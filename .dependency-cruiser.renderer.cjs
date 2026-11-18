/**
 * Renderer bundles (webpack target "web", resolve.fallback only for path/os/http/https).
 * Cruise from the four renderer entries; boundary violations are never baselined.
 */
const { baseOptions } = require("./.dependency-cruiser.shared.cjs");

module.exports = {
  forbidden: [
    {
      name: "renderer-no-node-core",
      comment:
        "Node core modules are unavailable in the web target (webpack fallbacks exist only for path/os/http/https). " +
        "depcruise normalises node:os to os, so the node: prefix cannot be told apart; all core modules are forbidden.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "renderer-no-electron",
      comment: "Windows must use the preload API, not electron directly.",
      severity: "error",
      from: {},
      to: { path: "^electron$" },
    },
  ],
  options: { ...baseOptions, tsPreCompilationDeps: false },
};
