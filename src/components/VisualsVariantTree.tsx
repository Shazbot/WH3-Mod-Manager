import React, { memo, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import type { VariantMeshCatalog } from "../visuals/variantMesh";
import {
  buildVariantMeshTree,
  soloTreeItem,
  type VariantTreeChoiceNode,
  type VariantTreeNode,
  type VariantTreeSlotNode,
} from "../visuals/variantMeshTree";

type VisualsVariantTreeProps = {
  /** Undefined until the preview has loaded the VMD catalog. */
  catalog?: VariantMeshCatalog;
  isCatalogReady: boolean;
  renderedChoiceKeys: readonly string[];
  hiddenIds: readonly string[];
  onHiddenIdsChange: (ids: string[]) => void;
  /** Asks the preview to render a choice that is not currently shown. */
  onSelectChoice: (choiceKey: string) => void;
};

const INDENT_PX = 14;

const VisualsVariantTree = memo(
  ({ catalog, isCatalogReady, renderedChoiceKeys, hiddenIds, onHiddenIdsChange, onSelectChoice }: VisualsVariantTreeProps) => {
    const tree = useMemo(() => (catalog ? buildVariantMeshTree(catalog) : []), [catalog]);
    const rendered = useMemo(() => new Set(renderedChoiceKeys), [renderedChoiceKeys]);
    const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

    const toggleEye = (event: React.MouseEvent, id: string) => {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        onHiddenIdsChange(soloTreeItem(tree, id, hiddenIds));
        return;
      }
      onHiddenIdsChange(hidden.has(id) ? hiddenIds.filter((hiddenId) => hiddenId !== id) : [...hiddenIds, id]);
    };

    const renderNode = (node: VariantTreeNode, depth: number, ancestorHidden: boolean): React.ReactNode => {
      const isChoice = node.kind === "choice";
      const isHidden = hidden.has(node.id);
      const isMuted = ancestorHidden || isHidden;
      const isUnrendered = isChoice && !rendered.has(node.id);
      const dimmed = isMuted || isUnrendered;
      const children: VariantTreeNode[] =
        node.kind === "slot" ? node.choices : (node as VariantTreeChoiceNode).children;
      const isExpandable = children.length > 0;
      const isOpen = !collapsed[node.id];
      const label = node.kind === "slot" ? node.label : `${node.choiceIndex + 1} · ${node.label}`;
      const stateNotes = [
        isHidden ? "hidden" : ancestorHidden ? "hidden by parent" : "",
        isUnrendered ? "not shown in preview, click to select" : "",
      ].filter(Boolean);
      const title = [isChoice ? (node.targetPath ?? node.label) : node.id, ...stateNotes].join(" - ");
      const canSelect = isChoice && isUnrendered;
      return (
        <React.Fragment key={node.id}>
          <div
            className="flex items-center gap-1 py-0.5 pr-2 hover:bg-gray-800"
            style={{ paddingLeft: 4 + depth * INDENT_PX }}
          >
            {isExpandable ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${label}`}
                className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-400 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
                onClick={() => setCollapsed((current) => ({ ...current, [node.id]: isOpen }))}
              >
                <FontAwesomeIcon icon={faChevronRight} className={`text-[10px] ${isOpen ? "rotate-90" : ""}`} />
              </button>
            ) : (
              <span className="h-4 w-4 shrink-0" />
            )}
            <button
              type="button"
              aria-pressed={!isHidden}
              aria-label={`${isHidden ? "Show" : "Hide"} ${label}`}
              title={`${isHidden ? "Show" : "Hide"} ${label} (Ctrl+click to show only this)`}
              className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-300 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
              onClick={(event) => toggleEye(event, node.id)}
            >
              <FontAwesomeIcon icon={isHidden ? faEyeSlash : faEye} className="text-[11px]" />
            </button>
            <button
              type="button"
              title={title}
              disabled={!canSelect}
              className={`min-w-0 flex-1 truncate text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 ${
                node.kind === "slot" ? "font-medium" : ""
              } ${dimmed ? "text-gray-500" : "text-gray-100"} ${canSelect ? "cursor-pointer hover:text-blue-400" : "cursor-default"}`}
              onClick={() => canSelect && onSelectChoice(node.id)}
            >
              {label}
              {isChoice && node.isReference && <span className="ml-1 text-[10px] text-gray-500">VMD</span>}
            </button>
          </div>
          {isExpandable && isOpen && children.map((child) => renderNode(child, depth + 1, isMuted))}
        </React.Fragment>
      );
    };

    return (
      <div className="h-full min-h-0 overflow-auto bg-gray-900 py-1 text-xs" aria-label="Variant slots">
        {!catalog && !isCatalogReady ? (
          <div className="p-3 text-gray-400">Loading slots…</div>
        ) : tree.length === 0 ? (
          <div className="p-3 text-gray-400">This file has no variant slots.</div>
        ) : (
          tree.map((slot: VariantTreeSlotNode) => renderNode(slot, 0, false))
        )}
      </div>
    );
  },
);

VisualsVariantTree.displayName = "VisualsVariantTree";

export default VisualsVariantTree;
