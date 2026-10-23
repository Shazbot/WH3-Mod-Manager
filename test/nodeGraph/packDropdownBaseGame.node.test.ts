import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({ decompress: vi.fn(async (input: Uint8Array) => input) }));
vi.mock("electron-is-dev", () => ({ default: false }));

import appData from "../../src/appData";
import { executeNodeAction } from "../../src/nodeExecutor";
import { serializeNodeGraphState } from "../../src/nodeGraph/graphSerialization";
import { serializeNodeConfigForExecution } from "../../src/nodeGraphExecutor";
import { prepareNodeConfig } from "../../src/packFileSerializer";

const originalGame = appData.currentGame;
const originalFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
const originalEnabledMods = appData.enabledMods;
let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "whmm-pack-dropdown-"));
  await writeFile(path.join(folder, "db.pack"), "");
  appData.currentGame = "wh3";
  appData.gamesToGameFolderPaths.wh3.dataFolder = folder;
  appData.enabledMods = [{ name: "mod.pack", path: path.join(folder, "mod.pack") } as Mod];
});

afterEach(async () => {
  appData.currentGame = originalGame;
  appData.gamesToGameFolderPaths.wh3.dataFolder = originalFolder;
  appData.enabledMods = originalEnabledMods;
  await rm(folder, { recursive: true, force: true });
});

const run = (selectedPack: string, includeBaseGame?: boolean) =>
  executeNodeAction({
    nodeId: "pack-input",
    nodeType: "packfilesdropdown",
    textValue: "",
    config: { selectedPack, includeBaseGame },
    inputData: null,
  });

const fileNames = (result: Awaited<ReturnType<typeof run>>) => {
  expect(result.success).toBe(true);
  return (result.data as PackFilesNodeData).files.map((file) => file.name);
};

describe("Pack Dropdown Input base game option", () => {
  it.each([undefined, false])("excludes vanilla when includeBaseGame is %s", async (includeBaseGame) => {
    expect(fileNames(await run("mod.pack", includeBaseGame))).toEqual(["mod.pack"]);
  });

  it("includes vanilla only when requested", async () => {
    expect(fileNames(await run("mod.pack", true))).toEqual(["mod.pack", "db.pack"]);
  });

  it.each([false, true])("keeps explicitly selected vanilla once with includeBaseGame=%s", async (flag) => {
    expect(fileNames(await run("db.pack", flag))).toEqual(["db.pack"]);
  });

  it("defaults legacy plain pack-name execution to mod only", async () => {
    const result = await executeNodeAction({
      nodeId: "legacy-input",
      nodeType: "packfilesdropdown",
      textValue: "mod.pack",
      inputData: null,
    });
    expect(fileNames(result)).toEqual(["mod.pack"]);
  });

  it.each([undefined, false, true])("persists and executes includeBaseGame=%s", (includeBaseGame) => {
    const node = {
      id: "pack-input",
      type: "packfilesdropdown" as const,
      position: { x: 0, y: 0 },
      data: { label: "Pack Dropdown Input", selectedPack: "mod.pack", includeBaseGame },
    };
    const graph = serializeNodeGraphState({
      nodes: [node] as never[],
      edges: [],
      flowOptions: [],
      isGraphEnabled: false,
      graphStartsEnabled: true,
    });
    expect(graph.nodes[0].data.includeBaseGame).toBe(includeBaseGame);
    const expected = { selectedPack: "mod.pack", includeBaseGame: includeBaseGame ?? false };
    expect(JSON.parse(serializeNodeConfigForExecution(graph.nodes[0]))).toEqual(expected);
    expect(prepareNodeConfig(graph.nodes[0])).toEqual(expected);
  });
});
