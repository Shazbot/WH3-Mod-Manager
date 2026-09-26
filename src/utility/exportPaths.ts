import * as nodePath from "node:path";

/** Resolves a relative export path while keeping it inside the chosen directory. */
export const resolveExportOutputPath = (baseDirectory: string, relativePath: string): string | undefined => {
  const resolvedBaseDirectory = nodePath.resolve(baseDirectory);
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalizedRelativePath.includes("..")) return;

  const outputPath = nodePath.resolve(resolvedBaseDirectory, normalizedRelativePath);
  const baseWithSep = resolvedBaseDirectory.endsWith(nodePath.sep)
    ? resolvedBaseDirectory
    : `${resolvedBaseDirectory}${nodePath.sep}`;
  if (outputPath !== resolvedBaseDirectory && !outputPath.startsWith(baseWithSep)) return;

  return outputPath;
};
