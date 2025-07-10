import * as React from "react";
import { createRoot } from "react-dom/client";
import store from "./store";
import { Provider } from "react-redux";
import Onboarding from "./components/Onboarding";
import { ErrorBoundary } from "react-error-boundary";
import TopBar from "./components/TopBar";
import { Toasts } from "./components/Toasts";
import LeftSidebar from "./components/LeftSidebar";
import Main from "./components/Main";
import { StrictMode, useRef, Suspense } from "react";
import LocalizationContext, { staticTextIds } from "./localizationContext";
import { useAppSelector } from "./hooks";
import { perfMonitor, startTiming, endTiming } from "./utility/performanceMonitor";

// Lazy load heavy components with performance tracking
const ModsViewer = React.lazy(() => {
  const startTime = performance.now();
  return import("./components/viewer/ModsViewer").then((module) => {
    perfMonitor.trackComponentLoad("ModsViewer", startTime);
    return module;
  });
});
const SkillsViewer = React.lazy(() => {
  const startTime = performance.now();
  return import("./components/skillsViewer/SkillsViewer").then((module) => {
    perfMonitor.trackComponentLoad("SkillsViewer", startTime);
    return module;
  });
});

// Loading component
const LoadingSpinner = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
  </div>
);

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div role="alert" className="text-red-600">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <p>Press Ctrl+Shift+I to screenshot the error data in the Console tab</p>
    </div>
  );
}

const App = React.memo(() => {
  React.useEffect(() => {
    startTiming("app_component_mount");
    return () => {
      endTiming("app_component_mount");
    };
  }, []);

  const [localization, setLocalization] = React.useState<Record<string, string>>({});
  const currentLanguage = useAppSelector((state) => state.app.currentLanguage);
  const [cachedLanguage, setCachedLanguage] = React.useState<string>(currentLanguage);

  if (Object.keys(localization).length == 0 || cachedLanguage != currentLanguage)
    window.api?.translateAllStatic(staticTextIds).then((translated) => {
      setCachedLanguage(currentLanguage);
      setLocalization(translated);
    });

  const scrollElement = useRef<HTMLDivElement>(null);

  return (
    <LocalizationContext.Provider value={localization}>
      <ErrorBoundary
        FallbackComponent={ErrorFallback}
        onReset={() => {
          // reset the state of your app so the error doesn't happen again
        }}
      >
        <TopBar />
        {(window.location.pathname.includes("/main_window") && (
          <div
            ref={scrollElement}
            id="mod-rows-scroll"
            className="m-auto pb-4 pt-11 height-without-topbar overflow-y-scroll scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700"
          >
            <Onboarding></Onboarding>
            <LeftSidebar />
            <Main scrollElement={scrollElement} />
          </div>
        )) ||
          (window.location.pathname.includes("/viewer") && (
            <div className="m-auto px-8 pb-4 pt-11">
              <Suspense fallback={<LoadingSpinner />}>
                <ModsViewer />
              </Suspense>
            </div>
          )) || (
            <div className="m-auto px-8 pb-4 pt-11">
              <Suspense fallback={<LoadingSpinner />}>
                <SkillsViewer />
              </Suspense>
            </div>
          )}
        <Toasts />
      </ErrorBoundary>
    </LocalizationContext.Provider>
  );
});

function render() {
  startTiming("react_render");
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </StrictMode>
  );
  endTiming("react_render");
}

render();
