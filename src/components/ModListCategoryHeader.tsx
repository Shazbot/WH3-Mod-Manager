import React, { CSSProperties, memo, useContext } from "react";
import { GoChevronDown, GoChevronRight } from "react-icons/go";
import { CellMeasurerChildProps } from "react-virtualized/dist/es/CellMeasurer";

import localizationContext from "../localizationContext";
import { getCategoryColorClasses } from "../utility/frontend/categoryColors";
import { uncategorizedCategoryName } from "../utility/frontend/modListLayout";

type ModListCategoryHeaderProps = {
  category: string;
  /** How many mods the category holds after filtering, collapsed or not. */
  modCount: number;
  isCollapsed: boolean;
  /** The colour the category was given in the categories tab, if any. */
  color?: string;
  onCategoryToggled?: (category: string) => void;
  style: CSSProperties;
  registerChild: CellMeasurerChildProps["registerChild"];
};

/**
 * The heading that opens a category's run of rows in the grouped mod list.
 *
 * It is a row of the same virtualized list as the mods, so it is positioned by the `style` the list hands
 * it and measured by the `CellMeasurer` around it, rather than being laid out by the pane's grid.
 */
const ModListCategoryHeader = memo(
  ({ category, modCount, isCollapsed, color, onCategoryToggled, style, registerChild }: ModListCategoryHeaderProps) => {
    const localized: Record<string, string> = useContext(localizationContext);
    const colorClasses = getCategoryColorClasses(color);
    // "Uncategorized" is a stored category name rather than a label, so only its display side is localized.
    const label = (category === uncategorizedCategoryName && (localized.uncategorized || category)) || category;

    return (
      <div style={style} ref={registerChild}>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-2 py-1 border-b border-slate-600/60 text-left cursor-pointer hover:bg-slate-700/40"
          aria-expanded={!isCollapsed}
          title={(isCollapsed ? localized.expandAll : localized.collapseAll) || label}
          onClick={() => onCategoryToggled?.(category)}
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
          <span className="ml-auto shrink-0 pr-1 text-sm opacity-60">{modCount}</span>
        </button>
      </div>
    );
  },
);

export default ModListCategoryHeader;
