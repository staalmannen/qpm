# qpm design

## 1. Purpose

qpm is a portable npm-compatible package manager designed to run on JavaScript
runtimes other than Node.js. Its first deployment target is QuickJS / QuickTS
on Plan 9, built against the Plan 9 APE (ANSI/POSIX Environment), but Plan 9
is the motivating example rather than the project's scope limit.

The central distinction is between the npm ecosystem and the runtime commonly
used to execute its tooling. qpm should consume npm registry metadata,
package archives, manifests, and lockfiles without requiring Node.js or V8.
Over time, qpm should also provide a substantial Node.js compatibility layer
so that a much larger portion of the npm package ecosystem can actually run
on alternative JavaScript engines.

APE is a useful first portability target because it provides a deliberately
small POSIX environment. A successful APE build is a strong portability
discipline, but other POSIX systems must still be tested.

## 2. Design principles

1. **Runtime-independent package-manager core.** Registry handling, manifests,
   semver, dependency resolution, lockfiles, and install planning should be
   ordinary ECMAScript without Node-specific APIs.
2. **Broad npm compatibility is the goal.** Aim for high compatibility with
   npm conventions and package metadata, rather than a permanently minimal
   registry downloader.
3. **Node compatibility is a long-term project component.** Keep Node API
   emulation separate from package-management logic, but treat it as an
   important path toward running existing npm packages on non-Node runtimes.
4. **Conservative POSIX native layer.** Native services are implemented in C
   against a small POSIX interface available through Plan 9 APE and ordinary
   POSIX systems.
5. **Dependencies behind interfaces.** HTTP, compression, archive handling,
   and cryptography are isolated behind C interfaces. libcurl, zlib, and a
   TLS/crypto library such as LibreSSL or OpenSSL may be used without leaking
   their APIs into the JavaScript core.
6. **npm-compatible defaults.** Use `node_modules` as the default installation
   layout and prioritize interoperability with `package-lock.json`.
7. **Install safely and deterministically.** Resolve first, record exact
   versions and integrity data, then install. Never execute package lifecycle
   scripts by default.

## 3. Architecture

```
                    qpm CLI / runtime entry point
                              |
                       command interface
                              |
              +---------------+----------------+
              |                                |
       Package-manager core              Runtime adapter
       - package.json                    - QuickJS bindings
       - semver                           - filesystem / HTTP
       - registry metadata                - native C services
       - dependency graph                 - module loading hooks
       - package-lock.json                       |
       - install planner                  Node compatibility layer
              |                           - node: modules
              |                           - Buffer / process
              |                           - streams / events
              |                           - other Node APIs
              |                                |
              +---------------+----------------+
                              |
                    Portable C support library
                    - HTTP / TLS
                    - filesystem helpers
                    - gzip / tar extraction
                    - integrity hashing
                              |
                         POSIX / APE
                              |
                   npm registry and package files
```

The package-manager core should be importable as ES modules and accept plain
objects and callbacks. It must not call POSIX or C APIs directly. Runtime
adapters expose a small, stable set of host operations. The C support library
itself should not depend on QuickJS, so it can be tested independently and
reused by another runtime or executable.

The Node compatibility layer is deliberately a separate subsystem. It may
use runtime hooks and native facilities where necessary, but should not make
the package manager itself depend on Node semantics.

### Core modules

- `semver.js`: parse versions, compare them, and evaluate npm semver ranges.
- `manifest.js`: validate and normalize package.json dependency sections and
  related metadata.
- `registry.js`: construct package metadata URLs and retrieve packuments.
- `resolver.js`: resolve dependency graphs, including multiple versions of
  the same package where ranges conflict.
- `lockfile.js`: read, write, and update npm `package-lock.json` from the
  beginning; support relevant lockfile versions and preserve compatible data.
- `installer.js`: download tarballs, verify integrity, extract, and create
  npm-compatible installation trees.
- `runtime-adapter.js`: connect the portable core to a particular JS engine
  and its native services.

### Native C layer

Suggested source layout:

```
src/
  js/
    semver.js
    manifest.js
    registry.js
    resolver.js
    lockfile.js
    installer.js
  c/
    include/
      qpm_platform.h
    common/
      http.c
      archive.c
      integrity.c
    posix/
      filesystem.c
      process.c
    quickjs/
      bindings.c
  compat/
    node/
      ...
```

The C library should expose qpm-oriented functions rather than exposing
libcurl, LibreSSL/OpenSSL, zlib, or platform-specific APIs to JavaScript. Keep
the interface small and use explicit byte buffers and lengths.

A preliminary interface could look like:

```c
/* qpm_platform.h */

typedef struct QpmHttpResponse QpmHttpResponse;

int qpm_http_get(const char *url,
                 const char * const *headers,
                 QpmHttpResponse *response);
void qpm_http_response_free(QpmHttpResponse *response);

int qpm_read_file(const char *path, void **data, size_t *length);
int qpm_write_file(const char *path, const void *data, size_t length);
int qpm_mkdirs(const char *path);
int qpm_rename(const char *from, const char *to);
int qpm_remove_tree(const char *path);

int qpm_extract_tar_gz(const void *data, size_t length,
                       const char *destination);
int qpm_sha512(const void *data, size_t length,
               unsigned char digest[64]);
```

This is an illustrative API, not yet a frozen ABI. Error reporting, ownership,
large-file handling, streaming downloads, and cancellation should be specified
before implementation. Package tarballs should ultimately be downloaded to
temporary files or streamed rather than necessarily held entirely in memory.

### POSIX portability baseline

Treat Plan 9 APE as the portability floor and prefer standard interfaces:
stdio / file descriptors, `open`, `read`, `write`, `close`, `stat`,
`mkdir`, `rename`, `unlink`, directory traversal, and ordinary process
interfaces only where needed.

Avoid making the common C implementation depend on:
- Linux-specific system calls or headers.
- GNU-only libc extensions.
- BSD-only interfaces.
- pthreads or asynchronous I/O unless a demonstrated requirement emerges.
- shell utilities for operations that can be implemented safely in-process.

Use compile-time feature checks for optional facilities. Keep platform-specific
code in small backend files rather than scattering `#ifdef` branches
throughout the implementation. POSIX path handling belongs in the native
filesystem adapter; JavaScript package logic should use abstract path
operations where practical.

APE's minimal environment is a useful portability discipline, but POSIX
systems differ in details and optional interfaces. Build and test on APE plus
at least one conventional POSIX system before describing a release as broadly
POSIX-portable.

## 4. Native dependencies

The initial Plan 9 APE environment already has the following libraries
available, so qpm can use them rather than designing around their absence.
Keep each behind the native C interface so other builds can substitute
equivalent implementations.

| Dependency | Role | Policy |
|---|---|---|
| libc / APE | Base C and POSIX services | Required for the initial native build |
| libcurl | HTTPS, redirects, headers, downloads | Use as the initial HTTP backend |
| zlib | gzip decompression | Use for npm tarballs |
| LibreSSL or OpenSSL | TLS and cryptographic digest facilities | Support either through a small crypto abstraction |
| tar handling | npm tarball extraction | Prefer a controlled in-process extractor or suitable portable library |

The TLS stack used by libcurl is a build-time configuration concern. Avoid
coupling qpm's code to LibreSSL-specific or OpenSSL-specific APIs. Likewise,
keep digest operations behind a qpm interface.

npm package integrity commonly uses SHA-512 in Subresource Integrity form;
older metadata may also contain SHA-1. The installer must support SHA-512 and
handle legacy integrity metadata deliberately. It must not silently accept a
package when a supplied integrity value fails verification.

## 5. Registry protocol

The public npm registry exposes package metadata at:

- Unscoped: `https://registry.npmjs.org/<encoded-package-name>`
- Scoped: `https://registry.npmjs.org/@scope%2fname`

A packument contains a `versions` object keyed by version and usually
`dist-tags`, including `latest`. Each version entry may include dependency
sections and `dist.tarball` / `dist.integrity`.

Use registry metadata formats and negotiation compatible with npm clients.
Start with full packuments if that is simplest, then add abbreviated metadata,
caching, ETags, and conditional requests without changing resolver semantics.

Treat registry metadata and package contents as untrusted input. Validate
package names, versions, URLs, archive paths, and integrity fields.

## 6. Resolution and lockfile semantics

Resolution is separate from installation:

1. Read the root package.json and existing `package-lock.json`, if present.
2. Collect dependencies according to the requested install mode.
3. Reuse locked resolutions when they remain valid and satisfy the manifest.
4. Fetch metadata for dependencies that need resolution.
5. Select versions using npm-compatible semver behavior.
6. Recursively resolve dependencies, including peer and optional dependency
   semantics as support is added.
7. Detect cycles and preserve each dependency edge's requested range.
8. Produce and validate the complete lock graph before changing the install tree.
9. Update `package-lock.json` deterministically.

**package-lock compatibility is a foundational requirement, not a later
migration feature.** The initial lockfile implementation should target the
current npm lockfile format in use by supported npm versions, while reading
older lockfile versions where practical. Preserve fields qpm does not yet
interpret when safely possible, rather than discarding information on rewrite.
Lockfile fixtures from real npm projects should be part of the test suite.

The current prototype's semver evaluator is deliberately scoped. It supports
common stable-version ranges, but is not yet fully npm-compatible. Expand it
against npm semver behavior and conformance fixtures before relying on it for
general dependency resolution.

Conflicting dependency ranges may require multiple installed copies. The
resolver must model a graph, not a flat map keyed only by package name, and
the installer should produce the npm-compatible placement strategy.

## 7. Installation layout

### Default: npm-compatible `node_modules`

Install packages into the conventional layout:

```
project/
  package.json
  package-lock.json
  node_modules/
    package-a/
    @scope/
      package-b/
```

This is the default on every platform, including Plan 9. qpm is intended to
serve projects and runtimes beyond Plan 9; the Plan 9 environment motivates
the need for an alternative package manager but should not dictate a
Plan-9-specific package layout.

Implement npm-compatible dependency placement, including nested dependencies,
scoped packages, package aliases, and links as support grows. Keep filesystem
operations abstract enough to accommodate differences between POSIX systems.

A qpm-native global cache or content-addressed store may be added as an
implementation detail, but it must not replace the default project-visible
`node_modules` structure or undermine npm interoperability.

## 8. Node.js compatibility layer

High npm package compatibility ultimately requires more than downloading and
placing packages. Many packages assume Node.js APIs and module-resolution
behavior. qpm's long-term scope therefore includes a Node.js compatibility
layer for alternative JavaScript engines, initially QuickJS / QuickTS.

This layer should be developed separately from the package manager and
incrementally, based on real package requirements. Likely areas include:

- CommonJS loading and interoperation with ES modules.
- Node-style package and module resolution, including `exports`,
  `imports`, and package entry points.
- `node:` built-in modules, prioritizing commonly used APIs.
- `process`, `Buffer`, events, streams, and timers.
- Filesystem, path, URL, OS, crypto, and networking APIs.
- Child processes, worker threads, and native addons only where feasible.
- Runtime behavior and edge cases expected by popular npm packages.

Do not imply that a compatibility layer makes every Node package portable.
Native addons, V8-specific extensions, unsupported language features, and
deep assumptions about Node internals may remain incompatible. Track
compatibility empirically with a test corpus of real packages.

## 9. Security and reproducibility

- Do not run `preinstall`, `install`, `postinstall`, or other lifecycle
  scripts by default.
- Verify `dist.integrity` before extraction.
- Reject archive entries that escape the installation root, including
  traversal through symbolic links or hard links.
- Use HTTPS and validate redirects and final download URLs.
- Write to a temporary directory, then rename into place.
- Record exact versions, resolved tarball URLs, and integrity values in
  `package-lock.json`.
- Never treat package metadata as trusted executable configuration.
- Consider package provenance/signatures as a later enhancement.

## 10. Roadmap

### Phase 0 — portable core (started)

- [x] Runtime-independent semver subset
- [x] package.json dependency normalization
- [x] Registry package-name URL encoding
- [x] Packument version selection
- [ ] Expand semver behavior and conformance tests

### Phase 1 — native foundation and registry client

- [ ] Define and implement the small C platform interface
- [ ] Build the C support library against Plan 9 APE
- [ ] Add QuickJS bindings for the native interface
- [ ] Implement libcurl HTTP backend with zlib and LibreSSL/OpenSSL support
- [ ] Fetch packuments and cache metadata
- [ ] Human-readable `qpm info` / `qpm view`
- [ ] Build/test on a second POSIX system

### Phase 2 — npm-compatible installation foundation

- [ ] Implement npm-compatible `package-lock.json` reading/writing
- [ ] Add lockfile fixtures from multiple npm lockfile versions
- [ ] Implement npm-compatible semver behavior
- [ ] Dependency graph resolver and peer dependency handling
- [ ] Tarball download and integrity verification
- [ ] Safe tar/gzip extraction
- [ ] npm-compatible `node_modules` placement
- [ ] Atomic installation and lockfile updates

### Phase 3 — package-manager workflows

- [ ] `qpm install`, `qpm add`, `qpm remove`
- [ ] Scoped packages, aliases, optional/dev/peer dependencies
- [ ] npm-compatible configuration and common CLI behavior
- [ ] Offline cache
- [ ] Workspaces (as compatibility needs dictate)

### Phase 4 — Node.js compatibility

- [ ] CommonJS and Node-style module resolution
- [ ] Core `node:` modules and common globals
- [ ] `process`, `Buffer`, events, streams, timers
- [ ] Filesystem, path, URL, OS, crypto, and networking APIs
- [ ] Expand compatibility based on real-world package test results
- [ ] Evaluate child processes, workers, and native-addon support

## 11. Non-goals and constraints

- Requiring Node.js or V8 to run qpm.
- Guaranteeing every npm package works on QuickJS or every supported runtime.
- Automatically executing package lifecycle scripts without an explicit,
  secure policy.
- Implementing every Node API before testing which APIs packages actually use.

## 12. Open design questions

1. Which exact npm lockfile versions and npm client behaviors should be the
   initial compatibility target?
2. What HTTP and byte-array APIs does the QuickJS Plan 9 port expose, and
   should downloads be streamed directly to temporary files?
3. Which QuickJS module-loading hooks are available for implementing
   CommonJS and Node-style resolution?
4. How should qpm configuration and global cache locations map across Plan 9
   and conventional POSIX systems?
5. Which real-world npm packages should form the initial compatibility test
   corpus?

The default installation layout is `node_modules`, and
`package-lock.json` compatibility starts with the initial installer design.
The recommended sequence is to establish the POSIX C interface and registry
client, then build lockfile-compatible resolution and installation, while
developing the Node compatibility layer as a distinct, steadily expanding
workstream.
