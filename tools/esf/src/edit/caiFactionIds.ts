import { CaabStringTables, walkCaabNodes } from "../esf/codecs/caabBinary";
import { CaabItem, CaabRecordNode } from "../esf/codecs/caabTree";


/**
 * Per-faction rows in the AI world model carry ids of their own, and cloning a
 * row copies them. CAI_FACTION is the clearest case: its numeric slots are
 *
 *     [?, factionId, bdiId, ?, auxId, 0, 0]
 *
 * so a cloned row claims the donor's faction id and duplicates two ids that are
 * unique across the file. Vanilla has 535 CAI_FACTION rows with no duplicates in
 * either slot, which is the invariant to preserve.
 *
 * Note the row ordering: factions come first in FACTION_ARRAY order and the
 * extra participant (faction id 1, the same one that occupies id 1 in the
 * pairwise diplomacy matrix) sits LAST. A new faction's row therefore belongs
 * immediately before that trailing entry, not after it.
 */
export interface CaiFactionSlots {
  factionIdSlot: number;
  idSlots: number[];
}

export const CAI_FACTION_SLOTS: CaiFactionSlots = { factionIdSlot: 1, idSlots: [2, 4] };

export interface CaiFactionIdSpan {
  rowIndex: number;
  value: number;
  start: number;
  end: number;
}

/**
 * Reads the faction-id slot from each serialized CAI_FACTION row in
 * CAI_WORLD_FACTIONS. These rows contain array and nested-record values before
 * their numeric slots, so reading only the first raw span of a tree node misses
 * the faction id entirely.
 */
export function collectCaiFactionIdSpans(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: Pick<CaabStringTables, "recordNames" | "utf8ById" | "utf16ById">
): CaiFactionIdSpan[] {
  const rows: CaiFactionIdSpan[] = [];
  let current: { rowIndex: number; u32Count: number; idSpan?: CaiFactionIdSpan } | null = null;

  walkCaabNodes(source, header, tables, {
    onRecordStart(record, stack) {
      if (record.name !== "CAI_FACTION" || stack[stack.length - 1] !== "CAI_WORLD_FACTIONS") return;
      if (current) throw new Error("Nested CAI_FACTION rows are not supported.");
      current = { rowIndex: rows.length, u32Count: 0 };
    },
    onValue(value, stack) {
      if (!current || !stack.includes("CAI_FACTION") || value.kind !== "value" || value.type !== "u32") return;
      if (current.u32Count === CAI_FACTION_SLOTS.factionIdSlot) {
        if (
          typeof value.value !== "number" ||
          value.startOffset === undefined ||
          value.endOffset === undefined
        ) {
          throw new Error(`Could not locate the faction ID span in CAI_FACTION row ${current.rowIndex}.`);
        }
        current.idSpan = {
          rowIndex: current.rowIndex,
          value: value.value,
          start: value.startOffset,
          end: value.endOffset,
        };
      }
      current.u32Count += 1;
    },
    onRecordEnd(record, stack) {
      if (record.name !== "CAI_FACTION" || stack[stack.length - 1] !== "CAI_WORLD_FACTIONS") return;
      if (!current?.idSpan) throw new Error(`CAI_FACTION row ${rows.length} has no readable faction ID.`);
      rows.push(current.idSpan);
      current = null;
    },
  });

  return rows;
}

/**
 * These rows mix the u32 and i32 marker families -- a zero may be encoded as
 * 0x19 (i32 zero) rather than 0x14 (u32 zero) -- so both have to be decoded, and
 * a rewritten value keeps the family it replaced.
 */
const U32_ZERO = 0x14, U32_ONE = 0x15, U32_BYTE = 0x16, U32_16 = 0x17, U32_24 = 0x18, U32_FULL = 0x08;
const I32_ZERO = 0x19, I32_BYTE = 0x1a, I32_16 = 0x1b, I32_24 = 0x1c;

interface DecodedInt {
  value: number;
  width: number;
  signed: boolean;
}

function decodeInt(buffer: Buffer, offset: number): DecodedInt | null {
  switch (buffer[offset]) {
    case U32_ZERO: return { value: 0, width: 1, signed: false };
    case U32_ONE: return { value: 1, width: 1, signed: false };
    case U32_BYTE: return { value: buffer[offset + 1], width: 2, signed: false };
    case U32_16: return { value: buffer.readUInt16LE(offset + 1), width: 3, signed: false };
    case U32_24: return { value: buffer.readUIntBE(offset + 1, 3), width: 4, signed: false };
    case U32_FULL: return { value: buffer.readUInt32LE(offset + 1), width: 5, signed: false };
    case I32_ZERO: return { value: 0, width: 1, signed: true };
    case I32_BYTE: return { value: buffer.readInt8(offset + 1), width: 2, signed: true };
    case I32_16: return { value: buffer.readInt16LE(offset + 1), width: 3, signed: true };
    case I32_24: {
      let v = buffer[offset + 1] | (buffer[offset + 2] << 8) | (buffer[offset + 3] << 16);
      if (v & 0x800000) v |= 0xff000000;
      return { value: v | 0, width: 4, signed: true };
    }
    default: return null;
  }
}

function encodeInt(value: number, signed: boolean): Buffer {
  if (!signed) {
    if (value === 0) return Buffer.from([U32_ZERO]);
    if (value === 1) return Buffer.from([U32_ONE]);
    if (value <= 0xff) return Buffer.from([U32_BYTE, value]);
    if (value <= 0xffff) { const b = Buffer.allocUnsafe(3); b[0] = U32_16; b.writeUInt16LE(value, 1); return b; }
    if (value <= 0xffffff) return Buffer.from([U32_24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
    const b = Buffer.allocUnsafe(5); b[0] = U32_FULL; b.writeUInt32LE(value, 1); return b;
  }
  if (value === 0) return Buffer.from([I32_ZERO]);
  if (value >= -128 && value <= 127) { const b = Buffer.allocUnsafe(2); b[0] = I32_BYTE; b.writeInt8(value, 1); return b; }
  if (value >= -32768 && value <= 32767) { const b = Buffer.allocUnsafe(3); b[0] = I32_16; b.writeInt16LE(value, 1); return b; }
  return Buffer.from([I32_24, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
}

interface ValuePosition {
  slot: number;
  start: number;
  end: number;
  value: number;
  signed: boolean;
}

/**
 * Decodes the leading u32-family values of a record's first group, returning
 * their byte spans so individual slots can be rewritten. Stops at the first
 * value that is not u32-family, which is enough to reach the slots of interest.
 */
export function readLeadingValues(record: CaabRecordNode, source: Buffer, limit: number): ValuePosition[] {
  const out: ValuePosition[] = [];
  const group = record.groups[0];
  if (!group) {
    return out;
  }
  for (const item of group) {
    if (item.kind !== "raw") {
      continue;
    }
    let offset = item.start;
    while (offset < item.end && out.length < limit) {
      const decoded = decodeInt(source, offset);
      if (!decoded) {
        return out;
      }
      out.push({
        slot: out.length,
        start: offset,
        end: offset + decoded.width,
        value: decoded.value,
        signed: decoded.signed,
      });
      offset += decoded.width;
    }
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/** Replaces a decoded value in place, splitting the raw span that holds it. */
export function rewriteValueAt(record: CaabRecordNode, position: ValuePosition, value: number): boolean {
  const group = record.groups[0];
  if (!group) {
    return false;
  }
  for (let index = 0; index < group.length; index += 1) {
    const item = group[index];
    if (item.kind !== "raw" || position.start < item.start || position.end > item.end) {
      continue;
    }
    const replacement: CaabItem[] = [];
    if (position.start > item.start) {
      replacement.push({ kind: "raw", start: item.start, end: position.start });
    }
    replacement.push({ kind: "bytes", data: encodeInt(value, position.signed) });
    if (position.end < item.end) {
      replacement.push({ kind: "raw", start: position.end, end: item.end });
    }
    group.splice(index, 1, ...replacement);
    return true;
  }
  return false;
}

export interface CaiFactionFixReport {
  factionIdFrom: number;
  factionIdTo: number;
  idsReassigned: { slot: number; from: number; to: number }[];
}

/**
 * Points a cloned CAI_FACTION row at the new faction and gives it fresh ids.
 * `nextId` is called per id slot and must return a value unused anywhere.
 */
export function fixClonedCaiFaction(
  clonedRow: CaabItem[],
  source: Buffer,
  newFactionId: number,
  nextId: (slot: number, current: number) => number
): CaiFactionFixReport | null {
  // CAI_FACTION is not necessarily a direct child of the row; the BDI wrapper
  // records sit between, so search the subtree.
  const findRecord = (items: CaabItem[]): CaabRecordNode | null => {
    for (const item of items) {
      if (item.kind !== "record") continue;
      if (item.name === "CAI_FACTION") return item;
      for (const group of item.groups) {
        const nested = findRecord(group);
        if (nested) return nested;
      }
    }
    return null;
  };
  const record = findRecord(clonedRow);
  if (!record) {
    return null;
  }

  const values = readLeadingValues(record, source, 8);
  const factionSlot = values.find((v) => v.slot === CAI_FACTION_SLOTS.factionIdSlot);
  if (!factionSlot) {
    return null;
  }

  const report: CaiFactionFixReport = {
    factionIdFrom: factionSlot.value,
    factionIdTo: newFactionId,
    idsReassigned: [],
  };

  // Rewrite from the highest offset down, so earlier spans keep their positions.
  const targets = [
    ...CAI_FACTION_SLOTS.idSlots
      .map((slot) => values.find((v) => v.slot === slot))
      .filter((v): v is ValuePosition => v !== undefined && v.value !== 0)
      .map((v) => ({ position: v, value: nextId(v.slot, v.value) })),
    { position: factionSlot, value: newFactionId },
  ].sort((a, b) => b.position.start - a.position.start);

  for (const target of targets) {
    if (!rewriteValueAt(record, target.position, target.value)) {
      throw new Error(`Could not rewrite CAI_FACTION slot ${target.position.slot}.`);
    }
    if (target.position !== factionSlot) {
      report.idsReassigned.push({
        slot: target.position.slot,
        from: target.position.value,
        to: target.value,
      });
    }
  }

  return report;
}
