import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";
import { serializeNodeConfigForExecution } from "../../src/nodeGraphExecutor";
import { prepareFlow, prepareNodeConfig } from "../../src/packFileSerializer";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const inputData: PackFilesNodeData = {
  type: "PackFiles",
  files: [
    { name: "first.pack", path: "K:\\mods\\first.pack", loaded: true },
    { name: "Second.pack", path: "K:\\mods\\Second.pack", loaded: true },
    { name: "missing.pack", path: "K:\\mods\\missing.pack", loaded: false, error: "missing" },
  ],
  count: 3,
  loadedCount: 2,
};

const removeNode = (selectedPack = "Second.pack", useCurrentPack = false) => ({
  id: "remove_pack",
  type: "removepacksource" as const,
  position: { x: 0, y: 0 },
  data: {
    label: "Remove Pack Source",
    type: "removepacksource" as const,
    selectedPack,
    useCurrentPack,
    inputType: "PackFiles",
    outputType: "PackFiles",
  },
});

describe("Remove Pack Source node", () => {
  it("removes the selected pack and recalculates PackFiles counts", async () => {
    const result = await executeNodeAction({
      nodeId: "remove_pack",
      nodeType: "removepacksource",
      textValue: "",
      inputData,
      config: { selectedPack: "second.pack" },
    });

    expect(result.success).toBe(true);
    expect((result.data as PackFilesNodeData).files.map((file) => file.name)).toEqual([
      "first.pack",
      "missing.pack",
    ]);
    expect(result.data).toMatchObject({ count: 2, loadedCount: 1 });
  });

  it("also accepts an exact pack path and leaves non-matches unchanged", async () => {
    const exactPath = await executeNodeAction({
      nodeId: "remove_pack",
      nodeType: "removepacksource",
      textValue: "",
      inputData,
      config: { selectedPack: "k:/mods/first.pack" },
    });
    const noMatch = await executeNodeAction({
      nodeId: "remove_pack",
      nodeType: "removepacksource",
      textValue: "",
      inputData,
      config: { selectedPack: "not-in-input.pack" },
    });

    expect((exactPath.data as PackFilesNodeData).files.map((file) => file.name)).not.toContain("first.pack");
    expect((noMatch.data as PackFilesNodeData).files).toEqual(inputData.files);
  });

  it("requires both PackFiles input and a selected pack", async () => {
    const wrongInput = await executeNodeAction({
      nodeId: "remove_pack",
      nodeType: "removepacksource",
      textValue: "",
      inputData: { type: "Text", value: "" },
      config: { selectedPack: "first.pack" },
    });
    const emptySelection = await executeNodeAction({
      nodeId: "remove_pack",
      nodeType: "removepacksource",
      textValue: "",
      inputData,
      config: { selectedPack: "" },
    });

    expect(wrongInput).toMatchObject({ success: false, error: "Invalid input: Expected PackFiles data" });
    expect(emptySelection.success).toBe(false);
    expect(emptySelection.error).toContain("No pack selected");
  });

  it("serializes its explicit dropdown selection for manual runs", () => {
    expect(JSON.parse(serializeNodeConfigForExecution(removeNode() as never))).toEqual({
      selectedPack: "Second.pack",
    });
    expect(prepareNodeConfig(removeNode() as never)).toEqual({ selectedPack: "Second.pack" });
  });

  it("uses the containing pack only when preparing an unattended packaged flow", () => {
    const node = removeNode("explicit.pack", true);
    const graph = {
      version: "1.0",
      timestamp: 0,
      nodes: [node],
      connections: [],
      options: [],
      metadata: { nodeCount: 1, connectionCount: 0 },
      isGraphEnabled: true,
      graphStartsEnabled: true,
    };

    const prepared = prepareFlow("whmmflows\\flow.json", graph, "owner.pack", undefined, false);

    expect(prepared.nodes[0].data.selectedPack).toBe("owner.pack");
    expect(prepared.nodeConfigs.remove_pack).toEqual({ selectedPack: "owner.pack" });
    expect(node.data.selectedPack).toBe("explicit.pack");
  });
});
