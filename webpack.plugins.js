/* eslint-disable @typescript-eslint/no-var-requires */
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");

module.exports = [
  new ForkTsCheckerWebpackPlugin({ typescript: { memoryLimit: 4096 } }),
  new ReactRefreshWebpackPlugin(),
];
