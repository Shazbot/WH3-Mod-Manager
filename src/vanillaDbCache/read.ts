import * as fs from "fs";
import { SchemaField } from "../packFileTypes";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { buildNumericCellFields, buildStringCellFields, isStringCellType } from "./cellFields";
import { checksumBytes } from "./checksum";
import { decodeDictionaryColumn, decodeDictionaryColumnIds, decodeI64Column, decodeNumericColumn } from "./columnCodec";
import { FRONT_CODED_CHECKPOINT_INTERVAL, FrontCodedBlock, readAllFrontCodedEntries } from "./frontCodedBlock";
import {
  VANILLA_DB_CACHE_HEADER_BYTES,
  VANILLA_DB_CACHE_DICTIONARY_PROBE_BYTES,
  VanillaDbCacheColumnMeta,
  VanillaDbCacheIdentity,
  VanillaDbCacheMeta,
  VanillaDbCacheTableMeta,
  decodeVanillaDbCacheHeader,
  decodeVanillaDbCacheMetaBlock,
  isVanillaDbCacheCurrent,
} from "./format";

/**
 * Lazy reader for the vanilla DB cache.
 *
 * Nothing is read until something is asked for, at four levels: the file is not opened until the first
 * request, a table's columns are read one table at a time, a column is decoded only when touched, and
 * the string pool is paged in chunks rather than held whole. Decoded data lives in a cache bounded by
 * **bytes**, not entries - the point of this format is that the base game data does not have to sit in
 * memory, and an unbounded cache would put it back there.
 */

/** Bytes of decoded columns and pool chunks to keep before evicting the least recently used. */
export const DEFAULT_DECODED_CACHE_BYTES = 16 * 1024 * 1024;

/** Where the reader gets its bytes. Abstracted so tests can serve them from memory and count reads. */
export interface VanillaDbCacheSource {
  read(offset: number, length: number): Uint8Array;
  /** Total bytes available, used to reject a file that was truncated mid-write. */
  readonly size: number;
  readonly bytesRead: number;
  close(): void;
}

export const createMemorySource = (bytes: Uint8Array): VanillaDbCacheSource => {
  let bytesRead = 0;
  return {
    read(offset, length) {
      bytesRead += length;
      return bytes.subarray(offset, offset + length);
    },
    size: bytes.length,
    get bytesRead() {
      return bytesRead;
    },
    close() {
      // Nothing to release.
    },
  };
};

export const createFileSource = (filePath: string): VanillaDbCacheSource => {
  const fileId = fs.openSync(filePath, "r");
  return createFileSourceFromFd(fileId);
};

/** Takes ownership of an already-authorized readonly descriptor. */
export const createFileSourceFromFd = (fileId: number): VanillaDbCacheSource => {
  const size = fs.fstatSync(fileId).size;
  let bytesRead = 0;
  return {
    read(offset, length) {
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fileId, buffer, 0, length, offset);
      bytesRead += length;
      return buffer;
    },
    size,
    get bytesRead() {
      return bytesRead;
    },
    close() {
      fs.closeSync(fileId);
    },
  };
};

/** The furthest byte anything in the metadata points at. */
const requiredFileSize = (meta: VanillaDbCacheMeta, payloadStart: number): number => {
  let furthest = Math.max(
    meta.pool.offset + meta.pool.length,
    meta.pool.checkpointsOffset + meta.pool.checkpointsLength,
  );
  for (const table of meta.tables) {
    for (const column of table.columns) {
      furthest = Math.max(furthest, column.offset + column.length);
      if (column.presentOffset != undefined && column.presentLength != undefined) {
        furthest = Math.max(furthest, column.presentOffset + column.presentLength);
      }
    }
  }
  return payloadStart + furthest;
};

interface CacheEntry {
  value: unknown;
  bytes: number;
}

/** Map-reinsertion LRU bounded by the size of what it holds rather than how many things it holds. */
class SizedCache {
  private entries = new Map<string, CacheEntry>();
  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {}

  get decodedBytes(): number {
    return this.totalBytes;
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Reinsertion is what makes Map iteration order an LRU order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set(key: string, value: unknown, bytes: number): void {
    const existing = this.entries.get(key);
    if (existing) this.totalBytes -= existing.bytes;
    this.entries.delete(key);
    // One large value must not escape the byte cap just because it is the only entry.
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.totalBytes += bytes;

    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest?.bytes ?? 0;
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }
}

export interface VanillaDbCacheStats {
  /** Bytes pulled from the source. Watching this is how laziness stays honest. */
  bytesRead: number;
  /** Bytes of decoded columns and pool chunks currently held. */
  decodedBytes: number;
}

export interface VanillaDbCacheReader {
  readonly meta: VanillaDbCacheMeta;
  /** Decoded data currently held plus the immutable table directory. */
  readonly residentBytes: number;
  listTablePaths(): string[];
  getTableMeta(packedFilePath: string): VanillaDbCacheTableMeta | undefined;
  /** Cells for a whole table, in the shape readPack produces: one flat array of rows of cells. */
  getTableRows(packedFilePath: string): SchemaField[][] | undefined;
  /** One string per row for a string column, resolved through the pool. */
  getColumnStrings(packedFilePath: string, columnName: string): string[] | undefined;
  /** One number per row for a numeric column. */
  getColumnNumbers(packedFilePath: string, columnName: string): Float64Array | undefined;
  /** Exact I64 values as decimal strings, without passing through JavaScript Number. */
  getColumnI64Strings(packedFilePath: string, columnName: string): string[] | undefined;
  /** Rows as JSON-safe typed values: I64 strings, optional strings as null, and booleans as booleans. */
  getTypedTableRows(packedFilePath: string): Array<Record<string, VanillaDbCacheTypedValue>> | undefined;
  /** The distinct pool ids a string column holds, ascending, without expanding its rows. */
  getColumnPoolIds(packedFilePath: string, columnName: string): Uint32Array | undefined;
  /** One pool id per row of a string column. */
  getColumnPoolIdsPerRow(packedFilePath: string, columnName: string): Uint32Array | undefined;
  /** The whole string pool as one block, for prefix ranges and scans. */
  getPoolBlock(): FrontCodedBlock;
  /** Visits the pool in sorted-id order while keeping only size-capped chunks decoded. */
  forEachPoolValue(visitor: (value: string, poolId: number) => boolean | void): void;
  resolvePoolValue(poolId: number): string | undefined;
  stats(): VanillaDbCacheStats;
  close(): void;
}

export type VanillaDbCacheTypedValue = string | number | boolean | null;

export class VanillaDbCacheIntegrityError extends Error {
  constructor(blockName: string) {
    super(`vanilla DB cache block failed its checksum: ${blockName}`);
    this.name = "VanillaDbCacheIntegrityError";
  }
}

const verifyBlock = (bytes: Uint8Array, expectedChecksum: number, blockName: string): Uint8Array => {
  if (checksumBytes(bytes) !== expectedChecksum) throw new VanillaDbCacheIntegrityError(blockName);
  return bytes;
};

/**
 * Opens a cache, or returns undefined when it cannot be used.
 *
 * Never throws. A truncated, corrupt, stale or foreign file has to read as a miss so the caller falls
 * back to reading the pack, rather than taking the app down.
 */
export const openVanillaDbCache = (
  source: VanillaDbCacheSource,
  identity?: VanillaDbCacheIdentity,
  maxDecodedBytes = DEFAULT_DECODED_CACHE_BYTES,
): VanillaDbCacheReader | undefined => {
  let meta: VanillaDbCacheMeta;
  let payloadStart: number;
  let poolCheckpoints: Uint32Array;

  try {
    const header = decodeVanillaDbCacheHeader(source.read(0, VANILLA_DB_CACHE_HEADER_BYTES));
    if (!header) return undefined;

    const metaBlock = source.read(VANILLA_DB_CACHE_HEADER_BYTES, header.metaJsonLength);
    const decodedMeta = decodeVanillaDbCacheMetaBlock(metaBlock);
    if (!decodedMeta) return undefined;
    meta = decodedMeta;
    if (identity && !isVanillaDbCacheCurrent(meta, identity)) return undefined;

    payloadStart = VANILLA_DB_CACHE_HEADER_BYTES + header.metaJsonLength;

    // A file cut short mid-write still has a valid header and metadata, and would then hand back
    // short buffers that decode into plausible nonsense instead of failing.
    if (source.size < requiredFileSize(meta, payloadStart)) return undefined;

    // The only part read up front. It is what makes the pool addressable by rank without holding it.
    const checkpointBytes = verifyBlock(
      source.read(payloadStart + meta.pool.checkpointsOffset, meta.pool.checkpointsLength),
      meta.pool.checkpointsChecksum,
      "string pool checkpoints",
    );
    poolCheckpoints = new Uint32Array(
      checkpointBytes.buffer.slice(checkpointBytes.byteOffset, checkpointBytes.byteOffset + checkpointBytes.byteLength),
    );
    if (
      poolCheckpoints.length !== Math.ceil(meta.pool.count / FRONT_CODED_CHECKPOINT_INTERVAL) ||
      meta.pool.chunkChecksums.length !== poolCheckpoints.length
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const decoded = new SizedCache(maxDecodedBytes);
  const tableByPath = new Map<string, VanillaDbCacheTableMeta>();
  for (const table of meta.tables) {
    const key = normalizePackFilePathKey(table.packedFilePath);
    if (tableByPath.has(key)) {
      decoded.clear();
      return undefined;
    }
    tableByPath.set(key, table);
  }
  const getTable = (packedFilePath: string): VanillaDbCacheTableMeta | undefined =>
    tableByPath.get(normalizePackFilePathKey(packedFilePath));

  const readPoolChunk = (chunkIndex: number): string[] => {
    const cacheKey = `pool:${chunkIndex}`;
    const cached = decoded.get<string[]>(cacheKey);
    if (cached) return cached;

    const chunkStart = poolCheckpoints[chunkIndex];
    const chunkEnd = chunkIndex + 1 < poolCheckpoints.length ? poolCheckpoints[chunkIndex + 1] : meta.pool.length;
    const entriesInChunk = Math.min(
      FRONT_CODED_CHECKPOINT_INTERVAL,
      meta.pool.count - chunkIndex * FRONT_CODED_CHECKPOINT_INTERVAL,
    );

    // A chunk starts with a whole value, so it decodes without anything before it.
    const values = readAllFrontCodedEntries({
      bytes: verifyBlock(
        source.read(payloadStart + meta.pool.offset + chunkStart, chunkEnd - chunkStart),
        meta.pool.chunkChecksums[chunkIndex],
        `string pool chunk ${chunkIndex}`,
      ),
      checkpoints: new Uint32Array([0]),
      count: entriesInChunk,
    });

    decoded.set(
      cacheKey,
      values,
      values.reduce((total, value) => total + value.length * 2 + 16, 0),
    );
    return values;
  };

  const resolvePoolValue = (poolId: number): string | undefined => {
    if (poolId < 0 || poolId >= meta.pool.count) return undefined;
    const chunk = readPoolChunk(Math.floor(poolId / FRONT_CODED_CHECKPOINT_INTERVAL));
    return chunk[poolId % FRONT_CODED_CHECKPOINT_INTERVAL];
  };

  const columnSlice = (offset: number, length: number, checksum: number, blockName: string) =>
    verifyBlock(source.read(payloadStart + offset, length), checksum, blockName);

  const i64StringsFor = (tablePath: string, column: VanillaDbCacheColumnMeta): string[] => {
    const cacheKey = `i64:${tablePath}:${column.name}`;
    const cached = decoded.get<string[]>(cacheKey);
    if (cached) return cached;

    const values = decodeI64Column(
      columnSlice(column.offset, column.length, column.checksum, `${tablePath}:${column.name}`),
    );
    decoded.set(
      cacheKey,
      values,
      values.reduce((total, value) => total + value.length * 2 + 16, 0),
    );
    return values;
  };

  const numbersFor = (tablePath: string, column: VanillaDbCacheColumnMeta): Float64Array => {
    const cacheKey = `num:${tablePath}:${column.name}`;
    const cached = decoded.get<Float64Array>(cacheKey);
    if (cached) return cached;

    const values =
      column.fieldType === "I64"
        ? Float64Array.from(i64StringsFor(tablePath, column), Number)
        : decodeNumericColumn(
            columnSlice(column.offset, column.length, column.checksum, `${tablePath}:${column.name}`),
          );
    decoded.set(cacheKey, values, values.byteLength);
    return values;
  };

  const presenceFor = (tablePath: string, column: VanillaDbCacheColumnMeta): Float64Array | undefined => {
    if (column.presentOffset == undefined || column.presentLength == undefined) return undefined;
    const cacheKey = `present:${tablePath}:${column.name}`;
    const cached = decoded.get<Float64Array>(cacheKey);
    if (cached) return cached;

    const values = decodeNumericColumn(
      columnSlice(
        column.presentOffset,
        column.presentLength,
        column.presentChecksum!,
        `${tablePath}:${column.name}:presence`,
      ),
    );
    decoded.set(cacheKey, values, values.byteLength);
    return values;
  };

  const poolIdsFor = (tablePath: string, column: VanillaDbCacheColumnMeta): Uint32Array => {
    const cacheKey = `ids:${tablePath}:${column.name}`;
    const cached = decoded.get<Uint32Array>(cacheKey);
    if (cached) return cached;

    const ids = decodeDictionaryColumn(
      columnSlice(column.offset, column.length, column.checksum, `${tablePath}:${column.name}`),
    );
    decoded.set(cacheKey, ids, ids.byteLength);
    return ids;
  };

  const findColumn = (table: VanillaDbCacheTableMeta, columnName: string) =>
    table.columns.find((column) => column.name === columnName);

  const stringsFor = (tablePath: string, column: VanillaDbCacheColumnMeta): string[] => {
    const ids = poolIdsFor(tablePath, column);
    const byId = new Map<number, string>();
    const values: string[] = new Array(ids.length);
    for (let row = 0; row < ids.length; row++) {
      let value = byId.get(ids[row]);
      if (value === undefined) {
        value = resolvePoolValue(ids[row]) ?? "";
        byId.set(ids[row], value);
      }
      values[row] = value;
    }
    return values;
  };

  return {
    meta,

    get residentBytes() {
      return decoded.decodedBytes + JSON.stringify(meta).length * 2 + tableByPath.size * 96;
    },

    listTablePaths: () => meta.tables.map((table) => table.packedFilePath),

    getTableMeta: (packedFilePath) => getTable(packedFilePath),

    getColumnNumbers(packedFilePath, columnName) {
      const table = getTable(packedFilePath);
      const column = table && findColumn(table, columnName);
      if (!table || !column || isStringCellType(column.fieldType)) return undefined;
      return numbersFor(table.packedFilePath, column);
    },

    getColumnI64Strings(packedFilePath, columnName) {
      const table = getTable(packedFilePath);
      const column = table && findColumn(table, columnName);
      if (!table || !column || column.fieldType !== "I64") return undefined;
      return i64StringsFor(table.packedFilePath, column);
    },

    getColumnPoolIds(packedFilePath, columnName) {
      const table = getTable(packedFilePath);
      const column = table && findColumn(table, columnName);
      if (!table || !column || !isStringCellType(column.fieldType)) return undefined;

      const tablePath = table.packedFilePath;
      const cacheKey = `dict:${tablePath}:${columnName}`;
      const cached = decoded.get<Uint32Array>(cacheKey);
      if (cached) return cached;

      // The dictionary sits at the head of the column, so a bounded prefix usually has all of it and
      // the row data - most of the column - is never read. Only a column with an unusually large
      // dictionary needs the whole thing.
      const probeLength = Math.min(column.length, VANILLA_DB_CACHE_DICTIONARY_PROBE_BYTES);
      let ids = decodeDictionaryColumnIds(
        verifyBlock(
          source.read(payloadStart + column.offset, probeLength),
          column.probeChecksum!,
          `${tablePath}:${columnName}:dictionary probe`,
        ),
      );
      if (!ids && probeLength < column.length) {
        ids = decodeDictionaryColumnIds(
          columnSlice(column.offset, column.length, column.checksum, `${tablePath}:${columnName}`),
        );
      }
      if (!ids) return undefined;

      decoded.set(cacheKey, ids, ids.byteLength);
      return ids;
    },

    getColumnPoolIdsPerRow(packedFilePath, columnName) {
      const table = getTable(packedFilePath);
      const column = table && findColumn(table, columnName);
      if (!table || !column || !isStringCellType(column.fieldType)) return undefined;
      return poolIdsFor(table.packedFilePath, column);
    },

    getPoolBlock() {
      // The pool as one block. Reading it whole is the opposite of how everything else here works, so
      // it is only for scans and prefix ranges - operations that would touch most of it anyway.
      const cacheKey = "pool:whole";
      const cached = decoded.get<FrontCodedBlock>(cacheKey);
      if (cached) return cached;

      const block: FrontCodedBlock = {
        bytes: verifyBlock(
          source.read(payloadStart + meta.pool.offset, meta.pool.length),
          meta.pool.checksum,
          "string pool",
        ),
        checkpoints: poolCheckpoints,
        count: meta.pool.count,
      };
      decoded.set(cacheKey, block, block.bytes.length);
      return block;
    },

    forEachPoolValue(visitor) {
      for (let chunkIndex = 0; chunkIndex < poolCheckpoints.length; chunkIndex++) {
        const values = readPoolChunk(chunkIndex);
        const firstPoolId = chunkIndex * FRONT_CODED_CHECKPOINT_INTERVAL;
        for (let index = 0; index < values.length; index++) {
          if (visitor(values[index], firstPoolId + index) === false) return;
        }
      }
    },

    getColumnStrings(packedFilePath, columnName) {
      const table = getTable(packedFilePath);
      const column = table && findColumn(table, columnName);
      if (!table || !column || !isStringCellType(column.fieldType)) return undefined;
      return stringsFor(table.packedFilePath, column);
    },

    getTableRows(packedFilePath) {
      const table = getTable(packedFilePath);
      if (!table) return undefined;
      const tablePath = table.packedFilePath;

      const columnValues = table.columns.map((column) => {
        if (!isStringCellType(column.fieldType)) {
          return { column, numbers: numbersFor(tablePath, column) };
        }
        const ids = poolIdsFor(tablePath, column);
        const byId = new Map<number, string>();
        const strings: string[] = new Array(ids.length);
        for (let row = 0; row < ids.length; row++) {
          let value = byId.get(ids[row]);
          if (value === undefined) {
            value = resolvePoolValue(ids[row]) ?? "";
            byId.set(ids[row], value);
          }
          strings[row] = value;
        }
        return { column, strings, presence: presenceFor(tablePath, column) };
      });

      const rows: SchemaField[][] = new Array(table.rowCount);
      for (let row = 0; row < table.rowCount; row++) {
        const cells: SchemaField[] = new Array(table.columns.length);
        for (let index = 0; index < columnValues.length; index++) {
          const entry = columnValues[index];
          const { column } = entry;
          const cell: SchemaField = {
            type: column.fieldType,
            fields: entry.strings
              ? buildStringCellFields(column.fieldType, entry.strings[row], entry.presence?.[row] ?? 0)
              : buildNumericCellFields(column.fieldType, entry.numbers![row]),
          };
          // Only when the schema said so, matching the cell readDBPackedFiles builds.
          if (column.isKey) cell.isKey = true;
          cells[index] = cell;
        }
        rows[row] = cells;
      }
      return rows;
    },

    getTypedTableRows(packedFilePath) {
      const table = getTable(packedFilePath);
      if (!table) return undefined;
      const tablePath = table.packedFilePath;

      const columnValues = table.columns.map((column) => {
        if (column.fieldType === "I64") {
          const i64 = i64StringsFor(tablePath, column);
          if (i64.length !== table.rowCount) {
            throw new Error(`I64 column ${column.name} has ${i64.length} rows; expected ${table.rowCount}`);
          }
          return { column, i64 };
        }
        if (isStringCellType(column.fieldType)) {
          const strings = stringsFor(tablePath, column);
          if (strings.length !== table.rowCount) {
            throw new Error(`String column ${column.name} has ${strings.length} rows; expected ${table.rowCount}`);
          }
          const presence = presenceFor(tablePath, column);
          if (column.fieldType === "OptionalStringU8" && !presence) {
            throw new Error(`Optional string column ${column.name} has no presence column`);
          }
          if (presence && presence.length !== table.rowCount) {
            throw new Error(`Presence column ${column.name} has ${presence.length} rows; expected ${table.rowCount}`);
          }
          if (column.fieldType === "OptionalStringU8") {
            for (const value of presence!) {
              if (value !== 0 && value !== 1) {
                throw new Error(`Invalid OptionalStringU8 presence byte ${value} in column ${column.name}`);
              }
            }
          }
          return {
            column,
            strings,
            presence,
          };
        }
        const numbers = numbersFor(tablePath, column);
        if (numbers.length !== table.rowCount) {
          throw new Error(`Numeric column ${column.name} has ${numbers.length} rows; expected ${table.rowCount}`);
        }
        return { column, numbers };
      });

      const rows: Array<Record<string, VanillaDbCacheTypedValue>> = new Array(table.rowCount);
      for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex++) {
        const row: Record<string, VanillaDbCacheTypedValue> = {};
        for (const entry of columnValues) {
          const { column } = entry;
          if (entry.i64) {
            row[column.name] = entry.i64[rowIndex];
          } else if (entry.strings) {
            row[column.name] =
              column.fieldType === "OptionalStringU8" && entry.presence?.[rowIndex] !== 1
                ? null
                : entry.strings[rowIndex];
          } else if (column.fieldType === "Boolean") {
            const value = entry.numbers![rowIndex];
            if (value !== 0 && value !== 1) {
              throw new Error(`Invalid Boolean value ${value} in column ${column.name}`);
            }
            row[column.name] = value === 1;
          } else {
            const value = entry.numbers![rowIndex];
            if (!Number.isFinite(value)) {
              throw new Error(`Non-finite numeric value ${value} in column ${column.name}`);
            }
            row[column.name] = value;
          }
        }
        rows[rowIndex] = row;
      }
      return rows;
    },

    resolvePoolValue,

    stats: () => ({ bytesRead: source.bytesRead, decodedBytes: decoded.decodedBytes }),

    close() {
      decoded.clear();
      source.close();
    },
  };
};
