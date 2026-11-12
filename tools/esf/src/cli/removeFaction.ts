import * as fs from "fs";
import * as path from "path";
import { requireValue } from "./args";
import { openEsfBuffer } from "../esf/compressed";
import { readCaabHeader } from "../esf/codecs/caabBinary";
import { buildCaabTree } from "../esf/codecs/caabTree";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { repackAndVerify } from "../esf/recompress";
import { collectFactionKeys, removeFaction } from "../edit/removeFaction";
import { tablesFor, verify } from "../edit/verifyRemoval";

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
