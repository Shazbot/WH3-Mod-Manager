import { findVanillaPacksUnderPrefix, type VanillaPackIndex } from "../vanillaPackIndex/format";

const DB_CLONE_UNWRITABLE_TABLE_PREFIX = "start_pos_";

/** start_pos rows are backed by campaign startpos data, so DB Clone cannot create new keys in them. */
export const isDBCloneTableIgnored = (tableNameOrPath: string): boolean => {
  const tableName = tableNameOrPath.startsWith("db\\") ? tableNameOrPath.slice(3).split("\\")[0] : tableNameOrPath;
  return tableName.startsWith(DB_CLONE_UNWRITABLE_TABLE_PREFIX);
};

export const toDBTablePrefix = (tableNameOrPrefix: string): string => {
  if (!tableNameOrPrefix.startsWith("db\\")) return `db\\${tableNameOrPrefix}\\`;
  return tableNameOrPrefix.split("\\").length === 2 ? `${tableNameOrPrefix}\\` : tableNameOrPrefix;
};

/** The vanilla packs that win at least one packed file belonging to this DB table. */
export const getVanillaPackNamesForDBTable = (index: VanillaPackIndex, tableName: string): string[] =>
  findVanillaPacksUnderPrefix(index, toDBTablePrefix(tableName));
