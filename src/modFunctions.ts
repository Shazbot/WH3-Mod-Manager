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
        let humanName = undefined;
        try {
          const regexpSize = /<div class="workshopItemTitle">(.+)<\/div>/;
          const match = body.match(regexpSize);
          humanName = match[1];
        } catch (err) {
          log(`failed for ${workshopId}`);
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
          if (match) {
            author = match[1];
          }
        } catch (err) {
          log(`failed for ${workshopId}`);
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
          log(`failed for ${workshopId}`);
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

const getDataMods = async (gameDir: string, log: (msg: string) => void): Promise<Mod[]> => {
  const vanillaPacks: string[] = [];

  return fs.readFile(`${gameDir}\\data\\manifest.txt`, "utf8").then(async (data) => {
    const re = /([^\s]+)/;
    const dataPath = `${gameDir}\\data`;
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
        let lastChanged = undefined;
        try {
          lastChanged = await fs.stat(`${dataPath}\\${file.name}`).then((stats) => {
            return stats.mtimeMs;
          });
        } catch (err) {
          log(`ERROR: ${err}`);
        }

        let doesThumbnailExist = false;
        const thumbnailPath = `${dataPath}\\${file.name.replace(/\.pack$/, ".png")}`;
        try {
          await fs.access(thumbnailPath, dumbfs.constants.R_OK);
          doesThumbnailExist = true;
          // eslint-disable-next-line no-empty
        } catch {}

        const mod: Mod = {
          humanName: "",
          name: file.name,
          path: `${dataPath}\\${file.name}`,
          modDirectory: dataPath,
          imgPath: doesThumbnailExist ? thumbnailPath : "",
          workshopId: file.name,
          isEnabled: false,
          isInData: true,
          loadOrder: undefined,
          lastChanged,
          author: "",
          isDeleted: false,
          isMovie: false,
        };
        return mod;
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
    .map(async (file) => {
      // log(`Reading folder ${contentFolder}\\${file.name}`);
      const files = await fs.readdir(`${contentFolder}\\${file.name}`, { withFileTypes: true });

      const pack = files.find((file) => file.name.endsWith(".pack"));
      const img = files.find((file) => file !== pack);

      if (pack) {
        let lastChanged = undefined;
        try {
          lastChanged = await fs.stat(`${contentFolder}\\${file.name}\\${pack.name}`).then((stats) => {
            return stats.mtimeMs;
          });
        } catch (err) {
          log(`ERROR: ${err}`);
        }

        // log(`Reading pack file ${contentFolder}\\${file.name}\\${pack.name}`);
        const packPath = `${contentFolder}\\${file.name}\\${pack.name}`;
        const imgPath = `${contentFolder}\\${file.name}\\${img.name}`;
        const mod: Mod = {
          author: "",
          humanName: "",
          name: pack.name,
          path: packPath,
          modDirectory: `${contentFolder}\\${file.name}`,
          imgPath: imgPath,
          workshopId: file.name,
          isEnabled: false,
          isInData: false,
          loadOrder: undefined,
          lastChanged,
          isDeleted: false,
          isMovie: false,
        };
        return mod;
      }
    });

  const settledMods = await Promise.allSettled(newMods);
  (settledMods.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Mod>[]).map((r) => {
    const mod = r.value;
    mods.push(mod);
  });

  return mods;
}
