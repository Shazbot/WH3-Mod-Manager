import * as React from "react";
import { createRoot } from "react-dom/client";
import ModRow from "./ModRow";
import store from "./store";
import { Provider } from "react-redux";
import PlayGame from "./PlayGame";
import Onboarding from "./Onboarding";
import { ErrorBoundary } from "react-error-boundary";
import TopBar from "./TopBar";

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div role="alert text-red-600">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <p>Press Ctrl+Shift+I to screenshot the error data in the Console tab</p>
    </div>
  );
}

function render() {
  const root = createRoot(document.getElementById("root"));
  root.render(
    <Provider store={store}>
      <ErrorBoundary
        FallbackComponent={ErrorFallback}
        onReset={() => {
          // reset the state of your app so the error doesn't happen again
        }}
      >
        <TopBar />
        <main>
          <Onboarding></Onboarding>
          <div className="grid grid-cols-12 text-white">
            <div className="col-span-10">
              <ModRow />
            </div>
            <div className="ml-3 col-span-2 relative">
              <PlayGame />
            </div>
          </div>
        </main>
      </ErrorBoundary>
    </Provider>
  );
}

render();
