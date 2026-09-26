/**
 * Renderer-safe validation for Edit XML File authoring fields.
 *
 * This module deliberately has no Electron, Node, or server-runtime imports. The executor performs
 * the authoritative validation again, while the editor can give immediate feedback in a browser.
 */

const XML_NAME_START_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2ff],
  [0x370, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0xeffff],
];

const inXmlNameStartRange = (codePoint: number): boolean =>
  codePoint === 0x3a || XML_NAME_START_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);

const inXmlNameRange = (codePoint: number): boolean =>
  inXmlNameStartRange(codePoint) ||
  codePoint === 0x2d ||
  codePoint === 0x2e ||
  (codePoint >= 0x30 && codePoint <= 0x39) ||
  codePoint === 0xb7 ||
  (codePoint >= 0x300 && codePoint <= 0x36f) ||
  (codePoint >= 0x203f && codePoint <= 0x2040);

/** XML 1.0 Name validation for element and attribute fields. */
export const isValidXmlName = (value: string): boolean => {
  if (!value) return false;
  const codePoints = Array.from(value, (character) => character.codePointAt(0) as number);
  return codePoints.length > 0 && inXmlNameStartRange(codePoints[0]) && codePoints.slice(1).every(inXmlNameRange);
};

// Flow option placeholders are resolved before the XML node reaches the runtime validator. For
// authoring, replace them with a valid name token so fields such as `{{elementName}}` can be used
// wherever an XML element or attribute name is required.
const FLOW_OPTION_PLACEHOLDER = /\{\{[^{}]+\}\}/g;
const replaceFlowOptionPlaceholdersForValidation = (value: string): string =>
  value.replace(FLOW_OPTION_PLACEHOLDER, "flowOption");

/** XML Name validation for fields that may contain a flow option placeholder. */
export const isValidXmlNameTemplate = (value: string): boolean =>
  isValidXmlName(value) || isValidXmlName(replaceFlowOptionPlaceholdersForValidation(value));

const parseWithDomParser = (value: string): boolean | undefined => {
  if (typeof DOMParser === "undefined") return undefined;
  try {
    const document = new DOMParser().parseFromString(value, "application/xml");
    if (document.getElementsByTagName("parsererror").length > 0) return false;
    const elementRoots = Array.from(document.childNodes).filter((node) => node.nodeType === Node.ELEMENT_NODE);
    const nonWhitespaceText = Array.from(document.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.nodeValue || "").trim().length > 0,
    );
    return elementRoots.length === 1 && !nonWhitespaceText;
  } catch {
    return false;
  }
};

/**
 * Checks a replacement is one XML element rather than text, multiple roots, or malformed markup.
 * DOMParser is available in the renderer; the conservative fallback is used by non-DOM tooling.
 */
export const isSingleXmlElement = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const domResult = parseWithDomParser(trimmed);
  if (domResult !== undefined) return domResult;

  // Keep the fallback intentionally conservative: it accepts the common self-closing or paired
  // element form and rejects text-only/multi-root input. The server parser remains authoritative.
  const name = String.raw`[A-Za-z_:][A-Za-z0-9_.:-]*`;
  const selfClosing = new RegExp(String.raw`^<${name}(?:\s[^<>]*?)?\s*/>$`, "s");
  const paired = new RegExp(String.raw`^<(${name})(?:\s[^<>]*?)?>(?:.|\s)*</\1>$`, "s");
  return selfClosing.test(trimmed) || paired.test(trimmed);
};

/**
 * Checks a replacement XML template. Flow option placeholders are allowed in element/attribute names
 * while authoring and are replaced with a valid XML name before this check; the resolved XML is
 * validated again by the runtime parser.
 */
export const isSingleXmlElementTemplate = (value: string): boolean =>
  isSingleXmlElement(value) || isSingleXmlElement(replaceFlowOptionPlaceholdersForValidation(value));
