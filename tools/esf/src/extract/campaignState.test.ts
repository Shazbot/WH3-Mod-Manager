import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode } from "../esf/codecs/caabTree";
import { CaabStringTables } from "../esf/codecs/caabBinary";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { parseEsfDocument } from "../esf/EsfParser";
import { encodeAscii, encodeU32 } from "../edit/addFaction";
import { extractCampaignState } from "./campaignState";

const NAMES = [
  "ROOT", "CAMPAIGN_ENV", "CAMPAIGN_SETUP", "CAMPAIGN_MODEL", "WORLD", "FACTION_ARRAY", "FACTION", "CHARACTER_ARRAY",
  "CHARACTER", "LOCOMOTABLE", "ARMY_ARRAY", "MILITARY_FORCE", "UNIT_CONTAINER", "UNITS_ARRAY", "UNIT", "UNIT_RECORD_KEY",
  "OLD_DIPLOMACY_MANAGER", "OLD_DIPLOMACY_RELATIONSHIP", "FAMILY_TREE", "FAMILY_MEMBER", "CHARACTER_DETAILS",
  "REGION_MANAGER", "REGIONS_ARRAY", "REGION", "REGION_SLOT_MANAGER", "REGION_SLOT_ARRAY", "REGION_SLOT",
  "REGION_BUILDING_MANAGER", "BUILDING_BASE",
];

function build(rootName: string) {
  const strings: string[] = [];
  const A = (text: string) => {
    let id = strings.indexOf(text);
    if (id < 0) id = strings.push(text) - 1;
    return encodeAscii(id);
  };
  const u32 = (value: number) => encodeU32(value);
  const i32 = (value: number) => { const b = Buffer.alloc(5); b[0] = 0x04; b.writeInt32LE(value, 1); return b; };
  const u16 = (value: number) => { const b = Buffer.alloc(3); b[0] = 0x07; b.writeUInt16LE(value, 1); return b; };
  const u8 = (value: number) => Buffer.from([0x06, value]);
  const bool = (value: boolean) => Buffer.from([value ? 0x12 : 0x13]);
  const u32Array = (...values: number[]) => {
    const payload = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => payload.writeUInt32LE(value, index * 4));
    return Buffer.concat([Buffer.from([0x48, payload.length]), payload]);
  };
  const bytes = (...buffers: Buffer[]): CaabItem => ({ kind: "bytes", data: Buffer.concat(buffers) });
  const rec = (name: string, group: CaabItem[]): CaabRecordNode => ({
    kind: "record", name, nameIndex: NAMES.indexOf(name), version: 0, flags: 0xe0, isRoot: name === rootName,
    hasNestedBlocks: true, groups: [group], blockSizeWidth: 1, groupCountWidth: 1, groupSizeWidths: [1],
  });
  const many = (name: string, groups: CaabItem[][]): CaabRecordNode => ({ ...rec(name, []), groups, groupSizeWidths: groups.map(() => 1) });
  // [14] lists relationship codes: 1659 = non-aggression pact, 4051 = trade agreement.
  const oldGroup = (other: number, stance: string, access = 0, codes: number[] = [1657]) => bytes(
    u32(other), i32(0), A(stance), u32(0), i32(0), i32(0), i32(0), i32(0), u32(0), u32(0), u32Array(), u32(0), i32(access === 1 ? -1 : 0), A("neutral"), u32Array(...codes),
  );

  const unit = (id: number, key: string, cur: number, max: number, commander: number, xp: number, rank: number) =>
    rec("UNIT", [bytes(u32(id)), rec("UNIT_RECORD_KEY", [bytes(A(key))]), bytes(u32(cur), u32(max), u32(commander), u32(xp), u8(rank))]);
  const faction = (id: number, key: string, kids: CaabRecordNode[]) => rec("FACTION", [bytes(u32(id), A(key)), ...kids]);
  // Direct values end with an off-map u16 pair and a u32 that is non-zero for characters out of play.
  const character = (id: number, type: string, familyId: number, forceId: number, hiddenAt?: [number, number], outOfPlay = 0) =>
    rec("CHARACTER", [
      rec("LOCOMOTABLE", [bytes(u16(525), u16(636))]),
      bytes(u32(id), A(type), u32(familyId), u32(forceId), u16(hiddenAt?.[0] ?? 65535), u16(hiddenAt?.[1] ?? 65535), u32(outOfPlay)),
    ]);
  const karl = character(122, "general", 124, 66);
  const garrison = character(130, "colonel", 131, 0);
  const embedded = character(140, "champion", 141, 0, [520, 470]);
  const wounded = character(150, "champion", 151, 0, undefined, 8512);
  // One OLD_DIPLOMACY_RELATIONSHIP record with one block per other faction.
  const oldRel = rec("OLD_DIPLOMACY_RELATIONSHIP", [
    oldGroup(63, "war"), oldGroup(64, "military_allies", 0, [1657, 1658, 1659, 1660]), oldGroup(65, "neutral", 1, [4051, 1657, 1658, 4053]),
  ]);
  const empireFull = faction(62, "emp_empire", [
    many("CHARACTER_ARRAY", [[karl], [garrison], [embedded], [wounded]]),
    rec("ARMY_ARRAY", [rec("MILITARY_FORCE", [bytes(u32(66), u32(122)), rec("UNIT_CONTAINER", [rec("UNITS_ARRAY", [
      unit(569, "emp_cha_karl", 3216, 3216, 122, 0, 0),
      unit(567, "emp_halberdiers", 45, 90, 0, 700, 1),
    ])])])]),
    rec("OLD_DIPLOMACY_MANAGER", [oldRel]),
  ]);
  const others = [63, 64, 65].map((id) => faction(id, `other_${id}`, []));
  const member = (familyId: number, charId: number, type: string, subtype: string) => rec("FAMILY_MEMBER", [
    bytes(u32(familyId)),
    rec("CHARACTER_DETAILS", [bytes(A("emp_empire"), u32(charId), A(""), A(type), A(subtype), A("art_set"))]),
  ]);
  const members = [
    member(124, 122, "general", "emp_karl_franz"),
    member(131, 130, "colonel", "emp_garrison_captain"),
    member(141, 140, "champion", "emp_witch_hunter"),
    member(151, 150, "champion", "emp_witch_hunter"),
  ];
  const slot = (instance: string, template: string, type: string, building: string | null) =>
    rec("REGION_SLOT", [
      bytes(A(instance), A(template), A(type)),
      rec("REGION_BUILDING_MANAGER", building === null ? [] : [rec("BUILDING_BASE", [bytes(u32(1), A(building))])]),
    ]);
  // The fourth direct u32 is the owner's faction id; the owner asciis can lag behind it.
  const region = rec("REGION", [
    bytes(u32(1), A("test_region_altdorf"), u32(0), u32(200), u32(62), A("other_63"), A("sub"), bool(false), bool(false), A(""), A("other_63"), A("")),
    rec("REGION_SLOT_MANAGER", [rec("REGION_SLOT_ARRAY", [slot("r:0", "tpl_primary", "primary", "emp_settlement_1"), slot("r:1", "tpl_sec", "secondary", null)])]),
  ]);
  const abandoned = rec("REGION", [
    bytes(u32(2), A("test_region_ruin"), u32(0), u32(200), u32(63), A("other_63"), A("sub"), bool(false), bool(true), A(""), A("other_63"), A("")),
    rec("REGION_SLOT_MANAGER", [rec("REGION_SLOT_ARRAY", [slot("q:0", "tpl_ruin", "primary", "ruin_1")])]),
  ]);
  const root = rec(rootName, [
    rec("CAMPAIGN_ENV", [
      rec("CAMPAIGN_SETUP", [bytes(A("wh3_main_combi"))]),
      rec("CAMPAIGN_MODEL", [rec("WORLD", [
        many("FACTION_ARRAY", [[empireFull], ...others.map((f) => [f as CaabItem])]),
        many("FAMILY_TREE", members.map((m) => [m as CaabItem])),
        rec("REGION_MANAGER", [many("REGIONS_ARRAY", [[region], [abandoned]])]),
      ])]),
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

for (const rootName of ["CAMPAIGN_SAVE_GAME", "CAMPAIGN_STARTPOS"]) {
  test(`extracts campaign state from a ${rootName} root`, () => {
    NAMES[0] = rootName;
    const buffer = build(rootName);
    const state = extractCampaignState(buffer, parseEsfDocument(buffer));
    assert.equal(state.campaignKey, "wh3_main_combi");
    assert.deepEqual(state.regions, [
      {
        faction: "emp_empire",
        region: "test_region_altdorf",
        buildings: [
          { building: "emp_settlement_1", type: "primary", template: "tpl_primary" },
          { building: "", type: "secondary", template: "tpl_sec" },
        ],
      },
      { faction: null, region: "test_region_ruin", buildings: null },
    ]);
    assert.equal(state.faction_to_chars.length, 1);
    const [empire] = state.faction_to_chars;
    assert.equal(empire.faction, "emp_empire");
    // The garrison commander and the out-of-play character are left out; the embedded champion is off-map.
    assert.deepEqual(empire.chars, [
      {
        x: 525, y: 636, subtype: "emp_karl_franz", id: 122, rank: 1,
        units: [
          { id: 569, xp: 0, health: 100, unit_key: "emp_cha_karl" },
          { id: 567, xp: 1, health: 50, unit_key: "emp_halberdiers" },
        ],
      },
      { x: 65535, y: 65535, subtype: "emp_witch_hunter", id: 140, rank: 1 },
    ]);
    assert.deepEqual(empire.diplo.war, ["other_63"]);
    assert.deepEqual(empire.diplo.mil_ally, ["other_64"]);
    assert.deepEqual(empire.diplo.non_aggression, ["other_64"]);
    assert.deepEqual(empire.diplo.trade, ["other_65"]);
    assert.deepEqual(empire.diplo.mil_access, ["other_65"]);
    assert(state.warnings.length > 0);
  });
}
