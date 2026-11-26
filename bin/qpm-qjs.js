// Executable entry for QuickJS:
//
//   qjs --std -m bin/qpm-qjs.js <command> ...
//
// The QuickJS twin of bin/qpm.mjs: same commands, with the host adapter
// built on QuickJS's std/os modules instead of Node's.
import * as std from "std";
import { runCli } from "../src/cli.js";
import { createQjsHost } from "../src/host-qjs.js";

// scriptArgs[0] is this script's own path.
// QuickJS's console has only log, so stdout and stderr are written
// directly; errors must not land on stdout where `--json` output goes.
const code = await runCli({
  argv: scriptArgs.slice(1),
  host: createQjsHost(),
  log: (m) => { std.out.puts(m + "\n"); std.out.flush(); },
  err: (m) => { std.err.puts(m + "\n"); std.err.flush(); }
});
std.exit(code);
