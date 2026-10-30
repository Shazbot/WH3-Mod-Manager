import groupBy from "object.groupby";
import { resolveTextReplacements } from "./utility/localizationText";
export { resolveTextReplacements } from "./utility/localizationText";

// Game-wide lookups that are the same for every tree, kept per skills-data build so a tree switch does not redo them.
// Each build makes new `nodeLinks` and `locs` objects and does not change them after, so those are the keys.
const nodeRequirementsCache = new WeakMap<NodeLinks, ReturnType<typeof getNodeRequirements>>();
const localizedSubtypeNamesCache = new WeakMap<object, Map<string, string | undefined>>();

export type NodeSkill = {
  node: string;
  skill: string;
  tier: string;
  indent: string;
  visibleInUI: "0" | "1";
  factionKey: string;
  subculture: string;
  requiredNumParents: number;
};

export type NodeToSkill = Record<string, NodeSkill>;

export type NodeLinks = Record<
  string,
  {
    child: string;
    childLinkPosition?: string;
    parentLinkPosition?: string;
    childLinkPositionOffset?: string;
    parentLinkPositionOffset?: string;
    linkType: "REQUIRED" | "SUBSET_REQUIRED";
  }[]
>;

export type SkillAndIcons = { key: string; iconPath: string; maxLevel: number; unlockRank: number }[];
export type SkillsToEffects = Record<string, Effect[]>;
export type NodesToParents = Record<string, Skill[]>;
export type EffectsToEffectData = Record<string, EffectData>;

/**
 * The DB stores skill icons relative to `ui/campaign ui/skills`, while editor pickers expose the
 * full asset path. Keep the in-memory/editor representation relative so a save can be loaded again
 * without accumulating the folder prefix.
 */
export const normalizeSkillIconPath = (iconPath?: string) => {
  if (!iconPath) return "";
  return iconPath
    .replaceAll("/", "\\")
    .replace(/^ui\\campaign ui\\skills\\/i, "")
    .replace(/^ui\\battle ui\\ability_icons\\/i, "");
};

export const skillIconAssetPath = (iconPath?: string) => {
  if (!iconPath) return "";
  const normalized = iconPath.replaceAll("/", "\\");
  if (/^ui\\(?:campaign ui\\skills|battle ui\\ability_icons)\\/i.test(normalized)) return normalized;
  return `ui\\campaign ui\\skills\\${normalizeSkillIconPath(normalized)}`;
};

/**
 * Picks the entries of a game-wide record keyed by skill node that belong to one tree.
 * @param record - The record covering every skill node in the game.
 * @param nodeIds - The node keys of the tree being sent.
 * @returns A new record holding only those nodes' entries.
 */
export function pickTreeNodeEntries<T>(record: Record<string, T>, nodeIds: Iterable<string>) {
  const picked: Record<string, T> = {};
  for (const nodeId of nodeIds) {
    if (Object.hasOwn(record, nodeId)) picked[nodeId] = record[nodeId];
  }
  return picked;
}

/**
 * Picks one tree's entries from the game-wide node links, requirements and locks. Together they are ~14 MB, and
 * the tree only looks up its own nodes.
 * @param nodes - The node keys of the tree being sent.
 * @param skills - The tree's skills, which can include parent nodes missing from `nodes`.
 * @param nodeLinks - The links of every skill node in the game.
 * @param nodeToSkill - The skill of every skill node in the game.
 * @param nodeToSkillLocks - The skill locks of every skill node in the game.
 * @returns The tree's `nodeLinks`, `nodeRequirements` and `nodeToSkillLocks`.
 */
export function pickTreeNodeData<T>(
  nodes: string[],
  skills: { nodeId: string }[],
  nodeLinks: NodeLinks,
  nodeToSkill: Record<string, NodeSkill>,
  nodeToSkillLocks: Record<string, T>,
) {
  const treeNodeIds = new Set([...nodes, ...skills.map((skill) => skill.nodeId)]);
  let nodeRequirements = nodeRequirementsCache.get(nodeLinks);
  if (!nodeRequirements) {
    nodeRequirements = getNodeRequirements(nodeLinks, nodeToSkill);
    nodeRequirementsCache.set(nodeLinks, nodeRequirements);
  }
  return {
    nodeLinks: pickTreeNodeEntries(nodeLinks, treeNodeIds),
    nodeRequirements: pickTreeNodeEntries(nodeRequirements, treeNodeIds),
    nodeToSkillLocks: pickTreeNodeEntries(nodeToSkillLocks, treeNodeIds),
  };
}

/**
 * Gets the on-screen names of the agent subtypes. Each name is looked up once per `locs`, since the lookup walks
 * every loc pack.
 * @param subtypes - The agent subtype keys.
 * @param locs - The loc packs `getLoc` reads, used as the cache key.
 * @param getLoc - Looks up one loc key.
 * @returns The localized name of each subtype that has one.
 */
export function getSubtypesToLocalizedNames(
  subtypes: string[],
  locs: object,
  getLoc: (locId: string) => string | undefined,
) {
  let names = localizedSubtypeNamesCache.get(locs);
  if (!names) {
    names = new Map();
    localizedSubtypeNamesCache.set(locs, names);
  }
  const subtypesToLocalizedNames = {} as Record<string, string>;
  for (const subtype of subtypes) {
    if (!names.has(subtype)) names.set(subtype, getLoc(`agent_subtypes_onscreen_name_override_${subtype}`));
    const localized = names.get(subtype);
    if (localized) subtypesToLocalizedNames[subtype] = localized;
  }
  return subtypesToLocalizedNames;
}

export function getNodesToParents(
  nodes: string[],
  nodeLinks: NodeLinks,
  nodeToSkill: NodeToSkill,
  skillsToEffects: SkillsToEffects,
) {
  const nodesToParents: Record<string, Skill[]> = {};
  nodes.forEach((node) => {
    const skill = nodeToSkill[node];
    let linkedToNode = undefined;
    if (nodeLinks[node]) {
      const links = nodeLinks[node];
      const skills = [];
      for (const link of links) {
        const parentSkill = nodeToSkill[link.child];
        if (parentSkill) {
          skills.push(parentSkill);
        }
      }
      skills.sort((firstSkill, secondSkill) => Number.parseInt(firstSkill.tier) - Number.parseInt(secondSkill.tier));
      if (skills.length > 0) {
        linkedToNode = skills[0].node;
      }
    }
    if (linkedToNode) {
      nodesToParents[linkedToNode] = nodesToParents[linkedToNode] || [];
      nodesToParents[linkedToNode].push({
        title: "",
        description: "",
        x: Number.parseInt(skill.indent),
        y: Number.parseInt(skill.tier),
        img: "",
        effects: skillsToEffects[skill.skill],
        id: skill.skill,
        linkedToNode,
        maxLevel: 1,
        origIndent: skill.indent,
        origTier: skill.tier,
        isHiddentInUI: skill.visibleInUI == "0",
        nodeId: node,
        faction: skill.factionKey,
        subculture: skill.subculture,
        unlockRank: 0,
      });
    }
  });
  return nodesToParents;
}

export function getSkills(
  nodes: string[],
  nodeLinks: NodeLinks,
  nodeToSkill: NodeToSkill,
  nodesToParents: NodesToParents,
  skillsToEffects: SkillsToEffects,
  skillAndIcons: SkillAndIcons,
  skillsToAutoUnlocks: Record<string, SkillAutoUnlock[]>,
) {
  const skills = nodes.map((node) => {
    const skill = nodeToSkill[node];
    let linkedToNode = undefined;
    if (nodeLinks[node]) {
      const links = nodeLinks[node];
      const skills = [];
      for (const link of links) {
        const parentSkill = nodeToSkill[link.child];
        if (parentSkill) {
          skills.push(parentSkill);
        }
      }
      skills.sort((firstSkill, secondSkill) => Number.parseInt(firstSkill.tier) - Number.parseInt(secondSkill.tier));
      if (skills.length > 0) {
        linkedToNode = skills[0].node;
      }
    }
    if (linkedToNode) {
      const parents = nodesToParents[linkedToNode];
      if (parents) {
        parents.sort((firstSkill, secondSkill) => firstSkill.y - secondSkill.y);
        if (parents[0] && parents[parents.length - 1].id != skill.skill) {
          linkedToNode = undefined;
        }
      }
    }
    // console.log(
    //   "IMG IS",
    //   skillAndIcons.find((skillAndIcon) => skillAndIcon.key == skill.skill)?.iconPath || ""
    // );
    const skillAndIcon = skillAndIcons.find((skillAndIcon) => skillAndIcon.key == skill.skill);

    if (!skillsToEffects[skill.skill]) {
      console.log(`Skill ${skill.skill} has no effects!`);
    }

    return {
      title: "",
      description: "",
      x: Number.parseInt(skill.indent),
      y: Number.parseInt(skill.tier),
      img: skillAndIcon?.iconPath || "",
      effects: skillsToEffects[skill.skill] || [],
      id: skill.skill,
      linkedToNode,
      maxLevel: skillAndIcon?.maxLevel || 1,
      origIndent: skill.indent,
      origTier: skill.tier,
      isHiddentInUI: skill.visibleInUI == "0",
      nodeId: node,
      faction: skill.factionKey,
      subculture: skill.subculture,
      unlockRank: skillAndIcon?.unlockRank ?? 0,
      autoUnlocks: skillsToAutoUnlocks[skill.skill],
    } as Skill;
  });

  const isVariant = (skill: Skill) => !!skill.faction || !!skill.subculture;
  const skillsGroupedByRow = groupBy(skills, (skill) => skill.x);
  for (const skillsInRow of Object.values(skillsGroupedByRow)) {
    // Base skills go before the faction/subculture variants on their spot, so the variants share the base's column
    // whatever order the nodes came in.
    skillsInRow.sort(
      (firstSkill, secondSkill) =>
        firstSkill.y - secondSkill.y || Number(isVariant(firstSkill)) - Number(isVariant(secondSkill)),
    );
    const startingColumn = (skillsInRow[0].x == 0 && 1) || 0; // first row starts at column 1, other rows at 0
    for (let i = 0, j = 0; i < skillsInRow.length; i++, j++) {
      const currentSkill = skillsInRow[i];
      // check if there are nodes that share the same position due to faction or subculture columns
      if (
        ((currentSkill.subculture && currentSkill.subculture != "") ||
          (currentSkill.faction && currentSkill.faction != "")) &&
        skillsInRow.some(
          (skill) =>
            skill != currentSkill &&
            skill.origIndent == currentSkill.origIndent &&
            skill.origTier == currentSkill.origTier &&
            skillsInRow.indexOf(skill) < i,
        )
      ) {
        j--;
      }
      currentSkill.y = startingColumn + j;
    }
  }

  for (const node of Object.keys(nodesToParents)) {
    const parents = nodesToParents[node];
    if (parents.length < 2) continue;
    for (const parent of parents) {
      const skill = skills.find((skill) => skill.nodeId === parent.nodeId);
      if (skill) {
        skill.group = node;
      }
    }
    if (parents.length > 1) {
      console.log(
        "to group:",
        parents.map((parent) => parent.id),
      );
    }
  }

  // Group skills that are REQUIRED children of the same visible convergence-gate parent, at the same row.
  // Only "convergence gates" are eligible parents: nodes that appear as a SUBSET_REQUIRED target
  // in at least one other node's links (i.e. multiple prereq choices unlock this gate).
  // This prevents over-grouping from ROOT gate nodes whose many REQUIRED children have no
  // common downstream node and thus were never pre-grouped by nodesToParents.
  const subsetRequiredChildSet = new Set<string>();
  for (const links of Object.values(nodeLinks)) {
    for (const link of links) {
      if (link.linkType === "SUBSET_REQUIRED") {
        subsetRequiredChildSet.add(link.child);
      }
    }
  }

  const parentToChildren: Record<string, string[]> = {};
  for (const [parentNodeId, links] of Object.entries(nodeLinks)) {
    if (!subsetRequiredChildSet.has(parentNodeId)) continue; // skip non-convergence-gate parents
    for (const link of links) {
      if (link.linkType !== "REQUIRED") continue;
      if (!parentToChildren[parentNodeId]) parentToChildren[parentNodeId] = [];
      if (!parentToChildren[parentNodeId].includes(link.child)) {
        parentToChildren[parentNodeId].push(link.child);
      }
    }
  }
  for (const [parentNodeId, childNodeIds] of Object.entries(parentToChildren)) {
    if (childNodeIds.length < 2) continue;
    const parentSkill = skills.find((s) => s.nodeId === parentNodeId);
    if (!parentSkill || parentSkill.isHiddentInUI) continue;
    const sameRowChildren = childNodeIds.flatMap((c) => {
      const s = skills.find((sk) => sk.nodeId === c);
      return s && !s.isHiddentInUI && s.x === parentSkill.x ? [s] : [];
    });
    if (sameRowChildren.length < 2) continue;
    for (const s of sameRowChildren) {
      if (!s.group) s.group = "req:" + parentNodeId; // distinct prefix — avoids collision with nodesToParents keys
    }
  }

  return skills;
}

export function getSkillToEffects(skills: Skill[], skillsToEffects: SkillsToEffects) {
  const skillToEffects: Record<string, Effect[]> = {};
  for (const skill of skills) {
    if (!skillToEffects[skill.id]) skillToEffects[skill.id] = [];

    for (const effect of skillsToEffects[skill.id]) {
      skillToEffects[skill.id].push(effect);
    }
  }
  return skillToEffects;
}

export function stripLocImgTags(localizedText: string | undefined) {
  if (!localizedText) return localizedText;
  return localizedText.replaceAll(/\[\[img:.*?\]\]\[\[\/img\]\]/gi, "");
}

/**
 * Gets a `ui_tagged_images_tables` image path in the form icon paths are kept in.
 * @param imagePath The path as the table has it, such as `UI/Campaign UI/Effect_bundles/magic.png`.
 * @returns The lower case path with backslashes.
 */
export const normalizeTaggedImagePath = (imagePath: string) => imagePath.replaceAll("/", "\\").toLowerCase();

/**
 * Records a rank at which a skill is automatically upgraded, keeping each skill's entries sorted by skill level.
 * @param skillsToAutoUnlocks The entries of each skill, changed in place.
 * @param skill The skill key.
 * @param rank The character_level it is granted at.
 * @param skillLevel The skill level it upgrades to.
 * @param replace Whether an entry for the same skill level is overwritten, as a mod does, rather than keeping the lower rank.
 */
/**
 * Gets the level a skill is automatically granted at a rank.
 * @param autoUnlocks The skill's auto unlocks, whose ranks are the raw DB `character_level` values.
 * @param currentRank The rank as the viewer shows it, which is the DB value plus one.
 * @param maxLevel The skill's highest level.
 * @returns The highest level granted by that rank, or 0 when none is.
 */
export const getAutoUnlockedLevel = (autoUnlocks: SkillAutoUnlock[], currentRank: number, maxLevel: number) =>
  Math.min(
    maxLevel,
    autoUnlocks.reduce(
      (level, unlock) => (unlock.rank + 1 <= currentRank ? Math.max(level, unlock.skillLevel) : level),
      0,
    ),
  );

export function addSkillAutoUnlock(
  skillsToAutoUnlocks: Record<string, SkillAutoUnlock[]>,
  skill: string,
  rank: number,
  skillLevel: number,
  replace: boolean,
) {
  const unlocks = (skillsToAutoUnlocks[skill] ??= []);
  const existing = unlocks.find((unlock) => unlock.skillLevel === skillLevel);
  if (existing) {
    if (replace || rank < existing.rank) existing.rank = rank;
  } else {
    unlocks.push({ rank, skillLevel });
    unlocks.sort((a, b) => a.skillLevel - b.skillLevel);
  }
}

/**
 * Gets the tagged images that texts draw inline with `[[img:tag]]`.
 * @param texts The texts to search, which may be missing.
 * @param uiTaggedImages Image paths keyed by tag.
 * @returns The image paths of the tags the texts use, keyed by tag. Tags absent from the map are skipped.
 */
export function pickTaggedImagesForTexts(texts: (string | undefined)[], uiTaggedImages: Record<string, string>) {
  const picked: Record<string, string> = {};
  for (const text of texts) {
    for (const [, tag] of (text || "").matchAll(/\[\[img:(.*?)\]\]/gi)) {
      if (uiTaggedImages[tag]) picked[tag] = uiTaggedImages[tag];
    }
  }
  return picked;
}

/**
 * Gets the tagged images that skill texts draw inline with `[[img:tag]]`.
 * @param skills The skills whose descriptions and effects are searched.
 * @param uiTaggedImages Image paths keyed by tag.
 * @param effectAttributes The attributes the skills' effects grant, whose descriptions are searched too.
 * @returns The image paths of the tags the texts use, keyed by tag.
 */
export function pickTaggedImagesForSkills(
  skills: Skill[],
  uiTaggedImages: Record<string, string>,
  effectAttributes: Record<string, UnitAttributeText[]> = {},
) {
  const texts = skills
    .flatMap((skill) => [skill.localizedDescription, ...skill.effects.map((effect) => effect.localizedKey)])
    .concat(
      Object.values(effectAttributes).flatMap((attributes) => attributes.map((attribute) => attribute.description)),
    );
  return pickTaggedImagesForTexts(texts, uiTaggedImages);
}

/**
 * Gets the unit attributes that a tree's effects grant, which the skill tooltip lists under its effects.
 * @param skills The tree's skills.
 * @param effectToUnitAttributes The attribute keys each effect grants.
 * @param getLoc Looks up a localised string.
 * @returns The attributes' names and descriptions, keyed by effect key.
 */
export function pickEffectAttributesForSkills(
  skills: Skill[],
  effectToUnitAttributes: Record<string, string[]>,
  getLoc: (locId: string) => string | undefined,
) {
  const picked: Record<string, UnitAttributeText[]> = {};
  for (const effectKey of new Set(skills.flatMap((skill) => skill.effects.map((effect) => effect.effectKey)))) {
    const attributes = (effectToUnitAttributes[effectKey] || []).flatMap((attribute) => {
      const bulletText = getLoc(`unit_attributes_bullet_text_${attribute}`);
      if (!bulletText) return [];
      const [name, description = ""] = (resolveTextReplacements(bulletText, getLoc) || bulletText).split("||");
      return [{ name: name.trim(), description: description.trim() }];
    });
    if (attributes.length > 0) picked[effectKey] = attributes;
  }
  return picked;
}

/**
 * Gets the game's texts for why a skill is locked.
 * @param getLoc Looks up a localised string.
 * @returns The rank, auto unlock and parent skill texts.
 */
export const getSkillLockTexts = (getLoc: (locId: string) => string | undefined): SkillLockTexts => ({
  rank: getLoc("random_localisation_strings_string_skill_locked_rank"),
  autoUnlock: getLoc("random_localisation_strings_string_skill_locked_auto_unlock"),
  singleParent: getLoc("random_localisation_strings_string_skill_locked_single_parent"),
  multipleParents: getLoc("random_localisation_strings_string_skill_locked_multi_parent"),
});

export function appendLocalizationsToSkills(
  skills: Skill[],
  getLoc: (locId: string) => string | undefined,
  effectsToEffectData: Record<string, EffectData> = {},
) {
  for (const skill of skills) {
    const titleLocId = `character_skills_localised_name_${skill.id}`;
    const descriptionLocId = `character_skills_localised_description_${skill.id}`;
    skill.localizedTitle = getLoc(titleLocId);
    skill.localizedTitle = resolveTextReplacements(skill.localizedTitle, getLoc);

    skill.localizedDescription = getLoc(descriptionLocId);
    skill.localizedDescription = resolveTextReplacements(skill.localizedDescription, getLoc);

    // console.log("translate:", titleLocId, skill.localizedTitle);
    for (const effect of skill.effects) {
      // The skill tooltip draws inline icons, so their tags are kept.
      effect.localizedKey = formatEffectLocalization(effect.effectKey, effect.value, getLoc, true);
      // The game adds what the effect applies to, such as "(all armies)", after the effect text.
      const scopeText = getLoc(`campaign_effect_scopes_localised_text_${effect.effectScope}`);
      if (scopeText) effect.localizedKey += resolveTextReplacements(scopeText, getLoc) || scopeText;
      const isPositiveGood = effectsToEffectData[effect.effectKey]?.isPositive;
      if (isPositiveGood != undefined) {
        const value = Number(effect.value) || 0;
        effect.isGood = value == 0 || value > 0 == (isPositiveGood == "true" || isPositiveGood == "1");
      }
      // const effectData = effectsToEffectData[effect.effectKey];
      // if (effectData && effectData.icon) {
      //   effect.icon = effectData.icon;
      // }
    }
  }
}

export function getRawEffectLocalization(
  effectKey: string,
  getLoc: (locId: string) => string | undefined,
  keepImgTags = false,
): string {
  const locId = `effects_description_${effectKey}`;
  let localized = getLoc(locId);
  if (!localized) return effectKey;
  localized = resolveTextReplacements(localized, getLoc) || localized;
  if (!keepImgTags) localized = stripLocImgTags(localized) || localized;
  return localized;
}

export function formatEffectLocalization(
  effectKey: string,
  effectValue: string | number | undefined,
  getLoc: (locId: string) => string | undefined,
  keepImgTags = false,
): string {
  let localized = getRawEffectLocalization(effectKey, getLoc, keepImgTags);
  if (effectValue == null || `${effectValue}`.trim() === "") return localized;

  const value = Number(effectValue);
  if (Number.isNaN(value)) return localized;

  localized = localized.replace("%n%", `${value.toString()}%`);
  localized = localized.replace("%n", `${value.toString()}`);
  localized = localized.replace("%+n", `${(value > 0 && "+") || ""}${value.toString()}`);
  return localized;
}

export function getNodeRequirements(nodeLinks: NodeLinks, nodeToSkill: Record<string, NodeSkill>) {
  const nodeRequirements = {} as Record<string, { single: string[]; multiple: string[]; numMultiple: number }>;

  for (const [parentNode, nodeLinkData] of Object.entries(nodeLinks)) {
    for (const nodeLink of nodeLinkData) {
      nodeRequirements[nodeLink.child] = nodeRequirements[nodeLink.child] || {};
      switch (nodeLink.linkType) {
        case "REQUIRED":
          nodeRequirements[nodeLink.child].single = nodeRequirements[nodeLink.child].single || [];
          if (!nodeRequirements[nodeLink.child].single.includes(parentNode)) {
            nodeRequirements[nodeLink.child].single.push(parentNode);
          }
          break;
        case "SUBSET_REQUIRED":
          nodeRequirements[nodeLink.child].multiple = nodeRequirements[nodeLink.child].multiple || [];
          if (!nodeRequirements[nodeLink.child].multiple.includes(parentNode)) {
            nodeRequirements[nodeLink.child].multiple.push(parentNode);
            const nodeData = nodeToSkill[nodeLink.child];
            if (nodeData) {
              nodeRequirements[nodeLink.child].numMultiple = nodeData.requiredNumParents;
            }
          }
          break;
      }
    }
  }

  return nodeRequirements;
}
