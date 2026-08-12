import fs from "fs";
import path from "path";
import { extractMapPointsWithTheatreBounds, TheatreBounds } from "../extract/mapPoints";
import { extractRegionCenters } from "../extract/regionCenters";
import { extractRegionAreasGrid } from "../extract/regionAreas";
import { extractRegionPolygons } from "../extract/regionPolygons";
import { parsePathfindingRegionKeys } from "../extract/pathfindingRegions";
import { extractLookupGridFromTga } from "../extract/tgaLookup";
import { parseEsfDocument } from "../index";
import { requireInt, requireValue } from "./args";

type GridSourceMode = "auto" | "lookup" | "region-areas";

interface CliOptions {
  mapDataPath: string;
  lookupPath: string | null;
  pathfindingPath: string | null;
  sourceMode: GridSourceMode;
  outPath: string;
  width: number;
  includeNonRegion: boolean;
  flipY: boolean;
  minLoopArea: number;
  splitByMarkers: boolean | null;
  displayFlipY: boolean | null;
}

interface PointMarker {
  id: number;
  key: string;
  x: number;
  y: number;
  gx: number;
  gy: number;
  areaId: number;
  componentId: number;
}

interface PolygonGridInput {
  width: number;
  height: number;
  areaIds: Uint16Array;
  uniqueAreas: number;
  areaClassKeys: Uint32Array;
  areaClassCounts: Uint32Array;
  areaClassHex: string[];
}

function parseArgs(argv: string[]): CliOptions {
  let mapDataPath = process.env.ESF_FILE ?? "";
  let lookupPath: string | null = process.env.LOOKUP_FILE ?? null;
  let pathfindingPath: string | null = process.env.PATHFINDING_FILE ?? null;
  let sourceMode: GridSourceMode = "auto";
  let outPath = process.env.OUT_FILE ?? "map_regions.html";
  let width = 1500;
  let includeNonRegion = false;
  let flipY = false;
  let minLoopArea = 1;
  let splitByMarkers: boolean | null = null;
  let displayFlipY: boolean | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--file") {
      mapDataPath = requireValue("--file", next);
      index += 1;
      continue;
    }

    if (arg === "--lookup") {
      lookupPath = requireValue("--lookup", next);
      index += 1;
      continue;
    }

    if (arg === "--pathfinding") {
      pathfindingPath = requireValue("--pathfinding", next);
      index += 1;
      continue;
    }

    if (arg === "--out") {
      outPath = requireValue("--out", next);
      index += 1;
      continue;
    }

    if (arg === "--width") {
      width = requireInt("--width", next, 500);
      index += 1;
      continue;
    }

    if (arg === "--min-loop-area") {
      minLoopArea = requireInt("--min-loop-area", next, 0);
      index += 1;
      continue;
    }

    if (arg === "--include-nonregion") {
      includeNonRegion = true;
      continue;
    }

    if (arg === "--source") {
      const mode = requireValue("--source", next);
      if (mode !== "lookup" && mode !== "region-areas" && mode !== "auto") {
        throw new Error(`Invalid value for --source: ${mode}. Expected lookup, region-areas or auto.`);
      }
      sourceMode = mode;
      index += 1;
      continue;
    }

    if (arg === "--flip-y") {
      flipY = true;
      continue;
    }

    if (arg === "--split") {
      splitByMarkers = true;
      continue;
    }

    if (arg === "--no-split") {
      splitByMarkers = false;
      continue;
    }

    if (arg === "--display-flip-y") {
      displayFlipY = true;
      continue;
    }

    if (arg === "--display-no-flip-y") {
      displayFlipY = false;
      continue;
    }
  }

  if (!mapDataPath) {
    throw new Error("Missing required argument --file <path-to-map_data.esf> (or set ESF_FILE).");
  }

  return {
    mapDataPath: path.resolve(mapDataPath),
    lookupPath: lookupPath ? path.resolve(lookupPath) : null,
    pathfindingPath: pathfindingPath ? path.resolve(pathfindingPath) : null,
    sourceMode,
    outPath: path.resolve(outPath),
    width,
    includeNonRegion,
    flipY,
    minLoopArea,
    splitByMarkers,
    displayFlipY,
  };
}

function inferLookupCandidates(mapDataPath: string): string[] {
  const mapDir = path.dirname(mapDataPath);
  const mapDirName = path.basename(mapDir);
  const mapBase = mapDirName.replace(/_map_\d+$/i, "");
  const candidates: string[] = [];

  if (mapBase !== mapDirName) {
    candidates.push(path.join(mapDir, `${mapBase}_lookup_minimap.tga`));
    candidates.push(path.join(mapDir, `${mapBase}_lookup.tga`));
  }

  const entries = fs.readdirSync(mapDir);
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".tga")) {
      continue;
    }
    const lower = entry.toLowerCase();
    if (lower.includes("small_lookup")) {
      continue;
    }
    if (lower.endsWith("_lookup_minimap.tga")) {
      candidates.push(path.join(mapDir, entry));
    }
  }

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".tga")) {
      continue;
    }
    const lower = entry.toLowerCase();
    if (lower.includes("small_lookup")) {
      continue;
    }
    if (lower.endsWith("_lookup.tga")) {
      candidates.push(path.join(mapDir, entry));
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });
}

function resolveLookupPath(mapDataPath: string, explicitLookupPath: string | null): string | null {
  if (explicitLookupPath) {
    return explicitLookupPath;
  }

  const candidates = inferLookupCandidates(mapDataPath);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePathfindingPath(mapDataPath: string, explicitPathfindingPath: string | null): string | null {
  if (explicitPathfindingPath) {
    return explicitPathfindingPath;
  }

  const candidate = path.join(path.dirname(mapDataPath), "pathfinding.ppd");
  return fs.existsSync(candidate) ? candidate : null;
}

function colorFromIndex(index: number): [number, number, number] {
  let hash = index * 2654435761;
  hash ^= hash >>> 16;
  const hue = Math.abs(hash) % 360;
  const sat = 50 + (Math.abs(hash >>> 8) % 30);
  const light = 36 + (Math.abs(hash >>> 16) % 16);

  const h = hue / 360;
  const s = sat / 100;
  const l = light / 100;

  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (value: number): number => {
    let t = value;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  return [
    Math.round(hueToRgb(h + 1 / 3) * 255),
    Math.round(hueToRgb(h) * 255),
    Math.round(hueToRgb(h - 1 / 3) * 255),
  ];
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/**
 * Serialises the payload for embedding inside an inline `<script>` block. A raw
 * `JSON.stringify` is not safe there: a `</script>` sequence in a region key or
 * file path would close the block early, and U+2028/U+2029 are literal line
 * terminators in JS source.
 */
function toInlineScriptJson(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildMarkers(
  points: Array<{ id: number; key: string; x: number; y: number; gridSpace?: boolean }>,
  grid: { width: number; height: number; areaIds: Uint16Array },
  componentIds: Uint32Array,
  flipY: boolean
): PointMarker[] {
  if (points.length === 0) {
    return [];
  }

  const allGridSpace = points.every((point) => point.gridSpace === true);
  if (allGridSpace) {
    return points.map((point) => {
      const gx = Math.max(0, Math.min(grid.width - 1, Math.round(point.x)));
      const gy = Math.max(0, Math.min(grid.height - 1, Math.round(point.y)));
      const index = gy * grid.width + gx;
      const areaId = grid.areaIds[index];
      const componentId = componentIds[index];

      return {
        id: point.id,
        key: point.key,
        x: point.x,
        y: point.y,
        gx,
        gy,
        areaId,
        componentId,
      };
    });
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);

  return points.map((point) => {
    const normalizedX = (point.x - minX) / spanX;
    const normalizedY = (point.y - minY) / spanY;
    const gyNorm = flipY ? 1 - normalizedY : normalizedY;

    const gx = Math.max(0, Math.min(grid.width - 1, Math.round(normalizedX * (grid.width - 1))));
    const gy = Math.max(0, Math.min(grid.height - 1, Math.round(gyNorm * (grid.height - 1))));
    const index = gy * grid.width + gx;
    const areaId = grid.areaIds[index];
    const componentId = componentIds[index];

    return {
      id: point.id,
      key: point.key,
      x: point.x,
      y: point.y,
      gx,
      gy,
      areaId,
      componentId,
    };
  });
}

function buildLookupAreaPoints(
  grid: { width: number; height: number; areaIds: Uint16Array; areaClassCounts: Uint32Array },
  componentIds: Uint32Array,
  regionKeysByAreaId: string[] | null,
  includeNonRegion: boolean
): PointMarker[] {
  const areaCount = grid.areaClassCounts.length;
  const sumX = new Float64Array(areaCount);
  const sumY = new Float64Array(areaCount);
  const counts = new Uint32Array(areaCount);

  for (let index = 0; index < grid.areaIds.length; index += 1) {
    const areaId = grid.areaIds[index];
    if (areaId >= areaCount) {
      continue;
    }
    const gx = index % grid.width;
    const gy = Math.floor(index / grid.width);
    sumX[areaId] += gx;
    sumY[areaId] += gy;
    counts[areaId] += 1;
  }

  const centroidX = new Float64Array(areaCount);
  const centroidY = new Float64Array(areaCount);
  for (let areaId = 0; areaId < areaCount; areaId += 1) {
    if (counts[areaId] === 0) {
      continue;
    }
    centroidX[areaId] = sumX[areaId] / counts[areaId];
    centroidY[areaId] = sumY[areaId] / counts[areaId];
  }

  const bestIndex = new Int32Array(areaCount);
  bestIndex.fill(-1);
  const bestDistance = new Float64Array(areaCount);
  bestDistance.fill(Number.POSITIVE_INFINITY);

  for (let index = 0; index < grid.areaIds.length; index += 1) {
    const areaId = grid.areaIds[index];
    if (areaId >= areaCount || counts[areaId] === 0) {
      continue;
    }
    const gx = index % grid.width;
    const gy = Math.floor(index / grid.width);
    const dx = gx - centroidX[areaId];
    const dy = gy - centroidY[areaId];
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance[areaId]) {
      bestDistance[areaId] = distance;
      bestIndex[areaId] = index;
    }
  }

  const markers: PointMarker[] = [];
  for (let areaId = 0; areaId < areaCount; areaId += 1) {
    if (counts[areaId] === 0) {
      continue;
    }
    const index = bestIndex[areaId];
    if (index < 0) {
      continue;
    }

    const regionKey = regionKeysByAreaId?.[areaId] ?? `area_${areaId}`;
    if (!includeNonRegion && !/_region_/i.test(regionKey)) {
      continue;
    }

    const gx = index % grid.width;
    const gy = Math.floor(index / grid.width);
    markers.push({
      id: areaId,
      key: regionKey,
      x: gx,
      y: gy,
      gx,
      gy,
      areaId,
      componentId: componentIds[index],
    });
  }

  markers.sort((left, right) => left.id - right.id);
  return markers;
}

function buildLookupMarkersFromTheatrePoints(
  points: Array<{ id: number; key: string; x: number; y: number }>,
  theatreBounds: TheatreBounds,
  grid: { width: number; height: number; areaIds: Uint16Array },
  componentIds: Uint32Array
): PointMarker[] {
  const spanX = theatreBounds.maxX - theatreBounds.minX;
  const spanY = theatreBounds.maxY - theatreBounds.minY;
  if (spanX <= 0 || spanY <= 0) {
    return [];
  }

  return points
    .map((point) => {
      const normalizedX = (point.x - theatreBounds.minX) / spanX;
      const normalizedY = (point.y - theatreBounds.minY) / spanY;
      const gx = Math.max(0, Math.min(grid.width - 1, Math.round(normalizedX * (grid.width - 1))));
      const gy = Math.max(0, Math.min(grid.height - 1, Math.round((1 - normalizedY) * (grid.height - 1))));
      const index = gy * grid.width + gx;

      return {
        id: point.id,
        key: point.key,
        x: point.x,
        y: point.y,
        gx,
        gy,
        areaId: grid.areaIds[index],
        componentId: componentIds[index],
      };
    })
    .sort((left, right) => left.id - right.id);
}

function buildMarkerPartitionGrid(
  baseGrid: Pick<PolygonGridInput, "width" | "height">,
  componentIds: Uint32Array,
  markers: PointMarker[]
): PolygonGridInput {
  const width = baseGrid.width;
  const height = baseGrid.height;
  const totalCells = width * height;
  const unassignedAreaId = 0xffff;
  // Cells store the owning marker's index, so a marker index must never be able
  // to collide with the "unassigned" sentinel.
  if (markers.length >= unassignedAreaId) {
    throw new Error(
      `Too many markers to partition (${markers.length}); the limit is ${unassignedAreaId - 1}.`
    );
  }
  const areaIds = new Uint16Array(totalCells);
  areaIds.fill(unassignedAreaId);

  const markerIndicesByComponent = new Map<number, number[]>();
  markers.forEach((marker, markerIndex) => {
    if (marker.componentId === 0xffffffff) {
      return;
    }
    const existing = markerIndicesByComponent.get(marker.componentId);
    if (existing) {
      existing.push(markerIndex);
    } else {
      markerIndicesByComponent.set(marker.componentId, [markerIndex]);
    }
  });

  const activeComponents = new Set(markerIndicesByComponent.keys());
  const componentCellCounts = new Map<number, number>();

  for (let index = 0; index < totalCells; index += 1) {
    const componentId = componentIds[index];
    if (!activeComponents.has(componentId)) {
      continue;
    }
    componentCellCounts.set(componentId, (componentCellCounts.get(componentId) ?? 0) + 1);
  }

  const componentCells = new Map<number, Int32Array>();
  const componentWriteOffsets = new Map<number, number>();
  for (const [componentId, count] of componentCellCounts.entries()) {
    componentCells.set(componentId, new Int32Array(count));
    componentWriteOffsets.set(componentId, 0);
  }

  for (let index = 0; index < totalCells; index += 1) {
    const componentId = componentIds[index];
    const cells = componentCells.get(componentId);
    if (!cells) {
      continue;
    }
    const offset = componentWriteOffsets.get(componentId) ?? 0;
    cells[offset] = index;
    componentWriteOffsets.set(componentId, offset + 1);
  }

  for (const [componentId, markerIndices] of markerIndicesByComponent.entries()) {
    const cells = componentCells.get(componentId);
    if (!cells || cells.length === 0) {
      continue;
    }

    if (markerIndices.length === 1) {
      const markerIndex = markerIndices[0];
      for (let index = 0; index < cells.length; index += 1) {
        areaIds[cells[index]] = markerIndex;
      }
      continue;
    }

    const queue = new Int32Array(cells.length);
    let head = 0;
    let tail = 0;
    const fallbackMarkerIndex = markerIndices[0];

    for (const markerIndex of markerIndices) {
      const marker = markers[markerIndex];
      const seed = marker.gy * width + marker.gx;
      if (componentIds[seed] !== componentId || areaIds[seed] !== unassignedAreaId) {
        continue;
      }
      areaIds[seed] = markerIndex;
      queue[tail] = seed;
      tail += 1;
    }

    if (tail === 0) {
      const seed = cells[0];
      areaIds[seed] = fallbackMarkerIndex;
      queue[tail] = seed;
      tail += 1;
    }

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const owner = areaIds[index];
      const x = index % width;
      const y = Math.floor(index / width);

      const tryAssign = (nextIndex: number): void => {
        if (componentIds[nextIndex] !== componentId || areaIds[nextIndex] !== unassignedAreaId) {
          return;
        }
        areaIds[nextIndex] = owner;
        queue[tail] = nextIndex;
        tail += 1;
      };

      if (x > 0) {
        tryAssign(index - 1);
      }
      if (x < width - 1) {
        tryAssign(index + 1);
      }
      if (y > 0) {
        tryAssign(index - width);
      }
      if (y < height - 1) {
        tryAssign(index + width);
      }
    }

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (areaIds[cell] === unassignedAreaId) {
        areaIds[cell] = fallbackMarkerIndex;
      }
    }
  }

  const areaClassCounts = new Uint32Array(markers.length);
  for (let index = 0; index < areaIds.length; index += 1) {
    const areaId = areaIds[index];
    if (areaId === unassignedAreaId) {
      continue;
    }
    areaClassCounts[areaId] += 1;
  }

  return {
    width,
    height,
    areaIds,
    uniqueAreas: markers.length,
    areaClassKeys: Uint32Array.from(markers.map((marker) => marker.id)),
    areaClassCounts,
    areaClassHex: markers.map((marker) => marker.id.toString(16).padStart(4, "0")),
  };
}

function buildHtml(
  sourceFile: string,
  sourceLabel: string,
  grid: { width: number; height: number; areaIds: Uint16Array; uniqueAreas: number },
  polygonData: ReturnType<typeof extractRegionPolygons>,
  markers: PointMarker[],
  displayWidth: number,
  splitByMarkers: boolean,
  displayFlipY: boolean
): string {
  const displayHeight = Math.max(400, Math.round((displayWidth * grid.height) / grid.width));

  const payload = {
    sourceFile,
    sourceLabel,
    gridWidth: grid.width,
    gridHeight: grid.height,
    displayWidth,
    displayHeight,
    displayFlipY,
    splitByMarkers,
    uniqueAreas: grid.uniqueAreas,
    totalLoops: polygonData.totalLoops,
    totalVertices: polygonData.totalVertices,
    componentCount: polygonData.componentCount,
    componentIdsBase64: toBase64(
      new Uint8Array(
        polygonData.componentIds.buffer,
        polygonData.componentIds.byteOffset,
        polygonData.componentIds.byteLength
      )
    ),
    areas: polygonData.areas.map((area) => ({
      componentId: area.componentId,
      areaId: area.areaId,
      classKeyHex: area.classKeyHex,
      pixelCount: area.pixelCount,
      loops: area.loops,
      color: colorFromIndex(area.componentId),
    })),
    markers,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WH3 Region Polygon Viewer</title>
  <style>
    :root {
      --bg: #0f141b;
      --panel: #18212b;
      --text: #d2deee;
      --muted: #93a7bd;
      --line: #304052;
      --active: #4eb4ff;
    }
    body {
      margin: 0;
      background: radial-gradient(circle at 15% 10%, #1a2635, var(--bg) 50%);
      color: var(--text);
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    .layout {
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 14px;
      min-height: 100vh;
      padding: 14px;
      box-sizing: border-box;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      background: linear-gradient(180deg, #192430, var(--panel));
      box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35);
    }
    .meta {
      font-size: 13px;
      color: var(--muted);
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .canvasWrap {
      padding: 10px;
      background: #0f161e;
      overflow: auto;
      height: calc(100vh - 98px);
      box-sizing: border-box;
      cursor: grab;
    }
    .canvasWrap.panning {
      cursor: grabbing;
    }
    canvas {
      border: 1px solid #3f5167;
      border-radius: 8px;
      display: block;
      background: #000;
    }
    .side {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .section {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
      background: #202b37;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .controls button {
      border: 1px solid #42566c;
      background: #111922;
      color: var(--text);
      border-radius: 6px;
      font-size: 12px;
      padding: 5px 8px;
      cursor: pointer;
    }
    .controls button:hover {
      border-color: #5f7a95;
      background: #152334;
    }
    .zoomValue {
      color: #c5d6e8;
      min-width: 48px;
      text-align: right;
    }
    .search {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
    }
    .search input {
      width: 100%;
      box-sizing: border-box;
      border-radius: 8px;
      border: 1px solid #42566c;
      background: #111922;
      color: var(--text);
      padding: 9px 10px;
      font-size: 13px;
    }
    .list {
      overflow: auto;
      flex: 1;
      padding: 8px;
    }
    .item {
      border-radius: 8px;
      border: 1px solid transparent;
      padding: 7px 8px;
      margin-bottom: 5px;
      background: #121b25;
      color: #cdd9e8;
      font-size: 12px;
      line-height: 1.35;
      cursor: pointer;
    }
    .item:hover {
      border-color: #4a627b;
      background: #162334;
    }
    .item.active {
      border-color: var(--active);
      background: #18354f;
    }
    .area {
      color: #86b9e8;
      margin-right: 8px;
    }
    .tooltip {
      position: fixed;
      pointer-events: none;
      z-index: 30;
      opacity: 0;
      transition: opacity 80ms ease;
      background: rgba(7, 11, 17, 0.95);
      border: 1px solid #3a5168;
      border-radius: 6px;
      color: #e0ebf8;
      font-size: 12px;
      padding: 6px 8px;
      max-width: 460px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .canvasWrap {
        height: 60vh;
      }
      .side {
        min-height: 320px;
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <div class="panel">
      <div class="meta" id="meta"></div>
      <div class="canvasWrap">
        <canvas id="mapCanvas"></canvas>
      </div>
    </div>
    <div class="panel side">
      <div class="section" id="summary"></div>
      <div class="section controls">
        <button id="zoomOut" type="button">-</button>
        <button id="zoomReset" type="button">100%</button>
        <button id="zoomIn" type="button">+</button>
        <span id="zoomValue" class="zoomValue"></span>
      </div>
      <div class="search">
        <input id="searchInput" placeholder="Filter point labels...">
      </div>
      <div id="markerList" class="list"></div>
    </div>
  </div>
  <div id="tooltip" class="tooltip"></div>
  <script>
    const data = ${toInlineScriptJson(payload)};
    const canvas = document.getElementById("mapCanvas");
    const context = canvas.getContext("2d");
    const tooltip = document.getElementById("tooltip");
    const meta = document.getElementById("meta");
    const summary = document.getElementById("summary");
    const zoomOut = document.getElementById("zoomOut");
    const zoomIn = document.getElementById("zoomIn");
    const zoomReset = document.getElementById("zoomReset");
    const zoomValue = document.getElementById("zoomValue");
    const markerList = document.getElementById("markerList");
    const searchInput = document.getElementById("searchInput");
    const canvasWrap = document.querySelector(".canvasWrap");
    const componentIds = decodeU32Array(data.componentIdsBase64);
    const displayFlipY = data.displayFlipY === true;

    const areaByComponentId = new Map();
    for (const area of data.areas) {
      areaByComponentId.set(area.componentId, area);
    }

    meta.textContent = "source: " + data.sourceFile;
    summary.textContent =
      data.sourceLabel + " cells: " + data.gridWidth + "x" + data.gridHeight +
      " | areas: " + data.uniqueAreas +
      " | split: " + (data.splitByMarkers ? "marker partition" : "raw") +
      " | components: " + data.componentCount +
      " | polygon loops: " + data.totalLoops +
      " | polygon vertices: " + data.totalVertices +
      " | markers: " + data.markers.length;

    canvas.width = data.gridWidth;
    canvas.height = data.gridHeight;

    let filteredMarkers = data.markers.slice();
    let selectedMarkerId = null;
    let selectedComponentId = null;
    let zoom = 1;
    const minZoom = 0.5;
    const maxZoom = 6;
    let isPanning = false;
    let didDragPan = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function displayYFromCellY(gy) {
      return displayFlipY ? (data.gridHeight - 1 - gy) : gy;
    }

    function displayYFromVertexY(y) {
      return displayFlipY ? (data.gridHeight - y) : y;
    }

    function applyZoom(nextZoom, anchorClientX, anchorClientY) {
      const clampedZoom = clamp(nextZoom, minZoom, maxZoom);
      const previousWidth = canvas.clientWidth || data.displayWidth * zoom;
      const previousHeight = canvas.clientHeight || data.displayHeight * zoom;
      const wrapRect = canvasWrap.getBoundingClientRect();
      const anchorX = anchorClientX === undefined ? wrapRect.left + canvasWrap.clientWidth / 2 : anchorClientX;
      const anchorY = anchorClientY === undefined ? wrapRect.top + canvasWrap.clientHeight / 2 : anchorClientY;
      const offsetX = anchorX - wrapRect.left;
      const offsetY = anchorY - wrapRect.top;
      const worldX = (canvasWrap.scrollLeft + offsetX) / Math.max(previousWidth, 1);
      const worldY = (canvasWrap.scrollTop + offsetY) / Math.max(previousHeight, 1);

      zoom = clampedZoom;
      canvas.style.width = (data.displayWidth * zoom) + "px";
      canvas.style.height = (data.displayHeight * zoom) + "px";
      zoomValue.textContent = Math.round(zoom * 100) + "%";

      const nextWidth = canvas.clientWidth || data.displayWidth * zoom;
      const nextHeight = canvas.clientHeight || data.displayHeight * zoom;
      canvasWrap.scrollLeft = worldX * nextWidth - offsetX;
      canvasWrap.scrollTop = worldY * nextHeight - offsetY;
    }

    applyZoom(1);
    drawMap();
    renderMarkerList();

    searchInput.addEventListener("input", () => {
      const filter = searchInput.value.trim().toLowerCase();
      filteredMarkers = data.markers.filter((marker) => marker.key.toLowerCase().includes(filter));
      renderMarkerList();
    });

    canvas.addEventListener("mousemove", (event) => {
      const { gx, gy } = toGridPosition(event);
      const componentId = componentIds[gy * data.gridWidth + gx];
      const marker = nearestMarker(gx, gy);
      const area = areaByComponentId.get(componentId);
      const areaText = area
        ? "component " + componentId + " | area " + area.areaId + " | class " + area.classKeyHex + " | pixels " + area.pixelCount
        : "component " + componentId;

      tooltip.style.opacity = "1";
      tooltip.style.left = (event.clientX + 12) + "px";
      tooltip.style.top = (event.clientY + 12) + "px";
      tooltip.textContent = marker
        ? areaText + " | " + marker.key + " (" + marker.id + ")"
        : areaText + " | cell " + gx + "," + gy;
    });

    canvas.addEventListener("mouseleave", () => {
      tooltip.style.opacity = "0";
    });

    canvas.addEventListener("click", (event) => {
      if (didDragPan) {
        didDragPan = false;
        return;
      }
      const { gx, gy } = toGridPosition(event);
      selectedComponentId = componentIds[gy * data.gridWidth + gx];
      const marker = nearestMarker(gx, gy);
      selectedMarkerId = marker ? marker.id : null;
      renderMarkerList();
      drawMap();
    });

    canvasWrap.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }
      isPanning = true;
      didDragPan = false;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panStartScrollLeft = canvasWrap.scrollLeft;
      panStartScrollTop = canvasWrap.scrollTop;
      canvasWrap.classList.add("panning");
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!isPanning) {
        return;
      }
      const deltaX = event.clientX - panStartX;
      const deltaY = event.clientY - panStartY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        didDragPan = true;
      }
      canvasWrap.scrollLeft = panStartScrollLeft - deltaX;
      canvasWrap.scrollTop = panStartScrollTop - deltaY;
    });

    window.addEventListener("mouseup", () => {
      if (!isPanning) {
        return;
      }
      isPanning = false;
      canvasWrap.classList.remove("panning");
    });

    canvasWrap.addEventListener("wheel", (event) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      applyZoom(zoom * factor, event.clientX, event.clientY);
    }, { passive: false });

    zoomOut.addEventListener("click", () => applyZoom(zoom / 1.2));
    zoomIn.addEventListener("click", () => applyZoom(zoom * 1.2));
    zoomReset.addEventListener("click", () => applyZoom(1));

    function decodeU8Array(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    function decodeU32Array(base64) {
      const bytes = decodeU8Array(base64);
      if (bytes.byteLength % 4 !== 0) {
        throw new Error("Corrupt component id payload: " + bytes.byteLength + " bytes is not a multiple of 4.");
      }
      return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    }

    function drawMap() {
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const area of data.areas) {
        context.beginPath();
        for (const loop of area.loops) {
          if (!loop || loop.length < 6) {
            continue;
          }
          context.moveTo(loop[0], displayYFromVertexY(loop[1]));
          for (let index = 2; index < loop.length; index += 2) {
            context.lineTo(loop[index], displayYFromVertexY(loop[index + 1]));
          }
          context.closePath();
        }

        const color = area.color;
        context.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
        context.fill("evenodd");
      }

      if (selectedComponentId !== null) {
        const selectedArea = areaByComponentId.get(selectedComponentId);
        if (selectedArea) {
          context.beginPath();
          for (const loop of selectedArea.loops) {
            if (!loop || loop.length < 6) {
              continue;
            }
            context.moveTo(loop[0], displayYFromVertexY(loop[1]));
            for (let index = 2; index < loop.length; index += 2) {
              context.lineTo(loop[index], displayYFromVertexY(loop[index + 1]));
            }
            context.closePath();
          }
          context.fillStyle = "rgba(255,255,255,0.2)";
          context.strokeStyle = "rgba(255,255,255,0.95)";
          context.lineWidth = 1.2;
          context.fill("evenodd");
          context.stroke();
        }
      }

      context.save();
      context.fillStyle = "rgba(255,255,255,0.92)";
      for (const marker of data.markers) {
        const drawY = displayYFromCellY(marker.gy);
        context.fillRect(marker.gx - 1, drawY - 1, 2, 2);
      }
      context.restore();

      if (selectedMarkerId !== null) {
        const marker = data.markers.find((entry) => entry.id === selectedMarkerId);
        if (marker) {
          const drawY = displayYFromCellY(marker.gy);
          context.save();
          context.strokeStyle = "#ffffff";
          context.lineWidth = 2;
          context.beginPath();
          context.arc(marker.gx, drawY, 5, 0, Math.PI * 2);
          context.stroke();
          context.restore();
        }
      }
    }

    function toGridPosition(event) {
      const rect = canvas.getBoundingClientRect();
      const gx = Math.max(0, Math.min(data.gridWidth - 1, Math.floor((event.clientX - rect.left) * data.gridWidth / rect.width)));
      const rawY = Math.max(0, Math.min(data.gridHeight - 1, Math.floor((event.clientY - rect.top) * data.gridHeight / rect.height)));
      const gy = displayFlipY ? (data.gridHeight - 1 - rawY) : rawY;
      return { gx, gy };
    }

    function nearestMarker(gx, gy) {
      let best = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const marker of data.markers) {
        const dx = marker.gx - gx;
        const dy = marker.gy - gy;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = marker;
        }
      }
      return bestDistance <= 64 ? best : null;
    }

    function renderMarkerList() {
      markerList.innerHTML = "";
      for (const marker of filteredMarkers) {
        const item = document.createElement("div");
        item.className = "item" + (selectedMarkerId === marker.id ? " active" : "");
        const areaLabel = document.createElement("span");
        areaLabel.className = "area";
        areaLabel.textContent = "area " + marker.areaId + " / part " + marker.componentId;
        item.appendChild(areaLabel);
        item.appendChild(document.createTextNode(marker.key));
        item.addEventListener("click", () => {
          selectedMarkerId = marker.id;
          selectedComponentId = marker.componentId;
          renderMarkerList();
          drawMap();
        });
        markerList.appendChild(item);
      }
    }
  </script>
</body>
</html>`;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(options.mapDataPath)) {
    throw new Error(`ESF file not found: ${options.mapDataPath}`);
  }

  const buffer = fs.readFileSync(options.mapDataPath);
  const document = parseEsfDocument(buffer);
  const centerPoints = extractRegionCenters(buffer, document, {
    includeNonRegion: options.includeNonRegion,
  });
  const keyPointData = extractMapPointsWithTheatreBounds(buffer, document, {
    includeNonRegion: options.includeNonRegion,
  });
  const keyPoints = keyPointData.points;
  let points: Array<{ id: number; key: string; x: number; y: number; gridSpace?: boolean }> =
    centerPoints.length > 0 ? centerPoints : keyPoints;

  const resolvedLookupPath = resolveLookupPath(options.mapDataPath, options.lookupPath);
  if (options.sourceMode === "lookup" && !resolvedLookupPath) {
    throw new Error(
      "Lookup source requested but no lookup TGA file was found. Pass --lookup <path-to-*_lookup_minimap.tga>."
    );
  }

  let sourceKind: "lookup" | "region-areas" = "region-areas";
  let sourceLabel = "REGION_AREAS";
  let sourcePath = options.mapDataPath;
  let sourceGrid: PolygonGridInput;
  let resolvedPathfindingPath: string | null = null;
  let pathfindingRegionCount: number | null = null;

  if (options.sourceMode !== "region-areas" && resolvedLookupPath) {
    sourceKind = "lookup";
    sourceLabel = "LOOKUP_TGA";
    sourcePath = resolvedLookupPath;
    sourceGrid = extractLookupGridFromTga(fs.readFileSync(resolvedLookupPath));

    if (keyPoints.length > 0) {
      points = keyPoints;
    } else {
      points = centerPoints.filter((point) => {
        const regionId = point.id;
        return (
          Number.isInteger(regionId) &&
          regionId >= 0 &&
          regionId < sourceGrid.areaClassCounts.length &&
          sourceGrid.areaClassCounts[regionId] > 0
        );
      });
    }
  } else {
    sourceGrid = extractRegionAreasGrid(buffer);
  }

  const sourcePolygons = extractRegionPolygons(sourceGrid, { minLoopArea: options.minLoopArea });
  let sourceMarkers: PointMarker[];
  if (sourceKind === "lookup") {
    const theatreMarkers =
      keyPoints.length > 0 && keyPointData.theatreBounds
        ? buildLookupMarkersFromTheatrePoints(
            keyPoints,
            keyPointData.theatreBounds,
            sourceGrid,
            sourcePolygons.componentIds
          )
        : [];

    if (theatreMarkers.length > 0) {
      sourceMarkers = theatreMarkers;
    } else {
      resolvedPathfindingPath = resolvePathfindingPath(options.mapDataPath, options.pathfindingPath);
      let regionKeysByAreaId: string[] | null = null;
      if (resolvedPathfindingPath) {
        const parsedPathfinding = parsePathfindingRegionKeys(fs.readFileSync(resolvedPathfindingPath));
        regionKeysByAreaId = parsedPathfinding.regionKeys;
        pathfindingRegionCount = parsedPathfinding.regionKeys.length;
      }
      sourceMarkers = buildLookupAreaPoints(
        sourceGrid,
        sourcePolygons.componentIds,
        regionKeysByAreaId,
        options.includeNonRegion
      );
    }
  } else {
    sourceMarkers = buildMarkers(points, sourceGrid, sourcePolygons.componentIds, options.flipY);
  }

  const splitRequested = options.splitByMarkers ?? sourceKind === "region-areas";
  const displayFlipY = options.displayFlipY ?? sourceKind === "region-areas";

  let renderGrid: PolygonGridInput = sourceGrid;
  let polygons = sourcePolygons;
  let markers = sourceMarkers;
  let splitApplied = false;

  if (splitRequested && sourceMarkers.length > 0) {
    const markerGrid = buildMarkerPartitionGrid(sourceGrid, sourcePolygons.componentIds, sourceMarkers);
    const markerPolygons = extractRegionPolygons(markerGrid, {
      minLoopArea: options.minLoopArea,
      ignoreAreaId: 0xffff,
    });
    const markerMarkers =
      sourceKind === "lookup"
        ? buildLookupAreaPoints(markerGrid, markerPolygons.componentIds, null, options.includeNonRegion)
        : buildMarkers(points, markerGrid, markerPolygons.componentIds, options.flipY);

    if (markerPolygons.areas.length > 0) {
      renderGrid = markerGrid;
      polygons = markerPolygons;
      markers = markerMarkers;
      splitApplied = true;
    }
  }

  const html = buildHtml(
    sourcePath,
    sourceLabel,
    renderGrid,
    polygons,
    markers,
    options.width,
    splitApplied,
    displayFlipY
  );

  fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
  fs.writeFileSync(options.outPath, html, "utf8");

  console.log(`Wrote ${options.outPath}`);
  console.log(`mapData=${options.mapDataPath}`);
  console.log(`gridSource=${sourceKind}`);
  if (sourceKind === "lookup" && resolvedLookupPath) {
    console.log(`lookupFile=${resolvedLookupPath}`);
  }
  if (sourceKind === "lookup" && resolvedPathfindingPath) {
    console.log(`pathfindingFile=${resolvedPathfindingPath}`);
  }
  if (sourceKind === "lookup" && keyPointData.theatreBounds) {
    console.log(
      `theatreBounds=${keyPointData.theatreBounds.minX.toFixed(3)},${keyPointData.theatreBounds.minY.toFixed(
        3
      )} -> ${keyPointData.theatreBounds.maxX.toFixed(3)},${keyPointData.theatreBounds.maxY.toFixed(3)}`
    );
  }
  if (sourceKind === "lookup" && pathfindingRegionCount !== null) {
    console.log(`pathfindingRegions=${pathfindingRegionCount}`);
  }
  console.log(`codec=0x${document.header.codecId.toString(16).padStart(8, "0")}`);
  console.log(`grid=${renderGrid.width}x${renderGrid.height}`);
  console.log(`uniqueAreas=${renderGrid.uniqueAreas}`);
  console.log(`displayFlipY=${displayFlipY}`);
  console.log(`splitRequested=${splitRequested}`);
  console.log(`splitByMarkers=${splitApplied}`);
  console.log(`components=${polygons.componentCount}`);
  console.log(`polygonLoops=${polygons.totalLoops}`);
  console.log(`polygonVertices=${polygons.totalVertices}`);
  console.log(`markers=${markers.length}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`renderRegionMap failed: ${message}`);
  process.exitCode = 1;
}
