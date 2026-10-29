import { describe, expect, it } from "vitest";
import { applyOnnxPredictions, type ApplyOnnxPredictionsRequest } from "../../src/nodeGraph/onnxRows";
import type { AmendedSchemaField, DBField, SCHEMA_FIELD_TYPE } from "../../src/packFileTypes";
import { parseEditedCellValue } from "../../src/utility/dbRowCells";

const field = (name: string, field_type: SCHEMA_FIELD_TYPE = "StringU8", is_key = false) =>
  ({ name, field_type, is_key }) as DBField;
const table = (name: string, fields: DBField[], values: string[][]): DBTablesNodeTable => ({
  name,
  fileName: `db\\${name}\\test`,
  sourceFile: { name: "test.pack", path: "test.pack", loaded: true },
  table: {
    tableSchema: { version: 1, fields },
    schemaFields: values.flatMap((row) =>
      row.map(
        (value, i) =>
          ({ name: fields[i].name, ...parseEditedCellValue(fields[i].field_type, value) }) as AmendedSchemaField,
      ),
    ),
  } as DBTablesNodeTable["table"],
});
const rows = (data: DBTablesNodeTable) => {
  const width = data.table.tableSchema!.fields.length;
  return Array.from({ length: data.table.schemaFields!.length / width }, (_, i) =>
    Object.fromEntries(
      data.table.schemaFields!.slice(i * width, (i + 1) * width).map((c) => [c.name, c.resolvedKeyValue]),
    ),
  );
};
const fixture = (): ApplyOnnxPredictionsRequest => {
  const roots = table(
    "roots_tables",
    [field("key", "StringU8", true), field("link")],
    [
      ["a", "shared"],
      ["b", "shared"],
    ],
  );
  const linked = table("linked_tables", [field("key", "StringU8", true), field("damage", "I32")], [["shared", "10"]]);
  return {
    inputData: { type: "TableSelection", tables: [roots], tableCount: 1, sourceFiles: [] },
    rootTableName: "roots_tables",
    cloneIdentity: "flow/node",
    strength: 1,
    models: [{ key: "prediction", defaultTableName: "linked_tables", defaultColumn: "damage" }],
    bindings: {
      prediction: {
        enabled: true,
        mode: "delta",
        tableName: "linked_tables",
        column: "damage",
        path: [{ tableName: "roots_tables", column: "link", targetTable: "linked_tables", targetColumn: "key" }],
      },
    },
    predictions: { prediction: [2.4, 4.6] },
    linkedTableData: [linked],
    collisionTableData: [linked],
  };
};

describe("ONNX row writeback", () => {
  it("optionally rounds a model delta before strength and floating-point writeback", () => {
    const request = fixture();
    const linked = table(
      "linked_tables",
      [field("key", "StringU8", true), field("damage", "F32")],
      [["shared", "1.25"]],
    );
    request.linkedTableData = [linked];
    request.collisionTableData = [linked];
    request.predictions.prediction = [2.5, -2.5];
    request.bindings.prediction = { ...request.bindings.prediction, roundPrediction: true, strength: 0.5 };
    const result = applyOnnxPredictions(request);
    expect(rows(result.tables[1]).map((r) => r.damage)).toEqual(["2.75", "0.25"]);
  });
  it("isolates shared linked rows per root without mutating sources", () => {
    const request = fixture();
    const snapshot = structuredClone(request);
    const result = applyOnnxPredictions(request);
    const roots = rows(result.tables[0]);
    const clones = rows(result.tables[1]);
    expect(roots.map((r) => r.key)).toEqual(["a", "b"]);
    expect(roots[0].link).not.toBe(roots[1].link);
    expect(clones.map((r) => r.key)).toEqual(roots.map((r) => r.link));
    expect(clones.map((r) => r.damage)).toEqual(["12", "15"]);
    expect(request).toEqual(snapshot);
    expect(applyOnnxPredictions(request)).toEqual(result);
  });
  it("scopes deterministic clone keys to the flow and node", () => {
    const request = fixture();
    const first = rows(applyOnnxPredictions(request).tables[1])[0].key;
    request.cloneIdentity = "another-flow/node";
    expect(rows(applyOnnxPredictions(request).tables[1])[0].key).not.toBe(first);
  });
  it("avoids clones for zero-strength predictions", () => {
    const request = fixture();
    request.bindings.prediction.strength = 0;
    const result = applyOnnxPredictions(request);
    expect(result.tables).toHaveLength(1);
    expect(rows(result.tables[0]).map((r) => r.link)).toEqual(["shared", "shared"]);
  });
  it("rejects non-finite and out-of-range predictions atomically", () => {
    for (const value of [Infinity, NaN, 2 ** 32]) {
      const request = fixture();
      request.predictions.prediction[1] = value;
      const original = structuredClone(request.inputData);
      expect(() => applyOnnxPredictions(request)).toThrow();
      expect(request.inputData).toEqual(original);
    }
  });
  it("clones intermediate rows when a descendant changes", () => {
    const request = fixture();
    const middle = table("middle_tables", [field("key", "StringU8", true), field("link")], [["middle", "shared"]]);
    request.inputData.tables = [
      table(
        "roots_tables",
        [field("key", "StringU8", true), field("link")],
        [
          ["a", "middle"],
          ["b", "middle"],
        ],
      ),
    ];
    request.linkedTableData.push(middle);
    request.collisionTableData.push(middle);
    request.bindings.prediction.path.unshift({
      tableName: "roots_tables",
      column: "link",
      targetTable: "middle_tables",
      targetColumn: "key",
    });
    request.bindings.prediction.path[1].tableName = "middle_tables";
    const result = applyOnnxPredictions(request);
    const roots = rows(result.tables[0]);
    const middles = rows(result.tables.find((t) => t.name === "middle_tables")!);
    const children = rows(result.tables.find((t) => t.name === "linked_tables")!);
    expect(middles.map((r) => r.key)).toEqual(roots.map((r) => r.link));
    expect(children.map((r) => r.key)).toEqual(middles.map((r) => r.link));
    expect(new Set(middles.map((r) => r.key)).size).toBe(2);
  });
});
