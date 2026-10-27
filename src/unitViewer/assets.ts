import bs from "binary-search";
import type { PackedFile } from "../packFileTypes";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { collator } from "../utility/packFileSorting";

export const getUnitViewerAssetCandidates = (normalizedPath: string) => {
  const withoutExtension = normalizedPath.replace(/\.(png|webp|jpe?g)$/i, "");
  return Array.from(
    new Set([normalizedPath, `${withoutExtension}.png`, `${withoutExtension}.webp`, `${withoutExtension}.jpg`]),
  );
};

/** Matches a batch against one sorted pack index without rescanning it for each missing candidate. */
export const findUnitViewerAssetFiles = (
  packedFiles: Pick<PackedFile, "name">[],
  normalizedPaths: Iterable<string>,
): Map<string, string> => {
  const candidatesByAsset = Array.from(normalizedPaths, (path) => [path, getUnitViewerAssetCandidates(path)] as const);
  const wanted = new Set(candidatesByAsset.flatMap(([, candidates]) => candidates.map(normalizePackFilePathKey)));
  let fallback: Map<string, string> | undefined;
  const matches = new Map<string, string>();

  for (const [path, candidates] of candidatesByAsset) {
    for (const candidate of candidates) {
      // Keep the existing binary-search preference, including when normalized duplicates exist.
      const index = bs(packedFiles, candidate, (file, name) => collator.compare(file.name, name));
      if (index >= 0) {
        matches.set(path, packedFiles[index].name);
        break;
      }
      if (!fallback) {
        fallback = new Map();
        for (const file of packedFiles) {
          const key = normalizePackFilePathKey(file.name);
          if (wanted.has(key) && !fallback.has(key)) fallback.set(key, file.name);
        }
      }
      const fileName = fallback.get(normalizePackFilePathKey(candidate));
      if (fileName !== undefined) {
        matches.set(path, fileName);
        break;
      }
    }
  }
  return matches;
};
