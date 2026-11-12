import { CaabRecordNode } from "../esf/codecs/caabTree";
import { findRecords } from "./addFaction";
import { readLeadingValues } from "./caiFactionIds";
function treeIds(root: CaabRecordNode, source: Buffer): Set<number> {
 const ids=new Set<number>();
 for(const world of findRecords(root,"CAI_WORLD_TECHNOLOGY_TREES")) for(const node of findRecords(world,"CAI_BDI_COMPONENT")) {
  const id=readLeadingValues(node,source,1)[0]; if(!id||id.signed)throw new Error("AI research-tree component ID missing.");ids.add(id.value);
 }
 return ids;
}
function parentId(group: CaabRecordNode["groups"][number], source: Buffer): number {
 const row=group.find((node):node is CaabRecordNode=>node.kind==="record"&&node.name==="CAI_TECHNOLOGY");
 if(!row||row.version!==0)throw new Error("Unsupported AI technology row.");
 const id=readLeadingValues(row,source,1)[0];if(!id||id.signed||id.value===0)throw new Error("AI technology research-tree ID missing.");return id.value;
}
/** CAI_TECHNOLOGY v0 first u32 resolves to its owning research-tree BDI component. */
export function removeOrphanCaiTechnologies(root: CaabRecordNode, source: Buffer): number {
 const live=treeIds(root,source);let removed=0;
 for(const world of findRecords(root,"CAI_WORLD_TECHNOLOGIES")) {
  const groups=[],widths=[];
  for(let i=0;i<world.groups.length;i++) {
   const group=world.groups[i];if(!live.has(parentId(group,source))){removed++;continue;}groups.push(group);widths.push(world.groupSizeWidths[i]);
  }
  world.groups=groups;world.groupSizeWidths=widths;
 }
 return removed;
}
export function validateCaiTechnologyTrees(root: CaabRecordNode, source: Buffer): void {
 const live=treeIds(root,source);
 for(const world of findRecords(root,"CAI_WORLD_TECHNOLOGIES"))for(const group of world.groups){const id=parentId(group,source);if(!live.has(id))throw new Error(`AI technology references missing research tree ${id}.`);}
}
