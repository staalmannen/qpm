// Node.js host adapter for development and CI.
// Uses standard Node modules only (no third-party deps).

import { assertInstallerHost } from "./host.js";
import { extractTarGzTo } from "./tar.js";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { URL } from "node:url";

function request(urlString, headers, maxRedirects) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === "https:" ? https : http;
    const opts = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "GET",
      headers: headers || {}
    };
    const req = lib.request(opts, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error("Too many redirects for " + urlString));
          res.resume();
          return;
        }
        const next = new URL(res.headers.location, url).href;
        res.resume();
        resolve(request(next, headers, maxRedirects - 1));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const headerMap = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") headerMap[k.toLowerCase()] = v;
          else if (Array.isArray(v)) headerMap[k.toLowerCase()] = v.join(", ");
        }
        resolve({
          status,
          url: urlString,
          headers: headerMap,
          body
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * @returns {import('./host.js').Host}
 */
export function createNodeHost() {
  const host = {
    async httpGet(url, options) {
      const headers = (options && options.headers) || {};
      const res = await request(url, headers, 10);
      return {
        status: res.status,
        url: res.url,
        headers: res.headers,
        body: res.body
      };
    },

    async readText(filePath) {
      return fs.readFile(filePath, "utf8");
    },

    async writeText(filePath, data) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, data, "utf8");
    },

    async readBytes(filePath) {
      const buf = await fs.readFile(filePath);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },

    async writeBytes(filePath, data) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, Buffer.from(data));
    },

    async mkdirp(dirPath) {
      await fs.mkdir(dirPath, { recursive: true });
    },

    async exists(filePath) {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    async removeTree(target) {
      await fs.rm(target, { recursive: true, force: true });
    },

    async rename(from, to) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
    },

    pathJoin(...parts) {
      return path.join(...parts);
    },

    cwd() {
      return process.cwd();
    },

    async hash(algo, data) {
      const name = String(algo).toLowerCase();
      const allowed = { sha1: "sha1", sha256: "sha256", sha384: "sha384", sha512: "sha512" };
      if (!allowed[name]) throw new Error("Unsupported hash algorithm: " + algo);
      const h = crypto.createHash(allowed[name]);
      h.update(Buffer.from(data));
      const dig = h.digest();
      return new Uint8Array(dig.buffer, dig.byteOffset, dig.byteLength);
    },

    async extractTarGz(data, destination) {
      await extractTarGzTo(data, destination, { stripPackagePrefix: true });
    }
  };
  return assertInstallerHost(host);
}
