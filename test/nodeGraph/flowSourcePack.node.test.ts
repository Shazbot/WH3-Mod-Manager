import { describe, expect, it } from "vitest";

import { isFlowSourcePack, resolveManualFlowSourcePack } from "../../src/flowExecutionSupport";

const packFile = (name: string, path: string): PackFilesNodeFile => ({
  name,
  path,
  loaded: true,
});

describe("Edit Text File flow source pack filtering", () => {
  it("uses an owning pack only for flows opened from a pack", () => {
    expect(resolveManualFlowSourcePack("whmmflows\\flow.json", "K:\\mods\\owner.pack")).toBe("K:\\mods\\owner.pack");
    expect(resolveManualFlowSourcePack(undefined, "K:\\mods\\working.pack")).toBeUndefined();
    expect(resolveManualFlowSourcePack("local-flow.json", "K:\\mods\\working.pack")).toBeUndefined();
  });

  it("matches the exact pack path across slash and case differences", () => {
    expect(isFlowSourcePack(packFile("owner.pack", "K:\\mods\\Owner.pack"), "k:/mods/owner.pack")).toBe(true);
  });

  it("matches by pack name when execution only knows the owning pack name", () => {
    expect(isFlowSourcePack(packFile("owner.pack", "K:\\mods\\owner.pack"), "owner.pack")).toBe(true);
  });

  it("does not match a duplicate pack name when execution knows the full owning path", () => {
    expect(isFlowSourcePack(packFile("owner.pack", "K:\\other-mods\\owner.pack"), "K:\\mods\\owner.pack")).toBe(false);
  });

  it("does not filter another pack or filter anything without an owning pack", () => {
    const candidate = packFile("other.pack", "K:\\mods\\other.pack");

    expect(isFlowSourcePack(candidate, "owner.pack")).toBe(false);
    expect(isFlowSourcePack(candidate, undefined)).toBe(false);
  });
});
