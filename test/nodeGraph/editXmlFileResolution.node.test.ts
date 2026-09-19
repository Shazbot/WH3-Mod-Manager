import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { executeNodeAction } from "../../src/nodeExecutor";
import { writePack } from "../../src/packFileSerializer";
import { buildVanillaPackIndex } from "../../src/vanillaPackIndex/format";
import { createFlowExecutionContext } from "../../src/flowExecutionSupport";
import type { NewPackedFile } from "../../src/packFileTypes";

const vanillaStoreMocks = vi.hoisted(() => ({
  getVanillaPackIndex: vi.fn(async () => undefined),
}));

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));
vi.mock("../../src/vanillaPackIndex/store", () => vanillaStoreMocks);

const XML_PATH = "ui\\campaign\\hud.xml";

const originalEnabledMods = appData.enabledMods;
const originalVanillaPackNames = appData.allVanillaPackNames;
const temporaryFolders: string[] = [];

afterEach(async () => {
  appData.enabledMods = originalEnabledMods;
  appData.allVanillaPackNames = originalVanillaPackNames;
  vanillaStoreMocks.getVanillaPackIndex.mockReset();
  vanillaStoreMocks.getVanillaPackIndex.mockResolvedValue(undefined);
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const createPack = async (name: string, xml: string): Promise<{ folder: string; packPath: string }> => {
  const folder = await mkdtemp(path.join(tmpdir(), "whmm-edit-xml-"));
  temporaryFolders.push(folder);
  const packPath = path.join(folder, name);
  const buffer = Buffer.from(xml, "utf8");
  await writePack(
    [
      {
        name: XML_PATH,
        file_size: buffer.length,
        start_pos: -1,
        buffer,
      } as unknown as NewPackedFile,
    ],
    packPath,
  );
  return { folder, packPath };
};

const config = {
  targetMode: "path",
  filePath: "UI/CAMPAIGN/HUD.XML",
  ignoreHierarchy: false,
  locatorSteps: [{ id: "step", elementName: "button", attributes: [] }],
  action: "replaceElement",
  attributeEdits: [],
  replacementXml: '<button source="winner" />',
};

const runPackFiles = (files: Array<{ name: string; path: string; loaded: boolean }>, executionContext?: any) =>
  executeNodeAction({
    nodeId: "edit-xml-resolution",
    nodeType: "editxmlfile",
    textValue: "",
    config,
    executionContext,
    inputData: { type: "PackFiles", files, count: files.length, loadedCount: files.length },
  });

describe("Edit XML File pack resolution", () => {
  it("edits the highest-priority mod copy of one exact path", async () => {
    const low = await createPack("low.pack", '<root><button source="low" /></root>');
    const high = await createPack("high.pack", '<root><button source="high" /></root>');
    appData.allVanillaPackNames = new Set();
    appData.enabledMods = [
      { name: "low.pack", path: low.packPath, loadOrder: 0 },
      { name: "high.pack", path: high.packPath, loadOrder: 1 },
    ] as any;

    const result = await runPackFiles([
      { name: "low.pack", path: low.packPath, loaded: true },
      { name: "high.pack", path: high.packPath, loaded: true },
    ]);
    expect(result.success).toBe(true);
    const output = (result.data as DBTablesNodeData).tables[0];
    expect(output.table.buffer?.toString("utf8")).toBe('<root><button source="winner" /></root>');
    expect(output.sourceFile.path).toBe(high.packPath);
  });

  it("resolves an indexed vanilla file and reads the targeted payload", async () => {
    const vanilla = await createPack("variants.pack", '<root><button source="vanilla" /></root>');
    appData.enabledMods = [];
    appData.allVanillaPackNames = new Set(["variants.pack"]);
    vanillaStoreMocks.getVanillaPackIndex.mockResolvedValue(
      buildVanillaPackIndex(
        { game: "wh3", dataFolder: vanilla.folder, manifestSize: 1, manifestMtimeMs: 1, packCount: 1 },
        [{ packName: "variants.pack", fileNames: [XML_PATH] }],
      ),
    );

    const result = await runPackFiles([{ name: "variants.pack", path: vanilla.packPath, loaded: true }]);
    expect(result.success).toBe(true);
    expect((result.data as DBTablesNodeData).tables[0].table.buffer?.toString("utf8")).toBe(
      '<root><button source="winner" /></root>',
    );
  });

  it("uses execution-context pack path substitutes for index and targeted reads", async () => {
    const original = await createPack("original.pack", '<root><button source="original" /></root>');
    const substitute = await createPack("substitute.pack", '<root><button source="substitute" /></root>');
    appData.enabledMods = [];
    appData.allVanillaPackNames = new Set();
    const executionContext = createFlowExecutionContext();
    executionContext.packPathSubstitutes.set(original.packPath, substitute.packPath);

    const result = await runPackFiles(
      [{ name: "original.pack", path: original.packPath, loaded: true }],
      executionContext,
    );
    expect(result.success).toBe(true);
    expect((result.data as DBTablesNodeData).tables[0].table.buffer?.toString("utf8")).toBe(
      '<root><button source="winner" /></root>',
    );
  });
});
