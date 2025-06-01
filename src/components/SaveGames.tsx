import { Modal } from "../flowbite/components/Modal/index";
import React, { useMemo, useState, memo, useCallback } from "react";
import { useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";
import classNames from "classnames";

export interface SaveGameProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const onEnableModsInSave = (name: string) => {
  window.api?.getPacksInSave(name);
};

const SaveGame = memo((props: SaveGameProps) => {
  const isWH3Running = useAppSelector((state) => state.app.isWH3Running);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const isMakeUnitsGeneralsEnabled = useAppSelector((state) => state.app.isMakeUnitsGeneralsEnabled);
  const isScriptLoggingEnabled = useAppSelector((state) => state.app.isScriptLoggingEnabled);
  const isSkipIntroMoviesEnabled = useAppSelector((state) => state.app.isSkipIntroMoviesEnabled);
  const isAutoStartCustomBattleEnabled = useAppSelector((state) => state.app.isAutoStartCustomBattleEnabled);
  const isClosedOnPlay = useAppSelector((state) => state.app.isClosedOnPlay);
  const packDataOverwrites = useAppSelector((state) => state.app.packDataOverwrites);
  const savesState = useAppSelector((state) => state.app.saves);
  const areModsInOrder = useAppSelector((state) => state.app.currentPreset.version) != undefined;

  const [filterText, setFilterText] = useState("");

  const saves = useMemo(() => {
    return savesState
      .filter((save) => save.name.toLowerCase().includes(filterText.toLowerCase()))
      .sort((first, second) => second.lastChanged - first.lastChanged);
  }, [savesState, filterText]);

  const onClose = useCallback(() => {
    props.setIsOpen(!props.isOpen);
  }, [props]);

  const onLoadClick = useCallback(
    (name: string) => {
      window.api?.startGame(
        mods,
        areModsInOrder,
        {
          isMakeUnitsGeneralsEnabled,
          isSkipIntroMoviesEnabled,
          isScriptLoggingEnabled,
          isAutoStartCustomBattleEnabled,
          isClosedOnPlay,
          packDataOverwrites,
        },
        name
      );
    },
    [mods, isMakeUnitsGeneralsEnabled, isSkipIntroMoviesEnabled, isScriptLoggingEnabled]
  );

  const localized = useLocalizations();

  return (
    <>
      {props.isOpen && (
        <Modal
          show={props.isOpen}
          onClose={onClose}
          size="2xl"
          position="top-center"
          explicitClasses={[
            "mt-8",
            "!max-w-7xl",
            "md:!h-full",
            "overflow-hidden",
            "modalDontOverflowWindowHeight",
          ]}
        >
          <Modal.Header>
            <div className="flex justify-between w-full">
              <div className="content-center">{localized.savedGames}</div>
              <input
                value={filterText} 
                placeholder={localized.searchSaves}
                onChange={(e) => setFilterText(e.target.value)}
                className="bg-gray-50 w-48 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 focus:outline-none"
              />
            </div>
          </Modal.Header>
          <Modal.Body>
            <div>
              {saves.map((save) => {
                return (
                  <div className="grid grid-cols-[3fr_2fr] h-full p-2 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-600 dark:hover:text-white" key={save.name}>
                    <div className="self-center leading-relaxed text-gray-500 dark:text-gray-300 h-[40px] truncate content-center">
                      {save.name}
                    </div>
                    <div className="grid grid-cols-2 w-fit gap-4 justify-self-end">
                      <button
                        className={classNames("bg-green-500 hover:bg-green-700 font-bold text-white px-4 rounded h-[32px] w-full m-auto text-sm truncate", {
                          "opacity-30": isWH3Running
                          }) 
                        }
                        type="button"
                        disabled={isWH3Running}
                        onClick={() => onLoadClick(save.name)}
                      >
                        {localized.loadSave}
                      </button>
                      <button
                        className="bg-green-500 hover:bg-green-700 font-bold text-white px-4 rounded h-[32px] w-full text-sm m-auto truncate"
                        type="button"
                        onClick={() => onEnableModsInSave(save.name)}
                      >
                        {localized.loadModsFromSave}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});
export default SaveGame;
