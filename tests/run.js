import { compareVersions, satisfies, maxSatisfying } from "../src/semver.js";
import { normalizeManifest, validatePackageName } from "../src/manifest.js";
import { packageMetadataURL, selectVersion } from "../src/registry.js";

function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ": expected " + String(expected) + ", got " + String(actual));
  }
}
function truth(value, label) {
  if (!value) throw new Error(label + ": expected true");
}

equal(compareVersions("1.2.0", "1.1.9"), 1, "version ordering");
equal(compareVersions("1.0.0-alpha", "1.0.0"), -1, "prerelease ordering");
truth(satisfies("1.4.2", "^1.2.0"), "caret range");
truth(!satisfies("2.0.0", "^1.2.0"), "caret upper bound");
truth(satisfies("0.2.4", "^0.2.3"), "zero-major caret");
truth(!satisfies("0.3.0", "^0.2.3"), "zero-major caret upper bound");
truth(satisfies("1.3.0", "~1.2"), "tilde upper range");
truth(satisfies("1.2.9", "1.2.x"), "wildcard patch");
truth(satisfies("2.0.0", ">=1.0.0 <3.0.0"), "comparator set");
truth(satisfies("3.0.0", "^1.0.0 || ^3.0.0"), "range alternatives");
equal(maxSatisfying(["1.0.0", "1.2.0", "2.0.0"], "^1"), "1.2.0", "max satisfying");

const manifest = normalizeManifest({
  name: "demo",
  dependencies: { zod: "^3.0.0" },
  devDependencies: { testlib: "~1.2.0" }
});
equal(manifest.dependencies.zod.range, "^3.0.0", "manifest dependency");
equal(manifest.dependencies.testlib.section, "devDependencies", "manifest section");
truth(validatePackageName("@scope/pkg"), "scoped package name");
truth(!validatePackageName("../escape"), "reject path traversal name");
equal(packageMetadataURL("@scope/pkg"), "https://registry.npmjs.org/@scope%2fpkg", "scoped metadata URL");

const packument = {
  versions: { "1.0.0": {}, "1.4.0": {}, "2.0.0": {} },
  "dist-tags": { latest: "2.0.0" }
};
equal(selectVersion(packument, "^1.0.0"), "1.4.0", "registry version selection");
equal(selectVersion(packument, "latest"), "2.0.0", "latest dist-tag");

console.log("qpm core tests: ok");
