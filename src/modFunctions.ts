import { fork } from "child_process";
import { parse, getTime } from "date-fns";
import Registry from "winreg";
import * as VDF from "@node-steam/vdf";
import * as dumbfs from "fs";
import appData from "./appData";
import fetch from "electron-fetch";
import { zonedTimeToUtc } from "date-fns-tz";
import * as nodePath from "path";
import * as fsExtra from "fs-extra";
import * as os from "os";
import { XMLParser } from "fast-xml-parser";
import { gameToGameFolder, gameToManifest, gameToSteamId, SupportedGames } from "./supportedGames";
import { decodeHTML } from "entities";

const matchAuthorNameInSteamHtmlTag = /.*>(.+?)'s .*?<\/a>/;
const matchBreadcrumbsInSteamPageHtml = /<div class="breadcrumbs">(.*?)<\/div>/s;
const xmlParser = new XMLParser();
export function fetchModData(
  ids: string[],
  cb: (modData: ModData) => void,
  log: (msg: string) => void,
  retryIndex = 0
) {
  const child = fork(
    nodePath.join(__dirname, "sub.js"),
    [gameToSteamId[appData.currentGame], "getItems", ids.filter((id) => !isNaN(parseFloat(id))).join(",")],
    {}
  );
  child.on("message", (workshopData: WorkshopItemStringInsteadOfBigInt[]) => {
    for (const workshopItem of workshopData) {
      if (workshopItem) {
        fetch(`https://steamcommunity.com/profiles/${workshopItem.owner.steamId64}?xml=1`)
          .then((data) => data.buffer())
          .then((data) => {
            const steamProfile = xmlParser.parse(data);
            const modData = {
              workshopId: workshopItem.publishedFileId,
              humanName: workshopItem.title,
              author: steamProfile?.profile?.steamID?.toString() ?? "",
              reqModIdToName: [],
              lastChanged: workshopItem.timeUpdated * 1000,
              subscriptionTime: workshopItem.timeAddedToUserList * 1000,
              isDeleted: false,
              tags: workshopItem.tags,
            } as ModData;
            cb(modData);
          })
          .catch();
      }
    }
  });

  ids.forEach(async (workshopId) => {
    fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`)
      .then((res) => res.text())
      .then((body) => {
        let isDeleted = false;
        let humanName = "";
        try {
          const regexpSize = /<div class="workshopItemTitle">(.+)<\/div>/;
          const match = body.match(regexpSize);
          if (match && match[1] != null) {
            humanName = decodeHTML(match[1]);
          } else {
            log(`failed fetching humanName for ${workshopId}`);

            const regexpDeleted = /<h3>There was a problem accessing the item.\s+?Please try again.<\/h3>/;
            const match = body.match(regexpDeleted);
            if (match && match[0]) isDeleted = true;
          }
        } catch (err) {
          log(`failed fetching mod page for ${workshopId}`);
          if (err instanceof Error) log(err.message);
        }

        let author = "";
        try {
          const regexBreadcrumbsMatch = body.match(matchBreadcrumbsInSteamPageHtml);
          if (regexBreadcrumbsMatch && regexBreadcrumbsMatch[1]) {
            const breadcrumbs = regexBreadcrumbsMatch[1];
            const match = breadcrumbs && breadcrumbs.match(matchAuthorNameInSteamHtmlTag);
            if (match && match[1] != null) {
              author = decodeHTML(decodeHTML(match[1])); // the author is already encoded in the steam page here for some reason
            } else {
              log(`failed fetching author for ${workshopId}`);
            }
          } else {
            log(`failed fetching author for ${workshopId}`);
          }
        } catch (err) {
          log(`failed fetching mod page for ${workshopId}`);
          if (err instanceof Error) log(err.message);
        }

        const reqModIdToName: [string, string][] = [];
        try {
          const requiredItemsContainerInnerRegex = /id="RequiredItems"(.+?)<\/div>/s;
          const requiredItemsContainerInner = body.match(requiredItemsContainerInnerRegex);
          if (requiredItemsContainerInner && requiredItemsContainerInner[1]) {
            const requiredModsIdsRegex = /filedetails\/\?id=(\w+)/gs;
            if (requiredItemsContainerInner && requiredItemsContainerInner[1]) {
              const requiredModsIds = requiredItemsContainerInner[1].matchAll(requiredModsIdsRegex);
              const reqIds = [...requiredModsIds]
                .filter((matchAllResult) => matchAllResult && matchAllResult[1])
                .map((matchAllResult) => matchAllResult[1]);

              const requiredItemHumanNameIdsRegex = /class="requiredItem">[\n\r\t]+(.*?)[\n\r\t]+/gs;
              const requiredItemHumanNameIds = requiredItemsContainerInner[1].matchAll(
                requiredItemHumanNameIdsRegex
              );
              const reqHumanNames = [...requiredItemHumanNameIds]
                .filter((matchAllResult) => matchAllResult && matchAllResult[1])
                .map((matchAllResult) => matchAllResult[1]);

              if (reqIds && reqIds[0] && reqHumanNames && reqHumanNames[0]) {
                reqModIdToName.push([reqIds[0], reqHumanNames[0]]);
              }
            }
          }
        } catch (err) {
          log(`failed fetching mod page for ${workshopId}`);
          if (err instanceof Error) log(err.message);
        }

        let lastChanged = undefined;
        try {
          const detailsStatRightInnerRegex = /class="detailsStatRight">(.+?)<\/div>/gs;
          const detailsStatRightInner = body.matchAll(detailsStatRightInnerRegex);
          const timeMatches = [...detailsStatRightInner]
            .filter((matchAllResult) => matchAllResult[1])
            .map((matchAllResult) => matchAllResult[1]);

          if (timeMatches.length > 0) {
            // log(humanName);
            // log(timeMatches);
            const steamDate = timeMatches[2] ?? timeMatches[1]; // if mod was never updated, just uploaded
            //steamDate = "2 Oct, 2021 @ 11:25am";

            if (steamDate) {
              const dateFragments = steamDate
                .replace(",", "")
                .replace("@", "")
                .split(" ")
                .filter((str) => str !== "");
              const hasYear = dateFragments.length > 3;

              const day = dateFragments[0];
              const date = dateFragments.join(" ");
              const hours = dateFragments[hasYear ? 3 : 2].split(":")[0];
              const hourFormat = hours.length > 1 ? "hh" : "h";
              const dayFormat = day.length > 1 ? "dd" : "d";

              // log(`DATE: ${date}`);
              const format = dayFormat + " MMM " + (hasYear ? "yyyy " : "") + hourFormat + ":mma";
              // log(`date: ` + date);
              // log(`FORMAT: ` + format);
              const result = zonedTimeToUtc(parse(date, format, new Date()), "America/Phoenix");
              // log(result);
              lastChanged = getTime(result);
            }
          }
        } catch (err) {
          if (err instanceof Error) log(err.message);
        }

        if (humanName || isDeleted) {
          const modData = {
            workshopId,
            humanName,
            author,
            reqModIdToName,
            lastChanged,
            isDeleted,
            subscriptionTime: 0,
          } as ModData;
          cb(modData);
        }
      })
      .catch(async () => {
        if (retryIndex < 3) {
          log(`Retrying fetching mod data for mod with id ${workshopId}, retry number ${retryIndex}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          fetchModData([workshopId], cb, log, retryIndex + 1);
        }
      });
  });
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
  const thumbnailPath = nodePath.join(dataPath, fileName.replace(/\.pack$/, ".png"));
  try {
    await dumbfs.accessSync(thumbnailPath, dumbfs.constants.R_OK);
    doesThumbnailExist = true;
    // eslint-disable-next-line no-empty
  } catch {}

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

const getDataMods = async (gameDir: string, log: (msg: string) => void): Promise<Mod[]> => {
  const dataPath = await getDataPath(log);
  if (!dataPath) throw new Error("Data folder not found");

  const vanillaPacks: string[] = [];
  try {
    const data = await dumbfs.readFileSync(nodePath.join(gameDir, "data", "manifest.txt"), "utf8");
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
        !vanillaPacks.find((vanillaPack) => file.name === vanillaPack)
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
    if (!dumbfs.existsSync(steamPath)) {
      console.log("Unable to find steam directory at " + steamPath);
      return;
    }
    installPath = steamPath;
  }

  const libFoldersPath = nodePath.join(installPath, "steamapps", "libraryfolders.vdf");
  console.log(`Check lib vdf at ${libFoldersPath}`);
  if (!dumbfs.existsSync(libFoldersPath)) return;
  console.log(`Found libraryfolders.vdf at ${libFoldersPath}`);

  const data = await dumbfs.readFileSync(libFoldersPath, "utf8");
  const object = VDF.parse(data).libraryfolders;
  const paths = [];
  for (const property in object) {
    paths.push(object[property].path);
  }

  for (const basepath of paths) {
    const path = basepath.replaceAll("\\\\", "\\").replaceAll("//", "/");
    const worshopFilePath = nodePath.join(path, "steamapps", `appmanifest_${gameToSteamId[game]}.acf`);
    try {
      await dumbfs.readFileSync(worshopFilePath, "utf8"); // try to read the file to check for its existence
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
      `appmanifest_${gameToSteamId[appData.currentGame]}.acf`
    );

    const appmanifest = await dumbfs.readFileSync(appmanifestFilePath, "utf8");
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
  log: (msg: string) => void
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
    subbedTime = dumbfs.statSync(contentSubfolder).birthtimeMs;
  } catch (err) {
    log(`ERROR: ${err}`);
  }

  const files = await dumbfs.readdirSync(contentSubfolder, {
    withFileTypes: true,
  });

  const pack = files.find((file) => file.name.endsWith(".pack"));
  const img = files.find((file) => file.name.endsWith(".png"));

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
  const dataMods = await getDataMods(
    appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
    log
  );
  mods.push(...dataMods);

  console.log(
    "DATA MODS THAT ARE SIMLINKS:",
    dataMods.filter((mod) => mod.isSymbolicLink)
  );

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
