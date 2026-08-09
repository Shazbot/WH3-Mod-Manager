import { describe, expect, it } from "vitest";

import { EMPTY_MEMORY_PACK_REASON, planSaveAs, type SaveAsSituation } from "../src/utility/saveAsPlan";

const situation = (overrides: Partial<SaveAsSituation> = {}): SaveAsSituation => ({
  isMemoryPack: false,
  unsavedFileCount: 1,
  targetExists: false,
  targetIsSourcePack: false,
  overwriteExisting: false,
  ...overrides,
});

describe("save as planning", () => {
  it("writes the pack when there are changes and the path is free", () => {
    expect(planSaveAs(situation())).toEqual({ action: "writePack" });
  });

  it("asks before replacing an existing pack", () => {
    expect(planSaveAs(situation({ targetExists: true }))).toEqual({ action: "confirmOverwrite" });
  });

  it("asks before anything is written, whether or not there are changes", () => {
    // The destructive failure would be copying or writing first and asking afterwards.
    expect(planSaveAs(situation({ targetExists: true, unsavedFileCount: 0 }))).toEqual({
      action: "confirmOverwrite",
    });
  });

  it("writes over an existing pack once that has been agreed to", () => {
    expect(planSaveAs(situation({ targetExists: true, overwriteExisting: true }))).toEqual({
      action: "writePack",
    });
  });

  it("copies the pack when there is nothing unsaved", () => {
    // writePack returns early on an empty file list, so writing would leave no file at all.
    expect(planSaveAs(situation({ unsavedFileCount: 0 }))).toEqual({ action: "copyPack" });
  });

  it("copies over an existing pack once that has been agreed to", () => {
    expect(
      planSaveAs(situation({ unsavedFileCount: 0, targetExists: true, overwriteExisting: true })),
    ).toEqual({ action: "copyPack" });
  });

  it("does nothing when saving an unchanged pack over itself", () => {
    expect(
      planSaveAs(
        situation({
          unsavedFileCount: 0,
          targetExists: true,
          targetIsSourcePack: true,
          overwriteExisting: true,
        }),
      ),
    ).toEqual({ action: "leaveAsIs" });
  });

  it("still writes when saving a changed pack over itself", () => {
    expect(
      planSaveAs(situation({ targetExists: true, targetIsSourcePack: true, overwriteExisting: true })),
    ).toEqual({ action: "writePack" });
  });

  it("rejects an empty memory pack, which has no file to copy and nothing to write", () => {
    expect(planSaveAs(situation({ isMemoryPack: true, unsavedFileCount: 0 }))).toEqual({
      action: "reject",
      reason: EMPTY_MEMORY_PACK_REASON,
    });
  });

  it("writes a memory pack that holds something", () => {
    expect(planSaveAs(situation({ isMemoryPack: true }))).toEqual({ action: "writePack" });
  });
});
