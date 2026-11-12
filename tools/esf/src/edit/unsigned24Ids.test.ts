import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabRecordNode } from "../esf/codecs/caabTree";
import { CaabStringTables, readCaabHeader, parseCaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { decodeU32, encodeU32 } from "./addFaction";
import { readLeadingValues } from "./caiFactionIds";

const sample = Buffer.from([0x18, 0x01, 0x03, 0x7a]); // Native dump ID66426.
function root(data: Buffer): CaabRecordNode { return { kind: "record", name: "ROOT", nameIndex: 0, version: 0, flags: 0xa0, isRoot: true, hasNestedBlocks: false, groups: [[{ kind: "bytes", data }]], blockSizeWidth: 1, groupCountWidth: 1, groupSizeWidths: [1] }; }
test("native 24-bit ID bytes decode as big endian", () => {
  assert.deepEqual(decodeU32(sample, 0), { value: 66426, width: 4 });
  assert.deepEqual(encodeU32(66426), sample);
});
test("leading AI IDs use the same native numeric representation", () => {
  const node = root(sample); node.groups[0] = [{ kind: "raw", start: 0, end: sample.length }];
  assert.equal(readLeadingValues(node, sample, 1)[0].value, 66426);
});
test("16-bit and 24-bit IDs cannot collide after decoding", () => {
  assert.equal(decodeU32(Buffer.from([0x17, 0x01, 0x01]), 0).value, 257);
  assert.equal(decodeU32(Buffer.from([0x18, 0x01, 0x01, 0x00]), 0).value, 65792);
});
test("unsigned encoding stays correct across compression-width boundaries", () => {
  for (const id of [0, 1, 255, 256, 65535, 65536, 65792, 0xffffff, 0x1000000]) assert.equal(decodeU32(encodeU32(id), 0).value, id);
  assert.deepEqual(encodeU32(65536), Buffer.from([0x18, 1, 0, 0]));
});
test("binary ESF walker reports the native 24-bit ID", () => {
  const tables: CaabStringTables = { recordNames: ["ROOT"], utf8ById: new Map(), utf16ById: new Map(), entries: [{ table: "record_name", text: "ROOT", id: 0, offset: 0, length: 4 }] };
  const buffer = writeCaabBuffer({ header: { codecId: 0xabca, unknown1: 0, creationDate: 0, recordNamesOffset: 0 }, tables, root: root(sample), source: Buffer.alloc(0) });
  const h = readCaabHeader(buffer), values: number[] = [];
  walkCaabNodes(buffer, h, parseCaabStringTables(buffer, h.recordNamesOffset), { onValue(v) { if (v.kind === "value" && v.type === "u32") values.push(v.value as number); } });
  assert.deepEqual(values, [66426]);
});
