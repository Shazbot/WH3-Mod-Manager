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
        { from: "./temp/readPacksWorker.js", to: "readPacksWorker.js" },
      ],
    }),
  ],
};
