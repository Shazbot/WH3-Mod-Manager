import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem,CaabRecordNode } from "../esf/codecs/caabTree";
import { encodeU32 } from "./addFaction";
import { removeOrphanCaiTechnologies,validateCaiTechnologyTrees } from "./caiTechnologies";
function fixture(allLive=false){const chunks:Buffer[]=[];let offset=0;
 function raw(id:number):CaabItem{const data=encodeU32(id),start=offset;offset+=data.length;chunks.push(data);return{kind:"raw",start,end:offset};}
 function record(name:string,groups:CaabItem[][]):CaabRecordNode{return{kind:"record",name,nameIndex:0,version:0,flags:0xe0,isRoot:false,hasNestedBlocks:true,groups,groupSizeWidths:groups.map((_,i)=>i+1),blockSizeWidth:1,groupCountWidth:1};}
 const rows=[100,200,100].map(id=>[record("CAI_TECHNOLOGY",[[raw(id)]])]);
 const world=record("CAI_WORLD_TECHNOLOGIES",rows),trees=record("CAI_WORLD_TECHNOLOGY_TREES",[[record("CAI_BDI_COMPONENT",[[raw(100)]])]]);if(allLive)trees.groups.push([record("CAI_BDI_COMPONENT",[[raw(200)]])]);
 const root=record("ROOT",[[world,trees]]);return{root,world,rows,source:Buffer.concat(chunks)};
}
test("orphan research rows are removed with matching group metadata",()=>{const f=fixture();assert.equal(removeOrphanCaiTechnologies(f.root,f.source),1);assert.deepEqual(f.world.groups,[f.rows[0],f.rows[2]]);assert.deepEqual(f.world.groupSizeWidths,[1,3]);validateCaiTechnologyTrees(f.root,f.source);});
test("remaining technologies cannot reference missing research trees",()=>{const f=fixture();assert.throws(()=>validateCaiTechnologyTrees(f.root,f.source),/missing research tree 200/);});
test("live research rows stay unchanged",()=>{const f=fixture(true);assert.equal(removeOrphanCaiTechnologies(f.root,f.source),0);assert.deepEqual(f.world.groups,f.rows);assert.deepEqual(f.world.groupSizeWidths,[1,2,3]);});
test("unknown technology layouts are rejected",()=>{const f=fixture();(f.rows[0][0] as CaabRecordNode).version=1;assert.throws(()=>removeOrphanCaiTechnologies(f.root,f.source),/Unsupported AI technology row/);});
