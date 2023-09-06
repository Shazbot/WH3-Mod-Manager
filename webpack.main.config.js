/* eslint-disable @typescript-eslint/no-var-requires */
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: "./src/index.ts",
  // Put your normal webpack config below here
  module: {
    rules: require("./webpack.rules"),
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "./temp/sub.js", to: "sub.js" },
        { from: "./locales/**/*" },
        { from: "./temp/readPacksWorker.js", to: "readPacksWorker.js" },
        { from: "./temp/schema.js", to: "schema.js" },
        { from: "./temp/schema/schema_wh3.json", to: "../schema/schema_wh3.json" },
        { from: "./node_modules/binary-file", to: "../node_modules/binary-file" },
        { from: "./node_modules/denodeify", to: "../node_modules/denodeify" },
        {
          from: "./node_modules/steamworks.js/",
          to: "../node_modules/steamworks.js/",
        },
      ],
    }),
  ],
};
