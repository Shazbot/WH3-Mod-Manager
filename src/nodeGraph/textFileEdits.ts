import * as cheerio from "cheerio";
import * as luaparse from "luaparse";

/** How a rule decides which files it applies to. */
export type TextFileTargetMatch = "path" | "name" | "regex" | "input";

export type TextFileSkipOperator = "and" | "or";

export interface TextFileSkipCondition {
  id: string;
  value: string;
  /** Connects this condition to the one before it. AND binds more tightly than OR. */
  operator?: TextFileSkipOperator;
}

/** Which syntax the selector is written in. */
export type TextFileEditMode = "xml" | "lua" | "text";

export type TextFileEditOperation =
  | "replace"
  | "regexReplace"
  | "insertBefore"
  | "insertAfter"
  | "insertBetween"
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
  /**
   * The closing snippet for insertBetween: the value goes in the gap after `selector` and before
   * this. Ignored by every other operation.
   */
  selectorEnd?: string;
  operation: TextFileEditOperation;
  attributeName?: string;
  value?: string;
  /**
   * Leave the file alone if it already contains this text.
   *
   * A rule matching by name or regex sweeps every pack it is given, and some of those files may
   * already carry the snippet - shipped that way, or edited by hand. The guard lets one rule cover
   * the files that need it without doubling up on the ones that do not. Checked against the file as
   * earlier rules in the same run have left it, so two rules writing the same marker do not both
   * fire.
   */
  skipIfContains?: string;
  /**
   * Boolean expression of snippets which guard the edit. Conditions joined by AND form a group;
   * OR starts another group. The legacy skipIfContains field is used when this is absent.
   */
  skipConditions?: TextFileSkipCondition[];
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
  /** Rules that stood down because the file already contained their guard text. */
  skippedRuleIds: string[];
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
export const matchesTextFileTarget = (
  filePath: string,
  rule: Pick<TextFileEditRule, "targetMatch" | "target">,
): boolean => {
  // This mode is offered when the node consumes a previous TableSelection and intentionally needs
  // no target text: every file in that prior output is selected.
  if (rule.targetMatch === "input") return true;

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

/**
 * Whether a rule's skip expression is true for this file.
 *
 * AND binds more tightly than OR: A OR B AND C is evaluated as A OR (B AND C). Empty rows are
 * ignored. Existing flows with the old single skipIfContains field retain their original behavior.
 */
export const matchesTextFileSkipConditions = (
  text: string,
  rule: Pick<TextFileEditRule, "skipIfContains" | "skipConditions">,
): boolean => {
  const conditions: TextFileSkipCondition[] = [];
  let pendingOperator: TextFileSkipOperator | undefined;
  for (const condition of rule.skipConditions || []) {
    if (!condition.value) {
      if (condition.operator === "or") pendingOperator = "or";
      continue;
    }
    conditions.push({
      ...condition,
      operator:
        conditions.length === 0
          ? undefined
          : pendingOperator === "or" || condition.operator === "or"
            ? "or"
            : "and",
    });
    pendingOperator = undefined;
  }
  if (conditions.length === 0) return Boolean(rule.skipIfContains && text.includes(rule.skipIfContains));

  let anyGroupMatches = false;
  let currentGroupMatches = true;
  conditions.forEach((condition, index) => {
    const contains = text.includes(condition.value);
    if (index > 0 && condition.operator === "or") {
      anyGroupMatches = anyGroupMatches || currentGroupMatches;
      currentGroupMatches = contains;
    } else {
      currentGroupMatches = currentGroupMatches && contains;
    }
  });
  return anyGroupMatches || currentGroupMatches;
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
    // Handled by applyBetweenRule, which needs both snippets; alone, the opening one behaves as
    // insert-after so a half-configured rule still does something predictable.
    case "insertBetween":
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

/**
 * Inserts into the gap between two literal snippets.
 *
 * Each opening snippet pairs with the first closing snippet after it, so overlapping pairs cannot
 * both claim the same region. The text lands right after the opening snippet, leaving whatever is
 * already between them in place.
 */
const applyBetweenRule = (text: string, rule: TextFileEditRule): { ranges: MatchedRange[]; error?: string } => {
  const opening = rule.selector;
  const closing = rule.selectorEnd ?? "";
  if (!opening || !closing) {
    return { ranges: [], error: "needs both an opening and a closing snippet to insert between" };
  }

  const ranges: MatchedRange[] = [];
  let searchFrom = 0;
  for (;;) {
    const openingIndex = text.indexOf(opening, searchFrom);
    if (openingIndex === -1) break;

    const gapStart = openingIndex + opening.length;
    const closingIndex = text.indexOf(closing, gapStart);
    if (closingIndex === -1) break;

    ranges.push({ start: gapStart, end: gapStart, replacement: rule.value ?? "" });
    searchFrom = closingIndex + closing.length;
  }

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

/** Expands the JavaScript replacement references supported by String.replace. */
const expandRegexReplacement = (replacement: string, match: RegExpExecArray, source: string): string =>
  replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (token, reference: string) => {
    if (reference === "$") return "$";
    if (reference === "&") return match[0];
    if (reference === "`") return source.slice(0, match.index);
    if (reference === "'") return source.slice(match.index + match[0].length);

    if (reference.startsWith("<")) {
      if (!match.groups) return token;
      const name = reference.slice(1, -1);
      return match.groups[name] ?? "";
    }

    const captureNumber = Number(reference);
    if (captureNumber > 0 && captureNumber < match.length) return match[captureNumber] ?? "";

    // JavaScript reads $10 as capture 1 followed by 0 when a tenth capture does not exist.
    if (reference.length === 2) {
      const firstCaptureNumber = Number(reference[0]);
      if (firstCaptureNumber > 0 && firstCaptureNumber < match.length) {
        return (match[firstCaptureNumber] ?? "") + reference[1];
      }
    }
    return token;
  });

/** Replaces every regular-expression match, retaining capture references in the replacement text. */
const applyRegexReplaceRule = (
  text: string,
  rule: TextFileEditRule,
): { ranges: MatchedRange[]; error?: string } => {
  let regex: RegExp;
  try {
    regex = new RegExp(rule.selector, "g");
  } catch (error) {
    return { ranges: [], error: `invalid regular expression '${rule.selector}': ${(error as Error).message}` };
  }

  const ranges: MatchedRange[] = [];
  for (;;) {
    const match = regex.exec(text);
    if (!match) break;
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement: expandRegexReplacement(rule.value ?? "", match, text),
    });

    // RegExp.exec does not advance after an empty match, so advance explicitly to avoid looping.
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return { ranges };
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
  const skippedRuleIds = new Set<string>();
  const errors: string[] = [];
  let edited = text;

  for (const rule of rules) {
    if (!matchesTextFileTarget(filePath, rule)) continue;

    // A file that already carries the rule's marker is left alone, so one rule can sweep a set of
    // files where only some of them need the edit.
    if (matchesTextFileSkipConditions(edited, rule)) {
      skippedRuleIds.add(rule.id);
      matchCountByRuleId[rule.id] = matchCountByRuleId[rule.id] ?? 0;
      continue;
    }

    const { ranges, error } =
      rule.operation === "insertBetween"
        ? applyBetweenRule(edited, rule)
        : rule.operation === "regexReplace"
          ? applyRegexReplaceRule(edited, rule)
        : rule.mode === "xml"
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

  return { text: edited, matchCountByRuleId, skippedRuleIds: [...skippedRuleIds], errors };
};
