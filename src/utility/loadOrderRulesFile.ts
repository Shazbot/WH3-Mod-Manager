import type { LoadOrderRule } from "../loadOrderRules";
import { normalizeLoadOrderPackName } from "../loadOrderRules";

/**
 * A mod can ship its own load order rules in `whmm\load_order.whmm`.
 *
 * Two columns are enough because every rule is relative to the pack holding the file: column one
 * says BEFORE or AFTER, column two names the *other* pack. The game ignores the whole `whmm\`
 * folder, which is why this is plain text and not a db table.
 */
export const LOAD_ORDER_RULES_FOLDER = "whmm";
export const LOAD_ORDER_RULES_PACKED_FILE_PATH = "whmm\\load_order.whmm";

export type LoadOrderRuleRelation = "BEFORE" | "AFTER";

export interface LoadOrderRuleRow {
  relation: LoadOrderRuleRelation;
  packName: string;
}

export interface LoadOrderRulesFileError {
  /** 1-based, so it matches what an editor shows. */
  line: number;
  text: string;
  message: string;
}

export interface ParsedLoadOrderRulesFile {
  rows: LoadOrderRuleRow[];
  errors: LoadOrderRulesFileError[];
}

const normalizePackedFilePath = (filePath: string): string => filePath.trim().replaceAll("/", "\\").toLowerCase();

export const isLoadOrderRulesPackedFilePath = (filePath: string): boolean =>
  normalizePackedFilePath(filePath) === LOAD_ORDER_RULES_PACKED_FILE_PATH;

/**
 * Tolerant on the way in: any capitalisation, tabs or runs of spaces between the columns, CRLF or LF,
 * `#` comments and blank lines. Writing is always tab separated and upper case.
 */
export function parseLoadOrderRulesRows(text: string): ParsedLoadOrderRulesFile {
  const rows: LoadOrderRuleRow[] = [];
  const errors: LoadOrderRulesFileError[] = [];

  text.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;

    const columns = line.split(/\t+|\s{2,}| +/).filter((column) => column !== "");
    const report = (message: string) => errors.push({ line: lineIndex + 1, text: rawLine, message });

    if (columns.length < 2) {
      report("Expected two columns: BEFORE or AFTER, then a pack name.");
      return;
    }
    if (columns.length > 2) {
      report("Expected two columns, but found more. Pack names cannot contain spaces.");
      return;
    }

    const relation = columns[0].toUpperCase();
    if (relation !== "BEFORE" && relation !== "AFTER") {
      report(`Unknown relation "${columns[0]}". Expected BEFORE or AFTER.`);
      return;
    }

    const packName = normalizeLoadOrderPackName(columns[1]);
    if (packName === "") {
      report("Missing pack name.");
      return;
    }

    rows.push({ relation, packName });
  });

  return { rows, errors };
}

/** Rows are relative to their own pack, so turning them into rules needs to know which pack that is. */
export function loadOrderRuleRowsToRules(rows: LoadOrderRuleRow[], ownPackName: string): LoadOrderRule[] {
  const normalizedOwnPackName = normalizeLoadOrderPackName(ownPackName);
  if (normalizedOwnPackName === "") return [];

  return rows
    .filter((row) => row.packName.toLowerCase() !== normalizedOwnPackName.toLowerCase())
    .map((row) =>
      // A pack's file only ever positions that pack, which is exactly why two columns is enough.
      row.relation === "BEFORE"
        ? {
            before: normalizedOwnPackName,
            after: row.packName,
            sourcePackName: normalizedOwnPackName,
            subjectPackName: normalizedOwnPackName,
          }
        : {
            before: row.packName,
            after: normalizedOwnPackName,
            sourcePackName: normalizedOwnPackName,
            subjectPackName: normalizedOwnPackName,
          },
    );
}

export function parseLoadOrderRulesFile(
  text: string,
  ownPackName: string,
): { rules: LoadOrderRule[]; rows: LoadOrderRuleRow[]; errors: LoadOrderRulesFileError[] } {
  const { rows, errors } = parseLoadOrderRulesRows(text);
  return { rules: loadOrderRuleRowsToRules(rows, ownPackName), rows, errors };
}

const RULES_FILE_HEADER = [
  "# WHMM load order rules for this pack.",
  "# One rule per line: BEFORE or AFTER, a tab, then the other pack's name.",
  "# BEFORE means this pack appears higher in the load order (with a lower order number), so it overrides that one.",
].join("\n");

export function serializeLoadOrderRuleRows(rows: LoadOrderRuleRow[]): string {
  const lines = rows.map((row) => `${row.relation}\t${normalizeLoadOrderPackName(row.packName)}`);
  return `${RULES_FILE_HEADER}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

/** Rules a pack holds about itself, expressed as the two-column rows the file stores. */
export function loadOrderRulesToRows(rules: LoadOrderRule[], ownPackName: string): LoadOrderRuleRow[] {
  const ownKey = normalizeLoadOrderPackName(ownPackName).toLowerCase();
  const rows: LoadOrderRuleRow[] = [];

  for (const rule of rules) {
    if (normalizeLoadOrderPackName(rule.before).toLowerCase() === ownKey) {
      rows.push({ relation: "BEFORE", packName: normalizeLoadOrderPackName(rule.after) });
    } else if (normalizeLoadOrderPackName(rule.after).toLowerCase() === ownKey) {
      rows.push({ relation: "AFTER", packName: normalizeLoadOrderPackName(rule.before) });
    }
  }

  return rows;
}
