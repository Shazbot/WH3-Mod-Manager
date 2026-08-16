import { describe, expect, it } from "vitest";

import { applyDBCloneGlobalKey, getDBCloneGlobalKey } from "../src/components/viewer/dbCloneGlobalKey";

describe("DB Clone global key", () => {
  it("prepends the configured modder prefix with one separator", () => {
    expect(getDBCloneGlobalKey("new_building", "author__", true)).toBe("author_new_building");
  });

  it("does not add the same prefix twice", () => {
    expect(getDBCloneGlobalKey("author_new_building", "author_", true)).toBe("author_new_building");
  });

  it("leaves the key alone when prefixing is disabled or unavailable", () => {
    expect(getDBCloneGlobalKey("new_building", "author", false)).toBe("new_building");
    expect(getDBCloneGlobalKey("new_building", "", true)).toBe("new_building");
  });

  it("assigns the global key to every selected direct node and leaves indirect nodes alone", () => {
    expect(
      applyDBCloneGlobalKey(
        { unselected: "custom" },
        ["root", "dependency", "indirect"],
        { root: {}, dependency: {}, indirect: { isIndirectRef: true } },
        "author_clone",
      ),
    ).toEqual({ unselected: "custom", root: "author_clone", dependency: "author_clone" });
  });
});
