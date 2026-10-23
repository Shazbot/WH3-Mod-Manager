import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFlowExecutionContext } from "../../src/flowExecutionSupport";
import {
  createNativePatchFlowContribution,
  normalizeNativePatchFlowInputs,
  parseNativePatchFlowContribution,
  parseNativePatchFlowTemplate,
} from "../../src/nativePatches/flowTemplate";
import { NativePatchPackageError } from "../../src/nativePatches/failurePolicy";
import { nativePatchUserMessage } from "../../src/nativePatches/messages";
import { buildNativePatchLaunchPlan } from "../../src/nativePatches/planner";
import { readNativePatchPackEntry } from "../../src/nativePatches/planner";
import { executeNodeAction } from "../../src/nodeExecutor";
import { executeNodeGraph, serializeNodeConfigForExecution } from "../../src/nodeGraphExecutor";
import {
  deserializeNodeGraph,
  prepareGraphForExecution,
  serializeNodeGraphState,
} from "../../src/nodeGraph/graphSerialization";
import appData from "../../src/appData";
import { executeFlowsForPack } from "../../src/packFileSerializer";

const packMocks = vi.hoisted(() => ({ readPack: vi.fn() }));
const vanillaMocks = vi.hoisted(() => ({ readVanillaPackFromCache: vi.fn() }));

vi.mock("@mongodb-js/zstd", () => ({ decompress: vi.fn(async (input: Uint8Array) => input) }));
vi.mock("electron-is-dev", () => ({ default: false }));
vi.mock("../../src/packFileSerializer", async () => {
  const actual = await vi.importActual<typeof import("../../src/packFileSerializer")>("../../src/packFileSerializer");
  return { ...actual, readPack: packMocks.readPack };
});
vi.mock("../../src/vanillaDbCache/store", async () => {
  const actual = await vi.importActual<typeof import("../../src/vanillaDbCache/store")>(
    "../../src/vanillaDbCache/store",
  );
  return { ...actual, readVanillaPackFromCache: vanillaMocks.readVanillaPackFromCache };
});

const makeTemplate = (id = "test.mapping", version = "1.0.0") => ({
  format: "wh3-native-patch-template",
  format_version: 1,
  template: { id, version, name: "Mapping fixture" },
  native_patch: {
    format: "wh3-native-patch",
    format_version: 3,
    package: { id, version, name: "Mapping fixture" },
    requires_loader: { min_version: "2.2.0", capabilities: ["blocks.v1", "table-parameters.v1"] },
    target: { id: "game", filename: "Warhammer3.exe", machine: "amd64" },
    lifecycle: { apply: "startup", before: "game_initialization", change: "restart", lifetime: "process" },
    allocation_policy: {
      type: "module_window",
      module: "game",
      min_rva: "after_image",
      max_rva_exclusive: "0x80000000",
    },
    requires: [],
    conflicts: [],
    claims: [],
    blocks: [{ id: "state", size: 260, alignment: 4, protection: "rw", source: { zero: true } }],
    symbols: {},
    signatures: [],
    guards: [],
    writes: [],
    fixups: [],
    runtime_functions: [],
    assets: [],
    parameters: [
      {
        id: "mapping_data",
        type: "table",
        capacity: 8,
        columns: [
          { name: "flag", type: "ascii", max_bytes: 15 },
          { name: "unit_set", type: "ascii", max_bytes: 15 },
        ],
        count_at: { block: "state", offset: 0 },
        entries_at: { block: "state", offset: 4 },
      },
    ],
  },
  inputs: {
    scalars: [],
    tables: [
      {
        id: "mappings",
        table_name: "Mappings",
        parameter: "mapping_data",
        max_rows: 8,
        group_by: "flag",
        value_column: "unit_set",
        provider_merge: "identical_by_group",
      },
    ],
  },
});

const makeGraph = (templatePath: string, duplicateTableEdge = false, branchToPatch = false) => {
  const nodes = [
    { id: "schema", type: "customschema", data: { type: "customschema" } },
    { id: "rows", type: "customrowsinput", data: { type: "customrowsinput" } },
    ...(branchToPatch ? [{ id: "branch", type: "conditionalbranch", data: { type: "conditionalbranch" } }] : []),
    { id: "patch", type: "nativepatch", data: { type: "nativepatch", tableBindings: ["mappings"] } },
  ] as any[];
  const connections = [
    { id: "schema-rows", sourceId: "schema", sourceHandle: "output", targetId: "rows", targetHandle: "input" },
    ...(branchToPatch
      ? [
          { id: "rows-branch", sourceId: "rows", sourceHandle: "output", targetId: "branch", targetHandle: "input" },
          {
            id: "branch-patch",
            sourceId: "branch",
            sourceHandle: "output-true",
            targetId: "patch",
            targetHandle: "input-table:mappings",
          },
        ]
      : [
          {
            id: "rows-patch",
            sourceId: "rows",
            sourceHandle: "output",
            targetId: "patch",
            targetHandle: "input-table:mappings",
          },
          ...(duplicateTableEdge
            ? [
                {
                  id: "rows-patch-duplicate",
                  sourceId: "rows",
                  sourceHandle: "output",
                  targetId: "patch",
                  targetHandle: "input-table:mappings",
                },
              ]
            : []),
        ]),
  ] as any[];
  const nodeConfigs: Record<string, unknown> = {
    schema: {
      schemaColumns: [
        { name: "flag", type: "StringU8" },
        { name: "unit_set", type: "StringU8" },
      ],
    },
    rows: { customRows: [{ flag: "flag_alpha", unit_set: "set_alpha" }], tableName: "mapping_input" },
    ...(branchToPatch ? { branch: { selectedFlowOptionId: "enabled", flowOptionChecked: false } } : {}),
    patch: { selectedPackName: "", templatePath, scalarValues: {}, tableBindings: ["mappings"] },
  };
  return { nodes, connections, nodeConfigs };
};

let temporaryDirectory = "";
let templatePackPath = "";
let templatePack: any;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-native-flow-node-"));
  templatePackPath = path.join(temporaryDirectory, "owner.pack");
  vanillaMocks.readVanillaPackFromCache.mockResolvedValue(undefined);
  const raw = Buffer.from(JSON.stringify(makeTemplate()));
  fs.writeFileSync(templatePackPath, raw);
  templatePack = {
    name: "owner.pack",
    path: templatePackPath,
    packedFiles: [{ name: "whmm_patch_templates/mapping.wh3patchtemplate.json", start_pos: 0, file_size: raw.length }],
  };
  packMocks.readPack.mockImplementation(async (packPath: string) => {
    if (packPath === templatePackPath) return templatePack;
    throw new Error(`unexpected pack read: ${packPath}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("Native Patch flow node", () => {
  it("keeps the documented data-only template and flow valid", () => {
    const exampleDirectory = path.join(process.cwd(), "docs", "examples", "native-patch-flow");
    const template = parseNativePatchFlowTemplate(
      fs.readFileSync(path.join(exampleDirectory, "data-only.wh3patchtemplate.json")),
    );
    const graph = deserializeNodeGraph(fs.readFileSync(path.join(exampleDirectory, "flow.json"), "utf8"));
    expect(template.template.id).toBe("example.mapping.data-only");
    expect(template.inputs.tables.map((table) => table.id)).toEqual(["mappings"]);
    expect(graph.nodes.find((node) => node.type === "nativepatch")?.data.tableBindings).toEqual(["mappings"]);
  });

  it.each([
    ["native-patch-flow", "data-only.wh3patchtemplate.json", false],
    ["target-unit-sets", "target_unit_sets.experimental.wh3patchtemplate.json", false],
    ["native-patch-flow", "data-only.wh3patchtemplate.json", true],
    ["target-unit-sets", "target_unit_sets.experimental.wh3patchtemplate.json", true],
  ] as const)("executes the %s example %s (terminal: %s)", async (directory, templateFile, terminal) => {
    const exampleDirectory = path.join(process.cwd(), "docs", "examples", directory);
    const templateBytes = fs.readFileSync(path.join(exampleDirectory, templateFile));
    const flow = JSON.parse(fs.readFileSync(path.join(exampleDirectory, "flow.json"), "utf8"));
    if (terminal) {
      flow.nodes = flow.nodes.filter((node: any) => node.type !== "savechanges");
      flow.connections = flow.connections.filter(
        (connection: any) => connection.sourceId !== "node_2" || connection.sourceHandle?.startsWith("output-schema:"),
      );
    }
    const flowText = JSON.stringify(flow);
    fs.writeFileSync(templatePackPath, templateBytes);
    templatePack.packedFiles = [
      {
        name: `whmm_patch_templates/${templateFile}`,
        start_pos: 0,
        file_size: templateBytes.length,
      },
      {
        name: "whmmflows\\example_native_mapping.json",
        text: flowText,
        file_size: Buffer.byteLength(flowText),
        start_pos: templateBytes.length,
      },
    ];
    const stats = fs.statSync(templatePackPath);
    templatePack.lastChangedLocal = stats.mtimeMs;
    templatePack.size = stats.size;

    const previousGame = appData.currentGame;
    const previousGamePath = appData.gamesToGameFolderPaths.wh3.gamePath;
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = temporaryDirectory;
    try {
      const result = await executeFlowsForPack(templatePackPath, "", {}, "owner.pack", templatePack);
      expect(result.hadErrors).toBe(false);
      expect(result.nativePatchFlowError).toBeUndefined();
      expect(result.createdPackPaths).toHaveLength(terminal ? 0 : 1);
      expect(result.nativePatchContributions).toHaveLength(terminal ? 1 : 0);

      let contributionBytes: Buffer;
      if (terminal) {
        contributionBytes = result.nativePatchContributions[0].bytes;
        const plan = await buildNativePatchLaunchPlan({
          runId: "terminal-flow-example",
          targetPath: "unused-unhashed-target.exe",
          enabledPacks: [],
          effectiveContentPacks: [],
          runtimeContributions: result.nativePatchContributions,
        });
        expect(plan?.packages).toHaveLength(1);
        expect(plan?.packages[0].manifest.package.id).toBe(parseNativePatchFlowTemplate(templateBytes).template.id);
      } else {
        const actualSerializer =
          await vi.importActual<typeof import("../../src/packFileSerializer")>("../../src/packFileSerializer");
        const outputPack = await actualSerializer.readPack(result.createdPackPaths[0], { skipParsingTables: true });
        const contributionEntry = outputPack.packedFiles.find((entry) => entry.name.endsWith(".wh3patchcontrib.json"));
        expect(contributionEntry).toBeDefined();
        contributionBytes = await readNativePatchPackEntry(
          { path: outputPack.path, pack: outputPack, priority: 0 },
          contributionEntry!,
        );
      }
      const contribution = parseNativePatchFlowContribution(contributionBytes).contribution;
      const template = parseNativePatchFlowTemplate(templateBytes);
      expect(contribution.template.id).toBe(template.native_patch.package.id);
      expect(contribution.template.version).toBe(template.native_patch.package.version);
      expect(contribution.provenance).toEqual({
        sourcePack: "owner.pack",
        flowFile: "whmmflows\\example_native_mapping.json",
        nodeId: "node_2",
      });
      expect(contribution.inputs.tables.mappings).toEqual([
        { flag: "example_flag", unit_set: "example_unit_set_a" },
        { flag: "example_flag", unit_set: "example_unit_set_b" },
      ]);
    } finally {
      appData.currentGame = previousGame;
      appData.gamesToGameFolderPaths.wh3.gamePath = previousGamePath;
    }
  });

  it.each(["disabled", "pruned", "empty", "failed"])(
    "does not register a %s terminal contribution at startup",
    async (mode) => {
      const graph = makeGraph("whmm_patch_templates/mapping.wh3patchtemplate.json", false, mode === "pruned");
      if (mode === "disabled") graph.nodes.find((node) => node.id === "patch")!.data.isDisabled = true;
      if (mode === "empty") graph.nodeConfigs.rows = { customRows: [], tableName: "mapping_input" };
      if (mode === "failed") graph.connections = graph.connections.filter((edge) => edge.sourceId !== "schema");
      if (mode !== "failed") {
        graph.nodes = graph.nodes.filter((node) => node.id !== "schema");
        graph.connections = graph.connections.filter((edge) => edge.sourceId !== "schema");
        graph.connections.unshift({
          id: "patch-schema-rows",
          sourceId: "patch",
          sourceHandle: "output-schema:mappings",
          targetId: "rows",
          targetHandle: "input-schema",
        });
      }
      const flow = {
        version: "1.0.0",
        timestamp: 0,
        nodes: graph.nodes.map((node) => ({
          ...node,
          data: { ...node.data, ...(graph.nodeConfigs[node.id] as object) },
        })),
        connections: graph.connections,
        options: [],
        isGraphEnabled: true,
        graphStartsEnabled: true,
      };
      templatePack.packedFiles.push({
        name: "whmmflows\\terminal.json",
        text: JSON.stringify(flow),
        file_size: 0,
        start_pos: 0,
      });
      const stats = fs.statSync(templatePackPath);
      templatePack.lastChangedLocal = stats.mtimeMs;
      templatePack.size = stats.size;
      const result = await executeFlowsForPack(templatePackPath, "", {}, "owner.pack", templatePack);
      expect(result.nativePatchContributions).toEqual([]);
      expect(result.createdPackPaths).toEqual([]);
      expect(result.hadErrors).toBe(mode === "failed");
      if (mode === "failed") expect(result.nativePatchFlowError).toBeDefined();
    },
  );

  it("routes declared table rows into an inspectable contribution with source provenance", async () => {
    const graph = makeGraph("whmm_patch_templates/mapping.wh3patchtemplate.json");
    const context = createFlowExecutionContext();
    context.flowSourcePackPath = templatePackPath;
    context.flowSourcePackName = "owner.pack";
    context.flowFileName = "whmmflows/mappings.json";

    const result = await executeNodeGraph({ ...graph, executionContext: context });
    expect(result.success).toBe(true);
    const patchOutput = result.executionResults.get("patch")?.data;
    expect(patchOutput).toMatchObject({ type: "TableSelection", tableCount: 1 });
    const file = patchOutput.tables[0];
    expect(file.outputFileName).toMatch(/^whmm_patch_contributions\/v1\/[a-f0-9]{64}\.wh3patchcontrib\.json$/);
    const contribution = parseNativePatchFlowContribution(file.table.buffer).contribution;
    expect(contribution.provenance).toEqual({
      sourcePack: "owner.pack",
      flowFile: "whmmflows/mappings.json",
      nodeId: "patch",
    });
    expect(contribution.inputs.tables.mappings).toEqual([{ flag: "flag_alpha", unit_set: "set_alpha" }]);
  });

  it("feeds its declared schema into rows that connect back to the same Native Patch", async () => {
    const graph = makeGraph("whmm_patch_templates/mapping.wh3patchtemplate.json");
    graph.nodes = graph.nodes.filter((node) => node.id !== "schema");
    graph.nodes.find((node) => node.id === "patch")!.data.tableSchemas = {
      mappings: [{ name: "stale_editor_column", type: "Boolean" }],
    };
    graph.connections = graph.connections.filter((edge) => edge.sourceId !== "schema");
    graph.connections.unshift({
      id: "schema-from-patch",
      sourceId: "patch",
      sourceHandle: "output-schema:mappings",
      targetId: "rows",
      targetHandle: "input-schema",
    });
    const context = createFlowExecutionContext();
    context.flowSourcePackPath = templatePackPath;
    const result = await executeNodeGraph({ ...graph, executionContext: context });
    expect(result.success).toBe(true);
    expect(result.totalExecuted).toBe(2);
    expect(
      result.executionResults.get("rows")?.data.tables[0].table.tableSchema.fields.map((field: any) => field.name),
    ).toEqual(["flag", "unit_set"]);
    const output = result.executionResults.get("patch")?.data.tables[0];
    expect(parseNativePatchFlowContribution(output.table.buffer).contribution.inputs.tables.mappings).toEqual([
      { flag: "flag_alpha", unit_set: "set_alpha" },
    ]);
  });

  it("reports a deleted schema output instead of using cached editor columns", async () => {
    const graph = makeGraph("whmm_patch_templates/mapping.wh3patchtemplate.json");
    graph.nodes = graph.nodes.filter((node) => node.id !== "schema");
    graph.connections = graph.connections.filter((edge) => edge.sourceId !== "schema");
    graph.connections.unshift({
      id: "missing-schema",
      sourceId: "patch",
      sourceHandle: "output-schema:removed",
      targetId: "rows",
      targetHandle: "input-schema",
    });
    const context = createFlowExecutionContext();
    context.flowSourcePackPath = templatePackPath;
    const result = await executeNodeGraph({ ...graph, executionContext: context });
    expect(result.success).toBe(false);
    expect(result.executionResults.get("rows")?.error).toContain("no table input 'removed'");
    expect(result.executionResults.has("patch")).toBe(false);
  });

  it("keeps the output path stable when values change and separates flow identities", async () => {
    const graph = makeGraph("whmm_patch_templates/mapping.wh3patchtemplate.json");
    const run = async (flowFileName: string, unitSet: string) => {
      graph.nodeConfigs.rows = { customRows: [{ flag: "flag_alpha", unit_set: unitSet }], tableName: "mapping_input" };
      const context = createFlowExecutionContext();
      context.flowSourcePackPath = templatePackPath;
      context.flowSourcePackName = "owner.pack";
      context.flowFileName = flowFileName;
      const result = await executeNodeGraph({ ...graph, executionContext: context });
      expect(result.success).toBe(true);
      return result.executionResults.get("patch")?.data.tables[0];
    };

    const first = await run("whmmflows/first.json", "set_one");
    const changedTemplate = makeTemplate("test.mapping.v2", "2.0.0");
    const changedTemplateBytes = Buffer.from(JSON.stringify(changedTemplate));
    fs.writeFileSync(templatePackPath, changedTemplateBytes);
    templatePack.packedFiles = [
      {
        name: "whmm_patch_templates/mapping.wh3patchtemplate.json",
        start_pos: 0,
        file_size: changedTemplateBytes.length,
      },
    ];
    const updated = await run("whmmflows/first.json", "set_two");
    const otherFlow = await run("whmmflows/second.json", "set_two");
    expect(updated.outputFileName).toBe(first.outputFileName);
    expect(otherFlow.outputFileName).not.toBe(first.outputFileName);
    expect(parseNativePatchFlowContribution(updated.table.buffer).contribution.inputs.tables.mappings[0].unit_set).toBe(
      "set_two",
    );
  });

  it("rejects two connections to one named table socket", async () => {
    const graph = makeGraph("whmm_patch_templates/mapping.wh3patchtemplate.json", true);
    const result = await executeNodeGraph({ ...graph, executionContext: createFlowExecutionContext() });
    expect(result.success).toBe(false);
    expect(
      [...result.executionResults.values()].some((node) => node.error?.includes("more than one incoming connection")),
    ).toBe(true);
  });

  it("rejects a connected table ID that the selected template does not declare", async () => {
    const context = createFlowExecutionContext();
    context.flowSourcePackPath = templatePackPath;
    const result = await executeNodeAction({
      nodeId: "patch",
      nodeType: "nativepatch",
      textValue: "",
      config: { templatePath: "whmm_patch_templates/mapping.wh3patchtemplate.json" },
      inputData: { type: "NativePatchFlowInputs", tables: { stale_id: { type: "TableSelection", tables: [] } } },
      executionContext: context,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("no table input 'stale_id'");
  });

  it("resolves an explicitly selected template pack from mod metadata when the read cache is empty", async () => {
    const previousPacksData = appData.packsData;
    const previousAllMods = appData.allMods;
    appData.packsData = [];
    appData.allMods = [{ name: "remote_templates.pack", path: templatePackPath, isDeleted: false } as any];
    try {
      const result = await executeNodeAction({
        nodeId: "patch",
        nodeType: "nativepatch",
        textValue: "",
        config: {
          selectedPackName: "remote_templates.pack",
          templatePath: "whmm_patch_templates/mapping.wh3patchtemplate.json",
          tableBindings: ["mappings"],
        },
        inputData: {
          type: "NativePatchFlowInputs",
          tables: {
            mappings: { type: "TableSelection", tables: [], sourceFiles: [], tableCount: 0 },
          },
        },
      });
      expect(result.success).toBe(true);
      expect(packMocks.readPack).toHaveBeenCalledWith(templatePackPath, expect.any(Object));
    } finally {
      appData.packsData = previousPacksData;
      appData.allMods = previousAllMods;
    }
  });

  it("preserves both provider names in native merge errors", async () => {
    const template = parseNativePatchFlowTemplate(Buffer.from(JSON.stringify(makeTemplate())));
    const createProviderPack = (filename: string, sourcePack: string, unitSet: string) => {
      const contribution = createNativePatchFlowContribution({
        template,
        inputs: normalizeNativePatchFlowInputs(
          template,
          {},
          { mappings: [{ flag: "shared_flag", unit_set: unitSet }] },
        ),
        provenance: { sourcePack, flowFile: "whmmflows/mapping.json", nodeId: sourcePack },
        payloads: [],
      });
      const bytes = Buffer.from(JSON.stringify(contribution));
      const packPath = path.join(temporaryDirectory, filename);
      fs.writeFileSync(packPath, bytes);
      return {
        path: packPath,
        priority: 0,
        displayName: `container for ${sourcePack}`,
        pack: {
          path: packPath,
          packedFiles: [
            {
              name: `whmm_patch_contributions/v1/${filename}.wh3patchcontrib.json`,
              start_pos: 0,
              file_size: bytes.length,
            },
          ],
        },
      };
    };

    let failure: unknown;
    try {
      await buildNativePatchLaunchPlan({
        runId: "provider-error",
        targetPath: "unused-for-unhashed-fixture.exe",
        enabledPacks: [
          createProviderPack("provider_one.pack", "Source Mod One", "set_one"),
          createProviderPack("provider_two.pack", "Source Mod Two", "set_two"),
        ],
        effectiveContentPacks: [],
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(NativePatchPackageError);
    const packageError = failure as NativePatchPackageError;
    expect(packageError.packages.map((item) => item.sourceModName)).toEqual(["Source Mod One", "Source Mod Two"]);
    const userMessage = nativePatchUserMessage(packageError.packages, "stopped");
    expect(userMessage).toContain("“Source Mod One”");
    expect(userMessage).toContain("“Source Mod Two”");
  });

  it("does not execute a native patch whose control-flow branch was pruned", async () => {
    const graph = makeGraph("whmm_patch_templates/mapping.wh3patchtemplate.json", false, true);
    const result = await executeNodeGraph({ ...graph, executionContext: createFlowExecutionContext() });
    expect(result.success).toBe(true);
    expect(result.skippedNodeIds).toContain("patch");
    expect(result.executionResults.has("patch")).toBe(false);
    expect(packMocks.readPack).not.toHaveBeenCalled();
  });

  it("skips a disabled native patch without loading its template", async () => {
    const result = await executeNodeGraph({
      nodes: [{ id: "patch", type: "nativepatch", data: { type: "nativepatch", isDisabled: true } }] as any[],
      connections: [],
    });
    expect(result.success).toBe(true);
    expect(result.skippedNodeIds).toContain("patch");
    expect(packMocks.readPack).not.toHaveBeenCalled();
  });

  it("treats an empty declared table input as a no-op contribution", async () => {
    const context = createFlowExecutionContext();
    context.flowSourcePackPath = templatePackPath;
    context.flowSourcePackName = "owner.pack";
    const result = await executeNodeAction({
      nodeId: "patch",
      nodeType: "nativepatch",
      textValue: "",
      config: { templatePath: "whmm_patch_templates/mapping.wh3patchtemplate.json", tableBindings: ["mappings"] },
      inputData: {
        type: "NativePatchFlowInputs",
        tables: { mappings: { type: "TableSelection", tables: [], sourceFiles: [], tableCount: 0 } },
      },
      executionContext: context,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ type: "TableSelection", tables: [], tableCount: 0, sourceFiles: [] });
  });

  it("persists the selected template and declaration bindings through graph serialization", () => {
    const node = {
      id: "patch",
      type: "nativepatch",
      position: { x: 0, y: 0 },
      data: {
        label: "Native Patch",
        type: "nativepatch",
        selectedPackName: "shared_templates.pack",
        templatePath: "whmm_patch_templates/mapping.wh3patchtemplate.json",
        scalarValues: { include_all: true },
        scalarOptionBindings: { include_all: "option_toggle" },
        tableBindings: ["mappings"],
        outputType: "TableSelection",
      },
    } as any;
    const serialized = serializeNodeGraphState({
      nodes: [node],
      edges: [],
      flowOptions: [],
      isGraphEnabled: true,
      graphStartsEnabled: true,
    });
    const execution = prepareGraphForExecution({
      nodes: serialized.nodes as any,
      edges: [],
      flowOptions: [{ id: "option_toggle", name: "Include all", type: "checkbox", value: false }],
    });
    expect(serialized.nodes[0].data).toMatchObject({
      selectedPackName: "shared_templates.pack",
      templatePath: "whmm_patch_templates/mapping.wh3patchtemplate.json",
      tableBindings: ["mappings"],
    });
    expect((execution.nodes[0].data as any).scalarValues.include_all).toBe(false);
    expect(JSON.parse(serializeNodeConfigForExecution(execution.nodes[0] as any))).toMatchObject({
      selectedPackName: "shared_templates.pack",
      tableBindings: ["mappings"],
      scalarValues: { include_all: false },
    });
  });

  it("normalizes multiline scalar option bindings for a manual execution", () => {
    const prepared = prepareGraphForExecution({
      nodes: [
        {
          id: "patch",
          type: "nativepatch",
          position: { x: 0, y: 0 },
          data: {
            label: "Native Patch",
            type: "nativepatch",
            templatePath: "whmm_patch_templates/mapping.wh3patchtemplate.json",
            scalarValues: { keys: ["stale"] },
            scalarOptionBindings: { keys: "unit_keys" },
            tableBindings: [],
          },
        },
      ] as any[],
      edges: [],
      flowOptions: [{ id: "unit_keys", name: "Unit keys", type: "multiline", value: " alpha \n\n beta\n" }],
    });
    expect((prepared.nodes[0].data as any).scalarValues.keys).toEqual(["alpha", "beta"]);
  });

  it("aborts startup flow execution when an upstream node feeding Native Patch fails", async () => {
    const flow = {
      version: "1",
      timestamp: Date.now(),
      nodes: [
        {
          id: "rows",
          type: "customrowsinput",
          position: { x: 0, y: 0 },
          data: { type: "customrowsinput", customRows: [], tableName: "mapping_input" },
        },
        {
          id: "patch",
          type: "nativepatch",
          position: { x: 100, y: 0 },
          data: {
            type: "nativepatch",
            templatePath: "whmm_patch_templates/mapping.wh3patchtemplate.json",
            tableBindings: ["mappings"],
          },
        },
      ],
      connections: [
        {
          id: "rows-patch",
          sourceId: "rows",
          sourceHandle: "output",
          targetId: "patch",
          targetHandle: "input-table:mappings",
        },
      ],
      options: [],
      metadata: { nodeCount: 2, connectionCount: 1 },
      isGraphEnabled: true,
      graphStartsEnabled: true,
    };
    templatePack.packedFiles.push({
      name: "whmmflows\\upstream_failure.json",
      text: JSON.stringify(flow),
      file_size: 0,
      start_pos: 0,
    });
    const stats = fs.statSync(templatePackPath);
    templatePack.lastChangedLocal = stats.mtimeMs;
    templatePack.size = stats.size;

    const result = await executeFlowsForPack(templatePackPath, "", {}, "owner.pack", templatePack);
    expect(result.hadErrors).toBe(true);
    expect(result.nativePatchFlowError).toContain("owner.pack :: whmmflows\\upstream_failure.json :: node patch:");
    expect(result.nativePatchFlowError).toContain("Expected CustomSchema data");
  });

  it("aborts startup flow execution when Save Changes downstream of Native Patch fails", async () => {
    const blockedGamePath = path.join(temporaryDirectory, "not-a-directory");
    fs.writeFileSync(blockedGamePath, "file");
    const previousGame = appData.currentGame;
    const previousGamePath = appData.gamesToGameFolderPaths.wh3.gamePath;
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = blockedGamePath;
    const flow = {
      version: "1",
      timestamp: Date.now(),
      nodes: [
        {
          id: "schema",
          type: "customschema",
          position: { x: 0, y: 0 },
          data: {
            type: "customschema",
            schemaColumns: [
              { name: "flag", type: "StringU8" },
              { name: "unit_set", type: "StringU8" },
            ],
          },
        },
        {
          id: "rows",
          type: "customrowsinput",
          position: { x: 100, y: 0 },
          data: {
            type: "customrowsinput",
            customRows: [{ flag: "flag_alpha", unit_set: "set_alpha" }],
            tableName: "mapping_input",
          },
        },
        {
          id: "patch",
          type: "nativepatch",
          position: { x: 200, y: 0 },
          data: {
            type: "nativepatch",
            templatePath: "whmm_patch_templates/mapping.wh3patchtemplate.json",
            tableBindings: ["mappings"],
          },
        },
        {
          id: "save",
          type: "savechanges",
          position: { x: 300, y: 0 },
          data: { type: "savechanges", packName: "broken-save", openInWindows: false },
        },
      ],
      connections: [
        { id: "schema-rows", sourceId: "schema", sourceHandle: "output", targetId: "rows", targetHandle: "input" },
        {
          id: "rows-patch",
          sourceId: "rows",
          sourceHandle: "output",
          targetId: "patch",
          targetHandle: "input-table:mappings",
        },
        { id: "patch-save", sourceId: "patch", sourceHandle: "output", targetId: "save", targetHandle: "input" },
      ],
      options: [],
      metadata: { nodeCount: 4, connectionCount: 3 },
      isGraphEnabled: true,
      graphStartsEnabled: true,
    };
    templatePack.packedFiles.push({
      name: "whmmflows\\save_failure.json",
      text: JSON.stringify(flow),
      file_size: 0,
      start_pos: 0,
    });
    const stats = fs.statSync(templatePackPath);
    templatePack.lastChangedLocal = stats.mtimeMs;
    templatePack.size = stats.size;

    try {
      const result = await executeFlowsForPack(templatePackPath, "", {}, "owner.pack", templatePack);
      expect(result.hadErrors).toBe(true);
      expect(result.nativePatchFlowError).toContain("owner.pack :: whmmflows\\save_failure.json :: node patch:");
      expect(result.nativePatchFlowError).toContain("ENOTDIR");
    } finally {
      appData.currentGame = previousGame;
      appData.gamesToGameFolderPaths.wh3.gamePath = previousGamePath;
    }
  });
});
