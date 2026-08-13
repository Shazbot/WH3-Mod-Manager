import { Modal } from "../flowbite/components/Modal/index";
import React, { memo, useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { orderImportedMods, setAreModsEnabled, setImportedMods } from "../appSlice";
import { Spinner } from "flowbite-react";
import { getMissingSharedWorkshopIds, parseSharedModList, sharedModMatchesInstalledMod } from "../sharedModList";

export interface ShareModsProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}
const ShareMods = memo((props: ShareModsProps) => {
  const { isOpen, setIsOpen } = props;
  const dispatch = useAppDispatch();
  const [importModsText, setImportModsText] = useState("");
  const [isSpinnerOpen, setIsSpinnerOpen] = useState(false);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const allMods = useAppSelector((state) => state.app.allMods);
  const importedMods = useAppSelector((state) => state.app.importedMods);
  const saves = [...useAppSelector((state) => state.app.saves)];
  saves.sort((first, second) => second.lastChanged - first.lastChanged);

  const onClose = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  const cancelPendingImport = useCallback(() => {
    setIsSpinnerOpen(false);
    dispatch(setImportedMods([]));
  }, [dispatch]);

  const exportModsToClipboard = () => {
    window.api?.exportModsToClipboard(mods, allMods);
  };

  const importMods = () => {
    const imported = parseSharedModList(importModsText);
    const missingLocalMods = imported.filter(
      (importedMod) =>
        importedMod.modName &&
        !importedMod.workshopId &&
        !mods.some((mod) => sharedModMatchesInstalledMod(importedMod, mod)),
    );
    const importableMods = imported.filter(
      (importedMod) =>
        !importedMod.modName ||
        !!importedMod.workshopId ||
        mods.some((mod) => sharedModMatchesInstalledMod(importedMod, mod)),
    );

    if (missingLocalMods.length > 0) {
      console.warn(
        "Skipping shared local mods that are not installed:",
        missingLocalMods.map((mod) => mod.modName),
      );
    }
    console.log("imported mods:", importableMods);
    dispatch(setImportedMods(importableMods));

    const missingWorkshopIds = getMissingSharedWorkshopIds(importableMods, allMods);
    if (missingWorkshopIds.length > 0) {
      setIsSpinnerOpen(true);
      window.api?.subscribeToMods(missingWorkshopIds);
    } else {
      setIsOpen(false);
    }
  };

  const onImportModsChanged = (input: string) => {
    setImportModsText(input);
  };

  useEffect(() => {
    if (
      importedMods.length > 0 &&
      importedMods.every((importedMod) => mods.some((mod) => sharedModMatchesInstalledMod(importedMod, mod)))
    ) {
      dispatch(orderImportedMods());
      setIsSpinnerOpen(false);
      setIsOpen(false);
    }
  }, [dispatch, importedMods, mods, setIsOpen]);

  return (
    <>
      {isOpen && (
        <>
          <Modal
            onClose={cancelPendingImport}
            // show={true}
            show={
              isSpinnerOpen &&
              !importedMods.every((subbedMod) => mods.some((mod) => sharedModMatchesInstalledMod(subbedMod, mod)))
            }
            size="2xl"
            position="center"
          >
            <Modal.Header>Waiting For Mods To Download...</Modal.Header>
            <Modal.Body>
              <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
                We're now subscribed to the mods, but there is a chance Steam won't download new mods while the mod
                manager is running. Close the manager, wait for Steam to download the mods and import mods agains if
                this takes more than 1 min.
              </p>
              <div className="text-center mt-8">
                <Spinner color="purple" size="xl" />
              </div>
            </Modal.Body>
          </Modal>
          <Modal
            show={isOpen}
            // show={true}
            onClose={onClose}
            size="2xl"
            position="center"
            explicitClasses={["!max-w-7xl"]}
          >
            <Modal.Header>Share Mod List</Modal.Header>
            <Modal.Body>
              <div className="border-b border-gray-600 pb-6">
                <div className="text-lg font-medium text-gray-900 dark:text-white">Export</div>
                <div className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
                  <p>
                    Share the enabled mods and their load order. Pressing the button will copy some text into your
                    clipboard, share that text with the other person.
                  </p>

                  <div className="flex mt-4 justify-center">
                    <button
                      className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out"
                      onClick={() => exportModsToClipboard()}
                    >
                      <span className="uppercase">Export to clipboard</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-10 text-lg font-medium text-gray-900 dark:text-white">Import</div>
              <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300 pb-4">
                Import shared mods. Workshop mods will be subscribed, downloaded, and enabled. Local packs are enabled
                when a file with the same name is already installed.
              </p>
              <textarea
                id="message"
                rows={4}
                className="block p-2.5 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                placeholder="Paste exported mods here"
                value={importModsText}
                onChange={(e) => onImportModsChanged(e.target.value)}
              ></textarea>

              <div className="flex mt-4 justify-center">
                <button
                  disabled={importModsText == null || importModsText === ""}
                  className="disabled:opacity-50 disabled:cursor-not-allowed make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out"
                  onClick={() => importMods()}
                >
                  <span className="uppercase">Import</span>
                </button>
              </div>
            </Modal.Body>
          </Modal>
        </>
      )}
    </>
  );
});
export default ShareMods;
