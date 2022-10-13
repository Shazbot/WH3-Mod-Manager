import { Tooltip } from "flowbite-react";
import React, { useState } from "react";
import { setModLoadOrder, toggleAlwaysEnabledMods, toggleAlwaysHiddenMods } from "./appSlice";
import { Modal } from "./flowbite";
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
  const [isSetLoadOrderOpen, setIsSetLoadOrderOpen] = useState(false);
  const [loadOrderHasError, setLoadOrderHasError] = useState(false);
  const [currentModLoadOrder, setCurrentModLoadOrder] = useState("");

  const onGoToWorkshopPageClick = () => {
    let workshopId = props.mod.workshopId;
    if (props.mod.isInData) {
      const contentMod = allMods.find((iterMod) => iterMod.name == props.mod.name && !iterMod.isInData);
      if (!contentMod) return;
      workshopId = contentMod.workshopId;
    }
    window.open(`https://steamcommunity.com/workshop/filedetails/?id=${workshopId}`);
  };

  const onOpenInSteam = () => {
    let workshopId = props.mod.workshopId;
    if (props.mod.isInData) {
      const contentMod = allMods.find((iterMod) => iterMod.name == props.mod.name && !iterMod.isInData);
      if (!contentMod) return;
      workshopId = contentMod.workshopId;
    }
    window.api.openInSteam(`https://steamcommunity.com/workshop/filedetails/?id=${workshopId}`);
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
  const reMerge = (mod: Mod) => {
    if (!mod) return;

    const modsToMerge = mod.mergedModsData
      .map((mod) => allMods.find((iterMod) => iterMod.path == mod.path))
      .filter((mod) => mod);
    window.api.reMerge(mod, modsToMerge);
  };
  const deletePack = (mod: Mod) => {
    if (!mod) return;
    window.api.deletePack(mod);
  };

  return (
    (props.mod == null && <></>) || (
      <>
        <Modal
          onClose={() => setIsSetLoadOrderOpen(false)}
          // show={true}
          show={isSetLoadOrderOpen}
          size="2xl"
          position="center"
        >
          <Modal.Header>Set Load Order For {props.mod.name}</Modal.Header>
          <Modal.Body>
            <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
              Set load order for this mod. Changing load orders is very rarely needed in WH3 and can cause
              unintended compatibility issues between mods.{" "}
              <span className="text-red-600 font-semibold">
                Always leave load order at default unless you have a very good reason!
              </span>
            </p>
            <div className="flex mt-4 justify-center items-center">
              <input
                id="filterInput"
                type="text"
                onChange={(e) => {
                  const loadOrder = e.target.value;
                  setCurrentModLoadOrder(loadOrder);
                  setLoadOrderHasError(loadOrder != "" && !Number(loadOrder));
                }}
                value={currentModLoadOrder}
                className={
                  "inline-block bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 w-20 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 " +
                  (loadOrderHasError ? "!border-red-700" : "")
                }
              ></input>
              <div className="ml-4 justify-center inline-block">
                <button
                  className="make-tooltip-w-full px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out"
                  onClick={() => {
                    const numLordOrder = Number(currentModLoadOrder) - 1;
                    if (numLordOrder == null || isNaN(numLordOrder)) return;
                    if (numLordOrder < 0) return;
                    dispatch(setModLoadOrder({ modName: props.mod.name, loadOrder: numLordOrder }));
                    setIsSetLoadOrderOpen(false);
                  }}
                >
                  <span className="uppercase">Set Load Order</span>
                </button>
              </div>
            </div>
          </Modal.Body>
        </Modal>
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
            <li>
              <a
                onClick={() => setIsSetLoadOrderOpen(true)}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Set Load Order
              </a>
            </li>
            {props.mod &&
              (!props.mod.isInData ||
                allMods.some((iterMod) => iterMod.name == props.mod.name && !iterMod.isInData)) && (
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
            {props.mod.mergedModsData && (
              <li>
                <a
                  onClick={() => reMerge(props.mod)}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="top"
                    content="Merge mods again to update the merged pack with latest versions of mods."
                  >
                    Update (Re-merge)
                  </Tooltip>
                </a>
              </li>
            )}
            {props.mod.mergedModsData && (
              <li>
                <a
                  onClick={() => deletePack(props.mod)}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip placement="top" content="Delete the merged pack.">
                    Delete
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
