import { CaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { CaabRecordNode, replaceByteRanges } from "../esf/codecs/caabTree";
import { encodeU32 } from "./addFaction";

export interface RegionFactionOwnerSpan { regionId: number; regionKey: string | null; ownerId: number; start: number; end: number; }

/** REGION v3 stores its numeric owner as direct scalar 4 (after id, key, 0, 0). */
export function collectRegionFactionOwners(source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables): RegionFactionOwnerSpan[] {
  const rows: RegionFactionOwnerSpan[] = [];
  let region: { scalar: number; id?: number; key?: string | null; owner?: RegionFactionOwnerSpan } | undefined;
  walkCaabNodes(source, header, tables, {
    onRecordStart(r, parent) {
      if (r.name !== "REGION" || parent[parent.length - 1] !== "REGIONS_ARRAY") return;
      if (r.version !== 3) throw new Error(`Unsupported REGION version ${r.version} for numeric-owner remapping.`);
      region = { scalar: 0 };
    },
    onValue(v, stack) {
      if (!region || stack[stack.length - 1] !== "REGION" || v.kind !== "value") return;
      if (region.scalar === 0) { if (v.type !== "u32" || typeof v.value !== "number") throw new Error("REGION ID missing."); region.id = v.value; }
      if (region.scalar === 1) { if (v.type !== "ascii") throw new Error("REGION key missing."); region.key = (v.value as { text: string | null }).text; }
      if (region.scalar === 4) {
        if (v.type !== "u32" || typeof v.value !== "number" || v.startOffset === undefined || v.endOffset === undefined || region.id === undefined) throw new Error("REGION numeric owner missing.");
        region.owner = { regionId: region.id, regionKey: region.key ?? null, ownerId: v.value, start: v.startOffset, end: v.endOffset };
      }
      region.scalar++;
    },
    onRecordEnd(r, parent) {
      if (r.name !== "REGION" || parent[parent.length - 1] !== "REGIONS_ARRAY" || !region) return;
      if (!region.owner) throw new Error("REGION has no numeric owner field.");
      rows.push(region.owner); region = undefined;
    },
  });
  return rows;
}

export function remapRegionFactionOwners(root: CaabRecordNode, source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables, remapping: ReadonlyMap<number, number>, transfers: ReadonlyMap<number, number> = new Map()): number {
  const edits = collectRegionFactionOwners(source, header, tables).flatMap(row => {
    if (row.ownerId === 0) return [];
    const recipient = transfers.get(row.ownerId) ?? row.ownerId;
    const next = remapping.get(recipient);
    if (next === undefined) throw new Error(`REGION ${row.regionKey ?? row.regionId} needs a surviving recipient for owner faction ID ${row.ownerId}.`);
    return next === row.ownerId ? [] : [{ start: row.start, end: row.end, data: encodeU32(next) }];
  });
  return replaceByteRanges(root, edits);
}
