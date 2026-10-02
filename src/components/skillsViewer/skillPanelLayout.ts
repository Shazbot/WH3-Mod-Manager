// Sizes and offsets copied from the game's skill panel layout in ui3.pack. Each comment names the twui component the
// value came from, in ui/campaign ui/character_details_panel_skills.twui.xml.

/** Card art for each state, copied from ui/skins/default in ui2.pack. */
export const skillArt = {
  hover: require("../../assets/skills/skills_tab_hover.png") as string,
  inactive: require("../../assets/skills/skills_tab_inactive.png") as string,
  selected: require("../../assets/skills/skills_tab_selected.png") as string,
  selectedHover: require("../../assets/skills/skills_tab_selected_hover.png") as string,
  padlock: require("../../assets/skills/padlock.png") as string,
  lockedRank: require("../../assets/skills/skill_locked_rank.png") as string,
};

// template_skill_entry, with chain0's 56 px spacing between entries and 90 px row height.
export const skillEntry = { width: 185, height: 65, columnPitch: 241, rowPitch: 90 };

// card: the 185x67 tab art, drawn 2 px left and 1 px up of the entry.
export const skillCard = { x: -2, y: -1, width: 185, height: 67 };

// skills_tab_ornament (220x67) and the skill icon (72x72) inside card.
export const skillOrnament = { x: -35, y: 0, width: 220, height: 67 };
export const skillIconBox = { x: -3, y: -5, size: 72 };

// dy_skill: the skill name.
export const skillName = { x: 61, y: 10, width: 112, height: 44, fontSize: 12 };

// level_parent: a vertical list of 16x20 pips with -4 px spacing.
export const skillLevels = { x: 169, y: 4, pipWidth: 16, pipHeight: 20, spacing: -4 };

// arrow: parchment_divider_arrow (68x13), drawn at (-12, 10) inside the arrow component at (185, 16) of the entry. It
// runs from 12 px inside the left card to the next card's left edge.
export const skillArrow = { y: 16 + 10, width: 68 };

// The padlock in card's locked state, and skill_locked_rank in its locked_rank state.
export const skillPadlock = { x: -2, y: 30, width: 32, height: 40 };
export const skillRankLock = { x: 54, y: -3, width: 135, height: 72 };

// dy_skill's font colour and its text_outline_t0 shader. Locked names use the ui_font_inactive_grey_light preset,
// which lives in a db table, so its colour is a close estimate.
export const skillText = {
  colour: "#FFF8D7",
  lockedColour: "#A9A598",
  outline: "0 0 1px #000, 0 0 1px #000, 1px 1px 1px #000",
};
