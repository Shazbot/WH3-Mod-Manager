import { beforeEach, describe, expect, it, vi } from "vitest";

const nodeExecutorMocks = vi.hoisted(() => ({
  executeNodeAction: vi.fn(),
  resetCounterTracking: vi.fn(),
}));

vi.mock("../../src/nodeExecutor", () => nodeExecutorMocks);

import { executeNodeGraph } from "../../src/nodeGraphExecutor";

const createNode = (id: string, isDisabled = false) =>
  ({
    id,
    type: "packedfiles",
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type: "packedfiles",
      isDisabled,
    },
  }) as any;

describe("node graph execution", () => {
  beforeEach(() => {
    nodeExecutorMocks.executeNodeAction.mockReset();
    nodeExecutorMocks.resetCounterTracking.mockReset();
    nodeExecutorMocks.executeNodeAction.mockResolvedValue({ success: true, data: {} });
  });

  it("skips a disabled node and every downstream connection from it", async () => {
    const result = await executeNodeGraph({
      nodes: [
        createNode("disabled-source", true),
        createNode("child"),
        createNode("grandchild"),
        createNode("independent"),
      ],
      connections: [
        {
          id: "disabled-to-child",
          sourceId: "disabled-source",
          targetId: "child",
        },
        {
          id: "child-to-grandchild",
          sourceId: "child",
          targetId: "grandchild",
        },
      ],
    });

    expect(nodeExecutorMocks.executeNodeAction).toHaveBeenCalledTimes(1);
    expect(nodeExecutorMocks.executeNodeAction).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "independent" }),
    );
    expect(result.success).toBe(true);
    expect(result.totalExecuted).toBe(1);
    expect(result.executionResults.has("disabled-source")).toBe(false);
    expect(result.executionResults.has("child")).toBe(false);
    expect(result.executionResults.has("grandchild")).toBe(false);
  });

  it("treats a flow whose only branch is disabled as a successful no-op", async () => {
    const result = await executeNodeGraph({
      nodes: [createNode("disabled-source", true), createNode("child")],
      connections: [
        {
          id: "disabled-to-child",
          sourceId: "disabled-source",
          targetId: "child",
        },
      ],
    });

    expect(nodeExecutorMocks.executeNodeAction).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.totalExecuted).toBe(0);
    expect(result.failureCount).toBe(0);
  });

  it("passes every ChangedColumnSelection input to a shared Save Changes node", async () => {
    const createChangedInput = (tableName: string) => ({
      type: "ChangedColumnSelection",
      adjustedInputData: { columns: [{ tableName }] },
      originalData: { columns: [] },
      appliedFormula: "test",
    });
    const inputsByNodeId = {
      "changed-main-units": createChangedInput("main_units_tables"),
      "changed-land-units": createChangedInput("land_units_tables"),
      "changed-characters": createChangedInput("campaign_character_art_sets_tables"),
    };
    nodeExecutorMocks.executeNodeAction.mockImplementation(async ({ nodeId }: { nodeId: string }) => ({
      success: true,
      data: inputsByNodeId[nodeId as keyof typeof inputsByNodeId] ?? { type: "SaveResult" },
    }));

    const sourceNodes = Object.keys(inputsByNodeId).map((id) => createNode(id));
    const saveNode = {
      ...createNode("save"),
      type: "savechanges",
      data: { ...createNode("save").data, type: "savechanges" },
    };
    const result = await executeNodeGraph({
      nodes: [...sourceNodes, saveNode],
      connections: sourceNodes.map((sourceNode) => ({
        id: `${sourceNode.id}-save`,
        sourceId: sourceNode.id,
        targetId: saveNode.id,
      })),
    });

    expect(result.success).toBe(true);
    expect(nodeExecutorMocks.executeNodeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "save",
        inputData: Object.values(inputsByNodeId),
      }),
    );
  });
});
