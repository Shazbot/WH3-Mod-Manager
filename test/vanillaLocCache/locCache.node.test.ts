import { describe, expect, it } from "vitest";

import { buildVanillaLocCacheBytes } from "../../src/vanillaLocCache/build";
import { readVanillaLocCacheHeader, VANILLA_LOC_CACHE_HEADER_BYTES } from "../../src/vanillaLocCache/format";
import { createMemorySource, openVanillaLocCache } from "../../src/vanillaLocCache/read";

const openFrom = (entries: Array<readonly [string, string]>) => {
  const bytes = buildVanillaLocCacheBytes(entries);
  const reader = openVanillaLocCache(createMemorySource(bytes));
  if (!reader) throw new Error("the reader rejected the builder's own output");
  return { reader, bytes };
};

describe("vanilla loc cache", () => {
  it("round-trips entries regardless of the order they were handed over", () => {
    const { reader } = openFrom([
      ["unit_abilities_tooltip_text_zulu", "Zulu tooltip"],
      ["land_units_onscreen_name_alpha", "Alpha"],
      ["unit_abilities_onscreen_name_alpha", "Alpha Ability"],
    ]);

    expect(reader.count).toBe(3);
    expect(reader.get("land_units_onscreen_name_alpha")).toBe("Alpha");
    expect(reader.get("unit_abilities_onscreen_name_alpha")).toBe("Alpha Ability");
    expect(reader.get("unit_abilities_tooltip_text_zulu")).toBe("Zulu tooltip");
    expect(reader.get("not_present")).toBeUndefined();
  });

  it("keeps empty values distinct from missing keys", () => {
    const { reader } = openFrom([
      ["blanked", ""],
      ["present", "text"],
    ]);

    expect(reader.get("blanked")).toBe("");
    expect(reader.get("missing")).toBeUndefined();
  });

  it("applies last-wins for a key that appears more than once", () => {
    const { reader } = openFrom([
      ["shared", "first"],
      ["other", "kept"],
      ["shared", "second"],
    ]);

    expect(reader.get("shared")).toBe("second");
    expect(reader.get("other")).toBe("kept");
    expect(reader.count).toBe(2);
  });

  it("round-trips non-ascii text and keys that straddle a checkpoint boundary", () => {
    // More than one checkpoint interval (64), so lookups cross chunk starts and decode from them.
    const entries = Array.from(
      { length: 200 },
      (_, index) => [`prefix_shared_key_${String(index).padStart(4, "0")}`, `välue ${index} — ✓`] as const,
    );
    const { reader } = openFrom(entries);

    expect(reader.count).toBe(200);
    for (const [key, value] of [entries[0], entries[63], entries[64], entries[128], entries[199]]) {
      expect(reader.get(key)).toBe(value);
    }
  });

  it("reads only the value it was asked for, not the whole blob", () => {
    const entries = Array.from(
      { length: 500 },
      (_, index) => [`key_${String(index).padStart(4, "0")}`, "x".repeat(1000)] as const,
    );
    const bytes = buildVanillaLocCacheBytes(entries);
    const source = createMemorySource(bytes);
    const reader = openVanillaLocCache(source)!;
    const afterOpen = source.bytesRead;

    expect(reader.get("key_0250")).toBe("x".repeat(1000));

    // One value, not the 500 KB blob. The open cost is the key block, which is deliberately resident.
    expect(source.bytesRead - afterOpen).toBe(1000);
    expect(reader.residentBytes).toBeLessThan(bytes.length / 2);
  });

  it("rejects a file that is not this format, and one truncated mid-write", () => {
    const { bytes } = openFrom([["key", "value"]]);

    expect(openVanillaLocCache(createMemorySource(new Uint8Array(4)))).toBeUndefined();
    expect(openVanillaLocCache(createMemorySource(bytes.subarray(0, bytes.length - 1)))).toBeUndefined();

    const wrongMagic = Uint8Array.from(bytes);
    wrongMagic[0] = "X".charCodeAt(0);
    expect(openVanillaLocCache(createMemorySource(wrongMagic))).toBeUndefined();

    const wrongVersion = Uint8Array.from(bytes);
    new DataView(wrongVersion.buffer).setUint32(4, 99, true);
    expect(openVanillaLocCache(createMemorySource(wrongVersion))).toBeUndefined();
  });

  it("writes a header the reader agrees with", () => {
    const { bytes } = openFrom([
      ["a", "1"],
      ["b", "2"],
    ]);
    const meta = readVanillaLocCacheHeader(bytes.subarray(0, VANILLA_LOC_CACHE_HEADER_BYTES));

    expect(meta).toMatchObject({ count: 2, valueBlobLength: 2 });
  });

  it("holds an empty set without tripping the reader", () => {
    const { reader } = openFrom([]);

    expect(reader.count).toBe(0);
    expect(reader.get("anything")).toBeUndefined();
  });
});
