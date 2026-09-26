import { describe, expect, it } from "vitest";

import { compileVisualsUnitFilter } from "../src/visuals/unitFilter";

describe("Visuals unit filter", () => {
  it("compiles case-insensitive regular expressions", () => {
    const filter = compileVisualsUnitFilter("^(emp|brt).*lord$");
    expect(filter.error).toBeUndefined();
    expect(filter.regex?.test("EMP_general_lord")).toBe(true);
    expect(filter.regex?.test("wh3_main_ksl_lord")).toBe(false);
  });

  it("returns no matcher for blank input", () => {
    expect(compileVisualsUnitFilter("   ")).toEqual({});
  });

  it("reports invalid expressions without throwing", () => {
    const filter = compileVisualsUnitFilter("[");
    expect(filter.regex).toBeUndefined();
    expect(filter.error).toContain("regular expression");
  });
});
