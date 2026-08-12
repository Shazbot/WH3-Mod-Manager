import fs from "fs";
import path from "path";
import {
  extractMapPointsWithTheatreBounds,
  extractRegionCenters,
  extractStartposRegions,
  openEsfBuffer,
  parseEsfDocument,
} from "../index";
import { requireInt, requireValue } from "./args";

interface CliOptions {
  filePath: string;
  limit: number;
  json: boolean;
  assertMin: number;
  includeNonRegion: boolean;
}

/** Which record layout the regions were read from. */
type RegionSource = "map_data" | "startpos";

interface RegionRow {
  /** REGION_INDEX (map_data) or REGIONS_ARRAY position (startpos). */
  regionIndex: number;
  key: string;
  /** map_data only: region centre in region-area grid cells. */
  gridX: number | null;
  gridY: number | null;
  /** map_data only: REGION_KEYS world coordinates, when in a UI theatre. */
  worldX: number | null;
  worldY: number | null;
  /** startpos only: campaign-start ownership. */
  ownerFaction: string | null;
  subculture: string | null;
  settlementKey: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  let filePath = process.env.ESF_FILE ?? "";
  let limit = 50;
  let json = false;
  let assertMin = 1;
  let includeNonRegion = false;

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

    if (arg === "--include-nonregion") {
      includeNonRegion = true;
      continue;
    }
  }

  if (!filePath) {
    throw new Error("Missing required argument --file <path-to-esf> (or set ESF_FILE).");
  }

  return {
    filePath,
    limit,
    json,
    assertMin,
    includeNonRegion,
  };
}

function emptyRow(regionIndex: number, key: string): RegionRow {
  return {
    regionIndex,
    key,
    gridX: null,
    gridY: null,
    worldX: null,
    worldY: null,
    ownerFaction: null,
    subculture: null,
    settlementKey: null,
  };
}

/**
 * Builds region rows from whichever layout the file uses. A campaign map's
 * map_data.esf carries REGION_DATA/REGION_KEYS geometry; a startpos.esf carries
 * REGIONS_ARRAY ownership. The two are detected by content rather than by
 * filename so a decompressed startpos dump also works.
 */
function buildRegionRows(
  buffer: Buffer,
  includeNonRegion: boolean
): { rows: RegionRow[]; source: RegionSource | null } {
  const document = parseEsfDocument(buffer);
  const options = { includeNonRegion };

  const centers = extractRegionCenters(buffer, document, options);
  if (centers.length > 0) {
    // REGION_KEYS only covers regions in a UI theatre, so it is a subset of
    // REGION_DATA; join on the key and leave world coordinates null otherwise.
    const worldByKey = new Map(
      extractMapPointsWithTheatreBounds(buffer, document, options).points.map((point) => [point.key, point])
    );

    const rows = centers.map((center) => {
      const row = emptyRow(center.id, center.key);
      row.gridX = center.x;
      row.gridY = center.y;
      const world = worldByKey.get(center.key);
      if (world) {
        row.worldX = world.x;
        row.worldY = world.y;
      }
      return row;
    });

    return { rows, source: "map_data" };
  }

  const startposRegions = extractStartposRegions(buffer, document, options);
  if (startposRegions.length > 0) {
    const rows = startposRegions.map((region) => {
      const row = emptyRow(region.regionIndex, region.key);
      row.ownerFaction = region.ownerFaction;
      row.subculture = region.subculture;
      row.settlementKey = region.settlementKey;
      return row;
    });

    return { rows, source: "startpos" };
  }

  return { rows: [], source: null };
}

function printMapDataRows(rows: RegionRow[]): void {
  console.log("index\tgrid x,y\tworld x,y\tkey");
  for (const row of rows) {
    const world =
      row.worldX === null || row.worldY === null ? "-" : `${row.worldX.toFixed(1)},${row.worldY.toFixed(1)}`;
    console.log(`${row.regionIndex}\t${row.gridX},${row.gridY}\t\t${world}\t${row.key}`);
  }
}

function printStartposRows(rows: RegionRow[]): void {
  console.log("index\tkey\towner faction\tsubculture");
  for (const row of rows) {
    console.log(`${row.regionIndex}\t${row.key}\t${row.ownerFaction ?? "-"}\t${row.subculture ?? "-"}`);
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const absolutePath = path.resolve(options.filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`ESF file not found: ${absolutePath}`);
  }

  const opened = openEsfBuffer(fs.readFileSync(absolutePath));
  const document = parseEsfDocument(opened.buffer);
  const { rows, source } = buildRegionRows(opened.buffer, options.includeNonRegion);

  if (rows.length === 0 || !source) {
    throw new Error(
      `No region records found in ${absolutePath}. Expected either a campaign map's ` +
        "map_data.esf (REGION_DATA/REGION_KEYS) or a startpos.esf (REGIONS_ARRAY)."
    );
  }

  const limited = rows.slice(0, options.limit);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          file: absolutePath,
          source,
          compressed: opened.wasCompressed,
          uncompressedSize: opened.uncompressedSize,
          header: document.header,
          totalRegions: rows.length,
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
    if (opened.wasCompressed) {
      console.log(`compressed: LZMA, ${opened.uncompressedSize} bytes decompressed`);
    }
    console.log(`source: ${source}`);
    console.log(`string table entries: ${document.stringTable.length}`);
    console.log(`regions: ${rows.length}`);
    console.log("");
    if (source === "map_data") {
      printMapDataRows(limited);
    } else {
      printStartposRows(limited);
    }
  }

  if (rows.length < options.assertMin) {
    throw new Error(`Expected at least ${options.assertMin} regions, found ${rows.length}.`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dumpRegions failed: ${message}`);
  process.exitCode = 1;
}
