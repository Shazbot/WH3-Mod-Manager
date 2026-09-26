import { describe, expect, it } from "vitest";

import { createCacheBuildGeneration } from "../../src/vanillaDbCache/buildGeneration";

describe("cache build generation", () => {
  it("keeps a captured token current until invalidated", () => {
    const generation = createCacheBuildGeneration();
    const token = generation.capture();

    expect(generation.isCurrent(token)).toBe(true);
  });

  it("rejects work captured before a game or folder change", () => {
    const generation = createCacheBuildGeneration();
    const staleToken = generation.capture();
    generation.invalidate();

    expect(generation.isCurrent(staleToken)).toBe(false);
    expect(generation.isCurrent(generation.capture())).toBe(true);
  });
});
