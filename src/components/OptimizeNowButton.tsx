import React, { memo, useEffect, useMemo, useState } from "react";
import { FaBolt } from "react-icons/fa";

import { useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";

type Localized = Record<string, string>;

/** Starts the background optimization now. Disabled when there is nothing to do or it cannot run. */
const OptimizeNowButton = memo(() => {
  const localized = useLocalizations() as Localized;
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const isWH3Running = useAppSelector((state) => state.app.isWH3Running);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const stagingMode = useAppSelector((state) => state.app.workshopModStagingMode);
  const [status, setStatus] = useState<WorkshopOptimizerBackgroundStatus>();

  const hasEnabledMods = useMemo(() => mods.some((mod) => mod.isEnabled), [mods]);

  useEffect(() => {
    const unsubscribe = window.api?.onWorkshopOptimizerBackgroundStatus?.((_event, next) => setStatus(next));
    void window.api?.getWorkshopOptimizerBackgroundStatus?.().then((initial) => initial && setStatus(initial));
    return () => {
      unsubscribe?.();
    };
  }, []);

  let reason: string | undefined;
  if (currentGame !== "wh3" || stagingMode !== "copy") {
    reason = localized.optimizeNowNotApplicable || "Optimization only applies to Warhammer III with copied mods";
  } else if (!hasEnabledMods) reason = localized.optimizeNowNoMods || "No enabled mods to optimize";
  else if (isWH3Running) reason = localized.optimizeNowGameRunning || "Close the game first";
  else if (status?.state === "running") reason = localized.optimizeNowRunning || "Optimizing…";
  else if (status?.upToDate) reason = localized.optimizeNowUpToDate || "All enabled mods are already optimized";

  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs font-medium uppercase text-gray-200 hover:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!!reason}
      title={reason}
      onClick={() => window.api?.runWorkshopOptimizerBackgroundNow?.()}
    >
      <FaBolt aria-hidden="true" />
      {localized.optimizeNowButton || "Optimize now"}
    </button>
  );
});
OptimizeNowButton.displayName = "OptimizeNowButton";

export default OptimizeNowButton;
