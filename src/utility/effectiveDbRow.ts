/** Canonical logical table name used when DB files are split into row-bearing subfiles. */
export const getCanonicalLogicalTableName = (packedFileName: string): string => {
  const normalizedName = packedFileName.replace(/[\\/]+/g, "\\").toLowerCase();
  const [folder, tableName] = normalizedName.split("\\");
  return folder === "db" && tableName ? `db\\${tableName}` : normalizedName;
};

/** Normalized subfile name used to choose the effective row across DB table variants. */
export const normalizePackedDbFileName = (packedFileName: string): string =>
  packedFileName.replace(/[\\/]+/g, "\\").toLowerCase();

/** Lower normalized table filename wins; equality intentionally retains the earlier candidate. */
export const shouldReplaceEffectiveDbRowWinner = (candidateFileName: string, currentFileName: string): boolean =>
  normalizePackedDbFileName(candidateFileName) < normalizePackedDbFileName(currentFileName);
