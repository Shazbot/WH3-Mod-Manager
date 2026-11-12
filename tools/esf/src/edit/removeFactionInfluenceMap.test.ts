import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode } from "../esf/codecs/caabTree";
import { decodeU32, encodeU32 } from "./addFaction";
import { removeCaiFactionInfluenceMap } from "./removeFaction";

function record(name: string, groups: CaabItem[][]): CaabRecordNode {
  return { kind: "record", name, nameIndex: 0, version: 0, flags: 0x80,
    isRoot: false, hasNestedBlocks: false, groups, blockSizeWidth: 1,
    groupCountWidth: 1, groupSizeWidths: [] };
}
function fixture(keys: number[], count = keys.length) {
  const chunks: Buffer[] = [];
  let offset = 0;
  function raw(...values: number[]): CaabItem {
    const data = Buffer.concat(values.map(encodeU32));
    const span: CaabItem = { kind: "raw", start: offset, end: offset + data.length };
    chunks.push(data); offset += data.length;
    return span;
  }
  const group: CaabItem[] = [raw(1, 999), record("CAI_EXTENDED_RESOURCE_INFLUENCE_MAP", [[]])];
  keys.forEach((key, i) => {
    group.push(i === 0 ? raw(count, key) : raw(key));
    group.push(record("CAI_HISTORICAL_INFLUENCE_MAP", [[]]));
  });
  const manager = record("CAI_INFLUENCE_MAP_MANAGER", [group]);
  return { root: record("ROOT", [[manager]]), manager, source: Buffer.concat(chunks) };
}
function directValues(f: ReturnType<typeof fixture>): number[] {
  const out: number[] = [];
  for (const item of f.manager.groups[0]) {
    if (item.kind === "record") continue;
    const data = item.kind === "raw" ? f.source.subarray(item.start, item.end) : item.data;
    for (let offset = 0; offset < data.length;) {
      const value = decodeU32(data, offset); out.push(value.value); offset += value.width;
    }
  }
  return out;
}
test("deleting a historical map updates the explicit count and preserves other keys", () => {
  const f = fixture([11, 22, 33]);
  assert.equal(removeCaiFactionInfluenceMap(f.root, f.source, 22), 1);
  assert.deepEqual(directValues(f), [1, 999, 2, 11, 33]);
  assert.equal(f.manager.groups[0].filter(n => n.kind === "record" && n.name === "CAI_HISTORICAL_INFLUENCE_MAP").length, 2);
});
test("deleting the first historical map preserves its shared count prefix", () => {
  const f = fixture([11, 22, 33]);
  removeCaiFactionInfluenceMap(f.root, f.source, 11);
  assert.deepEqual(directValues(f), [1, 999, 2, 22, 33]);
});
test("an inconsistent declared map count is rejected before mutation", () => {
  const f = fixture([11, 22], 3);
  assert.throws(() => removeCaiFactionInfluenceMap(f.root, f.source, 11), /declares 3 historical maps but contains 2/);
  assert.deepEqual(directValues(f), [1, 999, 3, 11, 22]);
});
test("duplicate matching map keys are rejected before mutation", () => {
  const f = fixture([11, 11]);
  assert.throws(() => removeCaiFactionInfluenceMap(f.root, f.source, 11), /found 2/);
  assert.deepEqual(directValues(f), [1, 999, 2, 11, 11]);
});
test("count encoding can shrink at the 256-map boundary", () => {
  const keys = Array.from({ length: 256 }, (_, i) => 1000 + i);
  const f = fixture(keys);
  removeCaiFactionInfluenceMap(f.root, f.source, 1100);
  assert.deepEqual(directValues(f), [1, 999, 255, ...keys.filter(key => key !== 1100)]);
});
