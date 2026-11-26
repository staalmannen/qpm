// Engine-independent ustar parsing for npm package tarballs.
//
// This is the half of extraction that is a pure function of its input:
// it takes the already-gunzipped archive bytes and returns the entries a
// host should write. Decompression and filesystem writes stay in the host
// adapter (see tar.js for the Node one), so this file runs on any engine
// with Uint8Array -- QuickJS included.

import { decodeUtf8 } from "./utf8.js";

function readOctal(buf, start, len) {
  let s = "";
  for (let i = start; i < start + len; i++) {
    const c = buf[i];
    if (c === 0 || c === 0x20) break;
    s += String.fromCharCode(c);
  }
  s = s.trim();
  if (!s) return 0;
  return parseInt(s, 8) || 0;
}

function readString(buf, start, len) {
  let end = start;
  const limit = start + len;
  while (end < limit && buf[end] !== 0) end++;
  return decodeUtf8(buf.subarray(start, end));
}

/**
 * Sanitize a tar entry path. Rejects absolute paths, drive letters,
 * empty segments and any `..` segment.
 * @param {string} name
 * @returns {string|null} normalized relative path, or null if rejected
 */
export function safeTarPath(name) {
  if (!name || typeof name !== "string") return null;
  let p = name.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  if (!p || p === ".") return null;
  const parts = p.split("/");
  for (const part of parts) {
    if (part === ".." || part === "") return null;
  }
  return parts.join("/");
}

/**
 * @typedef {object} TarEntry
 * @property {string} path    relative, already sanitized (and stripped)
 * @property {"file"|"dir"} type
 * @property {Uint8Array} data   empty for directories
 */

/**
 * Parse an uncompressed ustar archive.
 *
 * Unsafe paths are dropped, as are symlinks, hard links and special files
 * (an installer should never create those from a registry tarball). With
 * stripPackagePrefix (the default) the leading "package/" that npm puts
 * on every entry is removed, and the "package" directory itself dropped.
 *
 * @param {Uint8Array} buf
 * @param {object} [options]
 * @param {boolean} [options.stripPackagePrefix=true]
 * @returns {TarEntry[]}
 */
export function parseTar(buf, options) {
  const stripPackagePrefix = !options || options.stripPackagePrefix !== false;
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    let zero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) { zero = false; break; }
    }
    if (zero) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = header[156] ? String.fromCharCode(header[156]) : "0";
    const magic = readString(header, 257, 6);
    let fullName = name;
    if (magic === "ustar") {
      const prefix = readString(header, 345, 155);
      if (prefix) fullName = prefix + "/" + name;
    }

    offset += 512;
    const dataEnd = offset + size;
    if (dataEnd > buf.length) {
      throw new Error("truncated tar entry: " + fullName);
    }
    const content = buf.subarray(offset, dataEnd);
    offset = dataEnd + ((512 - (size % 512)) % 512);

    let rel = safeTarPath(fullName);
    if (!rel) continue;
    if (stripPackagePrefix && (rel === "package" || rel.startsWith("package/"))) {
      rel = rel === "package" ? "" : rel.slice("package/".length);
      if (!rel) continue;
    }

    if (typeFlag === "5" || typeFlag === "D") {
      entries.push({ path: rel, type: "dir", data: new Uint8Array(0) });
    } else if (typeFlag === "0" || typeFlag === "\0") {
      entries.push({ path: rel, type: "file", data: content });
    }
    // "1" hard link, "2" symlink, devices, fifos, pax headers: skipped
  }
  return entries;
}
