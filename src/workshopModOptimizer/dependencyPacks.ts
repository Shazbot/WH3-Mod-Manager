import * as nodePath from "node:path";

/** What the dependency rules read of a mod; `Mod` satisfies it. */
export interface DependencyAwareMod {
  name: string;
  path: string;
  workshopId?: string;
  /** Required workshop mods as [workshop id, name]. */
  reqModIdToName?: [string, string][];
  /** Pack names the mod depends on. */
  dependencyPacks?: string[];
}

const comparablePath = (path: string) => nodePath.win32.normalize(path).toLowerCase();

/**
 * The mods that have a declared dependency edge with `source`, in either direction (the source requires
 * them, or they require the source), in the order of `mods`. The rules are those of the dependency-aware
 * bisect in `appSlice.ts`: required workshop ids are matched to mods by workshop id, `dependencyPacks`
 * names to mods by pack name (compared without regard to case, as Windows does). The source itself is
 * never part of the result; a dependency that is not in `mods` (not enabled) is ignored.
 */
export const dependencyRelatedMods = <T extends DependencyAwareMod>(
  source: DependencyAwareMod,
  mods: readonly T[],
): T[] => {
  const own = comparablePath(source.path);
  const requiredIds = new Set((source.reqModIdToName ?? []).map(([id]) => id));
  const requiredNames = new Set((source.dependencyPacks ?? []).map((name) => name.toLowerCase()));
  const sourceName = source.name.toLowerCase();
  const sourceId = source.workshopId ?? "";
  const seen = new Set<string>([own]);
  const result: T[] = [];
  for (const mod of mods) {
    const key = comparablePath(mod.path);
    if (seen.has(key)) continue;
    const modId = mod.workshopId ?? "";
    const sourceRequiresMod = (modId !== "" && requiredIds.has(modId)) || requiredNames.has(mod.name.toLowerCase());
    const modRequiresSource =
      (sourceId !== "" && (mod.reqModIdToName ?? []).some(([id]) => id === sourceId)) ||
      (mod.dependencyPacks ?? []).some((name) => name.toLowerCase() === sourceName);
    if (!sourceRequiresMod && !modRequiresSource) continue;
    seen.add(key);
    result.push(mod);
  }
  return result;
};
