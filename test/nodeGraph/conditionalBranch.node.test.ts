import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";
import {
  deserializeNodeGraph,
  prepareGraphForExecution,
  serializeNodeGraphState,
} from "../../src/nodeGraph/graphSerialization";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const tableSelection = {
  type: "TableSelection" as const,
  tables: [],
  sourceFiles: [],
  tableCount: 0,
};

const runBranch = (config: Record<string, unknown>) =>
  executeNodeAction({
    nodeId: "branch_1",
    nodeType: "conditionalbranch",
    textValue: "",
    config,
    inputData: tableSelection,
  });

const createGateNode = (selectedFlowOptionId: string) =>
  ({
    id: "node_0",
    type: "conditionalbranch",
    position: { x: 0, y: 0 },
    data: {
      label: "Conditional Branch",
      type: "conditionalbranch",
      inputType: "TableSelection",
      outputType: "TableSelection",
      selectedFlowOptionId,
    },
  }) as any;

const checkboxOption = (id: string, value: boolean) => ({
  id,
  name: id,
  type: "checkbox" as const,
  value,
});

describe("conditional branch node", () => {
  it("continues through the true handle when the option is checked", async () => {
    const result = await runBranch({ selectedFlowOptionId: "useTsv", flowOptionChecked: true });

    expect(result.success).toBe(true);
    expect(result.activeOutputHandles).toEqual(["output-true"]);
    // The gate is a passthrough: the branch that runs gets exactly what came in.
    expect(result.data).toBe(tableSelection);
  });

  it("continues through the false handle when the option is unchecked", async () => {
    const result = await runBranch({ selectedFlowOptionId: "useTsv", flowOptionChecked: false });

    expect(result.success).toBe(true);
    expect(result.activeOutputHandles).toEqual(["output-false"]);
  });

  it("treats an unresolved option as unchecked rather than running both branches", async () => {
    const result = await runBranch({ selectedFlowOptionId: "useTsv" });

    expect(result.activeOutputHandles).toEqual(["output-false"]);
  });

  it("fails when no option has been picked", async () => {
    const result = await runBranch({ selectedFlowOptionId: "" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No flow option selected");
  });

  it("rejects input that is not a table selection", async () => {
    const result = await executeNodeAction({
      nodeId: "branch_1",
      nodeType: "conditionalbranch",
      textValue: "",
      config: { selectedFlowOptionId: "useTsv", flowOptionChecked: true },
      inputData: { type: "Text", text: "nope" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Expected TableSelection");
  });
});

describe("resolving the checkbox option for execution", () => {
  it("resolves a checked option to true", () => {
    const result = prepareGraphForExecution({
      nodes: [createGateNode("useTsv")],
      edges: [],
      flowOptions: [checkboxOption("useTsv", true)],
    });

    expect((result.nodes[0].data as any).flowOptionChecked).toBe(true);
  });

  it("resolves an unchecked option to false", () => {
    const result = prepareGraphForExecution({
      nodes: [createGateNode("useTsv")],
      edges: [],
      flowOptions: [checkboxOption("useTsv", false)],
    });

    expect((result.nodes[0].data as any).flowOptionChecked).toBe(false);
  });

  it("falls back to false when the option was deleted from the flow", () => {
    const node = createGateNode("deletedOption");
    // A boolean left over from when the option existed must not survive.
    node.data.flowOptionChecked = true;

    const result = prepareGraphForExecution({
      nodes: [node],
      edges: [],
      flowOptions: [checkboxOption("somethingElse", true)],
    });

    expect((result.nodes[0].data as any).flowOptionChecked).toBe(false);
  });

  it("ignores an option of the wrong type", () => {
    const result = prepareGraphForExecution({
      nodes: [createGateNode("someText")],
      edges: [],
      flowOptions: [{ id: "someText", name: "Some text", type: "textbox", value: "true" }],
    });

    expect((result.nodes[0].data as any).flowOptionChecked).toBe(false);
  });

  it("keeps the chosen option through save and load", () => {
    const serialized = serializeNodeGraphState({
      nodes: [createGateNode("useTsv")],
      edges: [],
      flowOptions: [checkboxOption("useTsv", true)],
      isGraphEnabled: true,
      graphStartsEnabled: true,
    });
    const deserialized = deserializeNodeGraph(JSON.stringify(serialized));

    expect(serialized.nodes[0].data.selectedFlowOptionId).toBe("useTsv");
    expect(deserialized.nodes[0].data.selectedFlowOptionId).toBe("useTsv");
  });
});
