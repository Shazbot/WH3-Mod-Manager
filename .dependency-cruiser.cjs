/** General hygiene rules. Existing violations live in .dependency-cruiser-known-violations.json. */
const fs = require("fs");
const known = ".dependency-cruiser-known-violations.json";

const { baseOptions } = require("./.dependency-cruiser.shared.cjs");

module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "^src/(index|preload|rendererMain|rendererViewer|rendererSkills|rendererTechTrees|sub)\\.tsx?$",
          "^src/cli/main\\.ts$",
          "^src/mcp/server\\.ts$",
          "^src/wh3AssetHostIpc\\.ts$",
          "^src/mixerStartpos/worker\\.ts$",
          "^src/esfMap/campaignSave(Write)?Worker\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      from: { path: "^src", pathNot: "\\.test\\.tsx?$" },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "no-duplicate-dep-types",
      severity: "warn",
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ["type-only"] },
    },
  ],
  options: {
    ...baseOptions,
    knownViolations: fs.existsSync(known) ? JSON.parse(fs.readFileSync(known, "utf8")) : [],
  },
};
