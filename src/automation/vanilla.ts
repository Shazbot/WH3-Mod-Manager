import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import * as VDF from "@node-steam/vdf";
import { z } from "zod";
import { getSteamInstallCandidates, parseLibraryFolders } from "../steamPaths";
import { AutomationError, throwIfAborted } from "./errors";
import type { AutomationContext } from "./operations";

export const vanillaInputs = {
  vanillaPackPaths: z.array(z.string().min(1)).max(512).optional(),
  gameDataPath: z
    .string()
    .min(1)
    .optional()
    .describe("WH3 data directory containing manifest.txt; overrides automatic discovery."),
  withVanilla: z
    .boolean()
    .default(false)
    .describe(
      "Include base game manifest packs. Discover data via explicit paths, WHMM settings (including Windows settings under WSL), or Steam libraries. Mods retain priority.",
    ),
};

/** Injectable platform metadata keeps discovery tests independent of installed games. */
export interface GameDiscoveryOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  runCommand?: (command: string, args: string[]) => Promise<string>;
}

export interface DiscoveredGameFolders {
  dataPath: string;
  /** Workshop content folder saved in WHMM settings, when known. */
  contentFolder?: string;
}

/** Steam layout: <library>/steamapps/common/<game>/data -> <library>/steamapps/workshop/content/<appid>. */
export const deriveWorkshopContentFolder = (dataPath: string): string | undefined => {
  const steamApps = path.dirname(path.dirname(path.dirname(dataPath)));
  if (path.basename(path.dirname(path.dirname(dataPath))).toLowerCase() !== "common") return undefined;
  return path.join(steamApps, "workshop", "content", "1142710");
};

/** All file reads remain policy-gated; interop retrieves only Windows path metadata. */
export const discoverGameDataPath = async (
  context: AutomationContext,
  options: GameDiscoveryOptions = {},
): Promise<string> => (await discoverGameFolders(context, options)).dataPath;

export const discoverGameFolders = async (
  context: AutomationContext,
  options: GameDiscoveryOptions = {},
): Promise<DiscoveredGameFolders> => {
  throwIfAborted(context.signal);
  const env = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDirectory ?? os.homedir();
  const isWsl = platform === "linux" && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  const run = options.runCommand ?? ((command: string, args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8", timeout: 5000, maxBuffer: 65536, windowsHide: true, signal: context.signal,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  }));
  const localPath = async (value: string): Promise<string> => {
    throwIfAborted(context.signal);
    if (isWsl && /^(?:[a-z]:[\\/]|\\\\)/i.test(value)) {
      const converted = (await run("wslpath", ["-u", "--", value])).trim();
      if (!path.posix.isAbsolute(converted) || converted.includes("\0"))
        throw new Error("Windows path could not be converted to a WSL path");
      return converted;
    }
    return value;
  };
  // Explicit environment overrides are authoritative, including when unavailable.
  if (env.WHMM_GAME_DATA_PATH) return { dataPath: await localPath(env.WHMM_GAME_DATA_PATH) };
  const searchedPaths: string[] = [];
  const availableData = async (value: string): Promise<string | undefined> => {
    try {
      const directory = await localPath(value);
      searchedPaths.push(directory);
      const canonical = await context.policy.assertReadPath(directory);
      await context.policy.assertReadPath(path.join(canonical, "manifest.txt"));
      return canonical;
    } catch {
      throwIfAborted(context.signal);
      return undefined;
    }
  };
  const readConfig = async (root: string | undefined): Promise<DiscoveredGameFolders | undefined> => {
    if (!root) return undefined;
    try {
      const configPath = path.join(await localPath(root), "wh3mm", "config.json");
      searchedPaths.push(configPath);
      const config = JSON.parse((await context.policy.readFile(configPath)).bytes.toString("utf8"));
      const value = config?.gameFolderPaths?.wh3?.dataFolder ?? config?.appFolderPaths?.dataFolder;
      const dataPath = typeof value === "string" && value.length ? await availableData(value) : undefined;
      if (!dataPath) return undefined;
      const content = config?.gameFolderPaths?.wh3?.contentFolder;
      let contentFolder: string | undefined;
      if (typeof content === "string" && content.length) {
        try {
          contentFolder = await localPath(content);
        } catch {
          throwIfAborted(context.signal);
        }
      }
      return { dataPath, ...(contentFolder ? { contentFolder } : {}) };
    } catch {
      throwIfAborted(context.signal);
      return undefined;
    }
  };
  const configRoot =
    platform === "win32"
      ? env.APPDATA
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : (env.XDG_CONFIG_HOME ?? path.join(home, ".config"));
  const configured = await readConfig(configRoot);
  if (configured) return configured;

  let windows: { appData?: string; steamPath?: string; programFiles?: string; programFilesX86?: string } = {};
  if (isWsl || platform === "win32") {
    // WSL does not normally inherit APPDATA or Windows' Steam registry location.
    // Fixed commands return metadata only: no config, manifest or pack is read here.
    try {
      windows = JSON.parse((await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='SilentlyContinue'; " +
        "$steam=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Valve\\Steam').SteamPath; " +
        "if (!$steam) { $steam=(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam').InstallPath }; " +
        "if (!$steam) { $steam=(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Valve\\Steam').InstallPath }; " +
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); " +
        "@{appData=[Environment]::GetFolderPath('ApplicationData'); steamPath=$steam; " +
        "programFiles=$env:ProgramFiles; programFilesX86=${env:ProgramFiles(x86)}} | ConvertTo-Json -Compress",
      ])).replace(/^\uFEFF/, "").trim());
    } catch {
      throwIfAborted(context.signal);
    }
  }
  if (isWsl) {
    const windowsConfigured = await readConfig(env.APPDATA || windows.appData);
    if (windowsConfigured) return windowsConfigured;
  }

  const steamRoots = getSteamInstallCandidates(platform, home);
  const windowsSteamPaths = [windows.steamPath];
  for (const programFiles of [env["ProgramFiles(x86)"], windows.programFilesX86, env.ProgramFiles, windows.programFiles]) {
    if (programFiles) windowsSteamPaths.push(path.win32.join(programFiles, "Steam"));
  }
  for (const candidate of windowsSteamPaths) {
    if (!candidate) continue;
    try {
      steamRoots.push(await localPath(candidate));
    } catch {
      throwIfAborted(context.signal);
    }
  }
  for (const steamRoot of new Set(steamRoots)) {
    throwIfAborted(context.signal);
    let libraryRoots = [steamRoot];
    try {
      const libraryPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
      searchedPaths.push(libraryPath);
      const contents = (await context.policy.readFile(libraryPath)).bytes.toString("utf8");
      libraryRoots = [...libraryRoots, ...parseLibraryFolders(contents)];
    } catch {
      throwIfAborted(context.signal);
    }
    for (const library of new Set(libraryRoots)) {
      try {
        const localLibrary = await localPath(library);
        const appManifest = path.join(localLibrary, "steamapps", "appmanifest_1142710.acf");
        searchedPaths.push(appManifest);
        const parsed = VDF.parse((await context.policy.readFile(appManifest)).bytes.toString("utf8")) as {
          AppState?: { installdir?: string; appid?: string | number };
        };
        const installDirectory = parsed.AppState?.installdir;
        if (String(parsed.AppState?.appid) !== "1142710" || typeof installDirectory !== "string" ||
            !installDirectory || installDirectory === "." || installDirectory === ".." || /[\\/\0]/.test(installDirectory)) continue;
        const data = await availableData(path.join(localLibrary, "steamapps", "common", installDirectory, "data"));
        if (data) return { dataPath: data };
      } catch {
        throwIfAborted(context.signal);
      }
    }
  }
  throw new AutomationError(
    "INVALID_ARGUMENT",
    "Could not discover readable WH3 game data from WHMM settings or Steam libraries. Supply --game-data <directory> (gameDataPath in MCP/JSON), set WHMM_GAME_DATA_PATH, or allow the config/Steam metadata and game files in MCP read roots.",
    { searchedPaths: [...new Set(searchedPaths)] },
  );
};

export const parseManifestPackNames = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.match(/([^\s]+)/)?.[1])
    .filter((value): value is string => Boolean(value && value.toLowerCase().endsWith(".pack")));

export const validateManifestPackName = (name: string): string => {
  if (
    !name ||
    name.includes("\0") ||
    path.posix.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    /^[a-zA-Z]:/.test(name)
  ) {
    throw new AutomationError("VALIDATION", `Invalid pack name in manifest: ${JSON.stringify(name)}`);
  }
  const segments = name.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new AutomationError("VALIDATION", `Manifest pack name escapes the game data folder: ${JSON.stringify(name)}`);
  }
  return name;
};
