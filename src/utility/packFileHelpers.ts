import { Pack, PackedFile } from "../packFileTypes";

export const getDBName = (packFile: PackedFile) => {
  const dbNameMatch = packFile.name.match(/^db\\(.*?)\\/);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

export const getDBSubname = (packFile: PackedFile) => {
  const dbNameMatch = packFile.name.match(/^db\\.*?\\(.*?)$/);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

export const getDBNameFromString = (packFileName: string) => {
  const dbNameMatch = packFileName.match(/^db\\(.*?)\\/);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

export const getDBSubnameFromString = (packFileName: string) => {
  const dbNameMatch = packFileName.match(/^db\\.*?\\(.*?)$/);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

export const getPackNameFromPath = (packPath: string) => {
  const packNameMatch = packPath.match(/^.*\\(.*?)$/);
  if (packNameMatch == null) return;
  const packName = packNameMatch[1];
  return packName;
};

export const currentPackData = {} as { data?: Pack };
