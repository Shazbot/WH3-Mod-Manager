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

  it("passes an empty TableSelection to Save Changes as a successful no-op input", async () => {
    const source = createNode("edit");
    const saveNode = {
      ...createNode("save"),
      type: "savechanges",
      data: { ...createNode("save").data, type: "savechanges" },
    };
    const emptySelection = {
      type: "TableSelection",
      tables: [],
      sourceFiles: [{ path: "already-edited.pack" }],
      tableCount: 0,
    };
    nodeExecutorMocks.executeNodeAction.mockImplementation(async ({ nodeId }: { nodeId: string }) => ({
      success: true,
      data: nodeId === "edit" ? emptySelection : { type: "SaveResult", savedTo: "" },
    }));

    const result = await executeNodeGraph({
      nodes: [source, saveNode],
      connections: [{ id: "edit-to-save", sourceId: "edit", targetId: "save" }],
    });

    expect(result.success).toBe(true);
    expect(nodeExecutorMocks.executeNodeAction).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "save", inputData: emptySelection }),
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
        nodes: [gate, createNode("trueSave"), createNode("falseChild"), createNode("falseSave")],
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

    /**
     * The reported graph: the true branch goes through a filter into the dump, the false branch
     * goes straight into the same dump. The dump is a join of both branches.
     */
    const buildJoinGraph = () => {
      const gate = {
        ...createNode("gate"),
        type: "conditionalbranch",
        data: { ...createNode("gate").data, type: "conditionalbranch" },
      };
      const dump = {
        ...createNode("dump"),
        type: "dumptotsv",
        data: { ...createNode("dump").data, type: "dumptotsv" },
      };
      return {
        nodes: [gate, createNode("filter"), dump],
        connections: [
          { id: "gate-filter", sourceId: "gate", targetId: "filter", sourceHandle: "output-true" },
          { id: "gate-dump", sourceId: "gate", targetId: "dump", sourceHandle: "output-false" },
          { id: "filter-dump", sourceId: "filter", targetId: "dump", sourceHandle: "match" },
        ],
      };
    };

    const runJoinWithActiveHandle = async (activeHandle: string) => {
      nodeExecutorMocks.executeNodeAction.mockImplementation(async ({ nodeId }: { nodeId: string }) =>
        nodeId === "gate"
          ? { success: true, data: { type: "TableSelection" }, activeOutputHandles: [activeHandle] }
          : { success: true, data: { type: "TableSelection" } },
      );
      const result = await executeNodeGraph(buildJoinGraph());
      const ranNodeIds = nodeExecutorMocks.executeNodeAction.mock.calls.map((call) => call[0].nodeId);
      return { result, ranNodeIds };
    };

    it("still runs a node joined to both branches when the false branch is taken", async () => {
      const { ranNodeIds } = await runJoinWithActiveHandle("output-false");

      // The filter sits on the dead branch, but it must not block the dump forever.
      expect(ranNodeIds).not.toContain("filter");
      expect(ranNodeIds).toContain("dump");
    });

    it("runs the join through the filter when the true branch is taken", async () => {
      const { ranNodeIds } = await runJoinWithActiveHandle("output-true");

      expect(ranNodeIds).toContain("filter");
      expect(ranNodeIds).toContain("dump");
    });

    it("gives the join only the live branch's data, not a null for the pruned edge", async () => {
      const branchData = { type: "TableSelection", tables: [], sourceFiles: [], tableCount: 0 };
      nodeExecutorMocks.executeNodeAction.mockImplementation(async ({ nodeId }: { nodeId: string }) =>
        nodeId === "gate"
          ? { success: true, data: branchData, activeOutputHandles: ["output-false"] }
          : { success: true, data: branchData },
      );

      await executeNodeGraph(buildJoinGraph());

      // Two incoming edges but one is dead, so the dump must not take the merge-many path.
      expect(nodeExecutorMocks.executeNodeAction).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: "dump", inputData: branchData }),
      );
    });

    it("counts the join in the run totals", async () => {
      const { result } = await runJoinWithActiveHandle("output-false");

      // gate + dump; the filter is pruned rather than failed.
      expect(result.totalExecuted).toBe(2);
      expect(result.success).toBe(true);
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
