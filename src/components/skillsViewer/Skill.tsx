import React, { useCallback } from "react";
import { Handle, NodeToolbar, Position } from "@xyflow/react";

export type SkillData = {
  skillBackground: string;
  skillIconBackground: string;
  skillIcon: string;
  skillLevelImg: string;
  skillLevelLitIcon: string;
  tooltipFrame: string;
  label: string;
  row: number;
  isGrouping: boolean;
  numLevels: number;
  description: string;
  effects: Effect[];
  isAbilityIcon: boolean;
  imgPath: string;
  id: string;
  origIndent: string;
  origTier: string;
  isHiddentInUI: boolean;
};
const Skill = ({ data }: { data: SkillData }) => {
  const { skillBackground, skillIconBackground, skillIcon, label } = data;

  const [isTooltipOpen, setIsTooltipOpen] = React.useState(false);
  const resolvedSkillIcon = skillIcon; //require(`../../../dumps/img/${skillIcon}`);
  const [currentLevel, setCurrentLevel] = React.useState(0);

  const onMouseEnter = useCallback(() => {
    setIsTooltipOpen(true);
  }, [setIsTooltipOpen]);
  const onMouseLeave = useCallback(() => {
    setIsTooltipOpen(false);
  }, [setIsTooltipOpen]);

  const onClick = useCallback(
    (currentLevel: number, maxLevel: number) => {
      if (currentLevel < maxLevel) setCurrentLevel(currentLevel + 1);
      console.log("clicked skill:", data);
      console.log("effects:");
      for (const effect of data.effects) {
        console.log(effect);
      }
    },
    [setCurrentLevel]
  );

  const onRightClick = useCallback(
    (currentLevel: number) => {
      if (currentLevel > 0) setCurrentLevel(currentLevel - 1);
    },
    [setCurrentLevel]
  );

  return (
    <>
      <NodeToolbar
        style={{ fontFamily: '"Libre Baskerville", serif' }}
        isVisible={isTooltipOpen}
        position={Position.Right}
      >
        <div style={{ backgroundImage: `url('${data.tooltipFrame}')` }} className={`w-96 skillTooltip`}>
          <div className="font-bold text-center">{data.label}</div>
          <div className="text-sm italic">{data.description}</div>
          {/* <div className="mt-2">
            {data.effects
              .filter((effect) => effect.level == Math.min(currentLevel + 1, data.numLevels))
              .map((effect) => {
                const resolvedEffectIcon = effect.icon && require(`../../../dumps/img/${effect.icon}`);
                return (
                  <div className="flex gap-2 text-sm">
                    <img className="h-6" src={resolvedEffectIcon} alt={effect.icon} />
                    {effect.localizedKey}
                  </div>
                );
              })}
          </div> */}
          <div className="mt-2">
            <div className="flex gap-2 flex-col">
              {data.effects
                .filter((effect) => effect.level == Math.min(currentLevel + 1, data.numLevels))
                .map((effect) => {
                  return (
                    <div className="flex gap-2 text-sm">
                      <img
                        className="h-6"
                        src={`data:image/png;base64,${effect.iconData}`}
                        alt={effect.icon}
                      />
                      {effect.localizedKey}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </NodeToolbar>
      <div
        onMouseEnter={() => onMouseEnter()}
        onMouseLeave={() => onMouseLeave()}
        onClick={() => onClick(currentLevel, data.numLevels)}
        onContextMenu={() => onRightClick(currentLevel)}
        className="h-20 relative w-[260px]"
      >
        <Handle type="target" position={Position.Left} className="ml-[10px] z-[2] opacity-0" />
        <img className="absolute h-20 w-full" src={skillBackground} alt={skillBackground} />
        <div className="absolute h-20 left-[-30px]">
          <img className="h-full object-cover" src={skillIconBackground} alt={skillIconBackground} />
          <img
            className={`absolute ${
              data.isAbilityIcon ? "h-[70%] top-[8px] left-[53px]" : "h-[110%] top-[-6px] left-[14.5%]"
            }`}
            src={`data:image/png;base64,${resolvedSkillIcon}`}
            alt={skillIcon}
          />
        </div>
        <div
          className="absolute left-[40%] top-[15%] text-center h-[50%] w-[50%] text-gray-200"
          style={{ fontFamily: '"Libre Baskerville", serif' }}
        >
          {label}
        </div>
        <div className="absolute right-[2%] h-[70%] justify-center flex flex-col mt-[8px]">
          {Array.from(Array(data.numLevels).keys()).map((i) => (
            <div className="relative">
              <img key={`${data.label}-skillLevel-${i}`} src={data.skillLevelImg} alt="skillLevelImg"></img>
              {i < currentLevel && (
                <img className="absolute top-0" src={data.skillLevelLitIcon} alt="skillLevelLitIcon" />
              )}
            </div>
          ))}
        </div>
        <Handle type="source" position={Position.Right} className="mr-[10px] z-[2] opacity-0" />
      </div>
    </>
  );
};
export default Skill;
