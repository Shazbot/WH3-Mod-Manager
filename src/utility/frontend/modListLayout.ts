/**
 * The mod list is rendered in one of two shapes.
 *
 * `wide` is the historical single-list layout: one column each for order, the enabled checkbox,
 * thumbnail, pack name, human name, author, last updated and configuration.
 *
 * `compact` is used by the dual layout, where two lists share the width one used to have. It drops the
 * enabled checkbox column (clicking the row toggles the mod instead) and stacks human name, author and
 * pack name into a single cell. The configuration column is only present on the enabled-mods pane.
 */
export type ModListLayout = "wide" | "compact";

/** Everything a row needs that is cheaper to derive once for the whole list than per row. */
export type ModRowDatum = {
  mod: Mod;
  isAlwaysEnabled: boolean;
  isEnabledInMergedMod: boolean;
  decodedHumanName: string;
  decodedAuthor: string;
  customFolderPath?: string;
  hasDbCustomization: boolean;
  hasFlowCustomization: boolean;
  hasPackDataOverwrite: boolean;
  thumbnailSrc: string;
};

type GridClassOptions = {
  isAuthorEnabled: boolean;
  areThumbnailsEnabled: boolean;
  showConfigColumn: boolean;
};

/**
 * The CSS grid template the header container and every row share. Column counts differ between the
 * variants, which is why the class has to be picked rather than composed.
 */
export const getModListGridClass = (
  layout: ModListLayout,
  { isAuthorEnabled, areThumbnailsEnabled, showConfigColumn }: GridClassOptions,
) => {
  if (layout === "compact") {
    if (areThumbnailsEnabled && showConfigColumn) return "grid-mods-compact-thumbs-config";
    if (areThumbnailsEnabled) return "grid-mods-compact-thumbs";
    if (showConfigColumn) return "grid-mods-compact-config";
    return "grid-mods-compact";
  }

  if (isAuthorEnabled && areThumbnailsEnabled) return "grid-mods-thumbs-author";
  if (isAuthorEnabled) return "grid-mods-author";
  if (areThumbnailsEnabled) return "grid-mods-thumbs";
  return "grid-mods";
};

/** How far a load-order drop placeholder has to stretch to span the whole row. */
export const getModListGhostClass = (
  layout: ModListLayout,
  { isAuthorEnabled, areThumbnailsEnabled, showConfigColumn }: GridClassOptions,
) => {
  if (layout === "compact") {
    const columnCount = 3 + (areThumbnailsEnabled ? 1 : 0) + (showConfigColumn ? 1 : 0);
    return `grid-column-compact-${columnCount}`;
  }

  if (isAuthorEnabled && areThumbnailsEnabled) return "grid-column-8";
  if (isAuthorEnabled) return "grid-column-7";
  if (areThumbnailsEnabled) return "grid-column-7";
  return "grid-column-6";
};

/** The category a mod with none of its own is filed under, matching the categories tab's own fallback. */
export const uncategorizedCategoryName = "Uncategorized";

/** A mod row, tagged so it can share the list with the category headers. */
export type ModListModRow = { kind: "mod" } & ModRowDatum;

/** The heading that opens a category's run of rows in the grouped list. */
export type ModListCategoryHeaderRow = {
  kind: "categoryHeader";
  category: string;
  /** How many mods the category holds after filtering, whether or not they are currently rendered. */
  modCount: number;
  isCollapsed: boolean;
};

export type ModListRow = ModListModRow | ModListCategoryHeaderRow;

/** Every category a mod belongs to, falling back to the uncategorized bucket. */
export const getModCategories = (mod: Mod) =>
  mod.categories && mod.categories.length > 0 ? mod.categories : [uncategorizedCategoryName];

/** Uncategorized leads, since it is the bucket rather than a name the user chose; the rest sort by name. */
const compareCategoryNames = (first: string, second: string) => {
  if (first === second) return 0;
  if (first === uncategorizedCategoryName) return -1;
  if (second === uncategorizedCategoryName) return 1;
  return first.localeCompare(second);
};

/**
 * Interleaves category headings into a list of mod rows.
 *
 * A mod carries a list of categories rather than one, so it shows up under each of them - the same way
 * the categories tab lists it. Rows keep the order they came in with inside their category, which is
 * whatever the list is currently sorted by. A collapsed category renders as its heading alone, but its
 * heading still counts every mod it holds.
 */
export const groupModRowsByCategory = (rows: ModListModRow[], collapsedCategories: Set<string>): ModListRow[] => {
  const rowsByCategory = new Map<string, ModListModRow[]>();

  for (const row of rows) {
    for (const category of getModCategories(row.mod)) {
      const categoryRows = rowsByCategory.get(category);
      if (categoryRows) categoryRows.push(row);
      else rowsByCategory.set(category, [row]);
    }
  }

  return Array.from(rowsByCategory.entries())
    .sort(([firstCategory], [secondCategory]) => compareCategoryNames(firstCategory, secondCategory))
    .flatMap(([category, categoryRows]): ModListRow[] => {
      const isCollapsed = collapsedCategories.has(category);
      const header: ModListCategoryHeaderRow = {
        kind: "categoryHeader",
        category,
        modCount: categoryRows.length,
        isCollapsed,
      };
      return isCollapsed ? [header] : [header, ...categoryRows];
    });
};
