import type { AnimationSelectionProfile } from "../visuals/animationSelection";
import type { UnitViewerEntity, UnitViewerVisualPart } from "./types";

export type UnitViewerAnimationProfileSource = {
  baseEntity: Pick<UnitViewerEntity, "flySpeed">;
  mountEntity?: Pick<UnitViewerEntity, "flySpeed">;
  visualParts?: Pick<UnitViewerVisualPart, "role">[];
};

/** Crew on an engine stand; crew seated directly on a mount use the mounted rider family. */
export const getPartAnimationProfile = (
  part: Pick<UnitViewerVisualPart, "role">,
  unit: UnitViewerAnimationProfileSource,
): AnimationSelectionProfile => {
  if (part.role === "mount") return (unit.mountEntity?.flySpeed ?? 0) > 0 ? "flying" : "ground";
  if (part.role === "engine") return "ground";
  if (part.role === "crew" && unit.visualParts?.some((candidate) => candidate.role === "engine")) {
    return unit.baseEntity.flySpeed > 0 ? "flying" : "ground";
  }
  return getUnitViewerAnimationProfile(unit);
};

/** Maps the unit's movement metadata to the animation-bin family used by its model. */
export const getUnitViewerAnimationProfile = (unit: UnitViewerAnimationProfileSource): AnimationSelectionProfile => {
  const isFlying = unit.baseEntity.flySpeed > 0 || (unit.mountEntity?.flySpeed ?? 0) > 0;
  if (unit.mountEntity) return isFlying ? "riderFlying" : "rider";
  return isFlying ? "flying" : "ground";
};
