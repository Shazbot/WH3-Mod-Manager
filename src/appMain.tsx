import React, { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { ErrorBoundary } from "react-error-boundary";

import store from "./store";
import TopBar from "./components/TopBar";
import { Toasts } from "./components/Toasts";
import Onboarding from "./components/Onboarding";
import LeftSidebar from "./components/LeftSidebar";
import Main from "./components/Main";

import LocalizationContext, { staticTextIds, useLocalizations } from "./localizationContext";
import { useAppSelector } from "./hooks";
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

const AppMain = React.memo(() => {
  useEffect(() => {
    startTiming("app_main_mount");
    return () => {
      endTiming("app_main_mount");
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

  const scrollElement = useRef<HTMLDivElement>(null);

  return (
    <LocalizationContext.Provider value={localization}>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <TopBar />
        <div
          ref={scrollElement}
          id="mod-rows-scroll"
          className="m-auto pb-4 ml-14 pt-11 height-without-topbar overflow-y-auto scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700"
        >
          <Onboarding />
          <LeftSidebar />
          <Main scrollElement={scrollElement} />
        </div>
        <Toasts />
      </ErrorBoundary>
    </LocalizationContext.Provider>
  );
});

export function renderMainWindow() {
  startTiming("react_render_main");
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <StrictMode>
      <Provider store={store}>
        <AppMain />
      </Provider>
    </StrictMode>,
  );
  endTiming("react_render_main");
}
