import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

import type { NewPackedFile } from "../packFileTypes";
import type { VariantMeshSelection } from "./variantMesh";

export const UNIT_PAINTER_PROJECT_MANIFEST_PATH = "whmm_unit_painter\\project.json";
export const UNIT_PAINTER_PROJECT_FORMAT_VERSION = 1;

export type UnitPainterProjectTexture = {
  sourceVirtualPath: string;
  width: number;
  height: number;
  rgbaBytes: Uint8Array;
};

export type UnitPainterProjectManifest = {
  formatVersion: 1;
  sourceVariantMeshDefinition: string;
  variantSelections: VariantMeshSelection[];
  paintedTextures: Array<{
    sourceVirtualPath: string;
    width: number;
    height: number;
    filePath: string;
  }>;
};

const normalizePackPath = (value: string): string => value.replace(/\//g, "\\").trim();

const isSafePackPath = (value: string): boolean => {
  if (
    !value
    || value.includes("\0")
    || value.startsWith("\\")
    || /^[a-zA-Z]:/.test(value)
    || nodePath.isAbsolute(value)
  ) {
    return false;
  }
  return !value.split("\\").some((part) => part === ".." || part === "." || part === "");
};

const isPainterManifestPath = (value: string): boolean =>
  !value.includes("\\") && /^whmm_unit_painter_manifest_.+\.json$/i.test(value);

export const ensureUnitPainterPackExtension = (filePath: string): string =>
  filePath.toLowerCase().endsWith(".pack") ? filePath : `${filePath}.pack`;

export const getUnitPainterDefaultPackName = (assetPath: string): string => {
  const fileName = normalizePackPath(assetPath).split("\\").pop() || "unit";
  const stem = fileName.replace(/\.variantmeshdefinition$/i, "").replace(/\.[^.]+$/, "");
  const safeStem = stem
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${safeStem || "unit"}_painted.pack`;
};

export const getUnitPainterNamespaceName = (packPath: string, assetPath: string): string => {
  const packFileName = packPath.replace(/\//g, "\\").split("\\").pop() || "";
  const packStem = packFileName.replace(/\.pack$/i, "");
  const sourceStem = getUnitPainterDefaultPackName(assetPath).replace(/\.pack$/i, "");
  const candidate = packStem || sourceStem;
  const sanitized = candidate
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return sanitized || "painted_unit";
};

export const buildUnitPainterPackFiles = async (
  generatedDirectory: string,
  generatedVirtualPaths: readonly string[],
  expectedVariantMeshPath: string,
): Promise<NewPackedFile[]> => {
  const root = nodePath.resolve(generatedDirectory);
  const expectedVmd = normalizePackPath(expectedVariantMeshPath);
  const expectedVmdKey = expectedVmd.toLowerCase();
  const seen = new Set<string>();
  const output: NewPackedFile[] = [];
  let foundExpectedVmd = false;

  for (const rawPath of generatedVirtualPaths) {
    if (typeof rawPath !== "string") throw new Error("WH3AssetHost returned an invalid generated file path.");

    const virtualPath = normalizePackPath(rawPath);
    if (!isSafePackPath(virtualPath)) {
      throw new Error(`WH3AssetHost returned an unsafe generated file path: ${rawPath}`);
    }
    if (isPainterManifestPath(virtualPath)) continue;

    const key = virtualPath.toLowerCase();
    if (seen.has(key)) throw new Error(`WH3AssetHost returned the generated file twice: ${virtualPath}`);
    seen.add(key);

    const fullPath = nodePath.resolve(root, ...virtualPath.split("\\"));
    const relative = nodePath.relative(root, fullPath);
    if (relative === ".." || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
      throw new Error(`Generated painter file escaped its staging directory: ${virtualPath}`);
    }

    const buffer = await fs.readFile(fullPath);
    output.push({
      name: virtualPath,
      buffer,
      file_size: buffer.length,
    });

    if (key === expectedVmdKey) foundExpectedVmd = true;
  }

  if (!foundExpectedVmd) {
    throw new Error(
      `Painted export did not contain the source VariantMeshDefinition override '${expectedVmd}'.`,
    );
  }
  if (output.length === 0) throw new Error("Painted export did not produce any packable game files.");

  return output;
};


const normalizeProjectSourcePath = (value: string) => normalizePackPath(value).replace(/^\\+/, "");

export const buildUnitPainterProjectPackFiles = (
  sourceVariantMeshDefinition: string,
  variantSelections: readonly VariantMeshSelection[],
  textures: readonly UnitPainterProjectTexture[],
): NewPackedFile[] => {
  const paintedTextures = textures.map((texture, index) => {
    const filePath = `whmm_unit_painter\\textures\\${String(index + 1).padStart(3, "0")}.rgba`;
    return {
      sourceVirtualPath: normalizeProjectSourcePath(texture.sourceVirtualPath),
      width: texture.width,
      height: texture.height,
      filePath,
    };
  });
  const manifest: UnitPainterProjectManifest = {
    formatVersion: UNIT_PAINTER_PROJECT_FORMAT_VERSION,
    sourceVariantMeshDefinition: normalizeProjectSourcePath(sourceVariantMeshDefinition),
    variantSelections: [...variantSelections]
      .map((selection) => ({ slotPath: selection.slotPath, choiceIndex: selection.choiceIndex }))
      .sort((a, b) => a.slotPath.localeCompare(b.slotPath)),
    paintedTextures,
  };
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  return [
    {
      name: UNIT_PAINTER_PROJECT_MANIFEST_PATH,
      buffer: manifestBuffer,
      file_size: manifestBuffer.length,
    },
    ...textures.map((texture, index) => {
      const buffer = Buffer.from(texture.rgbaBytes);
      return {
        name: paintedTextures[index].filePath,
        buffer,
        file_size: buffer.length,
      };
    }),
  ];
};

export const parseUnitPainterProjectManifest = (buffer: Uint8Array): UnitPainterProjectManifest => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(buffer).toString("utf8"));
  } catch {
    throw new Error("The unit painter project manifest is not valid JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("The unit painter project manifest is invalid.");
  const candidate = value as Partial<UnitPainterProjectManifest>;
  if (candidate.formatVersion !== UNIT_PAINTER_PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported unit painter project format '${String(candidate.formatVersion)}'. Expected version ${UNIT_PAINTER_PROJECT_FORMAT_VERSION}.`,
    );
  }
  if (typeof candidate.sourceVariantMeshDefinition !== "string" || !candidate.sourceVariantMeshDefinition.trim()) {
    throw new Error("The unit painter project is missing its source VariantMeshDefinition.");
  }
  const sourceVariantMeshDefinition = normalizeProjectSourcePath(candidate.sourceVariantMeshDefinition);
  if (!isSafePackPath(sourceVariantMeshDefinition) || !/\.variantmeshdefinition$/i.test(sourceVariantMeshDefinition)) {
    throw new Error("The unit painter project contains an invalid source VariantMeshDefinition path.");
  }
  if (!Array.isArray(candidate.variantSelections) || !Array.isArray(candidate.paintedTextures)) {
    throw new Error("The unit painter project manifest is incomplete.");
  }

  const variantSelections: VariantMeshSelection[] = [];
  const seenSlots = new Set<string>();
  for (const raw of candidate.variantSelections) {
    if (!raw || typeof raw !== "object") throw new Error("The unit painter project contains an invalid variant selection.");
    const selection = raw as Partial<VariantMeshSelection>;
    const slotPath = typeof selection.slotPath === "string" ? selection.slotPath.trim() : "";
    if (!slotPath || !Number.isInteger(selection.choiceIndex) || selection.choiceIndex! < 0) {
      throw new Error("The unit painter project contains an invalid variant selection.");
    }
    const key = slotPath.toLowerCase();
    if (seenSlots.has(key)) throw new Error(`The unit painter project repeats slot '${slotPath}'.`);
    seenSlots.add(key);
    variantSelections.push({ slotPath, choiceIndex: selection.choiceIndex! });
  }

  const paintedTextures: UnitPainterProjectManifest["paintedTextures"] = [];
  const seenSources = new Set<string>();
  const seenFiles = new Set<string>();
  for (const raw of candidate.paintedTextures) {
    if (!raw || typeof raw !== "object") throw new Error("The unit painter project contains an invalid painted texture.");
    const texture = raw as Partial<UnitPainterProjectManifest["paintedTextures"][number]>;
    const sourceVirtualPath =
      typeof texture.sourceVirtualPath === "string" ? normalizeProjectSourcePath(texture.sourceVirtualPath) : "";
    const filePath = typeof texture.filePath === "string" ? normalizePackPath(texture.filePath) : "";
    const width = typeof texture.width === "number" && Number.isInteger(texture.width) ? texture.width : 0;
    const height = typeof texture.height === "number" && Number.isInteger(texture.height) ? texture.height : 0;
    if (
      !sourceVirtualPath ||
      !isSafePackPath(sourceVirtualPath) ||
      !filePath ||
      !isSafePackPath(filePath) ||
      !/^whmm_unit_painter\\textures\\.+\.rgba$/i.test(filePath) ||
      width <= 0 ||
      height <= 0 ||
      width > 16384 ||
      height > 16384
    ) {
      throw new Error("The unit painter project contains an invalid painted texture.");
    }
    const sourceKey = sourceVirtualPath.toLowerCase();
    const fileKey = filePath.toLowerCase();
    if (seenSources.has(sourceKey) || seenFiles.has(fileKey)) {
      throw new Error("The unit painter project contains duplicate texture entries.");
    }
    seenSources.add(sourceKey);
    seenFiles.add(fileKey);
    paintedTextures.push({ sourceVirtualPath, width, height, filePath });
  }

  return {
    formatVersion: UNIT_PAINTER_PROJECT_FORMAT_VERSION,
    sourceVariantMeshDefinition,
    variantSelections,
    paintedTextures,
  };
};
