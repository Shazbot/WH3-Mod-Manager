import * as React from "react";
import { createRoot } from "react-dom/client";
import ModRow from "./ModRows";
import store from "./store";
import { Provider } from "react-redux";
import Sidebar from "./Sidebar";
import Onboarding from "./Onboarding";
import { ErrorBoundary } from "react-error-boundary";
import TopBar from "./TopBar";
import { Toasts } from "./Toasts";
import { RouterProvider, createBrowserRouter, useLocation } from "react-router-dom";
import ModsViewer from "./ModsViewer";

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div role="alert" className="text-red-600">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <p>Press Ctrl+Shift+I to screenshot the error data in the Console tab</p>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/main_window",
    errorElement: (
      <ErrorBoundary
        FallbackComponent={ErrorFallback}
        onReset={() => {
          // reset the state of your app so the error doesn't happen again
        }}
      />
    ),
    element: (
      <div className="m-auto px-8 py-4 max-w-[100rem]">
        <Onboarding></Onboarding>
        <div className="grid grid-cols-12 text-white">
          <div className="col-span-10">
            <ModRow />
          </div>
          <div className="ml-3 col-span-2 relative">
            <Sidebar />
          </div>
        </div>
      </div>
    ),
  },
  {
    path: "/viewer",
    errorElement: (
      <ErrorBoundary
        FallbackComponent={ErrorFallback}
        onReset={() => {
          // reset the state of your app so the error doesn't happen again
        }}
      />
    ),
    element: (
      <div className="m-auto px-8 py-4">
        <ModsViewer />
      </div>
    ),
  },
]);

function render() {
  // console.log("LOCATION IS ", useLocation());
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <Provider store={store}>
      <TopBar />
      <RouterProvider router={router} />
      <Toasts />
    </Provider>
  );
}

render();
