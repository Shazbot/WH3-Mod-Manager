import { DBVersion, PackedFile, SchemaField } from "../packFileTypes";
import { parseDBTablePath } from "../utility/packFileHelpers";
import {
  isEncodableCellType,
  isStringCellType,
  readNumericCell,
  readOptionalPresentByte,
  readStringCell,
} from "./cellFields";
import { encodeDictionaryColumn, encodeNumericColumn } from "./columnCodec";
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

/**
 * Builds the cache from packed files that `readPack` has already parsed.
 *
 * Takes parsed packed files rather than a path on purpose: the pack reader defines what a cell means,
 * and parsing again here would be a second implementation to keep in step with it. The schema lookup
 * is injected for the same reason - it keeps this a pure function over its inputs, testable without
 * Electron, the schema globals or a game install.
 */

/** Resolves the DBVersion a packed file's rows were parsed with, matching what readPack chose. */
export type ResolveTableSchema = (packedFile: PackedFile) => DBVersion | undefined;

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

/** Rows of cells, sliced out of the flat per-cell array readPack produces. */
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
  identity: VanillaDbCacheIdentity & { dbPackPath: string },
): BuildVanillaDbCacheResult => {
  const skipped: BuildVanillaDbCacheResult["skipped"] = [];

  // Every string is collected before any column is encoded: a column stores pool ids, an id is a rank
  // in the sorted pool, and a rank is only final once the pool holds everything.
  const poolValues = new Set<string>([""]);
  const parsedTables: Array<{ packedFile: PackedFile; dbVersion: DBVersion; rows: SchemaField[][] }> = [];

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
    const unsupported = dbVersion.fields.find((schemaField) => !isEncodableCellType(schemaField.field_type));
    if (unsupported) {
      // parseTypeBuffer has no case for this type, so the rows it produced are misaligned from the
      // field it gave up on onwards. Storing them would preserve the damage, not the data.
      skipped.push({
        packedFilePath: packedFile.name,
        reason: `unsupported field type ${unsupported.field_type}`,
      });
      continue;
    }

    const rows = chunkIntoRows(packedFile.schemaFields, dbVersion.fields.length);
    for (const row of rows) {
      for (let column = 0; column < dbVersion.fields.length; column++) {
        const fieldType = dbVersion.fields[column].field_type;
        if (isStringCellType(fieldType)) poolValues.add(readStringCell(fieldType, row[column].fields));
      }
    }
    parsedTables.push({ packedFile, dbVersion, rows });
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
  for (const { packedFile, dbVersion, rows } of parsedTables) {
    const columns: PendingColumn[] = [];

    for (let column = 0; column < dbVersion.fields.length; column++) {
      const { name, field_type: fieldType, is_key: isKey } = dbVersion.fields[column];

      if (!isStringCellType(fieldType)) {
        const values = rows.map((row) => readNumericCell(row[column].fields));
        columns.push({ name, fieldType, isKey, payload: encodeNumericColumn(values) });
        continue;
      }

      const poolIds = rows.map(
        (row) => poolIdByValue.get(readStringCell(fieldType, row[column].fields))!,
      );
      const payload = encodeDictionaryColumn(poolIds);

      // The presence byte gets its own column: only the byte 1 makes a string present, and any other
      // value has to come back as itself rather than as "absent".
      const presentPayload =
        fieldType === "OptionalStringU8"
          ? encodeNumericColumn(rows.map((row) => readOptionalPresentByte(row[column].fields)))
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
        meta.probeChecksum = checksumBytes(
          column.payload.subarray(0, VANILLA_DB_CACHE_DICTIONARY_PROBE_BYTES),
        );
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
      packedFilePath: packedFile.name,
      dbName: parseDBTablePath(packedFile.name)?.dbName ?? packedFile.name,
      rowCount: rows.length,
      schemaVersion: dbVersion.version,
      packedFileVersion: packedFile.version,
      guid: packedFile.guid,
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
