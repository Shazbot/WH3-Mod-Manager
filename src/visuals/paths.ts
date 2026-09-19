import { normalizePackFilePath } from "../utility/packFilePathUtils";

/** Resolves a variants table filename to the packed path consumed by the model preview host. */
export const toVariantMeshDefinitionPath = (value: string) => {
  let path = normalizePackFilePath(value);
  if (!path) return path;
  if (!path.toLowerCase().endsWith(".variantmeshdefinition")) {
    path = `${path}.variantmeshdefinition`;
  }
  const lower = path.toLowerCase();
  if (!lower.startsWith("variantmeshes\\")) {
    path = `variantmeshes\\variantmeshdefinitions\\${path}`;
  } else if (!lower.startsWith("variantmeshes\\variantmeshdefinitions\\")) {
    const baseName = path.split("\\").pop() || path;
    path = `variantmeshes\\variantmeshdefinitions\\${baseName}`;
  }
  return normalizePackFilePath(path);
};
