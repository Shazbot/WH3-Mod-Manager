import React, { memo, useCallback, useState } from "react";
import { Handle, NodeToolbar, Position } from "@xyflow/react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { setSkillNodeLevel } from "@/src/appSlice";
import { useLocalizations } from "@/src/localizationContext";

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
  nodeId: string;
  origIndent: string;
  origTier: string;
  isHiddentInUI: boolean;
  faction?: string;
  subculture?: string;
  isCheckingSkillRequirements: boolean;
  unlockRank: number;
  isEditMode?: boolean;
  editGroupColor?: string;
  existingSkillKey?: string;
};
const Skill = memo(({ data, selected }: { data: SkillData; selected?: boolean }) => {
  const dispatch = useAppDispatch();
  const { skillBackground, skillIconBackground, skillIcon, label } = data;
  const skillNodesToLevel = useAppSelector((state) => state.app.skillNodesToLevel);
  const skillsData = useAppSelector((state) => state.app.skillsData);
  const currentRank = useAppSelector((state) => state.app.currentRank);

  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const resolvedSkillIcon = skillIcon; //require(`../../../dumps/img/${skillIcon}`);
  const [currentLevel, setCurrentLevel] = useState(0);

  const localized = useLocalizations();

  const isCheckingSkillRequirements = data.isCheckingSkillRequirements;

  const onMouseEnter = useCallback(() => {
    setIsTooltipOpen(true);
  }, [setIsTooltipOpen]);
  const onMouseLeave = useCallback(() => {
    setIsTooltipOpen(false);
  }, [setIsTooltipOpen]);

  const onClick = useCallback(
    (currentLevel: number, maxLevel: number) => {
      if (currentLevel < maxLevel) {
        setCurrentLevel(currentLevel + 1);
        dispatch(setSkillNodeLevel({ skillNodeId: data.nodeId, level: currentLevel + 1 }));
      }
      console.log("clicked skill:", data);
      console.log("effects:");
      for (const effect of data.effects) {
        console.log(effect);
      }
    },
    [setCurrentLevel],
  );

  const onRightClick = useCallback(
    (currentLevel: number) => {
      if (currentLevel > 0) {
        setCurrentLevel(currentLevel - 1);
        dispatch(setSkillNodeLevel({ skillNodeId: data.nodeId, level: currentLevel - 1 }));
      }
    },
    [setCurrentLevel],
  );

  if (!skillsData) return <></>;

  const skillsBeingDisabled = [] as string[];
  const nodeToSkillLocks = skillsData.nodeToSkillLocks;
  for (const [nodeId, skillAndLevels] of Object.entries(nodeToSkillLocks)) {
    for (const [iterSkill, iterLevel] of skillAndLevels) {
      if (iterSkill == data.id && iterLevel == currentLevel + 1) {
        for (const skillBeingDisabled of skillsData.currentSkills.filter((skill) => skill.nodeId == nodeId)) {
          skillsBeingDisabled.push(skillBeingDisabled.localizedTitle || skillBeingDisabled.id);
        }
      }
    }
  }

  let areRequirementsValid = true;
  let reqsMessage = "";
  const skillAndLevels = nodeToSkillLocks[data.nodeId];
  if (skillAndLevels) {
    for (const [lockingSkill, lockingLevel] of skillAndLevels) {
      for (const skillNodeToCheck of skillsData.currentSkills.filter((skill) => skill.id == lockingSkill)) {
        const level = skillNodesToLevel[skillNodeToCheck.nodeId];
        if (level && level >= lockingLevel) areRequirementsValid = false;
      }
    }
  }

  const nodeRequirements = skillsData.nodeRequirements[data.nodeId];
  if (nodeRequirements) {
    if (nodeRequirements.single && nodeRequirements.single.length > 0) {
      for (const parentNode of nodeRequirements.single || []) {
        areRequirementsValid = areRequirementsValid && (skillNodesToLevel[parentNode] || 0) > 0;
      }
      if (!areRequirementsValid) {
        const reqParentNodeSkill = skillsData.currentSkills.find(
          (skill) => skill.nodeId == nodeRequirements.single[0],
        );
        if (reqParentNodeSkill) {
          reqsMessage =
            localized.skillUnlockRequirementParent &&
            localized.skillUnlockRequirementParent.replace(
              "REQUIRED_SKILL",
              reqParentNodeSkill.localizedTitle || reqParentNodeSkill.id,
            );
        }
      }
    }
    let countForMultiple = 0;
    if (nodeRequirements.multiple && nodeRequirements.multiple.length > 0) {
      for (const parentNode of nodeRequirements.multiple) {
        countForMultiple += skillNodesToLevel[parentNode] || 0;
      }
      areRequirementsValid = areRequirementsValid && countForMultiple >= nodeRequirements.numMultiple;

      if (!areRequirementsValid) {
        reqsMessage =
          localized.skillUnlockRequirementMultipleParents &&
          localized.skillUnlockRequirementMultipleParents.replace(
            "NUM_SKILL_POINTS",
            nodeRequirements.numMultiple.toString(),
          );
      }
    }
  }

  if (!isCheckingSkillRequirements) areRequirementsValid = true;

  return (
    <>
      <NodeToolbar
        style={{ fontFamily: '"Libre Baskerville", serif' }}
        isVisible={isTooltipOpen}
        position={Position.Right}
      >
        <div style={{ backgroundImage: `url('${data.tooltipFrame}')` }} className={`w-96 skillTooltip`}>
          <div className="font-bold text-center">{data.label}</div>
          {data.subculture && <div className="font-bold text-center">{data.subculture}</div>}
          {data.faction && <div className="font-bold text-center">{data.faction}</div>}
          {data.numLevels > 3 && (
            <div className="font-bold text-center">
              {currentLevel}/{data.numLevels}
            </div>
          )}
          <div className="text-sm italic">{data.description}</div>
          {data.unlockRank > 0 && data.unlockRank > currentRank && (
            <div className="text-sm text-red-600">
              {localized.skillUnlockRank?.replace("UNLOCK_RANK", data.unlockRank.toString())}
            </div>
          )}
          {!areRequirementsValid && reqsMessage != "" && (
            <div className="text-sm text-red-600">{reqsMessage}</div>
          )}
          {skillsBeingDisabled.length > 0 && (
            <>
              <div className="text-sm text-yellow-200">{localized.skillUnlockWillLock}</div>
              {skillsBeingDisabled.map((skillBeingDisabled) => (
                <div className="text-sm text-yellow-200">{skillBeingDisabled}</div>
              ))}
            </>
          )}
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
                .map((effect, i) => {
                  return (
                    <div key={effect.key + i} id={effect.key + i} className="flex gap-2 text-sm">
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
        onClick={() => {
          if (data.isEditMode) return;
          if (isCheckingSkillRequirements && data.unlockRank > currentRank) return;
          if (!isCheckingSkillRequirements || areRequirementsValid) onClick(currentLevel, data.numLevels);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (data.isEditMode) return;
          if (isCheckingSkillRequirements && data.unlockRank > currentRank) return;
          onRightClick(currentLevel);
        }}
        className={`h-20 relative w-[260px] ${data.editGroupColor ? "ring-2 ring-offset-1 ring-offset-transparent" : ""} ${
          areRequirementsValid && (!isCheckingSkillRequirements || data.unlockRank <= currentRank)
            ? ""
            : "grayscale"
        } ${data.isEditMode && selected ? "outline-dashed outline-2 outline-offset-2 outline-cyan-400 rounded-sm" : ""}`}
        style={data.editGroupColor ? { boxShadow: `inset 4px 0 0 ${data.editGroupColor}` } : undefined}
      >
        <Handle
          type="target"
          position={Position.Left}
          className={`ml-[10px] z-[2] ${data.isEditMode ? "" : "opacity-0"}`}
        />
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
          {Array.from(Array(Math.min(data.numLevels, 3)).keys()).map((i) => (
            <div className="relative" key={`${data.label}-skillLevel-${i}`}>
              <img src={data.skillLevelImg} alt="skillLevelImg"></img>
              {i < currentLevel && (
                <img className="absolute top-0" src={data.skillLevelLitIcon} alt="skillLevelLitIcon" />
              )}
            </div>
          ))}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className={`mr-[10px] z-[2] ${data.isEditMode ? "" : "opacity-0"}`}
        />
      </div>
    </>
  );
});
export default Skill;
