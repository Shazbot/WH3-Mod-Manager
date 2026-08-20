import * as fs from "fs";
import * as os from "os";
import * as nodePath from "path";
import * as VDF from "@node-steam/vdf";

type SteamLibraryFolders = {
  libraryfolders?: Record<string, { path?: string }>;
};

const uniquePaths = (paths: string[]) => [...new Set(paths)];

/**
 * Returns the conventional Steam roots used by native, Flatpak, and Snap installs.
 * The caller still needs to verify that a candidate exists.
 */
export const getSteamInstallCandidates = (
  platform = process.platform,
  homeDirectory = os.homedir(),
): string[] => {
  if (platform === "linux") {
    return uniquePaths([
      nodePath.join(homeDirectory, ".steam", "steam"),
      nodePath.join(homeDirectory, ".steam", "root"),
      nodePath.join(homeDirectory, ".steam", "debian-installation"),
      nodePath.join(homeDirectory, ".local", "share", "Steam"),
      nodePath.join(homeDirectory, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
      nodePath.join(homeDirectory, ".var", "app", "com.valvesoftware.Steam", ".steam", "steam"),
      nodePath.join(homeDirectory, "snap", "steam", "common", ".local", "share", "Steam"),
      nodePath.join(homeDirectory, "snap", "steam", "common", ".steam", "steam"),
    ]);
  }

  if (platform === "darwin") {
    return [nodePath.join(homeDirectory, "Library", "Application Support", "Steam")];
  }

  return [];
};

export const findSteamInstallPathSync = (
  platform = process.platform,
  homeDirectory = os.homedir(),
): string | undefined => {
  return getSteamInstallCandidates(platform, homeDirectory).find((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
};

export const findSteamInstallPath = async (
  platform = process.platform,
  homeDirectory = os.homedir(),
): Promise<string | undefined> => {
  for (const candidate of getSteamInstallCandidates(platform, homeDirectory)) {
    try {
      if ((await fs.promises.stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Try the next conventional location.
    }
  }
  return undefined;
};

const parseLibraryFolders = (contents: string): string[] => {
  try {
    const parsed = VDF.parse(contents) as SteamLibraryFolders;
    return Object.values(parsed.libraryfolders ?? {})
      .map((entry) => entry.path)
      .filter((libraryPath): libraryPath is string => Boolean(libraryPath))
      .map((libraryPath) => libraryPath.replaceAll("\\\\", "\\").replaceAll("//", "/"));
  } catch {
    return [];
  }
};

const getSteamLibraryRootsSync = (steamInstallPath: string): string[] => {
  const libraryFoldersPath = nodePath.join(steamInstallPath, "steamapps", "libraryfolders.vdf");
  try {
    return uniquePaths([steamInstallPath, ...parseLibraryFolders(fs.readFileSync(libraryFoldersPath, "utf8"))]);
  } catch {
    return [steamInstallPath];
  }
};

const getSteamLibraryRoots = async (steamInstallPath: string): Promise<string[]> => {
  const libraryFoldersPath = nodePath.join(steamInstallPath, "steamapps", "libraryfolders.vdf");
  try {
    return uniquePaths([
      steamInstallPath,
      ...parseLibraryFolders(await fs.promises.readFile(libraryFoldersPath, "utf8")),
    ]);
  } catch {
    return [steamInstallPath];
  }
};

const appManifestPath = (libraryRoot: string, appId: string) =>
  nodePath.join(libraryRoot, "steamapps", `appmanifest_${appId}.acf`);

export type SteamAppLocation = {
  steamInstallPath: string;
  steamAppsFolder: string;
};

const getInstallPathsToSearch = (
  steamInstallPath: string | undefined,
  platform: NodeJS.Platform,
  homeDirectory: string,
) => (steamInstallPath ? [steamInstallPath] : getSteamInstallCandidates(platform, homeDirectory));

export const findSteamAppLocationSync = (
  appId: string,
  steamInstallPath?: string,
  platform = process.platform,
  homeDirectory = os.homedir(),
): SteamAppLocation | undefined => {
  for (const installPath of getInstallPathsToSearch(steamInstallPath, platform, homeDirectory)) {
    const libraryRoot = getSteamLibraryRootsSync(installPath).find((candidate) =>
      fs.existsSync(appManifestPath(candidate, appId)),
    );
    if (libraryRoot) {
      return { steamInstallPath: installPath, steamAppsFolder: nodePath.join(libraryRoot, "steamapps") };
    }
  }
  return undefined;
};

export const findSteamAppLocation = async (
  appId: string,
  steamInstallPath?: string,
  platform = process.platform,
  homeDirectory = os.homedir(),
): Promise<SteamAppLocation | undefined> => {
  for (const installPath of getInstallPathsToSearch(steamInstallPath, platform, homeDirectory)) {
    for (const libraryRoot of await getSteamLibraryRoots(installPath)) {
      try {
        await fs.promises.stat(appManifestPath(libraryRoot, appId));
        return { steamInstallPath: installPath, steamAppsFolder: nodePath.join(libraryRoot, "steamapps") };
      } catch {
        // Try the next library, then the next Steam installation.
      }
    }
  }
  return undefined;
};

export const findSteamAppsFolderSync = (
  appId: string,
  steamInstallPath?: string,
  platform = process.platform,
  homeDirectory = os.homedir(),
): string | undefined => findSteamAppLocationSync(appId, steamInstallPath, platform, homeDirectory)?.steamAppsFolder;

export const findSteamAppsFolder = async (
  appId: string,
  steamInstallPath?: string,
  platform = process.platform,
  homeDirectory = os.homedir(),
): Promise<string | undefined> =>
  (await findSteamAppLocation(appId, steamInstallPath, platform, homeDirectory))?.steamAppsFolder;

export const getCompatDataPrefixSync = (appId: string, steamAppsFolder?: string): string | undefined => {
  const resolvedSteamAppsFolder = steamAppsFolder ?? findSteamAppsFolderSync(appId);
  if (!resolvedSteamAppsFolder) return undefined;
  return nodePath.join(resolvedSteamAppsFolder, "compatdata", appId, "pfx");
};
