import { useEffect, useState } from "react";

/**
 * Holds a value back while a tab is hidden: returns whatever it was when the tab was last active,
 * and catches up to the current value the moment the tab is shown again.
 *
 * Tabs kept mounted by useKeepMountedOnceActive keep running their effects while hidden, so a change
 * made elsewhere - enabling a mod, say - makes them rebuild data nobody is looking at, which reads
 * packs again. Deferring the value the rebuild keys off moves that work to the point the user
 * actually comes back to the tab.
 */
export const useDeferredWhileInactive = <T>(isActive: boolean, value: T): T => {
  const [valueWhileActive, setValueWhileActive] = useState(value);

  useEffect(() => {
    if (isActive && value !== valueWhileActive) {
      setValueWhileActive(value);
    }
  }, [isActive, value, valueWhileActive]);

  return isActive ? value : valueWhileActive;
};
