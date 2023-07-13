import * as React from "react";
import { createRoot } from "react-dom/client";
import ModRows from "./components/ModRows";
import store from "./store";
import { Provider } from "react-redux";
import Sidebar from "./components/Sidebar";
import Onboarding from "./components/Onboarding";
import { ErrorBoundary } from "react-error-boundary";
import TopBar from "./components/TopBar";
import { Toasts } from "./components/Toasts";
import ModsViewer from "./components/viewer/ModsViewer";
import LeftSidebar from "./components/LeftSidebar";
import Main from "./components/Main";

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div role="alert" className="text-red-600">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <p>Press Ctrl+Shift+I to screenshot the error data in the Console tab</p>
    </div>
  );
}

function render() {
  // console.log("LOCATION IS ", useLocation());
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <Provider store={store}>
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
    </Provider>
  );
}

render();
