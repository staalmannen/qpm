// Conformance-oriented fixtures for qpm semver.
// Expected results follow npm/node-semver default behavior
// (includePrerelease = false).

export const COMPARE = [
  // [a, b, expected compareVersions(a,b)]
  ["1.0.0", "1.0.0", 0],
  ["1.0.0", "1.0.1", -1],
  ["1.0.1", "1.0.0", 1],
  ["1.0.0", "1.1.0", -1],
  ["1.1.0", "1.0.0", 1],
  ["1.0.0", "2.0.0", -1],
  ["2.0.0", "1.0.0", 1],
  ["1.0.0-alpha", "1.0.0", -1],
  ["1.0.0", "1.0.0-alpha", 1],
  ["1.0.0-alpha", "1.0.0-alpha", 0],
  ["1.0.0-alpha", "1.0.0-beta", -1],
  ["1.0.0-beta", "1.0.0-alpha", 1],
  ["1.0.0-alpha.1", "1.0.0-alpha", 1],
  ["1.0.0-alpha", "1.0.0-alpha.1", -1],
  ["1.0.0-alpha.1", "1.0.0-alpha.beta", -1], // numeric < non-numeric
  ["1.0.0-alpha.beta", "1.0.0-alpha.1", 1],
  ["1.0.0-alpha.beta", "1.0.0-beta", -1],
  ["1.0.0-beta", "1.0.0-beta.2", -1],
  ["1.0.0-beta.2", "1.0.0-beta.11", -1],
  ["1.0.0-beta.11", "1.0.0-rc.1", -1],
  ["1.0.0-rc.1", "1.0.0", -1],
  ["v1.2.3", "1.2.3", 0],
  ["=1.2.3", "1.2.3", 0],
  ["1.2.3+build", "1.2.3", 0], // build metadata ignored in precedence
  ["1.2.3+build.1", "1.2.3+build.2", 0]
];

// [version, range, expected satisfies]
export const SATISFIES = [
  // exact / equality
  ["1.2.3", "1.2.3", true],
  ["1.2.3", "=1.2.3", true],
  ["1.2.4", "1.2.3", false],
  ["1.2.3", "v1.2.3", true],

  // wildcards / x-ranges
  ["1.2.3", "*", true],
  ["1.2.3", "x", true],
  ["1.2.3", "X", true],
  ["1.2.3", "1.x", true],
  ["1.2.3", "1.X", true],
  ["1.2.3", "1.*", true],
  ["2.0.0", "1.x", false],
  ["1.2.3", "1.2.x", true],
  ["1.3.0", "1.2.x", false],
  ["1.2.3", "1.2.*", true],
  ["1.2.0", "1.2", true],
  ["1.3.0", "1.2", false],
  ["1.0.0", "1", true],
  ["2.0.0", "1", false],

  // comparators
  ["1.2.3", ">1.2.2", true],
  ["1.2.3", ">1.2.3", false],
  ["1.2.3", ">=1.2.3", true],
  ["1.2.3", ">=1.2.4", false],
  ["1.2.3", "<1.2.4", true],
  ["1.2.3", "<1.2.3", false],
  ["1.2.3", "<=1.2.3", true],
  ["1.2.3", "<=1.2.2", false],
  ["2.0.0", ">=1.0.0 <3.0.0", true],
  ["3.0.0", ">=1.0.0 <3.0.0", false],
  ["1.0.0", ">=1.0.0 <3.0.0", true],

  // caret
  ["1.2.3", "^1.2.3", true],
  ["1.9.9", "^1.2.3", true],
  ["2.0.0", "^1.2.3", false],
  ["1.2.2", "^1.2.3", false],
  ["0.2.5", "^0.2.3", true],
  ["0.3.0", "^0.2.3", false],
  ["0.0.4", "^0.0.3", false], // caret on 0.0.x only allows that patch
  ["0.0.3", "^0.0.3", true],
  ["0.0.4", "^0.0.3", false],
  ["1.0.0", "^1.0.0", true],
  ["1.0.0-alpha", "^1.0.0", false], // prerelease excluded by default
  ["1.2.3-alpha", "^1.2.3-alpha", true],
  ["1.2.3-beta", "^1.2.3-alpha", true],
  ["1.2.4-alpha", "^1.2.3-alpha", false],

  // tilde
  ["1.2.3", "~1.2.3", true],
  ["1.2.9", "~1.2.3", true],
  ["1.3.0", "~1.2.3", false],
  ["1.2.9", "~1.2", true],
  ["1.3.0", "~1.2", false],
  ["1.9.0", "~1", true],
  ["2.0.0", "~1", false],
  ["0.2.4", "~0.2.3", true],
  ["0.3.0", "~0.2.3", false],

  // hyphen ranges
  ["1.2.3", "1.2.3 - 2.3.4", true],
  ["2.3.4", "1.2.3 - 2.3.4", true],
  ["1.2.2", "1.2.3 - 2.3.4", false],
  ["2.3.5", "1.2.3 - 2.3.4", false],
  ["1.2.0", "1.2 - 2.3.4", true],
  ["2.3.4", "1.2.3 - 2.3", true],
  ["2.4.0", "1.2.3 - 2.3", false],
  ["2.9.9", "1.2.3 - 2", true],
  ["3.0.0", "1.2.3 - 2", false],

  // OR
  ["1.0.0", "^1.0.0 || ^2.0.0", true],
  ["2.1.0", "^1.0.0 || ^2.0.0", true],
  ["3.0.0", "^1.0.0 || ^2.0.0", false],

  // prerelease rules (default: only match if range mentions prerelease)
  ["1.0.0-alpha", "1.0.0-alpha", true],
  ["1.0.0-alpha", ">=1.0.0-alpha", true],
  ["1.0.0-alpha", "*", false],
  ["1.0.0-alpha", ">=0.0.0", false],
  ["1.0.0", ">=1.0.0-alpha", true],
  ["1.0.1-alpha", "^1.0.0", false],

  // spaced comparators
  ["1.5.0", ">1.0.0 <2.0.0", true],
  ["2.0.0", ">1.0.0 <2.0.0", false]
];

// [versions[], range, expected maxSatisfying or null]
export const MAX_SATISFYING = [
  [["1.0.0", "1.2.0", "2.0.0"], "^1", "1.2.0"],
  [["1.0.0", "1.2.0", "2.0.0"], "^2", "2.0.0"],
  [["1.0.0", "1.2.0", "2.0.0"], "^3", null],
  [["1.0.0-alpha", "1.0.0", "1.1.0"], "*", "1.1.0"],
  [["1.0.0-alpha", "1.0.0-beta"], "*", null],
  [["1.2.3", "1.2.4", "1.3.0"], "~1.2.3", "1.2.4"],
  [["0.1.0", "0.2.0", "1.0.0"], "^0.1.0", "0.1.0"]
];
