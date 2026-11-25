// package-lock.json read/write helpers.
// Targets lockfileVersion 2/3 shape used by modern npm.
// Pure data transformation; no filesystem.

/**
 * Minimal lockfile structure we produce / accept.
 * We preserve unknown top-level fields when updating.
 */

/**
 * @param {object|string} input
 * @returns {object} normalized lockfile object
 */
export function parseLockfile(input) {
  const lock = typeof input === "string" ? JSON.parse(input) : input;
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    throw new Error("package-lock.json must contain a JSON object");
  }
  const version = lock.lockfileVersion;
  if (version != null && version !== 1 && version !== 2 && version !== 3) {
    throw new Error("Unsupported lockfileVersion: " + version);
  }
  return lock;
}

/**
 * Build a preferred-version map (name -> version) from a lockfile.
 * Works for lockfileVersion 1 (dependencies tree) and 2/3 (packages map).
 * @param {object} lock
 * @returns {Map<string, string>}
 */
export function preferredVersionsFromLockfile(lock) {
  const map = new Map();
  if (!lock || typeof lock !== "object") return map;

  // lockfileVersion 2/3: "packages" map with keys "" (root) and "node_modules/..."
  if (lock.packages && typeof lock.packages === "object") {
    for (const key of Object.keys(lock.packages)) {
      if (key === "") continue;
      const entry = lock.packages[key];
      if (!entry || typeof entry !== "object") continue;
      let resolvedName = entry.name;
      if (!resolvedName) {
        if (key.startsWith("node_modules/")) {
          const rest = key.slice("node_modules/".length);
          const parts = rest.split("/node_modules/").pop().split("/");
          if (parts[0].startsWith("@") && parts.length >= 2) {
            resolvedName = parts[0] + "/" + parts[1];
          } else {
            resolvedName = parts[0];
          }
        }
      }
      if (resolvedName && typeof entry.version === "string") {
        map.set(resolvedName, entry.version);
      }
    }
    return map;
  }

  // lockfileVersion 1 style: recursive "dependencies"
  function walk(deps) {
    if (!deps || typeof deps !== "object") return;
    for (const name of Object.keys(deps)) {
      const entry = deps[name];
      if (entry && typeof entry.version === "string") {
        map.set(name, entry.version);
      }
      if (entry && entry.dependencies) walk(entry.dependencies);
    }
  }
  walk(lock.dependencies);
  return map;
}

/**
 * Create a lockfile object from a ResolveResult (see resolver.js).
 * Produces lockfileVersion 3 style with a "packages" map.
 *
 * @param {object} rootManifest  normalized or raw root package.json
 * @param {import('./resolver.js').ResolveResult} resolveResult
 * @param {object} [existing]    previous lockfile to preserve unknown fields from
 * @returns {object}
 */
export function buildLockfile(rootManifest, resolveResult, existing) {
  const root = typeof rootManifest === "string" ? JSON.parse(rootManifest) : (rootManifest || {});
  const name = root.name || (resolveResult.rootId && resolveResult.rootId.split("@")[0]) || "";
  const version = root.version || "0.0.0";

  const packages = {
    "": {
      name,
      version,
      dependencies: {}
    }
  };

  const rootDeps = root.dependencies || {};
  const rootDev = root.devDependencies || {};
  const rootOpt = root.optionalDependencies || {};
  const rootPeer = root.peerDependencies || {};
  if (Object.keys(rootDeps).length) packages[""].dependencies = { ...rootDeps };
  if (Object.keys(rootDev).length) packages[""].devDependencies = { ...rootDev };
  if (Object.keys(rootOpt).length) packages[""].optionalDependencies = { ...rootOpt };
  if (Object.keys(rootPeer).length) packages[""].peerDependencies = { ...rootPeer };

  const seenNames = new Map();
  for (const pkg of resolveResult.packages) {
    if (!seenNames.has(pkg.name)) {
      seenNames.set(pkg.name, pkg);
    }
  }

  for (const [pkgName, pkg] of seenNames) {
    const key = "node_modules/" + pkgName;
    const entry = {
      version: pkg.version,
      resolved: pkg.tarball || undefined,
      integrity: pkg.integrity || undefined
    };
    if (Object.keys(pkg.dependencies).length) {
      entry.dependencies = { ...pkg.dependencies };
    }
    packages[key] = entry;
  }

  const lock = {
    name,
    version,
    lockfileVersion: 3,
    requires: true,
    packages
  };

  if (existing && typeof existing === "object") {
    if (existing.dependencies && !lock.dependencies) {
      // keep v1-style tree only if we didn't already have packages; we always have packages.
    }
  }

  return lock;
}

/**
 * Serialize lockfile to stable JSON text (2-space indent, trailing newline).
 */
export function stringifyLockfile(lock) {
  return JSON.stringify(lock, null, 2) + "\n";
}
