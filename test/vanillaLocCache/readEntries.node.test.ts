import { describe, expect, it } from "vitest";

import { buildVanillaLocCacheBytes } from "../../src/vanillaLocCache/build";
import { createMemorySource, openVanillaLocCache } from "../../src/vanillaLocCache/read";

describe("vanilla loc cache enumeration", () => {
  it("enumerates in key order with source provenance and supports early exit", () => {
    const reader = openVanillaLocCache(
      createMemorySource(
        buildVanillaLocCacheBytes([
          ["b", "two", "pack-b\0text\\db\\b.loc"],
          ["a", "one", "pack-a\0text\\db\\a.loc"],
        ]),
      ),
    )!;
    const entries: Array<[string, string, string | undefined]> = [];
    reader.forEachEntry((key, value, _rank, source) => {
      entries.push([key, value, source]);
      return entries.length < 1;
    });

    expect(entries).toEqual([["a", "one", "pack-a\0text\\db\\a.loc"]]);
  });

  it("reads values in batches rather than one source read per entry by default", () => {
    const bytes = buildVanillaLocCacheBytes(
      Array.from({ length: 4 }, (_, index) => [`key${index}`, `value-${index}`] as const),
    );
    const source = createMemorySource(bytes);
    const reader = openVanillaLocCache(source)!;
    const afterOpen = source.bytesRead;
    const values: string[] = [];
    reader.forEachEntry((_key, value) => values.push(value));

    expect(values).toEqual(["value-0", "value-1", "value-2", "value-3"]);
    expect(source.bytesRead - afterOpen).toBe(values.join("").length);
  });

  it("supports an async early-exit walk with event-loop yields", async () => {
    const reader = openVanillaLocCache(
      createMemorySource(
        buildVanillaLocCacheBytes([
          ["a", "one"],
          ["b", "two"],
          ["c", "three"],
        ]),
      ),
    )!;
    const keys: string[] = [];
    let yields = 0;

    await reader.forEachEntryAsync!(
      (key) => {
        keys.push(key);
        return keys.length < 2;
      },
      { yieldEvery: 1, yieldToEventLoop: async () => void yields++ },
    );

    expect(keys).toEqual(["a", "b"]);
    expect(yields).toBe(1);
  });
});
