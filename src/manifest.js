// package.json helpers. No filesystem or Node.js dependencies.

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export function normalizeManifest(input) {
  const manifest = typeof input === "string" ? JSON.parse(input) : input;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("package.json must contain a JSON object");
  }
  if (manifest.name != null && (typeof manifest.name !== "string" || !manifest.name)) {
    throw new Error("package.json name must be a non-empty string");
  }
  const result = {
    name: manifest.name || null,
    version: manifest.version || null,
    dependencies: {}
  };
  for (const section of SECTIONS) {
    const entries = manifest[section];
    if (entries == null) continue;
    if (typeof entries !== "object" || Array.isArray(entries)) {
      throw new Error(section + " must be an object");
    }
    for (const name of Object.keys(entries).sort()) {
      const range = entries[name];
      if (typeof range !== "string" || !range.trim()) {
        throw new Error("Invalid dependency range for " + name);
      }
      if (result.dependencies[name] && result.dependencies[name].range !== range) {
        throw new Error("Dependency " + name + " occurs in multiple sections with different ranges");
      }
      result.dependencies[name] = { range, section };
    }
  }
  return result;
}

export function validatePackageName(name) {
  if (typeof name !== "string" || !name || name.length > 214) return false;
  // npm allows only lowercase, and scoped names are @scope/name
  if (name.startsWith("@")) {
    const parts = name.split("/");
    if (parts.length !== 2) return false;
    const scope = parts[0].slice(1); // drop leading @
    const pkg = parts[1];
    if (!scope || !pkg) return false;
    return /^[a-z0-9._~-]+$/.test(scope) && /^[a-z0-9._~-]+$/.test(pkg);
  }
  return /^[a-z0-9._~-]+$/.test(name);
}

/**
 * Collect top-level dependency requests from a normalized manifest.
 * @param {object} normalized - result of normalizeManifest
 * @param {object} [options]
 * @param {boolean} [options.includeDev=false]
 * @param {boolean} [options.includeOptional=true]
 * @param {boolean} [options.includePeer=false]
 * @returns {Array<{name: string, range: string, section: string}>}
 */
export function collectDependencies(normalized, options = {}) {
  const includeDev = options.includeDev === true;
  const includeOptional = options.includeOptional !== false;
  const includePeer = options.includePeer === true;
  const out = [];
  for (const name of Object.keys(normalized.dependencies).sort()) {
    const dep = normalized.dependencies[name];
    if (dep.section === "devDependencies" && !includeDev) continue;
    if (dep.section === "optionalDependencies" && !includeOptional) continue;
    if (dep.section === "peerDependencies" && !includePeer) continue;
    out.push({ name, range: dep.range, section: dep.section });
  }
  return out;
}
