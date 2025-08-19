/* eslint-disable @typescript-eslint/no-var-requires */
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");
const path = require("path");
const relocateLoader = require("@vercel/webpack-asset-relocator-loader");
const AssetRelocatorPatch = require("@electron-forge/plugin-webpack/dist/util/AssetRelocatorPatch");

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
  optimization: {
    // Simpler optimization for main process
    splitChunks: {
      chunks: "async", // Only split async chunks to avoid conflicts
      cacheGroups: {
        default: false, // Disable default cache group
        vendors: false, // Disable vendor cache group for main process
      },
    },
    // Enable tree shaking
    usedExports: true,
    sideEffects: false,
  },
  externals: {
    // Externalize large schema files to load them dynamically
    "../schema/schema_wh3.json": "commonjs2 ../schema/schema_wh3.json",
    "../schema/schema_wh2.json": "commonjs2 ../schema/schema_wh2.json",
    "../schema/schema_3k.json": "commonjs2 ../schema/schema_3k.json",
    "../schema/schema_att.json": "commonjs2 ../schema/schema_att.json",
    "../schema/schema_troy.json": "commonjs2 ../schema/schema_troy.json",
    "../schema/schema_ph.json": "commonjs2 ../schema/schema_ph.json",
    "../schema/schema_ph_dyn.json": "commonjs2 ../schema/schema_ph_dyn.json",
    "../schema/schema_wh3.json.zst": "../schema/schema_wh3.json.zst",
    "../schema/schema_wh2.json.zst": "../schema/schema_wh2.json.zst",
    "../schema/schema_3k.json.zst": "../schema/schema_3k.json.zst",
    "../schema/schema_att.json.zst": "../schema/schema_att.json.zst",
    "../schema/schema_troy.json.zst": "../schema/schema_troy.json.zst",
    "../schema/schema_ph.json.zst": "../schema/schema_ph.json.zst",
    "../schema/schema_ph_dyn.json.zst": "../schema/schema_ph_dyn.json.zst",
  },
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^@aws-sdk\/client-s3$/ }),
    new CopyPlugin({
      patterns: [
        { from: "./temp/sub.js", to: "sub.js" },
        { from: "./locales/**/*" },
        { from: "./temp/readPacksWorker.js", to: "readPacksWorker.js" },
        { from: "./schema/**/*", to: "../schema/[name][ext]" },
        { from: "./node_modules/binary-file", to: "../node_modules/binary-file" },
        { from: "./node_modules/denodeify", to: "../node_modules/denodeify" },
        {
          from: "./node_modules/steamworks.js/",
          to: "../node_modules/steamworks.js/",
        },
      ],
    }),
    {
      apply(compiler) {
        compiler.hooks.compilation.tap("webpack-asset-relocator-loader", (compilation) => {
          relocateLoader.initAssetCache(compilation, "native_modules");
        });
      },
    },
  ],
  output: {
    pathinfo: false,
    // Use unique chunk naming to avoid conflicts
    chunkFilename: isProduction ? "main.[name].[contenthash].js" : "main.[name].js",
    filename: "index.js", // Explicit main filename
    // Clean output directory
    clean: isProduction,
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
    // Improve cache invalidation
    buildDependencies: {
      config: [__filename],
    },
  },
  // Performance optimizations
  performance: {
    hints: isProduction ? "warning" : false,
    maxEntrypointSize: 512000,
    maxAssetSize: 512000,
  },
};
