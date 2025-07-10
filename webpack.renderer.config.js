const rules = require("./webpack.rules");
const plugins = require("./webpack.plugins");
const path = require("path");

const isProduction = process.argv[process.argv.indexOf("--mode") + 1] === "production";

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
  optimization: isProduction
    ? {
        splitChunks: {
          chunks: "all",
          maxInitialRequests: 20,
          maxAsyncRequests: 20,
          cacheGroups: {
            default: {
              minChunks: 2,
              priority: -20,
              reuseExistingChunk: true,
            },
            vendor: {
              test: /[\/]node_modules[\/]/,
              name: "renderer-vendors",
              chunks: "all",
              priority: 10,
              enforce: true,
            },
            handsontable: {
              test: /[\/]node_modules[\/](@handsontable|handsontable)[\/]/,
              name: "renderer-handsontable",
              chunks: "async",
              priority: 20,
              enforce: true,
            },
            reactIcons: {
              test: /[\/]node_modules[\/]react-icons[\/]/,
              name: "renderer-react-icons",
              chunks: "async",
              priority: 15,
            },
            flowbite: {
              test: /[\/]src[\/]flowbite[\/]/,
              name: "renderer-flowbite",
              chunks: "async",
              priority: 8,
            },
            viewer: {
              test: /[\/]src[\/]components[\/]viewer[\/]/,
              name: "renderer-viewer",
              chunks: "async",
              priority: 12,
            },
            skillsViewer: {
              test: /[\/]src[\/]components[\/]skillsViewer[\/]/,
              name: "renderer-skills-viewer",
              chunks: "async",
              priority: 12,
            },
          },
        },
        // Enable tree shaking
        usedExports: true,
        sideEffects: false,
      }
    : {},
  output: {
    // Use renderer-specific naming to avoid conflicts
    chunkFilename: isProduction ? "renderer.[name].[contenthash].js" : "renderer.[name].js",
    filename: isProduction ? "renderer.[name].[contenthash].js" : "renderer.[name].js",
  },
  // Performance optimizations
  performance: {
    hints: isProduction ? "warning" : false,
    maxEntrypointSize: 1024000, // 1MB
    maxAssetSize: 512000, // 512KB
  },
};
