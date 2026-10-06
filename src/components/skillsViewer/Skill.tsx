import React, { memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Handle, NodeToolbar, Position } from "@xyflow/react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { setSkillNodeLevel } from "@/src/appSlice";
import { useLocalizations } from "@/src/localizationContext";
import AbilityTooltipCard from "./AbilityTooltipCard";
import GameText from "./GameText";
import { SkillsDataContext } from "./skillsDataContext";
import {
  skillAbilityIconBox,
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
  skillTooltipLockBar,
} from "./skillPanelLayout";

// The game's default tooltip Appear, Stick and Hide delays. A tooltip sticks once it has been up for the stick delay,
// so the mouse can move into it, and the hide delay gives the mouse time to cross the gap.
const tooltipAppearDelayMs = 250;
const tooltipStickDelayMs = 350;
const tooltipHideDelayMs = 150;
// A locked tooltip waits longer after the mouse leaves its card, so a slow or crooked move into it does not close it.
const tooltipLockedHideDelayMs = 300;
// Closes the open tooltip, so another card's tooltip appearing closes it.
let closeOpenTooltip: (() => void) | undefined;

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

// Card part styles, built once since the layout never changes.
const cardStyle = toBox(skillCard);
const ornamentStyle = toBox(skillOrnament);
const iconStyle = toBox(skillIconBox);
const abilityIconStyle = toBox(skillAbilityIconBox);
const nameStyle = {
  ...toBox(skillName),
  fontSize: skillName.fontSize,
  textShadow: skillText.outline,
  fontFamily: '"Libre Baskerville", serif',
};
const padlockStyle = toBox(skillPadlock);
const rankLockStyle = toBox(skillRankLock);
// The lock bar's holder sits in the tooltip frame's padding box, so the bar is moved out into the frame's border.
const lockBarStyle = {
  ...toBox(skillTooltipLockBar),
  left: skillTooltipLockBar.x - skillTooltip.frameSliceX,
  top:
    skillTooltipLockBar.holderHeight +
    skillTooltip.frameSliceY -
    skillTooltipLockBar.frameEdgeInset -
    skillTooltipLockBar.height,
};
const lockBarFillingStyle = {
  opacity: skillTooltipLockBar.fillingOpacity,
  filter: `brightness(${skillTooltipLockBar.fillingBrightness})`,
  animationDuration: `${tooltipStickDelayMs}ms`,
};
const lockGlowStyle = {
  top: skillTooltipLockBar.glowY,
  height: skillTooltipLockBar.glowHeight,
  maskImage: `url('${skillArt.stickyFlameMask}')`,
  maskSize: "100% 100%",
};
const lockLineStyle = { top: skillTooltipLockBar.lineY, height: 1 };

/** Props for TooltipLockBar. */
type TooltipLockBarProps = {
  /** Whether the tooltip has stuck, which shows the full bar. */
  isLocked: boolean;
  /** Bumped each time the stick delay starts, so the fill starts over. */
  run: number;
  /** The tooltip's width, which the bar spans less the game's insets. */
  tooltipWidth: number;
};

/**
 * Draws the game's stick_progress_bar on a tooltip's bottom edge, filling while the tooltip sticks.
 * @param props.isLocked Whether the tooltip has stuck.
 * @param props.run Bumped each time the stick delay starts.
 * @param props.tooltipWidth The tooltip's width.
 * @returns The bar.
 */
const TooltipLockBar = ({ isLocked, run, tooltipWidth }: TooltipLockBarProps) => {
  const barStyle = { ...lockBarStyle, width: tooltipWidth - (skillTooltip.width - skillTooltipLockBar.width) };
  return (
    <div className="relative" style={{ height: skillTooltipLockBar.holderHeight }}>
      <div
        key={isLocked ? "locked" : run}
        className={`absolute pointer-events-none ${isLocked ? "" : "skillTooltipLockFill"}`}
        style={isLocked ? barStyle : { ...barStyle, ...lockBarFillingStyle }}
      >
        <div className="absolute w-full skillTooltipLockGlow" style={lockGlowStyle} />
        <img className="absolute w-full" style={lockLineStyle} src={skillArt.stickyBarFill} alt="lockBar" />
      </div>
    </div>
  );
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

  const [isCardHovered, setIsCardHovered] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [isTooltipLocked, setIsTooltipLocked] = useState(false);
  // Bumped each time the stick delay starts, so the lock bar's fill starts over.
  const [lockBarRun, setLockBarRun] = useState(0);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();
  const tooltipHideTimer = useRef<ReturnType<typeof setTimeout>>();
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

  const closeTooltip = useCallback(() => {
    clearTimeout(tooltipTimer.current);
    clearTimeout(tooltipHideTimer.current);
    setIsTooltipLocked(false);
    setIsTooltipOpen(false);
    if (closeOpenTooltip == closeTooltip) closeOpenTooltip = undefined;
  }, []);
  const startStickDelay = useCallback(() => {
    setLockBarRun((run) => run + 1);
    tooltipTimer.current = setTimeout(() => setIsTooltipLocked(true), tooltipStickDelayMs);
  }, []);
  const onMouseEnter = useCallback(() => {
    setIsCardHovered(true);
    clearTimeout(tooltipHideTimer.current);
    if (isTooltipLocked) return;
    clearTimeout(tooltipTimer.current);
    if (isTooltipOpen) return startStickDelay();
    tooltipTimer.current = setTimeout(() => {
      if (closeOpenTooltip != closeTooltip) closeOpenTooltip?.();
      closeOpenTooltip = closeTooltip;
      setIsTooltipOpen(true);
      startStickDelay();
    }, tooltipAppearDelayMs);
  }, [closeTooltip, isTooltipLocked, isTooltipOpen, startStickDelay]);
  const hideTooltip = useCallback(
    (lockedDelayMs: number) => {
      if (!isTooltipLocked) clearTimeout(tooltipTimer.current);
      if (!isTooltipOpen) return closeTooltip();
      clearTimeout(tooltipHideTimer.current);
      tooltipHideTimer.current = setTimeout(closeTooltip, isTooltipLocked ? lockedDelayMs : tooltipHideDelayMs);
    },
    [closeTooltip, isTooltipLocked, isTooltipOpen],
  );
  const onMouseLeave = useCallback(() => {
    setIsCardHovered(false);
    hideTooltip(tooltipLockedHideDelayMs);
  }, [hideTooltip]);
  useEffect(() => closeTooltip, [closeTooltip]);

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
            borderStyle: "solid",
            borderWidth: `${skillTooltip.frameSliceY}px ${skillTooltip.frameSliceX}px`,
            borderImage: `url('${data.tooltipFrame}') ${skillTooltip.frameSliceY} ${skillTooltip.frameSliceX} fill`,
            color: skillText.colour,
            fontSize: skillTooltip.bodySize,
          }}
          onMouseEnter={() => isTooltipLocked && clearTimeout(tooltipHideTimer.current)}
          onMouseLeave={() => hideTooltip(tooltipHideDelayMs)}
        >
          <div className="nowheel max-h-[calc(92vh-50px)] overflow-y-auto">
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
                <GameText text={data.description} taggedImages={skillsData.taggedImages} icons={skillsData.icons} />
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
                      <GameText
                        text={effect.localizedKey}
                        taggedImages={skillsData.taggedImages}
                        icons={skillsData.icons}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <TooltipLockBar isLocked={isTooltipLocked} run={lockBarRun} tooltipWidth={skillTooltip.width} />
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
          style={data.isEditMode ? undefined : { pointerEvents: "none" }}
        />
        <div className="absolute" style={cardStyle}>
          <img className="absolute w-full h-full" src={skillBackground} alt={skillBackground} />
          {isLocked ? (
            <img className="absolute w-full h-full" src={skillArt.inactive} alt="inactive" />
          ) : (
            <>
              {currentLevel > 0 && <img className="absolute w-full h-full" src={skillArt.selected} alt="selected" />}
              {isCardHovered && (
                <img
                  className="absolute w-full h-full"
                  src={currentLevel > 0 ? skillArt.selectedHover : skillArt.hover}
                  alt="hover"
                />
              )}
            </>
          )}
          {/* The ornament hangs 35 px past the card's left edge, so it must not catch the previous card's hover. */}
          <img
            className={`absolute max-w-none pointer-events-none ${isLocked ? "grayscale" : ""}`}
            style={ornamentStyle}
            src={skillIconBackground}
            alt={skillIconBackground}
          />
          <img
            className={`absolute max-w-none object-contain ${isLocked ? "grayscale" : ""}`}
            style={data.isAbilityIcon ? abilityIconStyle : iconStyle}
            src={resolvedSkillIcon}
            alt={skillIcon}
          />
          <div
            className="absolute flex items-center justify-center text-center leading-tight"
            style={{ ...nameStyle, color: isLocked ? skillText.lockedColour : skillText.colour }}
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
          {isRankLocked && (
            <img className="absolute max-w-none" style={rankLockStyle} src={skillArt.lockedRank} alt="lockedRank" />
          )}
          {isLocked && !isRankLocked && (
            <img className="absolute max-w-none" style={padlockStyle} src={skillArt.padlock} alt="padlock" />
          )}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className={`mr-[10px] z-[2] ${data.isEditMode ? "" : "opacity-0"}`}
          style={data.isEditMode ? undefined : { pointerEvents: "none" }}
        />
      </div>
    </>
  );
});
export default Skill;
