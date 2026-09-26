import React, { memo, useEffect, useRef } from "react";
import type { BuildingsCloneTarget } from "./useBuildingsDeepClone";

export type BuildingContextMenuProps = {
  x: number;
  y: number;
  heading: string;
  items: Array<{ label: string; target: BuildingsCloneTarget }>;
  onPick: (target: BuildingsCloneTarget) => void;
  onClose: () => void;
  /** Editing entries, listed under the clone ones. */
  editActions?: Array<{ label: string; run: () => void; separatorBefore?: boolean }>;
};

/**
 * The right-click menu over a building or a set label.
 *
 * The building menu keeps the culture-variant clone as its deep-clone entry; set-level actions are
 * still supplied separately when the user right-clicks a set label.
 */
const BuildingContextMenu = memo(({ x, y, heading, items, onPick, onClose, editActions }: BuildingContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const separatorCount = editActions?.filter((action) => action.separatorBefore).length ?? 0;
  const menuHeight =
    40 +
    items.length * 48 +
    (editActions && editActions.length > 0 ? editActions.length * 36 + 8 + separatorCount * 9 : 0);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      // Clamped so a right-click near the right or bottom edge does not open off screen.
      style={{
        left: Math.min(x, Math.max(0, window.innerWidth - 360)),
        top: Math.min(y, Math.max(0, window.innerHeight - menuHeight)),
      }}
      className="fixed z-[80] w-[340px] rounded border border-gray-600 bg-gray-800 py-1 shadow-lg"
    >
      <div className="truncate border-b border-gray-700 px-3 py-1 text-xs text-gray-400">{heading}</div>
      {items.map((item) => (
        <button
          key={`${item.target.tableName}:${item.target.keyValue}`}
          type="button"
          role="menuitem"
          onClick={() => onPick(item.target)}
          className="block w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-blue-800/60"
        >
          {item.label}
          <span className="block truncate text-xs text-gray-500">{item.target.tableName}</span>
        </button>
      ))}
      {editActions && editActions.length > 0 && (
        <div className="mt-1 border-t border-gray-700 pt-1">
          {editActions.map((action) => (
            <React.Fragment key={action.label}>
              {action.separatorBefore && <div className="my-1 border-t border-gray-700" role="separator" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  action.run();
                  onClose();
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-emerald-800/60"
              >
                {action.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
});

export default BuildingContextMenu;
