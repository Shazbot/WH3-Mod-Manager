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
  const uniqueFixture = () => {
    const request = fixture();
    request.inputData.tables = [
      table(
        "roots_tables",
        [field("key", "StringU8", true), field("link")],
        [
          ["a", "one"],
          ["b", "two"],
        ],
      ),
    ];
    const linked = table(
      "linked_tables",
      [field("key", "StringU8", true), field("damage", "I32")],
      [
        ["one", "10"],
        ["two", "20"],
      ],
    );
    request.linkedTableData = [linked];
    request.collisionTableData = [linked];
    return request;
  };

  it("reuses unshared linked keys by default without mutating source rows", () => {
    const request = uniqueFixture();
    const original = structuredClone(request);
    const result = applyOnnxPredictions(request);
    expect(rows(result.tables[0]).map((row) => row.link)).toEqual(["one", "two"]);
    expect(rows(result.tables[1])).toEqual([
      { key: "one", damage: "12" },
      { key: "two", damage: "25" },
    ]);
    expect(request).toEqual(original);
  });

  it("can disable reuse and create new keys even for unshared rows", () => {
    const request = uniqueFixture();
    request.reuseExistingKeys = false;
    const result = applyOnnxPredictions(request);
    expect(rows(result.tables[0]).map((row) => row.link)).not.toContain("one");
    expect(rows(result.tables[0]).map((row) => row.link)).not.toContain("two");
    expect(rows(result.tables[1]).map((row) => row.damage)).toEqual(["12", "25"]);
  });

  it("counts one owner when several models update columns on the same linked row", () => {
    const request = uniqueFixture();
    request.inputData.tables = [table("roots_tables", [field("key", "StringU8", true), field("link")], [["a", "one"]])];
    const linked = table(
      "linked_tables",
      [field("key", "StringU8", true), field("damage", "I32"), field("armour", "I32")],
      [["one", "10", "20"]],
    );
    request.linkedTableData = [linked];
    request.collisionTableData = [linked];
    request.models.push({ key: "armour", defaultTableName: "linked_tables", defaultColumn: "armour" });
    request.bindings.armour = { ...request.bindings.prediction, column: "armour" };
    request.predictions = { prediction: [2], armour: [3] };
    const result = applyOnnxPredictions(request);
    expect(rows(result.tables[1])).toEqual([{ key: "one", damage: "12", armour: "23" }]);
  });

  it("reuses unique keys and clones shared keys within the same table", () => {
    const request = uniqueFixture();
    request.inputData.tables = [
      table(
        "roots_tables",
        [field("key", "StringU8", true), field("link")],
        [
          ["a", "one"],
          ["b", "two"],
          ["c", "two"],
        ],
      ),
    ];
    request.predictions.prediction = [2.4, 4.6, 7.2];
    const result = applyOnnxPredictions(request);
    const links = rows(result.tables[0]).map((row) => row.link);
    expect(links[0]).toBe("one");
    expect(links.slice(1)).not.toContain("two");
    expect(new Set(links).size).toBe(3);
    expect(rows(result.tables[1]).map((row) => row.damage)).toEqual(["12", "25", "27"]);
  });

  it("does not duplicate reused keys carried in a legacy table input", () => {
    const request = uniqueFixture();
    request.inputData.tables.push(request.linkedTableData[0]);
    const result = applyOnnxPredictions(request);
    const output = result.tables.filter((table) => table.name === "linked_tables").flatMap(rows);
    expect(output).toEqual([
      { key: "one", damage: "12" },
      { key: "two", damage: "25" },
    ]);
  });

  it("keeps unique intermediate keys while redirecting their shared child to clones", () => {
    const request = fixture();
    request.inputData.tables = [
      table(
        "roots_tables",
        [field("key", "StringU8", true), field("link")],
        [
          ["a", "ma"],
          ["b", "mb"],
        ],
      ),
    ];
    const middle = table(
      "middle_tables",
      [field("key", "StringU8", true), field("link")],
      [
        ["ma", "shared"],
        ["mb", "shared"],
      ],
    );
    request.linkedTableData.push(middle);
    request.collisionTableData.push(middle);
    request.bindings.prediction.path = [
      { tableName: "roots_tables", column: "link", targetTable: "middle_tables", targetColumn: "key" },
      { tableName: "middle_tables", column: "link", targetTable: "linked_tables", targetColumn: "key" },
    ];
    const result = applyOnnxPredictions(request);
    expect(rows(result.tables[0]).map((row) => row.link)).toEqual(["ma", "mb"]);
    const middleRows = rows(result.tables.find((table) => table.name === "middle_tables")!);
    expect(middleRows.map((row) => row.key)).toEqual(["ma", "mb"]);
    expect(middleRows.map((row) => row.link)).toEqual(
      rows(result.tables.find((table) => table.name === "linked_tables")!).map((row) => row.key),
    );
    expect(middleRows.map((row) => row.link)).not.toContain("shared");
  });

  it("protects a shared row even when one root has a no-op prediction", () => {
    const request = fixture();
    request.predictions.prediction = [2, 0];
    const result = applyOnnxPredictions(request);
    expect(rows(result.tables[0])[0].link).not.toBe("shared");
    expect(rows(result.tables[0])[1].link).toBe("shared");
    expect(rows(result.tables[1])).toHaveLength(1);
  });
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
