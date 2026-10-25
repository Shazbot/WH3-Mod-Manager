import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizePackFilePath, normalizePackFilePathKey } from "../utility/packFilePathUtils";

export type SupportedVisualDependencyExtension =
  "variantmeshdefinition" | "wsmodel" | "rigid_model_v2" | "xml.material" | "dds";

export type ResolvedVisualDependency = {
  resolvedPath: string;
  text?: string;
};

export type VisualDependencyClosure = {
  paths: string[];
  missing: string[];
};

const dependencyXmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

const detailedDependencyXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

const collectStringValues = (value: unknown, output: string[]) => {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectStringValues(child, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value as Record<string, unknown>)) collectStringValues(child, output);
};

export const getSupportedVisualDependencyExtension = (
  filePath: string,
): SupportedVisualDependencyExtension | undefined => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".variantmeshdefinition")) return "variantmeshdefinition";
  if (lower.endsWith(".wsmodel")) return "wsmodel";
  if (lower.endsWith(".rigid_model_v2")) return "rigid_model_v2";
  if (lower.endsWith(".xml.material")) return "xml.material";
  if (lower.endsWith(".dds")) return "dds";
  return undefined;
};

export interface VisualReferenceCondition {
  slotPath: string;
  slotName?: string;
  choiceIndex: number;
  parent?: VisualReferenceCondition;
}

export interface VisualReferenceDetail {
  path: string;
  extension: SupportedVisualDependencyExtension;
  location: string;
  sourceField: string;
  relationship: "variant-mesh-reference" | "model" | "geometry" | "material" | "texture";
  conditional?: VisualReferenceCondition;
}

export interface UnsupportedVisualReferenceDetail {
  path: string;
  location: string;
  sourceField: string;
  conditional?: VisualReferenceCondition;
}

export interface VisualReferenceExtraction {
  references: VisualReferenceDetail[];
  unsupportedReferences: UnsupportedVisualReferenceDetail[];
  valid: boolean;
  error?: string;
}

type ConditionalVisit = VisualReferenceCondition | undefined;
type OrderedXmlNode = Record<string, unknown> & { ":@"?: Record<string, unknown> };

const xmlElementAndValue = (node: OrderedXmlNode): [string, unknown] | undefined =>
  Object.entries(node).find(([key]) => key !== ":@");

const referenceRelationship = (
  extension: SupportedVisualDependencyExtension,
): VisualReferenceDetail["relationship"] => {
  switch (extension) {
    case "variantmeshdefinition":
      return "variant-mesh-reference";
    case "wsmodel":
      return "model";
    case "rigid_model_v2":
      return "geometry";
    case "xml.material":
      return "material";
    case "dds":
      return "texture";
  }
};

const referenceBearingFields = new Set([
  "animation",
  "definition",
  "file",
  "filename",
  "geometry",
  "material",
  "mesh",
  "model",
  "path",
  "rigid_model",
  "shader",
  "skeleton",
  "source",
  "texture",
  "variant_mesh",
  "variant_mesh_reference",
  "wsmodel",
]);

/** Extracts supported XML references with their source field and conservative VMD choice context. */
export const getSupportedVisualReferenceDetails = (text: string): VisualReferenceExtraction => {
  const validation = XMLValidator.validate(text);
  if (validation !== true)
    return { references: [], unsupportedReferences: [], valid: false, error: JSON.stringify(validation) };

  let parsed: unknown;
  try {
    parsed = detailedDependencyXmlParser.parse(text);
  } catch (error) {
    return {
      references: [],
      unsupportedReferences: [],
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!Array.isArray(parsed))
    return {
      references: [],
      unsupportedReferences: [],
      valid: false,
      error: "XML parser returned no ordered document",
    };

  const references: VisualReferenceDetail[] = [];
  const unsupportedReferences: UnsupportedVisualReferenceDetail[] = [];
  const addReference = (rawValue: unknown, location: string, sourceField: string, conditional: ConditionalVisit) => {
    if (typeof rawValue !== "string") return;
    const normalizedPath = normalizePackFilePath(rawValue.trim());
    const extension = getSupportedVisualDependencyExtension(normalizedPath);
    if (!normalizedPath) return;
    if (!extension) {
      const hasExtension = /(?:^|\\)[^\\]+\.[a-z0-9_]+$/i.test(normalizedPath);
      const fieldLooksLikeReference = referenceBearingFields.has(sourceField.toLowerCase());
      if (hasExtension && (normalizedPath.includes("\\") || fieldLooksLikeReference)) {
        unsupportedReferences.push({
          path: normalizedPath,
          location,
          sourceField,
          ...(conditional ? { conditional } : {}),
        });
      }
      return;
    }
    references.push({
      path: normalizedPath,
      extension,
      location,
      sourceField,
      relationship: referenceRelationship(extension),
      ...(conditional ? { conditional } : {}),
    });
  };

  const visit = (rawNode: unknown, parentPath: string, inherited: ConditionalVisit): void => {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) return;
    const node = rawNode as OrderedXmlNode;
    const pair = xmlElementAndValue(node);
    if (!pair) return;
    const [elementName, rawChildren] = pair;
    const siblings = Array.isArray(rawChildren) ? rawChildren : rawChildren == null ? [] : [rawChildren];
    const index = Number((node as { __index?: number }).__index ?? 0);
    if (elementName === "#text") {
      const parentElement =
        parentPath
          .split("/")
          .at(-1)
          ?.replace(/\[\d+\]$/, "") ?? "#text";
      for (const child of siblings) addReference(child, `${parentPath}/text()`, parentElement, inherited);
      return;
    }
    const elementPath = `${parentPath}/${elementName}[${index}]`;
    const attributes = node[":@"];
    let current = inherited;
    if (elementName === "SLOT") {
      const slotName = typeof attributes?.["@_name"] === "string" ? String(attributes["@_name"]) : undefined;
      const inlineCount = siblings.filter((child) => {
        const childPair = child && typeof child === "object" ? xmlElementAndValue(child as OrderedXmlNode) : undefined;
        return childPair?.[0] === "VARIANT_MESH";
      }).length;
      let inlineChoice = 0;
      let referenceChoice = inlineCount;
      const choiceByChild = new Map<unknown, number>();
      for (const child of siblings) {
        const childPair = child && typeof child === "object" ? xmlElementAndValue(child as OrderedXmlNode) : undefined;
        if (childPair?.[0] === "VARIANT_MESH") choiceByChild.set(child, inlineChoice++);
        else if (childPair?.[0] === "VARIANT_MESH_REFERENCE") choiceByChild.set(child, referenceChoice++);
      }
      siblings.forEach((child, childIndex) => {
        const choiceIndex = choiceByChild.get(child);
        const childConditional =
          choiceIndex === undefined
            ? current
            : { slotPath: elementPath, slotName, choiceIndex, ...(current ? { parent: current } : {}) };
        const childNode =
          child && typeof child === "object" ? { ...(child as OrderedXmlNode), __index: childIndex } : child;
        visit(childNode, elementPath, childConditional);
      });
      return;
    }

    if (attributes) {
      for (const [name, value] of Object.entries(attributes)) {
        if (!name.startsWith("@_")) continue;
        const fieldName = name.slice(2);
        addReference(value, `${elementPath}/@${fieldName}`, fieldName, current);
      }
    }
    siblings.forEach((child, childIndex) => {
      const childNode =
        child && typeof child === "object" ? { ...(child as OrderedXmlNode), __index: childIndex } : child;
      if (typeof child === "string") addReference(child, `${elementPath}/text()`, elementName, current);
      else visit(childNode, elementPath, current);
    });
  };

  parsed.forEach((node, index) => {
    const rootNode = node && typeof node === "object" ? { ...(node as OrderedXmlNode), __index: index } : node;
    visit(rootNode, "", undefined);
  });
  return { references, unsupportedReferences, valid: true };
};

/**
 * Pulls supported Visuals asset references from XML-backed asset files.
 *
 * VMD, WSModel and xml.material references can live either in attributes or element text,
 * so walking the parsed XML values is deliberately format-agnostic. Unsupported references
 * (shaders, animations, etc.) are ignored here rather than entering the recursive extraction.
 */
export const getSupportedVisualReferences = (text: string): string[] => {
  let parsed: unknown;
  try {
    parsed = dependencyXmlParser.parse(text);
  } catch {
    return [];
  }
  const rawValues: string[] = [];
  collectStringValues(parsed, rawValues);
  const references: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of rawValues) {
    const normalizedPath = normalizePackFilePath(rawValue);
    if (!normalizedPath || !getSupportedVisualDependencyExtension(normalizedPath)) continue;
    const key = normalizePackFilePathKey(normalizedPath);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    references.push(normalizedPath);
  }
  return references;
};

const getXmlTextValue = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const text = (value as Record<string, unknown>)["#text"];
  return typeof text === "string" ? text.trim() : "";
};

export type VisualMaterialFactionTextures = {
  baseColourPath?: string;
  maskPath?: string;
};

export const getVisualMaterialFactionTextures = (text: string): VisualMaterialFactionTextures | undefined => {
  let parsed: unknown;
  try {
    parsed = dependencyXmlParser.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const material = (parsed as Record<string, unknown>).material;
  if (!material || typeof material !== "object") return undefined;
  const textures = (material as Record<string, unknown>).textures;
  if (!textures || typeof textures !== "object") return undefined;
  const rawEntries = (textures as Record<string, unknown>).texture;
  const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];
  let baseColourPath: string | undefined;
  let maskPath: string | undefined;
  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, unknown>;
    const slot = getXmlTextValue(entry.slot).toLowerCase();
    const source = normalizePackFilePath(getXmlTextValue(entry.source));
    if (!source) continue;
    if (slot === "t_xml_base_colour") baseColourPath = source;
    if (slot === "t_xml_mask") maskPath = source;
  }
  return baseColourPath || maskPath ? { baseColourPath, maskPath } : undefined;
};

const canContainSupportedVisualReferences = (filePath: string) => {
  const extension = getSupportedVisualDependencyExtension(filePath);
  return extension === "variantmeshdefinition" || extension === "wsmodel" || extension === "xml.material";
};

/**
 * Resolves a root Visuals asset and recursively walks every supported reference below it.
 * Resolved paths are deduplicated, so recursive/cyclic VMD references cannot loop forever.
 */
export const collectVisualDependencyClosure = async (
  rootPath: string,
  readAsset: (requestedPath: string) => Promise<ResolvedVisualDependency | undefined>,
): Promise<VisualDependencyClosure> => {
  const normalizedRoot = normalizePackFilePath(rootPath);
  if (!normalizedRoot || !getSupportedVisualDependencyExtension(normalizedRoot)) {
    return { paths: [], missing: normalizedRoot ? [normalizedRoot] : [] };
  }

  const queue = [normalizedRoot];
  const queuedOrRead = new Set<string>();
  const resolvedPaths = new Set<string>();
  const paths: string[] = [];
  const missing: string[] = [];

  while (queue.length > 0) {
    const requestedPath = queue.shift()!;
    const requestedKey = normalizePackFilePathKey(requestedPath);
    if (!requestedKey || queuedOrRead.has(requestedKey)) continue;
    queuedOrRead.add(requestedKey);

    const asset = await readAsset(requestedPath);
    if (!asset) {
      missing.push(requestedPath);
      continue;
    }

    const resolvedPath = normalizePackFilePath(asset.resolvedPath);
    const resolvedKey = normalizePackFilePathKey(resolvedPath);
    if (!resolvedPath || !resolvedKey || !getSupportedVisualDependencyExtension(resolvedPath)) {
      missing.push(requestedPath);
      continue;
    }
    if (resolvedPaths.has(resolvedKey)) continue;

    resolvedPaths.add(resolvedKey);
    paths.push(resolvedPath);

    if (!asset.text || !canContainSupportedVisualReferences(resolvedPath)) continue;
    for (const reference of getSupportedVisualReferences(asset.text)) {
      const referenceKey = normalizePackFilePathKey(reference);
      if (referenceKey && !queuedOrRead.has(referenceKey)) queue.push(reference);
    }
  }

  return { paths, missing };
};
