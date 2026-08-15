import React, { memo, useCallback, useEffect, useState } from "react";
import { routeOrthogonal, type TileBox } from "./buildingsLayout";
import type { BuildingsUpgradeEdge } from "../../buildingsData/types";

export type BuildingUpgradeArrowsProps = {
  edges: BuildingsUpgradeEdge[];
  /** Live element per level key, filled in by the tiles as they mount. */
  tileElements: React.RefObject<Map<string, HTMLElement>>;
  containerRef: React.RefObject<HTMLElement>;
  /** Any value that changes when the board relays out, so the paths are recomputed. */
  layoutToken: unknown;
};

type Arrow = { key: string; path: string; isImplicit: boolean };

const boxOf = (element: HTMLElement, originX: number, originY: number): TileBox => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - originX,
    top: rect.top - originY,
    right: rect.right - originX,
    bottom: rect.bottom - originY,
    centerX: rect.left + rect.width / 2 - originX,
  };
};

/**
 * The upgrade connectors, drawn as one SVG over the board.
 *
 * Positions are measured off the real DOM rather than recomputed from the grid maths: the tiles are
 * sized by a CSS variable and laid out by CSS grid, so the browser is the only thing that knows
 * where they ended up. That is also why the board zooms by changing the tile size rather than with a
 * transform - `getBoundingClientRect` then reports the same pixels the SVG is drawn in, and none of
 * this needs to compensate for a scale factor.
 */
const BuildingUpgradeArrows = memo(({ edges, tileElements, containerRef, layoutToken }: BuildingUpgradeArrowsProps) => {
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const container = containerRef.current;
    const elements = tileElements.current;
    if (!container || !elements) return;

    const containerRect = container.getBoundingClientRect();
    // An absolutely positioned SVG can itself enlarge scrollWidth/scrollHeight. Measuring those
    // values feeds a previous, larger selection back into the next layout and leaves scrollable
    // blank space. clientWidth/clientHeight are the board's real band dimensions and can shrink.
    setSize({ width: container.clientWidth, height: container.clientHeight });

    const next: Arrow[] = [];
    for (const edge of edges) {
      const fromElement = elements.get(edge.fromLevelKey);
      const toElement = elements.get(edge.toLevelKey);
      if (!fromElement || !toElement) continue;
      next.push({
        key: `${edge.fromLevelKey}->${edge.toLevelKey}`,
        path: routeOrthogonal(
          boxOf(fromElement, containerRect.left, containerRect.top),
          boxOf(toElement, containerRect.left, containerRect.top),
        ),
        isImplicit: edge.isImplicit,
      });
    }
    setArrows(next);
  }, [containerRef, edges, tileElements]);

  useEffect(() => {
    // After paint, so the grid has settled and the tiles report their final boxes.
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure, layoutToken]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, measure]);

  if (arrows.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-[1]"
      width={size.width}
      height={size.height}
      aria-hidden="true"
    >
      <defs>
        <marker id="buildingArrowHead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="rgba(220,180,120,0.85)" />
        </marker>
      </defs>
      {arrows.map((arrow) => (
        <path
          key={arrow.key}
          d={arrow.path}
          fill="none"
          stroke="rgba(220,180,120,0.55)"
          strokeWidth={2}
          // An implicit edge is inferred from consecutive levels rather than read from the junction
          // table, so it is drawn dashed to say "this is not an explicit upgrade row".
          strokeDasharray={arrow.isImplicit ? "3 3" : undefined}
          markerEnd="url(#buildingArrowHead)"
        />
      ))}
    </svg>
  );
});

export default BuildingUpgradeArrows;
