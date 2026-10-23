import { createHash } from "node:crypto";

/**
 * Cache keys for optimized Workshop packs.
 *
 * The exact key covers every enabled mod. The narrow key covers only the consumers the host found
 * relevant (they overlap the mod, reference it, name its VMDs in DB tables, have tables it could
 * not decode, or replace vanilla files it reaches). A mod that does none of those cannot change
 * what the optimizer keeps, freezes or derives, so enabling, disabling or updating it must not
 * invalidate the result.
 */

export interface OptimizerKeyBase {
  /** The optimizer option set and its profile id. */
  profile: string;
  options: Record<string, boolean>;
  source: { name: string; size: number; mtimeMs: number };
  /**
   * The optimizer's OUTPUT version (`PackOptimizerVersions.OutputVersion`, from `WH3AssetHost --version`).
   * It changes only when the output for the same inputs changes, so an app or host update that leaves the
   * output alone keeps every cached result.
   */
  outputVersion: number;
  /** Version of the host's probe/scan rules; only the exact-to-narrow alias depends on it. */
  scanVersion: number;
  /** Digest of the installed game's packs. */
  gameIdentity: string;
  /** Digest of the DB table layouts the optimizer reads. */
  schemaDigest: string;
}

export interface KeyConsumer {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface KeyedConsumer extends KeyConsumer {
  /** Loads before the optimized mod. */
  beforeSource: boolean;
}

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

const comparablePath = (path: string) => path.replace(/\//g, "\\").toLowerCase();

const baseParts = (base: OptimizerKeyBase) => ({
  profile: base.profile,
  options: Object.fromEntries(Object.entries(base.options).sort(([first], [second]) => first.localeCompare(second))),
  source: { name: base.source.name.toLowerCase(), size: base.source.size, mtimeMs: Math.round(base.source.mtimeMs) },
  output: base.outputVersion,
  game: base.gameIdentity,
  schema: base.schemaDigest,
});

/** Every enabled mod in load order, with its position relative to the optimized mod. */
export const buildExactKey = (base: OptimizerKeyBase, consumers: readonly KeyedConsumer[]): string =>
  sha({
    kind: "exact",
    ...baseParts(base),
    scan: base.scanVersion,
    consumers: consumers.map((consumer) => [
      comparablePath(consumer.path),
      consumer.size,
      Math.round(consumer.mtimeMs),
      consumer.beforeSource,
    ]),
  });

/**
 * Only the relevant consumers, in load order, with whether each loads before the mod. The order
 * among them and the side of the mod are what the result depends on, not the absolute index.
 */
export const buildNarrowKey = (base: OptimizerKeyBase, relevant: readonly KeyedConsumer[]): string =>
  sha({
    kind: "narrow",
    ...baseParts(base),
    consumers: relevant.map((consumer) => [
      comparablePath(consumer.path),
      consumer.size,
      Math.round(consumer.mtimeMs),
      consumer.beforeSource,
    ]),
  });
