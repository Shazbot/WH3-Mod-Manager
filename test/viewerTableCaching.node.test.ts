import { describe, expect, it, vi } from "vitest";

import { createInFlightTableRequests } from "../src/components/viewer/inFlightTableRequests";
import { clonePackIndexForTable } from "../src/components/viewer/viewerPackIndex";
import { Pack, PackedFile } from "../src/packFileTypes";

describe("viewer table request deduplication", () => {
  it("shares an exact request and allows another table to run concurrently", async () => {
    const requests = createInFlightTableRequests();
    let finishFirst!: () => void;
    const firstTask = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const otherTask = vi.fn(async () => undefined);

    const first = requests.run("pack|table-a", firstTask);
    const duplicate = requests.run("pack|table-a", firstTask);
    const other = requests.run("pack|table-b", otherTask);

    expect(duplicate).toBe(first);
    expect(firstTask).toHaveBeenCalledOnce();
    await other;
    expect(otherTask).toHaveBeenCalledOnce();
    expect(requests.size()).toBe(1);

    finishFirst();
    await first;
    expect(requests.size()).toBe(0);
  });

  it("allows a failed request to be retried", async () => {
    const requests = createInFlightTableRequests();
    await expect(requests.run("pack|table", async () => Promise.reject(new Error("read failed")))).rejects.toThrow(
      "read failed",
    );

    const retry = vi.fn(async () => undefined);
    await requests.run("pack|table", retry);
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("viewer pack-index reuse", () => {
  it("clones only the table descriptor that cache filling will mutate", () => {
    const target = {
      name: "db\\units_tables\\data__",
      schemaFields: [{ type: "I32", fields: [] }],
      tableSchema: { version: 1, fields: [] },
    } as PackedFile;
    const untouched = { name: "script\\campaign\\mod.lua" } as PackedFile;
    const indexedPack = {
      name: "db.pack",
      path: "K:\\game\\data\\db.pack",
      packedFiles: [target, untouched],
      readTables: [],
    } as Pack;

    const cloned = clonePackIndexForTable(indexedPack, target.name);

    expect(cloned).toBeDefined();
    expect(cloned?.pack).not.toBe(indexedPack);
    expect(cloned?.packedFile).not.toBe(target);
    expect(cloned?.packedFile.schemaFields).toEqual([]);
    expect(cloned?.packedFile.tableSchema).toBeUndefined();
    expect(cloned?.pack.packedFiles[1]).toBe(untouched);
    expect(cloned?.pack.readTables).toEqual([target.name]);
    expect(target.schemaFields).toHaveLength(1);
  });

  it("reports a table absent from the retained index", () => {
    const indexedPack = { packedFiles: [] } as unknown as Pack;
    expect(clonePackIndexForTable(indexedPack, "db\\missing_tables\\data__")).toBeUndefined();
  });
});
