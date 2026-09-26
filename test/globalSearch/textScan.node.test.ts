import { describe, expect, it } from "vitest";

import { createSearchMatcher } from "../../src/globalSearch/matcher";
import { scanTextForMatches } from "../../src/globalSearch/textScan";

describe("global search text scanner", () => {
  it("reports line, column and decoded offset across newline forms and a BOM", () => {
    const text = "\ufefffirst\r\nsecond\rthird\nfourth";
    const [match] = scanTextForMatches(text, createSearchMatcher("third", { caseSensitive: true }));

    expect(match).toMatchObject({ line: 3, column: 1, offset: 15, excerpt: "third" });
  });

  it("caps matches per file and reports that more were available", () => {
    const matches = scanTextForMatches("needle needle needle", createSearchMatcher("needle", { caseSensitive: true }), {
      maxMatches: 2,
    });

    expect(matches).toHaveLength(2);
    expect(matches.truncated).toBe(true);
  });

  it("advances a regex matcher across multiple matches", () => {
    const matches = scanTextForMatches("needle needle", createSearchMatcher("needle", { regex: true }));
    expect(matches.map((match) => match.offset)).toEqual([0, 7]);
  });

  it("keeps line accounting linear across many matches", () => {
    const text = `${"filler\n".repeat(2000)}needle\nneedle\nneedle`;
    const matches = scanTextForMatches(text, createSearchMatcher("needle", { caseSensitive: true }));

    expect(matches.map((match) => match.line)).toEqual([2001, 2002, 2003]);
  });
});
