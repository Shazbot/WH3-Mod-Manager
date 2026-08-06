import log from "electron-log/renderer";

export function setupRendererLogging() {
  const originalConsoleLog = console.log.bind(console);
  console.log = (...args) => {
    log.log(...args);
    originalConsoleLog(...args);
  };

  window.addEventListener("error", (e) => {
    log.error("Unhandled renderer error", {
      message: e.message,
      filename: e.filename,
      line: e.lineno,
      column: e.colno,
      stack: e.error instanceof Error ? e.error.stack : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    log.error("Unhandled renderer promise rejection", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  // Forward logs coming from main to this renderer's console.
  window.api?.handleLog((event, msg) => {
    console.log(msg);
  });
}
