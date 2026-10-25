import { describe, expect, it } from "vitest";

import { getPartAnimationProfile, getUnitViewerAnimationProfile } from "../src/unitViewer/animationProfile";

const unit = (baseFlySpeed: number, mountFlySpeed?: number) => ({
  baseEntity: { flySpeed: baseFlySpeed },
  ...(mountFlySpeed === undefined ? {} : { mountEntity: { flySpeed: mountFlySpeed } }),
});

describe("getPartAnimationProfile", () => {
  it("uses rider animations for personality crew seated directly on a war bear", () => {
    expect(
      getPartAnimationProfile({ role: "crew" }, { ...unit(0, 0), visualParts: [{ role: "crew" }, { role: "mount" }] }),
    ).toBe("rider");
  });

  it("keeps engine crew standing when a draught mount is present", () => {
    expect(
      getPartAnimationProfile(
        { role: "crew" },
        { ...unit(0, 0), visualParts: [{ role: "crew" }, { role: "mount" }, { role: "engine" }] },
      ),
    ).toBe("ground");
  });

  it("uses the mount's own movement family for the mount", () => {
    expect(getPartAnimationProfile({ role: "mount" }, unit(10, 0))).toBe("ground");
    expect(getPartAnimationProfile({ role: "mount" }, unit(0, 10))).toBe("flying");
    expect(getPartAnimationProfile({ role: "crew" }, unit(0, 10))).toBe("riderFlying");
  });
});

describe("getUnitViewerAnimationProfile", () => {
  it("uses the ground profile for an unmounted ground unit", () => {
    expect(getUnitViewerAnimationProfile(unit(0))).toBe("ground");
  });

  it("uses the rider profile for a mounted ground unit", () => {
    expect(getUnitViewerAnimationProfile(unit(0, 0))).toBe("rider");
  });

  it("uses the flying profile for an unmounted flying unit", () => {
    expect(getUnitViewerAnimationProfile(unit(10))).toBe("flying");
  });

  it("uses the rider-flying profile when either part of a mount can fly", () => {
    expect(getUnitViewerAnimationProfile(unit(0, 10))).toBe("riderFlying");
    expect(getUnitViewerAnimationProfile(unit(10, 0))).toBe("riderFlying");
  });
});
