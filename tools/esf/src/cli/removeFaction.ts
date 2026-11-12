import * as fs from "fs";
import * as path from "path";
import { requireValue } from "./args";
import { openEsfBuffer } from "../esf/compressed";
import { parseCaabStringTables, parseCbabStringTables, readCaabHeader, walkCaabNodes } from "../esf/codecs/caabBinary";
import { buildCaabTree } from "../esf/codecs/caabTree";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { repackAndVerify } from "../esf/recompress";
import { collectFactionKeys, findFactionKeyReferences, removeFaction, validateCaiFactionBeliefReferences } from "../edit/removeFaction";
import { validateCaiTechnologyTrees } from "../edit/caiTechnologies";
import { validateCaiMilitaryForceSlots } from "../edit/caiMilitaryForceSlots";
import { validateCaiSettlementOwners } from "../edit/caiSettlementReferences";
import { validateCaiMobileReferences } from "../edit/caiMobileReferences";
import { validateFactionKeyedRows } from "../edit/factionKeyedRows";
import { collectProvinceFactionOwners } from "../edit/provinceFactionIds";
import { collectRegionFactionOwners } from "../edit/regionFactionIds";
import { collectCaiFactionIdSpans } from "../edit/caiFactionIds";
import { collectFactionArrayIdSpans, collectIndexedFactionIdSpans } from "../edit/factionIdSpans";
import { FACTION_ID_BASE, findFirstRecord, relationshipGroupId, validateFactionIdPermutation } from "../edit/addFaction";

function tablesFor(buffer: Buffer, codecId: number, offset: number) {
  return (codecId === 0x0000abcb ? parseCbabStringTables : parseCaabStringTables)(buffer, offset);
}

export function verify(inner: Buffer, removedKey: string | readonly string[], expectedCount: number): void {
  const header = readCaabHeader(inner);
  const tables = tablesFor(inner, header.codecId, header.recordNamesOffset);
  const root = buildCaabTree(inner, header, tables);
  const keys = collectFactionKeys(root, inner, tables);
  if (keys.length !== expectedCount) throw new Error(`Expected ${expectedCount} factions, found ${keys.length}.`);
  const removedKeys = new Set((typeof removedKey === "string" ? [removedKey] : removedKey).map(key => key.toLowerCase()));
  if (keys.some(key => removedKeys.has(key.toLowerCase()))) throw new Error("A removed faction remains in FACTION_ARRAY.");
  walkCaabNodes(inner, header, tables, { onValue(value, stack) {
    if (value.kind !== "value" || value.type !== "ascii") return;
    const key = (value.value as { text?: string }).text;
    if (key && removedKeys.has(key.toLowerCase())) throw new Error(`Unresolved reference to ${key}: ${stack.join("/")}`);
  }});

  for (const region of collectRegionFactionOwners(inner, header, tables)) {
    if (region.ownerId > keys.length + FACTION_ID_BASE - 1) throw new Error(`Region ${region.regionKey} has out-of-range owner faction ${region.ownerId}.`);
  }
  for (const province of collectProvinceFactionOwners(inner, header, tables)) {
    if (province.ownerId > keys.length + FACTION_ID_BASE - 1) throw new Error(`Province ${province.provinceId} has out-of-range faction ${province.ownerId}.`);
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
      (id) => id !== index + FACTION_ID_BASE
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let file: string | undefined;
  let outPath: string | undefined;
  let factionKey: string | undefined;
  let transferTo: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") { file = requireValue("--file", argv[i + 1]); i += 1; }
    else if (argv[i] === "--out") { outPath = requireValue("--out", argv[i + 1]); i += 1; }
    else if (argv[i] === "--faction") { factionKey = requireValue("--faction", argv[i + 1]); i += 1; }
    else if (argv[i] === "--transfer-to") { transferTo = requireValue("--transfer-to", argv[i + 1]); i += 1; }
  }
  if (!file) throw new Error("Missing required argument --file <path-to-startpos.esf>.");
  if (!outPath) throw new Error("Missing required argument --out <new-startpos.esf>; the input is never overwritten.");
  if (!factionKey) throw new Error("Missing required argument --faction <faction-key>.");
  if (path.resolve(file) === path.resolve(outPath)) throw new Error("Input and output paths must differ.");

  const outer = fs.readFileSync(file);
  const opened = openEsfBuffer(outer);
  const header = readCaabHeader(opened.buffer);
  const tables = tablesFor(opened.buffer, header.codecId, header.recordNamesOffset);
  const root = buildCaabTree(opened.buffer, header, tables);
  const before = collectFactionKeys(root, opened.buffer, tables).length;
  const report = removeFaction(opened.buffer, header, tables, root, { factionKey, transferTo });
  const rewrittenInner = writeCaabBuffer({ header, tables, root, source: opened.buffer });
  verify(rewrittenInner, report.removedKey, report.factionsAfter);

  let output = rewrittenInner;
  let compressedSize: number | undefined;
  if (opened.wasCompressed) {
    const repacked = await repackAndVerify(outer, rewrittenInner);
    output = repacked.buffer;
    compressedSize = repacked.compressedSize;
  }

  fs.writeFileSync(outPath, output);
  console.log(`Removed ${report.removedKey} at index ${report.removedIndex} (id ${report.removedId}).`);
  console.log(`Factions: ${before} -> ${report.factionsAfter}; relationships removed: ${report.relationshipsTrimmed}; pairwise entries removed: ${report.pairsRemoved}.`);
  console.log(`Faction ID fields remapped: ${report.factionIdsRemapped} (${report.factionIdReferencesRemapped.map((item) => `${item.recordName}: ${item.count}`).join(", ")}).`);
  console.log(`Faction-indexed lists updated: ${report.listsTrimmed.map((item) => `${item.name} (${item.instances})`).join(", ") || "none"}.`);
  console.log(`AI rows removed: CAI faction managers ${report.caiFactionManagersRemoved}, strategic stance rows ${report.caiStrategicStanceRowsRemoved}, BDI components ${report.caiBdiComponentsRemoved}, BDI block ownership rows ${report.caiBdiBlockOwnershipRowsRemoved}; characters ${report.caiCharactersRemoved}, character posts ${report.caiCharacterPostsRemoved}, resource mobiles ${report.caiResourceMobilesRemoved}, units ${report.caiUnitsRemoved}; influence maps ${report.influenceMapsRemoved}, CAI belief groups ${report.caiBeliefGroupsRemoved}; family members ${report.familyMembersRemoved}; name-manager row ${report.nameManagerRemoved ? "yes" : "no"}.`);
  console.log(`Region faction references reassigned: ${report.regionReferencesReassigned}.`);
  console.log(`Wrote ${outPath}${compressedSize === undefined ? "" : ` (${compressedSize} compressed bytes)`}.`);
  console.log("Structural checks passed. This does not establish that the game accepts the edited startpos.");
}

if (require.main === module) main().catch((error: Error) => {
  console.error(`removeFaction failed: ${error.message}`);
  process.exitCode = 1;
});
