import { CaabHeaderFields, CaabStringTables, walkCaabNodes } from "./caabBinary";

const RECORD_FLAG_HAS_NESTED_BLOCKS = 0x40;
const RECORD_FLAG_HAS_NON_OPTIMIZED_INFO = 0x20;

/**
 * A run of bytes inside the node section that the tree deliberately does not
 * interpret. Values (ints, strings, coords, arrays) are opaque here: rewriting
 * a record's group counts and block sizes never needs to understand them, and
 * copying them verbatim removes a whole class of encoder bugs.
 */
export interface CaabRawSpan {
  kind: "raw";
  start: number;
  end: number;
}

export interface CaabRecordNode {
  kind: "record";
  name: string;
  nameIndex: number;
  version: number;
  /** The original marker byte, reused verbatim when writing. */
  flags: number;
  isRoot: boolean;
  hasNestedBlocks: boolean;
  groups: CaabItem[][];

  /**
   * Byte widths the file used for each CAULEB128 field. Shipped files pad some
   * of these (a leading 0x80 encodes a zero group and changes nothing), so the
   * writer reproduces the original width instead of always emitting the minimal
   * form. Widths are treated as a floor: a value that outgrows its original
   * encoding is written wider.
   */
  blockSizeWidth: number;
  groupCountWidth: number;
  groupSizeWidths: number[];

  /** Filled in by the writer's measure pass; see `measureRecord`. */
  blockSize?: number;
  groupSizes?: number[];
  totalSize?: number;
}

/**
 * Literal bytes substituted for part of the original buffer. Used to swap a
 * value's encoding for a new one without teaching the tree how values work.
 */
export interface CaabBytes {
  kind: "bytes";
  data: Buffer;
}

export type CaabItem = CaabRawSpan | CaabBytes | CaabRecordNode;

// Big-endian LEB128, matching readCauleb128 in caabBinary.
function readCauleb128(buffer: Buffer, offset: number): { value: number; nextOffset: number } {
  let value = 0;
  let cursor = offset;
  for (let index = 0; index < 5 && cursor < buffer.length; index += 1) {
    const byte = buffer[cursor];
    cursor += 1;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: cursor };
    }
  }
  throw new Error(`Invalid CAULEB128 integer at offset ${offset}.`);
}

interface ChildEntry {
  node: CaabRecordNode;
  start: number;
  end: number;
}

interface OpenRecord {
  node: CaabRecordNode;
  /** Byte ranges of each group's contents, excluding the group-size prefixes. */
  groupRanges: { start: number; end: number }[];
  /** Child records collected per group, in file order, with the byte range each spans. */
  groupChildren: ChildEntry[][];
  /** Index of the group the next child can belong to; children arrive in file order. */
  groupCursor: number;
  blockStartOffset: number;
  blockEndOffset: number;
}

/**
 * Computes each group's byte range for a record. Group sizes are CAULEB128
 * values stored at the start of the block, immediately before each group's
 * contents, so the ranges have to be read rather than derived.
 */
function readGroupRanges(
  buffer: Buffer,
  blockStartOffset: number,
  blockEndOffset: number,
  groupCount: number,
  hasNestedBlocks: boolean
): { ranges: { start: number; end: number }[]; widths: number[] } {
  if (!hasNestedBlocks) {
    return { ranges: [{ start: blockStartOffset, end: blockEndOffset }], widths: [] };
  }

  const ranges: { start: number; end: number }[] = [];
  const widths: number[] = [];
  let offset = blockStartOffset;
  for (let index = 0; index < groupCount; index += 1) {
    const sizeInfo = readCauleb128(buffer, offset);
    const start = sizeInfo.nextOffset;
    const end = start + sizeInfo.value;
    if (end > blockEndOffset) {
      throw new Error(`CAAB group ${index} at ${offset} exceeds its block (${end} > ${blockEndOffset}).`);
    }
    ranges.push({ start, end });
    widths.push(sizeInfo.nextOffset - offset);
    offset = end;
  }
  if (offset !== blockEndOffset) {
    throw new Error(`CAAB group list ended at ${offset}, expected ${blockEndOffset}.`);
  }
  return { ranges, widths };
}

/** Turns a group's child records plus the gaps between them into an item list. */
function buildGroupItems(
  range: { start: number; end: number },
  children: ChildEntry[]
): CaabItem[] {
  const items: CaabItem[] = [];
  let cursor = range.start;

  for (const child of children) {
    if (child.start > cursor) {
      items.push({ kind: "raw", start: cursor, end: child.start });
    }
    items.push(child.node);
    cursor = child.end;
  }

  if (cursor < range.end) {
    items.push({ kind: "raw", start: cursor, end: range.end });
  }
  return items;
}

/**
 * Builds an editable tree of the node section. Only records become nodes; every
 * other byte stays as an opaque span, which keeps the tree proportional to the
 * record count rather than the value count.
 */
export function buildCaabTree(
  buffer: Buffer,
  header: Pick<CaabHeaderFields, "recordNamesOffset">,
  tables: Pick<CaabStringTables, "recordNames" | "utf8ById" | "utf16ById">
): CaabRecordNode {
  const stack: OpenRecord[] = [];
  const recordNameIndex = new Map<string, number>();
  tables.recordNames.forEach((name, index) => {
    if (!recordNameIndex.has(name)) recordNameIndex.set(name, index);
  });
  let root: CaabRecordNode | null = null;

  walkCaabNodes(buffer, header, tables, {
    onRecordStart(record) {
      const isRoot = stack.length === 0;
      const hasNestedBlocks = (record.flags & RECORD_FLAG_HAS_NESTED_BLOCKS) !== 0;

      // Re-read the record's own size fields so their original encoded widths
      // are preserved; the walker reports the values but not how wide they were.
      const sizeFieldOffset = record.startOffset + 1 + (isRoot || (record.flags & RECORD_FLAG_HAS_NON_OPTIMIZED_INFO) !== 0 ? 3 : 1);
      const blockSizeInfo = readCauleb128(buffer, sizeFieldOffset);
      const blockSizeWidth = blockSizeInfo.nextOffset - sizeFieldOffset;
      let groupCountWidth = 0;
      if (hasNestedBlocks) {
        const groupCountInfo = readCauleb128(buffer, blockSizeInfo.nextOffset);
        groupCountWidth = groupCountInfo.nextOffset - blockSizeInfo.nextOffset;
      }

      const node: CaabRecordNode = {
        kind: "record",
        name: record.name,
        nameIndex: 0, // resolved below from the record-name table
        version: record.version,
        flags: record.flags,
        isRoot,
        hasNestedBlocks,
        groups: [],
        blockSizeWidth,
        groupCountWidth,
        groupSizeWidths: [],
      };

      const nameIndex = recordNameIndex.get(record.name) ?? -1;
      if (nameIndex < 0) {
        throw new Error(`Record name ${record.name} is not in the record-name table.`);
      }
      node.nameIndex = nameIndex;

      const { ranges: groupRanges, widths: groupSizeWidths } = readGroupRanges(
        buffer,
        record.blockStartOffset,
        record.blockEndOffset,
        record.groupCount,
        hasNestedBlocks
      );
      node.groupSizeWidths = groupSizeWidths;

      stack.push({
        node,
        groupRanges,
        groupChildren: groupRanges.map(() => []),
        groupCursor: 0,
        blockStartOffset: record.blockStartOffset,
        blockEndOffset: record.blockEndOffset,
      });

      if (isRoot) {
        root = node;
        return;
      }

      const parent = stack[stack.length - 2];
      const ranges = parent.groupRanges;
      while (parent.groupCursor < ranges.length && record.startOffset >= ranges[parent.groupCursor].end) {
        parent.groupCursor += 1;
      }
      const groupIndex = parent.groupCursor;
      if (
        groupIndex >= ranges.length ||
        record.startOffset < ranges[groupIndex].start ||
        record.blockEndOffset > ranges[groupIndex].end
      ) {
        throw new Error(`Record ${record.name} at ${record.startOffset} fell outside every parent group.`);
      }
      parent.groupChildren[groupIndex].push({ node, start: record.startOffset, end: record.blockEndOffset });
    },

    onRecordEnd() {
      const open = stack.pop();
      if (!open) {
        throw new Error("CAAB record end without a matching start.");
      }
      open.node.groups = open.groupRanges.map((range, index) =>
        buildGroupItems(range, open.groupChildren[index])
      );
    },
  });

  if (!root) {
    throw new Error("CAAB node section contained no root record.");
  }
  if (stack.length !== 0) {
    throw new Error(`CAAB tree ended with ${stack.length} unclosed records.`);
  }
  return root;
}

export function isRecordNode(item: CaabItem): item is CaabRecordNode {
  return item.kind === "record";
}

/**
 * Substitutes `data` for the original bytes in `[start, end)`. The range must
 * fall entirely inside one raw span — that is, it must cover whole values and
 * no part of any record header, which is what every caller here needs. The
 * surviving head and tail of the span are kept so nothing else shifts.
 *
 * Returns false when no span covered the range, so callers can fail loudly
 * rather than silently writing a file that kept its old bytes.
 */
export function replaceByteRange(root: CaabRecordNode, start: number, end: number, data: Buffer): boolean {
  if (end <= start) {
    throw new Error(`Invalid replacement range [${start}, ${end}).`);
  }

  const stack: CaabRecordNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as CaabRecordNode;

    for (const group of node.groups) {
      for (let index = 0; index < group.length; index += 1) {
        const item = group[index];

        if (item.kind === "record") {
          stack.push(item);
          continue;
        }
        if (item.kind !== "raw" || start < item.start || end > item.end) {
          continue;
        }

        const replacement: CaabItem[] = [];
        if (start > item.start) {
          replacement.push({ kind: "raw", start: item.start, end: start });
        }
        replacement.push({ kind: "bytes", data });
        if (end < item.end) {
          replacement.push({ kind: "raw", start: end, end: item.end });
        }
        group.splice(index, 1, ...replacement);
        return true;
      }
    }
  }

  return false;
}

export interface CaabByteReplacement {
  start: number;
  end: number;
  data: Buffer;
}

/** Applies ordered, non-overlapping value replacements with one tree traversal. */
export function replaceByteRanges(root: CaabRecordNode, replacements: CaabByteReplacement[]): number {
  if (replacements.length === 0) return 0;
  const ordered = [...replacements].sort((a, b) => a.start - b.start);
  for (let index = 0; index < ordered.length; index += 1) {
    const replacement = ordered[index];
    if (replacement.end <= replacement.start) {
      throw new Error(`Invalid replacement range [${replacement.start}, ${replacement.end}).`);
    }
    if (index > 0 && replacement.start < ordered[index - 1].end) {
      throw new Error(`Overlapping replacement ranges at ${replacement.start}.`);
    }
  }

  let replacementIndex = 0;
  const visitRecord = (record: CaabRecordNode): void => {
    for (const group of record.groups) {
      for (let index = 0; index < group.length; index += 1) {
        const item = group[index];
        if (item.kind === "record") {
          visitRecord(item);
          continue;
        }
        if (item.kind !== "raw") continue;

        const parts: CaabItem[] = [];
        let cursor = item.start;
        while (replacementIndex < ordered.length && ordered[replacementIndex].start < item.end) {
          const replacement = ordered[replacementIndex];
          if (replacement.start < item.start || replacement.end > item.end || replacement.start < cursor) {
            throw new Error(`Replacement range [${replacement.start}, ${replacement.end}) is not covered by one raw span.`);
          }
          if (replacement.start > cursor) parts.push({ kind: "raw", start: cursor, end: replacement.start });
          parts.push({ kind: "bytes", data: replacement.data });
          cursor = replacement.end;
          replacementIndex += 1;
        }
        if (parts.length === 0) continue;
        if (cursor < item.end) parts.push({ kind: "raw", start: cursor, end: item.end });
        group.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
    }
  };

  visitRecord(root);
  if (replacementIndex !== ordered.length) {
    const missing = ordered[replacementIndex];
    throw new Error(`No raw span covered replacement range [${missing.start}, ${missing.end}).`);
  }
  return replacementIndex;
}

export function recordUsesNonOptimizedHeader(node: CaabRecordNode): boolean {
  return node.isRoot || (node.flags & RECORD_FLAG_HAS_NON_OPTIMIZED_INFO) !== 0;
}
