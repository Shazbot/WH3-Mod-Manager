const fs = require("fs");
const path = require("path");

const hostPath = path.resolve(__dirname, "..", "tools", "WH3AssetHost", "WH3AssetHost.exe");
const nativePatchHelperPath = path.resolve(__dirname, "..", "tools", "nativePatchHelper", "WH3NativePatchHelper.exe");

let valid = false;
try {
  valid = fs.statSync(hostPath).isFile() && fs.statSync(hostPath).size > 0;
} catch {
  valid = false;
}

if (!valid) {
  console.error(
    [
      "WH3AssetHost.exe is required for packaged WHMM builds.",
      `Expected: ${hostPath}`,
      "Publish the AssetEditor WH3AssetHost project and copy the release executable into tools/WH3AssetHost before packaging.",
    ].join("\n"),
  );
  process.exit(1);
}

let nativePatchHelperValid = false;
try {
  nativePatchHelperValid = fs.statSync(nativePatchHelperPath).isFile() && fs.statSync(nativePatchHelperPath).size > 0;
} catch {
  nativePatchHelperValid = false;
}

if (!nativePatchHelperValid) {
  console.error(
    [
      "WH3NativePatchHelper.exe is required for packaged WHMM builds.",
      `Expected: ${nativePatchHelperPath}`,
      "Build the helper with tools/nativePatchHelper/build.ps1 before packaging.",
    ].join("\n"),
  );
  process.exit(1);
}
