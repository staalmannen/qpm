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

Early prototype / design stage. The repository currently contains the
runtime-independent core only. It can parse common npm semver ranges and select
matching versions from registry metadata. It does not yet download or install
packages.

See [DESIGN.md](DESIGN.md) for architecture and roadmap.

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

The exact invocation may vary with how QuickJS is built and how module loading
is configured.
