import { PackCollisions } from "../packFileTypes";

/**
 * A compatibility report written out in a form two builds can be diffed against each other.
 *
 * Built to answer one question: did a change to how the data is read alter what gets reported? So the
 * output has to be **canonical** - the same findings must produce the same bytes regardless of the
 * order they happened to be discovered in. Object keys are sorted, and so are arrays, by the canonical
 * form of their own elements.
 *
 * Sorting arrays does discard the order findings came in. That is deliberate: the order conflicts are
 * discovered is an artefact of pack iteration, not a fact about the mods, and leaving it in would make
 * every diff noisy with differences that mean nothing.
 */

/** Recursively sorts object keys and array elements so equal content always serialises identically. */
export const canonicaliseForDiff = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const items = value.map(canonicaliseForDiff);
    return items
      .map((item) => ({ item, key: JSON.stringify(item) ?? "" }))
      .sort((first, second) => (first.key < second.key ? -1 : first.key > second.key ? 1 : 0))
      .map(({ item }) => item);
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicaliseForDiff((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
};

export interface CompatReportModEntry {
  name: string;
  isEnabled: boolean;
  loadOrder: number | null;
}

export interface CompatReportCounts {
  packFileCollisions: number;
  packTableCollisions: number;
  missingTableReferences: number;
  uniqueIdsCollisions: number;
  scriptListenerCollisions: number;
  packFileAnalysisErrors: number;
  missingFileRefs: number;
}

const countEntries = (byPack: Record<string, unknown[]>): number =>
  Object.values(byPack).reduce((total, entries) => total + entries.length, 0);

const countNestedEntries = (byPack: Record<string, Record<string, unknown[]>>): number =>
  Object.values(byPack).reduce((total, byFile) => total + countEntries(byFile), 0);

/**
 * Totals, so a difference is obvious before anyone opens a diff tool.
 *
 * Counting the leaves rather than the top-level keys: a pack losing one of its five missing references
 * is exactly the kind of regression this is looking for, and a key count would not show it.
 */
export const countCompatFindings = (collisions: PackCollisions): CompatReportCounts => ({
  packFileCollisions: collisions.packFileCollisions.length,
  packTableCollisions: collisions.packTableCollisions.length,
  missingTableReferences: countEntries(collisions.missingTableReferences),
  uniqueIdsCollisions: countEntries(collisions.uniqueIdsCollisions),
  scriptListenerCollisions: countEntries(collisions.scriptListenerCollisions),
  packFileAnalysisErrors: countNestedEntries(collisions.packFileAnalysisErrors),
  missingFileRefs: countNestedEntries(collisions.missingFileRefs),
});

/**
 * The whole report as text.
 *
 * The mod list is included because a comparison across two builds only means anything if both ran over
 * the same mods - and a mod set that quietly differs is the most likely way to get a misleading result.
 */
export const formatCompatReport = (
  collisions: PackCollisions,
  mods: readonly CompatReportModEntry[],
): string =>
  `${JSON.stringify(
    {
      mods: canonicaliseForDiff(
        mods.map((mod) => ({ name: mod.name, isEnabled: mod.isEnabled, loadOrder: mod.loadOrder })),
      ),
      counts: countCompatFindings(collisions),
      collisions: canonicaliseForDiff(collisions),
    },
    null,
    2,
  )}\n`;
