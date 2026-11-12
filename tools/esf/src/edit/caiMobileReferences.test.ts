import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode, buildCaabTree } from "../esf/codecs/caabTree";
import { CaabStringTables, readCaabHeader, parseCaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { writeCaabBuffer, cauleb128Length, writeCauleb128 } from "../esf/codecs/caabWriter";
import { encodeU32 } from "./addFaction";
import { removeCaiMobileReferences, removeCaiDependentReferenceArrays, validateCaiMobileReferences } from "./caiMobileReferences";

function fixture(marker = 0x58, dependent = false, rawId = 66426, declareComponents = false, withGarrison = false) {
  const names = ["ROOT", "CAI_THEATRE", "CAI_REGION", "CAI_ANALYSER", "CAI_DIPLOMATIC_ANALYSIS", "CAI_FACTION_MANAGER_MANAGER", "CAI_BDI_COMPONENT", "CAI_GARRISONABLE"];
  const tables: CaabStringTables = { recordNames: names, utf8ById: new Map(), utf16ById: new Map(),
    entries: names.map((text, id) => ({ table: "record_name", text, id, offset: 0, length: text.length })) };
  const width = marker === 0x58 ? 3 : 4;
  const array = (ids: number[]): CaabItem => {
    const payload = Buffer.alloc(ids.length * width);
    ids.forEach((id, i) => width === 3 ? payload.writeUIntBE(id, i * width, width) : payload.writeUIntLE(id, i * width, width));
    const prefix = cauleb128Length(payload.length), data = Buffer.alloc(1 + prefix + payload.length);
    data[0] = marker; writeCauleb128(data, 1, payload.length); payload.copy(data, 1 + prefix);
    return { kind: "bytes", data };
  };
  const record = (name: string, items: CaabItem[], isRoot = false): CaabRecordNode => ({
    kind: "record", name, nameIndex: names.indexOf(name), version: 0, flags: 0xa0,
    isRoot, hasNestedBlocks: false, groups: [items], blockSizeWidth: 1, groupCountWidth: 1, groupSizeWidths: [1],
  });
  const root = record("ROOT", dependent ? [
    record("CAI_DIPLOMATIC_ANALYSIS", [array([rawId, 10]), array([20])]),
    record("CAI_ANALYSER", [array([10, rawId, 20, 30, rawId, 40])]),
    record("CAI_FACTION_MANAGER_MANAGER", [array([rawId, 100, 10, 200])]),
  ] : [
    record("CAI_THEATRE", [array([10, rawId, 20]), array([rawId])]),
    record("CAI_REGION", [array([rawId]), array([]), array([]), array([]), array([30, rawId])]),
    record("CAI_ANALYSER", [array([10, rawId, 20, rawId])]),
  ], true);
  if (withGarrison) root.groups[0].push(record("CAI_GARRISONABLE", [array([rawId,10])]));
  if (declareComponents) for (const id of [10, rawId, 20, 30]) root.groups[0].push(record("CAI_BDI_COMPONENT", [{ kind: "bytes", data: encodeU32(id) }]));
  const buffer = writeCaabBuffer({ header: { codecId: 0xabca, unknown1: 0, creationDate: 0, recordNamesOffset: 0 }, tables, root, source: Buffer.alloc(0) });
  const header = readCaabHeader(buffer), parsedTables = parseCaabStringTables(buffer, header.recordNamesOffset);
  return { buffer, header, tables: parsedTables, root: buildCaabTree(buffer, header, parsedTables), rawId, width };
}

for (const marker of [0x58, 0x48]) test(`mobile cleanup preserves neighbouring IDs and unrelated arrays (marker ${marker})`, () => {
  const f = fixture(marker);
  assert.equal(removeCaiMobileReferences(f.root, f.buffer, f.header, f.tables, new Set([f.rawId])), 2);
  const next = writeCaabBuffer({ header: f.header, tables: f.tables, root: f.root, source: f.buffer });
  const arrays: number[][] = [];
  walkCaabNodes(next, readCaabHeader(next), f.tables, { onValue(v) {
    if (v.kind !== "array") return;
    const payload = v.value.payload, ids: number[] = [];
    for (let at = 0; at < payload.length; at += f.width) ids.push(f.width === 3 ? payload.readUIntBE(at, f.width) : payload.readUIntLE(at, f.width));
    arrays.push(ids);
  }});
  assert.deepEqual(arrays, [[10, 20], [f.rawId], [f.rawId], [], [], [], [30], [10, f.rawId, 20, f.rawId]]);
});

test("no removed mobile leaves the complete fixture byte-identical", () => {
  const f = fixture();
  assert.equal(removeCaiMobileReferences(f.root, f.buffer, f.header, f.tables, new Set([123])), 0);
  assert.deepEqual(writeCaabBuffer({ header: f.header, tables: f.tables, root: f.root, source: f.buffer }), f.buffer);
});

for (const marker of [0x58, 0x48]) test(`dependent cleanup removes complete pairs in either key position (marker ${marker})`, () => {
  const f = fixture(marker, true);
  assert.equal(removeCaiDependentReferenceArrays(f.root, f.buffer, f.header, f.tables, new Set([f.rawId])), 4);
  const next = writeCaabBuffer({ header: f.header, tables: f.tables, root: f.root, source: f.buffer });
  const arrays: number[][] = [];
  walkCaabNodes(next, readCaabHeader(next), f.tables, { onValue(v) {
    if (v.kind !== "array") return;
    const payload = v.value.payload, ids: number[] = [];
    for (let at = 0; at < payload.length; at += f.width) ids.push(f.width === 3 ? payload.readUIntBE(at, f.width) : payload.readUIntLE(at, f.width));
    arrays.push(ids);
  }});
  assert.deepEqual(arrays, [[10], [20], [20, 30], [10, 200]]);
});


test("deleted parent records do not create missing-span batch edits", () => {
  const f = fixture(0x58, true);
  f.root.groups[0].splice(1, 1); // remove the entire CAI_ANALYSER parent
  assert.equal(removeCaiDependentReferenceArrays(f.root, f.buffer, f.header, f.tables, new Set([f.rawId])), 2);
  const next = writeCaabBuffer({ header: f.header, tables: f.tables, root: f.root, source: f.buffer });
  assert.doesNotThrow(() => walkCaabNodes(next, readCaabHeader(next), f.tables, {}));
});

test("a 16-bit component ID matches its wider 24-bit reference array encoding", () => {
  const f = fixture(0x58, false, 0xde12);
  assert.equal(removeCaiMobileReferences(f.root, f.buffer, f.header, f.tables, new Set([0xde12])), 2);
});

test("native-reference verification accepts existing components across integer widths", () => {
  const f = fixture(0x58, false, 0xde12, true);
  assert.equal(validateCaiMobileReferences(f.buffer, f.header, f.tables), 5);
});
test("native-reference verification rejects a missing theatre component", () => {
  const f = fixture(0x58, false, 0xde12);
  assert.throws(() => validateCaiMobileReferences(f.buffer, f.header, f.tables), /CAI_THEATRE references missing AI component 10/);
});

test("garrison reference arrays delete individual removed components and preserve live neighbours", () => {
  const f=fixture(0x58,false,66426,true,true);
  assert.equal(removeCaiMobileReferences(f.root,f.buffer,f.header,f.tables,new Set([66426])),3);
  const next=writeCaabBuffer({header:f.header,tables:f.tables,root:f.root,source:f.buffer});
  assert.equal(validateCaiMobileReferences(next,readCaabHeader(next),f.tables),4);
});
