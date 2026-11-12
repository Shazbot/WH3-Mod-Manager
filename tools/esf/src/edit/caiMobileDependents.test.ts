import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode } from "../esf/codecs/caabTree";
import { decodeU32, encodeU32 } from "./addFaction";
import { removeCaiMobileDependents } from "./caiMobileDependents";

function fixture(count = 2) {
  const chunks: Buffer[] = []; let offset = 0;
  function values(...ids: number[]): CaabItem {
    const data = Buffer.concat(ids.map(encodeU32)), item: CaabItem = { kind: "raw", start: offset, end: offset + data.length };
    chunks.push(data); offset += data.length; return item;
  }
  function record(name: string, groups: CaabItem[][]): CaabRecordNode {
    return { kind: "record", name, nameIndex: 0, version: 0, flags: 0xc0, isRoot: false,
      hasNestedBlocks: true, groups, blockSizeWidth: 1, groupCountWidth: 1, groupSizeWidths: groups.map(() => 1) };
  }
  const firstBasic = record("CAI_RESOURCE_INFLUENCE_MAP", [[]]), firstExtended = record("CAI_EXTENDED_RESOURCE_INFLUENCE_MAP", [[]]);
  const secondBasic = record("CAI_RESOURCE_INFLUENCE_MAP", [[]]), secondExtended = record("CAI_EXTENDED_RESOURCE_INFLUENCE_MAP", [[]]);
  const maps = record("CAI_INFLUENCE_MAP_MANAGER", [[values(count, 10), firstBasic, firstExtended, values(20), secondBasic, secondExtended]]);
  const beliefs = record("CAI_BDI_POOL_BELIEFS", [
    [record("CAI_RESOURCE_MOBILE_MILITARY_STRENGTH_ANALYSIS", [[values(10)]])],
    [record("CAI_RESOURCE_MOBILE_MILITARY_STRENGTH_ANALYSIS", [[values(20)]])],
  ]);
  const root = record("ROOT", [[maps, beliefs]]);
  return { root, maps, beliefs, firstBasic, firstExtended, secondBasic, secondExtended, source: Buffer.concat(chunks) };
}
function scalars(group: CaabItem[], source: Buffer) {
  const out: number[] = [];
  for (const item of group) {
    if (item.kind === "record") continue;
    const bytes = item.kind === "raw" ? source.subarray(item.start, item.end) : item.data;
    for (let at = 0; at < bytes.length;) { const value = decodeU32(bytes, at); out.push(value.value); at += value.width; }
  }
  return out;
}

test("first resource deletion preserves the shared counter and deletes both companion maps", () => {
  const f = fixture();
  assert.deepEqual(removeCaiMobileDependents(f.root, f.source, new Set([10])), { beliefsRemoved: 1, mapsRemoved: 1 });
  assert.deepEqual(scalars(f.maps.groups[0], f.source), [1, 20]);
  assert.deepEqual(f.maps.groups[0].filter(n => n.kind === "record"), [f.secondBasic, f.secondExtended]);
  assert.equal(f.beliefs.groups.length, 1); assert.deepEqual(f.beliefs.groupSizeWidths, [1]);
});

test("last resource deletion preserves the preceding key and complete first map pair", () => {
  const f = fixture();
  assert.deepEqual(removeCaiMobileDependents(f.root, f.source, new Set([20])), { beliefsRemoved: 1, mapsRemoved: 1 });
  assert.deepEqual(scalars(f.maps.groups[0], f.source), [1, 10]);
  assert.deepEqual(f.maps.groups[0].filter(n => n.kind === "record"), [f.firstBasic, f.firstExtended]);
});

test("inconsistent resource map count is rejected", () => {
  const f = fixture(3);
  assert.throws(() => removeCaiMobileDependents(f.root, f.source, new Set([10])), /count does not match/);
});
