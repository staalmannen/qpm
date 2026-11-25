// Install-path planner: hoist one version per name to the top-level
// node_modules; nest additional versions under the dependent that needs them.
// Pure data: no host I/O.

/**
 * @typedef {object} Placement
 * @property {string} id           "name@version"
 * @property {string} name
 * @property {string} version
 * @property {string} relPath      path relative to project root, e.g. "node_modules/foo"
 *                                 or "node_modules/bar/node_modules/foo"
 * @property {boolean} nested
 * @property {string|null} parentId
 */

/**
 * Build relative node_modules path segments for a package name (scoped-aware).
 * @param {string} name
 * @returns {string[]}
 */
export function nameToSegments(name) {
  if (name.startsWith("@")) {
    const parts = name.split("/");
    if (parts.length !== 2) throw new Error("Invalid scoped name: " + name);
    return ["node_modules", parts[0], parts[1]];
  }
  return ["node_modules", name];
}

/**
 * Join path segments with "/".
 * @param {string[]} segments
 */
export function joinRel(...segments) {
  return segments.filter(Boolean).join("/");
}

/**
 * Plan install paths for a ResolveResult.
 *
 * Strategy (simplified npm-style hoisting):
 * 1. Walk packages in resolver order (parents tend to appear first).
 * 2. First version of each name is hoisted to top-level node_modules.
 * 3. A later different version is nested under each parent that depends on it.
 * 4. Same version as the hoisted one is deduplicated (no extra install).
 *
 * @param {import('./resolver.js').ResolveResult} resolveResult
 * @returns {Placement[]}
 */
export function planPlacement(resolveResult) {
  const packages = resolveResult.packages || [];
  const edges = resolveResult.edges || new Map();
  const rootId = resolveResult.rootId;

  // parentId -> Set of child ids (from edges)
  // Also build reverse: childId -> parentIds
  const parentsOf = new Map();
  for (const [parentId, kids] of edges.entries()) {
    for (const kid of kids) {
      if (!parentsOf.has(kid)) parentsOf.set(kid, []);
      parentsOf.get(kid).push(parentId);
    }
  }

  /** @type {Map<string, string>} name -> version hoisted to root */
  const hoisted = new Map();
  /** @type {Map<string, Placement>} id -> placement (first placement wins for lookup) */
  const byId = new Map();
  /** @type {Placement[]} */
  const placements = [];

  function relForNested(parentRelPath, name) {
    const segs = nameToSegments(name);
    // segs is ["node_modules", ...name]
    if (!parentRelPath) return joinRel(...segs);
    return joinRel(parentRelPath, ...segs);
  }

  for (const pkg of packages) {
    const existingHoist = hoisted.get(pkg.name);

    if (existingHoist == null) {
      // First version of this name: hoist to top level.
      const relPath = joinRel(...nameToSegments(pkg.name));
      const place = {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        relPath,
        nested: false,
        parentId: null
      };
      hoisted.set(pkg.name, pkg.version);
      byId.set(pkg.id, place);
      placements.push(place);
      continue;
    }

    if (existingHoist === pkg.version) {
      // Same version already at root — dedupe. Record byId for parent lookups
      // but do not emit a second placement.
      if (!byId.has(pkg.id)) {
        byId.set(pkg.id, {
          id: pkg.id,
          name: pkg.name,
          version: pkg.version,
          relPath: joinRel(...nameToSegments(pkg.name)),
          nested: false,
          parentId: null
        });
      }
      continue;
    }

    // Different version: nest under each parent that is not the synthetic root.
    const parentIds = parentsOf.get(pkg.id) || [];
    let nestedAny = false;
    for (const parentId of parentIds) {
      if (parentId === rootId) {
        // Root itself requested this version but another version was already
        // hoisted. Nest under a virtual conflict path at top level is wrong;
        // place a nested copy under a synthetic path is not npm-like.
        // Prefer nesting with a unique path under node_modules/.qpm-nested/ —
        // but standard npm would nest under the root dependency that needs it.
        // If the root edge needs this version, we still need a physical copy.
        // Use node_modules/<name> already taken; root conflict is rare when
        // root deps are processed first. Fall through to nest under nothing
        // only if no other parent — then force a nested path.
        continue;
      }
      const parentPlace = byId.get(parentId);
      if (!parentPlace) continue;
      const relPath = relForNested(parentPlace.relPath, pkg.name);
      // Avoid duplicate placements at the same path.
      if (placements.some((p) => p.relPath === relPath)) continue;
      const place = {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        relPath,
        nested: true,
        parentId
      };
      placements.push(place);
      nestedAny = true;
      if (!byId.has(pkg.id)) byId.set(pkg.id, place);
    }

    if (!nestedAny) {
      // No concrete parent placement (e.g. only root requested the alternate
      // version). Nest under a dedicated path so both versions coexist.
      const segs = nameToSegments(pkg.name); // ["node_modules", ...]
      const alt = joinRel("node_modules", ".qpm-nested", pkg.version, ...segs.slice(1));
      const place = {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        relPath: alt,
        nested: true,
        parentId: null
      };
      placements.push(place);
      if (!byId.has(pkg.id)) byId.set(pkg.id, place);
    }
  }

  return placements;
}

/**
 * Group placements by id (one id may appear under multiple parents).
 * @param {Placement[]} placements
 * @returns {Map<string, Placement[]>}
 */
export function placementsById(placements) {
  const map = new Map();
  for (const p of placements) {
    if (!map.has(p.id)) map.set(p.id, []);
    map.get(p.id).push(p);
  }
  return map;
}
