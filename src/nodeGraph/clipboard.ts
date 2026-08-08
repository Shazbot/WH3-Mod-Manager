import type { Edge, Node } from "@xyflow/react";

export interface NodeGraphClipboard {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Whether the keystroke landed in something the user is typing into.
 *
 * Copy and paste only act on nodes when the graph itself has focus; inside a field the browser's own
 * text handling has to win, or you could not paste a table name into a textbox.
 */
export const isTextEntryTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
};

/** Node data without the editor callbacks, so a copy can be structured-cloned. */
const cloneNodeData = (data: Record<string, unknown> | undefined): Record<string, unknown> => {
  const plainData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (typeof value === "function") continue;
    plainData[key] = value;
  }
  return structuredClone(plainData);
};

/**
 * Takes the selected nodes and the edges that run between them.
 *
 * An edge with only one end selected is left out: pasting it would wire the copy back into the
 * original, which is never what copying a group of nodes means.
 */
export const copySelectedNodes = (nodes: Node[], edges: Edge[]): NodeGraphClipboard | undefined => {
  const selectedNodes = nodes.filter((node) => node.selected);
  if (selectedNodes.length === 0) return undefined;

  const selectedIds = new Set(selectedNodes.map((node) => node.id));

  return {
    nodes: selectedNodes.map((node) => ({
      ...node,
      data: cloneNodeData(node.data as Record<string, unknown>),
      selected: false,
      dragging: false,
    })),
    edges: edges
      .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
      .map((edge) => ({ ...edge, selected: false })),
  };
};

/**
 * Adds a copy of the clipboard to the graph: fresh ids, nudged into view of the originals, and the
 * copied edges rewired between the new nodes.
 *
 * The pasted nodes come out selected and the originals deselected, so a second paste copies the copy
 * and repeated pastes walk across the canvas instead of stacking.
 */
export const pasteNodes = (
  state: { nodes: Node[]; edges: Edge[] },
  clipboard: NodeGraphClipboard,
  createNodeId: () => string,
  offset: { x: number; y: number } = { x: 40, y: 40 },
): { nodes: Node[]; edges: Edge[] } => {
  if (clipboard.nodes.length === 0) return state;

  const newIdByOldId = new Map<string, string>();
  const pastedNodes = clipboard.nodes.map((node) => {
    const newId = createNodeId();
    newIdByOldId.set(node.id, newId);
    return {
      ...node,
      id: newId,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data: cloneNodeData(node.data as Record<string, unknown>),
      selected: true,
      dragging: false,
    };
  });

  const pastedEdges = clipboard.edges.map((edge) => {
    const source = newIdByOldId.get(edge.source)!;
    const target = newIdByOldId.get(edge.target)!;
    return {
      ...edge,
      id: `edge-${source}-${target}-${edge.sourceHandle ?? ""}-${edge.targetHandle ?? ""}`,
      source,
      target,
      selected: false,
    };
  });

  return {
    nodes: [...state.nodes.map((node) => ({ ...node, selected: false })), ...pastedNodes],
    edges: [...state.edges, ...pastedEdges],
  };
};
