import { Modal } from "./flowbite/components/Modal/index";
import React from "react";
import { useAppDispatch, useAppSelector } from "./hooks";
import { toggleMod } from "./appSlice";

const subbedModIdsToWaitFor: string[] = [];

export interface RequiredModsProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modDependencies: [Mod, [string, string][]][];
}

export default function RequiredMods(props: RequiredModsProps) {
  const dispatch = useAppDispatch();
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const allMods = useAppSelector((state) => state.app.allMods);
  const isMakeUnitsGeneralsEnabled = useAppSelector((state) => state.app.isMakeUnitsGeneralsEnabled);
  const isScriptLoggingEnabled = useAppSelector((state) => state.app.isScriptLoggingEnabled);
  const isSkipIntroMoviesEnabled = useAppSelector((state) => state.app.isSkipIntroMoviesEnabled);
  const saves = [...useAppSelector((state) => state.app.saves)];
  saves.sort((first, second) => second.lastChanged - first.lastChanged);
  const onClose = () => {
    props.setIsOpen(!props.isOpen);
  };
  const onModClick = (name: string, id: string) => {
    let foundMod = mods.find((mod) => mod.workshopId == id);
    if (!foundMod) {
      const modInAll = allMods.find((mod) => mod.workshopId == id);
      if (!modInAll) {
        subbedModIdsToWaitFor.push(id);
        window.api.subscribeToMods([id]);
      } else {
        foundMod = mods.find((mod) => mod.name == foundMod.name);
        if (!foundMod) return;
      }
    }

    if (foundMod) {
      dispatch(toggleMod(foundMod));
    }
  };

  const modNameToIdLookup = new Map<string, string>();
  for (const [mod, modDependencies] of props.modDependencies) {
    for (const [modName, modId] of modDependencies) {
      modNameToIdLookup.set(modName, modId);
    }
  }

  // console.log(modNameToIdLookup);

  setInterval(() => {
    const newMods = subbedModIdsToWaitFor.filter((subbedModId) =>
      mods.find((iterMod) => iterMod.workshopId === subbedModId)
    );
    if (newMods.length == 0) return;

    const restOfMods = subbedModIdsToWaitFor.filter(
      (subbedModId) => !mods.find((iterMod) => iterMod.workshopId === subbedModId)
    );
    console.log("waiting for:", restOfMods);
    subbedModIdsToWaitFor.splice(0, subbedModIdsToWaitFor.length, ...restOfMods);

    newMods.forEach((id) => {
      const foundMod = mods.find((mod) => mod.workshopId == id);
      if (foundMod) {
        dispatch(toggleMod(foundMod));
      }
    });
  }, 100);

  return (
    <>
      <Modal show={props.isOpen} onClose={onClose} size="2xl" position="top-center">
        <Modal.Header>Missing Required Mods</Modal.Header>
        <Modal.Body>
          <div className="grid grid-cols-2 h-full gap-4">
            {[...modNameToIdLookup.entries()].map(([modId, modName], i) => {
              return (
                <React.Fragment key={modId}>
                  <div className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
                    {modName}
                  </div>
                  <button
                    className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded h-15 w-26 m-auto "
                    type="button"
                    onClick={(e) => {
                      onModClick(modName, modId);
                      // e.currentTarget.disabled = true;
                    }}
                  >
                    {(allMods.some((mod) => mod.workshopId == modId) && `Enable`) || `Subscribe And Enable`}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
}
