import BinaryFile from "binary-file";
import {
  Field,
  FIELD_TYPE,
  FIELD_VALUE,
  Pack,
  PackedFile,
  PackHeader,
  SchemaField,
  SCHEMA_FIELD_TYPE,
  AmendedSchemaField,
  NewPackedFile,
  DBVersion,
  LocVersion,
  LocFields,
} from "./packFileTypes";
import clone from "just-clone";
import { emptyMovie, autoStartCustomBattleScript } from "./helperPackData";
import { DBNameToDBVersions } from "./schema";
import * as nodePath from "path";
import appData from "./appData";
import { format } from "date-fns";
import { Blob } from "buffer";
import * as fsExtra from "fs-extra";
import { Worker } from "node:worker_threads";
import { compareModNames } from "./modSortingHelpers";
import { getDBName } from "./utility/packFileHelpers";
import getPackTableData, {
  isSchemaFieldNumber,
  isSchemaFieldNumberInteger,
} from "./utility/frontend/packDataHandling";
import deepClone from "clone-deep";
import { gameToIntroMovies } from "./supportedGames";
import { getSavesFolderPath } from "./gameSaves";
import * as fs from "fs";
import { collator } from "./utility/packFileSorting";
import bs from "binary-search";
import { decompress } from "@mongodb-js/zstd";
import { readModsByPath } from "./ipcMainListeners";

// console.log(DBNameToDBVersions.land_units_officers_tables);

const string_schema = `{
    "units_custom_battle_permissions_tables": {
      "10": [
        ["faction", "StringU8", "1"],
        ["general_unit", "Boolean", "2"],
        ["unit", "StringU8", "0"],
        ["siege_unit_attacker", "Boolean", "3"],
        ["siege_unit_defender", "Boolean", "4"],
        ["general_portrait", "OptionalStringU8", "5"],
        ["general_uniform", "OptionalStringU8", "6"],
        ["set_piece_character", "OptionalStringU8", "7"],
        ["campaign_exclusive", "Boolean", "8"],
        ["armory_item_set", "OptionalStringU8", "9"]
      ]
    }}`;

const object_schema = JSON.parse(string_schema);
const latest_version = Object.keys(object_schema.units_custom_battle_permissions_tables).sort()[0];
const ver_schema = object_schema.units_custom_battle_permissions_tables[latest_version];

function getTypeSize(type: FIELD_TYPE, val: FIELD_VALUE): number {
  switch (type) {
    case "Int8":
    case "UInt8":
      {
        return 1;
      }
      break;
    case "Int16":
      {
        return 2;
      }
      break;
    case "String":
      {
        return (val as string).length;
      }
      break;
    case "F32":
      {
        return 4;
      }
      break;
    case "I32":
      {
        return 4;
      }
      break;
    case "I16":
      {
        return 2;
      }
      break;
    case "I64":
      {
        return 8;
      }
      break;
    case "F64":
      {
        return 8;
      }
      break;
    default:
      throw new Error("UNKNOWN TYPE_FIELD");
      break;
  }
}

function getDataSize(data: SchemaField[]): number {
  let size = 0;
  for (const field of data) {
    for (const value of field.fields) {
      size += getTypeSize(value.type, value.val);
    }
  }
  return size;
}

export async function typeToBuffer(type: SCHEMA_FIELD_TYPE, value: PlainPackDataTypes): Promise<Buffer> {
  switch (type) {
    case "Boolean":
      {
        // console.log('boolean');
        const view = new DataView(new ArrayBuffer(1));
        view.setUint8(0, Number(value));
        return Buffer.from(view.buffer);
      }
      break;
    case "ColourRGB":
      {
        const view = new DataView(new ArrayBuffer(4));
        view.setInt32(0, Number(value));
        return Buffer.from(view.buffer);
      }
      break;
    case "StringU16":
      {
        const len = (value as string).length;
        const strLenView = new DataView(new ArrayBuffer(2));
        strLenView.setInt16(0, Number(len), true);
        const strLenBuffer = Buffer.from(strLenView.buffer);

        return Buffer.concat([strLenBuffer, Buffer.from(value as string, "utf16le")]);
      }
      break;
    case "StringU8":
      {
        const len = (value as string).length;
        const strLenView = new DataView(new ArrayBuffer(2));
        strLenView.setInt16(0, Number(len), true);
        const strLenBuffer = Buffer.from(strLenView.buffer);

        return Buffer.concat([strLenBuffer, Buffer.from(value as string, "ascii")]);
      }
      break;
    case "OptionalStringU8":
      {
        const strLenView = new DataView(new ArrayBuffer(1));
        const doesExist = value && value != "";
        strLenView.setUint8(0, doesExist ? 1 : 0);
        const itExistsBuffer = Buffer.from(strLenView.buffer);

        if (itExistsBuffer && doesExist) {
          const len = (value as string).length;
          const strLenView = new DataView(new ArrayBuffer(2));
          strLenView.setInt16(0, Number(len), true);
          const strLenBuffer = Buffer.from(strLenView.buffer);

          return Buffer.concat([itExistsBuffer, strLenBuffer, Buffer.from(value as string, "ascii")]);
        }
        return itExistsBuffer;
      }
      break;
    case "F32":
      {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, Number(value), true);
        return Buffer.from(view.buffer);
      }
      break;
    case "I32":
      {
        const view = new DataView(new ArrayBuffer(4));
        view.setInt32(0, Number(value), true);
        return Buffer.from(view.buffer);
      }
      break;
    case "I16":
      {
        const view = new DataView(new ArrayBuffer(2));
        view.setInt16(0, Number(value), true);
        return Buffer.from(view.buffer);
      }
      break;
    case "F64":
      {
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, Number(value), true);
        return Buffer.from(view.buffer);
      }
      break;
    case "I64":
      {
        const view = new DataView(new ArrayBuffer(8));
        view.setBigInt64(0, BigInt(value), true);
        return Buffer.from(view.buffer);
      }
      break;
    default:
      console.log("NO WAY TO RESOLVE " + type);
      throw new Error("NO WAY TO RESOLVE " + type);
      break;
  }
}

async function parseType(
  file: BinaryFile,
  type: SCHEMA_FIELD_TYPE,
  existingFields?: Field[]
): Promise<Field[]> {
  const fields: Field[] = existingFields || [];
  switch (type) {
    case "Boolean":
      {
        // console.log('boolean');
        const val = await file.readUInt8();
        fields.push({ type: "UInt8", val });
        return fields;
        // await outFile.writeInt8(newVal !== undefined ? newVal : val);
      }
      break;
    case "ColourRGB":
      {
        const val = await file.readInt32();
        fields.push({ type: "I32", val });
        return fields;
      }
      break;
    case "StringU16":
      {
        try {
          const length = await file.readInt16();
          const val = (await file.read(length * 2)).toString("utf8");
          fields.push({ type: "String", val });
          return fields;
        } catch (e) {
          console.log(e);
          throw e;
        }
      }
      break;
    case "StringU8":
      {
        const length = await file.readUInt16();
        const val = await file.readString(length);

        // console.log('string');
        // console.log('position is ' + file.tell());
        // const val = await read_string(file);

        // console.log(length);
        // console.log(val);
        fields.push({ type: "Int16", val: length });
        fields.push({ type: "String", val });
        return fields;
        // await outFile.writeString(val + '\0');
        // await outFile.writeInt16(length);
        // await outFile.writeString(val);
      }
      break;
    case "OptionalStringU8":
      {
        const doesExist = await file.readUInt8();
        fields.push({ type: "Int8", val: doesExist });
        if (doesExist === 1) return await parseType(file, "StringU8", fields);

        return fields;
      }
      break;
    case "F32":
      {
        const doesExist = await file.readFloat();
        fields.push({ type: "F32", val: doesExist });
        return fields;
      }
      break;
    case "I32":
      {
        const doesExist = await file.readInt32();
        fields.push({ type: "I32", val: doesExist });
        return fields;
      }
      break;
    case "I16":
      {
        const doesExist = await file.readInt16();
        fields.push({ type: "I16", val: doesExist });
        return fields;
      }
      break;
    case "F64":
      {
        const doesExist = await file.readDouble();
        fields.push({ type: "F64", val: doesExist });
        return fields;
      }
      break;
    case "I64":
      {
        const doesExist = await file.readInt64();
        fields.push({ type: "I64", val: doesExist });
        return fields;
      }
      break;
    default:
      console.log("NO WAY TO RESOLVE " + type);
      throw new Error("NO WAY TO RESOLVE " + type);
      break;
  }
}

function parseTypeBuffer(
  buffer: Buffer,
  pos: number,
  type: SCHEMA_FIELD_TYPE,
  existingFields?: Field[]
): [Field[], number] {
  const fields: Field[] = existingFields || [];
  switch (type) {
    case "Boolean":
      {
        // console.log('boolean');
        const val = buffer.readUInt8(pos); //await file.readUInt8();
        pos += 1;
        fields.push({ type: "UInt8", val });
        return [fields, pos];
        // await outFile.writeInt8(newVal !== undefined ? newVal : val);
      }
      break;
    case "ColourRGB":
      {
        const val = buffer.readInt32LE(pos); // await file.readInt32();
        pos += 4;
        fields.push({ type: "I32", val });
        return [fields, pos];
      }
      break;
    case "StringU16":
      {
        try {
          const length = buffer.readInt16LE(pos); //await file.readInt16();
          pos += 2;
          const val = buffer.subarray(pos, pos + length * 2).toString("utf16le"); //(await file.read(length * 2)).toString("utf8");
          pos += length * 2;
          fields.push({ type: "String", val });
          return [fields, pos];
        } catch (e) {
          console.log(e);
          throw e;
        }
      }
      break;
    case "StringU8":
      {
        const length = buffer.readUint16LE(pos); //await file.readUInt16();
        // console.log("stringU8 length is", length);
        pos += 2;
        const val = buffer.subarray(pos, pos + length).toString("ascii"); //await file.readString(length);
        pos += length;
        // console.log("val is", val);

        // console.log('string');
        // console.log('position is ' + file.tell());
        // const val = await read_string(file);

        // console.log(length);
        // console.log(val);
        fields.push({ type: "Int16", val: length });
        fields.push({ type: "String", val });
        return [fields, pos];
        // await outFile.writeString(val + '\0');
        // await outFile.writeInt16(length);
        // await outFile.writeString(val);
      }
      break;
    case "OptionalStringU8":
      {
        const doesExist = buffer.readUint8(pos); // await file.readUInt8();
        pos += 1;
        fields.push({ type: "Int8", val: doesExist });
        if (doesExist === 1) {
          return parseTypeBuffer(buffer, pos, "StringU8", fields);
        }

        return [fields, pos];
      }
      break;
    case "F32":
      {
        const doesExist = buffer.readFloatLE(pos); //await file.readFloat();
        pos += 4;
        fields.push({ type: "F32", val: doesExist });
        return [fields, pos];
      }
      break;
    case "I32":
      {
        const doesExist = buffer.readInt32LE(pos); //await file.readInt32();
        pos += 4;
        fields.push({ type: "I32", val: doesExist });
        return [fields, pos];
      }
      break;
    case "I16":
      {
        const doesExist = buffer.readInt16LE(pos); //await file.readInt32();
        pos += 2;
        fields.push({ type: "I16", val: doesExist });
        return [fields, pos];
      }
      break;
    case "F64":
      {
        const doesExist = buffer.readDoubleLE(pos); //await file.readDouble();
        pos += 8;
        fields.push({ type: "F64", val: doesExist });
        return [fields, pos];
      }
      break;
    case "I64":
      {
        const doesExist = Number(buffer.readBigInt64LE(pos)); //await file.readInt64();
        pos += 8;
        fields.push({ type: "I64", val: doesExist });
        return [fields, pos];
      }
      break;
    default:
      throw new Error("NO WAY TO RESOLVE " + type);
      break;
  }
}

export function getFieldSize(value: string, type: SCHEMA_FIELD_TYPE): number {
  switch (type) {
    case "Boolean":
      {
        return 1;
      }
      break;
    case "ColourRGB":
      {
        return 4;
      }
      break;
    case "StringU16":
      {
        return (value as string).length * 2 + 2;
      }
      break;
    case "StringU8":
      {
        return (value as string).length + 2;
      }
      break;
    case "OptionalStringU8":
      {
        const stringVal = value as string;
        if (stringVal == "") return 1;

        return stringVal.length + 2 + 1;
      }
      break;
    case "F32":
      {
        return 4;
      }
      break;
    case "I32":
      {
        return 4;
      }
      break;
    case "I16":
      {
        return 2;
      }
      break;
    case "F64":
      {
        return 8;
      }
      break;
    case "I64":
      {
        return 8;
      }
      break;
    default:
      throw new Error("NO WAY TO RESOLVE " + type);
      break;
  }
}

const getGUID = () => {
  const genRanHex = (size: number) =>
    [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  return [genRanHex(8), genRanHex(4), genRanHex(4), genRanHex(4), genRanHex(12)].join("-");
};

const createBattlePermissionsData = (packsData: Pack[], pack_files: PackedFile[], enabledMods: Mod[]) => {
  // console.log(packsData);
  // console.log(packsData.filter((packData) => packData == null));
  const dataDBPack = packsData.find((packData) => packData.name === "db.pack");
  if (!dataDBPack) return;
  const vanillaBattlePersmission = dataDBPack.packedFiles.find((pf) =>
    pf.name.startsWith("db\\units_custom_battle_permissions_tables\\")
  );
  if (!vanillaBattlePersmission) return;

  const vanillaBattlePersmissionVersion = vanillaBattlePersmission.version;

  const battlePermissions = clone(
    packsData
      .filter((packData) => enabledMods.find((enabledMod) => enabledMod.path === packData.path))
      .map((packData) => packData.packedFiles)
      .map((packedFiles) =>
        packedFiles.filter(
          (packedFile) =>
            packedFile.name.startsWith("db\\units_custom_battle_permissions_tables\\") &&
            packedFile.version == vanillaBattlePersmissionVersion
        )
      )
      .reduce((previous, packedFile) => previous.concat(packedFile), [])
  );

  for (const packFile of battlePermissions) {
    const newFields: SchemaField[] = [];
    if (!packFile.schemaFields) continue;
    if (getDBName(packFile) === "units_custom_battle_permissions_tables") {
      const dbVersion = getDBVersion(packFile);
      if (dbVersion == null) continue;
      const general_unit_index = dbVersion.fields.findIndex((field) => field.name == "general_unit");
      const dbVersionNumFields = dbVersion.fields.length;

      for (let i = 0; i < packFile.schemaFields.length; i++) {
        const field = packFile.schemaFields[i];
        if (
          general_unit_index != null &&
          dbVersionNumFields != null &&
          i % dbVersionNumFields == general_unit_index
        ) {
          // console.log("FOUND GENERAL UNIT INDEX");
          // console.log(field.name);

          if (field.fields[0].val == 1) {
            for (let j = 0; j < dbVersion.fields.length; j++) {
              const fieldToAdd = clone(packFile.schemaFields[i - general_unit_index + j]);
              if (j == general_unit_index) fieldToAdd.fields[0].val = 0;
              newFields.push(fieldToAdd);
            }
          } else {
            field.fields[0].val = 1;
          }
        }
      }

      packFile.schemaFields.push(...newFields);
    }
  }

  const battlePermissionsSchemaFields = battlePermissions.reduce((previous, packedFile) => {
    if (packedFile.version != vanillaBattlePersmissionVersion) return previous;
    return (packedFile.schemaFields && previous.concat(packedFile.schemaFields)) || previous;
  }, [] as SchemaField[]);
  pack_files.push({
    name: `db\\units_custom_battle_permissions_tables\\!!!!whmm_out`,
    file_size: getDataSize(battlePermissionsSchemaFields) + 91,
    start_pos: 0,
    // is_compressed: 0,
    schemaFields: battlePermissionsSchemaFields,
    version: 11,
    guid: "129d32d8-3563-4d4f-8e19-a815e834e456",
  });
};

const createIntroMoviesData = (pack_files: PackedFile[]) => {
  for (const moviePath of gameToIntroMovies[appData.currentGame]) {
    pack_files.push({
      name: moviePath,
      file_size: emptyMovie.length,
      start_pos: 0,
      // is_compressed: 0,
      schemaFields: [{ type: "Buffer", fields: [{ type: "Buffer", val: emptyMovie }] }],
    } as PackedFile);
  }
};

export const getDBVersionByTableName = (packFile: PackedFile, dbName: string) => {
  if (packFile.name.endsWith(".loc")) return LocVersion;

  const dbversions = DBNameToDBVersions[appData.currentGame][dbName];
  // console.log("GETTING DB VERSIONS, dbversions IS", dbversions);
  if (!dbversions) return;

  // console.log("getting db version for", dbName, "version in file is:", packFile.version);
  const dbversion =
    dbversions.find((dbversion) => dbversion.version == packFile.version) ||
    dbversions.find((dbversion) => dbversion.version == 0) ||
    dbversions[0];
  // console.log("GETTING DB VERSION from dbversions, dbversion IS", dbversion);
  if (!dbversion) {
    console.log("FAILED getting db version for", dbName, "version in file is:", packFile.version);
    return;
  }
  // console.log("GETTING DB VERSION packFile version IS", packFile.version);
  if (packFile.version == null) return dbversion;
  if (dbversion.version < packFile.version) return;
  return dbversion;
};

export const getDBVersion = (packFile: PackedFile) => {
  if (packFile.name.endsWith(".loc")) return LocVersion;

  // console.log("GETTING DB VERSION FOR", packFile.name);
  const dbName = getDBName(packFile);
  // console.log("GETTING DB VERSION, DBNAME IS", dbName);
  if (!dbName) return;

  return getDBVersionByTableName(packFile, dbName);
};

export const chunkSchemaIntoRows = (schemaFields: SchemaField[], dbversion: DBVersion) => {
  return (
    schemaFields?.reduce<SchemaField[][]>((resultArray, item, index) => {
      const chunkIndex = Math.floor(index / dbversion.fields.length);

      if (!resultArray[chunkIndex]) {
        resultArray[chunkIndex] = []; // start a new chunk
      }

      resultArray[chunkIndex].push(item as SchemaField);

      return resultArray;
    }, []) ?? []
  );
};

export const resolveKeyValue = (field_type: SCHEMA_FIELD_TYPE, fields: Field[]) => {
  if (isSchemaFieldNumber(field_type)) {
    return isSchemaFieldNumberInteger(field_type)
      ? (fields[0].val as number).toFixed(0).toString()
      : (fields[0].val as number).toFixed(3).toString();
  }
  if (field_type == "OptionalStringU8" || field_type == "StringU8")
    if (fields[0] && fields[0].val) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        (fields[2] && fields[2].val!.toString()) ||
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        (fields[1] && fields[1].val!.toString()) ||
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        fields[0].val!.toString()
      );
    } else {
      return "";
    }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return (fields[1] && fields[1].val!.toString()) || fields[0].val!.toString();
};

export const amendSchemaField = (schemaFields: SchemaField[], dbVersion: DBVersion) => {
  const amendedSchemaFields: AmendedSchemaField[] = [];

  const chunkedSchemaIntoRows = chunkSchemaIntoRows(schemaFields || [], dbVersion);

  // console.log("chunked into ", chunkedSchemaIntoRows.length);
  // console.log("num fields in row is ", dbversion.fields.length);
  // console.log("db types are ", dbversion.fields.map((field) => field.name).join(", "));
  // console.log("with num chunks of ", chunkedSchemaIntoRows.map((row) => row.length).join(","));

  for (const chunkedSchemaIntoRow of chunkedSchemaIntoRows) {
    for (const dbFieldsIndex of dbVersion.fields.keys()) {
      const { name, field_type } = dbVersion.fields[dbFieldsIndex];
      const fields = chunkedSchemaIntoRow[dbFieldsIndex].fields;
      if (!fields) {
        console.log("MISSING FIELD ", name);
      }
      const resolvedKeyValue = resolveKeyValue(field_type, fields);

      const newAmendedField = {
        name,
        resolvedKeyValue,
        ...chunkedSchemaIntoRow[dbFieldsIndex],
      } as AmendedSchemaField;

      amendedSchemaFields.push(newAmendedField);

      // if (chunkedSchemaIntoRow == chunkedSchemaIntoRows[0]) {
      //   console.log("AMENDING ", name, resolvedKeyValue);
      // }
    }
  }

  return amendedSchemaFields;
};

export const getPacksTableData = (packs: Pack[], tables: (DBTable | string)[], getLocs?: boolean) => {
  console.log(
    "getPacksTableData:",
    packs.map((pack) => pack.name),
    "num tables:",
    tables.length
  );
  // console.log(
  //   "getPacksTableData:",
  //   packs.map((pack) => pack.name),
  //   tables
  // );
  const results: PackViewData[] = [];
  for (const pack of packs) {
    const locFiles: Record<string, PackedFile> = {};
    if (getLocs) {
      for (const packedFile of pack.packedFiles) {
        if (packedFile.name.endsWith(".loc")) {
          // console.log("found loc pack file", packedFile.name);
          locFiles[packedFile.name] = packedFile;
        }
      }
    }

    const result = { packName: pack.name, packPath: pack.path, tables } as PackViewData;
    result.packedFiles = result.packedFiles || {};

    let packedFiles: PackedFile[] = [];

    if (getLocs) {
      packedFiles = packedFiles.concat(Object.values(locFiles));
    }

    for (const table of tables) {
      if (typeof table === "string") {
        packedFiles = pack.packedFiles.filter((packedFile) => packedFile.name.startsWith(table));
      } else {
        packedFiles = pack.packedFiles.filter((packedFile) =>
          packedFile.name.startsWith(`db\\${table.dbName}\\${table.dbSubname}`)
        );
      }

      // console.log("getpackviewdata packedFiles:", packedFiles);
      for (const packedFile of packedFiles) {
        const amendedSchemaFields: AmendedSchemaField[] = [];
        const dbversion = locFiles[packedFile.name] ? LocVersion : getDBVersion(packedFile);
        if (!dbversion) {
          console.log("no dbversion for", packedFile.name);
          return;
        }

        const chunkedSchemaIntoRows = chunkSchemaIntoRows(packedFile.schemaFields || [], dbversion);

        // console.log("chunked into ", chunkedSchemaIntoRows.length);
        // console.log("num fields in row is ", dbversion.fields.length);
        // console.log("db types are ", dbversion.fields.map((field) => field.name).join(", "));
        // console.log("with num chunks of ", chunkedSchemaIntoRows.map((row) => row.length).join(","));

        for (const chunkedSchemaIntoRow of chunkedSchemaIntoRows) {
          for (const dbFieldsIndex of dbversion.fields.keys()) {
            const { name, field_type } = dbversion.fields[dbFieldsIndex];
            const fields = chunkedSchemaIntoRow[dbFieldsIndex].fields;
            if (!fields) {
              console.log("MISSING FIELD ", name);
            }
            const resolvedKeyValue = resolveKeyValue(field_type, fields);

            amendedSchemaFields.push({ name, resolvedKeyValue, ...chunkedSchemaIntoRow[dbFieldsIndex] });

            // if (chunkedSchemaIntoRow == chunkedSchemaIntoRows[0]) {
            //   console.log("AMENDING ", name, resolvedKeyValue);
            // }
          }
        }
        packedFile.schemaFields = amendedSchemaFields;
        if (typeof table === "string" && table.includes("character_skill_node_sets")) {
          console.log("FOUND character_skill_node_sets_tables", pack.name, packedFile.name);
        }
        packedFile.tableSchema = dbversion;
        result.packedFiles[packedFile.name] = packedFile;
      }
    }
    results.push(result);
  }

  return results;
};

export const getPackViewData = (pack: Pack, table?: DBTable | string, getLocs?: boolean) => {
  console.log("getPackViewData:", pack.name, table);
  const tables = pack.packedFiles.map((packedFile) => packedFile.name);
  const locFiles: Record<string, PackedFile> = {};
  if (getLocs) {
    for (const packedFile of pack.packedFiles) {
      if (packedFile.name.endsWith(".loc")) {
        // console.log("found loc pack file", packedFile.name);
        locFiles[packedFile.name] = packedFile;
      }
    }
  }

  const result = { packName: pack.name, packPath: pack.path, tables } as PackViewData;
  result.packedFiles = result.packedFiles || {};
  let packedFiles: PackedFile[] = [];
  if (table) {
    if (typeof table === "string") {
      packedFiles = pack.packedFiles.filter((packedFile) => packedFile.name == table);
    } else {
      packedFiles = pack.packedFiles.filter((packedFile) =>
        packedFile.name.startsWith(`db\\${table.dbName}\\${table.dbSubname}`)
      );
    }
  }
  if (getLocs) {
    packedFiles = packedFiles.concat(Object.values(locFiles));
  }
  // console.log("getpackviewdata packedFiles:", packedFiles);
  for (const packedFile of packedFiles) {
    const amendedSchemaFields: AmendedSchemaField[] = [];
    const dbversion = locFiles[packedFile.name] ? LocVersion : getDBVersion(packedFile);
    if (!dbversion) {
      console.log("no dbversion for", packedFile.name);
      return;
    }

    const chunkedSchemaIntoRows = chunkSchemaIntoRows(packedFile.schemaFields || [], dbversion);

    // console.log("chunked into ", chunkedSchemaIntoRows.length);
    // console.log("num fields in row is ", dbversion.fields.length);
    // console.log("db types are ", dbversion.fields.map((field) => field.name).join(", "));
    // console.log("with num chunks of ", chunkedSchemaIntoRows.map((row) => row.length).join(","));

    for (const chunkedSchemaIntoRow of chunkedSchemaIntoRows) {
      for (const dbFieldsIndex of dbversion.fields.keys()) {
        const { name, field_type } = dbversion.fields[dbFieldsIndex];
        const fields = chunkedSchemaIntoRow[dbFieldsIndex].fields;
        if (!fields) {
          console.log("MISSING FIELD ", name);
        }
        const resolvedKeyValue = resolveKeyValue(field_type, fields);

        amendedSchemaFields.push({ name, resolvedKeyValue, ...chunkedSchemaIntoRow[dbFieldsIndex] });

        // if (chunkedSchemaIntoRow == chunkedSchemaIntoRows[0]) {
        //   console.log("AMENDING ", name, resolvedKeyValue);
        // }
      }
    }
    packedFile.schemaFields = amendedSchemaFields;
    packedFile.tableSchema = dbversion;
    result.packedFiles[packedFile.name] = packedFile;
  }

  return result;
};

const createScriptLoggingData = (pack_files: PackedFile[]) => {
  pack_files.push({
    name: "script\\enable_console_logging",
    file_size: 1,
    start_pos: 0,
    is_compressed: false,
    schemaFields: [{ type: "Buffer", fields: [{ type: "Buffer", val: Buffer.from([0x00]) }] }],
  } as PackedFile);
};

const createAutoStartCustomBattleData = (pack_files: PackedFile[]) => {
  const scriptBuffer = Buffer.from(autoStartCustomBattleScript, "utf-8");
  pack_files.push({
    name: "script\\frontend\\mod\\pj_auto_custom_battles.lua",
    file_size: scriptBuffer.byteLength,
    start_pos: 0,
    is_compressed: false,
    schemaFields: [
      {
        type: "Buffer",
        fields: [{ type: "Buffer", val: scriptBuffer }],
      },
    ],
  } as PackedFile);
};

const sortByPackName = (packFirst: Pack, packSecond: Pack) => {
  return compareModNames(packFirst.name, packSecond.name);
};

export const mergeMods = async (mods: Mod[], existingPath?: string) => {
  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
  if (!dataFolder) return;
  let outFile: BinaryFile | undefined;
  try {
    const targetPath =
      existingPath ||
      nodePath.join(dataFolder, "merged-" + format(new Date(), "dd-MM-yyyy-HH-mm-ss") + ".pack");
    await fsExtra.ensureDirSync(nodePath.dirname(targetPath));

    const packFieldsSettled = await Promise.allSettled(
      mods.map((mod) => readPack(mod.path, { skipParsingTables: true }))
    );
    const sources = (
      packFieldsSettled.filter((pfs) => pfs.status === "fulfilled") as PromiseFulfilledResult<Pack>[]
    )
      .map((r) => r.value)
      .filter((packData) => packData);

    const header = "PFH5";
    const byteMask = 3;
    const refFileCount = 0;
    const pack_file_index_size = 0;

    outFile = new BinaryFile(targetPath, "w", true);
    await outFile.open();
    await outFile.writeString(header);
    await outFile.writeInt32(byteMask);
    await outFile.writeInt32(refFileCount);
    await outFile.writeInt32(pack_file_index_size);

    const packedFileNameToPackFileLookup: Record<string, PackedFile> = {};
    const packedFileNameToPackSource: Record<string, Pack> = {};

    const reverseSortedPacksByName = sources.sort(sortByPackName).reverse();

    for (const sourcePack of reverseSortedPacksByName) {
      for (const packFile of sourcePack.packedFiles) {
        const packedFileName = packFile.name;
        packedFileNameToPackFileLookup[packedFileName] = packFile;
        packedFileNameToPackSource[packedFileName] = sourcePack;
      }
    }

    await outFile.writeInt32(Object.keys(packedFileNameToPackFileLookup).length);

    const index_size = Object.keys(packedFileNameToPackFileLookup).reduce(
      (acc, name) => acc + new Blob([name]).size + 1 + 5,
      0
    );
    await outFile.writeInt32(index_size);
    await outFile.writeInt32(0x7fffffff); // header_buffer

    const sortedPackFileNames = Object.keys(packedFileNameToPackFileLookup).sort(compareModNames);

    const sortedPackFileNamesDBFirst = sortedPackFileNames
      .filter((name) => name.startsWith("db\\"))
      .concat(sortedPackFileNames.filter((name) => !name.startsWith("db\\")));

    for (const packedFileName of sortedPackFileNamesDBFirst) {
      const packedFile = packedFileNameToPackFileLookup[packedFileName];
      const { name, file_size } = packedFile;
      await outFile.writeInt32(file_size);
      await outFile.writeInt8(0);
      await outFile.writeString(name + "\0");
    }

    const packNameToFileHandle: Record<string, BinaryFile> = {};
    for (const sourcePack of sources) {
      const sourceFile = new BinaryFile(sourcePack.path, "r", true);
      await sourceFile.open();
      for (const packedFile of sourcePack.packedFiles) {
        packNameToFileHandle[packedFile.name] = sourceFile;
      }
    }

    const mergedMetaData = mods.map(
      (mod) =>
        ({
          path: mod.path,
          lastChanged: mod.lastChanged || mod.lastChangedLocal,
          humanName: mod.humanName,
          name: mod.name,
        } as MergedModsData)
    );
    const parsedTargetPath = nodePath.parse(targetPath);
    await fsExtra.writeJSONSync(
      nodePath.join(parsedTargetPath.dir, parsedTargetPath.name + ".json"),
      mergedMetaData
    );

    for (const packedFileName of sortedPackFileNamesDBFirst) {
      const sourceFile = packNameToFileHandle[packedFileName];
      const packedFile = packedFileNameToPackFileLookup[packedFileName];

      const data: Buffer = await sourceFile.read(packedFile.file_size, packedFile.start_pos);
      await outFile.write(data);
    }

    for (const fileHandle of Object.values(packNameToFileHandle)) {
      await fileHandle.close();
    }

    return targetPath;
  } catch (e) {
    console.log(e);
  } finally {
    if (outFile) await outFile.close();
  }
};

export const addFakeUpdate = async (pathSource: string, pathTarget: string) => {
  const randomHexString = [...Array(100)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  const toAdd = [
    {
      name: "whmm_update.txt",
      file_size: randomHexString.length,
      start_pos: 0,
      // is_compressed: 0,
      schemaFields: [{ type: "Buffer", fields: [{ type: "Buffer", val: Buffer.from(randomHexString) }] }],
    } as PackedFile,
  ];
  await writeCopyPack(pathSource, pathTarget, toAdd);
};

export const createOverwritePack = async (
  pathSource: string,
  pathTarget: string,
  overwrites: PackDataOverwrite[]
) => {
  if (overwrites.length == 0) return;
  const tablesToRead = overwrites.map((overwrite) => overwrite.packFilePath);
  console.log("to read for new overwrite pack:", tablesToRead);
  const sourceMod = await readPack(pathSource, { tablesToRead });

  const packFilesToAdd: PackedFile[] = [];

  for (const packedFile of sourceMod.packedFiles) {
    if (tablesToRead.includes(packedFile.name)) {
      const packViewData = getPackViewData(sourceMod, packedFile.name);
      if (packViewData) {
        const packTableDatas = getPackTableData(packedFile.name, packViewData);
        if (!packTableDatas) continue;
        const packTableData = packTableDatas[packedFile.name];
        console.log("PARSED packTableData for", packedFile.name, packTableData);

        const currentTableOverwrites = overwrites.filter(
          (iterOverwrite) => iterOverwrite.packFilePath == packedFile.name
        );
        if (currentTableOverwrites.length == 0) continue;

        const dbversion = getDBVersion(packedFile);
        if (!dbversion) {
          continue;
        }

        let clonedTableData = deepClone(packTableData) as PlainPackFileData;

        for (const overwrite of currentTableOverwrites) {
          if (overwrite.operation == "EDIT" || overwrite.operation == "REMOVE") {
            clonedTableData = clonedTableData.reduce<PlainPackFileData>((acc, item) => {
              const isMatch = overwrite.columnIndices.reduce((isMatch, columnIndex, index) => {
                return isMatch && overwrite.columnValues[index] == item[columnIndex];
              }, true);
              if (isMatch) {
                console.log("isMatch FOR", overwrite.columnValues);
                console.log("item is", item);
                console.log("operation is", overwrite.operation);
                if (overwrite.operation == "REMOVE") return acc;
                if (
                  overwrite.operation == "EDIT" &&
                  overwrite.overwriteIndex &&
                  overwrite.overwriteData != undefined
                ) {
                  const clonedRow = deepClone(item);
                  clonedRow[overwrite.overwriteIndex] = overwrite.overwriteData;
                  acc.push(clonedRow);
                  return acc;
                }
              }
              acc.push(item);
              return acc;
            }, [] as PlainPackFileData);
          }
        }

        console.log("NEW clonedTableData is:", clonedTableData);

        const newPackFile = deepClone(packedFile) as PackedFile;
        packFilesToAdd.push(newPackFile);

        // console.log("chunked into ", chunkedSchemaIntoRows.length);
        // console.log("num fields in row is ", dbversion.fields.length);
        // console.log("db types are ", dbversion.fields.map((field) => field.name).join(", "));
        // console.log("with num chunks of ", chunkedSchemaIntoRows.map((row) => row.length).join(","));

        newPackFile.schemaFields = [];
        newPackFile.file_size = 0;
        let newTableDataAsBuffer: Buffer = Buffer.from([]);
        for (const clonedTableDataRow of clonedTableData) {
          for (const dbFieldsIndex of dbversion.fields.keys()) {
            const { name, field_type, is_key } = dbversion.fields[dbFieldsIndex];

            const buffer = await typeToBuffer(field_type, clonedTableDataRow[dbFieldsIndex]);

            newPackFile.file_size += buffer.length;
            // newPackFile.schemaFields.push({ type: "Buffer", fields: [{ type: "Buffer", val: buffer }] });
            newTableDataAsBuffer = Buffer.concat([newTableDataAsBuffer, buffer]);

            // if (chunkedSchemaIntoRow == chunkedSchemaIntoRows[0]) {
            //   console.log("AMENDING ", name, resolvedKeyValue);
            // }
          }
        }

        if (newPackFile.guid) newPackFile.file_size += newPackFile.guid.length + 4 + 2;
        if (newPackFile.version) newPackFile.file_size += 8;
        newPackFile.file_size += 1; // marker after guid and version
        newPackFile.file_size += 4; // entry count
        console.log("ORIGINAL PACK file_size is:", packedFile.file_size);
        console.log("NEW PACK file_size is:", newPackFile.file_size);
        newPackFile.entryCount = clonedTableData.length;
        console.log("NEW entry count is:", clonedTableData.length);
        console.log("NEW buffer length is:", newTableDataAsBuffer.length);
        if (newTableDataAsBuffer.length > 0)
          newPackFile.schemaFields.push({
            type: "Buffer",
            fields: [{ type: "Buffer", val: newTableDataAsBuffer }],
          });
      }
    }
  }
  console.log("packFilesToAdd:", packFilesToAdd);
  console.log("tableSchema:", packFilesToAdd[0].tableSchema);

  // const randomHexString = [...Array(100)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  // const toAdd = [
  //   {
  //     name: "whmm_update.txt",
  //     file_size: randomHexString.length,
  //     start_pos: 0,
  //     // is_compressed: 0,
  //     schemaFields: [{ type: "Buffer", fields: [{ type: "Buffer", val: Buffer.from(randomHexString) }] }],
  //   } as PackedFile,
  // ];
  await writeCopyPack(pathSource, pathTarget, packFilesToAdd, sourceMod);
};

export const writeCopyPack = async (
  pathSource: string,
  pathTarget: string,
  packFilesToAdd: PackedFile[],
  sourceMod?: Pack
) => {
  let outFile: BinaryFile | undefined;
  let sourceFile: BinaryFile | undefined;
  // eslint-disable-next-line @typescript-eslint/no-inferrable-types
  let sourceFileId: number = -1;
  try {
    // console.log(pathSource);
    sourceMod = sourceMod || (await readPack(pathSource, { skipParsingTables: true }));
    // console.log(sourceMod);

    const packFiles = sourceMod.packedFiles;
    const packFilesWithAdded = sourceMod.packedFiles.concat(
      packFilesToAdd.filter((packFiletoAdd) =>
        sourceMod?.packedFiles.every((existingPackFile) => existingPackFile.name != packFiletoAdd.name)
      )
    );

    const packFilesToAddWithoutReplaced = packFilesToAdd.filter((packFiletoAdd) =>
      sourceMod?.packedFiles.every((existingPackFile) => existingPackFile.name != packFiletoAdd.name)
    );

    if (packFiles.length < 1) return;

    outFile = new BinaryFile(pathTarget, "w", true);
    sourceFile = new BinaryFile(pathSource, "r", true);
    await sourceFile.open();
    sourceFileId = fs.openSync(pathSource, "r");
    await outFile.open();
    await outFile.write(sourceMod.packHeader.header);
    await outFile.writeInt32(sourceMod.packHeader.byteMask);
    await outFile.writeInt32(sourceMod.packHeader.refFileCount);
    await outFile.writeInt32(sourceMod.packHeader.pack_file_index_size);

    await outFile.writeInt32(packFilesWithAdded.length);

    const index_size = packFilesWithAdded.reduce((acc, pack) => acc + new Blob([pack.name]).size + 1 + 5, 0);
    await outFile.writeInt32(index_size);
    await outFile.writeInt32(0x7fffffff); // header_buffer

    console.log("DEP PACKS:", sourceMod.dependencyPacks);
    if (sourceMod.dependencyPacks) {
      for (const dependencyPack of sourceMod.dependencyPacks) {
        await outFile.writeString(dependencyPack);
        await outFile.writeUInt8(0);
      }
    }

    for (const packFile of packFilesWithAdded) {
      const { name, file_size } = packFile;
      // console.log("file size is " + file_size);

      const replacementPackFile = packFilesToAdd.find((toAdd) => toAdd.name == name);
      await outFile.writeInt32(replacementPackFile ? replacementPackFile.file_size : file_size);
      // await outFile.writeInt8(is_compressed);
      await outFile.writeInt8(replacementPackFile ? 0 : packFile.is_compressed ? 1 : 0);
      await outFile.writeString(name + "\0");
    }

    for (const packFile of packFiles) {
      let data: Buffer | undefined;
      const fileToReplaceWith = packFilesToAdd.find((packFileToAdd) => packFileToAdd.name == packFile.name);
      if (fileToReplaceWith && fileToReplaceWith.schemaFields) {
        if (fileToReplaceWith.guid) {
          const view = new DataView(new ArrayBuffer(2));
          console.log("GUID LENGTS IS", fileToReplaceWith.guid.length / 2);
          view.setInt16(0, fileToReplaceWith.guid.length / 2, true);

          await outFile.write(Buffer.from([0xfd, 0xfe, 0xfc, 0xff]));
          await outFile.write(Buffer.from(view.buffer));
          await outFile.write(Buffer.from(fileToReplaceWith.guid, "utf8"));
        }
        if (fileToReplaceWith.version) {
          await outFile.write(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
          await outFile.writeInt32(fileToReplaceWith.version);
        }
        if (fileToReplaceWith.guid || fileToReplaceWith.version) {
          // marker after guid and version
          const view = new DataView(new ArrayBuffer(1));
          view.setUint8(0, 1);
          await outFile.write(Buffer.from(view.buffer));
        }
        if (fileToReplaceWith.entryCount != undefined) {
          await outFile.writeInt32(fileToReplaceWith.entryCount);
        }
        console.log("fileToReplaceWith IS:", fileToReplaceWith.name);
        console.log("fileToReplaceWith IS:", fileToReplaceWith);
        // create an empty buffer if there isn't one (the table is now empty)
        data =
          fileToReplaceWith.schemaFields[0] &&
          fileToReplaceWith.schemaFields[0].fields &&
          (fileToReplaceWith.schemaFields[0].fields[0].val as Buffer);
        // startPosOffset += fileToReplaceWith.file_size - packFile.file_size;
      } else {
        data = Buffer.allocUnsafe(packFile.file_size);
        fs.readSync(sourceFileId, data, 0, data.length, packFile.start_pos);

        // data = await sourceFile.read(packFile.file_size, packFile.start_pos);
      }

      if (data) await outFile.write(data);
    }

    for (const packFile of packFilesToAddWithoutReplaced) {
      if (packFile.schemaFields) await outFile.write(packFile.schemaFields[0].fields[0].val as Buffer);
    }
  } catch (e) {
    console.log(e);
  } finally {
    if (outFile) await outFile.close();
    if (sourceFile) await sourceFile.close();
    if (sourceFileId >= 0) fs.closeSync(sourceFileId);
  }
};

export const writePack = async (packFiles: NewPackedFile[], path: string, existingPackToAppend?: Pack) => {
  let outFile: BinaryFile | undefined;

  const timestamp = format(new Date(), "ddMMyy_HHmmss");
  const outPath = existingPackToAppend ? `${path}_${timestamp}` : path;

  try {
    const header = "PFH5";
    const byteMask = 3;
    const refFileCount = 0;
    const pack_file_index_size = 0;

    if (packFiles.length < 1) return;

    outFile = new BinaryFile(outPath, "w", true);
    await outFile.open();
    await outFile.writeString(header);
    await outFile.writeInt32(byteMask);
    await outFile.writeInt32(refFileCount);
    await outFile.writeInt32(pack_file_index_size);

    const allPackFiles = existingPackToAppend
      ? [
          ...packFiles,
          ...existingPackToAppend.packedFiles.map(
            (pf) =>
              ({
                name: pf.name,
                file_size: pf.file_size,
                readBuffer: true,
              } as NewPackedFile)
          ),
        ]
      : packFiles;

    await outFile.writeInt32(allPackFiles.length);

    allPackFiles.sort((firstPf, secondPf) => {
      return firstPf.name.localeCompare(secondPf.name);
    });

    const index_size = allPackFiles.reduce((acc, pack) => acc + new Blob([pack.name]).size + 1 + 5, 0);
    await outFile.writeInt32(index_size);
    await outFile.writeInt32(0x7fffffff); // header_buffer

    console.log("position after header:", outFile.tell());

    // const positionForFile = {} as Record<string, number>;
    // let currentPos = 0;

    for (const packFile of allPackFiles) {
      // const { name, file_size, start_pos, is_compressed } = packFile;
      const { name, file_size } = packFile;
      // console.log("writing packed file", packFile.name, "file size is ", file_size);
      if (packFile.schemaFields && packFile.tableSchema && !packFile.name.endsWith(".loc")) {
        // await outFile.writeInt32(file_size + 78); // if using guid, guid size is 78
        await outFile.writeInt32(file_size);
      } else {
        await outFile.writeInt32(file_size);
      }
      // await outFile.writeInt8(is_compressed);
      await outFile.writeInt8(0);
      await outFile.writeString(name + "\0");
    }

    // console.log("position after FILES header:", outFile.tell());
    // const posAfterFilesHeader = outFile.tell();

    // currentPos = posAfterFilesHeader;
    // for (const packFile of packFiles) {
    //   // const { name, file_size, start_pos, is_compressed } = packFile;
    //   const { name, file_size } = packFile;
    //   let sizeInc = 0;
    //   // console.log("writing packed file", packFile.name, "file size is ", file_size);
    //   if (packFile.schemaFields && packFile.tableSchema && !packFile.name.endsWith(".loc")) {
    //     sizeInc = file_size + 78;
    //   } else {
    //     sizeInc = file_size;
    //   }
    //   currentPos = currentPos + sizeInc;
    //   positionForFile[name] = currentPos;
    // }

    for (const packFile of allPackFiles) {
      if (packFile.readBuffer && existingPackToAppend) {
        const existingPack = await readPack(existingPackToAppend.path, { filesToRead: [packFile.name] });
        if (existingPack) {
          const readPF = existingPack.packedFiles.find((pf) => pf.name == packFile.name);
          if (readPF) {
            // console.log("READ BUFFER OF", readPF.name);
            await writeField(outFile, { type: "Buffer", fields: [{ type: "Buffer", val: readPF.buffer }] });
            readPF.buffer = undefined;
          }
        }
      } else if (packFile.buffer) {
        await writeField(outFile, { type: "Buffer", fields: [{ type: "Buffer", val: packFile.buffer }] });
      } else if (packFile.schemaFields && packFile.tableSchema) {
        if (packFile.name.endsWith(".loc")) {
          await outFile.write(Buffer.from([0xff, 0xfe]));
          await outFile.write(Buffer.from([0x4c, 0x4f, 0x43]));
        } else {
          // optionally include the GUID
          // const newGuid = getGUID();
          // const view = new DataView(new ArrayBuffer(2));
          // console.log("GUID LENGTS IS", newGuid.length / 2);
          // view.setInt16(0, newGuid.length, true);

          // await outFile.write(Buffer.from([0xfd, 0xfe, 0xfc, 0xff]));
          // await outFile.write(Buffer.from(view.buffer));
          // await outFile.write(Buffer.from(newGuid, "utf16le"));

          if (packFile.version != null) {
            console.log(packFile.name, "version:", packFile.version);
            await outFile.write(Buffer.from([0xfc, 0xfd, 0xfe, 0xff])); // version marker
            await outFile.writeInt32(packFile.version); // db version
          }
        }

        if (packFile.name.endsWith(".loc")) {
          await outFile.writeInt8(0);
          await outFile.writeInt32(1);
        } else {
          await outFile.writeInt8(1);
        }
        // await outFile.writeInt8(1);
        console.log("num rows:", packFile.schemaFields.length / packFile.tableSchema.fields.length);
        await outFile.writeInt32(packFile.schemaFields.length / packFile.tableSchema.fields.length);

        for (let i = 0; i < packFile.schemaFields.length; i++) {
          const field = packFile.schemaFields[i];
          await writeField(outFile, field);
        }

        console.log("WROTE FILE:", packFile.name);
        // console.log("current pos:", outFile.tell());
        // console.log("saved pos:", positionForFile[packFile.name]);
      } else {
        console.log("NO BUFFER AND NO SCHEMA DATA FOR", packFile.name);
      }
    }

    if (existingPackToAppend) {
      await fsExtra.move(outPath, path, { overwrite: true });
    }
  } finally {
    if (outFile) await outFile.close();
  }
};

export const writeStartGamePack = async (
  packsData: Pack[],
  path: string,
  enabledMods: Mod[],
  startGameOptions: StartGameOptions
) => {
  let outFile: BinaryFile | undefined;
  try {
    const header = "PFH5";
    const byteMask = 3;
    const refFileCount = 0;
    const pack_file_index_size = 0;

    const packFiles: PackedFile[] = [];

    if (startGameOptions.isMakeUnitsGeneralsEnabled)
      createBattlePermissionsData(packsData, packFiles, enabledMods);
    if (startGameOptions.isSkipIntroMoviesEnabled) createIntroMoviesData(packFiles);
    if (startGameOptions.isScriptLoggingEnabled) createScriptLoggingData(packFiles);
    if (startGameOptions.isAutoStartCustomBattleEnabled) createAutoStartCustomBattleData(packFiles);

    if (packFiles.length < 1) return;

    outFile = new BinaryFile(path, "w", true);
    await outFile.open();
    await outFile.writeString(header);
    await outFile.writeInt32(byteMask);
    await outFile.writeInt32(refFileCount);
    await outFile.writeInt32(pack_file_index_size);

    await outFile.writeInt32(packFiles.length);

    const index_size = packFiles.reduce((acc, pack) => acc + new Blob([pack.name]).size + 1 + 5, 0);
    await outFile.writeInt32(index_size);
    await outFile.writeInt32(0x7fffffff); // header_buffer

    for (const packFile of packFiles) {
      // const { name, file_size, start_pos, is_compressed } = packFile;
      const { name, file_size } = packFile;
      // console.log("file size is " + file_size);
      await outFile.writeInt32(file_size);
      // await outFile.writeInt8(is_compressed);
      await outFile.writeInt8(0);
      await outFile.writeString(name + "\0");
    }

    for (const packFile of packFiles) {
      if (!packFile.schemaFields) continue;
      if (packFile.guid != null) {
        const guid = packFile.guid;
        // console.log("guid is " + guid);
        await outFile.write(Buffer.from([0xfd, 0xfe, 0xfc, 0xff])); // guid marker
        await outFile.writeInt16(guid.length);
        const twoByteGUID = guid
          .split("")
          .map((str) => str + "\0")
          .join("");
        // console.log(twoByteGUID);
        await outFile.write(Buffer.from(twoByteGUID, "utf-8"));
      }

      if (packFile.version != null) {
        // console.log(packFile.version);
        await outFile.write(Buffer.from([0xfc, 0xfd, 0xfe, 0xff])); // version marker
        await outFile.writeInt32(packFile.version); // db version
        await outFile.writeInt8(1);

        // console.log("NUM OF FIELDS:");
        // console.log(packFile.schemaFields.length / ver_schema.length);
        await outFile.writeInt32(packFile.schemaFields.length / ver_schema.length);
      }

      // console.log(general_unit_index);
      // console.log(dbVersionNumFields);

      for (let i = 0; i < packFile.schemaFields.length; i++) {
        const field = packFile.schemaFields[i];
        await writeField(outFile, field);
      }
    }
  } finally {
    if (outFile) await outFile.close();
  }
};

const writeField = async (file: BinaryFile, schemaField: SchemaField) => {
  // console.log(field);
  for (const field of schemaField.fields) {
    switch (field.type) {
      case "UInt8":
        {
          await file.writeUInt8(field.val as number);
        }
        break;
      case "F32":
        {
          await file.writeFloat(field.val as number);
        }
        break;
      case "I32":
        {
          await file.writeInt32(field.val as number);
        }
        break;
      case "I16":
        {
          await file.writeInt16(field.val as number);
        }
        break;
      case "I64":
        {
          const buffer = Buffer.alloc(8);
          buffer.writeBigInt64LE(BigInt(field.val as number));
          await file.write(buffer);
          // await file.writeInt64(field.val as number);
        }
        break;
      case "F64":
        {
          await file.writeDouble(field.val as number);
        }
        break;
      case "Int8":
        {
          await file.writeInt8(field.val as number);
        }
        break;
      case "Int16":
        {
          await file.writeUInt16(field.val as number);
        }
        break;
      case "String":
        {
          await file.writeString(field.val as string);
        }
        break;
      case "Buffer":
        {
          await file.write(field.val as Buffer);
        }
        break;
      default:
        throw new Error("NO WAY TO RESOLVE " + field.type);
        break;
    }
  }
};

const readUTFString = async (fileIn: BinaryFile) => {
  const length = await fileIn.readInt16();
  // console.log('length is ' + length);
  // since utf8 is 2 bytes per char
  return (await fileIn.read(length * 2)).toString("utf8");
};

const readUTFStringFromBuffer = (buffer: Buffer, pos: number): [string, number] => {
  const length = buffer.readInt16LE(pos);
  pos += 2;
  // console.log('length is ' + length);
  // since utf8 is 2 bytes per char
  return [buffer.subarray(pos, pos + length * 2).toString("utf8"), pos + length * 2];
};
const matchPackNamesInsideSaveFile = /\0[^\0]+?\.pack/g;
export const getPacksInSave = async (saveName: string): Promise<string[]> => {
  console.log("Getting packs from save: ", saveName);
  const savePath = nodePath.join(getSavesFolderPath(), saveName);

  let file: BinaryFile;
  try {
    file = new BinaryFile(savePath, "r", true);
    await file.open();
    const header = await file.read(await file.size());
    const ascii = header.toString("ascii");

    console.log(
      "mods in save:",
      ascii.match(matchPackNamesInsideSaveFile)?.map((match) => match.replace("\0", ""))
    );

    const packsInSave = ascii.match(matchPackNamesInsideSaveFile);
    if (packsInSave != null) return packsInSave.map((match) => match.replace("\0", ""));
  } catch (err) {
    console.log(err);
  }

  return [];
};

let toRead: Mod[];

export const readFromExistingPack = async (
  pack: Pack,
  packReadingOptions: PackReadingOptions = { skipParsingTables: false }
): Promise<Pack> => {
  const pack_files = pack.packedFiles;
  let packHeader: PackHeader | undefined;
  const modPath = pack.path;

  console.log(`reading from existing pack ${modPath}`);

  let lastChangedLocal = -1;
  try {
    lastChangedLocal = (await fsExtra.stat(modPath)).mtimeMs;
  } catch (e) {
    console.log(e);
  }

  // let file: BinaryFile | undefined;
  // eslint-disable-next-line @typescript-eslint/no-inferrable-types
  let fileId: number = -1;
  try {
    // file = new BinaryFile(modPath, "r", true);
    fileId = fs.openSync(modPath, "r");
    // await file.open();

    console.log(`${modPath} file opened`);
    if (packReadingOptions.tablesToRead)
      console.log(`readFromExistingPack: TABLES TO READ:`, packReadingOptions.tablesToRead.join(", "));

    if (packReadingOptions.filesToRead && packReadingOptions.filesToRead.length > 0) {
      for (const fileToRead of packReadingOptions.filesToRead) {
        // console.log("FIND", fileToRead);
        const indexOfFileToRead = bs(pack_files, fileToRead, (a: PackedFile, b: string) =>
          collator.compare(a.name, b)
        );
        if (indexOfFileToRead >= 0) {
          // console.log("FOUND", fileToRead);
          const packedFileToRead = pack_files[indexOfFileToRead];
          let buffer = Buffer.allocUnsafe(packedFileToRead.file_size);
          fs.readSync(fileId, buffer, 0, buffer.length, packedFileToRead.start_pos);
          if (packedFileToRead.is_compressed) {
            buffer = Buffer.concat([Buffer.from(await decompress(buffer.subarray(4)))]);
          }
          packedFileToRead.buffer = buffer;
        }
      }
    }

    const dbPackFiles = packReadingOptions.skipParsingTables
      ? []
      : pack_files.filter((packFile) => {
          const dbNameMatch = packFile.name.match(matchDBFileRegex);
          return dbNameMatch != null && dbNameMatch[1];
        });

    if (packReadingOptions.skipParsingTables || dbPackFiles.length < 1) {
      return {
        name: nodePath.basename(modPath),
        path: modPath,
        packedFiles: pack_files,
        packHeader,
        lastChangedLocal,
        readTables: [],
      } as Pack;
    }

    const startPos = dbPackFiles.reduce(
      (previous, current) => (previous < current.start_pos ? previous : current.start_pos),
      Number.MAX_SAFE_INTEGER
    );

    const startOfLastPack = dbPackFiles.reduce(
      (previous, current) => (previous > current.start_pos ? previous : current.start_pos),
      -1
    );
    const endPos =
      (dbPackFiles.find((packFile) => packFile.start_pos === startOfLastPack)?.file_size ?? 0) +
      startOfLastPack;
    // console.log("endPos is ", endPos);

    const buffer = Buffer.allocUnsafe(endPos - startPos);
    fs.readSync(fileId, buffer, 0, buffer.length, startPos);
    // const buffer = await file.read(endPos - startPos, startPos);

    // console.log("len:", endPos - startPos);
    // console.log("startPos:", startPos);

    await readDBPackedFiles(packReadingOptions, dbPackFiles, buffer, startPos, modPath);
  } catch (e) {
    console.log(e);
  } finally {
    // if (file) await file.close();
    if (fileId >= 0) fs.closeSync(fileId);
  }

  console.log("done reading");

  let readTables: string[] | "all" = "all";
  if (packReadingOptions.skipParsingTables) readTables = [];
  if (packReadingOptions.tablesToRead) readTables = packReadingOptions.tablesToRead;

  return {
    name: nodePath.basename(modPath),
    path: modPath,
    packedFiles: pack_files,
    packHeader,
    lastChangedLocal,
    readTables,
  } as Pack;
};

const readDBPackedFiles = async (
  packReadingOptions: PackReadingOptions,
  dbPackFiles: PackedFile[],
  buffer: Buffer,
  startPos: number,
  modPath: string
) => {
  let currentPos = 0;
  for (const pack_file of dbPackFiles) {
    if (
      packReadingOptions.tablesToRead &&
      !packReadingOptions.tablesToRead.some((tableToRead) => pack_file.name.startsWith(tableToRead))
    )
      continue;

    // if (packReadingOptions.tablesToRead) {
    //   console.log("READING TABLE ", pack_file.name);
    // }

    currentPos = pack_file.start_pos - startPos;

    const dbNameMatch = pack_file.name.match(matchDBFileRegex);
    if (dbNameMatch == null) continue;
    const dbName = dbNameMatch[1];
    if (dbName == null) continue;

    const dbversions = DBNameToDBVersions[appData.currentGame][dbName];
    if (!dbversions) continue;

    let packBuffer = buffer.subarray(currentPos, currentPos + pack_file.file_size);
    if (pack_file.is_compressed) {
      // console.log("dbbuffer before: currentPos", currentPos, "len", pack_file.file_size);
      // fs.writeFileSync("dbbuffer_raw_" + pack_file.name.replaceAll("\\", "_"), packBuffer);
      packBuffer = Buffer.from(await decompress(packBuffer.subarray(4)));
      // fs.writeFileSync("dbbuffer_" + pack_file.name.replaceAll("\\", "_"), packBuffer);
    }

    currentPos = 0;

    // console.log(`reading ${pack_file.name}`);

    let version: number | undefined;
    for (;;) {
      const marker = await packBuffer.subarray(currentPos, currentPos + 4);
      currentPos += 4;

      if (marker.toString("hex") === "fdfefcff") {
        const readUTF = readUTFStringFromBuffer(packBuffer, currentPos);
        // console.log("guid is " + readUTF[0]);
        pack_file.guid = readUTF[0];
        currentPos = readUTF[1];
        // console.log("current pos after guid is:", currentPos);
      } else if (marker.toString("hex") === "fcfdfeff") {
        // console.log("found version marker");
        version = packBuffer.readInt32LE(currentPos); // await file.readInt32();
        currentPos += 4;

        pack_file.version = version;
        // await file.read(1);
      } else {
        // console.log(marker.toString("hex"));
        currentPos -= 4;
        currentPos += 1;
        // file.seek(file.tell() - 4);
        break;
      }
      // if (pack_file.name === "db\\character_skill_nodes_tables\\mixu_ll_empire") {
      // console.log(pack_file.name);
      // console.log(dbName);
      // console.log(file.tell());
      // console.log(dbName);
      // console.log(marker);
      // console.log("-------------------");
      // }
    }

    // if (version == null) {
    //   console.log("version is", version);
    //   console.log(pack_file.guid);
    //   console.log(pack_file.name);
    //   console.log(pack_file.start_pos);
    // }

    // if (version == null) continue;
    const dbversion =
      dbversions.find((dbversion) => dbversion.version == version) ||
      dbversions.find((dbversion) => dbversion.version == 0);
    if (!dbversion) continue;
    if (version != null && dbversion.version < version) continue;
    // if (version == null) {
    //   console.log("USING VERSION", dbversion.version, dbName, pack_file.name, modPath);
    // }

    const entryCount = packBuffer.readInt32LE(currentPos); //await file.readInt32();
    currentPos += 4;

    // console.log("entry count is ", entryCount);
    // console.log("pos is ", currentPos);

    // console.log(dbName);
    // outFile.seek(file.tell());

    try {
      for (let i = 0; i < entryCount; i++) {
        for (const field of dbversion.fields) {
          const { name, field_type, is_key } = field;
          // console.log(name);
          // console.log(field_type);
          // console.log(currentPos);
          // console.log("real_pos:", currentPos + startPos);

          // if (name === 'general_unit') console.log("it's a general");
          // console.log("pos is " + outFile.tell());
          // console.log('i is ' + i);
          // const fields = await parseType(file, field_type);
          const lastPos = currentPos;
          try {
            const fieldsRet = await parseTypeBuffer(packBuffer, currentPos, field_type);
            const fields = fieldsRet[0];
            currentPos = fieldsRet[1];

            if (!fields[1] && !fields[0]) {
              console.log(name);
              console.log(field_type);
            }
            if (fields[0].val == undefined) {
              console.log(name);
              console.log(field_type);
            }
            if (fields.length == 0) {
              console.log(name);
              console.log(field_type);
            }

            const schemaField: SchemaField = {
              // name,
              type: field_type,
              fields,
              // isKey: is_key,
              // resolvedKeyValue: (is_key && fields[1] && fields[1].val.toString()) || fields[0].val.toString(),
            };
            if (is_key) {
              schemaField.isKey = true;
            }
            pack_file.schemaFields = pack_file.schemaFields || [];
            pack_file.schemaFields.push(schemaField);

            // if (pack_file.name.includes("xyz")) {
            // console.log(dbName, name, field_type);
            //   console.log("lastPos:", lastPos);
            //   console.log("currentPos:", currentPos);
            //   console.log("read", fields[0]);
            //   console.log("read", fields[1]);
            // }
          } catch (e) {
            console.log(e);
            console.log("ERROR PARSING DB FIELD");
            console.log(modPath);
            console.log(pack_file.name);
            console.log(dbName, name, field_type);
            console.log("lastPos:", lastPos);
            console.log("currentPos:", currentPos);
            console.log("real_pos:", currentPos + startPos);

            throw e;
          }
        }
      }
    } catch {
      console.log(`cannot read ${pack_file.name} in ${modPath}, skipping it`);
    }
  }
};

const readLoc = async (
  packReadingOptions: PackReadingOptions,
  locPackFile: PackedFile,
  buffer: Buffer,
  modPath: string
) => {
  let currentPos = 0;

  console.log("READING LOC file", locPackFile.name);

  const marker = await buffer.subarray(currentPos, currentPos + 2);
  currentPos += 2;

  if (marker.toString("hex") != "fffe") {
    console.log("FF FE marker is wrong!");
    return;
  }

  const locMarker = await buffer.subarray(currentPos, currentPos + 3);
  currentPos += 3;
  if (locMarker.toString("hex") != "4c4f43") {
    console.log("LOC marker is wrong!");
    return;
  }

  currentPos += 1; // null byte
  currentPos += 4; // pack file version, loc is always 1

  const entryCount = buffer.readInt32LE(currentPos);
  currentPos += 4;

  try {
    for (let i = 0; i < entryCount; i++) {
      for (const field of LocFields) {
        const { name, field_type, is_key } = field;

        // console.log("reading", name, field_type, currentPos);
        const lastPos = currentPos;
        try {
          const fieldsRet = await parseTypeBuffer(buffer, currentPos, field_type);
          const fields = fieldsRet[0];
          currentPos = fieldsRet[1];

          // console.log("after read:", fieldsRet);
          // console.log("fields 0:", fields[0] && fields[0].val);
          // console.log("fields 1:", fields[1] && fields[1].val);

          if (!fields[1] && !fields[0]) {
            console.log(name);
            console.log(field_type);
          }
          if (fields[0].val == undefined) {
            console.log(name);
            console.log(field_type);
          }
          if (fields.length == 0) {
            console.log(name);
            console.log(field_type);
          }

          const schemaField: SchemaField = {
            // name,
            type: field_type,
            fields,
          };
          if (is_key) {
            schemaField.isKey = true;
          }
          locPackFile.schemaFields = locPackFile.schemaFields || [];
          locPackFile.schemaFields.push(schemaField);
        } catch (e) {
          console.log(e);
          console.log("ERROR PARSING DB FIELD");
          console.log(modPath);
          console.log(locPackFile.name);
          console.log(name, field_type);
          console.log("lastPos:", lastPos);
          console.log("currentPos:", currentPos);

          throw e;
        }
      }
    }
  } catch {
    console.log(`cannot read ${locPackFile.name} in ${modPath}, skipping it`);
  }
};

export const matchDBFileRegex = /^db\\(.*?)\\/;
export const readPack = async (
  modPath: string,
  packReadingOptions: PackReadingOptions = { skipParsingTables: false }
): Promise<Pack> => {
  const pack_files: PackedFile[] = [];
  let packHeader: PackHeader | undefined;
  const dependencyPacks: string[] = [];

  let lastChangedLocal = -1;
  try {
    lastChangedLocal = (await fsExtra.stat(modPath)).mtimeMs;
  } catch (e) {
    console.log(e);
  }

  // let file: BinaryFile | undefined;
  // eslint-disable-next-line @typescript-eslint/no-inferrable-types
  let fileId: number = -1;
  try {
    fileId = fs.openSync(modPath, "r");

    // console.log(`${modPath} file opened`);
    // if (packReadingOptions.tablesToRead)
    //   console.log(`NUM OF TABLES TO READ:`, packReadingOptions.tablesToRead.length);

    // header 4
    // byteMask 4
    // refFileCount 4
    // pack_file_index_size 4
    // pack_file_count 4
    // packed_file_index_size 4
    // headerBuffer 4
    // header_buffer_len 4;
    const packedFileHeaderSize = 8 * 4;
    const packedFileHeader = Buffer.allocUnsafe(packedFileHeaderSize);
    fs.readSync(fileId, packedFileHeader, 0, packedFileHeader.length, 0);

    let packedFileHeaderPosition = 0;
    const header = await packedFileHeader.subarray(packedFileHeaderPosition, packedFileHeaderPosition + 4);
    packedFileHeaderPosition += 4;
    if (header === null) throw new Error("header missing");

    const byteMask = await packedFileHeader.readInt32LE(packedFileHeaderPosition);
    packedFileHeaderPosition += 4;

    const refFileCount = await packedFileHeader.readInt32LE(packedFileHeaderPosition);
    packedFileHeaderPosition += 4;

    const pack_file_index_size = await packedFileHeader.readInt32LE(packedFileHeaderPosition);
    packedFileHeaderPosition += 4;

    const pack_file_count = await packedFileHeader.readInt32LE(packedFileHeaderPosition);
    packedFileHeaderPosition += 4;

    const packed_file_index_size = await packedFileHeader.readInt32LE(packedFileHeaderPosition);
    packedFileHeaderPosition += 4;

    const header_buffer_len = 4;
    const header_buffer = await packedFileHeader.subarray(
      packedFileHeaderPosition,
      packedFileHeaderPosition + header_buffer_len
    );
    packedFileHeaderPosition += header_buffer_len;

    // const header = await file.read(4);
    // if (header === null) throw new Error("header missing");

    // const byteMask = await file.readInt32();
    // const refFileCount = await file.readInt32();
    // const pack_file_index_size = await file.readInt32();
    // const pack_file_count = await file.readInt32();
    // const packed_file_index_size = await file.readInt32();

    // console.log(`modPath is ${modPath}`);
    // console.log(`header is ${header}`);
    // console.log(`byteMask is ${byteMask}`);
    // console.log(`refFileCount is ${refFileCount}`);
    // console.log(`pack_file_index_size is ${pack_file_index_size}`);
    // console.log(`pack_file_count is ${pack_file_count}`);
    // console.log(`packed_file_index_size is ${packed_file_index_size}`);

    // const header_buffer_len = 4;
    // const header_buffer = await file.read(4); // header_buffer

    packHeader = {
      header,
      byteMask,
      refFileCount,
      pack_file_index_size,
      pack_file_count,
      header_buffer,
    } as PackHeader;

    if (pack_file_index_size > 0) {
      const packIndexBuffer = Buffer.allocUnsafe(pack_file_index_size);
      fs.readSync(fileId, packIndexBuffer, 0, pack_file_index_size, packedFileHeaderPosition);

      packedFileHeaderPosition += pack_file_index_size;

      // get the dependencyPacks
      let start = 0;
      for (let i = 0; i < pack_file_index_size; i++) {
        if (packIndexBuffer[i] === 0) {
          if (i > start) {
            dependencyPacks[dependencyPacks.length] = packIndexBuffer.toString("utf8", start, i);
          }
          start = i + 1;
        }
      }
    }

    const dataStart = 24 + header_buffer_len + pack_file_index_size + packed_file_index_size;
    // console.log("data starts at " + dataStart);

    let file_pos = dataStart;

    const headerSize = dataStart - packedFileHeaderPosition;
    // const headerBuffer = await file.read(headerSize);

    const headerBuffer = Buffer.allocUnsafe(headerSize);
    fs.readSync(fileId, headerBuffer, 0, headerBuffer.length, packedFileHeaderPosition);

    // console.log("header size is: " + headerSize);

    // console.time("1000files");
    let bufPos = 0;
    // console.log("pack_file_count is " + pack_file_count);
    for (let i = 0; i < pack_file_count; i++) {
      let name = "";

      const file_size = headerBuffer.readInt32LE(bufPos);
      bufPos += 4;

      let is_compressed = false;
      if (appData.currentGame != "attila") {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        is_compressed = headerBuffer.readInt8(bufPos) == 1;
        bufPos += 1;
      }

      // const file_size = (stream.read(4) as Buffer).readInt32LE();
      // const is_compressed = (stream.read(1) as Buffer).readInt8();

      const nameStartPos = bufPos;
      for (let i = nameStartPos; i < headerBuffer.length; i++) {
        if (headerBuffer[i] === 0) {
          name = headerBuffer.toString("utf8", nameStartPos, i);
          bufPos = i + 1;
          break;
        }
      }

      // if (i === 1000) {
      // console.log(console.timeEnd("1000files"));
      // }

      pack_files.push({
        name,
        file_size,
        start_pos: file_pos,
        is_compressed,
      });
      file_pos += file_size;
    }

    if (!packReadingOptions.skipSorting) pack_files.sort((a, b) => collator.compare(a.name, b.name));

    // Early return if no additional processing needed
    if (
      !packReadingOptions.readScripts &&
      !packReadingOptions.readLocs &&
      (!packReadingOptions.filesToRead || packReadingOptions.filesToRead.length === 0) &&
      packReadingOptions.skipParsingTables
    ) {
      return {
        name: nodePath.basename(modPath),
        path: modPath,
        packedFiles: pack_files,
        packHeader,
        lastChangedLocal,
        readTables: [],
        dependencyPacks,
      } as Pack;
    }

    if (packReadingOptions.readScripts) {
      const scriptFiles: PackedFile[] = [];
      const xmlFiles: PackedFile[] = [];

      const xmlExtensions = new Set([".xml", ".variantmeshdefinition", ".wsmodel", ".xml.material"]);

      for (const packFile of pack_files) {
        const name = packFile.name;
        const lastDot = name.lastIndexOf(".");
        if (lastDot === -1) continue;

        const ext = name.substring(lastDot);
        if (ext === ".lua") {
          scriptFiles.push(packFile);
        } else if (xmlExtensions.has(ext)) {
          xmlFiles.push(packFile);
        }
      }
      // const scriptFiles = pack_files.filter((packFile) => {
      //   return packFile.name.endsWith(".lua");
      // });

      // const xmlFiles = pack_files.filter((packFile) => {
      //   return (
      //     packFile.name.endsWith(".xml") ||
      //     packFile.name.endsWith(".variantmeshdefinition") ||
      //     packFile.name.endsWith(".wsmodel") ||
      //     packFile.name.endsWith(".xml.material")
      //   );
      // });

      for (const scriptFile of scriptFiles) {
        let buffer = Buffer.allocUnsafe(scriptFile.file_size);
        fs.readSync(fileId, buffer, 0, buffer.length, scriptFile.start_pos);

        if (scriptFile.is_compressed) {
          buffer = Buffer.from(await decompress(buffer.subarray(4)));
        }
        scriptFile.text = buffer.toString("utf8");
      }

      for (const scriptFile of xmlFiles) {
        let buffer = Buffer.allocUnsafe(scriptFile.file_size);
        fs.readSync(fileId, buffer, 0, buffer.length, scriptFile.start_pos);

        if (scriptFile.is_compressed) {
          buffer = Buffer.from(await decompress(buffer.subarray(4)));
        }
        if (buffer.subarray(0, 2).toString("hex") == "fffe") {
          scriptFile.text = buffer.subarray(2).toString("utf16le");
        } else {
          scriptFile.text = buffer.toString("utf8");
        }
      }
    }

    if (packReadingOptions.readLocs) {
      const locPackFiles = pack_files.filter((packFile) => packFile.name.endsWith(".loc"));

      for (const locPackFile of locPackFiles) {
        // console.log("LOC file to read:", locPackFile);
        // const buffer = await file.read(locPackFile.file_size, locPackFile.start_pos);

        let buffer = Buffer.allocUnsafe(locPackFile.file_size);
        fs.readSync(fileId, buffer, 0, buffer.length, locPackFile.start_pos);

        if (locPackFile.is_compressed) {
          buffer = Buffer.concat([Buffer.from(await decompress(buffer.subarray(4)))]);
          // console.log("it's compressed!");
          // console.log("buffer:", buffer);
          // fs.writeFileSync("locbuffer" + locPackFile.name.replaceAll("\\", "_"), buffer);
        }
        await readLoc(packReadingOptions, locPackFile, buffer, modPath);
      }
    }

    if (packReadingOptions.filesToRead && packReadingOptions.filesToRead.length > 0) {
      for (const fileToRead of packReadingOptions.filesToRead) {
        // console.log("FIND", fileToRead);
        const indexOfFileToRead = bs(pack_files, fileToRead, (a: PackedFile, b: string) =>
          collator.compare(a.name, b)
        );
        if (indexOfFileToRead >= 0) {
          // console.log("FOUND", fileToRead);
          const packedFileToRead = pack_files[indexOfFileToRead];
          let buffer = Buffer.allocUnsafe(packedFileToRead.file_size);
          fs.readSync(fileId, buffer, 0, buffer.length, packedFileToRead.start_pos);
          if (packedFileToRead.is_compressed) {
            buffer = Buffer.from(await decompress(buffer.subarray(4)));
          }
          packedFileToRead.buffer = buffer;
        }
      }
    }

    // Early return if skipping tables
    if (packReadingOptions.skipParsingTables) {
      return {
        name: nodePath.basename(modPath),
        path: modPath,
        packedFiles: pack_files,
        packHeader,
        lastChangedLocal,
        readTables: [],
        dependencyPacks,
      } as Pack;
    }

    const dbPackFiles = pack_files.filter((packFile) => {
      const dbNameMatch = packFile.name.match(matchDBFileRegex);
      return dbNameMatch != null && dbNameMatch[1];
    });

    if (packReadingOptions.tablesToRead) {
      if (dbPackFiles.length < 1) console.log(`NO DB TABLES PRESENT IN PACK:`, modPath);
      else console.log(`readPack: TABLES TO READ:`, packReadingOptions.tablesToRead.join(", "));
    }

    // we've already checked packReadingOptions.skipParsingTables above
    if (dbPackFiles.length < 1) {
      return {
        name: nodePath.basename(modPath),
        path: modPath,
        packedFiles: pack_files,
        packHeader,
        lastChangedLocal,
        readTables: [],
        dependencyPacks,
      } as Pack;
    }

    let startPos = Number.MAX_SAFE_INTEGER;
    let endPos = -1;
    for (const dbFile of dbPackFiles) {
      if (dbFile.start_pos < startPos) startPos = dbFile.start_pos;
      const fileEnd = dbFile.start_pos + dbFile.file_size;
      if (fileEnd > endPos) endPos = fileEnd;
    }

    // const buffer = await file.read(endPos - startPos, startPos);

    const buffer = Buffer.allocUnsafe(endPos - startPos);
    fs.readSync(fileId, buffer, 0, buffer.length, startPos);

    // console.log("len:", endPos - startPos);
    // console.log("startPos:", startPos);

    await readDBPackedFiles(packReadingOptions, dbPackFiles, buffer, startPos, modPath);
  } catch (e) {
    console.log(e);
  } finally {
    try {
      // if (file) await file.close();
      if (fileId >= 0) fs.closeSync(fileId);
    } catch (e) {
      console.log(e);
    }
  }

  // console.log("readPack:", modPath);
  // const mod = toRead.find((iterMod) => modName === iterMod.name);
  // if (mod) {
  //   toRead.splice(toRead.indexOf(mod), 1);
  // }
  // console.log(toRead.map((mod) => mod.name));

  let readTables: string[] | "all" = "all";
  if (packReadingOptions.skipParsingTables) readTables = [];
  if (packReadingOptions.tablesToRead) readTables = packReadingOptions.tablesToRead;

  return {
    name: nodePath.basename(modPath),
    path: modPath,
    packedFiles: pack_files,
    packHeader,
    lastChangedLocal,
    readTables,
    dependencyPacks,
  } as Pack;
};

export const readPackWithWorker = async (modPath: string, skipParsingTables = false): Promise<Pack> => {
  return new Promise<Pack>((resolve, reject) => {
    const worker = new Worker(nodePath.join(__dirname, "readPacksWorker.js"), {
      workerData: { mods: [modPath] },
    });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code: number) => {
      if (code !== 0) reject(new Error(`Stopped with  ${code} exit code`));
    });
  });
};

// Helper function to extract the base filename from a packed file path
const getBaseFilename = (filePath: string): string => {
  const parts = filePath.split("\\");
  return parts[parts.length - 1];
};

// Helper function to replace the base filename in a packed file path
const replaceBaseFilename = (filePath: string, newBasename: string): string => {
  const parts = filePath.split("\\");
  parts[parts.length - 1] = newBasename;
  return parts.join("\\");
};

// Helper function to escape special regex characters for literal string matching
const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Buffer pool for efficient memory reuse during pack operations
class BufferPool {
  private pools = new Map<number, Buffer[]>();
  private readonly MAX_POOL_SIZE = 10; // Maximum buffers per size pool

  getBuffer(size: number): Buffer {
    // Round up to nearest power of 2 for better reuse (with minimum of 1KB)
    const poolSize = Math.max(1024, Math.pow(2, Math.ceil(Math.log2(size))));

    let pool = this.pools.get(poolSize);
    if (!pool) {
      pool = [];
      this.pools.set(poolSize, pool);
    }

    // Try to reuse an existing buffer
    const buffer = pool.pop();
    if (buffer) {
      return buffer; // Return full buffer, caller uses only what they need
    }

    // Create new buffer if none available
    return Buffer.allocUnsafe(poolSize);
  }

  returnBuffer(buffer: Buffer, originalSize: number): void {
    const poolSize = Math.max(1024, Math.pow(2, Math.ceil(Math.log2(originalSize))));

    // Only return if it's the right size for the pool
    if (buffer.length !== poolSize) {
      return; // Different size, don't pool it
    }

    let pool = this.pools.get(poolSize);
    if (!pool) {
      pool = [];
      this.pools.set(poolSize, pool);
    }

    // Return buffer to pool for reuse (but don't let pool grow too large)
    if (pool.length < this.MAX_POOL_SIZE) {
      pool.push(buffer);
    }
    // If pool is full, let buffer get garbage collected
  }

  // Clear all pools (useful for cleanup)
  clear(): void {
    this.pools.clear();
  }

  // Get stats for debugging
  getStats(): { totalPools: number; totalBuffers: number; poolSizes: number[] } {
    let totalBuffers = 0;
    const poolSizes: number[] = [];

    for (const [size, pool] of this.pools) {
      totalBuffers += pool.length;
      if (pool.length > 0) {
        poolSizes.push(size);
      }
    }

    return {
      totalPools: this.pools.size,
      totalBuffers,
      poolSizes: poolSizes.sort((a, b) => a - b),
    };
  }
}

export const renamePackedFilesWithOptions = async (
  packPath: string,
  searchPattern: string,
  replaceTarget: string,
  useRegex: boolean,
  isDev?: boolean,
  pathFilter?: string
): Promise<void> => {
  const backupPath = packPath + ".backup." + Date.now();

  // Create temporary pack path we use to create the new pack
  const tempPath = packPath + ".temp." + Date.now();

  try {
    // Create backup
    await fsExtra.copy(packPath, backupPath);
    console.log(`Created backup at: ${backupPath}`);

    // Read the original pack
    const originalPack = await readPack(packPath, { skipParsingTables: true, skipSorting: true });

    // Find files that match the pattern and create renamed copies
    const renamedFiles: PackedFile[] = [];
    let hasChanges = false;

    // Create a map from original names to renamed files for quick lookup
    const renameMap = new Map<string, PackedFile>();

    for (const packedFile of originalPack.packedFiles) {
      // Check path filter first (if provided)
      if (pathFilter?.trim()) {
        const filePath = packedFile.name.substring(0, packedFile.name.lastIndexOf("\\"));
        if (!filePath.includes(pathFilter.trim())) {
          continue; // Skip files that don't match path filter
        }
      }

      const baseFilename = getBaseFilename(packedFile.name);
      let newBaseFilename: string | null = null;

      if (useRegex) {
        const regex = new RegExp(searchPattern, "g");
        if (regex.test(baseFilename)) {
          regex.lastIndex = 0; // Reset for replacement
          newBaseFilename = baseFilename.replace(regex, replaceTarget);
        }
      } else {
        // Simple string replacement
        if (baseFilename.includes(searchPattern)) {
          newBaseFilename = baseFilename.replace(new RegExp(escapeRegExp(searchPattern), "g"), replaceTarget);
        }
      }

      if (newBaseFilename && newBaseFilename !== baseFilename) {
        const newFileName = replaceBaseFilename(packedFile.name, newBaseFilename);
        console.log(`Renaming with options: ${packedFile.name} -> ${newFileName}`);

        // Create a copy of the packed file with new name
        const renamedFile: PackedFile = {
          ...packedFile,
          name: newFileName,
        };
        renameMap.set(packedFile.name, renamedFile);
        renamedFiles.push(renamedFile);
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      if (isDev) {
        console.log("No files matched the rename pattern - but continuing for dev testing");
        // Don't return early in dev mode - allow the process to continue for testing
      } else {
        console.log("No files matched the rename pattern");
        // Remove backup since no changes were made
        await fsExtra.remove(backupPath);
        return;
      }
    }

    // Create new pack with renamed files (safe - doesn't touch original)
    await createPackWithRenamedFilesWithOptions(originalPack, tempPath, renameMap);
  } catch (error) {
    console.error("Error during pack creation (original file safe):", error);

    // Original file is still intact, just clean up temp file and backup
    try {
      if (await fsExtra.pathExists(tempPath)) {
        await fsExtra.remove(tempPath);
      }
      await fsExtra.remove(backupPath);
    } catch (cleanupError) {
      console.error("Failed to clean up temp files:", cleanupError);
    }

    throw error;
  }

  // Atomically replace original with temporary pack (ONLY dangerous step)
  try {
    await fsExtra.move(tempPath, packPath, { overwrite: true });
    console.log(`Successfully renamed files in pack: ${packPath}`);
    console.log(`Backup available at: ${backupPath}`);
  } catch (moveError) {
    console.error("Error during final file replacement:", moveError);

    // Try to restore from backup since original might be corrupted
    try {
      if (await fsExtra.pathExists(backupPath)) {
        await fsExtra.copy(backupPath, packPath);
        console.log("Restored from backup due to move failure");
      }
    } catch (restoreError) {
      console.error("Failed to restore from backup:", restoreError);
    }

    throw moveError;
  }
};

const createPackWithRenamedFilesWithOptions = async (
  originalPack: Pack,
  tempPath: string,

  renameMap: Map<string, PackedFile>
): Promise<void> => {
  let outFile: BinaryFile | undefined;
  let sourceFileId = -1;

  try {
    // Create the final list of packed files
    const finalPackedFiles: PackedFile[] = [];

    // Add all files, using renamed versions where applicable
    for (const originalFile of originalPack.packedFiles) {
      const renamedFile = renameMap.get(originalFile.name);
      if (renamedFile) {
        finalPackedFiles.push(renamedFile);
      } else {
        finalPackedFiles.push(originalFile);
      }
    }

    // Write the new pack file
    outFile = new BinaryFile(tempPath, "w", true);
    sourceFileId = fs.openSync(originalPack.path, "r");
    await outFile.open();

    // Write header
    await writePackHeader(
      outFile,
      originalPack.packHeader,
      finalPackedFiles,
      originalPack.dependencyPacks || []
    );

    // Pre-build file lookup map for O(1) instead of O(N) lookups
    const originalFileMap = new Map<string, PackedFile>();
    for (const pf of originalPack.packedFiles) {
      originalFileMap.set(pf.name, pf);
    }

    // Build reverse lookup for renamed files
    const renamedToOriginalMap = new Map<string, string>();
    for (const [originalName, renamedFile] of renameMap.entries()) {
      renamedToOriginalMap.set(renamedFile.name, originalName);
    }

    // Sort files by original pack position for sequential disk reads (much faster I/O)
    finalPackedFiles.sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const origA = originalFileMap.get(a.name) || originalFileMap.get(renamedToOriginalMap.get(a.name)!);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const origB = originalFileMap.get(b.name) || originalFileMap.get(renamedToOriginalMap.get(b.name)!);
      return (origA?.start_pos || 0) - (origB?.start_pos || 0);
    });

    // Create buffer pool for efficient memory reuse
    const bufferPool = new BufferPool();

    // Optimized batching for files mostly <1MB
    const SMALL_FILE_BATCH_SIZE = 2 * 1024 * 1024; // 2MB batches for small files
    const LARGE_FILE_THRESHOLD = 1024 * 1024; // 1MB threshold

    let currentBatchSize = 0;
    let batchBuffers: { buffer: Buffer; actualSize: number; poolBuffer: Buffer }[] = [];

    const flushBatch = async () => {
      if (batchBuffers.length > 0) {
        // Create array of buffer slices for concatenation
        const bufferSlices = batchBuffers.map((item) => item.buffer.subarray(0, item.actualSize));
        const combinedBuffer = Buffer.concat(bufferSlices);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await outFile!.write(combinedBuffer);

        // Return all buffers to pool
        for (const item of batchBuffers) {
          bufferPool.returnBuffer(item.poolBuffer, item.actualSize);
        }

        batchBuffers = [];
        currentBatchSize = 0;
      }
    };

    try {
      for (const file of finalPackedFiles) {
        // Fast O(1) lookup instead of O(N) find operations
        let originalFile = originalFileMap.get(file.name);
        if (!originalFile) {
          const originalName = renamedToOriginalMap.get(file.name);
          if (originalName) {
            originalFile = originalFileMap.get(originalName);
          }
        }

        // Get buffer from pool (reuses existing if available)
        const poolBuffer = bufferPool.getBuffer(file.file_size);
        const data = poolBuffer.subarray(0, file.file_size);

        if (originalFile) {
          fs.readSync(sourceFileId, data, 0, file.file_size, originalFile.start_pos);
        } else {
          console.warn(`Could not find original data for file: ${file.name}`);
          data.fill(0);
        }

        // Handle large files differently - write immediately to avoid memory buildup
        if (file.file_size >= LARGE_FILE_THRESHOLD) {
          // Flush any pending small files first
          await flushBatch();
          // Write large file directly
          await outFile.write(data);
          // Return buffer to pool immediately
          bufferPool.returnBuffer(poolBuffer, file.file_size);
        } else {
          // Batch small files together
          batchBuffers.push({
            buffer: data,
            actualSize: file.file_size,
            poolBuffer: poolBuffer,
          });
          currentBatchSize += file.file_size;

          // Flush batch when it reaches optimal size
          if (currentBatchSize >= SMALL_FILE_BATCH_SIZE) {
            await flushBatch();
          }
        }
      }

      // Flush remaining batch
      await flushBatch();
    } finally {
      // Clean up buffer pool
      bufferPool.clear();
    }
  } finally {
    if (outFile) await outFile.close();
    if (sourceFileId >= 0) fs.closeSync(sourceFileId);
  }
};

const writePackHeader = async (
  outFile: BinaryFile,
  originalHeader: PackHeader,
  packedFiles: PackedFile[],
  dependencyPacks: string[]
): Promise<void> => {
  // Write base header
  await outFile.write(originalHeader.header);
  await outFile.writeInt32(originalHeader.byteMask);
  await outFile.writeInt32(originalHeader.refFileCount);

  // Calculate pack index size
  const pack_file_index_size = dependencyPacks.reduce(
    (acc, dep) => acc + Buffer.byteLength(dep, "utf8") + 1,
    0
  );
  await outFile.writeInt32(pack_file_index_size);

  await outFile.writeInt32(packedFiles.length);

  // Calculate packed file index size
  const packed_file_index_size = packedFiles.reduce(
    (acc, file) => acc + 4 + 1 + Buffer.byteLength(file.name, "utf8") + 1,
    0
  );
  await outFile.writeInt32(packed_file_index_size);

  await outFile.writeInt32(0x7fffffff); // header_buffer

  // Write dependency packs
  for (const dep of dependencyPacks) {
    await outFile.writeString(dep);
    await outFile.writeUInt8(0);
  }

  // Write file index
  // Pre-calculate total size for file index to write in one batch
  let totalIndexSize = 0;
  for (const file of packedFiles) {
    totalIndexSize += 4; // file_size (int32)
    totalIndexSize += 1; // is_compressed (int8)
    totalIndexSize += Buffer.byteLength(file.name + "\0", "utf8"); // filename + null terminator
  }

  // Create buffer for entire file index and write all at once
  const indexBuffer = Buffer.allocUnsafe(totalIndexSize);
  let offset = 0;

  for (const file of packedFiles) {
    // Write file_size
    indexBuffer.writeInt32LE(file.file_size, offset);
    offset += 4;

    // Write is_compressed flag
    indexBuffer.writeInt8(file.is_compressed ? 1 : 0, offset);
    offset += 1;

    // Write filename with null terminator
    const filenameBytes = Buffer.from(file.name + "\0", "utf8");
    filenameBytes.copy(indexBuffer, offset);
    offset += filenameBytes.length;
  }

  // Single write operation for entire file index
  await outFile.write(indexBuffer);
};

export const readDataFromPacks = async (mods: Mod[]) => {
  // console.log("READ PACKS STARTED");
  // mods = mods.filter((mod) => mod.name === "!!pj_test1.pack" || mod.name === "!!pj_test1_dupe.pack");
  // mods = mods.filter((mod) => mod.name === "!!pj_test1.pack");
  // mods = mods.filter((mod) => mod.name === "cthdwf.pack");
  // mods = mods.filter((mod) => mod.name != "data.pack");
  // mods = mods.filter((mod) => mod.name === "merged-11-10-2022-15-22.pack");

  toRead = [...mods];

  // return (
  //   await new Promise<{ newPacksData: Pack[] }>((resolve, reject) => {
  //     const worker = new Worker(path.join(__dirname, "readPacksWorker.js"), { workerData: { mods, schema } });
  //     worker.on("message", resolve);
  //     worker.on("error", reject);
  //     worker.on("exit", (code) => {
  //       if (code !== 0) reject(new Error(`Stopped with  ${code} exit code`));
  //     });
  //   })
  // ).newPacksData;

  try {
    const packFieldsPromises = mods.map((mod) => {
      return readPack(mod.path);
    });

    console.time("readPacks");
    const packFieldsSettled = await Promise.allSettled(packFieldsPromises);
    const newPacksData = (
      packFieldsSettled.filter((pfs) => pfs.status === "fulfilled") as PromiseFulfilledResult<Pack>[]
    )
      .map((r) => r.value)
      .filter((packData) => packData);
    console.timeEnd("readPacks"); //26.580s

    console.log("READ PACKS DONE");
    return newPacksData;
  } catch (e) {
    console.log(e);
  }

  // console.log("num conflicts: " + num_conf);

  // console.log("num packs: " + packsData.length);
};
