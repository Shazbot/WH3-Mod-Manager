import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import ModRow from "./stories/ModRow";

function render() {
  const root = createRoot(document.getElementById("root"));
  //   root.render(<h1 className="text-3xl font-bold underline bg-black">Hello world!</h1>);
  root.render(<ModRow label={""} />);
  //   ReactDOM.render(<h2>Hello from ars !!!!</h2>, document.body);
}

render();
