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

  describe("conditional branch gating", () => {
    /** true-branch -> trueSave, false-branch -> falseChild -> falseSave, plus a shared tail. */
    const buildBranchGraph = () => {
      const gate = {
        ...createNode("gate"),
        type: "conditionalbranch",
        data: { ...createNode("gate").data, type: "conditionalbranch" },
      };
      return {
        nodes: [
          gate,
          createNode("trueSave"),
          createNode("falseChild"),
          createNode("falseSave"),
        ],
        connections: [
          { id: "c1", sourceId: "gate", targetId: "trueSave", sourceHandle: "output-true" },
          { id: "c2", sourceId: "gate", targetId: "falseChild", sourceHandle: "output-false" },
          { id: "c3", sourceId: "falseChild", targetId: "falseSave" },
        ],
      };
    };

    const runWithActiveHandle = async (activeHandle: string) => {
      nodeExecutorMocks.executeNodeAction.mockImplementation(async ({ nodeId }: { nodeId: string }) =>
        nodeId === "gate"
          ? { success: true, data: { type: "TableSelection" }, activeOutputHandles: [activeHandle] }
          : { success: true, data: {} },
      );
      const result = await executeNodeGraph(buildBranchGraph());
      const ranNodeIds = nodeExecutorMocks.executeNodeAction.mock.calls.map((call) => call[0].nodeId);
      return { result, ranNodeIds };
    };

    it("runs only the true branch when the option is checked", async () => {
      const { result, ranNodeIds } = await runWithActiveHandle("output-true");

      expect(ranNodeIds).toContain("trueSave");
      expect(ranNodeIds).not.toContain("falseChild");
      // The skip has to be transitive, or a save two nodes down the dead branch still writes a pack.
      expect(ranNodeIds).not.toContain("falseSave");
      expect(result.success).toBe(true);
    });

    it("runs only the false branch when the option is unchecked", async () => {
      const { ranNodeIds } = await runWithActiveHandle("output-false");

      expect(ranNodeIds).toContain("falseChild");
      expect(ranNodeIds).toContain("falseSave");
      expect(ranNodeIds).not.toContain("trueSave");
    });

    it("reports success even though half the graph never ran", async () => {
      const { result } = await runWithActiveHandle("output-true");

      // A skipped branch is the intended outcome, not a failure.
      expect(result.failureCount).toBe(0);
      expect(result.success).toBe(true);
    });

    it("passes the gate's input straight through to the branch that runs", async () => {
      const tableSelection = { type: "TableSelection", tables: [], sourceFiles: [], tableCount: 0 };
      nodeExecutorMocks.executeNodeAction.mockImplementation(async ({ nodeId }: { nodeId: string }) =>
        nodeId === "gate"
          ? { success: true, data: tableSelection, activeOutputHandles: ["output-true"] }
          : { success: true, data: {} },
      );

      await executeNodeGraph(buildBranchGraph());

      expect(nodeExecutorMocks.executeNodeAction).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: "trueSave", inputData: tableSelection }),
      );
    });

    it("follows every connection when a node reports no active handles", async () => {
      nodeExecutorMocks.executeNodeAction.mockResolvedValue({ success: true, data: {} });

      const result = await executeNodeGraph(buildBranchGraph());
      const ranNodeIds = nodeExecutorMocks.executeNodeAction.mock.calls.map((call) => call[0].nodeId);

      // Existing nodes set no activeOutputHandles and must be unaffected by the gating.
      expect(ranNodeIds).toEqual(expect.arrayContaining(["trueSave", "falseChild", "falseSave"]));
      expect(result.success).toBe(true);
    });
  });
});
