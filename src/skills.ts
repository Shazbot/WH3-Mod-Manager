import groupBy from "object.groupby";

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
    linkType: "REQUIRED" | "SUBSET_REQUIRED";
  }[]
>;

export type SkillAndIcons = { key: string; iconPath: string; maxLevel: number; unlockRank: number }[];
export type SkillsToEffects = Record<string, Effect[]>;
export type NodesToParents = Record<string, Skill[]>;
export type EffectsToEffectData = Record<string, EffectData>;

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
      skills.sort(
        (firstSkill, secondSkill) => Number.parseInt(firstSkill.tier) - Number.parseInt(secondSkill.tier),
      );
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
      skills.sort(
        (firstSkill, secondSkill) => Number.parseInt(firstSkill.tier) - Number.parseInt(secondSkill.tier),
      );
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
    } as Skill;
  });

  const skillsGroupedByRow = groupBy(skills, (skill) => skill.x);
  for (const skillsInRow of Object.values(skillsGroupedByRow)) {
    skillsInRow.sort((firstSkill, secondSkill) => firstSkill.y - secondSkill.y);
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

// {{tr:xxx}} inside a loc should be replaced with a ui_text_replacements_localised_text_xxx loc keys
export function resolveTextReplacements(
  localizedText: string | undefined,
  getLoc: (locId: string) => string | undefined,
) {
  if (!localizedText) return;

  return localizedText.replaceAll(/{{tr:(.*?)}}/gi, (_, captureGroup) => {
    let replacementText =
      getLoc(`ui_text_replacements_localised_text_${captureGroup}`) || getLoc(captureGroup);
    if (replacementText?.startsWith("{{tr:")) {
      const nestedReplacementKey = replacementText.match(/^{{tr:(.*?)}}$/i)?.[1];
      if (nestedReplacementKey) {
        replacementText =
          getLoc(`ui_text_replacements_localised_text_${nestedReplacementKey}`) ||
          getLoc(nestedReplacementKey) ||
          replacementText;
      }
    }
    return replacementText || captureGroup;
  });
}

export function stripLocImgTags(localizedText: string | undefined) {
  if (!localizedText) return localizedText;
  return localizedText.replaceAll(/\[\[img:.*?\]\]\[\[\/img\]\]/gi, "");
}

export function appendLocalizationsToSkills(skills: Skill[], getLoc: (locId: string) => string | undefined) {
  for (const skill of skills) {
    const titleLocId = `character_skills_localised_name_${skill.id}`;
    const descriptionLocId = `character_skills_localised_description_${skill.id}`;
    skill.localizedTitle = getLoc(titleLocId);
    skill.localizedTitle = resolveTextReplacements(skill.localizedTitle, getLoc);

    skill.localizedDescription = getLoc(descriptionLocId);
    skill.localizedDescription = resolveTextReplacements(skill.localizedDescription, getLoc);

    // console.log("translate:", titleLocId, skill.localizedTitle);
    for (const effect of skill.effects) {
      effect.localizedKey = formatEffectLocalization(effect.effectKey, effect.value, getLoc);
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
): string {
  const locId = `effects_description_${effectKey}`;
  let localized = getLoc(locId);
  if (!localized) return effectKey;
  localized = resolveTextReplacements(localized, getLoc) || localized;
  localized = stripLocImgTags(localized) || localized;
  return localized;
}

export function formatEffectLocalization(
  effectKey: string,
  effectValue: string | number | undefined,
  getLoc: (locId: string) => string | undefined,
): string {
  let localized = getRawEffectLocalization(effectKey, getLoc);
  if (effectValue == null || `${effectValue}`.trim() === "") return localized;

  const value = Number(effectValue);
  if (Number.isNaN(value)) return localized;

  localized = localized.replace("%n%", `${value.toString()}%`);
  localized = localized.replace("%n", `${value.toString()}`);
  localized = localized.replace("%+n", `${(value > 0 && "+") || ""}${value.toString()}`);
  return localized;
}

export function getNodeRequirements(nodeLinks: NodeLinks, nodeToSkill: Record<string, NodeSkill>) {
  const nodeRequirements = {} as Record<
    string,
    { single: string[]; multiple: string[]; numMultiple: number }
  >;

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
