import * as os from "node:os";
import * as path from "node:path";
import type { AutomationContext } from "../automation/operations";

export const defaultCliCacheDirectory = (
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string => {
  if (platform === "win32") return path.win32.join(environment.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "wh3mm");
  if (platform === "darwin") return path.join(home, "Library", "Caches", "wh3mm");
  const root = environment.XDG_CACHE_HOME;
  return path.join(root && path.isAbsolute(root) ? root : path.join(home, ".cache"), "wh3mm");
};

const oneLine = (value: unknown): string => String(value ?? "unknown").replace(/[\r\n\t]+/g, " ").trim();

export const createCliProgressReporter = (
  write: (value: string) => void,
  now: () => number = Date.now,
  interval = 500,
): NonNullable<AutomationContext["progress"]> => {
  let previousPhase = "";
  let previousTime = -Infinity;
  let previousSignature = "";
  return (update) => {
    const phase = `${update.state ?? ""}:${update.stage}`;
    const signature = JSON.stringify(update);
    if (signature === previousSignature) return;
    const time = now();
    const finished = update.total !== undefined && update.completed !== undefined && update.completed >= update.total;
    if (phase === previousPhase && time - previousTime < interval && !finished) return;
    previousPhase = phase;
    previousTime = time;
    previousSignature = signature;
    const counts = update.completed === undefined ? "" : ` ${update.completed}${update.total === undefined ? "" : `/${update.total}`}`;
    const details = (["units", "paths", "edges"] as const)
      .filter((key) => update[key] !== undefined).map((key) => `${key}=${update[key]}`).join(" ");
    write(`[progress] ${oneLine(update.state ? `${update.state} ${update.stage}` : update.stage)}${counts}${details ? ` ${details}` : ""}${update.message ? `: ${oneLine(update.message)}` : ""}\n`);
  };
};

/** Compact review output; the operation keeps full source evidence in JSON/reports. */
export const formatAffectedChecklist = (data: Record<string, any>): string => {
  const affected = data.affectedUnits;
  const checklist = affected.checklist ?? {};
  const lines = [`${affected.total ?? 0} affected units; ${affected.complete ? "complete" : "incomplete — see unresolved paths and diagnostics"}`];
  for (const unit of checklist.units ?? []) {
    const factions = (unit.customBattleFactions ?? []).map((faction: any) => oneLine(faction.key)).join(", ") || "unknown";
    const files = (unit.changedFiles ?? []).map((file: any) => oneLine(file.path)).join(", ") || "none";
    lines.push(`${oneLine(unit.key)} | ${oneLine(unit.name)} | ${oneLine(unit.role)} | custom battle: ${factions} | ${unit.changedBytes ?? 0} bytes | ${files}`);
  }
  for (const asset of checklist.campaignReviewAssets ?? []) {
    lines.push(`${oneLine(asset.classification ?? "unknown usage")} | ${oneLine(asset.path)} | ${asset.bytes ?? 0} bytes | ${oneLine(asset.reason)}`);
  }
  for (const asset of checklist.unmappedAssets ?? []) {
    lines.push(`unmapped (${oneLine(asset.status)}) | ${oneLine(asset.path)} | ${asset.bytes ?? 0} bytes`);
  }
  for (const assetPath of affected.unresolvedPaths ?? []) lines.push(`unresolved | ${oneLine(assetPath)}`);
  return `${lines.join("\n")}\n`;
};
