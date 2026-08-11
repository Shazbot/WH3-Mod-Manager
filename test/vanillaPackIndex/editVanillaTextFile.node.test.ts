import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { executeNodeAction } from "../../src/nodeExecutor";
import { writePack } from "../../src/packFileSerializer";
import { buildVanillaPackIndex } from "../../src/vanillaPackIndex/format";
import { getVanillaPackIndex } from "../../src/vanillaPackIndex/store";
import type { NewPackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));
// The index itself is built from a real pack below; only its lookup up from disk is stubbed, since
// that needs Electron's userData folder.
vi.mock("../../src/vanillaPackIndex/store", () => ({
  getVanillaPackIndex: vi.fn(async () => undefined),
  clearVanillaPackIndexCache: vi.fn(),
}));

const VARIANT_MESH_PATH =
  "variantmeshes\\variantmeshdefinitions\\emp_state_troops_shields_set1.variantmeshdefinition";

const vanillaContent = `<VARIANT_MESH>
\t<SLOT name="shield">
\t\t<VARIANT_MESH model="VariantMeshes/wh_variantmodels/hu1/emp/emp_props/emp_state_troops_shield_01.wsmodel">
\t\t\t<META_DATA>equipment</META_DATA>
\t\t</VARIANT_MESH>
\t</SLOT>
</VARIANT_MESH>`;

let dataFolder: string | undefined;
const originalCurrentGame = appData.currentGame;
const originalDataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
const originalVanillaPackNames = appData.allVanillaPackNames;
const originalEnabledMods = appData.enabledMods;

afterEach(async () => {
  appData.currentGame = originalCurrentGame;
  appData.gamesToGameFolderPaths.wh3.dataFolder = originalDataFolder;
  appData.allVanillaPackNames = originalVanillaPackNames;
  appData.enabledMods = originalEnabledMods;
  if (dataFolder) {
    await rm(dataFolder, { recursive: true, force: true });
    dataFolder = undefined;
  }
});

/** A data folder with one real vanilla pack in it, plus the index that describes it. */
const setUpVanillaPack = async (contents: Array<{ name: string; text: string }>) => {
  dataFolder = await mkdtemp(path.join(tmpdir(), "whmm-vanilla-index-"));
  appData.currentGame = "wh3";
  appData.gamesToGameFolderPaths.wh3.dataFolder = dataFolder;
  appData.allVanillaPackNames = new Set(["variants.pack"]);
  appData.enabledMods = [];

  const packPath = path.join(dataFolder, "variants.pack");
  await writePack(
    contents.map(
      (file) =>
        ({
          name: file.name,
          file_size: Buffer.byteLength(file.text, "utf8"),
          start_pos: -1,
          buffer: Buffer.from(file.text, "utf8"),
        }) as unknown as NewPackedFile,
    ),
    packPath,
  );

  vi.mocked(getVanillaPackIndex).mockResolvedValue(
    buildVanillaPackIndex(
      {
        game: "wh3",
        dataFolder,
        manifestSize: 1,
        manifestMtimeMs: 1,
        packCount: 1,
      },
      [{ packName: "variants.pack", fileNames: contents.map((file) => file.name) }],
    ),
  );

  return packPath;
};

const editViaFlow = (packPath: string, rule: Record<string, unknown>) =>
  executeNodeAction({
    nodeId: "edit_text",
    nodeType: "edittextfile",
    textValue: "",
    config: { textFileRules: [rule], textFileFormatter: "autoIndent" },
    inputData: {
      type: "PackFiles",
      files: [{ name: "variants.pack", path: packPath, loaded: true }],
      count: 1,
      loadedCount: 1,
    } as PackFilesNodeData,
  });

describe("Edit Text File against a vanilla pack", () => {
  it("edits a vanilla file located through the index", async () => {
    const packPath = await setUpVanillaPack([{ name: VARIANT_MESH_PATH, text: vanillaContent }]);

    const result = await editViaFlow(packPath, {
      id: "append_shields",
      targetMatch: "path",
      // Forward slashes, as the flow that prompted this was written.
      target: "variantmeshes/variantmeshdefinitions/emp_state_troops_shields_set1.variantmeshdefinition",
      mode: "xml",
      selector: 'SLOT[name="shield"] > VARIANT_MESH:last-child',
      operation: "insertAfter",
      value:
        '<VARIANT_MESH model="VariantMeshes/wh_variantmodels/hu1/emp/pj_emp_props/pj_shield_01.wsmodel">' +
        "<META_DATA>audio_shield_type:metal</META_DATA></VARIANT_MESH>",
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();

    const tables = (result.data as DBTablesNodeData).tables;
    expect(tables).toHaveLength(1);
    const edited = tables[0].table.buffer?.toString("utf8") ?? "";
    expect(edited).toContain("pj_shield_01.wsmodel");
    expect(edited).toContain("emp_state_troops_shield_01.wsmodel");
    expect(edited.indexOf("pj_shield_01.wsmodel")).toBeLessThan(edited.indexOf("</SLOT>"));
    // Written back at the path the game reads it from.
    expect(tables[0].outputFileName).toBe(VARIANT_MESH_PATH);
  });

  it("finds a vanilla file by name as well as by path", async () => {
    const packPath = await setUpVanillaPack([{ name: VARIANT_MESH_PATH, text: vanillaContent }]);

    const result = await editViaFlow(packPath, {
      id: "by_name",
      targetMatch: "name",
      target: "emp_state_troops_shields_set1.variantmeshdefinition",
      mode: "text",
      selector: "equipment",
      operation: "replace",
      value: "replaced",
    });

    expect(result.success).toBe(true);
    expect((result.data as DBTablesNodeData).tables[0].table.buffer?.toString("utf8")).toContain("replaced");
  });

  it("warns instead of silently doing nothing when no vanilla pack has the target", async () => {
    const packPath = await setUpVanillaPack([{ name: VARIANT_MESH_PATH, text: vanillaContent }]);

    const result = await editViaFlow(packPath, {
      id: "missing",
      targetMatch: "path",
      target: "variantmeshes/variantmeshdefinitions/not_a_real_file.variantmeshdefinition",
      mode: "xml",
      selector: "SLOT",
      operation: "insertAfter",
      value: "<VARIANT_MESH/>",
    });

    expect(result.success).toBe(true);
    expect((result.data as DBTablesNodeData).tables).toHaveLength(0);
    expect(result.warnings?.[0]).toContain("matched nothing");
  });

  it("falls back to reading the pack directly when there is no index", async () => {
    const packPath = await setUpVanillaPack([{ name: VARIANT_MESH_PATH, text: vanillaContent }]);
    vi.mocked(getVanillaPackIndex).mockResolvedValue(undefined);

    const result = await editViaFlow(packPath, {
      id: "no_index",
      targetMatch: "path",
      target: VARIANT_MESH_PATH,
      mode: "text",
      selector: "equipment",
      operation: "replace",
      value: "replaced",
    });

    expect(result.success).toBe(true);
    expect((result.data as DBTablesNodeData).tables[0].table.buffer?.toString("utf8")).toContain("replaced");
  });
});
