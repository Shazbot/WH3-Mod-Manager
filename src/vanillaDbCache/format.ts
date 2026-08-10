import * as zlib from "zlib";
import { SCHEMA_FIELD_TYPE } from "../packFileTypes";

/**
 * On-disk layout of the vanilla DB cache.
 *
 * ```
 * [0,  4)            magic "WDBC"
 * [4,  8)            u32 format version
 * [8, 12)            u32 length of the metadata JSON
 * [12, 12 + n)       metadata JSON, utf8
 * [12 + n, end)      the payload: the string pool and its checkpoints, then each table's columns
 * ```
 *
 * **Offsets in the metadata are relative to the start of the payload**, which the reader locates as
 * `12 + metaJsonLength`. Absolute offsets would depend on the length of the JSON that contains them,
 * so writing one could change another.
 *
 * The metadata is JSON rather than a packed binary directory. It is read once, it is a fraction of a
 * percent of the file, and a directory is exactly the sort of thing where a silent offset bug turns
 * one table's bytes into another's. The parts where size actually matters - the pool and the columns -
 * are binary.
 *
 * Blocks are stored uncompressed. Measured over WH3 the whole file is about 12 MB, and zstd would take
 * it to roughly 8; that is not worth making every table read asynchronous and adding a decompress step
 * to the path this cache exists to make fast. Per-block compression can be added later without moving
 * anything, since blocks are already addressed by offset and length.
 */

export const VANILLA_DB_CACHE_MAGIC = "WDBC";

/**
 * Bumped whenever the bytes stop meaning what an older reader thinks they mean. A mismatch rebuilds.
 *
 * 2: the metadata block is gzipped.
 * 3: independently-read payload blocks carry checksums.
 */
export const VANILLA_DB_CACHE_VERSION = 3;

export const VANILLA_DB_CACHE_HEADER_BYTES = 12;

/**
 * Prefix stored and verified when search needs only a string column's dictionary. Enough for roughly
 * a thousand distinct values; a larger dictionary falls back to reading and verifying the full column.
 */
export const VANILLA_DB_CACHE_DICTIONARY_PROBE_BYTES = 2048;

export interface VanillaDbCacheColumnMeta {
  name: string;
  fieldType: SCHEMA_FIELD_TYPE;
  /**
   * Present and true only for key fields, matching readDBPackedFiles, which sets `isKey` on the cell
   * when the schema says so and leaves the property off entirely otherwise.
   */
  isKey?: boolean;
  /** Payload-relative offset of the column: numeric values, or string ids into the pool. */
  offset: number;
  length: number;
  checksum: number;
  /** Checksum of the bounded prefix used to read a string dictionary without its row payload. */
  probeChecksum?: number;
  /**
   * OptionalStringU8 only: the presence byte per row, stored as its own numeric column.
   *
   * It cannot be folded into the string column because only the byte 1 makes a string present, and
   * any other byte has to come back as itself.
   */
  presentOffset?: number;
  presentLength?: number;
  presentChecksum?: number;
}

export interface VanillaDbCacheTableMeta {
  /** Full packed file path, e.g. `db\main_units_tables\data__`. */
  packedFilePath: string;
  dbName: string;
  rowCount: number;
  /** Version of the schema the rows were parsed with, which fixes the column layout. */
  schemaVersion: number;
  /** Version marker found in the packed file, absent when it carried none. */
  packedFileVersion?: number;
  guid?: string;
  columns: VanillaDbCacheColumnMeta[];
}

export interface VanillaDbCacheMeta {
  game: string;
  /** Total payload bytes, used to check the derived offsets landed where the builder put things. */
  payloadBytes: number;
  /** Identity of the pack the cache was built from, so a patched game invalidates it. */
  dbPackPath: string;
  dbPackSize: number;
  dbPackMtimeMs: number;
  /**
   * sha1 of the bundled schema file. A schema correction can change a table's field list without the
   * pack changing at all, and decoding against the wrong layout usually still parses.
   */
  schemaHash: string;
  pool: {
    offset: number;
    length: number;
    count: number;
    checkpointsOffset: number;
    checkpointsLength: number;
    checksum: number;
    checkpointsChecksum: number;
    /** One checksum per independently-readable front-coded checkpoint chunk. */
    chunkChecksums: number[];
  };
  tables: VanillaDbCacheTableMeta[];
}

export interface VanillaDbCacheIdentity {
  game: string;
  dbPackSize: number;
  dbPackMtimeMs: number;
  schemaHash: string;
}

/** Whether a cache was built from the same inputs the caller has now. */
export const isVanillaDbCacheCurrent = (
  meta: VanillaDbCacheMeta,
  identity: VanillaDbCacheIdentity,
): boolean =>
  meta.game === identity.game &&
  meta.dbPackSize === identity.dbPackSize &&
  meta.dbPackMtimeMs === identity.dbPackMtimeMs &&
  meta.schemaHash === identity.schemaHash;

/**
 * Wire form of the metadata.
 *
 * The obvious encoding - one JSON object per column - spent 1.22 MB on 1520 tables, most of it the
 * words `name`, `fieldType`, `offset` and `length` repeated 6792 times. Tuples with a shared field
 * type list cut that to a fraction, with none of the decompression a zstd block would need on a
 * structure that is read whole on open.
 *
 * Offsets are not stored at all. The builder writes the payload in exactly the order it lists here, so
 * the reader recovers every offset by accumulating lengths - and `payloadBytes` catches it if the two
 * ever disagree about that order.
 */
interface CompactColumn extends Array<unknown> {
  /** name */
  0: string;
  /** index into `fieldTypes` */
  1: number;
  /** payload length */
  2: number;
  /** checksum */
  3: number;
  /** bit 0: is a key field. bit 1: has a presence column. */
  4: number;
  /** presence column length, when bit 1 is set */
  5?: number;
  /** presence column checksum, when bit 1 is set */
  6?: number;
  /** bounded-prefix checksum for string columns */
  7?: number;
}

const COLUMN_FLAG_IS_KEY = 1;
const COLUMN_FLAG_HAS_PRESENCE = 2;

interface CompactMeta {
  game: string;
  dbPackPath: string;
  dbPackSize: number;
  dbPackMtimeMs: number;
  schemaHash: string;
  payloadBytes: number;
  fieldTypes: SCHEMA_FIELD_TYPE[];
  /** [poolLength, poolCount, checkpointsLength, poolChecksum, checkpointsChecksum, chunkChecksums] */
  pool: [number, number, number, number, number, number[]];
  /** [packedFilePath, rowCount, schemaVersion, packedFileVersion, guid, columns] */
  tables: Array<[string, number, number, number | null, string | null, CompactColumn[]]>;
}

export const encodeVanillaDbCacheMeta = (meta: VanillaDbCacheMeta): string => {
  const fieldTypes: SCHEMA_FIELD_TYPE[] = [];
  const fieldTypeIndex = new Map<SCHEMA_FIELD_TYPE, number>();
  const indexOfFieldType = (fieldType: SCHEMA_FIELD_TYPE): number => {
    let index = fieldTypeIndex.get(fieldType);
    if (index === undefined) {
      index = fieldTypes.length;
      fieldTypes.push(fieldType);
      fieldTypeIndex.set(fieldType, index);
    }
    return index;
  };

  const compact: CompactMeta = {
    game: meta.game,
    dbPackPath: meta.dbPackPath,
    dbPackSize: meta.dbPackSize,
    dbPackMtimeMs: meta.dbPackMtimeMs,
    schemaHash: meta.schemaHash,
    payloadBytes: meta.payloadBytes,
    fieldTypes,
    pool: [
      meta.pool.length,
      meta.pool.count,
      meta.pool.checkpointsLength,
      meta.pool.checksum,
      meta.pool.checkpointsChecksum,
      meta.pool.chunkChecksums,
    ],
    tables: meta.tables.map((table) => [
      table.packedFilePath,
      table.rowCount,
      table.schemaVersion,
      table.packedFileVersion ?? null,
      table.guid ?? null,
      table.columns.map((column) => {
        const flags =
          (column.isKey ? COLUMN_FLAG_IS_KEY : 0) |
          (column.presentLength != undefined ? COLUMN_FLAG_HAS_PRESENCE : 0);
        const compactColumn = [
          column.name,
          indexOfFieldType(column.fieldType),
          column.length,
          column.checksum,
          flags,
        ] as unknown as CompactColumn;
        if (column.presentLength != undefined) {
          compactColumn[5] = column.presentLength;
          compactColumn[6] = column.presentChecksum;
        }
        if (column.probeChecksum != undefined) compactColumn[7] = column.probeChecksum;
        return compactColumn;
      }),
    ]),
  };

  // fieldTypes is filled while mapping the tables above, so it must be stringified after that runs.
  return JSON.stringify(compact);
};

/**
 * Rebuilds the metadata, deriving every offset from the order things were written in.
 *
 * Returns undefined rather than throwing on anything malformed, including a payload total that does
 * not match what the offsets add up to - that would mean the reader and the builder disagree about
 * the layout, and every read after it would quietly return another column's bytes.
 */
export const decodeVanillaDbCacheMeta = (json: string): VanillaDbCacheMeta | undefined => {
  try {
    const compact = JSON.parse(json) as CompactMeta;
    if (!compact?.tables || !compact.pool || !compact.fieldTypes) return undefined;

    const [
      poolLength,
      poolCount,
      checkpointsLength,
      poolChecksum,
      checkpointsChecksum,
      chunkChecksums,
    ] = compact.pool;
    if (
      !Number.isInteger(poolChecksum) ||
      !Number.isInteger(checkpointsChecksum) ||
      !Array.isArray(chunkChecksums)
    ) {
      return undefined;
    }
    let cursor = 0;
    const poolOffset = cursor;
    cursor += poolLength;
    const checkpointsOffset = cursor;
    cursor += checkpointsLength;

    const tables: VanillaDbCacheTableMeta[] = compact.tables.map(
      ([packedFilePath, rowCount, schemaVersion, packedFileVersion, guid, columns]) => {
        const decodedColumns: VanillaDbCacheColumnMeta[] = columns.map((column) => {
          const [name, fieldTypeIdx, length, checksum, flags] = column;
          if (!Number.isInteger(checksum)) throw new Error("missing column checksum");
          const decoded: VanillaDbCacheColumnMeta = {
            name,
            fieldType: compact.fieldTypes[fieldTypeIdx],
            offset: cursor,
            length,
            checksum,
          };
          cursor += length;
          if (flags & COLUMN_FLAG_IS_KEY) decoded.isKey = true;
          if (flags & COLUMN_FLAG_HAS_PRESENCE) {
            decoded.presentOffset = cursor;
            decoded.presentLength = column[5] ?? 0;
            decoded.presentChecksum = column[6];
            if (!Number.isInteger(decoded.presentChecksum)) {
              throw new Error("missing presence checksum");
            }
            cursor += decoded.presentLength;
          }
          if (column[7] != undefined) {
            if (!Number.isInteger(column[7])) throw new Error("invalid probe checksum");
            decoded.probeChecksum = column[7];
          }
          return decoded;
        });

        const table: VanillaDbCacheTableMeta = {
          packedFilePath,
          dbName: parseTableName(packedFilePath),
          rowCount,
          schemaVersion,
          columns: decodedColumns,
        };
        if (packedFileVersion != null) table.packedFileVersion = packedFileVersion;
        if (guid != null) table.guid = guid;
        return table;
      },
    );

    if (cursor !== compact.payloadBytes) return undefined;

    return {
      game: compact.game,
      payloadBytes: compact.payloadBytes,
      dbPackPath: compact.dbPackPath,
      dbPackSize: compact.dbPackSize,
      dbPackMtimeMs: compact.dbPackMtimeMs,
      schemaHash: compact.schemaHash,
      pool: {
        offset: poolOffset,
        length: poolLength,
        count: poolCount,
        checkpointsOffset,
        checkpointsLength,
        checksum: poolChecksum,
        checkpointsChecksum,
        chunkChecksums,
      },
      tables,
    };
  } catch {
    return undefined;
  }
};

/**
 * The metadata block as stored: the compact JSON, gzipped.
 *
 * Compressed because it is the one part read whole on open - roughly 0.6 MB of the 1.3 MB a first
 * single-table request costs - so squeezing it buys latency at the price of a single inflate, with
 * nothing added to the per-table read path.
 *
 * gzip rather than zstd deliberately. `zlib.gunzipSync` exists in every Node the app could run on,
 * where `zstdDecompressSync` needs Node 22.15 or later; guessing wrong about the Node inside a given
 * Electron build would mean a synchronous call throwing at runtime. On JSON the two are close enough
 * that the certainty is worth more than the difference.
 */
export const encodeVanillaDbCacheMetaBlock = (meta: VanillaDbCacheMeta): Uint8Array =>
  zlib.gzipSync(Buffer.from(encodeVanillaDbCacheMeta(meta), "utf8"), { level: 9 });

/** Undefined for anything that will not inflate or parse, so a damaged cache reads as a miss. */
export const decodeVanillaDbCacheMetaBlock = (block: Uint8Array): VanillaDbCacheMeta | undefined => {
  try {
    return decodeVanillaDbCacheMeta(zlib.gunzipSync(Buffer.from(block)).toString("utf8"));
  } catch {
    return undefined;
  }
};

/** The table folder out of a packed file path, without pulling in the pack helpers. */
const parseTableName = (packedFilePath: string): string => {
  const parts = packedFilePath.split("\\");
  return parts.length >= 2 ? parts[parts.length - 2] : packedFilePath;
};

export const encodeVanillaDbCacheHeader = (metaJsonLength: number): Uint8Array => {
  const header = new Uint8Array(VANILLA_DB_CACHE_HEADER_BYTES);
  for (let index = 0; index < 4; index++) header[index] = VANILLA_DB_CACHE_MAGIC.charCodeAt(index);
  const view = new DataView(header.buffer);
  view.setUint32(4, VANILLA_DB_CACHE_VERSION, true);
  view.setUint32(8, metaJsonLength, true);
  return header;
};

/**
 * Reads the fixed header, or undefined when the bytes are not a cache this reader understands.
 *
 * Never throws: a truncated or stale file has to read as a miss so the caller rebuilds, not as a crash
 * on startup.
 */
export const decodeVanillaDbCacheHeader = (
  bytes: Uint8Array,
): { formatVersion: number; metaJsonLength: number } | undefined => {
  if (bytes.length < VANILLA_DB_CACHE_HEADER_BYTES) return undefined;
  for (let index = 0; index < 4; index++) {
    if (bytes[index] !== VANILLA_DB_CACHE_MAGIC.charCodeAt(index)) return undefined;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatVersion = view.getUint32(4, true);
  if (formatVersion !== VANILLA_DB_CACHE_VERSION) return undefined;
  return { formatVersion, metaJsonLength: view.getUint32(8, true) };
};
