// UTF-8 encode/decode without TextEncoder/TextDecoder.
//
// QuickJS has neither (nor URL or Buffer), so the portable core cannot
// assume them. These are used where present and replaced by a small pure
// implementation where not. Invalid input decodes to U+FFFD per sequence,
// which is what TextDecoder does in its default (non-fatal) mode.

const hasEncoder = typeof TextEncoder === "function";
const hasDecoder = typeof TextDecoder === "function";

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export function encodeUtf8(str) {
  return hasEncoder ? new TextEncoder().encode(str) : encodeUtf8Pure(str);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeUtf8(bytes) {
  return hasDecoder ? new TextDecoder().decode(bytes) : decodeUtf8Pure(bytes);
}

// The pure implementations are exported so tests can exercise them on an
// engine that has the built-ins too.

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export function encodeUtf8Pure(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // lone surrogate
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
               0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeUtf8Pure(bytes) {
  let s = "";
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i];
    let cp = 0xfffd;
    let len = 1;
    if (b < 0x80) {
      cp = b;
    } else if (b >= 0xc2 && b <= 0xdf) {
      len = 2;
    } else if (b >= 0xe0 && b <= 0xef) {
      len = 3;
    } else if (b >= 0xf0 && b <= 0xf4) {
      len = 4;
    }
    if (len > 1) {
      let ok = i + len <= n;
      let v = len === 2 ? b & 0x1f : len === 3 ? b & 0x0f : b & 0x07;
      for (let k = 1; ok && k < len; k++) {
        const cb = bytes[i + k];
        if ((cb & 0xc0) !== 0x80) ok = false;
        else v = (v << 6) | (cb & 0x3f);
      }
      // reject overlongs, surrogates and out-of-range values
      if (ok && ((len === 3 && (v < 0x800 || (v >= 0xd800 && v <= 0xdfff))) ||
                 (len === 4 && (v < 0x10000 || v > 0x10ffff)))) {
        ok = false;
      }
      if (ok) {
        cp = v;
      } else {
        len = 1;
      }
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      s += String.fromCharCode(cp);
    }
    i += len;
  }
  return s;
}
