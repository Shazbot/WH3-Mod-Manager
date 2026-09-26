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

/**
 * Chooses a bounded content width from measured row widths.
 *
 * The nearest-rank percentile keeps the common case visible while allowing a few unusually long
 * values to use the pinned cell's hover expansion. Empty values should be omitted by the caller, so
 * they do not make the column look smaller without contributing any content that needs to fit.
 */
export const getPercentileWidth = (
  widths: readonly number[],
  percentile: number,
  minWidth: number,
  maxWidth: number,
): number => {
  const finiteWidths = widths.filter((width) => Number.isFinite(width));
  if (finiteWidths.length === 0) return minWidth;

  const sortedWidths = [...finiteWidths].sort((first, second) => first - second);
  const clampedPercentile = Math.min(1, Math.max(0, percentile));
  const rank = Math.max(1, Math.ceil(sortedWidths.length * clampedPercentile));
  const percentileWidth = sortedWidths[Math.min(rank, sortedWidths.length) - 1] ?? minWidth;

  return Math.min(maxWidth, Math.max(minWidth, Math.ceil(percentileWidth)));
};

/**
 * Segments a shortened value has to keep. Without a floor the detector will happily strip a key down
 * to `3` or `1` - still unique, and useless to read.
 */
const KEY_PREFIX_MIN_KEPT_SEGMENTS = 2;
/** No key in the game's own tables carries a shared prefix longer than this. */
const KEY_PREFIX_MAX_DEPTH = 6;
/**
 * Share of rows allowed to keep their full value before a depth is judged too deep. Going one
 * segment further usually costs a jump in exemptions rather than a few more - it is the point where
 * the prefix stops being boilerplate and starts being the thing that tells two rows apart.
 *
 * The floor is what keeps the share workable on a short table, where one honest pair of duplicates
 * is already a tenth of the rows and would otherwise veto shortening for all of them.
 */
const KEY_PREFIX_MAX_EXEMPT_SHARE = 0.05;
const KEY_PREFIX_MIN_EXEMPT_ALLOWANCE = 2;
/**
 * Whatever the allowance works out to, shortening has to be what the column mostly does. A depth
 * that only reaches a minority of the rows describes those rows, not the table.
 */
const KEY_PREFIX_MAX_EXEMPT_FRACTION = 0.5;
/**
 * Rows a prefix has to appear on before it counts as repeated. A row whose leading segments are its
 * own has nothing boilerplate to lose: `inf_spearmen_extra_long` sitting among `wh3_dlc27_` keys
 * would otherwise be cut down to `extra_long`, which drops the part that names it.
 */
const KEY_PREFIX_MIN_ROWS = 2;

export interface KeyPrefixDisplay {
  /** Underscore-separated segments hidden from the values that were shortened. */
  depth: number;
  /** Full value to what is shown for it. Only holds values that were actually shortened. */
  shortened: Map<string, string>;
}

const EMPTY_KEY_PREFIX_DISPLAY: KeyPrefixDisplay = { depth: 0, shortened: new Map() };

/**
 * Finds the leading segments a key column repeats on every row, so the column can stop spending
 * width on them.
 *
 * Game keys are `game_release_faction_...`, and the first segments are the same for whole runs of
 * rows: `wh3_dlc27_` in front of two thousand units says nothing about which unit a row is. The
 * depth is taken from the data rather than fixed, because it is not always two - the skill node
 * table repeats `wh3_dlc24_skill_node_` - and it is sometimes nothing at all, as for a table keyed
 * by number.
 *
 * A row keeps its full value when shortening it would leave too little to read, or would make it
 * read the same as another row: the game re-adds the same unit in later releases, so
 * `wh3_dlc27_chs_inf_chaos_warriors_0` and `wh_main_chs_inf_chaos_warriors_0` sit in one table, and
 * the release is the only thing telling them apart. Every displayed value is therefore still unique
 * to its row, which is what makes hiding the rest of it safe.
 */
export const buildKeyPrefixDisplay = (values: readonly string[]): KeyPrefixDisplay => {
  if (values.length === 0) return EMPTY_KEY_PREFIX_DISPLAY;

  const segmented = values.map((value) => value.split("_"));
  const maxExempt = Math.min(
    values.length * KEY_PREFIX_MAX_EXEMPT_FRACTION,
    Math.max(KEY_PREFIX_MIN_EXEMPT_ALLOWANCE, values.length * KEY_PREFIX_MAX_EXEMPT_SHARE),
  );
  let best = EMPTY_KEY_PREFIX_DISPLAY;

  for (let depth = 1; depth <= KEY_PREFIX_MAX_DEPTH; depth++) {
    const longEnough = segmented.map((segments) => segments.length - depth >= KEY_PREFIX_MIN_KEPT_SEGMENTS);

    const prefixCounts = new Map<string, number>();
    for (let index = 0; index < segmented.length; index++) {
      if (!longEnough[index]) continue;
      const prefix = segmented[index].slice(0, depth).join("_");
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }

    const candidates = segmented.map((segments, index) => {
      if (!longEnough[index]) return undefined;
      const prefix = segments.slice(0, depth).join("_");
      if ((prefixCounts.get(prefix) ?? 0) < KEY_PREFIX_MIN_ROWS) return undefined;
      return segments.slice(depth).join("_");
    });
    if (candidates.every((candidate) => candidate === undefined)) break;

    // What each row would show at this depth, exempt rows included: a shortened value that matches
    // some other row's full value is just as ambiguous as one that matches another shortened value.
    const displayCounts = new Map<string, number>();
    for (let index = 0; index < values.length; index++) {
      const display = candidates[index] ?? values[index];
      displayCounts.set(display, (displayCounts.get(display) ?? 0) + 1);
    }

    const shortened = new Map<string, string>();
    let exempt = 0;
    for (let index = 0; index < values.length; index++) {
      const candidate = candidates[index];
      if (candidate !== undefined && displayCounts.get(candidate) === 1) shortened.set(values[index], candidate);
      else exempt++;
    }

    if (exempt > maxExempt) break;
    best = { depth, shortened };
  }

  return best;
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

export interface PackTabTreeState {
  packPath: string;
  openTabs: ReadonlyArray<{ id: string; kind: "db" | "flow" | "file" | "loadOrderRules" }>;
  activeTabId: string | null;
}

/** Chooses the tree sub-tab without changing the value for unrelated pack updates. */
export const getPreferredTreeTab = (
  packTab: PackTabTreeState,
  packsDataByPath: Record<string, PackViewData>,
  unsavedPacksDataByPath: Record<string, PackedFile[]>,
): "db" | "files" => {
  const activeTab = packTab.openTabs.find((tab) => tab.id === packTab.activeTabId);
  const packData = packsDataByPath[packTab.packPath];
  const inventory = packData
    ? getPackFileInventory(packData, unsavedPacksDataByPath[packTab.packPath] ?? [])
    : undefined;

  // The rules file sits under whmm\, so like a flow or any other packed file it belongs to the
  // Files side of the tree rather than DB Tables.
  const isNonDBTab =
    activeTab?.kind === "flow" || activeTab?.kind === "file" || activeTab?.kind === "loadOrderRules";

  return isNonDBTab || (!inventory?.hasDBTables && inventory?.hasFiles) ? "files" : "db";
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
