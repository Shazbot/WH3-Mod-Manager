import fs from "fs";
import path from "path";
import {
  extractMapPointsWithTheatreBounds,
  extractRegionCenters,
  extractStartposRegions,
  openEsfBuffer,
  parseEsfDocument,
} from "../index";

function resolveFilePath(): string {
  const selected = process.argv[2] || process.env.ESF_FILE;
  if (!selected) {
    throw new Error("Missing ESF path. Pass a map_data.esf or startpos.esf as the first argument, or set ESF_FILE.");
  }
  return path.resolve(selected);
}

function checkMapData(buffer: Buffer, document: ReturnType<typeof parseEsfDocument>): boolean {
  const centers = extractRegionCenters(buffer, document);
  if (centers.length < 1) {
    return false;
  }

  if (!centers.every((region) => /_region_/i.test(region.key))) {
    throw new Error("Region extraction returned keys that do not look like region keys.");
  }

  const keyPointData = extractMapPointsWithTheatreBounds(buffer, document);
  const keyPoints = keyPointData.points;

  // REGION_KEYS only covers regions shown in a UI theatre, so it is expected to
  // be a subset of REGION_DATA rather than an exact match.
  const centerKeys = new Set(centers.map((region) => region.key));
  const orphans = keyPoints.filter((point) => !centerKeys.has(point.key));
  if (orphans.length > 0) {
    throw new Error(
      `REGION_KEYS contained ${orphans.length} keys missing from REGION_DATA, e.g. ${orphans[0].key}.`
    );
  }

  console.log(`source=map_data`);
  console.log(`regionCentres=${centers.length}`);
  console.log(`regionKeyPoints=${keyPoints.length}`);
  console.log(`theatreBounds=${keyPointData.theatreBounds ? "yes" : "no"}`);
  console.log("sample:");
  for (const region of centers.slice(0, 20)) {
    console.log(`${region.id}\t${region.x},${region.y}\t${region.key}`);
  }

  return true;
}

function checkStartpos(buffer: Buffer, document: ReturnType<typeof parseEsfDocument>): boolean {
  const regions = extractStartposRegions(buffer, document);
  if (regions.length < 1) {
    return false;
  }

  if (!regions.every((region) => /_region_/i.test(region.key))) {
    throw new Error("Startpos extraction returned keys that do not look like region keys.");
  }

  const indices = regions.map((region) => region.regionIndex);
  if (new Set(indices).size !== indices.length) {
    throw new Error("Startpos region indices are not unique.");
  }

  const withoutOwner = regions.filter((region) => !region.ownerFaction);
  if (withoutOwner.length > 0) {
    throw new Error(
      `${withoutOwner.length} startpos regions had no owning faction, e.g. ${withoutOwner[0].key}.`
    );
  }

  console.log(`source=startpos`);
  console.log(`regions=${regions.length}`);
  console.log(`owningFactions=${new Set(regions.map((region) => region.ownerFaction)).size}`);
  console.log(`subcultures=${new Set(regions.map((region) => region.subculture)).size}`);
  console.log("sample:");
  for (const region of regions.slice(0, 20)) {
    console.log(`${region.regionIndex}\t${region.key}\t${region.ownerFaction}`);
  }

  return true;
}

function main(): void {
  const filePath = resolveFilePath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`ESF file does not exist: ${filePath}`);
  }

  const opened = openEsfBuffer(fs.readFileSync(filePath));
  const document = parseEsfDocument(opened.buffer);

  console.log(`PASS: parsed ${filePath}`);
  console.log(`codec=0x${document.header.codecId.toString(16).padStart(8, "0")}`);
  if (opened.wasCompressed) {
    console.log(`compressed=lzma decompressedBytes=${opened.uncompressedSize}`);
  }
  console.log(`stringTable=${document.stringTable.length}`);

  if (checkMapData(opened.buffer, document)) {
    return;
  }

  if (checkStartpos(opened.buffer, document)) {
    return;
  }

  throw new Error(
    "No region records extracted. Expected a campaign map's map_data.esf (REGION_DATA/REGION_KEYS) " +
      "or a startpos.esf (REGIONS_ARRAY)."
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`testReadRegions failed: ${message}`);
  process.exitCode = 1;
}
