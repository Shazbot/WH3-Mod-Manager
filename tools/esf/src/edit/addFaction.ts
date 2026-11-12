import { CaabStringTables } from "../esf/codecs/caabBinary";
import { CaabItem, CaabRecordNode } from "../esf/codecs/caabTree";

/**
 * Faction ids in the diplomacy matrix are the FACTION_ARRAY index plus two:
 * the faction at index 0 has id 2, and a 534-faction startpos spans ids 2..535.
 * Every faction's OLD_DIPLOMACY_RELATIONSHIP lists all ids except its own, in
 * ascending order, with the id as the group's leading u32.
 */
export const FACTION_ID_BASE = 2;

/** Lists that carry exactly one group per faction and must grow alongside FACTION_ARRAY. */
export const FACTION_INDEXED_RECORDS = [
  "FACTION_INFOS",
  "SPYING_ARRAY",
  "FACTION_TARGETS",
  "FACTION_FAVOUR_POINTS",
  "FACTION_STRATEGIC_THREAT_DATA",
  "CAI_WORLD_TECHNOLOGY_TREES",
  "CAI_WORLD_GOVERNORSHIPS",
  "CAMPAIGN_PLAYER_SETUP",
  "CAI_FACTION_STRATEGIC_STANCE",
  /** These records hold N+1 groups rather than N. Their extra id-1 row is not
   * in the same position in every record; see FACTION_INDEXED_EXTRA_ROW_ORDER. */
  "CAI_WORLD_FACTIONS",
  "CAI_BDI_COMPONENT_BLOCK_OWNS",
  "FACTION_PLAGUES_DATA",
] as const;

/**
 * Faction-indexed records whose group headers also store the faction ID as the
 * first u32 in each group. Removing a group alone leaves a gap in those IDs.
 * The sequence is validated against FACTION_ARRAY before the editor rewrites it.
 */
export const EXPLICIT_FACTION_ID_INDEXED_RECORDS = [
  "FACTION_STRATEGIC_THREAT_DATA",
  "FACTION_FAVOUR_POINTS",
  "FACTION_TARGETS",
  "FACTION_PLAGUES_DATA",
] as const;

/** Position of the extra id-1 participant in records with N+1 groups. */
export const FACTION_INDEXED_EXTRA_ROW_ORDER: Partial<
  Record<(typeof FACTION_INDEXED_RECORDS)[number], "leading" | "trailing">
> = {
  CAI_WORLD_FACTIONS: "trailing",
  CAI_BDI_COMPONENT_BLOCK_OWNS: "leading",
  FACTION_PLAGUES_DATA: "leading",
};

const MARKER_ASCII = 0x0f;
const MARKER_U32_ZERO = 0x14;
const MARKER_U32_ONE = 0x15;
const MARKER_U32_BYTE = 0x16;
const MARKER_U32_16BIT = 0x17;
const MARKER_U32_24BIT = 0x18;
const MARKER_U32 = 0x08;

export interface DecodedU32 {
  value: number;
  /** Byte length of the encoded value, marker included. */
  width: number;
}

/** Reads one of the u32-family encodings, which vary in width by magnitude. */
export function decodeU32(buffer: Buffer, offset: number): DecodedU32 {
  switch (buffer[offset]) {
    case MARKER_U32_ZERO:
      return { value: 0, width: 1 };
    case MARKER_U32_ONE:
      return { value: 1, width: 1 };
    case MARKER_U32_BYTE:
      return { value: buffer[offset + 1], width: 2 };
    case MARKER_U32_16BIT:
      return { value: buffer.readUInt16LE(offset + 1), width: 3 };
    case MARKER_U32_24BIT:
      return {
        value: buffer.readUIntBE(offset + 1, 3),
        width: 4,
      };
    case MARKER_U32:
      return { value: buffer.readUInt32LE(offset + 1), width: 5 };
    default:
      throw new Error(`Expected a u32 value at offset ${offset}, found marker 0x${buffer[offset].toString(16)}.`);
  }
}

/** Encodes a u32 in the narrowest form the file itself uses for that magnitude. */
export function encodeU32(value: number): Buffer {
  if (value === 0) return Buffer.from([MARKER_U32_ZERO]);
  if (value === 1) return Buffer.from([MARKER_U32_ONE]);
  if (value <= 0xff) return Buffer.from([MARKER_U32_BYTE, value]);
  if (value <= 0xffff) {
    const out = Buffer.allocUnsafe(3);
    out[0] = MARKER_U32_16BIT;
    out.writeUInt16LE(value, 1);
    return out;
  }
  if (value <= 0xffffff) {
    return Buffer.from([MARKER_U32_24BIT, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  }
  const out = Buffer.allocUnsafe(5);
  out[0] = MARKER_U32;
  out.writeUInt32LE(value, 1);
  return out;
}

export function encodeAscii(stringId: number): Buffer {
  const out = Buffer.allocUnsafe(5);
  out[0] = MARKER_ASCII;
  out.writeUInt32LE(stringId, 1);
  return out;
}

/**
 * Copies a record subtree. Raw spans are shared rather than copied because they
 * are immutable descriptors into the source buffer, but record nodes must be
 * distinct objects: the writer caches measured sizes on them, and a node
 * appearing twice would be measured for one position and written in another.
 */
export function cloneItem(item: CaabItem): CaabItem {
  if (item.kind !== "record") {
    return item;
  }
  const copy: CaabRecordNode = {
    ...item,
    groups: item.groups.map((group) => group.map(cloneItem)),
    groupSizeWidths: [...item.groupSizeWidths],
    blockSize: undefined,
    groupSizes: undefined,
    totalSize: undefined,
  };
  return copy;
}

export function findRecords(node: CaabRecordNode, name: string, found: CaabRecordNode[] = []): CaabRecordNode[] {
  for (const group of node.groups) {
    for (const item of group) {
      if (item.kind === "record") {
        if (item.name === name) {
          found.push(item);
        }
        findRecords(item, name, found);
      }
    }
  }
  return found;
}

export function findFirstRecord(node: CaabRecordNode, name: string): CaabRecordNode | null {
  for (const group of node.groups) {
    for (const item of group) {
      if (item.kind === "record") {
        if (item.name === name) {
          return item;
        }
        const nested = findFirstRecord(item, name);
        if (nested) {
          return nested;
        }
      }
    }
  }
  return null;
}

/**
 * Rewrites the leading faction id of a relationship group. The id sits at the
 * very start of the group and its encoding width depends on its magnitude, so
 * the head of the first span is replaced wholesale rather than patched in place.
 */
export function retargetRelationshipGroup(group: CaabItem[], source: Buffer, newId: number): CaabItem[] {
  const first = group[0];
  if (!first) {
    throw new Error("Relationship group is empty.");
  }

  const out: CaabItem[] = [{ kind: "bytes", data: encodeU32(newId) }];

  if (first.kind === "raw") {
    const existing = decodeU32(source, first.start);
    if (first.start + existing.width < first.end) {
      out.push({ kind: "raw", start: first.start + existing.width, end: first.end });
    }
  } else if (first.kind === "bytes") {
    // A transplanted group carries its own bytes rather than pointing into the
    // destination buffer, so the id is decoded from those.
    const existing = decodeU32(first.data, 0);
    if (existing.width < first.data.length) {
      out.push({ kind: "bytes", data: Buffer.from(first.data.subarray(existing.width)) });
    }
  } else {
    throw new Error("Relationship group starts with a record.");
  }

  return [...out, ...group.slice(1).map(cloneItem)];
}

/** Reads the leading faction id of a relationship group. */
export function relationshipGroupId(group: CaabItem[], source: Buffer): number {
  const first = group[0];
  if (!first) {
    throw new Error("Relationship group is empty.");
  }
  if (first.kind === "raw") {
    return decodeU32(source, first.start).value;
  }
  if (first.kind === "bytes") {
    return decodeU32(first.data, 0).value;
  }
  throw new Error("Relationship group starts with a record.");
}

/** Validates a faction-keyed group list whose rows may be stored in any order. */
export function validateFactionIdPermutation(
  groups: CaabItem[][],
  source: Buffer,
  recordName: string,
  factionCount: number
): number[] {
  const ids = groups.map((group) => relationshipGroupId(group, source));
  const expected = new Set(Array.from({ length: factionCount }, (_, index) => index + FACTION_ID_BASE));
  if (ids.length !== factionCount || new Set(ids).size !== factionCount || ids.some((id) => !expected.has(id))) {
    throw new Error(recordName + " faction IDs are incomplete, duplicated, or outside the expected range.");
  }
  return ids;
}

/**
 * Appends a UTF-8 string and returns its id. Ids are stored explicitly beside
 * each entry rather than implied by position, so a new entry only needs an id
 * nothing else uses; existing references are unaffected.
 */
export function appendUtf8String(tables: CaabStringTables, text: string): number {
  let maxId = -1;
  for (const id of tables.utf8ById.keys()) {
    if (id > maxId) {
      maxId = id;
    }
  }
  const newId = maxId + 1;

  tables.utf8ById.set(newId, text);
  tables.entries.push({ id: newId, text, offset: 0, length: Buffer.byteLength(text, "utf8"), table: "utf8" });
  return newId;
}

/**
 * Replaces the faction key inside a cloned FACTION record. The key is the first
 * ascii value in the record's leading raw span.
 */
export function retargetFactionKey(faction: CaabRecordNode, source: Buffer, newStringId: number): boolean {
  const group = faction.groups[0];
  if (!group) {
    return false;
  }

  for (let index = 0; index < group.length; index += 1) {
    const item = group[index];
    if (item.kind !== "raw") {
      continue;
    }
    for (let offset = item.start; offset + 5 <= item.end; offset += 1) {
      if (source[offset] !== MARKER_ASCII) {
        continue;
      }
      const replacement: CaabItem[] = [];
      if (offset > item.start) {
        replacement.push({ kind: "raw", start: item.start, end: offset });
      }
      replacement.push({ kind: "bytes", data: encodeAscii(newStringId) });
      if (offset + 5 < item.end) {
        replacement.push({ kind: "raw", start: offset + 5, end: item.end });
      }
      group.splice(index, 1, ...replacement);
      return true;
    }
  }
  return false;
}
