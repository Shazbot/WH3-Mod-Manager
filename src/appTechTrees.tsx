import React, { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { ErrorBoundary } from "react-error-boundary";

import store from "./store";
import TopBar from "./components/TopBar";
import { Toasts } from "./components/Toasts";
import LocalizationContext, { staticTextIds, useLocalizations } from "./localizationContext";
import { useAppSelector } from "./hooks";
import TechTreesTab from "./components/techTrees/TechTreesTab";
import { endTiming, startTiming } from "./utility/performanceMonitor";

function ErrorFallback({ error }: { error: Error }) {
  const localized = useLocalizations();
  return (
    <div role="alert" className="text-red-600">
      <p>{localized.errorSomethingWentWrong}</p>
      <pre>{error.message}</pre>
      <p>{localized.errorScreenshotInstructions}</p>
    </div>
  );
}

const AppTechTrees = React.memo(() => {
  useEffect(() => {
    startTiming("app_tech_trees_mount");
    return () => {
      endTiming("app_tech_trees_mount");
    };
  }, []);

  const [localization, setLocalization] = useState<Record<string, string>>({});
  const currentLanguage = useAppSelector((state) => state.app.currentLanguage);

  useEffect(() => {
    if (!currentLanguage) return;
    window.api?.translateAllStatic(staticTextIds).then((translated) => {
      setLocalization(translated);
    });
  }, [currentLanguage]);

  return (
    <LocalizationContext.Provider value={localization}>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <TopBar />
        <div className="m-auto px-8 pb-4 pt-11">
          <TechTreesTab />
        </div>
        <Toasts />
      </ErrorBoundary>
    </LocalizationContext.Provider>
  );
});

export function renderTechTreesWindow() {
  startTiming("react_render_tech_trees");
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <StrictMode>
      <Provider store={store}>
        <AppTechTrees />
      </Provider>
    </StrictMode>,
  );
  endTiming("react_render_tech_trees");
}
