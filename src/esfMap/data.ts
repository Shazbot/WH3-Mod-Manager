import {
  extractRegionAreasGrid,
  extractRegionCenters,
  extractRegionPolygons,
  extractStartposRegions,
  openEsfBuffer,
  parseEsfDocument,
  type RegionAreasGrid,
  type RegionPolygonArea,
  type StartposRegion,
} from "../../tools/esf/src";
import type { EsfMapArea, EsfMapBasePayload, EsfMapColour, EsfMapMarker } from "./types";

interface PolygonGridInput {
  width: number;
  height: number;
  areaIds: Uint16Array;
  uniqueAreas: number;
  areaClassKeys: Uint32Array;
  areaClassCounts: Uint32Array;
  areaClassHex: string[];
}

interface BaseMarker {
  id: number;
  regionIndex: number;
  key: string;
  gx: number;
  gy: number;
  componentId: number;
  ownership: StartposRegion | undefined;
}

const UNASSIGNED_AREA_ID = 0xffff;

function clampGridCoordinate(value: number, limit: number): number {
  return Math.max(0, Math.min(limit - 1, Math.round(value)));
}

function buildMarkerPartitionGrid(
  baseGrid: Pick<PolygonGridInput, "width" | "height">,
  componentIds: Uint32Array,
  markers: BaseMarker[],
): PolygonGridInput {
  const width = baseGrid.width;
  const height = baseGrid.height;
  const totalCells = width * height;
  if (markers.length >= UNASSIGNED_AREA_ID) {
    throw new Error(`Too many map regions to render (${markers.length}).`);
  }

  const areaIds = new Uint16Array(totalCells);
  areaIds.fill(UNASSIGNED_AREA_ID);

  const markerIndicesByComponent = new Map<number, number[]>();
  markers.forEach((marker, markerIndex) => {
    if (marker.componentId === 0xffffffff) return;
    const existing = markerIndicesByComponent.get(marker.componentId);
    if (existing) existing.push(markerIndex);
    else markerIndicesByComponent.set(marker.componentId, [markerIndex]);
  });

  const activeComponents = new Set(markerIndicesByComponent.keys());
  const componentCellCounts = new Map<number, number>();
  for (let index = 0; index < totalCells; index += 1) {
    const componentId = componentIds[index];
    if (activeComponents.has(componentId)) {
      componentCellCounts.set(componentId, (componentCellCounts.get(componentId) ?? 0) + 1);
    }
  }

  const componentCells = new Map<number, Int32Array>();
  const componentWriteOffsets = new Map<number, number>();
  for (const [componentId, count] of componentCellCounts) {
    componentCells.set(componentId, new Int32Array(count));
    componentWriteOffsets.set(componentId, 0);
  }

  for (let index = 0; index < totalCells; index += 1) {
    const componentId = componentIds[index];
    const cells = componentCells.get(componentId);
    if (!cells) continue;
    const offset = componentWriteOffsets.get(componentId) ?? 0;
    cells[offset] = index;
    componentWriteOffsets.set(componentId, offset + 1);
  }

  for (const [componentId, markerIndices] of markerIndicesByComponent) {
    const cells = componentCells.get(componentId);
    if (!cells || cells.length === 0) continue;

    if (markerIndices.length === 1) {
      const markerIndex = markerIndices[0];
      for (const cell of cells) areaIds[cell] = markerIndex;
      continue;
    }

    const queue = new Int32Array(cells.length);
    let head = 0;
    let tail = 0;
    const fallbackMarkerIndex = markerIndices[0];

    for (const markerIndex of markerIndices) {
      const marker = markers[markerIndex];
      const seed = marker.gy * width + marker.gx;
      if (componentIds[seed] !== componentId || areaIds[seed] !== UNASSIGNED_AREA_ID) continue;
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

      const tryAssign = (nextIndex: number) => {
        if (componentIds[nextIndex] !== componentId || areaIds[nextIndex] !== UNASSIGNED_AREA_ID) return;
        areaIds[nextIndex] = owner;
        queue[tail] = nextIndex;
        tail += 1;
      };

      if (x > 0) tryAssign(index - 1);
      if (x < width - 1) tryAssign(index + 1);
      if (y > 0) tryAssign(index - width);
      if (y < height - 1) tryAssign(index + width);
    }

    for (const cell of cells) {
      if (areaIds[cell] === UNASSIGNED_AREA_ID) areaIds[cell] = fallbackMarkerIndex;
    }
  }

  const areaClassCounts = new Uint32Array(markers.length);
  for (const areaId of areaIds) {
    if (areaId !== UNASSIGNED_AREA_ID) areaClassCounts[areaId] += 1;
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

function hashText(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function colourFromText(text: string): EsfMapColour {
  const hash = hashText(text);
  const hue = (hash % 360) / 360;
  const saturation = 0.52 + ((hash >>> 8) % 20) / 100;
  const lightness = 0.38 + ((hash >>> 16) % 12) / 100;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const hueToRgb = (input: number): number => {
    let value = input;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [
    Math.round(hueToRgb(hue + 1 / 3) * 255),
    Math.round(hueToRgb(hue) * 255),
    Math.round(hueToRgb(hue - 1 / 3) * 255),
  ];
}

function colourFromComponent(componentId: number): EsfMapColour {
  const hash = Math.imul(componentId + 1, 2654435761) >>> 0;
  return [54 + ((hash >>> 16) % 36), 68 + ((hash >>> 8) % 38), 82 + (hash % 42)];
}

function colourForMarker(marker: BaseMarker): EsfMapColour {
  return marker.ownership?.ownerFaction
    ? colourFromText(marker.ownership.ownerFaction)
    : colourFromComponent(marker.id);
}

function mapArea(area: RegionPolygonArea, markers: BaseMarker[]): EsfMapArea {
  const marker = area.areaId < markers.length ? markers[area.areaId] : undefined;
  return {
    componentId: area.componentId,
    areaId: area.areaId,
    pixelCount: area.pixelCount,
    loops: area.loops,
    colour: marker ? colourForMarker(marker) : [32, 45, 58],
    regionKey: marker?.key,
    ownerFaction: marker?.ownership?.ownerFaction ?? null,
  };
}

function parseOwnership(startposBuffer: Buffer | undefined): {
  regions: StartposRegion[];
  wasCompressed: boolean;
} {
  if (!startposBuffer) return { regions: [], wasCompressed: false };
  const opened = openEsfBuffer(startposBuffer);
  const document = parseEsfDocument(opened.buffer);
  return {
    regions: extractStartposRegions(opened.buffer, document),
    wasCompressed: opened.wasCompressed,
  };
}

export function buildEsfMapData(
  mapDataBuffer: Buffer,
  startposBuffer: Buffer | undefined,
  paths: { mapDataPath: string; startposPath: string },
): EsfMapBasePayload {
  const mapOpened = openEsfBuffer(mapDataBuffer);
  const mapDocument = parseEsfDocument(mapOpened.buffer);
  const grid: RegionAreasGrid = extractRegionAreasGrid(mapOpened.buffer);
  const centers = extractRegionCenters(mapOpened.buffer, mapDocument);
  if (centers.length === 0) {
    throw new Error("The campaign map has no REGION_DATA region centres.");
  }

  const ownershipData = parseOwnership(startposBuffer);
  const ownershipByKey = new Map(ownershipData.regions.map((region) => [region.key.toLowerCase(), region]));
  const sourcePolygons = extractRegionPolygons(grid, { minLoopArea: 1 });
  const baseMarkers: BaseMarker[] = centers.map((center) => {
    const gx = clampGridCoordinate(center.x, grid.width);
    const gy = clampGridCoordinate(center.y, grid.height);
    const index = gy * grid.width + gx;
    return {
      id: center.id,
      regionIndex: center.id,
      key: center.key,
      gx,
      gy,
      componentId: sourcePolygons.componentIds[index],
      ownership: ownershipByKey.get(center.key.toLowerCase()),
    };
  });

  const renderGrid = buildMarkerPartitionGrid(grid, sourcePolygons.componentIds, baseMarkers);
  const polygons = extractRegionPolygons(renderGrid, { minLoopArea: 1 });
  const markers: EsfMapMarker[] = baseMarkers.map((marker) => {
    const index = marker.gy * renderGrid.width + marker.gx;
    return {
      id: marker.id,
      regionIndex: marker.regionIndex,
      key: marker.key,
      gx: marker.gx,
      gy: marker.gy,
      areaId: renderGrid.areaIds[index],
      componentId: polygons.componentIds[index],
      ownerFaction: marker.ownership?.ownerFaction ?? null,
      subculture: marker.ownership?.subculture ?? null,
      settlementKey: marker.ownership?.settlementKey ?? null,
    };
  });

  return {
    mapDataPath: paths.mapDataPath,
    startposPath: paths.startposPath,
    startposWasCompressed: ownershipData.wasCompressed,
    width: renderGrid.width,
    height: renderGrid.height,
    areas: polygons.areas.map((area) => mapArea(area, baseMarkers)),
    markers,
    componentCount: polygons.componentCount,
    totalLoops: polygons.totalLoops,
    totalVertices: polygons.totalVertices,
    regionCount: markers.length,
    ownedRegionCount: markers.filter((marker) => marker.ownerFaction !== null).length,
  };
}
