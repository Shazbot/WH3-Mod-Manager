import fs from "fs";
import path from "path";
import { extractRegionAreasGrid, parseEsfDocument } from "../index";
import { requireInt, requireValue } from "./args";

interface CliOptions {
  filePath: string;
  outPath: string | null;
  withGrid: boolean;
  classLimit: number;
}

interface RegionAreaClassRow {
  areaId: number;
  classKey: number;
  classKeyHex: string;
  pixelCount: number;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function parseArgs(argv: string[]): CliOptions {
  let filePath = process.env.ESF_FILE ?? "";
  let outPath: string | null = process.env.OUT_FILE ?? null;
  let withGrid = false;
  let classLimit = 30;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--file") {
      filePath = requireValue("--file", next);
      index += 1;
      continue;
    }

    if (arg === "--out") {
      outPath = requireValue("--out", next);
      index += 1;
      continue;
    }

    if (arg === "--class-limit") {
      classLimit = requireInt("--class-limit", next, 1);
      index += 1;
      continue;
    }

    if (arg === "--with-grid") {
      withGrid = true;
      continue;
    }
  }

  if (!filePath) {
    throw new Error("Missing required argument --file <path-to-map_data.esf>.");
  }

  return {
    filePath: path.resolve(filePath),
    outPath: outPath ? path.resolve(outPath) : null,
    withGrid,
    classLimit,
  };
}

function buildClassRows(
  areaClassKeys: Uint32Array,
  areaClassCounts: Uint32Array,
  areaClassHex: string[]
): RegionAreaClassRow[] {
  const rows: RegionAreaClassRow[] = [];
  for (let areaId = 0; areaId < areaClassKeys.length; areaId += 1) {
    const classKey = areaClassKeys[areaId];
    rows.push({
      areaId,
      classKey,
      classKeyHex: areaClassHex[areaId]
        ? `0x${areaClassHex[areaId]}`
        : `0x${classKey.toString(16).padStart(8, "0")}`,
      pixelCount: areaClassCounts[areaId] ?? 0,
    });
  }

  return rows.sort((left, right) => right.pixelCount - left.pixelCount);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(options.filePath)) {
    throw new Error(`ESF file not found: ${options.filePath}`);
  }

  const buffer = fs.readFileSync(options.filePath);
  const document = parseEsfDocument(buffer);
  const grid = extractRegionAreasGrid(buffer);
  const classes = buildClassRows(grid.areaClassKeys, grid.areaClassCounts, grid.areaClassHex);

  if (!options.outPath) {
    console.log(`file: ${options.filePath}`);
    console.log(`codec: 0x${document.header.codecId.toString(16).padStart(8, "0")}`);
    console.log(`region_areas_offset: ${grid.startOffset}`);
    console.log(`region_areas_grid: ${grid.width}x${grid.height}`);
    console.log(`region_areas_cells: ${grid.tokenCount}`);
    console.log(`region_areas_unique_classes: ${grid.uniqueAreas}`);
    console.log("");
    console.log("Top classes by pixel count:");
    for (const row of classes.slice(0, options.classLimit)) {
      console.log(`${row.pixelCount}\tarea:${row.areaId}\tclass:${row.classKeyHex}`);
    }
    return;
  }

  const payload: Record<string, unknown> = {
    file: options.filePath,
    codec: `0x${document.header.codecId.toString(16).padStart(8, "0")}`,
    regionAreas: {
      startOffset: grid.startOffset,
      width: grid.width,
      height: grid.height,
      tokenCount: grid.tokenCount,
      uniqueAreas: grid.uniqueAreas,
      classes,
    },
  };

  if (options.withGrid) {
    payload.regionAreasGrid = {
      encoding: "u16-base64-row-major",
      width: grid.width,
      height: grid.height,
      areaIdsBase64: toBase64(
        new Uint8Array(grid.areaIds.buffer, grid.areaIds.byteOffset, grid.areaIds.byteLength)
      ),
    };
  }

  fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
  fs.writeFileSync(options.outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Wrote ${options.outPath}`);
  console.log(`regionAreasGrid=${grid.width}x${grid.height}`);
  console.log(`uniqueAreas=${grid.uniqueAreas}`);
  if (options.withGrid) {
    console.log(`embeddedGridBytes=${grid.areaIds.byteLength}`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dumpRegionAreas failed: ${message}`);
  process.exitCode = 1;
}
