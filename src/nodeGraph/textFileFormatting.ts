import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

export type TextFileFormatter = "none" | "autoIndent" | "prettyXml" | "compactXml";

export interface TextFileFormattingResult {
  text: string;
  error?: string;
}

const xmlOptions = {
  ignoreAttributes: false,
  preserveOrder: true,
  commentPropName: "#comment",
  processEntities: false,
} as const;

const lineEndingOf = (text: string): "\r\n" | "\n" => (text.includes("\r\n") ? "\r\n" : "\n");

/** Uses the document's existing indentation, falling back to two spaces for an unformatted file. */
const indentationOf = (text: string): string => {
  const indents = text
    .split(/\r?\n/)
    .map((line) => line.match(/^[\t ]+(?=<)/)?.[0])
    .filter((indent): indent is string => Boolean(indent));
  if (indents.some((indent) => indent.includes("\t"))) return "\t";
  const spaceCounts = indents.map((indent) => indent.length).filter((count) => count > 0);
  return " ".repeat(spaceCounts.length > 0 ? Math.min(...spaceCounts) : 2);
};

const normalizeBuilderOutput = (built: string, source: string): string => {
  const lineEnding = lineEndingOf(source);
  let normalized =
    built.startsWith("\n") && !source.startsWith("\n") && !source.startsWith("\r\n") ? built.slice(1) : built;
  normalized = normalized.replace(/\n/g, lineEnding);
  const sourceHasFinalNewline = /\r?\n$/.test(source);
  if (sourceHasFinalNewline && !normalized.endsWith(lineEnding)) normalized += lineEnding;
  if (!sourceHasFinalNewline && normalized.endsWith(lineEnding)) normalized = normalized.slice(0, -lineEnding.length);
  return normalized;
};

/** Formats a complete XML document after all edit rules have run. */
export const formatXmlDocument = (text: string, formatter: "prettyXml" | "compactXml"): TextFileFormattingResult => {
  const validation = XMLValidator.validate(text, { allowBooleanAttributes: true });
  if (validation !== true) {
    return {
      text,
      error: `could not format invalid XML: ${validation.err.msg} at line ${validation.err.line}, column ${validation.err.col}`,
    };
  }

  try {
    const parsed = new XMLParser(xmlOptions).parse(text);
    const built = new XMLBuilder({
      ...xmlOptions,
      format: formatter === "prettyXml",
      indentBy: indentationOf(text),
      suppressEmptyNode: true,
    }).build(parsed);
    return { text: normalizeBuilderOutput(built, text) };
  } catch (error) {
    return { text, error: `could not format XML: ${(error as Error).message}` };
  }
};

const lineIndentAt = (source: string, index: number): string => {
  const lineStart = Math.max(source.lastIndexOf("\n", Math.max(0, index - 1)) + 1, 0);
  return source.slice(lineStart).match(/^[\t ]*/)?.[0] ?? "";
};

/**
 * Pretty-prints an inserted XML fragment and aligns every continuation line with its destination.
 * It adds a separating line break for insert-before/after when the value did not provide one.
 */
export const autoIndentXmlFragment = (
  source: string,
  replacement: string,
  insertionIndex: number,
  operation: "replace" | "insertBefore" | "insertAfter" | "insertBetween",
): TextFileFormattingResult => {
  if (!replacement.trim()) return { text: replacement };

  const wrapperName = "WHMM_FORMAT_FRAGMENT";
  const wrapped = `<${wrapperName}>${replacement}</${wrapperName}>`;
  const validation = XMLValidator.validate(wrapped, { allowBooleanAttributes: true });
  if (validation !== true) {
    return { text: replacement, error: `could not auto-indent invalid XML fragment: ${validation.err.msg}` };
  }

  try {
    const parsed = new XMLParser(xmlOptions).parse(wrapped) as Array<Record<string, unknown>>;
    const children = parsed[0]?.[wrapperName];
    const built = new XMLBuilder({
      ...xmlOptions,
      format: true,
      indentBy: indentationOf(source),
      suppressEmptyNode: true,
    }).build(children);
    const formatted = built.replace(/^\n/, "").replace(/\n$/, "");
    const lineEnding = lineEndingOf(source);
    const baseIndent = lineIndentAt(source, insertionIndex);
    const aligned = formatted.replace(/\n/g, `${lineEnding}${baseIndent}`);
    const hadLeadingNewline = /^\s*\r?\n/.test(replacement);
    const hadTrailingNewline = /\r?\n\s*$/.test(replacement);

    const leading =
      hadLeadingNewline || (operation === "insertAfter" && !hadLeadingNewline) ? `${lineEnding}${baseIndent}` : "";
    const trailing =
      hadTrailingNewline || (operation === "insertBefore" && !hadTrailingNewline) ? `${lineEnding}${baseIndent}` : "";
    return { text: `${leading}${aligned}${trailing}` };
  } catch (error) {
    return { text: replacement, error: `could not auto-indent XML fragment: ${(error as Error).message}` };
  }
};
