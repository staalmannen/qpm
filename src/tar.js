// gzip + ustar extraction for the Node host.
// Not part of the portable core contract -- host.extractTarGz is.
//
// The parsing lives in tar-core.js, which is engine-independent; this file
// adds only what is Node's: gunzip and the filesystem writes.

import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseTar } from "./tar-core.js";

export { safeTarPath } from "./tar-core.js";

const gunzip = promisify(zlib.gunzip);

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
  const inflated = await gunzip(Buffer.from(data));
  const buf = inflated instanceof Uint8Array ? inflated : new Uint8Array(inflated);

  await fs.mkdir(destination, { recursive: true });
  const resolvedDest = path.resolve(destination);

  for (const entry of parseTar(buf, options)) {
    const destPath = path.join(destination, entry.path);
    // Final containment check
    const resolvedFile = path.resolve(destPath);
    if (resolvedFile !== resolvedDest && !resolvedFile.startsWith(resolvedDest + path.sep)) {
      throw new Error("tar entry escapes destination: " + entry.path);
    }
    if (entry.type === "dir") {
      await fs.mkdir(destPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, Buffer.from(entry.data));
    }
  }
}
