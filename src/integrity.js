// Subresource Integrity (SRI) helpers for npm package dist.integrity.
// Pure ES modules. Hashing is delegated to the host so engines can use
// native crypto; a small pure-JS fallback is provided for tests.

const HEX = "0123456789abcdef";

export function toHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0xf];
  }
  return out;
}

export function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const n = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(n)) return null;
    out[i] = n;
  }
  return out;
}

/** Standard base64 encode (no URL-safe alphabet). */
export function toBase64(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] +
      chars[(n >> 6) & 63] + chars[n & 63];
  }
  if (i < bytes.length) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const n = (a << 16) | (b << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(n >> 6) & 63] : "=";
    out += "=";
  }
  return out;
}

export function fromBase64(b64) {
  if (typeof b64 !== "string") return null;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/=+$/, "").replace(/\s/g, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean[i]);
    const b = chars.indexOf(clean[i + 1] || "A");
    const c = chars.indexOf(clean[i + 2] || "A");
    const d = chars.indexOf(clean[i + 3] || "A");
    if (a < 0 || b < 0) return null;
    out.push((a << 2) | (b >> 4));
    if (clean[i + 2] != null) out.push(((b & 15) << 4) | (c >> 2));
    if (clean[i + 3] != null) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

/**
 * Parse an SRI string like "sha512-BASE64" or legacy "sha1-HEX".
 * Also accepts bare hex shasum (treated as sha1).
 * @returns {{algo: string, digest: Uint8Array, sri: string}|null}
 */
export function parseIntegrity(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  const m = /^(sha256|sha384|sha512|sha1)-([A-Za-z0-9+/=]+)$/i.exec(s);
  if (m) {
    const algo = m[1].toLowerCase();
    const digest = fromBase64(m[2]);
    if (!digest) return null;
    return { algo, digest, sri: algo + "-" + m[2] };
  }
  // Legacy npm shasum: 40-char hex SHA-1
  if (/^[0-9a-f]{40}$/i.test(s)) {
    const digest = fromHex(s);
    if (!digest) return null;
    return { algo: "sha1", digest, sri: "sha1-" + toBase64(digest) };
  }
  return null;
}

/**
 * Verify bytes against an integrity string using host.hash.
 * @param {import('./host.js').Host} host
 * @param {Uint8Array} data
 * @param {string} integrity  dist.integrity or dist.shasum
 * @returns {Promise<boolean>}
 */
export async function verifyIntegrity(host, data, integrity) {
  const parsed = parseIntegrity(integrity);
  if (!parsed) return false;
  if (typeof host.hash !== "function") {
    throw new Error("host.hash is required for integrity verification");
  }
  const actual = await host.hash(parsed.algo, data);
  if (!actual || actual.length !== parsed.digest.length) return false;
  // Constant-time style compare
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ parsed.digest[i];
  return diff === 0;
}

/**
 * Pick the strongest available integrity field from dist metadata.
 * Prefers dist.integrity (SRI) over dist.shasum.
 */
export function pickIntegrity(dist) {
  if (!dist || typeof dist !== "object") return null;
  if (typeof dist.integrity === "string" && dist.integrity.trim()) {
    return dist.integrity.trim();
  }
  if (typeof dist.shasum === "string" && dist.shasum.trim()) {
    return dist.shasum.trim();
  }
  return null;
}
