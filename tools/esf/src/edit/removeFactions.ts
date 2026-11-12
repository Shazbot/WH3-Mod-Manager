import { CaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { CaabItem, CaabRecordNode, replaceByteRanges } from "../esf/codecs/caabTree";
import { FACTION_ID_BASE, FACTION_INDEXED_RECORDS, FACTION_INDEXED_EXTRA_ROW_ORDER, decodeU32, encodeAscii, encodeU32, findFirstRecord, findRecords, relationshipGroupId, validateFactionIdPermutation } from "./addFaction";
import { collectCaiFactionIdSpans, readLeadingValues } from "./caiFactionIds";
import { collectFactionArrayIdSpans, collectIndexedFactionIdSpans } from "./factionIdSpans";
import { collectFactionKeys, pairOf, rewriteLeadingU32, rewritePairIds, itemReferencesKey, collectCaiBdiComponentIds, firstU32InGroup, firstU32InRecord, groupHasRetainedBdiComponent, CAI_FACTION_BELIEF_ID_SLOTS, readFactionBeliefValues } from "./removeFaction";
import { removeOrphanCaiTechnologies } from "./caiTechnologies";
import { removeCaiMilitaryForceSlots } from "./caiMilitaryForceSlots";
import { remapCaiSettlementReferences } from "./caiSettlementReferences";
import { remapFactionKeyedRows } from "./factionKeyedRows";
import { remapProvinceFactionOwners } from "./provinceFactionIds";
import { remapRegionFactionOwners } from "./regionFactionIds";
import { removeCaiMobileDependents } from "./caiMobileDependents";
import { removeCaiMobileReferences, removeCaiDependentReferenceArrays } from "./caiMobileReferences";

/** Faction key held by a region-ownership value (region owner or preview ownership), if `v` is one. Shared with the collector so removal and detection cannot drift. */
export function regionReferencedFactionKey(v: { kind: string; type?: string; value?: unknown }, stack: readonly string[]): string | undefined {
  const regionReference = ["REGION", "BUILDING_BASE"].includes(stack[stack.length - 1]) && stack.includes("REGIONS_ARRAY");
  const previewOwnership = stack[stack.length - 1] === "REGION_OWNERSHIPS" && stack.includes("REGION_OWNERSHIPS_BY_THEATRE");
  if (v.kind !== "value" || v.type !== "ascii" || !(regionReference || previewOwnership)) return undefined;
  return (v.value as { text?: string }).text || undefined;
}

export function filterFactionGroups(node: CaabRecordNode, remove: (group: CaabItem[], index: number) => boolean): number {
  const groups: CaabItem[][] = [], widths: number[] = []; let removed = 0;
  node.groups.forEach((group, index) => {
    if (remove(group, index)) removed++;
    else { groups.push(group); widths.push(node.groupSizeWidths[index]); }
  });
  node.groups = groups; node.groupSizeWidths = widths;
  return removed;
}

/** Compact original campaign IDs once, keeping the special id-1 participant. */
export function factionIdRemapping(count: number, removedIndices: ReadonlySet<number>): Map<number, number> {
  const result = new Map<number, number>([[1, 1]]); let next = FACTION_ID_BASE;
  for (let i = 0; i < count; i++) if (!removedIndices.has(i)) result.set(i + FACTION_ID_BASE, next++);
  return result;
}

function removeHistoricalMaps(root: CaabRecordNode, source: Buffer, ids: ReadonlySet<number>): number {
  const manager = findFirstRecord(root, "CAI_INFLUENCE_MAP_MANAGER");
  if (!manager?.groups[0]) throw new Error("Influence-map manager missing.");
  const group = manager.groups[0];
  const rows = group.flatMap((item, index) => {
    if (item.kind !== "record" || item.name !== "CAI_HISTORICAL_INFLUENCE_MAP") return [];
    const raw = group[index - 1]; if (raw?.kind !== "raw") throw new Error("Historical key missing.");
    const values = [];
    for (let at = raw.start; at < raw.end;) { const v = decodeU32(source, at), end = at + v.width; if (end > raw.end) throw new Error("Invalid historical key span."); values.push({ value: v.value, start: at, end }); at = end; }
    return [{ record: item, values }];
  });
  const prefix = rows[0]?.values, count = prefix?.[prefix.length - 2];
  if (!count || count.value !== rows.length) throw new Error("Historical count mismatch.");
  const matches = rows.filter(row => ids.has(row.values[row.values.length - 1].value));
  if (matches.length !== ids.size) throw new Error(`Expected ${ids.size} historical maps, got ${matches.length}.`);
  const replacements = [{ start: count.start, end: count.end, data: encodeU32(count.value - matches.length) }, ...matches.map(row => { const k = row.values[row.values.length - 1]; return { start: k.start, end: k.end, data: Buffer.alloc(0) }; })];
  if (replaceByteRanges(manager, replacements) !== replacements.length) throw new Error("Historical map rewrite failed.");
  const removed = new Set<CaabItem>(matches.map(row => row.record));
  manager.groups[0] = group.filter(item => !removed.has(item));
  return matches.length;
}

/** The same cleanup as single removal, with one ID map and shared source scans. */
export function removeFactions(source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables, root: CaabRecordNode, factionKeys: readonly string[], transfers: Readonly<Record<string, string>> = {}) {
  const requested = new Set(factionKeys), keys = collectFactionKeys(root, source, tables), before = keys.length;
  const removedIndices = new Set(keys.flatMap((key, i) => requested.has(key) ? [i] : []));
  const removedKeys = keys.filter((_, i) => removedIndices.has(i));
  if (!removedIndices.size) throw new Error("None of the requested factions are present.");
  const remap = factionIdRemapping(before, removedIndices), removedIds = new Set([...removedIndices].map(i => i + FACTION_ID_BASE));
  const wanted = new Set(removedKeys), stringIds = new Set([...tables.utf8ById].filter(([, key]) => wanted.has(key)).map(([id]) => id));
  const all = new Map<string, CaabRecordNode[]>();
  function index(node: CaabRecordNode) { const a = all.get(node.name) ?? []; a.push(node); all.set(node.name, a); for (const g of node.groups) for (const n of g) if (n.kind === "record") index(n); }
  index(root);
  const nodes = (name: string) => all.get(name) ?? [];
  const one = (name: string) => { const n = nodes(name)[0]; if (!n) throw new Error(`${name} missing.`); return n; };
  const factions = one("FACTION_ARRAY"), world = one("CAI_WORLD_FACTIONS"), componentIdsBefore = collectCaiBdiComponentIds(root, source);
  const caiOwners = new Set<number>();
  for (const i of removedIndices) { const id = firstU32InRecord(world.groups[i], "OWNED_DIRECT", source); if (id === undefined) throw new Error(`CAI faction owner missing at ${i}.`); caiOwners.add(id); }
  if (caiOwners.size !== removedIndices.size) throw new Error("Duplicate CAI faction owners.");
  const caiOwnerTransfers = new Map<number, number>();
  for (const [from, to] of Object.entries(transfers)) {
    const oldIndex = keys.indexOf(from), recipientIndex = keys.indexOf(to);
    if (oldIndex < 0 || recipientIndex < 0 || wanted.has(to)) throw new Error(`Invalid AI owner transfer ${from} -> ${to}.`);
    const owner = firstU32InRecord(world.groups[oldIndex], "OWNED_DIRECT", source), recipient = firstU32InRecord(world.groups[recipientIndex], "OWNED_DIRECT", source);
    if (owner === undefined || recipient === undefined) throw new Error("AI owner transfer key missing.");
    caiOwnerTransfers.set(owner, recipient);
  }
  const characters = new Set<number>(), forces = new Set<number>(), units = new Set<number>(), militaryForceSlots = new Set<number>();
  for (const i of removedIndices) for (const item of factions.groups[i]) if (item.kind === "record") {
    for (const n of findRecords(item, "CHARACTER")) { const id = readLeadingValues(n, source, 1)[0]?.value; if (id !== undefined) characters.add(id); }
    for (const n of findRecords(item, "MILITARY_FORCE")) { const id = readLeadingValues(n, source, 1)[0]?.value; if (id !== undefined) forces.add(id); }
    for (const n of findRecords(item, "MILITARY_FORCE_SLOT")) { const id = readLeadingValues(n, source, 1)[0]?.value; if (id !== undefined) militaryForceSlots.add(id); }
    for (const n of findRecords(item, "UNIT")) { const id = readLeadingValues(n, source, 1)[0]?.value; if (id !== undefined) units.add(id); }
  }
  const mobileKeys = new Set<number>();
  let mobile: { key?: number; force?: number; scalar: number } | undefined;
  const regionReplacements: { start: number; end: number; data: Buffer }[] = [];
  walkCaabNodes(source, header, tables, {
    onRecordStart(r, s) { if (r.name === "CAI_RESOURCE_MOBILE" && s[s.length - 1] === "CAI_WORLD_RESOURCE_MOBILES") mobile = { scalar: 0 }; },
    onValue(v, s) {
      if (mobile && s[s.length - 1] === "CAI_RESOURCE_MOBILE" && v.kind === "value") {
        if (v.type === "u32" && typeof v.value === "number") { if (mobile.scalar === 0) mobile.key = v.value; if (mobile.scalar === 9) mobile.force = v.value; } mobile.scalar++;
      }
      const key = regionReferencedFactionKey(v, s);
      if (!key || !wanted.has(key)) return;
      const transfer = transfers[key];
      if (!transfer || !keys.includes(transfer) || wanted.has(transfer)) throw new Error(`Region of ${key} requires a surviving transfer recipient.`);
      const id = [...tables.utf8ById].find(([, text]) => text === transfer)?.[0];
      if (id === undefined) throw new Error(`Transfer key ${transfer} missing from string table.`);
      regionReplacements.push({ start: v.startOffset!, end: v.endOffset!, data: encodeAscii(id) });
    },
    onRecordEnd(r) { if (r.name === "CAI_RESOURCE_MOBILE" && mobile) { if (mobile.force !== undefined && forces.has(mobile.force) && mobile.key !== undefined) mobileKeys.add(mobile.key); mobile = undefined; } },
  });
  if (regionReplacements.length) replaceByteRanges(root, regionReplacements);
  const ownerTransfers = new Map<number, number>();
  for (const [from, to] of Object.entries(transfers)) {
    const oldIndex = keys.indexOf(from), recipientIndex = keys.indexOf(to);
    if (oldIndex < 0 || recipientIndex < 0 || wanted.has(to)) throw new Error(`Invalid region transfer ${from} -> ${to}.`);
    ownerTransfers.set(oldIndex + FACTION_ID_BASE, recipientIndex + FACTION_ID_BASE);
  }
  const regionOwnerIdsRemapped = remapRegionFactionOwners(root, source, header, tables, remap, ownerTransfers);
  const provinceOwnerIdsRemapped = remapProvinceFactionOwners(root, source, header, tables, remap, ownerTransfers);
  const factionKeyedRows = remapFactionKeyedRows(root, source, remap, removedIds);
  const body = (group: CaabItem[], name: string) => group.find((n): n is CaabRecordNode => n.kind === "record" && n.name === name);
  const worldCharacters = one("CAI_WORLD_CHARACTERS"), worldUnits = one("CAI_WORLD_UNITS"), mobiles = one("CAI_WORLD_RESOURCE_MOBILES");
  const charactersRemoved = filterFactionGroups(worldCharacters, g => { const n = body(g, "CAI_CHARACTER"); return !!n && characters.has(readLeadingValues(n, source, 4)[3]?.value); });
  const retained = new Set<number>();
  for (const [container, name, idSlot, deleted] of [[worldCharacters, "CAI_CHARACTER", -1, new Set<number>()], [worldUnits, "CAI_UNIT", 1, units], [mobiles, "CAI_RESOURCE_MOBILE", 0, mobileKeys]] as const) {
    for (const g of container.groups) { const n = body(g, name); if (!n) continue; const values = readLeadingValues(n, source, 32); if (idSlot >= 0 && deleted.has(values[idSlot]?.value)) continue; for (const v of values) if (!v.signed && v.value > 0) retained.add(v.value); }
  }
  const mobileBefore = collectCaiBdiComponentIds(mobiles, source);
  const mobilesRemoved = filterFactionGroups(mobiles, g => { const n = body(g, "CAI_RESOURCE_MOBILE"); return !!n && mobileKeys.has(readLeadingValues(n, source, 1)[0]?.value) && !groupHasRetainedBdiComponent(g, source, retained); });
  const unitsRemoved = filterFactionGroups(worldUnits, g => { const n = body(g, "CAI_UNIT"); return !!n && units.has(readLeadingValues(n, source, 2)[1]?.value) && !groupHasRetainedBdiComponent(g, source, retained); });
  const postsRemoved = filterFactionGroups(one("CAI_CHARACTER_POSTS"), g => caiOwners.has(firstU32InRecord(g, "OWNED_DIRECT", source)!));
  const mobileAfter = collectCaiBdiComponentIds(mobiles, source), removedMobiles = new Set([...mobileBefore].filter(id => !mobileAfter.has(id)));
  const mobileDependents = removeCaiMobileDependents(root, source, removedMobiles);
  const explicit = [...collectFactionArrayIdSpans(source, header, tables, before), ...collectIndexedFactionIdSpans(source, header, tables, before), ...collectCaiFactionIdSpans(source, header, tables).map(s => ({ ...s, recordName: "CAI_FACTION" }))];
  let relationshipsRemoved = 0;
  factions.groups.forEach((g, i) => { if (removedIndices.has(i)) return; const n = g.find((x): x is CaabRecordNode => x.kind === "record"); if (!n) throw new Error("Faction row missing."); const rel = findFirstRecord(n, "OLD_DIPLOMACY_RELATIONSHIP"); if (!rel) throw new Error("Diplomacy row missing."); relationshipsRemoved += filterFactionGroups(rel, row => removedIds.has(relationshipGroupId(row, source))); for (const row of rel.groups) { const id = relationshipGroupId(row, source), next = remap.get(id); if (next === undefined) throw new Error(`Unknown relationship faction ${id}.`); if (next !== id) rewriteLeadingU32(row, source, next); } });
  const pairwise = findFirstRecord(one("DIPLOMACY_MANAGER"), "DIPLOMACY_RELATIONSHIP")!;
  const pairsRemoved = filterFactionGroups(pairwise, g => { const p = pairOf(g, source); if (!p) throw new Error("Pair missing."); return removedIds.has(p.a) || removedIds.has(p.b); });
  for (const g of pairwise.groups) { const p = pairOf(g, source)!; const a = remap.get(p.a), b = remap.get(p.b); if (a === undefined || b === undefined) throw new Error("Unknown pair faction ID."); if (a !== p.a || b !== p.b) rewritePairIds(g, source, a, b); }
  const indexedLists: Record<string, number> = {};
  for (const name of FACTION_INDEXED_RECORDS) {
    if (name === "CAI_FACTION_STRATEGIC_STANCE" || name === "CAI_BDI_COMPONENT_BLOCK_OWNS") continue;
    for (const n of nodes(name)) if (n.groups.length === before || n.groups.length === before + 1) {
      const leading = n.groups.length === before + 1 && FACTION_INDEXED_EXTRA_ROW_ORDER[name] === "leading";
      filterFactionGroups(n, (_, i) => removedIndices.has(i - (leading ? 1 : 0))); indexedLists[name] = (indexedLists[name] ?? 0) + 1;
    }
  }
  let stancesRemoved = 0;
  for (const n of nodes("CAI_FACTION_STRATEGIC_STANCE")) stancesRemoved += filterFactionGroups(n, g => caiOwners.has(firstU32InGroup(g, source)!));
  // Dormant/dummy factions have world rows but no interface manager.
  const interfaceManagers = one("CAI_INTERFACE_MANAGERS");
  const managerOwners = interfaceManagers.groups.map(g => firstU32InRecord(g, "CAI_FACTION_MANAGER", source));
  if (managerOwners.some(id => id === undefined) || new Set(managerOwners).size !== managerOwners.length) throw new Error("Invalid or duplicate AI manager owner key.");
  const existingManagerOwners = new Set(managerOwners);
  const inactiveTargetsWithoutManager = [...caiOwners].filter(id => !existingManagerOwners.has(id));
  const managersRemoved = filterFactionGroups(interfaceManagers, g => caiOwners.has(firstU32InRecord(g, "CAI_FACTION_MANAGER", source)!));
  const trade = nodes("INTERNATIONAL_TRADE_ROUTES")[0];
  if (trade) { const ids = validateFactionIdPermutation(trade.groups, source, "INTERNATIONAL_TRADE_ROUTES", before); filterFactionGroups(trade, (_, i) => removedIds.has(ids[i])); for (const g of trade.groups) { const id = firstU32InGroup(g, source)!, next = remap.get(id)!; if (id !== next) rewriteLeadingU32(g, source, next); } }
  const replacements = explicit.filter(s => !removedIds.has(s.value) && remap.get(s.value) !== s.value).map(s => { const id = remap.get(s.value); if (id === undefined) throw new Error(`Unknown faction ID ${s.value}.`); return { start: s.start, end: s.end, data: encodeU32(id) }; });
  replaceByteRanges(root, replacements);
  const historicalMapsRemoved = removeHistoricalMaps(root, source, caiOwners);
  let beliefsRemoved = 0;
  for (const pool of nodes("CAI_BDI_POOL_BELIEFS")) beliefsRemoved += filterFactionGroups(pool, g => {
    const match = g.some(n => { if (n.kind !== "record") return false; const slots = CAI_FACTION_BELIEF_ID_SLOTS[n.name]; if (!slots) return false; const vals = readFactionBeliefValues(n, source, Math.max(...slots) + 1); return slots.some(slot => !vals[slot]?.signed && caiOwners.has(vals[slot]?.value)); });
    return match && !groupHasRetainedBdiComponent(g, source, retained);
  });
  let familyRemoved = 0;
  const family = nodes("FAMILY_TREE")[0];
  if (family?.groups[0]) { const group = family.groups[0], count = readLeadingValues(family, source, 1)[0]?.value, actual = group.filter(n => n.kind === "record" && n.name === "FAMILY_MEMBER").length; if (count !== actual) throw new Error("Family count mismatch."); family.groups[0] = group.filter(n => { const remove = n.kind === "record" && n.name === "FAMILY_MEMBER" && itemReferencesKey(n, source, stringIds); if (remove) familyRemoved++; return !remove; }); if (familyRemoved) rewriteLeadingU32(family.groups[0], source, actual - familyRemoved); }
  const nameManager = nodes("CHARACTER_NAME_MANAGER")[0], nameFactions = nameManager && findFirstRecord(nameManager, "FACTIONS");
  const namesRemoved = nameFactions ? filterFactionGroups(nameFactions, g => g.some(n => itemReferencesKey(n, source, stringIds))) : 0;
  filterFactionGroups(factions, (_, i) => removedIndices.has(i));
  const caiMilitaryForceBuildingSlotsRemoved = removeCaiMilitaryForceSlots(root, source, militaryForceSlots);
  const caiTechnologiesRemoved = removeOrphanCaiTechnologies(root, source);
  const afterComponents = collectCaiBdiComponentIds(root, source), removedComponents = new Set([...componentIdsBefore].filter(id => !afterComponents.has(id)));
  const caiSettlementReferences = remapCaiSettlementReferences(root, source, header, tables, caiOwnerTransfers, removedComponents);
  const mobileReferencesRemoved = removeCaiMobileReferences(root, source, header, tables, removedComponents), dependentReferencesRemoved = removeCaiDependentReferenceArrays(root, source, header, tables, removedComponents);
  let ownershipRowsRemoved = 0;
  for (const n of findRecords(root, "CAI_BDI_COMPONENT_BLOCK_OWNS")) ownershipRowsRemoved += filterFactionGroups(n, g => removedComponents.has(firstU32InGroup(g, source)!));
  return { requested: [...requested], removedKeys, absentKeys: [...requested].filter(k => !wanted.has(k)), factionsBefore: before, factionsAfter: factions.groups.length, charactersRemoved, mobilesRemoved, unitsRemoved, postsRemoved, mobileDependents, relationshipsRemoved, pairsRemoved, indexedLists, factionIdFieldsRemapped: replacements.length, stancesRemoved, managersRemoved, inactiveTargetsWithoutManager, historicalMapsRemoved, beliefsRemoved, familyRemoved, namesRemoved, componentsRemoved: removedComponents.size, mobileReferencesRemoved, dependentReferencesRemoved, ownershipRowsRemoved, regionReferencesTransferred: regionReplacements.length, regionOwnerIdsRemapped, provinceOwnerIdsRemapped, factionKeyedRows, caiSettlementReferences, caiMilitaryForceBuildingSlotsRemoved, caiTechnologiesRemoved, transfers };
}
