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

interface PackComparison {
  saveName: string;
  packsInSave: string[];
  enabledPacks: string[];
  missingFromEnabled: string[];
  extraInEnabled: string[];
  common: string[];
}

const PackComparisonModal = memo(
  ({
    isOpen,
    setIsOpen,
    comparison,
    mods,
  }: {
    isOpen: boolean;
    setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    comparison: PackComparison | null;
    mods: Mod[];
  }) => {
    const onClose = useCallback(() => {
      setIsOpen(false);
    }, [setIsOpen]);

    const localized = useLocalizations();

    if (!comparison) return null;

    const getModHumanName = (packName: string) => {
      const mod = mods.find((m) => m.name === packName);
      return mod?.humanName || packName;
    };

    return (
      <Modal
        show={isOpen}
        onClose={onClose}
        size="2xl"
        position="top-center"
        explicitClasses={[
          "mt-8",
          "!max-w-5xl",
          "md:!h-full",
          "overflow-hidden",
          "modalDontOverflowWindowHeight",
        ]}
      >
        <Modal.Header>{localized.comparingModsInSave} - {comparison.saveName}</Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
                {localized.modsInSaveNotEnabled} ({comparison.missingFromEnabled.length})
              </h3>
              <div className="overflow-y-auto bg-red-50 dark:bg-red-900/20 p-2 rounded">
                {comparison.missingFromEnabled.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 italic">{localized.noMissingPacks}</p>
                ) : (
                  comparison.missingFromEnabled.map((pack) => (
                    <div key={pack} className="text-sm">
                      <span className="font-mono text-xs">{pack}</span>
                      {getModHumanName(pack) !== pack && (
                        <span className="ml-2 text-gray-600 dark:text-gray-300">
                          ({getModHumanName(pack)})
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-yellow-600 dark:text-yellow-400 mb-2">
                {localized.modsNotInSaveButEnabled} ({comparison.extraInEnabled.length})
              </h3>
              <div className="overflow-y-auto bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
                {comparison.extraInEnabled.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 italic">{localized.noExtraPacks}</p>
                ) : (
                  comparison.extraInEnabled.map((pack) => (
                    <div key={pack} className="text-sm">
                      <span className="font-mono text-xs">{pack}</span>
                      {getModHumanName(pack) !== pack && (
                        <span className="ml-2 text-gray-600 dark:text-gray-300">
                          ({getModHumanName(pack)})
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-green-600 dark:text-green-400 mb-2">
                {localized.modsInSaveAndEnabled} ({comparison.common.length})
              </h3>
              <div className="overflow-y-auto bg-green-50 dark:bg-green-900/20 p-2 rounded">
                {comparison.common.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 italic">{localized.noCommonPacks}</p>
                ) : (
                  comparison.common.map((pack) => (
                    <div key={pack} className="text-sm">
                      <span className="font-mono text-xs">{pack}</span>
                      {getModHumanName(pack) !== pack && (
                        <span className="ml-2 text-gray-600 dark:text-gray-300">
                          ({getModHumanName(pack)})
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    );
  }
);

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
  const [packComparison, setPackComparison] = useState<PackComparison | null>(null);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);

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

  const onComparePacksClick = useCallback(
    async (saveName: string) => {
      try {
        const packNames = await window.api?.getListOfPacksInSave(saveName);
        if (!packNames) return;

        // Packs to ignore in comparisons
        const ignoredPacks = new Set([
          "data.pack",
          "wh2_main.pack",
          "wh2_main_vortex.pack",
          "wh2_main_chaos.pack",
          "wh3_main.pack",
          "wh3_main_chaos.pack",
          "wh3_main_combi.pack",
          "three_kingdoms.pack",
          "data_rome2.pack",
          "attilla.pack",
          "jap_campaign.pack",
          "jap_loc.pack",
          "patch.pack",
          "main.pack",
          "patch_1.pack",
          "patch_2.pack",
          "!!!!out.pack",
        ]);

        const enabledPacks = mods.filter((mod) => mod.isEnabled).map((mod) => mod.name);

        const packsInSaveSet = new Set(packNames);
        const enabledPacksSet = new Set(enabledPacks);

        const common = packNames.filter((pack) => enabledPacksSet.has(pack));
        const missingFromEnabled = packNames.filter(
          (pack) => !enabledPacksSet.has(pack) && !ignoredPacks.has(pack)
        );
        const extraInEnabled = enabledPacks.filter((pack) => !packsInSaveSet.has(pack));

        const comparison: PackComparison = {
          saveName,
          packsInSave: packNames,
          enabledPacks,
          missingFromEnabled,
          extraInEnabled,
          common,
        };

        setPackComparison(comparison);
        setIsComparisonModalOpen(true);
      } catch (error) {
        console.error("Failed to get packs from save:", error);
      }
    },
    [mods]
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
                  <div
                    className="grid grid-cols-[3fr_3fr] h-full p-2 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-600 dark:hover:text-white"
                    key={save.name}
                  >
                    <div className="self-center leading-relaxed text-gray-500 dark:text-gray-300 h-[40px] truncate content-center">
                      {save.name}
                    </div>
                    <div className="grid grid-cols-3 w-fit gap-2 justify-self-end">
                      <button
                        className={classNames(
                          "bg-green-500 hover:bg-green-700 font-bold text-white px-4 rounded h-[32px] w-full m-auto text-sm truncate",
                          {
                            "opacity-30": isWH3Running,
                          }
                        )}
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
                      <button
                        className="bg-blue-500 hover:bg-blue-700 font-bold text-white px-2 rounded h-[32px] w-full text-xs m-auto truncate"
                        type="button"
                        onClick={() => onComparePacksClick(save.name)}
                      >
                        {localized.compareModsInSave}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Modal.Body>
        </Modal>
      )}
      <PackComparisonModal
        isOpen={isComparisonModalOpen}
        setIsOpen={setIsComparisonModalOpen}
        comparison={packComparison}
        mods={mods}
      />
    </>
  );
});
export default SaveGame;
