import * as cheerio from "cheerio";
import * as luaparse from "luaparse";

/** How a rule decides which files it applies to. */
export type TextFileTargetMatch = "path" | "name" | "regex";

/** Which syntax the selector is written in. */
export type TextFileEditMode = "xml" | "lua" | "text";

export type TextFileEditOperation =
  | "replace"
  | "insertBefore"
  | "insertAfter"
  | "delete"
  | "setAttribute";

export interface TextFileEditRule {
  id: string;
  targetMatch: TextFileTargetMatch;
  /** A pack path, a bare file name, or a regular expression, per targetMatch. */
  target: string;
  mode: TextFileEditMode;
  /** A CSS selector for xml, a function name or literal text for lua, literal text for plain text. */
  selector: string;
  operation: TextFileEditOperation;
  attributeName?: string;
  value?: string;
  /** Report a rule that matched nothing even on an unattended run. */
  required?: boolean;
}

/** A span of the source a rule matched, in the order they appear. */
interface MatchedRange {
  start: number;
  /** Exclusive. */
  end: number;
  /** Replacement for the whole range, when the operation rewrites rather than splices around it. */
  replacement?: string;
}

export interface TextFileEditResult {
  text: string;
  /** How many places each rule changed, keyed by rule id. Zero means the rule found nothing. */
  matchCountByRuleId: Record<string, number>;
  errors: string[];
}

const normalizePackPath = (filePath: string) => filePath.replace(/\//g, "\\").toLowerCase();

/**
 * Whether a rule applies to a file.
 *
 * "path" is the whole pack path, "name" just the file name so a rule can find a script wherever it
 * lives, and "regex" is tested against the whole path for anything else. Slashes are normalized so a
 * target written either way matches.
 */
export const matchesTextFileTarget = (filePath: string, rule: TextFileEditRule): boolean => {
  const target = (rule.target || "").trim();
  if (!target) return false;

  const normalizedPath = normalizePackPath(filePath);

  if (rule.targetMatch === "regex") {
    try {
      return new RegExp(rule.target, "i").test(filePath);
    } catch {
      return false;
    }
  }

  if (rule.targetMatch === "name") {
    const fileName = normalizedPath.split("\\").pop() ?? "";
    return fileName === normalizePackPath(target);
  }

  return normalizedPath === normalizePackPath(target);
};

/** Splices the ranges into the source, back to front so earlier offsets stay valid. */
const applyRanges = (text: string, ranges: MatchedRange[]): string => {
  let edited = text;
  for (const range of [...ranges].sort((first, second) => second.start - first.start)) {
    edited = edited.slice(0, range.start) + (range.replacement ?? "") + edited.slice(range.end);
  }
  return edited;
};

/** Turns a matched span into the range the operation wants to write. */
const rangeForOperation = (
  rule: TextFileEditRule,
  start: number,
  end: number,
  matchedText: string,
): MatchedRange => {
  const value = rule.value ?? "";
  switch (rule.operation) {
    case "delete":
      return { start, end };
    case "insertBefore":
      return { start, end: start, replacement: value };
    case "insertAfter":
      return { start: end, end, replacement: value };
    case "replace":
    default:
      return { start, end, replacement: value || matchedText };
  }
};

/**
 * Edits XML by selecting elements and splicing the original text at their source offsets.
 *
 * Serializing the whole document would work, but it rewrites quoting and whitespace throughout the
 * file; splicing leaves everything the rule did not target byte-identical. Attribute changes
 * re-serialize only the matched element, so even then the normalization is confined to it.
 */
const applyXmlRule = (text: string, rule: TextFileEditRule): { ranges: MatchedRange[]; error?: string } => {
  let $: cheerio.CheerioAPI;
  try {
    // withStartIndices/withEndIndices are htmlparser2 options cheerio forwards but does not type.
    $ = cheerio.load(text, {
      xmlMode: true,
      withStartIndices: true,
      withEndIndices: true,
    } as cheerio.CheerioOptions);
  } catch (error) {
    return { ranges: [], error: `could not be parsed as XML: ${(error as Error).message}` };
  }

  let selected;
  try {
    selected = $(rule.selector);
  } catch (error) {
    return { ranges: [], error: `invalid selector '${rule.selector}': ${(error as Error).message}` };
  }

  const ranges: MatchedRange[] = [];
  selected.each((_index, element) => {
    const node = element as unknown as { startIndex: number | null; endIndex: number | null };
    if (node.startIndex == null || node.endIndex == null) return;

    const start = node.startIndex;
    // htmlparser2's endIndex points at the last character, not past it.
    const end = node.endIndex + 1;

    if (rule.operation === "setAttribute") {
      if (!rule.attributeName) return;
      $(element).attr(rule.attributeName, rule.value ?? "");
      ranges.push({ start, end, replacement: $.xml($(element)) });
      return;
    }

    ranges.push(rangeForOperation(rule, start, end, text.slice(start, end)));
  });

  return { ranges };
};

/**
 * Edits Lua by locating a statement and splicing the text around it.
 *
 * luaparse has no printer, so an AST can never be written back out; it is used purely to find where
 * something is. "function name" locates that declaration, anything else is literal text.
 */
const applyLuaRule = (text: string, rule: TextFileEditRule): { ranges: MatchedRange[]; error?: string } => {
  const functionMatch = rule.selector.match(/^function\s+([\w.:]+)$/);
  if (!functionMatch) {
    return { ranges: applyLiteralRule(text, rule) };
  }

  let ast: luaparse.Chunk;
  try {
    ast = luaparse.parse(text, { ranges: true, locations: false, comments: false });
  } catch (error) {
    return { ranges: [], error: `could not be parsed as Lua: ${(error as Error).message}` };
  }

  const wantedName = functionMatch[1];
  const ranges: MatchedRange[] = [];

  const identifierName = (identifier: unknown): string => {
    const node = identifier as { type?: string; name?: string; base?: unknown; identifier?: unknown };
    if (!node) return "";
    if (node.type === "Identifier") return node.name ?? "";
    // A method or table function: base.identifier, so rebuild the dotted name.
    if (node.base !== undefined) return `${identifierName(node.base)}.${identifierName(node.identifier)}`;
    return "";
  };

  const visit = (statements: unknown[]) => {
    for (const statement of statements) {
      const node = statement as { type?: string; identifier?: unknown; range?: [number, number]; body?: unknown[] };
      if (node.type === "FunctionDeclaration" && node.range) {
        const name = identifierName(node.identifier);
        if (name === wantedName || name.replace(/\./g, ":") === wantedName) {
          ranges.push(rangeForOperation(rule, node.range[0], node.range[1], text.slice(node.range[0], node.range[1])));
        }
      }
      if (Array.isArray(node.body)) visit(node.body);
    }
  };
  visit(ast.body);

  return { ranges };
};

/** Every occurrence of the selector, taken literally. */
const applyLiteralRule = (text: string, rule: TextFileEditRule): MatchedRange[] => {
  const needle = rule.selector;
  if (!needle) return [];

  const ranges: MatchedRange[] = [];
  let searchFrom = 0;
  for (;;) {
    const index = text.indexOf(needle, searchFrom);
    if (index === -1) break;
    ranges.push(rangeForOperation(rule, index, index + needle.length, needle));
    searchFrom = index + needle.length;
  }
  return ranges;
};

/**
 * Applies every rule that targets this file, in order.
 *
 * Each rule is resolved against the text as the previous rules left it, so rules compose rather than
 * fighting over stale offsets.
 */
export const applyTextFileEdits = (
  filePath: string,
  text: string,
  rules: TextFileEditRule[],
): TextFileEditResult => {
  const matchCountByRuleId: Record<string, number> = {};
  const errors: string[] = [];
  let edited = text;

  for (const rule of rules) {
    if (!matchesTextFileTarget(filePath, rule)) continue;

    const { ranges, error } =
      rule.mode === "xml"
        ? applyXmlRule(edited, rule)
        : rule.mode === "lua"
          ? applyLuaRule(edited, rule)
          : { ranges: applyLiteralRule(edited, rule), error: undefined };

    if (error) {
      errors.push(`${filePath} ${error}`);
      matchCountByRuleId[rule.id] = matchCountByRuleId[rule.id] ?? 0;
      continue;
    }

    matchCountByRuleId[rule.id] = (matchCountByRuleId[rule.id] ?? 0) + ranges.length;
    edited = applyRanges(edited, ranges);
  }

  return { text: edited, matchCountByRuleId, errors };
};
