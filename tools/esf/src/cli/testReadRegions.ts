import fs from "fs";
import path from "path";
import { extractRegions, parseEsfDocument } from "../index";

function resolveFilePath(): string {
  const selected = process.argv[2] || process.env.ESF_FILE;
  if (!selected) {
    throw new Error("Missing ESF path. Pass it as the first argument or set ESF_FILE.");
  }
  return path.resolve(selected);
}

function main(): void {
  const filePath = resolveFilePath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`ESF file does not exist: ${filePath}`);
  }

  const document = parseEsfDocument(fs.readFileSync(filePath));
  const regions = extractRegions(document);

  if (regions.length < 1) {
    throw new Error("No region-like entries extracted from ESF.");
  }

  const keysWithMultipleSegments = regions.filter((region) => region.key.split("_").length >= 4);
  if (keysWithMultipleSegments.length < 1) {
    throw new Error("Region extraction did not return any expected key format.");
  }

  console.log(`PASS: parsed ${filePath}`);
  console.log(`codec=0x${document.header.codecId.toString(16).padStart(8, "0")}`);
  console.log(`stringTable=${document.stringTable.length}`);
  console.log(`regions=${regions.length}`);
  console.log("sample:");

  for (const region of regions.slice(0, 20)) {
    console.log(`${region.id ?? "null"}\t${region.key}`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`testReadRegions failed: ${message}`);
  process.exitCode = 1;
}
