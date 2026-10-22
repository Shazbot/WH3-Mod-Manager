import React, { memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { FaExclamationTriangle, FaFileAlt, FaFolderOpen, FaInfoCircle, FaRegSave, FaTimesCircle } from "react-icons/fa";

import { addToast } from "../appSlice";
import { Modal } from "../flowbite";
import { useAppDispatch } from "../hooks";
import localizationContext from "../localizationContext";

type Severity = "error" | "warning" | "info";
const SEVERITIES: Severity[] = ["error", "warning", "info"];
/** Findings drawn per severity and category before "Show all", so a pack with thousands stays responsive. */
const VISIBLE_PER_GROUP = 100;

const interpolate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

const SEVERITY_STYLE: Record<Severity, { text: string; badge: string; Icon: typeof FaTimesCircle }> = {
  error: { text: "text-red-400", badge: "bg-red-900 text-red-100", Icon: FaTimesCircle },
  warning: { text: "text-amber-400", badge: "bg-amber-900 text-amber-100", Icon: FaExclamationTriangle },
  info: { text: "text-sky-400", badge: "bg-slate-600 text-slate-100", Icon: FaInfoCircle },
};

const FindingRow = memo(
  ({ finding, localized }: { finding: VisualAssetCheckFinding; localized: Record<string, string> }) => {
    const style = SEVERITY_STYLE[finding.severity];
    const moreRelated = finding.relatedCount - finding.relatedPaths.length;
    return (
      <li className="py-2 border-b border-gray-600 last:border-b-0">
        <div className="flex items-baseline gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${style.badge}`}>{finding.code}</span>
          <span className="text-sm text-gray-100 break-words">{finding.message}</span>
        </div>
        {finding.path && <div className="mt-1 text-xs text-slate-300 break-all">{finding.path}</div>}
        {finding.details && (
          <div className="mt-0.5 text-xs text-slate-400 break-words">
            <span className="font-medium">{localized.visualCheckDetails || "Details"}: </span>
            {finding.details}
          </div>
        )}
        {finding.relatedPaths.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
              {interpolate(localized.visualCheckRelated || "Related paths ({{count}})", {
                count: finding.relatedCount,
              })}
            </summary>
            <ul className="mt-1 ml-4 space-y-0.5 text-xs text-slate-300">
              {finding.relatedPaths.map((path) => (
                <li key={path} className="break-all">
                  {path}
                </li>
              ))}
              {moreRelated > 0 && (
                <li className="text-slate-400">
                  {interpolate(localized.visualCheckRelatedMore || "... and {{count}} more (see the report file)", {
                    count: moreRelated,
                  })}
                </li>
              )}
            </ul>
          </details>
        )}
      </li>
    );
  },
);
FindingRow.displayName = "FindingRow";

const Findings = memo(
  ({ report, localized }: { report: VisualAssetCheckReport; localized: Record<string, string> }) => {
    // Errors and warnings by default; info (optimization hints, notes) is one click away.
    const [shown, setShown] = useState<Record<Severity, boolean>>({ error: true, warning: true, info: false });
    const usageKnown = report.summary.usageKnown;
    // Findings reachable only from variant meshes no unit uses are hidden by default when that is known.
    const [hideUnused, setHideUnused] = useState(usageKnown);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const visibleFindings = useMemo(
      () => (hideUnused ? report.findings.filter((finding) => finding.usedByGame !== false) : report.findings),
      [hideUnused, report.findings],
    );
    const counts = useMemo(() => {
      const result: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
      for (const finding of visibleFindings) result[finding.severity]++;
      return result;
    }, [visibleFindings]);
    const severityLabel: Record<Severity, string> = {
      error: localized.visualCheckErrors || "Errors",
      warning: localized.visualCheckWarnings || "Warnings",
      info: localized.visualCheckInfo || "Info",
    };

    // severity -> category -> findings, in the host's order (most severe, then category, code, path).
    const groups = useMemo(() => {
      const bySeverity = new Map<Severity, Map<string, VisualAssetCheckFinding[]>>();
      for (const finding of visibleFindings) {
        let categories = bySeverity.get(finding.severity);
        if (!categories) bySeverity.set(finding.severity, (categories = new Map()));
        let list = categories.get(finding.category);
        if (!list) categories.set(finding.category, (list = []));
        list.push(finding);
      }
      return bySeverity;
    }, [visibleFindings]);

    const total = visibleFindings.length;
    const anyShown = SEVERITIES.some((severity) => shown[severity] && (groups.get(severity)?.size ?? 0) > 0);

    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-300">
          {interpolate(
            localized.visualCheckSummary ||
              "Checked {{vmds}} variant meshes, {{wsmodels}} WSModels, {{rigids}} rigid models and {{materials}} materials in {{seconds}} s.",
            {
              vmds: report.vmdCount,
              wsmodels: report.wsModelCount,
              rigids: report.rigidCount,
              materials: report.materialCount,
              seconds: report.elapsedSeconds.toFixed(1),
            },
          )}
        </p>

        {usageKnown && (
          <p className="text-sm text-gray-300">
            {interpolate(
              localized.visualCheckUsage ||
                "{{used}} findings are in assets a unit uses, {{unused}} only in assets no unit uses (one level less serious), {{unknown}} unknown. {{vmdsUsed}} of {{vmds}} variant meshes are used.",
              {
                used: report.summary.findingsUsed,
                unused: report.summary.findingsUnused,
                unknown: report.summary.findingsUnknown,
                vmdsUsed: report.summary.vmdsUsed,
                vmds: report.summary.vmdsUsed + report.summary.vmdsUnused,
              },
            )}
          </p>
        )}

        <div
          role="group"
          aria-label={localized.visualCheckFilter || "Show"}
          className="flex flex-wrap items-center gap-2"
        >
          {SEVERITIES.map((severity) => {
            const { Icon, text } = SEVERITY_STYLE[severity];
            return (
              <button
                key={severity}
                type="button"
                aria-pressed={shown[severity]}
                disabled={counts[severity] === 0}
                onClick={() => setShown((previous) => ({ ...previous, [severity]: !previous[severity] }))}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                  shown[severity]
                    ? "border-blue-500 bg-gray-600 text-white"
                    : "border-gray-600 bg-gray-800 text-gray-400"
                }`}
              >
                <Icon className={`h-4 w-4 ${text}`} aria-hidden="true" />
                {severityLabel[severity]} ({counts[severity]})
              </button>
            );
          })}
          {usageKnown && (
            <label className="ml-2 inline-flex items-center gap-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={hideUnused}
                onChange={(event) => setHideUnused(event.target.checked)}
                className="rounded border-gray-500 bg-gray-700"
              />
              {interpolate(localized.visualCheckHideUnused || "Hide findings in assets no unit uses ({{count}})", {
                count: report.summary.findingsUnused,
              })}
            </label>
          )}
        </div>

        {total === 0 && (
          <p className="text-sm text-green-400">{localized.visualCheckNoFindings || "No problems found."}</p>
        )}
        {total > 0 && !anyShown && (
          <p className="text-sm text-gray-400">
            {localized.visualCheckNothingShown || "Nothing to show with these filters."}
          </p>
        )}

        {SEVERITIES.filter((severity) => shown[severity] && groups.has(severity)).map((severity) => {
          const { Icon, text } = SEVERITY_STYLE[severity];
          return (
            <section key={severity} aria-label={severityLabel[severity]}>
              <h3 className={`flex items-center gap-2 text-base font-medium ${text}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {severityLabel[severity]} ({counts[severity]})
              </h3>
              {[...(groups.get(severity) ?? [])].map(([category, findings]) => {
                const key = `${severity}|${category}`;
                const visible = expanded[key] ? findings : findings.slice(0, VISIBLE_PER_GROUP);
                return (
                  <details key={key} open={severity !== "info"} className="mt-1 rounded border border-gray-600">
                    <summary className="cursor-pointer select-none bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-200">
                      {localized[`visualCheckCategory${category}`] || category} ({findings.length})
                    </summary>
                    <ul className="px-3">
                      {visible.map((finding, index) => (
                        <FindingRow
                          key={`${finding.code}|${finding.path}|${index}`}
                          finding={finding}
                          localized={localized}
                        />
                      ))}
                    </ul>
                    {visible.length < findings.length && (
                      <button
                        type="button"
                        className="m-2 rounded px-3 py-1 text-sm text-blue-300 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onClick={() => setExpanded((previous) => ({ ...previous, [key]: true }))}
                      >
                        {interpolate(localized.visualCheckShowAll || "Show all {{count}}", { count: findings.length })}
                      </button>
                    )}
                  </details>
                );
              })}
            </section>
          );
        })}
      </div>
    );
  },
);
Findings.displayName = "Findings";

const failureText = (
  state: Extract<VisualAssetCheckState, { state: "failed" }>,
  localized: Record<string, string>,
): string => {
  switch (state.code) {
    case "HOST_MISSING":
      return (
        localized.visualCheckHostMissing ||
        "The asset host (WH3AssetHost.exe) was not found, so mods cannot be checked."
      );
    case "HOST_TOO_OLD":
      return (
        localized.visualCheckHostTooOld ||
        "The installed asset host is too old and has no visual asset check. Update the manager's bundled WH3AssetHost."
      );
    case "BUSY":
      return localized.visualCheckBusy || "A visual asset check is already running.";
    case "NO_GAME":
      return localized.visualCheckNoGame || "The game's data folder is not set up.";
    case "INDEX_FAILED":
      return interpolate(
        localized.visualCheckIndexFailed || "The vanilla pack index could not be prepared: {{error}}",
        {
          error: state.message,
        },
      );
    default:
      return interpolate(localized.visualCheckHostFailed || "The asset host failed: {{error}}", {
        error: state.message,
      });
  }
};

/**
 * Shows the per-mod "Check visual assets" run: progress while the host works, then the findings grouped by
 * severity and category with the text report one click away. The main process owns the run (see
 * workshopModOptimizer/visualCheckIpc.ts); this only follows its state. Mounted once in the main window so
 * it survives the context menu that started the check closing.
 */
const VisualAssetCheckModal = memo(() => {
  const dispatch = useAppDispatch();
  const localized = useContext(localizationContext) as Record<string, string>;
  const [state, setState] = useState<VisualAssetCheckState>({ state: "idle" });

  useEffect(() => {
    const unsubscribe = window.api?.onVisualAssetCheckState?.((_event, next) => setState(next));
    void window.api?.getVisualAssetCheckState?.().then((initial) => initial && setState(initial));
    return () => {
      unsubscribe?.();
    };
  }, []);

  // Closing a running check cancels it; closing a result returns to idle.
  const dismiss = useCallback(() => window.api?.cancelVisualAssetCheck?.(), []);

  const reportAction = useCallback(
    async (
      action: () => Promise<{ success: boolean; canceled?: boolean; savedPath?: string; error?: string }> | undefined,
    ) => {
      const result = await action();
      if (!result || result.canceled) return;
      // Opening the report or its folder is visible on its own; only a save or a failure gets a toast.
      if (result.success && !result.savedPath) return;
      dispatch(
        addToast({
          type: result.success ? "success" : "warning",
          messages: [
            result.success
              ? interpolate(localized.visualCheckReportSaved || "Report saved to {{path}}", {
                  path: result.savedPath ?? "",
                })
              : interpolate(localized.visualCheckReportFailed || "The report could not be opened or saved: {{error}}", {
                  error: result.error ?? "",
                }),
          ],
          duration: 6000,
          startTime: Date.now(),
        }),
      );
    },
    [dispatch, localized],
  );

  if (state.state === "idle") return null;

  const modName = state.state === "done" ? state.report.modName : state.modName;
  const percent = state.state === "running" ? Math.round(state.fraction * 100) : 0;
  const buttonBase = "px-4 py-2 font-medium text-sm rounded focus:outline-none focus:ring-2";

  return (
    <Modal show dismissible onClose={dismiss} size="5xl" position="center" explicitClasses={["max-h-[90vh]"]}>
      <Modal.Header>
        {localized.visualCheckTitle || "Visual asset check"}
        <span className="block text-sm font-normal text-gray-400 break-all">{modName}</span>
      </Modal.Header>
      <Modal.Body>
        {/* Long reports scroll inside the modal; header and footer stay on screen. */}
        <div className="max-h-[72vh] overflow-y-auto pr-1">
          {state.state === "running" && (
            <div className="space-y-2" role="status" aria-live="polite">
              <p className="text-sm text-gray-300">
                {interpolate(localized.visualCheckRunning || "Checking {{mod}}...", { mod: state.modName })}
              </p>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-2 w-full overflow-hidden rounded bg-gray-600"
              >
                <div className="h-full bg-blue-500" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-xs text-gray-400 break-all">
                {state.stage ?? localized.visualCheckStarting ?? "Starting the asset host..."}
                {state.item ? ` - ${state.item}` : ""} ({percent}%)
              </p>
            </div>
          )}
          {state.state === "failed" && (
            <div role="alert" className="space-y-2">
              <p className="text-base font-medium text-red-400">
                {localized.visualCheckFailedTitle || "The check could not be completed"}
              </p>
              <p className="text-sm text-gray-300 break-words">{failureText(state, localized)}</p>
            </div>
          )}
          {state.state === "done" && <Findings report={state.report} localized={localized} />}
        </div>
      </Modal.Body>
      <Modal.Footer>
        {state.state === "done" && state.report.reportPath && (
          <>
            <button
              type="button"
              className={`${buttonBase} inline-flex items-center gap-2 bg-purple-600 text-white hover:bg-purple-700 focus:ring-purple-500`}
              onClick={() => void reportAction(() => window.api?.openVisualAssetCheckReport?.())}
            >
              <FaFileAlt aria-hidden="true" />
              {localized.visualCheckOpenReport || "Open report"}
            </button>
            <button
              type="button"
              className={`${buttonBase} inline-flex items-center gap-2 bg-gray-500 text-white hover:bg-gray-600 focus:ring-gray-400`}
              onClick={() => void reportAction(() => window.api?.showVisualAssetCheckReportInFolder?.())}
            >
              <FaFolderOpen aria-hidden="true" />
              {localized.visualCheckShowInFolder || "Show in folder"}
            </button>
            <button
              type="button"
              className={`${buttonBase} inline-flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500`}
              onClick={() => void reportAction(() => window.api?.saveVisualAssetCheckReport?.())}
            >
              <FaRegSave aria-hidden="true" />
              {localized.visualCheckSaveReport || "Save report as..."}
            </button>
          </>
        )}
        <button
          type="button"
          className={`${buttonBase} bg-gray-500 text-white hover:bg-gray-600 focus:ring-gray-400`}
          onClick={dismiss}
        >
          {state.state === "running" ? localized.visualCheckCancel || "Cancel" : localized.visualCheckClose || "Close"}
        </button>
      </Modal.Footer>
    </Modal>
  );
});

VisualAssetCheckModal.displayName = "VisualAssetCheckModal";

export default VisualAssetCheckModal;
