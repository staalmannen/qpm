// Install planner and executor.
// Resolve first, verify integrity, extract into node_modules. No lifecycle scripts.

import { assertInstallerHost, fetchBytes } from "./host.js";
import { resolveDependencies } from "./resolver.js";
import { makeFetchPackument } from "./host.js";
import { buildLockfile, stringifyLockfile, preferredVersionsFromLockfile, parseLockfile } from "./lockfile.js";
import { verifyIntegrity, pickIntegrity, parseIntegrity } from "./integrity.js";
import { planPlacement } from "./placement.js";

/**
 * Compute the node_modules path for a package name (supports scopes).
 * Prefer planPlacement for multi-version installs.
 * @param {import('./host.js').Host} host
 * @param {string} rootDir
 * @param {string} name
 */
export function packageInstallPath(host, rootDir, name) {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return host.pathJoin(rootDir, "node_modules", scope, pkg);
  }
  return host.pathJoin(rootDir, "node_modules", name);
}

/**
 * Install resolved packages into rootDir using placement plan (nested on conflict).
 *
 * @param {import('./host.js').Host} host
 * @param {import('./resolver.js').ResolveResult} resolveResult
 * @param {object} options
 * @param {string} options.rootDir
 * @param {boolean} [options.skipExisting=false]
 * @param {(msg: string) => void} [options.log]
 * @returns {Promise<{installed: string[], skipped: string[], placement: import('./placement.js').Placement[]}>}
 */
export async function installResolved(host, resolveResult, options) {
  assertInstallerHost(host);
  const rootDir = options.rootDir;
  if (!rootDir) throw new Error("installResolved requires options.rootDir");
  const log = options.log || (() => {});
  const skipExisting = options.skipExisting === true;

  const placement = planPlacement(resolveResult);
  const byId = new Map();
  for (const pkg of resolveResult.packages) {
    byId.set(pkg.id, pkg);
  }

  // Cache downloaded tarballs by id so nested copies of the same version
  // do not re-download.
  /** @type {Map<string, Uint8Array>} */
  const tarballCache = new Map();

  const installed = [];
  const skipped = [];

  for (const place of placement) {
    const pkg = byId.get(place.id);
    if (!pkg) throw new Error("Placement references unknown package " + place.id);

    const dest = host.pathJoin(rootDir, ...place.relPath.split("/"));
    if (skipExisting && await host.exists(dest)) {
      skipped.push(place.relPath + " (" + place.id + ")");
      continue;
    }
    if (!pkg.tarball) {
      throw new Error("No tarball URL for " + pkg.id);
    }

    let bytes = tarballCache.get(pkg.id);
    if (!bytes) {
      log("download " + pkg.id);
      bytes = await fetchBytes(host, pkg.tarball);
      const integrity = pkg.integrity || pkg.shasum;
      if (integrity) {
        log("verify  " + pkg.id);
        const ok = await verifyIntegrity(host, bytes, integrity);
        if (!ok) {
          throw new Error("Integrity check failed for " + pkg.id + " (" + integrity.slice(0, 24) + "...)");
        }
      } else {
        log("warn    " + pkg.id + " has no integrity metadata");
      }
      tarballCache.set(pkg.id, bytes);
    }

    const tmp = host.pathJoin(
      rootDir,
      "node_modules",
      ".qpm-tmp-" + place.relPath.replace(/[\/\\]/g, "__")
    );
    if (await host.exists(tmp)) await host.removeTree(tmp);
    await host.mkdirp(tmp);

    log("extract " + pkg.id + " -> " + place.relPath);
    await host.extractTarGz(bytes, tmp);

    if (await host.exists(dest)) await host.removeTree(dest);
    // Ensure parent directory exists (scoped packages, nested paths).
    const parentParts = place.relPath.split("/");
    parentParts.pop();
    if (parentParts.length) {
      await host.mkdirp(host.pathJoin(rootDir, ...parentParts));
    } else {
      await host.mkdirp(host.pathJoin(rootDir, "node_modules"));
    }
    await host.rename(tmp, dest);

    installed.push(place.relPath + " (" + place.id + ")");
  }

  return { installed, skipped, placement };
}

/**
 * High-level: read package.json (+ optional lockfile), resolve, install, write lockfile.
 *
 * @param {import('./host.js').Host} host
 * @param {object} options
 * @param {string} options.rootDir
 * @param {string} [options.registry]
 * @param {boolean} [options.includeDev=false]
 * @param {(msg: string) => void} [options.log]
 * @returns {Promise<object>}
 */
export async function installProject(host, options) {
  assertInstallerHost(host);
  const rootDir = options.rootDir;
  const log = options.log || (() => {});

  const manifestPath = host.pathJoin(rootDir, "package.json");
  const lockPath = host.pathJoin(rootDir, "package-lock.json");
  const manifestText = await host.readText(manifestPath);
  const manifest = JSON.parse(manifestText);

  let preferred = new Map();
  if (await host.exists(lockPath)) {
    try {
      const lock = parseLockfile(await host.readText(lockPath));
      preferred = preferredVersionsFromLockfile(lock);
      log("using existing package-lock.json (" + preferred.size + " locked versions)");
    } catch (e) {
      log("warning: could not parse package-lock.json: " + e.message);
    }
  }

  const fetchPackument = makeFetchPackument(host, options.registry);
  log("resolving dependencies...");
  const resolved = await resolveDependencies(manifest, {
    fetchPackument,
    preferred,
    includeDev: options.includeDev === true
  });
  log("resolved " + resolved.packages.length + " package(s)");

  const result = await installResolved(host, resolved, {
    rootDir,
    log
  });

  const lock = buildLockfile(manifest, resolved, null, result.placement);
  await host.writeText(lockPath, stringifyLockfile(lock));
  log("wrote package-lock.json");

  return {
    resolved,
    installed: result.installed,
    skipped: result.skipped,
    placement: result.placement,
    lock
  };
}

export { parseIntegrity, verifyIntegrity, pickIntegrity };
