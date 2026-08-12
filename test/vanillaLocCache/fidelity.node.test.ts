import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as nodePath from "path";

import { buildVanillaLocCacheBytes } from "../../src/vanillaLocCache/build";
import { createMemorySource, openVanillaLocCache } from "../../src/vanillaLocCache/read";

/**
 * Opt in with `WHMM_FIDELITY=1 yarn test test/vanillaLocCache/fidelity.node.test.ts`.
 *
 * Off by default because it needs a dump of the game's text/db, which is not in the repo. This is
 * the test that proves the cache holds real game locs, at real scale, and reports the size and
 * resident-memory figures the cache exists for.
 *
 * Set WHMM_LOC_DUMP to point somewhere other than the default.
 */
const LOC_DUMP_DIR = process.env.WHMM_LOC_DUMP ?? "/mnt/k/projects/wh3dump/text/db";

const haveDump = process.env.WHMM_FIDELITY === "1" && fs.existsSync(LOC_DUMP_DIR);

const readDumpEntries = (): Array<readonly [string, string]> => {
  const entries: Array<readonly [string, string]> = [];
  for (const fileName of fs.readdirSync(LOC_DUMP_DIR)) {
    if (!fileName.endsWith(".loc.tsv")) continue;
    const lines = fs.readFileSync(nodePath.join(LOC_DUMP_DIR, fileName), "utf8").split("\n");
    // Row 0 is the column header, and the `#Loc;` row is a format marker, not an entry.
    for (let index = 1; index < lines.length; index++) {
      if (lines[index].startsWith("#Loc;")) continue;
      const columns = lines[index].replace(/\r$/, "").split("\t");
      if (columns.length < 2 || !columns[0]) continue;
      entries.push([columns[0], columns[1]] as const);
    }
  }
  return entries;
};

describe.skipIf(!haveDump)("vanilla loc cache fidelity", () => {
  // Verifying a quarter of a million lookups one at a time is well past the default timeout.
  it("round-trips every entry in the game's own locs", () => {
    const entries = readDumpEntries();
    expect(entries.length).toBeGreaterThan(100_000);

    const bytes = buildVanillaLocCacheBytes(entries);
    const reader = openVanillaLocCache(createMemorySource(bytes))!;
    expect(reader).toBeDefined();

    // Last-wins, so the expectation has to be built the same way the builder folds duplicates.
    const expected = new Map<string, string>();
    for (const [key, value] of entries) if (key !== "") expected.set(key, value);
    expect(reader.count).toBe(expected.size);

    let checked = 0;
    for (const [key, value] of expected) {
      const actual = reader.get(key);
      if (actual !== value) {
        throw new Error(`loc ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
      }
      checked++;
    }
    expect(checked).toBe(expected.size);

    const MB = 1024 * 1024;
    console.log(
      `loc cache: ${expected.size.toLocaleString()} entries, ` +
        `${(bytes.length / MB).toFixed(1)} MB on disk, ` +
        `${(reader.residentBytes / MB).toFixed(1)} MB resident`,
    );
  }, 120_000);

  it("serves a unit-viewer sized slice while touching a fraction of the file", () => {
    const prefixes = [
      "cultures_subcultures_name_",
      "ground_types_onscreen_name_",
      "land_units_onscreen_name_",
      "ui_unit_group_parents_onscreen_name_",
      "unit_abilities_additional_ui_effects_localised_text_",
      "unit_abilities_onscreen_name_",
      "unit_abilities_tooltip_text_",
      "unit_ability_source_types_name_",
      "unit_ability_types_onscreen_name_",
      "unit_attributes_bullet_text_",
      "unit_stat_localisations_onscreen_name_",
    ];
    const entries = readDumpEntries();
    const bytes = buildVanillaLocCacheBytes(entries);
    const source = createMemorySource(bytes);
    const reader = openVanillaLocCache(source)!;
    const afterOpen = source.bytesRead;

    const wanted = entries.filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix)));
    expect(wanted.length).toBeGreaterThan(1000);
    for (const [key] of wanted) expect(reader.get(key)).toBeDefined();

    // Only the value bytes for what was asked for; the blob is the bulk of the file and stays put.
    expect(source.bytesRead - afterOpen).toBeLessThan(bytes.length / 4);
  }, 120_000);
});
