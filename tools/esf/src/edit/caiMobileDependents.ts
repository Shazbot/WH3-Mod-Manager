import { CaabItem, CaabRecordNode, replaceByteRanges } from "../esf/codecs/caabTree";
import { decodeU32, encodeU32, findFirstRecord, findRecords } from "./addFaction";
import { readLeadingValues } from "./caiFactionIds";

/** Remove beliefs and both maps belonging to mobiles removed from CAI_WORLD. */
export function removeCaiMobileDependents(root: CaabRecordNode, source: Buffer, removedMobileIds: ReadonlySet<number>) {
  let beliefsRemoved = 0;
  for (const pool of findRecords(root, "CAI_BDI_POOL_BELIEFS")) {
    for (let i = pool.groups.length - 1; i >= 0; i--) {
      const analysis = pool.groups[i].find((n): n is CaabRecordNode => n.kind === "record" && n.name === "CAI_RESOURCE_MOBILE_MILITARY_STRENGTH_ANALYSIS");
      const id = analysis && readLeadingValues(analysis, source, 1)[0]?.value;
      if (id === undefined || !removedMobileIds.has(id)) continue;
      pool.groups.splice(i, 1); pool.groupSizeWidths.splice(i, 1); beliefsRemoved++;
    }
  }
  if (!removedMobileIds.size) return { beliefsRemoved, mapsRemoved: 0 };
  const manager = findFirstRecord(root, "CAI_INFLUENCE_MAP_MANAGER");
  if (!manager?.groups[0]) throw new Error("Missing resource influence-map group.");
  const group = manager.groups[0];
  const rows: { basic: CaabRecordNode; extended: CaabRecordNode; values: { start: number; end: number; value: number }[] }[] = [];
  for (let i = 0; i < group.length; i++) {
    const basic = group[i];
    if (basic.kind !== "record" || basic.name !== "CAI_RESOURCE_INFLUENCE_MAP") continue;
    const raw = group[i - 1], extended = group[i + 1];
    if (raw?.kind !== "raw" || extended?.kind !== "record" || extended.name !== "CAI_EXTENDED_RESOURCE_INFLUENCE_MAP") {
      throw new Error("Resource influence-map key/basic/extended triplet is malformed.");
    }
    const values = [];
    for (let at = raw.start; at < raw.end;) {
      const value = decodeU32(source, at), end = at + value.width;
      if (end > raw.end) throw new Error("Resource influence-map key exceeds raw span.");
      values.push({ start: at, end, value: value.value }); at = end;
    }
    rows.push({ basic, extended, values });
  }
  const first = rows[0]?.values, count = first?.[first.length - 2];
  if (!count || count.value !== rows.length) throw new Error("Resource influence-map count does not match its triplets.");
  const matches = rows.filter(row => removedMobileIds.has(row.values[row.values.length - 1].value));
  if (!matches.length) return { beliefsRemoved, mapsRemoved: 0 };
  const replacements = [{ start: count.start, end: count.end, data: encodeU32(count.value - matches.length) },
    ...matches.map(row => { const key = row.values[row.values.length - 1]; return { start: key.start, end: key.end, data: Buffer.alloc(0) }; })];
  if (replaceByteRanges(manager, replacements) !== replacements.length) throw new Error("Could not rewrite resource influence-map keys and count.");
  const removed = new Set<CaabItem>(matches.flatMap(row => [row.basic, row.extended]));
  for (let i = group.length - 1; i >= 0; i--) if (removed.has(group[i])) group.splice(i, 1);
  return { beliefsRemoved, mapsRemoved: matches.length };
}
