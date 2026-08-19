import React, { CSSProperties, memo, useContext } from "react";
import { GoChevronDown, GoChevronRight } from "react-icons/go";
import { CellMeasurerChildProps } from "react-virtualized/dist/es/CellMeasurer";

import localizationContext from "../localizationContext";
import { getCategoryColorClasses } from "../utility/frontend/categoryColors";
import { uncategorizedCategoryName } from "../utility/frontend/modListLayout";

type ModListCategoryHeaderProps = {
  category: string;
  /** Every mod the category holds after filtering, the enabled ones included. */
  modCount: number;
  /** How many of those are still switched off - the rows this heading opens. */
  notEnabledCount: number;
  isCollapsed: boolean;
  /** The colour the category was given in the categories tab, if any. */
  color?: string;
  onCategoryToggled?: (category: string) => void;
  onCategoryRightClick?: (category: string) => void;
  style: CSSProperties;
  registerChild: CellMeasurerChildProps["registerChild"];
};

/**
 * The heading that opens a category's run of rows in the grouped mod list.
 *
 * It is a row of the same virtualized list as the mods, so it is positioned by the `style` the list hands
 * it and measured by the `CellMeasurer` around it, rather than being laid out by the pane's grid.
 *
 * Only the mods that are not enabled yet are listed under it, so the count is what the heading is for: it
 * is the one place a category whose mods are all enabled still shows up.
 */
const ModListCategoryHeader = memo(
  ({
    category,
    modCount,
    notEnabledCount,
    isCollapsed,
    color,
    onCategoryToggled,
    onCategoryRightClick,
    style,
    registerChild,
  }: ModListCategoryHeaderProps) => {
    const localized: Record<string, string> = useContext(localizationContext);
    const colorClasses = getCategoryColorClasses(color);
    // "Uncategorized" is a stored category name rather than a label, so only its display side is localized.
    const label = (category === uncategorizedCategoryName && (localized.uncategorized || category)) || category;
    const isEveryModEnabled = notEnabledCount === 0;

    return (
      <div style={style} ref={registerChild}>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-2 py-1 border-b border-slate-600/60 text-left cursor-pointer hover:bg-slate-700/40"
          aria-expanded={!isCollapsed}
          title={`${notEnabledCount}/${modCount} ${localized.modsNotEnabledInCategory || "mods not enabled"}\n${
            localized.enableOrDisableAllInCategory || "Right click: enable or disable every mod in the category."
          }`}
          onClick={() => onCategoryToggled?.(category)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCategoryRightClick?.(category);
          }}
        >
          {(isCollapsed && <GoChevronRight className="shrink-0 opacity-70" aria-hidden />) || (
            <GoChevronDown className="shrink-0 opacity-70" aria-hidden />
          )}
          <span
            className={`truncate rounded px-2 py-0.5 text-sm font-medium ${colorClasses.bg} ${colorClasses.text}`}
            title={label}
          >
            {label}
          </span>
          {/* A category with nothing left to enable is dimmed rather than hidden: it is still the handle
              for switching all of its mods back off. */}
          <span className={`ml-auto shrink-0 pr-1 text-sm ${isEveryModEnabled ? "opacity-40" : ""}`}>
            {notEnabledCount}
            <span className="opacity-60">/{modCount}</span>
          </span>
        </button>
      </div>
    );
  },
);

export default ModListCategoryHeader;
