import { parse, getTime } from "date-fns";
import Registry from "winreg";
import * as VDF from "@node-steam/vdf";
import * as fsPromises from "fs/promises";
import * as dumbfs from "fs";
import appData from "./appData";
import fetch from "electron-fetch";
import { zonedTimeToUtc } from "date-fns-tz";
import * as nodePath from "path";
import * as fsExtra from "fs-extra";
import * as os from "os";

export function fetchModData(ids: string[], cb: (modData: ModData) => void, log: (msg: string) => void) {
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
            humanName = match[1];
          } else {
            log(`failed reading humanName for ${workshopId}`);

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
          const regexBreadcrumbs = /<div class="breadcrumbs">(.*?)<\/div>/s;
          const regexBreadcrumbsMatch = body.match(regexBreadcrumbs);
          if (regexBreadcrumbsMatch && regexBreadcrumbsMatch[1]) {
            const breadcrumbs = regexBreadcrumbsMatch[1];
            const match = breadcrumbs && breadcrumbs.match(/.*>(.+?)'s .*?<\/a>/);
            if (match && match[1] != null) {
              author = match[1];
            } else {
              log(`failed reading author for ${workshopId}`);
            }
          } else {
            log(`failed reading author for ${workshopId}`);
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
          } as ModData;
          cb(modData);
        }
      })
      .catch();
  });
}

async function getDataPath(log: (msg: string) => void): Promise<string> {
  if (!appData.dataFolder) {
    await getFolderPaths(log);
  }
  return appData.dataFolder as string;
}

export async function getDataMod(filePath: string, log: (msg: string) => void): Promise<Mod> {
  const dataPath = await getDataPath(log);
  if (!dataPath) throw new Error("Data folder not found");

  console.log("file path is:", filePath);
  const fileName = nodePath.basename(filePath);

  let lastChangedLocal = undefined;
  let size = -1;
  try {
    [lastChangedLocal, size] = await fsPromises.stat(filePath).then((stats) => {
      return [stats.mtimeMs, stats.size];
    });
  } catch (err) {
    log(`ERROR: ${err}`);
  }

  let doesThumbnailExist = false;
  const thumbnailPath = nodePath.join(dataPath, fileName.replace(/\.pack$/, ".png"));
  try {
    await fsPromises.access(thumbnailPath, dumbfs.constants.R_OK);
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
  };
  return mod;
}

const getDataMods = async (gameDir: string, log: (msg: string) => void): Promise<Mod[]> => {
  const dataPath = await getDataPath(log);
  if (!dataPath) throw new Error("Data folder not found");

  const vanillaPacks: string[] = [];
  return fsPromises.readFile(nodePath.join(gameDir, "data", "manifest.txt"), "utf8").then(async (data) => {
    const re = /([^\s]+)/;
    data.split("\n").map((line) => {
      const found = line.match(re);
      if (found) {
        vanillaPacks.push(found[1]);
      }
    });

    const files = await fsPromises.readdir(dataPath, { withFileTypes: true });

    const dataModsPromises = files
      .filter(
        (file) =>
          file.isFile() &&
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
  });
};

export const getFolderPaths = async (log: (msg: string) => void) => {
  let installPath = "";
  if (process.platform === "win32") {
    const regKey = new Registry({
      hive: Registry.HKLM,
      key: "\\SOFTWARE\\Wow6432Node\\Valve\\Steam",
    });

    const items = await regKeyValuesAsPromise(regKey);
    const installPathObj = items.find((x) => x.name === "InstallPath");
    if (!installPathObj) {
      log("Unable to find InstallPath in Windows registry");
      return;
    }
    installPath = installPathObj.value;
  } else if (process.platform === "linux") {
    const steamPath = os.homedir() + "/.steam/steam";
    if (!dumbfs.existsSync(steamPath)) {
      log("Unable to find steam directory at " + steamPath);
      return;
    }
    installPath = steamPath;
  }

  const libFoldersPath = nodePath.join(installPath, "steamapps", "libraryfolders.vdf");
  log(`Check lib vdf at ${libFoldersPath}`);
  if (!dumbfs.existsSync(libFoldersPath)) return;
  log(`Found libraryfolders.vdf at ${libFoldersPath}`);

  const data = await fsPromises.readFile(libFoldersPath, "utf8");
  const object = VDF.parse(data).libraryfolders;
  const paths = [];
  for (const property in object) {
    paths.push(object[property].path);
  }

  for (const basepath of paths) {
    const path = basepath.replaceAll("\\\\", "\\").replaceAll("//", "/");
    const worshopFilePath = nodePath.join(path, "steamapps", "appmanifest_1142710.acf");
    try {
      await fsPromises.readFile(worshopFilePath);
      log(`Found appmanifest_1142710.acf at ${worshopFilePath}`);
      const contentFolder = nodePath.join(path, "steamapps", "workshop", "content", "1142710");
      appData.contentFolder = contentFolder;
      appData.gamePath = nodePath.join(path, "steamapps", "common", "Total War WARHAMMER III");
      appData.dataFolder = nodePath.join(appData.gamePath, "data");

      log(`Content folder is at ${appData.contentFolder}`);
      log(`Game path is at ${appData.gamePath}`);
      // eslint-disable-next-line no-empty
    } catch (err) {}
  }
};

const regKeyValuesAsPromise = (regKey: Registry.Registry): Promise<{ name: string; value: string }[]> => {
  return new Promise((resolve, reject) => {
    regKey.values(async function (err, items: { name: string; value: string }[]) {
      if (err) reject("ERROR: " + err);
      resolve(items);
    });
  });
};

export async function getContentModInFolder(
  contentSubFolderName: string,
  log: (msg: string) => void
): Promise<Mod> {
  if (!appData.contentFolder) {
    await getFolderPaths(log);
  }
  if (!appData.contentFolder) throw new Error("Content folder not found");
  const contentFolder = appData.contentFolder;
  const contentSubfolder = nodePath.join(contentFolder, contentSubFolderName);

  let subbedTime = -1;
  try {
    [subbedTime] = await fsPromises.stat(contentSubfolder).then((stats) => {
      return [stats.birthtimeMs];
    });
  } catch (err) {
    log(`ERROR: ${err}`);
  }

  const files = await fsPromises.readdir(contentSubfolder, {
    withFileTypes: true,
  });

  const pack = files.find((file) => file.name.endsWith(".pack"));
  const img = files.find((file) => file.name.endsWith(".png"));

  if (!pack) throw new Error(`Content folder ${contentSubFolderName} doesn't contain a pack!`);

  let lastChangedLocal = undefined;
  let size = -1;
  try {
    [lastChangedLocal, size] = await fsPromises
      .stat(nodePath.join(contentSubfolder, pack.name))
      .then((stats) => {
        return [stats.mtimeMs, stats.size];
      });
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
  };
  return mod;
}

export async function getMods(log: (msg: string) => void): Promise<Mod[]> {
  const mods: Mod[] = [];

  if (!appData.contentFolder) {
    await getFolderPaths(log);
  }
  if (!appData.contentFolder) throw new Error("Content folder not found");
  const contentFolder = appData.contentFolder;

  if (!appData.gamePath) throw new Error("Game folder not found");
  const dataMods = await getDataMods(appData.gamePath, log);
  mods.push(...dataMods);

  const files = await fsPromises.readdir(contentFolder, { withFileTypes: true });
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

  return mods;
}
