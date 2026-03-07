import React, { memo, useCallback, useState } from "react";
import { Handle, NodeProps, NodeToolbar, Position } from "@xyflow/react";

const tooltipFrame = require("../../assets/skills/tooltip_frame.png");
const nodeBackground = require("../../assets/skills/tech_skills_tab_active.png");
const skillIconBackground = require("../../assets/skills/skills_tab_ornament.png");

type TechNodeData = {
  nodeKey: string;
  title: string;
  iconData?: string;
  technologyKey: string;
  researchPointsRequired: number;
  isHidden: boolean;
  showHandles: boolean;
  showKeys: boolean;
  isCheckingRequirements: boolean;
  areRequirementsValid: boolean;
  isUnlocked: boolean;
  onUnlock?: (nodeKey: string) => void;
  onLock?: (nodeKey: string) => void;
  shortDescription?: string;
  longDescription?: string;
  buildingLevel?: string;
  prerequisiteTechNames?: string[];
  effects?: TechEffect[];
};

const handleClass = (showHandles: boolean) => `z-[2] ${showHandles ? "" : "opacity-0 pointer-events-none"}`;

const TechNode = memo(({ data, selected }: NodeProps) => {
  const typedData = data as TechNodeData;
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  const onMouseEnter = useCallback(() => setIsTooltipOpen(true), []);
  const onMouseLeave = useCallback(() => setIsTooltipOpen(false), []);

  const hasRequirements = !!typedData.buildingLevel || (typedData.prerequisiteTechNames?.length ?? 0) > 0;
  const hasEffects = (typedData.effects?.length ?? 0) > 0;

  return (
    <>
      <NodeToolbar
        key={`${typedData.nodeKey}:${typedData.technologyKey}:${typedData.shortDescription || ""}:${typedData.longDescription || ""}`}
        style={{ fontFamily: '"Libre Baskerville", serif' }}
        isVisible={isTooltipOpen}
        position={Position.Right}
      >
        <div
          style={{ backgroundImage: `url('${tooltipFrame}')` }}
          className="w-[320px] max-h-[92vh] overflow-y-auto skillTooltip text-gray-100 text-sm space-y-1.5"
        >
          {/* Title */}
          <div className="font-bold text-center text-base">{typedData.title}</div>

          {/* Requirements */}
          {hasRequirements && (
            <div className="space-y-0.5">
              {typedData.buildingLevel && (
                <div className="text-red-400 text-xs italic">
                  Requires building: {typedData.buildingLevel}
                </div>
              )}
              {typedData.prerequisiteTechNames?.map((name) => (
                <div key={name} className="text-red-400 text-xs italic">
                  Requires technology: {name}
                </div>
              ))}
            </div>
          )}

          {/* Description */}
          {typedData.shortDescription && (
            <div className="text-xs border-t border-red-900/40 pt-1.5">
              {typedData.shortDescription}
            </div>
          )}
          {typedData.longDescription && (
            <div className="text-xs italic border-t border-red-900/40 pt-1.5">
              "{typedData.longDescription}"
            </div>
          )}

          {/* Research cost */}
          {typedData.researchPointsRequired > 0 && (
            <div className="text-amber-300 text-xs">Cost: {typedData.researchPointsRequired}</div>
          )}

          {/* Effects */}
          {hasEffects && (
            <div className="border-t border-red-900/40 pt-1.5 flex flex-col gap-1">
              {typedData.effects!.map((effect) => (
                <div key={effect.effectKey} className="flex gap-2 items-center text-xs">
                  {effect.iconData ? (
                    <img
                      className="h-6 w-6 object-contain shrink-0"
                      src={`data:image/png;base64,${effect.iconData}`}
                      alt={effect.icon}
                    />
                  ) : (
                    <div className="h-6 w-6 shrink-0" />
                  )}
                  <span>{effect.localizedKey}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </NodeToolbar>

      <div
        className={`relative w-[240px] h-20 rounded overflow-visible ${
          selected ? "ring-2 ring-cyan-500" : typedData.isUnlocked ? "ring-2 ring-emerald-500" : ""
        } ${typedData.isHidden ? "opacity-60" : ""} ${
          typedData.isCheckingRequirements && !typedData.areRequirementsValid && !typedData.isUnlocked ? "grayscale" : ""
        } ${typedData.isCheckingRequirements ? "cursor-pointer" : ""}`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={(event) => {
          if (!typedData.isCheckingRequirements) return;
          event.preventDefault();
          event.stopPropagation();
          if (typedData.isUnlocked || !typedData.areRequirementsValid) return;
          typedData.onUnlock?.(typedData.nodeKey);
        }}
        onContextMenu={(event) => {
          if (!typedData.isCheckingRequirements) return;
          event.preventDefault();
          event.stopPropagation();
          if (!typedData.isUnlocked) return;
          typedData.onLock?.(typedData.nodeKey);
        }}
      >
        <img className="absolute h-full w-full rounded" src={nodeBackground} alt="" />

        <Handle
          id="target-north"
          type="target"
          position={Position.Top}
          className={handleClass(typedData.showHandles)}
        />
        <Handle
          id="source-north"
          type="source"
          position={Position.Top}
          className={handleClass(typedData.showHandles)}
        />
        <Handle
          id="target-east"
          type="target"
          position={Position.Right}
          className={handleClass(typedData.showHandles)}
        />
        <Handle
          id="source-east"
          type="source"
          position={Position.Right}
          className={handleClass(typedData.showHandles)}
        />
        <Handle
          id="target-south"
          type="target"
          position={Position.Bottom}
          className={handleClass(typedData.showHandles)}
        />
        <Handle
          id="source-south"
          type="source"
          position={Position.Bottom}
          className={handleClass(typedData.showHandles)}
        />
        <Handle
          id="target-west"
          type="target"
          position={Position.Left}
          className={handleClass(typedData.showHandles)}
        />
        <Handle
          id="source-west"
          type="source"
          position={Position.Left}
          className={handleClass(typedData.showHandles)}
        />

        <div className="absolute h-20 left-[-30px]">
          <img
            className="h-full object-cover h-[130%] top-[-12%] left-[4.5%] relative"
            src={skillIconBackground}
            alt=""
          />
          {typedData.iconData && (
            <img
              className="absolute h-[110%] top-[-6px] left-[14.5%]"
              src={`data:image/png;base64,${typedData.iconData}`}
              alt={typedData.technologyKey}
            />
          )}
        </div>
        <div
          className="absolute left-[40%] top-[15%] w-[50%] text-center text-gray-200 overflow-visible"
          style={{ fontFamily: '"Libre Baskerville", serif' }}
        >
          <div className="leading-tight">{typedData.title}</div>
          {typedData.showKeys && (
            <div className="mt-0.5 text-[10px] opacity-70 whitespace-nowrap overflow-visible">
              {typedData.technologyKey}
            </div>
          )}
        </div>
      </div>
    </>
  );
});

export default TechNode;
