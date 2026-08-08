import React from "react";

import { FlowNodeDataPatch, FlowOption, NodeEditorActionData } from "../types";

export const DefaultTableVersionsContext = React.createContext<Record<string, number> | undefined>(undefined);

export const useDefaultTableVersions = () => {
  return React.useContext(DefaultTableVersionsContext);
};

/**
 * The flow's options, so a node can offer them for selection. Ambient editor state rather than node
 * data: only the chosen option's id is persisted with the node.
 */
export const FlowOptionsContext = React.createContext<FlowOption[]>([]);

export const useFlowOptions = () => {
  return React.useContext(FlowOptionsContext);
};

export const dispatchNodeDataUpdate = (
  data: NodeEditorActionData | undefined,
  detail: FlowNodeDataPatch & { nodeId?: string },
) => {
  if (typeof data?.onUpdateNodeData !== "function") {
    return;
  }

  const { nodeId: _nodeId, ...patch } = detail;
  data.onUpdateNodeData(patch);
};

export const isNodeEditorDebugEnabled = () =>
  process.env.NODE_ENV === "development" && process.env.WHMM_VERBOSE_NODE_EDITOR === "1";

export const nodeEditorDebugLog = (...args: unknown[]) => {
  if (isNodeEditorDebugEnabled()) {
    console.log(...args);
  }
};

// Only stop wheel propagation when the node content can actually scroll.
export const stopWheelPropagation = (e: React.WheelEvent<HTMLDivElement>) => {
  const target = e.currentTarget;
  const { scrollTop, scrollHeight, clientHeight } = target;
  const isScrollable = scrollHeight > clientHeight;

  if (!isScrollable) {
    return;
  }

  const isAtTop = scrollTop === 0;
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

  if (e.deltaY > 0 && isAtBottom) {
    return;
  }

  if (e.deltaY < 0 && isAtTop) {
    return;
  }

  // Let the scrollable element handle its own wheel scrolling while keeping
  // the event from bubbling up to the graph canvas.
  e.stopPropagation();
};
