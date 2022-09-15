import { parse, getTime } from "date-fns";
import Registry from "winreg";
import * as VDF from "@node-steam/vdf";
import * as fs from "fs/promises";
import * as dumbfs from "fs";
import appData from "./appData";
import fetch from "electron-fetch";
import { zonedTimeToUtc } from "date-fns-tz";

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
          if (match[1] != null) {
            humanName = match[1];
          } else {
            log(`failed reading humanName for ${workshopId}`);
          }
        } catch (err) {
          log(`failed fetching mod page for ${workshopId}`);
          log(err);

          const regexpDeleted = /<h3>There was a problem accessing the item.\s+?Please try again.<\/h3>/;
          const match = body.match(regexpDeleted);
          if (match[0]) isDeleted = true;
        }

        let author = "";
        try {
          const regexBreadcrumbs = /<div class="breadcrumbs">(.*?)<\/div>/s;
          const breadcrumbs = body.match(regexBreadcrumbs)[1];
          const match = breadcrumbs && breadcrumbs.match(/.*>(.+?)'s .*?<\/a>/);
          if (match && match[1] != null) {
            author = match[1];
          } else {
            log(`failed reading author for ${workshopId}`);
          }
        } catch (err) {
          log(`failed fetching mod page for ${workshopId}`);
          log(err);
        }

        let reqModIds: string[] = [];
        try {
          const requiredItemsContainerInnerRegex = /id="RequiredItems"(.+?)<\/div>/s;
          const requiredItemsContainerInner = body.match(requiredItemsContainerInnerRegex);
          if (requiredItemsContainerInner && requiredItemsContainerInner[1]) {
            const requiredModsIdsRegex = /filedetails\/\?id=(\w+)/gs;
            const requiredModsIds = requiredItemsContainerInner[1].matchAll(requiredModsIdsRegex);
            reqModIds = [...requiredModsIds].map((matchAllResult) => matchAllResult[1]);
          }
        } catch (err) {
          log(`failed fetching mod page for ${workshopId}`);
          log(err);
        }

        let lastChanged = undefined;
        try {
          const detailsStatRightInnerRegex = /class="detailsStatRight">(.+?)<\/div>/gs;
          const detailsStatRightInner = body.matchAll(detailsStatRightInnerRegex);
          const timeMatches = [...detailsStatRightInner].map((matchAllResult) => matchAllResult[1]);
          // log(humanName);
          // log(timeMatches);
          const steamDate = timeMatches[2] ?? timeMatches[1]; // if mod was never updated, just uploaded
          //steamDate = "2 Oct, 2021 @ 11:25am";

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
        } catch (err) {
          log(err);
        }

        if (humanName || isDeleted) {
          const modData = { workshopId, humanName, author, reqModIds, lastChanged, isDeleted } as ModData;
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
  return appData.dataFolder;
}

export async function getDataMod(fileName: string, log: (msg: string) => void): Promise<Mod> {
  const dataPath = await getDataPath(log);
  if (!dataPath) return;

  let lastChanged = undefined;
  try {
    lastChanged = await fs.stat(`${dataPath}\\${fileName}`).then((stats) => {
      return stats.mtimeMs;
    });
  } catch (err) {
    log(`ERROR: ${err}`);
  }

  let doesThumbnailExist = false;
  const thumbnailPath = `${dataPath}\\${fileName.replace(/\.pack$/, ".png")}`;
  try {
    await fs.access(thumbnailPath, dumbfs.constants.R_OK);
    doesThumbnailExist = true;
    // eslint-disable-next-line no-empty
  } catch {}

  const mod: Mod = {
    humanName: "",
    name: fileName,
    path: `${dataPath}\\${fileName}`,
    modDirectory: dataPath,
    imgPath: doesThumbnailExist ? thumbnailPath : "",
    workshopId: fileName,
    isEnabled: false,
    isInData: true,
    loadOrder: undefined,
    lastChanged,
    author: "",
    isDeleted: false,
    isMovie: false,
  };
  return mod;
}

const getDataMods = async (gameDir: string, log: (msg: string) => void): Promise<Mod[]> => {
  const dataPath = await getDataPath(log);
  if (!dataPath) return;

  const vanillaPacks: string[] = [];
  return fs.readFile(`${gameDir}\\data\\manifest.txt`, "utf8").then(async (data) => {
    const re = /([^\s]+)/;
    data.split("\n").map((line) => {
      const found = line.match(re);
      if (found) {
        vanillaPacks.push(found[1]);
      }
    });

    const files = await fs.readdir(dataPath, { withFileTypes: true });

    const dataModsPromises = files
      .filter(
        (file) =>
          file.isFile() &&
          file.name.endsWith(".pack") &&
          !vanillaPacks.find((vanillaPack) => file.name === vanillaPack)
      )
      .map(async (file) => {
        return getDataMod(file.name, log);
      });

    const fulfilled = await Promise.allSettled(dataModsPromises);

    return (fulfilled.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Mod>[]).map((r) => {
      const mod = r.value;
      return mod;
    });
  });
};

const getFolderPaths = async (log: (msg: string) => void) => {
  const regKey = new Registry({
    hive: Registry.HKLM,
    key: "\\SOFTWARE\\Wow6432Node\\Valve\\Steam",
  });

  const items = await regKeyValuesAsPromise(regKey);
  const installPathObj = items.find((x) => x.name === "InstallPath");
  if (!installPathObj) return;

  const installPath = installPathObj.value;
  const libFoldersPath = `${installPath}\\steamapps\\libraryfolders.vdf`;
  log(`Found libraryfolders.vdf at ${libFoldersPath}`);

  const data = await fs.readFile(libFoldersPath, "utf8");
  const object = VDF.parse(data).libraryfolders;
  const paths = [];
  for (const property in object) {
    paths.push(object[property].path);
  }

  for (const path of paths) {
    const worshopFilePath = `${path}\\steamapps\\appmanifest_1142710.acf`;
    try {
      await fs.readFile(worshopFilePath);
      log(`Found appmanifest_1142710.acf at ${worshopFilePath}`);
      // log(worshopFilePath);
      const contentFolder = `${path}\\steamapps\\workshop\\content\\1142710`;
      appData.contentFolder = contentFolder.replaceAll("\\\\", "\\");
      appData.gamePath = `${path}\\steamapps\\common\\Total War WARHAMMER III`.replaceAll("\\\\", "\\");
      appData.dataFolder = `${appData.gamePath}\\data`.replaceAll("\\\\", "\\");

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
  if (!appData.contentFolder) return;
  const contentFolder = appData.contentFolder;

  const files = await fs.readdir(`${contentFolder}\\${contentSubFolderName}`, { withFileTypes: true });

  const pack = files.find((file) => file.name.endsWith(".pack"));
  const img = files.find((file) => file.name.endsWith(".png"));

  if (pack) {
    let lastChanged = undefined;
    try {
      lastChanged = await fs.stat(`${contentFolder}\\${contentSubFolderName}\\${pack.name}`).then((stats) => {
        return stats.mtimeMs;
      });
    } catch (err) {
      log(`ERROR: ${err}`);
    }

    // log(`Reading pack file ${contentFolder}\\${file.name}\\${pack.name}`);
    const packPath = `${contentFolder}\\${contentSubFolderName}\\${pack.name}`;
    const imgPath = `${contentFolder}\\${contentSubFolderName}\\${img.name}`;
    const mod: Mod = {
      author: "",
      humanName: "",
      name: pack.name,
      path: packPath,
      modDirectory: `${contentFolder}\\${contentSubFolderName}`,
      imgPath: imgPath,
      workshopId: contentSubFolderName,
      isEnabled: false,
      isInData: false,
      loadOrder: undefined,
      lastChanged,
      isDeleted: false,
      isMovie: false,
    };
    return mod;
  }
}

export async function getMods(log: (msg: string) => void): Promise<Mod[]> {
  const mods: Mod[] = [];

  if (!appData.contentFolder) {
    await getFolderPaths(log);
  }
  if (!appData.contentFolder) return;
  const contentFolder = appData.contentFolder;

  const dataMods = await getDataMods(appData.gamePath, log);
  mods.push(...dataMods);

  const files = await fs.readdir(contentFolder, { withFileTypes: true });
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
