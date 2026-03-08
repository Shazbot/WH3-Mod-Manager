import { describe, expect, it } from "vitest";

import { createFallbackNode, createNodeFromDefinition } from "../../src/nodeGraph/nodeRegistry";

describe("nodeRegistry", () => {
  it("creates typed node defaults from the registry", () => {
    const node = createNodeFromDefinition("tableselectiondropdown", {
      nodeId: "node_1",
      position: { x: 12, y: 34 },
      label: "Table Dropdown",
      sortedTableNames: ["agents", "units"],
    });

    expect(node).toMatchObject({
      id: "node_1",
      type: "tableselectiondropdown",
      position: { x: 12, y: 34 },
    });
    expect(node.data).toMatchObject({
      label: "Table Dropdown",
      type: "tableselectiondropdown",
      selectedTable: "",
      inputType: "PackFiles",
      outputType: "TableSelection",
      tableNames: ["agents", "units"],
    });
  });

  it("creates the schema variant of generate rows with custom schema defaults", () => {
    const node = createNodeFromDefinition("generaterowsschema", {
      nodeId: "node_2",
      position: { x: 0, y: 0 },
      label: "Generate Rows Schema",
      sortedTableNames: [],
    });

    expect(node.data).toMatchObject({
      type: "generaterowsschema",
      inputType: "CustomSchema",
      outputType: "TableSelection",
      outputCount: 1,
      customSchemaColumns: [],
      customSchemaData: null,
    });
    expect((node.data as any).outputTables).toEqual([
      {
        handleId: "output-table1",
        name: "Table 1",
        existingTableName: "__custom_schema__",
        columnMapping: [],
      },
    ]);
  });

  it("keeps the styled fallback node path for unknown types", () => {
    const node = createFallbackNode("unknown-type", {
      nodeId: "node_3",
      position: { x: 1, y: 2 },
      label: "Unknown",
    });

    expect(node).toMatchObject({
      id: "node_3",
      type: "default",
      position: { x: 1, y: 2 },
      data: {
        label: "Unknown",
        type: "unknown-type",
      },
    });
    expect(node.style).toMatchObject({
      border: "2px solid #3b82f6",
      background: "#374151",
    });
  });
});
