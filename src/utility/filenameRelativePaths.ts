/** Splits schema filename_relative_path patterns using the pack path separator. */
export const parseFilenameRelativePaths = (filenameRelativePath: unknown): string[] => {
  if (typeof filenameRelativePath !== "string" || !filenameRelativePath.trim()) return [];
  return filenameRelativePath
    .split(";")
    .map((pattern) => pattern.trim().replace(/\//g, "\\"))
    .filter((pattern) => pattern.length > 0);
};

/** Applies the same placeholder and wildcard-prefix rules used by deep-clone file collection. */
export const getFilenameRelativePathMatch = (pattern: string, cellValue: string): { exactPath?: string; prefix?: string } => {
  const substituted = pattern.replace("%", cellValue);
  if (pattern.includes("*")) return { prefix: substituted.replace(/\*.*$/, "") };
  return { exactPath: pattern.split("%").join(cellValue) };
};
