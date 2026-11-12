import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode, buildCaabTree } from "../esf/codecs/caabTree";
import { CaabStringTables, parseCaabStringTables, readCaabHeader, walkCaabNodes } from "../esf/codecs/caabBinary";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { encodeAscii, encodeU32 } from "./addFaction";
import { collectRegionFactionOwners, remapRegionFactionOwners } from "./regionFactionIds";

function fixture(owners: number[], version = 3) {
  const names = ["ROOT", "REGIONS_ARRAY", "REGION", "CHILD"];
  const tables: CaabStringTables = { recordNames: names, utf8ById: new Map([[1, "test_region"]]), utf16ById: new Map(), entries: [
    ...names.map((text, id) => ({ table: "record_name" as const, text, id, offset: 0, length: text.length })),
    { table: "utf8", text: "test_region", id: 1, offset: 0, length: 11 },
  ] };
  const rec = (name: string, groups: CaabItem[][], nested = false, v = 0): CaabRecordNode => ({ kind: "record", name, nameIndex: names.indexOf(name), version: v, flags: nested ? 0xe0 : 0xa0, isRoot: name === "ROOT", hasNestedBlocks: nested, groups, blockSizeWidth: 1, groupCountWidth: 1, groupSizeWidths: groups.map(() => 1) });
  const bytes = (...buffers: Buffer[]): CaabItem => ({ kind: "bytes", data: Buffer.concat(buffers) });
  const regions = owners.map((owner, index) => [rec("REGION", [[
    bytes(encodeU32(index + 200), encodeAscii(1)),
    rec("CHILD", [[bytes(encodeU32(999))]]),
    bytes(encodeU32(0), encodeU32(0), encodeU32(owner), encodeU32(123456789)),
  ]], false, version)]);
  const root = rec("ROOT", [[rec("REGIONS_ARRAY", regions, true)]]);
  const source = writeCaabBuffer({ header: { codecId: 0xabca, unknown1: 0, creationDate: 0, recordNamesOffset: 0 }, tables, root, source: Buffer.alloc(0) });
  const header = readCaabHeader(source), parsed = parseCaabStringTables(source, header.recordNamesOffset);
  return { source, header, tables: parsed, root: buildCaabTree(source, header, parsed) };
}
function written(f: ReturnType<typeof fixture>) {
  const source = writeCaabBuffer({ header: f.header, tables: f.tables, root: f.root, source: f.source });
  return { source, owners: collectRegionFactionOwners(source, readCaabHeader(source), f.tables).map(r => r.ownerId) };
}

test("surviving numeric region owners compact independently of nested IDs and trailing hashes", () => {
  const f = fixture([607]);
  assert.equal(remapRegionFactionOwners(f.root, f.source, f.header, f.tables, new Map([[607, 401]])), 1);
  const out = written(f); assert.deepEqual(out.owners, [401]);
  const ids: number[] = [];
  walkCaabNodes(out.source, readCaabHeader(out.source), f.tables, { onValue(v) { if (v.kind === "value" && v.type === "u32") ids.push(v.value as number); } });
  assert(ids.includes(999)); assert(ids.includes(123456789));
});
test("removed region owners transfer to the recipient's compacted ID", () => {
  const f = fixture([3, 5]);
  assert.equal(remapRegionFactionOwners(f.root, f.source, f.header, f.tables, new Map([[5, 4]]), new Map([[3, 5]])), 2);
  assert.deepEqual(written(f).owners, [4, 4]);
});
test("unowned and special-participant regions preserve their zero/id1 owners", () => {
  const f = fixture([0, 1]);
  assert.equal(remapRegionFactionOwners(f.root, f.source, f.header, f.tables, new Map([[1, 1]])), 0);
  assert.deepEqual(written(f).owners, [0, 1]);
});
test("a removed owner without a recipient is rejected", () => {
  const f = fixture([3]);
  assert.throws(() => remapRegionFactionOwners(f.root, f.source, f.header, f.tables, new Map([[5, 4]])), /needs a surviving recipient/);
});
test("an unknown REGION layout is rejected", () => {
  const f = fixture([3], 4);
  assert.throws(() => collectRegionFactionOwners(f.source, f.header, f.tables), /Unsupported REGION version 4/);
});
