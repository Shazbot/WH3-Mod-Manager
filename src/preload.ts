// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from "electron";
import * as fs from "fs/promises";
import Registry from "winreg";
import * as VDF from "@node-steam/vdf";

console.log("SHIT");
ipcRenderer.send("asynchronous-message", "ping");

const regKey = new Registry({
  // new operator is optional
  hive: Registry.HKLM, // open registry hive HKEY_CURRENT_USER
  key: "\\SOFTWARE\\Wow6432Node\\Valve\\Steam", // key containing autostart programs
});

const mods: Mod[] = [];
// list autostart programs
regKey.values(function (err, items: { name: string; value: string }[] /* array of RegistryItem */) {
  if (err) console.log("ERROR: " + err);
  else {
    const installPathObj = items.find((x) => x.name === "InstallPath");
    if (installPathObj) {
      const installPath = installPathObj.value;
      const libFoldersPath = `${installPath}\\steamapps\\libraryfolders.vdf`;

      fs.readFile(libFoldersPath, "utf8")
        .then((data) => {
          const object = VDF.parse(data).libraryfolders;
          const paths = [];
          for (const property in object) {
            paths.push(object[property].path);
          }

          paths.find((path) => {
            const worshopFilePath = `${path}\\steamapps\\appmanifest_1142710.acf`;
            fs.readFile(worshopFilePath)
              .then(() => {
                console.log(worshopFilePath);
                const contentFolder = `${path}\\steamapps\\workshop\\content\\1142710`;
                fs.readdir(contentFolder, { withFileTypes: true })
                  .then((files) => {
                    files
                      .filter((file) => file.isDirectory())
                      .forEach((file) => {
                        fs.readdir(`${contentFolder}\\${file.name}`, { withFileTypes: true }).then(
                          (files) => {
                            files.forEach((file) => console.log(file.name));
                            const pack = files.find((file) => file.name.endsWith(".pack"));
                            const img = files.find((file) => file !== pack);
                            if (pack) {
                              const packPath = `${contentFolder}\\${file.name}\\${pack.name}`;
                              const imgPath = `${contentFolder}\\${file.name}\\${img.name}`;
                              const mod: Mod = {
                                name: pack.name,
                                path: packPath,
                                imgPath: imgPath,
                                workshopId: file.name,
                              };
                              mods.push(mod);
                            }
                          }
                        );
                      });
                  })
                  .catch();
                console.log("YEAH");
              })
              .catch();
          });
        })
        .catch();
    }
  }
});

const api: api = {
  doThing: () => ipcRenderer.send("do-a-thing", mods),
  getMods: () => mods,
};
contextBridge.exposeInMainWorld("api", api);
