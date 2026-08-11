export interface InFlightTableRequests {
  run(key: string, request: () => Promise<void>): Promise<void>;
  size(): number;
}

/**
 * Shares an exact table request without serialising unrelated tables from the same pack.
 * The conditional delete prevents an older completion from removing a newer request for the key.
 */
export const createInFlightTableRequests = (): InFlightTableRequests => {
  const requests = new Map<string, Promise<void>>();

  return {
    run(key, request) {
      const existing = requests.get(key);
      if (existing) return existing;

      const attempt = request();
      const shared = attempt.finally(() => {
        if (requests.get(key) === shared) requests.delete(key);
      });
      requests.set(key, shared);
      return shared;
    },
    size: () => requests.size,
  };
};
