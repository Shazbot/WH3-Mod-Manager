import * as fs from "fs";
import * as nodePath from "path";
import { describe, expect, it } from "vitest";

import { BUILDINGS_TABLES, buildBuildingsData } from "../src/buildingsData/data";
import {
  resolveCulturesWithoutChains,
  resolveForeignSlotTypes,
  resolveRegionBuildings,
} from "../src/buildingsData/derive";
import { computeBoardLayout } from "../src/components/buildings/buildingsLayout";
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
 * `WHMM_BUILDINGS_DRAKENHOF_UI_DUMP` is the same panel in wh3_main_combi_region_castle_drakenhof on
 * turn 1 as wh_main_vmp_schwartzhafen (9.0.5), kept as the raw `[ui]` script-log lines, so a second
 * culture checks the same rules from another side.
 *
 * Skipped when a dump is absent, so it costs nothing on a machine without them.
 *
 * One thing this cannot check, because the data is not in the DB at all:
 *
 * - a primary slot holds exactly one chain at a time, decided by who owns the region and whether it
 *   is ruined. The DB lists every alternative, so the settlement_major band legitimately shows more
 *   here than in a live campaign.
 */
const DB_DUMP = process.env.WHMM_BUILDINGS_DB_DUMP ?? "/mnt/k/projects/wh3dump/db";
const UI_DUMP = process.env.WHMM_BUILDINGS_UI_DUMP ?? "/mnt/k/wh3mods/altdorf.txt";
const DRAKENHOF_UI_DUMP = process.env.WHMM_BUILDINGS_DRAKENHOF_UI_DUMP ?? "/mnt/k/wh3mods/drakenhof.txt";
/**
 * The wh3dump copy went missing once and the whole suite skipped silently, so fall back to the loose
 * startpos the game itself ships.
 */
const STARTPOS_FILE =
  process.env.WHMM_BUILDINGS_STARTPOS ??
  [
    "/mnt/k/projects/wh3dump/campaigns/wh3_main_combi/startpos.esf",
    "/mnt/k/SteamLibrary/steamapps/common/Total War WARHAMMER III/data/campaigns/wh3_main_combi/startpos.esf",
  ].find((candidate) => fs.existsSync(candidate)) ??
  "";

const haveDumps = fs.existsSync(DB_DUMP) && fs.existsSync(UI_DUMP) && fs.existsSync(STARTPOS_FILE);
const haveDrakenhofDumps = fs.existsSync(DB_DUMP) && fs.existsSync(DRAKENHOF_UI_DUMP) && fs.existsSync(STARTPOS_FILE);
/** Foreign slots are region-agnostic, so their checks need only the DB dump. */
const haveDbDump = fs.existsSync(DB_DUMP);

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
 * Was twelve. Three rules, each verified below to hide nothing the game shows, account for eight of
 * them: a level in no building set has no band to be drawn in (the five `greenskin_vandalisation`
 * chains and `wh2_dlc12_dummy_nuclear_ruins`), a chain whose levels name only other cultures is
 * somebody else's (`wh_main_horde_chaos_trolls`), and a chain only a shared chain set offers with no
 * availability set is one the game gives nobody (`wh_main_HUMAN_MIDDENHEIM_worship` since 9.0).
 *
 * What is left:
 *
 * - **Another Empire province's cult.** `wh_main_HUMAN_TALABEC_worship` is narrowed by faction in
 *   game; this query pins culture and subculture but not faction, so it stays in.
 * - **`wh3_dlc29_EMPIRE_worship_ulric`** needs the `wh3_dlc29_loet_boris` DLC, which the account
 *   that took the dump does not own. A 9.0.5 retake drew the same 17 chains and 48 levels as the
 *   original, without it. Ownership is not in the data, so the board marks the chain as DLC.
 * - **`wh3_main_foreign_slot_endgame`**. `wh_start.lua` registers it with
 *   `cm:add_event_restricted_building_record` until the Vermintide endgame fires, which the DB
 *   cannot express. It used to be hidden by accident, by reading settlement type bindings as "only
 *   in that type".
 *
 * Showing these is defensible for a modding tool - it shows what the data permits - and the UI marks
 * them rather than hiding them.
 */
const EXPECTED_EXTRAS = [
  "wh3_dlc29_EMPIRE_worship_ulric",
  "wh3_main_foreign_slot_endgame",
  "wh_main_HUMAN_TALABEC_worship",
];

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

/** Condensed dump (altdorf.txt): `CcoBuildingSetRecord<set> CcoBuildingChainRecord<chain> <level> > <widget path>` */
const UI_LINE = /^CcoBuildingSetRecord(\S+) CcoBuildingChainRecord(\S+) (\S+)(?: >.*)?$/;
/**
 * Raw script-log dump (drakenhof.txt): the full widget path, with the level as the child of the
 * chain's `slot_parent` - which also holds a `template_slot_entry` widget that is not a level.
 */
const LOG_CHAIN = /CcoBuildingSetRecord(\S+) > chain_list_parent > chain_list > CcoBuildingChainRecord(\S+)/;
const LOG_LEVEL = /CcoBuildingChainRecord\S+ > building_chain > slot_parent > ([^\s>]+)/;

const readGroundTruth = (dumpPath: string) => {
  const chainToSet = new Map<string, string>();
  const chains = new Set<string>();
  const levels = new Set<string>();
  for (const line of fs.readFileSync(dumpPath, "utf8").split(/\r?\n/)) {
    const match = UI_LINE.exec(line);
    if (match) {
      const [, setKey, chainKey, levelKey] = match;
      if (levelKey.startsWith(">")) continue;
      chainToSet.set(chainKey, setKey);
      chains.add(chainKey);
      levels.add(levelKey);
      continue;
    }
    const chainMatch = LOG_CHAIN.exec(line);
    if (!chainMatch) continue;
    chainToSet.set(chainMatch[2], chainMatch[1]);
    chains.add(chainMatch[2]);
    const levelKey = LOG_LEVEL.exec(line)?.[1];
    if (levelKey && levelKey !== "template_slot_entry") levels.add(levelKey);
  }
  return { chainToSet, chains, levels };
};

/** The shipped DB plus the region slots from the real startpos.esf, built once for every suite. */
let shippedData: { tables: BuildingsTableRows; data: ReturnType<typeof buildBuildingsData> } | undefined;
const loadShippedData = () => {
  if (shippedData) return shippedData;
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
  shippedData = { tables, data: buildBuildingsData(tables, () => undefined) };
  return shippedData;
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
  // Vitest still collects skipped suites; avoid reading optional fixtures during collection.
  if (!haveDumps) return;
  const { tables, data } = loadShippedData();
  const view = resolveRegionBuildings(data, {
    campaign: CAMPAIGN,
    region: REGION,
    culture: CULTURE,
    subculture: SUBCULTURE,
  });
  const truth = readGroundTruth(UI_DUMP);
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

  it("marks the DLC chain the game hides from a player without the pack, and nothing it draws", () => {
    const tiles = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles));
    const marked = [...new Set(tiles.filter((tile) => tile.ownershipContentPacks).map((tile) => tile.chainKey))];
    expect(marked).toEqual(["wh3_dlc29_EMPIRE_worship_ulric"]);
    expect(tiles.find((tile) => tile.chainKey === "wh3_dlc29_EMPIRE_worship_ulric")?.ownershipContentPacks).toEqual([
      "wh3_dlc29_loet_boris",
    ]);
  });

  /**
   * 9.0 deleted the only availability row of several vampire chains that still sit in the generic
   * secondary chain sets Altdorf's secondary slot reaches. Read as "unrestricted", that drew them in
   * an Empire settlement.
   */
  it("hides the shared chain set chains 9.0 left without an availability set", () => {
    const retired = ["wh_main_VAMPIRES_ossuary", "wh_main_VAMPIRES_armoury"];
    const query = { campaign: CAMPAIGN, region: REGION, culture: CULTURE, subculture: SUBCULTURE, faction: CULTURE };
    const chainsOf = (regionView: BuildingsRegionView) =>
      new Set(regionView.bands.flatMap((band) => band.columns.map((column) => column.chainKey)));

    const hidden = chainsOf(resolveRegionBuildings(data, query));
    for (const chain of retired) expect(hidden.has(chain)).toBe(false);

    const shown = chainsOf(resolveRegionBuildings(data, { ...query, includeChainsWithoutAvailability: true }));
    for (const chain of retired) expect(shown.has(chain)).toBe(true);
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

/**
 * The same checks against the Vampire Counts panel at Drakenhof.
 *
 * It caught what Altdorf could not: `wh2_main_special_drakenhof_court` is bound to Nagash's four
 * settlement types since 9.x and was hidden by reading that as "only there", and the game draws none
 * of the vampire chains 9.0 left without an availability set - not even for Vampire Counts.
 */
const DRAKENHOF_REGION = "wh3_main_combi_region_castle_drakenhof";
const VMP_CULTURE = "wh_main_vmp_vampire_counts";
const VMP_SUBCULTURE = "wh_main_sc_vmp_vampire_counts";
const VLAD = "wh_main_vmp_schwartzhafen";

/**
 * Chains the DB permits at Drakenhof that the game, on turn 1, does not draw. Both are gated by
 * campaign state the DB cannot express:
 *
 * - `wh_main_VAMPIRES_sylvanian_outpost` is unlocked by the `wh3_main_tech_vmp_vampires_final_4`
 *   technology.
 * - `wh3_main_foreign_slot_endgame` is held back by `cm:add_event_restricted_building_record` in
 *   `wh_start.lua` until the Vermintide endgame.
 */
const EXPECTED_DRAKENHOF_EXTRAS = ["wh3_main_foreign_slot_endgame", "wh_main_VAMPIRES_sylvanian_outpost"];

describe.skipIf(!haveDrakenhofDumps)("buildings derivation against the in-game Drakenhof panel", () => {
  if (!haveDrakenhofDumps) return;
  const { data } = loadShippedData();
  const query = {
    campaign: CAMPAIGN,
    region: DRAKENHOF_REGION,
    culture: VMP_CULTURE,
    subculture: VMP_SUBCULTURE,
    faction: VLAD,
  };
  const view = resolveRegionBuildings(data, query);
  const truth = readGroundTruth(DRAKENHOF_UI_DUMP);
  const ours = flattenView(view);

  it("read the dump", () => {
    expect(truth.chains.size).toBe(15);
    expect(truth.levels.size).toBe(48);
  });

  it("shows every chain the game shows", () => {
    expect([...truth.chains].filter((chain) => !ours.chains.has(chain)).sort()).toEqual([]);
  });

  it("shows every building level the game shows", () => {
    expect([...truth.levels].filter((level) => !ours.levels.has(level)).sort()).toEqual([]);
  });

  it("puts each chain in the same building set the game does", () => {
    const mismatched = [...truth.chainToSet.entries()]
      .filter(([chain, setKey]) => ours.chainToSet.has(chain) && ours.chainToSet.get(chain) !== setKey)
      .map(([chain, setKey]) => `${chain}: game=${setKey} ours=${ours.chainToSet.get(chain)}`)
      .sort();
    expect(mismatched).toEqual([]);
  });

  it("shows exactly the documented extras and nothing else", () => {
    expect([...ours.chains].filter((chain) => !truth.chains.has(chain)).sort()).toEqual(EXPECTED_DRAKENHOF_EXTRAS);
  });

  it("keeps a chain bound to settlement types when none is picked", () => {
    const court = "wh2_main_special_drakenhof_court";
    expect(data.settlementTypeBindings[court]?.length).toBeGreaterThan(0);
    expect(ours.chains.has(court)).toBe(true);
  });

  it("draws Bone Pits and the Necrotic Morgue as forks, as the game does", () => {
    // Each branch requires a different settlement tier, so by tier alone the three tiles stacked
    // into one column and read as a straight upgrade line.
    const columns = computeBoardLayout(view).bands.flatMap((band) => band.columns);
    for (const [chain, trunk, branches] of [
      [
        "wh_main_VAMPIRES_corpses",
        "wh_main_VAMPIRES_corpses_1",
        ["wh_main_VAMPIRES_corpses_2", "wh_main_VAMPIRES_corpse_transport_1"],
      ],
      [
        "wh_main_VAMPIRES_shyish",
        "wh_main_VAMPIRES_shyish_1",
        ["wh_main_VAMPIRES_shyish_2", "wh_main_VAMPIRES_shyish_capital_1"],
      ],
    ] as const) {
      const column = columns.find((entry) => entry.chainKey === chain);
      const laneOf = (levelKey: string) => column?.cells.find((cell) => cell.tile.levelKey === levelKey)?.gridColumn;
      expect(column?.width).toBe(2);
      expect(new Set(branches.map(laneOf)).size).toBe(2);
      expect(laneOf(trunk)).toBe(laneOf(branches[0]));
    }
  });

  it("hides the vampire chains left without an availability set from Vampire Counts too", () => {
    const retired = [
      "wh_main_VAMPIRES_ossuary",
      "wh_main_VAMPIRES_armoury",
      "wh_main_VAMPIRES_necromancers",
      "wh_pro02_VAMPIRES_isabella_unique",
      "wh2_main_VAMPIRES_raisedead",
      "wh2_main_VAMPIRES_terrorgheists",
    ];
    expect(retired.filter((chain) => ours.chains.has(chain))).toEqual([]);
    const permissive = flattenView(resolveRegionBuildings(data, { ...query, includeChainsWithoutAvailability: true }));
    // Every one of them is this rule's alone: turning it off brings all six back.
    expect(retired.filter((chain) => permissive.chains.has(chain))).toEqual(retired);
  });
});

/**
 * The foreign slot types against the shipped tables.
 *
 * Nothing here needs a region or the UI dump: a slot set grants its slots inside whatever settlement
 * the granting region has, which is the whole point of browsing a type on its own. The numbers are
 * asserted exactly so a vanilla change - or a rule here quietly widening - fails rather than drifting.
 */
describe.skipIf(!haveDbDump)("foreign slot types against the shipped tables", () => {
  const tables: BuildingsTableRows = {};
  for (const tableName of BUILDINGS_TABLES) tables[tableName] = readTsvTable(tableName);
  const data = buildBuildingsData(tables, () => undefined);
  const types = resolveForeignSlotTypes(data);
  const typeByKey = new Map(types.map((type) => [type.key, type]));

  it("offers every slot set type the game's own sets name", () => {
    // COB_LURE is declared in slot_set_types but no slot set uses it, so it grants no slot and would
    // only ever draw an empty board.
    expect(types.map((type) => type.key)).toEqual([
      "ALLIED",
      "BLACK_TOWER",
      "CULT",
      "HIDDEN_CULT",
      "MINOR_CULT",
      "MINOR_CULT_CANNOT_REMOVE",
      "NOR_TRAP",
      "PIRATE_COVE",
      "SEA_PATROL_OUTPOST",
      "SILENT_SANCTUM",
      "TYRANTS_DEMANDS",
      "UNDERDEEP",
      "UNDEREMPIRE",
      "UNDEREMPIRE_ENDGAME",
      "VAMPIRE_COVEN",
      "VAMPIRE_LAIR_COMPLETE",
      "VAMPIRE_LAIR_FOREIGN",
      "VAMPIRE_LAIR_OWN",
      "VAMPIRE_LAIR_OWN_COMPLETE",
    ]);
  });

  it("combines the 40 minor cult slot sets into the one template they share", () => {
    expect(tables.slot_sets_tables.filter((row) => row.type === "MINOR_CULT")).toHaveLength(40);
    expect(typeByKey.get("MINOR_CULT")?.slotTemplates).toEqual(["wh3_main_minor_cults"]);
  });

  it("narrows the filters to the cultures a type's own buildings name", () => {
    // The four Chaos gods, and nobody else, build cults.
    expect(typeByKey.get("CULT")?.cultures).toEqual([
      "wh3_main_kho_khorne",
      "wh3_main_nur_nurgle",
      "wh3_main_sla_slaanesh",
      "wh3_main_tze_tzeentch",
    ]);
    // Allied outposts are the broad case: most of the game's cultures, thirteen named factions.
    // Was twelve until 9.0.5 bound `wh3_main_vmp_allied_outpost` to Neferata's availability set.
    expect(typeByKey.get("ALLIED")?.cultures).toHaveLength(26);
    expect(typeByKey.get("ALLIED")?.factions).toHaveLength(13);
    expect(data.factions.length).toBeGreaterThan(500);
  });

  it("draws the buildings the type's slot templates permit, level 0 included", () => {
    const view = resolveRegionBuildings(data, {
      campaign: CAMPAIGN,
      region: "",
      foreignSlotType: "UNDEREMPIRE",
      culture: "wh2_main_skv_skaven",
    });
    const tiles = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles));

    expect(view.slotTemplates.map((slot) => slot.slotTemplate).sort()).toEqual([
      "wh2_dlc12_underempire",
      "wh2_dlc12_underempire_laboratory",
    ]);
    expect(tiles.every((tile) => tile.isForeignSlot && !tile.isExistingInRegion)).toBe(true);
    // The under-empire's own settlement chain, whose five levels the game draws from tier I.
    const warren = view.bands
      .flatMap((band) => band.columns)
      .find((column) => column.chainKey === "wh2_dlc12_under_empire_settlement_warren");
    expect(warren?.tiles.map((tile) => tile.romanNumeral)).toEqual(["I", "II", "III", "IV", "V"]);
    expect(warren?.tiles.every((tile) => !tile.isRuin && !tile.isSettlementOrPort)).toBe(true);
  });

  it("never puts two of a branching chain's buildings in one board cell", () => {
    // Vanilla branches a lot of foreign chains: the underdeep pairs each tier-2 building with a
    // "switch it off" alternative, the sea patrol garrison offers five tier-3 choices, and
    // wh3_main_minor_cult_the_cabal puts nine buildings on one tier. Sharing a CSS grid cell hid
    // all but the last of them behind each other.
    const shared: string[] = [];
    for (const type of types) {
      const view = resolveRegionBuildings(data, { campaign: CAMPAIGN, region: "", foreignSlotType: type.key });
      for (const band of computeBoardLayout(view).bands) {
        for (const column of band.columns) {
          const byCell = new Map<string, string[]>();
          for (const cell of column.cells) {
            const key = `${cell.gridRow}|${cell.gridColumn}`;
            byCell.set(key, [...(byCell.get(key) ?? []), cell.tile.levelKey]);
          }
          for (const [, levelKeys] of byCell) {
            if (levelKeys.length > 1) shared.push(`${type.key} ${column.chainKey}: ${levelKeys.join(" + ")}`);
          }
        }
      }
    }
    expect(shared).toEqual([]);
  });

  it("draws a fork's arrows without inventing one between the siblings", () => {
    const view = resolveRegionBuildings(data, {
      campaign: CAMPAIGN,
      region: "",
      foreignSlotType: "UNDERDEEP",
      culture: "wh_main_dwf_dwarfs",
    });
    const chain = "wh3_main_underdeep_dwf_grudges";
    const column = computeBoardLayout(view)
      .bands.flatMap((band) => band.columns)
      .find((entry) => entry.chainKey === chain);

    // `_2` is the upgrade, `_2_a` the "book of grudges off" dead end; both are level 1.
    expect(column?.width).toBe(2);
    expect(column?.cells.map((cell) => `${cell.tile.levelKey}@${cell.gridRow},${cell.gridColumn}`)).toEqual([
      `${chain}_1@4,${column?.gridColumn}`,
      `${chain}_2@3,${column?.gridColumn}`,
      `${chain}_2_a@3,${(column?.gridColumn ?? 0) + 1}`,
      `${chain}_3@2,${column?.gridColumn}`,
    ]);
    expect(
      view.edges
        .filter((edge) => edge.fromLevelKey.startsWith(chain))
        .map((edge) => `${edge.fromLevelKey}->${edge.toLevelKey}${edge.isImplicit ? " (implicit)" : ""}`)
        .sort(),
    ).toEqual([`${chain}_1->${chain}_2`, `${chain}_1->${chain}_2_a`, `${chain}_2->${chain}_3`]);
  });

  it("keeps the chains a settlement type binding would hide in a region", () => {
    // A settlement type binding means "also allowed in that special settlement", and 50 of the 53
    // chains a pirate cove permits carry one - the Chaos Dwarf, daemon and Norsca types. A region
    // board narrows to them only once a type is picked; a foreign slot has no settlement of its
    // own, so the filter is skipped and they stay.
    const boundChain = "wh2_dlc12_under_empire_money_thieves";
    expect(data.settlementTypeBindings[boundChain]?.length).toBeGreaterThan(0);

    const view = resolveRegionBuildings(data, { campaign: CAMPAIGN, region: "", foreignSlotType: "PIRATE_COVE" });
    const chains = new Set(view.bands.flatMap((band) => band.columns.map((column) => column.chainKey)));
    expect(chains.has(boundChain)).toBe(true);
    // 54 of the 55 the chain set expands to. `wh3_dlc25_gom_chamber_of_the_dark_lady` has a single
    // culture variant pinned to one faction, so it needs a culture or faction filter to appear -
    // the same rule that hides any faction-specific building under an unfiltered query.
    expect(chains.size).toBe(54);
    expect(view.settlementTypeOptions).toEqual([]);
    expect(view.settlementTypeDisabled).toBe(true);
  });
});

/**
 * Horde boards against the shipped tables.
 *
 * Like the foreign slots, nothing here needs a region: a horde carries its slots with its army.
 * `military_force_type_horde_details` is the only table outside the startpos that ties a slot
 * template to a slot type, so these assertions are what prove the route through it reaches the
 * content that has no "horde" anywhere in its key - ogre camps, the Vampire Coast ship, the
 * dragonship and the Spirit of Grungni.
 */
describe.skipIf(!haveDbDump)("horde boards against the shipped tables", () => {
  const tables: BuildingsTableRows = {};
  for (const tableName of BUILDINGS_TABLES) tables[tableName] = readTsvTable(tableName);
  const data = buildBuildingsData(tables, () => undefined);

  const hordeView = (culture?: string): BuildingsRegionView =>
    resolveRegionBuildings(data, { mode: "horde", campaign: CAMPAIGN, region: "", culture });

  const chainsIn = (view: BuildingsRegionView) =>
    view.bands.flatMap((band) => band.columns.map((column) => column.chainKey)).sort();

  const tilesFor = (view: BuildingsRegionView, chainKey: string) =>
    view.bands
      .flatMap((band) => band.columns.filter((column) => column.chainKey === chainKey))
      .flatMap((column) => column.tiles);

  it("browses the six slot templates the game's force types name", () => {
    expect(data.hordeSlotTemplates.map((entry) => entry.slotTemplate)).toEqual([
      "horde_primary",
      "horde_secondary",
      "horde_primary_dark_fortress",
      "horde_primary_aislinn",
      "nakai_horde_primary",
      "nakai_horde_secondary",
    ]);
    // Force types can share template pairs; the templates are browsed as one board.
    expect(tables.military_force_type_horde_details_tables.length).toBe(17);
  });

  it("reaches the horde content whose keys say nothing about hordes", () => {
    const chains = chainsIn(hordeView());
    expect(chains).toContain("wh3_main_ogr_camp_town_centre");
    expect(chains).toContain("wh2_dlc11_vampirecoast_ship_hull");
    expect(chains).toContain("wh3_dlc27_hef_dragonship_barracks");
    expect(chains).toContain("wh3_dlc25_dwf_spirit_of_grungni_barracks");
    // And the legacy chains a region board hides, which the horde chain sets name deliberately.
    expect(chains).toContain("wh_dlc03_horde_beastmen_herd");
    expect(chains).toContain("wh_main_horde_chaos_settlement");
    // Nothing a region places.
    expect(chains).not.toContain("wh_main_emp_barracks");
    expect(chains).not.toContain("wh_main_EMPIRE_settlement_major");
  });

  it("narrows to one culture's own horde", () => {
    expect([...new Set(chainsIn(hordeView("wh3_main_ogr_ogre_kingdoms")))]).toEqual([
      "wh3_dlc26_ogr_camp_gnoblars",
      "wh3_main_ogr_camp_barracks",
      "wh3_main_ogr_camp_cav",
      "wh3_main_ogr_camp_defence_replenishment",
      "wh3_main_ogr_camp_defence_upkeep",
      "wh3_main_ogr_camp_growth",
      "wh3_main_ogr_camp_heavy_cav",
      "wh3_main_ogr_camp_hunting",
      "wh3_main_ogr_camp_monster",
      "wh3_main_ogr_camp_recruitment",
      "wh3_main_ogr_camp_town_centre",
      "wh3_main_ogr_camp_upkeep",
    ]);
  });

  /**
   * Checked against the in-game camp browser (Goldtooth, turn 1, 9.0.5): the game builds every chain
   * twice, once under `wh3_main_set_ogre_camp_all` and once under its own category, and the 43
   * levels match exactly. The one difference is `wh3_main_set_ogre_camp`, which the game never
   * builds although `show_in_ui` is true and nothing excludes it; its only chain is the town centre,
   * so it is drawn here as one extra band.
   */
  it("bands an Ogre camp's chains as the game does", () => {
    const view = hordeView("wh3_main_ogr_ogre_kingdoms");
    const chainsBySet = Object.fromEntries(
      view.bands.map((band) => [band.setKey, band.columns.map((column) => column.chainKey).sort()]),
    );
    expect(chainsBySet).toEqual({
      wh3_main_set_ogre_camp_all: [
        "wh3_dlc26_ogr_camp_gnoblars",
        "wh3_main_ogr_camp_barracks",
        "wh3_main_ogr_camp_cav",
        "wh3_main_ogr_camp_defence_replenishment",
        "wh3_main_ogr_camp_defence_upkeep",
        "wh3_main_ogr_camp_growth",
        "wh3_main_ogr_camp_heavy_cav",
        "wh3_main_ogr_camp_hunting",
        "wh3_main_ogr_camp_monster",
        "wh3_main_ogr_camp_recruitment",
        "wh3_main_ogr_camp_town_centre",
        "wh3_main_ogr_camp_upkeep",
      ],
      wh3_main_set_ogre_camp_recruitment: [
        "wh3_dlc26_ogr_camp_gnoblars",
        "wh3_main_ogr_camp_barracks",
        "wh3_main_ogr_camp_cav",
      ],
      wh3_main_set_ogre_camp_recruitment_advanced: ["wh3_main_ogr_camp_heavy_cav", "wh3_main_ogr_camp_monster"],
      wh3_main_set_ogre_camp_support: [
        "wh3_main_ogr_camp_growth",
        "wh3_main_ogr_camp_hunting",
        "wh3_main_ogr_camp_recruitment",
        "wh3_main_ogr_camp_upkeep",
      ],
      wh3_main_set_ogre_defence: ["wh3_main_ogr_camp_defence_replenishment", "wh3_main_ogr_camp_defence_upkeep"],
      // The documented extra: not built by the game.
      wh3_main_set_ogre_camp: ["wh3_main_ogr_camp_town_centre"],
    });
  });

  it("scopes the legacy Chaos horde chains to Chaos", () => {
    // `wh_main_horde_chaos_dragon_ogres` is a real member of `wh3_main_secondary_core_generic_horde`
    // but carries nothing to narrow it: no availability set row of its own, and both culture
    // variants leave `culture` empty, so the other-culture rule cannot classify it. It was the one
    // chain of the board's 124 that showed for every culture; `wh_main_bas_chs` is what pins it.
    const dragonOgres = "wh_main_horde_chaos_dragon_ogres";
    expect(data.availabilitySetsByChain[dragonOgres]).toContain("wh_main_bas_chs");
    expect(chainsIn(hordeView("wh_main_chs_chaos"))).toContain(dragonOgres);
    expect(chainsIn(hordeView("wh3_main_ogr_ogre_kingdoms"))).not.toContain(dragonOgres);
    expect(chainsIn(hordeView("wh_dlc03_bst_beastmen"))).not.toContain(dragonOgres);

    // Asserted exactly, so a *new* chain that nothing in the data narrows still fails here.
    const universal = data.cultures
      .map((culture) => new Set(chainsIn(hordeView(culture.key))))
      .reduce((shared, chains) => new Set([...shared].filter((chain) => chains.has(chain))));
    expect([...universal]).toEqual([]);
  });

  it("numbers horde tiers from zero rather than treating them as settlements", () => {
    const view = hordeView("wh_dlc03_bst_beastmen");
    // A horde primary chain is its board's y-axis: placed by its own level, first tier `I`, and no
    // level-0 ruin - the razed state is a region-settlement concept.
    expect(
      tilesFor(view, "wh_dlc03_horde_beastmen_herd").map((tile) => [tile.level, tile.tierRow, tile.romanNumeral]),
    ).toEqual([
      [0, 0, "I"],
      [1, 1, "II"],
      [2, 2, "III"],
      [3, 3, "IV"],
      [4, 4, "V"],
    ]);
    expect(tilesFor(view, "wh_dlc03_horde_beastmen_herd").every((tile) => !tile.isRuin)).toBe(true);
    expect(tilesFor(view, "wh_dlc03_horde_beastmen_herd").every((tile) => !tile.isSettlementOrPort)).toBe(true);
  });

  it("names the cultures with no horde at all", () => {
    const withoutChains = resolveCulturesWithoutChains(data, {
      mode: "horde",
      campaign: CAMPAIGN,
      region: "",
    });

    // The ones that do have a horde must not be listed.
    for (const culture of [
      "wh3_main_ogr_ogre_kingdoms",
      "wh_dlc03_bst_beastmen",
      "wh_main_chs_chaos",
      "wh2_dlc11_cst_vampire_coast",
      "wh2_main_lzd_lizardmen",
      "wh_main_dwf_dwarfs",
      "wh2_main_hef_high_elves",
    ]) {
      expect(withoutChains).not.toContain(culture);
      expect(chainsIn(hordeView(culture))).not.toEqual([]);
    }

    // The ones that do not: settled cultures with no horde force type of their own.
    for (const culture of ["wh_main_emp_empire", "wh3_main_ksl_kislev", "wh3_main_cth_cathay"]) {
      expect(withoutChains).toContain(culture);
      expect(chainsIn(hordeView(culture))).toEqual([]);
    }

    // Asserted as a count so a vanilla change moves it rather than passing silently.
    expect(withoutChains).toHaveLength(17);
    expect(data.cultures).toHaveLength(28);
  });

  it("reports nothing off a horde board", () => {
    expect(resolveCulturesWithoutChains(data, { campaign: CAMPAIGN, region: REGION })).toEqual([]);
    expect(
      resolveCulturesWithoutChains(data, {
        mode: "undercity",
        campaign: CAMPAIGN,
        region: "",
        foreignSlotType: "UNDEREMPIRE",
      }),
    ).toEqual([]);
  });

  it("reads a horde secondary's primary requirement as the row itself", () => {
    // The ship's hull tiers require ship levels 0, 2 and 4 - already row indices, unlike a region
    // settlement's 1-based levels.
    expect(
      tilesFor(hordeView("wh2_dlc11_cst_vampire_coast"), "wh2_dlc11_vampirecoast_ship_hull").map(
        (tile) => tile.tierRow,
      ),
    ).toEqual([0, 2, 4]);
  });
});
