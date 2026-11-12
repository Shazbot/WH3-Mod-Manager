import { strict as assert } from "node:assert";
import { test } from "node:test";
import { regionReferencedFactionKey } from "./removeFactions";

const ascii = (text: string) => ({ kind: "value", type: "ascii", value: { text } });

test("region and building owners inside REGIONS_ARRAY are region references", () => {
  assert.equal(regionReferencedFactionKey(ascii("a"), ["ROOT", "REGIONS_ARRAY", "REGION"]), "a");
  assert.equal(regionReferencedFactionKey(ascii("b"), ["ROOT", "REGIONS_ARRAY", "BUILDING_BASE"]), "b");
});
test("preview ownerships by theatre are region references", () => {
  assert.equal(regionReferencedFactionKey(ascii("c"), ["REGION_OWNERSHIPS_BY_THEATRE", "REGION_OWNERSHIPS"]), "c");
});
test("other ascii values, non-ascii values and empty text are not region references", () => {
  assert.equal(regionReferencedFactionKey(ascii("d"), ["ROOT", "FACTION_ARRAY", "REGION"]), undefined);
  assert.equal(regionReferencedFactionKey(ascii("e"), ["REGIONS_ARRAY", "OTHER"]), undefined);
  assert.equal(regionReferencedFactionKey({ kind: "value", type: "u32", value: 1 }, ["REGIONS_ARRAY", "REGION"]), undefined);
  assert.equal(regionReferencedFactionKey(ascii(""), ["REGIONS_ARRAY", "REGION"]), undefined);
});
