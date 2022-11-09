import { Tooltip } from "flowbite-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { setModLoadOrder, toggleAlwaysEnabledMods, toggleAlwaysHiddenMods } from "./appSlice";
import { Modal } from "./flowbite";
import { useAppDispatch, useAppSelector } from "./hooks";

type ModDropdownProps = {
  isOpen: boolean;
  positionX: number;
  positionY: number;
  mod?: Mod;
  referenceElement: HTMLDivElement | undefined;
};

const openInExplorer = (mod: Mod) => {
  window.api?.openFolderInExplorer(mod.path);
};
const openInRPFM = (mod: Mod) => {
  window.api?.openPack(mod.path);
};
const putPathInClipboard = (mod: Mod) => {
  console.log(mod);
  window.api?.putPathInClipboard(mod.path);
};
const makePackBackup = (mod: Mod) => {
  window.api?.makePackBackup(mod);
};
const deletePack = (mod: Mod) => {
  if (!mod) return;
  window.api?.deletePack(mod);
};
const unsubscribe = (mod: Mod) => {
  window.api?.unsubscribeToMod(mod);
};

const ModDropdown = memo((props: ModDropdownProps) => {
  const dispatch = useAppDispatch();
  const allMods = useAppSelector((state) => state.app.allMods);
  const [isSetLoadOrderOpen, setIsSetLoadOrderOpen] = useState(false);
  const [loadOrderHasError, setLoadOrderHasError] = useState(false);
  const [currentModLoadOrder, setCurrentModLoadOrder] = useState("");

  let deltaX = 0;
  let deltaY = 0;
  if (props.referenceElement) {
    deltaX = props.referenceElement.getBoundingClientRect().left - props.positionX;
    deltaY = props.referenceElement.getBoundingClientRect().top - props.positionY;
  }

  const onGoToWorkshopPageClick = useCallback(
    (mod: Mod) => {
      let workshopId = mod.workshopId;
      if (mod.isInData) {
        const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
        if (!contentMod) return;
        workshopId = contentMod.workshopId;
      }
      window.open(`https://steamcommunity.com/workshop/filedetails/?id=${workshopId}`);
    },
    [allMods]
  );

  const onOpenInSteam = useCallback(
    (mod: Mod) => {
      let workshopId = mod.workshopId;
      if (mod.isInData) {
        const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
        if (!contentMod) return;
        workshopId = contentMod.workshopId;
      }
      window.api?.openInSteam(`https://steamcommunity.com/workshop/filedetails/?id=${workshopId}`);
    },
    [allMods]
  );

  const updateMod = useCallback(
    (mod: Mod) => {
      const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
      if (contentMod == null) return;

      window.api?.updateMod(mod, contentMod);
    },
    [allMods]
  );
  const fakeUpdatePack = useCallback(
    (mod: Mod) => {
      const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
      if (contentMod == null) return;

      window.api?.fakeUpdatePack(mod);
    },
    [allMods]
  );
  const forceModDownload = useCallback(
    (mod: Mod) => {
      let modToDownload: Mod | undefined = mod;
      if (mod.isInData)
        modToDownload = allMods.find((iterMod) => !iterMod.isInData && iterMod.name == mod.name);
      if (!modToDownload) return;

      window.api?.forceModDownload(modToDownload);
    },
    [allMods]
  );
  const reMerge = (mod: Mod) => {
    if (!mod) return;
    if (!mod.mergedModsData) return;

    const modsToMerge = mod.mergedModsData
      .map((mod) => allMods.find((iterMod) => iterMod.path == mod.path))
      .filter((mod) => mod) as Mod[];
    window.api?.reMerge(mod, modsToMerge);
  };

  const modDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (modDropdownRef.current && props.referenceElement) {
        modDropdownRef.current.style.top = `${(
          props.referenceElement.getBoundingClientRect().top - deltaY
        ).toString()}px`;
        modDropdownRef.current.style.left = `${(
          props.referenceElement.getBoundingClientRect().left - deltaX
        ).toString()}px`;
      }
    }, 10);
    return () => clearInterval(interval);
  }, [props.referenceElement, modDropdownRef.current]);

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
          <Modal.Header>Set Load Order For {props.mod?.name}</Modal.Header>
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
                    dispatch(setModLoadOrder({ modName: props.mod?.name ?? "", loadOrder: numLordOrder }));
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
          ref={modDropdownRef}
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
              (!props.mod?.isInData ||
                allMods.some((iterMod) => iterMod.name == props.mod?.name && !iterMod.isInData)) && (
                <>
                  <li>
                    <a
                      href="#"
                      onClick={() => {
                        if (props.mod) {
                          onGoToWorkshopPageClick(props.mod);
                        }
                      }}
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
                      onClick={() => {
                        if (props.mod) {
                          onOpenInSteam(props.mod);
                        }
                      }}
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
                onClick={() => {
                  if (props.mod) dispatch(toggleAlwaysEnabledMods([props.mod]));
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="right"
                  style="light"
                  content={<div className="min-w-[10rem]">Mod will always be enabled, even when hidden.</div>}
                >
                  Keep always enabled
                </Tooltip>
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) dispatch(toggleAlwaysHiddenMods([props.mod]));
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="right"
                  style="light"
                  content={
                    <div className="min-w-[10rem]">
                      Mod will be hidden from the list and disabled (except when always enabled).
                    </div>
                  }
                >
                  Hide from list
                </Tooltip>
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) openInExplorer(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Show in explorer
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) openInRPFM(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Open in RPFM
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) putPathInClipboard(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Copy path to clipboard
              </a>
            </li>
            {props.mod?.isInData &&
              allMods.some((iterMod) => iterMod.name == props.mod?.name && !iterMod.isInData) && (
                <>
                  <li>
                    <a
                      onClick={() => {
                        if (props.mod) updateMod(props.mod);
                      }}
                      href="#"
                      className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    >
                      <Tooltip
                        placement="right"
                        style="light"
                        content={
                          <div className="min-w-[10rem]">
                            Uploads update to the workshop. Must already exist on the workshop.
                          </div>
                        }
                      >
                        Update Mod
                      </Tooltip>
                    </a>
                  </li>
                  <li>
                    <a
                      onClick={() => {
                        if (props.mod) fakeUpdatePack(props.mod);
                      }}
                      href="#"
                      className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    >
                      <Tooltip
                        placement="right"
                        style="light"
                        content={
                          <div className="min-w-[10rem]">
                            Adds a whmm_update.txt file to the pack filled with random hex numbers, or changes
                            the numbers if the file already exists. UPDATE PLZ
                          </div>
                        }
                      >
                        Fake Update Pack
                      </Tooltip>
                    </a>
                  </li>
                </>
              )}
            <li>
              <a
                onClick={() => {
                  if (props.mod) makePackBackup(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="right"
                  style="light"
                  content={
                    <div className="min-w-[10rem]">
                      Creates a backup of the pack in a whmm_backups folder that is in the same location as
                      the pack.
                    </div>
                  }
                >
                  Create Backup
                </Tooltip>
              </a>
            </li>
            {(!props.mod?.isInData ||
              allMods.find((iterMod) => !iterMod.isInData && iterMod.name == props.mod?.name)) && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) forceModDownload(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">Force Steam to re-download the mod.</div>}
                    style="light"
                  >
                    Force Download
                  </Tooltip>
                </a>
              </li>
            )}
            {(!props.mod?.isInData ||
              allMods.find((iterMod) => !iterMod.isInData && iterMod.name == props.mod?.name)) && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) unsubscribe(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">Unsubscribe from the mod in Steam.</div>}
                    style="light"
                  >
                    Unsubscribe
                  </Tooltip>
                </a>
              </li>
            )}
            {props.mod?.mergedModsData && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) reMerge(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={
                      <div className="min-w-[10rem]">
                        Merge mods again to update the merged pack with latest versions of mods.
                      </div>
                    }
                    style="light"
                  >
                    Update (Re-merge)
                  </Tooltip>
                </a>
              </li>
            )}
            {props.mod?.mergedModsData && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) deletePack(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">Delete the merged pack.</div>}
                    style="light"
                  >
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
});
export default ModDropdown;
