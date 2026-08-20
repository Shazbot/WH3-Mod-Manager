import { describe, expect, it } from "vitest";

import { suggestBuildingLevelKey } from "../src/components/buildings/buildingKey";

describe("suggestBuildingLevelKey", () => {
  it("adds the modder prefix to a vanilla chain once", () => {
    expect(suggestBuildingLevelKey("my_mod", "wh3_main_human_empire", 1)).toBe("my_mod_main_human_empire_2");
  });

  it("does not duplicate a modder prefix already carried by the chain", () => {
    expect(suggestBuildingLevelKey("my_mod", "my_mod_chain", 1)).toBe("my_mod_chain_2");
    expect(suggestBuildingLevelKey("my_mod", "wh3_my_mod_chain", 1)).toBe("my_mod_chain_2");
  });

  it("increments an existing previous-level suffix instead of appending another one", () => {
    expect(suggestBuildingLevelKey("my_mod", "my_mod_chain_1", 1)).toBe("my_mod_chain_2");
  });

  it("still appends the next level when the existing numeric suffix is not the previous level", () => {
    expect(suggestBuildingLevelKey("my_mod", "my_mod_chain_4", 1)).toBe("my_mod_chain_4_2");
  });
});
