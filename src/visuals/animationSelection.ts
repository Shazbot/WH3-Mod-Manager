export type AnimationSelectionCandidate = {
  path: string;
  label: string;
};

const STAND_IDLE_ANIMATION = /stand[_-]idle/i;
const CAMERA_ANIMATION = /^cam(?:\s|[_-]|$)/i;
const RIDER_ANIMATION = /rider/i;

export const selectDefaultAnimation = <T extends AnimationSelectionCandidate>(
  animations: readonly T[],
): T | undefined => {
  const standIdleAnimations = animations.filter((animation) => STAND_IDLE_ANIMATION.test(animation.path));
  const nonCameraAnimations = standIdleAnimations.filter((animation) => !CAMERA_ANIMATION.test(animation.label));

  return (
    nonCameraAnimations.find((animation) => !RIDER_ANIMATION.test(animation.label)) ??
    nonCameraAnimations[0] ??
    standIdleAnimations.find((animation) => !RIDER_ANIMATION.test(animation.label)) ??
    standIdleAnimations[0]
  );
};
