import { getSmoothStepPath, Position } from "@xyflow/react";

export type TechTreeNodeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TechTreeRenderedCompass = 1 | 2 | 3 | 4;

export type TechTreeLinkGeometry = {
  path: string;
  labelX: number;
  labelY: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  sourceCompass: TechTreeRenderedCompass;
  targetCompass: TechTreeRenderedCompass;
  sourceOffset: number;
  targetOffset: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const clampLinkPositionOffset = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return clamp(value, -1, 1);
};

const getNodeCenter = (nodeRect: TechTreeNodeRect) => ({
  x: nodeRect.x + nodeRect.width / 2,
  y: nodeRect.y + nodeRect.height / 2,
});

const compassToPosition = (compass: TechTreeRenderedCompass) => {
  if (compass === 1) return Position.Top;
  if (compass === 2) return Position.Right;
  if (compass === 3) return Position.Bottom;
  return Position.Left;
};

export const resolveRenderedCompass = (
  rawCompass: number | undefined,
  sourceRect: TechTreeNodeRect,
  targetRect: TechTreeNodeRect,
  side: "source" | "target",
): TechTreeRenderedCompass => {
  if (rawCompass === 1 || rawCompass === 2 || rawCompass === 3 || rawCompass === 4) {
    return rawCompass;
  }

  if (rawCompass !== 0) {
    return side === "source" ? 2 : 4;
  }

  const sourceCenter = getNodeCenter(sourceRect);
  const targetCenter = getNodeCenter(targetRect);
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    if (side === "source") return deltaX >= 0 ? 2 : 4;
    return deltaX >= 0 ? 4 : 2;
  }

  if (side === "source") return deltaY >= 0 ? 3 : 1;
  return deltaY >= 0 ? 1 : 3;
};

export const getNodeConnectionPoint = (
  nodeRect: TechTreeNodeRect,
  compass: TechTreeRenderedCompass,
  rawOffset: number | undefined,
) => {
  const offset = clampLinkPositionOffset(rawOffset);
  const centerX = nodeRect.x + nodeRect.width / 2;
  const centerY = nodeRect.y + nodeRect.height / 2;
  const offsetX = (nodeRect.width / 2) * offset;
  const offsetY = (nodeRect.height / 2) * offset;

  if (compass === 1) {
    return { x: centerX + offsetX, y: nodeRect.y };
  }
  if (compass === 2) {
    return { x: nodeRect.x + nodeRect.width, y: centerY + offsetY };
  }
  if (compass === 3) {
    return { x: centerX + offsetX, y: nodeRect.y + nodeRect.height };
  }
  return { x: nodeRect.x, y: centerY + offsetY };
};

export const buildTechTreeLinkGeometry = (args: {
  sourceRect: TechTreeNodeRect;
  targetRect: TechTreeNodeRect;
  rawSourceCompass: number | undefined;
  rawTargetCompass: number | undefined;
  rawSourceOffset: number | undefined;
  rawTargetOffset: number | undefined;
}): TechTreeLinkGeometry => {
  const sourceCompass = resolveRenderedCompass(
    args.rawSourceCompass,
    args.sourceRect,
    args.targetRect,
    "source",
  );
  const targetCompass = resolveRenderedCompass(
    args.rawTargetCompass,
    args.sourceRect,
    args.targetRect,
    "target",
  );
  const sourceOffset = clampLinkPositionOffset(args.rawSourceOffset);
  const targetOffset = clampLinkPositionOffset(args.rawTargetOffset);
  const sourcePoint = getNodeConnectionPoint(args.sourceRect, sourceCompass, sourceOffset);
  const targetPoint = getNodeConnectionPoint(args.targetRect, targetCompass, targetOffset);
  const sourcePosition = compassToPosition(sourceCompass);
  const targetPosition = compassToPosition(targetCompass);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    sourcePosition,
    targetPosition,
  });

  return {
    path,
    labelX,
    labelY,
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    sourcePosition,
    targetPosition,
    sourceCompass,
    targetCompass,
    sourceOffset,
    targetOffset,
  };
};
