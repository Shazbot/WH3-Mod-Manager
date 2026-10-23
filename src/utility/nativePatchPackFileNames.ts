export const canonicalPackName = (name: string) => name.replace(/\\/g, "/").replace(/^\/+/, "");

export const isNativePatchManifestPackedFile = (packedFileName: string) => {
  const name = canonicalPackName(packedFileName);
  return /^whmm_patches\//i.test(name) && name.toLowerCase().endsWith(".wh3patch.json");
};

export const isNativePatchContributionPackedFile = (packedFileName: string) => {
  const name = canonicalPackName(packedFileName);
  return /^whmm_patch_contributions\/v1\//i.test(name) && name.toLowerCase().endsWith(".wh3patchcontrib.json");
};
