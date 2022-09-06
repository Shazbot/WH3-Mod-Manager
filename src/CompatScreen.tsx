import React, { useState } from "react";
import { useAppDispatch, useAppSelector } from "./hooks";
import { Modal } from "./flowbite/components/Modal/index";
import { Spinner, Tabs } from "./flowbite";

export default function CompatScreen() {
  const dispatch = useAppDispatch();
  // const alwaysHidden = useAppSelector((state) => state.app.hiddenMods);
  // const packsData = useAppSelector((state) => state.app.packsData);
  const packCollisions = useAppSelector((state) => state.app.packCollisions);

  const [isCompatOpen, setIsCompatOpen] = React.useState(false);

  const isPackProcessingDone = false; //packsData.size > 0;

  const copyToData = () => {
    window.api.copyToData();
  };
  const cleanData = () => {
    window.api.cleanData();
  };

  console.log(packCollisions.packFileCollisions);

  return (
    <div>
      <div className="text-center mt-4">
        <button
          onClick={() => setIsCompatOpen(!isCompatOpen)}
          className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mx-2 mb-2 m-auto dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
          type="button"
          data-drawer-target="drawer-example"
          data-drawer-show="drawer-example"
          aria-controls="drawer-example"
        >
          Check Compat
        </button>
      </div>

      {/* <Modal
        // onClose={() => setIsSpinnerOpen(false)}
        show={isPackProcessingDone}
        size="2xl"
        position="center"
      >
        <Modal.Header>Waiting To Read All The Packs..</Modal.Header>
        <Modal.Body>
          <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
            Wait until all the mod packs are read...
          </p>
          <div className="text-center mt-8">
            <Spinner color="purple" size="xl" />
          </div>
        </Modal.Body>
      </Modal> */}
      <Modal
        // show={isCompatOpen}
        show={true}
        onClose={() => setIsCompatOpen(false)}
        size="2xl"
        position="top-center"
        explicitClasses={["!max-w-7xl"]}
      >
        <Modal.Header>Share Mod List</Modal.Header>
        <Modal.Body>
          <Tabs.Group style="underline">
            <Tabs.Item active={true} title="Files">
              {packCollisions &&
                packCollisions.packFileCollisions &&
                packCollisions.packFileCollisions.map((packCollision) => {
                  return (
                    <React.Fragment
                      key={packCollision.fileName + packCollision.secondPackName + packCollision.fileName}
                    >
                      <div>{packCollision.fileName}</div>
                      <div className="ml-4">
                        {packCollision.secondPackName}
                        <span className="ml-4">{packCollision.fileName}</span>
                      </div>
                    </React.Fragment>
                  );
                })}
            </Tabs.Item>
            <Tabs.Item title="Tables">Dashboard content</Tabs.Item>
          </Tabs.Group>
        </Modal.Body>
      </Modal>
    </div>
  );
}
