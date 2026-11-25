# qpm

A small, portable package manager for the npm registry, designed to run on
JavaScript engines other than Node.js.

The initial target is QuickJS (including QuickTS builds) on Plan 9. qpm is
**not** intended to require Node.js, V8, C++, or a Unix-like operating system.

## Goals

- Consume packages published to the existing npm registry.
- Keep package resolution and metadata handling independent of the JavaScript
  engine and operating system.
- Make host-specific operations explicit adapters: HTTP, files, directories,
  archive extraction, and command execution.
- Prefer a small, auditable implementation over reproducing the entire npm CLI.
- Eventually support both a conventional `node_modules` layout and a native
  module-cache layout.

## Status

Early prototype. The runtime-independent core now includes:

- npm-compatible semver subset with a growing conformance fixture suite (`semver.js`)
- `package.json` normalization and dependency collection (`manifest.js`)
- registry URL construction and packument version selection (`registry.js`)
- dependency graph resolver that accepts a host-provided `fetchPackument` callback (`resolver.js`)
- `package-lock.json` (v1/v2/v3) read helpers and v3 lockfile generation (`lockfile.js`)
- host capability interface (`host.js`) and a Node.js development adapter (`host-node.js`)
- registry client built on the host interface (`registry-client.js`)

Download, integrity verification, and flat `node_modules` installation work
through the host adapter (`installer.js`). There is still no full CLI surface
and no nested dependency placement / workspaces.

I/O stays behind the host adapter so the same core can run on Node (dev) or on
QuickJS with a small POSIX/C layer (libcurl, zlib, etc.). See [DESIGN.md](DESIGN.md).

### Development smoke tests (Node)

```bash
node --input-type=module -e 'import("./tests/run.js")'
node scripts/info.mjs left-pad '^1.2.0'
node scripts/install-demo.mjs
```

## Quick start

The core is written as ECMAScript modules and has no Node.js imports:

```js
import { selectVersion } from "./src/registry.js";

const packument = {
  versions: {
    "1.2.0": {},
    "1.3.0": {},
    "2.0.0": {}
  },
  "dist-tags": { latest: "2.0.0" }
};

const version = selectVersion(packument, "^1.2.0");
console.log(version); // "1.3.0"
```

The core accepts metadata as ordinary JavaScript objects. A future host adapter
will retrieve that metadata from `https://registry.npmjs.org/`.

## Runtime requirements

The core uses standard ECMAScript features (ES modules, `const`/`let`,
`Map`, and JSON). It deliberately avoids:

- `require()` and Node.js built-in modules
- `process`, `Buffer`, and Node-specific globals
- shell commands and POSIX assumptions
- a dependency on a particular HTTP or filesystem API

A host integration supplies those capabilities. This makes the core suitable
for QuickJS and other compact JavaScript engines, subject to their ES module
support.

## Development

Run the test file with a compatible JavaScript shell that supports ES modules.
The test suite is intentionally dependency-free:

```sh
qjs --std -m tests/run.js
```

A successful run prints a summary similar to:

```text
qpm core tests
---------------
All tests passed (18 assertions).
```

If an assertion fails, the runner prints a failure count and re-throws the
error so the JavaScript shell reports the failure (and exits unsuccessfully).

The exact invocation may vary with how QuickJS is built and how module loading
is configured.
