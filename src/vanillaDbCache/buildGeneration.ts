/**
 * Invalidates asynchronous cache work without trying to cancel synchronous pack parsing or encoding.
 * A task captures a token before it starts and checks it before publishing a file or reader.
 */
export interface CacheBuildGeneration {
  capture(): number;
  isCurrent(token: number): boolean;
  invalidate(): void;
}

export const createCacheBuildGeneration = (): CacheBuildGeneration => {
  let generation = 0;
  return {
    capture: () => generation,
    isCurrent: (token) => token === generation,
    invalidate: () => {
      generation++;
    },
  };
};
