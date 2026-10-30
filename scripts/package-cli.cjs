"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { build } = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const launcherSource = path.join(projectRoot, "tools", "cliLauncher");
const nativePackageRoot = path.join(projectRoot, "node_modules");

function fail(message) {
  throw new Error(`[packaged CLI] ${message}`);
}

function windowsArch(arch) {
  const normalized = String(arch).toLowerCase();
  if (normalized === "x64" || normalized === "x86_64") return { cmake: "x64", package: "x64", pe: 0x8664 };
  if (normalized === "arm64" || normalized === "aarch64") return { cmake: "ARM64", package: "arm64", pe: 0xaa64 };
  if (normalized === "ia32" || normalized === "x86" || normalized === "win32") {
    return { cmake: "Win32", package: "ia32", pe: 0x014c };
  }
  fail(`unsupported Windows architecture "${arch}". Supported architectures are x64, arm64, and ia32.`);
}

function locateCmake() {
  const configured = process.env.CMAKE_EXECUTABLE;
  const candidates = configured ? [configured] : [];
  if (!configured) {
    const standardPath = path.join(process.env.ProgramFiles || "C:\\Program Files", "CMake", "bin", "cmake.exe");
    candidates.push(standardPath);

    const addVisualStudioCmake = (installationPath) => {
      if (installationPath) {
        candidates.push(
          path.join(installationPath, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin", "cmake.exe"),
        );
      }
    };
    addVisualStudioCmake(process.env.VSINSTALLDIR);

    const vswherePath = path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Microsoft Visual Studio",
      "Installer",
      "vswhere.exe",
    );
    if (fsSync.existsSync(vswherePath)) {
      const vswhere = spawnSync(vswherePath, ["-latest", "-products", "*", "-version", "[17.0,18.0)", "-property", "installationPath"], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (vswhere.status === 0) addVisualStudioCmake(vswhere.stdout.trim());
    }

    candidates.push("cmake");
  }

  const checked = [];
  for (const candidate of candidates) {
    if (candidate !== "cmake" && !fsSync.existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    const versionMatch = probe.status === 0 && probe.stdout.match(/cmake version (\d+)\.(\d+)\.(\d+)/i);
    if (!versionMatch) continue;
    const version = versionMatch.slice(1).map(Number);
    checked.push(`${candidate} (${version.join(".")})`);
    if (version[0] > 3 || (version[0] === 3 && version[1] >= 21)) return candidate;
  }

  const checkedSummary = checked.length > 0 ? ` Found: ${checked.join(", ")}.` : " No usable CMake executable was found.";
  fail(`CMake 3.21 or newer is required for the Visual Studio 2022 generator.${checkedSummary} Install a newer CMake or set CMAKE_EXECUTABLE to its path.`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit", windowsHide: true });
  if (result.error) {
    fail(`${label} could not run (${result.error.message}). Install CMake and Visual Studio 2022 C++ build tools, then retry yarn make.`);
  }
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status ?? "unknown"}. Check that Visual Studio 2022 C++ and the Windows SDK are installed.`);
  }
}

function assertPeArchitecture(filePath, expectedMachine, label) {
  const bytes = fsSync.readFileSync(filePath);
  if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ") {
    fail(`${label} is not a valid Windows PE file: ${filePath}`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 6 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    fail(`${label} is not a valid Windows PE file: ${filePath}`);
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  if (machine !== expectedMachine) {
    fail(`${label} has PE machine 0x${machine.toString(16)}, which does not match the requested architecture (expected 0x${expectedMachine.toString(16)}): ${filePath}`);
  }
}

async function requireFile(filePath, description, installHint) {
  try {
    await fs.access(filePath);
  } catch {
    fail(`${description} is missing: ${filePath}. ${installHint}`);
  }
}

async function copyFile(sourcePath, destinationPath, description, installHint) {
  await requireFile(sourcePath, description, installHint);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

async function buildHeadlessBundle(headlessStage) {
  const cliDirectory = path.join(headlessStage, "cli");
  await fs.mkdir(cliDirectory, { recursive: true });
  await build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, "src", "cli", "main.ts")],
    outfile: path.join(cliDirectory, "main.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    tsconfig: path.join(projectRoot, "tsconfig.tools.json"),
    external: ["@mongodb-js/zstd", "lz4-napi"],
    sourcemap: false,
    logLevel: "info",
  });

  await copyFile(
    path.join(projectRoot, "schema", "schema_wh3.json.zst"),
    path.join(headlessStage, "schema", "schema_wh3.json.zst"),
    "WH3 schema",
    "Restore the repository schema file before packaging.",
  );
}

async function stageNativeCodecs(headlessStage, archInfo) {
  const nodeModules = path.join(headlessStage, "node_modules");
  const windowsInstallHint =
    "Install dependencies with Windows Node.js for the target architecture before packaging; optional native dependencies are platform-specific.";

  const lz4Source = path.join(nativePackageRoot, "lz4-napi");
  const lz4Package = JSON.parse(await fs.readFile(path.join(lz4Source, "package.json"), "utf8"));
  const platformPackageName = `lz4-napi-win32-${archInfo.package}-msvc`;
  const platformPackageSource = path.join(nativePackageRoot, "@antoniomuso", platformPackageName);
  const platformPackageJsonPath = path.join(platformPackageSource, "package.json");
  await requireFile(platformPackageJsonPath, `LZ4 ${archInfo.package} native package`, windowsInstallHint);
  const platformPackageJson = JSON.parse(await fs.readFile(platformPackageJsonPath, "utf8"));
  const nativeEntry = platformPackageJson.main;
  if (typeof nativeEntry !== "string" || path.basename(nativeEntry) !== nativeEntry || !nativeEntry.endsWith(".node")) {
    fail(`${platformPackageName}/package.json must name a simple .node main entry.`);
  }
  if (platformPackageJson.version !== lz4Package.version) {
    fail(`LZ4 native package version ${platformPackageJson.version} does not match lz4-napi ${lz4Package.version}; reinstall dependencies before packaging.`);
  }

  await copyFile(
    path.join(lz4Source, "index.js"),
    path.join(nodeModules, "lz4-napi", "index.js"),
    "lz4-napi loader",
    windowsInstallHint,
  );
  await copyFile(
    path.join(lz4Source, "package.json"),
    path.join(nodeModules, "lz4-napi", "package.json"),
    "lz4-napi package metadata",
    windowsInstallHint,
  );
  await copyFile(
    path.join(lz4Source, "LICENSE"),
    path.join(nodeModules, "lz4-napi", "LICENSE"),
    "lz4-napi license",
    windowsInstallHint,
  );
  await copyFile(
    platformPackageJsonPath,
    path.join(nodeModules, "@antoniomuso", platformPackageName, "package.json"),
    `LZ4 ${archInfo.package} native package metadata`,
    windowsInstallHint,
  );
  const lz4BinaryDestination = path.join(nodeModules, "@antoniomuso", platformPackageName, nativeEntry);
  const lz4BinarySource = path.join(platformPackageSource, nativeEntry);
  await copyFile(lz4BinarySource, lz4BinaryDestination, `LZ4 ${archInfo.package} native binding`, windowsInstallHint);
  assertPeArchitecture(lz4BinaryDestination, archInfo.pe, `LZ4 ${archInfo.package} native binding`);

  const zstdSource = path.join(nativePackageRoot, "@mongodb-js", "zstd");
  const zstdDestination = path.join(nodeModules, "@mongodb-js", "zstd");
  await copyFile(
    path.join(zstdSource, "package.json"),
    path.join(zstdDestination, "package.json"),
    "@mongodb-js/zstd package metadata",
    "Install Windows dependencies and rebuild native modules for the target architecture before packaging.",
  );
  await copyFile(
    path.join(zstdSource, "LICENSE.md"),
    path.join(zstdDestination, "LICENSE.md"),
    "@mongodb-js/zstd license",
    "Install Windows dependencies and rebuild native modules for the target architecture before packaging.",
  );
  await copyFile(
    path.join(zstdSource, "lib", "index.js"),
    path.join(zstdDestination, "lib", "index.js"),
    "@mongodb-js/zstd loader",
    "Install Windows dependencies and rebuild native modules for the target architecture before packaging.",
  );
  const zstdBinaryDestination = path.join(zstdDestination, "build", "Release", "zstd.node");
  await copyFile(
    path.join(zstdSource, "build", "Release", "zstd.node"),
    zstdBinaryDestination,
    "@mongodb-js/zstd Release native binding",
    "Install Windows dependencies and rebuild native modules for the target architecture before packaging.",
  );
  assertPeArchitecture(zstdBinaryDestination, archInfo.pe, "@mongodb-js/zstd native binding");
}

async function buildLauncher(buildDirectory, archInfo) {
  if (process.platform !== "win32") {
    fail("Windows CLI packaging requires a native Windows build host so CMake can use MSVC. Run yarn make from Windows with Visual Studio 2022 C++ build tools installed.");
  }

  const cmake = locateCmake();
  run(
    cmake,
    [
      "-S",
      launcherSource,
      "-B",
      buildDirectory,
      "-G",
      "Visual Studio 17 2022",
      "-A",
      archInfo.cmake,
    ],
    "CMake configuration for whmm-cli",
  );
  run(cmake, ["--build", buildDirectory, "--config", "Release", "--target", "whmm-cli"], "MSVC build for whmm-cli");

  const launcherPath = path.join(buildDirectory, "Release", "whmm-cli.exe");
  await requireFile(
    launcherPath,
    "MSVC-built whmm-cli.exe",
    "Install Visual Studio 2022 C++ build tools and the Windows SDK, then retry yarn make.",
  );
  assertPeArchitecture(launcherPath, archInfo.pe, "whmm-cli.exe");
  return launcherPath;
}

async function packageWindowsCli({ platform, arch, outputPaths }) {
  if (platform !== "win32") return;
  if (!Array.isArray(outputPaths) || outputPaths.length === 0) {
    fail("Forge did not provide package outputPaths; cannot stage the CLI into the Windows app.");
  }

  const archInfo = windowsArch(arch);
  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "whmm-packaged-cli-"));
  try {
    const headlessStage = path.join(workDirectory, "headless");
    await buildHeadlessBundle(headlessStage);
    await stageNativeCodecs(headlessStage, archInfo);
    const launcherPath = await buildLauncher(path.join(workDirectory, "launcher-build"), archInfo);

    for (const outputPath of outputPaths) {
      const appDirectory = path.resolve(outputPath);
      const resourcesDirectory = path.join(appDirectory, "resources");
      await requireFile(path.join(appDirectory, "wh3mm.exe"), "packaged wh3mm.exe", "Re-run Electron Forge packaging before staging the CLI.");
      try {
        const resourceInfo = await fs.stat(resourcesDirectory);
        if (!resourceInfo.isDirectory()) throw new Error("not a directory");
      } catch {
        fail(`packaged resources directory is missing: ${resourcesDirectory}. Re-run Electron Forge packaging before staging the CLI.`);
      }

      const stagedHeadless = path.join(resourcesDirectory, `.headless-staging-${process.pid}`);
      const destinationHeadless = path.join(resourcesDirectory, "headless");
      await fs.rm(stagedHeadless, { recursive: true, force: true });
      await fs.cp(headlessStage, stagedHeadless, { recursive: true, errorOnExist: true, force: false });

      try {
        await fs.rm(destinationHeadless, { recursive: true, force: true });
        await fs.rename(stagedHeadless, destinationHeadless);
        await fs.copyFile(launcherPath, path.join(appDirectory, "whmm-cli.exe"));
      } catch (error) {
        await fs.rm(stagedHeadless, { recursive: true, force: true });
        throw error;
      }
      console.log(`[packaged CLI] staged whmm-cli.exe and headless assets in ${appDirectory}`);
    }
  } finally {
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}

module.exports = async function postPackageHook(_forgeConfig, packageResult) {
  return packageWindowsCli(packageResult);
};
module.exports.packageWindowsCli = packageWindowsCli;
module.exports.windowsArch = windowsArch;
