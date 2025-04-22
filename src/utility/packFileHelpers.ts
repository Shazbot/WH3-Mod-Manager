import { DBVersion, Pack, PackedFile } from "../packFileTypes";

const matchDBFileRegex = /^db\\(.*?)\\/;
const matchDBFileSubnameRegex = /^db\\.*?\\(.*?)$/;
const matchPackNameFromPathRegex = /^.*\\(.*?)$/;

export const getDBName = (packFile: PackedFile) => {
  const dbNameMatch = packFile.name.match(matchDBFileRegex);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

export const getDBSubname = (packFile: PackedFile) => {
  const dbNameMatch = packFile.name.match(matchDBFileSubnameRegex);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

export const getDBNameFromString = (packFileName: string) => {
  const dbNameMatch = packFileName.match(matchDBFileRegex);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

export const getDBSubnameFromString = (packFileName: string) => {
  const dbNameMatch = packFileName.match(matchDBFileSubnameRegex);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

export const getPackNameFromPath = (packPath: string) => {
  const packNameMatch = packPath.match(matchPackNameFromPathRegex);
  if (packNameMatch == null) return;
  const packName = packNameMatch[1];
  return packName;
};

export const getDBPackedFilePath = (dbTableSelection: DBTableSelection) => {
  return `db\\${dbTableSelection.dbName}\\${dbTableSelection.dbSubname}`;
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
