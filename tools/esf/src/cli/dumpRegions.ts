import fs from "fs";
import path from "path";
import { extractRegions, parseEsfDocument } from "../index";
import { requireInt, requireValue } from "./args";

interface CliOptions {
  filePath: string;
  limit: number;
  json: boolean;
  assertMin: number;
}

function parseArgs(argv: string[]): CliOptions {
  let filePath = "";
  let limit = 50;
  let json = false;
  let assertMin = 1;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--file") {
      filePath = requireValue("--file", next);
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      limit = requireInt("--limit", next, 1);
      i += 1;
      continue;
    }

    if (arg === "--assert-min") {
      assertMin = requireInt("--assert-min", next, 0);
      i += 1;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }
  }

  if (!filePath) {
    throw new Error("Missing required argument --file <path-to-esf>.");
  }

  return {
    filePath,
    limit,
    json,
    assertMin,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const absolutePath = path.resolve(options.filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`ESF file not found: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  const document = parseEsfDocument(buffer);
  const regions = extractRegions(document);
  const limited = regions.slice(0, options.limit);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          file: absolutePath,
          header: document.header,
          totalRegions: regions.length,
          shownRegions: limited.length,
          regions: limited,
        },
        null,
        2
      )
    );
  } else {
    console.log(`file: ${absolutePath}`);
    console.log(`codec: 0x${document.header.codecId.toString(16).padStart(8, "0")}`);
    console.log(`string table entries: ${document.stringTable.length}`);
    console.log(`region candidates: ${regions.length}`);
    console.log("");
    for (const region of limited) {
      const idText = region.id === null ? "null" : String(region.id);
      console.log(`${idText}\t${region.key}`);
    }
  }

  if (regions.length < options.assertMin) {
    throw new Error(`Expected at least ${options.assertMin} regions, found ${regions.length}.`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dumpRegions failed: ${message}`);
  process.exitCode = 1;
}
