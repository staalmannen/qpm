#!/usr/bin/env node
// End-to-end install smoke test using the Node host.
// Creates a temp project, installs is-array (tiny, depends on left-pad historically
// — or use a package with few deps), writes lockfile.

import { createNodeHost } from "../src/host-node.js";
import { installProject } from "../src/installer.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const host = createNodeHost();
const root = await fs.mkdtemp(path.join(os.tmpdir(), "qpm-demo-"));

await host.writeText(path.join(root, "package.json"), JSON.stringify({
  name: "qpm-demo",
  version: "1.0.0",
  dependencies: {
    "is-array": "^1.0.1"
  }
}, null, 2) + "\n");

console.log("project:", root);

const result = await installProject(host, {
  rootDir: root,
  log: (m) => console.log("  " + m)
});

console.log("installed:", result.installed.join(", "));
const pkgJson = path.join(root, "node_modules", "is-array", "package.json");
const text = await host.readText(pkgJson);
const meta = JSON.parse(text);
console.log("on disk: is-array@" + meta.version);
console.log("ok");
