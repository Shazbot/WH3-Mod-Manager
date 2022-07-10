import { add, parse, getUnixTime } from "date-fns";
import Registry from "winreg";
import * as VDF from "@node-steam/vdf";
import * as fs from "fs/promises";
import appData from "./appData";
import fetch from "electron-fetch";

export function fetchModData(ids: string[], cb: (modData: ModData) => void, log: (msg: string) => void) {
  ids.forEach(async (workshopId) => {
    // await new Promise((resolve) => setTimeout(resolve, index * 20));
    fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`)
      .then((res) => res.text())
      .then((body) => {
        let humanName = undefined;
        try {
          const regexpSize = /<div class="workshopItemTitle">(.+)<\/div>/;
          const match = body.match(regexpSize);
          humanName = match[1];
        } catch (err) {
          log(err);
        }
        // log(match[1]);

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
          // log(`FORMAT: ` + format);
          const result = add(parse(date, format, new Date()), { hours: 2 });
          // log(result);
          lastChanged = getUnixTime(result) * 1000;
        } catch (err) {
          log(err);
        }

        if (humanName) {
          const modData = { workshopId, humanName, reqModIds, lastChanged } as ModData;
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

        const mod: Mod = {
          humanName: "",
          name: file.name,
          path: `${dataPath}\\${file.name}`,
          modDirectory: dataPath,
          imgPath: "",
          workshopId: file.name,
          isEnabled: false,
          isInData: true,
          loadOrder: undefined,
          lastChanged,
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

export function getMods(cb: (mods: Mod[]) => void, log: (msg: string) => void) {
  const mods: Mod[] = [];

  const regKey = new Registry({
    hive: Registry.HKLM,
    key: "\\SOFTWARE\\Wow6432Node\\Valve\\Steam",
  });

  regKey.values(async function (err, items: { name: string; value: string }[]) {
    if (err) log("ERROR: " + err);
    else {
      const installPathObj = items.find((x) => x.name === "InstallPath");
      if (installPathObj) {
        const installPath = installPathObj.value;
        const libFoldersPath = `${installPath}\\steamapps\\libraryfolders.vdf`;
        log(`Found libraryfolders.vdf at ${libFoldersPath}`);

        fs.readFile(libFoldersPath, "utf8").then((data) => {
          const object = VDF.parse(data).libraryfolders;
          const paths = [];
          for (const property in object) {
            paths.push(object[property].path);
          }

          paths.find((path) => {
            const worshopFilePath = `${path}\\steamapps\\appmanifest_1142710.acf`;
            fs.readFile(worshopFilePath).then(async () => {
              log(`Found appmanifest_1142710.acf at ${worshopFilePath}`);
              // log(worshopFilePath);
              const contentFolder = `${path}\\steamapps\\workshop\\content\\1142710`;
              appData.gamePath = `${path}\\steamapps\\common\\Total War WARHAMMER III`;

              log(`Content folder is at ${contentFolder}`);
              log(`Game path is at ${appData.gamePath}`);

              const dataMods = await getDataMods(`${path}\\steamapps\\common\\Total War WARHAMMER III`, log);
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
                      lastChanged = await fs
                        .stat(`${contentFolder}\\${file.name}\\${pack.name}`)
                        .then((stats) => {
                          return stats.mtimeMs;
                        });
                    } catch (err) {
                      log(`ERROR: ${err}`);
                    }

                    // log(`Reading pack file ${contentFolder}\\${file.name}\\${pack.name}`);
                    // mainWindow.webContents.send(
                    //   "handleLog",
                    //   `Reading pack file ${contentFolder}\\${file.name}\\${pack.name}`
                    // );

                    const packPath = `${contentFolder}\\${file.name}\\${pack.name}`;
                    const imgPath = `${contentFolder}\\${file.name}\\${img.name}`;
                    const mod: Mod = {
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
                    };
                    return mod;
                  }
                });

              const a = await Promise.allSettled(newMods);

              (a.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Mod>[]).forEach((r) => {
                const mod = r.value;
                mods.push(mod);
              });

              cb(mods);
            });
          });
        });
      }
    }
  });
}
