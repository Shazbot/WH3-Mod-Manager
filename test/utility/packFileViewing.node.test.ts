import { describe, expect, it } from "vitest";

import {
  getPackedFileViewerKind,
  isOpenablePackedFilePath,
} from "../../src/utility/packFileViewing";

describe("pack file viewing", () => {
  it("treats extensionless embedded flows as text files", () => {
    expect(getPackedFileViewerKind("whmmflows\\pj_unitmultiplier_sem_hp")).toBe("text");
    expect(getPackedFileViewerKind("whmmflows/pj_unitmultiplier_sem_hp")).toBe("text");
    expect(isOpenablePackedFilePath("WHMMFLOWS\\PJ_UNITMULTIPLIER_SEM_HP")).toBe(true);
  });

  it("does not classify unrelated extensionless packed files as text", () => {
    expect(getPackedFileViewerKind("unknown\\binary_file")).toBeUndefined();
  });
});
