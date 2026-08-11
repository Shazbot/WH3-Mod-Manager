/**
 * Presets store membership and order, not copies of mod records. A preset entry is
 * `{ name, isEnabled?, loadOrder? }` and joins to the installed mods by `name` (the pack file name),
 * which is what every consumer already did even when full Mod objects were stored.
 */

/** Entries default to enabled: saved user presets only list the mods they turn on. */
export const isPresetModEnabled = (entry: PresetModEntry) => entry.isEnabled ?? true;

/**
 * Entries for a preset the user saved. `enabledOnly` (the default) drops disabled mods and omits the
 * `isEnabled` flag, since membership then implies enabled.
 */
export function toPresetEntries(mods: Mod[], { enabledOnly = true } = {}): PresetModEntry[] {
  const modsToStore = enabledOnly ? mods.filter((mod) => mod.isEnabled) : mods;
  return modsToStore.map((mod) => {
    const entry: PresetModEntry = { name: mod.name };
    if (!enabledOnly && !mod.isEnabled) entry.isEnabled = false;
    if (mod.loadOrder != null) entry.loadOrder = mod.loadOrder;
    return entry;
  });
}

/**
 * Entries for a snapshot of the whole mod list ("On App Start", "On Last Game Launch", the current
 * preset), where the order of disabled mods matters too.
 */
export const toSnapshotEntries = (mods: Mod[]) => toPresetEntries(mods, { enabledOnly: false });

export const getEnabledEntryNames = (entries: PresetModEntry[]) =>
  new Set(entries.filter(isPresetModEnabled).map((entry) => entry.name));

/** Resolves entries back to installed mods, keeping entry order and skipping mods that are gone. */
export function resolveEntriesToMods(entries: PresetModEntry[], mods: Mod[]) {
  const modsByName = new Map(mods.map((mod) => [mod.name, mod]));
  return entries
    .map((entry) => modsByName.get(entry.name))
    .filter((mod): mod is Mod => mod !== undefined);
}

/** Drops entries whose name repeats, keeping the first. Mirrors withoutDataAndContentDuplicates. */
export function withoutDuplicateEntries(entries: PresetModEntry[]) {
  const seenNames = new Set<string>();
  return entries.filter((entry) => {
    if (seenNames.has(entry.name)) return false;
    seenNames.add(entry.name);
    return true;
  });
}
