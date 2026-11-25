// Small, dependency-free semver subset for qpm.
// Deliberately no Node.js APIs. See DESIGN.md for supported range syntax.

function parseVersion(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().replace(/^[v=]/, "");
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s);
  if (!m) return null;
  const pre = m[4] ? m[4].split(".") : [];
  for (const id of pre) {
    if (!id || (/^\d+$/.test(id) && id.length > 1 && id[0] === "0")) return null;
  }
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: pre };
}

export function compareVersions(a, b) {
  const x = typeof a === "string" ? parseVersion(a) : a;
  const y = typeof b === "string" ? parseVersion(b) : b;
  if (!x || !y) throw new Error("Invalid semantic version");
  for (const k of ["major", "minor", "patch"]) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  const xp = x.prerelease, yp = y.prerelease;
  if (!xp.length && !yp.length) return 0;
  if (!xp.length) return 1;
  if (!yp.length) return -1;
  const n = Math.min(xp.length, yp.length);
  for (let i = 0; i < n; i++) {
    if (xp[i] === yp[i]) continue;
    const xn = /^\d+$/.test(xp[i]), yn = /^\d+$/.test(yp[i]);
    if (xn && yn) return +xp[i] < +yp[i] ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return xp[i] < yp[i] ? -1 : 1;
  }
  return xp.length === yp.length ? 0 : (xp.length < yp.length ? -1 : 1);
}

function partialVersion(token) {
  const t = token.replace(/^[v=]/, "");
  const m = /^(\d+|x|X|\*)?(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(t);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]];
  let wildcard = false;
  const nums = [];
  for (const p of parts) {
    if (p == null || /^[x*]$/i.test(p)) {
      wildcard = true;
      nums.push(null);
    } else {
      if (wildcard || !/^(0|[1-9]\d*)$/.test(p)) return null;
      nums.push(+p);
    }
  }
  return {
    major: nums[0],
    minor: nums[1],
    patch: nums[2],
    prerelease: m[4] ? m[4].split(".") : [],
    precision: parts.filter(p => p != null && !/^[x*]$/i.test(p)).length,
    wildcard
  };
}

function floorOf(p) {
  return { major: p.major || 0, minor: p.minor || 0, patch: p.patch || 0, prerelease: p.prerelease || [] };
}

function upperForPartial(p) {
  if (p.major == null) return null;
  if (p.minor == null) return { major: p.major + 1, minor: 0, patch: 0, prerelease: [] };
  if (p.patch == null) return { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] };
  return null;
}

function testComparator(version, op, target) {
  const c = compareVersions(version, target);
  if (op === ">") return c > 0;
  if (op === ">=") return c >= 0;
  if (op === "<") return c < 0;
  if (op === "<=") return c <= 0;
  return c === 0;
}

function testToken(version, raw) {
  let token = raw.trim();
  if (!token || token === "*" || /^[xX]$/.test(token)) return true;
  const opMatch = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(token);
  const op = opMatch[1] || "";
  const p = partialVersion(opMatch[2]);
  if (!p) return false;
  const target = floorOf(p);

  if (op === "^" || op === "~") {
    if (compareVersions(version, target) < 0) return false;
    // Prerelease versions only match a caret/tilde range when they share the
    // same [major, minor, patch] as the range target (npm/node-semver rule).
    if (version.prerelease.length && target.prerelease.length) {
      if (version.major !== target.major ||
          version.minor !== target.minor ||
          version.patch !== target.patch) {
        return false;
      }
    }
    let upper;
    if (op === "~") {
      upper = p.minor == null
        ? { major: target.major + 1, minor: 0, patch: 0, prerelease: [] }
        : { major: target.major, minor: target.minor + 1, patch: 0, prerelease: [] };
    } else if (target.major > 0) {
      upper = { major: target.major + 1, minor: 0, patch: 0, prerelease: [] };
    } else if (p.minor == null) {
      upper = { major: 1, minor: 0, patch: 0, prerelease: [] };
    } else if (target.minor > 0) {
      upper = { major: 0, minor: target.minor + 1, patch: 0, prerelease: [] };
    } else if (p.patch == null) {
      upper = { major: 0, minor: 1, patch: 0, prerelease: [] };
    } else {
      upper = { major: 0, minor: 0, patch: target.patch + 1, prerelease: [] };
    }
    return compareVersions(version, upper) < 0;
  }

  if (!op && p.wildcard) {
    if (p.major == null) return true;
    if (version.major !== p.major) return false;
    if (p.minor == null) return true;
    if (version.minor !== p.minor) return false;
    return p.patch == null || version.patch === p.patch;
  }
  if (!op && p.precision < 3) {
    const upper = upperForPartial(p);
    return compareVersions(version, target) >= 0 &&
      (!upper || compareVersions(version, upper) < 0);
  }
  return testComparator(version, op || "=", target);
}

function testSet(version, range) {
  const s = range.trim();
  if (!s || s === "*" || /^[xX]$/.test(s)) return !version.prerelease.length;
  const hyphen = /^(.+?)\s+-\s+(.+)$/.exec(s);
  if (hyphen) {
    const lo = partialVersion(hyphen[1].trim());
    const hi = partialVersion(hyphen[2].trim());
    if (!lo || !hi) return false;
    if (compareVersions(version, floorOf(lo)) < 0) return false;
    const upper = upperForPartial(hi);
    return upper ? compareVersions(version, upper) < 0 : compareVersions(version, floorOf(hi)) <= 0;
  }
  const tokens = s.split(/\s+/).filter(Boolean);
  if (version.prerelease.length && !tokens.some(t => t.includes("-"))) return false;
  return tokens.every(t => testToken(version, t));
}

export function satisfies(versionText, range) {
  const version = parseVersion(versionText);
  if (!version || typeof range !== "string") return false;
  return range.split("||").some(part => testSet(version, part));
}

export function maxSatisfying(versionStrings, range) {
  let best = null;
  for (const s of versionStrings) {
    if (!satisfies(s, range)) continue;
    if (best == null || compareVersions(s, best) > 0) best = s;
  }
  return best;
}

export function parseVersionSafe(input) {
  return parseVersion(input);
}
