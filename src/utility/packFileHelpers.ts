import { Pack, PackedFile } from "../packFileTypes";

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

export const currentPackData = {} as { data?: Pack };
