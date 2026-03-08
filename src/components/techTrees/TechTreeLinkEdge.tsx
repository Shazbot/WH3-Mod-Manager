import React, { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, EdgeProps } from "@xyflow/react";

type TechTreeLinkEdgeData = {
  path?: string;
  labelX?: number;
  labelY?: number;
  labelText?: string;
  labelClassName?: string;
};

const baseLabelClassName =
  "absolute -translate-x-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs text-gray-100 whitespace-nowrap bg-gray-900/95 border border-gray-700 pointer-events-none";

const TechTreeLinkEdge = memo(({ id, markerEnd, style, data, interactionWidth }: EdgeProps) => {
  const typedData = (data || {}) as TechTreeLinkEdgeData;
  const path = typedData.path || "";
  const hasLabel =
    !!typedData.labelText &&
    Number.isFinite(typedData.labelX) &&
    Number.isFinite(typedData.labelY);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth}
      />
      {hasLabel && (
        <EdgeLabelRenderer>
          <div
            className={typedData.labelClassName || baseLabelClassName}
            style={{
              transform: `translate(-50%, -50%) translate(${typedData.labelX}px, ${typedData.labelY}px)`,
            }}
          >
            {typedData.labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export default TechTreeLinkEdge;
