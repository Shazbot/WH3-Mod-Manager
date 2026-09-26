import { describe, expect, it } from "vitest";

import { invalidateCustomizableModPath } from "../../src/utility/customizableModsState";

describe("customizable mod discovery invalidation", () => {
  it("removes pack metadata, the result, and processed-path bookkeeping", () => {
    const state = {
      customizableMods: {
        "/mods/changed.pack": ["whmmflows\\"],
        "/mods/kept.pack": [],
      },
      packMetaData: {
        "/mods/changed.pack": { size: 10, lastChangedLocal: 1 },
        "/mods/kept.pack": { size: 20, lastChangedLocal: 2 },
      },
      lastGetCustomizableMods: ["/mods/changed.pack", "/mods/kept.pack"],
    };

    invalidateCustomizableModPath(state, "/mods/changed.pack");

    expect(state).toEqual({
      customizableMods: { "/mods/kept.pack": [] },
      packMetaData: { "/mods/kept.pack": { size: 20, lastChangedLocal: 2 } },
      lastGetCustomizableMods: ["/mods/kept.pack"],
    });
  });
});
