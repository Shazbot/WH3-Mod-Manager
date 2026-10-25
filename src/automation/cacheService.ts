import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { DBVersion } from "../packFileTypes";
import {
  DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES,
  DEFAULT_MAX_INDEX_BYTES,
  readPackIndex,
  readPayload,
  type CorePack,
  type CorePackEntry,
} from "../packCore";
import { parseDBTablePath, resolveParsedDBVersion } from "../utility/packFileHelpers";
import { normalizePackFilePath, normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { getSchemaFilePath, getSchemaForGame, clearSchemaCache } from "../schema";
import {
  VANILLA_DB_CACHE_DECODER_REVISION,
  VANILLA_DB_CACHE_EXACT_SOURCE_FORMAT,
  type VanillaDbCacheIdentity,
} from "../vanillaDbCache/format";
import { buildVanillaDbCacheFromTables } from "../vanillaDbCache/build";
import {
  DEFAULT_DECODED_CACHE_BYTES,
  VanillaDbCacheIntegrityError,
  createFileSourceFromFd,
  openVanillaDbCache,
  type VanillaDbCacheReader,
} from "../vanillaDbCache/read";
import {
  readExactVanillaLocEntries,
  indexExactVanillaLocPackSet,
  VanillaLocSourceReadCanceled,
  type ExactVanillaLocFileOrder,
} from "../vanillaLocCache/exactSource";
import { buildVanillaLocCacheBytes } from "../vanillaLocCache/build";
import {
  createFileSource as createLocFileSource,
  createFileSourceFromFd as createLocFileSourceFromFd,
  createMemorySource as createLocMemorySource,
  openVanillaLocCache,
  type VanillaLocCacheReader,
} from "../vanillaLocCache/read";
import { getVanillaLocCacheFilePath, getVanillaLocCacheIdentity } from "../vanillaLocCache/identity";
import {
  VANILLA_LOC_CACHE_DECODER_REVISION,
  VANILLA_LOC_CACHE_EXACT_SOURCE_FORMAT,
  VANILLA_LOC_UNKNOWN_ROW_INDEX,
} from "../vanillaLocCache/format";
import { publishCacheFiles } from "../vanillaCacheFiles";
import { canonicalizeExistingPath, type CanonicalFileIdentity } from "../vanillaCacheIdentity";
import { AutomationError, throwIfAborted, yieldToEventLoop } from "./errors";
import { FilesystemPolicy, normalizeInternalPackPath } from "./filesystem";
import { loadPackedTable, tableRowsToJson, type TableRow, type TableSchemaProvider } from "./tables";

export const DEFAULT_AUTOMATION_CACHE_MEMORY_MIB = 128;
export const MIN_AUTOMATION_CACHE_MEMORY_MIB = 1;
export const MAX_AUTOMATION_CACHE_MEMORY_MIB = 1024;
const DB_CODEC_REVISION = "packCore-typed-rows-v1";
const DEFAULT_GAME = "wh3" as const;

export interface ReadonlyTableData {
  /** Normalized internal packed path, not the host filesystem pack path. */
  packedPath: string;
  schema: Readonly<DBVersion>;
  isLoc: boolean;
  rows: readonly Readonly<TableRow>[];
}

export interface RawLocalizationEntry {
  rawText: string;
  packPath: string;
  filePath: string;
  rowIndex: number;
}

export interface RawLocalizationLookup {
  getRaw(key: string): RawLocalizationEntry | undefined;
  forEachEntry(
    visit: (key: string, entry: RawLocalizationEntry) => boolean | void | Promise<boolean | void>,
  ): Promise<void>;
}

export interface RawLocalizationLookupLease {
  lookup: RawLocalizationLookup;
  release(): void;
}

export interface AutomationCacheStats {
  enabled: boolean;
  memoryLimitBytes: number;
  retainedBytes: number;
  readerCount: number;
  maxReaders: number;
  entries: { packIndexes: number; typedTables: number; dbReaders: number; locReaders: number };
  hits: { packIndexes: number; typedTables: number; dbReaders: number; locReaders: number };
  misses: { packIndexes: number; typedTables: number; dbReaders: number; locReaders: number };
  sourceFallbacks: number;
  persistentWrites: number;
}

export interface AutomationCacheRequestOptions {
  policy: FilesystemPolicy;
  signal?: AbortSignal;
  schemaProvider?: TableSchemaProvider;
  maxLogicalPayloadBytes?: number;
  /** Writes, patching, validation, diff, clone, and subset may still share raw indexes only when true. */
  useIndexCache?: boolean;
  useTypedCache?: boolean;
}

export interface AutomationCacheRequestScope {
  readPackIndex(packPath: string): Promise<CorePack>;
  assertPackSnapshot(pack: CorePack): Promise<void>;
  getReadonlyTable(packPath: string, packedFilePath: string): Promise<ReadonlyTableData | undefined>;
  getVanillaRawLoc(
    packPaths: readonly string[],
    order?: ExactVanillaLocFileOrder,
  ): Promise<RawLocalizationLookupLease | undefined>;
  close(): void;
}

export interface AutomationCacheService {
  beginRequest(options: AutomationCacheRequestOptions): AutomationCacheRequestScope;
  validateConfiguredPaths(policy: FilesystemPolicy): Promise<void>;
  stats(): AutomationCacheStats;
  invalidatePath(filePath: string): void;
  close(): Promise<void>;
}

export interface AutomationCacheServiceOptions {
  /** Managed headless cache namespace. Omitted means memory only. */
  cacheDir?: string;
  /** Readonly candidate GUI cache namespace. */
  whmmCacheDir?: string;
  memoryMiB?: number;
  maxReaders?: number;
  /** Internal dependency injection for fixture schemas; never surfaced as a CLI/MCP option. */
  schemaFingerprint?: string | ((schema: Record<string, DBVersion[]>) => string);
  onWarning?: (message: string) => void;
}

interface RetainedEntry {
  key: string;
  kind: "index" | "table" | "dbReader" | "locReader";
  bytes: number;
  value: unknown;
  close?: () => void;
  pins: number;
  metadata?: unknown;
}

class RetainedBudget {
  private entries = new Map<string, RetainedEntry>();
  private retainedBytesValue = 0;
  private pendingReaders = 0;

  constructor(
    readonly maxBytes: number,
    readonly maxReaders: number,
  ) {}

  get retainedBytes(): number {
    return this.retainedBytesValue;
  }
  get readerCount(): number {
    return (
      this.pendingReaders +
      [...this.entries.values()].filter((entry) => entry.kind === "dbReader" || entry.kind === "locReader").length
    );
  }
  counts(): { packIndexes: number; typedTables: number; dbReaders: number; locReaders: number } {
    const entries = [...this.entries.values()];
    return {
      packIndexes: entries.filter((entry) => entry.kind === "index").length,
      typedTables: entries.filter((entry) => entry.kind === "table").length,
      dbReaders: entries.filter((entry) => entry.kind === "dbReader").length,
      locReaders: entries.filter((entry) => entry.kind === "locReader").length,
    };
  }

  get<T>(key: string): RetainedEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  reserveReaderSlot(): (() => void) | undefined {
    if (this.readerCount >= this.maxReaders) {
      const reader = [...this.entries.values()].find(
        (entry) => (entry.kind === "dbReader" || entry.kind === "locReader") && entry.pins === 0,
      );
      if (reader) this.drop(reader.key);
    }
    if (this.readerCount >= this.maxReaders) return undefined;
    this.pendingReaders++;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.pendingReaders--;
    };
  }

  admit(entry: RetainedEntry): boolean {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > this.maxBytes) return false;
    const old = this.entries.get(entry.key);
    if (old?.pins) return false;
    if (old) this.drop(entry.key);
    const isReader = entry.kind === "dbReader" || entry.kind === "locReader";
    while (this.retainedBytesValue + entry.bytes > this.maxBytes || (isReader && this.readerCount >= this.maxReaders)) {
      const victim = [...this.entries.values()].find((candidate) => candidate.pins === 0);
      if (!victim) return false;
      this.drop(victim.key);
    }
    this.entries.set(entry.key, entry);
    this.retainedBytesValue += entry.bytes;
    return true;
  }

  pin(key: string): RetainedEntry | undefined {
    const entry = this.get(key);
    if (entry) entry.pins++;
    return entry;
  }

  unpin(key: string): void {
    const entry = this.entries.get(key);
    if (entry && entry.pins > 0) entry.pins--;
  }

  drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.pins > 0) return;
    this.entries.delete(key);
    this.retainedBytesValue -= entry.bytes;
    try {
      entry.close?.();
    } catch {
      /* A closed reader is already evicted. */
    }
  }

  dropWhere(predicate: (entry: RetainedEntry) => boolean): void {
    for (const entry of [...this.entries.values()]) if (predicate(entry)) this.drop(entry.key);
  }

  dispose(): void {
    for (const entry of [...this.entries.values()]) {
      entry.pins = 0;
      this.drop(entry.key);
    }
  }
}

const deepFreeze = <T>(value: T): T => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
};

const cloneAndFreezeSchema = (schema: DBVersion): Readonly<DBVersion> =>
  deepFreeze(JSON.parse(JSON.stringify(schema)) as DBVersion);

const identityString = (identity: CanonicalFileIdentity): string =>
  JSON.stringify([
    identity.path,
    identity.size.toString(10),
    identity.mtimeNs.toString(10),
    identity.ctimeNs.toString(10),
    identity.dev.toString(10),
    identity.ino.toString(10),
  ]);

const identityFromDescriptor = (filePath: string, fd: number): CanonicalFileIdentity => {
  const canonicalPath = fs.realpathSync.native(filePath);
  const stats = fs.fstatSync(fd, { bigint: true });
  if (!stats.isFile()) throw new AutomationError("IO_ACCESS", `Path is not a regular file: ${filePath}`);
  return {
    path: canonicalPath,
    size: stats.size,
    mtimeMs: Number(stats.mtimeNs) / 1_000_000,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
    dev: stats.dev,
    ino: stats.ino,
  };
};

const descriptorMatchesPath = (expected: CanonicalFileIdentity): boolean => {
  let fd: number | undefined;
  try {
    fd = fs.openSync(expected.path, "r");
    return identityString(identityFromDescriptor(expected.path, fd)) === identityString(expected);
  } catch {
    return false;
  } finally {
    if (fd !== undefined)
      try {
        fs.closeSync(fd);
      } catch {
        /* Ignore cleanup errors. */
      }
  }
};

const openIdentity = async (
  requestedPath: string,
  policy: FilesystemPolicy,
): Promise<{ identity: CanonicalFileIdentity; fd: number }> => {
  const canonicalPath = await policy.assertReadPath(requestedPath);
  let fd: number | undefined;
  try {
    fd = fs.openSync(canonicalPath, "r");
    return { identity: identityFromDescriptor(canonicalPath, fd), fd };
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    throw error;
  }
};

const schemaLayoutMatches = (
  schema: DBVersion,
  table: { schemaVersion: number; columns: Array<{ name: string; fieldType: string }> },
): boolean =>
  schema.version === table.schemaVersion &&
  schema.fields.length === table.columns.length &&
  schema.fields.every(
    (field, index) => field.name === table.columns[index]?.name && field.field_type === table.columns[index]?.fieldType,
  );

const tablePathHash = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

const estimatePackBytes = (pack: CorePack): number => {
  let bytes =
    1024 +
    pack.header.headerBuffer.length +
    pack.header.rawHeader.length +
    pack.dependencyBytes.length +
    pack.trailingBytes.length;
  for (const dependency of pack.dependencies) bytes += dependency.length * 2 + 32;
  for (const entry of pack.entries) bytes += entry.name.length * 2 + 80;
  return bytes;
};

/** Conservative retained-data accounting; it is a logical budget estimate, not V8 heap measurement. */
const estimateRowsBytes = (data: ReadonlyTableData): number => {
  let bytes = 1024 + data.rows.length * 48;
  bytes += data.schema.fields.length * 96;
  for (const field of data.schema.fields) bytes += field.name.length * 2 + 32;
  for (const row of data.rows) {
    const entries = Object.entries(row);
    bytes += 64 + entries.length * 40;
    for (const [name, value] of entries) {
      bytes += name.length * 2 + (typeof value === "string" ? value.length * 2 + 24 : 16);
    }
  }
  return bytes;
};

const schemaFileHash = (game: "wh3"): string => {
  const schemaPath = getSchemaFilePath(game);
  return crypto.createHash("sha1").update(fs.readFileSync(schemaPath)).digest("hex");
};

const getDbCacheIdentity = (source: CanonicalFileIdentity, schemaHash: string): VanillaDbCacheIdentity => ({
  game: DEFAULT_GAME,
  dbPackPath: source.path,
  dbPackSize: Number(source.size),
  dbPackMtimeMs: source.mtimeMs,
  dbPackMtimeNs: source.mtimeNs.toString(10),
  dbPackCtimeNs: source.ctimeNs.toString(10),
  dbPackDev: source.dev.toString(10),
  dbPackIno: source.ino.toString(10),
  schemaHash,
  sourceFormat: VANILLA_DB_CACHE_EXACT_SOURCE_FORMAT,
  decoderRevision: VANILLA_DB_CACHE_DECODER_REVISION,
});

const dbSourceIdentityString = (identity: VanillaDbCacheIdentity): string =>
  JSON.stringify([
    identity.dbPackPath,
    String(identity.dbPackSize),
    identity.dbPackMtimeNs,
    identity.dbPackCtimeNs,
    identity.dbPackDev,
    identity.dbPackIno,
  ]);

const dbReaderIsProven = (reader: VanillaDbCacheReader, identity: VanillaDbCacheIdentity): boolean =>
  reader.meta.sourceFormat === VANILLA_DB_CACHE_EXACT_SOURCE_FORMAT &&
  reader.meta.decoderRevision === VANILLA_DB_CACHE_DECODER_REVISION &&
  reader.meta.dbPackMtimeNs !== undefined &&
  reader.meta.dbPackCtimeNs !== undefined &&
  reader.meta.dbPackDev !== undefined &&
  reader.meta.dbPackIno !== undefined &&
  reader.meta.dbPackPath === identity.dbPackPath &&
  reader.meta.dbPackSize === identity.dbPackSize &&
  reader.meta.dbPackMtimeNs === identity.dbPackMtimeNs &&
  reader.meta.dbPackCtimeNs === identity.dbPackCtimeNs &&
  reader.meta.dbPackDev === identity.dbPackDev &&
  reader.meta.dbPackIno === identity.dbPackIno &&
  reader.meta.schemaHash === identity.schemaHash;

const sourceLabelParts = (sourceLabel: string | undefined): { packPath: string; filePath: string } | undefined => {
  if (sourceLabel === undefined) return undefined;
  const separator = sourceLabel.indexOf("\0");
  if (separator <= 0 || separator === sourceLabel.length - 1) return undefined;
  return { packPath: sourceLabel.slice(0, separator), filePath: sourceLabel.slice(separator + 1) };
};

const sha256 = (value: string | Uint8Array): string => crypto.createHash("sha256").update(value).digest("hex");

const hashDescriptor = (fd: number): string => {
  const hash = crypto.createHash("sha256");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  const size = fs.fstatSync(fd).size;
  while (offset < size) {
    const read = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), offset);
    if (read === 0) throw new Error("Short read while hashing cache file");
    hash.update(chunk.subarray(0, read));
    offset += read;
  }
  return hash.digest("hex");
};

interface DbReaderRecord {
  reader: VanillaDbCacheReader;
  filePath: string;
  fileIdentity: string;
  sourcePath: string;
}

interface LocReaderRecord {
  reader: VanillaLocCacheReader;
  filePath?: string;
  stampPath?: string;
  fileIdentity?: string;
  stampIdentity?: string;
  sourcePaths: readonly string[];
  memoryBacked: boolean;
}

interface LoadedSchemaSnapshot {
  schema: Record<string, DBVersion[]>;
  fingerprint: string;
}

interface CacheCounters {
  hits: AutomationCacheStats["hits"];
  misses: AutomationCacheStats["misses"];
  sourceFallbacks: number;
  persistentWrites: number;
}

export const createAutomationCacheService = (options: AutomationCacheServiceOptions = {}): AutomationCacheService => {
  const memoryMiB = options.memoryMiB ?? DEFAULT_AUTOMATION_CACHE_MEMORY_MIB;
  if (
    !Number.isInteger(memoryMiB) ||
    memoryMiB < MIN_AUTOMATION_CACHE_MEMORY_MIB ||
    memoryMiB > MAX_AUTOMATION_CACHE_MEMORY_MIB
  ) {
    throw new RangeError(
      `cache memory must be between ${MIN_AUTOMATION_CACHE_MEMORY_MIB} and ${MAX_AUTOMATION_CACHE_MEMORY_MIB} MiB`,
    );
  }
  const maxReaders = options.maxReaders ?? 8;
  if (!Number.isInteger(maxReaders) || maxReaders < 1 || maxReaders > 8)
    throw new RangeError("maxReaders must be an integer from 1 through 8");
  const cacheDir = options.cacheDir ? path.resolve(options.cacheDir) : undefined;
  const whmmCacheDir = options.whmmCacheDir ? path.resolve(options.whmmCacheDir) : undefined;
  const budget = new RetainedBudget(memoryMiB * 1024 * 1024, maxReaders);
  const counters: CacheCounters = {
    hits: { packIndexes: 0, typedTables: 0, dbReaders: 0, locReaders: 0 },
    misses: { packIndexes: 0, typedTables: 0, dbReaders: 0, locReaders: 0 },
    sourceFallbacks: 0,
    persistentWrites: 0,
  };
  let closed = false;
  let warningSent = false;
  let defaultSchemaSnapshot: LoadedSchemaSnapshot | undefined;
  let activeScopes = 0;
  const scopeWaiters: Array<() => void> = [];
  const packIdentityByObject = new WeakMap<CorePack, string>();

  const warnOnce = (message: string): void => {
    if (warningSent) return;
    warningSent = true;
    options.onWarning?.(message);
  };

  const schemaSnapshot = async (
    request: AutomationCacheRequestOptions,
  ): Promise<{ snapshot: LoadedSchemaSnapshot; cacheable: boolean }> => {
    if (request.schemaProvider) {
      const loaded = await request.schemaProvider(DEFAULT_GAME);
      if (options.schemaFingerprint === undefined) {
        return { snapshot: { schema: loaded, fingerprint: "custom-uncached" }, cacheable: false };
      }
      const fingerprint =
        typeof options.schemaFingerprint === "function" ? options.schemaFingerprint(loaded) : options.schemaFingerprint;
      return { snapshot: { schema: loaded, fingerprint }, cacheable: true };
    }

    let currentHash: string;
    try {
      currentHash = schemaFileHash(DEFAULT_GAME);
    } catch {
      // Hashing is cache bookkeeping. Let the ordinary schema provider determine the operation's
      // result if the bundled file is missing or unreadable.
      const loaded = await getSchemaForGame(DEFAULT_GAME);
      return { snapshot: { schema: loaded, fingerprint: "unhashed-default-schema" }, cacheable: false };
    }
    if (defaultSchemaSnapshot?.fingerprint !== currentHash) {
      if (defaultSchemaSnapshot) {
        clearSchemaCache();
        budget.dropWhere(
          (entry) =>
            (entry.kind === "table" || entry.kind === "dbReader") &&
            (entry.metadata as { schemaHash?: string } | undefined)?.schemaHash !== currentHash,
        );
      } else {
        // A different caller may have initialized the global schema before this service existed.
        clearSchemaCache();
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        let before: string;
        try {
          before = schemaFileHash(DEFAULT_GAME);
        } catch {
          const loaded = await getSchemaForGame(DEFAULT_GAME);
          return { snapshot: { schema: loaded, fingerprint: "unhashed-default-schema" }, cacheable: false };
        }
        const loaded = await getSchemaForGame(DEFAULT_GAME);
        let after: string;
        try {
          after = schemaFileHash(DEFAULT_GAME);
        } catch {
          return { snapshot: { schema: loaded, fingerprint: "unhashed-default-schema" }, cacheable: false };
        }
        if (before === after) {
          defaultSchemaSnapshot = { schema: loaded, fingerprint: after };
          break;
        }
        clearSchemaCache();
      }
      let finalHash: string | undefined;
      try {
        finalHash = schemaFileHash(DEFAULT_GAME);
      } catch {
        /* The caller will not cache this snapshot. */
      }
      if (!defaultSchemaSnapshot || defaultSchemaSnapshot.fingerprint !== finalHash) {
        throw new AutomationError("CONFLICT", "Bundled DB schema changed while it was being loaded");
      }
    }
    return { snapshot: defaultSchemaSnapshot, cacheable: true };
  };

  const descriptorIdentityKey = (identity: CanonicalFileIdentity): string => identityString(identity);

  const authorizeCacheRead = async (
    filePath: string,
    policy: FilesystemPolicy,
  ): Promise<{ identity: CanonicalFileIdentity; fd: number }> => openIdentity(filePath, policy);

  const prepareWritePath = async (filePath: string, policy: FilesystemPolicy): Promise<string | undefined> => {
    try {
      const canonical = await policy.assertWritePath(filePath);
      await fsp.mkdir(path.dirname(canonical), { recursive: true });
      return await policy.assertWritePath(canonical);
    } catch (error) {
      if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
      warnOnce(
        "Headless cache persistence is unavailable under the configured write roots; using readable cache, memory, or source data.",
      );
      return undefined;
    }
  };

  const verifyCacheFileIdentity = async (
    filePath: string,
    expected: string,
    policy: FilesystemPolicy,
  ): Promise<boolean> => {
    try {
      const { identity, fd } = await authorizeCacheRead(filePath, policy);
      fs.closeSync(fd);
      return descriptorIdentityKey(identity) === expected;
    } catch {
      return false;
    }
  };

  const dbReaderFor = async (
    filePath: string,
    cacheKey: string,
    sourcePath: string,
    identity: VanillaDbCacheIdentity,
    policy: FilesystemPolicy,
  ): Promise<VanillaDbCacheReader | undefined> => {
    const retained = budget.get<DbReaderRecord>(cacheKey);
    if (retained) {
      const record = retained.value as DbReaderRecord;
      if (await verifyCacheFileIdentity(record.filePath, record.fileIdentity, policy)) {
        counters.hits.dbReaders++;
        return record.reader;
      }
      budget.drop(cacheKey);
    }
    const releaseSlot = budget.reserveReaderSlot();
    if (!releaseSlot) return undefined;
    let fd: number | undefined;
    let source: ReturnType<typeof createFileSourceFromFd> | undefined;
    let reader: VanillaDbCacheReader | undefined;
    try {
      const authorized = await authorizeCacheRead(filePath, policy);
      fd = authorized.fd;
      const fileIdentity = descriptorIdentityKey(authorized.identity);
      source = createFileSourceFromFd(fd);
      fd = undefined;
      reader = openVanillaDbCache(source, identity);
      if (!reader || !dbReaderIsProven(reader, identity)) {
        source.close();
        reader = undefined;
        counters.misses.dbReaders++;
        return undefined;
      }
      const record: DbReaderRecord = { reader, filePath: authorized.identity.path, fileIdentity, sourcePath };
      const reservedBytes = DEFAULT_DECODED_CACHE_BYTES + reader.residentBytes;
      releaseSlot();
      if (
        !budget.admit({
          key: cacheKey,
          kind: "dbReader",
          bytes: reservedBytes,
          value: record,
          close: () => reader?.close(),
          pins: 0,
          metadata: { sourcePath, sourceIdentity: dbSourceIdentityString(identity), schemaHash: identity.schemaHash },
        })
      ) {
        reader.close();
        reader = undefined;
        return undefined;
      }
      counters.misses.dbReaders++;
      return record.reader;
    } catch (error) {
      try {
        reader?.close();
      } catch {
        /* Ignore cleanup errors on a cache miss. */
      }
      try {
        if (!reader) source?.close();
      } catch {
        /* Source may already be closed. */
      }
      if (fd !== undefined)
        try {
          fs.closeSync(fd);
        } catch {
          /* Ignore cleanup errors. */
        }
      if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
      counters.misses.dbReaders++;
      return undefined;
    } finally {
      releaseSlot();
    }
  };

  const dropDbReader = (reader: VanillaDbCacheReader): void => {
    budget.dropWhere((entry) => entry.kind === "dbReader" && (entry.value as DbReaderRecord).reader === reader);
  };

  const tableFromReader = (
    reader: VanillaDbCacheReader,
    packedFilePath: string,
    dbName: string,
    schemaMap: Record<string, DBVersion[]>,
  ): ReadonlyTableData | undefined => {
    const tableMeta = reader.getTableMeta(packedFilePath);
    if (!tableMeta) return undefined;
    const schema = resolveParsedDBVersion(tableMeta.packedFileVersion, schemaMap[dbName]);
    if (!schema || !schemaLayoutMatches(schema, tableMeta)) return undefined;
    try {
      const rawRows = reader.getTypedTableRows(packedFilePath);
      if (!rawRows || rawRows.length !== tableMeta.rowCount) return undefined;
      const rows = rawRows.map((row) => Object.freeze(row as TableRow));
      return Object.freeze({
        packedPath: packedFilePath,
        schema: cloneAndFreezeSchema(schema),
        isLoc: false,
        rows: Object.freeze(rows),
      });
    } catch (error) {
      if (error instanceof VanillaDbCacheIntegrityError) dropDbReader(reader);
      return undefined;
    }
  };

  const openLocCacheCandidate = async (
    filePath: string,
    stampPath: string,
    expected: { identity: string; sourceFormat: string; decoderRevision: string; orderFingerprint: string },
    policy: FilesystemPolicy,
  ): Promise<
    | {
        reader: VanillaLocCacheReader;
        fileIdentity: string;
        stampIdentity: string;
        canonicalPath: string;
        canonicalStampPath: string;
      }
    | undefined
  > => {
    let cacheFd: number | undefined;
    let stampFd: number | undefined;
    let source: ReturnType<typeof createLocFileSourceFromFd> | undefined;
    try {
      const cache = await authorizeCacheRead(filePath, policy);
      cacheFd = cache.fd;
      const stampFile = await authorizeCacheRead(stampPath, policy);
      stampFd = stampFile.fd;
      const stampBytes = fs.readFileSync(stampFd);
      const stampAfterRead = identityFromDescriptor(stampFile.identity.path, stampFd);
      if (descriptorIdentityKey(stampAfterRead) !== descriptorIdentityKey(stampFile.identity)) return undefined;
      let stamp: Record<string, unknown>;
      try {
        stamp = JSON.parse(stampBytes.toString("utf8")) as Record<string, unknown>;
      } catch {
        return undefined;
      }
      if (
        stamp.identity !== expected.identity ||
        stamp.sourceFormat !== expected.sourceFormat ||
        stamp.decoderRevision !== expected.decoderRevision ||
        stamp.orderFingerprint !== expected.orderFingerprint ||
        typeof stamp.contentSha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(stamp.contentSha256)
      )
        return undefined;
      if (hashDescriptor(cacheFd) !== stamp.contentSha256) return undefined;
      const cacheAfterRead = identityFromDescriptor(cache.identity.path, cacheFd);
      if (descriptorIdentityKey(cache.identity) !== descriptorIdentityKey(cacheAfterRead)) return undefined;
      source = createLocFileSourceFromFd(cacheFd);
      cacheFd = undefined;
      const reader = openVanillaLocCache(source);
      if (!reader || !reader.hasCompleteProvenance) {
        try {
          reader?.close();
        } catch {
          /* Ignore invalid cache cleanup. */
        }
        try {
          source.close();
        } catch {
          /* Ignore invalid cache cleanup. */
        }
        return undefined;
      }
      return {
        reader,
        fileIdentity: descriptorIdentityKey(cache.identity),
        stampIdentity: descriptorIdentityKey(stampFile.identity),
        canonicalPath: cache.identity.path,
        canonicalStampPath: stampFile.identity.path,
      };
    } catch (error) {
      if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
      return undefined;
    } finally {
      if (cacheFd !== undefined)
        try {
          fs.closeSync(cacheFd);
        } catch {
          /* Ignore cleanup errors. */
        }
      if (stampFd !== undefined)
        try {
          fs.closeSync(stampFd);
        } catch {
          /* Ignore cleanup errors. */
        }
    }
  };

  const validateConfiguredPaths = async (policy: FilesystemPolicy): Promise<void> => {
    if (cacheDir) {
      const canonical = await policy.assertReadTargetPath(cacheDir);
      try {
        const stat = await fsp.stat(canonical);
        if (!stat.isDirectory()) throw new AutomationError("IO_ACCESS", `--cache-dir must be a directory: ${cacheDir}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (whmmCacheDir) {
      const canonical = await policy.assertReadPath(whmmCacheDir);
      const stat = await fsp.stat(canonical);
      if (!stat.isDirectory())
        throw new AutomationError("IO_ACCESS", `--whmm-cache-dir must be a directory: ${whmmCacheDir}`);
    }
  };

  const stats = (): AutomationCacheStats => ({
    enabled: !closed,
    memoryLimitBytes: budget.maxBytes,
    retainedBytes: budget.retainedBytes,
    readerCount: budget.readerCount,
    maxReaders,
    entries: budget.counts(),
    hits: { ...counters.hits },
    misses: { ...counters.misses },
    sourceFallbacks: counters.sourceFallbacks,
    persistentWrites: counters.persistentWrites,
  });

  const makeScope = (request: AutomationCacheRequestOptions): AutomationCacheRequestScope => {
    const releases = new Set<() => void>();
    const scopedIdentity = new Map<string, CanonicalFileIdentity>();
    const scopedSources = new WeakMap<CorePack, CanonicalFileIdentity>();
    const useIndexCache = request.useIndexCache !== false;
    const useTypedCache = request.useTypedCache !== false;
    const payloadLimit = request.maxLogicalPayloadBytes ?? DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES;
    const cachePayloadAllowed = payloadLimit === DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES;
    let scopeClosed = false;

    const checkOpen = () => {
      if (scopeClosed || closed) throw new AutomationError("CANCELLED", "Automation cache request has ended");
      throwIfAborted(request.signal);
    };

    const assertIdentityStillCurrent = async (expected: CanonicalFileIdentity): Promise<void> => {
      checkOpen();
      const { identity, fd } = await openIdentity(expected.path, request.policy);
      fs.closeSync(fd);
      if (identityString(identity) !== identityString(expected)) {
        throw new AutomationError("CONFLICT", "Pack changed while the request was using its cached index", {
          packPath: expected.path,
        });
      }
    };

    const locateEntry = (pack: CorePack, packedFilePath: string): CorePackEntry => {
      const normalized = normalizeInternalPackPath(packedFilePath);
      const wanted = normalizePackFilePathKey(normalized);
      const matches = pack.entries.filter((entry) => normalizePackFilePathKey(entry.name) === wanted);
      if (matches.length === 0) throw new AutomationError("VALIDATION", `Packed file not found: ${packedFilePath}`);
      if (matches.length > 1) throw new AutomationError("CONFLICT", `Packed file path is ambiguous: ${packedFilePath}`);
      return matches[0];
    };

    const readFreshPayload = async (pack: CorePack, entry: CorePackEntry): Promise<Buffer> => {
      const expected = scopedSources.get(pack);
      if (expected) await assertIdentityStillCurrent(expected);
      const payload = await readPayload(pack, entry, { game: DEFAULT_GAME, maxLogicalPayloadBytes: payloadLimit });
      if (expected) await assertIdentityStillCurrent(expected);
      return payload;
    };

    const getSchemaForRequest = async (): Promise<{
      schema: Record<string, DBVersion[]>;
      hash: string;
      cacheable: boolean;
    }> => {
      const result = await schemaSnapshot(request);
      return { schema: result.snapshot.schema, hash: result.snapshot.fingerprint, cacheable: result.cacheable };
    };

    const dropStaleTables = (
      sourcePath: string,
      current: {
        domain: "db" | "loc";
        sourceIdentity: string;
        payloadLimit: number;
        schemaHash?: string;
      },
    ) => {
      budget.dropWhere((entry) => {
        if (entry.kind !== "table") return false;
        const metadata = entry.metadata as
          | {
              sourcePath?: string;
              domain?: "db" | "loc";
              sourceIdentity?: string;
              payloadLimit?: number;
              codecRevision?: string;
              schemaHash?: string;
            }
          | undefined;
        if (metadata?.sourcePath !== sourcePath) return false;
        return (
          metadata.sourceIdentity !== current.sourceIdentity ||
          metadata.payloadLimit !== current.payloadLimit ||
          metadata.codecRevision !== DB_CODEC_REVISION ||
          (current.domain === "db" && metadata.domain === "db" && metadata.schemaHash !== current.schemaHash)
        );
      });
    };

    const getTableFromDbCache = async (
      filePath: string,
      key: string,
      sourcePath: string,
      identity: VanillaDbCacheIdentity,
      packedPath: string,
      dbName: string,
      schemaMap: Record<string, DBVersion[]>,
    ): Promise<ReadonlyTableData | undefined> => {
      const reader = await dbReaderFor(filePath, key, sourcePath, identity, request.policy);
      if (!reader) return undefined;
      return tableFromReader(reader, packedPath, dbName, schemaMap);
    };

    const publishDbTable = async (
      data: ReadonlyTableData,
      parsed: Awaited<ReturnType<typeof loadPackedTable>>["parsed"],
      source: CanonicalFileIdentity,
      schemaHash: string,
      payloadLimit: number,
    ): Promise<{ cachePath: string; cacheIdentity: string } | undefined> => {
      if (!cacheDir) return undefined;
      const dbIdentity = getDbCacheIdentity(source, schemaHash);
      const built = buildVanillaDbCacheFromTables(
        [
          {
            packedFilePath: data.packedPath,
            schema: parsed.schema,
            rows: parsed.rows.map((row) => row.cells.map((cell) => cell.fields)),
            packedFileVersion: parsed.preamble.version,
            guid: parsed.preamble.guid,
          },
        ],
        dbIdentity,
      );
      if (built.skipped.length > 0 || built.meta.tables.length !== 1) return undefined;
      const directory = path.join(cacheDir, "headless", "db", sha256(source.path));
      const tableHash = tablePathHash(normalizePackFilePathKey(data.packedPath));
      const limitHash = tablePathHash(String(payloadLimit)).slice(0, 16);
      const target = path.join(directory, `${tableHash}-${limitHash}.bin`);
      const writablePath = await prepareWritePath(target, request.policy);
      if (!writablePath) return undefined;
      const published = await publishCacheFiles({
        cachePath: writablePath,
        cacheBytes: built.bytes,
        shouldPublish: () => !request.signal?.aborted && descriptorMatchesPath(source),
      }).catch(() => false);
      if (published) counters.persistentWrites++;
      await assertIdentityStillCurrent(source);
      if (!published) return undefined;
      const opened = await authorizeCacheRead(writablePath, request.policy);
      fs.closeSync(opened.fd);
      return { cachePath: opened.identity.path, cacheIdentity: descriptorIdentityKey(opened.identity) };
    };

    const readReadonlyTable = async (
      packPath: string,
      packedFilePath: string,
    ): Promise<ReadonlyTableData | undefined> => {
      checkOpen();
      const pack = await scope.readPackIndex(packPath);
      const entry = locateEntry(pack, packedFilePath);
      const normalizedPath = normalizePackFilePath(entry.name);
      const isLoc = normalizedPath.toLowerCase().endsWith(".loc");
      const source = scopedSources.get(pack)!;
      const pathKey = normalizePackFilePathKey(normalizedPath);
      const canCacheStructured = !request.schemaProvider || options.schemaFingerprint !== undefined;
      const schema = isLoc ? undefined : await getSchemaForRequest();
      const domain = isLoc ? "loc" : "db";
      const sourceEpoch = JSON.stringify([
        identityString(source),
        domain,
        isLoc ? undefined : schema?.hash,
        DB_CODEC_REVISION,
        payloadLimit,
      ]);
      const tableIdentity = JSON.stringify([sourceEpoch, pathKey]);
      const retainView = useTypedCache && canCacheStructured && cachePayloadAllowed;
      const retainedKey = `table:${tableIdentity}`;

      if (retainView) {
        const retained = budget.get<ReadonlyTableData>(retainedKey);
        if (retained) {
          const metadata = retained.metadata as { cachePath?: string; cacheIdentity?: string } | undefined;
          if (
            !metadata?.cachePath ||
            !metadata.cacheIdentity ||
            (await verifyCacheFileIdentity(metadata.cachePath, metadata.cacheIdentity, request.policy))
          ) {
            await assertIdentityStillCurrent(source);
            counters.hits.typedTables++;
            return retained.value as ReadonlyTableData;
          }
          budget.drop(retainedKey);
        }
        counters.misses.typedTables++;
        dropStaleTables(source.path, {
          domain,
          sourceIdentity: identityString(source),
          payloadLimit,
          ...(!isLoc && schema ? { schemaHash: schema.hash } : {}),
        });
      }

      if (!isLoc && retainView && schema?.cacheable) {
        const parsedPath = parseDBTablePath(normalizedPath.toLowerCase());
        if (parsedPath) {
          const dbIdentity = getDbCacheIdentity(source, schema.hash);
          const packHash = sha256(source.path);
          const tableHash = tablePathHash(pathKey);
          const limitHash = tablePathHash(String(payloadLimit)).slice(0, 16);
          const managedPath = cacheDir
            ? path.join(cacheDir, "headless", "db", packHash, `${tableHash}-${limitHash}.bin`)
            : undefined;
          const candidates = [
            ...(whmmCacheDir ? [path.join(whmmCacheDir, "vanilla-db-cache-wh3.bin")] : []),
            ...(managedPath ? [managedPath] : []),
          ];
          for (const cachePath of candidates) {
            const readerKey = `dbReader:${cachePath}:${identityString(source)}:${schema.hash}:${payloadLimit}`;
            const data = await getTableFromDbCache(
              cachePath,
              readerKey,
              source.path,
              dbIdentity,
              normalizedPath,
              parsedPath.dbName,
              schema.schema,
            );
            if (data) {
              await assertIdentityStillCurrent(source);
              counters.hits.typedTables++;
              const immutable = Object.freeze({ ...data, schema: cloneAndFreezeSchema(data.schema as DBVersion) });
              const readerEntry = budget.get<DbReaderRecord>(readerKey);
              const readerRecord = readerEntry?.value as DbReaderRecord | undefined;
              budget.admit({
                key: retainedKey,
                kind: "table",
                bytes: estimateRowsBytes(immutable),
                value: immutable,
                pins: 0,
                metadata: {
                  sourcePath: source.path,
                  sourceIdentity: identityString(source),
                  schemaHash: schema.hash,
                  sourceEpoch,
                  domain: "db",
                  payloadLimit,
                  codecRevision: DB_CODEC_REVISION,
                  ...(readerRecord
                    ? { cachePath: readerRecord.filePath, cacheIdentity: readerRecord.fileIdentity }
                    : {}),
                },
              });
              return immutable;
            }
          }
        }
      }

      const payload = await readFreshPayload(pack, entry);
      const loaded = await loadPackedTable(normalizedPath, payload, async () => schema?.schema ?? {});
      await assertIdentityStillCurrent(source);
      const rows = tableRowsToJson(loaded.parsed);
      const immutable = Object.freeze({
        packedPath: loaded.packedPath,
        schema: cloneAndFreezeSchema(loaded.parsed.schema),
        isLoc: loaded.isLoc,
        rows: Object.freeze(rows.map((row) => deepFreeze(row))),
      });
      if (!isLoc && retainView && schema?.cacheable) {
        const rowBytes = estimateRowsBytes(immutable);
        let diskOrigin: { cachePath: string; cacheIdentity: string } | undefined;
        try {
          diskOrigin = await publishDbTable(immutable, loaded.parsed, source, schema.hash, payloadLimit);
        } catch (error) {
          if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code))
            throw error;
          // Persistent cache writes never change a source result.
        }
        await assertIdentityStillCurrent(source);
        budget.admit({
          key: retainedKey,
          kind: "table",
          bytes: rowBytes,
          value: immutable,
          pins: 0,
          metadata: {
            sourcePath: source.path,
            sourceIdentity: identityString(source),
            schemaHash: schema.hash,
            sourceEpoch,
            domain,
            payloadLimit,
            codecRevision: DB_CODEC_REVISION,
            ...diskOrigin,
          },
        });
      } else if (isLoc && retainView) {
        await assertIdentityStillCurrent(source);
        budget.admit({
          key: retainedKey,
          kind: "table",
          bytes: estimateRowsBytes(immutable),
          value: immutable,
          pins: 0,
          metadata: {
            sourcePath: source.path,
            sourceIdentity: identityString(source),
            sourceEpoch,
            domain,
            payloadLimit,
            codecRevision: DB_CODEC_REVISION,
          },
        });
      }
      counters.sourceFallbacks++;
      return immutable;
    };

    const checkRecordFileIdentity = async (record: LocReaderRecord): Promise<boolean> => {
      if (record.memoryBacked || !record.filePath || !record.fileIdentity || !record.stampPath || !record.stampIdentity)
        return true;
      return (
        (await verifyCacheFileIdentity(record.filePath, record.fileIdentity, request.policy)) &&
        (await verifyCacheFileIdentity(record.stampPath, record.stampIdentity, request.policy))
      );
    };

    const makeLookupLease = (key: string, record: LocReaderRecord): RawLocalizationLookupLease | undefined => {
      const pinned = budget.pin(key);
      if (!pinned) return undefined;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releases.delete(release);
        budget.unpin(key);
      };
      releases.add(release);
      const entryInfo = (
        sourceLabel: string | undefined,
        rowIndex: number,
        rawText: string,
      ): RawLocalizationEntry | undefined => {
        const source = sourceLabelParts(sourceLabel);
        if (!source || rowIndex === VANILLA_LOC_UNKNOWN_ROW_INDEX) return undefined;
        return { rawText, packPath: source.packPath, filePath: source.filePath, rowIndex };
      };
      const lookup: RawLocalizationLookup = {
        getRaw(keyText) {
          const found = record.reader.getEntry(keyText);
          return found ? entryInfo(found.sourceLabel, found.rowIndex, found.value) : undefined;
        },
        async forEachEntry(visit) {
          checkOpen();
          await record.reader.forEachEntryAsync?.(
            (keyText, value, _rank, sourceLabel, rowIndex) => {
              throwIfAborted(request.signal);
              const entry = entryInfo(sourceLabel, rowIndex ?? VANILLA_LOC_UNKNOWN_ROW_INDEX, value);
              return entry ? visit(keyText, entry) : false;
            },
            { yieldEvery: 256, yieldToEventLoop: () => yieldToEventLoop(request.signal) },
          );
          checkOpen();
        },
      };
      return { lookup, release };
    };

    const readVanillaLoc = async (
      packPaths: readonly string[],
      order: ExactVanillaLocFileOrder = "packIndex",
    ): Promise<RawLocalizationLookupLease | undefined> => {
      checkOpen();
      if (
        !useTypedCache ||
        !cachePayloadAllowed ||
        (request.schemaProvider && options.schemaFingerprint === undefined)
      ) {
        counters.misses.locReaders++;
        return undefined;
      }
      const indexedPacks = await Promise.all(packPaths.map((packPath) => scope.readPackIndex(packPath)));
      const packs = indexedPacks.filter((pack) =>
        pack.entries.some((entry) =>
          order === "gui" ? entry.name.endsWith(".loc") : entry.name.toLowerCase().endsWith(".loc"),
        ),
      );
      if (packs.length === 0) return undefined;
      const canonicalPackPaths = packs.map((pack) => pack.path);
      const byPath = new Map(packs.map((pack) => [pack.path, pack]));
      let packSet;
      try {
        packSet = indexExactVanillaLocPackSet(canonicalPackPaths, DEFAULT_GAME, order, (packPath) => {
          const pack = byPath.get(canonicalizeExistingPath(packPath));
          if (!pack) throw new Error(`Pack index was not authorized: ${packPath}`);
          return pack;
        });
      } catch (error) {
        if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code))
          throw error;
        counters.sourceFallbacks++;
        return undefined;
      }
      for (const pack of packs) {
        const source = scopedSources.get(pack);
        if (source) await assertIdentityStillCurrent(source);
      }
      const assertPackSetCurrent = async () => {
        for (const pack of packs) {
          const source = scopedSources.get(pack);
          if (source) await assertIdentityStillCurrent(source);
        }
      };
      const sourceIdentity = getVanillaLocCacheIdentity(DEFAULT_GAME, canonicalPackPaths);
      const sourceSetIdentity = JSON.stringify(
        canonicalPackPaths.map((packPath) => [packPath, identityString(scopedIdentity.get(packPath)!)]),
      );
      budget.dropWhere(
        (entry) =>
          entry.kind === "locReader" &&
          (
            entry.metadata as { sourcePaths?: readonly string[]; sourceSetIdentity?: string } | undefined
          )?.sourcePaths?.some((candidate) => canonicalPackPaths.includes(candidate)) === true &&
          (entry.metadata as { sourceSetIdentity?: string } | undefined)?.sourceSetIdentity !== sourceSetIdentity,
      );
      const expectedStamp = {
        identity: sourceIdentity,
        sourceFormat: VANILLA_LOC_CACHE_EXACT_SOURCE_FORMAT,
        decoderRevision: VANILLA_LOC_CACHE_DECODER_REVISION,
        orderFingerprint: packSet.orderFingerprint,
      };
      const key = `locReader:${sha256(JSON.stringify(expectedStamp))}`;
      const retained = budget.get<LocReaderRecord>(key);
      if (retained) {
        const record = retained.value as LocReaderRecord;
        if (await checkRecordFileIdentity(record)) {
          await assertPackSetCurrent();
          counters.hits.locReaders++;
          return makeLookupLease(key, record);
        }
        budget.drop(key);
      }
      counters.misses.locReaders++;

      const tryCandidate = async (
        filePath: string,
        stampPath: string,
      ): Promise<RawLocalizationLookupLease | undefined> => {
        const releaseSlot = budget.reserveReaderSlot();
        if (!releaseSlot) return undefined;
        try {
          const opened = await openLocCacheCandidate(filePath, stampPath, expectedStamp, request.policy);
          if (!opened) return undefined;
          try {
            await assertPackSetCurrent();
            const record: LocReaderRecord = {
              reader: opened.reader,
              filePath: opened.canonicalPath,
              stampPath: opened.canonicalStampPath,
              fileIdentity: opened.fileIdentity,
              stampIdentity: opened.stampIdentity,
              sourcePaths: canonicalPackPaths,
              memoryBacked: false,
            };
            releaseSlot();
            const accepted = budget.admit({
              key,
              kind: "locReader",
              bytes: opened.reader.residentBytes,
              value: record,
              close: () => opened.reader.close(),
              pins: 0,
              metadata: { sourcePaths: canonicalPackPaths, sourceSetIdentity },
            });
            if (!accepted) {
              opened.reader.close();
              return undefined;
            }
            counters.hits.locReaders++;
            return makeLookupLease(key, record);
          } catch (error) {
            opened.reader.close();
            throw error;
          }
        } finally {
          releaseSlot();
        }
      };

      if (whmmCacheDir) {
        const guiFiles = [
          ...new Set([
            getVanillaLocCacheFilePath(whmmCacheDir, DEFAULT_GAME, packPaths),
            getVanillaLocCacheFilePath(whmmCacheDir, DEFAULT_GAME, canonicalPackPaths),
          ]),
        ];
        for (const guiFile of guiFiles) {
          const found = await tryCandidate(guiFile, `${guiFile}.id`);
          if (found) return found;
        }
      }
      const managedIdentity = sha256(JSON.stringify([canonicalPackPaths, order, packSet.orderFingerprint]));
      const managedFile = cacheDir ? path.join(cacheDir, "headless", "loc", `${managedIdentity}.bin`) : undefined;
      if (managedFile) {
        const found = await tryCandidate(managedFile, `${managedFile}.id`);
        if (found) return found;
      }

      const releaseColdSlot = budget.reserveReaderSlot();
      if (!releaseColdSlot) return undefined;
      try {
        const sourceEntries = await readExactVanillaLocEntries(packSet, {
          shouldCancel: () => Boolean(request.signal?.aborted),
          assertSourceCurrent: async (pack) => {
            const source = scopedSources.get(pack);
            if (source) await assertIdentityStillCurrent(source);
          },
        });
        checkOpen();
        const bytes = buildVanillaLocCacheBytes(sourceEntries);
        const contentSha256 = sha256(bytes);
        let record: LocReaderRecord | undefined;
        let reader: VanillaLocCacheReader | undefined;
        if (managedFile) {
          const writablePath = await prepareWritePath(managedFile, request.policy);
          if (writablePath) {
            const stampPath = `${writablePath}.id`;
            const stampBytes = Buffer.from(JSON.stringify({ ...expectedStamp, contentSha256 }), "utf8");
            const published = await publishCacheFiles({
              cachePath: writablePath,
              cacheBytes: bytes,
              stampPath,
              stampBytes,
              shouldPublish: () =>
                !request.signal?.aborted &&
                canonicalPackPaths.every((packPath) => {
                  const expected = scopedIdentity.get(packPath);
                  return expected ? descriptorMatchesPath(expected) : false;
                }),
            });
            if (published) {
              counters.persistentWrites++;
              const opened = await openLocCacheCandidate(writablePath, stampPath, expectedStamp, request.policy);
              if (opened) {
                reader = opened.reader;
                record = {
                  reader,
                  filePath: opened.canonicalPath,
                  stampPath: opened.canonicalStampPath,
                  fileIdentity: opened.fileIdentity,
                  stampIdentity: opened.stampIdentity,
                  sourcePaths: canonicalPackPaths,
                  memoryBacked: false,
                };
              }
            }
          }
        }
        checkOpen();
        if (!reader) {
          reader = openVanillaLocCache(createLocMemorySource(bytes));
          if (!reader || !reader.hasCompleteProvenance) {
            reader?.close();
            return undefined;
          }
          record = { reader, sourcePaths: canonicalPackPaths, memoryBacked: true };
        }
        if (!record) {
          reader.close();
          return undefined;
        }
        const bytesHeld = reader.residentBytes + (record.memoryBacked ? bytes.length : 0);
        await assertPackSetCurrent();
        releaseColdSlot();
        const accepted = budget.admit({
          key,
          kind: "locReader",
          bytes: bytesHeld,
          value: record,
          close: () => reader?.close(),
          pins: 0,
          metadata: { sourcePaths: canonicalPackPaths, sourceSetIdentity },
        });
        if (!accepted) {
          reader.close();
          return undefined;
        }
        return makeLookupLease(key, record);
      } catch (error) {
        if (
          error instanceof VanillaLocSourceReadCanceled ||
          (error instanceof AutomationError && error.code === "CANCELLED")
        ) {
          throw new AutomationError("CANCELLED", "Operation was cancelled");
        }
        if (error instanceof AutomationError && ["CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
        counters.sourceFallbacks++;
        return undefined;
      } finally {
        releaseColdSlot();
      }
    };

    const scope: AutomationCacheRequestScope = {
      async readPackIndex(packPath) {
        checkOpen();
        const { identity, fd } = await openIdentity(packPath, request.policy);
        fs.closeSync(fd);
        const canonicalPath = identity.path;
        const maxIndexBytes = DEFAULT_MAX_INDEX_BYTES;
        const currentIdentity = identityString(identity);
        const firstIdentity = scopedIdentity.get(canonicalPath);
        if (firstIdentity && identityString(firstIdentity) !== currentIdentity) {
          throw new AutomationError("CONFLICT", "Pack changed during the request", { packPath: canonicalPath });
        }
        if (!firstIdentity) scopedIdentity.set(canonicalPath, identity);
        const key = `index:${currentIdentity}:${DEFAULT_GAME}:${maxIndexBytes}`;
        budget.dropWhere(
          (entry) =>
            (entry.kind === "index" || entry.kind === "table" || entry.kind === "dbReader") &&
            (entry.metadata as { sourcePath?: string } | undefined)?.sourcePath === canonicalPath &&
            (entry.metadata as { sourceIdentity?: string } | undefined)?.sourceIdentity !== currentIdentity,
        );
        const retained = useIndexCache ? budget.get<CorePack>(key) : undefined;
        if (retained) {
          const pack = retained.value as CorePack;
          counters.hits.packIndexes++;
          scopedSources.set(pack, identity);
          packIdentityByObject.set(pack, identityString(identity));
          return pack;
        }
        counters.misses.packIndexes++;
        const pack = deepFreeze(readPackIndex(canonicalPath, { game: DEFAULT_GAME, maxIndexBytes }));
        if (pack.fileSize !== Number(identity.size)) {
          throw new AutomationError("CONFLICT", "Pack changed while its index was being read", {
            packPath: canonicalPath,
          });
        }
        await assertIdentityStillCurrent(identity);
        scopedSources.set(pack, identity);
        packIdentityByObject.set(pack, identityString(identity));
        if (useIndexCache) {
          const bytes = estimatePackBytes(pack);
          budget.admit({
            key,
            kind: "index",
            bytes,
            value: pack,
            pins: 0,
            metadata: { sourcePath: canonicalPath, sourceIdentity: currentIdentity },
          });
        }
        return pack;
      },
      async assertPackSnapshot(pack) {
        checkOpen();
        const expected = scopedSources.get(pack);
        if (!expected) {
          const snapshotIdentity = packIdentityByObject.get(pack);
          if (!snapshotIdentity)
            throw new AutomationError("CONFLICT", "Pack index was not obtained from this request scope", {
              packPath: pack.path,
            });
          const { identity, fd } = await openIdentity(pack.path, request.policy);
          fs.closeSync(fd);
          if (identityString(identity) !== snapshotIdentity)
            throw new AutomationError("CONFLICT", "Pack changed since its index was read", { packPath: pack.path });
          return;
        }
        await assertIdentityStillCurrent(expected);
      },
      getReadonlyTable: readReadonlyTable,
      getVanillaRawLoc: readVanillaLoc,
      close() {
        if (scopeClosed) return;
        scopeClosed = true;
        for (const release of [...releases]) release();
        releases.clear();
        activeScopes--;
        if (activeScopes === 0) for (const resolve of scopeWaiters.splice(0)) resolve();
      },
    };
    return scope;
  };

  return {
    beginRequest(request) {
      if (closed) throw new AutomationError("CANCELLED", "Automation cache service is closed");
      activeScopes++;
      return makeScope(request);
    },
    validateConfiguredPaths,
    stats,
    invalidatePath(filePath) {
      const canonical = canonicalizeExistingPath(filePath);
      budget.dropWhere((entry) => {
        if (entry.kind === "index")
          return (entry.metadata as { sourcePath?: string } | undefined)?.sourcePath === canonical;
        if (entry.kind === "table")
          return (entry.metadata as { sourcePath?: string } | undefined)?.sourcePath === canonical;
        if (entry.kind === "dbReader")
          return (entry.metadata as { sourcePath?: string } | undefined)?.sourcePath === canonical;
        if (entry.kind === "locReader")
          return (
            (entry.metadata as { sourcePaths?: readonly string[] } | undefined)?.sourcePaths?.includes(canonical) ??
            false
          );
        return false;
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      if (activeScopes > 0) await new Promise<void>((resolve) => scopeWaiters.push(resolve));
      budget.dispose();
      defaultSchemaSnapshot = undefined;
    },
  };
};
