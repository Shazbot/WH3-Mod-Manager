import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src", "index.css"), "utf8");

const getGridTemplate = (className: string) => {
  const rule = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(css);
  expect(rule, `${className} is missing from index.css`).not.toBeNull();
  const template = /grid-template-columns:\s*([^;]+);/.exec(rule?.[1] ?? "");
  expect(template, `${className} has no grid-template-columns`).not.toBeNull();
  return (template?.[1] ?? "").trim();
};

const compactClasses = [
  "grid-mods-compact",
  "grid-mods-compact-thumbs",
  "grid-mods-compact-config",
  "grid-mods-compact-thumbs-config",
];

describe("compact mod list grid templates", () => {
  /*
   * The sticky header row and every virtualized mod row are separate grid containers that share only the
   * template. An intrinsic track resolves against whatever each container happens to hold - the header's
   * thumbnail icon versus a row's 4rem image - so the two stop lining up and every later column drifts.
   */
  it.each(compactClasses)("%s sizes every track without intrinsic keywords", (className) => {
    const template = getGridTemplate(className);
    expect(template).not.toMatch(/max-content|min-content|fit-content|\bauto\b/);
  });

  it("keeps a column for each cell the compact row renders", () => {
    const trackCount = (className: string) => getGridTemplate(className).split(/\s+/).length;

    // order, name, last updated - plus a thumbnail and a configuration column when those are shown.
    expect(trackCount("grid-mods-compact")).toBe(3);
    expect(trackCount("grid-mods-compact-thumbs")).toBe(4);
    expect(trackCount("grid-mods-compact-config")).toBe(4);
    expect(trackCount("grid-mods-compact-thumbs-config")).toBe(5);
  });
});
