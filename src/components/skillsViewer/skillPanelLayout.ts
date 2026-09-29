// Sizes and offsets copied from the game's skill panel layout in ui3.pack. Each comment names the twui component the
// value came from, in ui/campaign ui/character_details_panel_skills.twui.xml.

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

// dy_skill's font colour and its text_outline_t0 shader.
export const skillText = { colour: "#FFF8D7", outline: "0 0 1px #000, 0 0 1px #000, 1px 1px 1px #000" };
