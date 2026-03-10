import "./index.css";

import store from "./store";
import { renderTechTreesWindow } from "./appTechTrees";
import { setupRendererLogging } from "./rendererCommon";
import {
  setCurrentLanguage,
  setIsFeaturesForModdersEnabled,
  setModdersPrefix,
  setStartArgs,
} from "./appSlice";

setupRendererLogging();

console.log("IN RENDERER (tech_trees)");

window.api?.techTreesAreReady();

window.api?.setStartArgs((event, startArgs) => {
  store.dispatch(setStartArgs(startArgs));
});

window.api?.setCurrentLanguage((event, language: string) => {
  store.dispatch(setCurrentLanguage(language));
});

window.api?.setIsFeaturesForModdersEnabled((event, isFeaturesForModdersEnabled) => {
  store.dispatch(setIsFeaturesForModdersEnabled(isFeaturesForModdersEnabled));
});

window.api?.setModdersPrefix((event, moddersPrefix) => {
  store.dispatch(setModdersPrefix(moddersPrefix));
});

renderTechTreesWindow();
