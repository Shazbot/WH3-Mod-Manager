const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function applyPatchDirectory(directory) {
  const patchDirectory = path.join(process.cwd(), directory);
  if (!fs.existsSync(patchDirectory)) {
    return;
  }

  const result = spawnSync(
    process.execPath,
    [require.resolve("patch-package"), "--patch-dir", directory],
    { stdio: "inherit" }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

applyPatchDirectory("patches/common");
applyPatchDirectory(`patches/${process.platform}`);
