import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";

import type {
  WorkshopStagingOptimizer,
  WorkshopStagingOptimizerContext,
  WorkshopStagingOptimizerMod,
  WorkshopStagingOptimizerPlan,
  WorkshopStagingOptimizerResult,
} from "../utility/workshopModStaging";
import { type OptimizerKeyBase, type KeyedConsumer, buildExactKey, buildNarrowKey } from "./cacheKey";
import type { WorkshopOptimizerCache } from "./cache";
import type { OptimizerModRecord, OptimizerSkipReason } from "./logFormat";
import {
  type HostConsumerPack,
  type HostRunOutcome,
  WORKSHOP_OPTIMIZER_HOST_OPTIONS,
  WORKSHOP_OPTIMIZER_PROFILE_ID,
  hostStageFraction,
  runHost,
} from "./hostRunner";

export interface WorkshopOptimizerEnabledMod {
  name: string;
  /** The original pack, not a staged copy. */
  path: string;
}

export interface WorkshopOptimizerDeps {
  cache: WorkshopOptimizerCache;
  hostExecutablePath: string;
  /** sha256 of the host executable. */
  hostHash: () => Promise<string>;
  vanillaFileIndexPath: string;
  /** Builds the vanilla pack index the host reads when it is missing or stale. */
  ensureVanillaIndex: () => Promise<void>;
  gameDataFolder: string;
  dbSchemaPath?: string;
  gameIdentity: () => Promise<string>;
  schemaDigest: () => Promise<string>;
  includeRigidModelV2: boolean;
  /** Every enabled mod in load order (first loads first), including the one being optimized. */
  loadOrder: readonly WorkshopOptimizerEnabledMod[];
  /** Whether the pack has a `.variantmeshdefinition` or `.wsmodel`; cheap index check, no host run. */
  hasVisualAssets: (packPath: string) => Promise<boolean>;
  parentProcessId?: number;
  runHost?: typeof runHost;
  statFile?: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  log?: (message: string) => void;
}

const makeAbortError = () => {
  const error = new Error("Workshop mod optimization canceled");
  error.name = "AbortError";
  return error;
};

const defaultStat = async (path: string) => {
  const stats = await fs.promises.stat(path);
  return { size: stats.size, mtimeMs: stats.mtimeMs };
};

interface PlanDetails {
  base: OptimizerKeyBase;
  consumers: KeyedConsumer[];
  sourceLoadOrderIndex: number;
  relevantPaths: Set<string>;
}

const comparablePath = (path: string) => path.replace(/\//g, "\\").toLowerCase();

/**
 * Optimizes eligible staged Workshop mods with `WH3AssetHost.exe optimize`, one process at a time,
 * and keeps the finished packs in the persistent cache. See `src/workshopModOptimizer/cache.ts`
 * and `cacheKey.ts` for what a result depends on.
 */
export class WorkshopModOptimizer implements WorkshopStagingOptimizer {
  /** Messages for the user (host too old, ...); the caller shows and clears them after staging. */
  readonly warnings: string[] = [];
  private readonly runHostProcess: typeof runHost;
  private readonly statFile: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  private readonly details = new Map<WorkshopStagingOptimizerPlan, PlanDetails>();
  private hostAvailable: boolean | undefined;
  private memo: { hostHash?: string; gameIdentity?: string; schemaDigest?: string } = {};
  private vanillaIndexReady = false;
  private tempCleaned = false;
  /** What happened per mod, by comparable source path: for the launch's main.log lines. */
  readonly records = new Map<string, OptimizerModRecord>();

  recordFor(path: string): OptimizerModRecord {
    const key = comparablePath(path);
    let record = this.records.get(key);
    if (!record) {
      record = {};
      this.records.set(key, record);
    }
    return record;
  }

  getRecord(path: string): OptimizerModRecord | undefined {
    return this.records.get(comparablePath(path));
  }

  private skip(path: string, reason: OptimizerSkipReason): undefined {
    this.recordFor(path).skipReason = reason;
    return undefined;
  }

  constructor(private readonly deps: WorkshopOptimizerDeps) {
    this.runHostProcess = deps.runHost ?? runHost;
    this.statFile = deps.statFile ?? defaultStat;
  }

  private log(message: string) {
    this.deps.log?.(message);
  }

  private async ensureHost(signal?: AbortSignal): Promise<boolean> {
    if (this.hostAvailable !== undefined) return this.hostAvailable;
    if (!fs.existsSync(this.deps.hostExecutablePath)) {
      this.hostAvailable = false;
      this.warnings.push("The mod optimizer (WH3AssetHost.exe) was not found; plain copies are used.");
      return false;
    }
    const outcome = await this.runHostProcess({
      executablePath: this.deps.hostExecutablePath,
      args: ["optimize", "--check-dds"],
      signal,
    });
    if (outcome.kind === "canceled") throw makeAbortError();
    this.hostAvailable = outcome.kind === "result" || outcome.kind === "ok";
    if (!this.hostAvailable) {
      this.warnings.push(
        "The installed WH3AssetHost does not support mod optimization (or its native library failed to load); plain copies are used.",
      );
    }
    return this.hostAvailable;
  }

  private async ensureVanillaIndex() {
    if (this.vanillaIndexReady) return;
    await this.deps.ensureVanillaIndex();
    this.vanillaIndexReady = true;
  }

  private async keyBase(mod: WorkshopStagingOptimizerMod): Promise<OptimizerKeyBase> {
    this.memo.hostHash ??= await this.deps.hostHash();
    this.memo.gameIdentity ??= await this.deps.gameIdentity();
    this.memo.schemaDigest ??= await this.deps.schemaDigest();
    return {
      profile: WORKSHOP_OPTIMIZER_PROFILE_ID,
      options: { ...WORKSHOP_OPTIMIZER_HOST_OPTIONS },
      includeRigidModelV2: this.deps.includeRigidModelV2,
      source: { name: mod.name, size: mod.sourceFingerprint.size, mtimeMs: mod.sourceFingerprint.mtimeMs },
      hostHash: this.memo.hostHash,
      gameIdentity: this.memo.gameIdentity,
      schemaDigest: this.memo.schemaDigest,
    };
  }

  private baseRequest(sourcePath: string, consumers: KeyedConsumer[], sourceLoadOrderIndex: number) {
    return {
      schemaVersion: 1,
      gameDirectory: this.deps.gameDataFolder,
      vanillaFileIndexPath: this.deps.vanillaFileIndexPath,
      sourcePackPath: sourcePath,
      ...(this.deps.dbSchemaPath ? { dbSchemaPath: this.deps.dbSchemaPath } : {}),
      consumerPackPaths: consumers.map((consumer) => consumer.path),
      ...(consumers.length > 0 ? { sourceLoadOrderIndex } : {}),
    };
  }

  private async writeRequest(request: object): Promise<string> {
    await this.deps.cache.ensureDirectories();
    const requestPath = nodePath.join(this.deps.cache.tempDirectory, `${randomUUID()}-request.json`);
    await fs.promises.writeFile(requestPath, JSON.stringify(request));
    return requestPath;
  }

  async plan(
    mod: WorkshopStagingOptimizerMod,
    signal?: AbortSignal,
  ): Promise<WorkshopStagingOptimizerPlan | undefined> {
    if (!(await this.deps.hasVisualAssets(mod.path))) return this.skip(mod.path, "no-visual-assets");
    if (!(await this.ensureHost(signal))) return this.skip(mod.path, "host-unavailable");
    if (!this.tempCleaned) {
      // Host output left behind by a crashed earlier launch.
      this.tempCleaned = true;
      await this.deps.cache.cleanTemp();
    }

    const base = await this.keyBase(mod);
    const ownIndex = this.deps.loadOrder.findIndex(
      (enabled) => comparablePath(enabled.path) === comparablePath(mod.path),
    );
    const sourceLoadOrderIndex = ownIndex >= 0 ? ownIndex : this.deps.loadOrder.length;
    const consumers: KeyedConsumer[] = [];
    for (const [index, enabled] of this.deps.loadOrder.entries()) {
      if (index === ownIndex) continue;
      try {
        const stats = await this.statFile(enabled.path);
        consumers.push({
          path: enabled.path,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          beforeSource: index < sourceLoadOrderIndex,
        });
      } catch {
        // A pack that cannot be read cannot be a consumer either.
      }
    }

    const exactKey = buildExactKey(base, consumers);
    const aliased = await this.deps.cache.resolveAlias(exactKey);
    if (aliased) {
      if ((await this.deps.cache.lookup(aliased)) || (await this.deps.cache.lookupFailure(aliased))) {
        this.recordFor(mod.path).keyKind = "narrow (alias hit)";
        return this.finishPlan(mod.path, aliased, { base, consumers, sourceLoadOrderIndex, relevantPaths: new Set() });
      }
    }

    // No entry for the exact set: ask the host which of the other mods can matter.
    let narrowKey = exactKey;
    let relevantPaths = new Set(consumers.map((consumer) => comparablePath(consumer.path)));
    const record = this.recordFor(mod.path);
    record.keyKind = "exact (probe unavailable)";
    if (consumers.length === 0) {
      narrowKey = buildNarrowKey(base, []);
      relevantPaths = new Set();
      record.keyKind = "narrow (no other mods)";
    } else {
      const probeStarted = Date.now();
      try {
        await this.ensureVanillaIndex();
        const requestPath = await this.writeRequest({
          ...this.baseRequest(mod.path, consumers, consumers.filter((c) => c.beforeSource).length),
          probeOnly: true,
        });
        let outcome: HostRunOutcome;
        try {
          outcome = await this.runHostProcess({
            executablePath: this.deps.hostExecutablePath,
            args: ["optimize", "--request", requestPath, ...this.parentArgs()],
            signal,
          });
        } finally {
          await fs.promises.rm(requestPath, { force: true }).catch(() => undefined);
        }
        if (outcome.kind === "canceled") throw makeAbortError();
        if (outcome.kind === "probe") {
          const relevant = new Set(
            outcome.probe.consumers
              .filter((consumer) => consumer.relevant)
              .map((consumer) => comparablePath(consumer.path)),
          );
          relevantPaths = relevant;
          record.keyKind = "narrow (probed)";
          record.probeSeconds = (Date.now() - probeStarted) / 1000;
          record.relevantConsumers = consumers
            .filter((consumer) => relevant.has(comparablePath(consumer.path)))
            .map((consumer) => nodePath.basename(consumer.path));
          narrowKey = buildNarrowKey(
            base,
            consumers.filter((consumer) => relevant.has(comparablePath(consumer.path))),
          );
        } else {
          record.probeError = describeOutcome(outcome);
          this.log(
            `Optimizer probe for ${mod.name} did not answer (${describeOutcome(outcome)}); keying on every enabled mod.`,
          );
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        record.probeError = error instanceof Error ? error.message : String(error);
        this.log(`Optimizer probe for ${mod.name} failed (${record.probeError}).`);
      }
    }

    await this.deps.cache.writeAlias(exactKey, narrowKey).catch(() => undefined);
    return this.finishPlan(mod.path, narrowKey, { base, consumers, sourceLoadOrderIndex, relevantPaths });
  }

  /** The failed host run's exit code, error and stderr tail, for the user and for bug reports. */
  private async writeHostLog(
    modName: string,
    outcome: Extract<HostRunOutcome, { kind: "failed" }>,
  ): Promise<string | undefined> {
    try {
      const directory = nodePath.join(this.deps.cache.root, "logs");
      await fs.promises.mkdir(directory, { recursive: true });
      const logPath = nodePath.join(directory, `${nodePath.basename(modName)}.host.log`);
      await fs.promises.writeFile(
        logPath,
        [
          `time: ${new Date().toISOString()}`,
          `mod: ${modName}`,
          `exit code: ${outcome.exitCode ?? "none"}`,
          `message: ${outcome.message}`,
          "stderr:",
          outcome.stderr ?? "",
        ].join("\n"),
      );
      return logPath;
    } catch {
      return undefined;
    }
  }

  private parentArgs(): string[] {
    return this.deps.parentProcessId ? ["--parent-pid", String(this.deps.parentProcessId)] : [];
  }

  private async finishPlan(
    sourcePath: string,
    key: string,
    details: PlanDetails,
  ): Promise<WorkshopStagingOptimizerPlan | undefined> {
    const failure = await this.deps.cache.lookupFailure(key);
    if (failure) {
      this.recordFor(sourcePath).failureMarker = { message: failure.message, createdAt: failure.createdAt };
      return this.skip(sourcePath, "cached-failure");
    }
    const plan: WorkshopStagingOptimizerPlan = { key };
    this.details.set(plan, details);
    this.deps.cache.pin(key);
    return plan;
  }

  async produce(
    mod: WorkshopStagingOptimizerMod,
    plan: WorkshopStagingOptimizerPlan,
    context: WorkshopStagingOptimizerContext,
  ): Promise<WorkshopStagingOptimizerResult> {
    const cache = this.deps.cache;
    const hit = await cache.lookup(plan.key);
    if (hit) {
      context.onProgress({ stage: "Restoring", fraction: 1, fromCache: true });
      return {
        status: "ready",
        packPath: hit.packPath,
        fromCache: true,
        reportPath: cache.reportPathFor(mod.name),
        warnings: [],
      };
    }

    const details = this.details.get(plan);
    if (!details) return { status: "failed", message: "The optimizer plan was not prepared.", warnings: [] };
    await this.ensureVanillaIndex();
    await cache.ensureDirectories();

    const startedAt = Date.now();
    const record = this.recordFor(mod.path);
    const outputPath = cache.newTempPath(mod.name);
    const reportPath = `${outputPath}.report.txt`;
    const requestPath = await this.writeRequest({
      ...this.baseRequest(mod.path, details.consumers, details.consumers.filter((c) => c.beforeSource).length),
      outputPackPath: outputPath,
      reportPath,
      cacheDirectory: cache.hostCacheDirectory,
      options: WORKSHOP_OPTIMIZER_HOST_OPTIONS,
    });

    const combined = new AbortController();
    const abort = () => combined.abort();
    context.signal?.addEventListener("abort", abort, { once: true });
    context.skipSignal?.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted || context.skipSignal?.aborted) combined.abort();

    const cleanup = async () => {
      context.signal?.removeEventListener("abort", abort);
      context.skipSignal?.removeEventListener("abort", abort);
      for (const path of [
        outputPath,
        `${outputPath}.optimizing`,
        reportPath,
        `${reportPath}.optimizing`,
        requestPath,
      ]) {
        await fs.promises.rm(path, { force: true }).catch(() => undefined);
      }
    };

    try {
      let outcome: HostRunOutcome;
      try {
        outcome = await this.runHostProcess({
          executablePath: this.deps.hostExecutablePath,
          args: ["optimize", "--request", requestPath, ...this.parentArgs()],
          signal: combined.signal,
          onProgress: (line) =>
            context.onProgress({
              stage: line.stage,
              item: line.item ?? undefined,
              fraction: hostStageFraction(line.stage, line.current, line.total),
            }),
        });
      } catch (error) {
        outcome = { kind: "failed", exitCode: null, message: error instanceof Error ? error.message : String(error) };
      }

      if (outcome.kind === "canceled") {
        if (context.signal?.aborted) throw makeAbortError();
        return { status: "skipped" };
      }
      if (outcome.kind !== "result") {
        const message = describeOutcome(outcome);
        if (outcome.kind === "failed") {
          record.exitCode = outcome.exitCode;
          record.hostLogPath = await this.writeHostLog(mod.name, outcome);
        }
        await cache.recordFailure(plan.key, message).catch(() => undefined);
        return { status: "failed", message, warnings: [] };
      }

      record.exitCode = 0;
      const warnings: string[] = [...(outcome.result.warnings ?? [])];
      context.onProgress({ stage: "Compressing", fraction: 0.97 });
      const compression = await context.compress(outputPath);
      if (compression.status === "failed") warnings.push(...compression.warnings);

      let key = plan.key;
      const reportedRelevant = (outcome.result.consumerPacks ?? []).filter((pack: HostConsumerPack) => pack.relevant);
      const missing = reportedRelevant.filter((pack) => !details.relevantPaths.has(comparablePath(pack.path)));
      if (details.relevantPaths.size > 0 || missing.length > 0) {
        if (missing.length > 0 && details.relevantPaths.size < details.consumers.length) {
          // The probe should be a superset of the real run; if it was not, key the result on both.
          const union = new Set([...details.relevantPaths, ...missing.map((pack) => comparablePath(pack.path))]);
          key = buildNarrowKey(
            details.base,
            details.consumers.filter((consumer) => union.has(comparablePath(consumer.path))),
          );
          this.log(
            `Optimizer probe missed ${missing.length} relevant consumer(s) for ${mod.name}; result stored under a wider key.`,
          );
        }
      }

      const hostReport = await fs.promises
        .stat(reportPath)
        .then(() => reportPath)
        .catch(() => undefined);
      const packPath = await cache.commit(
        key,
        outputPath,
        {
          sourceName: mod.name,
          sourcePath: mod.path,
          profile: WORKSHOP_OPTIMIZER_PROFILE_ID,
          hostVersion: outcome.result.hostVersion,
          relevantConsumers: reportedRelevant.map((pack) => pack.path),
        },
        hostReport,
      );
      record.seconds = (Date.now() - startedAt) / 1000;
      return { status: "ready", packPath, fromCache: false, reportPath: cache.reportPathFor(mod.name), warnings };
    } finally {
      await cleanup();
    }
  }
}

const describeOutcome = (outcome: HostRunOutcome): string => {
  switch (outcome.kind) {
    case "failed":
      return outcome.message;
    case "canceled":
      return "canceled";
    default:
      return `unexpected host answer (${outcome.kind})`;
  }
};
