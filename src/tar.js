// Minimal gzip + ustar extraction helpers used by the Node host.
// Not part of the portable core contract — host.extractTarGz is.
// Rejects path traversal and absolute paths.

import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const gunzip = promisify(zlib.gunzip);

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
  return new TextDecoder().decode(buf.subarray(start, end));
}

/**
 * Sanitize a tar entry path: strip leading package/ prefix is left to caller;
 * here we only reject unsafe paths.
 * @param {string} name
 * @returns {string|null} normalized relative path or null if rejected
 */
export function safeTarPath(name) {
  if (!name || typeof name !== "string") return null;
  // Normalize separators
  let p = name.replace(/\\/g, "/");
  // Drop leading ./
  while (p.startsWith("./")) p = p.slice(2);
  // Reject absolute and drive paths
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  // Reject empty after strip
  if (!p || p === ".") return null;
  const parts = p.split("/");
  for (const part of parts) {
    if (part === ".." || part === "") return null;
  }
  return parts.join("/");
}

/**
 * Parse a gzipped ustar archive and write files under destination.
 * npm packages typically have a single top-level "package/" directory.
 *
 * @param {Uint8Array|Buffer} data
 * @param {string} destination  absolute or relative output directory
 * @param {object} [options]
 * @param {boolean} [options.stripPackagePrefix=true]  strip leading "package/"
 */
export async function extractTarGzTo(data, destination, options) {
  const stripPackagePrefix = !options || options.stripPackagePrefix !== false;
  const inflated = await gunzip(Buffer.from(data));
  const buf = inflated instanceof Uint8Array ? inflated : new Uint8Array(inflated);

  await fs.mkdir(destination, { recursive: true });

  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // Empty block marks end
    let zero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) { zero = false; break; }
    }
    if (zero) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = header[156] ? String.fromCharCode(header[156]) : "0";
    // ustar prefix (ustar format)
    const magic = readString(header, 257, 6);
    let fullName = name;
    if (magic === "ustar") {
      const prefix = readString(header, 345, 155);
      if (prefix) fullName = prefix + "/" + name;
    }

    offset += 512;
    const dataEnd = offset + size;
    const content = buf.subarray(offset, dataEnd);
    // advance to next 512-byte boundary
    offset = dataEnd + ((512 - (size % 512)) % 512);

    let rel = safeTarPath(fullName);
    if (!rel) continue;

    if (stripPackagePrefix && (rel === "package" || rel.startsWith("package/"))) {
      rel = rel === "package" ? "" : rel.slice("package/".length);
      if (!rel) {
        // top-level package dir itself
        continue;
      }
    }

    const destPath = path.join(destination, rel);
    // Final containment check
    const resolvedDest = path.resolve(destination);
    const resolvedFile = path.resolve(destPath);
    if (resolvedFile !== resolvedDest && !resolvedFile.startsWith(resolvedDest + path.sep)) {
      throw new Error("tar entry escapes destination: " + fullName);
    }

    if (typeFlag === "5" || typeFlag === "D") {
      await fs.mkdir(destPath, { recursive: true });
    } else if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, Buffer.from(content));
    } else if (typeFlag === "2") {
      // symlink — skip for safety in v1 installer
      continue;
    } else {
      // other types (hard link, fifo, ...) skipped
      continue;
    }
  }
}
