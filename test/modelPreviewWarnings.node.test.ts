import { describe, expect, it } from "vitest";

import { filterVisualsModelPreviewWarnings } from "../src/visuals/modelPreviewWarnings";

const stumpWarning = "No candidate could be resolved for slot 'stumps' in root.";
const unrelatedWarning = "A different model diagnostic should remain visible.";

describe("model preview warnings", () => {
  it("hides the known stump warning when modder features are disabled", () => {
    expect(filterVisualsModelPreviewWarnings([stumpWarning, unrelatedWarning], false)).toEqual([unrelatedWarning]);
  });

  it("keeps the stump warning visible when modder features are enabled", () => {
    expect(filterVisualsModelPreviewWarnings([stumpWarning, unrelatedWarning], true)).toEqual([
      stumpWarning,
      unrelatedWarning,
    ]);
  });
});
