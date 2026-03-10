import { defineConfig } from "eslint/config";
import tseslint from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import js from "@eslint/js";

const tsFiles = ["**/*.{ts,tsx}"];

export default defineConfig([
  {
    ignores: [
      "**/node_modules/**",
      "**/.webpack/**",
      "**/coverage/**",
      "**/storybook-static/**",
      "temp/**",
      "dist/**",
      "**/.*",
    ],
  },

  {
    ...js.configs.recommended,
    files: tsFiles,
  },

  ...tseslint.configs["flat/recommended"].map((config) => ({
    ...config,
    files: tsFiles,
  })),

  {
    files: tsFiles,
    plugins: {
      import: importPlugin,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    settings: {
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"],
      },
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },

    rules: {
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-unresolved": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
