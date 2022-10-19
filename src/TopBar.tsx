import React, { memo } from "react";
import { useAppSelector } from "./hooks";
import { version } from "../package.json";

const TopBar = memo(() => {
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);

  const enabledMods = mods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
  );
  const hiddenAndEnabledMods = hiddenMods.filter((iterMod) =>
    enabledMods.find((mod) => mod.name === iterMod.name)
  );
  const title =
    `WH3 Mod Manager v${version}: ${enabledMods.length} mods enabled` +
    (hiddenAndEnabledMods.length > 0 ? ` (${hiddenAndEnabledMods.length} of those hidden)` : "");

  return (
    <div id="top-bar" className="h-[28px] bg-gray-700 w-full sticky top-0 flex items-center z-50">
      <span className="ml-2 font-light text-sm text-slate-100">{title}</span>
    </div>
  );
});
export default TopBar;
