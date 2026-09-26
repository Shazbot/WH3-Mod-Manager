import { MAX_GLOBAL_SEARCH_QUERY_LENGTH } from "./types";

export interface SearchMatcher {
  readonly isEmpty: boolean;
  readonly isValidRegex: boolean;
  readonly caseSensitive: boolean;
  /** Case-folded literal needle; undefined in regex mode. */
  readonly literal?: string;
  /** The hot path used by pool and cell scans. */
  test(value: string): boolean;
  /** Finds one match at or after `fromIndex`. */
  find(value: string, fromIndex?: number): { start: number; end: number } | undefined;
  /** Returns a fresh regex without global or sticky state. */
  toRegExp(extraFlags?: string): RegExp;
}

export interface SearchMatcherOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  /** Override the global-search length guard for legacy callers such as packFileContains. */
  maxQueryLength?: number;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const noMatchRegExp = (): RegExp => /(?!)^/;

const cleanFlags = (flags: string): string => {
  const seen = new Set<string>();
  let cleaned = "";
  for (const flag of flags.replace(/[gy]/g, "")) {
    if (seen.has(flag)) continue;
    seen.add(flag);
    cleaned += flag;
  }
  return cleaned;
};

const buildRegExp = (source: string, caseSensitive: boolean, extraFlags = ""): RegExp => {
  const flags = cleanFlags(`${caseSensitive ? "" : "i"}${extraFlags}`);
  try {
    return new RegExp(source, flags);
  } catch {
    return noMatchRegExp();
  }
};

const tryBuildRegExp = (source: string, caseSensitive: boolean): { regex: RegExp; valid: boolean } => {
  const flags = cleanFlags(caseSensitive ? "" : "i");
  try {
    return { regex: new RegExp(source, flags), valid: true };
  } catch {
    return { regex: noMatchRegExp(), valid: false };
  }
};

/** Creates the single matching abstraction shared by DB, loc, text and binary searches. */
export const createSearchMatcher = (query: string, options: SearchMatcherOptions = {}): SearchMatcher => {
  const caseSensitive = options.caseSensitive ?? false;
  const regex = options.regex ?? false;
  const maxQueryLength = options.maxQueryLength ?? MAX_GLOBAL_SEARCH_QUERY_LENGTH;
  const isEmpty = query.length === 0;
  const isWithinLimit = query.length <= maxQueryLength;
  const regexResult = regex && isWithinLimit ? tryBuildRegExp(query, caseSensitive) : undefined;
  const regexValue = regexResult?.regex ?? noMatchRegExp();
  const isValidRegex = !regex || (isWithinLimit && regexResult?.valid === true);
  const literal = regex ? undefined : caseSensitive ? query : query.toLowerCase();
  const findPattern = regex
    ? regexResult?.valid
      ? new RegExp(query, `${caseSensitive ? "" : "i"}g`)
      : noMatchRegExp()
    : new RegExp(escapeRegExp(query), `${caseSensitive ? "" : "i"}g`);

  const toRegExp = (extraFlags = ""): RegExp => {
    if (!isWithinLimit || (regex && !isValidRegex)) return noMatchRegExp();
    return buildRegExp(regex ? query : escapeRegExp(query), caseSensitive, extraFlags);
  };

  const test = (value: string): boolean => {
    if (isEmpty || !isWithinLimit || (regex && !isValidRegex)) return false;
    if (!regex) return caseSensitive ? value.includes(query) : value.toLowerCase().includes(literal!);
    regexValue.lastIndex = 0;
    return regexValue.test(value);
  };

  const find = (value: string, fromIndex = 0): { start: number; end: number } | undefined => {
    if (isEmpty || !isWithinLimit || (regex && !isValidRegex)) return undefined;
    if (!regex && caseSensitive) {
      const start = value.indexOf(query, fromIndex);
      return start < 0 ? undefined : { start, end: start + query.length };
    }

    // A lowercased copy is not length-preserving for every Unicode code point. Use a regex for the
    // result position rather than trying to translate an index from the folded copy.
    findPattern.lastIndex = Math.max(0, fromIndex);
    const match = findPattern.exec(value);
    if (!match) return undefined;
    return { start: match.index, end: match.index + match[0].length };
  };

  return {
    isEmpty,
    isValidRegex,
    caseSensitive,
    literal,
    test,
    find,
    toRegExp,
  };
};
