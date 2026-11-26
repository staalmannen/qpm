// Host capability interface for qpm.
//
// The package-manager core never touches the network or filesystem directly.
// A host adapter supplies these operations. Implementations may be:
//   - Node.js (development / CI)
//   - QuickJS + native C bindings (curl, POSIX file ops)
//   - any other engine with equivalent primitives
//
// Design constraint: prefer portable, standard facilities (POSIX file I/O,
// libcurl or another ordinary HTTP client). Plan 9 APE is a portability
// benchmark, not a reason to introduce platform-specific APIs in the core
// or in the adapter contract.

import { decodeUtf8, encodeUtf8 } from "./utf8.js";

/**
 * @typedef {object} HttpResponse
 * @property {number} status
 * @property {string} url          final URL after redirects
 * @property {Record<string, string>} headers
 * @property {string|Uint8Array} body
 */

/**
 * @typedef {object} Host
 * @property {(url: string, options?: {headers?: Record<string,string>}) => Promise<HttpResponse>} httpGet
 * @property {(path: string) => Promise<string>} readText
 * @property {(path: string, data: string) => Promise<void>} writeText
 * @property {(path: string) => Promise<Uint8Array>} readBytes
 * @property {(path: string, data: Uint8Array) => Promise<void>} writeBytes
 * @property {(path: string) => Promise<void>} mkdirp
 * @property {(path: string) => Promise<boolean>} exists
 * @property {(path: string) => Promise<void>} removeTree
 * @property {(from: string, to: string) => Promise<void>} rename
 * @property {(...parts: string[]) => string} pathJoin
 * @property {() => string} cwd
 * @property {(algo: string, data: Uint8Array) => Promise<Uint8Array>} [hash]
 * @property {(data: Uint8Array, destination: string) => Promise<void>} [extractTarGz]
 */

const REQUIRED = [
  "httpGet",
  "readText",
  "writeText",
  "readBytes",
  "writeBytes",
  "mkdirp",
  "exists",
  "removeTree",
  "rename",
  "pathJoin",
  "cwd"
];

/**
 * @param {Partial<Host>} host
 * @returns {Host}
 */
export function assertHost(host) {
  if (!host || typeof host !== "object") {
    throw new Error("host adapter must be an object");
  }
  for (const key of REQUIRED) {
    if (typeof host[key] !== "function") {
      throw new Error("host adapter missing function: " + key);
    }
  }
  return /** @type {Host} */ (host);
}

/**
 * Require installer-related capabilities.
 * @param {Partial<Host>} host
 * @returns {Host}
 */
export function assertInstallerHost(host) {
  assertHost(host);
  if (typeof host.hash !== "function") {
    throw new Error("host adapter missing function: hash");
  }
  if (typeof host.extractTarGz !== "function") {
    throw new Error("host adapter missing function: extractTarGz");
  }
  return /** @type {Host} */ (host);
}

/**
 * @param {Host} host
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function fetchJSON(host, url, options) {
  assertHost(host);
  const headers = Object.assign(
    { Accept: "application/json", "User-Agent": "qpm/0.0" },
    options && options.headers
  );
  const res = await host.httpGet(url, { headers });
  if (res.status < 200 || res.status >= 300) {
    throw new Error("HTTP " + res.status + " for " + url);
  }
  const text = typeof res.body === "string"
    ? res.body
    : decodeUtf8(res.body);
  return JSON.parse(text);
}

/**
 * Download raw bytes (e.g. a package tarball).
 * @param {Host} host
 * @param {string} url
 * @returns {Promise<Uint8Array>}
 */
export async function fetchBytes(host, url) {
  assertHost(host);
  const res = await host.httpGet(url, {
    headers: { "User-Agent": "qpm/0.0", Accept: "*/*" }
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error("HTTP " + res.status + " for " + url);
  }
  if (typeof res.body === "string") {
    return encodeUtf8(res.body);
  }
  return res.body instanceof Uint8Array ? res.body : new Uint8Array(res.body);
}

/**
 * @param {Host} host
 * @param {string} [registry]
 * @returns {(name: string) => Promise<object>}
 */
export function makeFetchPackument(host, registry) {
  assertHost(host);
  const base = (registry || "https://registry.npmjs.org").replace(/\/$/, "");
  return async function fetchPackument(name) {
    const { packageMetadataURL } = await import("./registry.js");
    const url = packageMetadataURL(name, base);
    return fetchJSON(host, url);
  };
}
