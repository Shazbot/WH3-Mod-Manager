import { DBFieldName, DBFileName, DBVersion, Pack } from "@/src/packFileTypes";

export const packDataStore = {} as Record<string, Pack>;
export const doneRequests = {} as Record<string, string[]>;
export const dataFromBackend = { DBNameToDBVersions: {}, DBFieldsThatReference: {} } as {
  DBNameToDBVersions: Record<string, DBVersion[]>;
  DBFieldsThatReference: Record<DBFileName, Record<DBFieldName, string[]>>;
  DBFieldsReferencedBy: Record<string, Record<string, string[][]>>;
  referencedColums: Record<string, string[]>; // table name to columns that are referenced from another table, if it's only one consider it that table's key
};
