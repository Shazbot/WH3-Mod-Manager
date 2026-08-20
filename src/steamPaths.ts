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

export const findSteamAppsFolderSync = (
  appId: string,
  steamInstallPath = findSteamInstallPathSync(),
): string | undefined => {
  if (!steamInstallPath) return undefined;
  const libraryRoot = getSteamLibraryRootsSync(steamInstallPath).find((candidate) =>
    fs.existsSync(appManifestPath(candidate, appId)),
  );
  return libraryRoot ? nodePath.join(libraryRoot, "steamapps") : undefined;
};

export const findSteamAppsFolder = async (
  appId: string,
  steamInstallPath?: string,
): Promise<string | undefined> => {
  const resolvedSteamInstallPath = steamInstallPath ?? (await findSteamInstallPath());
  if (!resolvedSteamInstallPath) return undefined;
  for (const libraryRoot of await getSteamLibraryRoots(resolvedSteamInstallPath)) {
    try {
      if (await fs.promises.stat(appManifestPath(libraryRoot, appId))) {
        return nodePath.join(libraryRoot, "steamapps");
      }
    } catch {
      // Try the next Steam library.
    }
  }
  return undefined;
};

export const getCompatDataPrefixSync = (appId: string, steamAppsFolder?: string): string | undefined => {
  const resolvedSteamAppsFolder = steamAppsFolder ?? findSteamAppsFolderSync(appId);
  if (!resolvedSteamAppsFolder) return undefined;
  return nodePath.join(resolvedSteamAppsFolder, "compatdata", appId, "pfx");
};
