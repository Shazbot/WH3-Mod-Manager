import { CaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { CaabRecordNode, replaceByteRanges } from "../esf/codecs/caabTree";
import { cauleb128Length, writeCauleb128 } from "../esf/codecs/caabWriter";
import { encodeU32 } from "./addFaction";

interface Reference { name: string; value: number; start: number; end: number }
function collect(source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables) {
  const regionGroupOwners: { start: number; end: number; marker: number; width: number; ids: number[] }[] = [];
  const owners: Reference[] = [], garrisons: Reference[] = [], factionOwners = new Set<number>();
  const frames: { name: string; version: number; scalars: number; arrays: number }[] = [];
  walkCaabNodes(source, header, tables, {
    onRecordStart(record) { frames.push({ name: record.name, version: record.version, scalars: 0, arrays: 0 }); },
    onRecordEnd() { frames.pop(); },
    onValue(value, stack) {
      const current = frames[frames.length - 1];
      if (value.kind === "array") {
        const index = current.arrays++;
        if (current.name === "CAI_BASIC_REGION_GROUP_ANALYSIS" && index === 2) {
          if (current.version !== 0) throw new Error("Unsupported basic region-group version.");
          const width = ({ 0x56: 1, 0x57: 2, 0x58: 3, 0x48: 4 } as Record<number, number>)[value.marker], payload = value.value.payload;
          if (!width || payload.length % width) throw new Error("Invalid basic region-group faction array.");
          const ids = [];
          for (let at = 0; at < payload.length; at += width) ids.push(width === 3 ? payload.readUIntBE(at, width) : payload.readUIntLE(at, width));
          regionGroupOwners.push({ start: value.startOffset!, end: value.endOffset!, marker: value.marker, width, ids });
        }
        return;
      }
      if (value.type !== "u32") return;
      const frame = frames[frames.length - 1], index = frame.scalars++;
      if (frame.name === "OWNED_DIRECT" && stack.includes("CAI_WORLD_FACTIONS") && index === 0) factionOwners.add(value.value as number);
      const owner = index === 0 && ((stack.includes("CAI_WORLD_SETTLEMENTS") && ["OWNED_DIRECT", "CAI_SETTLEMENT"].includes(frame.name)) || (stack.includes("CAI_FACTION_PROVINCES") && frame.name === "OWNED_DIRECT"));
      const garrison = frame.name === "CAI_GARRISONABLE" && index < 4;
      if (!owner && !garrison) return;
      if (frame.version !== 0) throw new Error(`Unsupported ${frame.name} version ${frame.version}.`);
      const ref = { name: frame.name, value: value.value as number, start: value.startOffset!, end: value.endOffset! };
      (owner ? owners : garrisons).push(ref);
    },
  });
  return { owners, garrisons, factionOwners, regionGroupOwners };
}

/** Territory ownership uses stable AI faction keys; optional garrison slots use BDI IDs. */
export function remapCaiSettlementReferences(root: CaabRecordNode, source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables, transfers: ReadonlyMap<number, number>, removedComponents: ReadonlySet<number>) {
  const refs = collect(source, header, tables);
  const owners = refs.owners.filter(ref => transfers.has(ref.value)).map(ref => ({ ...ref, data: encodeU32(transfers.get(ref.value)!) }));
  const ownersRemapped = replaceByteRanges(root, owners);
  if (ownersRemapped !== owners.length) throw new Error("Could not rewrite all AI settlement owner references.");
  const garrisons = refs.garrisons.filter(ref => removedComponents.has(ref.value)).map(ref => ({ ...ref, data: encodeU32(0) }));
  // Removed mobile parents are absent from root; only surviving spans are rewritten.
  const garrisonReferencesCleared = replaceByteRanges(root, garrisons);
  // The third region-group array is parallel to neighbouring regions/weights.
  // Transfer owner identities in place; never shorten this array independently.
  const arrays = refs.regionGroupOwners.filter(ref => ref.ids.some(id => transfers.has(id))).map(ref => {
    const ids = ref.ids.map(id => transfers.get(id) ?? id), width = ids.some(id => id >= 2 ** (8 * ref.width)) ? 4 : ref.width;
    const marker = width === ref.width ? ref.marker : 0x48, length = ids.length * width, prefix = cauleb128Length(length), data = Buffer.alloc(1 + prefix + length);
    data[0] = marker; writeCauleb128(data, 1, length);
    ids.forEach((id, index) => width === 3 ? data.writeUIntBE(id, 1 + prefix + index * width, width) : data.writeUIntLE(id, 1 + prefix + index * width, width));
    return { start: ref.start, end: ref.end, data };
  });
  const spans: { start: number; end: number }[] = [];
  function visit(node: CaabRecordNode): void { for (const group of node.groups) for (const item of group) { if (item.kind === "record") visit(item); else if (item.kind === "raw") spans.push(item); } }
  visit(root);
  let cursor = 0;
  const liveArrays = arrays.filter(edit => {
    while (cursor < spans.length && spans[cursor].end <= edit.start) cursor++;
    const span = spans[cursor];
    return span && span.start <= edit.start && span.end >= edit.end;
  });
  const regionGroupArraysRemapped = replaceByteRanges(root, liveArrays);
  return { ownersRemapped, garrisonReferencesCleared, regionGroupArraysRemapped };
}

export function validateCaiSettlementOwners(source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables): void {
  const refs = collect(source, header, tables);
  for (const ref of refs.regionGroupOwners) for (const id of ref.ids) if (!refs.factionOwners.has(id)) throw new Error(`Basic region-group references missing AI faction owner ${id}.`);
  for (const ref of refs.owners) if (ref.value !== 0 && !refs.factionOwners.has(ref.value)) throw new Error(`${ref.name} references missing AI faction owner ${ref.value}.`);
}
