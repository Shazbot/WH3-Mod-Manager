import type { SearchMatcher } from "./matcher";
import { makeMatchExcerpt, type ScanMatches } from "./textScan";

export interface ByteScanLimits {
  maxMatches?: number;
  maxExcerptLength?: number;
  chunkBytes?: number;
  overlapBytes?: number;
}

export interface ByteScanMatch {
  offset: number;
  encoding: "utf8" | "utf16le";
  excerpt: string;
  matchStartInExcerpt: number;
  matchEndInExcerpt: number;
}

const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_OVERLAP_BYTES = 64 * 1024;

const constrainWholeFileAnchors = (pattern: RegExp, allowStart: boolean, allowEnd: boolean): RegExp => {
  if (allowStart && allowEnd) return pattern;

  let source = "";
  let inCharacterClass = false;
  for (let index = 0; index < pattern.source.length; index++) {
    const character = pattern.source[index];
    if (character === "\\") {
      source += character;
      if (index + 1 < pattern.source.length) source += pattern.source[++index];
      continue;
    }
    if (character === "[") inCharacterClass = true;
    if (character === "]" && inCharacterClass) inCharacterClass = false;
    const disabledStart = character === "^" && !inCharacterClass && !allowStart;
    const disabledEnd = character === "$" && !inCharacterClass && !allowEnd;
    source += disabledStart || disabledEnd ? "(?!)" : character;
  }
  return new RegExp(source, pattern.flags);
};

const withGlobal = (pattern: RegExp): RegExp => {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags.replace("y", ""));
};

const forEachDecodedMatch = (
  value: string,
  matcher: SearchMatcher,
  allowStart: boolean,
  allowEnd: boolean,
  visit: (start: number, end: number) => boolean,
): boolean => {
  if (!matcher.isValidRegex || matcher.isEmpty) return false;
  const constrained = constrainWholeFileAnchors(matcher.toRegExp(), allowStart, allowEnd);
  const pattern = withGlobal(constrained);
  let foundAny = false;
  for (;;) {
    const found = pattern.exec(value);
    if (!found) break;
    const start = found.index;
    const end = start + found[0].length;
    foundAny = true;
    if (!visit(start, end)) return true;
    if (found[0].length === 0) pattern.lastIndex++;
  }
  return foundAny;
};

/** Boolean counterpart used by the legacy streaming pack search. */
export const containsBytesInWindow = (
  buffer: Buffer,
  matcher: SearchMatcher,
  allowStart: boolean,
  allowEnd: boolean,
): boolean =>
  forEachDecodedMatch(buffer.toString("utf8"), matcher, allowStart, allowEnd, () => false) ||
  forEachDecodedMatch(buffer.toString("utf16le"), matcher, allowStart, allowEnd, () => false) ||
  forEachDecodedMatch(buffer.subarray(1).toString("utf16le"), matcher, allowStart, allowEnd, () => false);

/**
 * Moves a window start off a UTF-8 continuation byte (10xxxxxx).
 *
 * A window after the first begins at `baseStart - overlapBytes`, an arbitrary byte that can land
 * inside a multi-byte sequence. Decoding from there emits U+FFFD for the broken head, which encodes
 * back to three bytes where the original was one or two - so every byte offset derived from the
 * decoded string past that point would be wrong. At most three bytes are skipped, and they are
 * inside the overlap, so any match there was already reported by the previous window.
 */
const alignToUtf8Boundary = (buffer: Buffer, start: number): number => {
  const limit = Math.min(buffer.length, start + 4);
  let aligned = start;
  while (aligned < limit && (buffer[aligned] & 0xc0) === 0x80) aligned++;
  return aligned;
};

/**
 * Byte offset of a string index, resolved forward from the previous call.
 *
 * Matches arrive in ascending index order within one decoded window, so measuring only the gap since
 * the last match makes the whole window cost one pass instead of one per match - which for a 4 MiB
 * window and twenty matches is the difference between 4 MiB and 80 MiB of copying.
 */
const makeUtf8OffsetCursor = () => {
  let lastIndex = 0;
  let lastByteOffset = 0;
  return (value: string, index: number): number => {
    if (index < lastIndex) {
      lastIndex = 0;
      lastByteOffset = 0;
    }
    lastByteOffset += Buffer.byteLength(value.slice(lastIndex, index), "utf8");
    lastIndex = index;
    return lastByteOffset;
  };
};

/**
 * Searches the two text decodings used by binary pack payloads. Overlapping windows retain matches
 * that straddle a read boundary, while the offset/encoding key removes duplicates from the overlap.
 */
export const scanBytesForMatches = (
  buffer: Buffer,
  matcher: SearchMatcher,
  {
    maxMatches = Number.POSITIVE_INFINITY,
    maxExcerptLength = 240,
    chunkBytes = DEFAULT_CHUNK_BYTES,
    overlapBytes = DEFAULT_OVERLAP_BYTES,
  }: ByteScanLimits = {},
): ScanMatches<ByteScanMatch> => {
  const matches: ByteScanMatch[] = [];
  if (matcher.isEmpty || !matcher.isValidRegex || maxMatches <= 0 || buffer.length === 0) {
    Object.defineProperty(matches, "truncated", { value: false, enumerable: false });
    return matches as ScanMatches<ByteScanMatch>;
  }

  const seen = new Set<string>();
  let truncated = false;
  const safeChunkBytes = Math.max(1, chunkBytes);
  const safeOverlapBytes = Math.min(Math.max(0, overlapBytes), safeChunkBytes);

  const addMatches = (
    decoded: string,
    encoding: "utf8" | "utf16le",
    windowStart: number,
    alignment: number,
    isFirstWindow: boolean,
    isLastWindow: boolean,
  ): boolean => {
    const utf8OffsetAt = makeUtf8OffsetCursor();
    forEachDecodedMatch(decoded, matcher, isFirstWindow && alignment === 0, isLastWindow, (start, end) => {
      const offset =
        encoding === "utf8" ? windowStart + utf8OffsetAt(decoded, start) : windowStart + alignment + start * 2;
      const key = `${encoding}:${offset}:${end - start}`;
      if (seen.has(key)) return true;
      seen.add(key);
      // Checked before keeping it, so `truncated` means "a further match exists" rather than "the
      // cap was reached" - the same lookahead scanTextForMatches reports. It also avoids building an
      // excerpt for a match that is only being used to answer that question.
      if (matches.length >= maxMatches) {
        truncated = true;
        return false;
      }
      const excerpt = makeMatchExcerpt(decoded, start, end, maxExcerptLength);
      matches.push({ offset, encoding, ...excerpt });
      return true;
    });
    if (truncated) return false;
    return true;
  };

  for (let baseStart = 0; baseStart < buffer.length && !truncated; baseStart += safeChunkBytes) {
    const windowStart = Math.max(0, baseStart - safeOverlapBytes);
    const windowEnd = Math.min(buffer.length, baseStart + safeChunkBytes);
    const isFirstWindow = baseStart === 0;
    const isLastWindow = windowEnd === buffer.length;
    const window = buffer.subarray(windowStart, windowEnd);

    const utf8Start = alignToUtf8Boundary(buffer, windowStart);
    const utf8Window = utf8Start === windowStart ? window : buffer.subarray(utf8Start, windowEnd);
    if (
      !addMatches(utf8Window.toString("utf8"), "utf8", utf8Start, 0, isFirstWindow && utf8Start === 0, isLastWindow)
    ) {
      break;
    }
    if (!addMatches(window.toString("utf16le"), "utf16le", windowStart, 0, isFirstWindow, isLastWindow)) break;
    if (window.length > 1) {
      if (!addMatches(window.subarray(1).toString("utf16le"), "utf16le", windowStart, 1, isFirstWindow, isLastWindow))
        break;
    }
  }

  Object.defineProperty(matches, "truncated", { value: truncated, enumerable: false });
  return matches as ScanMatches<ByteScanMatch>;
};

export { constrainWholeFileAnchors };
