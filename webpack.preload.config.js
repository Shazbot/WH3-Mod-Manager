const path = require("path");

const isProduction = process.argv[process.argv.indexOf("--mode") + 1] === "production";

/**
 * Preloads are loaded by Electron as a single script. Keep them self-contained: the renderer
 * compiler has a separate runtime and cannot safely consume the chunks produced by splitChunks.
 */
module.exports = {
  module: {
    rules: require("./webpack.rules"),
  },
  devtool: isProduction ? "source-map" : "eval-cheap-module-source-map",
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"],
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: false,
  },
};
