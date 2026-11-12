import { strict as assert } from "node:assert";
import { test } from "node:test";
import { factionIdRemapping, filterFactionGroups } from "./removeFactions";
import { CaabRecordNode } from "../esf/codecs/caabTree";

test("batch ID mapping preserves id1 and compacts nonadjacent deletions", () => {
  assert.deepEqual([...factionIdRemapping(6, new Set([0, 2, 5]))], [[1, 1], [3, 2], [5, 3], [6, 4]]);
});
test("adjacent deletions match the verified Ravenqueen/Truthsayers layout", () => {
  const map = factionIdRemapping(808, new Set([559, 560]));
  assert.equal(map.size, 807); assert.equal(map.has(561), false); assert.equal(map.has(562), false);
  assert.equal(map.get(560), 560); assert.equal(map.get(563), 561); assert.equal(map.get(809), 807);
});
test("batch group filtering keeps each surviving row with its original size width", () => {
  const groups = [1, 2, 3, 4].map(n => [{ kind: "bytes" as const, data: Buffer.from([n]) }]);
  const node: CaabRecordNode = { kind: "record", name: "TEST", nameIndex: 0, version: 0, flags: 0xc0,
    isRoot: false, hasNestedBlocks: true, groups, groupSizeWidths: [1, 3, 2, 4], blockSizeWidth: 1, groupCountWidth: 1 };
  assert.equal(filterFactionGroups(node, (_, i) => i === 0 || i === 2), 2);
  assert.deepEqual(node.groups, [groups[1], groups[3]]); assert.deepEqual(node.groupSizeWidths, [3, 4]);
});
