import * as React from "react";
import { createRoot } from "react-dom/client";
import ModRow from "./stories/ModRow";
import store from "./store";
import { Provider } from "react-redux";
import PlayGame from "./PlayGame";

function render() {
  const root = createRoot(document.getElementById("root"));
  root.render(
    <Provider store={store}>
      <div className="grid grid-cols-12">
        <div className="col-span-10">
          <ModRow />
        </div>
        <div className="col-span-2 relative">
          <PlayGame />
        </div>
      </div>
    </Provider>
  );
}

render();
