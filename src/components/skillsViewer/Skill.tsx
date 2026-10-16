import React, {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Handle, NodeToolbar, Position } from "@xyflow/react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { setSkillNodeLevel } from "@/src/appSlice";
import { useLocalizations } from "@/src/localizationContext";
import GameText, { textTagColours } from "./GameText";
import SkillSpellTooltip from "./SkillSpellTooltip";
import { SkillsDataContext } from "./skillsDataContext";
import {
  skillAbilityIconBox,
  skillArt,
  skillAutoUnlockBadge,
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
  spellTooltip,
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
// The nodes the hovered skill would lock out, which preview the lock chains. Cards subscribe to it, so only the cards
// whose preview changes re-render.
const noLockPreview = new Set<string>();
let lockPreviewNodeIds = noLockPreview;
const lockPreviewListeners = new Set<() => void>();

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
 * Tells whether an icon is sized like a framed ability icon (59 px) rather than a 72 px skill icon. Tiny icons such as
 * 24 px traits are not, and keep their own size.
 * @param naturalWidth The image's own width.
 * @returns True for an ability-sized icon.
 */
const isAbilityIconSize = (naturalWidth: number) =>
  naturalWidth > skillIconBox.width / 2 && naturalWidth < skillIconBox.width;

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
  // A skill with no name shows its key, one long word that would otherwise spill onto the cards beside it.
  overflowWrap: "anywhere" as const,
  overflow: "hidden",
};
const padlockStyle = toBox(skillPadlock);
const rankLockStyle = toBox(skillRankLock);
const autoUnlockBadgeStyle = toBox(skillAutoUnlockBadge);
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
const titleStyle = {
  fontSize: skillTooltip.titleSize,
  lineHeight: `${skillTooltip.titleLineHeight}px`,
  marginTop: skillTooltip.titleTextY - skillTooltip.frameSliceY,
};
const descriptionStyle = {
  fontFamily: "Georgia, serif",
  fontSize: skillTooltip.descriptionSize,
  color: skillText.descriptionColour,
  marginTop: skillTooltip.descriptionTextY - skillTooltip.titleTextY - skillTooltip.titleLineHeight,
};
const eyeStyle = { width: skillTooltip.eyeIconSize, height: skillTooltip.eyeIconSize, verticalAlign: "-3px" };

/**
 * Gets the game's red lock text, or the app's own text in the same style when the game has none.
 * @param gameText The game's text, which holds a placeholder for the value.
 * @param placeholder The game text's placeholder, such as `%d`.
 * @param value What the placeholder stands for.
 * @param fallback The app's text, with its value already filled in.
 * @returns The text to add after the skill's description.
 */
const getLockText = (gameText: string | undefined, placeholder: string, value: string | number, fallback?: string) =>
  gameText ? gameText.replace(placeholder, String(value)) : fallback ? `\n\n[[col:red]]${fallback}[[/col]]` : "";

/**
 * Registers a card to hear when the lock preview changes.
 * @param listener Called after each change.
 * @returns A function that unregisters the card.
 */
const subscribeLockPreview = (listener: () => void) => {
  lockPreviewListeners.add(listener);
  return () => void lockPreviewListeners.delete(listener);
};

/**
 * Sets which nodes preview the lock chains and tells the cards.
 * @param nodeIds The nodes to preview as locked.
 */
const setLockPreview = (nodeIds: Set<string>) => {
  lockPreviewNodeIds = nodeIds;
  for (const listener of lockPreviewListeners) listener();
};

/**
 * Finds the skills that unlocking a skill's next level locks out.
 * @param skillsData The tree's data.
 * @param skillId The skill being unlocked.
 * @param nextLevel The level being unlocked.
 * @returns The skills it locks out.
 */
const getSkillsLockedBy = (skillsData: SkillsData, skillId: string, nextLevel: number) =>
  Object.entries(skillsData.nodeToSkillLocks)
    .filter(([, skillAndLevels]) => skillAndLevels.some(([skill, level]) => skill == skillId && level == nextLevel))
    .flatMap(([nodeId]) => skillsData.currentSkills.filter((skill) => skill.nodeId == nodeId));

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
  autoUnlockRank?: number;
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
  // The effect row being hovered, whose spell or attributes show beside or under this tooltip.
  const [hoveredEffect, setHoveredEffect] = useState<Effect>();
  // Bumped each time the stick delay starts, so the lock bar's fill starts over.
  const [lockBarRun, setLockBarRun] = useState(0);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();
  const tooltipHideTimer = useRef<ReturnType<typeof setTimeout>>();
  const [hoveredLevel, setHoveredLevel] = useState<number>();
  const [iconNaturalWidth, setIconNaturalWidth] = useState(0);
  const isTinyIcon = iconNaturalWidth > 0 && iconNaturalWidth <= skillIconBox.width / 2;
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
    setHoveredEffect(undefined);
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

  const lockedSkills = useMemo(
    () => (skillsData ? getSkillsLockedBy(skillsData, data.id, currentLevel + 1) : []),
    [skillsData, data.id, currentLevel],
  );
  const isLockPreviewed = useSyncExternalStore(subscribeLockPreview, () => lockPreviewNodeIds.has(data.nodeId));
  // While this card is hovered or its tooltip is up, the skills it would lock out show their chains.
  const isPreviewingLocks = isCardHovered || isTooltipOpen;
  useEffect(() => {
    if (!isPreviewingLocks || lockedSkills.length == 0) return;
    const lockedNodeIds = new Set(lockedSkills.map((skill) => skill.nodeId));
    setLockPreview(lockedNodeIds);
    // Another card may have taken over the preview already.
    return () => {
      if (lockPreviewNodeIds == lockedNodeIds) setLockPreview(noLockPreview);
    };
  }, [isPreviewingLocks, lockedSkills]);

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

  const skillsBeingDisabled = lockedSkills.map((skill) => skill.localizedTitle || skill.id);
  const nodeToSkillLocks = skillsData.nodeToSkillLocks;

  let isLockedByOtherSkill = false;
  let reqsMessage = "";
  const skillAndLevels = nodeToSkillLocks[data.nodeId];
  if (skillAndLevels) {
    for (const [lockingSkill, lockingLevel] of skillAndLevels) {
      for (const skillNodeToCheck of skillsData.currentSkills.filter((skill) => skill.id == lockingSkill)) {
        const level = skillNodesToLevel[skillNodeToCheck.nodeId];
        if (level && level >= lockingLevel) isLockedByOtherSkill = true;
      }
    }
  }
  let areRequirementsValid = !isLockedByOtherSkill;

  const nodeRequirements = skillsData.nodeRequirements[data.nodeId];
  if (nodeRequirements) {
    if (nodeRequirements.single && nodeRequirements.single.length > 0) {
      for (const parentNode of nodeRequirements.single || []) {
        areRequirementsValid = areRequirementsValid && (skillNodesToLevel[parentNode] || 0) > 0;
      }
      if (!areRequirementsValid) {
        const reqParentNodeSkill = skillsData.currentSkills.find((skill) => skill.nodeId == nodeRequirements.single[0]);
        if (reqParentNodeSkill) {
          const parentTitle = reqParentNodeSkill.localizedTitle || reqParentNodeSkill.id;
          reqsMessage = getLockText(
            skillsData.skillLockTexts.singleParent,
            "%S",
            parentTitle,
            localized.skillUnlockRequirementParent?.replace("REQUIRED_SKILL", parentTitle),
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
        reqsMessage = getLockText(
          skillsData.skillLockTexts.multipleParents,
          "%d",
          nodeRequirements.numMultiple,
          localized.skillUnlockRequirementMultipleParents?.replace(
            "NUM_SKILL_POINTS",
            nodeRequirements.numMultiple.toString(),
          ),
        );
      }
    }
  }

  if (!isCheckingSkillRequirements) {
    areRequirementsValid = true;
    isLockedByOtherSkill = false;
  }
  const isRankLocked = isCheckingSkillRequirements && data.unlockRank > currentRank;
  const isLocked = !areRequirementsValid || isRankLocked;
  const isAutoUnlockPending =
    data.autoUnlockRank != undefined && data.autoUnlockRank > currentRank && currentLevel == 0;
  // The game adds why a skill is locked to its description, in red after a blank line.
  let lockText = "";
  if (isAutoUnlockPending) {
    lockText = getLockText(
      skillsData.skillLockTexts.autoUnlock,
      "%d",
      data.autoUnlockRank!,
      localized.skillAutoUnlockRank?.replace("UNLOCK_RANK", data.autoUnlockRank!.toString()),
    );
  } else if (data.unlockRank > 0 && data.unlockRank > currentRank) {
    lockText = getLockText(
      skillsData.skillLockTexts.rank,
      "%d",
      data.unlockRank,
      localized.skillUnlockRank?.replace("UNLOCK_RANK", data.unlockRank.toString()),
    );
  }
  if (!areRequirementsValid) lockText += reqsMessage;

  // A hovered pip shows its own level, otherwise the tooltip shows the next level to unlock.
  const shownLevel = hoveredLevel ?? Math.min(currentLevel + 1, data.numLevels);
  const effectsAtShownLevel = data.effects.filter((effect) => effect.level == shownLevel);
  const getEffectAbilities = (effect: Effect) =>
    (skillsData.effectToUnitAbilityEnables[effect.effectKey] || [])
      .map((mapping) => skillsData.abilityTooltipsByKey[mapping.unitAbilityKey])
      .filter((ability): ability is AbilityTooltipData => !!ability);
  // Hidden effects can grant the spell that a shown effect only names.
  const hiddenEffectAbilities = effectsAtShownLevel
    .filter((effect) => effect.priority == "0")
    .flatMap(getEffectAbilities);
  // An effect row links to the spell its text names, the longest name winning so an upgraded spell beats its base.
  const getRowAbility = (effect: Effect) => {
    const abilities = getEffectAbilities(effect);
    const named = (abilities.length > 0 ? abilities : hiddenEffectAbilities)
      .filter((ability) => effect.localizedKey?.includes(ability.name))
      .sort((first, second) => second.name.length - first.name.length);
    return named[0] || abilities[0];
  };
  // The game hides effects with priority 0 and lists the rest by priority, keeping the table's order on ties. A closed
  // tooltip lists nothing, so the many closed cards skip the per-row work.
  const shownEffects = !isTooltipOpen
    ? []
    : effectsAtShownLevel
        .filter((effect) => effect.priority != "0")
        .sort((first, second) => Number(first.priority) - Number(second.priority));
  const hoveredAbility = hoveredEffect && getRowAbility(hoveredEffect);

  return (
    <>
      <NodeToolbar
        style={{ fontFamily: '"Libre Baskerville", serif' }}
        isVisible={isTooltipOpen}
        position={Position.Right}
      >
        <div
          className="relative"
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
          {hoveredAbility && (
            <div
              className="absolute ml-1"
              style={{ left: `calc(100% + ${skillTooltip.frameSliceX}px)`, top: -skillTooltip.frameSliceY }}
            >
              <SkillSpellTooltip
                ability={hoveredAbility}
                compareAbility={Object.values(skillsData.abilityTooltipsByKey).find(
                  (ability) => ability.overpowerOption === hoveredAbility.key,
                )}
                icons={skillsData.icons}
                tooltipFrame={data.tooltipFrame}
              />
            </div>
          )}
          <div className="nowheel max-h-[calc(92vh-50px)] overflow-y-auto">
            <div>
              <div className="font-bold text-center" style={titleStyle}>
                {label}
              </div>
              {data.subculture && <div className="font-bold text-center">{data.subculture}</div>}
              {data.faction && <div className="font-bold text-center">{data.faction}</div>}
              {data.numLevels > 3 && (
                <div className="font-bold text-center">
                  {currentLevel}/{data.numLevels}
                </div>
              )}
              <div className="italic" style={descriptionStyle}>
                <GameText
                  text={data.description + lockText}
                  taggedImages={skillsData.taggedImages}
                  icons={skillsData.icons}
                />
              </div>
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
                {shownEffects.map((effect, i) => {
                  const colour =
                    effect.isGood == undefined ? undefined : textTagColours[effect.isGood ? "green" : "red"];
                  const isSpell = !!getRowAbility(effect);
                  const hasTooltip = isSpell;
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
                      onMouseEnter={hasTooltip ? () => setHoveredEffect(effect) : undefined}
                      onMouseLeave={hasTooltip ? () => setHoveredEffect(undefined) : undefined}
                    >
                      <img
                        className="shrink-0 object-contain"
                        style={{ width: skillTooltip.effectIconSize, height: skillTooltip.effectIconSize }}
                        src={effect.iconData}
                        alt={effect.icon}
                      />
                      <span style={{ color: colour }}>
                        <GameText
                          text={effect.localizedKey}
                          taggedImages={skillsData.taggedImages}
                          icons={skillsData.icons}
                        />
                        {hasTooltip && (
                          <img
                            className="ml-1 inline-block"
                            style={eyeStyle}
                            src={skillArt.tooltipAvailable}
                            alt="tooltipAvailable"
                          />
                        )}
                      </span>
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
            className={`absolute max-w-none ${isTinyIcon ? "object-none" : "object-contain"} ${isLocked ? "grayscale" : ""}`}
            style={data.isAbilityIcon || isAbilityIconSize(iconNaturalWidth) ? abilityIconStyle : iconStyle}
            src={resolvedSkillIcon}
            alt={skillIcon}
            onLoad={(e) => setIconNaturalWidth(e.currentTarget.naturalWidth)}
          />
          <div
            className="absolute flex items-center justify-center text-center leading-tight"
            style={{ ...nameStyle, color: isLocked ? skillText.lockedColour : skillText.colour }}
          >
            {label}
          </div>
          <div
            className="absolute flex flex-col -translate-y-1/2"
            style={{ left: skillLevels.x, top: skillLevels.centerY }}
          >
            {Array.from(Array(Math.min(data.numLevels, 3)).keys()).map((i) => (
              <div
                className="relative"
                key={`${data.label}-skillLevel-${i}`}
                style={{
                  width: skillLevels.pipWidth,
                  height: skillLevels.pipHeight,
                  marginTop: i > 0 ? skillLevels.spacing : 0,
                }}
                onMouseEnter={() => setHoveredLevel(i + 1)}
                onMouseLeave={() => setHoveredLevel(undefined)}
              >
                <img className="absolute w-full h-full" src={data.skillLevelImg} alt="skillLevelImg"></img>
                {i < currentLevel && (
                  <img className="absolute w-full h-full" src={data.skillLevelLitIcon} alt="skillLevelLitIcon" />
                )}
                {!isLocked && hoveredLevel == i + 1 && (
                  <img className="absolute w-full h-full" src={skillArt.levelHover} alt="levelHover" />
                )}
              </div>
            ))}
          </div>
          {isLockedByOtherSkill || isLockPreviewed ? (
            <img className="absolute max-w-none" style={rankLockStyle} src={skillArt.lockedRank} alt="lockedRank" />
          ) : isAutoUnlockPending ? (
            <img
              className="absolute max-w-none"
              style={autoUnlockBadgeStyle}
              src={skillArt.autoUnlockRank}
              alt="autoUnlockRank"
            />
          ) : (
            isLocked && (
              <img className="absolute max-w-none" style={padlockStyle} src={skillArt.padlock} alt="padlock" />
            )
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
