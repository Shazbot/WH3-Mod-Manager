import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { requireValue } from "./args";

interface Options {
  packPath: string;
  campaign: string;
  faction: string;
  outputPackPath: string;
  transferTo?: string;
  overwrite: boolean;
}

interface CliResponse {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { message?: string };
}

function parseArgs(argv: string[]): Options {
  let packPath: string | undefined;
  let campaign: string | undefined;
  let faction: string | undefined;
  let outputPackPath: string | undefined;
  let transferTo: string | undefined;
  let overwrite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--pack") { packPath = requireValue(flag, argv[index + 1]); index += 1; }
    else if (flag === "--campaign") { campaign = requireValue(flag, argv[index + 1]); index += 1; }
    else if (flag === "--faction") { faction = requireValue(flag, argv[index + 1]); index += 1; }
    else if (flag === "--out-pack") { outputPackPath = requireValue(flag, argv[index + 1]); index += 1; }
    else if (flag === "--transfer-to") { transferTo = requireValue(flag, argv[index + 1]); index += 1; }
    else if (flag === "--overwrite") overwrite = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }

  if (!packPath) throw new Error("Missing required argument --pack <source-pack>.");
  if (!campaign) throw new Error("Missing required argument --campaign <campaign-directory>.");
  if (!/^[A-Za-z0-9_-]+$/.test(campaign)) throw new Error("Campaign must be a folder name, such as wh3_main_combi.");
  if (!faction) throw new Error("Missing required argument --faction <faction-key>.");
  if (!outputPackPath) throw new Error("Missing required argument --out-pack <new-pack-path>.");

  const resolvedSource = path.resolve(packPath);
  const resolvedOutput = path.resolve(outputPackPath);
  if (resolvedSource === resolvedOutput) throw new Error("The output pack must differ from the source pack.");
  if (!overwrite && fs.existsSync(resolvedOutput)) {
    throw new Error(`Output pack already exists: ${resolvedOutput}. Remove it or pass --overwrite.`);
  }

  return {
    packPath: resolvedSource,
    campaign,
    faction,
    outputPackPath: resolvedOutput,
    ...(transferTo ? { transferTo } : {}),
    overwrite,
  };
}

function runWhmmCli(repoRoot: string, cliPath: string, args: string[], label: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  let response: CliResponse;
  try {
    response = JSON.parse(result.stdout.trim()) as CliResponse;
  } catch {
    throw new Error(`${label} returned unreadable output: ${(result.stdout || result.stderr).trim().slice(0, 800)}`);
  }
  if (result.status !== 0 || !response.ok || !response.data) {
    const message = response.error?.message ?? result.stderr.trim() ?? `exit code ${result.status}`;
    throw new Error(`${label} failed: ${message}`);
  }
  return response.data;
}

function runFactionEditor(repoRoot: string, editorPath: string, args: string[]): string {
  const result = spawnSync(process.execPath, ["--max-old-space-size=8192", editorPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Faction editor could not start: ${result.error.message}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    throw new Error(`Faction editor failed: ${result.stderr.trim() || `exit code ${result.status}`}`);
  }
  return result.stdout;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "../../../..");
  const whmmCliPath = path.join(repoRoot, "dist", "cli", "main.js");
  const factionEditorPath = path.join(repoRoot, "tools", "esf", "dist", "cli", "removeFaction.js");
  if (!fs.existsSync(whmmCliPath)) throw new Error("WHMM CLI is not built. Run yarn build:tools first.");
  if (!fs.existsSync(factionEditorPath)) throw new Error("ESF editor is not built. Run yarn esf:build first.");

  const internalPath = `campaigns\\${options.campaign}\\startpos.esf`;
  const internalGlob = `campaigns/${options.campaign}/startpos.esf`;
  const cacheRoot = path.join(repoRoot, ".cache", "automation", "startpos-investigation");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const tempDirectory = fs.mkdtempSync(path.join(cacheRoot, "remove-faction-pack-"));
  const sourceEsfPath = path.join(tempDirectory, "source-startpos.esf");
  const editedEsfPath = path.join(tempDirectory, "edited-startpos.esf");
  const baseSubsetPath = path.join(tempDirectory, "startpos-base-subset.pack");
  const writeInputPath = path.join(tempDirectory, "write.json");

  try {
    runWhmmCli(
      repoRoot,
      whmmCliPath,
      ["pack", "read", options.packPath, internalPath, "--output", sourceEsfPath, "--format", "json"],
      "Reading startpos from source pack",
    );
    if (!fs.existsSync(sourceEsfPath) || fs.statSync(sourceEsfPath).size === 0) {
      throw new Error(`WHMM did not extract ${internalPath} from ${options.packPath}.`);
    }

    runFactionEditor(repoRoot, factionEditorPath, [
      "--file", sourceEsfPath,
      "--out", editedEsfPath,
      "--faction", options.faction,
      ...(options.transferTo ? ["--transfer-to", options.transferTo] : []),
    ]);

    const subset = runWhmmCli(
      repoRoot,
      whmmCliPath,
      [
        "pack", "subset", options.packPath,
        "--include", internalGlob,
        "--closure", "none",
        "--mode", "external",
        "--output", baseSubsetPath,
        "--format", "json",
      ],
      "Creating one-file source-pack subset",
    );
    if (subset.fileCount !== 1 || subset.complete !== true) {
      throw new Error(`Expected one complete startpos entry in the base subset; received ${String(subset.fileCount)}.`);
    }

    fs.writeFileSync(writeInputPath, JSON.stringify({
      files: [{ op: "replace", path: internalPath, sourcePath: editedEsfPath }],
    }, null, 2));
    runWhmmCli(
      repoRoot,
      whmmCliPath,
      [
        "pack", "write", baseSubsetPath,
        "--output", options.outputPackPath,
        "--input", writeInputPath,
        ...(options.overwrite ? ["--overwrite"] : []),
        "--format", "json",
      ],
      "Writing edited startpos override",
    );

    const validation = runWhmmCli(
      repoRoot,
      whmmCliPath,
      ["pack", "validate", options.outputPackPath, "--full-payloads", "--format", "json"],
      "Validating output pack",
    );
    if (validation.valid !== true || validation.validationComplete !== true || validation.fileCount !== 1) {
      throw new Error("Output pack did not pass complete single-file validation.");
    }
    console.log(`Created and validated one-file override pack: ${options.outputPackPath}`);
    console.log(`Replaced ${internalPath} from ${options.packPath}.`);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error: Error) => {
  console.error(`removeFactionPack failed: ${error.message}`);
  process.exitCode = 1;
});
