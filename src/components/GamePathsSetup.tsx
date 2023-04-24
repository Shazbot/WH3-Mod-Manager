import { Modal } from "../flowbite/components/Modal/index";
import React, { memo } from "react";
import { useAppSelector } from "../hooks";

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

const GamePathsSetup = memo(({ isOpen, setIsOpen }: GamePathsSetupProps) => {
  const isSetAppFolderPathsDone = useAppSelector((state) => state.app.isSetAppFolderPathsDone);
  const appFolderPaths = useAppSelector((state) => state.app.appFolderPaths);
  const isAnyPathEmpty = appFolderPaths.contentFolder == "" || appFolderPaths.gamePath == "";

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
          <Modal.Header>Configure Folder Locations</Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-y-8 gap-x-4 z-10 leading-relaxed dark:text-gray-300 relative font-normal items-center">
              <div>
                {(isAnyPathEmpty && (
                  <p className="m-auto text-center">
                    The mod manager tried to get WH3 folder locations from Windows Registry, but it couldn't
                    find them! You'll have to set them manually!
                  </p>
                )) || (
                  <p className="m-auto text-center">
                    The mod manager automatically found WH3 folder paths from the Windows Registry, but you
                    can set them manually here.
                  </p>
                )}
              </div>
              <div className="border w-full border-gray-600"></div>
              <div>
                <p className="m-auto text-center">
                  The main Warhammer 3 folder that contains Warhammer3.exe, for example C:\Program Files
                  (x86)\Steam\steamapps\common\Total War WARHAMMER III
                </p>
                <div className="flex gap-x-4 items-center w-full mt-4">
                  <span className="whitespace-nowrap">WH3 folder:</span>
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
                    <span className="uppercase">Select WH3 Folder</span>
                  </button>
                </div>
              </div>
              <div className="border w-full border-gray-600"></div>
              <div className="max-w-[90%]">
                <p className="m-auto max-w-[95%] text-center">
                  The Warhammer 3 Steam Workshop content folder named 1142710 (which is the steam ID for WH3)
                  that contains mods, for example C:\Program Files
                  (x86)\Steam\steamapps\workshop\content\1142710
                </p>
                <div className="flex gap-x-4 items-center w-full mt-4">
                  <span className="whitespace-nowrap">Content folder:</span>
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
                    <span className="uppercase">Select Content Folder</span>
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
