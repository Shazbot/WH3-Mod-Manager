import * as nodePath from "path";
import { describe, expect, it } from "vitest";

import { createPackReadRegistry } from "../src/utility/packReadRegistry";

const dbPack = "C:\\data\\db.pack";

describe("createPackReadRegistry", () => {
  it("returns straight away when nothing is reading the pack", async () => {
    const packReads = createPackReadRegistry();

    await expect(packReads.waitUntilFree(dbPack)).resolves.toBe(true);
  });

  it("waits for the read in flight rather than giving up on it", async () => {
    const packReads = createPackReadRegistry();
    const releaseRead = packReads.begin(dbPack);
    let freed = false;

    const waiting = packReads.waitUntilFree(dbPack).then((becameFree) => {
      freed = becameFree;
    });

    await Promise.resolve();
    expect(freed).toBe(false);
    expect(packReads.isReading(dbPack)).toBe(true);

    releaseRead();
    await waiting;
    expect(freed).toBe(true);
    expect(packReads.isReading(dbPack)).toBe(false);
  });

  // A pack reached by a differently written path is the same file, and reading it twice at once is
  // the thing being avoided. Built with the platform's own separator so the test means the same on
  // the Windows paths this actually runs on as it does where the suite runs.
  it("treats differently written paths to the same pack as one read", () => {
    const packReads = createPackReadRegistry();
    const packPath = ["data", "db.pack"].join(nodePath.sep);
    const sameByAnotherPath = ["data", "unusedtables", "..", "db.pack"].join(nodePath.sep);
    const releaseRead = packReads.begin(sameByAnotherPath);

    expect(packReads.isReading(packPath)).toBe(true);
    releaseRead();
    expect(packReads.isReading(packPath)).toBe(false);
  });

  it("stays held until the last of several reads releases", async () => {
    const packReads = createPackReadRegistry();
    const releaseFirst = packReads.begin(dbPack);
    const releaseSecond = packReads.begin(dbPack);

    releaseFirst();
    expect(packReads.isReading(dbPack)).toBe(true);
    releaseSecond();
    expect(packReads.isReading(dbPack)).toBe(false);
  });

  it("ignores a release called twice, so it cannot free someone else's read", () => {
    const packReads = createPackReadRegistry();
    const releaseFirst = packReads.begin(dbPack);
    releaseFirst();

    packReads.begin(dbPack);
    releaseFirst();

    expect(packReads.isReading(dbPack)).toBe(true);
  });

  // The backstop exists for a registration that leaked. Callers read anyway when it fires, so a
  // false answer has to be reported rather than the wait hanging on forever.
  it("gives up only on the backstop, and says so", async () => {
    const packReads = createPackReadRegistry();
    packReads.begin(dbPack);

    await expect(packReads.waitUntilFree(dbPack, 5)).resolves.toBe(false);
  });

  it("keeps waiting when another read starts before the waiter resumes", async () => {
    const packReads = createPackReadRegistry();
    const releaseFirst = packReads.begin(dbPack);
    let freed = false;

    const waiting = packReads.waitUntilFree(dbPack).then((becameFree) => {
      freed = becameFree;
    });

    // A second read starting as the first ends: the waiter is woken, finds the pack busy again and
    // goes back to waiting rather than returning to a caller that would read beside it.
    const releaseSecond = packReads.begin(dbPack);
    releaseFirst();
    await Promise.resolve();
    expect(freed).toBe(false);

    releaseSecond();
    await waiting;
    expect(freed).toBe(true);
  });

  it("lists the packs being read as the paths they were registered under", () => {
    const packReads = createPackReadRegistry();
    packReads.begin(dbPack);

    expect(packReads.reading()).toEqual([dbPack]);
  });
});
