// Fails fast before `electron-forge start` when a dev port can't be bound.
// On Windows, Hyper-V/WSL2/WinNAT reserve dynamic port ranges that can cover
// Forge's defaults (dev server 3000, logger 9000), which surfaces as an
// opaque "listen EACCES" deep inside Forge.
const net = require("net");
const path = require("path");

const pkg = require(path.join(__dirname, "..", "package.json"));
const webpackPlugin = (pkg.config?.forge?.plugins ?? []).find(
  (plugin) => plugin.name === "@electron-forge/plugin-webpack",
);
const pluginConfig = webpackPlugin?.config ?? {};

const ports = [
  { name: "webpack dev server", port: pluginConfig.port ?? 3000 },
  { name: "Forge logger", port: pluginConfig.loggerPort ?? 9000 },
];

const tryListen = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => resolve(err));
    server.once("listening", () => server.close(() => resolve(null)));
    server.listen(port, "0.0.0.0");
  });

(async () => {
  let failed = false;
  for (const { name, port } of ports) {
    const err = await tryListen(port);
    if (!err) continue;
    failed = true;
    console.error(`Port ${port} (${name}) is unavailable: ${err.code ?? err.message}`);
    if (err.code === "EADDRINUSE") {
      console.error(`  Another process is listening on it. Find it with: netstat -ano | findstr :${port}`);
    } else if (err.code === "EACCES" && process.platform === "win32") {
      console.error("  Windows has probably reserved it (Hyper-V/WSL2/WinNAT). Check with:");
      console.error("    netsh interface ipv4 show excludedportrange protocol=tcp");
      console.error("  Free it from an admin shell with: net stop winnat && net start winnat");
      console.error(
        `  Or set "${name === "Forge logger" ? "loggerPort" : "port"}" in the plugin-webpack config in package.json.`,
      );
    }
  }
  if (failed) process.exit(1);
})();
