export type PackRowsByTable = Record<string, Array<Record<string, string>>>;

export interface PackRowsForSave {
  fileNames: string[];
  rowsByTable: PackRowsByTable;
}

/**
 * Removes pending rows whose complete serialized values already occur in the target pack.
 *
 * The caller supplies the projection because a localization row and a DB row have different
 * notions of which values make them identical. Keeping the comparison here makes both save
 * panels use the same exact-match semantics.
 */
export const filterRowsAlreadyInPack = <TRow>(
  pendingRows: readonly TRow[],
  existingRows: readonly Record<string, string>[] | undefined,
  pendingProjection: (row: TRow) => readonly unknown[],
  existingProjection: (row: Record<string, string>) => readonly unknown[],
): TRow[] => {
  if (!existingRows || existingRows.length === 0) return [...pendingRows];

  const existingSignatures = new Set(existingRows.map((row) => JSON.stringify(existingProjection(row))));
  return pendingRows.filter((row) => !existingSignatures.has(JSON.stringify(pendingProjection(row))));
};
