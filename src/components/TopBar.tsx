import React, { memo } from "react";
import { useAppSelector } from "../hooks";
import appPackage from "../../package.json";

const TopBar = memo(() => {
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);
  const startArgs = useAppSelector((state) => state.app.startArgs);
  const isAdmin = useAppSelector((state) => state.app.isAdmin);
  const isHardwareAccelerationDisabled = startArgs.some((arg) => arg == "-nogpu");

  const enabledMods = mods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
  );
  const hiddenAndEnabledMods = hiddenMods.filter((iterMod) =>
    enabledMods.find((mod) => mod.name === iterMod.name)
  );
  const title =
    `WH3 Mod Manager v${appPackage.version}: ${enabledMods.length} mods enabled` +
    (hiddenAndEnabledMods.length > 0 ? ` (${hiddenAndEnabledMods.length} of those hidden)` : "") +
    ((isHardwareAccelerationDisabled && " nogpu") || "") +
    ((isAdmin && " admin") || "");

  return (
    <div
      id="top-bar"
      draggable="true"
      className="h-[28px] bg-gray-700 w-full fixed top-0 flex items-center z-[1000]"
    >
      <img className="ml-1 h-[24px]" src={require("../assets/modmanager.ico")} />
      <span className="ml-1 font-light text-sm text-slate-100">{title}</span>
    </div>
  );
});
export default TopBar;
