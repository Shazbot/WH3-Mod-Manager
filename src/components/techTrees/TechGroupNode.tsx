import React, { memo } from "react";
import { NodeProps } from "@xyflow/react";

type TechGroupNodeData = {
  label?: string;
  colorHex: string;
  width: number;
  height: number;
};

const TechGroupNode = memo(({ data }: NodeProps) => {
  const typedData = data as TechGroupNodeData;
  const safeHex = typedData.colorHex.replace(/[^0-9a-fA-F]/g, "").padStart(6, "0").slice(0, 6);
  return (
    <div
      style={{
        width: typedData.width,
        height: typedData.height,
        borderColor: `#${safeHex}`,
        backgroundColor: `#${safeHex}22`,
      }}
      className="rounded border-2 pointer-events-none"
    >
      {typedData.label && (
        <div className="text-xs font-semibold px-2 py-1 text-gray-100 opacity-90">{typedData.label}</div>
      )}
    </div>
  );
});

export default TechGroupNode;
