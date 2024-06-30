import appData from "./appData";
import { gameToDBFieldsThatReference } from "./schema";

export const resolveTable = (dbName: string) => {
  const resolveTableIter = (dbName: string, acc: string[]) => {
    const dbFieldsThatReference = gameToDBFieldsThatReference[appData.currentGame];
    if (!dbFieldsThatReference[dbName]) return acc;
    for (const dbTableNameAndKey of Object.values(dbFieldsThatReference[dbName])) {
      const newTable = dbTableNameAndKey[0];
      if (acc.includes(newTable)) continue;
      acc.push(newTable);
      resolveTableIter(newTable, acc);
    }
    return acc;
  };
  return resolveTableIter(dbName, [dbName]);
};
