import React, { memo, useContext, useEffect, useMemo, useState } from "react";

import { useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";

const interpolate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

/**
 * Keeps the main process informed of the enabled mods (it optimizes them in the background when
 * "Optimize mods" is on) and shows a small status line while a job runs: bottom right, a compact dark
 * surface like the placement status, no modal.
 */
const WorkshopOptimizerBackground = memo(() => {
  const localized = useContext(localizationContext) as Record<string, string>;
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const optimize = useAppSelector((state) => state.app.optimizeWorkshopModsOnStart);
  const workshopModStagingMode = useAppSelector((state) => state.app.workshopModStagingMode);
  const [status, setStatus] = useState<WorkshopOptimizerBackgroundStatus>();

  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const signature = useMemo(
    () =>
      `${optimize}|${workshopModStagingMode}|` +
      enabledMods
        .map(
          (mod) =>
            `${mod.path}|${mod.loadOrder ?? ""}|${mod.lastChangedLocal ?? ""}|` +
            `${mod.workshopId ?? ""}|${JSON.stringify(mod.reqModIdToName ?? [])}|${(mod.dependencyPacks ?? []).join(",")}`,
        )
        .join("\n"),
    [enabledMods, optimize, workshopModStagingMode],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.api?.updateWorkshopOptimizerBackground?.(
        enabledMods.map((mod) => ({
          name: mod.name,
          path: mod.path,
          modDirectory: mod.modDirectory,
          isEnabled: mod.isEnabled,
          isInModding: mod.isInModding,
          isInData: mod.isInData,
          loadOrder: mod.loadOrder,
          humanName: mod.humanName,
          sourceKind: mod.sourceKind,
          sourceId: mod.sourceId,
          // The dependency edges go into the cache keys: without them the keys differ from a launch's.
          workshopId: mod.workshopId,
          reqModIdToName: mod.reqModIdToName,
          dependencyPacks: mod.dependencyPacks,
        })),
        { optimize: !!optimize, workshopModStagingMode },
      );
    }, 500);
    return () => window.clearTimeout(timeout);
    // The signature covers everything the main process needs from the mods.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    const unsubscribe = window.api?.onWorkshopOptimizerBackgroundStatus?.((_event, nextStatus) =>
      setStatus(nextStatus),
    );
    void window.api?.getWorkshopOptimizerBackgroundStatus?.().then((initial) => initial && setStatus(initial));
    return () => {
      unsubscribe?.();
    };
  }, []);

  if (!status || (status.state !== "running" && status.state !== "paused")) return null;
  const percent = Math.round((status.fraction ?? 0) * 100);
  const text =
    status.state === "paused"
      ? localized.workshopOptimizerBackgroundPaused || "Background optimization is paused while the game runs"
      : interpolate(
          localized.workshopOptimizerBackgroundRunning ||
            "Optimizing mods in the background ({{done}}/{{total}}): {{mod}} {{percent}}%",
          {
            done: Math.min(status.total, status.done + 1),
            total: status.total,
            mod: status.currentMod ?? "",
            percent,
          },
        );

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="workshop-optimizer-background"
      className="fixed bottom-4 right-4 z-[55] flex max-w-md items-center gap-3 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-200 shadow-lg"
    >
      <span className="min-w-0 break-words">{text}</span>
      <button
        type="button"
        className="shrink-0 rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
        onClick={() => window.api?.cancelWorkshopOptimizerBackground?.()}
      >
        {localized.workshopOptimizerBackgroundCancel || "Cancel"}
      </button>
    </div>
  );
});

export default WorkshopOptimizerBackground;
