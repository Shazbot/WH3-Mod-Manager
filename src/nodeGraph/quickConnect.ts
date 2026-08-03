import type { Connection, Edge } from "@xyflow/react";

type QuickConnectHandle = {
  id?: string | null;
};

type QuickConnectEdge = Pick<Edge, "target" | "targetHandle">;

export const hasDirectedConnection = (
  edges: Array<Pick<Edge, "source" | "target">>,
  sourceNodeId: string,
  targetNodeId: string,
): boolean => edges.some((edge) => edge.source === sourceNodeId && edge.target === targetNodeId);

export const buildQuickConnectionCandidates = ({
  sourceNodeId,
  targetNodeId,
  sourceHandles,
  targetHandles,
  edges,
}: {
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandles: QuickConnectHandle[];
  targetHandles: QuickConnectHandle[];
  edges: QuickConnectEdge[];
}): Connection[] => {
  if (sourceNodeId === targetNodeId || sourceHandles.length === 0 || targetHandles.length === 0) {
    return [];
  }

  const sourceHandle = sourceHandles[0].id ?? null;
  const targetHandleIds = targetHandles.map((handle) => handle.id ?? null);
  const isTargetHandleFree = (targetHandle: string | null) =>
    !edges.some(
      (edge) => edge.target === targetNodeId && (edge.targetHandle ?? null) === targetHandle,
    );

  const freeTargetHandles = targetHandleIds.filter(isTargetHandleFree);
  const occupiedTargetHandles = targetHandleIds.filter((targetHandle) => !isTargetHandleFree(targetHandle));

  return [...freeTargetHandles, ...occupiedTargetHandles].map((targetHandle) => ({
    source: sourceNodeId,
    sourceHandle,
    target: targetNodeId,
    targetHandle,
  }));
};
