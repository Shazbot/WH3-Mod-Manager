import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabRecordNode } from "../esf/codecs/caabTree";
import { decodeU32, encodeU32 } from "./addFaction";
import { FACTION_KEYED_ROW_VERSIONS, remapFactionKeyedRows, validateFactionKeyedRows } from "./factionKeyedRows";

function fixture(ids: number[], version = 0) {
  const chunks: Buffer[] = []; let offset = 0;
  const groups = ids.map((id, i) => { const data = Buffer.concat([encodeU32(id), Buffer.from(`opaque-tag-payload-${i}`)]), start = offset; offset += data.length; chunks.push(data); return [{ kind: "raw" as const, start, end: offset }]; });
  const table: CaabRecordNode = { kind: "record", name: "FACTION_CHARACTER_TAGS", nameIndex: 0, version, flags: 0xc0, isRoot: false, hasNestedBlocks: true, groups, groupSizeWidths: ids.map((_, i) => i + 1), blockSizeWidth: 1, groupCountWidth: 1 };
  const root: CaabRecordNode = { ...table, name: "ROOT", groups: [[table]], groupSizeWidths: [1] };
  return { table, root, source: Buffer.concat(chunks) };
}
function values(f: ReturnType<typeof fixture>) { return f.table.groups.map(group => { const first = group[0]; assert(first.kind === "raw" || first.kind === "bytes"); const data = first.kind === "raw" ? f.source.subarray(first.start, first.end) : first.data, id = decodeU32(data, 0); return { id: id.value, payload: data.subarray(id.width).toString() }; }); }

test("tag rows remove deleted owners and compact sparse surviving IDs without changing payloads", () => {
  const f = fixture([10, 607, 718]);
  assert.deepEqual(remapFactionKeyedRows(f.root, f.source, new Map([[10, 10], [607, 400]]), new Set([718])), { removed: 1, remapped: 1 });
  assert.deepEqual(values(f), [{ id: 10, payload: "opaque-tag-payload-0" }, { id: 400, payload: "opaque-tag-payload-1" }]);
  assert.deepEqual(f.table.groupSizeWidths, [1, 2]);
  assert.doesNotThrow(() => validateFactionKeyedRows(f.root, f.source, 562));
});
test("special participant id1 and unchanged owners remain intact", () => {
  const f = fixture([1, 10]), original = f.table.groups.slice();
  assert.deepEqual(remapFactionKeyedRows(f.root, f.source, new Map([[1, 1], [10, 10]]), new Set()), { removed: 0, remapped: 0 });
  assert.deepEqual(f.table.groups, original);
});
test("unknown and out-of-range tag owners are rejected", () => {
  const f = fixture([607]);
  assert.throws(() => validateFactionKeyedRows(f.root, f.source, 562), /Invalid faction-keyed row owner 607/);
  assert.throws(() => remapFactionKeyedRows(f.root, f.source, new Map(), new Set()), /Unknown faction-keyed row owner 607/);
});
test("duplicate tag owners are rejected", () => {
  const f = fixture([10, 10]);
  assert.throws(() => remapFactionKeyedRows(f.root, f.source, new Map([[10, 10]]), new Set()), /Duplicate faction-keyed row owner 10/);
});
test("unsupported character-tag layouts are rejected", () => {
  const f = fixture([10], 1);
  assert.throws(() => remapFactionKeyedRows(f.root, f.source, new Map([[10, 10]]), new Set()), /Unsupported FACTION_CHARACTER_TAGS version 1/);
});

for (const [name, version] of Object.entries(FACTION_KEYED_ROW_VERSIONS)) test(`${name} remaps only the leading owner and drops removed rows`, () => {
  const f = fixture([10, 607, 718], version); f.table.name = name;
  assert.deepEqual(remapFactionKeyedRows(f.root, f.source, new Map([[10, 10], [607, 400]]), new Set([718])), { removed: 1, remapped: 1 });
  assert.deepEqual(values(f), [{ id: 10, payload: "opaque-tag-payload-0" }, { id: 400, payload: "opaque-tag-payload-1" }]);
  validateFactionKeyedRows(f.root, f.source, 562);
});

test("cooking rows preserve nested records before the first direct owner value", () => {
  const f = fixture([607], 3); f.table.name = "FACTION_COOKING_INFO";
  const child: CaabRecordNode = { ...f.table, name: "OPAQUE_CHILD", groups: [], groupSizeWidths: [] };
  f.table.groups[0].unshift(child as any);
  assert.deepEqual(remapFactionKeyedRows(f.root, f.source, new Map([[607, 400]]), new Set()), { removed: 0, remapped: 1 });
  assert.equal(f.table.groups[0][0], child);
  const raw = f.table.groups[0][1]; assert(raw.kind === "bytes"); assert.equal(decodeU32(raw.data, 0).value, 400);
  validateFactionKeyedRows(f.root, f.source, 562);
});
