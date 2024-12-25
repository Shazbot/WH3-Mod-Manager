const rules = require("./webpack.rules");
const plugins = require("./webpack.plugins");
const path = require("path");

rules.push(
  {
    test: /\.css$/,
    use: [{ loader: "style-loader" }, { loader: "css-loader" }, { loader: "postcss-loader" }],
  },
  {
    test: /\.(png|svg|jpg|jpeg|gif|ico)$/i,
    type: "asset/resource",
  }
);

module.exports = {
  module: {
    rules,
  },
  plugins: plugins,
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"],
    fallback: {
      http: require.resolve("stream-http"),
      os: require.resolve("os-browserify/browser"),
      https: require.resolve("https-browserify"),
      path: require.resolve("path-browserify"),
    },
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
};
