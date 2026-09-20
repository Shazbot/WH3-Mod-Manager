import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

import type { NewPackedFile } from "../packFileTypes";

const normalizePackPath = (value: string): string =>
  value.replace(/\//g, "\\").trim().replace(/^\\+/, "");

const isSafePackPath = (value: string): boolean => {
  if (!value || value.includes("\0") || nodePath.isAbsolute(value)) return false;
  return !value.split("\\").some((part) => part === ".." || part === "");
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
  const packStem = nodePath.basename(packPath).replace(/\.pack$/i, "");
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
