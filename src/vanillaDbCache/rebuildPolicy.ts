/**
 * How many times to retry a cache operation that keeps failing.
 *
 * Disk corruption and transient I/O failures often heal with one retry. Persistent write failures and
 * a builder and reader that disagree do not: the same seconds of work repeat on every request forever.
 * This bounds all recoverable failures together, per cache identity, per session.
 *
 * Kept apart from the store so the counting can be tested without Electron. The store holds one of
 * these and consults it before spending anything on a build.
 */

/** Retries allowed after a recoverable cache failure. One covers transient I/O and disk damage. */
export const MAX_RETRIES_AFTER_FAILURE = 1;

export interface CacheRebuildPolicy {
  /** False once this identity has been given up on for the session. */
  mayBuild(identityKey: string): boolean;
  /** Bytes straight from the builder were rejected before touching disk. Repeating cannot help. */
  recordUnopenable(identityKey: string): void;
  /** A recoverable operation failed. Says whether another attempt is still worth making. */
  recordRecoverableFailure(identityKey: string): { abandoned: boolean; failureCount: number };
  /** Everything this identity has been recorded as, for logging. */
  isAbandoned(identityKey: string): boolean;
}

export const createCacheRebuildPolicy = (
  maxRetries = MAX_RETRIES_AFTER_FAILURE,
): CacheRebuildPolicy => {
  const abandoned = new Set<string>();
  const failureCounts = new Map<string, number>();

  return {
    mayBuild: (identityKey) => !abandoned.has(identityKey),

    recordUnopenable(identityKey) {
      // The build succeeded and the reader rejected its own output, so the two disagree about the
      // format. Another identical build would be rejected identically.
      abandoned.add(identityKey);
    },

    recordRecoverableFailure(identityKey) {
      const failureCount = (failureCounts.get(identityKey) ?? 0) + 1;
      failureCounts.set(identityKey, failureCount);
      if (failureCount > maxRetries) abandoned.add(identityKey);
      return { abandoned: abandoned.has(identityKey), failureCount };
    },

    isAbandoned: (identityKey) => abandoned.has(identityKey),
  };
};

/**
 * What makes two caches the same one to retry.
 *
 * The pack's path, size and mtime and the schema hash are all in here, so a moved installation, a
 * patched game or an updated schema gets a fresh start rather than inheriting a giving-up decision.
 */
export const buildCacheIdentityKey = (identity: {
  game: string;
  dbPackPath: string;
  dbPackSize: number;
  dbPackMtimeMs: number;
  schemaHash: string;
}): string =>
  JSON.stringify([
    identity.game,
    identity.dbPackPath,
    identity.dbPackSize,
    identity.dbPackMtimeMs,
    identity.schemaHash,
  ]);
