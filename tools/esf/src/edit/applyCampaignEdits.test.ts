import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode } from "../esf/codecs/caabTree";
import { CaabStringTables, parseCaabStringTables, readCaabHeader, walkCaabNodes } from "../esf/codecs/caabBinary";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { parseEsfDocument } from "../esf/EsfParser";
import { encodeAscii, encodeU32 } from "../edit/addFaction";
import { extractCampaignState } from "../extract/campaignState";
import { applyCampaignEditsToEsf, LAND_RANK_XP_THRESHOLDS } from "./applyCampaignEdits";

const NAMES = [
  "CAMPAIGN_SAVE_GAME", "CAMPAIGN_ENV", "CAMPAIGN_SETUP", "CAMPAIGN_MODEL", "WORLD", "FACTION_ARRAY", "FACTION", "CHARACTER_ARRAY",
  "CHARACTER", "LOCOMOTABLE", "ARMY_ARRAY", "MILITARY_FORCE", "UNIT_CONTAINER", "UNITS_ARRAY", "UNIT", "UNIT_RECORD_KEY",
  "LINE_OF_SIGHT", "FAMILY_TREE", "FAMILY_MEMBER", "CHARACTER_DETAILS",
  "REGION_MANAGER", "REGIONS_ARRAY", "REGION", "REGION_SLOT_MANAGER", "REGION_SLOT_ARRAY", "REGION_SLOT",
  "REGION_BUILDING_MANAGER", "BUILDING_BASE", "CAMPAIGN_COMMAND_QUEUE_INDEX_TABLES", "OLD_DIPLOMACY_MANAGER", "OLD_DIPLOMACY_RELATIONSHIP",
  "PROVINCE_MANAGER", "PROVINCE_ARRAY", "PROVINCE", "FACTION_PROVINCE_MANAGER_ARRAY", "FACTION_PROVINCE_MANAGER", "SETTLEMENT", "GARRISON_RESIDENCE",
  "UNIT_HISTORY", "COMMANDER_DETAILS", "CAI_INTERFACE", "CAI_WORLD", "CAI_WORLD_FACTIONS", "CAI_FACTION", "OWNED_DIRECT", "CAI_WORLD_SETTLEMENTS",
  "CAI_SETTLEMENT", "CAI_WORLD_RESOURCE_MOBILES", "CAI_RESOURCE_MOBILE", "CAI_BDI_COMPONENT", "CAI_WORLD_CHARACTERS", "CAI_CHARACTER", "OWNED_INDIRECT",
];

function build() {
  const strings: string[] = [];
  const A = (text: string) => {
    let id = strings.indexOf(text);
    if (id < 0) id = strings.push(text) - 1;
    return encodeAscii(id);
  };
  const u32 = (value: number) => encodeU32(value);
  const u16 = (value: number) => { const b = Buffer.alloc(3); b[0] = 0x07; b.writeUInt16LE(value, 1); return b; };
  const u8 = (value: number) => Buffer.from([0x06, value]);
  const f32 = (value: number) => { const b = Buffer.alloc(5); b[0] = 0x0a; b.writeFloatLE(value, 1); return b; };
  const bool = (value: boolean) => Buffer.from([value ? 0x12 : 0x13]);
  const coord = (x: number, y: number) => { const b = Buffer.alloc(9); b[0] = 0x0c; b.writeFloatLE(x, 1); b.writeFloatLE(y, 5); return b; };
  const bytes = (...buffers: Buffer[]): CaabItem => ({ kind: "bytes", data: Buffer.concat(buffers) });
  const rec = (name: string, group: CaabItem[]): CaabRecordNode => ({
    kind: "record", name, nameIndex: NAMES.indexOf(name), version: 0, flags: 0xe0, isRoot: name === "CAMPAIGN_SAVE_GAME",
    hasNestedBlocks: true, groups: [group], blockSizeWidth: 1, groupCountWidth: 1, groupSizeWidths: [1],
  });
  const many = (name: string, groups: CaabItem[][]): CaabRecordNode => ({ ...rec(name, []), groups, groupSizeWidths: groups.map(() => 1) });
  const unit = (id: number, key: string, cur: number, max: number, commander: number, xp: number, rank: number) =>
    rec("UNIT", [bytes(u32(id)), rec("UNIT_RECORD_KEY", [bytes(A(key))]), bytes(u32(cur), u32(max), u32(commander), u32(xp), u8(rank))]);
  // World coordinates follow x = 0.5 * lx + 1, y = 0.25 * ly + 2.
  const character = (id: number, familyId: number, forceId: number, lx: number, ly: number, type = "general") =>
    rec("CHARACTER", [
      rec("LOCOMOTABLE", [bytes(coord(0.5 * lx + 1, 0.25 * ly + 2), u16(lx), u16(ly))]),
      bytes(u32(id), A(type), u32(familyId), u32(forceId), u16(65535), u16(65535), u32(0)),
      rec("LINE_OF_SIGHT", [bytes(bool(true), coord(0.5 * lx - 24, 0.25 * ly - 23), coord(0.5 * lx + 26, 0.25 * ly + 27))]),
    ]);
  const i32 = (value: number) => { const b = Buffer.alloc(5); b[0] = 0x04; b.writeInt32LE(value, 1); return b; };
  const arr = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([marker, payload.length]), payload]);
  const codes = (values: number[]) => arr(0x4f, Buffer.concat(values.map((v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; })));
  // 15 direct values: [0] other id, [2] stance, [6]/[7] vassal/master turn, [12] access, [14] codes.
  const relation = (other: number, stance: string, access: number, list: number[]) =>
    rec("OLD_DIPLOMACY_RELATIONSHIP", [bytes(u32(other), i32(0), A(stance), i32(0), i32(0), i32(0), i32(0), i32(0), u32(0), u32(0), arr(0x56, Buffer.alloc(4)), u32(0), i32(access), A("neutral"), codes(list))]);
  const second = rec("FACTION", [
    bytes(u32(327), A("emp_talabecland")),
    many("CHARACTER_ARRAY", [[character(200, 201, 70, 50, 50)], [character(310, 311, 910, 60, 90, "colonel")]]),
    many("ARMY_ARRAY", [[rec("MILITARY_FORCE", [bytes(u32(70), u32(200))])], [rec("MILITARY_FORCE", [bytes(u32(910), u32(310))])]]),
    rec("OLD_DIPLOMACY_MANAGER", [relation(62, "neutral", 0, [1657, 1658])]),
  ]);
  const faction = rec("FACTION", [
    bytes(u32(62), A("emp_empire")),
    rec("OLD_DIPLOMACY_MANAGER", [relation(327, "neutral", 0, [1657, 1658])]),
    many("CHARACTER_ARRAY", [[character(122, 124, 66, 100, 200)], [character(130, 131, 67, 300, 40)], [character(140, 141, 68, 20, 360)], [character(300, 301, 900, 40, 80, "colonel")]]),
    many("ARMY_ARRAY", [
      [rec("MILITARY_FORCE", [bytes(u32(66), u32(122)), rec("UNIT_CONTAINER", [rec("UNITS_ARRAY", [
        unit(569, "emp_cha_karl", 3216, 3216, 122, 0, 0),
        unit(567, "emp_halberdiers", 90, 90, 0, 700, 1),
        unit(568, "emp_swordsmen", 80, 80, 0, 1234, 2),
      ])])])],
      [rec("MILITARY_FORCE", [bytes(u32(67), u32(130))])],
      [rec("MILITARY_FORCE", [bytes(u32(68), u32(140))])],
      [rec("MILITARY_FORCE", [bytes(u32(900), u32(300)), rec("UNIT_CONTAINER", [rec("UNITS_ARRAY", [
        rec("UNIT", [bytes(u32(9001)), rec("UNIT_HISTORY", [bytes(u32(62))]), rec("COMMANDER_DETAILS", [bytes(A("emp_empire"))]), rec("UNIT_RECORD_KEY", [bytes(A("emp_garrison"))]), bytes(u32(10), u32(10), u32(300), u32(0), u8(0))]),
      ])])])],
    ]),
  ]);
  const member = (familyId: number, charId: number, subtype: string, type = "general") => rec("FAMILY_MEMBER", [
    bytes(u32(familyId)),
    rec("CHARACTER_DETAILS", [bytes(A("emp_empire"), u32(charId), A(""), A(type), A(subtype), A("art_set"))]),
  ]);
  const slot = (instance: string, template: string, type: string, building: string | null) =>
    rec("REGION_SLOT", [
      bytes(A(instance), A(template), A(type)),
      rec("REGION_BUILDING_MANAGER", building === null ? [] : [rec("BUILDING_BASE", [bytes(u32(679), A(building), f32(5 + Number(/(\d+)$/.exec(building)![1]) - 1), f32(5 + Number(/(\d+)$/.exec(building)![1]) - 1), A("emp_empire"), bool(false), A("sub"))])]),
    ]);
  const region = rec("REGION", [
    bytes(u32(1), A("test_region_altdorf"), u32(0), u32(200), u32(62), A("emp_empire"), A("sub"), bool(false), bool(false), A(""), A("emp_empire"), A("")),
    rec("SETTLEMENT", [rec("GARRISON_RESIDENCE", [bytes(u32(1), u32(66), u32(0), arr(0x56, Buffer.alloc(0)), u32(0), u32(0), u32(900), u32(0))])]),
    rec("REGION_SLOT_MANAGER", [rec("REGION_SLOT_ARRAY", [slot("r:0", "tpl_main", "secondary", "emp_settlement_1"), slot("r:1", "tpl_sec", "secondary", null), slot("r:2", "tpl_primary", "primary", "emp_capital_1")])]),
  ]);
  const root = rec("CAMPAIGN_SAVE_GAME", [
    rec("CAMPAIGN_ENV", [
      rec("CAMPAIGN_SETUP", [bytes(A("wh3_main_combi"))]),
      rec("CAMPAIGN_MODEL", [rec("CAMPAIGN_COMMAND_QUEUE_INDEX_TABLES", [bytes(u32(1), u32(2), u32(3), u32(4), u32(5), u32(1363), u32(7))]), rec("WORLD", [
        many("FACTION_ARRAY", [[faction], [second]]),
        many("FAMILY_TREE", [[member(124, 122, "emp_karl_franz")], [member(201, 200, "emp_t")], [member(131, 130, "emp_a")], [member(141, 140, "emp_b")], [member(301, 300, "emp_col", "colonel")], [member(311, 310, "emp_col2", "colonel")]]),
        rec("REGION_MANAGER", [many("REGIONS_ARRAY", [[region]])]),
        rec("PROVINCE_MANAGER", [rec("PROVINCE_ARRAY", [rec("PROVINCE", [bytes(u32(37)), many("FACTION_PROVINCE_MANAGER_ARRAY", [[
          rec("FACTION_PROVINCE_MANAGER", [bytes(u32(57), u32(62), arr(0x57, Buffer.from([1, 0, 2, 0])))]),
          rec("FACTION_PROVINCE_MANAGER", [bytes(u32(58), u32(327), arr(0x56, Buffer.from([9])))]),
        ]])])])]),
      ]), rec("CAI_INTERFACE", [rec("CAI_WORLD", [
        rec("CAI_WORLD_FACTIONS", [
          rec("OWNED_DIRECT", [bytes(u32(7639))]), rec("OWNED_DIRECT", [bytes(u32(20664))]),
          rec("CAI_FACTION", [bytes(arr(0x57, Buffer.from([0x93, 0, 0x6f, 4])), u32(0), u32(0), arr(0x58, Buffer.from([0, 0xd8, 0x3e, 3, 0xd8, 0x1c])), arr(0x58, Buffer.from([0, 0xd8, 0x3d, 3, 0xd8, 0x1b])))]),
          rec("CAI_FACTION", [bytes(arr(0x57, Buffer.from([0x0d, 5])), u32(0), u32(0), arr(0x57, Buffer.from([0xb5, 0xf1])), arr(0x57, Buffer.from([0xb4, 0xf1])))]),
        ]),
        rec("CAI_WORLD_SETTLEMENTS", [rec("CAI_SETTLEMENT", [bytes(u32(0), u32(0), u32(1))]), rec("OWNED_DIRECT", [bytes(u32(7639))])]),
        rec("CAI_WORLD_RESOURCE_MOBILES", [
          rec("CAI_RESOURCE_MOBILE", [bytes(u32(251931), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(900))]),
          rec("OWNED_DIRECT", [bytes(u32(7639))]), rec("CAI_BDI_COMPONENT", [bytes(u32(251932))]),
        ]),
        rec("CAI_WORLD_CHARACTERS", [rec("CAI_CHARACTER", [bytes(u32(0), u32(0), u32(0), u32(300))]), rec("OWNED_INDIRECT", [bytes(u32(7639))])]),
      ])])]),
    ]),
  ]);
  const tables: CaabStringTables = {
    recordNames: NAMES,
    utf8ById: new Map(strings.map((text, id) => [id, text])),
    utf16ById: new Map(),
    entries: [
      ...NAMES.map((text, id) => ({ table: "record_name" as const, text, id, offset: 0, length: text.length })),
      ...strings.map((text, id) => ({ table: "utf8" as const, text, id, offset: 0, length: text.length })),
    ],
  };
  return writeCaabBuffer({ header: { codecId: 0xabca, unknown1: 0, creationDate: 0, recordNamesOffset: 0 }, tables, root, source: Buffer.alloc(0) });
}

const buildingBases = (buffer: Buffer) => {
  const out: { id: number; floats: number[] }[] = [];
  const header = readCaabHeader(buffer);
  walkCaabNodes(buffer, header, parseCaabStringTables(buffer, header.recordNamesOffset), {
    onRecordStart(record) { if (record.name === "BUILDING_BASE") out.push({ id: -1, floats: [] }); },
    onValue(v, stack) {
      if (stack[stack.length - 1] !== "BUILDING_BASE" || v.kind !== "value") return;
      const last = out[out.length - 1];
      if (v.type === "u32" && last.id < 0) last.id = Number(v.value);
      else if (v.type === "f32") last.floats.push(Number(v.value));
    },
  });
  return out;
};
const queueCounter = (buffer: Buffer) => {
  let found = -1;
  let index = 0;
  const header = readCaabHeader(buffer);
  walkCaabNodes(buffer, header, parseCaabStringTables(buffer, header.recordNamesOffset), {
    onValue(v, stack) {
      if (stack[stack.length - 1] !== "CAMPAIGN_COMMAND_QUEUE_INDEX_TABLES" || v.kind !== "value") return;
      if (index++ === 5) found = Number(v.value);
    },
  });
  return found;
};
const state = (buffer: Buffer) => extractCampaignState(buffer, parseEsfDocument(buffer));

test("applies a move, unit health/rank and a building swap, and changes nothing else", () => {
  const source = build();
  const before = state(source);
  const karl = before.faction_to_chars[0].chars[0];
  assert.equal(karl.id, 122);
  const slotBefore = before.regions[0].buildings![0];
  const result = applyCampaignEditsToEsf(source, {
    actions: [
      { type: "update_character", faction: "emp_empire", characterId: 122, changes: { x: { before: 100, after: 140 }, y: { before: 200, after: 120 } } },
      { type: "update_unit", faction: "emp_empire", characterId: 122, unitId: 567, changes: { health: { before: 100, after: 40 }, xp: { before: 1, after: 3 } } },
      { type: "set_building", region: "test_region_altdorf", slotIndex: 0, before: slotBefore, after: { ...slotBefore, building: "emp_settlement_2" } },
    ],
  });
  assert.equal(result.applied.length, 4);
  assert.deepEqual(result.skipped, []);
  const after = state(result.buffer);
  const chars = after.faction_to_chars[0].chars;
  assert.deepEqual([chars[0].x, chars[0].y], [140, 120]);
  assert.deepEqual([chars[1].x, chars[1].y], [300, 40]);
  const units = chars[0].units!;
  assert.deepEqual(units[1], { id: 567, xp: 3, health: 40, unit_key: "emp_halberdiers" });
  assert.deepEqual(units[2], before.faction_to_chars[0].chars[0].units![2]);
  assert.equal(after.regions[0].buildings![0].building, "emp_settlement_2");
  // The replacing building takes the next id from the shared counter and the level value follows the key (5 -> 6).
  assert.deepEqual(buildingBases(result.buffer).map((b) => [b.id, b.floats]), [[1363, [6, 6]], [679, [5, 5]]]);
  assert.equal(queueCounter(result.buffer), 1364);
  assert.equal(after.regions[0].buildings![1].building, "");
  // The world position and line of sight bounds moved by the same world delta (fit: x = 0.5 lx + 1, y = 0.25 ly + 2).
  const world = (buffer: Buffer) => {
    const out: number[][] = [];
    const header = readCaabHeader(buffer);
    walkCaabNodes(buffer, header, parseCaabStringTables(buffer, header.recordNamesOffset), {
      onValue(v, stack) {
        if (v.kind === "value" && v.type === "coord2d" && (stack[stack.length - 1] === "LOCOMOTABLE" || stack[stack.length - 1] === "LINE_OF_SIGHT")) {
          const c = v.value as { x: number; y: number };
          out.push([c.x, c.y]);
        }
      },
    });
    return out;
  };
  const w0 = world(source);
  const w1 = world(result.buffer);
  assert.deepEqual(w1[0], [0.5 * 140 + 1, 0.25 * 120 + 2]);
  assert.deepEqual(w1[1], [w0[1][0] + 20, w0[1][1] - 20]);
  assert.deepEqual(w1[2], [w0[2][0] + 20, w0[2][1] - 20]);
  assert.deepEqual(w1.slice(3), w0.slice(3));
});

test("skips unsupported edits with a reason and leaves the save untouched", () => {
  const source = build();
  const result = applyCampaignEditsToEsf(source, {
    ownership: { test_region_altdorf: "other" },
    actions: [
      { type: "set_diplomacy", faction: "emp_empire", targetFaction: "x" },
      { type: "update_character", faction: "emp_empire", characterId: 122, changes: { rank: { before: 1, after: 5 } } },
      { type: "update_unit", faction: "emp_empire", characterId: 122, unitId: 568, changes: { xp: { before: 2, after: 4 } } },
      { type: "set_building", region: "test_region_altdorf", slotIndex: 1, before: { building: "", type: "secondary", template: "tpl_sec" }, after: { building: "x", type: "secondary", template: "tpl_sec" } },
    ],
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 5);
  const primary = applyCampaignEditsToEsf(source, {
    actions: [{ type: "set_building", region: "test_region_altdorf", slotIndex: 2, before: { building: "emp_capital_1", type: "primary", template: "tpl_primary" }, after: { building: "emp_capital_2", type: "primary", template: "tpl_primary" } }],
  });
  assert.equal(primary.applied.length, 0);
  assert.match(primary.skipped[0], /primary building/);
  assert.equal(result.buffer, source);
  assert.equal(LAND_RANK_XP_THRESHOLDS[3], 2400);
});

const diploOf = (buffer: Buffer, faction: string) => state(buffer).faction_to_chars.find((f) => f.faction === faction)!.diplo;
const relations = (buffer: Buffer) => {
  const out: Record<string, { stance: string; access: number; turns: number[]; codes: number[] }> = {};
  const header = readCaabHeader(buffer);
  let owner = "";
  let values: unknown[] = [];
  walkCaabNodes(buffer, header, parseCaabStringTables(buffer, header.recordNamesOffset), {
    onRecordStart(record, stack) { if (record.name === "OLD_DIPLOMACY_RELATIONSHIP") values = []; void stack; },
    onValue(v, stack) {
      if (stack[stack.length - 1] === "FACTION" && v.kind === "value" && v.type === "u32" && !owner) owner = String(v.value);
      if (stack[stack.length - 1] !== "OLD_DIPLOMACY_RELATIONSHIP") return;
      values.push(v.kind === "array" ? Array.from({ length: v.value.payloadByteLength / 4 }, (_, i) => v.value.payload.readUInt32LE(i * 4)) : v.kind === "value" && v.type === "ascii" ? (v.value as { text: string }).text : Number((v as { value: unknown }).value));
      if (values.length === 15) {
        out[`${owner}>${values[0]}`] = { stance: values[2] as string, access: values[12] as number, turns: [values[6] as number, values[7] as number], codes: values[14] as number[] };
        values = [];
      }
    },
    onRecordEnd(record) { if (record.name === "FACTION") owner = ""; },
  });
  return out;
};

test("writes war, treaties, access, alliances and vassalage on both sides of a pair", () => {
  const source = build();
  const set = (after: string[], before: string[] = [], turn?: number) =>
    applyCampaignEditsToEsf(source, { turn, actions: [{ type: "set_diplomacy", faction: "emp_empire", targetFaction: "emp_talabecland", before, after }] });

  const war = set(["war"]);
  assert.deepEqual(war.skipped, []);
  assert.deepEqual(diploOf(war.buffer, "emp_empire").war, ["emp_talabecland"]);
  assert.deepEqual(diploOf(war.buffer, "emp_talabecland").war, ["emp_empire"]);
  assert.deepEqual(relations(war.buffer)["62>327"].codes, [1657, 1658]);

  // Codes change length: trade is prepended, non-aggression appended, access toggles -1.
  const treaties = set(["trade", "non_aggression", "mil_access"]);
  assert.deepEqual(treaties.skipped, []);
  for (const [from, to] of [["62", "327"], ["327", "62"]]) {
    const r = relations(treaties.buffer)[`${from}>${to}`];
    assert.deepEqual(r.codes, [4051, 1657, 1658, 1659]);
    assert.equal(r.access, -1);
    assert.equal(r.stance, "neutral");
  }
  assert.deepEqual(diploOf(treaties.buffer, "emp_talabecland").trade, ["emp_empire"]);

  // Removal restores the original blocks exactly.
  const removed = applyCampaignEditsToEsf(treaties.buffer, {
    actions: [{ type: "set_diplomacy", faction: "emp_empire", targetFaction: "emp_talabecland", before: ["trade", "non_aggression", "mil_access"], after: [] }],
  });
  assert.deepEqual(relations(removed.buffer), relations(source));
  assert.deepEqual(state(removed.buffer), state(source));

  const ally = set(["mil_ally", "mil_access"]);
  assert.equal(relations(ally.buffer)["327>62"].stance, "military_allies");
  assert.deepEqual(diploOf(ally.buffer, "emp_empire").mil_ally, ["emp_talabecland"]);
  const def = set(["def_ally"]);
  assert.equal(relations(def.buffer)["62>327"].stance, "defensive_allies");
  assert.deepEqual(diploOf(def.buffer, "emp_talabecland").def_ally, ["emp_empire"]);

  const vassal = set(["vassals"], [], 106);
  assert.deepEqual(vassal.skipped, []);
  const rel = relations(vassal.buffer);
  assert.deepEqual([rel["62>327"].stance, rel["62>327"].turns], ["master", [0, 106]]);
  assert.deepEqual([rel["327>62"].stance, rel["327>62"].turns], ["vassal", [106, 0]]);
  assert.deepEqual(diploOf(vassal.buffer, "emp_empire").vassals, ["emp_talabecland"]);
  assert.deepEqual(diploOf(vassal.buffer, "emp_talabecland").vassals, []);
  const freed = applyCampaignEditsToEsf(vassal.buffer, {
    actions: [{ type: "set_diplomacy", faction: "emp_empire", targetFaction: "emp_talabecland", before: ["vassals"], after: [] }],
  });
  assert.deepEqual(relations(freed.buffer), relations(source));
  assert.deepEqual(state(freed.buffer), state(source));

  // make_peace ends a war only.
  const peace = applyCampaignEditsToEsf(war.buffer, { actions: [{ type: "make_peace", faction: "emp_empire", targetFaction: "emp_talabecland" }] });
  assert.deepEqual(relations(peace.buffer), relations(source));
  assert.deepEqual(state(peace.buffer), state(source));
});

test("skips contradictory diplomacy and the vassal side of a pair", () => {
  const source = build();
  const result = applyCampaignEditsToEsf(source, {
    actions: [
      { type: "set_diplomacy", faction: "emp_empire", targetFaction: "emp_talabecland", before: [], after: ["war", "mil_ally"] },
      { type: "set_diplomacy", faction: "emp_empire", targetFaction: "nobody", before: [], after: ["war"] },
    ],
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.buffer, source);
});

/** Direct u32/u16/ascii values of every record named `name`, with the faction (id) owning it, for ownership assertions. */
const ownership = (buffer: Buffer) => {
  const header = readCaabHeader(buffer);
  const tables = parseCaabStringTables(buffer, header.recordNamesOffset);
  const out = { forcesByFaction: {} as Record<string, number[]>, charsByFaction: {} as Record<string, number[]>, owners: [] as number[], lists: [] as number[][], unitHistory: [] as number[], commander: [] as string[], ai: {} as Record<string, number[]> };
  let faction = "";
  let counts: number[] = [];
  const text = (v: { value: unknown }) => (v.value as { text: string }).text;
  walkCaabNodes(buffer, header, tables, {
    onRecordStart(record, stack) { counts.push(0); void stack; void record; },
    onRecordEnd() { counts.pop(); },
    onValue(v, stack) {
      const k = counts[counts.length - 1]++;
      const name = stack[stack.length - 1];
      const grand = stack[stack.length - 2];
      if (name === "FACTION" && grand === "FACTION_ARRAY" && v.kind === "value" && v.type === "u32" && k === 0) faction = String(v.value);
      if (name === "MILITARY_FORCE" && k === 0 && v.kind === "value") (out.forcesByFaction[faction] ??= []).push(Number(v.value));
      if (name === "CHARACTER" && k === 0 && v.kind === "value" && grand === "CHARACTER_ARRAY") (out.charsByFaction[faction] ??= []).push(Number(v.value));
      if (name === "REGION" && v.kind === "value" && v.type === "u32" && k === 4) out.owners.push(Number(v.value));
      if (name === "FACTION_PROVINCE_MANAGER" && k === 2 && v.kind === "array") out.lists.push(Array.from({ length: v.value.payloadByteLength / (v.marker === 0x57 ? 2 : 1) }, (_, i) => (v.marker === 0x57 ? v.value.payload.readUInt16LE(i * 2) : v.value.payload[i])));
      if (name === "UNIT_HISTORY" && k === 0 && v.kind === "value") out.unitHistory.push(Number(v.value));
      if (name === "COMMANDER_DETAILS" && k === 0 && v.kind === "value") out.commander.push(text(v as { value: unknown }));
      if (name === "OWNED_DIRECT" || name === "OWNED_INDIRECT") (out.ai[`${grand}.${name}`] ??= []).push(Number((v as { value: unknown }).value));
    },
  });
  return out;
};

test("transfers a region with its garrison, province lists and AI owner references", () => {
  const source = build();
  const before = ownership(source);
  assert.deepEqual(before.forcesByFaction["62"], [66, 67, 68, 900]);
  const result = applyCampaignEditsToEsf(source, { ownership: { test_region_altdorf: "emp_talabecland" }, actions: [] });
  assert.deepEqual(result.skipped, []);
  assert.equal(result.applied.length, 1);
  const after = ownership(result.buffer);
  assert.deepEqual(after.owners, [327]);
  // Garrison force and colonel moved (ids kept), re-keyed to the new owner; nothing else moved.
  assert.deepEqual(after.forcesByFaction["62"], [66, 67, 68]);
  assert.deepEqual(after.forcesByFaction["327"], [70, 910, 900]);
  assert.deepEqual(after.charsByFaction["62"], [122, 130, 140]);
  assert.deepEqual(after.charsByFaction["327"], [200, 310, 300]);
  assert.deepEqual(after.unitHistory, [327]);
  assert.deepEqual(after.commander, ["emp_talabecland"]);
  // Region id 1 left the owner's list [1, 2] and joined the new owner's list [9] in the same province.
  assert.deepEqual(after.lists, [[2], [9, 1]]);
  assert.deepEqual(after.ai["CAI_WORLD_SETTLEMENTS.OWNED_DIRECT"], [20664]);
  assert.deepEqual(after.ai["CAI_WORLD_RESOURCE_MOBILES.OWNED_DIRECT"], [20664]);
  assert.deepEqual(after.ai["CAI_WORLD_CHARACTERS.OWNED_INDIRECT"], [20664]);
  assert.equal(state(result.buffer).regions[0].faction, "emp_talabecland");
  // Everything else the extractor reads is unchanged.
  assert.deepEqual(state(result.buffer).faction_to_chars, state(source).faction_to_chars);
});

test("skips ownership changes it cannot write", () => {
  const source = build();
  const result = applyCampaignEditsToEsf(source, { ownership: { test_region_altdorf: null, nowhere: "emp_empire" }, actions: [] });
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.buffer, source);
  const noPresence = applyCampaignEditsToEsf(source, { ownership: { test_region_altdorf: "emp_empire" }, actions: [] });
  assert.match(noPresence.applied[0], /already owned/);
});
