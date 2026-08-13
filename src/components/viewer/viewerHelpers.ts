import type { DBVersion, SchemaField, AmendedSchemaField, PackedFile } from "@/src/packFileTypes";
import {
  getDBPackedFilePath,
  getDBNameFromString,
  getDBSubnameFromString,
  getPackNameFromPath,
} from "../../utility/packFileHelpers";

export interface WidestValue {
  value: string;
  width: number;
}

/**
 * Keeps the value a column has to be wide enough to display, comparing by rendered width.
 *
 * The longest value by character count is not the widest one in a proportional font, and for a key
 * column that difference is what puts an ellipsis on the value you most need to read in full.
 *
 * `maxGlyphWidthPx` is an upper bound on a single glyph's advance in the measured font. A candidate
 * whose length times that bound cannot reach the incumbent is skipped without measuring, which keeps
 * this affordable when it runs once per cell.
 */
export const pickWidestValue = (
  current: WidestValue,
  candidate: string,
  measure: (text: string) => number,
  maxGlyphWidthPx: number,
): WidestValue => {
  if (candidate.length * maxGlyphWidthPx < current.width) return current;

  const width = measure(candidate);
  return width > current.width ? { value: candidate, width } : current;
};

const MEMORY_PACK_PREFIX = "memory://";

/**
 * Name to offer in Save As: the open pack's own, so saving a copy is a one-word edit rather than
 * retyping. Memory packs carry their name in the path instead of a file name.
 */
export const getDefaultSaveAsPackName = (packPath: string): string => {
  const fileName = packPath.startsWith(MEMORY_PACK_PREFIX)
    ? packPath.slice(MEMORY_PACK_PREFIX.length)
    : (getPackNameFromPath(packPath) ?? packPath.split(/[\\/]/).pop() ?? "");
  return fileName.toLowerCase().endsWith(".pack") ? fileName.slice(0, -".pack".length) : fileName;
};

export const getPackFileInventory = (
  packData: Pick<PackViewData, "tables" | "packedFiles">,
  unsavedFiles: Array<Pick<PackedFile, "name">>,
) => {
  const fileNames = new Set([
    ...packData.tables,
    ...Object.keys(packData.packedFiles || {}),
    ...unsavedFiles.map((file) => file.name),
  ]);
  const hasDBTables = [...fileNames].some((fileName) =>
    Boolean(getDBNameFromString(fileName) && getDBSubnameFromString(fileName)),
  );

  return {
    isEmpty: fileNames.size === 0,
    hasDBTables,
    hasFiles: [...fileNames].some((fileName) => !getDBNameFromString(fileName) || !getDBSubnameFromString(fileName)),
  };
};

/** True when switching to this table can be satisfied entirely from renderer memory. */
export const hasLoadedDBTable = (
  packData: Pick<PackViewData, "packedFiles"> | undefined,
  unsavedFiles: readonly PackedFile[],
  selection: DBTableSelection,
): boolean => {
  const packedFilePath = getDBPackedFilePath(selection);
  const candidates = [...unsavedFiles, ...Object.values(packData?.packedFiles ?? {})];
  const packedFile =
    candidates.find((file) => file.name === packedFilePath) ??
    candidates.find((file) => file.name.startsWith(packedFilePath));

  // tableSchema is installed only after parsing and amendment. An empty table legitimately has no
  // schemaFields, so array length cannot distinguish it from an index-only descriptor.
  return packedFile?.tableSchema != undefined && packedFile.schemaFields != undefined;
};

export const chunkTableIntoRows = (schemaFields: SchemaField[], currentSchema: DBVersion) => {
  return (
    schemaFields.reduce<AmendedSchemaField[][]>((resultArray, item, index) => {
      const chunkIndex = Math.floor(index / currentSchema.fields.length);

      if (!resultArray[chunkIndex]) {
        resultArray[chunkIndex] = []; // start a new chunk
      }

      resultArray[chunkIndex].push(item as AmendedSchemaField);

      return resultArray;
    }, []) || []
  );
};

export const findNodeInTree = (
  tree: IViewerTreeNodeWithData | IViewerTreeNode,
  targetName: string,
): IViewerTreeNodeWithData | IViewerTreeNode | null => {
  if (tree.name === targetName) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNodeInTree(child, targetName);
      if (found) return found;
    }
  }
  return null;
};

export const findParentOfNode = (
  tree: IViewerTreeNodeWithData | IViewerTreeNode,
  targetName: string,
): IViewerTreeNodeWithData | IViewerTreeNode | null => {
  const findParentOfNodeIter = (
    tree: IViewerTreeNodeWithData | IViewerTreeNode,
    targetName: string,
    parentNode: IViewerTreeNodeWithData | IViewerTreeNode,
  ): IViewerTreeNodeWithData | IViewerTreeNode | null => {
    if (tree.name === targetName) return parentNode;
    if (tree.children) {
      for (const child of tree.children) {
        const found = findParentOfNodeIter(child, targetName, tree);
        if (found) return found;
      }
    }
    return null;
  };

  return findParentOfNodeIter(tree, targetName, tree);
};
