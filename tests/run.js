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
  const { safeTarPath, parseTar } = await import("../src/tar-core.js");

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

  // ========== UTF-8 (QuickJS has no TextEncoder/TextDecoder) ==========
  const { encodeUtf8Pure, decodeUtf8Pure, encodeUtf8, decodeUtf8 } = await import("../src/utf8.js");
  const sample = "a\u00e9\u20ac\ud83d\ude00z"; // 1, 2, 3 and 4 byte forms
  equal(toHex(encodeUtf8Pure(sample)), "61c3a9e282acf09f9880" + "7a", "utf8 encode all widths");
  equal(decodeUtf8Pure(encodeUtf8Pure(sample)), sample, "utf8 roundtrip");
  equal(decodeUtf8(encodeUtf8(sample)), sample, "utf8 roundtrip (engine default)");
  equal(decodeUtf8Pure(new Uint8Array([0x61, 0xc3])), "a\ufffd", "utf8 truncated sequence -> U+FFFD");
  equal(decodeUtf8Pure(new Uint8Array([0xc0, 0x80])), "\ufffd\ufffd", "utf8 overlong rejected");
  equal(decodeUtf8Pure(new Uint8Array([0xed, 0xa0, 0x80])), "\ufffd\ufffd\ufffd", "utf8 encoded surrogate rejected");

  // ========== tar parsing (pure; gunzip is the host's job) ==========
  function tarHeader(name, size, type, prefix) {
    const h = new Uint8Array(512);
    const put = (str, at) => { const b = encodeUtf8Pure(str); h.set(b, at); };
    put(name, 0);
    put("0000644", 100);
    put(size.toString(8).padStart(11, "0"), 124);
    h[156] = type.charCodeAt(0);
    put("ustar", 257);
    h[263] = 0x30; h[264] = 0x30; // version "00"
    if (prefix) put(prefix, 345);
    for (let i = 148; i < 156; i++) h[i] = 0x20;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += h[i];
    put(sum.toString(8).padStart(6, "0"), 148);
    h[154] = 0;
    return h;
  }
  function tarArchive(members) {
    const blocks = [];
    for (const m of members) {
      const data = m.data ? encodeUtf8Pure(m.data) : new Uint8Array(0);
      blocks.push(tarHeader(m.name, data.length, m.type || "0", m.prefix));
      const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
      padded.set(data);
      blocks.push(padded);
    }
    blocks.push(new Uint8Array(1024));
    let n = 0;
    for (const b of blocks) n += b.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const b of blocks) { out.set(b, at); at += b.length; }
    return out;
  }
  const bigText = "x".repeat(600); // crosses a 512-byte block boundary
  const archive = tarArchive([
    { name: "package/", type: "5" },
    { name: "package/package.json", data: "{\"name\":\"t\"}" },
    { name: "package/lib/big.txt", data: bigText },
    { name: "package/../evil.js", data: "nope" },
    { name: "package/link", type: "2" },
    { name: "deep.js", prefix: "package/a/b", data: "deep" },
    { name: "package/caf\u00e9.txt", data: "\u20ac" }
  ]);
  const ents = parseTar(archive);
  const byPath = new Map(ents.map((e) => [e.path, e]));
  equal(ents.length, 4, "tar: unsafe, symlink and package/ dir dropped");
  equal(decodeUtf8Pure(byPath.get("package.json").data), "{\"name\":\"t\"}", "tar: file content");
  equal(byPath.get("lib/big.txt").data.length, 600, "tar: multi-block file length");
  equal(decodeUtf8Pure(byPath.get("a/b/deep.js").data), "deep", "tar: ustar prefix joined and stripped");
  truth(byPath.has("caf\u00e9.txt"), "tar: UTF-8 file name");
  falsy(byPath.has("evil.js") || byPath.has("../evil.js"), "tar: traversal entry dropped");
  const unstripped = parseTar(archive, { stripPackagePrefix: false });
  truth(unstripped.some((e) => e.path === "package/package.json"), "tar: prefix kept when asked");
  let truncated = false;
  // blocks: dir hdr 0, package.json hdr 512 + data 1024, big.txt hdr 1536,
  // big.txt data from 2048 -- cut inside that data
  try { parseTar(archive.subarray(0, 2048 + 100)); } catch (_) { truncated = true; }
  truth(truncated, "tar: truncated entry throws");

  // ========== placement (nested on version conflict) ==========
  const { planPlacement, nameToSegments, joinRel } = await import("../src/placement.js");
  equal(joinRel(...nameToSegments("left-pad")), "node_modules/left-pad", "nameToSegments unscoped");
  equal(joinRel(...nameToSegments("@scope/pkg")), "node_modules/@scope/pkg", "nameToSegments scoped");

  // Synthetic resolve result: root -> A@1, B@1; A needs shared@1; B needs shared@2
  const placementResult = {
    rootId: "app@1.0.0",
    packages: [
      { id: "parent-a@1.0.0", name: "parent-a", version: "1.0.0", range: "1.0.0", section: "dependencies", tarball: null, integrity: null, shasum: null, dependencies: { shared: "1.0.0" } },
      { id: "parent-b@1.0.0", name: "parent-b", version: "1.0.0", range: "1.0.0", section: "dependencies", tarball: null, integrity: null, shasum: null, dependencies: { shared: "2.0.0" } },
      { id: "shared@1.0.0", name: "shared", version: "1.0.0", range: "1.0.0", section: "dependencies", tarball: null, integrity: null, shasum: null, dependencies: {} },
      { id: "shared@2.0.0", name: "shared", version: "2.0.0", range: "2.0.0", section: "dependencies", tarball: null, integrity: null, shasum: null, dependencies: {} }
    ],
    byId: new Map(),
    edges: new Map([
      ["app@1.0.0", ["parent-a@1.0.0", "parent-b@1.0.0"]],
      ["parent-a@1.0.0", ["shared@1.0.0"]],
      ["parent-b@1.0.0", ["shared@2.0.0"]]
    ])
  };
  const places = planPlacement(placementResult);
  const paths = places.map((p) => p.relPath).sort();
  truth(paths.includes("node_modules/parent-a"), "place parent-a at root");
  truth(paths.includes("node_modules/parent-b"), "place parent-b at root");
  truth(paths.includes("node_modules/shared"), "hoist one shared version");
  const nestedShared = places.filter((p) => p.name === "shared" && p.nested);
  truth(nestedShared.length >= 1, "nest conflicting shared version");
  truth(nestedShared.some((p) => p.relPath.includes("node_modules/shared")), "nested path contains node_modules/shared");

  // ========== lockfile fixtures ==========
  // Read through whichever file API the engine has: QuickJS's "std"
  // module, else Node's fs. No URL class on QuickJS, so the fixture
  // directory is worked out from import.meta.url by string handling.
  async function readTextFile(file) {
    try {
      const std = await import("std");
      const text = std.loadFile(file);
      if (typeof text === "string") return text;
    } catch (_) {}
    try {
      const fs = await import("node:fs");
      return fs.readFileSync(file, "utf8");
    } catch (_) {}
    return null;
  }
  function fixtureDir() {
    let u = String(import.meta.url || "");
    if (u.startsWith("file://")) u = decodeURIComponent(u.slice(7));
    const slash = u.lastIndexOf("/");
    return (slash >= 0 ? u.slice(0, slash + 1) : "") + "fixtures/";
  }
  async function loadFixture(name) {
    for (const c of ["tests/fixtures/" + name, fixtureDir() + name]) {
      const text = await readTextFile(c);
      if (text !== null) return parseLockfile(text);
    }
    throw new Error("fixture not found: " + name);
  }

  const fixV1 = await loadFixture("lockfile-v1.json");
  equal(fixV1.lockfileVersion, 1, "fixture v1 version");
  const prefV1 = preferredVersionsFromLockfile(fixV1);
  equal(prefV1.get("is-array"), "1.0.1", "fixture v1 is-array");
  equal(prefV1.get("left-pad"), "1.2.0", "fixture v1 nested left-pad");
  equal(prefV1.get("ms"), "2.1.3", "fixture v1 ms");

  const fixV2 = await loadFixture("lockfile-v2.json");
  equal(fixV2.lockfileVersion, 2, "fixture v2 version");
  const prefV2 = preferredVersionsFromLockfile(fixV2);
  equal(prefV2.get("left-pad"), "1.3.0", "fixture v2 left-pad from packages");
  equal(prefV2.get("ms"), "2.1.3", "fixture v2 ms");

  const fixV3 = await loadFixture("lockfile-v3-nested.json");
  equal(fixV3.lockfileVersion, 3, "fixture v3 version");
  const prefV3 = preferredVersionsFromLockfile(fixV3);
  truth(prefV3.has("shared"), "fixture v3 has shared");
  truth(prefV3.has("parent-a"), "fixture v3 has parent-a");
  truth(fixV3.packages["node_modules/parent-b/node_modules/shared"].version === "2.0.0", "fixture v3 nested shared@2");

  // ========== CLI arg parsing ==========
  const { parseArgs } = await import("../src/args.js");
  const cliInstall = parseArgs(["install", "--dev", "--dir", "/tmp/proj"]);
  equal(cliInstall.command, "install", "cli command");
  truth(cliInstall.flags.dev, "cli --dev");
  equal(cliInstall.flags.dir, "/tmp/proj", "cli --dir");
  const cliInfo = parseArgs(["info", "left-pad", "^1.2.0"]);
  equal(cliInfo.command, "info", "cli info");
  equal(cliInfo.args[0], "left-pad", "cli info pkg");
  equal(cliInfo.args[1], "^1.2.0", "cli info range");

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
