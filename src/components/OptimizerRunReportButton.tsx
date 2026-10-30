import React, { memo, useEffect, useMemo, useState } from "react";
import { FaClipboardList } from "react-icons/fa";

import { Modal } from "../flowbite";
import { useLocalizations } from "../localizationContext";
import {
  type OptimizerRunModEntry,
  type OptimizerRunModStatus,
  type OptimizerRunReport,
  type OptimizerRunSkipReason,
  totalOptimizerRun,
} from "../workshopModOptimizer/runReport";

type Localized = Record<string, string>;

const interpolate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

/** "336 MB", "1.4 GB"; binary units like the rest of the options drawer. */
const formatSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 || unit === 0 ? 0 : 1 })} ${units[unit]}`;
};

const percentSaved = (source: number, output: number): number =>
  source > 0 ? Math.max(0, Math.round(((source - output) / source) * 100)) : 0;

const STATUS_STYLE: Record<OptimizerRunModStatus, string> = {
  failed: "bg-red-900 text-red-100",
  optimized: "bg-green-900 text-green-100",
  alreadyOptimal: "bg-slate-600 text-slate-100",
  skipped: "bg-gray-700 text-gray-300",
};

const statusLabel = (status: OptimizerRunModStatus, localized: Localized): string =>
  ({
    optimized: localized.optimizerReportStatusOptimized || "Optimized",
    alreadyOptimal: localized.optimizerReportStatusAlreadyOptimal || "Already optimal",
    skipped: localized.optimizerReportStatusSkipped || "Skipped",
    failed: localized.optimizerReportStatusFailed || "Failed",
  })[status];

const skipText = (reason: OptimizerRunSkipReason | undefined, localized: Localized): string =>
  ({
    noVisualAssets:
      localized.optimizerReportSkipNoVisualAssets || "Nothing to optimize: this mod has no unit models or textures.",
    dataFolder:
      localized.optimizerReportSkipDataFolder || "Not optimized: mods in the game's Data folder are never changed.",
    notStaged:
      localized.optimizerReportSkipNotStaged || "Not optimized: this mod is loaded from its own folder, not copied.",
    userSkipped: localized.optimizerReportSkipUser || "Skipped because you chose to launch without optimizing.",
    hostUnavailable:
      localized.optimizerReportSkipHostUnavailable ||
      "Skipped because the optimizer could not be started; the mod was copied unchanged.",
    previouslyFailed:
      localized.optimizerReportSkipPreviouslyFailed ||
      "Skipped because optimizing this mod failed before; it was copied unchanged.",
  })[reason ?? "noVisualAssets"];

const changes = (mod: OptimizerRunModEntry, localized: Localized): string[] => {
  const lines: string[] = [];
  if ((mod.textureBytesSaved ?? 0) > 0) {
    lines.push(
      interpolate(localized.optimizerReportChangeTextures || "Textures made smaller, saving {{size}}", {
        size: formatSize(mod.textureBytesSaved ?? 0),
      }),
    );
  }
  if ((mod.mergedModelsGenerated ?? 0) > 0) {
    lines.push(
      interpolate(localized.optimizerReportChangeMerged || "{{count}} combined models created", {
        count: mod.mergedModelsGenerated ?? 0,
      }),
    );
  }
  if ((mod.drawCallsEliminated ?? 0) > 0) {
    lines.push(
      interpolate(localized.optimizerReportChangeDraws || "About {{count}} fewer drawing steps per frame", {
        count: Math.round(mod.drawCallsEliminated ?? 0),
      }),
    );
  }
  return lines;
};

const ModRow = memo(({ mod, localized }: { mod: OptimizerRunModEntry; localized: Localized }) => {
  const hasSizes = mod.sourceBytes !== undefined && mod.outputBytes !== undefined;
  const detail = changes(mod, localized);
  return (
    <li className="py-2 border-b border-gray-600 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[mod.status]}`}>
          {statusLabel(mod.status, localized)}
        </span>
        <span className="text-sm text-gray-100 wrap-break-word">{mod.name}</span>
        {mod.reused && mod.status !== "skipped" && (
          <span className="text-xs text-gray-400">
            {localized.optimizerReportReused || "(reused from an earlier run)"}
          </span>
        )}
      </div>
      {mod.status === "optimized" && hasSizes && (
        <div className="mt-1 text-sm text-gray-300">
          {interpolate(localized.optimizerReportSizes || "{{before}} → {{after}} (saved {{percent}}%)", {
            before: formatSize(mod.sourceBytes ?? 0),
            after: formatSize(mod.outputBytes ?? 0),
            percent: percentSaved(mod.sourceBytes ?? 0, mod.outputBytes ?? 0),
          })}
        </div>
      )}
      {mod.status === "optimized" && !hasSizes && (
        <div className="mt-1 text-sm text-gray-400">
          {localized.optimizerReportNoSizes || "Optimized. No size details were recorded for this result."}
        </div>
      )}
      {mod.status === "alreadyOptimal" && (
        <div className="mt-1 text-sm text-gray-300">
          {localized.optimizerReportAlreadyOptimal ||
            "The optimizer found nothing to improve; the mod was kept as it is."}
          {hasSizes && ` (${formatSize(mod.sourceBytes ?? 0)})`}
        </div>
      )}
      {mod.status === "optimized" && detail.length > 0 && (
        <ul className="mt-1 ml-4 list-disc text-xs text-slate-300">
          {detail.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {mod.status === "skipped" && (
        <div className="mt-1 text-sm text-gray-400">{skipText(mod.skipReason, localized)}</div>
      )}
      {mod.status === "skipped" && mod.failureMessage && (
        <div className="mt-0.5 text-xs text-slate-400 wrap-break-word">{mod.failureMessage}</div>
      )}
      {mod.status === "failed" && (
        <div className="mt-1 text-sm text-red-300 wrap-break-word">
          {interpolate(
            localized.optimizerReportFailed || "Could not be optimized and was copied unchanged. Reason: {{reason}}",
            { reason: mod.failureMessage || localized.optimizerReportUnknownReason || "unknown error" },
          )}
        </div>
      )}
    </li>
  );
});
ModRow.displayName = "OptimizerRunReportModRow";

const Report = ({ report, localized }: { report: OptimizerRunReport; localized: Localized }) => {
  const totals = useMemo(() => totalOptimizerRun(report), [report]);
  const groups = useMemo(() => {
    const byStatus = (status: OptimizerRunModStatus) => report.mods.filter((mod) => mod.status === status);
    return {
      failed: byStatus("failed"),
      optimized: byStatus("optimized").sort(
        (a, b) => (b.sourceBytes ?? 0) - (b.outputBytes ?? 0) - ((a.sourceBytes ?? 0) - (a.outputBytes ?? 0)),
      ),
      alreadyOptimal: byStatus("alreadyOptimal"),
      skipped: byStatus("skipped"),
    };
  }, [report]);

  return (
    <div className="space-y-4">
      <section className="rounded border border-gray-600 bg-gray-800 p-3 space-y-1">
        <p className="text-sm text-gray-400">
          {interpolate(localized.optimizerReportRunAt || "Latest run: {{date}}", {
            date: new Date(report.createdAt).toLocaleString(),
          })}
        </p>
        <p className="text-base font-medium text-gray-100">
          {totals.optimized > 0
            ? interpolate(
                localized.optimizerReportTotalSaved || "Saved {{size}} in total ({{before}} → {{after}}, {{percent}}%)",
                {
                  size: formatSize(totals.savedBytes),
                  before: formatSize(totals.sourceBytes),
                  after: formatSize(totals.outputBytes),
                  percent: percentSaved(totals.sourceBytes, totals.outputBytes),
                },
              )
            : localized.optimizerReportNothingSaved || "No mods were made smaller in this run."}
        </p>
        <p className="text-sm text-gray-300">
          {interpolate(
            localized.optimizerReportCounts ||
              "{{optimized}} optimized, {{alreadyOptimal}} already optimal, {{skipped}} skipped, {{failed}} failed",
            { ...totals },
          )}
          {totals.drawCallsEliminated > 0 &&
            ` · ${interpolate(localized.optimizerReportTotalDraws || "about {{count}} fewer drawing steps per frame", {
              count: Math.round(totals.drawCallsEliminated),
            })}`}
        </p>
      </section>

      <ul>
        {[...groups.failed, ...groups.optimized, ...groups.alreadyOptimal].map((mod) => (
          <ModRow key={mod.packName} mod={mod} localized={localized} />
        ))}
      </ul>

      {groups.skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-slate-300 hover:text-slate-100">
            {interpolate(localized.optimizerReportSkippedMods || "Skipped mods ({{count}})", {
              count: groups.skipped.length,
            })}
          </summary>
          <ul className="mt-1">
            {groups.skipped.map((mod) => (
              <ModRow key={mod.packName} mod={mod} localized={localized} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

/** The "Optimizer results" button (options drawer) and the window with the per-mod report of the latest run. */
const OptimizerRunReportButton = memo(() => {
  const localized = useLocalizations() as Localized;
  const [report, setReport] = useState<OptimizerRunReport>();
  const [show, setShow] = useState(false);

  useEffect(() => {
    void window.api?.getWorkshopOptimizerRunReport?.().then((initial) => initial && setReport(initial));
    const unsubscribe = window.api?.onWorkshopOptimizerRunReport?.((_event, next) => setReport(next));
    return () => {
      unsubscribe?.();
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs font-medium uppercase text-gray-200 hover:bg-gray-700 focus:outline-hidden focus:ring-1 focus:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!report}
        title={report ? undefined : localized.optimizerReportNone || "No optimization run yet"}
        onClick={() => setShow(true)}
      >
        <FaClipboardList aria-hidden="true" />
        {localized.optimizerReportButton || "Optimizer results"}
      </button>
      {show && (
        <Modal
          show
          dismissible
          onClose={() => setShow(false)}
          size="5xl"
          position="center"
          explicitClasses={["max-h-[90vh]"]}
        >
          <Modal.Header>
            {localized.optimizerReportTitle || "Optimizer results"}
            <span className="block text-sm font-normal text-gray-400">
              {localized.optimizerReportSubtitle || "What happened to each mod in the latest Optimize mods run"}
            </span>
          </Modal.Header>
          <Modal.Body>
            <div className="max-h-[72vh] overflow-y-auto pr-1">
              {report ? (
                <Report report={report} localized={localized} />
              ) : (
                <p className="text-sm text-gray-300">
                  {localized.optimizerReportNone ||
                    "No optimization run yet. Turn on Optimize mods and start the game to see results here."}
                </p>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              className="px-4 py-2 font-medium text-sm rounded focus:outline-hidden focus:ring-2 bg-gray-500 text-white hover:bg-gray-600 focus:ring-gray-400"
              onClick={() => setShow(false)}
            >
              {localized.visualCheckClose || "Close"}
            </button>
          </Modal.Footer>
        </Modal>
      )}
    </>
  );
});
OptimizerRunReportButton.displayName = "OptimizerRunReportButton";

export default OptimizerRunReportButton;
