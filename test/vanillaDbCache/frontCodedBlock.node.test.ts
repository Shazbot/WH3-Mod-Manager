import { describe, expect, it } from "vitest";

import {
  FRONT_CODED_CHECKPOINT_INTERVAL,
  buildFrontCodedBlock,
  findFrontCodedPrefixRange,
  findFrontCodedRank,
  readAllFrontCodedEntries,
  readFrontCodedEntry,
  sharedPrefixLength,
} from "../../src/vanillaDbCache/frontCodedBlock";

const sorted = (values: string[]) => values.toSorted();
const blockOf = (values: string[]) => buildFrontCodedBlock(sorted(values));

/** Long enough to span several chunks, with the repeated prefixes real game keys have. */
const manyKeys = () => {
  const keys: string[] = [];
  for (const culture of ["wh_main_grn_greenskins", "wh_main_emp_empire", "wh2_dlc09_tmb_tomb_kings"]) {
    for (let index = 0; index < 100; index++) keys.push(`${culture}_unit_${String(index).padStart(3, "0")}`);
  }
  return sorted(keys);
};

describe("front coded block", () => {
  it("round trips every entry", () => {
    const values = manyKeys();
    const block = buildFrontCodedBlock(values);

    expect(readAllFrontCodedEntries(block)).toEqual(values);
    for (let rank = 0; rank < values.length; rank++) {
      expect(readFrontCodedEntry(block, rank)).toBe(values[rank]);
    }
  });

  it("actually shares prefixes, which is the point", () => {
    const values = manyKeys();
    const plainBytes = values.reduce((total, value) => total + Buffer.byteLength(value) + 1, 0);

    expect(buildFrontCodedBlock(values).bytes.length).toBeLessThan(plainBytes / 2);
  });

  it("reads a rank in the middle of a chunk without the entries before its chunk", () => {
    const values = manyKeys();
    const block = buildFrontCodedBlock(values);
    const rank = FRONT_CODED_CHECKPOINT_INTERVAL * 2 + 5;

    expect(readFrontCodedEntry(block, rank)).toBe(values[rank]);
  });

  it("reads the last entry of a chunk and the first of the next", () => {
    const values = manyKeys();
    const block = buildFrontCodedBlock(values);

    for (const rank of [
      FRONT_CODED_CHECKPOINT_INTERVAL - 1,
      FRONT_CODED_CHECKPOINT_INTERVAL,
      values.length - 1,
    ]) {
      expect(readFrontCodedEntry(block, rank)).toBe(values[rank]);
    }
  });

  it("finds every value by binary search", () => {
    const values = manyKeys();
    const block = buildFrontCodedBlock(values);

    for (let rank = 0; rank < values.length; rank++) {
      expect(findFrontCodedRank(block, values[rank])).toBe(rank);
    }
  });

  it("reports a missing value as absent, including before and after everything", () => {
    const block = blockOf(["b_one", "b_two", "c_three"]);

    expect(findFrontCodedRank(block, "a_before_all")).toBe(-1);
    expect(findFrontCodedRank(block, "b_onx")).toBe(-1);
    expect(findFrontCodedRank(block, "zzz_after_all")).toBe(-1);
  });

  it("gives a prefix match as a contiguous rank range", () => {
    const values = manyKeys();
    const block = buildFrontCodedBlock(values);

    const { start, end } = findFrontCodedPrefixRange(block, "wh_main_grn_");

    expect(end - start).toBe(100);
    for (let rank = start; rank < end; rank++) {
      expect(readFrontCodedEntry(block, rank)!.startsWith("wh_main_grn_")).toBe(true);
    }
    // And nothing outside the range matches, which is what makes the range test sound.
    expect(values.filter((value) => value.startsWith("wh_main_grn_"))).toHaveLength(100);
  });

  it("gives an empty range for a prefix nothing matches", () => {
    const block = blockOf(["alpha", "beta"]);

    expect(findFrontCodedPrefixRange(block, "gamma")).toEqual({ start: 2, end: 2 });
  });

  it("handles an empty block", () => {
    const block = buildFrontCodedBlock([]);

    expect(block.count).toBe(0);
    expect(readAllFrontCodedEntries(block)).toEqual([]);
    expect(readFrontCodedEntry(block, 0)).toBeUndefined();
    expect(findFrontCodedRank(block, "anything")).toBe(-1);
  });

  it("handles a single entry and the empty string", () => {
    const block = buildFrontCodedBlock(["", "only"]);

    expect(readFrontCodedEntry(block, 0)).toBe("");
    expect(readFrontCodedEntry(block, 1)).toBe("only");
    expect(findFrontCodedRank(block, "")).toBe(0);
  });

  it("round trips non-ascii and characters outside the BMP", () => {
    // A shared prefix must not be cut through a surrogate pair - half a pair is a different string.
    const values = sorted(["Épée des Ténèbres", "Épée de feu", "剣", "剣士", "🗡x", "🗡y", "🗡"]);
    const block = buildFrontCodedBlock(values);

    expect(readAllFrontCodedEntries(block)).toEqual(values);
    for (const value of values) expect(findFrontCodedRank(block, value)).toBeGreaterThanOrEqual(0);
  });

  it("round trips a prefix longer than a byte can count", () => {
    const long = "x".repeat(400);
    const values = sorted([long + "a", long + "b", long + "c"]);

    expect(readAllFrontCodedEntries(buildFrontCodedBlock(values))).toEqual(values);
  });

  it("keeps duplicate-free ranks stable when values differ only by case", () => {
    const values = sorted(["Alpha", "alpha", "ALPHA"]);
    const block = buildFrontCodedBlock(values);

    for (const value of values) {
      expect(readFrontCodedEntry(block, findFrontCodedRank(block, value))).toBe(value);
    }
  });
});

describe("shared prefix length", () => {
  it("counts the common leading code units", () => {
    expect(sharedPrefixLength("wh_main_grn", "wh_main_emp")).toBe(8);
    expect(sharedPrefixLength("abc", "abc")).toBe(3);
    expect(sharedPrefixLength("abc", "xyz")).toBe(0);
    expect(sharedPrefixLength("", "abc")).toBe(0);
  });

  it("refuses to split a surrogate pair", () => {
    // Both start with the same high surrogate but differ in the low one, so the naive answer is 1 -
    // which would store half a character.
    expect(sharedPrefixLength("🗡", "🗢")).toBe(0);
  });
});
