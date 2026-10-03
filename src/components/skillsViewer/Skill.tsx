import React, { memo, useCallback, useContext, useEffect, useState } from "react";
import { Handle, NodeToolbar, Position } from "@xyflow/react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { setSkillNodeLevel } from "@/src/appSlice";
import { useLocalizations } from "@/src/localizationContext";
import AbilityTooltipCard from "./AbilityTooltipCard";
import { SkillsDataContext } from "./skillsDataContext";
import {
  skillArt,
  skillCard,
  skillEntry,
  skillIconBox,
  skillLevels,
  skillName,
  skillOrnament,
  skillPadlock,
  skillRankLock,
  skillText,
  skillTooltip,
} from "./skillPanelLayout";

// Ability icons carry their own round frame, so they sit smaller inside the ornament's circle.
const abilityIconInset = 12;

// Where the effect icons start inside the tooltip frame's border.
const effectIconLeft =
  (skillTooltip.width - skillTooltip.effectRowWidth) / 2 + skillTooltip.effectIconX - skillTooltip.frameSliceX;

/**
 * Turns a layout rect into absolute-position styles.
 * @param rect The rect's offset and size from the game's layout.
 * @returns The left, top, width and height styles.
 */
const toBox = (rect: { x: number; y: number; width: number; height: number }) => ({
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
});

/**
 * Places the skill icon inside the ornament's circle.
 * @param isAbilityIcon Whether the icon is an ability icon rather than a skill icon.
 * @returns The icon's absolute-position styles.
 */
const iconBox = (isAbilityIcon: boolean) => {
  const inset = isAbilityIcon ? abilityIconInset : 0;
  const size = skillIconBox.size - inset * 2;
  return toBox({ x: skillIconBox.x + inset, y: skillIconBox.y + inset, width: size, height: size });
};

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
  requiredNumParents?: number;
};
const Skill = memo(({ data, selected }: { data: SkillData; selected?: boolean }) => {
  const dispatch = useAppDispatch();
  const { skillBackground, skillIconBackground, skillIcon, label } = data;
  const skillNodesToLevel = useAppSelector((state) => state.app.skillNodesToLevel);
  const skillsData = useContext(SkillsDataContext);
  const currentRank = useAppSelector((state) => state.app.currentRank);

  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const resolvedSkillIcon = skillIcon; //require(`../../../dumps/img/${skillIcon}`);
  const reduxLevel = Math.min(skillNodesToLevel[data.nodeId] || 0, data.numLevels);
  const [currentLevel, setCurrentLevel] = useState(reduxLevel);

  // Skill nodes stay mounted while tab data and global state change. Keep the local click state in
  // sync so switching tabs, resetting a tree, or changing a level elsewhere cannot leave the icon
  // and tooltip one or more levels behind Redux.
  useEffect(() => {
    setCurrentLevel(reduxLevel);
  }, [reduxLevel, data.nodeId]);

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
    [data, dispatch],
  );

  const onRightClick = useCallback(
    (currentLevel: number) => {
      if (currentLevel > 0) {
        setCurrentLevel(currentLevel - 1);
        dispatch(setSkillNodeLevel({ skillNodeId: data.nodeId, level: currentLevel - 1 }));
      }
    },
    [data.nodeId, dispatch],
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
        const reqParentNodeSkill = skillsData.currentSkills.find((skill) => skill.nodeId == nodeRequirements.single[0]);
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
  const isRankLocked = isCheckingSkillRequirements && data.unlockRank > currentRank;
  const isLocked = !areRequirementsValid || isRankLocked;

  const shownLevel = Math.min(currentLevel + 1, data.numLevels);
  const effectsAtShownLevel = data.effects.filter((effect) => effect.level == shownLevel);
  const unlockedAbilityKeys = [] as string[];
  for (const effect of effectsAtShownLevel) {
    const mappings = skillsData.effectToUnitAbilityEnables[effect.effectKey] || [];
    for (const mapping of mappings) {
      const abilityKey = mapping.unitAbilityKey;
      if (!skillsData.abilityTooltipsByKey[abilityKey]) continue;
      if (!unlockedAbilityKeys.includes(abilityKey)) unlockedAbilityKeys.push(abilityKey);
    }
  }
  const unlockedAbilityTooltips = unlockedAbilityKeys
    .map((abilityKey) => skillsData.abilityTooltipsByKey[abilityKey])
    .filter((ability): ability is AbilityTooltipData => !!ability);

  return (
    <>
      <NodeToolbar
        style={{ fontFamily: '"Libre Baskerville", serif' }}
        isVisible={isTooltipOpen}
        position={Position.Right}
      >
        <div
          style={{
            width: skillTooltip.width,
            padding: "2px 0",
            borderStyle: "solid",
            borderWidth: `${skillTooltip.frameSliceY}px ${skillTooltip.frameSliceX}px`,
            borderImage: `url('${data.tooltipFrame}') ${skillTooltip.frameSliceY} ${skillTooltip.frameSliceX} fill`,
            color: skillText.colour,
            fontSize: skillTooltip.bodySize,
          }}
          className="max-h-[92vh] overflow-y-auto skillTooltip"
        >
          {unlockedAbilityTooltips.length > 0 && (
            <div className="space-y-2">
              {unlockedAbilityTooltips.map((ability, i) => {
                const compareAbility = unlockedAbilityTooltips.find(
                  (iterAbility) => iterAbility.overpowerOption === ability.key,
                );
                return (
                  <AbilityTooltipCard
                    key={ability.key + i}
                    ability={ability}
                    compareAbility={compareAbility}
                    icons={skillsData.icons}
                    fallbackIconData={resolvedSkillIcon}
                  />
                );
              })}
            </div>
          )}

          <div className={unlockedAbilityTooltips.length > 0 ? "mt-3 border-t border-red-900/70 pt-2" : ""}>
            <div className="font-bold text-center" style={{ fontSize: skillTooltip.titleSize }}>
              {data.label}
            </div>
            {data.subculture && <div className="font-bold text-center">{data.subculture}</div>}
            {data.faction && <div className="font-bold text-center">{data.faction}</div>}
            {data.numLevels > 3 && (
              <div className="font-bold text-center">
                {currentLevel}/{data.numLevels}
              </div>
            )}
            <div className="mt-1 italic" style={{ fontFamily: "Georgia, serif", color: skillText.descriptionColour }}>
              {data.description}
            </div>
            {data.unlockRank > 0 && data.unlockRank > currentRank && (
              <div className="text-red-600">
                {localized.skillUnlockRank?.replace("UNLOCK_RANK", data.unlockRank.toString())}
              </div>
            )}
            {!areRequirementsValid && reqsMessage != "" && <div className="text-red-600">{reqsMessage}</div>}
            {skillsBeingDisabled.length > 0 && (
              <>
                <div className="text-yellow-200">{localized.skillUnlockWillLock}</div>
                {skillsBeingDisabled.map((skillBeingDisabled) => (
                  <div className="text-yellow-200">{skillBeingDisabled}</div>
                ))}
              </>
            )}
          </div>
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
            <div className="flex gap-1 flex-col">
              {effectsAtShownLevel.map((effect, i) => {
                return (
                  <div
                    key={effect.key + i}
                    id={effect.key + i}
                    className="flex items-center"
                    style={{
                      minHeight: skillTooltip.effectRowHeight,
                      paddingLeft: effectIconLeft,
                      gap: skillTooltip.effectTextX - skillTooltip.effectIconX - skillTooltip.effectIconSize,
                    }}
                  >
                    <img
                      className="shrink-0 object-contain"
                      style={{ width: skillTooltip.effectIconSize, height: skillTooltip.effectIconSize }}
                      src={effect.iconData}
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
          if (!isLocked) onClick(currentLevel, data.numLevels);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (data.isEditMode) return;
          if (isRankLocked) return;
          onRightClick(currentLevel);
        }}
        className={`relative ${data.editGroupColor ? "ring-2 ring-offset-1 ring-offset-transparent" : ""} ${
          data.isEditMode && selected ? "outline-dashed outline-2 outline-offset-2 outline-cyan-400 rounded-sm" : ""
        }`}
        style={{
          width: skillEntry.width,
          height: skillEntry.height,
          ...(data.editGroupColor ? { boxShadow: `inset 4px 0 0 ${data.editGroupColor}` } : {}),
        }}
      >
        <Handle
          type="target"
          position={Position.Left}
          className={`ml-[10px] z-[2] ${data.isEditMode ? "" : "opacity-0"}`}
        />
        <div className="absolute group" style={toBox(skillCard)}>
          <img className="absolute w-full h-full" src={skillBackground} alt={skillBackground} />
          {isLocked ? (
            <img className="absolute w-full h-full" src={skillArt.inactive} alt="inactive" />
          ) : (
            <>
              {currentLevel > 0 && <img className="absolute w-full h-full" src={skillArt.selected} alt="selected" />}
              <img
                className="absolute w-full h-full opacity-0 group-hover:opacity-100"
                src={currentLevel > 0 ? skillArt.selectedHover : skillArt.hover}
                alt="hover"
              />
            </>
          )}
          <img
            className={`absolute max-w-none ${isLocked ? "grayscale" : ""}`}
            style={toBox(skillOrnament)}
            src={skillIconBackground}
            alt={skillIconBackground}
          />
          <img
            className={`absolute max-w-none object-contain ${isLocked ? "grayscale" : ""}`}
            style={iconBox(data.isAbilityIcon)}
            src={resolvedSkillIcon}
            alt={skillIcon}
          />
          <div
            className="absolute flex items-center justify-center text-center leading-tight"
            style={{
              ...toBox(skillName),
              fontSize: skillName.fontSize,
              color: isLocked ? skillText.lockedColour : skillText.colour,
              textShadow: skillText.outline,
              fontFamily: '"Libre Baskerville", serif',
            }}
          >
            {label}
          </div>
          <div className="absolute flex flex-col" style={{ left: skillLevels.x, top: skillLevels.y }}>
            {Array.from(Array(Math.min(data.numLevels, 3)).keys()).map((i) => (
              <div
                className="relative"
                key={`${data.label}-skillLevel-${i}`}
                style={{
                  width: skillLevels.pipWidth,
                  height: skillLevels.pipHeight,
                  marginTop: i > 0 ? skillLevels.spacing : 0,
                }}
              >
                <img className="absolute w-full h-full" src={data.skillLevelImg} alt="skillLevelImg"></img>
                {i < currentLevel && (
                  <img className="absolute w-full h-full" src={data.skillLevelLitIcon} alt="skillLevelLitIcon" />
                )}
              </div>
            ))}
          </div>
          {isRankLocked ? (
            <img
              className="absolute max-w-none"
              style={toBox(skillRankLock)}
              src={skillArt.lockedRank}
              alt="lockedRank"
            />
          ) : (
            isLocked && (
              <img className="absolute max-w-none" style={toBox(skillPadlock)} src={skillArt.padlock} alt="padlock" />
            )
          )}
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
