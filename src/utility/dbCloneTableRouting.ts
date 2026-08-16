import { findVanillaPacksUnderPrefix, type VanillaPackIndex } from "../vanillaPackIndex/format";

export const toDBTablePrefix = (tableNameOrPrefix: string): string => {
  if (!tableNameOrPrefix.startsWith("db\\")) return `db\\${tableNameOrPrefix}\\`;
  return tableNameOrPrefix.split("\\").length === 2 ? `${tableNameOrPrefix}\\` : tableNameOrPrefix;
};

/** The vanilla packs that win at least one packed file belonging to this DB table. */
export const getVanillaPackNamesForDBTable = (index: VanillaPackIndex, tableName: string): string[] =>
  findVanillaPacksUnderPrefix(index, toDBTablePrefix(tableName));
