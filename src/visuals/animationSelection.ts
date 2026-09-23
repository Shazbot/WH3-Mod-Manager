export type AnimationSelectionCandidate = {
  path: string;
  label: string;
};

/** Semantic animation family used when a model has more than one standing pose. */
export type AnimationSelectionProfile = "ground" | "rider" | "flying" | "riderFlying";

/** Default animation selected by the asset host from the game's animation-bin slots. */
export type AnimationSelectionDefault = {
  path: string;
  slot?: string | null;
};

export type AnimationSelectionDefaults = Partial<
  Record<AnimationSelectionProfile, AnimationSelectionDefault>
>;

const STAND_IDLE_ANIMATION = /stand[_-]idle/i;
const CAMERA_ANIMATION = /^cam(?:\s|[_-]|$)/i;
const RIDER_ANIMATION = /rider/i;

const normalizeAnimationPath = (path: string) => path.replaceAll("\\", "/").trim().toLowerCase();

export const selectDefaultAnimation = <T extends AnimationSelectionCandidate>(
  animations: readonly T[],
  preferredPath?: string | null,
): T | undefined => {
  const normalizedPreferredPath = preferredPath ? normalizeAnimationPath(preferredPath) : "";
  if (normalizedPreferredPath) {
    const metadataDefault = animations.find(
      (animation) => normalizeAnimationPath(animation.path) === normalizedPreferredPath,
    );
    if (metadataDefault) return metadataDefault;
  }

  const standIdleAnimations = animations.filter((animation) => STAND_IDLE_ANIMATION.test(animation.path));
  const nonCameraAnimations = standIdleAnimations.filter((animation) => !CAMERA_ANIMATION.test(animation.label));

  return (
    nonCameraAnimations.find((animation) => !RIDER_ANIMATION.test(animation.label)) ??
    nonCameraAnimations[0] ??
    standIdleAnimations.find((animation) => !RIDER_ANIMATION.test(animation.label)) ??
    standIdleAnimations[0]
  );
};
