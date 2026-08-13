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

export const isLocPackedFilePath = (packFileName: string) => packFileName.toLowerCase().endsWith(".loc");

/**
 * Loc files are DB tables too - a fixed schema rather than one looked up by table name - so the
 * viewer lists them beside the rest instead of stranding them among the raw files.
 *
 * A loc has no table folder of its own, so its own folder plays that part: `text\db\mymod.loc` reads
 * as folder `text`, table `db`, file `mymod.loc`. That round-trips through getDBPackedFilePath and
 * groups in the tree with no special casing anywhere else.
 */
const parseLocPath = (packFileName: string): ParsedDBTablePath | undefined => {
  if (!isLocPackedFilePath(packFileName)) return undefined;

  const lastSeparator = packFileName.lastIndexOf("\\");
  if (lastSeparator < 1) return undefined;

  const previousSeparator = packFileName.lastIndexOf("\\", lastSeparator - 1);
  return {
    dbFolder: previousSeparator < 0 ? "" : packFileName.slice(0, previousSeparator),
    dbName: packFileName.slice(previousSeparator + 1, lastSeparator),
    dbSubname: packFileName.slice(lastSeparator + 1),
  };
};

/** Table files the viewer can show, including the spare-copy folders and loc files. */
export const parseDBTablePath = (packFileName: string) =>
  parseDBTablePathInRoots(packFileName, DB_TABLE_ROOTS) ?? parseLocPath(packFileName);

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
  // Absent means a selection made before spare folders existed, which means the live table. An empty
  // string is different: a loc sitting one folder deep, whose table folder is the pack root's child.
  const dbFolder = dbTableSelection.dbFolder ?? DEFAULT_DB_TABLE_ROOT;
  const tablePath = `${dbTableSelection.dbName}\\${dbTableSelection.dbSubname}`;
  return dbFolder ? `${dbFolder}\\${tablePath}` : tablePath;
};

export const tableNameWithDBPrefix = (tableName: string) =>
  (tableName.startsWith("db") && tableName) || `db\\${tableName}`;

/**
 * The DBVersion a packed file's rows were actually parsed with.
 *
 * Deliberately not `getDBVersion` below. That one ends its chain with `dbversions[0]`, falling back to
 * the newest layout when nothing matches, where the parser instead skips the table. Anything
 * reconstructing parsed rows - the vanilla DB cache, most of all - has to make the same choice the
 * parse made, or it would decode against a field list the bytes were never read with.
 */
export const resolveParsedDBVersion = (
  packedFileVersion: number | undefined,
  dbversions: DBVersion[] | undefined,
): DBVersion | undefined => {
  if (!dbversions) return undefined;

  const dbversion =
    dbversions.find((candidate) => candidate.version == packedFileVersion) ||
    dbversions.find((candidate) => candidate.version == 0);
  if (!dbversion) return undefined;
  if (packedFileVersion != null && dbversion.version < packedFileVersion) return undefined;
  return dbversion;
};

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

/**
 * Drops the parsed rows of tables a feature has finished with.
 *
 * Packs stay in `appData.packsData` for the session, and their parsed tables are by far the most
 * expensive thing they carry: a cell is an object wrapping an array of objects, and once amended
 * with its name and resolved key it measures around 250 bytes, so the ~24k row skill node table
 * alone runs to tens of megabytes. Features that distil those rows into a model of their own and
 * cache that model never read the rows again, and the vanilla db cache refills a dropped table in
 * milliseconds, so holding them for the rest of the session buys nothing.
 *
 * `readTables` is narrowed to match. Readers skip a pack that already claims to have parsed what
 * they want, so a claim left standing over dropped rows would have them silently see no rows at all
 * rather than read them again. A pack claiming "all" is left alone: nothing here can narrow that
 * claim truthfully.
 */
export const releaseParsedTables = (packs: readonly Pack[], tablePathPrefixes: readonly string[]) => {
  if (tablePathPrefixes.length === 0) return;
  for (const pack of packs) {
    if (pack.readTables === "all") continue;
    let released = 0;
    for (const packedFile of pack.packedFiles) {
      if (!packedFile.schemaFields) continue;
      if (!tablePathPrefixes.some((prefix) => packedFile.name.startsWith(prefix))) continue;
      packedFile.schemaFields = undefined;
      released += 1;
    }
    // Either direction of the prefix relation counts as a match: an entry is sometimes a whole
    // packed file path rather than the table prefix, and forgetting an entry whose rows are still
    // parsed only costs a re-read, where keeping one whose rows are gone loses them silently.
    pack.readTables = pack.readTables.filter(
      (readTable) =>
        !tablePathPrefixes.some((prefix) => readTable.startsWith(prefix) || prefix.startsWith(readTable)),
    );
    if (released > 0) {
      console.log("releaseParsedTables: dropped", released, "parsed tables from", pack.name);
    }
  }
};
