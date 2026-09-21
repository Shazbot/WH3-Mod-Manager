const { spawnSync } = require("node:child_process");
const path = require("node:path");

const vitest = path.join(__dirname, "..", "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(
  process.execPath,
  [
    vitest,
    "run",
    "test/unitPainterPerformance.node.test.ts",
    "--config",
    "vitest.config.mjs",
    "--configLoader",
    "native",
  ],
  {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: {
      ...process.env,
      WHMM_UNIT_PAINTER_BENCHMARK: "1",
    },
  },
);

process.exit(result.status ?? 1);
