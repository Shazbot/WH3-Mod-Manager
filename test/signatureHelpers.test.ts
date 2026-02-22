/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  areCustomizableModsEqual,
  buildCustomizableModsSignature,
  buildStringArraySignature,
  buildStringRecordSignature,
  stableStringify,
} = require("../src/utility/signatureHelpers.ts");

test("buildStringArraySignature is deterministic and length-safe", () => {
  const signatureA = buildStringArraySignature(["ab", "c"]);
  const signatureB = buildStringArraySignature(["a", "bc"]);
  const signatureC = buildStringArraySignature(["ab", "c"]);

  assert.equal(signatureA, signatureC);
  assert.notEqual(signatureA, signatureB);
});

test("buildStringRecordSignature is key-order independent", () => {
  const signatureA = buildStringRecordSignature({ b: "2", a: "1" });
  const signatureB = buildStringRecordSignature({ a: "1", b: "2" });
  const signatureC = buildStringRecordSignature({ a: "1", b: "3" });

  assert.equal(signatureA, signatureB);
  assert.notEqual(signatureA, signatureC);
});

test("areCustomizableModsEqual compares content instead of object identity", () => {
  const left = {
    "/mods/a.pack": ["table_1", "table_2"],
    "/mods/b.pack": ["table_3"],
  };
  const rightSameContentDifferentOrder = {
    "/mods/b.pack": ["table_3"],
    "/mods/a.pack": ["table_1", "table_2"],
  };
  const rightChangedValue = {
    "/mods/b.pack": ["table_3"],
    "/mods/a.pack": ["table_1", "table_4"],
  };

  assert.equal(areCustomizableModsEqual(left, rightSameContentDifferentOrder), true);
  assert.equal(areCustomizableModsEqual(left, rightChangedValue), false);
});

test("buildCustomizableModsSignature is deterministic across key insertion order", () => {
  const first = {
    "/mods/a.pack": ["table_1", "table_2"],
    "/mods/b.pack": ["table_3"],
  };
  const second = {
    "/mods/b.pack": ["table_3"],
    "/mods/a.pack": ["table_1", "table_2"],
  };
  const changed = {
    "/mods/a.pack": ["table_1", "table_2"],
    "/mods/b.pack": ["table_3", "table_4"],
  };

  assert.equal(buildCustomizableModsSignature(first), buildCustomizableModsSignature(second));
  assert.notEqual(buildCustomizableModsSignature(first), buildCustomizableModsSignature(changed));
});

test("stableStringify normalizes object key order", () => {
  const a = {
    z: 1,
    a: {
      q: "x",
      b: [2, 1],
    },
  };
  const b = {
    a: {
      b: [2, 1],
      q: "x",
    },
    z: 1,
  };
  const c = {
    a: {
      b: [1, 2],
      q: "x",
    },
    z: 1,
  };

  assert.equal(stableStringify(a), stableStringify(b));
  assert.notEqual(stableStringify(a), stableStringify(c));
});
