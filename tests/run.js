import { compareVersions, satisfies, maxSatisfying } from "../src/semver.js";
import { normalizeManifest, validatePackageName, collectDependencies } from "../src/manifest.js";
import { packageMetadataURL, selectVersion, getDistInfo } from "../src/registry.js";
import { resolveDependencies, flattenResolved } from "../src/resolver.js";
import { parseLockfile, preferredVersionsFromLockfile, buildLockfile, stringifyLockfile } from "../src/lockfile.js";
import { assertHost, makeFetchPackument } from "../src/host.js";
import { COMPARE, SATISFIES, MAX_SATISFYING } from "./semver-fixtures.js";

let assertions = 0;
let failures = [];

console.log("qpm core tests");
console.log("---------------");

function equal(actual, expected, label) {
  assertions++;
  if (actual !== expected) {
    failures.push(label + ": expected " + String(expected) + ", got " + String(actual));
  }
}
function truth(value, label) {
  assertions++;
  if (!value) failures.push(label + ": expected true");
}
function falsy(value, label) {
  assertions++;
  if (value) failures.push(label + ": expected false");
}

try {
  // ========== semver fixtures ==========
  for (const [a, b, exp] of COMPARE) {
    equal(compareVersions(a, b), exp, "compare " + a + " vs " + b);
  }
  for (const [ver, range, exp] of SATISFIES) {
    const got = satisfies(ver, range);
    if (exp) truth(got, "satisfies(" + ver + ", " + range + ")");
    else falsy(got, "!satisfies(" + ver + ", " + range + ")");
  }
  for (const [versions, range, exp] of MAX_SATISFYING) {
    equal(maxSatisfying(versions, range), exp, "maxSatisfying " + range);
  }

  // ========== manifest ==========
  const manifest = normalizeManifest({
    name: "demo",
    dependencies: { zod: "^3.0.0" },
    devDependencies: { testlib: "~1.2.0" }
  });
  equal(manifest.dependencies.zod.range, "^3.0.0", "manifest dependency");
  equal(manifest.dependencies.testlib.section, "devDependencies", "manifest section");
  truth(validatePackageName("@scope/pkg"), "scoped package name");
  truth(!validatePackageName("../escape"), "reject path traversal name");
  truth(!validatePackageName(""), "reject empty name");
  truth(validatePackageName("left-pad"), "simple name");

  const collected = collectDependencies(manifest, { includeDev: true });
  equal(collected.length, 2, "collectDependencies count");
  equal(collected[0].name, "testlib", "collectDependencies sorted");

  // ========== registry ==========
  equal(packageMetadataURL("@scope/pkg"), "https://registry.npmjs.org/@scope%2fpkg", "scoped metadata URL");
  equal(packageMetadataURL("left-pad"), "https://registry.npmjs.org/left-pad", "unscoped metadata URL");

  const packument = {
    versions: {
      "1.0.0": { dist: { tarball: "https://example.com/a-1.0.0.tgz", integrity: "sha512-aaa" } },
      "1.4.0": { dist: { tarball: "https://example.com/a-1.4.0.tgz", integrity: "sha512-bbb" } },
      "2.0.0": { dist: { tarball: "https://example.com/a-2.0.0.tgz", integrity: "sha512-ccc" } }
    },
    "dist-tags": { latest: "2.0.0" }
  };
  equal(selectVersion(packument, "^1.0.0"), "1.4.0", "registry version selection");
  equal(selectVersion(packument, "latest"), "2.0.0", "latest dist-tag");
  const dist = getDistInfo(packument.versions["1.4.0"]);
  equal(dist.integrity, "sha512-bbb", "dist integrity");

  // ========== resolver (in-memory registry) ==========
  const registry = {
    "left-pad": {
      name: "left-pad",
      "dist-tags": { latest: "1.3.0" },
      versions: {
        "1.2.0": {
          name: "left-pad",
          version: "1.2.0",
          dist: { tarball: "https://registry.npmjs.org/left-pad/-/left-pad-1.2.0.tgz", integrity: "sha512-lp1" }
        },
        "1.3.0": {
          name: "left-pad",
          version: "1.3.0",
          dist: { tarball: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", integrity: "sha512-lp2" }
        }
      }
    },
    "is-array": {
      name: "is-array",
      "dist-tags": { latest: "1.0.1" },
      versions: {
        "1.0.0": {
          name: "is-array",
          version: "1.0.0",
          dependencies: { "left-pad": "^1.2.0" },
          dist: { tarball: "https://registry.npmjs.org/is-array/-/is-array-1.0.0.tgz", integrity: "sha512-ia1" }
        },
        "1.0.1": {
          name: "is-array",
          version: "1.0.1",
          dependencies: { "left-pad": "^1.2.0" },
          dist: { tarball: "https://registry.npmjs.org/is-array/-/is-array-1.0.1.tgz", integrity: "sha512-ia2" }
        }
      }
    }
  };

  async function fakeFetch(name) {
    if (!registry[name]) throw new Error("Package not in test registry: " + name);
    return registry[name];
  }

  const resolved = await resolveDependencies(
    {
      name: "demo-app",
      version: "1.0.0",
      dependencies: { "is-array": "^1.0.0" }
    },
    { fetchPackument: fakeFetch }
  );

  truth(resolved.packages.length >= 2, "resolver found packages");
  const flat = flattenResolved(resolved);
  equal(flat.get("is-array"), "1.0.1", "resolver selected latest is-array");
  equal(flat.get("left-pad"), "1.3.0", "resolver selected transitive left-pad");

  const preferred = new Map([["is-array", "1.0.0"], ["left-pad", "1.2.0"]]);
  const resolvedPref = await resolveDependencies(
    {
      name: "demo-app",
      version: "1.0.0",
      dependencies: { "is-array": "^1.0.0" }
    },
    { fetchPackument: fakeFetch, preferred }
  );
  const flatPref = flattenResolved(resolvedPref);
  equal(flatPref.get("is-array"), "1.0.0", "preferred version honored");
  equal(flatPref.get("left-pad"), "1.2.0", "preferred transitive version honored");

  // ========== lockfile ==========
  const lock = buildLockfile(
    { name: "demo-app", version: "1.0.0", dependencies: { "is-array": "^1.0.0" } },
    resolved
  );
  equal(lock.lockfileVersion, 3, "lockfile version 3");
  truth(lock.packages["node_modules/is-array"], "lockfile has is-array entry");
  equal(lock.packages["node_modules/is-array"].version, "1.0.1", "lockfile version matches");

  const parsed = parseLockfile(stringifyLockfile(lock));
  equal(parsed.name, "demo-app", "round-trip lockfile name");

  const prefs = preferredVersionsFromLockfile(lock);
  equal(prefs.get("is-array"), "1.0.1", "preferredVersionsFromLockfile");

  const v1 = {
    lockfileVersion: 1,
    dependencies: {
      "is-array": {
        version: "1.0.0",
        dependencies: {
          "left-pad": { version: "1.2.0" }
        }
      }
    }
  };
  const prefsV1 = preferredVersionsFromLockfile(v1);
  equal(prefsV1.get("is-array"), "1.0.0", "v1 lockfile is-array");
  equal(prefsV1.get("left-pad"), "1.2.0", "v1 lockfile left-pad");

  // ========== host interface (mock) ==========
  const mockHost = {
    async httpGet() { return { status: 200, url: "", headers: {}, body: "{}" }; },
    async readText() { return ""; },
    async writeText() {},
    async readBytes() { return new Uint8Array(); },
    async writeBytes() {},
    async mkdirp() {},
    async exists() { return false; },
    async removeTree() {},
    async rename() {},
    pathJoin(...p) { return p.join("/"); },
    cwd() { return "/tmp"; }
  };
  truth(assertHost(mockHost) === mockHost, "assertHost accepts complete host");
  let threw = false;
  try { assertHost({ httpGet() {} }); } catch { threw = true; }
  truth(threw, "assertHost rejects incomplete host");

  const calls = [];
  const recordingHost = {
    ...mockHost,
    async httpGet(url) {
      calls.push(url);
      return {
        status: 200,
        url,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(registry["left-pad"])
      };
    }
  };
  const fp = makeFetchPackument(recordingHost);
  const doc = await fp("left-pad");
  equal(doc.name, "left-pad", "makeFetchPackument returns packument");
  truth(calls[0].includes("registry.npmjs.org/left-pad"), "makeFetchPackument hits registry URL");

  // ========== integrity + path safety ==========
  const { parseIntegrity, toHex, fromHex, toBase64, fromBase64 } = await import("../src/integrity.js");
  const { safeTarPath } = await import("../src/tar.js");

  equal(toHex(fromHex("aabbccdd")), "aabbccdd", "hex roundtrip");
  equal(toHex(fromBase64(toBase64(new Uint8Array([0, 1, 2, 3])))), "00010203", "base64 roundtrip");

  const sri = parseIntegrity("sha512-abc+/DEF==");
  truth(sri && sri.algo === "sha512", "parse SRI algo");
  const legacy = parseIntegrity("0123456789abcdef0123456789abcdef01234567");
  truth(legacy && legacy.algo === "sha1" && legacy.digest.length === 20, "parse legacy shasum");
  truth(!parseIntegrity(""), "reject empty integrity");

  equal(safeTarPath("package/index.js"), "package/index.js", "safe tar path");
  equal(safeTarPath("../etc/passwd"), null, "reject tar traversal");
  equal(safeTarPath("/etc/passwd"), null, "reject absolute tar path");
  equal(safeTarPath("foo/../../etc"), null, "reject nested traversal");

} catch (error) {
  console.log("FAIL after " + assertions + " assertions");
  if (failures.length) {
    for (const f of failures) console.log("  - " + f);
  }
  throw error;
}

if (failures.length) {
  console.log("FAIL: " + failures.length + " of " + assertions + " assertions failed");
  for (const f of failures) console.log("  - " + f);
  throw new Error(failures.length + " assertion(s) failed");
}

console.log("All tests passed (" + assertions + " assertions).");
