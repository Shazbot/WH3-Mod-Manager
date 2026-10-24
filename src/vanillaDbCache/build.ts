import { DBVersion, Field, PackedFile, SchemaField } from "../packFileTypes";
import { parseDBTablePath } from "../utility/packFileHelpers";
import {
  isEncodableCellType,
  isStringCellType,
  readI64Cell,
  readNumericCell,
  readOptionalPresentByte,
  readStringCell,
} from "./cellFields";
import { encodeDictionaryColumn, encodeI64Column, encodeNumericColumn } from "./columnCodec";
import { buildFrontCodedBlock } from "./frontCodedBlock";
import { checksumBytes } from "./checksum";
import {
  VanillaDbCacheColumnMeta,
  VanillaDbCacheIdentity,
  VanillaDbCacheMeta,
  VanillaDbCacheTableMeta,
  VANILLA_DB_CACHE_DICTIONARY_PROBE_BYTES,
  encodeVanillaDbCacheHeader,
  encodeVanillaDbCacheMetaBlock,
} from "./format";

/** Resolves the DBVersion a packed file's rows were parsed with, matching the legacy GUI reader. */
export type ResolveTableSchema = (packedFile: PackedFile) => DBVersion | undefined;

/** Parsed exact rows supplied by packCore, without copying or synthesizing source cell bytes. */
export type VanillaDbCacheBuildCell = readonly Field[];
export type VanillaDbCacheBuildRow = readonly VanillaDbCacheBuildCell[];

export interface VanillaDbCacheBuildTable {
  packedFilePath: string;
  schema: DBVersion;
  rows: readonly VanillaDbCacheBuildRow[];
  packedFileVersion?: number;
  guid?: string;
}

export interface BuildVanillaDbCacheResult {
  bytes: Uint8Array;
  meta: VanillaDbCacheMeta;
  /** Packed files left out, with why. A table with no schema cannot be stored or read back. */
  skipped: Array<{ packedFilePath: string; reason: string }>;
}

interface PendingColumn {
  name: string;
  fieldType: VanillaDbCacheColumnMeta["fieldType"];
  isKey: boolean;
  payload: Uint8Array;
  presentPayload?: Uint8Array;
}

/** Rows of cells, sliced out of the flat per-cell array the legacy GUI reader produces. */
const chunkIntoRows = (schemaFields: SchemaField[], columnCount: number): SchemaField[][] => {
  if (columnCount <= 0) return [];
  const rowCount = Math.floor(schemaFields.length / columnCount);
  const rows: SchemaField[][] = new Array(rowCount);
  for (let row = 0; row < rowCount; row++) {
    rows[row] = schemaFields.slice(row * columnCount, (row + 1) * columnCount);
  }
  return rows;
};

export const buildVanillaDbCache = (
  packedFiles: readonly PackedFile[],
  resolveTableSchema: ResolveTableSchema,
  identity: VanillaDbCacheIdentity,
): BuildVanillaDbCacheResult => {
  const skipped: BuildVanillaDbCacheResult["skipped"] = [];

  const tables: VanillaDbCacheBuildTable[] = [];
  for (const packedFile of packedFiles) {
    const dbVersion = resolveTableSchema(packedFile);
    if (!dbVersion) {
      skipped.push({ packedFilePath: packedFile.name, reason: "no schema" });
      continue;
    }
    if (!packedFile.schemaFields) {
      skipped.push({ packedFilePath: packedFile.name, reason: "not parsed" });
      continue;
    }
    tables.push({
      packedFilePath: packedFile.name,
      schema: dbVersion,
      rows: chunkIntoRows(packedFile.schemaFields, dbVersion.fields.length).map((row) =>
        row.map((cell) => cell.fields),
      ),
      packedFileVersion: packedFile.version,
      guid: packedFile.guid,
    });
  }

  // A cache built from the old GUI parser must never carry the exact-source proof that production
  // headless reuse requires, even if a caller passes a richer identity object.
  const legacyIdentity = { ...identity, sourceFormat: undefined, decoderRevision: undefined };
  const built = buildVanillaDbCacheFromTables(tables, legacyIdentity);
  return { ...built, skipped: [...skipped, ...built.skipped] };
};

/** Builds from rows already parsed by packCore's shared exact DB decoder. */
export const buildVanillaDbCacheFromTables = (
  inputTables: readonly VanillaDbCacheBuildTable[],
  identity: VanillaDbCacheIdentity,
): BuildVanillaDbCacheResult => {
  const skipped: BuildVanillaDbCacheResult["skipped"] = [];

  // Every string is collected before any column is encoded: a column stores pool ids, an id is a rank
  // in the sorted pool, and a rank is only final once the pool holds everything.
  const poolValues = new Set<string>([""]);
  const parsedTables: Array<{
    packedFilePath: string;
    packedFileVersion?: number;
    guid?: string;
    dbVersion: DBVersion;
    rows: readonly VanillaDbCacheBuildRow[];
  }> = [];

  for (const table of inputTables) {
    const dbVersion = table.schema;
    const unsupported = dbVersion.fields.find((schemaField) => !isEncodableCellType(schemaField.field_type));
    if (unsupported) {
      skipped.push({
        packedFilePath: table.packedFilePath,
        reason: `unsupported field type ${unsupported.field_type}`,
      });
      continue;
    }

    if (table.rows.some((row) => row.length !== dbVersion.fields.length)) {
      skipped.push({ packedFilePath: table.packedFilePath, reason: "row does not match schema" });
      continue;
    }
    const rows = table.rows;
    for (const row of rows) {
      for (let column = 0; column < dbVersion.fields.length; column++) {
        const fieldType = dbVersion.fields[column].field_type;
        if (isStringCellType(fieldType)) poolValues.add(readStringCell(fieldType, [...row[column]]));
      }
    }
    parsedTables.push({
      packedFilePath: table.packedFilePath,
      packedFileVersion: table.packedFileVersion,
      guid: table.guid,
      dbVersion,
      rows,
    });
  }

  const sortedPoolValues = Array.from(poolValues).sort();
  const pool = buildFrontCodedBlock(sortedPoolValues);
  const poolIdByValue = new Map(sortedPoolValues.map((value, rank) => [value, rank]));

  const poolCheckpointBytes = new Uint8Array(
    pool.checkpoints.buffer,
    pool.checkpoints.byteOffset,
    pool.checkpoints.byteLength,
  );

  // Offsets below are relative to the start of the payload, not the file. The reader adds the header
  // and metadata size, which it already knows - otherwise the offsets would depend on the length of
  // the JSON that contains them, and writing them would change it.
  const sections: Uint8Array[] = [pool.bytes, poolCheckpointBytes];
  let payloadCursor = pool.bytes.length + poolCheckpointBytes.length;

  const tables: VanillaDbCacheTableMeta[] = [];
  for (const { packedFilePath, packedFileVersion, guid, dbVersion, rows } of parsedTables) {
    const columns: PendingColumn[] = [];

    for (let column = 0; column < dbVersion.fields.length; column++) {
      const { name, field_type: fieldType, is_key: isKey } = dbVersion.fields[column];

      if (!isStringCellType(fieldType)) {
        if (fieldType === "I64") {
          columns.push({
            name,
            fieldType,
            isKey,
            payload: encodeI64Column(rows.map((row) => readI64Cell([...row[column]]))),
          });
        } else {
          const values = rows.map((row) => readNumericCell([...row[column]]));
          columns.push({ name, fieldType, isKey, payload: encodeNumericColumn(values) });
        }
        continue;
      }

      const poolIds = rows.map((row) => poolIdByValue.get(readStringCell(fieldType, [...row[column]]))!);
      const payload = encodeDictionaryColumn(poolIds);

      // The presence byte gets its own column: only the byte 1 makes a string present, and any other
      // value has to come back as itself rather than as "absent".
      const presentPayload =
        fieldType === "OptionalStringU8"
          ? encodeNumericColumn(rows.map((row) => readOptionalPresentByte([...row[column]])))
          : undefined;

      columns.push({ name, fieldType, isKey, payload, presentPayload });
    }

    const columnMetas: VanillaDbCacheColumnMeta[] = [];
    for (const column of columns) {
      const meta: VanillaDbCacheColumnMeta = {
        name: column.name,
        fieldType: column.fieldType,
        offset: payloadCursor,
        length: column.payload.length,
        checksum: checksumBytes(column.payload),
      };
      if (isStringCellType(column.fieldType)) {
        meta.probeChecksum = checksumBytes(column.payload.subarray(0, VANILLA_DB_CACHE_DICTIONARY_PROBE_BYTES));
      }
      // Set only when true, so the metadata says what readDBPackedFiles puts on the cell.
      if (column.isKey) meta.isKey = true;
      sections.push(column.payload);
      payloadCursor += column.payload.length;

      if (column.presentPayload) {
        meta.presentOffset = payloadCursor;
        meta.presentLength = column.presentPayload.length;
        meta.presentChecksum = checksumBytes(column.presentPayload);
        sections.push(column.presentPayload);
        payloadCursor += column.presentPayload.length;
      }
      columnMetas.push(meta);
    }

    tables.push({
      packedFilePath,
      dbName: parseDBTablePath(packedFilePath)?.dbName ?? packedFilePath,
      rowCount: rows.length,
      schemaVersion: dbVersion.version,
      packedFileVersion,
      guid,
      columns: columnMetas,
    });
  }

  const meta: VanillaDbCacheMeta = {
    game: identity.game,
    payloadBytes: payloadCursor,
    dbPackPath: identity.dbPackPath,
    dbPackSize: identity.dbPackSize,
    dbPackMtimeMs: identity.dbPackMtimeMs,
    schemaHash: identity.schemaHash,
    pool: {
      offset: 0,
      length: pool.bytes.length,
      count: pool.count,
      checkpointsOffset: pool.bytes.length,
      checkpointsLength: poolCheckpointBytes.length,
      checksum: checksumBytes(pool.bytes),
      checkpointsChecksum: checksumBytes(poolCheckpointBytes),
      chunkChecksums: Array.from(pool.checkpoints, (chunkStart, chunkIndex) => {
        const chunkEnd = pool.checkpoints[chunkIndex + 1] ?? pool.bytes.length;
        return checksumBytes(pool.bytes.subarray(chunkStart, chunkEnd));
      }),
    },
    tables,
  };
  if (identity.dbPackMtimeNs !== undefined) meta.dbPackMtimeNs = identity.dbPackMtimeNs;
  if (identity.dbPackCtimeNs !== undefined) meta.dbPackCtimeNs = identity.dbPackCtimeNs;
  if (identity.dbPackDev !== undefined) meta.dbPackDev = identity.dbPackDev;
  if (identity.dbPackIno !== undefined) meta.dbPackIno = identity.dbPackIno;
  if (identity.sourceFormat !== undefined) meta.sourceFormat = identity.sourceFormat;
  if (identity.decoderRevision !== undefined) meta.decoderRevision = identity.decoderRevision;

  const metaJson = encodeVanillaDbCacheMetaBlock(meta);
  const header = encodeVanillaDbCacheHeader(metaJson.length);
  const payloadBytes = sections.reduce((total, section) => total + section.length, 0);

  const bytes = new Uint8Array(header.length + metaJson.length + payloadBytes);
  bytes.set(header, 0);
  bytes.set(metaJson, header.length);
  let offset = header.length + metaJson.length;
  for (const section of sections) {
    bytes.set(section, offset);
    offset += section.length;
  }

  return { bytes, meta, skipped };
};
