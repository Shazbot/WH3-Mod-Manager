/** Options shared by the entry-scoped boundary configs. */
const baseOptions = {
  tsConfig: { fileName: "tsconfig.json" },
  tsPreCompilationDeps: true,
  doNotFollow: { path: "node_modules" },
  exclude: { path: ["\\.test\\.tsx?$", "src/flowbite/components/Modal"] },
  enhancedResolveOptions: {
    exportsFields: ["exports"],
    conditionNames: ["import", "require", "node", "default", "types"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
};

module.exports = { baseOptions };
