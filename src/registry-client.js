// Registry client built on the host adapter.
// Portable core logic; all I/O goes through Host.

import { assertHost, fetchJSON, makeFetchPackument } from "./host.js";
import { packageMetadataURL, selectVersion, getVersionMetadata, getDistInfo, DEFAULT_REGISTRY } from "./registry.js";

/**
 * @param {import('./host.js').Host} host
 * @param {object} [options]
 * @param {string} [options.registry]
 */
export function createRegistryClient(host, options) {
  assertHost(host);
  const registry = (options && options.registry) || DEFAULT_REGISTRY;
  const fetchPackument = makeFetchPackument(host, registry);

  return {
    registry,
    fetchPackument,

    async getPackument(name) {
      return fetchPackument(name);
    },

    async getVersion(name, range) {
      const packument = await fetchPackument(name);
      return getVersionMetadata(packument, range || "latest");
    },

    async getDist(name, range) {
      const { version, metadata } = await this.getVersion(name, range);
      const dist = getDistInfo(metadata);
      return { name, version, ...dist };
    },

    metadataURL(name) {
      return packageMetadataURL(name, registry);
    }
  };
}

export { packageMetadataURL, selectVersion, getVersionMetadata, getDistInfo, DEFAULT_REGISTRY };
