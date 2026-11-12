import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode, buildCaabTree } from "../esf/codecs/caabTree";
import { CaabStringTables, readCaabHeader, parseCaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { encodeU32 } from "./addFaction";
import { remapCaiSettlementReferences, validateCaiSettlementOwners } from "./caiSettlementReferences";

function fixture(version = 0, withProvince = false, withRegion = false) {
  const names = ["ROOT", "CAI_WORLD_FACTIONS", "CAI_WORLD_SETTLEMENTS", "OWNED_DIRECT", "CAI_GARRISONABLE", "CAI_SETTLEMENT", "OPAQUE", "CAI_FACTION_PROVINCES", "CAI_FACTION_PROVINCE", "CAI_BASIC_REGION_GROUP_ANALYSIS"];
  const tables: CaabStringTables = { recordNames: names, utf8ById: new Map(), utf16ById: new Map(), entries: names.map((text,id) => ({ table: "record_name", text, id, offset: 0, length: text.length })) };
  const raw = (...values: number[]): CaabItem => ({ kind: "bytes", data: Buffer.concat(values.map(encodeU32)) });
  function record(name: string, groups: CaabItem[][], isRoot = false): CaabRecordNode { return { kind: "record", name, nameIndex: names.indexOf(name), version: name === "CAI_GARRISONABLE" ? version : 0, flags: isRoot ? 0xa0 : 0xe0, isRoot, hasNestedBlocks: !isRoot, groups, blockSizeWidth: 1, groupCountWidth: 1, groupSizeWidths: groups.map(() => 1) }; }
  const root = record("ROOT", [[
    record("CAI_WORLD_FACTIONS", [[record("OWNED_DIRECT", [[raw(10)]])], [record("OWNED_DIRECT", [[raw(20)]])]]),
    record("CAI_WORLD_SETTLEMENTS", [[record("OWNED_DIRECT", [[raw(10)]]), record("CAI_GARRISONABLE", [[raw(30,31,32,33)]]), record("CAI_SETTLEMENT", [[{ kind: "bytes", data: Buffer.from([0x48,0]) }, raw(10,348), record("OPAQUE", [[raw(10,30)]])]])]]),
  ]], true);
  if (withProvince) root.groups[0].push(record("CAI_FACTION_PROVINCES", [[record("OWNED_DIRECT", [[raw(10)]]),record("CAI_FACTION_PROVINCE", [[raw(10,66851,1008)]])]]));
  if (withRegion) root.groups[0].push(record("CAI_BASIC_REGION_GROUP_ANALYSIS", [[{kind:"bytes",data:Buffer.from([0x57,2,10,0,0x57,2,20,0,0x57,4,10,0,20,0,0x4a,8,0,0,0x80,0x3f,0,0,0,0x40])}]]),raw(123));
  const source = writeCaabBuffer({ header: { codecId: 0xabca, unknown1: 0, creationDate: 0, recordNamesOffset: 0 }, tables, root, source: Buffer.alloc(0) });
  const header = readCaabHeader(source), parsedTables = parseCaabStringTables(source, header.recordNamesOffset);
  return { source, header, tables: parsedTables, root: buildCaabTree(source, header, parsedTables) };
}
function output(f: ReturnType<typeof fixture>) { return writeCaabBuffer({ header:f.header, tables:f.tables, root:f.root, source:f.source }); }
function values(f: ReturnType<typeof fixture>) { const out: Record<string,number[]> = {}; const b = output(f); walkCaabNodes(b,readCaabHeader(b),f.tables,{onValue(v,p){ if(v.kind === "value" && v.type === "u32") (out[p.join('/')] ??= []).push(v.value as number); }}); return out; }

test("both AI settlement owner fields transfer without changing region IDs or nested IDs", () => {
  const f=fixture(); assert.deepEqual(remapCaiSettlementReferences(f.root,f.source,f.header,f.tables,new Map([[10,20]]),new Set()),{ownersRemapped:2,garrisonReferencesCleared:0,regionGroupArraysRemapped:0});
  const v=values(f); assert.deepEqual(v['ROOT/CAI_WORLD_SETTLEMENTS/OWNED_DIRECT'],[20]); assert.deepEqual(v['ROOT/CAI_WORLD_SETTLEMENTS/CAI_SETTLEMENT'],[20,348]); assert.deepEqual(v['ROOT/CAI_WORLD_SETTLEMENTS/CAI_SETTLEMENT/OPAQUE'],[10,30]);
  const b=output(f); validateCaiSettlementOwners(b,readCaabHeader(b),f.tables);
});
test("only removed optional garrison references are cleared", () => {
  const f=fixture(); assert.deepEqual(remapCaiSettlementReferences(f.root,f.source,f.header,f.tables,new Map(),new Set([30,32])),{ownersRemapped:0,garrisonReferencesCleared:2,regionGroupArraysRemapped:0}); assert.deepEqual(values(f)['ROOT/CAI_WORLD_SETTLEMENTS/CAI_GARRISONABLE'],[0,31,0,33]);
});
test("no transfer or removed garrison keeps the entire stream unchanged", () => {
  const f=fixture(); remapCaiSettlementReferences(f.root,f.source,f.header,f.tables,new Map(),new Set()); assert.deepEqual(output(f),f.source);
});
test("AI settlement owner verification rejects missing faction owners", () => {
  const f=fixture(); const factions=f.root.groups[0].find((n):n is CaabRecordNode=>n.kind==='record'&&n.name==='CAI_WORLD_FACTIONS')!; factions.groups.shift(); factions.groupSizeWidths.shift(); const b=output(f); assert.throws(()=>validateCaiSettlementOwners(b,readCaabHeader(b),f.tables),/missing AI faction owner 10/);
});
test("unknown garrison layouts are rejected before mutation", () => {
  const f=fixture(1); assert.throws(()=>remapCaiSettlementReferences(f.root,f.source,f.header,f.tables,new Map(),new Set([30])),/Unsupported CAI_GARRISONABLE version 1/);
});

test("AI province transfer preserves same-number manager IDs and other domains", () => {
 const f=fixture(0,true);
 assert.deepEqual(remapCaiSettlementReferences(f.root,f.source,f.header,f.tables,new Map([[10,20]]),new Set()),{ownersRemapped:3,garrisonReferencesCleared:0,regionGroupArraysRemapped:0});
 const v=values(f);assert.deepEqual(v['ROOT/CAI_FACTION_PROVINCES/OWNED_DIRECT'],[20]);assert.deepEqual(v['ROOT/CAI_FACTION_PROVINCES/CAI_FACTION_PROVINCE'],[10,66851,1008]);
 const b=output(f);validateCaiSettlementOwners(b,readCaabHeader(b),f.tables);
});

test("region-group faction transfers preserve parallel array lengths and weights",()=>{const f=fixture(0,false,true);const report=remapCaiSettlementReferences(f.root,f.source,f.header,f.tables,new Map([[10,20]]),new Set());assert.equal(report.regionGroupArraysRemapped,1);const arrays:string[]=[];const next=output(f);walkCaabNodes(next,readCaabHeader(next),f.tables,{onValue(v,p){if(p[p.length-1]==="CAI_BASIC_REGION_GROUP_ANALYSIS"&&v.kind==="array")arrays.push(v.value.payload.toString("hex"));}});assert.deepEqual(arrays,["0a00","1400","14001400","0000803f00000040"]);validateCaiSettlementOwners(next,readCaabHeader(next),f.tables);});
test("region-group faction arrays reject missing owners independently of settlement owners",()=>{const original=fixture(0,false,true);const factions=original.root.groups[0].find((n):n is CaabRecordNode=>n.kind==="record"&&n.name==="CAI_WORLD_FACTIONS")!;factions.groups.shift();factions.groupSizeWidths.shift();const next=output(original);assert.throws(()=>validateCaiSettlementOwners(next,readCaabHeader(next),original.tables),/Basic region-group references missing AI faction owner 10/);});

test("deleted region-group parents cannot create edits into later surviving spans",()=>{const f=fixture(0,false,true);f.root.groups[0]=f.root.groups[0].filter(n=>n.kind!=="record"||n.name!=="CAI_BASIC_REGION_GROUP_ANALYSIS");const r=remapCaiSettlementReferences(f.root,f.source,f.header,f.tables,new Map([[10,20]]),new Set());assert.equal(r.regionGroupArraysRemapped,0);assert.doesNotThrow(()=>output(f));});
