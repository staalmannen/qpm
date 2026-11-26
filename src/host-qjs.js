// QuickJS host adapter for qpm.
//
// Built on QuickJS's own "std" and "os" modules only -- no native code of
// qpm's -- so it runs on any qjs, QuickTS on Plan 9 APE included. Only the
// QuickJS entry point (bin/qpm-qjs.js) imports this file; Node never sees
// it, which is why the static imports of "std"/"os" are safe here.
//
// HTTP goes through std.urlGet, which runs `curl -s -i -- URL` via popen
// and returns once curl exits. Two consequences, both accepted for now:
//   - request headers cannot be set (curl's defaults are sent);
//   - redirects are not followed (curl runs without -L), so a 3xx comes
//     back as a status, which fetchJSON/fetchBytes report as an error.
//
// Not provided yet: hash and extractTarGz, which `install` needs. Without
// them assertInstallerHost refuses with a clear message, while `info` and
// `resolve`, which need only HTTP and files, work.

import * as std from "std";
import * as os from "os";

function fail(what, path, errno) {
  const e = new Error(what + " " + path + ": " + std.strerror(errno));
  e.errno = errno;
  return e;
}

/** Parse the raw header block urlGet returns into a lower-cased map. */
function parseHeaders(text) {
  const headers = {};
  for (const line of String(text || "").split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    headers[name] = line.slice(i + 1).trim();
  }
  return headers;
}

function statOf(path, follow) {
  const [st, err] = follow ? os.stat(path) : os.lstat(path);
  return err === 0 ? st : null;
}

function isDir(st) {
  return st !== null && (st.mode & os.S_IFMT) === os.S_IFDIR;
}

/** Normalise a "/"-separated path: collapse "//", drop ".", resolve "..". */
function normalize(p) {
  const abs = p.startsWith("/");
  const out = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
    } else {
      out.push(part);
    }
  }
  const s = out.join("/");
  return abs ? "/" + s : (s || ".");
}

export function createQjsHost() {
  const host = {
    async httpGet(url) {
      const r = std.urlGet(url, { binary: true, full: true });
      const body = r.response ? new Uint8Array(r.response) : new Uint8Array(0);
      return {
        status: r.status,
        url,
        headers: parseHeaders(r.responseHeaders),
        body
      };
    },

    async readText(path) {
      const text = std.loadFile(path);
      if (text === null) throw new Error("cannot read " + path);
      return text;
    },

    async writeText(path, data) {
      const f = std.open(path, "w");
      if (!f) throw new Error("cannot create " + path);
      f.puts(data);
      f.close();
    },

    async readBytes(path) {
      const f = std.open(path, "rb");
      if (!f) throw new Error("cannot read " + path);
      f.seek(0, std.SEEK_END);
      const size = f.tell();
      f.seek(0, std.SEEK_SET);
      const buf = new ArrayBuffer(size);
      const n = size ? f.read(buf, 0, size) : 0;
      f.close();
      if (n !== size) throw new Error("short read on " + path);
      return new Uint8Array(buf);
    },

    async writeBytes(path, data) {
      const f = std.open(path, "wb");
      if (!f) throw new Error("cannot create " + path);
      const n = data.length ? f.write(data.buffer, data.byteOffset, data.length) : 0;
      f.close();
      if (n !== data.length) throw new Error("short write on " + path);
    },

    async mkdirp(path) {
      const p = normalize(path);
      const parts = p.split("/");
      let cur = p.startsWith("/") ? "" : ".";
      for (const part of parts) {
        if (part === "") continue;
        cur = cur === "" ? "/" + part : cur + "/" + part;
        const st = statOf(cur, true);
        if (st !== null) {
          if (!isDir(st)) throw new Error("not a directory: " + cur);
          continue;
        }
        const err = os.mkdir(cur, 0o777);
        if (err < 0 && !isDir(statOf(cur, true))) throw fail("mkdir", cur, -err);
      }
    },

    async exists(path) {
      return statOf(path, true) !== null;
    },

    async removeTree(path) {
      const st = statOf(path, false);
      if (st === null) return;
      if (isDir(st)) {
        const [names, err] = os.readdir(path);
        if (err !== 0) throw fail("readdir", path, err);
        for (const n of names) {
          if (n === "." || n === "..") continue;
          await host.removeTree(path + "/" + n);
        }
      }
      const err = os.remove(path);
      if (err < 0) throw fail("remove", path, -err);
    },

    async rename(from, to) {
      const err = os.rename(from, to);
      if (err < 0) throw fail("rename", from + " -> " + to, -err);
    },

    pathJoin(...parts) {
      return normalize(parts.filter((x) => x !== "").join("/"));
    },

    cwd() {
      const [dir, err] = os.getcwd();
      if (err !== 0) throw fail("getcwd", ".", err);
      return dir;
    }
  };
  return host;
}
