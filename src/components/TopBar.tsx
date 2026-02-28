import React, { memo, useEffect, useState } from "react";
import { useAppSelector } from "../hooks";
import appPackage from "../../package.json";
import { gameToGameName } from "../supportedGames";

const managerNameAndVersion = `WH3 Mod Manager v${appPackage.version}`;

const TopBarFrame = memo(({ title }: { title: string }) => {
  return (
    <>
      <div
        id="top-bar"
        draggable="true"
        className="h-[28px] bg-gray-700 w-full fixed top-0 flex items-center z-[1000]"
      >
        <img className="ml-1 h-[24px]" src={require("../assets/modmanager.ico")} />
        <span className="ml-1 font-light text-sm text-slate-100">{title}</span>
      </div>
      <div id="top-bar" className="h-[28px] w-full"></div>
    </>
  );
});

const TopBarMain = memo(() => {
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);
  const startArgs = useAppSelector((state) => state.app.startArgs);
  const isAdmin = useAppSelector((state) => state.app.isAdmin);
  const currentGame = useAppSelector((state) => state.app.currentGame);

  const [translated, setTranslated] = useState<Record<string, string>>({});

  const enabledMods = mods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name),
  );
  const hiddenAndEnabledMods = hiddenMods.filter((iterMod) =>
    enabledMods.find((mod) => mod.name === iterMod.name),
  );
  const isHardwareAccelerationDisabled = startArgs.some((arg) => arg == "-nogpu");

  useEffect(() => {
    const forTranslation = {
      numModsEnabled: { count: enabledMods.length },
      numModsHidden: { count: hiddenAndEnabledMods.length },
    };
    window.api?.translateAll(forTranslation).then((translated) => {
      setTranslated(translated);
    });
  }, [enabledMods.length, hiddenAndEnabledMods.length]);

  const title =
    `${managerNameAndVersion}: ${translated["numModsEnabled"]}` +
    (hiddenAndEnabledMods.length > 0 ? ` (${translated["numModsHidden"]})` : "") +
    ` for ${gameToGameName[currentGame]}` +
    ((isHardwareAccelerationDisabled && " nogpu") || "") +
    ((isAdmin && " admin") || "");

  return <TopBarFrame title={title} />;
});

const TopBarViewer = memo(() => {
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packPath = currentDBTableSelection?.packPath;
  const title = `${managerNameAndVersion}` + (packPath ? `: viewing ${packPath.replace(/.*\/\//, "")}` : "");
  return <TopBarFrame title={title} />;
});

const TopBarSkills = memo(() => {
  return <TopBarFrame title={managerNameAndVersion} />;
});

const TopBar = memo(() => {
  const pathname = window.location.pathname;
  if (pathname.includes("/main_window")) return <TopBarMain />;
  if (pathname.includes("/viewer")) return <TopBarViewer />;
  return <TopBarSkills />;
});

export default TopBar;
