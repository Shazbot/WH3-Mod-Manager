import { Modal } from "../flowbite/components/Modal/index";
import React, { memo, useContext } from "react";
import { useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";
import { SupportedGames } from "../supportedGames";

export interface GamePathsSetupProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const onSelectContentFolder = () => {
  window.api?.selectContentFolder();
};
const onSelectWarhammer3Folder = () => {
  window.api?.selectWarhammer3Folder();
};

const supportedGameToMainGameFolderLocalization: Record<SupportedGames, string> = {
  wh2: "mainWH2Folder",
  wh3: "mainWH3Folder",
  threeKingdoms: "mainThreeKingdomsFolder",
};
const supportedGameToGameFolderLocalization: Record<SupportedGames, string> = {
  wh2: "wh2Folder",
  wh3: "wh3Folder",
  threeKingdoms: "threeKingdomsFolder",
};
const supportedGameToContentFolderLocalization: Record<SupportedGames, string> = {
  wh2: "wh2ContentFolder",
  wh3: "wh3ContentFolder",
  threeKingdoms: "threeKingdomsContentFolder",
};
const supportedGameToSelectFolderLocalization: Record<SupportedGames, string> = {
  wh2: "selectWH2Folder",
  wh3: "selectWH3Folder",
  threeKingdoms: "selectThreeKingdomsFolder",
};
const supportedGameToSetFolderPathsManuallyLocalization: Record<SupportedGames, string> = {
  wh2: "setFolderPathsManuallyWH2",
  wh3: "setFolderPathsManuallyWH3",
  threeKingdoms: "setFolderPathsManuallyThreeKingdoms",
};
const supportedGameToSetFolderPathsManuallyOptionallyLocalization: Record<SupportedGames, string> = {
  wh2: "setFolderPathsManuallyOptionallyWH2",
  wh3: "setFolderPathsManuallyOptionallyWH3",
  threeKingdoms: "setFolderPathsManuallyOptionallyThreeKingdoms",
};

const GamePathsSetup = memo(({ isOpen, setIsOpen }: GamePathsSetupProps) => {
  const isSetAppFolderPathsDone = useAppSelector((state) => state.app.isSetAppFolderPathsDone);
  const appFolderPaths = useAppSelector((state) => state.app.appFolderPaths);
  const isAnyPathEmpty = appFolderPaths.contentFolder == "" || appFolderPaths.gamePath == "";
  const currentGame = useAppSelector((state) => state.app.currentGame);

  const localized: Record<string, string> = useContext(localizationContext);

  return (
    <>
      {(isOpen || (isSetAppFolderPathsDone && isAnyPathEmpty)) && (
        <Modal
          onClose={() => {
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
                {(isAnyPathEmpty && (
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
                      onSelectWarhammer3Folder();
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
                      onSelectContentFolder();
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
