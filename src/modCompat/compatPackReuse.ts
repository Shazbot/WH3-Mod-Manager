import type { Pack } from "../packFileTypes";

export interface CompatPackStat {
  size: number;
  mtimeMs: number;
}

export const isCompatTextFileName = (fileName: string) =>
  fileName.endsWith(".lua") ||
  fileName.endsWith(".xml") ||
  fileName.endsWith(".xml.material") ||
  fileName.endsWith(".variantmeshdefinition") ||
  fileName.endsWith(".wsmodel");

export const canReuseParsedPackForCompat = (pack: Pack, stat: CompatPackStat) =>
  pack.readTables === "all" && pack.size === stat.size && pack.lastChangedLocal === stat.mtimeMs;

export const canReusePackIndexForCompat = (pack: Pack, stat: CompatPackStat) =>
  pack.size === stat.size && pack.lastChangedLocal === stat.mtimeMs;

export const packHasCompatTextFiles = (pack: Pack) =>
  pack.packedFiles.some((packedFile) => isCompatTextFileName(packedFile.name));

export const packNeedsCompatTextRefresh = (pack: Pack) =>
  pack.packedFiles.some(
    (packedFile) => isCompatTextFileName(packedFile.name) && packedFile.text === undefined,
  );

/** Merge only transient source text, preserving the retained pack's parsed DB rows and index. */
export const mergeCompatTextIntoPack = (target: Pack, source: Pack) => {
  const sourceTextByName = new Map(
    source.packedFiles
      .filter((packedFile) => packedFile.text !== undefined)
      .map((packedFile) => [packedFile.name, packedFile.text] as const),
  );
  let mergedCount = 0;
  for (const packedFile of target.packedFiles) {
    const text = sourceTextByName.get(packedFile.name);
    if (text === undefined) continue;
    packedFile.text = text;
    mergedCount++;
  }
  return mergedCount;
};
