import { useEffect, useState } from "react";

/**
 * Reports whether a tab should stay in the tree: false until it first becomes active, true from then
 * on.
 *
 * Tabs are rendered only while active so the expensive ones cost nothing until they are opened, but
 * unmounting a stateful tab throws away its in-memory work. Keeping it mounted and merely hidden
 * lets the user switch tabs and come back to their work, while still paying nothing for a tab they
 * never open in a session.
 */
export const useKeepMountedOnceActive = (isActive: boolean): boolean => {
  const [wasEverActive, setWasEverActive] = useState(isActive);

  useEffect(() => {
    if (isActive && !wasEverActive) {
      setWasEverActive(true);
    }
  }, [isActive, wasEverActive]);

  return isActive || wasEverActive;
};
