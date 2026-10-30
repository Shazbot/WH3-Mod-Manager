import { describe, expect, it, vi } from "vitest";

import {
  filterSkillsByFactionCombo,
  getChainColumnXs,
  getStackedRowBrackets,
} from "../src/components/skillsViewer/SkillsView";
import { skillEntry, skillGroupWidth } from "../src/components/skillsViewer/skillPanelLayout";

vi.mock("@xyflow/react", () => ({
  Position: { Left: "left", Right: "right" },
  ReactFlow: () => null,
  Panel: () => null,
  ViewportPortal: () => null,
  addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
}));

const pitch = skillEntry.columnPitch;
const skill = (x: number, y: number, id = `${x}_${y}`) => ({ x, y, id }) as unknown as Skill;
const groupExtra = (size: number) => skillGroupWidth(size) + pitch - skillEntry.width;

describe("getChainColumnXs", () => {
  it("lays a contiguous group out as one wide item", () => {
    const members = [skill(0, 1), skill(0, 2)];
    const skills = [skill(0, 0), ...members, skill(0, 3)];
    const xs = getChainColumnXs(skills, { g: members })[0];
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBe(pitch);
    expect(xs[2]).toBeUndefined();
    expect(xs[3]).toBe(pitch + groupExtra(2));
  });

  it("places an unrelated skill between group members after the group", () => {
    const members = [skill(0, 0), skill(0, 2)];
    const skills = [members[0], skill(0, 1), members[1]];
    const xs = getChainColumnXs(skills, { g: members })[0];
    expect(Number.isFinite(xs[0])).toBe(true);
    expect(Number.isFinite(xs[1])).toBe(true);
    expect(xs[1]).toBeGreaterThanOrEqual(xs[0] + skillGroupWidth(2));
  });

  it("keeps a column that stacks a member with a non-member variant", () => {
    const members = [skill(0, 0), skill(0, 1)];
    const skills = [...members, skill(0, 1, "variant")];
    const xs = getChainColumnXs(skills, { g: members })[0];
    expect(Number.isFinite(xs[1])).toBe(true);
  });

  it("draws variant groups starting on one spot as one item", () => {
    // Helman Ghorst's campaign row: a base group and its Nagash variant group stack on the same columns.
    const base = [skill(0, 1), skill(0, 2), skill(0, 3)];
    const variant = [skill(0, 1, "v1"), skill(0, 2, "v2"), skill(0, 3, "v3")];
    const skills = [skill(0, 0), ...base, ...variant, skill(0, 4)];
    const xs = getChainColumnXs(skills, { base, variant })[0];
    expect(xs[1]).toBe(pitch);
    expect(xs[2]).toBeUndefined();
    expect(xs[3]).toBeUndefined();
    expect(xs[4]).toBe(pitch + groupExtra(3));
  });
});

describe("filterSkillsByFactionCombo", () => {
  const entry = (id: string, tier: string, subculture = "") =>
    ({ id, origIndent: "5", origTier: tier, faction: "", subculture }) as unknown as Skill;
  const nag = "|||wh3_dlc29_sc_nag_undead_legions";

  it("replaces a base skill with the filtered variant on its spot", () => {
    const skills = [
      entry("base_01", "0"),
      entry("nag_01", "0", "wh3_dlc29_sc_nag_undead_legions"),
      entry("vmp_01", "0", "wh_main_sc_vmp_vampire_counts"),
      entry("base_02", "1"),
    ];
    expect(filterSkillsByFactionCombo(skills, nag).map((skill) => skill.id)).toEqual(["nag_01", "base_02"]);
  });
});

describe("getStackedRowBrackets", () => {
  const node = (id: string, row: number, x: number, y: number, parentId?: string) =>
    ({ id, type: "skill", parentId, position: { x, y }, data: { row, isGrouping: false } }) as never;
  const group = (id: string, x: number, y: number) =>
    ({ id, type: "default", position: { x, y }, data: { row: 0, isGrouping: true } }) as never;

  it("marks only rows that stack onto more than one line, counting group members by their absolute position", () => {
    const middle = skillEntry.height / 2;
    const brackets = getStackedRowBrackets([
      node("flat", 0, 0, 0),
      node("base", 1, 0, 100),
      node("variant", 1, 0, 175),
      group("g", 300, 100),
      node("member", 1, 20, 75, "g"),
    ]);
    expect(brackets).toEqual([{ x: -20, lineYs: [100 + middle, 175 + middle] }]);
  });
});
