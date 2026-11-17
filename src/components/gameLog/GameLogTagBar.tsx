import { memo, useEffect, useState, type MouseEvent } from "react";
import {
  ALL_TAGS,
  isTagFilterActive,
  isTagShown,
  setTagShown,
  soloTag,
  toggleTag,
  type TagFilter,
} from "../../gameLog/parse";

export type GameLogTagBarProps = {
  /** [tag, line count], in display order. */
  tags: readonly (readonly [string, number])[];
  filter: TagFilter;
  onFilterChange: (filter: TagFilter) => void;
};

const MENU_WIDTH = 176;
const VIEWPORT_MARGIN = 8;

const menuItemClass =
  "w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent";

const GameLogTagBar = memo(({ tags, filter, onFilterChange }: GameLogTagBarProps) => {
  const [menu, setMenu] = useState<{ tag: string; x: number; y: number }>();

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const onBadgeClick = (tag: string, event: MouseEvent) =>
    onFilterChange(event.ctrlKey || event.metaKey ? soloTag(filter, tag) : toggleTag(filter, tag));

  const openMenu = (tag: string, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ tag, x: Math.min(event.clientX, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN), y: event.clientY });
  };

  const runMenuAction = (next: TagFilter) => {
    setMenu(undefined);
    onFilterChange(next);
  };

  const isActive = isTagFilterActive(filter);
  const isMenuTagOnlyShown = !!menu && filter.mode === "only" && filter.tags.size === 1 && filter.tags.has(menu.tag);

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1 bg-gray-800 border-b border-gray-600">
      {tags.map(([tag, count]) => {
        const isShown = isTagShown(filter, tag);
        return (
          <button
            type="button"
            key={tag}
            aria-pressed={isShown}
            title={`Click to ${isShown ? "hide" : "show"} · Ctrl+click to show only this`}
            onClick={(event) => onBadgeClick(tag, event)}
            onContextMenu={(event) => openMenu(tag, event)}
            className={`px-2 py-0.5 text-xs rounded-full border ${
              isShown
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-gray-800 border-gray-600 text-gray-500 line-through"
            }`}
          >
            {tag} {count}
          </button>
        );
      })}
      {isActive && (
        <button
          type="button"
          className="px-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
          onClick={() => onFilterChange(ALL_TAGS)}
        >
          Show all
        </button>
      )}
      {menu && (
        <div
          role="menu"
          className="fixed z-50 py-1 bg-gray-800 border border-gray-600 rounded shadow-lg"
          style={{ top: menu.y, left: menu.x, width: MENU_WIDTH }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            disabled={isMenuTagOnlyShown}
            onClick={() => runMenuAction(soloTag(filter, menu.tag))}
          >
            Show only this
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            disabled={!isTagShown(filter, menu.tag)}
            onClick={() => runMenuAction(setTagShown(filter, menu.tag, false))}
          >
            Hide this
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            disabled={!isActive}
            onClick={() => runMenuAction(ALL_TAGS)}
          >
            Show all
          </button>
        </div>
      )}
    </div>
  );
});
GameLogTagBar.displayName = "GameLogTagBar";

export default GameLogTagBar;
