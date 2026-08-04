import React, { memo, useCallback } from "react";

import { resolveUsedModsImport } from "../appSlice";
import { Modal } from "../flowbite";
import { useAppDispatch, useAppSelector } from "../hooks";

const UsedModsLoadOrderModal = memo(() => {
  const dispatch = useAppDispatch();
  const pendingImport = useAppSelector((state) => state.app.pendingUsedModsImport);
  const isOnboardingToRun = useAppSelector((state) => state.app.isOnboardingToRun);

  const useAutomaticOrder = useCallback(() => {
    dispatch(resolveUsedModsImport("automatic"));
  }, [dispatch]);

  const keepPreviousOrder = useCallback(() => {
    dispatch(resolveUsedModsImport("previous"));
  }, [dispatch]);

  return (
    <Modal
      show={pendingImport !== undefined && !isOnboardingToRun}
      onClose={useAutomaticOrder}
      size="lg"
      position="center"
    >
      <Modal.Header>Choose Mod Load Order</Modal.Header>
      <Modal.Body>
        <div className="space-y-4 text-base leading-relaxed text-gray-500 dark:text-gray-300">
          <p>We found your previously enabled mods in the game folder.</p>
          <p>
            They were last used in a custom order. Automatic load order is recommended for most
            users and helps avoid unintended compatibility issues.
          </p>
          <p>Would you like to use automatic load order or keep the previous order?</p>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          className="px-4 py-2 bg-gray-500 text-white font-medium text-sm rounded hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400"
          onClick={keepPreviousOrder}
        >
          Keep Previous Order
        </button>
        <button
          type="button"
          className="px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onClick={useAutomaticOrder}
        >
          Use Automatic Order (Recommended)
        </button>
      </Modal.Footer>
    </Modal>
  );
});

UsedModsLoadOrderModal.displayName = "UsedModsLoadOrderModal";

export default UsedModsLoadOrderModal;
