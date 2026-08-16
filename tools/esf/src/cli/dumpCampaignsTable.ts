import fs from "fs";
import path from "path";
import {
  extractCampaignTableIdentity,
  extractCampaignTableRow,
  openEsfBuffer,
  parseEsfDocument,
  StartposCampaignTableIdentity,
  StartposCampaignTableRow,
} from "../index";
import { requireValue } from "./args";

const CAMPAIGNS_TABLE_COLUMNS = [
  "campaign_name",
  "onscreen_name",
  "description",
  "map_name",
  "exportable",
  "bullet_list",
  "display_location",
  "mask",
  "available_for_mp",
  "mp_sort_order",
  "game",
  "script_path",
  "battle_path",
  "terrain_location",
] as const;

const EXTRACTED_COLUMN_INDEXES = new Set([0, 3, 6, 8, 11, 12, 13]);

interface CliOptions {
  filePaths: string[];
  outPath: string | null;
  validationPath: string | null;
  json: boolean;
  identityOnly: boolean;
}

interface ExtractedFileRow {
  file: string;
  wasCompressed: boolean;
  row: StartposCampaignTableRow;
}

interface ExtractedIdentityRow {
  file: string;
  row: StartposCampaignTableIdentity;
}

function parseArgs(argv: string[]): CliOptions {
  const filePaths: string[] = [];
  let outPath: string | null = null;
  let validationPath: string | null = null;
  let json = false;
  let identityOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--file") {
      filePaths.push(path.resolve(requireValue("--file", next)));
      index += 1;
      continue;
    }

    if (arg === "--out") {
      outPath = path.resolve(requireValue("--out", next));
      index += 1;
      continue;
    }

    if (arg === "--validate") {
      validationPath = path.resolve(requireValue("--validate", next));
      index += 1;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--identity-only") {
      identityOnly = true;
      continue;
    }
  }

  if (filePaths.length === 0 && process.env.ESF_FILE) {
    filePaths.push(path.resolve(process.env.ESF_FILE));
  }

  if (filePaths.length === 0) {
    throw new Error("Missing required --file <path-to-startpos.esf> (may be repeated).");
  }

  return { filePaths, outPath, validationPath, json, identityOnly };
}

function identityToColumns(row: StartposCampaignTableIdentity): string[] {
  return [row.campaignName, row.mapName];
}

function rowToColumns(row: StartposCampaignTableRow): string[] {
  // Empty fields are not present in startpos.esf. Keeping them empty makes the
  // output a valid 14-column campaigns_tables-shaped TSV without fabricating
  // localised or DB-only values.
  return [
    row.campaignName,
    "",
    "",
    row.mapName,
    "",
    "",
    row.displayLocation,
    "",
    String(row.availableForMp),
    "",
    "",
    row.scriptPath,
    row.battlePath,
    row.terrainLocation,
  ];
}

function parseTsv(contents: string): string[][] {
  return contents
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}

function validateRows(rows: ExtractedFileRow[], validationPath: string): string {
  if (!fs.existsSync(validationPath)) {
    throw new Error(`Validation TSV not found: ${validationPath}`);
  }

  const expectedByCampaign = new Map<string, string[]>();
  for (const columns of parseTsv(fs.readFileSync(validationPath, "utf8"))) {
    if (columns[0]) {
      expectedByCampaign.set(columns[0], columns);
    }
  }

  const failures: string[] = [];
  for (const extracted of rows) {
    const actual = rowToColumns(extracted.row);
    const expected = expectedByCampaign.get(extracted.row.campaignName);
    if (!expected) {
      failures.push(`${extracted.row.campaignName}: missing from validation TSV`);
      continue;
    }

    for (const index of EXTRACTED_COLUMN_INDEXES) {
      if (actual[index] !== expected[index]) {
        failures.push(
          `${extracted.row.campaignName}.${CAMPAIGNS_TABLE_COLUMNS[index]}: ` +
            `got ${JSON.stringify(actual[index])}, expected ${JSON.stringify(expected[index])}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Validation failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  return (
    `Validated ${rows.length} row(s), 7 ESF-backed columns each. ` +
    "Skipped 7 columns which are not persisted in startpos.esf."
  );
}

function validationRows(validationPath: string): Map<string, string[]> {
  if (!fs.existsSync(validationPath)) {
    throw new Error(`Validation TSV not found: ${validationPath}`);
  }

  const rows = new Map<string, string[]>();
  for (const columns of parseTsv(fs.readFileSync(validationPath, "utf8"))) {
    if (columns[0]) {
      rows.set(columns[0], columns);
    }
  }
  return rows;
}

function validateIdentities(rows: ExtractedIdentityRow[], validationPath: string): string {
  const expectedByCampaign = validationRows(validationPath);
  const failures: string[] = [];

  for (const extracted of rows) {
    const expected = expectedByCampaign.get(extracted.row.campaignName);
    if (!expected) {
      failures.push(`${extracted.row.campaignName}: missing from validation TSV`);
      continue;
    }
    if (extracted.row.mapName !== expected[3]) {
      failures.push(
        `${extracted.row.campaignName}.map_name: got ${JSON.stringify(extracted.row.mapName)}, ` +
          `expected ${JSON.stringify(expected[3])}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Validation failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  return `Validated campaign_name and map_name for ${rows.length} row(s).`;
}

function extractFile(filePath: string): ExtractedFileRow {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ESF file not found: ${filePath}`);
  }

  const opened = openEsfBuffer(fs.readFileSync(filePath));
  const document = parseEsfDocument(opened.buffer);
  const row = extractCampaignTableRow(opened.buffer, document);
  if (!row) {
    throw new Error(`Could not locate complete campaign metadata in ${filePath}.`);
  }

  return { file: filePath, wasCompressed: opened.wasCompressed, row };
}

function extractIdentityFile(filePath: string): ExtractedIdentityRow {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ESF file not found: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const row = extractCampaignTableIdentity(buffer, parseEsfDocument(buffer));
  if (!row) {
    throw new Error(`Could not locate campaign_name and map_name in ${filePath}.`);
  }
  return { file: filePath, row };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.identityOnly) {
    const rows = options.filePaths.map(extractIdentityFile);
    const validationMessage = options.validationPath ? validateIdentities(rows, options.validationPath) : null;
    const output = options.json
      ? JSON.stringify({ columns: ["campaign_name", "map_name"], rows }, null, 2) + "\n"
      : rows.map((extracted) => identityToColumns(extracted.row).join("\t")).join("\n") + "\n";
    writeOutput(options.outPath, output);
    if (validationMessage) {
      console.error(validationMessage);
    }
    return;
  }

  const rows = options.filePaths.map(extractFile);
  const validationMessage = options.validationPath ? validateRows(rows, options.validationPath) : null;

  const output = options.json
    ? JSON.stringify(
        {
          columns: CAMPAIGNS_TABLE_COLUMNS,
          unavailableFromStartpos: CAMPAIGNS_TABLE_COLUMNS.filter(
            (_column, index) => !EXTRACTED_COLUMN_INDEXES.has(index),
          ),
          rows,
        },
        null,
        2,
      ) + "\n"
    : rows.map((extracted) => rowToColumns(extracted.row).join("\t")).join("\n") + "\n";

  writeOutput(options.outPath, output);

  if (validationMessage) {
    console.error(validationMessage);
  }
}

function writeOutput(outPath: string | null, output: string): void {
  if (!outPath) {
    process.stdout.write(output);
    return;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output, "utf8");
  console.error(`Wrote ${outPath}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dumpCampaignsTable failed: ${message}`);
  process.exitCode = 1;
}
