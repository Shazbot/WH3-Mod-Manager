"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const launcherScript = path.join(projectRoot, "tools", "cliLauncher", "whmm-cli.cmd");
const nativePackageRoot = path.join(projectRoot, "node_modules");

function fail(message) {
  throw new Error(`[packaged CLI] ${message}`);
}

function windowsArch(arch) {
  const normalized = String(arch).toLowerCase();
  if (normalized === "x64" || normalized === "x86_64") return { package: "x64", pe: 0x8664 };
  if (normalized === "arm64" || normalized === "aarch64") return { package: "arm64", pe: 0xaa64 };
  if (normalized === "ia32" || normalized === "x86" || normalized === "win32") {
    return { package: "ia32", pe: 0x014c };
  }
  fail(`unsupported Windows architecture "${arch}". Supported architectures are x64, arm64, and ia32.`);
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
    await requireFile(launcherScript, "CLI launcher script", "Restore tools/cliLauncher/whmm-cli.cmd before packaging.");

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
        await fs.copyFile(launcherScript, path.join(appDirectory, "whmm-cli.cmd"));
      } catch (error) {
        await fs.rm(stagedHeadless, { recursive: true, force: true });
        throw error;
      }
      console.log(`[packaged CLI] staged whmm-cli.cmd and headless assets in ${appDirectory}`);
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
