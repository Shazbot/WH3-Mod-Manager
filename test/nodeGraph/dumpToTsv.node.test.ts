import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { executeNodeAction } from "../../src/nodeExecutor";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createSchemaField = (name: string, value: string | number) => ({
  name,
  type: typeof value === "number" ? "I32" : "StringU8",
  fields: [{ type: typeof value === "number" ? "I32" : "String", val: value }],
  resolvedKeyValue: String(value),
  isKey: name === "key",
});

const createDbField = (name: string, value: string | number) => ({
  name,
  field_type: typeof value === "number" ? "I32" : "StringU8",
  is_key: name === "key",
  default_value: "",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

let outputDirectory: string | undefined;
const originalCurrentGame = appData.currentGame;
const originalGamePath = appData.gamesToGameFolderPaths.wh3.gamePath;

afterEach(async () => {
  appData.currentGame = originalCurrentGame;
  appData.gamesToGameFolderPaths.wh3.gamePath = originalGamePath;
  if (outputDirectory) {
    await rm(outputDirectory, { recursive: true, force: true });
    outputDirectory = undefined;
  }
});

describe("dump to TSV node", () => {
  it("exports complete adjusted rows from ChangedColumnSelection input", async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "whmm-dump-to-tsv-"));
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.gamePath = outputDirectory;

    const columns = ["key", "category", "num_mounts", "num_engines", "rank_depth", "primary_ammo"];
    const adjustedValues: Array<string | number> = ["wh2_dlc09_tmb_cav_hexwraiths", "cavalry", 82, 22, 26, 22];
    const sourceTable = {
      name: "db\\land_units_tables\\data__",
      schemaFields: adjustedValues.map((value, index) => createSchemaField(columns[index], value)),
      tableSchema: {
        version: 1,
        fields: adjustedValues.map((value, index) => createDbField(columns[index], value)),
      },
    };

    const adjustedInputData = {
      type: "ColumnSelection" as const,
      columns: [
        {
          tableName: "db\\land_units_tables",
          fileName: "db\\land_units_tables\\data__",
          sourcePack: {},
          sourceTable,
          selectedColumns: ["num_mounts", "num_engines", "rank_depth", "primary_ammo"],
          // ColumnSelection.data contains the pre-adjustment snapshot. The dump must use sourceTable instead.
          data: [
            { col: "num_mounts", data: "60" },
            { col: "num_engines", data: "0" },
            { col: "rank_depth", data: "4" },
            { col: "primary_ammo", data: "0" },
          ],
        },
      ],
      sourceTables: [],
      selectedColumnCount: 4,
    };

    const result = await executeNodeAction({
      nodeId: "dump_to_tsv_1",
      nodeType: "dumptotsv",
      textValue: "",
      config: { filename: "adjusted_land_units.tsv", openInWindows: false },
      inputData: {
        type: "ChangedColumnSelection",
        adjustedInputData,
        originalData: adjustedInputData,
        appliedFormula: "Merged 4 inputs",
      },
    });

    expect(result.success).toBe(true);
    const output = await readFile(path.join(outputDirectory, "adjusted_land_units.tsv"), "utf8");
    expect(output.split("\n")).toEqual([columns.join("\t"), adjustedValues.join("\t")]);
  });
});
