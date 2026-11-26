// Thin CLI entry for qpm (Node host). Portable core stays free of Node APIs;
// this file is the development/runtime entry that wires host + commands.

import { createNodeHost } from "./host-node.js";
import { createRegistryClient } from "./registry-client.js";
import { installProject } from "./installer.js";
import { resolveDependencies, flattenResolved } from "./resolver.js";
import { makeFetchPackument } from "./host.js";
import { parseLockfile, preferredVersionsFromLockfile } from "./lockfile.js";
import { planPlacement } from "./placement.js";
import { parseArgs } from "./args.js";

const VERSION = "0.0.1";

function usage() {
  return [
    "qpm " + VERSION + " — portable npm-compatible package manager",
    "",
    "Usage:",
    "  qpm install              Install dependencies from package.json",
    "  qpm info <pkg> [range]   Show package metadata from the registry",
    "  qpm resolve              Resolve dependency graph (no install)",
    "  qpm help                 Show this help",
    "",
    "Options:",
    "  --dir <path>             Project directory (default: cwd)",
    "  --registry <url>         Registry base URL",
    "  --dev                    Include devDependencies on install/resolve",
    "  --json                   Machine-readable output where applicable"
  ].join("\n");
}

export { parseArgs };

/**
 * @param {object} options
 * @param {string[]} options.argv
 * @param {(msg: string) => void} [options.log]
 * @param {(msg: string) => void} [options.err]
 * @param {import('./host.js').Host} [options.host]
 * @returns {Promise<number>} exit code
 */
export async function runCli(options) {
  const log = options.log || console.log;
  const err = options.err || console.error;
  const host = options.host || createNodeHost();
  let parsed;
  try {
    parsed = parseArgs(options.argv || []);
  } catch (e) {
    err(e.message);
    err(usage());
    return 2;
  }

  const { command, args, flags } = parsed;
  if (flags.help || command === "help" || command === "--help") {
    log(usage());
    return 0;
  }

  const rootDir = flags.dir || host.cwd();

  try {
    if (command === "info" || command === "view") {
      return await cmdInfo(host, args, flags, log, err);
    }
    if (command === "install" || command === "i") {
      return await cmdInstall(host, rootDir, flags, log, err);
    }
    if (command === "resolve") {
      return await cmdResolve(host, rootDir, flags, log, err);
    }
    err("Unknown command: " + command);
    err(usage());
    return 2;
  } catch (e) {
    err(e && e.stack ? e.stack : String(e));
    return 1;
  }
}

async function cmdInfo(host, args, flags, log, err) {
  const name = args[0];
  const range = args[1] || "latest";
  if (!name) {
    err("usage: qpm info <package> [range]");
    return 2;
  }
  const client = createRegistryClient(host, { registry: flags.registry || undefined });
  const { version, metadata } = await client.getVersion(name, range);
  const dist = metadata.dist || {};
  if (flags.json) {
    log(JSON.stringify({ name, version, description: metadata.description || null, dist }, null, 2));
    return 0;
  }
  log(name + "@" + version);
  if (metadata.description) log(metadata.description);
  log("tarball:   " + (dist.tarball || "(none)"));
  log("integrity: " + (dist.integrity || dist.shasum || "(none)"));
  const deps = metadata.dependencies;
  if (deps && Object.keys(deps).length) {
    log("dependencies:");
    for (const k of Object.keys(deps).sort()) {
      log("  " + k + ": " + deps[k]);
    }
  }
  return 0;
}

async function cmdInstall(host, rootDir, flags, log) {
  const result = await installProject(host, {
    rootDir,
    registry: flags.registry || undefined,
    includeDev: flags.dev,
    log: (m) => log(m)
  });
  if (flags.json) {
    log(JSON.stringify({
      installed: result.installed,
      skipped: result.skipped,
      count: result.installed.length
    }, null, 2));
  } else {
    log("done: " + result.installed.length + " installed" +
      (result.skipped.length ? ", " + result.skipped.length + " skipped" : ""));
  }
  return 0;
}

async function cmdResolve(host, rootDir, flags, log) {
  const manifestPath = host.pathJoin(rootDir, "package.json");
  const lockPath = host.pathJoin(rootDir, "package-lock.json");
  const manifest = JSON.parse(await host.readText(manifestPath));
  let preferred = new Map();
  if (await host.exists(lockPath)) {
    try {
      preferred = preferredVersionsFromLockfile(parseLockfile(await host.readText(lockPath)));
    } catch {
      /* ignore bad lock */
    }
  }
  const fetchPackument = makeFetchPackument(host, flags.registry || undefined);
  const resolved = await resolveDependencies(manifest, {
    fetchPackument,
    preferred,
    includeDev: flags.dev
  });
  const placement = planPlacement(resolved);
  if (flags.json) {
    log(JSON.stringify({
      packages: resolved.packages.map((p) => ({ id: p.id, range: p.range })),
      placement: placement.map((p) => ({
        id: p.id,
        path: p.relPath,
        nested: p.nested
      }))
    }, null, 2));
  } else {
    log("resolved " + resolved.packages.length + " package(s):");
    for (const p of resolved.packages) {
      log("  " + p.id + " (requested " + p.range + ")");
    }
    log("placement (" + placement.length + " install path(s)):");
    for (const p of placement) {
      log("  " + p.relPath + " <- " + p.id + (p.nested ? " [nested]" : ""));
    }
  }
  return 0;
}
