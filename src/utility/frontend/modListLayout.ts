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
