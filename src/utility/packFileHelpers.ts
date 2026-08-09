import { DBVersion, Pack, PackedFile } from "../packFileTypes";

const matchPackNameFromPathRegex = /^.*\\(.*?)$/;

/** The folder the game itself reads DB tables from. Anything elsewhere is inert until copied here. */
export const DEFAULT_DB_TABLE_ROOT = "db";

/** Where the viewer puts a table you deliberately do not want the game to load. */
export const UNUSED_DB_TABLE_ROOT = "unusedtables";

/**
 * Folders whose contents the viewer treats as DB tables.
 *
 * Only `db\` is loaded by the game; the others hold spare copies you can keep in a pack, edit, and
 * later swap over the live table with the file operations node. Add a folder here to make it
 * editable in the viewer - it stays inert as far as the game, flows and collision checking are
 * concerned.
 */
export const DB_TABLE_ROOTS = [DEFAULT_DB_TABLE_ROOT, UNUSED_DB_TABLE_ROOT];

export interface ParsedDBTablePath {
  /** The root folder the file sits in, e.g. "db" or "unusedtables". */
  dbFolder: string;
  /** The table folder, e.g. "main_units_tables". */
  dbName: string;
  /** Everything after the table folder. May itself contain separators. */
  dbSubname: string;
}

/**
 * Splits a packed file path into its table parts, or undefined if it is not a table file.
 *
 * Deliberately not a regex: this runs once per packed file on every pack read, and a pattern that
 * has to match a folder at an arbitrary depth backtracks across the whole path for the majority of
 * files, which are not tables. Two prefix checks and two slices cost about what the old anchored
 * `^db\\` regex did.
 */
const parseDBTablePathInRoots = (packFileName: string, roots: string[]): ParsedDBTablePath | undefined => {
  for (const dbFolder of roots) {
    if (!packFileName.startsWith(`${dbFolder}\\`)) continue;

    const rest = packFileName.slice(dbFolder.length + 1);
    const separator = rest.indexOf("\\");
    if (separator < 1) return undefined;

    const dbName = rest.slice(0, separator);
    // Everything after the table folder, separators and all, so a nested subname survives.
    const dbSubname = rest.slice(separator + 1);
    if (!dbName || !dbSubname) return undefined;

    return { dbFolder, dbName, dbSubname };
  }

  return undefined;
};

/** Table files the viewer can show and edit, including the spare-copy folders. */
export const parseDBTablePath = (packFileName: string) =>
  parseDBTablePathInRoots(packFileName, DB_TABLE_ROOTS);

/**
 * Table files the game actually loads.
 *
 * Used where widening would be wrong rather than merely cautious: collision checking must not report
 * conflicts between inert spares, and a flow resolving a table by name must mean the live one.
 */
export const parseLiveDBTablePath = (packFileName: string) =>
  parseDBTablePathInRoots(packFileName, [DEFAULT_DB_TABLE_ROOT]);

export const getDBName = (packFile: PackedFile) => parseDBTablePath(packFile.name)?.dbName;

export const getDBSubname = (packFile: PackedFile) => parseDBTablePath(packFile.name)?.dbSubname;

export const getDBNameFromString = (packFileName: string) => parseDBTablePath(packFileName)?.dbName;

export const getDBSubnameFromString = (packFileName: string) => parseDBTablePath(packFileName)?.dbSubname;

export const getDBFolderFromString = (packFileName: string) => parseDBTablePath(packFileName)?.dbFolder;

/**
 * Label for a table group in the viewer tree.
 *
 * Tables are grouped by table name, so the folder has to be part of the label or a spare copy and
 * the live table collapse into one group - and then editing one would edit the other. The live
 * folder keeps its bare table name so nothing looks different from before.
 */
export const getDBGroupName = (dbFolder: string, dbName: string) =>
  dbFolder === DEFAULT_DB_TABLE_ROOT ? dbName : `${dbFolder}\\${dbName}`;

/** Inverse of getDBGroupName. */
export const parseDBGroupName = (groupName: string) => {
  const separator = groupName.lastIndexOf("\\");
  if (separator < 0) return { dbFolder: DEFAULT_DB_TABLE_ROOT, dbName: groupName };
  return { dbFolder: groupName.slice(0, separator), dbName: groupName.slice(separator + 1) };
};

/**
 * Groups table paths for the viewer tree: group label -> the subnames under it.
 *
 * Grouping by table name alone would merge a spare copy into the live table's group and leave no way
 * to tell them apart, so the folder is part of the key.
 */
export const groupDBTablePaths = (packFileNames: string[]) => {
  const subnamesByGroup = new Map<string, Set<string>>();

  for (const packFileName of packFileNames) {
    const parsed = parseDBTablePath(packFileName);
    if (!parsed) continue;

    const groupName = getDBGroupName(parsed.dbFolder, parsed.dbName);
    let subnames = subnamesByGroup.get(groupName);
    if (!subnames) {
      subnames = new Set<string>();
      subnamesByGroup.set(groupName, subnames);
    }
    subnames.add(parsed.dbSubname);
  }

  return subnamesByGroup;
};

export const getPackNameFromPath = (packPath: string) => {
  const packNameMatch = packPath.match(matchPackNameFromPathRegex);
  if (packNameMatch == null) return;
  const packName = packNameMatch[1];
  return packName;
};

export const getDBPackedFilePath = (dbTableSelection: DBTableSelection) => {
  // A selection made before spare folders existed has no dbFolder and means the live table.
  const dbFolder = dbTableSelection.dbFolder || DEFAULT_DB_TABLE_ROOT;
  return `${dbFolder}\\${dbTableSelection.dbName}\\${dbTableSelection.dbSubname}`;
};

export const tableNameWithDBPrefix = (tableName: string) =>
  (tableName.startsWith("db") && tableName) || `db\\${tableName}`;

export const getDBVersion = (packFile: PackedFile, DBNameToDBVersions: Record<string, DBVersion[]>) => {
  // console.log("GETTING DB VERSION FOR", packFile.name);
  const dbName = getDBName(packFile);
  // console.log("GETTING DB VERSION, DBNAME IS", dbName);
  if (!dbName) return;
  const dbversions = DBNameToDBVersions[dbName];
  // console.log("GETTING DB VERSIONS, dbversions IS", dbversions);
  if (!dbversions) return;

  const dbversion =
    dbversions.find((dbversion) => dbversion.version == packFile.version) ||
    dbversions.find((dbversion) => dbversion.version == 0) ||
    dbversions[0];
  // console.log("GETTING DB VERSION from dbversions, dbversion IS", dbversion);
  if (!dbversion) return;
  // console.log("GETTING DB VERSION packFile version IS", packFile.version);
  if (packFile.version == null) return dbversion;
  if (dbversion.version < packFile.version) return;
  return dbversion;
};

export const currentPackData = {} as { data?: Pack };
