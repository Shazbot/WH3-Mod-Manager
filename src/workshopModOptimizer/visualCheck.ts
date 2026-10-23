import * as fs from "node:fs";
import * as nodePath from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { sortByNameAndLoadOrder } from "../modSortingHelpers";
import { type DependencyAwareMod, dependencyRelatedMods } from "./dependencyPacks";
import {
  type HostCheckFinding,
  type HostCheckSummary,
  type HostRunOutcome,
  CHECK_STAGE_SECONDS,
  HostProgressTracker,
  parseHostVersionLine,
  runHost,
} from "./hostRunner";

/**
 * The per-mod "Check visual assets" action: runs `WH3AssetHost.exe check` on one pack and returns the
 * findings plus the path of the text report the host wrote. No Electron imports, so it is tested with a
 * fake host (see `test/visualAssetCheck.node.test.ts`). The Electron side is `visualCheckIpc.ts`.
 */

export interface VisualCheckMod {
  name: string;
  /** The pack file to check. */
  path: string;
  /** Dependency metadata of the mod (see `dependencyPacks.ts`); without it only packs that require the mod count. */
  workshopId?: string;
  reqModIdToName?: [string, string][];
  dependencyPacks?: string[];
}

export type VisualCheckEnabledMod = DependencyAwareMod & { loadOrder?: number };

export interface VisualCheckReport {
  modName: string;
  modPath: string;
  /** Milliseconds since the epoch. */
  generatedAt: number;
  elapsedSeconds: number;
  hostVersion?: string;
  summary: HostCheckSummary;
  findings: HostCheckFinding[];
  /** The stored text report; empty when the host wrote none. */
  reportPath: string;
  vmdCount: number;
  wsModelCount: number;
  rigidCount: number;
  materialCount: number;
}

export type VisualCheckFailureCode =
  /** The bundled WH3AssetHost.exe does not exist. */
  | "HOST_MISSING"
  /** The host runs but has no `check` action (an older build). */
  | "HOST_TOO_OLD"
  /** The vanilla pack index the host reads could not be built. */
  | "INDEX_FAILED"
  /** The host failed or rejected the request. */
  | "HOST_FAILED";

export type VisualCheckOutcome =
  | { status: "done"; report: VisualCheckReport }
  | { status: "failed"; code: VisualCheckFailureCode; message: string }
  | { status: "canceled" };

export interface VisualCheckDeps {
  hostExecutablePath: string;
  vanillaFileIndexPath: string;
  /** The game's data folder (the one holding manifest.txt). */
  gameDataFolder: string;
  /** Where the text reports are kept, one per pack name. */
  reportsDirectory: string;
  /** Scratch folder for the request file. */
  tempDirectory: string;
  /** The host's vanilla consumer cache folder. */
  hostCacheDirectory: string;
  /** RPFM schema for the host's unit-category resolver (finds which findings the game data uses). Optional. */
  dbSchemaPath?: string;
  /** Builds the vanilla pack index when it is missing or stale. */
  ensureVanillaIndex: () => Promise<void>;
  parentProcessId?: number;
  runHost?: typeof runHost;
  now?: () => number;
  log?: (message: string) => void;
}

export interface VisualCheckRunOptions {
  /** The user's other enabled mods, in load order (this mod excluded): a reference they provide is not missing. */
  dependencyPackPaths?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: { stage: string; item?: string; fraction: number }) => void;
}

/** The oldest `check=` version of the host this code understands. */
export const REQUIRED_HOST_CHECK_VERSION = 2;

/**
 * The name the stored report of a pack gets: the pack name (extension dropped, unsafe characters replaced)
 * and a short hash of the full path, so a Workshop copy and a custom-folder copy of one name do not collide.
 */
export const checkReportFileNameFor = (packPath: string) => {
  const hash = createHash("sha1").update(nodePath.win32.normalize(packPath).toLowerCase()).digest("hex").slice(0, 8);
  const name = nodePath.win32
    .basename(packPath)
    .replace(/\.pack$/i, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\p{Cc}/gu, "_");
  return `${name}.${hash}.check.txt`;
};

export const buildCheckRequest = (
  deps: Pick<VisualCheckDeps, "gameDataFolder" | "vanillaFileIndexPath" | "hostCacheDirectory" | "dbSchemaPath">,
  packPath: string,
  reportPath: string,
  dependencyPackPaths: readonly string[] = [],
) => ({
  schemaVersion: 1,
  gameDirectory: deps.gameDataFolder,
  vanillaFileIndexPath: deps.vanillaFileIndexPath,
  sourcePackPath: packPath,
  reportPath,
  cacheDirectory: deps.hostCacheDirectory,
  ...(deps.dbSchemaPath ? { dbSchemaPath: deps.dbSchemaPath } : {}),
  ...(dependencyPackPaths.length > 0 ? { dependencyPackPaths: [...dependencyPackPaths] } : {}),
});

const describeFailure = (outcome: Extract<HostRunOutcome, { kind: "failed" }>) => {
  // An older host does not know the subcommand: it exits 2 with a usage-style message.
  if (
    outcome.exitCode === 2 &&
    /unknown|usage|invalid ?arguments|--pack/i.test(`${outcome.message} ${outcome.stderr ?? ""}`)
  ) {
    return { code: "HOST_TOO_OLD" as const, message: outcome.message };
  }
  return { code: "HOST_FAILED" as const, message: outcome.message };
};

/** Runs the check of one pack. Never throws: every failure is an outcome. */
export const runVisualAssetCheck = async (
  deps: VisualCheckDeps,
  mod: VisualCheckMod,
  options: VisualCheckRunOptions = {},
): Promise<VisualCheckOutcome> => {
  const run = deps.runHost ?? runHost;
  const now = deps.now ?? Date.now;
  if (!fs.existsSync(deps.hostExecutablePath)) {
    return {
      status: "failed",
      code: "HOST_MISSING",
      message: `WH3AssetHost.exe was not found at '${deps.hostExecutablePath}'.`,
    };
  }

  let requestPath: string | undefined;
  let storedReport: string | undefined;
  try {
    const version = await run({
      executablePath: deps.hostExecutablePath,
      args: ["--version"],
      signal: options.signal,
    });
    if (version.kind === "canceled") return { status: "canceled" };
    const versions = version.kind === "version" ? parseHostVersionLine(version.text) : undefined;
    if (!versions || (versions.checkVersion ?? 0) < REQUIRED_HOST_CHECK_VERSION) {
      return {
        status: "failed",
        code: "HOST_TOO_OLD",
        message: versions
          ? `The installed WH3AssetHost (${versions.hostVersion}) does not support the visual asset check.`
          : "The installed WH3AssetHost could not be queried for its version.",
      };
    }

    try {
      await deps.ensureVanillaIndex();
    } catch (error) {
      return {
        status: "failed",
        code: "INDEX_FAILED",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (options.signal?.aborted) return { status: "canceled" };

    await fs.promises.mkdir(deps.reportsDirectory, { recursive: true });
    await fs.promises.mkdir(deps.tempDirectory, { recursive: true });
    await fs.promises.mkdir(deps.hostCacheDirectory, { recursive: true });
    storedReport = nodePath.join(deps.reportsDirectory, checkReportFileNameFor(mod.path));
    requestPath = nodePath.join(deps.tempDirectory, `${randomUUID()}-check-request.json`);
    await fs.promises.writeFile(
      requestPath,
      JSON.stringify(buildCheckRequest(deps, mod.path, storedReport, options.dependencyPackPaths)),
    );

    const tracker = new HostProgressTracker(CHECK_STAGE_SECONDS);
    const outcome = await run({
      executablePath: deps.hostExecutablePath,
      args: [
        "check",
        "--request",
        requestPath,
        ...(deps.parentProcessId ? ["--parent-pid", String(deps.parentProcessId)] : []),
      ],
      signal: options.signal,
      lowPriority: true,
      onProgress: (line) =>
        options.onProgress?.({
          stage: line.stage,
          item: line.item ?? undefined,
          fraction: tracker.update(line.stage, line.current, line.total),
        }),
    });

    if (outcome.kind === "canceled") return { status: "canceled" };
    if (outcome.kind === "failed") {
      deps.log?.(`check of ${mod.name} failed (exit ${outcome.exitCode}): ${outcome.message}`);
      return { status: "failed", ...describeFailure(outcome) };
    }
    if (outcome.kind !== "check") {
      return { status: "failed", code: "HOST_FAILED", message: "The host finished without reporting a check result." };
    }

    const check = outcome.check;
    return {
      status: "done",
      report: {
        modName: mod.name,
        modPath: mod.path,
        generatedAt: now(),
        elapsedSeconds: check.elapsedSeconds ?? 0,
        hostVersion: check.hostVersion,
        summary: check.summary,
        findings: check.findings,
        reportPath: check.reportPath,
        vmdCount: check.vmdCount ?? 0,
        wsModelCount: check.wsModelCount ?? 0,
        rigidCount: check.rigidCount ?? 0,
        materialCount: check.materialCount ?? 0,
      },
    };
  } catch (error) {
    if (options.signal?.aborted) return { status: "canceled" };
    return { status: "failed", code: "HOST_FAILED", message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (requestPath) await fs.promises.rm(requestPath, { force: true }).catch(() => undefined);
    if (storedReport) await fs.promises.rm(`${storedReport}.checking`, { force: true }).catch(() => undefined);
  }
};

const isPackFile = (path: unknown): path is string => typeof path === "string" && /\.pack$/i.test(path);

/**
 * The user's enabled packs that have a declared dependency relationship with this mod, in either direction
 * (see `dependencyRelatedMods`), in load order (first loads first), this mod excluded.
 */
export const dependencyPacksOf = (mod: VisualCheckMod, enabledMods: VisualCheckEnabledMod[] | undefined): string[] => {
  const own = nodePath.win32.normalize(mod.path).toLowerCase();
  const seen = new Set<string>([own]);
  const result: string[] = [];
  const ordered = sortByNameAndLoadOrder((enabledMods ?? []).filter((item) => isPackFile(item?.path)));
  for (const other of dependencyRelatedMods(mod, ordered)) {
    const key = nodePath.win32.normalize(other.path).toLowerCase();
    if (seen.has(key) || !fs.existsSync(other.path)) continue;
    seen.add(key);
    result.push(other.path);
  }
  return result;
};
