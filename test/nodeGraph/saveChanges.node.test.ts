import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { executeNodeAction } from "../../src/nodeExecutor";
import { readPackHeader } from "../../src/packFileHandler";
import { createFlowExecutionContext } from "../../src/flowExecutionSupport";
import { getPacksTableData, readPack } from "../../src/packFileSerializer";
import { DBNameToDBVersions } from "../../src/schema";
import { parseEditedCellValue } from "../../src/utility/dbRowCells";
import type { DBVersion, Pack, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

let outputDirectory: string | undefined;
const originalCurrentGame = appData.currentGame;
const originalGamePath = appData.gamesToGameFolderPaths.wh3.gamePath;
const originalMainUnitsSchema = DBNameToDBVersions.wh3.main_units_tables;

beforeEach(() => {
  vi.mocked(shell.openPath).mockReset().mockResolvedValue("");
});

afterEach(async () => {
  appData.currentGame = originalCurrentGame;
  appData.gamesToGameFolderPaths.wh3.gamePath = originalGamePath;
  if (originalMainUnitsSchema) DBNameToDBVersions.wh3.main_units_tables = originalMainUnitsSchema;
  else delete DBNameToDBVersions.wh3.main_units_tables;
  if (outputDirectory) {
    await rm(outputDirectory, { recursive: true, force: true });
    outputDirectory = undefined;
  }
});

const executeTextSave = async (
  executionContext?: ReturnType<typeof createFlowExecutionContext>,
  inputData: any = { type: "Text", text: "saved text" },
) => {
  outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
  appData.currentGame = "wh3";
  appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

  return executeNodeAction({
    nodeId: "save_changes_1",
    nodeType: "savechanges",
    textValue: "",
    config: {
      packName: "manual-output",
      packedFileName: "output.txt",
      openInWindows: true,
    },
    inputData,
    executionContext,
  });
};

const moviePackOutputInputs = [
  {
    name: "text",
    inputData: { type: "Text", text: "saved text" },
  },
  {
    name: "table selection",
    inputData: {
      type: "TableSelection",
      tables: [
        {
          name: "script\\movie.lua",
          fileName: "script\\movie.lua",
          sourceFile: {} as Pack,
          table: {
            name: "script\\movie.lua",
            file_size: 4,
            start_pos: 0,
            buffer: Buffer.from("data"),
          } as PackedFile,
          outputFileName: "script\\movie.lua",
        },
      ],
      sourceFiles: [],
      tableCount: 1,
    },
  },
  {
    name: "changed column selection",
    inputData: {
      type: "ChangedColumnSelection",
      adjustedInputData: {
        columns: [
          {
            fileName: "db\\main_units_tables\\source",
            sourcePack: { name: "source.pack", path: "source.pack" },
            sourceTable: {
              version: 1,
              tableSchema: {
                version: 1,
                fields: [
                  {
                    name: "key",
                    field_type: "StringU8",
                    is_key: true,
                    default_value: "",
                    is_filename: false,
                    is_reference: [],
                    description: "",
                    ca_order: 0,
                    is_bitwise: 0,
                    enum_values: {},
                  },
                ],
              },
              schemaFields: [
                {
                  name: "key",
                  type: "StringU8",
                  fields: [{ type: "String", val: "movie_key" }],
                  resolvedKeyValue: "movie_key",
                  isKey: true,
                },
              ],
            },
          },
        ],
      },
      originalData: { columns: [] },
      appliedFormula: "test",
    },
  },
] as const;

describe("save changes node", () => {
  it("treats an empty TableSelection as a successful no-op", async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const result = await executeNodeAction({
      nodeId: "save_changes_empty",
      nodeType: "savechanges",
      textValue: "",
      config: { packName: "empty-output", openInWindows: false },
      inputData: {
        type: "TableSelection",
        tables: [],
        sourceFiles: [],
        tableCount: 0,
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        type: "SaveResult",
        savedTo: "",
        message: "No changes to save",
      }),
    );
  });

  it("opens a newly saved pack after a manual editor run when enabled", async () => {
    const result = await executeTextSave();

    expect(result.success).toBe(true);
    expect(shell.openPath).toHaveBeenCalledOnce();
    expect(shell.openPath).toHaveBeenCalledWith(
      path.join(outputDirectory as string, "whmm_flows", "manual-output.pack"),
    );
  });

  it("does not open a newly saved pack during an automatic flow run", async () => {
    const result = await executeTextSave(createFlowExecutionContext());

    expect(result.success).toBe(true);
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it.each(moviePackOutputInputs)(
    "opens a saved $name pack for a manual run with an execution context",
    async ({ inputData }) => {
      const context = createFlowExecutionContext();
      context.isManualRun = true;
      const result = await executeTextSave(context, inputData);
      expect(result.success).toBe(true);
      expect(shell.openPath).toHaveBeenCalledWith((result.data as { savedTo: string }).savedTo);
    },
  );

  it.each([false, true])(
    "regenerates output between manual runs but merges saves within one run (shared context=%s)",
    async (sharedContext) => {
      outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-repeat-flow-"));
      appData.currentGame = "wh3";
      appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;
      const schema = {
        version: 7,
        fields: [
          { name: "unit", field_type: "StringU8", is_key: true },
          { name: "cost", field_type: "I32", is_key: false },
        ],
      } as DBVersion;
      DBNameToDBVersions.wh3.main_units_tables = [schema];
      const newContext = () => ({ ...createFlowExecutionContext(), isManualRun: true });
      const context = newContext();
      const savedTo = path.join(outputDirectory, "data", "repeat-output.pack");
      for (let index = 0; index < 2; index++) {
        const unit = sharedContext && index === 1 ? "another_unit" : "teb_origo";
        const result = await executeNodeAction({
          nodeId: `save_${index}`,
          nodeType: "savechanges",
          textValue: "",
          config: { packName: "repeat-output", openInWindows: false },
          executionContext: sharedContext ? context : newContext(),
          inputData: {
            type: "TableSelection",
            sourceFiles: [],
            tableCount: 1,
            tables: [
              {
                name: "db\\main_units_tables",
                fileName: "db\\main_units_tables\\source",
                sourceFile: {} as Pack,
                table: {
                  name: "db\\main_units_tables\\source",
                  version: 7,
                  tableSchema: schema,
                  schemaFields: [
                    { name: "unit", ...parseEditedCellValue("StringU8", unit) },
                    { name: "cost", ...parseEditedCellValue("I32", (index + 1) * 10) },
                  ],
                } as PackedFile,
              },
            ],
          },
        });
        expect(result.success).toBe(true);
      }
      const pack = await readPack(savedTo, { tablesToRead: ["db\\main_units_tables"] });
      getPacksTableData([pack], ["db\\main_units_tables"]);
      const cells = pack.packedFiles.flatMap((file) => file.schemaFields || []);
      expect(
        cells
          .filter((cell) => cell.name === "unit")
          .map((cell) => cell.resolvedKeyValue)
          .sort(),
      ).toEqual(sharedContext ? ["another_unit", "teb_origo"] : ["teb_origo"]);
      expect(
        cells
          .filter((cell) => cell.name === "cost")
          .map((cell) => cell.resolvedKeyValue)
          .sort(),
      ).toEqual(sharedContext ? ["10", "20"] : ["20"]);
      expect(pack.packedFiles).toHaveLength(sharedContext ? 2 : 1);
    },
  );

  it("preserves prior raw native patch contributions when appending to an existing output pack", async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const rawContribution = (name: string, contents: string) => ({
      name,
      fileName: name,
      sourceFile: { name: "template.pack", path: "template.pack" } as Pack,
      outputFileName: name,
      table: { name, file_size: contents.length, start_pos: 0, buffer: Buffer.from(contents) },
    });
    const saveContribution = (nodeId: string, file: ReturnType<typeof rawContribution>) =>
      executeNodeAction({
        nodeId,
        nodeType: "savechanges",
        textValue: "",
        config: { packName: "native-contributions", openInWindows: false },
        inputData: { type: "TableSelection", tables: [file], sourceFiles: [], tableCount: 1 },
      });

    const firstName = "whmm_patch_contributions/v1/first.wh3patchcontrib.json";
    const secondName = "whmm_patch_contributions/v1/second.wh3patchcontrib.json";
    expect((await saveContribution("save_first", rawContribution(firstName, '{"provider":1}'))).success).toBe(true);
    expect((await saveContribution("save_second", rawContribution(secondName, '{"provider":2}'))).success).toBe(true);

    const outputPackPath = path.join(outputDirectory, "data", "native-contributions.pack");
    const savedPack = await readPack(outputPackPath, { skipParsingTables: true });
    expect(savedPack.packedFiles.map((file) => file.name)).toEqual(expect.arrayContaining([firstName, secondName]));
  });

  it.each(moviePackOutputInputs)("writes $name output as a movie pack when enabled", async ({ name, inputData }) => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const result = await executeNodeAction({
      nodeId: `save_changes_movie_${name.replaceAll(" ", "_")}`,
      nodeType: "savechanges",
      textValue: "",
      config: { packName: `movie-${name.replaceAll(" ", "-")}`, openInWindows: false, saveAsMoviePack: true },
      inputData,
    });

    expect(result.success).toBe(true);
    const saveData = result.data as DBSaveChangesNodeData;
    await expect(readPackHeader(saveData.savedTo)).resolves.toMatchObject({ isMovie: true });
  });

  it("keeps text output as a regular mod pack by default", async () => {
    const result = await executeTextSave();

    expect(result.success).toBe(true);
    const saveData = result.data as DBSaveChangesNodeData;
    await expect(readPackHeader(saveData.savedTo)).resolves.toMatchObject({ isMovie: false });
  });

  it("routes a table carrying an output path prefix outside db\\, leaving other tables untouched", async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const tableSchema = {
      version: 1,
      fields: [
        {
          name: "key",
          field_type: "StringU8",
          is_key: true,
          default_value: "",
          is_filename: false,
          is_reference: [],
          description: "",
          ca_order: 0,
          is_bitwise: 0,
          enum_values: {},
        },
      ],
    } as DBVersion;

    const createTable = (name: string, value: string, outputPathPrefix?: string, outputPathSuffix?: string) => ({
      name,
      fileName: `db\\${name}\\data__`,
      sourceFile: {} as Pack,
      table: {
        name: `db\\${name}\\data__`,
        file_size: 0,
        start_pos: 0,
        version: 1,
        tableSchema,
        schemaFields: [
          {
            name: "key",
            type: "StringU8" as const,
            fields: [{ type: "String" as const, val: value }],
            resolvedKeyValue: value,
            isKey: true,
          },
        ],
      } as PackedFile,
      outputPathPrefix,
      outputPathSuffix,
    });

    const result = await executeNodeAction({
      nodeId: "save_changes_2",
      nodeType: "savechanges",
      textValue: "",
      config: { packName: "table-output", openInWindows: false },
      inputData: {
        type: "TableSelection",
        tables: [
          createTable("main_units_tables", "my_new_unit"),
          createTable("deepclone_loc", "some_loc_key", "text\\db\\", ".loc"),
        ],
        sourceFiles: [],
        tableCount: 2,
      },
    });

    expect(result.success).toBe(true);

    const savedPack = await readPack(path.join(outputDirectory, "data", "table-output.pack"), {
      skipParsingTables: true,
    });
    const savedNames = savedPack.packedFiles.map((packedFile) => packedFile.name);

    expect(savedNames.some((name) => /^text\\db\\table-output_[a-z0-9]+\.loc$/.test(name))).toBe(true);
    expect(savedNames.some((name) => /^db\\main_units_tables\\table-output_[a-z0-9]+$/.test(name))).toBe(true);
  });

  it("writes a raw payload at its exact path when the table names one", async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const artPath = "ui\\units\\minspec_portholes\\my_new_unit.png";
    const artBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await executeNodeAction({
      nodeId: "save_changes_3",
      nodeType: "savechanges",
      textValue: "",
      config: { packName: "art-output", openInWindows: false },
      inputData: {
        type: "TableSelection",
        tables: [
          {
            name: artPath,
            fileName: artPath,
            sourceFile: {} as Pack,
            table: { name: artPath, file_size: artBytes.length, start_pos: 0, buffer: artBytes } as PackedFile,
            outputFileName: artPath,
          },
        ],
        sourceFiles: [],
        tableCount: 1,
      },
    });

    expect(result.success).toBe(true);

    const savedPack = await readPack(path.join(outputDirectory, "data", "art-output.pack"), {
      skipParsingTables: true,
      filesToRead: [artPath],
    });
    const savedFile = savedPack.packedFiles.find((packedFile) => packedFile.name === artPath);

    // The name must survive verbatim: the game finds this file by the unit key, not by a generated name.
    expect(savedFile).toBeDefined();
    expect(savedFile?.buffer).toEqual(artBytes);
  });

  it("reports the packs it replaces, so the mod list can leave the originals out", async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const copiedFile = (name: string, replacesSourcePackPath?: string) => ({
      name,
      fileName: name,
      sourceFile: {} as Pack,
      table: {
        name,
        file_size: 4,
        start_pos: 0,
        buffer: Buffer.from("data"),
      } as PackedFile,
      outputFileName: name,
      replacesSourcePackPath,
    });

    const result = await executeNodeAction({
      nodeId: "save_changes_4",
      nodeType: "savechanges",
      textValue: "",
      config: { packName: "replacement-output", openInWindows: false },
      inputData: {
        type: "TableSelection",
        tables: [
          copiedFile("script\\a.lua", "C:\\game\\data\\my_mod.pack"),
          copiedFile("script\\b.lua", "C:\\game\\data\\my_mod.pack"),
          copiedFile("script\\c.lua", "C:\\game\\data\\other_mod.pack"),
          // Not part of any pack copy, so it must not make a pack look replaced.
          copiedFile("ui\\generated.png"),
        ],
        sourceFiles: [],
        tableCount: 4,
      },
    });

    expect(result.success).toBe(true);
    const saveData = result.data as DBSaveChangesNodeData;
    expect(saveData.replacedPackPaths?.toSorted()).toEqual([
      "C:\\game\\data\\my_mod.pack",
      "C:\\game\\data\\other_mod.pack",
    ]);
    // A manual run has no mod list to fix up, so the message has to say it.
    expect(saveData.message).toContain("disable the original");
  });

  it("uses the original pack name when writing a single pack replacement", async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const originalPackPath = "C:\\workshop\\content\\123\\my_mod.pack";
    const result = await executeNodeAction({
      nodeId: "save_changes_replacement_name",
      nodeType: "savechanges",
      textValue: "",
      config: { packName: "configured-output-name", openInWindows: false },
      inputData: {
        type: "TableSelection",
        tables: [
          {
            name: "script\\changed.lua",
            fileName: "script\\changed.lua",
            sourceFile: {} as Pack,
            table: {
              name: "script\\changed.lua",
              file_size: 4,
              start_pos: 0,
              buffer: Buffer.from("data"),
            } as PackedFile,
            outputFileName: "script\\changed.lua",
            replacesSourcePackPath: originalPackPath,
          },
        ],
        sourceFiles: [],
        tableCount: 1,
      },
    });

    expect(result.success).toBe(true);
    const saveData = result.data as DBSaveChangesNodeData;
    expect(saveData.savedTo).toBe(path.join(outputDirectory, "data", "my_mod.pack"));
    expect(saveData.replacedPackPaths).toEqual([originalPackPath]);
    await expect(readPack(saveData.savedTo, { skipParsingTables: true })).resolves.toEqual(
      expect.objectContaining({ name: "my_mod.pack" }),
    );
  });

  it("reports nothing replaced when no table claims to stand in for a pack", async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-save-changes-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const artPath = "ui\\generated.png";
    const result = await executeNodeAction({
      nodeId: "save_changes_5",
      nodeType: "savechanges",
      textValue: "",
      config: { packName: "plain-output", openInWindows: false },
      inputData: {
        type: "TableSelection",
        tables: [
          {
            name: artPath,
            fileName: artPath,
            sourceFile: {} as Pack,
            table: { name: artPath, file_size: 4, start_pos: 0, buffer: Buffer.from("data") } as PackedFile,
            outputFileName: artPath,
          },
        ],
        sourceFiles: [],
        tableCount: 1,
      },
    });

    expect(result.success).toBe(true);
    const saveData = result.data as DBSaveChangesNodeData;
    expect(saveData.replacedPackPaths).toEqual([]);
    expect(saveData.message).not.toContain("Replaces");
  });
});
