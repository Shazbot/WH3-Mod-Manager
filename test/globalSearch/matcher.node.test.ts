import { describe, expect, it } from "vitest";

import { createSearchMatcher } from "../../src/globalSearch/matcher";

describe("global search matcher", () => {
  it("matches literal values with the requested case semantics", () => {
    expect(createSearchMatcher("Needle", { caseSensitive: true }).test("needle")).toBe(false);
    expect(createSearchMatcher("Needle", { caseSensitive: false }).test("a NEEDLE b")).toBe(true);
    expect(createSearchMatcher("Needle", { caseSensitive: true }).find("xxNeedleyy")).toEqual({ start: 2, end: 8 });
  });

  it("supports regex matching without leaking lastIndex", () => {
    const matcher = createSearchMatcher("needle", { regex: true });
    expect(matcher.test("needle")).toBe(true);
    expect(matcher.test("needle")).toBe(true);
    expect(matcher.find("x needle y")).toEqual({ start: 2, end: 8 });
    expect(matcher.find("needle needle", 6)).toEqual({ start: 7, end: 13 });
    expect(matcher.toRegExp("gy").flags).not.toMatch(/[gy]/);
  });

  it("does not turn an invalid regex into a literal search", () => {
    const matcher = createSearchMatcher("effect[", { regex: true });
    expect(matcher.isValidRegex).toBe(false);
    expect(matcher.test("effect[")).toBe(false);
    expect(matcher.find("effect[")).toBeUndefined();
  });
});
