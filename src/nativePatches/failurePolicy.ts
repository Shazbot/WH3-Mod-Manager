import type { NativePatchIdentity, NativePatchManifest, NativePatchSkippedPackage } from "./manifest";

type PatchSource = {
  manifest: NativePatchManifest;
  sourcePackPath?: string;
  sourceModName?: string;
  pack?: { path: string; displayName?: string };
};

export const nativePatchIdentity = (item: PatchSource): NativePatchIdentity => ({
  packageId: item.manifest.package.id,
  packageName: item.manifest.package.name,
  sourcePackPath: item.sourcePackPath ?? item.pack?.path,
  sourceModName: item.sourceModName ?? item.pack?.displayName,
});

export class NativePatchPackageError extends Error {
  constructor(
    message: string,
    readonly packageIds: string[],
    readonly packages: NativePatchIdentity[] = [],
  ) {
    super(message);
  }
}

/** Remove optional failures and propagate missing dependencies before retrying. */
export const skipFailedNativePatches = <T extends PatchSource>(
  packages: T[],
  packageIds: string[],
  message: string,
  onSkippedPackage?: (notice: NativePatchSkippedPackage) => void,
): T[] => {
  const implicated = packageIds.length
    ? packages.filter((item) => packageIds.includes(item.manifest.package.id))
    : packages;
  const skipped = new Map<string, string>();
  for (const item of implicated) {
    if (item.manifest.on_failure === "warn" || item.manifest.on_failure === "silent") {
      skipped.set(item.manifest.package.id, message);
    }
  }
  if (!skipped.size) throw new NativePatchPackageError(message, packageIds, implicated.map(nativePatchIdentity));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of packages) {
      const id = item.manifest.package.id;
      if (skipped.has(id)) continue;
      const dependency = Array.isArray(item.manifest.requires)
        ? item.manifest.requires.find((entry) => entry && skipped.has(entry.id))
        : undefined;
      if (!dependency) continue;
      const reason = `${id} requires skipped native patch ${dependency.id}@${dependency.version}`;
      if ((item.manifest.on_failure ?? "abort") === "abort") {
        throw new NativePatchPackageError(reason, [id], [nativePatchIdentity(item)]);
      }
      skipped.set(id, reason);
      changed = true;
    }
  }
  return packages.filter((item) => {
    const id = item.manifest.package.id;
    const reason = skipped.get(id);
    if (reason === undefined) return true;
    onSkippedPackage?.({
      ...nativePatchIdentity(item),
      policy: item.manifest.on_failure as "warn" | "silent",
      message: reason,
    });
    return false;
  });
};
