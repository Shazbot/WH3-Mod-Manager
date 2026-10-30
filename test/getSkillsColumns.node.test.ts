import { describe, expect, it } from "vitest";

import { getSkills, type NodeToSkill } from "../src/skills";

const nodeSkill = (node: string, indent: string, tier: string, subculture = "") => ({
  node,
  skill: `${node}_skill`,
  tier,
  indent,
  visibleInUI: "1",
  factionKey: "",
  subculture,
  requiredNumParents: 0,
});

describe("getSkills columns", () => {
  it("puts a subculture variant on its base skill's column even when the variant's node comes first", () => {
    // Helman Ghorst's campaign row: each base skill shares its spot with a Nagash subculture variant whose node key
    // sorts first.
    const nodes = ["nag_01", "base_01", "nag_02", "base_02", "nag_03", "base_03"];
    const nodeToSkill = Object.fromEntries(
      nodes.map((node) => {
        const tier = node.slice(-1);
        return [node, nodeSkill(node, "5", tier, node.startsWith("nag") ? "wh3_dlc29_sc_nag_undead_legions" : "")];
      }),
    ) as unknown as NodeToSkill;

    const skills = getSkills(nodes, {}, nodeToSkill, {}, {}, [], {});
    const columns = Object.fromEntries(skills.map((skill) => [skill.nodeId, skill.y]));

    expect(columns).toEqual({ base_01: 0, nag_01: 0, base_02: 1, nag_02: 1, base_03: 2, nag_03: 2 });
  });
});
