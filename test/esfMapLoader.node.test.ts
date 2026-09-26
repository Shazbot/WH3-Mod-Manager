import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getVanillaStartposFilePaths } from "../src/esfMap/loader";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("ESF campaign startpos discovery", () => {
  it("does not include the unsupported prologue startpos", async () => {
    const dataFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-esf-loader-"));
    temporaryDirectories.push(dataFolder);
    const prologueFolder = path.join(dataFolder, "campaigns", "wh3_main_prologue");
    const mainCampaignFolder = path.join(dataFolder, "campaigns", "wh3_main_combi");
    await fs.promises.mkdir(prologueFolder, { recursive: true });
    await fs.promises.mkdir(mainCampaignFolder, { recursive: true });
    await fs.promises.writeFile(path.join(prologueFolder, "startpos.esf"), "not parsed");
    const mainStartposPath = path.join(mainCampaignFolder, "startpos.esf");
    await fs.promises.writeFile(mainStartposPath, "not parsed");

    await expect(getVanillaStartposFilePaths(dataFolder)).resolves.toEqual([mainStartposPath]);
  });
});
