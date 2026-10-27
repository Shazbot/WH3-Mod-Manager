import { createHash } from "node:crypto";
import * as path from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { stat, mkdir, writeFile } from "node:fs/promises";
import { VISUALS_DATA_CACHE_VERSION, type VisualsPackCacheEntry } from "./cache";

/** Independent of the GUI catalog version: these are raw references, never resolved providers. */
export const VISUAL_REFERENCE_CACHE_VERSION = 1;
export const VISUAL_REFERENCE_PARSER_REVISION = "xml-rmv2-texture-slots-v1";
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface VisualsCacheSource {
  path: string;
  identity: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface VisualsCacheStats {
  catalogHits: number;
  referenceHits: number;
  referenceMisses: number;
  sourceParses: number;
  persistentWrites: number;
}

interface PackReferences {
  version: number;
  revision: string;
  sourceIdentity: string;
  payloadLimit: number;
  references: Record<string, unknown>;
}

interface CachePolicy {
  readFile(filePath: string): Promise<{ path: string; bytes: Buffer }>;
  assertReadPath(filePath: string): Promise<string>;
  assertReadTargetPath(filePath: string): Promise<string>;
  assertWritePath(filePath: string): Promise<string>;
  withAtomicOutput(options: {
    outputPath: string; sourcePaths: string[]; overwrite: boolean;
    produce: (temporaryPath: string) => Promise<void>;
  }): Promise<{ path: string }>;
}

export interface VisualsCacheSession {
  catalog(source: VisualsCacheSource, schemaHash: string): Promise<VisualsPackCacheEntry | undefined>;
  reference<T>(source: VisualsCacheSource, filePath: string, kind: string,
    validate: (value: unknown) => value is T, load: () => Promise<T>): Promise<T>;
  flush(): Promise<void>;
  flushSource(identity: string): Promise<void>;
  discard(): void;
}

/** Filesystem and memory ownership are supplied by the consumer (GUI or headless adapter). */
export const createVisualsCacheSession = (options: {
  cacheDir?: string;
  whmmCacheDir?: string;
  payloadLimit: number;
  policy: CachePolicy;
  checkCancelled(): void;
  mapCatalogPath?(filePath: string): Promise<string>;
  retain(key: string, value: unknown, bytes: number, sourcePath?: string): void;
  retained(key: string): unknown;
  stats: VisualsCacheStats;
  onPersistenceUnavailable?(): void;
}): VisualsCacheSession => {
  const packs = new Map<string, Promise<{ value: PackReferences; dirty: boolean; source: VisualsCacheSource }>>();
  const catalogFiles = new Map<string, Promise<unknown>>();
  const fileTimes = new Map<string, number>();
  const fatal = (error: unknown) => {
    options.checkCancelled();
    if (error && typeof error === "object" && "code" in error && error.code === "CANCELLED") throw error;
  };
  const read = async (filePath: string): Promise<unknown> => {
    try {
      const allowed = await options.policy.assertReadPath(filePath);
      const info = await stat(allowed);
      if (!info.isFile() || info.size > MAX_CACHE_BYTES) return undefined;
      fileTimes.set(filePath, info.mtimeMs);
      const bytes = (await options.policy.readFile(allowed)).bytes;
      if (bytes.length > MAX_CACHE_BYTES) return undefined;
      const decoded = zstdDecompressSync(bytes, { maxOutputLength: MAX_CACHE_BYTES });
      const parsed: unknown = JSON.parse(decoded.toString("utf8"));
      // A disk cache can be replaced during an MCP session; only request-local reads are reused.
      return parsed;
    } catch (error) { fatal(error); return undefined; }
  };
  const pack = (source: VisualsCacheSource) => {
    let pending = packs.get(source.identity);
    if (pending) return pending;
    pending = (async () => {
      const key = `visuals-references:${source.identity}:${options.payloadLimit}:${VISUAL_REFERENCE_PARSER_REVISION}`;
      let candidate = options.retained(key);
      if (!candidate) {
        for (const root of [options.cacheDir && path.join(options.cacheDir, "headless"), options.whmmCacheDir]) {
          if (!root) continue;
          candidate = await read(path.join(root, "visuals", "references", `${hash(source.path)}.bin`));
          const value = candidate as Partial<PackReferences> | undefined;
          if (value?.version === VISUAL_REFERENCE_CACHE_VERSION && value.revision === VISUAL_REFERENCE_PARSER_REVISION &&
              value.sourceIdentity === source.identity && value.payloadLimit === options.payloadLimit &&
              value.references && typeof value.references === "object" && !Array.isArray(value.references)) break;
          candidate = undefined;
        }
      }
      const value = candidate as PackReferences | undefined;
      return { source, dirty: false, value: value ?? {
        version: VISUAL_REFERENCE_CACHE_VERSION, revision: VISUAL_REFERENCE_PARSER_REVISION,
        sourceIdentity: source.identity, payloadLimit: options.payloadLimit, references: {},
      } };
    })();
    packs.set(source.identity, pending);
    return pending;
  };
  const flushSource = async (identity: string): Promise<void> => {
    const pending = packs.get(identity);
    if (!pending) return;
    const record = await pending;
    options.checkCancelled();
    const text = JSON.stringify(record.value);
    options.retain(`visuals-references:${record.source.identity}:${options.payloadLimit}:${VISUAL_REFERENCE_PARSER_REVISION}`,
      record.value, Buffer.byteLength(text) * 4 + 2048, record.source.path);
    if (record.dirty && options.cacheDir && Buffer.byteLength(text) <= MAX_CACHE_BYTES) {
      try {
        const outputPath = path.join(options.cacheDir, "headless", "visuals", "references", `${hash(record.source.path)}.bin`);
        await options.policy.assertReadTargetPath(outputPath);
        const allowed = await options.policy.assertWritePath(outputPath);
        await mkdir(path.dirname(allowed), { recursive: true });
        await options.policy.withAtomicOutput({ outputPath: allowed, sourcePaths: [record.source.path], overwrite: true,
          produce: async (temporaryPath) => { await writeFile(temporaryPath,
            zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_compressionLevel]: 1 } })); } });
        options.stats.persistentWrites++;
      } catch (error) { fatal(error); options.onPersistenceUnavailable?.(); }
    }
    packs.delete(identity);
  };
  return {
    async catalog(source, schemaHash) {
      if (!options.whmmCacheDir) return undefined;
      for (const file of ["vanilla.bin", "mods.bin"]) {
        options.checkCancelled();
        const filePath = path.join(options.whmmCacheDir, "visuals", file);
        let pending = catalogFiles.get(filePath);
        if (!pending) { pending = read(filePath); catalogFiles.set(filePath, pending); }
        const payload = await pending as { version?: number; entries?: Record<string, VisualsPackCacheEntry>; segments?: Record<string, VisualsPackCacheEntry> } | undefined;
        if (payload?.version !== VISUALS_DATA_CACHE_VERSION) continue;
        // GUI v7 has size/mtime identities. A later source change also invalidates it,
        // including a same-size replacement whose mtime was deliberately preserved.
        if (source.ctimeMs > (fileTimes.get(filePath) ?? -Infinity) + 0.001) continue;
        const entries = payload.entries ?? payload.segments;
        if (!entries || typeof entries !== "object") continue;
        for (const entry of Object.values(entries)) {
          if (!entry?.identity || typeof entry.identity.packPath !== "string" || entry.identity.size !== source.size ||
              Math.abs(entry.identity.mtimeMs - source.mtimeMs) > 0.001 || entry.tables?.schemaHash !== schemaHash) continue;
          if (path.win32.basename(entry.identity.packPath).toLowerCase() !== path.basename(source.path).toLowerCase()) continue;
          try {
            const local = await (options.mapCatalogPath?.(entry.identity.packPath) ?? Promise.resolve(entry.identity.packPath));
            const canonical = await options.policy.assertReadPath(local);
            const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
            if (normalized(canonical) !== normalized(source.path)) continue;
            options.stats.catalogHits++;
            return entry;
          } catch (error) { fatal(error); }
        }
      }
      return undefined;
    },
    async reference(source, filePath, kind, validate, load) {
      options.checkCancelled();
      const record = await pack(source);
      const key = `${kind}:${filePath.replace(/\\/g, "/").toLowerCase()}`;
      const candidate = Object.hasOwn(record.value.references, key) ? record.value.references[key] : undefined;
      if (validate(candidate)) { options.stats.referenceHits++; return candidate; }
      options.stats.referenceMisses++;
      options.stats.sourceParses++;
      const value = await load();
      options.checkCancelled();
      // Copy-on-write: shared retained entries are immutable across request snapshots.
      if (!record.dirty) record.value = { ...record.value, references: { ...record.value.references } };
      record.value.references[key] = value;
      record.dirty = true;
      return value;
    },
    async flush() {
      for (const identity of packs.keys()) await flushSource(identity);
      catalogFiles.clear();
    },
    flushSource,
    discard() { packs.clear(); catalogFiles.clear(); fileTimes.clear(); },
  };
};
