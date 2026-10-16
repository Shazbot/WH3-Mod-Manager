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
  autoUnlockRank: require("../../assets/skills/skill_auto_unlock_rank.png") as string,
  levelHover: require("../../assets/skills/skills_tab_level_over.png") as string,
  stickyBarFill: require("../../assets/skills/sticky_bar_fill.png") as string,
  stickyFlameMask: require("../../assets/skills/sticky_tooltip_flame_mask.png") as string,
  spellTitle: require("../../assets/skills/tooltip_title_rare.png") as string,
  spellCost: require("../../assets/skills/spell_cost_frame.png") as string,
};

// template_skill_entry, with chain0's 56 px spacing between entries and 90 px row height.
export const skillEntry = { width: 185, height: 65, columnPitch: 241, rowPitch: 90 };

// card: the 185x67 tab art, drawn 2 px left and 1 px up of the entry.
export const skillCard = { x: -2, y: -1, width: 185, height: 67 };

// skills_tab_ornament (220x67) and the skill icon (72x72) inside card.
export const skillOrnament = { x: -35, y: 0, width: 220, height: 67 };
export const skillIconBox = { x: -3, y: -5, width: 72, height: 72 };
// Ability icons (59x59, with their own round frame) sit 12 px inside the icon box. Some are also shipped in the skills
// icon folder, so the viewer goes by the image's size, not its folder.
export const skillAbilityIconBox = { x: 9, y: 7, width: 48, height: 48 };

// dy_skill: the skill name.
export const skillName = { x: 61, y: 10, width: 112, height: 44, fontSize: 12 };

// level_parent: a vertical list of 16x20 pips with -4 px spacing, centered on the card and moved 3 px up.
export const skillLevels = { x: 169, centerY: skillCard.height / 2 - 3, pipWidth: 16, pipHeight: 20, spacing: -4 };

// arrow: parchment_divider_arrow (68x13), drawn at (-12, 10) inside the arrow component at (185, 16) of the entry. It
// runs from 12 px inside the left card to the next card's left edge.
export const skillArrow = { y: 16 + 10, width: 68 };

// Not from the game: the box drawn around grouped skills, padding its cards on the left/right, top and bottom.
export const skillGroupPad = { x: 10, top: 15, bottom: 10 };

// The padlock in card's locked state, and the skill_locked_rank chains, drawn on skills another skill locks out.
export const skillPadlock = { x: -2, y: 30, width: 32, height: 40 };
export const skillRankLock = { x: 54, y: -3, width: 135, height: 72 };
// skill_auto_unlock_rank in card's locked_auto_unlock state.
export const skillAutoUnlockBadge = { x: 0, y: 37, width: 30, height: 30 };

// ui/common ui/character_background_skill_tooltip.twui.xml: tooltip_body draws tooltip_frame as a 9-slice with 16/20
// margins. Effect rows (template_entry) are 314x26, centered, with the icon at x 14 and the text 44 px in.
export const skillTooltip = {
  width: 340,
  frameSliceX: 16,
  frameSliceY: 20,
  titleSize: 14,
  // dy_title's text starts 18 px down (10 offset, 8 text offset) and the description's 35 px (30 offset, 5 text offset).
  titleTextY: 18,
  titleLineHeight: 18,
  descriptionTextY: 35,
  // The game's description is 12 px, but Georgia italic reads smaller than the game's font at that size.
  descriptionSize: 13,
  bodySize: 12,
  effectRowWidth: 314,
  effectRowHeight: 26,
  effectIconX: 14,
  effectIconSize: 24,
  effectTextX: 44,
};

// ui/common ui/special_ability_tooltip.twui.xml: main_tooltip_body is 411 wide, in the same frame as the skill tooltip.
// header, at (16, 8), draws the 365x35 tooltip_title art from x -10 with the name 32 px in, and the 30x30
// spell_cost_frame on its right. top_parent, at (20, 47), holds the 59x59 icon, and 70 px in, the type lines on a
// 24 px pitch.
export const spellTooltip = {
  width: 411,
  headerY: 8,
  headerHeight: 35,
  titleArtX: -10,
  titleArtWidth: 365,
  nameX: 32,
  costSize: 30,
  costFontSize: 16,
  topX: 4,
  topY: 4,
  iconSize: 59,
  linesX: 70,
  linePitch: 24,
};

// stick_progress_bar, the last item in tooltip_body: a 329x3 bar at (6, 2) of a 10 px holder that grows from its center
// while the tooltip sticks. Its fill is a 1 px line at y 2 under a 52 px magic_flame glow at y -49. While filling it is
// drawn as in_progress_comp, tinted #B0B0B064. The bar sits on the tooltip frame's bottom edge, whose art ends 8 px
// above the frame.
export const skillTooltipLockBar = {
  x: 6,
  y: 2,
  width: 329,
  height: 3,
  holderHeight: 10,
  lineY: 2,
  glowY: -49,
  glowHeight: 52,
  fillingBrightness: 0xb0 / 0xff,
  fillingOpacity: 0x64 / 0xff,
  frameEdgeInset: 8,
};

// dy_skill's font colour and its text_outline_t0 shader. Locked names use the ui_font_inactive_grey_light preset,
// which lives in a db table, so its colour is a close estimate.
export const skillText = {
  colour: "#FFF8D7",
  lockedColour: "#A9A598",
  // The description's ui_font_faded_grey_beige preset, sampled from the game.
  descriptionColour: "#A99F89",
  outline: "0 0 1px #000, 0 0 1px #000, 1px 1px 1px #000",
};
