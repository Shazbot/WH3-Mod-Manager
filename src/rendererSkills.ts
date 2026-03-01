import "./index.css";

import store from "./store";
import { renderSkillsWindow } from "./appSkills";
import { setupRendererLogging } from "./rendererCommon";
import {
  setCurrentLanguage,
  setIsCheckingSkillRequirements,
  setIsFeaturesForModdersEnabled,
  setIsShowingHiddenModifiersInsideSkills,
  setIsShowingHiddenSkills,
  setIsShowingSkillNodeSetNames,
  setSkillsData,
  setStartArgs,
} from "./appSlice";

setupRendererLogging();

console.log("IN RENDERER (skills)");
let hasReceivedSkillsViewOptions = false;
let lastSentSkillsViewOptions: SkillsViewOptions | undefined;

const applySkillsViewOptions = (skillsViewOptions: SkillsViewOptions) => {
  store.dispatch(setIsShowingSkillNodeSetNames(skillsViewOptions.isShowingSkillNodeSetNames));
  store.dispatch(setIsShowingHiddenSkills(skillsViewOptions.isShowingHiddenSkills));
  store.dispatch(
    setIsShowingHiddenModifiersInsideSkills(skillsViewOptions.isShowingHiddenModifiersInsideSkills),
  );
  store.dispatch(setIsCheckingSkillRequirements(skillsViewOptions.isCheckingSkillRequirements));
};

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

window.api?.onSkillsViewOptions((event, skillsViewOptions: SkillsViewOptions) => {
  hasReceivedSkillsViewOptions = true;
  lastSentSkillsViewOptions = skillsViewOptions;
  applySkillsViewOptions(skillsViewOptions);
});

store.subscribe(() => {
  if (!hasReceivedSkillsViewOptions) return;
  const state = store.getState().app;
  const skillsViewOptions: SkillsViewOptions = {
    isShowingSkillNodeSetNames: state.isShowingSkillNodeSetNames,
    isShowingHiddenSkills: state.isShowingHiddenSkills,
    isShowingHiddenModifiersInsideSkills: state.isShowingHiddenModifiersInsideSkills,
    isCheckingSkillRequirements: state.isCheckingSkillRequirements,
  };
  if (
    lastSentSkillsViewOptions &&
    lastSentSkillsViewOptions.isShowingSkillNodeSetNames === skillsViewOptions.isShowingSkillNodeSetNames &&
    lastSentSkillsViewOptions.isShowingHiddenSkills === skillsViewOptions.isShowingHiddenSkills &&
    lastSentSkillsViewOptions.isShowingHiddenModifiersInsideSkills ===
      skillsViewOptions.isShowingHiddenModifiersInsideSkills &&
    lastSentSkillsViewOptions.isCheckingSkillRequirements === skillsViewOptions.isCheckingSkillRequirements
  ) {
    return;
  }
  lastSentSkillsViewOptions = skillsViewOptions;

  window.api?.setSkillsViewOptions(skillsViewOptions);
});

window.api?.skillsAreReady();

renderSkillsWindow();
