import { describe, expect, it, vi } from "vitest";

import { executeDeepClonePlan, parseFilenameRelativePaths, replaceKeyInValue } from "../../src/flowDeepClone";
import { chunkSchemaIntoRows } from "../../src/packFileSerializer";
import type { AmendedSchemaField, DBField, DBVersion, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

describe("parseFilenameRelativePaths", () => {
  it("converts the schema's forward slashes to pack separators", () => {
    expect(parseFilenameRelativePaths("variantmeshes/variantmeshdefinitions/%.variantmeshdefinition")).toEqual([
      "variantmeshes\\variantmeshdefinitions\\%.variantmeshdefinition",
    ]);
  });

  it("splits the semicolon-separated form into one pattern per file", () => {
    // unit_variants_tables.unit_card names an icon and three masks in a single field.
    expect(
      parseFilenameRelativePaths("ui/units/icons/%.png;ui/units/mask/%_mask1.png;ui/units/mask/%_mask2.png"),
    ).toEqual(["ui\\units\\icons\\%.png", "ui\\units\\mask\\%_mask1.png", "ui\\units\\mask\\%_mask2.png"]);
  });

  it("keeps the wildcard form intact for the caller to resolve", () => {
    expect(parseFilenameRelativePaths("%/*")).toEqual(["%\\*"]);
  });

  it("ignores fields that declare no path", () => {
    expect(parseFilenameRelativePaths(null)).toEqual([]);
    expect(parseFilenameRelativePaths(undefined)).toEqual([]);
    expect(parseFilenameRelativePaths("")).toEqual([]);
    expect(parseFilenameRelativePaths("   ")).toEqual([]);
  });
});

describe("replaceKeyInValue", () => {
  it("swaps the row's key inside a path the cell already holds", () => {
    expect(
      replaceKeyInValue("variantmeshes/wh_variantmodels/emp/emp_spearmen", "emp_spearmen", "abc_emp_spearmen"),
    ).toBe("variantmeshes/wh_variantmodels/emp/abc_emp_spearmen");
  });

  it("replaces a bare value outright", () => {
    expect(replaceKeyInValue("emp_spearmen", "emp_spearmen", "abc_emp_spearmen")).toBe("abc_emp_spearmen");
  });

  it("replaces every occurrence", () => {
    expect(replaceKeyInValue("a/emp/emp", "emp", "new")).toBe("a/new/new");
  });

  it("leaves a value that does not contain the key unchanged", () => {
    // The caller uses this to decide there is no derived name, so it must not invent one.
    expect(replaceKeyInValue("shared/asset", "emp_spearmen", "abc_emp_spearmen")).toBe("shared/asset");
  });

  it("is a no-op without a key", () => {
    expect(replaceKeyInValue("anything", "", "new")).toBe("anything");
  });
});

const meshes = "variantmeshes\\variantmeshdefinitions\\";

const createField = (name: string, options: { isKey?: boolean; filenamePath?: string } = {}): DBField =>
  ({
    name,
    field_type: "StringU8",
    is_key: options.isKey ?? false,
    default_value: "",
    is_filename: options.filenamePath !== undefined,
    filename_relative_path: options.filenamePath ?? null,
    is_reference: [],
    description: "",
    ca_order: 0,
    is_bitwise: 0,
    enum_values: {},
  }) as DBField;

const variantsSchema: DBVersion = {
  version: 6,
  fields: [
    createField("variant_name", { isKey: true }),
    createField("tech_folder", { filenamePath: "%/*" }),
    createField("variant_filename", {
      filenamePath: "variantmeshes/variantmeshdefinitions/%.variantmeshdefinition",
    }),
  ],
};

const createVariantsRow = (values: string[]): AmendedSchemaField[] =>
  variantsSchema.fields.map((field, index) => ({
    name: field.name,
    type: field.field_type,
    fields: [{ type: "String" as const, val: values[index] ?? "" }],
    resolvedKeyValue: values[index] ?? "",
    isKey: field.is_key,
  }));

const runVariantsClone = async (options: {
  rowValues: string[];
  existingFiles?: string[];
  packedFilesUnderPrefix?: Record<string, string[]>;
}) => {
  const rows = [createVariantsRow(options.rowValues)];
  const tableFile = {
    tableName: "variants_tables",
    packedFile: {
      name: "db\\variants_tables\\data__",
      file_size: 0,
      start_pos: 0,
      version: 6,
      tableSchema: variantsSchema,
      schemaFields: rows.flat(),
    } as PackedFile,
    packName: "test.pack",
    packPath: "C:\\test.pack",
  };

  return executeDeepClonePlan(
    [tableFile],
    {
      cloneTree: {
        table: "variants_tables",
        keyColumn: "variant_name",
        linkColumn: "",
        direction: "forward",
        selected: true,
        children: [],
      },
      nameTemplate: "{selfOriginal}_clone",
      useModdersPrefix: false,
      moddersPrefix: "",
      variantAxes: [],
      columnOverrides: [],
      generateLoc: false,
      autoFollowReferences: false,
    },
    {
      loadTable: async () => [tableFile],
      getRows: (packedFile) =>
        chunkSchemaIntoRows(packedFile.schemaFields!, packedFile.tableSchema!) as AmendedSchemaField[][],
      referencedColumnsByTable: {},
      numericIdFieldByTable: {},
      hasPackedFile: (name) => (options.existingFiles ?? []).includes(name),
      listPackedFiles: (prefix) => options.packedFilesUnderPrefix?.[prefix] ?? [],
    },
  );
};

const cellValue = (row: AmendedSchemaField[], columnName: string) =>
  row.find((cell) => cell.name === columnName)?.resolvedKeyValue;

describe("cloning files named through filename_relative_path", () => {
  it("copies the variant mesh definition under the new key and points the cell at it", async () => {
    const result = await runVariantsClone({
      rowValues: ["xyxyxy", "", "xyxyxy"],
      existingFiles: [`${meshes}xyxyxy.variantmeshdefinition`],
    });

    expect(result.fileCopies).toEqual([
      {
        sourceName: `${meshes}xyxyxy.variantmeshdefinition`,
        targetName: `${meshes}xyxyxy_clone.variantmeshdefinition`,
      },
    ]);
    const clonedRow = result.tables.find((table) => table.tableName === "variants_tables")!.rows[0];
    expect(cellValue(clonedRow, "variant_name")).toBe("xyxyxy_clone");
    expect(cellValue(clonedRow, "variant_filename")).toBe("xyxyxy_clone");
  });

  it("leaves the cell pointing at the original when no file exists", async () => {
    const result = await runVariantsClone({ rowValues: ["xyxyxy", "", "xyxyxy"], existingFiles: [] });

    expect(result.fileCopies).toEqual([]);
    const clonedRow = result.tables.find((table) => table.tableName === "variants_tables")!.rows[0];
    // Renaming to a file that is not there would be worse than sharing the original.
    expect(cellValue(clonedRow, "variant_filename")).toBe("xyxyxy");
  });

  it("copies everything under the folder for a wildcard pattern", async () => {
    const sourceFolder = "variantmeshes\\wh_variantmodels\\emp\\xyxyxy";
    const result = await runVariantsClone({
      rowValues: ["xyxyxy", sourceFolder, ""],
      packedFilesUnderPrefix: {
        [`${sourceFolder}\\`]: [`${sourceFolder}\\body.rigid_model_v2`, `${sourceFolder}\\head.rigid_model_v2`],
      },
    });

    expect(result.fileCopies.map((copy) => copy.targetName)).toEqual([
      "variantmeshes\\wh_variantmodels\\emp\\xyxyxy_clone\\body.rigid_model_v2",
      "variantmeshes\\wh_variantmodels\\emp\\xyxyxy_clone\\head.rigid_model_v2",
    ]);
    const clonedRow = result.tables.find((table) => table.tableName === "variants_tables")!.rows[0];
    expect(cellValue(clonedRow, "tech_folder")).toBe("variantmeshes\\wh_variantmodels\\emp\\xyxyxy_clone");
  });

  it("copies a filename that differs from the row key, naming the copy after the new key", async () => {
    // The real variants_tables case: variant_name and variant_filename are unrelated values, so the
    // copy is named after the new key rather than derived from the old filename.
    const result = await runVariantsClone({
      rowValues: ["wh_main_emp_greatswords", "", "emp_greatswords"],
      existingFiles: [`${meshes}emp_greatswords.variantmeshdefinition`],
    });

    expect(result.fileCopies).toEqual([
      {
        sourceName: `${meshes}emp_greatswords.variantmeshdefinition`,
        targetName: `${meshes}wh_main_emp_greatswords_clone.variantmeshdefinition`,
      },
    ]);
    const clonedRow = result.tables.find((table) => table.tableName === "variants_tables")!.rows[0];
    expect(cellValue(clonedRow, "variant_filename")).toBe("wh_main_emp_greatswords_clone");
  });

  it("copies every file a semicolon-separated field names", async () => {
    const iconsSchemaRow = ["wh_main_emp_greatswords", "", "emp_greatswords"];
    const result = await runVariantsClone({
      rowValues: iconsSchemaRow,
      existingFiles: [`${meshes}emp_greatswords.variantmeshdefinition`],
    });

    expect(result.fileCopies).toHaveLength(1);
  });

  it("does nothing for a row that keeps its own key", async () => {
    const result = await runVariantsClone({
      rowValues: ["xyxyxy", "", "xyxyxy"],
      existingFiles: [`${meshes}xyxyxy.variantmeshdefinition`],
    });
    expect(result.fileCopies).toHaveLength(1);

    // Without a lookup the engine cannot tell what exists, so it must not rename the cell.
    const noLookup = await runVariantsClone({ rowValues: ["xyxyxy", "", "xyxyxy"] });
    expect(noLookup.fileCopies).toEqual([]);
  });
});
