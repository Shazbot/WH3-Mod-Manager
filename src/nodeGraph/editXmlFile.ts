import type { XmlAttributeEdit, XmlLocatorStep } from "./nodes/types";

/** A source range for an XML attribute value, retaining the quote used by the source. */
export interface XmlAttributeOffset {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
  quote: '"' | "'";
}

/** The source ranges needed to edit one element without serialising its neighbours. */
export interface XmlElementOffset {
  name: string;
  start: number;
  startTagEnd: number;
  /** Offset of `>` (or `/` in `/>`) in the opening tag. */
  startTagCloseStart: number;
  endTagStart: number;
  end: number;
  selfClosing: boolean;
  attributes: XmlAttributeOffset[];
  parent?: XmlElementOffset;
  children: XmlElementOffset[];
}

export interface ParsedXmlDocument {
  text: string;
  root: XmlElementOffset;
  elements: XmlElementOffset[];
}

export interface XmlEditResult {
  success: boolean;
  text?: string;
  changed?: boolean;
  matchedElement?: XmlElementOffset;
  error?: string;
}

export interface EditXmlFileConfig {
  ignoreHierarchy: boolean;
  locatorSteps: XmlLocatorStep[];
  action: "setAttributes" | "replaceElement";
  attributeEdits: XmlAttributeEdit[];
  replacementXml: string;
}

class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

const isWhitespace = (character: string | undefined): boolean =>
  character === " " || character === "\t" || character === "\r" || character === "\n";

const isNameStartCodePoint = (codePoint: number): boolean =>
  codePoint === 0x3a ||
  codePoint === 0x5f ||
  (codePoint >= 0x41 && codePoint <= 0x5a) ||
  (codePoint >= 0x61 && codePoint <= 0x7a) ||
  (codePoint >= 0xc0 && codePoint <= 0xd6) ||
  (codePoint >= 0xd8 && codePoint <= 0xf6) ||
  (codePoint >= 0xf8 && codePoint <= 0x2ff) ||
  (codePoint >= 0x370 && codePoint <= 0x37d) ||
  (codePoint >= 0x37f && codePoint <= 0x1fff) ||
  (codePoint >= 0x200c && codePoint <= 0x200d) ||
  (codePoint >= 0x2070 && codePoint <= 0x218f) ||
  (codePoint >= 0x2c00 && codePoint <= 0x2fef) ||
  (codePoint >= 0x3001 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xf900 && codePoint <= 0xfdcf) ||
  (codePoint >= 0xfdf0 && codePoint <= 0xfffd) ||
  (codePoint >= 0x10000 && codePoint <= 0xeffff);

const isNameCodePoint = (codePoint: number): boolean =>
  isNameStartCodePoint(codePoint) ||
  codePoint === 0x2d ||
  codePoint === 0x2e ||
  (codePoint >= 0x30 && codePoint <= 0x39) ||
  codePoint === 0xb7 ||
  (codePoint >= 0x300 && codePoint <= 0x36f) ||
  (codePoint >= 0x203f && codePoint <= 0x2040);

const isValidXmlCharacter = (codePoint: number): boolean =>
  codePoint === 0x9 ||
  codePoint === 0xa ||
  codePoint === 0xd ||
  (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
  (codePoint >= 0x10000 && codePoint <= 0x10ffff);

const ensureXmlCharacters = (value: string, offset: number): void => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (!isValidXmlCharacter(codePoint)) throw new XmlParseError(`Invalid XML character at offset ${offset}`);
  }
};

/** XML 1.0 Name validation shared by runtime config checks and the renderer. */
export const isValidXmlName = (value: string): boolean => {
  if (!value) return false;
  const codePoints = Array.from(value, (character) => character.codePointAt(0) as number);
  return codePoints.length > 0 && isNameStartCodePoint(codePoints[0]) && codePoints.slice(1).every(isNameCodePoint);
};

const readName = (text: string, at: number): { name: string; next: number } => {
  const firstCodePoint = text.codePointAt(at);
  if (firstCodePoint === undefined || !isNameStartCodePoint(firstCodePoint)) {
    throw new XmlParseError(`Invalid XML name at offset ${at}`);
  }

  let next = at + (firstCodePoint > 0xffff ? 2 : 1);
  while (next < text.length) {
    const codePoint = text.codePointAt(next);
    if (codePoint === undefined || !isNameCodePoint(codePoint)) break;
    next += codePoint > 0xffff ? 2 : 1;
  }
  return { name: text.slice(at, next), next };
};

const decodeXmlEntities = (value: string): string => {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/g, (entity, body: string) => {
      if (body === "amp") return "&";
      if (body === "lt") return "<";
      if (body === "gt") return ">";
      if (body === "quot") return '"';
      if (body === "apos") return "'";
      const codePoint = body.toLowerCase().startsWith("#x")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(codePoint) || !isValidXmlCharacter(codePoint)) {
        throw new XmlParseError(`Invalid XML character reference '&${body};'`);
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        throw new XmlParseError(`Invalid XML character reference '&${body};'`);
      }
    })
    .replace(/&[^;\s<]+;|&/g, (entity) => {
      throw new XmlParseError(`Invalid XML entity '${entity}'`);
    });
};

const findMarkupEnd = (text: string, start: number, terminator: string): number => {
  const end = text.indexOf(terminator, start);
  if (end === -1) throw new XmlParseError(`Unclosed XML markup at offset ${start}`);
  return end + terminator.length;
};

const findDoctypeEnd = (text: string, start: number): number => {
  let quote: '"' | "'" | undefined;
  let subsetDepth = 0;
  for (let at = start; at < text.length; at++) {
    const character = text[at];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") {
      subsetDepth++;
      continue;
    }
    if (character === "]" && subsetDepth > 0) {
      subsetDepth--;
      continue;
    }
    if (character === ">" && subsetDepth === 0) return at + 1;
  }
  throw new XmlParseError(`Unclosed doctype at offset ${start}`);
};

const parseAttributeValue = (text: string, at: number): { value: string; next: number; quote: '"' | "'" } => {
  const quote = text[at];
  if (quote !== '"' && quote !== "'") throw new XmlParseError(`XML attribute value must be quoted at offset ${at}`);
  const valueStart = at + 1;
  let next = valueStart;
  while (next < text.length && text[next] !== quote) {
    if (text[next] === "<") throw new XmlParseError(`The '<' character is not allowed in an XML attribute value`);
    next++;
  }
  if (next >= text.length) throw new XmlParseError(`Unclosed XML attribute value at offset ${at}`);
  const rawValue = text.slice(valueStart, next);
  ensureXmlCharacters(rawValue, valueStart);
  return { value: decodeXmlEntities(rawValue), next: next + 1, quote };
};

type OpenElement = XmlElementOffset;

/**
 * Parses XML while keeping exact opening/closing and attribute-value offsets.
 *
 * This intentionally has no serializer: all edits are later applied as source slices, so comments,
 * line endings, entity spelling, quote style, and unrelated bytes survive untouched.
 */
export const parseXmlWithOffsets = (text: string): ParsedXmlDocument => {
  const originalText = text;
  const bomOffset = text.startsWith("\uFEFF") ? 1 : 0;
  if (bomOffset > 0) text = text.slice(1);

  const elements: XmlElementOffset[] = [];
  const stack: OpenElement[] = [];
  let root: XmlElementOffset | undefined;
  let sawDocumentElement = false;
  let at = 0;
  let xmlDeclarationSeen = false;
  let doctypeSeen = false;

  const ensureTextIsAllowed = (rawText: string, offset: number) => {
    if (rawText.includes("]]>")) throw new XmlParseError(`CDATA close marker outside CDATA at offset ${offset}`);
    // Entity validation also catches malformed ampersands while preserving the source bytes.
    ensureXmlCharacters(rawText, offset);
    decodeXmlEntities(rawText);
    if (stack.length === 0 && rawText.trim().length > 0) {
      throw new XmlParseError(`Text outside the XML document element at offset ${offset}`);
    }
  };

  const pushElement = (element: XmlElementOffset) => {
    const parent = stack[stack.length - 1];
    if (parent) {
      element.parent = parent;
      parent.children.push(element);
    } else {
      if (root) throw new XmlParseError(`Multiple XML document elements`);
      root = element;
      sawDocumentElement = true;
    }
    elements.push(element);
    if (!element.selfClosing) stack.push(element);
  };

  while (at < text.length) {
    if (text[at] !== "<") {
      const nextMarkup = text.indexOf("<", at);
      const textEnd = nextMarkup === -1 ? text.length : nextMarkup;
      ensureTextIsAllowed(text.slice(at, textEnd), at);
      at = textEnd;
      continue;
    }

    if (text.startsWith("<!--", at)) {
      const commentEnd = findMarkupEnd(text, at + 4, "-->");
      const commentBody = text.slice(at + 4, commentEnd - 3);
      if (commentBody.includes("--")) throw new XmlParseError(`Invalid '--' in XML comment at offset ${at}`);
      at = commentEnd;
      continue;
    }
    if (text.startsWith("<![CDATA[", at)) {
      if (stack.length === 0) throw new XmlParseError(`CDATA is only allowed inside an XML element at offset ${at}`);
      const cdataEnd = text.indexOf("]]>", at + 9);
      if (cdataEnd === -1) throw new XmlParseError(`Unclosed CDATA at offset ${at}`);
      ensureXmlCharacters(text.slice(at + 9, cdataEnd), at + 9);
      at = cdataEnd + 3;
      continue;
    }
    if (text.startsWith("<?", at)) {
      const piEnd = findMarkupEnd(text, at + 2, "?>");
      const targetStart = at + 2;
      const target = readName(text, targetStart).name;
      if (target.toLowerCase() === "xml") {
        if (xmlDeclarationSeen || sawDocumentElement || targetStart !== 2) {
          throw new XmlParseError(`XML declaration must be the first processing instruction`);
        }
        xmlDeclarationSeen = true;
      }
      at = piEnd;
      continue;
    }
    if (text.startsWith("<!DOCTYPE", at)) {
      if (doctypeSeen || sawDocumentElement || stack.length > 0) {
        throw new XmlParseError(`DOCTYPE must appear once before the document element`);
      }
      if (text.slice(at + 2, at + 9).toUpperCase() !== "DOCTYPE") {
        throw new XmlParseError(`Invalid doctype at offset ${at}`);
      }
      doctypeSeen = true;
      at = findDoctypeEnd(text, at + 9);
      continue;
    }
    if (text.startsWith("<!", at)) throw new XmlParseError(`Unsupported XML declaration at offset ${at}`);

    if (text.startsWith("</", at)) {
      const nameStart = at + 2;
      let nameAt = nameStart;
      while (isWhitespace(text[nameAt])) nameAt++;
      if (nameAt !== nameStart) throw new XmlParseError(`Whitespace is not allowed after '</' at offset ${at}`);
      const { name, next } = readName(text, nameAt);
      let closeAt = next;
      while (isWhitespace(text[closeAt])) closeAt++;
      if (text[closeAt] !== ">") throw new XmlParseError(`Expected '>' for closing element at offset ${at}`);
      const element = stack.pop();
      if (!element || element.name !== name) {
        throw new XmlParseError(`Mismatched closing element '${name}' at offset ${at}`);
      }
      element.endTagStart = at;
      element.end = closeAt + 1;
      at = closeAt + 1;
      continue;
    }

    const start = at;
    const { name, next: nameEnd } = readName(text, at + 1);
    const attributes: XmlAttributeOffset[] = [];
    const seenAttributeNames = new Set<string>();
    let next = nameEnd;
    let selfClosing = false;
    let closeIndex = -1;
    while (next < text.length) {
      while (isWhitespace(text[next])) next++;
      if (text[next] === ">") {
        closeIndex = next;
        break;
      }
      if (text[next] === "/" && text[next + 1] === ">") {
        selfClosing = true;
        closeIndex = next + 1;
        break;
      }
      if (text[next] === "/") throw new XmlParseError(`Expected '>' after '/' at offset ${next}`);
      const attributeStart = next;
      const attribute = readName(text, next);
      next = attribute.next;
      if (seenAttributeNames.has(attribute.name)) {
        throw new XmlParseError(`Duplicate XML attribute '${attribute.name}' at offset ${attributeStart}`);
      }
      seenAttributeNames.add(attribute.name);
      while (isWhitespace(text[next])) next++;
      if (text[next] !== "=") throw new XmlParseError(`Expected '=' after XML attribute '${attribute.name}'`);
      next++;
      while (isWhitespace(text[next])) next++;
      const valueStart = next;
      const parsedValue = parseAttributeValue(text, next);
      next = parsedValue.next;
      attributes.push({
        name: attribute.name,
        value: parsedValue.value,
        valueStart: valueStart + 1,
        valueEnd: parsedValue.next - 1,
        quote: parsedValue.quote,
      });
    }
    if (closeIndex === -1) throw new XmlParseError(`Unclosed start element '${name}' at offset ${start}`);
    const element: XmlElementOffset = {
      name,
      start,
      startTagEnd: closeIndex + 1,
      startTagCloseStart: closeIndex - (selfClosing ? 1 : 0),
      endTagStart: closeIndex - (selfClosing ? 1 : 0),
      end: selfClosing ? closeIndex + 1 : -1,
      selfClosing,
      attributes,
      children: [],
    };
    pushElement(element);
    at = closeIndex + 1;
  }

  if (stack.length > 0) throw new XmlParseError(`Unclosed XML element '${stack[stack.length - 1].name}'`);
  if (!root) throw new XmlParseError(`XML document has no root element`);
  if (bomOffset > 0) {
    for (const element of elements) {
      element.start += bomOffset;
      element.startTagEnd += bomOffset;
      element.startTagCloseStart += bomOffset;
      element.endTagStart += bomOffset;
      element.end += bomOffset;
      for (const attribute of element.attributes) {
        attribute.valueStart += bomOffset;
        attribute.valueEnd += bomOffset;
      }
    }
  }
  return { text: originalText, root, elements };
};

const hasHierarchyAncestor = (element: XmlElementOffset): boolean => {
  let ancestor = element.parent;
  while (ancestor) {
    if (ancestor.name === "hierarchy") return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const descendantsOf = (element: XmlElementOffset): XmlElementOffset[] => {
  const descendants: XmlElementOffset[] = [];
  const visit = (child: XmlElementOffset) => {
    descendants.push(child);
    child.children.forEach(visit);
  };
  element.children.forEach(visit);
  return descendants;
};

const matchingStep = (element: XmlElementOffset, step: XmlLocatorStep): boolean => {
  const elementName = typeof step.elementName === "string" ? step.elementName.trim() : "";
  if (elementName !== "*" && element.name !== elementName) return false;
  return (step.attributes || []).every((attribute) => {
    const candidate = element.attributes.find((existing) => existing.name === attribute.name.trim());
    return candidate !== undefined && candidate.value === attribute.value;
  });
};

const collectUnique = (elements: XmlElementOffset[]): XmlElementOffset[] => {
  const seen = new Set<XmlElementOffset>();
  return elements.filter((element) => {
    if (seen.has(element)) return false;
    seen.add(element);
    return true;
  });
};

const validateLocatorConfig = (config: EditXmlFileConfig): string | undefined => {
  if (!Array.isArray(config.locatorSteps) || config.locatorSteps.length === 0) {
    return "XML locator requires at least one step";
  }
  for (let stepIndex = 0; stepIndex < config.locatorSteps.length; stepIndex++) {
    const step = config.locatorSteps[stepIndex];
    if (!step || typeof step.elementName !== "string") return `Invalid XML locator step ${stepIndex + 1}`;
    const elementName = step.elementName.trim();
    if (elementName !== "*" && !isValidXmlName(elementName)) {
      return `Invalid XML element name '${step.elementName}' in locator step ${stepIndex + 1}`;
    }
    const names = new Set<string>();
    for (const attribute of step.attributes || []) {
      if (!attribute || typeof attribute.name !== "string" || !attribute.name.trim()) {
        return `Incomplete XML locator attribute in step ${stepIndex + 1}`;
      }
      const name = attribute.name.trim();
      if (!isValidXmlName(name))
        return `Invalid XML attribute name '${attribute.name}' in locator step ${stepIndex + 1}`;
      if (names.has(name)) return `Duplicate XML locator attribute '${name}' in step ${stepIndex + 1}`;
      names.add(name);
      if (typeof attribute.value !== "string" || !attribute.value.trim()) {
        return `Incomplete XML locator attribute '${name}' in step ${stepIndex + 1}`;
      }
    }
  }
  return undefined;
};

const validateActionConfig = (config: EditXmlFileConfig): string | undefined => {
  if (config.action === "setAttributes") {
    if (!Array.isArray(config.attributeEdits) || config.attributeEdits.length === 0) {
      return "Set attributes requires at least one attribute edit";
    }
    const names = new Set<string>();
    for (const edit of config.attributeEdits) {
      if (
        !edit ||
        typeof edit.name !== "string" ||
        !edit.name.trim() ||
        typeof edit.newValue !== "string" ||
        !edit.newValue.trim()
      ) {
        return "Incomplete XML attribute edit";
      }
      const name = edit.name.trim();
      if (!isValidXmlName(name)) return `Invalid XML mutation attribute name '${edit.name}'`;
      if (names.has(name)) return `Duplicate XML mutation attribute '${name}'`;
      names.add(name);
    }
    return undefined;
  }
  if (config.action !== "replaceElement") return "Invalid XML action";
  if (typeof config.replacementXml !== "string" || !config.replacementXml.trim()) {
    return "Replacement XML is required";
  }
  return undefined;
};

const escapeAttributeValue = (value: string, quote: '"' | "'"): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(new RegExp(quote === '"' ? '"' : "'", "g"), quote === '"' ? "&quot;" : "&apos;")
    .replace(/\r/g, "&#xD;")
    .replace(/\n/g, "&#xA;")
    .replace(/\t/g, "&#x9;");

const lineIndentAt = (text: string, offset: number): string => {
  const lineStart = Math.max(text.lastIndexOf("\n", offset - 1), text.lastIndexOf("\r", offset - 1)) + 1;
  const prefix = text.slice(lineStart, offset);
  const match = prefix.match(/^[ \t]*/);
  return match?.[0] ?? "";
};

const additionForMissingAttributes = (
  text: string,
  element: XmlElementOffset,
  missing: Array<{ name: string; newValue: string }>,
): { at: number; value: string } => {
  const closeAt = element.startTagCloseStart;
  let trailingStart = closeAt;
  while (trailingStart > element.start && isWhitespace(text[trailingStart - 1])) trailingStart--;
  const trailingWhitespace = text.slice(trailingStart, closeAt);
  const opening = text.slice(element.start, element.startTagEnd);
  const openingIsMultiline = /\r|\n/.test(opening);
  const quote = element.attributes[0]?.quote ?? '"';
  const rendered = (attribute: { name: string; newValue: string }) =>
    `${attribute.name}=${quote}${escapeAttributeValue(attribute.newValue, quote)}${quote}`;

  if (trailingWhitespace.includes("\n") || trailingWhitespace.includes("\r") || openingIsMultiline) {
    const firstMultilineAttribute = element.attributes.find((attribute) => {
      const attributeNameStart = attribute.valueStart - attribute.name.length - 2;
      return /\r|\n/.test(text.slice(element.start, attributeNameStart));
    });
    const indent = firstMultilineAttribute
      ? lineIndentAt(text, firstMultilineAttribute.valueStart - firstMultilineAttribute.name.length - 2)
      : `${lineIndentAt(text, element.start)}  `;
    const newline =
      /\r\n/.test(opening) || trailingWhitespace.includes("\r\n")
        ? "\r\n"
        : /\r/.test(opening) || trailingWhitespace.includes("\r")
          ? "\r"
          : "\n";
    return {
      at: trailingWhitespace.length > 0 ? trailingStart : closeAt,
      value: missing.map((attribute) => `${newline}${indent}${rendered(attribute)}`).join(""),
    };
  }

  // Add one conventional separator before the new attribute, then retain any source whitespace
  // that was already between the last attribute and the closing token.
  return {
    at: trailingStart,
    value: ` ${missing.map(rendered).join(" ")}`,
  };
};

const applySetAttributes = (text: string, element: XmlElementOffset, edits: XmlAttributeEdit[]): string => {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const missing: XmlAttributeEdit[] = [];
  for (const edit of edits) {
    const name = edit.name.trim();
    const existing = element.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      replacements.push({
        start: existing.valueStart,
        end: existing.valueEnd,
        value: escapeAttributeValue(edit.newValue, existing.quote),
      });
    } else {
      missing.push({ ...edit, name });
    }
  }
  if (missing.length > 0) {
    const addition = additionForMissingAttributes(text, element, missing);
    replacements.push({ start: addition.at, end: addition.at, value: addition.value });
  }
  let edited = text;
  for (const replacement of replacements.sort((first, second) => second.start - first.start)) {
    edited = edited.slice(0, replacement.start) + replacement.value + edited.slice(replacement.end);
  }
  return edited;
};

/** Checks that replacement text is a valid XML document with exactly one element root. */
export const isSingleXmlElement = (replacementXml: string): boolean => {
  try {
    parseXmlWithOffsets(replacementXml);
    return true;
  } catch {
    return false;
  }
};

/** Applies one structural XML edit while preserving every source slice outside the target. */
export const applyEditXmlFile = (sourceText: string, config: EditXmlFileConfig): XmlEditResult => {
  if (
    !config ||
    typeof config.ignoreHierarchy !== "boolean" ||
    !Array.isArray(config.locatorSteps) ||
    !Array.isArray(config.attributeEdits) ||
    (config.action !== "setAttributes" && config.action !== "replaceElement") ||
    typeof config.replacementXml !== "string"
  ) {
    return { success: false, error: "Invalid XML node configuration" };
  }
  const configError = validateLocatorConfig(config) || validateActionConfig(config);
  if (configError) return { success: false, error: configError };

  let document: ParsedXmlDocument;
  try {
    document = parseXmlWithOffsets(sourceText);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Malformed XML" };
  }

  let scopes: XmlElementOffset[];
  if (config.ignoreHierarchy) {
    const components = document.elements.filter(
      (element) => element.name === "components" && !hasHierarchyAncestor(element),
    );
    if (components.length === 0) return { success: false, error: "XML document has no <components> element" };
    scopes = components;
  } else {
    scopes = [document.root];
  }

  let candidates = collectUnique(
    (config.ignoreHierarchy
      ? scopes.flatMap((scope) => descendantsOf(scope))
      : [document.root, ...descendantsOf(document.root)]
    ).filter((element) => !config.ignoreHierarchy || !hasHierarchyAncestor(element)),
  );
  for (let stepIndex = 0; stepIndex < config.locatorSteps.length; stepIndex++) {
    const step = config.locatorSteps[stepIndex];
    candidates = collectUnique(candidates.filter((element) => matchingStep(element, step)));
    if (candidates.length === 0) {
      return {
        success: false,
        error: `XML locator step ${stepIndex + 1} matched no elements`,
      };
    }
    if (stepIndex < config.locatorSteps.length - 1) {
      candidates = collectUnique(
        candidates
          .flatMap((scope) => descendantsOf(scope))
          .filter((element) => !config.ignoreHierarchy || !hasHierarchyAncestor(element)),
      );
    }
  }
  if (candidates.length !== 1) {
    return {
      success: false,
      error: `XML locator final step matched ${candidates.length} elements; expected exactly one`,
    };
  }
  const target = candidates[0];

  let edited = document.text;
  if (config.action === "setAttributes") {
    edited = applySetAttributes(document.text, target, config.attributeEdits);
  } else {
    let replacementDocument: ParsedXmlDocument;
    try {
      replacementDocument = parseXmlWithOffsets(config.replacementXml);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Malformed replacement XML" };
    }
    if (!replacementDocument.root) return { success: false, error: "Replacement XML must contain one element" };
    edited = document.text.slice(0, target.start) + config.replacementXml + document.text.slice(target.end);
    try {
      parseXmlWithOffsets(edited);
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? `Replacement XML would make the document invalid: ${error.message}`
            : "Invalid replacement XML",
      };
    }
  }

  return {
    success: true,
    text: edited,
    changed: edited !== sourceText,
    matchedElement: target,
  };
};

/** Alias kept for callers/tests that use the shorter runtime helper name. */
export const applyEditXml = applyEditXmlFile;
