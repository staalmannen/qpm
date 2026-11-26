#!/usr/bin/env node
// Executable entry: node bin/qpm.mjs <command> ...
import { runCli } from "../src/cli.js";
import { createNodeHost } from "../src/host-node.js";

const code = await runCli({ argv: process.argv.slice(2), host: createNodeHost() });
process.exit(code);
