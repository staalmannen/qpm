#!/usr/bin/env node
// Development helper: qpm-like "info" using the Node host adapter.
// Usage: node scripts/info.mjs <package> [range]
// Example: node scripts/info.mjs left-pad ^1.2.0

import { createNodeHost } from "../src/host-node.js";
import { createRegistryClient } from "../src/registry-client.js";

const name = process.argv[2];
const range = process.argv[3] || "latest";
if (!name) {
  console.error("usage: node scripts/info.mjs <package> [range]");
  process.exit(2);
}

const host = createNodeHost();
const client = createRegistryClient(host);

const { version, metadata } = await client.getVersion(name, range);
const dist = metadata.dist || {};
console.log(name + "@" + version);
if (metadata.description) console.log(metadata.description);
console.log("tarball:   " + (dist.tarball || "(none)"));
console.log("integrity: " + (dist.integrity || dist.shasum || "(none)"));
const deps = metadata.dependencies;
if (deps && Object.keys(deps).length) {
  console.log("dependencies:");
  for (const k of Object.keys(deps).sort()) {
    console.log("  " + k + ": " + deps[k]);
  }
}
