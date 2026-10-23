import { describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

import { serializeNodeGraphState } from "../../src/nodeGraph/graphSerialization";
import { serializeNodeConfigForExecution } from "../../src/nodeGraphExecutor";
import { prepareNodeConfig } from "../../src/packFileSerializer";

/**
 * A save node option has to survive four separate hops or it silently does nothing: the graph file,
 * and the two config marshallers - one for a manual run, one for the unattended run at game start.
 */
const saveNode = (openInViewer: boolean, saveAsMoviePack = false) => ({
  id: "node_0",
  type: "savechanges" as const,
  position: { x: 0, y: 0 },
  data: {
    label: "Save Changes",
    type: "savechanges",
    textValue: "",
    packName: "my-output",
    packedFileName: "",
    openInWindows: false,
    openInViewer,
    saveAsMoviePack,
    inputType: "TableSelection",
  },
});

describe("save changes execution options", () => {
  it("round-trips through the saved graph", () => {
    const serialized = serializeNodeGraphState({
      nodes: [saveNode(true, true)] as never[],
      edges: [],
      flowOptions: [],
      isGraphEnabled: false,
      graphStartsEnabled: true,
    });

    expect(serialized.nodes[0].data.openInViewer).toBe(true);
    expect(serialized.nodes[0].data.saveAsMoviePack).toBe(true);
  });

  it("reaches the executor on a manual run", () => {
    const config = serializeNodeConfigForExecution(saveNode(true, true) as never);

    expect(JSON.parse(config as string).openInViewer).toBe(true);
    expect(JSON.parse(config as string).saveAsMoviePack).toBe(true);
  });

  it("reaches the executor on the unattended run at game start", () => {
    const config = prepareNodeConfig(saveNode(true, true) as never);

    expect((config as { openInViewer?: boolean }).openInViewer).toBe(true);
    expect((config as { saveAsMoviePack?: boolean }).saveAsMoviePack).toBe(true);
  });

  it("defaults new save options to off for existing flows", () => {
    const withoutTheField = saveNode(false);
    delete (withoutTheField.data as Record<string, unknown>).openInViewer;
    delete (withoutTheField.data as Record<string, unknown>).saveAsMoviePack;

    expect(JSON.parse(serializeNodeConfigForExecution(withoutTheField as never) as string).openInViewer).toBe(false);
    expect(JSON.parse(serializeNodeConfigForExecution(withoutTheField as never) as string).saveAsMoviePack).toBe(false);
    expect((prepareNodeConfig(withoutTheField as never) as { openInViewer?: boolean }).openInViewer).toBe(false);
    expect((prepareNodeConfig(withoutTheField as never) as { saveAsMoviePack?: boolean }).saveAsMoviePack).toBe(false);
  });
});

describe("Edit Text File formatter execution config", () => {
  const editNode = {
    id: "node_format",
    type: "edittextfile" as const,
    position: { x: 0, y: 0 },
    data: {
      label: "Edit Text File",
      type: "edittextfile",
      inputType: "PackFiles",
      outputType: "TableSelection",
      textFileRules: [],
      textFileFormatter: "compactXml",
      ignoreFlowSourcePack: true,
      flowSourcePack: "owner.pack",
    },
  };

  it("reaches the executor on manual and unattended runs", () => {
    const manualConfig = JSON.parse(serializeNodeConfigForExecution(editNode as never) as string);
    const automaticConfig = prepareNodeConfig(editNode as never) as Record<string, unknown>;

    expect(manualConfig).toMatchObject({
      textFileFormatter: "compactXml",
      ignoreFlowSourcePack: true,
      flowSourcePack: "owner.pack",
    });
    expect(automaticConfig).toMatchObject({
      textFileFormatter: "compactXml",
      ignoreFlowSourcePack: true,
      flowSourcePack: "owner.pack",
    });
  });
});
