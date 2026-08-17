import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Comments are stripped first: otherwise the text of a comment preceding a rule is captured as part of
// that rule's selector and the exact-match lookup below never finds it.
const css = readFileSync(join(__dirname, "..", "src", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Rules keyed by their exact selector, so `.a` never matches `.a.b`. */
const rulesBySelector = new Map<string, string>();
for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  rulesBySelector.set(selector.trim(), body);
}

const getBody = (selector: string) => {
  const body = rulesBySelector.get(selector);
  expect(body, `${selector} is missing from index.css`).toBeDefined();
  return body ?? "";
};

const getGridTemplate = (selector: string) => {
  const template = /grid-template-columns:\s*([^;]+);/.exec(getBody(selector));
  expect(template, `${selector} has no grid-template-columns`).not.toBeNull();
  return (template?.[1] ?? "").trim();
};

const getVar = (body: string, name: string) => /:\s*([^;]+);/.exec(body.split(name)[1] ?? "")?.[1]?.trim();

const INTRINSIC = /max-content|min-content|fit-content|\bauto\b/;

const compactGrids = [
  "grid-mods-compact",
  "grid-mods-compact-thumbs",
  "grid-mods-compact-config",
  "grid-mods-compact-thumbs-config",
];

const densities = [".mod-list-compact", ".mod-list-compact.mod-list-comfortable", ".mod-list-compact.mod-list-roomy"];

describe("compact mod list grid templates", () => {
  it("keeps a column for each cell the compact row renders", () => {
    const trackCount = (name: string) => getGridTemplate(`.${name}`).split(/\s+/).length;

    // order, name, last updated - plus a thumbnail and a configuration column when those are shown.
    expect(trackCount("grid-mods-compact")).toBe(3);
    expect(trackCount("grid-mods-compact-thumbs")).toBe(4);
    expect(trackCount("grid-mods-compact-config")).toBe(4);
    expect(trackCount("grid-mods-compact-thumbs-config")).toBe(5);
  });

  it.each(compactGrids)("%s sizes every track without intrinsic keywords", (name) => {
    expect(getGridTemplate(`.${name}`)).not.toMatch(INTRINSIC);
  });

  /*
   * The sticky header row and every virtualized mod row are separate grid containers that share only the
   * template. An intrinsic track resolves against whatever each container happens to hold - the header's
   * thumbnail icon versus a row's image - so the two stop lining up and every later column drifts.
   */
  it.each(densities)("%s sizes every track without intrinsic keywords", (selector) => {
    expect(getBody(selector)).not.toMatch(INTRINSIC);
  });

  it("gives the base density every variable the rows and headers read", () => {
    const body = getBody(".mod-list-compact");
    for (const name of [
      "--mod-row-order-w",
      "--mod-row-thumb-col",
      "--mod-row-time-w",
      "--mod-row-gear-w",
      "--mod-row-thumb",
      "--mod-row-pad-y",
      "--mod-row-title-size",
      "--mod-row-title-weight",
      "--mod-row-meta-size",
      "--mod-row-leading",
    ]) {
      expect(getVar(body, name), `${name} is missing from .mod-list-compact`).toBeDefined();
    }
  });

  it("actually gets roomier at each step", () => {
    const rem = (selector: string, name: string) => parseFloat(getVar(getBody(selector), name) ?? "");

    for (const name of ["--mod-row-thumb", "--mod-row-pad-y", "--mod-row-title-size", "--mod-row-leading"]) {
      const compact = rem(".mod-list-compact", name);
      const comfortable = rem(".mod-list-compact.mod-list-comfortable", name);
      const roomy = rem(".mod-list-compact.mod-list-roomy", name);
      expect(comfortable, `${name} comfortable > compact`).toBeGreaterThan(compact);
      expect(roomy, `${name} roomy > comfortable`).toBeGreaterThan(comfortable);
    }
  });
});
