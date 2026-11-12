import { CaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { CaabRecordNode, CaabByteReplacement, CaabRawSpan, replaceByteRanges } from "../esf/codecs/caabTree";
import { cauleb128Length, writeCauleb128 } from "../esf/codecs/caabWriter";

/**
 * Native resolvers 0x2861e7c and 0x2861580 require these mobile references to
 * resolve. Other arrays can contain pairs, counters, or unrelated ID domains.
 * Unsigned 24-bit encodings use big endian, unlike 16-/32-bit values.
 * Compare native numeric IDs across scalar and array encoding widths.
 */
function rewriteCaiReferenceArrays(
  root: CaabRecordNode,
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: CaabStringTables,
  removedComponentIds: ReadonlySet<number>,
  mode: "mobile" | "dependent"
): number {
  const widths: Record<number, number> = { 0x56: 1, 0x57: 2, 0x58: 3, 0x48: 4 };
  const frames: { name: string; arrayIndex: number }[] = [];
  let removed = 0;
  const edits: (CaabByteReplacement & { matches: number })[] = [];
  walkCaabNodes(source, header, tables, {
    onRecordStart(record) { frames.push({ name: record.name, arrayIndex: 0 }); },
    onRecordEnd() { frames.pop(); },
    onValue(value) {
      if (value.kind !== "array") return;
      const frame = frames[frames.length - 1];
      const index = frame.arrayIndex++;
      const mobile = (frame.name === "CAI_THEATRE" && index === 0) || (frame.name === "CAI_REGION" && index === 4) || frame.name === "CAI_GARRISONABLE";
      const paired = index === 0 && ["CAI_ANALYSER", "CAI_FACTION_MANAGER_MANAGER"].includes(frame.name);
      const diplomatic = frame.name === "CAI_DIPLOMATIC_ANALYSIS";
      if (mode === "mobile" ? !mobile : !(paired || diplomatic)) return;
      const width = widths[value.marker];
      if (!width) throw new Error(`Unsupported mobile-reference array marker 0x${value.marker.toString(16)}.`);
      const payload = value.value.payload;
      const stride = width * (mode === "dependent" && paired ? 2 : 1);
      if (payload.length % stride) throw new Error("Malformed CAI mobile-reference array length.");
      const chunks: Buffer[] = [];
      let matches = 0;
      for (let at = 0; at < payload.length; at += stride) {
        const idAt = (offset: number) => width === 3 ? payload.readUIntBE(offset, width) : payload.readUIntLE(offset, width);
        if (removedComponentIds.has(idAt(at)) ||
            (stride === width * 2 && removedComponentIds.has(idAt(at + width)))) matches++;
        else chunks.push(payload.subarray(at, at + stride));
      }
      if (!matches) return;
      const next = Buffer.concat(chunks);
      const prefix = cauleb128Length(next.length);
      const encoded = Buffer.alloc(1 + prefix + next.length);
      encoded[0] = value.marker;
      writeCauleb128(encoded, 1, next.length);
      next.copy(encoded, 1 + prefix);
      edits.push({ start: value.startOffset!, end: value.endOffset!, data: encoded, matches });
    },
  });
  // Deleted records still exist in the source walk. Retain only edits covered by
  // surviving raw spans, then apply every replacement in one tree traversal.
  const spans: CaabRawSpan[] = [];
  function visit(node: CaabRecordNode): void { for (const group of node.groups) for (const item of group) { if (item.kind === "record") visit(item); else if (item.kind === "raw") spans.push(item); } }
  visit(root);
  let cursor = 0;
  const live = edits.filter(edit => {
    while (cursor < spans.length && spans[cursor].end <= edit.start) cursor++;
    const span = spans[cursor];
    return span && span.start <= edit.start && span.end >= edit.end;
  });
  replaceByteRanges(root, live);
  removed = live.reduce((sum, edit) => sum + edit.matches, 0);
  return removed;
}

export function removeCaiMobileReferences(root: CaabRecordNode, source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables, removedIds: ReadonlySet<number>): number {
  return rewriteCaiReferenceArrays(root, source, header, tables, removedIds, "mobile");
}

/** CAI_ANALYSER and manager arrays hold pairs; delete complete pairs only. */
export function removeCaiDependentReferenceArrays(root: CaabRecordNode, source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables, removedIds: ReadonlySet<number>): number {
  return rewriteCaiReferenceArrays(root, source, header, tables, removedIds, "dependent");
}

/** Reject references that native theatre/region resolvers must resolve. */
export function validateCaiMobileReferences(source: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables): number {
  const ids = new Set<number>(), references: { name: string; id: number }[] = [];
  const frames: { name: string; arrayIndex: number; componentIdRead: boolean; scalarIndex: number }[] = [];
  const widths: Record<number, number> = { 0x56: 1, 0x57: 2, 0x58: 3, 0x48: 4 };
  walkCaabNodes(source, header, tables, {
    onRecordStart(record) { frames.push({ name: record.name, arrayIndex: 0, componentIdRead: false, scalarIndex: 0 }); },
    onRecordEnd() { frames.pop(); },
    onValue(value) {
      const frame = frames[frames.length - 1];
      if (frame.name === "CAI_BDI_COMPONENT" && !frame.componentIdRead && value.kind === "value" && value.type === "u32") {
        ids.add(value.value as number); frame.componentIdRead = true;
      }
      if (frame.name === "CAI_GARRISONABLE" && value.kind === "value" && value.type === "u32") {
        const index = frame.scalarIndex++;
        if (index < 4 && value.value !== 0) references.push({ name: frame.name, id: value.value as number });
      }
      if (value.kind !== "array") return;
      const index = frame.arrayIndex++;
      if (!((frame.name === "CAI_THEATRE" && index === 0) || (frame.name === "CAI_REGION" && index === 4) || frame.name === "CAI_GARRISONABLE" || (frame.name === "CAI_BASIC_REGION_GROUP_ANALYSIS" && index < 3))) return;
      const width = widths[value.marker], payload = value.value.payload;
      if (!width || payload.length % width) throw new Error(`Invalid mobile-reference array in ${frame.name}.`);
      for (let at = 0; at < payload.length; at += width) references.push({ name: frame.name, id: width === 3 ? payload.readUIntBE(at, width) : payload.readUIntLE(at, width) });
    },
  });
  for (const reference of references) if (!ids.has(reference.id)) throw new Error(`${reference.name} references missing AI component ${reference.id}.`);
  return references.length;
}
