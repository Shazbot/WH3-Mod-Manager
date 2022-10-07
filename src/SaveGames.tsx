import { Modal } from "./flowbite/components/Modal/index";
import React from "react";
import { useAppDispatch, useAppSelector } from "./hooks";

export interface SaveGameProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}
export default function SaveGame(props: SaveGameProps) {
  const dispatch = useAppDispatch();
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const isMakeUnitsGeneralsEnabled = useAppSelector((state) => state.app.isMakeUnitsGeneralsEnabled);
  const isScriptLoggingEnabled = useAppSelector((state) => state.app.isScriptLoggingEnabled);
  const isSkipIntroMoviesEnabled = useAppSelector((state) => state.app.isSkipIntroMoviesEnabled);
  const saves = [...useAppSelector((state) => state.app.saves)];
  saves.sort((first, second) => second.lastChanged - first.lastChanged);
  const onClose = () => {
    props.setIsOpen(!props.isOpen);
  };
  const onLoadClick = (name: string) => {
    window.api.startGame(
      mods,
      { isMakeUnitsGeneralsEnabled, isSkipIntroMoviesEnabled, isScriptLoggingEnabled },
      name
    );
  };

  const onEnableModsInSave = (name: string) => {
    window.api.getPacksInSave(name);
  };

  return (
    <>
      <Modal show={props.isOpen} onClose={onClose} size="2xl" position="top-center">
        <Modal.Header>Saved Games</Modal.Header>
        <Modal.Body>
          <div className="grid grid-cols-3 h-full gap-4">
            {saves.map((save, i) => {
              return (
                <React.Fragment key={save.name}>
                  <div className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
                    {save.name}
                  </div>
                  <button
                    className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded h-15 w-26 m-auto "
                    type="button"
                    onClick={() => onLoadClick(save.name)}
                  >
                    Load Save
                  </button>
                  <button
                    className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded text-sm m-auto "
                    type="button"
                    onClick={() => onEnableModsInSave(save.name)}
                  >
                    Load Mods From Save
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
