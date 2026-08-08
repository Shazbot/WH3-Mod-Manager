import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { executeNodeAction } from "../../src/nodeExecutor";
import { createFlowExecutionContext } from "../../src/flowExecutionSupport";
import { readPack } from "../../src/packFileSerializer";
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

beforeEach(() => {
  vi.mocked(shell.openPath).mockReset().mockResolvedValue("");
});

afterEach(async () => {
  appData.currentGame = originalCurrentGame;
  appData.gamesToGameFolderPaths.wh3.gamePath = originalGamePath;
  if (outputDirectory) {
    await rm(outputDirectory, { recursive: true, force: true });
    outputDirectory = undefined;
  }
});

const executeTextSave = async (executionContext?: ReturnType<typeof createFlowExecutionContext>) => {
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
    inputData: {
      type: "Text",
      text: "saved text",
    },
    executionContext,
  });
};

describe("save changes node", () => {
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

    const createTable = (
      name: string,
      value: string,
      outputPathPrefix?: string,
      outputPathSuffix?: string,
    ) => ({
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
    expect(savedNames.some((name) => /^db\\main_units_tables\\table-output_[a-z0-9]+$/.test(name))).toBe(
      true,
    );
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
});
