import { normalizePackFilePath } from "./packFilePathUtils";

/** Returns the pack-relative folder containing a packed file. */
export const getParentPackFolder = (filePath: string) => {
  const normalizedPath = normalizePackFilePath(filePath);
  const separatorIndex = normalizedPath.lastIndexOf("\\");
  return separatorIndex < 0 ? "" : normalizedPath.slice(0, separatorIndex);
};

/** Returns every folder represented by the parent segments of the supplied packed file paths. */
export const getPackFolderPaths = (filePaths: string[]) => {
  const folderPaths = new Map<string, string>();

  for (const filePath of filePaths) {
    const segments = normalizePackFilePath(filePath).split("\\").filter(Boolean);
    let currentPath = "";
    for (let index = 0; index < segments.length - 1; index += 1) {
      currentPath = currentPath ? `${currentPath}\\${segments[index]}` : segments[index];
      const key = currentPath.toLowerCase();
      if (!folderPaths.has(key)) folderPaths.set(key, currentPath);
    }
  }

  return [...folderPaths.values()];
};
