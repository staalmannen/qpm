// Install planner and executor.
// Resolve first, verify integrity, extract into node_modules. No lifecycle scripts.

import { assertInstallerHost, fetchBytes } from "./host.js";
import { resolveDependencies } from "./resolver.js";
import { makeFetchPackument } from "./host.js";
import { buildLockfile, stringifyLockfile, preferredVersionsFromLockfile, parseLockfile } from "./lockfile.js";
import { verifyIntegrity, pickIntegrity, parseIntegrity } from "./integrity.js";
import { normalizeManifest } from "./manifest.js";

/**
 * Compute the node_modules path for a package name (supports scopes).
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
 * Install resolved packages into rootDir/node_modules.
 *
 * @param {import('./host.js').Host} host
 * @param {import('./resolver.js').ResolveResult} resolveResult
 * @param {object} options
 * @param {string} options.rootDir
 * @param {boolean} [options.skipExisting=false]
 * @param {(msg: string) => void} [options.log]
 * @returns {Promise<{installed: string[], skipped: string[]}>}
 */
export async function installResolved(host, resolveResult, options) {
  assertInstallerHost(host);
  const rootDir = options.rootDir;
  if (!rootDir) throw new Error("installResolved requires options.rootDir");
  const log = options.log || (() => {});
  const skipExisting = options.skipExisting === true;

  // Prefer a single version per name (flat node_modules). First seen wins
  // (resolver pushes parents before children when possible).
  const byName = new Map();
  for (const pkg of resolveResult.packages) {
    if (!byName.has(pkg.name)) byName.set(pkg.name, pkg);
  }

  const installed = [];
  const skipped = [];

  for (const [name, pkg] of byName) {
    const dest = packageInstallPath(host, rootDir, name);
    if (skipExisting && await host.exists(dest)) {
      skipped.push(name + "@" + pkg.version);
      continue;
    }
    if (!pkg.tarball) {
      throw new Error("No tarball URL for " + pkg.id);
    }

    log("download " + pkg.id);
    const bytes = await fetchBytes(host, pkg.tarball);

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

    // Extract to a temp dir then rename into place for a slightly safer install.
    const tmp = host.pathJoin(rootDir, "node_modules", ".qpm-tmp-" + name.replace("/", "__") + "-" + pkg.version);
    if (await host.exists(tmp)) await host.removeTree(tmp);
    await host.mkdirp(tmp);

    log("extract " + pkg.id);
    await host.extractTarGz(bytes, tmp);

    // If destination exists, replace it.
    if (await host.exists(dest)) await host.removeTree(dest);
    // Ensure parent exists (scoped packages).
    const parent = name.startsWith("@")
      ? host.pathJoin(rootDir, "node_modules", name.split("/")[0])
      : host.pathJoin(rootDir, "node_modules");
    await host.mkdirp(parent);
    await host.rename(tmp, dest);

    installed.push(name + "@" + pkg.version);
  }

  return { installed, skipped };
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

  const lock = buildLockfile(manifest, resolved);
  await host.writeText(lockPath, stringifyLockfile(lock));
  log("wrote package-lock.json");

  return {
    resolved,
    installed: result.installed,
    skipped: result.skipped,
    lock
  };
}

export { parseIntegrity, verifyIntegrity, pickIntegrity };
