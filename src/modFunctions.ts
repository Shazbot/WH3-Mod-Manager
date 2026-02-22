import { fork } from "child_process";
import Registry from "winreg";
import * as VDF from "@node-steam/vdf";
import * as dumbfs from "fs";
import appData from "./appData";
import * as nodePath from "path";
import * as fsExtra from "fs-extra";
import * as os from "os";
import { gameToGameFolder, gameToManifest, gameToSteamId, SupportedGames } from "./supportedGames";

const wh3mmWorkshopId = "2845454582";
const steamWorkerResponseTimeoutMs = 30_000;

const runSteamSubProcess = <T>(
  command: "getModsData" | "getItems",
  payload: string,
  log: (msg: string) => void,
): Promise<T> => {
  const args = [gameToSteamId[appData.currentGame], command, payload];
  const child = fork(nodePath.join(__dirname, "sub.js"), args, {});

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // no-op
      }
      reject(new Error(`Steam helper timed out for command ${command}`));
    }, steamWorkerResponseTimeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
    };

    child.once("message", (message: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(message);
    });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Steam helper exited before responding for ${command} (code=${code ?? "null"}, signal=${
            signal ?? "none"
          })`,
        ),
      );
    });
  }).catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`[Steam] ${command} failed: ${errorMessage}`);
    throw error;
  });
};

export const normalizeWorkshopIds = (ids: string[]) => {
  return Array.from(new Set(ids.filter((id) => /^\d+$/.test(id))));
};

export async function fetchModData(ids: string[], log: (msg: string) => void): Promise<ModData[]> {
  const dedupedIds = normalizeWorkshopIds(ids);
  if (dedupedIds.length === 0) {
    return [];
  }

  const joinedIds = dedupedIds.join(",");
  const modsData = await runSteamSubProcess<ModsData>("getModsData", joinedIds, log);
  const workshopData = modsData.mods || [];
  const modsDataDependencies = modsData.dependencies || {};
  const modsDataAuthors = modsData.authors || {};

  const dedupedDependencyIds = Array.from(new Set(Object.values(modsDataDependencies).flat())).filter(
    (depId) => depId && depId !== wh3mmWorkshopId,
  );
  const unsubbedDepIds = dedupedDependencyIds.filter(
    (depId) => !workshopData.some((mod) => mod.publishedFileId == depId),
  );

  let depModsData: WorkshopItemStringInsteadOfBigInt[] = [];
  if (unsubbedDepIds.length > 0) {
    try {
      depModsData = await runSteamSubProcess<WorkshopItemStringInsteadOfBigInt[]>(
        "getItems",
        unsubbedDepIds.join(","),
        log,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`[Steam] Failed resolving dependency titles, continuing with partial data: ${errorMessage}`);
    }
  }

  const modIdToModName = new Map<string, string>();
  for (const modData of depModsData.concat(workshopData)) {
    modIdToModName.set(modData.publishedFileId, modData.title);
  }

  const resolvedModData: ModData[] = [];
  for (const workshopItem of workshopData) {
    if (!workshopItem) continue;

    const depIds = (modsDataDependencies[workshopItem.publishedFileId] || []).filter(
      (depId) => depId !== wh3mmWorkshopId,
    );
    const reqModIdToName = depIds.map((depId) => [depId, modIdToModName.get(depId) ?? ""] as [string, string]);
    const authorId = workshopItem.owner.steamId64.toString();

    resolvedModData.push({
      workshopId: workshopItem.publishedFileId,
      humanName: workshopItem.title,
      author: modsDataAuthors[authorId] ?? "",
      reqModIdToName,
      reqModIds: depIds,
      lastChanged: workshopItem.timeUpdated * 1000,
      subscriptionTime: workshopItem.timeAddedToUserList * 1000,
      isDeleted: false,
      tags: workshopItem.tags,
    } as ModData);
  }

  return resolvedModData;
}

async function getDataPath(log: (msg: string) => void): Promise<string> {
  if (!appData.gamesToGameFolderPaths[appData.currentGame].dataFolder) {
    await getFolderPaths(log);
  }
  return appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string;
}

export async function getDataMod(filePath: string, log: (msg: string) => void): Promise<Mod> {
  const dataPath = await getDataPath(log);
  if (!dataPath) throw new Error("Data folder not found");

  // console.log("file path is:", filePath);
  const fileName = nodePath.basename(filePath);

  let lastChangedLocal = undefined;
  let size = -1;
  let isSymbolicLink = false;
  try {
    const stats = await dumbfs.lstatSync(filePath);
    lastChangedLocal = stats.mtimeMs;
    size = stats.size;
    isSymbolicLink = stats.isSymbolicLink();
  } catch (err) {
    log(`ERROR: ${err}`);
  }

  let doesThumbnailExist = false;
  let thumbnailPath = nodePath.join(dataPath, fileName.replace(/\.pack$/, ".png"));
  try {
    await dumbfs.accessSync(thumbnailPath, dumbfs.constants.R_OK);
    doesThumbnailExist = true;
    // eslint-disable-next-line no-empty
  } catch {
    try {
      thumbnailPath = nodePath.join(dataPath, fileName.replace(/\.pack$/, ".jpg"));
      await dumbfs.accessSync(thumbnailPath, dumbfs.constants.R_OK);
      doesThumbnailExist = true;
    } catch {}
  }

  let mergedModsData = null;
  try {
    mergedModsData = await fsExtra.readJSON(filePath.replace(".pack", ".json"));
    // console.log(mergedModsData);
    // eslint-disable-next-line no-empty
  } catch {}

  const linuxBit = process.platform === "linux" ? "Z:" : "";
  const mod: Mod = {
    humanName: "",
    name: fileName,
    path: filePath,
    modDirectory: linuxBit + nodePath.dirname(filePath),
    imgPath: doesThumbnailExist ? thumbnailPath : "",
    workshopId: fileName,
    isEnabled: false,
    isInData: true,
    isInModding: nodePath.basename(nodePath.dirname(filePath)) == "modding",
    loadOrder: undefined,
    lastChangedLocal,
    author: "",
    isDeleted: false,
    isMovie: false,
    size,
    mergedModsData,
    isSymbolicLink,
    tags: ["mod"],
  };
  return mod;
}

const getDataMods = async (
  gameDir: string,
  log: (msg: string) => void,
  subFolder?: string,
): Promise<Mod[]> => {
  let dataPath = await getDataPath(log);
  if (!dataPath) throw new Error("Data folder not found");

  if (subFolder) {
    dataPath = nodePath.join(dataPath, subFolder);
    if (!fsExtra.existsSync(dataPath)) {
      return [];
    }
  }

  const vanillaPacks: string[] = [];
  try {
    const data = await dumbfs.promises.readFile(nodePath.join(gameDir, "data", "manifest.txt"), "utf8");
    const re = /([^\s]+)/;
    data.split("\n").map((line) => {
      const found = line.match(re);
      if (found) {
        vanillaPacks.push(found[1]);
      }
    });
    if (appData.currentGame == "attila") {
      vanillaPacks.push("charlemagne.pack");
    }
    if (appData.currentGame == "rome2") {
      vanillaPacks.push("gaul.pack", "blood_rome2.pack", "punic.pack");
    }
  } catch (e) {
    if (gameToManifest[appData.currentGame])
      vanillaPacks.splice(0, 0, ...(gameToManifest[appData.currentGame] as string[]));
  }

  appData.allVanillaPackNames = vanillaPacks.filter((pack) => pack.endsWith(".pack"));

  const files = await dumbfs.readdirSync(dataPath, { withFileTypes: true });

  const dataModsPromises = files
    .filter(
      (file) =>
        !file.isDirectory() &&
        file.name.endsWith(".pack") &&
        !vanillaPacks.find((vanillaPack) => file.name === vanillaPack),
    )
    .map(async (file) => {
      return getDataMod(nodePath.join(dataPath, file.name), log);
    });

  const fulfilled = await Promise.allSettled(dataModsPromises);

  return (fulfilled.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Mod>[]).map((r) => {
    const mod = r.value;
    return mod;
  });
};

const regKeyValuesAsPromise = (regKey: Registry.Registry): Promise<{ name: string; value: string }[]> => {
  return new Promise((resolve, reject) => {
    regKey.values(async function (err, items: { name: string; value: string }[]) {
      if (err) reject("ERROR: " + err);
      resolve(items);
    });
  });
};

// Find the steamapps folder, e.g. K:\SteamLibrary\steamapps\
const getSteamAppsFolder = async (newGame?: SupportedGames) => {
  const game = newGame || appData.currentGame;
  let installPath = "";
  if (process.platform === "win32") {
    const regKey = new Registry({
      hive: Registry.HKLM,
      key: "\\SOFTWARE\\Wow6432Node\\Valve\\Steam",
    });

    const items = await regKeyValuesAsPromise(regKey);
    const installPathObj = items.find((x) => x.name === "InstallPath");
    if (!installPathObj) {
      console.log("Unable to find InstallPath in Windows registry");
      return;
    }
    installPath = installPathObj.value;
  } else if (process.platform === "linux") {
    const steamPath = os.homedir() + "/.steam/steam";
    try {
      await dumbfs.promises.access(steamPath);
    } catch {
      console.log("Unable to find steam directory at " + steamPath);
      return;
    }
    installPath = steamPath;
  }

  const libFoldersPath = nodePath.join(installPath, "steamapps", "libraryfolders.vdf");
  console.log(`Check lib vdf at ${libFoldersPath}`);
  try {
    await dumbfs.promises.access(libFoldersPath);
  } catch {
    return;
  }
  console.log(`Found libraryfolders.vdf at ${libFoldersPath}`);

  const data = await dumbfs.promises.readFile(libFoldersPath, "utf8");
  const object = VDF.parse(data).libraryfolders;
  const paths = [];
  for (const property in object) {
    paths.push(object[property].path);
  }

  for (const basepath of paths) {
    const path = basepath.replaceAll("\\\\", "\\").replaceAll("//", "/");
    const worshopFilePath = nodePath.join(path, "steamapps", `appmanifest_${gameToSteamId[game]}.acf`);
    try {
      await dumbfs.promises.readFile(worshopFilePath, "utf8"); // try to read the file to check for its existence
      console.log(`Found appmanifest_${gameToSteamId[game]}.acf at ${worshopFilePath}`);

      const steamAppsFolderPath = nodePath.join(path, "steamapps");
      appData.gamesToSteamAppsFolderPaths[game] = steamAppsFolderPath;
      return steamAppsFolderPath;
      // eslint-disable-next-line no-empty
    } catch (err) {}
  }
};

export const getLastUpdated = async () => {
  try {
    const steamAppsFolderPath =
      appData.gamesToSteamAppsFolderPaths[appData.currentGame] || (await getSteamAppsFolder());
    if (!steamAppsFolderPath) return;

    const appmanifestFilePath = nodePath.join(
      steamAppsFolderPath,
      `appmanifest_${gameToSteamId[appData.currentGame]}.acf`,
    );

    const appmanifest = await dumbfs.promises.readFile(appmanifestFilePath, "utf8");
    const lastUpdated = VDF.parse(appmanifest).AppState.LastUpdated;
    console.log("lastUpdated:", lastUpdated);
    return lastUpdated;
  } catch (e) {
    /* empty */
  }
};

export const getFolderPaths = async (log: (msg: string) => void, newGame?: SupportedGames) => {
  const game = newGame || appData.currentGame;
  console.log(`getFolderPaths for ${game}`);
  const steamAppsFolderPath =
    appData.gamesToSteamAppsFolderPaths[game] || (await getSteamAppsFolder(newGame));

  appData.gamesToGameFolderPaths[game] = appData.gamesToGameFolderPaths[game] || {};
  if (!steamAppsFolderPath) return;

  const contentFolder = nodePath.join(steamAppsFolderPath, "workshop", "content", gameToSteamId[game]);
  appData.gamesToGameFolderPaths[game].contentFolder = contentFolder;

  const gamePath = nodePath.join(steamAppsFolderPath, "common", gameToGameFolder[game]);
  appData.gamesToGameFolderPaths[game].gamePath = gamePath;
  appData.gamesToGameFolderPaths[game].dataFolder = nodePath.join(gamePath, "data");

  log(`Content folder is at ${appData.gamesToGameFolderPaths[game].contentFolder}`);
  log(`Game path is at ${appData.gamesToGameFolderPaths[game].gamePath}`);
};

export async function getContentModInFolder(
  contentSubFolderName: string,
  log: (msg: string) => void,
): Promise<Mod> {
  if (!appData.gamesToGameFolderPaths[appData.currentGame].contentFolder) {
    await getFolderPaths(log);
  }
  if (!appData.gamesToGameFolderPaths[appData.currentGame].contentFolder)
    throw new Error("Content folder not found");
  const contentFolder = appData.gamesToGameFolderPaths[appData.currentGame].contentFolder as string;
  const contentSubfolder = nodePath.join(contentFolder, contentSubFolderName);

  let subbedTime = -1;
  try {
    const stats = await dumbfs.promises.stat(contentSubfolder);
    subbedTime = stats.birthtimeMs;
  } catch (err) {
    log(`ERROR: ${err}`);
  }

  const files = await dumbfs.readdirSync(contentSubfolder, {
    withFileTypes: true,
  });

  const pack = files.find((file) => file.name.endsWith(".pack"));
  const img =
    files.find((file) => file.name.endsWith(".png")) ?? files.find((file) => file.name.endsWith(".jpg"));

  if (!pack) throw new Error(`Content folder ${contentSubFolderName} doesn't contain a pack!`);

  let lastChangedLocal = undefined;
  let size = -1;
  let isSymbolicLink = false;
  try {
    const stats = await dumbfs.lstatSync(nodePath.join(contentSubfolder, pack.name));
    lastChangedLocal = stats.mtimeMs;
    size = stats.size;
    isSymbolicLink = stats.isSymbolicLink();
  } catch (err) {
    log(`ERROR: ${err}`);
  }

  // log(`Reading pack file ${contentFolder}\\${file.name}\\${pack.name}`);
  const packPath = nodePath.join(contentSubfolder, pack.name);
  const imgPath = (img && nodePath.join(contentSubfolder, img.name)) || "";
  const mod: Mod = {
    author: "",
    humanName: "",
    name: pack.name,
    path: packPath,
    modDirectory: nodePath.join(contentSubfolder),
    imgPath: imgPath,
    workshopId: contentSubFolderName,
    isEnabled: false,
    isInData: false,
    loadOrder: undefined,
    lastChangedLocal,
    isDeleted: false,
    isMovie: false,
    subbedTime: (subbedTime != -1 && subbedTime) || lastChangedLocal,
    size,
    isSymbolicLink,
    tags: ["mod"],
  };
  return mod;
}

export async function getMods(log: (msg: string) => void): Promise<Mod[]> {
  const mods: Mod[] = [];

  if (!appData.gamesToGameFolderPaths[appData.currentGame].contentFolder) {
    await getFolderPaths(log);
  }
  if (!appData.gamesToGameFolderPaths[appData.currentGame].contentFolder)
    throw new Error("Content folder not found");
  const contentFolder = appData.gamesToGameFolderPaths[appData.currentGame].contentFolder as string;

  if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) throw new Error("Game folder not found");

  const moddingDataMods = await getDataMods(
    appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
    log,
    "modding",
  );
  moddingDataMods.forEach((mod) => {
    mod.isInModding = true;
  });
  mods.push(...moddingDataMods);

  const dataMods = await getDataMods(
    appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
    log,
  );
  mods.push(...dataMods);

  console.log(
    "DATA MODS THAT ARE SIMLINKS:",
    dataMods.filter((mod) => mod.isSymbolicLink),
  );

  if (appData.currentGame != "shogun2") {
    const files = await dumbfs.readdirSync(contentFolder, { withFileTypes: true });
    const newMods = files
      .filter((file) => file.isDirectory())
      .map(async (contentSubFolder) => {
        // log(`Reading folder ${contentFolder}\\${file.name}`);
        return getContentModInFolder(contentSubFolder.name, log);
      });

    const settledMods = await Promise.allSettled(newMods);
    (settledMods.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Mod>[]).map((r) => {
      const mod = r.value;
      // if a content folder is empty it'll be undefined
      if (mod != null) {
        mods.push(mod);
      }
    });
  }

  // if a mod in data is missing a thumbnail, use the content mod's thumbnail
  for (const mod of mods) {
    if (mod.isInData && mod.imgPath == "") {
      const contentMod = mods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
      if (contentMod && contentMod.imgPath != "") {
        mod.imgPath = contentMod.imgPath;
      }
    }
  }

  return mods;
}
