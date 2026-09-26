import { describe, expect, it } from "vitest";

import { scanBytesForMatches } from "../../src/globalSearch/byteScan";
import { createSearchMatcher } from "../../src/globalSearch/matcher";

describe("global search byte scanner", () => {
  it("finds UTF-16LE text at both byte alignments", () => {
    const matcher = createSearchMatcher("needle", { caseSensitive: true });
    const even = scanBytesForMatches(Buffer.concat([Buffer.from("xx"), Buffer.from("needle", "utf16le")]), matcher);
    const odd = scanBytesForMatches(Buffer.concat([Buffer.from("x"), Buffer.from("needle", "utf16le")]), matcher);

    expect(even.some((match) => match.encoding === "utf16le" && match.offset === 2)).toBe(true);
    expect(odd.some((match) => match.encoding === "utf16le" && match.offset === 1)).toBe(true);
  });

  it("keeps a match that straddles a small window boundary", () => {
    const matches = scanBytesForMatches(Buffer.from("xxxxneedlexxxx"), createSearchMatcher("needle"), {
      chunkBytes: 8,
      overlapBytes: 8,
    });

    expect(matches.some((match) => match.encoding === "utf8" && match.offset === 4)).toBe(true);
  });

  it("reports truncation only when a further match exists", () => {
    const two = Buffer.from("needle needle");
    const three = Buffer.from("needle needle needle");
    const matcher = () => createSearchMatcher("needle", { caseSensitive: true });

    const exact = scanBytesForMatches(two, matcher(), { maxMatches: 2 });
    expect(exact).toHaveLength(2);
    expect(exact.truncated).toBe(false);

    const capped = scanBytesForMatches(three, matcher(), { maxMatches: 2 });
    expect(capped).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });

  it("reports the real byte offset when a window starts inside a UTF-8 sequence", () => {
    // "abcd" is bytes 0-3, the euro sign is bytes 4-6, "needle" starts at byte 7. With these
    // windows the second one begins at byte 5 - the middle of the euro sign.
    const buffer = Buffer.concat([Buffer.from("abcd"), Buffer.from("\u20ac"), Buffer.from("needle")]);
    expect(buffer.length).toBe(13);

    const matches = scanBytesForMatches(buffer, createSearchMatcher("needle", { caseSensitive: true }), {
      chunkBytes: 8,
      overlapBytes: 3,
    });

    expect(matches.filter((match) => match.encoding === "utf8").map((match) => match.offset)).toEqual([7]);
  });

  it("does not treat an internal window boundary as a whole-file anchor", () => {
    const buffer = Buffer.from("xxxxneedlexxxx");
    expect(
      scanBytesForMatches(buffer, createSearchMatcher("^needle", { regex: true }), { chunkBytes: 8, overlapBytes: 4 }),
    ).toEqual([]);
    expect(
      scanBytesForMatches(buffer, createSearchMatcher("needle$", { regex: true }), { chunkBytes: 8, overlapBytes: 4 }),
    ).toEqual([]);
  });
});
