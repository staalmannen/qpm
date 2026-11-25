#!/usr/bin/env node
// Executable entry: node bin/qpm.mjs <command> ...
import { runCli } from "../src/cli.js";

const code = await runCli({ argv: process.argv.slice(2) });
process.exit(code);
