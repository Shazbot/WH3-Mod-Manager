import { describe, expect, it, vi } from "vitest";

import { prepareFlow } from "../../src/packFileSerializer";
import { serializeNodeConfigForExecution } from "../../src/nodeGraphExecutor";
import { prepareGraphForExecution } from "../../src/nodeGraph/graphSerialization";
import type { SerializedNodeGraph } from "../../src/nodeGraph/types";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const makeNode = () => ({
  id: "xml",
  type: "editxmlfile",
  position: { x: 0, y: 0 },
  data: {
    label: "Edit XML File",
    type: "editxmlfile",
    inputType: "PackFiles",
    outputType: "TableSelection",
    targetMode: "path",
    filePath: "ui/{{path}}.xml",
    ignoreHierarchy: false,
    locatorSteps: [
      {
        id: "step",
        elementName: "{{element}}",
        attributes: [{ id: "locator-attribute", name: "{{locatorName}}", value: "{{locatorValue}}" }],
      },
    ],
    action: "replaceElement",
    attributeEdits: [{ id: "mutation", name: "{{mutationName}}", newValue: "{{mutationValue}}" }],
    replacementXml: "<{{replacementTag}}>{{replacementText}}</{{replacementTag}}>",
  },
});

const options = [
  { id: "path", name: "Path", type: "textbox", value: "campaign/hud" },
  { id: "element", name: "Element", type: "textbox", value: "button_group_management" },
  { id: "locatorName", name: "Locator name", type: "textbox", value: "id" },
  { id: "locatorValue", name: "Locator value", type: "textbox", value: "management" },
  { id: "mutationName", name: "Mutation name", type: "textbox", value: "dock_offset" },
  { id: "mutationValue", name: "Mutation value", type: "textbox", value: "-180.00,-190.00" },
  { id: "replacementTag", name: "Replacement tag", type: "textbox", value: "LayoutEngine" },
  { id: "replacementText", name: "Replacement text", type: "textbox", value: "replacement" },
] as any;
const optionValues = {
  path: "campaign/hud",
  element: "button_group_management",
  locatorName: "id",
  locatorValue: "management",
  mutationName: "dock_offset",
  mutationValue: "-180.00,-190.00",
  replacementTag: "LayoutEngine",
  replacementText: "replacement",
};

describe("Edit XML File flow-option substitution", () => {
  it("substitutes every path, locator, mutation, and replacement field for a manual run", () => {
    const result = prepareGraphForExecution({
      nodes: [makeNode()] as any,
      edges: [],
      flowOptions: options,
    });
    const node = result.nodes[0];
    expect(node.data.filePath).toBe("ui/campaign/hud.xml");
    expect(node.data.locatorSteps).toEqual([
      {
        id: "step",
        elementName: "button_group_management",
        attributes: [{ id: "locator-attribute", name: "id", value: "management" }],
      },
    ]);
    expect(node.data.attributeEdits).toEqual([{ id: "mutation", name: "dock_offset", newValue: "-180.00,-190.00" }]);
    expect(node.data.replacementXml).toBe("<LayoutEngine>replacement</LayoutEngine>");
    expect(JSON.parse(serializeNodeConfigForExecution(node as any))).toMatchObject({
      filePath: "ui/campaign/hud.xml",
      replacementXml: "<LayoutEngine>replacement</LayoutEngine>",
      locatorSteps: expect.any(Array),
      attributeEdits: expect.any(Array),
    });
  });

  it("keeps packaged-flow preparation in parity with the manual substitution", () => {
    const node = makeNode() as any;
    const flowData: SerializedNodeGraph = {
      version: "1.0",
      timestamp: 1,
      nodes: [node],
      connections: [],
      options,
      metadata: { nodeCount: 1, connectionCount: 0 },
      isGraphEnabled: true,
      graphStartsEnabled: true,
    };
    const prepared = prepareFlow("flow.xml", flowData, "working.pack", { optionValues } as any, false);
    expect(prepared.nodes[0].data.filePath).toBe("ui/campaign/hud.xml");
    expect(prepared.nodes[0].data.locatorSteps?.[0]).toMatchObject({
      elementName: "button_group_management",
      attributes: [{ name: "id", value: "management" }],
    });
    expect(prepared.nodes[0].data.attributeEdits).toEqual([
      { id: "mutation", name: "dock_offset", newValue: "-180.00,-190.00" },
    ]);
    expect(prepared.nodes[0].data.replacementXml).toBe("<LayoutEngine>replacement</LayoutEngine>");
    expect(prepared.nodeConfigs.xml).toMatchObject({
      targetMode: "path",
      filePath: "ui/campaign/hud.xml",
      replacementXml: "<LayoutEngine>replacement</LayoutEngine>",
    });
  });
});
