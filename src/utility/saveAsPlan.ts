/**
 * What "Save As" should do, decided before anything touches the disk.
 *
 * The branches interact in ways that are easy to get subtly wrong - writing before asking about an
 * existing pack destroys it, and both writePack paths return early on an empty file list, so an
 * unchanged pack has to be copied rather than written. Kept pure so those orderings can be pinned.
 */

export const EMPTY_MEMORY_PACK_REASON = "This pack is empty, so there is nothing to save yet.";

export interface SaveAsSituation {
  /** A pack that only exists in memory, so there is no file to copy. */
  isMemoryPack: boolean;
  unsavedFileCount: number;
  /** A pack already sits at the chosen save path. */
  targetExists: boolean;
  /** The chosen save path is the pack being saved from. */
  targetIsSourcePack: boolean;
  /** The user has already agreed to replace what is at the save path. */
  overwriteExisting: boolean;
}

export type SaveAsPlan =
  | { action: "reject"; reason: string }
  | { action: "confirmOverwrite" }
  | { action: "leaveAsIs" }
  | { action: "copyPack" }
  | { action: "writePack" };

export const planSaveAs = (situation: SaveAsSituation): SaveAsPlan => {
  if (situation.isMemoryPack && situation.unsavedFileCount === 0) {
    return { action: "reject", reason: EMPTY_MEMORY_PACK_REASON };
  }
  // Before any writing, so declining leaves the existing pack exactly as it was.
  if (situation.targetExists && !situation.overwriteExisting) return { action: "confirmOverwrite" };

  if (situation.unsavedFileCount === 0) {
    // Saving an unchanged pack over itself would be a copy onto itself, which is just a no-op.
    return situation.targetIsSourcePack ? { action: "leaveAsIs" } : { action: "copyPack" };
  }
  return { action: "writePack" };
};
