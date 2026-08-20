import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  findSteamAppsFolder,
  findSteamAppsFolderSync,
  findSteamInstallPathSync,
  getCompatDataPrefixSync,
  getSteamInstallCandidates,
} from "../src/steamPaths";

const temporaryDirectories: string[] = [];

const makeHomeDirectory = async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-steam-paths-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("Steam Linux path discovery", () => {
  it("includes native, Flatpak, and Snap locations", () => {
    const homeDirectory = "/home/test-user";
    const candidates = getSteamInstallCandidates("linux", homeDirectory);

    expect(candidates).toContain(path.join(homeDirectory, ".local", "share", "Steam"));
    expect(candidates).toContain(
      path.join(homeDirectory, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
    );
    expect(candidates).toContain(path.join(homeDirectory, "snap", "steam", "common", ".steam", "steam"));
  });

  it("finds a game in a secondary Steam library", async () => {
    const homeDirectory = await makeHomeDirectory();
    const steamInstallPath = path.join(homeDirectory, ".local", "share", "Steam");
    const secondaryLibrary = path.join(homeDirectory, "Games", "SteamLibrary");
    await fs.promises.mkdir(path.join(steamInstallPath, "steamapps"), { recursive: true });
    await fs.promises.mkdir(path.join(secondaryLibrary, "steamapps"), { recursive: true });
    await fs.promises.writeFile(
      path.join(steamInstallPath, "steamapps", "libraryfolders.vdf"),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steamInstallPath.replaceAll("\\", "\\\\")}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${secondaryLibrary.replaceAll("\\", "\\\\")}"\n\t}\n}\n`,
    );
    await fs.promises.writeFile(path.join(secondaryLibrary, "steamapps", "appmanifest_1142710.acf"), "manifest");

    expect(findSteamInstallPathSync("linux", homeDirectory)).toBe(steamInstallPath);
    expect(findSteamAppsFolderSync("1142710", steamInstallPath)).toBe(path.join(secondaryLibrary, "steamapps"));
    await expect(findSteamAppsFolder("1142710", steamInstallPath)).resolves.toBe(
      path.join(secondaryLibrary, "steamapps"),
    );
    expect(getCompatDataPrefixSync("1142710", path.join(secondaryLibrary, "steamapps"))).toBe(
      path.join(secondaryLibrary, "compatdata", "1142710", "pfx"),
    );
  });
});
