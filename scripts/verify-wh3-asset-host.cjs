const fs = require("fs");
const path = require("path");

const toolDirectory = path.resolve(__dirname, "..", "tools", "WH3AssetHost");
const requiredFiles = [
  "WH3AssetHost.exe",
  "texconv.exe",
  "DirectXTex-LICENSE.txt",
];

const missing = requiredFiles.filter((fileName) => {
  const filePath = path.join(toolDirectory, fileName);
  try {
    return !fs.statSync(filePath).isFile() || fs.statSync(filePath).size <= 0;
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  console.error(
    [
      "The packaged WH3AssetHost runtime is incomplete.",
      `Directory: ${toolDirectory}`,
      `Missing: ${missing.join(", ")}`,
      "Publish the AssetEditor WH3AssetHost project and copy the complete publish output into tools/WH3AssetHost before packaging.",
      "The publish output includes the pinned DirectXTex texconv.exe and its MIT license.",
    ].join("\n"),
  );
  process.exit(1);
}
