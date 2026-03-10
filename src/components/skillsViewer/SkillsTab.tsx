import React, { memo, useEffect, useMemo } from "react";
import { useAppSelector } from "../../hooks";
import SkillsViewer from "./SkillsViewer";

let lastRequestedSkillsSignature: string | undefined;

const SkillsTab = memo(() => {
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const skillsData = useAppSelector((state) => state.app.skillsData);
  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const enabledModsSignature = useMemo(
    () =>
      `${currentGame}|${enabledMods
        .map((mod) => `${mod.path}:${mod.loadOrder ?? ""}:${mod.lastChangedLocal ?? ""}:${mod.lastChanged ?? ""}`)
        .join("|")}`,
    [currentGame, enabledMods],
  );

  useEffect(() => {
    if (currentGame !== "wh3") return;
    if (lastRequestedSkillsSignature === enabledModsSignature && skillsData) return;
    lastRequestedSkillsSignature = enabledModsSignature;
    window.api?.requestSkillsData(mods);
  }, [currentGame, enabledModsSignature, mods, skillsData]);

  if (currentGame !== "wh3") {
    return <div className="px-6 py-4 text-gray-300">Skill Trees are unavailable for this game.</div>;
  }

  if (!skillsData) {
    return <div className="px-6 py-4 text-gray-300">Loading Skill Trees...</div>;
  }

  return <SkillsViewer />;
});

export default SkillsTab;
