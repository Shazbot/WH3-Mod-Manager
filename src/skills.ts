import groupBy from "object.groupby";
export type NodeToSkill = Record<
  string,
  {
    node: string;
    skill: string;
    tier: string;
    indent: string;
    visibleInUI: "0" | "1";
  }
>;

export type NodeLinks = Record<
  string,
  {
    child: string;
    childLinkPosition?: string;
    parentLinkPosition?: string;
  }[]
>;

export type SkillAndIcons = { key: string; iconPath: string; maxLevel: number }[];
export type SkillsToEffects = Record<string, Effect[]>;
export type NodesToParents = Record<string, Skill[]>;
export type EffectsToEffectData = Record<string, EffectData>;

export function getNodesToParents(
  nodes: string[],
  nodeLinks: NodeLinks,
  nodeToSkill: NodeToSkill,
  skillsToEffects: SkillsToEffects
) {
  const nodesToParents: Record<string, Skill[]> = {};
  nodes.forEach((node) => {
    const skill = nodeToSkill[node];
    let linkedToSkill = undefined;
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
        (firstSkill, secondSkill) => Number.parseInt(firstSkill.tier) - Number.parseInt(secondSkill.tier)
      );
      if (skills.length > 0) {
        linkedToSkill = skills[0].skill;
      }
    }
    if (linkedToSkill) {
      nodesToParents[linkedToSkill] = nodesToParents[linkedToSkill] || [];
      nodesToParents[linkedToSkill].push({
        title: "",
        description: "",
        x: Number.parseInt(skill.indent),
        y: Number.parseInt(skill.tier),
        img: "",
        effects: skillsToEffects[skill.skill],
        id: skill.skill,
        linkedToSkill,
        maxLevel: 1,
        origIndent: skill.indent,
        origTier: skill.tier,
        isHiddentInUI: skill.visibleInUI == "0",
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
  skillAndIcons: SkillAndIcons
) {
  const skills = nodes.map((node) => {
    const skill = nodeToSkill[node];
    let linkedToSkill = undefined;
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
        (firstSkill, secondSkill) => Number.parseInt(firstSkill.tier) - Number.parseInt(secondSkill.tier)
      );
      if (skills.length > 0) {
        linkedToSkill = skills[0].skill;
      }
    }
    if (linkedToSkill) {
      const parents = nodesToParents[linkedToSkill];
      if (parents) {
        parents.sort((firstSkill, secondSkill) => firstSkill.y - secondSkill.y);
        if (parents[0] && parents[parents.length - 1].id != skill.skill) {
          linkedToSkill = undefined;
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
      linkedToSkill,
      maxLevel: skillAndIcon?.maxLevel || 1,
      origIndent: skill.indent,
      origTier: skill.tier,
      isHiddentInUI: skill.visibleInUI == "0",
    } as Skill;
  });

  const skillsGroupedByRow = groupBy(skills, (skill) => skill.x);
  for (const skillsInRow of Object.values(skillsGroupedByRow)) {
    skillsInRow.sort((firstSkill, secondSkill) => firstSkill.y - secondSkill.y);
    const startingColumn = (skillsInRow[0].x == 0 && 1) || 0; // first row starts at column 1, other rows at 0
    for (let i = 0; i < skillsInRow.length; i++) {
      skillsInRow[i].y = startingColumn + i;
    }
  }

  for (const node of Object.keys(nodesToParents)) {
    const parents = nodesToParents[node];
    if (parents.length < 2) continue;
    for (const parent of parents) {
      const skill = skills.find((skill) => skill.id === parent.id);
      if (skill) {
        skill.group = node;
      }
    }
    if (parents.length > 1) {
      console.log(
        "to group:",
        parents.map((parent) => parent.id)
      );
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
function resolveTextReplacements(
  localizedText: string | undefined,
  getLoc: (locId: string) => string | undefined
) {
  if (!localizedText) return;

  return localizedText.replaceAll(/{{tr:(.*?)}}/gi, (_, captureGroup) => {
    console.log("capture group is", captureGroup);
    const replacementText = getLoc(`ui_text_replacements_localised_text_${captureGroup}`);
    console.log("FOUND:", replacementText);
    return replacementText || captureGroup;
  });
}

export function appendLocalizationsToSkills(skills: Skill[], getLoc: (locId: string) => string | undefined) {
  for (const skill of skills) {
    const titleLocId = `character_skills_localised_name_${skill.id}`;
    const descriptionLocId = `character_skills_localised_description_${skill.id}`;
    skill.localizedTitle = getLoc(titleLocId);
    skill.localizedTitle = resolveTextReplacements(skill.localizedTitle, getLoc);

    skill.localizedDescription = getLoc(descriptionLocId);
    skill.localizedDescription = resolveTextReplacements(skill.localizedDescription, getLoc);

    console.log("translate:", titleLocId, skill.localizedTitle);
    for (const effect of skill.effects) {
      const effectDescriptionKey = `effects_description_${effect.effectKey}`;
      console.log("translated:", effectDescriptionKey, getLoc(effectDescriptionKey));
      effect.localizedKey = getLoc(effectDescriptionKey);
      if (!effect.localizedKey) {
        effect.localizedKey = effect.effectKey;
        continue;
      }
      effect.localizedKey = resolveTextReplacements(effect.localizedKey, getLoc) || "";

      effect.localizedKey = effect.localizedKey.replaceAll(/\[\[img:.*?\]\]\[\[\/img\]\]/gi, "");

      if (effect.localizedKey) {
        const value = Number(effect.value);
        effect.localizedKey = effect.localizedKey.replace("%n%", `${value.toString()}%`);
        effect.localizedKey = effect.localizedKey.replace("%n", `${value.toString()}`);
        effect.localizedKey = effect.localizedKey.replace(
          "%+n",
          `${(value > 0 && "+") || ""}${value.toString()}`
        );
      }
      // const effectData = effectsToEffectData[effect.effectKey];
      // if (effectData && effectData.icon) {
      //   effect.icon = effectData.icon;
      // }
    }
  }
}
