import { describe, expect, it } from "vitest";

import { selectDefaultAnimation, type AnimationSelectionCandidate } from "../src/visuals/animationSelection";

const animation = (path: string, label: string): AnimationSelectionCandidate => ({ path, label });

describe("selectDefaultAnimation", () => {
  it("prefers a non-camera, non-rider stand idle animation", () => {
    const preferred = animation("animations\\human\\stand_idle.anim", "stand idle");
    expect(
      selectDefaultAnimation([
        animation("animations\\human\\stand_idle_rider.anim", "stand idle rider"),
        animation("animations\\human\\cam_stand_idle.anim", "cam stand idle"),
        preferred,
      ]),
    ).toBe(preferred);
  });

  it("prefers a non-camera rider animation over a camera animation", () => {
    const preferred = animation("animations\\human\\stand_idle_rider.anim", "stand idle rider");
    expect(
      selectDefaultAnimation([
        animation("animations\\human\\cam_stand_idle.anim", "cam stand idle"),
        preferred,
      ]),
    ).toBe(preferred);
  });

  it("falls back to a non-rider camera animation when no non-camera animation exists", () => {
    const preferred = animation("animations\\human\\cam_stand_idle.anim", "cam stand idle");
    expect(
      selectDefaultAnimation([
        animation("animations\\human\\cam_stand_idle_rider.anim", "cam stand idle rider"),
        preferred,
      ]),
    ).toBe(preferred);
  });
});
