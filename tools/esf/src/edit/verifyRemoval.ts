import { parseCaabStringTables, parseCbabStringTables, readCaabHeader, walkCaabNodes } from "../esf/codecs/caabBinary";
import { buildCaabTree } from "../esf/codecs/caabTree";
import { collectFactionKeys, validateCaiFactionBeliefReferences } from "./removeFaction";
import { validateCaiTechnologyTrees } from "./caiTechnologies";
import { validateCaiMilitaryForceSlots } from "./caiMilitaryForceSlots";
import { validateCaiSettlementOwners } from "./caiSettlementReferences";
import { validateCaiMobileReferences } from "./caiMobileReferences";
import { validateFactionKeyedRows } from "./factionKeyedRows";
import { collectProvinceFactionOwners } from "./provinceFactionIds";
import { collectRegionFactionOwners } from "./regionFactionIds";
import { collectCaiFactionIdSpans } from "./caiFactionIds";
import { collectFactionArrayIdSpans, collectIndexedFactionIdSpans } from "./factionIdSpans";
import { FACTION_ID_BASE, findFirstRecord, relationshipGroupId, validateFactionIdPermutation } from "./addFaction";

/** Structural validation of a rewritten startpos after faction removal. */
export function tablesFor(buffer: Buffer, codecId: number, offset: number) {
  return (codecId === 0x0000abcb ? parseCbabStringTables : parseCaabStringTables)(buffer, offset);
}

export function verify(inner: Buffer, removedKey: string | readonly string[], expectedCount: number): void {
  const header = readCaabHeader(inner);
  const tables = tablesFor(inner, header.codecId, header.recordNamesOffset);
  const root = buildCaabTree(inner, header, tables);
  const keys = collectFactionKeys(root, inner, tables);
  if (keys.length !== expectedCount) throw new Error(`Expected ${expectedCount} factions, found ${keys.length}.`);
  const removedKeys = new Set(
    (typeof removedKey === "string" ? [removedKey] : removedKey).map((key) => key.toLowerCase()),
  );
  if (keys.some((key) => removedKeys.has(key.toLowerCase())))
    throw new Error("A removed faction remains in FACTION_ARRAY.");
  walkCaabNodes(inner, header, tables, {
    onValue(value, stack) {
      if (value.kind !== "value" || value.type !== "ascii") return;
      const key = (value.value as { text?: string }).text;
      if (key && removedKeys.has(key.toLowerCase()))
        throw new Error(`Unresolved reference to ${key}: ${stack.join("/")}`);
    },
  });

  for (const region of collectRegionFactionOwners(inner, header, tables)) {
    if (region.ownerId > keys.length + FACTION_ID_BASE - 1)
      throw new Error(`Region ${region.regionKey} has out-of-range owner faction ${region.ownerId}.`);
  }
  for (const province of collectProvinceFactionOwners(inner, header, tables)) {
    if (province.ownerId > keys.length + FACTION_ID_BASE - 1)
      throw new Error(`Province ${province.provinceId} has out-of-range faction ${province.ownerId}.`);
  }
  validateFactionKeyedRows(root, inner, keys.length + FACTION_ID_BASE - 1);
  validateCaiMobileReferences(inner, header, tables);
  validateCaiSettlementOwners(inner, header, tables);
  validateCaiMilitaryForceSlots(root, inner);
  validateCaiTechnologyTrees(root, inner);
  validateCaiFactionBeliefReferences(root, inner);
  const factionArray = findFirstRecord(root, "FACTION_ARRAY");
  if (!factionArray) throw new Error("FACTION_ARRAY missing after write.");
  collectFactionArrayIdSpans(inner, header, tables, keys.length);
  collectIndexedFactionIdSpans(inner, header, tables, keys.length);
  const tradeRoutes = findFirstRecord(root, "INTERNATIONAL_TRADE_ROUTES");
  if (tradeRoutes) {
    validateFactionIdPermutation(tradeRoutes.groups, inner, "INTERNATIONAL_TRADE_ROUTES", keys.length);
  }
  for (let index = 0; index < factionArray.groups.length; index += 1) {
    const record = factionArray.groups[index].find((item) => item.kind === "record");
    if (!record || record.kind !== "record") throw new Error(`Faction ${index} record missing after write.`);
    const relationship = findFirstRecord(record, "OLD_DIPLOMACY_RELATIONSHIP");
    if (!relationship) throw new Error(`Faction ${keys[index]} has no diplomacy relationships.`);
    const ids = relationship.groups.map((group) => relationshipGroupId(group, inner));
    const expectedIds = Array.from({ length: keys.length }, (_, i) => i + FACTION_ID_BASE).filter(
      (id) => id !== index + FACTION_ID_BASE,
    );
    if (ids.length !== expectedIds.length || ids.some((id, position) => id !== expectedIds[position])) {
      throw new Error(`Faction ${keys[index]} has an incomplete or misordered diplomacy row.`);
    }
  }

  const manager = findFirstRecord(root, "DIPLOMACY_MANAGER");
  const pairwise = manager ? findFirstRecord(manager, "DIPLOMACY_RELATIONSHIP") : null;
  if (!pairwise) throw new Error("Pairwise diplomacy missing after write.");
  const expectedPairs = (keys.length * (keys.length + 1)) / 2;
  if (pairwise.groups.length !== expectedPairs) {
    throw new Error(`Pairwise diplomacy has ${pairwise.groups.length} entries; expected ${expectedPairs}.`);
  }

  const worldFactions = findFirstRecord(root, "CAI_WORLD_FACTIONS");
  if (!worldFactions) throw new Error("CAI_WORLD_FACTIONS missing after write.");
  if (worldFactions.groups.length !== keys.length && worldFactions.groups.length !== keys.length + 1) {
    throw new Error(`CAI_WORLD_FACTIONS has ${worldFactions.groups.length} rows for ${keys.length} factions.`);
  }
  const caiFactionIds = collectCaiFactionIdSpans(inner, header, tables);
  const expectedCaiFactionIds = Array.from({ length: keys.length }, (_, index) => index + FACTION_ID_BASE);
  if (worldFactions.groups.length === keys.length + 1) expectedCaiFactionIds.push(1);
  if (
    caiFactionIds.length !== expectedCaiFactionIds.length ||
    caiFactionIds.some((row, index) => row.value !== expectedCaiFactionIds[index])
  ) {
    const mismatch = caiFactionIds.findIndex((row, index) => row.value !== expectedCaiFactionIds[index]);
    throw new Error(`CAI_WORLD_FACTIONS faction IDs are incomplete or misordered at row ${mismatch}.`);
  }
}
