import { describe, expect, it } from "vitest";
import {
  buildTechTreeLinkGeometry,
  clampLinkPositionOffset,
  getNodeConnectionPoint,
  resolveRenderedCompass,
  type TechTreeNodeRect,
} from "../src/components/techTrees/techTreeLinkGeometry";

const sourceRect: TechTreeNodeRect = { x: 0, y: 0, width: 240, height: 80 };
const targetRectRight: TechTreeNodeRect = { x: 300, y: 0, width: 240, height: 80 };
const targetRectBelow: TechTreeNodeRect = { x: 0, y: 200, width: 240, height: 80 };

describe("techTreeLinkGeometry", () => {
  it("resolves raw position 0 horizontally from node centers", () => {
    expect(resolveRenderedCompass(0, sourceRect, targetRectRight, "source")).toBe(2);
    expect(resolveRenderedCompass(0, sourceRect, targetRectRight, "target")).toBe(4);
  });

  it("resolves raw position 0 vertically from node centers", () => {
    expect(resolveRenderedCompass(0, sourceRect, targetRectBelow, "source")).toBe(3);
    expect(resolveRenderedCompass(0, sourceRect, targetRectBelow, "target")).toBe(1);
  });

  it("clamps offsets to the node edge extremes", () => {
    expect(clampLinkPositionOffset(3)).toBe(1);
    expect(clampLinkPositionOffset(-4)).toBe(-1);
  });

  it("moves north connection points from left to right across the node edge", () => {
    expect(getNodeConnectionPoint(sourceRect, 1, -1)).toEqual({ x: 0, y: 0 });
    expect(getNodeConnectionPoint(sourceRect, 1, 0)).toEqual({ x: 120, y: 0 });
    expect(getNodeConnectionPoint(sourceRect, 1, 1)).toEqual({ x: 240, y: 0 });
  });

  it("builds edge geometry with auto-resolved handles and preserved offsets", () => {
    const geometry = buildTechTreeLinkGeometry({
      sourceRect,
      targetRect: targetRectRight,
      rawSourceCompass: 0,
      rawTargetCompass: 0,
      rawSourceOffset: 0.5,
      rawTargetOffset: -1,
    });

    expect(geometry.sourceCompass).toBe(2);
    expect(geometry.targetCompass).toBe(4);
    expect(geometry.sourceY).toBe(60);
    expect(geometry.targetY).toBe(0);
    expect(geometry.path).toContain("M");
  });
});
