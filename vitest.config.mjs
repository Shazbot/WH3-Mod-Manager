import path from "node:path";
import { fileURLToPath } from "node:url";

import { transformSync } from "@babel/core";
import ts from "typescript";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const typescriptFilePattern = /\.(?:[cm]?ts|tsx)$/;
// Matches the renderer build: React Compiler runs on src .tsx files only (webpack.renderer.config.js).
const reactCompilerFilePattern = /\/src\/.+\.tsx$/;

// Tests run the same compiled components the app ships, so a component the compiler breaks fails here too. Like the
// renderer build it compiles the TSX source before TypeScript: once JSX is createElement calls, the compiler reads
// `ref` props as refs passed to a function and skips the component. Vite chains this plugin's source map with the
// TypeScript one, so stack traces still point at the source.
const reactCompiler = {
  name: "react-compiler",
  enforce: "pre",
  transform(source, id) {
    const filePath = id.split("?", 1)[0];
    if (filePath.includes("/node_modules/") || !reactCompilerFilePattern.test(filePath)) return null;

    const result = transformSync(source, {
      filename: filePath,
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      plugins: [
        ["@babel/plugin-syntax-typescript", { isTSX: true }],
        ["babel-plugin-react-compiler", { target: "19" }],
      ],
    });
    return { code: result.code, map: result.map };
  },
};

const transformTypescript = {
  name: "transform-typescript-with-typescript",
  enforce: "pre",
  transform(source, id) {
    const filePath = id.split("?", 1)[0];
    if (filePath.includes("/node_modules/") || !typescriptFilePattern.test(filePath)) return null;

    const result = ts.transpileModule(source, {
      fileName: filePath,
      compilerOptions: {
        esModuleInterop: true,
        inlineSources: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        sourceMap: true,
        target: ts.ScriptTarget.ES2021,
      },
    });
    const code = result.outputText.replace(/\bprocess\.env\.([A-Z0-9_]+)/g, (_match, name) => {
      const value = process.env[name];
      return value === undefined ? "undefined" : JSON.stringify(value);
    });

    return {
      code,
      map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
    };
  },
};

export default defineConfig({
  root: projectRoot,
  esbuild: false,
  plugins: [reactCompiler, transformTypescript],
  resolve: {
    alias: {
      "@": path.resolve(projectRoot),
    },
  },
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
    },
    projects: [
      {
        esbuild: false,
        plugins: [reactCompiler, transformTypescript],
        // Projects do not inherit the root `resolve`, and src code imports through the "@" alias.
        resolve: { alias: { "@": projectRoot } },
        test: {
          name: "node",
          include: ["test/**/*.node.test.ts"],
          environment: "node",
          setupFiles: ["./test/setup/node.ts"],
        },
      },
      {
        esbuild: false,
        plugins: [reactCompiler, transformTypescript],
        resolve: { alias: { "@": projectRoot } },
        test: {
          name: "dom",
          include: ["test/**/*.dom.test.ts", "test/**/*.dom.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./test/setup/node.ts", "./test/setup/dom.ts"],
        },
      },
    ],
  },
});
