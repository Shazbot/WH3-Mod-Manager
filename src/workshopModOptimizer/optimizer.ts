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
import { dependencyRelatedMods } from "./dependencyPacks";
import type { WorkshopOptimizerCache } from "./cache";
import type { OptimizerModRecord, OptimizerSkipReason } from "./logFormat";
import {
  type HostConsumerPack,
  type HostRunOutcome,
  type HostVersions,
  WORKSHOP_OPTIMIZER_PROFILE_ID,
  HostProgressTracker,
  buildHostOptions,
  parseHostVersionLine,
  runHost,
} from "./hostRunner";

export interface WorkshopOptimizerEnabledMod {
  name: string;
  /** The original pack, not a staged copy. */
  path: string;
  /** Dependency metadata, see `dependencyPacks.ts`; a mod without it has no declared dependencies. */
  workshopId?: string;
  reqModIdToName?: [string, string][];
  dependencyPacks?: string[];
}

/** A running background job the launch can wait for, see `background.ts`. */
export interface OptimizerBackgroundJoin {
  /**
   * If a background job is producing `key`, waits for it (forwarding its progress) and returns "joined";
   * a job for another key is stopped ("preempted") because only one host runs at a time; "none" otherwise.
   */
  joinOrPreempt(
    key: string,
    onProgress: (progress: { stage: string; fraction: number }) => void,
    signal?: AbortSignal,
  ): Promise<"joined" | "preempted" | "none">;
}

export interface WorkshopOptimizerDeps {
  cache: WorkshopOptimizerCache;
  hostExecutablePath: string;
  vanillaFileIndexPath: string;
  /** Builds the vanilla pack index the host reads when it is missing or stale. */
  ensureVanillaIndex: () => Promise<void>;
  gameDataFolder: string;
  dbSchemaPath?: string;
  gameIdentity: () => Promise<string>;
  schemaDigest: () => Promise<string>;
  /** Whether the host also LZ4-compresses the output's rigid models (the user's rigid compression setting). */
  compressRigidModels: boolean;
  /** Every enabled mod in load order (first loads first), including the one being optimized. */
  loadOrder: readonly WorkshopOptimizerEnabledMod[];
  /** Whether the pack has a `.variantmeshdefinition` or `.wsmodel`; cheap index check, no host run. */
  hasVisualAssets: (packPath: string) => Promise<boolean>;
  parentProcessId?: number;
  runHost?: typeof runHost;
  statFile?: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  log?: (message: string) => void;
  /** Background optimization runs the host below normal priority. */
  lowPriority?: boolean;
  /** Set for the launch, so it can take over a background job. */
  background?: OptimizerBackgroundJoin;
  /** Told when a host process starts or ends, for the background job to stop it. */
  onHostStarted?: (pid: number | undefined) => void;
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
  /** Comparable paths of the consumers that have a declared dependency relationship with the mod. */
  dependencyPaths: Set<string>;
  relevantPaths: Set<string>;
}

interface ModContext {
  base: OptimizerKeyBase;
  consumers: KeyedConsumer[];
  sourceLoadOrderIndex: number;
  dependencyPaths: Set<string>;
  exactKey: string;
}

interface ProbeAnswer {
  relevant: Set<string>;
  seconds: number;
  batchSize: number;
}

const comparablePath = (path: string) => path.replace(/\//g, "\\").toLowerCase();

/**
 * Optimizes eligible staged mods with `WH3AssetHost.exe optimize`, one process at a time, and keeps the
 * finished packs in the persistent cache. See `cache.ts` and `cacheKey.ts` for what a result depends on.
 */
export class WorkshopModOptimizer implements WorkshopStagingOptimizer {
  /** Messages for the user (host too old, ...); the caller shows and clears them after staging. */
  readonly warnings: string[] = [];
  private readonly runHostProcess: typeof runHost;
  private readonly statFile: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  private readonly details = new Map<WorkshopStagingOptimizerPlan, PlanDetails>();
  private hostAvailable: boolean | undefined;
  private versions: HostVersions | undefined;
  private memo: { gameIdentity?: string; schemaDigest?: string } = {};
  private vanillaIndexReady = false;
  private tempCleaned = false;
  private readonly probeAnswers = new Map<string, ProbeAnswer>();
  private loadOrderStats: { path: string; size: number; mtimeMs: number }[] | undefined;
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
    const check = await this.runHostProcess({
      executablePath: this.deps.hostExecutablePath,
      args: ["optimize", "--check-dds"],
      signal,
    });
    if (check.kind === "canceled") throw makeAbortError();
    const version = await this.runHostProcess({
      executablePath: this.deps.hostExecutablePath,
      args: ["--version"],
      signal,
    });
    if (version.kind === "canceled") throw makeAbortError();
    this.versions = version.kind === "version" ? parseHostVersionLine(version.text) : undefined;
    this.hostAvailable = (check.kind === "result" || check.kind === "ok") && !!this.versions;
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
    this.memo.gameIdentity ??= await this.deps.gameIdentity();
    this.memo.schemaDigest ??= await this.deps.schemaDigest();
    return {
      profile: WORKSHOP_OPTIMIZER_PROFILE_ID,
      options: { ...buildHostOptions(this.deps.compressRigidModels) },
      source: { name: mod.name, size: mod.sourceFingerprint.size, mtimeMs: mod.sourceFingerprint.mtimeMs },
      outputVersion: this.versions?.outputVersion ?? 0,
      scanVersion: this.versions?.scanVersion ?? 0,
      gameIdentity: this.memo.gameIdentity,
      schemaDigest: this.memo.schemaDigest,
    };
  }

  private baseRequest(
    sourcePath: string,
    consumers: KeyedConsumer[],
    sourceLoadOrderIndex: number,
    dependencyPaths: ReadonlySet<string>,
  ) {
    const dependencyPackPaths = consumers
      .map((consumer) => consumer.path)
      .filter((path) => dependencyPaths.has(comparablePath(path)));
    return {
      schemaVersion: 1,
      gameDirectory: this.deps.gameDataFolder,
      vanillaFileIndexPath: this.deps.vanillaFileIndexPath,
      sourcePackPath: sourcePath,
      ...(this.deps.dbSchemaPath ? { dbSchemaPath: this.deps.dbSchemaPath } : {}),
      consumerPackPaths: consumers.map((consumer) => consumer.path),
      ...(consumers.length > 0 ? { sourceLoadOrderIndex } : {}),
      // Packs the mod is split across: the host resolves the files it references from them.
      ...(dependencyPackPaths.length > 0 ? { dependencyPackPaths } : {}),
    };
  }

  private async writeRequest(request: object): Promise<string> {
    await this.deps.cache.ensureDirectories();
    const requestPath = nodePath.join(this.deps.cache.tempDirectory, `${randomUUID()}-request.json`);
    await fs.promises.writeFile(requestPath, JSON.stringify(request));
    return requestPath;
  }

  private parentArgs(): string[] {
    return this.deps.parentProcessId ? ["--parent-pid", String(this.deps.parentProcessId)] : [];
  }

  /** The load order's packs that can be read, with the state that goes into the keys. */
  private async readLoadOrder() {
    if (this.loadOrderStats) return this.loadOrderStats;
    const stats: { path: string; size: number; mtimeMs: number }[] = [];
    for (const enabled of this.deps.loadOrder) {
      try {
        const stat = await this.statFile(enabled.path);
        stats.push({ path: enabled.path, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // A pack that cannot be read cannot be a consumer either.
      }
    }

    this.loadOrderStats = stats;
    return stats;
  }

  private async contextFor(mod: WorkshopStagingOptimizerMod): Promise<ModContext> {
    const base = await this.keyBase(mod);
    const loadOrder = await this.readLoadOrder();
    const ownIndex = loadOrder.findIndex((enabled) => comparablePath(enabled.path) === comparablePath(mod.path));
    const sourceLoadOrderIndex = ownIndex >= 0 ? ownIndex : loadOrder.length;
    const consumers: KeyedConsumer[] = loadOrder
      .map((enabled, index) => ({
        path: enabled.path,
        size: enabled.size,
        mtimeMs: enabled.mtimeMs,
        beforeSource: index < sourceLoadOrderIndex,
        index,
      }))
      .filter((item) => item.index !== ownIndex)
      .map(({ index: _index, ...rest }) => rest);
    const ownMod = this.deps.loadOrder.find((enabled) => comparablePath(enabled.path) === comparablePath(mod.path));
    const dependencyPaths = new Set(
      dependencyRelatedMods(ownMod ?? { name: mod.name, path: mod.path }, this.deps.loadOrder)
        .map((related) => comparablePath(related.path))
        .filter((path) => consumers.some((consumer) => comparablePath(consumer.path) === path)),
    );
    return { base, consumers, sourceLoadOrderIndex, dependencyPaths, exactKey: buildExactKey(base, consumers) };
  }

  /**
   * One probe for every mod that has no cached answer: the host loads and scans the load order once for
   * all of them (and keeps the per-pack scans for the next probe).
   */
  async prepare(mods: WorkshopStagingOptimizerMod[], signal?: AbortSignal): Promise<void> {
    const needProbe: { mod: WorkshopStagingOptimizerMod; context: ModContext }[] = [];
    for (const mod of mods) {
      if (!(await this.deps.hasVisualAssets(mod.path))) continue;
      if (!(await this.ensureHost(signal))) return;
      const context = await this.contextFor(mod);
      if (context.consumers.length === 0) continue;
      const aliased = await this.deps.cache.resolveAlias(context.exactKey);
      if (aliased && ((await this.deps.cache.lookup(aliased)) || (await this.deps.cache.lookupFailure(aliased))))
        continue;
      needProbe.push({ mod, context });
    }

    if (needProbe.length === 0) return;
    if (!this.tempCleaned) {
      this.tempCleaned = true;
      await this.deps.cache.cleanTemp();
    }

    await this.runProbe(needProbe, signal);
  }

  private async runProbe(
    items: { mod: WorkshopStagingOptimizerMod; context: ModContext }[],
    signal?: AbortSignal,
  ): Promise<void> {
    const started = Date.now();
    try {
      await this.ensureVanillaIndex();
      const loadOrder = await this.readLoadOrder();
      const requestPath = await this.writeRequest({
        schemaVersion: 1,
        gameDirectory: this.deps.gameDataFolder,
        vanillaFileIndexPath: this.deps.vanillaFileIndexPath,
        sourcePackPath: items[0].mod.path,
        ...(this.deps.dbSchemaPath ? { dbSchemaPath: this.deps.dbSchemaPath } : {}),
        consumerPackPaths: loadOrder.map((enabled) => enabled.path),
        probeOnly: true,
        probeSources: items.map((item) => item.mod.path),
        cacheDirectory: this.deps.cache.hostCacheDirectory,
      });
      let outcome: HostRunOutcome;
      try {
        outcome = await this.runHostProcess({
          executablePath: this.deps.hostExecutablePath,
          args: ["optimize", "--request", requestPath, ...this.parentArgs()],
          signal,
          lowPriority: this.deps.lowPriority,
          onStarted: this.deps.onHostStarted,
        });
      } finally {
        await fs.promises.rm(requestPath, { force: true }).catch(() => undefined);
        this.deps.onHostStarted?.(undefined);
      }

      if (outcome.kind === "canceled") throw makeAbortError();
      if (outcome.kind !== "probe" || !outcome.probe.sources) {
        const message = describeOutcome(outcome);
        for (const item of items) this.recordFor(item.mod.path).probeError = message;
        this.log(`Optimizer probe did not answer (${message}); keying on every enabled mod.`);
        return;
      }

      const seconds = (Date.now() - started) / 1000;
      for (const item of items) {
        const answer = outcome.probe.sources.find(
          (source) => comparablePath(source.sourcePackPath) === comparablePath(item.mod.path),
        );
        if (!answer) continue;
        this.probeAnswers.set(comparablePath(item.mod.path), {
          relevant: new Set(
            answer.consumers.filter((consumer) => consumer.relevant).map((consumer) => comparablePath(consumer.path)),
          ),
          seconds,
          batchSize: items.length,
        });
      }

      this.log(
        `Optimizer probe: ${items.length} mod(s) against ${loadOrder.length} enabled pack(s) in ${seconds.toFixed(1)} s ` +
          `(${outcome.probe.packsScanned ?? 0} scanned, ${outcome.probe.scanCacheHits ?? 0} from the scan cache)`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      for (const item of items) this.recordFor(item.mod.path).probeError = message;
      this.log(`Optimizer probe failed (${message}).`);
    }
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

    const context = await this.contextFor(mod);
    const { base, consumers, sourceLoadOrderIndex, dependencyPaths, exactKey } = context;
    const aliased = await this.deps.cache.resolveAlias(exactKey);
    if (aliased) {
      if ((await this.deps.cache.lookup(aliased)) || (await this.deps.cache.lookupFailure(aliased))) {
        this.recordFor(mod.path).keyKind = "narrow (alias hit)";
        return this.finishPlan(mod.path, aliased, {
          base,
          consumers,
          sourceLoadOrderIndex,
          dependencyPaths,
          relevantPaths: new Set(dependencyPaths),
        });
      }
    }

    // No entry for the exact set: the host says which of the other mods can matter.
    const record = this.recordFor(mod.path);
    let narrowKey = exactKey;
    let relevantPaths = new Set(consumers.map((consumer) => comparablePath(consumer.path)));
    record.keyKind = "exact (probe unavailable)";
    if (consumers.length === 0) {
      narrowKey = buildNarrowKey(base, []);
      relevantPaths = new Set();
      record.keyKind = "narrow (no other mods)";
    } else {
      if (!this.probeAnswers.has(comparablePath(mod.path))) await this.runProbe([{ mod, context }], signal);
      const answer = this.probeAnswers.get(comparablePath(mod.path));
      if (answer) {
        // The dependency packs always count: the host may read files from them, and the probe does not know.
        relevantPaths = new Set([...answer.relevant, ...dependencyPaths]);
        record.keyKind = "narrow (probed)";
        record.probeSeconds = answer.seconds;
        record.probeBatchSize = answer.batchSize;
        record.relevantConsumers = consumers
          .filter((consumer) => relevantPaths.has(comparablePath(consumer.path)))
          .map((consumer) => nodePath.basename(consumer.path));
        narrowKey = buildNarrowKey(
          base,
          consumers.filter((consumer) => relevantPaths.has(comparablePath(consumer.path))),
        );
      }
    }

    await this.deps.cache.writeAlias(exactKey, narrowKey).catch(() => undefined);
    return this.finishPlan(mod.path, narrowKey, {
      base,
      consumers,
      sourceLoadOrderIndex,
      dependencyPaths,
      relevantPaths,
    });
  }

  /** The host's answer for a mod is only valid for the load order it was asked about. */
  forgetProbeAnswers() {
    this.probeAnswers.clear();
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
    const plan: WorkshopStagingOptimizerPlan = { key, cached: !!(await this.deps.cache.lookup(key)) };
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
    const restored = async (): Promise<WorkshopStagingOptimizerResult | undefined> => {
      const hit = await cache.lookup(plan.key);
      if (!hit) return undefined;
      context.onProgress({ stage: "Restoring", fraction: 1, fromCache: true });
      return {
        status: "ready",
        packPath: hit.packPath,
        fromCache: true,
        reportPath: cache.reportPathFor(mod.name),
        warnings: [],
        summary: hit.meta.summary,
      };
    };

    const first = await restored();
    if (first) return first;

    // A background job may be making this very result: wait for it instead of starting over.
    if (this.deps.background) {
      const joined = await this.deps.background.joinOrPreempt(
        plan.key,
        (progress) => context.onProgress({ stage: progress.stage, fraction: progress.fraction }),
        context.signal,
      );
      if (context.signal?.aborted) throw makeAbortError();
      if (joined === "joined") {
        const afterJoin = await restored();
        if (afterJoin) {
          this.recordFor(mod.path).joinedBackground = true;
          return afterJoin;
        }
      }
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
      ...this.baseRequest(
        mod.path,
        details.consumers,
        details.consumers.filter((c) => c.beforeSource).length,
        details.dependencyPaths,
      ),
      outputPackPath: outputPath,
      reportPath,
      cacheDirectory: cache.hostCacheDirectory,
      options: buildHostOptions(this.deps.compressRigidModels),
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
      const tracker = new HostProgressTracker();
      try {
        outcome = await this.runHostProcess({
          executablePath: this.deps.hostExecutablePath,
          args: ["optimize", "--request", requestPath, ...this.parentArgs()],
          signal: combined.signal,
          lowPriority: this.deps.lowPriority,
          onStarted: this.deps.onHostStarted,
          onProgress: (line) =>
            context.onProgress({
              stage: line.stage,
              item: line.item ?? undefined,
              fraction: tracker.update(line.stage, line.current, line.total),
            }),
        });
      } catch (error) {
        outcome = { kind: "failed", exitCode: null, message: error instanceof Error ? error.message : String(error) };
      } finally {
        this.deps.onHostStarted?.(undefined);
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
        await cache.recordFailure(plan.key, message, { name: mod.name, path: mod.path }).catch(() => undefined);
        return { status: "failed", message, warnings: [] };
      }

      record.exitCode = 0;
      context.onProgress({ stage: "Saving", fraction: tracker.finish() });
      const warnings: string[] = [...(outcome.result.warnings ?? [])];

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
      const summary = outcome.result.summary;
      const packPath = await cache.commit(
        key,
        outputPath,
        {
          sourceName: mod.name,
          sourcePath: mod.path,
          profile: WORKSHOP_OPTIMIZER_PROFILE_ID,
          hostVersion: outcome.result.hostVersion,
          outputVersion: outcome.result.outputVersion,
          relevantConsumers: reportedRelevant.map((pack) => pack.path),
          summary,
        },
        hostReport,
      );
      record.seconds = (Date.now() - startedAt) / 1000;
      return {
        status: "ready",
        packPath,
        fromCache: false,
        reportPath: cache.reportPathFor(mod.name),
        warnings,
        summary,
      };
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
