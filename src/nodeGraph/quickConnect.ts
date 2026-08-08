import type { Connection, Edge } from "@xyflow/react";

type QuickConnectHandle = {
  id?: string | null;
};

type QuickConnectEdge = Pick<Edge, "source" | "sourceHandle" | "target" | "targetHandle">;

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

  const sourceHandleIds = sourceHandles.map((handle) => handle.id ?? null);
  const targetHandleIds = targetHandles.map((handle) => handle.id ?? null);

  const isSourceHandleFree = (sourceHandle: string | null) =>
    !edges.some(
      (edge) => edge.source === sourceNodeId && (edge.sourceHandle ?? null) === sourceHandle,
    );
  const isTargetHandleFree = (targetHandle: string | null) =>
    !edges.some(
      (edge) => edge.target === targetNodeId && (edge.targetHandle ?? null) === targetHandle,
    );

  // Free handles first on both sides. On a node with several outputs - a conditional branch, say -
  // quick connect should reach for the one still unused rather than always the first.
  const orderedSourceHandles = [
    ...sourceHandleIds.filter(isSourceHandleFree),
    ...sourceHandleIds.filter((sourceHandle) => !isSourceHandleFree(sourceHandle)),
  ];
  const orderedTargetHandles = [
    ...targetHandleIds.filter(isTargetHandleFree),
    ...targetHandleIds.filter((targetHandle) => !isTargetHandleFree(targetHandle)),
  ];

  // Source-major, so a free source paired with an occupied target is still preferred over falling
  // back to a source that is already wired up.
  return orderedSourceHandles.flatMap((sourceHandle) =>
    orderedTargetHandles.map((targetHandle) => ({
      source: sourceNodeId,
      sourceHandle,
      target: targetNodeId,
      targetHandle,
    })),
  );
};
