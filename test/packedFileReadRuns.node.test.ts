import { describe, expect, it } from "vitest";

import {
  READ_RUN_MAX_GAP_BYTES,
  groupPackedFilesIntoReadRuns,
} from "../src/utility/packedFileReadRuns";
import type { PackedFile } from "../src/packFileTypes";

const packedFile = (name: string, start_pos: number, file_size: number): PackedFile =>
  ({ name, start_pos, file_size }) as PackedFile;

/** Bytes a set of runs pulls off disk, which is the whole point of grouping them. */
const bytesRead = (runs: ReturnType<typeof groupPackedFilesIntoReadRuns>) =>
  runs.reduce((total, run) => total + (run.endPos - run.startPos), 0);

describe("packed file read runs", () => {
  it("reads one file as exactly that file", () => {
    const runs = groupPackedFilesIntoReadRuns([packedFile("db\\units\\data__", 5_000_000, 1000)]);

    expect(runs).toHaveLength(1);
    expect(runs[0].startPos).toBe(5_000_000);
    expect(runs[0].endPos).toBe(5_001_000);
  });

  it("merges files that sit next to each other into one read", () => {
    const runs = groupPackedFilesIntoReadRuns([
      packedFile("a", 0, 100),
      packedFile("b", 100, 100),
      packedFile("c", 200, 100),
    ]);

    expect(runs).toHaveLength(1);
    expect(bytesRead(runs)).toBe(300);
  });

  it("splits on a gap too large to be worth reading through", () => {
    // The case that mattered: two tables at opposite ends of db.pack. One span would have read the
    // whole region between them.
    const runs = groupPackedFilesIntoReadRuns([
      packedFile("early", 0, 1000),
      packedFile("late", 400_000_000, 1000),
    ]);

    expect(runs).toHaveLength(2);
    expect(bytesRead(runs)).toBe(2000);
  });

  it("reads through a small gap rather than paying for a second read", () => {
    const runs = groupPackedFilesIntoReadRuns([
      packedFile("a", 0, 1000),
      packedFile("b", 1000 + READ_RUN_MAX_GAP_BYTES, 1000),
    ]);

    expect(runs).toHaveLength(1);
  });

  it("splits one byte past the gap limit", () => {
    const runs = groupPackedFilesIntoReadRuns([
      packedFile("a", 0, 1000),
      packedFile("b", 1000 + READ_RUN_MAX_GAP_BYTES + 1, 1000),
    ]);

    expect(runs).toHaveLength(2);
  });

  it("orders by position, since packed files arrive ordered by name", () => {
    // Deliberately given back to front: readPack sorts pack_files by name, so position order is
    // whatever the pack happens to use. Grouping without sorting would start the run at 100 and then
    // fold in a file that begins before it.
    const runs = groupPackedFilesIntoReadRuns([
      packedFile("alpha", 100, 100),
      packedFile("zebra", 0, 100),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0].startPos).toBe(0);
    expect(runs[0].endPos).toBe(200);
  });

  it("keeps a run's reach past a file nested inside an earlier one", () => {
    // Takes three files to show: after the tiny nested one, measuring the gap against the previous
    // file rather than the run's furthest point makes the third look far away, and it gets a second
    // read over bytes the first already covered.
    const runs = groupPackedFilesIntoReadRuns([
      packedFile("big", 0, 10_000_000),
      packedFile("nested", 5, 10),
      packedFile("tail", 9_000_000, 100),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0].endPos).toBe(10_000_000);
    expect(bytesRead(runs)).toBe(10_000_000);
  });

  it("handles nothing to read", () => {
    expect(groupPackedFilesIntoReadRuns([])).toEqual([]);
  });

  it("does not reorder or drop the files it was given", () => {
    const files = [packedFile("a", 300, 10), packedFile("b", 0, 10), packedFile("c", 900_000_000, 10)];
    const runs = groupPackedFilesIntoReadRuns(files);

    expect(runs.flatMap((run) => run.packedFiles).map((file) => file.name).toSorted()).toEqual([
      "a",
      "b",
      "c",
    ]);
    // The input array itself is left alone - readPack still uses it afterwards.
    expect(files.map((file) => file.name)).toEqual(["a", "b", "c"]);
  });

  it("gives every file an offset inside its own run", () => {
    // readDBPackedFiles slices with start_pos - run.startPos, so a file landing outside its run's
    // buffer would read another table's bytes as its own.
    const runs = groupPackedFilesIntoReadRuns([
      packedFile("far", 50_000_000, 100),
      packedFile("b", 100, 100),
      packedFile("a", 0, 100),
      packedFile("inside", 20, 10),
    ]);

    for (const run of runs) {
      for (const file of run.packedFiles) {
        expect(file.start_pos).toBeGreaterThanOrEqual(run.startPos);
        expect(file.start_pos + file.file_size).toBeLessThanOrEqual(run.endPos);
      }
    }
  });
});
