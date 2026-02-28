/* eslint-disable @typescript-eslint/no-var-requires */
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");

const isProduction = process.argv[process.argv.indexOf("--mode") + 1] === "production";

const plugins = [
  new ForkTsCheckerWebpackPlugin({
    async: !isProduction,
    typescript: { memoryLimit: 4096 },
  }),
];

if (!isProduction) {
  plugins.push(new ReactRefreshWebpackPlugin());
}

module.exports = plugins;
