import * as fs from "fs";
import * as nodePath from "path";
import { describe, expect, it } from "vitest";

import { BUILDINGS_TABLES, buildBuildingsData } from "../src/buildingsData/data";
import { resolveRegionBuildings } from "../src/buildingsData/derive";
import type { BuildingsRegionView, BuildingsTableRows } from "../src/buildingsData/types";
import {
  extractCampaignTableIdentity,
  extractStartposRegionSlotTemplates,
  openEsfBuffer,
  parseEsfDocument,
} from "../tools/esf/src";

/**
 * Checks the derivation against what the game actually drew.
 *
 * `WHMM_BUILDINGS_DB_DUMP` is an RPFM TSV export laid out as `<table>_tables/*.tsv`, and
 * `WHMM_BUILDINGS_UI_DUMP` is a dump of the in-game building browser's UI hierarchy taken in
 * wh3_main_combi_region_altdorf while playing wh_main_emp_empire. Between them they give a real
 * input and a real expected output, which is the only way to tell whether the chain set,
 * availability, culture variant and building set rules here match the game's.
 *
 * Skipped when either dump is absent, so it costs nothing on a machine without them.
 *
 * One thing this cannot check, because the data is not in the DB at all:
 *
 * - a primary slot holds exactly one chain at a time, decided by who owns the region and whether it
 *   is ruined. The DB lists every alternative, so the settlement_major band legitimately shows more
 *   here than in a live campaign.
 */
const DB_DUMP = process.env.WHMM_BUILDINGS_DB_DUMP ?? "/mnt/k/projects/wh3dump/db";
const UI_DUMP = process.env.WHMM_BUILDINGS_UI_DUMP ?? "/mnt/k/wh3mods/altdorf.txt";
const STARTPOS_FILE =
  process.env.WHMM_BUILDINGS_STARTPOS ?? "/mnt/k/projects/wh3dump/campaigns/wh3_main_combi/startpos.esf";

const haveDumps = fs.existsSync(DB_DUMP) && fs.existsSync(UI_DUMP) && fs.existsSync(STARTPOS_FILE);

const CAMPAIGN = "wh3_main_combi";
const REGION = "wh3_main_combi_region_altdorf";
const CULTURE = "wh_main_emp_empire";
const SUBCULTURE = "wh_main_sc_emp_empire";

/** What the startpos.esf-derived table supplies for this region. */
const EXPECTED_ALTDORF_SLOTS = [
  { slotType: "primary", slotTemplate: "wh_main_special_altdorf_primary" },
  { slotType: "secondary", slotTemplate: "wh_main_special_altdorf_secondary" },
  { slotType: "port", slotTemplate: "wh_main_port" },
];

/**
 * Chains the DB permits at Altdorf that the live game does not draw, with nothing left in the data
 * to tell them apart. Asserted exactly, so a new extra - or one of these disappearing - fails.
 *
 * Was twelve. Two rules, each verified below to hide nothing the game shows, account for seven of
 * them: a level in no building set has no band to be drawn in (the five `greenskin_vandalisation`
 * chains and `wh2_dlc12_dummy_nuclear_ruins`), and a chain whose levels name only other cultures is
 * somebody else's (`wh_main_horde_chaos_trolls`).
 *
 * What is left has genuinely no signal:
 *
 * - **Other Empire provinces' cults.** `wh_main_HUMAN_MIDDENHEIM_worship` and
 *   `wh_main_HUMAN_TALABEC_worship` are narrowed by faction in game; this query pins culture and
 *   subculture but not faction, so both stay in.
 *
 * Showing these is defensible for a modding tool - it shows what the data permits - and the UI marks
 * them rather than hiding them.
 */
const EXPECTED_EXTRAS = ["wh_main_HUMAN_MIDDENHEIM_worship", "wh_main_HUMAN_TALABEC_worship"];

/** RPFM TSV: line 1 is the column names, line 2 is a `#table;version;path` comment, then rows. */
const readTsvTable = (tableName: string): Array<Record<string, string>> => {
  const dir = nodePath.join(DB_DUMP, tableName);
  let fileNames: string[];
  try {
    fileNames = fs.readdirSync(dir).filter((name) => name.endsWith(".tsv"));
  } catch {
    return [];
  }
  const rows: Array<Record<string, string>> = [];
  for (const fileName of fileNames.sort()) {
    const lines = fs.readFileSync(nodePath.join(dir, fileName), "utf8").split(/\r?\n/);
    if (lines.length < 3) continue;
    const headers = lines[0].split("\t");
    for (let index = 2; index < lines.length; index++) {
      if (lines[index] === "") continue;
      const cells = lines[index].split("\t");
      const row: Record<string, string> = {};
      for (let column = 0; column < headers.length; column++) row[headers[column]] = cells[column] ?? "";
      rows.push(row);
    }
  }
  return rows;
};

/** `CcoBuildingSetRecord<set> CcoBuildingChainRecord<chain> <level> > <widget path>` */
const UI_LINE = /^CcoBuildingSetRecord(\S+) CcoBuildingChainRecord(\S+) (\S+)(?: >.*)?$/;

const readGroundTruth = () => {
  const chainToSet = new Map<string, string>();
  const chains = new Set<string>();
  const levels = new Set<string>();
  for (const line of fs.readFileSync(UI_DUMP, "utf8").split(/\r?\n/)) {
    const match = UI_LINE.exec(line);
    if (!match) continue;
    const [, setKey, chainKey, levelKey] = match;
    if (levelKey.startsWith(">")) continue;
    chainToSet.set(chainKey, setKey);
    chains.add(chainKey);
    levels.add(levelKey);
  }
  return { chainToSet, chains, levels };
};

const flattenView = (view: BuildingsRegionView) => {
  const chainToSet = new Map<string, string>();
  const chains = new Set<string>();
  const levels = new Set<string>();
  for (const band of view.bands) {
    for (const column of band.columns) {
      chains.add(column.chainKey);
      if (!chainToSet.has(column.chainKey)) chainToSet.set(column.chainKey, band.setKey);
      for (const tile of column.tiles) levels.add(tile.levelKey);
    }
  }
  return { chainToSet, chains, levels };
};

describe.skipIf(!haveDumps)("buildings derivation against the in-game Altdorf panel", () => {
  const tables: BuildingsTableRows = {};
  for (const tableName of BUILDINGS_TABLES) tables[tableName] = readTsvTable(tableName);
  // The DB dump has no start_pos_* tables. Supply the rows extracted from the real startpos.esf.
  const startpos = fs.readFileSync(STARTPOS_FILE);
  const identity = extractCampaignTableIdentity(startpos, parseEsfDocument(startpos));
  const opened = openEsfBuffer(startpos);
  tables.start_pos_region_slot_templates_tables = extractStartposRegionSlotTemplates(
    opened.buffer,
    parseEsfDocument(opened.buffer),
    identity?.campaignName ?? CAMPAIGN,
  ).map((row) => ({
    campaign: row.campaign,
    region: row.region,
    slot_template: row.slotTemplate,
    slot_type: row.slotType,
  }));
  const data = buildBuildingsData(tables, () => undefined);
  const view = resolveRegionBuildings(data, {
    campaign: CAMPAIGN,
    region: REGION,
    culture: CULTURE,
    subculture: SUBCULTURE,
  });
  const truth = readGroundTruth();
  const ours = flattenView(view);

  it("gets the region's slots from the supplied startpos rows", () => {
    expect(view.slotTemplates.map((slot) => ({ slotType: slot.slotType, slotTemplate: slot.slotTemplate }))).toEqual(
      expect.arrayContaining(EXPECTED_ALTDORF_SLOTS),
    );
  });

  it("read both dumps", () => {
    expect(tables.building_levels_tables.length).toBeGreaterThan(1000);
    expect(truth.chains.size).toBe(17);
    expect(truth.levels.size).toBe(48);
  });

  it("shows every chain the game shows", () => {
    const missing = [...truth.chains].filter((chain) => !ours.chains.has(chain)).sort();
    expect(missing).toEqual([]);
  });

  it("shows every building level the game shows", () => {
    const missing = [...truth.levels].filter((level) => !ours.levels.has(level)).sort();
    expect(missing).toEqual([]);
  });

  it("hides the ruin level of the settlement and port chains, as the game does", () => {
    expect(ours.levels.has("wh_main_special_settlement_altdorf_ruin")).toBe(false);
    expect(ours.levels.has("wh_main_human_port_ruin")).toBe(false);
    // ...while keeping the level-0 first tier of ordinary secondary-slot buildings.
    expect(ours.levels.has("wh_main_emp_barracks_1")).toBe(true);
    expect(ours.levels.has("wh_main_emp_resource_pottery_1")).toBe(true);
  });

  it("drops the ruin-only chains that leaves with nothing to show", () => {
    for (const chain of [
      "wh_main_settlement_chaosruin",
      "wh_main_settlement_norscaruin_khorne",
      "wh_main_settlement_norscaruin_nurgle",
      "wh_main_settlement_norscaruin_slaanesh",
      "wh_main_settlement_norscaruin_tzeentch",
      "wh_main_horde_chaos_settlement",
    ]) {
      expect(ours.chains.has(chain)).toBe(false);
    }
  });

  it("puts each chain in the same building set the game does", () => {
    const mismatched = [...truth.chainToSet.entries()]
      .filter(([chain, setKey]) => ours.chainToSet.has(chain) && ours.chainToSet.get(chain) !== setKey)
      .map(([chain, setKey]) => `${chain}: game=${setKey} ours=${ours.chainToSet.get(chain)}`)
      .sort();
    expect(mismatched).toEqual([]);
  });

  it("shows exactly the documented extras and nothing else", () => {
    const extras = [...ours.chains].filter((chain) => !truth.chains.has(chain)).sort();
    expect(extras).toEqual(EXPECTED_EXTRAS);
  });

  /**
   * Altdorf sits on `wh_main_special_altdorf_primary`, so its primary band is a *special* settlement
   * chain and the generic `<CULTURE>_settlement_major` ones never appear in it. That blind spot let a
   * chain-set rule ship which hid `wh_main_EMPIRE_settlement_major` in every ordinary region while
   * every assertion above stayed green. An ordinary region is checked here for that reason.
   */
  it("still shows the culture's main settlement chain in an ordinary region", () => {
    const ordinary = resolveRegionBuildings(data, {
      campaign: CAMPAIGN,
      // A plain `wh_main_human_major_primary` region rather than a scripted special settlement.
      region: "wh3_main_combi_region_zhufbar",
      culture: CULTURE,
      subculture: SUBCULTURE,
    });
    const chains = new Set(ordinary.bands.flatMap((band) => band.columns.map((column) => column.chainKey)));
    expect(chains.size).toBeGreaterThan(5);
    expect(chains).toContain("wh_main_EMPIRE_settlement_major");
  });

  it("lays the y-axis out by primary settlement tier, not by each building's own level", () => {
    const tiles = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles));
    const rowOf = (levelKey: string) => tiles.find((tile) => tile.levelKey === levelKey)?.tierRow;

    // The settlement chain is the axis: its first tier is row 0 despite being DB level 1.
    expect(rowOf("wh_main_special_settlement_altdorf_1_emp")).toBe(0);
    expect(rowOf("wh_main_special_settlement_altdorf_5_emp")).toBe(4);

    // Every level of that chain has primary_slot_building_building_level_requirement = 0, which is
    // why it cannot be placed by the requirement column like everything else.
    const settlementLevels = tables.building_levels_tables.filter(
      (row) => row.chain === "wh_main_special_settlement_altdorf",
    );
    expect(settlementLevels.every((row) => row.primary_slot_building_building_level_requirement === "0")).toBe(true);

    // A secondary building sits on the tier it requires, whatever its own level is: the barracks is
    // DB level 0 but requires settlement level 1.
    expect(rowOf("wh_main_emp_barracks_1")).toBe(0);
    expect(rowOf("wh_main_emp_barracks_2")).toBe(1);
    // The forges start higher up the ladder even though they are also a level-0 first tier.
    expect(rowOf("wh_main_emp_forges_1")).toBe(1);
  });

  it("unlocks recruitment, which reading `building_units_allowed.enabled` suppressed entirely", () => {
    const tiles = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles));
    // Every vanilla row has `enabled = false`, so gating on it emptied the whole table.
    expect(tiles.some((tile) => tile.recruitable.length > 0)).toBe(true);

    const barracks1 = tiles.find((tile) => tile.levelKey === "wh_main_emp_barracks_1");
    expect(barracks1?.recruitable.map((unit) => unit.unitKey)).toContain("wh_main_emp_inf_swordsmen");
  });

  it("draws real upgrade arrows, from building_upgrades_junction rather than the downgrade table", () => {
    const explicit = view.edges.filter((edge) => !edge.isImplicit);
    expect(explicit.length).toBeGreaterThan(20);
    // Every row of the downgrade table maps a level to itself, so reading it produced self-edges.
    expect(explicit.some((edge) => edge.fromLevelKey === edge.toLevelKey)).toBe(false);
    expect(explicit).toContainEqual(
      expect.objectContaining({ fromLevelKey: "wh_main_emp_barracks_1", toLevelKey: "wh_main_emp_barracks_2" }),
    );
    expect(explicit).toContainEqual(
      expect.objectContaining({
        fromLevelKey: "wh_main_special_settlement_altdorf_4_emp",
        toLevelKey: "wh_main_special_settlement_altdorf_5_emp",
      }),
    );
  });

  it("reads the building set colours the live game ships", () => {
    // The bundled schema still describes colour_r/g/b; the game ships colour_hex.
    const landmark = data.sets["wh2_main_set_landmark"];
    expect([landmark.colourR, landmark.colourG, landmark.colourB]).toEqual([0x64, 0x14, 0x3c]);
  });
});
