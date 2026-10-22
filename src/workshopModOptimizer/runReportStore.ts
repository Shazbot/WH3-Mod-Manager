import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";

import type { OptimizerRunReport } from "./runReport";

export const OPTIMIZER_RUN_REPORT_FILE = "workshop-optimizer-last-run.json";

/** Writes the report next to the app's other state (`userData`), atomically. */
export const saveOptimizerRunReport = async (directory: string, report: OptimizerRunReport): Promise<void> => {
  const path = nodePath.join(directory, OPTIMIZER_RUN_REPORT_FILE);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(report));
    await fs.promises.rename(temporaryPath, path);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};

export const loadOptimizerRunReport = async (directory: string): Promise<OptimizerRunReport | undefined> => {
  try {
    const value = JSON.parse(await fs.promises.readFile(nodePath.join(directory, OPTIMIZER_RUN_REPORT_FILE), "utf8"));
    return value?.version === 1 && Array.isArray(value.mods) ? (value as OptimizerRunReport) : undefined;
  } catch {
    return undefined;
  }
};

export const clearOptimizerRunReport = (directory: string): Promise<void> =>
  fs.promises.rm(nodePath.join(directory, OPTIMIZER_RUN_REPORT_FILE), { force: true });
