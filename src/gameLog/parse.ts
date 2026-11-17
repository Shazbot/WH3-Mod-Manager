// Pure helpers for the Game Log tab. Renderer-side: no node: or fs imports.

export const OTHER_TAG = "(other)";

const PREFIX_PATTERN = /^\[([^\]]+)\] <([\d.]+)s> {1,5}/;
const ERROR_PATTERN = /script error|stack traceback|attempt to (index|call|perform|compare|concatenate)|\.lua:\d+:/i;

export type ParsedLine = { tag?: string; time?: string; body: string };
export type PrefixMode = "full" | "hideTimestamp" | "hideTagAndTimestamp";

/** `[tag] <150.8s>    <TABs>message` -> parts. Lines without that prefix have only a body. */
export const parseLine = (line: string): ParsedLine => {
  const match = PREFIX_PATTERN.exec(line);
  if (!match) return { body: line };
  return { tag: match[1], time: match[2], body: line.slice(match[0].length) };
};

/** Removes the prefix per mode. The scripts' own leading TABs are kept. */
export const stripPrefix = (line: string, mode: PrefixMode): string => {
  if (mode === "full") return line;
  const match = PREFIX_PATTERN.exec(line);
  if (!match) return line;
  if (mode === "hideTagAndTimestamp") return line.slice(match[0].length);
  // Hide timestamp only: keep the tag, drop "<150.8s>" and the spacing after it.
  const tag = /^\[[^\]]+\]/.exec(line)?.[0] ?? "";
  return `${tag} ${line.slice(match[0].length)}`;
};

export const isErrorLine = (line: string) => ERROR_PATTERN.test(line);

const ERROR_START_PATTERN = /script error/i;
/** A SCRIPT ERROR's "stack traceback:" follows about 4 lines later; matches this close belong to the same error. */
const ERROR_GROUP_LINES = 6;

/** Running error count, resumable across chunks of one log. */
export type ErrorCountState = { errors: number; linesSinceMatch: number };
export const initialErrorCountState = (): ErrorCountState => ({ errors: 0, linesSinceMatch: ERROR_GROUP_LINES + 1 });

/** Counts errors, not error lines: a SCRIPT ERROR line, or an error line not just after another one, starts a new one. */
export const countErrors = (
  lines: Iterable<string>,
  state: ErrorCountState = initialErrorCountState(),
): ErrorCountState => {
  let { errors, linesSinceMatch } = state;
  for (const line of lines) {
    linesSinceMatch++;
    if (!ERROR_PATTERN.test(line)) continue;
    if (ERROR_START_PATTERN.test(line) || linesSinceMatch > ERROR_GROUP_LINES) errors++;
    linesSinceMatch = 0;
  }
  return { errors, linesSinceMatch: Math.min(linesSinceMatch, ERROR_GROUP_LINES + 1) };
};

export const tagOf = (line: string): string => parseLine(line).tag ?? OTHER_TAG;

export const compileQuery = (
  pattern: string,
  options: { isRegex: boolean; caseSensitive: boolean },
): RegExp | { error: string } | undefined => {
  if (!pattern) return undefined;
  try {
    return new RegExp(
      options.isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      options.caseSensitive ? "" : "i",
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid regular expression" };
  }
};

export const isCompileError = (value: ReturnType<typeof compileQuery>): value is { error: string } =>
  value !== undefined && !(value instanceof RegExp);

export type VisibleRow = { kind: "line"; index: number } | { kind: "separator" };

export type FilterOptions = {
  include?: RegExp;
  exclude?: RegExp;
  hiddenTags?: ReadonlySet<string>;
  context?: number;
};

/** Counts per tag, with unprefixed lines under OTHER_TAG. */
export const countTags = (lines: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const tag = tagOf(line);
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
};

/**
 * Hidden channels and the exclude pattern remove lines outright. The include pattern selects lines
 * to keep and, like `grep -C`, pulls in `context` surrounding visible lines (overlapping hunks
 * merge, a separator marks each gap). Context never resurrects a hidden or excluded line.
 */
export const filterLines = (lines: readonly string[], options: FilterOptions): VisibleRow[] => {
  const { include, exclude, hiddenTags, context = 0 } = options;
  const visible: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (hiddenTags && hiddenTags.size > 0 && hiddenTags.has(tagOf(line))) continue;
    if (exclude && exclude.test(line)) continue;
    visible.push(index);
  }

  if (!include) return visible.map((index) => ({ kind: "line", index }));

  const n = Math.max(0, Math.floor(context));
  const keep = new Uint8Array(visible.length);
  for (let position = 0; position < visible.length; position++) {
    if (!include.test(lines[visible[position]])) continue;
    const end = Math.min(visible.length - 1, position + n);
    for (let marked = Math.max(0, position - n); marked <= end; marked++) keep[marked] = 1;
  }

  const rows: VisibleRow[] = [];
  let lastPosition = -1;
  for (let position = 0; position < visible.length; position++) {
    if (!keep[position]) continue;
    if (lastPosition !== -1 && position > lastPosition + 1) rows.push({ kind: "separator" });
    rows.push({ kind: "line", index: visible[position] });
    lastPosition = position;
  }
  return rows;
};
