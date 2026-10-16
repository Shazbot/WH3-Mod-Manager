import React from "react";
import AbilityTooltipCard from "./AbilityTooltipCard";
import { skillArt, skillText, skillTooltip, spellTooltip } from "./skillPanelLayout";

/** Props for SkillSpellTooltip. */
type SkillSpellTooltipProps = {
  ability: AbilityTooltipData;
  compareAbility?: AbilityTooltipData;
  icons: Record<string, string>;
  tooltipFrame: string;
};

/**
 * Draws a spell's tooltip like the game's special_ability_tooltip, for a skill effect that grants or changes it.
 * @param props.ability The spell to draw.
 * @param props.compareAbility The spell it upgrades, whose stats the changes are shown against.
 * @param props.icons Icon URLs keyed by path.
 * @param props.tooltipFrame The tooltip_frame art.
 * @returns The tooltip.
 */
const SkillSpellTooltip = ({ ability, compareAbility, icons, tooltipFrame }: SkillSpellTooltipProps) => (
  <div
    style={{
      width: spellTooltip.width,
      borderStyle: "solid",
      borderWidth: `${skillTooltip.frameSliceY}px ${skillTooltip.frameSliceX}px`,
      borderImage: `url('${tooltipFrame}') ${skillTooltip.frameSliceY} ${skillTooltip.frameSliceX} fill`,
      color: skillText.colour,
    }}
  >
    <div
      className="relative flex items-center"
      style={{ height: spellTooltip.headerHeight, marginTop: spellTooltip.headerY - skillTooltip.frameSliceY }}
    >
      <img
        className="absolute top-0 h-full"
        style={{ left: spellTooltip.titleArtX, width: spellTooltip.titleArtWidth }}
        src={skillArt.spellTitle}
        alt=""
      />
      <span
        className="relative"
        style={{ paddingLeft: spellTooltip.nameX, fontSize: skillTooltip.bodySize, textShadow: skillText.outline }}
      >
        {ability.name}
      </span>
      {ability.stats.womCost != undefined && (
        <div
          className="absolute right-0 flex items-center justify-center"
          style={{
            width: spellTooltip.costSize,
            height: spellTooltip.costSize,
            backgroundImage: `url('${skillArt.spellCost}')`,
            backgroundSize: "100% 100%",
            fontSize: spellTooltip.costFontSize,
            textShadow: skillText.outline,
          }}
        >
          {ability.stats.womCost}
        </div>
      )}
    </div>
    <AbilityTooltipCard ability={ability} compareAbility={compareAbility} icons={icons} isFramed />
  </div>
);

export default SkillSpellTooltip;
