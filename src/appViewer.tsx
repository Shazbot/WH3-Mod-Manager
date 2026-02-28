import React, { StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { ErrorBoundary } from "react-error-boundary";

import store from "./store";
import TopBar from "./components/TopBar";
import { Toasts } from "./components/Toasts";
import LocalizationContext, { staticTextIds, useLocalizations } from "./localizationContext";
import { useAppSelector } from "./hooks";
import { endTiming, perfMonitor, startTiming } from "./utility/performanceMonitor";

const ModsViewer = React.lazy(() => {
  const startTime = performance.now();
  return import("./components/viewer/ModsViewer").then((module) => {
    perfMonitor.trackComponentLoad("ModsViewer", startTime);
    return module;
  });
});

const LoadingSpinner = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
  </div>
);

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

const AppViewer = React.memo(() => {
  useEffect(() => {
    startTiming("app_viewer_mount");
    return () => {
      endTiming("app_viewer_mount");
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
          <Suspense fallback={<LoadingSpinner />}>
            <ModsViewer />
          </Suspense>
        </div>
        <Toasts />
      </ErrorBoundary>
    </LocalizationContext.Provider>
  );
});

export function renderViewerWindow() {
  startTiming("react_render_viewer");
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <StrictMode>
      <Provider store={store}>
        <AppViewer />
      </Provider>
    </StrictMode>,
  );
  endTiming("react_render_viewer");
}
