import {
  CaabStringTables,
  parseCaabStringTables,
  parseCbabStringTables,
  readCaabHeader,
  walkCaabNodes,
} from "../esf/codecs/caabBinary";
import { buildCaabTree } from "../esf/codecs/caabTree";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { openEsfBuffer } from "../esf/compressed";
import { repackAndVerify } from "../esf/recompress";
import { regionReferencedFactionKey, removeFactions } from "./removeFactions";
import { verify } from "./verifyRemoval";

/** Faction keys that own a region or appear in preview region ownerships, i.e. the ones `removeFactions` demands a transfer for. */
export function collectRegionReferencedFactionKeys(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: CaabStringTables,
): Set<string> {
  const keys = new Set<string>();
  walkCaabNodes(source, header, tables, {
    onValue(v, stack) {
      const key = regionReferencedFactionKey(v, stack);
      if (key) keys.add(key);
    },
  });
  return keys;
}

export type RemoveFactionsFromStartposReport = ReturnType<typeof removeFactions> & { keptRegionOwners: string[] };

/**
 * Removes a batch of factions from a (possibly compressed) startpos ESF and returns the re-packed bytes.
 * With `keepRegionOwners`, factions that still own regions are skipped (and listed in `keptRegionOwners`) instead of needing transfers.
 */
export async function removeFactionsFromStartpos(
  outer: Buffer,
  keys: readonly string[],
  opts: { keepRegionOwners: boolean; transfers?: Record<string, string>; log?: (message: string) => void },
): Promise<{ buffer: Buffer; report: RemoveFactionsFromStartposReport }> {
  const log = opts.log ?? (() => {});
  // `let` so the original tree and bytes can be dropped before verify rebuilds a tree from the output.
  let opened: ReturnType<typeof openEsfBuffer> | null = openEsfBuffer(outer);
  let source: Buffer | null = opened.buffer;
  const wasCompressed = opened.wasCompressed,
    header = readCaabHeader(source);
  const tables = (header.codecId === 0xabcb ? parseCbabStringTables : parseCaabStringTables)(
    source,
    header.recordNamesOffset,
  );
  let requested = [...keys],
    keptRegionOwners: string[] = [];
  if (opts.keepRegionOwners) {
    const referenced = collectRegionReferencedFactionKeys(source, header, tables);
    keptRegionOwners = requested.filter((k) => referenced.has(k));
    requested = requested.filter((k) => !referenced.has(k));
  }
  if (!requested.length) throw new Error("No removable factions remain after keeping region owners.");
  log("Building editable tree.");
  let root: ReturnType<typeof buildCaabTree> | null = buildCaabTree(source, header, tables);
  log("Removing faction batch and remapping surviving IDs.");
  const report = removeFactions(source, header, tables, root, requested, opts.transfers ?? {});
  log(`Writing and validating ${report.factionsBefore} -> ${report.factionsAfter} factions.`);
  const inner = writeCaabBuffer({ header, tables, root, source });
  root = null;
  source = null;
  opened = null;
  verify(inner, requested, report.factionsAfter);
  log("Structural validation passed; recompressing and checking stream equality.");
  const buffer = wasCompressed ? (await repackAndVerify(outer, inner)).buffer : inner;
  return { buffer, report: { ...report, keptRegionOwners } };
}
