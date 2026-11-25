// Dependency graph resolver. Pure ES modules, no host I/O.
// Accepts a fetchPackument(name) callback so the host supplies registry access.

import { selectVersion, getVersionMetadata, getDistInfo } from "./registry.js";
import { normalizeManifest, collectDependencies, validatePackageName } from "./manifest.js";
import { satisfies } from "./semver.js";

/**
 * @typedef {object} ResolvedPackage
 * @property {string} name
 * @property {string} version
 * @property {string} range
 * @property {string} section
 * @property {string|null} tarball
 * @property {string|null} integrity
 * @property {string|null} shasum
 * @property {object} dependencies
 * @property {string} id
 */

/**
 * @typedef {object} ResolveResult
 * @property {ResolvedPackage[]} packages
 * @property {Map<string, ResolvedPackage>} byId
 * @property {Map<string, string[]>} edges
 */

/**
 * Resolve a dependency graph starting from a root manifest.
 *
 * @param {object} rootManifestRaw
 * @param {object} options
 * @param {(name: string) => Promise<object>|object} options.fetchPackument
 * @param {boolean} [options.includeDev=false]
 * @param {boolean} [options.includeOptional=true]
 * @param {boolean} [options.includePeer=false]
 * @param {Map<string, string>} [options.preferred]
 * @returns {Promise<ResolveResult>}
 */
export async function resolveDependencies(rootManifestRaw, options) {
  if (!options || typeof options.fetchPackument !== "function") {
    throw new Error("resolveDependencies requires options.fetchPackument");
  }
  const fetchPackument = options.fetchPackument;
  const includeDev = options.includeDev === true;
  const includeOptional = options.includeOptional !== false;
  const includePeer = options.includePeer === true;
  const preferred = options.preferred || new Map();

  const root = normalizeManifest(rootManifestRaw);
  const byId = new Map();
  const edges = new Map();
  const visiting = new Set();
  const packages = [];

  async function resolveOne(name, range, section, parentId) {
    if (!validatePackageName(name)) {
      throw new Error("Invalid package name in dependency graph: " + name);
    }

    let version = null;
    if (preferred.has(name)) {
      const cand = preferred.get(name);
      if (satisfies(cand, range)) version = cand;
    }

    const packument = await Promise.resolve(fetchPackument(name));
    if (!version) {
      version = selectVersion(packument, range);
    }
    const { metadata } = getVersionMetadata(packument, version);
    const dist = getDistInfo(metadata);
    const id = name + "@" + version;

    if (parentId) {
      if (!edges.has(parentId)) edges.set(parentId, []);
      const kids = edges.get(parentId);
      if (!kids.includes(id)) kids.push(id);
    }

    if (byId.has(id)) {
      return byId.get(id);
    }

    if (visiting.has(id)) {
      const stub = {
        name,
        version,
        range,
        section,
        tarball: dist.tarball,
        integrity: dist.integrity,
        shasum: dist.shasum,
        dependencies: {},
        id
      };
      byId.set(id, stub);
      packages.push(stub);
      return stub;
    }

    visiting.add(id);

    const childManifest = normalizeManifest({
      name: metadata.name || name,
      version: metadata.version || version,
      dependencies: metadata.dependencies,
      optionalDependencies: metadata.optionalDependencies,
      peerDependencies: metadata.peerDependencies
    });

    const deps = {};
    for (const d of collectDependencies(childManifest, {
      includeDev: false,
      includeOptional,
      includePeer
    })) {
      deps[d.name] = d.range;
    }

    const node = {
      name,
      version,
      range,
      section,
      tarball: dist.tarball,
      integrity: dist.integrity,
      shasum: dist.shasum,
      dependencies: deps,
      id
    };
    byId.set(id, node);
    packages.push(node);

    for (const childName of Object.keys(deps).sort()) {
      await resolveOne(childName, deps[childName], "dependencies", id);
    }

    visiting.delete(id);
    return node;
  }

  const rootDeps = collectDependencies(root, { includeDev, includeOptional, includePeer });
  const rootId = (root.name || "root") + "@" + (root.version || "0.0.0");
  edges.set(rootId, []);

  for (const dep of rootDeps) {
    await resolveOne(dep.name, dep.range, dep.section, rootId);
  }

  return { packages, byId, edges, rootId };
}

/**
 * Simple flat map of name -> version for the resolved set.
 */
export function flattenResolved(result) {
  const map = new Map();
  for (const pkg of result.packages) {
    map.set(pkg.name, pkg.version);
  }
  return map;
}
