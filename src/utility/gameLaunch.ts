import { execFileSync, spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as nodePath from "path";

/**
 * Finds an executable by name on PATH. statSync follows symlinks, so a symlinked launcher still
 * counts, but a directory of that name does not. The search path is a parameter rather than read
 * from the environment inside the loop, so callers and tests can search a path of their choosing.
 */
export const findExecutableOnPath = (command: string, searchPath = process.env.PATH ?? ""): string | undefined => {
  for (const directory of searchPath.split(nodePath.delimiter)) {
    if (!directory) continue;
    const candidate = nodePath.join(directory, command);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return undefined;
};

export type GameLaunchRequest = {
  gameExecutablePath: string;
  steamId: string;
  /** Name of the file listing the mods for the game to load, used_mods.txt or my_mods.txt. */
  modListFileName: string;
  saveName?: string;
  platform?: NodeJS.Platform;
  /** Injectable so the launcher choice can be exercised without touching the real PATH. */
  findExecutable?: (command: string) => string | undefined;
  /** Injectable probe for package-manager front ends such as Flatpak and Snap. */
  isLauncherAvailable?: (launcher: LinuxLauncher, executable: string) => boolean;
};

export type GameLaunchResolution =
  { kind: "launch"; command: string; args: string[] } | { kind: "error"; message: string };

export type LinuxLauncher = "steam" | "flatpak" | "snap" | "protontricks-launch";
export type GameLauncher = "direct" | LinuxLauncher;
export type GameLaunchCommand = { launcher: GameLauncher; command: string; args: string[] };
export type GameLaunchPlan = { kind: "launch"; candidates: GameLaunchCommand[] } | { kind: "error"; message: string };

export const NO_LINUX_LAUNCHER_MESSAGE =
  "Unable to launch the game: no usable native, Flatpak, Snap, or Protontricks Steam launcher was found.";

/** Confirms that a package-manager executable actually has Steam installed beneath it. */
export const isLinuxLauncherAvailable = (launcher: LinuxLauncher, executable: string): boolean => {
  if (launcher === "steam" || launcher === "protontricks-launch") return true;

  try {
    if (launcher === "flatpak") {
      execFileSync(executable, ["info", "com.valvesoftware.Steam"], { stdio: "ignore", timeout: 3000 });
    } else {
      execFileSync(executable, ["list", "steam"], { stdio: "ignore", timeout: 3000 });
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * The arguments the game itself takes. These stay separate argv values: the semicolons are game
 * arguments, and a shell would read them as command separators and drop everything after them.
 */
const buildGameArgs = (modListFileName: string, saveName?: string) => [
  ...(saveName ? ["game_startup_mode", "campaign_load", saveName, ";"] : []),
  `${modListFileName};`,
];

/**
 * Decides what to run to start the game, without running it. On Linux the game is a Windows binary
 * that needs Steam's Proton configuration, so it is started through whichever Steam front end this
 * system actually has rather than executed directly.
 */
export const resolveGameLaunchPlan = ({
  gameExecutablePath,
  steamId,
  modListFileName,
  saveName,
  platform = process.platform,
  findExecutable = findExecutableOnPath,
  isLauncherAvailable = isLinuxLauncherAvailable,
}: GameLaunchRequest): GameLaunchPlan => {
  const gameArgs = buildGameArgs(modListFileName, saveName);

  if (platform !== "linux") {
    return {
      kind: "launch",
      candidates: [{ launcher: "direct", command: gameExecutablePath, args: gameArgs }],
    };
  }

  const candidates: GameLaunchCommand[] = [];

  const steamCommand = findExecutable("steam");
  if (steamCommand && isLauncherAvailable("steam", steamCommand)) {
    candidates.push({ launcher: "steam", command: steamCommand, args: ["-applaunch", steamId, ...gameArgs] });
  }

  // Flatpak Steam does not necessarily expose a `steam` executable to native applications.
  const flatpakCommand = findExecutable("flatpak");
  if (flatpakCommand && isLauncherAvailable("flatpak", flatpakCommand)) {
    candidates.push({
      launcher: "flatpak",
      command: flatpakCommand,
      args: ["run", "com.valvesoftware.Steam", "-applaunch", steamId, ...gameArgs],
    });
  }

  const snapCommand = findExecutable("snap");
  if (snapCommand && isLauncherAvailable("snap", snapCommand)) {
    candidates.push({
      launcher: "snap",
      command: snapCommand,
      args: ["run", "steam", "-applaunch", steamId, ...gameArgs],
    });
  }

  // Protontricks remains a fallback for systems where no Steam CLI is on PATH.
  const protontricksCommand = findExecutable("protontricks-launch");
  if (protontricksCommand && isLauncherAvailable("protontricks-launch", protontricksCommand)) {
    candidates.push({
      launcher: "protontricks-launch",
      command: protontricksCommand,
      args: ["--cwd-app", "--appid", steamId, gameExecutablePath, ...gameArgs],
    });
  }

  return candidates.length > 0 ? { kind: "launch", candidates } : { kind: "error", message: NO_LINUX_LAUNCHER_MESSAGE };
};

/** Backward-compatible single-choice view used by callers that only need to inspect the argv. */
export const resolveGameLaunch = (request: GameLaunchRequest): GameLaunchResolution => {
  const plan = resolveGameLaunchPlan(request);
  if (plan.kind === "error") return plan;
  const [{ command, args }] = plan.candidates;
  return { kind: "launch", command, args };
};

type LaunchProcessOptions = {
  earlyExitMs?: number;
  spawnProcess?: typeof spawn;
};

export type GameLaunchResult = { started: true; launch: GameLaunchCommand } | { started: false; message: string };

const attemptGameLaunch = (
  launch: GameLaunchCommand,
  cwd: string,
  earlyExitMs: number,
  spawnProcess: typeof spawn,
): Promise<{ started: boolean; error?: string }> =>
  new Promise((resolve) => {
    let child: ChildProcess;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (started: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (started) child.unref();
      resolve({ started, error });
    };

    try {
      child = spawnProcess(launch.command, launch.args, {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: process.platform === "win32",
      });
    } catch (error) {
      finish(false, error instanceof Error ? error.message : String(error));
      return;
    }

    child.once("error", (error) => finish(false, error.message));
    child.once("exit", (code, signal) => {
      if (code === 0) finish(true);
      else finish(false, `exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`);
    });
    child.once("spawn", () => {
      timer = setTimeout(() => finish(true), earlyExitMs);
    });
  });

/** Tries launchers in priority order, falling through when one rejects the request immediately. */
export const launchGame = async (
  candidates: GameLaunchCommand[],
  cwd: string,
  { earlyExitMs = 1500, spawnProcess = spawn }: LaunchProcessOptions = {},
): Promise<GameLaunchResult> => {
  const failures: string[] = [];
  for (const candidate of candidates) {
    const result = await attemptGameLaunch(candidate, cwd, earlyExitMs, spawnProcess);
    if (result.started) return { started: true, launch: candidate };
    failures.push(`${candidate.launcher}: ${result.error || "failed to start"}`);
  }
  return { started: false, message: `Unable to launch the game. ${failures.join("; ")}` };
};
