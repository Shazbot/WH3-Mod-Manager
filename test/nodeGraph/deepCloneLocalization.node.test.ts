import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { getVanillaLocLookup } from "../../src/ipcMainListeners";
import { executeNodeAction } from "../../src/nodeExecutor";
import type { AmendedSchemaField, DBField, DBVersion, Pack, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createField = (name: string, isKey = false): DBField => ({
  name,
  field_type: "StringU8",
  is_key: isKey,
  default_value: "",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const schema: DBVersion = {
  version: 1,
  fields: [createField("unit", true)],
  localised_fields: [createField("onscreen_name")],
  localised_key_order: [0],
};

const originalCurrentGame = appData.currentGame;
const originalDataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
let gameFolder: string | undefined;

beforeEach(async () => {
  gameFolder = await mkdtemp(path.join(tmpdir(), "whmm-deep-clone-loc-"));
  await writeFile(path.join(gameFolder, "local_en.pack"), "cache-backed test fixture");
  appData.currentGame = "wh3";
  appData.gamesToGameFolderPaths.wh3.dataFolder = gameFolder;
  vi.mocked(getVanillaLocLookup).mockReset();
});

afterEach(async () => {
  appData.currentGame = originalCurrentGame;
  appData.gamesToGameFolderPaths.wh3.dataFolder = originalDataFolder;
  vi.mocked(getVanillaLocLookup).mockReset();
  if (gameFolder) await rm(gameFolder, { recursive: true, force: true });
  gameFolder = undefined;
});

describe("Deep Clone localization lookup", () => {
  it("uses the vanilla localization cache for generated English text", async () => {
    const originalKey = "teb_worship_myrmidia_1";
    const locKey = `main_units_onscreen_name_${originalKey}`;
    const cachedLookup = {
      get: vi.fn((key: string) => (key === locKey ? "Worship of Myrmidia" : undefined)),
    };
    vi.mocked(getVanillaLocLookup).mockResolvedValue({ "vanilla-loc-cache": cachedLookup });

    const rootRow: AmendedSchemaField[] = [
      {
        name: "unit",
        type: "String",
        fields: [{ type: "String", val: originalKey }],
        resolvedKeyValue: originalKey,
        isKey: true,
      },
    ];
    const sourcePack = {
      name: "input.pack",
      path: path.join(gameFolder as string, "input.pack"),
      packedFiles: [],
      packHeader: {} as Pack["packHeader"],
      lastChangedLocal: 0,
      size: 0,
      readTables: "all",
    } as Pack;

    const result = await executeNodeAction({
      nodeId: "deepclone_loc_cache",
      nodeType: "deepclone",
      textValue: "",
      config: {
        cloneTree: {
          table: "main_units_tables",
          keyColumn: "unit",
          linkColumn: "",
          direction: "forward",
          selected: true,
          children: [],
        },
        nameTemplate: "{original}_clone",
        useModdersPrefix: false,
        generateLoc: true,
        autoFollowReferences: false,
      },
      inputData: {
        type: "TableSelection",
        tables: [
          {
            name: "main_units_tables",
            fileName: "db\\main_units_tables\\data__",
            sourceFile: sourcePack,
            table: {
              name: "db\\main_units_tables\\data__",
              file_size: 0,
              start_pos: 0,
              version: 1,
              tableSchema: schema,
              schemaFields: rootRow,
            } as PackedFile,
          },
        ],
        sourceFiles: [],
        tableCount: 1,
      },
    });

    expect(getVanillaLocLookup).toHaveBeenCalledWith([
      path.join(gameFolder as string, "local_en.pack"),
    ]);
    expect(result.success).toBe(true);

    const locTable = (result.data as any).tables.find((table: any) => table.name === "deepclone_loc");
    const textCell = (locTable.table.schemaFields as AmendedSchemaField[]).find((cell) => cell.name === "text");
    expect(textCell?.resolvedKeyValue).toBe("Worship of Myrmidia");
    expect(cachedLookup.get).toHaveBeenCalledWith(locKey);
  });
});
