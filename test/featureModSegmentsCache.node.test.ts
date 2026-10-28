import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFeatureModSegmentsMemory,
  getFeatureModSegmentPayloadPath,
  getFeatureModSegmentsIndexPath,
  loadFeatureModSegments,
  normalizeFeatureModSegmentPackPath,
  parseFeatureModSegmentsIndex,
  saveFeatureModSegments,
  type FeatureModSegmentsStoreOptions,
} from "../src/featureModSegmentsCache";

const zstdState = vi.hoisted(() => ({
  decompressCount: 0,
  gate: undefined as Promise<void> | undefined,
  onDecompress: undefined as (() => void) | undefined,
}));

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => value,
  decompress: async (value: Uint8Array) => {
    zstdState.decompressCount++;
    zstdState.onDecompress?.();
    if (zstdState.gate) await zstdState.gate;
    return value;
  },
}));

interface TestSegment {
  identity: { size: number; mtimeMs: number };
  lastUsedMs: number;
  rows: string[];
}

const directories: string[] = [];
let root = "";

const options = (userDataPath: string, maxEntries = 100): FeatureModSegmentsStoreOptions<TestSegment> => ({
  userDataPath,
  feature: "buildings",
  dataVersion: 4,
  maxEntries,
  getIdentity: (segment) => segment.identity,
  isValidSegment: (value): value is TestSegment =>
    value !== null &&
    typeof value === "object" &&
    "identity" in value &&
    typeof value.identity === "object" &&
    value.identity !== null &&
    "size" in value.identity &&
    typeof value.identity.size === "number" &&
    "mtimeMs" in value.identity &&
    typeof value.identity.mtimeMs === "number" &&
    typeof value.lastUsedMs === "number" &&
    Array.isArray(value.rows) &&
    value.rows.every((row: unknown) => typeof row === "string"),
});

const segment = (size: number, lastUsedMs: number, row: string): TestSegment => ({
  identity: { size, mtimeMs: size * 10 },
  lastUsedMs,
  rows: [row],
});

const segments = (...entries: Array<[string, TestSegment]>): Record<string, TestSegment> =>
  Object.fromEntries(entries.map(([packPath, value]) => [normalizeFeatureModSegmentPackPath(packPath), value]));

beforeEach(async () => {
  clearFeatureModSegmentsMemory();
  zstdState.decompressCount = 0;
  zstdState.gate = undefined;
  zstdState.onDecompress = undefined;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "whmm-feature-mod-segments-"));
  directories.push(root);
});

afterEach(async () => {
  clearFeatureModSegmentsMemory();
  zstdState.gate = undefined;
  zstdState.onDecompress = undefined;
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("per-pack feature mod segment store", () => {
  it("loads only requested payloads and ignores a corrupt inactive payload", async () => {
    const cacheOptions = options(root);
    const packA = path.join(root, "a.pack");
    const packB = path.join(root, "b.pack");
    const packC = path.join(root, "c.pack");
    await saveFeatureModSegments(
      cacheOptions,
      segments([packA, segment(1, 1, "a")], [packB, segment(2, 2, "b")], [packC, segment(3, 3, "c")]),
    );
    await fs.writeFile(getFeatureModSegmentPayloadPath(root, "buildings", packB), Buffer.from("corrupt"));
    clearFeatureModSegmentsMemory("buildings", root);
    zstdState.decompressCount = 0;

    const requested = await loadFeatureModSegments(cacheOptions, [packA]);

    expect(Object.keys(requested)).toEqual([normalizeFeatureModSegmentPackPath(packA)]);
    expect(requested[normalizeFeatureModSegmentPackPath(packA)].rows).toEqual(["a"]);
    // One decode for the index and one for A. B and C remain unopened.
    expect(zstdState.decompressCount).toBe(2);
  });

  it("treats a malformed selected segment as a cache miss", async () => {
    const cacheOptions = options(root);
    const packA = path.join(root, "a.pack");
    const keyA = normalizeFeatureModSegmentPackPath(packA);
    await saveFeatureModSegments(cacheOptions, segments([packA, segment(1, 1, "a")]));
    await fs.writeFile(
      getFeatureModSegmentPayloadPath(root, "buildings", packA),
      JSON.stringify({
        version: 1,
        dataVersion: 4,
        packPath: keyA,
        sourcePackPath: keyA,
        size: 1,
        mtimeMs: 10,
        segment: { lastUsedMs: 1, rows: ["missing identity"] },
      }),
    );
    clearFeatureModSegmentsMemory("buildings", root);

    await expect(loadFeatureModSegments(cacheOptions, [packA])).resolves.toEqual({});
  });

  it("rewrites only dirty payloads and keeps omitted inactive entries", async () => {
    const cacheOptions = options(root);
    const packA = path.join(root, "a.pack");
    const packB = path.join(root, "b.pack");
    const keyA = normalizeFeatureModSegmentPackPath(packA);
    const keyB = normalizeFeatureModSegmentPackPath(packB);
    await saveFeatureModSegments(cacheOptions, segments([packA, segment(1, 1, "a")], [packB, segment(2, 2, "b")]));
    const payloadBPath = getFeatureModSegmentPayloadPath(root, "buildings", packB);
    const payloadBBefore = await fs.readFile(payloadBPath);
    clearFeatureModSegmentsMemory("buildings", root);

    const loadedA = await loadFeatureModSegments(cacheOptions, [packA]);
    loadedA[keyA].rows = ["a-updated"];
    const saved = await saveFeatureModSegments(cacheOptions, loadedA, [packA]);

    expect(saved[keyA].rows).toEqual(["a-updated"]);
    expect(await fs.readFile(payloadBPath)).toEqual(payloadBBefore);
    clearFeatureModSegmentsMemory("buildings", root);
    const inactive = await loadFeatureModSegments(cacheOptions, [packB]);
    expect(inactive[keyB].rows).toEqual(["b"]);
  });

  it("updates LRU metadata without rewriting an unchanged payload", async () => {
    const cacheOptions = options(root);
    const packA = path.join(root, "a.pack");
    const keyA = normalizeFeatureModSegmentPackPath(packA);
    await saveFeatureModSegments(cacheOptions, segments([packA, segment(1, 1, "a")]));
    const payloadPath = getFeatureModSegmentPayloadPath(root, "buildings", packA);
    const payloadBefore = await fs.readFile(payloadPath);
    clearFeatureModSegmentsMemory("buildings", root);

    const loaded = await loadFeatureModSegments(cacheOptions, [packA]);
    loaded[keyA].lastUsedMs = 50;
    await saveFeatureModSegments(cacheOptions, loaded, []);

    expect(await fs.readFile(payloadPath)).toEqual(payloadBefore);
    clearFeatureModSegmentsMemory("buildings", root);
    expect((await loadFeatureModSegments(cacheOptions, [packA]))[keyA].lastUsedMs).toBe(50);
  });

  it("prunes inactive entries from index metadata without loading their payloads", async () => {
    const cacheOptions = options(root, 3);
    const packA = path.join(root, "a.pack");
    const packB = path.join(root, "b.pack");
    const packC = path.join(root, "c.pack");
    await saveFeatureModSegments(
      cacheOptions,
      segments([packA, segment(1, 4, "a")], [packB, segment(2, 2, "b")], [packC, segment(3, 3, "c")]),
    );
    clearFeatureModSegmentsMemory("buildings", root);

    const loadedC = await loadFeatureModSegments(cacheOptions, [packC]);
    loadedC[normalizeFeatureModSegmentPackPath(packC)].lastUsedMs = 10;
    await saveFeatureModSegments(options(root, 2), loadedC, []);

    clearFeatureModSegmentsMemory("buildings", root);
    const index = parseFeatureModSegmentsIndex(
      JSON.parse((await fs.readFile(getFeatureModSegmentsIndexPath(root, "buildings"))).toString("utf8")),
      4,
    );
    expect(Object.keys(index?.entries ?? {}).sort()).toEqual(
      [normalizeFeatureModSegmentPackPath(packA), normalizeFeatureModSegmentPackPath(packC)].sort(),
    );
    await expect(fs.stat(getFeatureModSegmentPayloadPath(root, "buildings", packB))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(zstdState.decompressCount).toBe(2); // index + C only
  });

  it("does not publish a pending disk read after the feature cache is cleared", async () => {
    const cacheOptions = options(root);
    const packA = path.join(root, "a.pack");
    const keyA = normalizeFeatureModSegmentPackPath(packA);
    await saveFeatureModSegments(cacheOptions, segments([packA, segment(1, 1, "a")]));
    clearFeatureModSegmentsMemory("buildings", root);

    let signalStarted!: () => void;
    let releaseRead!: () => void;
    const started = new Promise<void>((resolve) => (signalStarted = resolve));
    zstdState.gate = new Promise<void>((resolve) => (releaseRead = resolve));
    zstdState.onDecompress = signalStarted;
    const pendingLoad = loadFeatureModSegments(cacheOptions, [packA]);
    await started;
    clearFeatureModSegmentsMemory("buildings", root);
    releaseRead();

    await expect(pendingLoad).resolves.toEqual({});
    zstdState.gate = undefined;
    zstdState.onDecompress = undefined;
    expect((await loadFeatureModSegments(cacheOptions, [packA]))[keyA].rows).toEqual(["a"]);
  });

  it("serializes pruning and a concurrent re-add without deleting the new payload", async () => {
    const largeCache = options(root, 2);
    const smallCache = options(root, 1);
    const packA = path.join(root, "a.pack");
    const packB = path.join(root, "b.pack");
    const keyB = normalizeFeatureModSegmentPackPath(packB);
    await saveFeatureModSegments(largeCache, segments([packA, segment(1, 1, "a")], [packB, segment(2, 2, "b")]));
    clearFeatureModSegmentsMemory("buildings", root);

    const pendingPrune = saveFeatureModSegments(smallCache, segments([packA, segment(1, 10, "a")]), [packA]);
    const pendingReAdd = saveFeatureModSegments(smallCache, segments([packB, segment(2, 20, "b-new")]), [packB]);
    await Promise.all([pendingPrune, pendingReAdd]);

    clearFeatureModSegmentsMemory("buildings", root);
    expect((await loadFeatureModSegments(smallCache, [packB]))[keyB].rows).toEqual(["b-new"]);
  });

  it("returns newly built data when its first payload write fails without changing valid files", async () => {
    const cacheOptions = options(root);
    const packA = path.join(root, "a.pack");
    const packB = path.join(root, "b.pack");
    const keyB = normalizeFeatureModSegmentPackPath(packB);
    await saveFeatureModSegments(cacheOptions, segments([packA, segment(1, 1, "a")]));
    const indexPath = getFeatureModSegmentsIndexPath(root, "buildings");
    const payloadAPath = getFeatureModSegmentPayloadPath(root, "buildings", packA);
    const indexBefore = await fs.readFile(indexPath);
    const payloadABefore = await fs.readFile(payloadAPath);
    await fs.mkdir(getFeatureModSegmentPayloadPath(root, "buildings", packB));
    clearFeatureModSegmentsMemory("buildings", root);
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const saved = await saveFeatureModSegments(cacheOptions, segments([packB, segment(2, 2, "b")]), [packB]);

    expect(saved[keyB].rows).toEqual(["b"]);
    expect(await fs.readFile(indexPath)).toEqual(indexBefore);
    expect(await fs.readFile(payloadAPath)).toEqual(payloadABefore);
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });
});
