import * as React from "react";
import { createRoot } from "react-dom/client";
import store from "./store";
import { Provider } from "react-redux";
import Onboarding from "./components/Onboarding";
import { ErrorBoundary } from "react-error-boundary";
import TopBar from "./components/TopBar";
import { Toasts } from "./components/Toasts";
import ModsViewer from "./components/viewer/ModsViewer";
import LeftSidebar from "./components/LeftSidebar";
import Main from "./components/Main";
import { StrictMode } from "react";
import LocalizationContext, { staticTextIds } from "./localizationContext";
import { useAppSelector } from "./hooks";

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
  const [localization, setLocalization] = React.useState<Record<string, string>>({});
  const currentLanguage = useAppSelector((state) => state.app.currentLanguage);
  const [cachedLanguage, setCachedLanguage] = React.useState<string>(currentLanguage);

  if (Object.keys(localization).length == 0 || cachedLanguage != currentLanguage)
    window.api?.translateAllStatic(staticTextIds).then((translated) => {
      setCachedLanguage(currentLanguage);
      setLocalization(translated);
    });

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
            id="mod-rows-scroll"
            className="m-auto pb-4 pt-11 height-without-topbar scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700"
          >
            <Onboarding></Onboarding>
            <LeftSidebar />
            <Main />
          </div>
        )) ||
          (window.location.pathname.includes("/viewer") && (
            <div className="m-auto px-8 pb-4 pt-11">
              <ModsViewer />
            </div>
          ))}
        <Toasts />
      </ErrorBoundary>
    </LocalizationContext.Provider>
  );
});

function render() {
  // console.log("LOCATION IS ", useLocation());
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </StrictMode>
  );
}

render();
