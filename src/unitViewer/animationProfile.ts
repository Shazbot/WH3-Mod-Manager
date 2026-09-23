import type { AnimationSelectionProfile } from "../visuals/animationSelection";
import type { UnitViewerEntity } from "./types";

export type UnitViewerAnimationProfileSource = {
  baseEntity: Pick<UnitViewerEntity, "flySpeed">;
  mountEntity?: Pick<UnitViewerEntity, "flySpeed">;
};

/** Maps the unit's movement metadata to the animation-bin family used by its model. */
export const getUnitViewerAnimationProfile = (
  unit: UnitViewerAnimationProfileSource,
): AnimationSelectionProfile => {
  const isFlying = unit.baseEntity.flySpeed > 0 || (unit.mountEntity?.flySpeed ?? 0) > 0;
  if (unit.mountEntity) return isFlying ? "riderFlying" : "rider";
  return isFlying ? "flying" : "ground";
};
