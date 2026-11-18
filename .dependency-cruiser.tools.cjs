/** Headless CLI/MCP tools must not reach electron, react or UI code. Never baselined. */
const { baseOptions } = require("./.dependency-cruiser.shared.cjs");

module.exports = {
  forbidden: [
    {
      name: "tools-no-electron-or-react",
      severity: "error",
      from: {},
      to: { path: "^node_modules/(electron|react|react-dom)/" },
    },
    {
      name: "tools-no-ui",
      severity: "error",
      from: {},
      to: { path: "^src/(components/|renderer[^/]*$)" },
    },
  ],
  options: baseOptions,
};
