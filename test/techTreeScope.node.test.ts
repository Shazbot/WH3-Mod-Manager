import { describe, expect, it } from "vitest";
import {
  getTechnologyNodeScopeValues,
  hasBaseNodesOnlyNodes,
  resolveTechTreeScopeSelection,
} from "../src/components/techTrees/techTreeScope";

describe("techTreeScope", () => {
  it("detects scope values for faction and campaign nodes", () => {
    expect(
      getTechnologyNodeScopeValues({
        factionKey: "wh_main_emp_empire",
        campaignKey: "main_warhammer",
      } as Pick<TechnologyNodeData, "factionKey" | "campaignKey">),
    ).toEqual(["faction:wh_main_emp_empire", "campaign:main_warhammer"]);
  });

  it("detects when the current view still has base nodes", () => {
    expect(
      hasBaseNodesOnlyNodes([
        { nodeKey: "base", factionKey: undefined, campaignKey: undefined },
        { nodeKey: "scoped", factionKey: "foo", campaignKey: undefined },
      ] as Pick<TechnologyNodeData, "nodeKey" | "factionKey" | "campaignKey">[]),
    ).toBe(true);
  });

  it("switches to the first scoped option when no base-only nodes exist", () => {
    expect(
      resolveTechTreeScopeSelection({
        selectedScopeKey: "",
        availableScopeKeys: ["campaign:main_warhammer", "faction:wh_main_emp_empire"],
        hasBaseNodesOnly: false,
      }),
    ).toBe("campaign:main_warhammer");
  });

  it("falls back to base nodes when a scoped selection disappears but base nodes exist", () => {
    expect(
      resolveTechTreeScopeSelection({
        selectedScopeKey: "campaign:missing",
        availableScopeKeys: ["faction:wh_main_emp_empire"],
        hasBaseNodesOnly: true,
      }),
    ).toBe("");
  });
});
