import * as nodePath from "path";

/**
 * Which packs are being read right now, and a way to wait until one is free.
 *
 * Reads of the same pack are not allowed to overlap: they cost seconds and hundreds of megabytes,
 * and two of them racing to fill the same retained pack is how a caller ends up with rows that were
 * never read. Callers used to poll this state for a fixed two and a half seconds and then give up,
 * carrying on as if the pack had been read - which for a full parse of the game's database pack is
 * far too short a wait and a silent wrong answer at the end of it.
 *
 * Waiting here is exact rather than timed: a read hands its waiters back the moment it releases.
 * `timeoutMs` is only a backstop against a registration that leaked, and callers are expected to do
 * their read anyway when it fires - a wasteful second read beats no read at all.
 */
export interface PackReadRegistry {
  /** Registers a read of this pack. Call the returned release when it ends, including on failure. */
  begin(packPath: string): () => void;
  isReading(packPath: string): boolean;
  /** Resolves true once nothing is reading this pack, false if the backstop fired first. */
  waitUntilFree(packPath: string, timeoutMs?: number): Promise<boolean>;
  /** The packs being read, as the paths they were registered under. */
  reading(): string[];
}

/** Long enough that no real read hits it, short enough that a leak cannot wedge a pack forever. */
export const DEFAULT_PACK_READ_WAIT_MS = 5 * 60 * 1000;

interface PackReadEntry {
  packPath: string;
  readers: number;
  waiters: Set<() => void>;
}

export const createPackReadRegistry = (): PackReadRegistry => {
  // Keyed by resolved path: the same pack reached by differently written paths is the same read.
  const entriesByPath = new Map<string, PackReadEntry>();

  return {
    begin(packPath) {
      const key = nodePath.resolve(packPath);
      const entry = entriesByPath.get(key) ?? { packPath, readers: 0, waiters: new Set() };
      entry.readers++;
      entriesByPath.set(key, entry);

      let released = false;
      return () => {
        // A release called twice must not free a read someone else started in the meantime.
        if (released) return;
        released = true;
        entry.readers--;
        if (entry.readers > 0) return;
        if (entriesByPath.get(key) === entry) entriesByPath.delete(key);
        const waiters = [...entry.waiters];
        entry.waiters.clear();
        for (const waiter of waiters) waiter();
      };
    },

    isReading: (packPath) => (entriesByPath.get(nodePath.resolve(packPath))?.readers ?? 0) > 0,

    async waitUntilFree(packPath, timeoutMs = DEFAULT_PACK_READ_WAIT_MS) {
      const key = nodePath.resolve(packPath);
      const deadline = Date.now() + timeoutMs;

      // A loop, not a single wait: another read may start between this one being woken and resuming.
      for (;;) {
        const entry = entriesByPath.get(key);
        if (!entry || entry.readers === 0) return true;

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return false;

        const becameFree = await new Promise<boolean>((resolve) => {
          const waiter = () => {
            clearTimeout(backstop);
            resolve(true);
          };
          const backstop = setTimeout(() => {
            entry.waiters.delete(waiter);
            resolve(false);
          }, remainingMs);
          entry.waiters.add(waiter);
        });
        if (!becameFree) return false;
      }
    },

    reading: () => [...entriesByPath.values()].map((entry) => entry.packPath),
  };
};
