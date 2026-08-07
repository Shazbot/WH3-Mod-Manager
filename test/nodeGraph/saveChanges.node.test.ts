import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { executeNodeAction } from "../../src/nodeExecutor";
import { createFlowExecutionContext } from "../../src/flowExecutionSupport";

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
});
