import "./index.css";

import store from "./store";
import { renderSkillsWindow } from "./appSkills";
import { setupRendererLogging } from "./rendererCommon";
import { setCurrentLanguage, setIsFeaturesForModdersEnabled, setSkillsData, setStartArgs } from "./appSlice";

setupRendererLogging();

console.log("IN RENDERER (skills)");

window.api?.skillsAreReady();

window.api?.setStartArgs((event, startArgs) => {
  store.dispatch(setStartArgs(startArgs));
});

window.api?.setCurrentLanguage((event, language: string) => {
  store.dispatch(setCurrentLanguage(language));
});

window.api?.setIsFeaturesForModdersEnabled((event, isFeaturesForModdersEnabled) => {
  store.dispatch(setIsFeaturesForModdersEnabled(isFeaturesForModdersEnabled));
});

window.api?.setSkillsData((event, skillsData: SkillsData) => {
  store.dispatch(setSkillsData(skillsData));
});

renderSkillsWindow();
