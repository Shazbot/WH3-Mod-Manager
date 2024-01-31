import { Modal } from "../flowbite/components/Modal/index";
import React, { memo, useCallback, useContext } from "react";
import { useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";

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
  const saves = [...useAppSelector((state) => state.app.saves)];
  const areModsInOrder = useAppSelector((state) => state.app.currentPreset.version) != undefined;
  saves.sort((first, second) => second.lastChanged - first.lastChanged);

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

  const localized: Record<string, string> = useContext(localizationContext);

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
            ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
            "modalDontOverflowWindowHeight",
          ]}
        >
          <Modal.Header>{localized.savedGames}</Modal.Header>
          <Modal.Body>
            <div className="grid grid-cols-3 h-full gap-4">
              {saves.map((save) => {
                return (
                  <React.Fragment key={save.name}>
                    <div className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
                      {save.name}
                    </div>
                    <button
                      className={`bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded h-15 w-26 m-auto ${
                        (isWH3Running && "opacity-30") || ""
                      }`}
                      type="button"
                      disabled={isWH3Running}
                      onClick={() => onLoadClick(save.name)}
                    >
                      {localized.loadSave}
                    </button>
                    <button
                      className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded text-sm m-auto "
                      type="button"
                      onClick={() => onEnableModsInSave(save.name)}
                    >
                      {localized.loadModsFromSave}
                    </button>
                  </React.Fragment>
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
