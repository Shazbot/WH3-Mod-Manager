import { describe, expect, it } from "vitest";

import { substituteDeepCloneOptionValues } from "../../src/nodeGraph/deepCloneOptions";
import { prepareGraphForExecution } from "../../src/nodeGraph/graphSerialization";

const createDeepCloneNodeData = () => ({
  label: "Deep Clone",
  type: "deepclone",
  inputType: "TableSelection",
  outputType: "TableSelection",
  nameTemplate: "{original}{variant}",
  columnOverrides: [
    { table: "main_units_tables", column: "cost", value: "{{costMultiplier}}*x" },
    { table: "main_units_tables", column: "caste", value: "melee_infantry" },
  ],
  variantAxes: [
    {
      id: "tier",
      values: [
        {
          id: "t1",
          suffix: "_t1",
          overrides: [{ table: "land_units_tables", column: "shield", value: "{{shieldValue}}" }],
        },
      ],
    },
  ],
});

describe("substituteDeepCloneOptionValues", () => {
  it("replaces placeholders in both global and per-variant override values", () => {
    const nodeData = createDeepCloneNodeData() as unknown as Record<string, unknown>;

    const modified = substituteDeepCloneOptionValues(nodeData, (value) =>
      value.replace("{{costMultiplier}}", "1.5").replace("{{shieldValue}}", "1"),
    );

    expect(modified).toBe(true);
    expect((nodeData.columnOverrides as any[])[0].value).toBe("1.5*x");
    // Untouched values are left as they are.
    expect((nodeData.columnOverrides as any[])[1].value).toBe("melee_infantry");
    expect((nodeData.variantAxes as any[])[0].values[0].overrides[0].value).toBe("1");
  });

  it("reports no change when nothing matched", () => {
    const nodeData = createDeepCloneNodeData() as unknown as Record<string, unknown>;

    expect(substituteDeepCloneOptionValues(nodeData, (value) => value)).toBe(false);
  });

  it("leaves a node without overrides untouched", () => {
    const nodeData = { label: "Deep Clone", type: "deepclone" } as Record<string, unknown>;

    expect(substituteDeepCloneOptionValues(nodeData, () => "replaced")).toBe(false);
  });
});

describe("deep clone flow options through prepareGraphForExecution", () => {
  it("substitutes option values nested inside the clone node's overrides", () => {
    const nodes = [
      {
        id: "node_0",
        type: "deepclone",
        position: { x: 0, y: 0 },
        data: createDeepCloneNodeData(),
      },
    ] as any[];

    const result = prepareGraphForExecution({
      nodes,
      edges: [],
      flowOptions: [
        { id: "costMultiplier", name: "Cost multiplier", type: "range", value: 2, min: 1, max: 5, step: 1 },
        { id: "shieldValue", name: "Shield", type: "textbox", value: "1" },
      ],
    });

    const preparedData = result.nodes[0].data as any;
    expect(preparedData.columnOverrides[0].value).toBe("2*x");
    expect(preparedData.variantAxes[0].values[0].overrides[0].value).toBe("1");
  });
});
