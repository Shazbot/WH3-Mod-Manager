import * as nodePath from "node:path";

/**
 * Which custom-folder mods are staged into whmm_copied_mods when optimization is on.
 *
 * The game must load the staged copy unambiguously, so a staged pack name must not also be
 * findable in another working directory the launch emits. Workshop mods already work that way (each
 * has its own folder, dropped once staged). A custom folder holds many packs, so the folder is
 * staged as a whole: when it holds an optimizable mod every enabled mod of it is copied (the others
 * plain) and its add_working_directory line is dropped for this launch. A kept folder that still
 * holds a pack with a staged name is staged as well, until no emitted folder does.
 */

export interface SelectionMod {
  name: string;
  path: string;
  modDirectory: string;
  sourceKind: "workshop" | "custom" | "data";
  isInModding?: boolean;
}

export interface CustomFolderStaging {
  /** The custom-folder mods to stage next to the Workshop mods. */
  mods: SelectionMod[];
  /** Folders whose working-directory line is dropped (comparable form). */
  stagedDirectories: Set<string>;
  /** Why each folder was staged, by comparable directory. */
  folderReasons: Map<string, string>;
}

export const comparableDirectory = (directory: string) => nodePath.resolve(directory).toLowerCase();
const comparableName = (name: string) => name.toLowerCase();

export interface SelectCustomFolderStagingOptions {
  /** Enabled mods in load order. */
  mods: readonly SelectionMod[];
  /** Pack names (lowercase) that exist in the game's Data folders: those always win and are never staged. */
  dataPackNames: ReadonlySet<string>;
  hasVisualAssets: (packPath: string) => Promise<boolean>;
  /** Lowercase pack file names physically present in a folder. */
  listPackNames: (directory: string) => Promise<ReadonlySet<string>>;
}

export const selectCustomFolderStaging = async ({
  mods,
  dataPackNames,
  hasVisualAssets,
  listPackNames,
}: SelectCustomFolderStagingOptions): Promise<CustomFolderStaging> => {
  const eligible = mods.filter(
    (mod) => mod.sourceKind === "custom" && !mod.isInModding && !dataPackNames.has(comparableName(mod.name)),
  );
  const byDirectory = new Map<string, SelectionMod[]>();
  for (const mod of eligible) {
    const key = comparableDirectory(mod.modDirectory);
    byDirectory.set(key, [...(byDirectory.get(key) ?? []), mod]);
  }

  const stagedDirectories = new Set<string>();
  const folderReasons = new Map<string, string>();
  const stagedNames = new Set<string>();
  for (const mod of mods) {
    if (mod.sourceKind === "workshop" && !dataPackNames.has(comparableName(mod.name))) {
      stagedNames.add(comparableName(mod.name));
    }
  }

  const stageDirectory = (directory: string, reason: string) => {
    stagedDirectories.add(directory);
    folderReasons.set(directory, reason);
    for (const mod of byDirectory.get(directory) ?? []) stagedNames.add(comparableName(mod.name));
  };

  for (const [directory, folderMods] of byDirectory) {
    for (const mod of folderMods) {
      if (await hasVisualAssets(mod.path)) {
        stageDirectory(directory, `holds the optimizable mod ${mod.name}`);
        break;
      }
    }
  }

  // A folder that stays emitted must not also hold a staged name.
  const emittedCustomDirectories = new Set(
    mods
      .filter((mod) => mod.sourceKind === "custom" && !mod.isInModding)
      .map((mod) => comparableDirectory(mod.modDirectory)),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const directory of emittedCustomDirectories) {
      if (stagedDirectories.has(directory)) continue;
      const present = await listPackNames(directory);
      const clash = [...present].find((name) => stagedNames.has(name));
      if (!clash) continue;
      stageDirectory(directory, `holds ${clash}, which is staged from another source`);
      changed = true;
    }
  }

  return {
    mods: eligible.filter((mod) => stagedDirectories.has(comparableDirectory(mod.modDirectory))),
    stagedDirectories,
    folderReasons,
  };
};
