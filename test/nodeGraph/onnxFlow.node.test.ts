import { describe, expect, it, vi } from "vitest";
import { prepareFlow } from "../../src/packFileSerializer";
import { executeNodeAction } from "../../src/nodeExecutor";
import { prepareGraphForExecution, serializeReactFlowNodes } from "../../src/nodeGraph/graphSerialization";
import { serializeNodeConfigForExecution } from "../../src/nodeGraphExecutor";
import type { SerializedNodeGraph } from "../../src/nodeGraph/types";

import {
  buildOnnxInputTensors,
  combineOnnxPrediction,
  findOnnxForwardPaths,
  findOnnxShortestForwardPaths,
  formatOnnxPrediction,
  getOnnxInputUnresolvedIssues,
  inferOnnxInputBinding,
  isSafeOnnxPackPath,
  joinOnnxPackPath,
  parseOnnxBundleMetadata,
  parseOnnxModelTarget,
  resolveOnnxBindingValue,
  selectOnnxSchemaVersions,
} from "../../src/nodeGraph/onnxFlow";

vi.mock("@mongodb-js/zstd", () => ({ decompress: vi.fn(async (input: Uint8Array) => input) }));
vi.mock("electron-is-dev", () => ({ default: false }));

const field = (name: string, field_type: string, is_key = false, is_reference: [string, string] | false = false) =>
  ({ name, field_type, is_key, is_reference }) as any;
const table = (fields: any[]) => [{ fields }] as any;
const schema = {
  "db\\main_units_tables": table([
    field("key", "StringU8", true),
    field("tier", "I32"),
    field("land_unit", "StringU8", false, ["land_units_tables", "key"]),
    field("missile_weapon", "StringU8", false, ["missile_weapons_tables", "key"]),
  ]),
  "db\\land_units_tables": table([field("key", "StringU8", true), field("armour", "I32")]),
  "db\\missile_weapons_tables": table([
    field("key", "StringU8", true),
    field("land_unit", "StringU8", false, ["land_units_tables", "key"]),
  ]),
} as any;

describe("ONNX flow metadata and mapping", () => {
  it.each(["bundle", "standalone"])("accepts empty PackFiles as an empty table result in %s mode", async (mode) => {
    const result = await executeNodeAction({
      nodeId: "onnx-packs",
      nodeType: "onnx",
      textValue: "",
      inputData: { type: "PackFiles", files: [], count: 0, loadedCount: 0 },
      config: { mode, rootTableName: "land_units_tables" },
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ type: "TableSelection", tables: [], sourceFiles: [], tableCount: 0 });
  });

  it("retains compatibility with empty table selections", async () => {
    const input = { type: "TableSelection", tables: [], sourceFiles: [], tableCount: 0 } as const;
    const result = await executeNodeAction({
      nodeId: "onnx-tables",
      nodeType: "onnx",
      textValue: "",
      inputData: input as any,
      config: {},
    });
    expect(result.success).toBe(true);
    expect(result.data).toBe(input);
  });
  it("uses the installed table version rather than the largest version number", () => {
    const latest = { version: 36, fields: [] } as any;
    const live = { version: 7, fields: [field("is_renown", "Boolean")] } as any;
    const original = { main_units_tables: [latest, live] };
    expect(selectOnnxSchemaVersions(original, { main_units_tables: 7 }).main_units_tables).toEqual([live]);
    expect(original.main_units_tables).toEqual([latest, live]);
  });

  it("derives is_ranged from the missile-weapon cell without resolving the weapon or projectile", () => {
    const binding = {
      kind: "column-present" as const,
      tableName: "land_units_tables",
      column: "primary_missile_weapon",
      path: [],
    };
    const resolve = vi.fn(() => undefined);
    for (const [value, expected] of [
      ["weapon_without_projectile", 1],
      ["", 0],
    ] as const) {
      expect(
        resolveOnnxBindingValue(
          binding,
          [{ name: "primary_missile_weapon", resolvedKeyValue: value }],
          "float32",
          "__MISSING__",
          resolve,
        ),
      ).toBe(expected);
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(resolveOnnxBindingValue(binding, [], "float32", "__MISSING__", resolve)).toBe(0);
  });

  it("preserves missing numeric values for model imputation when configured", () => {
    const bindings = {
      feature: { kind: "column" as const, tableName: "root", column: "value", path: [], missingAsNaN: true },
    };
    const tensors = buildOnnxInputTensors(
      [{ name: "feature", type: "float32" }],
      bindings,
      [[], [{ name: "value", resolvedKeyValue: "0" }]],
      "__MISSING__",
      () => undefined,
    );
    const data = tensors.feature.data as Float32Array;
    expect(Number.isNaN(data[0])).toBe(true);
    expect(data[1]).toBe(0);
  });
  it("normalizes model targets and rejects unsafe packed paths", () => {
    expect(parseOnnxModelTarget("delta_main_units_tables__tier")).toEqual({
      tableName: "main_units_tables",
      column: "tier",
      isDelta: true,
    });
    expect(joinOnnxPackPath("onnx_models", "models/tier.onnx")).toBe("onnx_models\\models\\tier.onnx");
    expect(isSafeOnnxPackPath("models/tier.onnx")).toBe(true);
    for (const path of ["/models/tier.onnx", "C:\\models\\tier.onnx", "../tier.onnx", "models/./tier.onnx"]) {
      expect(isSafeOnnxPackPath(path)).toBe(false);
    }
    expect(() => joinOnnxPackPath("/models", "tier.onnx")).toThrow("Unsafe ONNX packed-file path");
    expect(() =>
      parseOnnxBundleMetadata(
        JSON.stringify({ main_units__tier: { file: "/tier.onnx" } }),
        JSON.stringify({
          inputs: [{ name: "main_units__tier", type: "float32" }],
          categorical_missing: "x",
          output: "y",
        }),
      ),
    ).toThrow("unsafe file path");
  });

  it("accepts constant predictions as warnings and validates bundle manifests", () => {
    const metadata = parseOnnxBundleMetadata(
      JSON.stringify({
        delta_main_units_tables__tier: { file: "tier.onnx" },
        land_units__armour: { constant: 0 },
      }),
      JSON.stringify({
        inputs: [
          { name: "main_units__tier", type: "float32" },
          { name: "is_ranged", type: "float32" },
        ],
        categorical_missing: "__MISSING__",
        output: "transformed_column",
      }),
    );
    expect(metadata.models).toHaveLength(2);
    expect(metadata.models[0]).toMatchObject({
      key: "delta_main_units_tables__tier",
      defaultTableName: "main_units_tables",
      defaultColumn: "tier",
    });
    expect(metadata.models[1]).toMatchObject({ constant: 0 });
    expect(metadata.warnings).toHaveLength(1);
    expect(metadata.errors).toEqual([]);
    expect(() =>
      parseOnnxBundleMetadata("{}", JSON.stringify({ inputs: [], categorical_missing: "x", output: "y" })),
    ).toThrow("inputs must not be empty");
  });

  it("prefers a unique shortest path while keeping longer routes selectable", () => {
    const direct = inferOnnxInputBinding({ name: "main_units__tier", type: "float32" }, "main_units_tables", schema);
    expect(direct.defaultBinding).toEqual({
      kind: "column",
      tableName: "db\\main_units_tables",
      column: "tier",
      path: [],
    });
    const paths = findOnnxForwardPaths("main_units_tables", "land_units_tables", schema);
    expect(paths).toHaveLength(2);
    const ambiguous = inferOnnxInputBinding(
      { name: "land_units__armour", type: "float32" },
      "main_units_tables",
      schema,
    );
    expect(ambiguous.defaultBinding).toMatchObject({
      kind: "column",
      path: [expect.objectContaining({ column: "land_unit" })],
    });
    expect(ambiguous.options).toHaveLength(2);
    const ranged = inferOnnxInputBinding({ name: "is_ranged", type: "float32" }, "main_units_tables", schema);
    expect(ranged.defaultBinding).toMatchObject({ kind: "unresolved" });
    expect(ranged.options.some((option) => option.tableName.toLowerCase().includes("missile_weapons"))).toBe(true);
    expect(
      getOnnxInputUnresolvedIssues([{ name: "is_ranged", type: "float32" }], { is_ranged: ranged.defaultBinding }),
    ).toHaveLength(1);
  });

  it("keeps equally short paths ambiguous", () => {
    const tied = {
      ...schema,
      "db\\main_units_tables": table([
        field("first", "StringU8", false, ["land_units_tables", "key"]),
        field("second", "StringU8", false, ["land_units_tables", "key"]),
      ]),
    };
    const inferred = inferOnnxInputBinding({ name: "land_units__armour", type: "float32" }, "main_units_tables", tied);
    expect(inferred.paths).toHaveLength(2);
    expect(inferred.defaultBinding).toMatchObject({ kind: "unresolved", reason: expect.stringContaining("shortest") });
  });

  it("finds the shortest route even when longer branches precede it in the schema", () => {
    const ordered = {
      ...schema,
      "db\\main_units_tables": table([
        field("weapon", "StringU8", false, ["missile_weapons_tables", "key"]),
        field("weapon_again", "StringU8", false, ["missile_weapons_tables", "key"]),
        field("direct", "StringU8", false, ["land_units_tables", "key"]),
      ]),
    };
    const paths = findOnnxShortestForwardPaths("main_units_tables", "land_units_tables", ordered);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(1);
    expect(paths[0][0].column).toBe("direct");
  });

  it("builds typed tensors with constants, missing defaults, and reference-presence checks", () => {
    const linkedPath = [
      { tableName: "main_units_tables", column: "land_unit", targetTable: "land_units_tables", targetColumn: "key" },
    ];
    const inputs = [
      { name: "tier", type: "float32" as const },
      { name: "armour", type: "float32" as const },
      { name: "class", type: "string" as const },
      { name: "ranged", type: "float32" as const },
      { name: "constant", type: "string" as const },
    ];
    const bindings = {
      tier: { kind: "column" as const, tableName: "main_units_tables", column: "tier", path: [] },
      armour: { kind: "column" as const, tableName: "land_units_tables", column: "armour", path: linkedPath },
      class: { kind: "column" as const, tableName: "land_units_tables", column: "category", path: linkedPath },
      ranged: { kind: "reference-present" as const, tableName: "land_units_tables", path: linkedPath },
      constant: { kind: "constant" as const, value: "siege" },
    };
    const rows = [
      [
        { name: "tier", resolvedKeyValue: "2" },
        { name: "land_unit", resolvedKeyValue: "u1" },
      ],
      [{ name: "tier", resolvedKeyValue: "3" }],
    ];
    const feeds = buildOnnxInputTensors(inputs, bindings, rows, "__MISSING__", (_path, row) =>
      row.some((cell) => cell.name === "land_unit")
        ? [
            { name: "armour", resolvedKeyValue: "17" },
            { name: "category", resolvedKeyValue: "infantry" },
          ]
        : undefined,
    );
    expect([...(feeds.tier.data as Float32Array)]).toEqual([2, 3]);
    expect([...(feeds.armour.data as Float32Array)]).toEqual([17, 0]);
    expect(feeds.class.data).toEqual(["infantry", "__MISSING__"]);
    expect([...(feeds.ranged.data as Float32Array)]).toEqual([1, 0]);
    expect(feeds.constant.data).toEqual(["siege", "siege"]);
    expect(feeds.tier.dims).toEqual([2, 1]);
  });

  it("combines delta predictions and keeps stored integer formatting convention", () => {
    expect(combineOnnxPrediction("10", 2.5, "delta", 2)).toBe(15);
    expect(combineOnnxPrediction("10", 2.5, "add", 99)).toBe(12.5);
    expect(combineOnnxPrediction("10", 2.5, "replace", 99)).toBe(2.5);
    expect(formatOnnxPrediction(2.7, "I32")).toBe("3");
    expect(formatOnnxPrediction(2.7, "F32")).toBe("2.7");
    expect(() => combineOnnxPrediction("0", Number.NaN, "delta", 1)).toThrow("not finite");
  });
});

describe("ONNX flow serialization and flow options", () => {
  const onnxNode = () => ({
    id: "onnx-node",
    type: "onnx",
    position: { x: 20, y: 30 },
    data: {
      label: "ONNX Prediction",
      type: "onnx",
      inputType: "TableSelection",
      outputType: "TableSelection",
      mode: "bundle",
      selectedPackName: "",
      rootTableName: "main_units_tables",
      modelsDirectory: "onnx_models",
      modelsManifestPath: "onnx_models/models.json",
      preprocessorManifestPath: "onnx_models/preprocessor.json",
      preprocessorModelPath: "onnx_models/preprocessor.onnx",
      inputBindings: { feature: { kind: "constant", value: 4 } },
      outputBindings: {
        delta_main_units_tables__tier: {
          enabled: true,
          tableName: "main_units_tables",
          column: "tier",
          path: [],
          mode: "delta",
          strengthOptionId: "strength",
        },
      },
      strength: 1,
      strengthOptionId: "strength",
    },
  });
  const flowOptions = [
    { id: "strength", name: "Delta strength", type: "range", value: 2, min: 0, max: 5, step: 0.5 },
  ] as any;

  it("persists standalone model settings and mappings", () => {
    const node = onnxNode() as any;
    node.data.mode = "standalone";
    node.data.standaloneModelPath = "models/predictor.onnx";
    node.data.standaloneInputBindings = { features: [{ kind: "constant", value: 3 }] };
    node.data.standaloneOutputName = "prediction";
    const serialized = serializeReactFlowNodes([node])[0];
    expect(serialized.data).toMatchObject({
      mode: "standalone",
      standaloneModelPath: "models/predictor.onnx",
      standaloneInputBindings: { features: [{ kind: "constant", value: 3 }] },
      standaloneOutputName: "prediction",
    });
    expect(JSON.parse(serializeNodeConfigForExecution(serialized))).toMatchObject({
      mode: "standalone",
      standaloneModelPath: "models/predictor.onnx",
      standaloneOutputName: "prediction",
    });
  });

  it.each([undefined, true, false])(
    "preserves key reuse settings across save, manual and launch configuration (%s)",
    (setting) => {
      const node = onnxNode() as any;
      node.data.reuseExistingKeys = setting;
      const serialized = serializeReactFlowNodes([node])[0];
      expect(serialized.data.reuseExistingKeys).toBe(setting !== false);
      expect(JSON.parse(serializeNodeConfigForExecution(serialized)).reuseExistingKeys).toBe(setting !== false);
      const flow: SerializedNodeGraph = {
        version: "1.0",
        timestamp: 0,
        nodes: [serialized],
        connections: [],
        options: [],
        metadata: { nodeCount: 1, connectionCount: 0 },
        isGraphEnabled: true,
        graphStartsEnabled: true,
      };
      const launched = prepareFlow("reuse.json", flow, "models.pack", undefined, false);
      expect((launched.nodeConfigs[node.id] as any).reuseExistingKeys).toBe(setting !== false);
    },
  );

  it("resolves node and per-output strength options in manual and launch runs", () => {
    const node = onnxNode() as any;
    const manual = prepareGraphForExecution({ nodes: [node], edges: [], flowOptions });
    expect(manual.nodes[0].data.strength).toBe(2);
    expect((manual.nodes[0].data.outputBindings as any).delta_main_units_tables__tier.strength).toBe(2);

    const flowData: SerializedNodeGraph = {
      version: "1.0",
      timestamp: 1,
      nodes: [node],
      connections: [],
      options: flowOptions,
      metadata: { nodeCount: 1, connectionCount: 0 },
      isGraphEnabled: true,
      graphStartsEnabled: true,
    };
    const launched = prepareFlow(
      "test.flow",
      flowData,
      "owner.pack",
      { optionValues: { strength: 3.5 } } as any,
      false,
    );
    expect(launched.nodes[0].data.strength).toBe(3.5);
    expect((launched.nodes[0].data.outputBindings as any).delta_main_units_tables__tier.strength).toBe(3.5);
    expect(launched.nodeConfigs["onnx-node"]).toMatchObject({ strength: 3.5, strengthOptionId: "strength" });
  });
});
