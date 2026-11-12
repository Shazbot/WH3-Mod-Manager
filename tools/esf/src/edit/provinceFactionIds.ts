import { CaabRecordInfo, CaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { CaabRecordNode, replaceByteRanges } from "../esf/codecs/caabTree";
import { encodeU32 } from "./addFaction";
import { groupRanges, groupIndexForOffset } from "./factionIdSpans";

export interface ProvinceFactionOwnerSpan { provinceId: number; provinceStart: number; recordName: string; rowIndex: number; ownerId: number; start: number; end: number; }

/** Numeric owner fields verified against land/sea territory readers. The provinceId label also identifies sea regions for FACTION_SEA_REGION_MANAGER rows. */
export function collectProvinceFactionOwners(source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables): ProvinceFactionOwnerSpan[] {
  const rows: ProvinceFactionOwnerSpan[] = [];
  let province: { id?: number; start: number; kind: string } | undefined;
  const frames: { record: CaabRecordInfo; manager: boolean; depth: number; provinceId: number; provinceStart: number; scalar: number; seen: Set<number>; ranges: { start: number; end: number }[] }[] = [];
  walkCaabNodes(source, header, tables, {
    onRecordStart(r, parent) {
      if (r.name === "PROVINCE" || r.name === "SEA_REGION") province = { start: r.startOffset, kind: r.name };
      const landManager = r.name === "FACTION_PROVINCE_MANAGER" && parent[parent.length - 1] === "FACTION_PROVINCE_MANAGER_ARRAY";
      const seaManager = r.name === "FACTION_SEA_REGION_MANAGER" && parent[parent.length - 1] === "FACTION_SEA_REGION_MANAGER_BLOCK";
      const manager = landManager || seaManager;
      const keyed = ["RECRUITMENT_MANAGER", "FACTION_PROVINCE_PERSISTENT_POOLED_RESOURCE_MANAGER"].includes(r.name) && parent[parent.length - 1] === "PROVINCE";
      if (!manager && !keyed) return;
      if (r.version !== (landManager ? 1 : 0)) throw new Error(`Unsupported ${r.name} version ${r.version} for owner remapping.`);
      if (province?.id === undefined) throw new Error("Province ID missing before its faction managers.");
      frames.push({ record: r, manager, depth: parent.length + 1, provinceId: province.id, provinceStart: province.start, scalar: 0, seen: new Set(), ranges: groupRanges(r, source) });
    },
    onValue(v, stack) {
      if (v.kind !== "value") return;
      if (province && province.id === undefined && stack[stack.length - 1] === province.kind) {
        if (v.type !== "u32" || typeof v.value !== "number") throw new Error("PROVINCE ID must be a u32.");
        province.id = v.value;
      }
      const f = frames[frames.length - 1];
      if (!f || stack.length !== f.depth || stack[stack.length - 1] !== f.record.name) return;
      let rowIndex: number;
      if (f.manager) { if (f.scalar++ !== 1) return; rowIndex = 0; }
      else { rowIndex = groupIndexForOffset(f.ranges, v.startOffset!); if (rowIndex < 0 || f.seen.has(rowIndex)) return; }
      if (v.type !== "u32" || typeof v.value !== "number" || v.startOffset === undefined || v.endOffset === undefined) throw new Error(`${f.record.name} faction owner must be a u32.`);
      f.seen.add(rowIndex);
      rows.push({ provinceId: f.provinceId, provinceStart: f.provinceStart, recordName: f.record.name, rowIndex, ownerId: v.value, start: v.startOffset, end: v.endOffset });
    },
    onRecordEnd(r) {
      const f = frames[frames.length - 1];
      if (f?.record.startOffset === r.startOffset) {
        const expected = f.manager ? 1 : f.ranges.length;
        if (f.seen.size !== expected) throw new Error(`${f.record.name} is missing a faction owner field.`);
        frames.pop();
      }
      if (r.startOffset === province?.start) province = undefined;
    },
  });
  return rows;
}

export function remapProvinceFactionOwners(root: CaabRecordNode, source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables, mapping: ReadonlyMap<number, number>, transfers: ReadonlyMap<number, number> = new Map()): number {
  const seen = new Set<string>();
  const edits = collectProvinceFactionOwners(source, header, tables).flatMap(row => {
    if (row.ownerId === 0) return [];
    const recipient = transfers.get(row.ownerId) ?? row.ownerId, next = mapping.get(recipient);
    if (next === undefined) throw new Error(`${row.recordName} in province ${row.provinceId} needs a surviving recipient for faction ${row.ownerId}.`);
    const key = `${row.provinceStart}/${row.recordName}/${next}`;
    if (seen.has(key)) throw new Error(`Province ${row.provinceId} would have duplicate ${row.recordName} entries for faction ${next}.`);
    seen.add(key);
    return next === row.ownerId ? [] : [{ start: row.start, end: row.end, data: encodeU32(next) }];
  });
  return replaceByteRanges(root, edits);
}
