export interface PackedFile {
  name: string;
  file_size: number;
  start_pos: number;
  is_compressed: number;
  schemaFields: SchemaField[];
  version: number | undefined;
  guid: string | undefined;
}

export interface SchemaField {
  name: string;
  type: SCHEMA_FIELD_TYPE | "Buffer";
  fields: Field[];
  isKey: boolean;
  resolvedKeyValue?: string;
}

export type SCHEMA_FIELD_TYPE =
  | "Boolean"
  | "OptionalStringU8"
  | "StringU8"
  | "F32"
  | "I32"
  | "I64"
  | "F64"
  | "ColourRGB"
  | "StringU16";
export type FIELD_TYPE = "Int16" | "Int8" | "UInt8" | "String" | "Buffer" | "F32" | "I32" | "I64" | "F64";
export type FIELD_VALUE = number | string | Buffer | undefined;

export interface Field {
  type: FIELD_TYPE;
  val: FIELD_VALUE;
}

export interface Pack {
  name: string;
  path: string;
  packedFiles: PackedFile[];
}

export async function getCompatData(packsData: Pack[]): Promise<PackCollisions> {
  // return [findPackFileCollisions(packsData), findPackTableCollisions(packsData)];
  return {
    packFileCollisions: findPackFileCollisions(packsData),
    packTableCollisions: findPackTableCollisions(packsData),
  };
  // return [findPackFileCollisions(packsData), []];
  // return [[], []];
}

export interface PackFileCollision {
  firstPackName: string;
  secondPackName: string;
  fileName: string;
}

export interface PackTableCollision extends PackFileCollision {
  secondFileName: string;
  key: string;
  value: string;
}

function findPackTableCollisions(packsData: Pack[]) {
  const packTableCollisions: PackTableCollision[] = [];
  console.time("compareKeys");
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    for (let j = i + 1; j < packsData.length; j++) {
      const packTwo = packsData[j];
      // for (const pack of packsData) {
      // for (const packTwo of packsData) {
      if (pack === packTwo) continue;
      if (pack.name === packTwo.name) continue;
      if (pack.name === "data.pack" || packTwo.name === "data.pack") continue;

      for (const packFile of pack.packedFiles) {
        if (packFile.name === "settings.rpfm_reserved") continue;
        for (const packTwoFile of packTwo.packedFiles) {
          if (packTwoFile.name === "settings.rpfm_reserved") continue;

          const dbNameMatch1 = packFile.name.match(/db\\(.*?)\\/);
          if (dbNameMatch1 == null) continue;
          const dbName1 = dbNameMatch1[1];
          if (dbName1 == null) continue;

          const dbNameMatch2 = packTwoFile.name.match(/db\\(.*?)\\/);
          if (dbNameMatch2 == null) continue;
          const dbName2 = dbNameMatch2[1];
          if (dbName2 == null) continue;

          try {
            if (dbName1 === dbName2) {
              // console.log(dbName1);
              const v1Keys = packFile.schemaFields.filter((field) => field.isKey);
              if (v1Keys.length != 1) continue;

              const v1 = v1Keys[0].resolvedKeyValue;
              const v2 = packTwoFile.schemaFields.find((field) => field.isKey).resolvedKeyValue;

              // console.log(v1);
              // console.log(v2);

              if (v1 === v2) {
                packTableCollisions.push({
                  firstPackName: pack.name,
                  secondPackName: packTwo.name,
                  fileName: packFile.name,
                  secondFileName: packTwoFile.name,
                  key: packFile.schemaFields.find((field) => field.isKey).name,
                  value: v1,
                });
                console.log("FOUND CONFLICT");
                console.log(
                  pack.name,
                  packTwo.name,
                  packFile.name,
                  packTwoFile.name,
                  packFile.schemaFields.find((field) => field.isKey).name,
                  v1
                );
              }
            }
          } catch (e) {
            console.log(e);
          }
        }
      }
    }
  }

  console.timeEnd("compareKeys");

  return packTableCollisions;
}

function findPackFileCollisions(packsData: Pack[]) {
  const conflicts: PackFileCollision[] = [];
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    for (let j = i + 1; j < packsData.length; j++) {
      const packTwo = packsData[j];
      // for (const pack of packsData) {
      // for (const packTwo of packsData) {
      if (pack === packTwo) continue;
      if (pack.name === packTwo.name) continue;
      if (pack.name === "data.pack" || packTwo.name === "data.pack") continue;

      for (const packFile of pack.packedFiles) {
        if (packFile.name === "settings.rpfm_reserved") continue;
        for (const packTwoFile of packTwo.packedFiles) {
          if (packTwoFile.name === "settings.rpfm_reserved") continue;
          if (packFile.name === packTwoFile.name) {
            conflicts.push({
              firstPackName: pack.name,
              secondPackName: packTwo.name,
              fileName: packFile.name,
            });
            // console.log("FOUND CONFLICT");
            // console.log(pack.name, packTwo.name, packFile.name);
          }
        }
      }
    }
  }
  return conflicts;
}
