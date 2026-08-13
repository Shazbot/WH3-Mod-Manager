import React, { memo, useEffect, useMemo, useRef } from "react";
import { useAppSelector } from "../../hooks";
import { useDeferredWhileInactive } from "../useDeferredWhileInactive";
import SkillsViewer from "./SkillsViewer";

let lastRequestedSkillsSignature: string | undefined;

type SkillsTabProps = {
  /** False while the tab is mounted but hidden, so rebuilds wait for the user to come back. */
  isActive?: boolean;
};

const SkillsTab = memo(({ isActive = true }: SkillsTabProps) => {
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
  const modsRef = useRef(mods);
  modsRef.current = mods;
  // While hidden this stays at the signature the tab last saw, so enabling a mod elsewhere queues the
  // rebuild instead of running it; switching back releases the current signature and rebuilds once.
  const signatureToRequest = useDeferredWhileInactive(isActive, enabledModsSignature);

  useEffect(() => {
    if (currentGame !== "wh3") return;
    if (lastRequestedSkillsSignature === signatureToRequest && skillsData) return;
    lastRequestedSkillsSignature = signatureToRequest;
    // The mods themselves are read from the ref: a fresh mods array from pack reading must not count
    // as a reason to rebuild, only a changed signature does.
    window.api?.requestSkillsData(modsRef.current);
  }, [currentGame, signatureToRequest, skillsData]);

  if (currentGame !== "wh3") {
    return <div className="px-6 py-4 text-gray-300">Skill Trees are unavailable for this game.</div>;
  }

  if (!skillsData) {
    return <div className="px-6 py-4 text-gray-300">Loading Skill Trees...</div>;
  }

  return <SkillsViewer />;
});

export default SkillsTab;
