# qpm design

## 1. Purpose

qpm is an npm-registry client and package installer for small JavaScript
runtimes. Its first deployment target is QuickJS / QuickTS on Plan 9.

The key design decision is to separate **package-management semantics** from
**host capabilities**. npm is a registry ecosystem and package metadata format;
Node.js is one runtime commonly used to execute package-manager tooling. qpm
should speak the former without depending on the latter.

## 2. Design principles

1. **No Node dependency in the core.** No `node:` imports, `process`,
   `Buffer`, `require`, or assumptions about POSIX paths.
2. **Small portable core.** Manifest handling, semver, registry metadata
   selection, dependency graph logic, and lockfile data are ordinary
   ECMAScript.
3. **Host services are injected.** HTTP, filesystem, archive extraction,
   hashing, and optional lifecycle execution are provided by a platform
   adapter.
4. **Install safely and deterministically.** Resolve first, record exact
   versions and integrity data, then install. Never execute package lifecycle
   scripts by default.
5. **npm compatibility is incremental.** Support common package.json patterns
   first; do not promise full npm CLI compatibility.

## 3. Architecture

```
                  qpm CLI / QuickJS shell
                            |
                    command interface
                            |
             +--------------+--------------+
             |                             |
       Package core                  Host adapter
       - package.json                - HTTP(S)
       - semver                      - filesystem
       - registry metadata           - mkdir / rename
       - dependency graph            - tar/gzip extraction
       - lockfile model              - SHA- integrity
             |                             |
             +-------------+---------------+
                           |
                     npm registry
              registry.npmjs.org
```

The core should be importable as ES modules and accept plain objects and
callbacks. The adapter translates platform-specific errors into a small
common error shape.

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

### Host adapter contract (proposed)

The core should not import these functions directly. The CLI creates an
adapter object and passes it to the installer.

- `http.get(url, headers?) -> { status, headers, body }`
- `fs.readText(path) -> string`
- `fs.writeText(path, text)`
- `fs.mkdir(path, recursive?)`
- `fs.exists(path) -> boolean`
- `fs.rename(from, to)`
- `fs.remove(path, recursive?)`
- `archive.extractTarGzip(bytes, destination, options)`
- `crypto.verifyIntegrity(bytes, integrity)`

The body/byte representation must be agreed with each host adapter. A future
C helper may provide HTTP, gzip/tar, and hashing on Plan 9, while keeping
policy and resolution in JavaScript.

## 4. Registry protocol

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

## 5. Resolution semantics

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

## 6. Installation layout

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

## 7. Security and reproducibility

- Do not run `preinstall`, `install`, `postinstall`, or other lifecycle
  scripts by default.
- Verify `dist.integrity` (normally Subresource Integrity syntax) before
  extraction.
- Reject archive entries that escape the installation root.
- Use HTTPS and validate redirects.
- Write to a temporary directory, then rename into place.
- Record exact versions, resolved tarball URLs, and integrity values in the
  lockfile.
- Never treat package metadata as trusted executable configuration.
- Consider package provenance/signatures as a later enhancement.

## 8. Roadmap

### Phase 0 — portable core (started)

- [x] Runtime-independent semver subset
- [x] package.json dependency normalization
- [x] Registry package-name URL encoding
- [x] Packument version selection
- [ ] Expand semver conformance tests

### Phase 1 — read-only registry client

- [ ] HTTP adapter for QuickJS/Plan 9
- [ ] Fetch packuments and cache metadata
- [ ] Human-readable `qpm info` / `qpm view`

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

## 9. Non-goals for the first release

- Reimplementing npm's entire CLI.
- Running arbitrary Node.js programs.
- Providing a complete Node.js API compatibility layer.
- Guaranteeing every npm package works on QuickJS. Packages may depend on
  Node APIs, native addons, browser APIs, or unsupported syntax.
- Running install scripts automatically.

## 10. Open design questions

1. Should qpm default to `node_modules`, or to a Plan 9-native package store?
2. What HTTP and byte-array APIs does the QuickJS Plan 9 port expose?
3. Is a small C archive/hash helper acceptable, with the package policy kept
   in JavaScript?
4. Which QuickJS module-resolution behavior should qpm target?
5. Should qpm use its own lockfile initially, or prioritize package-lock.json
   compatibility from the start?

The recommended order is to finish the portable core and host adapter
contracts before choosing a final installation layout.
