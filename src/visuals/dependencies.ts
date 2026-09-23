import { XMLParser } from "fast-xml-parser";
import { normalizePackFilePath, normalizePackFilePathKey } from "../utility/packFilePathUtils";

export type SupportedVisualDependencyExtension =
  | "variantmeshdefinition"
  | "wsmodel"
  | "rigid_model_v2"
  | "xml.material"
  | "dds";

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
  for (const child of Object.values(value as Record<string, unknown>)) {
    collectStringValues(child, output);
  }
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
