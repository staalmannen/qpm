import { maxSatisfying } from "./semver.js";
import { validatePackageName } from "./manifest.js";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export function packageMetadataURL(name, registry = DEFAULT_REGISTRY) {
  if (!validatePackageName(name)) throw new Error("Invalid npm package name: " + name);
  const encoded = name.startsWith("@")
    ? "@" + encodeURIComponent(name.slice(1, name.indexOf("/"))) + "%2f" +
      encodeURIComponent(name.slice(name.indexOf("/") + 1))
    : encodeURIComponent(name);
  return registry.replace(/\/$/, "") + "/" + encoded;
}

export function selectVersion(packument, range = "latest") {
  if (!packument || typeof packument !== "object" || !packument.versions) {
    throw new Error("Invalid registry packument");
  }
  const versions = Object.keys(packument.versions);
  if (range === "latest") {
    const tagged = packument["dist-tags"] && packument["dist-tags"].latest;
    if (tagged && packument.versions[tagged]) return tagged;
    range = "*";
  }
  const selected = maxSatisfying(versions, range);
  if (!selected) throw new Error("No published version satisfies " + range);
  return selected;
}

export function getVersionMetadata(packument, versionOrRange = "latest") {
  const version = selectVersion(packument, versionOrRange);
  const metadata = packument.versions[version];
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Registry metadata is missing for " + version);
  }
  return { version, metadata };
}
