import React, { memo, useEffect } from "react";
import { useAppSelector } from "../../hooks";
import SkillsViewer from "./SkillsViewer";

const SkillsTab = memo(() => {
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const skillsData = useAppSelector((state) => state.app.skillsData);

  useEffect(() => {
    if (currentGame !== "wh3") return;
    window.api?.requestSkillsData(mods);
  }, [currentGame, mods]);

  if (currentGame !== "wh3") {
    return <div className="px-6 py-4 text-gray-300">Skill Trees are unavailable for this game.</div>;
  }

  if (!skillsData) {
    return <div className="px-6 py-4 text-gray-300">Loading Skill Trees...</div>;
  }

  return <SkillsViewer />;
});

export default SkillsTab;
