import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabRecordNode, CaabItem } from "../esf/codecs/caabTree";
import { encodeU32 } from "./addFaction";
import { removeCaiMilitaryForceSlots, validateCaiMilitaryForceSlots } from "./caiMilitaryForceSlots";
function fixture() {
 const chunks:Buffer[]=[];let offset=0;
 function raw(...values:number[]):CaabItem {const data=Buffer.concat(values.map(encodeU32)),start=offset;offset+=data.length;chunks.push(data);return {kind:"raw",start,end:offset};}
 function rec(name:string,groups:CaabItem[][]):CaabRecordNode{return {kind:"record",name,nameIndex:0,version:0,flags:0xe0,isRoot:false,hasNestedBlocks:true,groups,groupSizeWidths:groups.map((_,i)=>i+1),blockSizeWidth:1,groupCountWidth:1};}
 const rows=[[595,0,0],[0,595,0],[0,596,0],[0,0,595]].map(ids=>[rec("CAI_BUILDING_SLOT",[[raw(...ids)]])]);
 const world=rec("CAI_WORLD_BUILDING_SLOTS",rows),live=rec("MILITARY_FORCE_SLOT",[[raw(596)]]),root=rec("ROOT",[[world,live]]);
 return {root,world,rows,source:Buffer.concat(chunks)};
}
test("military-force slot deletion preserves colliding IDs in other slot domains",()=>{const f=fixture();assert.equal(removeCaiMilitaryForceSlots(f.root,f.source,new Set([595])),1);assert.deepEqual(f.world.groups,[f.rows[0],f.rows[2],f.rows[3]]);assert.deepEqual(f.world.groupSizeWidths,[1,3,4]);validateCaiMilitaryForceSlots(f.root,f.source);});
test("missing military-force slot references fail output validation",()=>{const f=fixture();assert.throws(()=>validateCaiMilitaryForceSlots(f.root,f.source),/missing military-force slot 595/);});
test("no removed military-force slots keeps every original row",()=>{const f=fixture();assert.equal(removeCaiMilitaryForceSlots(f.root,f.source,new Set()),0);assert.deepEqual(f.world.groups,f.rows);assert.deepEqual(f.world.groupSizeWidths,[1,2,3,4]);});
test("unknown AI building-slot versions are rejected",()=>{const f=fixture();(f.rows[0][0] as CaabRecordNode).version=1;assert.throws(()=>removeCaiMilitaryForceSlots(f.root,f.source,new Set([595])),/Unsupported AI building-slot row/);});
