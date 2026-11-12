import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode, buildCaabTree } from "../esf/codecs/caabTree";
import { CaabStringTables, parseCaabStringTables, readCaabHeader, walkCaabNodes } from "../esf/codecs/caabBinary";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { encodeU32 } from "./addFaction";
import { collectProvinceFactionOwners, remapProvinceFactionOwners } from "./provinceFactionIds";

function fixture(owners = [607], managerVersion = 1, sea = false) {
  const names = ["ROOT", "PROVINCE_ARRAY", "PROVINCE", "FACTION_PROVINCE_MANAGER_ARRAY", "FACTION_PROVINCE_MANAGER", "RECRUITMENT_MANAGER", "FACTION_PROVINCE_PERSISTENT_POOLED_RESOURCE_MANAGER", "CHILD", "SEA_REGIONS_BLOCK", "SEA_REGION", "FACTION_SEA_REGION_MANAGER_BLOCK", "FACTION_SEA_REGION_MANAGER"];
  const tables: CaabStringTables = { recordNames: names, utf8ById: new Map(), utf16ById: new Map(), entries: names.map((text, id) => ({ table: "record_name", text, id, offset: 0, length: text.length })) };
  const rec = (name: string, groups: CaabItem[][], nested = false, version = 0): CaabRecordNode => ({ kind: "record", name, nameIndex: names.indexOf(name), version, flags: nested ? 0xe0 : 0xa0, isRoot: name === "ROOT", hasNestedBlocks: nested, groups, blockSizeWidth: 1, groupCountWidth: 1, groupSizeWidths: groups.map(() => 1) });
  const ints = (...values: number[]): CaabItem => ({ kind: "bytes", data: Buffer.concat(values.map(encodeU32)) });
  const province = rec("PROVINCE", [[ints(40),
    rec("FACTION_PROVINCE_MANAGER_ARRAY", owners.map((owner, i) => [rec("FACTION_PROVINCE_MANAGER", [[ints(62 + i, owner)]], false, managerVersion)]), true),
    rec("RECRUITMENT_MANAGER", [[ints(607), rec("RECRUITMENT_MANAGER", [[ints(1108)]])]], true),
    rec("FACTION_PROVINCE_PERSISTENT_POOLED_RESOURCE_MANAGER", [[ints(607), rec("CHILD", [[ints(999)]])]], true),
  ]], false, 3);
  const seaRegion = rec("SEA_REGION", [[ints(41), rec("FACTION_SEA_REGION_MANAGER_BLOCK", owners.map((owner, i) => [rec("FACTION_SEA_REGION_MANAGER", [[ints(77 + i, owner)]], false, managerVersion)]), true)]]);
  const root = rec("ROOT", [[sea ? rec("SEA_REGIONS_BLOCK", [[seaRegion]], true) : rec("PROVINCE_ARRAY", [[province]], true)]]);
  const source = writeCaabBuffer({ header: { codecId: 0xabca, unknown1: 0, creationDate: 0, recordNamesOffset: 0 }, tables, root, source: Buffer.alloc(0) });
  const header = readCaabHeader(source), parsed = parseCaabStringTables(source, header.recordNamesOffset);
  return { source, header, tables: parsed, root: buildCaabTree(source, header, parsed) };
}
function result(f: ReturnType<typeof fixture>) {
  const source = writeCaabBuffer({ header: f.header, tables: f.tables, root: f.root, source: f.source });
  return { source, rows: collectProvinceFactionOwners(source, readCaabHeader(source), f.tables) };
}

test("province managers and owner-keyed rows compact while nested same-name IDs remain unchanged", () => {
  const f = fixture();
  assert.equal(remapProvinceFactionOwners(f.root, f.source, f.header, f.tables, new Map([[607, 400]])), 3);
  const out = result(f); assert.deepEqual(out.rows.map(r => r.ownerId), [400, 400, 400]);
  const values: number[] = [];
  walkCaabNodes(out.source, readCaabHeader(out.source), f.tables, { onValue(v) { if (v.kind === "value" && v.type === "u32") values.push(v.value as number); } });
  assert(values.includes(62)); assert(values.includes(1108)); assert(values.includes(999));
});
test("a transferred manager uses the recipient's compacted ID", () => {
  const f = fixture([494]);
  assert.equal(remapProvinceFactionOwners(f.root, f.source, f.header, f.tables, new Map([[99, 80], [607, 400]]), new Map([[494, 99]])), 3);
  assert.deepEqual(result(f).rows.map(r => r.ownerId), [80, 400, 400]);
});
test("transfers cannot silently create duplicate faction managers in one province", () => {
  const f = fixture([494, 99]);
  assert.throws(() => remapProvinceFactionOwners(f.root, f.source, f.header, f.tables, new Map([[99, 99], [607, 400]]), new Map([[494, 99]])), /duplicate FACTION_PROVINCE_MANAGER/);
});
test("missing manager recipients are rejected", () => {
  const f = fixture([494]);
  assert.throws(() => remapProvinceFactionOwners(f.root, f.source, f.header, f.tables, new Map([[607, 400]])), /needs a surviving recipient/);
});
test("unknown province-manager layouts are rejected", () => {
  const f = fixture([607], 2);
  assert.throws(() => collectProvinceFactionOwners(f.source, f.header, f.tables), /Unsupported FACTION_PROVINCE_MANAGER version 2/);
});


test("sea-region managers compact their faction owner without changing manager UID", () => {
  const f = fixture([607], 0, true);
  assert.equal(remapProvinceFactionOwners(f.root, f.source, f.header, f.tables, new Map([[607, 400]])), 1);
  const out = result(f);
  assert.equal(out.rows[0].recordName, "FACTION_SEA_REGION_MANAGER");
  assert.equal(out.rows[0].ownerId, 400);
  const values: number[] = [];
  walkCaabNodes(out.source, readCaabHeader(out.source), f.tables, { onValue(v) { if (v.kind === "value" && v.type === "u32") values.push(v.value as number); } });
  assert(values.includes(77));
});
test("sea-region special-participant owners stay at id1", () => {
  const f = fixture([1], 0, true);
  assert.equal(remapProvinceFactionOwners(f.root, f.source, f.header, f.tables, new Map([[1, 1]])), 0);
  assert.equal(result(f).rows[0].ownerId, 1);
});
test("unknown sea-region-manager layouts are rejected", () => {
  const f = fixture([607], 1, true);
  assert.throws(() => collectProvinceFactionOwners(f.source, f.header, f.tables), /Unsupported FACTION_SEA_REGION_MANAGER version 1/);
});
