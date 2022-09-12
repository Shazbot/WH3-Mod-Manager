import { Tooltip } from "flowbite-react";
import React from "react";
import { toggleAlwaysEnabledMods, toggleAlwaysHiddenMods } from "./appSlice";
import { useAppDispatch, useAppSelector } from "./hooks";

type ModDropdownProps = {
  isOpen: boolean;
  positionX: number;
  positionY: number;
  mod?: Mod;
};

export default function ModDropdown(props: ModDropdownProps) {
  const dispatch = useAppDispatch();
  const isDev = useAppSelector((state) => state.app.isDev);
  const allMods = useAppSelector((state) => state.app.allMods);

  const onGoToWorkshopPageClick = () => {
    window.open(`https://steamcommunity.com/workshop/filedetails/?id=${props.mod.workshopId}`);
  };

  const onOpenInSteam = () => {
    window.api.openInSteam(`https://steamcommunity.com/workshop/filedetails/?id=${props.mod.workshopId}`);
  };

  const openInExplorer = (mod: Mod) => {
    window.api.openFolderInExplorer(mod.path);
  };
  const openInRPFM = (mod: Mod) => {
    window.api.openPack(mod.path);
  };
  const putPathInClipboard = (mod: Mod) => {
    if (isDev) console.log(mod);

    window.api.putPathInClipboard(mod.path);
  };
  const updateMod = (mod: Mod) => {
    const contentMod = allMods.find((iterMod) => iterMod.name == props.mod.name && !iterMod.isInData);
    if (contentMod == null) return;

    window.api.updateMod(mod, contentMod);
  };
  const fakeUpdatePack = (mod: Mod) => {
    const contentMod = allMods.find((iterMod) => iterMod.name == props.mod.name && !iterMod.isInData);
    if (contentMod == null) return;

    window.api.fakeUpdatePack(mod);
  };
  const makePackBackup = (mod: Mod) => {
    window.api.makePackBackup(mod);
  };
  const forceModDownload = (mod: Mod) => {
    if (mod.isInData) mod = allMods.find((iterMod) => !iterMod.isInData && iterMod.name == props.mod.name);
    if (!mod) return;

    window.api.forceModDownload(mod);
  };

  return (
    (props.mod == null && <></>) || (
      <>
        <div
          id="modDropdown"
          className={
            `${props.isOpen ? "" : "hidden"}` +
            ` fixed w-44 bg-white rounded divide-y divide-gray-100 shadow dark:bg-gray-700`
          }
          style={{
            left: props.positionX,
            top: props.positionY,
          }}
        >
          <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
            {props.mod && !props.mod.isInData && (
              <>
                <li>
                  <a
                    href="#"
                    onClick={() => onGoToWorkshopPageClick()}
                    className={
                      "block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    }
                  >
                    Go to workshop page
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    onClick={() => onOpenInSteam()}
                    className={
                      "block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    }
                  >
                    Open in Steam
                  </a>
                </li>
              </>
            )}
            <li>
              <a
                onClick={() => dispatch(toggleAlwaysEnabledMods([props.mod]))}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip placement="top" content="Mod will always be enabled, even when hidden.">
                  Keep always enabled
                </Tooltip>
              </a>
            </li>
            <li>
              <a
                onClick={() => dispatch(toggleAlwaysHiddenMods([props.mod]))}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="bottom"
                  content="Mod will be hidden from the list and disabled (except when always enabled)."
                >
                  Hide from list
                </Tooltip>
              </a>
            </li>
            <li>
              <a
                onClick={() => openInExplorer(props.mod)}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Show in explorer
              </a>
            </li>
            <li>
              <a
                onClick={() => openInRPFM(props.mod)}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Open in RPFM
              </a>
            </li>
            <li>
              <a
                onClick={() => putPathInClipboard(props.mod)}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Copy path to clipboard
              </a>
            </li>
            {props.mod.isInData &&
              allMods.some((iterMod) => iterMod.name == props.mod.name && !iterMod.isInData) && (
                <>
                  <li>
                    <a
                      onClick={() => updateMod(props.mod)}
                      href="#"
                      className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    >
                      <Tooltip
                        placement="top"
                        content="Uploads update to the workshop. Must already exist on the workshop."
                      >
                        Update Mod
                      </Tooltip>
                    </a>
                  </li>
                  <li>
                    <a
                      onClick={() => fakeUpdatePack(props.mod)}
                      href="#"
                      className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    >
                      <Tooltip
                        placement="top"
                        content="Adds a whmm_update.txt file to the pack filled with random hex numbers, or changes the numbers if the file already exists. UPDATE PLZ"
                      >
                        Fake Update Pack
                      </Tooltip>
                    </a>
                  </li>
                </>
              )}
            <li>
              <a
                onClick={() => makePackBackup(props.mod)}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="top"
                  content="Creates a backup of the pack in a whmm_backups folder that is in the same location as the pack."
                >
                  Create Backup
                </Tooltip>
              </a>
            </li>
            {(!props.mod.isInData ||
              allMods.find((iterMod) => !iterMod.isInData && iterMod.name == props.mod.name)) && (
              <li>
                <a
                  onClick={() => forceModDownload(props.mod)}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip placement="top" content="Force Steam to re-download the mod.">
                    Force Download
                  </Tooltip>
                </a>
              </li>
            )}
          </ul>
        </div>
      </>
    )
  );
}
