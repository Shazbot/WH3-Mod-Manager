import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const typescriptFilePattern = /\.(?:[cm]?ts|tsx)$/;

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
        jsx: ts.JsxEmit.React,
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
  plugins: [transformTypescript],
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
        plugins: [transformTypescript],
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
        plugins: [transformTypescript],
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
