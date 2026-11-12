import { CaabRecordNode } from "../esf/codecs/caabTree";
import { decodeU32, encodeU32, findRecords } from "./addFaction";

/** Explicit sparse tables whose leading u32 is a campaign faction ID.
 * Native reader evidence and input identity audits live in startpos_all_mixer_factions.
 * Counts, object IDs and opaque nested payloads are not faction IDs.
 */
export const FACTION_KEYED_ROW_VERSIONS: Readonly<Record<string, number>> = {
  FACTION_CHARACTER_TAGS: 0,
  FACTION_STRATEGIC_THREAT_SCORE_PER_FACTION: 0,
  FACTION_COOKING_INFO: 3,
  FACTION_POOLED_RESOURCE_THRESHOLD_OPERATION_SETS: 0,
  FACTION_POOLED_RESOURCE_CONSTRAINT_EFFECTS: 0,
  FACTION_UNIT_LIST_ALLOWANCE_INFO: 0,
  FACTION_PROVINCE_GOVERNORSHIP_DATA: 0,
  FACTION_PLAGUE_COMPOSITION_DATA: 0,
  FACTION_AGENT_PLAGUE_DATA: 0,
  FACTION_PRISON: 0,
  FACTION_TRESPASS_PERMISSIONS: 0,
};
export function remapFactionKeyedRows(root: CaabRecordNode, source: Buffer, mapping: ReadonlyMap<number, number>, removedIds: ReadonlySet<number>) {
  let removed = 0, remapped = 0;
  for (const [name, version] of Object.entries(FACTION_KEYED_ROW_VERSIONS)) for (const node of findRecords(root, name)) {
    if (node.version !== version) throw new Error(`Unsupported ${name} version ${node.version}.`);
    const groups = [], widths = [], seen = new Set<number>();
    for (let i = 0; i < node.groups.length; i++) {
      const group = node.groups[i], ownerIndex = group.findIndex(item => item.kind === "raw" || item.kind === "bytes"), first = group[ownerIndex];
      if (!first || (first.kind !== "raw" && first.kind !== "bytes")) throw new Error(`${name} row has no leading faction ID.`);
      const data = first.kind === "raw" ? source.subarray(first.start, first.end) : first.data, old = decodeU32(data, 0);
      if (seen.has(old.value)) throw new Error(`Duplicate faction-keyed row owner ${old.value} in ${name}.`);
      seen.add(old.value);
      if (removedIds.has(old.value)) { removed++; continue; }
      const next = mapping.get(old.value);
      if (next === undefined) throw new Error(`Unknown faction-keyed row owner ${old.value} in ${name}.`);
      if (next !== old.value) { group[ownerIndex] = { kind: "bytes", data: Buffer.concat([encodeU32(next), data.subarray(old.width)]) }; remapped++; }
      groups.push(group); widths.push(node.groupSizeWidths[i]);
    }
    node.groups = groups; node.groupSizeWidths = widths;
  }
  return { removed, remapped };
}

export function validateFactionKeyedRows(root: CaabRecordNode, source: Buffer, maximumFactionId: number): void {
  for (const [name, version] of Object.entries(FACTION_KEYED_ROW_VERSIONS)) for (const node of findRecords(root, name)) {
    if (node.version !== version) throw new Error(`Unsupported ${name} version ${node.version}.`);
    const seen = new Set<number>();
    for (const group of node.groups) {
      const first = group.find(item => item.kind === "raw" || item.kind === "bytes");
      if (!first || (first.kind !== "raw" && first.kind !== "bytes")) throw new Error(`${name} owner missing.`);
      const id = decodeU32(first.kind === "raw" ? source : first.data, first.kind === "raw" ? first.start : 0).value;
      if (id < 1 || id > maximumFactionId || seen.has(id)) throw new Error(`Invalid faction-keyed row owner ${id} in ${name}.`);
      seen.add(id);
    }
  }
}
