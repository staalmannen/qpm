# qpm design

## 1. Purpose

qpm is an npm-registry client and package installer for small JavaScript
runtimes. Its first deployment target is QuickJS / QuickTS on Plan 9, built
against the Plan 9 APE (ANSI/POSIX Environment).

The key design decision is to separate **package-management semantics** from
**host capabilities**. npm is a registry ecosystem and package metadata format;
Node.js is one runtime commonly used to execute package-manager tooling. qpm
should speak the former without depending on the latter.

APE is an especially useful first portability target: it provides a deliberately
small POSIX environment. qpm should rely on a conservative POSIX baseline and
avoid conveniences that exist only on particular Unix-like systems. The goal
is for a successful APE build to be a strong portability check for other POSIX
systems, while still testing those systems rather than assuming perfect
compatibility.

## 2. Design principles

1. **No Node dependency in the core.** No `node:` imports, `process`,
   `Buffer`, `require`, or Node-specific runtime assumptions.
2. **Portable JavaScript core.** Manifest handling, semver, registry metadata
   selection, dependency graph logic, and lockfile data are ordinary
   ECMAScript.
3. **Conservative POSIX native layer.** Native services are implemented in C
   against a small POSIX interface available through Plan 9 APE and ordinary
   POSIX systems.
4. **Dependencies behind interfaces.** HTTP, compression, archive handling,
   and cryptography are isolated behind C interfaces. Available libraries
   such as libcurl and LibreSSL may be used without leaking their APIs into
   the package-management core.
5. **Install safely and deterministically.** Resolve first, record exact
   versions and integrity data, then install. Never execute package lifecycle
   scripts by default.
6. **npm compatibility is incremental.** Support common package.json patterns
   first; do not promise full npm CLI compatibility.

## 3. Architecture

```
                  qpm CLI / QuickJS shell
                            |
                    command interface
                            |
             +--------------+--------------+
             |                             |
       Package core                  QuickJS bindings
       - package.json                - native function bridge
       - semver                             |
       - registry metadata           Portable C support library
       - dependency graph            - HTTP client interface
       - lockfile model              - filesystem operations
             |                       - gzip / tar extraction
             |                       - integrity hashing
             |                             |
             +-------------+---------------+
                           |
                 POSIX / Plan 9 APE
                           |
              npm registry and package files
```

The JavaScript core should be importable as ES modules and accept plain
objects and callbacks. It must not call POSIX or C APIs directly. The QuickJS
binding layer exposes a small, stable set of native operations to JavaScript.
The C support library itself should not depend on QuickJS, so it can be tested
independently and reused by another runtime or executable.

### Core modules

- `semver.js`: parse versions, compare them, and evaluate common npm ranges.
- `manifest.js`: validate and normalize package.json dependency sections.
- `registry.js`: construct package metadata URLs and select a matching
  published version from a packument.
- `resolver.js` (next): resolve dependency graphs, including multiple
  versions of the same package where ranges conflict.
- `lockfile.js` (next): read/write a deterministic qpm lockfile; later support
  npm package-lock interoperability.
- `installer.js` (next): download tarballs, verify integrity, extract, and
  write installation records.

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
```

The C library should expose qpm-oriented functions rather than exposing
libcurl, LibreSSL, zlib, or platform-specific APIs to JavaScript. Keep the
interface small and use explicit byte buffers and lengths.

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
before implementation. In particular, package tarballs should eventually be
downloaded to a file or streamed rather than necessarily held entirely in
memory.

### POSIX portability baseline

Treat Plan 9 APE as the portability floor and prefer standard interfaces:
stdio / file descriptors, `open`, `read`, `write`, `close`, `stat`,
`mkdir`, `rename`, `unlink`, directory traversal, and ordinary process
interfaces only where needed.

Avoid making the core C implementation depend on:
- Linux-specific system calls or headers.
- GNU-only libc extensions.
- BSD-only interfaces.
- pthreads or asynchronous I/O unless a demonstrated requirement emerges.
- shell utilities for operations that can be implemented safely in-process.

Use compile-time feature checks for optional facilities. Keep platform-specific
code in small backend files rather than scattering `#ifdef` branches
throughout the implementation. POSIX path handling belongs in the native
filesystem adapter; the JavaScript package logic should not assume that every
host uses the same path conventions.

APE's minimal environment is a useful portability discipline, but POSIX
systems differ in details and optional interfaces. The project should have
build and test coverage on APE plus at least one conventional POSIX system
before describing a release as broadly POSIX-portable.

## 4. Native dependencies

Use external libraries when they materially reduce implementation and
maintenance risk, but keep them replaceable behind the C interface.

| Dependency | Role | Policy |
|---|---|---|
| libc / APE | Base C and POSIX services | Required for the initial native build |
| libcurl | HTTPS, redirects, headers, downloads | Preferred HTTP backend where available |
| zlib | gzip decompression | Preferred compression dependency |
| LibreSSL | Cryptographic digest support if needed | Optional backend; do not expose its API above C |
| tar handling | npm tarball extraction | Small internal extractor or a suitable portable library |

The exact dependency set should be confirmed against the libraries available
in the target APE environment. Avoid depending on libcurl or LibreSSL merely
because they are available: use the smallest reliable set that provides the
required behavior. Conversely, there is no need to reject them on portability
grounds when they are already ported and provide a robust implementation.

npm package integrity commonly uses SHA-512 in Subresource Integrity form;
older metadata may also contain SHA-1. The installer must support SHA-512 and
should handle legacy integrity metadata deliberately. It must not silently
accept a package when a supplied integrity value fails verification.

## 5. Registry protocol

The public npm registry exposes package metadata at:

- Unscoped: `https://registry.npmjs.org/<encoded-package-name>`
- Scoped: `https://registry.npmjs.org/@scope%2fname`

A packument contains a `versions` object keyed by version and usually
`dist-tags`, including `latest`. Each version entry may include dependency
sections and `dist.tarball` / `dist.integrity`.

For an initial implementation qpm may fetch the full packument. Later it
should request abbreviated metadata where supported, cache responses, and
support ETags / conditional requests.

Treat registry metadata and package contents as untrusted input. Validate
package names, versions, URLs, archive paths, and integrity fields.

## 6. Resolution semantics

Resolution is separate from installation:

1. Read the root package.json.
2. Collect dependencies (and optionally devDependencies).
3. Fetch package metadata.
4. Select the highest stable version satisfying each range.
5. Recursively resolve that version's dependencies.
6. Detect cycles and preserve each dependency edge's requested range.
7. Produce a complete lock graph before writing files.

The first prototype's semver evaluator is deliberately scoped. It supports
common stable-version ranges: exact versions, `*` / `x`, comparator sets,
caret, tilde, wildcard components, hyphen ranges, and `||`. npm's complete
semver behavior includes nuanced prerelease, build-metadata, and partial-range
rules; these require dedicated compatibility tests before claiming full npm
semver compliance.

Conflicting dependency ranges may require multiple installed copies. The
resolver should model a graph, not a flat map keyed only by package name.
Installation layout can then use nested `node_modules`-style directories or
an internal content-addressed store with links/stubs where supported.

## 7. Installation layout

Two layouts are worth supporting:

### npm-compatible layout

`project/node_modules/<package>`

Advantages: familiar to existing tooling and package contents. Disadvantages:
requires Node-style package resolution conventions and potentially many files.

### qpm-native store

For example:

`/lib/js/packages/<name>/<version>/`

A project-local lockfile maps import names to exact package versions and
locations. This can be more natural on Plan 9, but requires a module resolver
or generated import map.

Do not commit to the native layout until QuickJS module resolution and Plan 9
filesystem conventions are settled. The initial core is layout-neutral.

## 8. Security and reproducibility

- Do not run `preinstall`, `install`, `postinstall`, or other lifecycle
  scripts by default.
- Verify `dist.integrity` (normally Subresource Integrity syntax) before
  extraction.
- Reject archive entries that escape the installation root, including
  traversal through symbolic links or hard links.
- Use HTTPS and validate redirects and final download URLs.
- Write to a temporary directory, then rename into place.
- Record exact versions, resolved tarball URLs, and integrity values in the
  lockfile.
- Never treat package metadata as trusted executable configuration.
- Consider package provenance/signatures as a later enhancement.

## 9. Roadmap

### Phase 0 — portable core (started)

- [x] Runtime-independent semver subset
- [x] package.json dependency normalization
- [x] Registry package-name URL encoding
- [x] Packument version selection
- [ ] Expand semver conformance tests

### Phase 1 — native foundation and read-only registry client

- [ ] Define and implement the small C platform interface
- [ ] Build the C support library against Plan 9 APE
- [ ] Add QuickJS bindings for the native interface
- [ ] Implement libcurl HTTP backend (or the smallest suitable APE backend)
- [ ] Fetch packuments and cache metadata
- [ ] Human-readable `qpm info` / `qpm view`
- [ ] Build/test on a second POSIX system to catch APE-specific assumptions

### Phase 2 — deterministic installation

- [ ] Dependency graph resolver
- [ ] Lockfile format and stable serialization
- [ ] Tarball download and integrity verification
- [ ] Safe tar/gzip extraction
- [ ] Atomic install into a selected layout

### Phase 3 — usability

- [ ] `qpm install`, `qpm add`, `qpm remove`
- [ ] Scoped packages and aliases
- [ ] Optional/dev/peer dependencies
- [ ] Workspaces (only if needed)
- [ ] Offline cache

### Phase 4 — compatibility

- [ ] npm package-lock import/export
- [ ] Node built-in compatibility is explicitly outside qpm's package-manager
  core; it belongs to the JavaScript runtime / host layer.
- [ ] Optional lifecycle scripts, sandboxed and disabled by default

## 10. Non-goals for the first release

- Reimplementing npm's entire CLI.
- Running arbitrary Node.js programs.
- Providing a complete Node.js API compatibility layer.
- Guaranteeing every npm package works on QuickJS. Packages may depend on
  Node APIs, native addons, browser APIs, or unsupported syntax.
- Running install scripts automatically.

## 11. Open design questions

1. Should qpm default to `node_modules`, or to a Plan 9-native package store?
2. What HTTP and byte-array APIs does the QuickJS Plan 9 port expose?
3. Which C dependencies are actually present in the target APE environment,
   and which should remain optional?
4. Should downloads be streamed directly to temporary files through the C
   interface, rather than buffered in JavaScript?
5. Which QuickJS module-resolution behavior should qpm target?
6. Should qpm use its own lockfile initially, or prioritize
   package-lock.json compatibility from the start?

The recommended order is to establish the conservative POSIX C interface,
implement and test it on Plan 9 APE, and finish the portable JavaScript core
before choosing a final installation layout.
