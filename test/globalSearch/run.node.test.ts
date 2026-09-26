import { describe, expect, it } from "vitest";

import type { Pack, PackedFile } from "../../src/packFileTypes";
import { runGlobalSearch, type GlobalSearchRunDeps } from "../../src/globalSearch/run";
import { MAX_GLOBAL_SEARCH_QUERY_LENGTH } from "../../src/globalSearch/types";
import type { GlobalSearchRequest, GlobalSearchResult } from "../../src/globalSearch/types";

const makeRequest = (overrides: Partial<GlobalSearchRequest> = {}): GlobalSearchRequest => ({
  searchId: "search-1",
  query: "needle",
  caseSensitive: true,
  regex: false,
  kinds: { db: true, loc: true, text: true, rigidModel: true },
  sources: [{ kind: "pack", path: "mod.pack" }],
  ...overrides,
});

const textFile: PackedFile = {
  name: "scripts\\test.lua",
  file_size: 6,
  start_pos: 0,
};
const rigidFile: PackedFile = {
  name: "variantmeshes\\test.rigid_model_v2",
  file_size: 6,
  start_pos: 0,
};
const dbFile: PackedFile = {
  name: "db\\test_tables\\data__",
  file_size: 0,
  start_pos: 0,
  tableSchema: {
    version: 1,
    fields: [{ name: "key", field_type: "StringU8", is_key: true, default_value: "" }],
  },
  schemaFields: [{ type: "StringU8", fields: [{ type: "String", val: "needle" }] }],
};

const pack: Pack = {
  name: "mod.pack",
  path: "mod.pack",
  packedFiles: [dbFile, textFile, rigidFile],
  packHeader: {} as Pack["packHeader"],
  lastChangedLocal: 0,
  size: 0,
  readTables: "all",
};

const makeDeps = (overrides: Partial<GlobalSearchRunDeps> = {}): GlobalSearchRunDeps => {
  const emitted: GlobalSearchResult[] = [];
  const deps: GlobalSearchRunDeps = {
    getVanillaPackIndex: async () => undefined,
    getVanillaPackPathsInLoadOrder: () => [],
    searchVanillaDb: async () => undefined,
    getVanillaLocReader: async () => undefined,
    forEachPackedFileBuffer: async (_path, wanted, visit) => {
      for (const file of [textFile, rigidFile]) {
        if (wanted(file.name)) await visit(file, Buffer.from("needle"));
      }
    },
    readPackRegistered: async () => pack,
    forEachPackLocEntry: (_pack, visit) => {
      visit("loc_needle", "A value", "text\\db\\test.loc");
    },
    isCanceled: () => false,
    report: () => undefined,
    emit: (batch) => emitted.push(...batch.results),
    yieldToEventLoop: async () => undefined,
    ...overrides,
  };
  return Object.assign(deps, { emitted });
};

describe("global search run", () => {
  it("searches each enabled kind and returns the complete streamed result set", async () => {
    const deps = makeDeps();
    const response = await runGlobalSearch(makeRequest(), {}, deps);

    expect(response.success).toBe(true);
    expect(response.counts).toEqual({ db: 1, loc: 1, text: 1, rigidModel: 1 });
    expect(response.results).toHaveLength(4);
    expect(deps.emitted).toEqual(response.results);
    expect(response.results.every((result) => result.packPath && result.packLabel)).toBe(true);
  });

  it("guards file reads with a size limit even when the request omits one", async () => {
    let seenMaxFileBytes: number | undefined;
    const deps = makeDeps({
      forEachPackedFileBuffer: async (_path, wanted, visit, options) => {
        seenMaxFileBytes = options?.maxFileBytes;
        if (wanted(textFile.name)) await visit(textFile, Buffer.from("needle"));
      },
    });

    await runGlobalSearch(makeRequest({ kinds: { db: false, loc: false, text: true, rigidModel: false } }), {}, deps);

    expect(seenMaxFileBytes).toBeGreaterThan(0);
    expect(Number.isFinite(seenMaxFileBytes)).toBe(true);
  });

  it("honours an explicit file size limit from the request", async () => {
    let seenMaxFileBytes: number | undefined;
    const deps = makeDeps({
      forEachPackedFileBuffer: async (_path, wanted, visit, options) => {
        seenMaxFileBytes = options?.maxFileBytes;
        if (wanted(textFile.name)) await visit(textFile, Buffer.from("needle"));
      },
    });

    await runGlobalSearch(
      makeRequest({ kinds: { db: false, loc: false, text: true, rigidModel: false }, maxFileBytes: 1234 }),
      {},
      deps,
    );

    expect(seenMaxFileBytes).toBe(1234);
  });

  it("rejects a query past the shared length limit", async () => {
    const response = await runGlobalSearch(
      makeRequest({ query: "n".repeat(MAX_GLOBAL_SEARCH_QUERY_LENGTH + 1) }),
      {},
      makeDeps(),
    );

    expect(response.success).toBe(false);
    expect(response.error).toBe("Search query is too long.");
  });

  it("accepts a query exactly at the shared length limit", async () => {
    const response = await runGlobalSearch(
      makeRequest({ query: "n".repeat(MAX_GLOBAL_SEARCH_QUERY_LENGTH) }),
      {},
      makeDeps(),
    );

    expect(response.success).toBe(true);
  });

  it("reads a pack once when DB and loc are both enabled", async () => {
    let reads = 0;
    const deps = makeDeps({ readPackRegistered: async () => (reads++, pack) });
    await runGlobalSearch(makeRequest({ kinds: { db: true, loc: true, text: false, rigidModel: false } }), {}, deps);
    expect(reads).toBe(1);
  });

  it("reports a missing vanilla DB cache as a warning", async () => {
    const response = await runGlobalSearch(
      makeRequest({ sources: [{ kind: "vanilla" }], kinds: { db: true, loc: false, text: false, rigidModel: false } }),
      {},
      makeDeps(),
    );
    expect(response.warnings).toContain("Base game DB cache unavailable.");
  });

  it("marks per-file caps as truncated", async () => {
    const response = await runGlobalSearch(
      makeRequest({ kinds: { db: false, loc: false, text: true, rigidModel: false }, maxResultsPerFile: 1 }),
      {},
      makeDeps({
        forEachPackedFileBuffer: async (_path, wanted, visit) => {
          if (wanted(textFile.name)) await visit(textFile, Buffer.from("needle needle"));
        },
      }),
    );
    expect(response.results).toHaveLength(1);
    expect(response.truncated).toBe(true);
  });

  it("warns when a selected pack has unsaved viewer changes", async () => {
    const response = await runGlobalSearch(
      makeRequest({ kinds: { db: false, loc: false, text: false, rigidModel: false } }),
      { packs: [{ path: "mod.pack", hasUnsavedChanges: true }] },
      makeDeps(),
    );

    expect(response.warnings).toContain("mod.pack: unsaved viewer changes are not included; search uses saved data.");
  });

  it("keeps a single unreadable pack from failing the whole search", async () => {
    const response = await runGlobalSearch(
      makeRequest({ kinds: { db: false, loc: false, text: true, rigidModel: false } }),
      {},
      makeDeps({
        forEachPackedFileBuffer: async () => {
          throw new Error("corrupt pack index");
        },
      }),
    );

    expect(response.success).toBe(true);
    expect(response.warnings).toContain("mod.pack: could not read pack (corrupt pack index).");
  });

  it("uses the async vanilla loc walk so cancellation can arrive between batches", async () => {
    let canceled = false;
    const locReader = {
      get: () => undefined,
      forEachEntry: () => undefined,
      forEachEntryAsync: async (
        visit: (key: string, value: string, rank: number, sourceLabel?: string) => boolean | void,
        options?: { yieldToEventLoop?: () => Promise<void> },
      ) => {
        if (visit("loc_key", "needle", 0, "localisation.pack\0text\\test.loc") === false) return;
        canceled = true;
        await options?.yieldToEventLoop?.();
        visit("second_key", "needle", 1, "localisation.pack\0text\\test.loc");
      },
      count: 2,
      residentBytes: 0,
      close: () => undefined,
    };
    const response = await runGlobalSearch(
      makeRequest({ sources: [{ kind: "vanilla" }], kinds: { db: false, loc: true, text: false, rigidModel: false } }),
      {},
      makeDeps({
        getVanillaLocReader: async () => locReader,
        getVanillaPackPathsInLoadOrder: () => ["vanilla.pack"],
        isCanceled: () => canceled,
      }),
    );

    expect(response.canceled).toBe(true);
    expect(response.results).toHaveLength(1);
  });

  it("stops when cancellation becomes observable", async () => {
    let canceled = false;
    const response = await runGlobalSearch(
      makeRequest({ kinds: { db: false, loc: false, text: true, rigidModel: false } }),
      {},
      makeDeps({
        isCanceled: () => canceled,
        forEachPackedFileBuffer: async (_path, wanted, visit) => {
          if (wanted(textFile.name)) {
            canceled = true;
            await visit(textFile, Buffer.from("needle"));
          }
        },
      }),
    );
    expect(response.canceled).toBe(true);
  });
});
