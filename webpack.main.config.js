/* eslint-disable @typescript-eslint/no-var-requires */
const CopyPlugin = require("copy-webpack-plugin");
const path = require("path");

const isProduction = process.argv[process.argv.indexOf("--mode") + 1] === "production";

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
    alias: {
      // "@": path.resolve(__dirname, "./"),
    },
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "./temp/sub.js", to: "sub.js" },
        { from: "./locales/**/*" },
        { from: "./temp/readPacksWorker.js", to: "readPacksWorker.js" },
        { from: "./temp/schema.js", to: "schema.js" },
        { from: "./schema/**/*", to: "../schema/[name][ext]" },
        { from: "./node_modules/binary-file", to: "../node_modules/binary-file" },
        { from: "./node_modules/denodeify", to: "../node_modules/denodeify" },
        {
          from: "./node_modules/@ai-zen/steamworks.js/",
          to: "../node_modules/@ai-zen/steamworks.js/",
        },
      ],
    }),
  ],
  output: {
    pathinfo: false,
  },
  devServer: {
    devMiddleware: {
      writeToDisk: true,
    },
    hot: true,
  },
  devtool: isProduction ? "source-map" : "eval-cheap-module-source-map",
  cache: {
    type: "filesystem",
  },
};
