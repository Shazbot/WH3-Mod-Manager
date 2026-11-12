import { CaabStringTables, CaabValue, walkCaabNodes } from "../esf/codecs/caabBinary";
import { FACTION_ID_BASE, EXPLICIT_FACTION_ID_INDEXED_RECORDS, FACTION_INDEXED_EXTRA_ROW_ORDER } from "./addFaction";

export interface ExplicitFactionIdSpan {
  recordName: string;
  rowIndex: number;
  value: number;
  start: number;
  end: number;
}

interface GroupRange {
  start: number;
  end: number;
}

interface IndexedRecordFrame {
  recordName: string;
  startOffset: number;
  rowCount: number;
  ranges: GroupRange[];
  spans: (ExplicitFactionIdSpan | null)[];
}

function readCauleb128(source: Buffer, offset: number): { value: number; nextOffset: number } {
  let value = 0;
  let cursor = offset;
  for (let index = 0; index < 5 && cursor < source.length; index += 1) {
    const byte = source[cursor++];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, nextOffset: cursor };
  }
  throw new Error(`Invalid CAULEB128 group size at offset ${offset}.`);
}

export function groupRanges(record: {
  name: string;
  flags: number;
  groupCount: number;
  blockStartOffset: number;
  blockEndOffset: number;
}, source: Buffer): GroupRange[] {
  if ((record.flags & 0x40) === 0) {
    return [{ start: record.blockStartOffset, end: record.blockEndOffset }];
  }

  const ranges: GroupRange[] = [];
  let cursor = record.blockStartOffset;
  for (let index = 0; index < record.groupCount; index += 1) {
    const size = readCauleb128(source, cursor);
    const end = size.nextOffset + size.value;
    if (end > record.blockEndOffset) {
      throw new Error(`${record.name} group ${index} exceeds its record block.`);
    }
    ranges.push({ start: size.nextOffset, end });
    cursor = end;
  }
  if (cursor !== record.blockEndOffset) {
    throw new Error(`${record.name} group boundaries do not fill its record block.`);
  }
  return ranges;
}

export function groupIndexForOffset(ranges: GroupRange[], offset: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const range = ranges[middle];
    if (offset < range.start) high = middle;
    else if (offset >= range.end) low = middle + 1;
    else return middle;
  }
  return -1;
}

function firstU32Span(value: CaabValue, recordName: string, rowIndex: number): ExplicitFactionIdSpan {
  if (
    value.kind !== "value" ||
    value.type !== "u32" ||
    typeof value.value !== "number" ||
    value.startOffset === undefined ||
    value.endOffset === undefined
  ) {
    throw new Error(`Could not read the first faction ID in ${recordName} row ${rowIndex}.`);
  }
  return {
    recordName,
    rowIndex,
    value: value.value,
    start: value.startOffset,
    end: value.endOffset,
  };
}

/** Reads and validates the explicit ID stored at the start of every FACTION record. */
export function collectFactionArrayIdSpans(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: Pick<CaabStringTables, "recordNames" | "utf8ById" | "utf16ById">,
  factionsBefore: number
): ExplicitFactionIdSpan[] {
  const rows: ExplicitFactionIdSpan[] = [];
  let current: { startOffset: number; rowIndex: number; span?: ExplicitFactionIdSpan } | null = null;

  walkCaabNodes(source, header, tables, {
    onRecordStart(record, stack) {
      if (record.name !== "FACTION" || stack[stack.length - 1] !== "FACTION_ARRAY") return;
      if (current) throw new Error("Nested FACTION records inside FACTION_ARRAY are not supported.");
      current = { startOffset: record.startOffset, rowIndex: rows.length };
    },
    onValue(value, stack) {
      if (!current || stack[stack.length - 1] !== "FACTION" || value.kind !== "value" || value.type !== "u32") return;
      if (!current.span) current.span = firstU32Span(value, "FACTION_ARRAY/FACTION", current.rowIndex);
    },
    onRecordEnd(record, stack) {
      if (record.name !== "FACTION" || stack[stack.length - 1] !== "FACTION_ARRAY") return;
      if (!current || current.startOffset !== record.startOffset || !current.span) {
        throw new Error(`FACTION_ARRAY row ${rows.length} has no readable faction ID.`);
      }
      rows.push(current.span);
      current = null;
    },
  });

  if (rows.length !== factionsBefore) {
    throw new Error(`Found ${rows.length} FACTION records for ${factionsBefore} faction rows.`);
  }
  for (const row of rows) {
    const expected = row.rowIndex + FACTION_ID_BASE;
    if (row.value !== expected) {
      throw new Error(`FACTION_ARRAY row ${row.rowIndex} has id ${row.value}; expected ${expected}.`);
    }
  }
  return rows;
}

function expectedIndexedFactionId(recordName: string, rowIndex: number, rowCount: number, factionsBefore: number): number {
  if (rowCount === factionsBefore) return rowIndex + FACTION_ID_BASE;
  if (rowCount !== factionsBefore + 1) {
    throw new Error(`${recordName} has ${rowCount} rows for ${factionsBefore} factions.`);
  }

  const extraRowOrder = FACTION_INDEXED_EXTRA_ROW_ORDER[recordName as keyof typeof FACTION_INDEXED_EXTRA_ROW_ORDER];
  if (extraRowOrder === "leading") return rowIndex === 0 ? 1 : rowIndex - 1 + FACTION_ID_BASE;
  if (extraRowOrder === "trailing") return rowIndex === factionsBefore ? 1 : rowIndex + FACTION_ID_BASE;
  throw new Error(`${recordName} has an unclassified extra faction row.`);
}

/**
 * Locates the first u32 in each faction-indexed group and verifies that it is
 * the faction ID sequence. This covers IDs embedded in otherwise positional
 * lists, including the leading non-faction participant in FACTION_PLAGUES_DATA.
 */
export function collectIndexedFactionIdSpans(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: Pick<CaabStringTables, "recordNames" | "utf8ById" | "utf16ById">,
  factionsBefore: number
): ExplicitFactionIdSpan[] {
  const wanted = new Set<string>(EXPLICIT_FACTION_ID_INDEXED_RECORDS);
  const counts = new Map<string, number>();
  const output: ExplicitFactionIdSpan[] = [];
  const active: IndexedRecordFrame[] = [];

  walkCaabNodes(source, header, tables, {
    onRecordStart(record) {
      if (!wanted.has(record.name) || (record.groupCount !== factionsBefore && record.groupCount !== factionsBefore + 1)) return;
      active.push({
        recordName: record.name,
        startOffset: record.startOffset,
        rowCount: record.groupCount,
        ranges: groupRanges(record, source),
        spans: Array(record.groupCount).fill(null),
      });
    },
    onValue(value, stack) {
      const current = active[active.length - 1];
      if (!current || stack[stack.length - 1] !== current.recordName || value.kind !== "value" || value.type !== "u32") return;
      const offset = value.startOffset;
      if (offset === undefined) return;
      const rowIndex = groupIndexForOffset(current.ranges, offset);
      if (rowIndex >= 0 && !current.spans[rowIndex]) {
        current.spans[rowIndex] = firstU32Span(value, current.recordName, rowIndex);
      }
    },
    onRecordEnd(record) {
      const current = active[active.length - 1];
      if (!current || current.startOffset !== record.startOffset) return;
      active.pop();
      const rows = current.spans.map((span, rowIndex) => {
        if (!span) throw new Error(`${current.recordName} row ${rowIndex} has no readable faction ID.`);
        const expected = expectedIndexedFactionId(current.recordName, rowIndex, current.rowCount, factionsBefore);
        if (span.value !== expected) {
          throw new Error(`${current.recordName} row ${rowIndex} has id ${span.value}; expected ${expected}.`);
        }
        return span;
      });
      output.push(...rows);
      counts.set(current.recordName, (counts.get(current.recordName) ?? 0) + 1);
    },
  });

  for (const name of wanted) {
    if (!counts.has(name)) throw new Error(`No explicit faction-ID rows found for ${name}.`);
  }
  return output;
}
