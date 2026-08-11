import { describe, expect, it } from "vitest";

import {
  findExistingPackedFlowName,
  normalizePackedFlowName,
  orderFlowPackCatalog,
  type FlowPackCatalogEntry,
} from "../../src/nodeGraph/flowPackOperations";

const entry = (overrides: Partial<FlowPackCatalogEntry>): FlowPackCatalogEntry => ({
  path: "/mods/mod.pack",
  name: "mod.pack",
  isEnabled: false,
  hasFlows: false,
  ...overrides,
});

describe("flow names stored in packs", () => {
  it("adds the internal folder and JSON extension", () => {
    expect(normalizePackedFlowName("my_flow")).toBe("whmmflows\\my_flow.json");
  });

  it("does not duplicate an existing folder or extension", () => {
    expect(normalizePackedFlowName("whmmflows/my_flow.JSON")).toBe("whmmflows\\my_flow.JSON");
  });

  it("rejects empty and traversing names", () => {
    expect(normalizePackedFlowName("  ")).toBeUndefined();
    expect(normalizePackedFlowName("../outside")).toBeUndefined();
  });

  it("finds a case-insensitive collision while preserving the stored name", () => {
    expect(
      findExistingPackedFlowName(
        ["whmmflows\\Existing.JSON", "script\\other.lua"],
        "whmmflows\\existing.json",
      ),
    ).toBe("whmmflows\\Existing.JSON");
  });
});

describe("flow pack catalog ordering", () => {
  it("puts enabled mods containing flows first and sorts both groups by display name", () => {
    const ordered = orderFlowPackCatalog([
      entry({ path: "/z", name: "z.pack", humanName: "Zulu", isEnabled: true }),
      entry({ path: "/b", name: "b.pack", humanName: "Beta", isEnabled: true, hasFlows: true }),
      entry({ path: "/a", name: "a.pack", humanName: "Alpha", isEnabled: true, hasFlows: true }),
      entry({ path: "/d", name: "d.pack", humanName: "Delta" }),
    ]);

    expect(ordered.map((pack) => pack.path)).toEqual(["/a", "/b", "/d", "/z"]);
  });
});
