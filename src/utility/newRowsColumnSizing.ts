import type { DBField } from "../packFileTypes";

/** The default width used by the two new-row grids for columns without special sizing. */
export const NEW_ROWS_COLUMN_MIN_WIDTH = 120;

// ag-theme-material uses 24px of horizontal padding on each side of a cell. Include both borders
// and a small safety margin so a measured value does not end up with an ellipsis due to rounding.
const CELL_CONTENT_PADDING_PX = 52;
const CELL_FONT = "400 17.6px Roboto, Arial, sans-serif";
const HEADER_FONT = "500 14px Roboto, Arial, sans-serif";
const FALLBACK_GLYPH_WIDTH_PX = 10;

let textMeasureContext: CanvasRenderingContext2D | undefined;
const measuredTextWidths = new Map<string, number>();

const measureTextWidth = (text: string, font: string): number => {
  if (text.length === 0) return 0;

  const cacheKey = `${font}\u0000${text}`;
  const cached = measuredTextWidths.get(cacheKey);
  if (cached != undefined) return cached;

  const fallback = Math.ceil(text.length * FALLBACK_GLYPH_WIDTH_PX);
  if (typeof document === "undefined" || /jsdom/i.test(globalThis.navigator?.userAgent ?? "")) {
    measuredTextWidths.set(cacheKey, fallback);
    return fallback;
  }

  try {
    textMeasureContext ??= document.createElement("canvas").getContext("2d") ?? undefined;
    if (textMeasureContext) {
      textMeasureContext.font = font;
      const width = Math.ceil(textMeasureContext.measureText(text).width);
      measuredTextWidths.set(cacheKey, width);
      return width;
    }
  } catch {
    // A browser without a usable canvas still gets the conservative character-width fallback.
  }

  measuredTextWidths.set(cacheKey, fallback);
  return fallback;
};

export const isNewRowsFullValueField = (field: Pick<DBField, "is_key" | "is_reference">): boolean =>
  field.is_key || field.is_reference.length > 0;

/**
 * Width for a key/reference column that must keep every pending-row value on one line. Values are
 * measured from all rows, including rows outside the grid's currently rendered viewport.
 */
export const getNewRowsFullValueColumnWidth = (
  field: Pick<DBField, "name" | "is_key">,
  rows: readonly Record<string, unknown>[],
): number => {
  const headerWidth = measureTextWidth(field.is_key ? `${field.name} *` : field.name, HEADER_FONT);
  const widestValueWidth = rows.reduce((widest, row) => {
    const value = String(row[field.name] ?? "");
    return Math.max(widest, measureTextWidth(value, CELL_FONT));
  }, 0);

  return Math.max(
    NEW_ROWS_COLUMN_MIN_WIDTH,
    Math.ceil(Math.max(headerWidth, widestValueWidth) + CELL_CONTENT_PADDING_PX),
  );
};
