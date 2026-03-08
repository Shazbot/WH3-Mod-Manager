import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
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
        test: {
          name: "node",
          include: ["test/**/*.node.test.ts"],
          environment: "node",
          setupFiles: ["./test/setup/node.ts"],
        },
      },
      {
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
