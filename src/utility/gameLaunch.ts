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
};

export type GameLaunchResolution =
  | { kind: "launch"; command: string; args: string[] }
  | { kind: "error"; message: string };

export const NO_LINUX_LAUNCHER_MESSAGE =
  "Unable to launch the game: Steam, Flatpak/Snap Steam, and protontricks-launch were not found.";

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
export const resolveGameLaunch = ({
  gameExecutablePath,
  steamId,
  modListFileName,
  saveName,
  platform = process.platform,
  findExecutable = findExecutableOnPath,
}: GameLaunchRequest): GameLaunchResolution => {
  const gameArgs = buildGameArgs(modListFileName, saveName);

  if (platform !== "linux") {
    return { kind: "launch", command: gameExecutablePath, args: gameArgs };
  }

  // Let Steam select the game's Proton/runtime configuration.
  const steamCommand = findExecutable("steam");
  if (steamCommand) {
    return { kind: "launch", command: steamCommand, args: ["-applaunch", steamId, ...gameArgs] };
  }

  // Flatpak Steam does not necessarily expose a `steam` executable to native applications.
  const flatpakCommand = findExecutable("flatpak");
  if (flatpakCommand) {
    return {
      kind: "launch",
      command: flatpakCommand,
      args: ["run", "com.valvesoftware.Steam", "-applaunch", steamId, ...gameArgs],
    };
  }

  const snapCommand = findExecutable("snap");
  if (snapCommand) {
    return { kind: "launch", command: snapCommand, args: ["run", "steam", "-applaunch", steamId, ...gameArgs] };
  }

  // Protontricks remains a fallback for systems where no Steam CLI is on PATH.
  const protontricksCommand = findExecutable("protontricks-launch");
  if (protontricksCommand) {
    return {
      kind: "launch",
      command: protontricksCommand,
      args: ["--cwd-app", "--appid", steamId, gameExecutablePath, ...gameArgs],
    };
  }

  return { kind: "error", message: NO_LINUX_LAUNCHER_MESSAGE };
};
