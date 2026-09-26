export interface ClosableCacheResource {
  close(): void;
}

export type CacheCandidateResult<Reader> =
  { kind: "opened"; reader: Reader } | { kind: "missing" | "stale" | "invalid" } | { kind: "io-error"; error: unknown };

/**
 * Classifies cache-open outcomes without knowing about Electron or the filesystem. Keeping this seam
 * pure makes the failure policy testable while the store supplies the concrete source and reader.
 */
export const openCacheCandidate = <
  Source extends ClosableCacheResource,
  Reader extends ClosableCacheResource,
>(options: {
  openSource(): Source;
  openReader(source: Source): Reader | undefined;
  isCurrent(reader: Reader): boolean;
  isMissingError(error: unknown): boolean;
}): CacheCandidateResult<Reader> => {
  let source: Source;
  try {
    source = options.openSource();
  } catch (error) {
    return options.isMissingError(error) ? { kind: "missing" } : { kind: "io-error", error };
  }

  const reader = options.openReader(source);
  if (!reader) {
    try {
      source.close();
    } catch {
      // The candidate is invalid either way and there is no reader retaining the resource.
    }
    return { kind: "invalid" };
  }

  if (!options.isCurrent(reader)) {
    try {
      reader.close();
    } catch (error) {
      return { kind: "io-error", error };
    }
    return { kind: "stale" };
  }

  return { kind: "opened", reader };
};
