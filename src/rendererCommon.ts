import log from "electron-log/renderer";

export function setupRendererLogging() {
  const originalConsoleLog = console.log.bind(console);
  console.log = (...args) => {
    log.log(...args);
    originalConsoleLog(...args);
  };

  window.addEventListener("error", (e) => {
    console.log(e);
  });

  // Forward logs coming from main to this renderer's console.
  window.api?.handleLog((event, msg) => {
    console.log(msg);
  });
}

