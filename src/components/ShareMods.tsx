import { Modal } from "../flowbite/components/Modal/index";
import React, { memo, useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { disableAllMods, setAreModsEnabled, setSharedMod } from "../appSlice";
import { Spinner } from "flowbite-react";

const subbedModIdsToWaitFor: ModIdAndLoadOrder[] = [];

export interface ShareModsProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}
const ShareMods = memo((props: ShareModsProps) => {
  const dispatch = useAppDispatch();
  const [importModsText, setImportModsText] = useState("");
  const [isSpinnerOpen, setIsSpinnerOpen] = useState(false);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const saves = [...useAppSelector((state) => state.app.saves)];
  saves.sort((first, second) => second.lastChanged - first.lastChanged);

  const onClose = useCallback(() => {
    props.setIsOpen(!props.isOpen);
  }, [props]);

  const exportModsToClipboard = () => {
    window.api?.exportModsToClipboard(mods);
  };

  const importMods = () => {
    dispatch(disableAllMods());
    const imported: ModIdAndLoadOrder[] = importModsText
      .trim()
      .split("|")
      .map((idAndOrder) => {
        if (idAndOrder.indexOf(";") > -1) {
          const [workshopId, loadOrderStr] = idAndOrder.split(";");
          return { workshopId, loadOrder: Number(loadOrderStr) };
        }
        return { workshopId: idAndOrder, loadOrder: undefined };
      });

    const onlyIds = imported.map((idAndOrder) => idAndOrder.workshopId);
    subbedModIdsToWaitFor.splice(0, subbedModIdsToWaitFor.length, ...imported);
    console.log("waiting for: ", subbedModIdsToWaitFor);
    props.setIsOpen(!props.isOpen);

    const newMods = subbedModIdsToWaitFor.filter(
      (subbedMod) => !mods.find((iterMod) => iterMod.workshopId === subbedMod.workshopId)
    );
    if (newMods.length > 0) {
      setIsSpinnerOpen(true);
      window.api?.subscribeToMods(onlyIds);
    }
  };

  const onImportModsChanged = (input: string) => {
    setImportModsText(input);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const newMods = subbedModIdsToWaitFor.filter((subbedMod) =>
        mods.find((iterMod) => iterMod.workshopId === subbedMod.workshopId)
      );
      if (newMods.length == 0) return;

      const restOfMods = subbedModIdsToWaitFor.filter(
        (subbedMod) => !mods.find((iterMod) => iterMod.workshopId === subbedMod.workshopId)
      );
      console.log("waiting for:", restOfMods);
      subbedModIdsToWaitFor.splice(0, subbedModIdsToWaitFor.length, ...restOfMods);

      dispatch(setSharedMod(newMods));
    }, 100);
    return () => clearInterval(interval);
  }, [subbedModIdsToWaitFor, mods]);

  return (
    <>
      <Modal
        onClose={() => setIsSpinnerOpen(false)}
        // show={true}
        show={
          isSpinnerOpen &&
          !subbedModIdsToWaitFor.every((subbedMod) =>
            mods.find((iterMod) => iterMod.workshopId === subbedMod.workshopId)
          )
        }
        size="2xl"
        position="center"
      >
        <Modal.Header>Waiting For Mods To Download...</Modal.Header>
        <Modal.Body>
          <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
            We're now subscribed to the mods, but there is a chance Steam won't download new mods while the
            mod manager is running. Close the manager, wait for Steam to download the mods and import mods
            agains if this takes more than 1 min.
          </p>
          <div className="text-center mt-8">
            <Spinner color="purple" size="xl" />
          </div>
        </Modal.Body>
      </Modal>
      <Modal
        show={props.isOpen}
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
            Import shared mods. Paste the exported text the other person has shared with you. This will
            subscribe to, download and enable those mods.
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
  );
});
export default ShareMods;
