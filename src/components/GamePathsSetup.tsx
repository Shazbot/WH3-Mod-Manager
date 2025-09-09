import { Modal } from "../flowbite/components/Modal/index";
import React, { memo, useContext } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";
import { SupportedGames } from "../supportedGames";
import { requestGameFolderPaths } from "../appSlice";

export interface GamePathsSetupProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const onSelectContentFolder = (requestFolderPathsForGame: SupportedGames | undefined) => {
  window.api?.selectContentFolder(requestFolderPathsForGame);
};
const onSelectWarhammer3Folder = (requestFolderPathsForGame: SupportedGames | undefined) => {
  window.api?.selectWarhammer3Folder(requestFolderPathsForGame);
};

const supportedGameToMainGameFolderLocalization: Record<SupportedGames, string> = {
  wh2: "mainWH2Folder",
  wh3: "mainWH3Folder",
  threeKingdoms: "mainThreeKingdomsFolder",
  attila: "mainAttilaFolder",
  troy: "mainTroyFolder",
  pharaoh: "mainPharaohFolder",
  dynasties: "mainDynastiesFolder",
  rome2: "mainRome2Folder",
  shogun2: "mainShogun2Folder",
};
const supportedGameToGameFolderLocalization: Record<SupportedGames, string> = {
  wh2: "wh2Folder",
  wh3: "wh3Folder",
  threeKingdoms: "threeKingdomsFolder",
  attila: "attilaFolder",
  troy: "troyFolder",
  pharaoh: "pharaohFolder",
  dynasties: "dynastiesFolder",
  rome2: "rome2Folder",
  shogun2: "shogun2Folder",
};
const supportedGameToContentFolderLocalization: Record<SupportedGames, string> = {
  wh2: "wh2ContentFolder",
  wh3: "wh3ContentFolder",
  threeKingdoms: "threeKingdomsContentFolder",
  attila: "attilaContentFolder",
  troy: "troyContentFolder",
  pharaoh: "pharaohContentFolder",
  dynasties: "dynastiesContentFolder",
  rome2: "rome2ContentFolder",
  shogun2: "shogun2ContentFolder",
};
const supportedGameToSelectFolderLocalization: Record<SupportedGames, string> = {
  wh2: "selectWH2Folder",
  wh3: "selectWH3Folder",
  threeKingdoms: "selectThreeKingdomsFolder",
  attila: "selectAttilaFolder",
  troy: "selectTroyFolder",
  pharaoh: "selectPharaohFolder",
  dynasties: "selectDynastiesFolder",
  rome2: "selectRome2Folder",
  shogun2: "selectShogun2Folder",
};
const supportedGameToSetFolderPathsManuallyLocalization: Record<SupportedGames, string> = {
  wh2: "setFolderPathsManuallyWH2",
  wh3: "setFolderPathsManuallyWH3",
  threeKingdoms: "setFolderPathsManuallyThreeKingdoms",
  attila: "setFolderPathsManuallyAttila",
  troy: "setFolderPathsManuallyTroy",
  pharaoh: "setFolderPathsManuallyPharaoh",
  dynasties: "setFolderPathsManuallyDynasties",
  rome2: "setFolderPathsManuallyRome2",
  shogun2: "setFolderPathsManuallyShogun2",
};
const supportedGameToSetFolderPathsManuallyOptionallyLocalization: Record<SupportedGames, string> = {
  wh2: "setFolderPathsManuallyOptionallyWH2",
  wh3: "setFolderPathsManuallyOptionallyWH3",
  threeKingdoms: "setFolderPathsManuallyOptionallyThreeKingdoms",
  attila: "setFolderPathsManuallyOptionallyAttila",
  troy: "setFolderPathsManuallyOptionallyTroy",
  pharaoh: "setFolderPathsManuallyOptionallyPharaoh",
  dynasties: "setFolderPathsManuallyOptionallyDynasties",
  rome2: "setFolderPathsManuallyOptionallyRome2",
  shogun2: "setFolderPathsManuallyOptionallyShogun2",
};

const GamePathsSetup = memo(({ isOpen, setIsOpen }: GamePathsSetupProps) => {
  const dispatch = useAppDispatch();
  const isSetAppFolderPathsDone = useAppSelector((state) => state.app.isSetAppFolderPathsDone);
  const appFolderPaths = useAppSelector((state) => state.app.appFolderPaths);
  const isAnyPathEmpty = appFolderPaths.contentFolder == "" || appFolderPaths.gamePath == "";
  const appStateCurrentGame = useAppSelector((state) => state.app.currentGame);
  const requestFolderPathsForGame = useAppSelector((state) => state.app.requestFolderPathsForGame);

  const currentGame = requestFolderPathsForGame ? requestFolderPathsForGame : appStateCurrentGame;

  const localized: Record<string, string> = useContext(localizationContext);

  console.log("requestFolderPathsForGame:", requestFolderPathsForGame);

  return (
    <>
      {(isOpen || (isSetAppFolderPathsDone && isAnyPathEmpty) || requestFolderPathsForGame) && (
        <Modal
          onClose={() => {
            dispatch(requestGameFolderPaths(undefined));
            setIsOpen(false);
          }}
          show={true}
          size="2xl"
          position="center"
          explicitClasses={["!max-w-7xl"]}
        >
          <Modal.Header>{localized.configureFolderLocations}</Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-y-8 gap-x-4 z-10 leading-relaxed dark:text-gray-300 relative font-normal items-center">
              <div>
                {((isAnyPathEmpty || requestFolderPathsForGame) && (
                  <p className="m-auto text-center">
                    {localized[supportedGameToSetFolderPathsManuallyLocalization[currentGame]]}
                  </p>
                )) || (
                  <p className="m-auto text-center">
                    {localized[supportedGameToSetFolderPathsManuallyOptionallyLocalization[currentGame]]}
                  </p>
                )}
              </div>
              <div className="border w-full border-gray-600"></div>
              <div>
                <p className="m-auto text-center">
                  {localized[supportedGameToMainGameFolderLocalization[currentGame]]}
                </p>
                <div className="flex gap-x-4 items-center w-full mt-4">
                  <span className="whitespace-nowrap">
                    {localized[supportedGameToGameFolderLocalization[currentGame]]}
                  </span>
                  <span className="w-full">
                    <input
                      type="text"
                      disabled
                      value={appFolderPaths.gamePath}
                      className="cursor-not-allowed bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                    ></input>
                  </span>
                  <button
                    className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-64"
                    onClick={() => {
                      onSelectWarhammer3Folder(requestFolderPathsForGame);
                    }}
                  >
                    <span className="uppercase">
                      {localized[supportedGameToSelectFolderLocalization[currentGame]]}
                    </span>
                  </button>
                </div>
              </div>
              <div className="border w-full border-gray-600"></div>
              <div className="max-w-[90%]">
                <p className="m-auto max-w-[95%] text-center">
                  {localized[supportedGameToContentFolderLocalization[currentGame]]}
                </p>
                <div className="flex gap-x-4 items-center w-full mt-4">
                  <span className="whitespace-nowrap">{localized.contentFolder}</span>
                  <span className="w-full">
                    <input
                      type="text"
                      disabled
                      value={appFolderPaths.contentFolder}
                      className="cursor-not-allowed bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                    ></input>
                  </span>
                  <button
                    className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-64"
                    onClick={() => {
                      onSelectContentFolder(requestFolderPathsForGame);
                    }}
                  >
                    <span className="uppercase">{localized.selectContentFolder}</span>
                  </button>
                </div>
              </div>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});
export default GamePathsSetup;
