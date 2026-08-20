import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findExecutableOnPath, NO_LINUX_LAUNCHER_MESSAGE, resolveGameLaunch } from "../src/utility/gameLaunch";

const isWindows = process.platform === "win32";
const temporaryDirectories: string[] = [];

const makeDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-game-launch-"));
  temporaryDirectories.push(directory);
  return directory;
};

const searchPathOf = (...directories: string[]) => directories.join(path.delimiter);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const GAME_EXE = "/games/Total War WARHAMMER III/Warhammer3.exe";
const STEAM_ID = "1142710";

/** Stands in for PATH lookups: only the named commands are considered installed. */
const withInstalled = (...installed: string[]) => {
  return (command: string) => (installed.includes(command) ? `/usr/bin/${command}` : undefined);
};

const resolveOnLinux = (installed: string[], saveName?: string) =>
  resolveGameLaunch({
    gameExecutablePath: GAME_EXE,
    steamId: STEAM_ID,
    modListFileName: "used_mods.txt",
    saveName,
    platform: "linux",
    findExecutable: withInstalled(...installed),
  });

describe("resolveGameLaunch", () => {
  it("runs the game directly when not on Linux", () => {
    const launch = resolveGameLaunch({
      gameExecutablePath: GAME_EXE,
      steamId: STEAM_ID,
      modListFileName: "used_mods.txt",
      platform: "win32",
      findExecutable: withInstalled(),
    });

    expect(launch).toEqual({ kind: "launch", command: GAME_EXE, args: ["used_mods.txt;"] });
  });

  it("prefers the native Steam CLI", () => {
    expect(resolveOnLinux(["steam", "flatpak", "snap", "protontricks-launch"])).toEqual({
      kind: "launch",
      command: "/usr/bin/steam",
      args: ["-applaunch", STEAM_ID, "used_mods.txt;"],
    });
  });

  it("falls back to Flatpak Steam when no native Steam is on PATH", () => {
    expect(resolveOnLinux(["flatpak", "snap", "protontricks-launch"])).toEqual({
      kind: "launch",
      command: "/usr/bin/flatpak",
      args: ["run", "com.valvesoftware.Steam", "-applaunch", STEAM_ID, "used_mods.txt;"],
    });
  });

  it("falls back to Snap Steam when neither native nor Flatpak Steam is present", () => {
    expect(resolveOnLinux(["snap", "protontricks-launch"])).toEqual({
      kind: "launch",
      command: "/usr/bin/snap",
      args: ["run", "steam", "-applaunch", STEAM_ID, "used_mods.txt;"],
    });
  });

  it("falls back to protontricks last, passing the game executable", () => {
    expect(resolveOnLinux(["protontricks-launch"])).toEqual({
      kind: "launch",
      command: "/usr/bin/protontricks-launch",
      args: ["--cwd-app", "--appid", STEAM_ID, GAME_EXE, "used_mods.txt;"],
    });
  });

  it("reports an error when no launcher is installed", () => {
    expect(resolveOnLinux([])).toEqual({ kind: "error", message: NO_LINUX_LAUNCHER_MESSAGE });
  });

  it("keeps the save arguments and their semicolon as separate argv values", () => {
    const launch = resolveOnLinux(["steam"], "My Campaign");

    // The bare ";" is an argument to the game. A shell would read it as a command separator and
    // discard everything after it, which is why these are never flattened into a command string.
    expect(launch).toEqual({
      kind: "launch",
      command: "/usr/bin/steam",
      args: ["-applaunch", STEAM_ID, "game_startup_mode", "campaign_load", "My Campaign", ";", "used_mods.txt;"],
    });
  });

  it("uses the fallback mod list file name it is given", () => {
    const launch = resolveOnLinux(["steam"]);
    const withFallback = resolveGameLaunch({
      gameExecutablePath: GAME_EXE,
      steamId: STEAM_ID,
      modListFileName: "my_mods.txt",
      platform: "linux",
      findExecutable: withInstalled("steam"),
    });

    expect(launch.kind === "launch" && launch.args.at(-1)).toBe("used_mods.txt;");
    expect(withFallback.kind === "launch" && withFallback.args.at(-1)).toBe("my_mods.txt;");
  });
});

describe("findExecutableOnPath", () => {
  it("ignores a directory that shares the executable's name", () => {
    const decoy = makeDirectory();
    const real = makeDirectory();
    fs.mkdirSync(path.join(decoy, "steam"));
    fs.writeFileSync(path.join(real, "steam"), "#!/bin/sh\n");
    fs.chmodSync(path.join(real, "steam"), 0o755);

    expect(findExecutableOnPath("steam", searchPathOf(decoy, real))).toBe(path.join(real, "steam"));
  });

  it("returns undefined when only a same-named directory exists", () => {
    const decoy = makeDirectory();
    fs.mkdirSync(path.join(decoy, "steam"));

    expect(findExecutableOnPath("steam", searchPathOf(decoy))).toBeUndefined();
  });

  it.skipIf(isWindows)("resolves a symlinked launcher", () => {
    const real = makeDirectory();
    const linked = makeDirectory();
    fs.writeFileSync(path.join(real, "steam"), "#!/bin/sh\n");
    fs.chmodSync(path.join(real, "steam"), 0o755);
    fs.symlinkSync(path.join(real, "steam"), path.join(linked, "steam"));

    expect(findExecutableOnPath("steam", searchPathOf(linked))).toBe(path.join(linked, "steam"));
  });

  it("skips empty PATH entries without throwing", () => {
    expect(findExecutableOnPath("steam", searchPathOf("", "", makeDirectory()))).toBeUndefined();
  });
});

// Tier 2: drive the resolver's output through a real spawn and read back what the launcher actually
// received. Steam is not involved; a recorder process stands in for it.
describe("launch arguments as the launcher receives them", () => {
  const recordArgv = async (command: string, args: string[], cwd: string) => {
    const directory = makeDirectory();
    const argvLog = path.join(directory, "argv.json");
    const recorder = path.join(directory, "recorder.cjs");
    fs.writeFileSync(
      recorder,
      `require("fs").writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));`,
    );

    // The recorder replaces the launcher; everything after it is what the launcher would have seen.
    const child = spawn(command, [recorder, ...args], { cwd, detached: true, stdio: "ignore" });
    await new Promise((resolve) => child.once("exit", resolve));
    return JSON.parse(fs.readFileSync(argvLog, "utf8")) as { argv: string[]; cwd: string };
  };

  it("delivers every argument intact, semicolons included", async () => {
    const gamePath = makeDirectory();
    const launch = resolveOnLinux(["steam"], "My Campaign");
    expect(launch.kind).toBe("launch");
    if (launch.kind !== "launch") return;

    const received = await recordArgv(process.execPath, launch.args, gamePath);

    expect(received.argv).toEqual([
      "-applaunch",
      STEAM_ID,
      "game_startup_mode",
      "campaign_load",
      "My Campaign",
      ";",
      "used_mods.txt;",
    ]);
    expect(fs.realpathSync(received.cwd)).toBe(fs.realpathSync(gamePath));
  });

  it("preserves a save name containing spaces and quotes as one argument", async () => {
    const awkwardSave = `Karl's "Grand" Campaign; rm -rf`;
    const launch = resolveOnLinux(["steam"], awkwardSave);
    expect(launch.kind).toBe("launch");
    if (launch.kind !== "launch") return;

    const received = await recordArgv(process.execPath, launch.args, makeDirectory());

    expect(received.argv).toContain(awkwardSave);
    expect(received.argv.at(-1)).toBe("used_mods.txt;");
  });
});
