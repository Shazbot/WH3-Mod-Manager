import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as VDF from "@node-steam/vdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { discoverGameDataPath } from "../../src/automation/vanilla";
import { prepareReferenceEnvironment, resolveReferenceAsset } from "../../src/automation/references";
import { writeRawPack } from "../../src/packCore";
import { main } from "../../src/cli/main";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const workspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-vanilla-"));
  roots.push(root);
  return root;
};
const metadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [] as string[],
};

describe("base game pack discovery", () => {
  it("uses environment discovery, preserves explicit overrides, and resolves mods above vanilla", async () => {
    const root = workspace();
    const base = path.join(root, "base.pack");
    const extra = path.join(root, "extra.pack");
    const mod = path.join(root, "mod.pack");
    for (const pack of [base, extra, mod])
      await writeRawPack(pack, [{ name: "textures\\shared.dds", buffer: Buffer.from(pack) }], metadata);
    fs.writeFileSync(path.join(root, "manifest.txt"), "base.pack\t123\n");
    vi.stubEnv("WHMM_GAME_DATA_PATH", root);
    const context = createAutomationContext({ readRoots: [root], writeRoots: [] });
    const env = await prepareReferenceEnvironment(context, [mod], [extra], undefined, true);
    expect(env.providers.map((p) => p.pack.path)).toEqual([extra, base, mod]);
    expect(resolveReferenceAsset(env, "textures/shared.dds").winner?.provider.pack.path).toBe(mod);
    vi.stubEnv("WHMM_GAME_DATA_PATH", path.join(root, "invalid"));
    const explicit = await prepareReferenceEnvironment(context, [mod], [], root, true);
    expect(explicit.providers.map((p) => p.pack.path)).toEqual([base, mod]);
    const restricted = await executeAutomationRequest(
      { operation: "pack_validate", packPath: mod, withVanilla: true, gameDataPath: root },
      createAutomationContext({ readRoots: [mod], writeRoots: [] }),
    );
    expect(restricted).toMatchObject({ ok: false, error: { code: "IO_ACCESS" } });
  });

  it("reads the WH3 saved path without loading Electron", async () => {
    const root = workspace();
    vi.stubEnv("WHMM_GAME_DATA_PATH", "");
    vi.stubEnv("APPDATA", root);
    vi.stubEnv("XDG_CONFIG_HOME", root);
    // On macOS the configuration lives in Application Support instead.
    const configPath =
      process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "wh3mm", "config.json")
        : path.join(root, "wh3mm", "config.json");
    if (process.platform === "darwin") return;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(path.join(root, "manifest.txt"), "base.pack\n");
    fs.writeFileSync(configPath, JSON.stringify({ gameFolderPaths: { wh3: { dataFolder: root } } }));
    const options = { platform: "linux" as const, homeDirectory: root, environment: { XDG_CONFIG_HOME: root } };
    expect(await discoverGameDataPath(createAutomationContext({ readRoots: [root] }), options)).toBe(root);
    fs.writeFileSync(configPath, "{}");
    await expect(discoverGameDataPath(createAutomationContext({ readRoots: [root] }), options)).rejects.toThrow("--game-data");
  });

  it("skips stale WHMM settings and discovers a registered Steam library", async () => {
    const root = workspace();
    const configRoot = path.join(root, "config");
    fs.mkdirSync(path.join(configRoot, "wh3mm"), { recursive: true });
    fs.writeFileSync(path.join(configRoot, "wh3mm", "config.json"), JSON.stringify({
      gameFolderPaths: { wh3: { dataFolder: path.join(root, "removed-game") } },
    }));
    const steam = path.join(root, ".local", "share", "Steam");
    const library = path.join(root, "other Steam library");
    fs.mkdirSync(path.join(steam, "steamapps"), { recursive: true });
    fs.mkdirSync(path.join(library, "steamapps"), { recursive: true });
    fs.writeFileSync(path.join(steam, "steamapps", "libraryfolders.vdf"),
      VDF.stringify({ libraryfolders: { "0": { path: library } } }));
    fs.writeFileSync(path.join(library, "steamapps", "appmanifest_1142710.acf"),
      VDF.stringify({ AppState: { appid: "1142710", installdir: "Custom WH3 directory" } }));
    const data = path.join(library, "steamapps", "common", "Custom WH3 directory", "data");
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, "manifest.txt"), "base.pack\n");
    const context = createAutomationContext({ readRoots: [root] });
    const options = { platform: "linux" as const, homeDirectory: root, environment: { XDG_CONFIG_HOME: configRoot } };
    expect(await discoverGameDataPath(context, options)).toBe(data);
    fs.writeFileSync(path.join(library, "steamapps", "appmanifest_1142710.acf"),
      VDF.stringify({ AppState: { appid: "1142710", installdir: "../outside" } }));
    await expect(discoverGameDataPath(context, options)).rejects.toThrow("--game-data");
  });

  it("discovers Windows WHMM settings under WSL without inherited Windows variables", async () => {
    const root = workspace();
    const appData = path.join(root, "windows-profile");
    const data = path.join(root, "custom-mount", "game", "data");
    fs.mkdirSync(path.join(appData, "wh3mm"), { recursive: true });
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, "manifest.txt"), "base.pack\n");
    fs.writeFileSync(path.join(appData, "wh3mm", "config.json"), JSON.stringify({
      gameFolderPaths: { wh3: { dataFolder: "Z:\\Games\\WH3\\data" } },
    }));
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === "powershell.exe") return JSON.stringify({ appData: "D:\\Profile\\AppData\\Roaming" });
      if (command === "wslpath" && args[2] === "D:\\Profile\\AppData\\Roaming") return appData;
      if (command === "wslpath" && args[2] === "Z:\\Games\\WH3\\data") return data;
      throw new Error(`Unexpected metadata command ${command}`);
    });
    const options = { platform: "linux" as const, homeDirectory: root, environment: { WSL_DISTRO_NAME: "test" }, runCommand };
    expect(await discoverGameDataPath(createAutomationContext({ readRoots: [root] }), options)).toBe(data);
    expect(runCommand).toHaveBeenCalledWith("wslpath", ["-u", "--", "Z:\\Games\\WH3\\data"]);
    // Allowing the game alone must not grant access to the Windows config.
    await expect(discoverGameDataPath(createAutomationContext({ readRoots: [data] }), options)).rejects.toThrow("MCP read roots");
  });

  it("converts Windows Steam library paths under WSL and rejects inaccessible games", async () => {
    const root = workspace();
    const steam = path.join(root, "steam");
    const library = path.join(root, "mounted-library");
    const data = path.join(library, "steamapps", "common", "WH3", "data");
    fs.mkdirSync(path.join(steam, "steamapps"), { recursive: true });
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, "manifest.txt"), "base.pack\n");
    fs.writeFileSync(path.join(steam, "steamapps", "libraryfolders.vdf"),
      VDF.stringify({ libraryfolders: { "0": { path: "Z:\\SteamLibrary" } } }));
    fs.writeFileSync(path.join(library, "steamapps", "appmanifest_1142710.acf"),
      VDF.stringify({ AppState: { appid: "1142710", installdir: "WH3" } }));
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === "powershell.exe") return JSON.stringify({ steamPath: "D:\\Steam" });
      if (command === "wslpath" && args[2] === "D:\\Steam") return steam;
      if (command === "wslpath" && args[2] === "Z:\\SteamLibrary") return library;
      throw new Error("Unexpected metadata command");
    });
    const options = { platform: "linux" as const, homeDirectory: root, environment: { WSL_DISTRO_NAME: "test" }, runCommand };
    expect(await discoverGameDataPath(createAutomationContext({ readRoots: [root] }), options)).toBe(data);
    await expect(discoverGameDataPath(createAutomationContext({ readRoots: [steam, path.join(library, "steamapps", "appmanifest_1142710.acf")] }), options))
      .rejects.toThrow("MCP read roots");
  });

  it("keeps environment overrides authoritative and cancels discovery", async () => {
    const root = workspace();
    const runCommand = vi.fn(async () => { throw new Error("No automatic fallback expected"); });
    expect(await discoverGameDataPath(createAutomationContext(), {
      platform: "linux", environment: { WHMM_GAME_DATA_PATH: path.join(root, "not-installed") }, runCommand,
    })).toBe(path.join(root, "not-installed"));
    expect(runCommand).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(discoverGameDataPath(createAutomationContext({ signal: controller.signal }), {
      environment: {}, runCommand,
    })).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("rejects unsafe or empty manifests and irrelevant CLI flags", async () => {
    const root = workspace();
    const mod = path.join(root, "mod.pack");
    await writeRawPack(mod, [], metadata);
    for (const manifest of ["../outside.pack\n", ""]) {
      fs.writeFileSync(path.join(root, "manifest.txt"), manifest);
      expect(
        await executeAutomationRequest({
          operation: "pack_validate",
          packPath: mod,
          gameDataPath: root,
          withVanilla: true,
        }),
      ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    const output: string[] = [];
    expect(
      await main(["pack", "info", mod, "--with-vanilla", "--format", "json"], {
        stdout: (v) => output.push(v),
        stderr: () => undefined,
      }),
    ).not.toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });
});
