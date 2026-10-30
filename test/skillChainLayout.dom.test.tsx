import { describe, expect, it, vi } from "vitest";

import { getChainColumnXs } from "../src/components/skillsViewer/SkillsView";
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
