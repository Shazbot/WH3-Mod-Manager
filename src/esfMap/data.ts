import {
  extractLookupGridFromTga,
  extractMapPointsWithTheatreBounds,
  extractRegionAreasGrid,
  extractRegionCenters,
  extractRegionPolygons,
  extractStartposRegions,
  openEsfBuffer,
  parsePathfindingRegionKeys,
  parseEsfDocument,
  type MapPoint,
  type RegionAreasGrid,
  type RegionPolygonArea,
  type StartposRegion,
  type TgaLookupGrid,
  type TheatreBounds,
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

function colourFromComponent(index: number): EsfMapColour {
  let hash = index * 2654435761;
  hash ^= hash >>> 16;
  const hue = Math.abs(hash) % 360;
  const saturation = 0.5 + (Math.abs(hash >>> 8) % 30) / 100;
  const lightness = 0.36 + (Math.abs(hash >>> 16) % 16) / 100;
  const h = hue / 360;
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
  return [Math.round(hueToRgb(h + 1 / 3) * 255), Math.round(hueToRgb(h) * 255), Math.round(hueToRgb(h - 1 / 3) * 255)];
}

function buildLookupMarkersFromTheatrePoints(
  points: MapPoint[],
  theatreBounds: TheatreBounds,
  grid: PolygonGridInput,
  componentIds: Uint32Array,
  ownershipByKey: Map<string, StartposRegion>,
): BaseMarker[] {
  const spanX = theatreBounds.maxX - theatreBounds.minX;
  const spanY = theatreBounds.maxY - theatreBounds.minY;
  if (spanX <= 0 || spanY <= 0) return [];

  return points
    .map((point) => {
      const normalizedX = (point.x - theatreBounds.minX) / spanX;
      const normalizedY = (point.y - theatreBounds.minY) / spanY;
      const gx = clampGridCoordinate(normalizedX * (grid.width - 1), grid.width);
      const gy = clampGridCoordinate((1 - normalizedY) * (grid.height - 1), grid.height);
      const index = gy * grid.width + gx;
      return {
        id: point.id,
        regionIndex: point.id,
        key: point.key,
        gx,
        gy,
        componentId: componentIds[index],
        ownership: ownershipByKey.get(point.key.toLowerCase()),
      };
    })
    .sort((first, second) => first.id - second.id);
}

function buildLookupAreaPoints(
  grid: PolygonGridInput,
  componentIds: Uint32Array,
  regionKeysByAreaId: string[] | undefined,
  ownershipByKey: Map<string, StartposRegion>,
): BaseMarker[] {
  const areaCount = grid.areaClassCounts.length;
  const sumX = new Float64Array(areaCount);
  const sumY = new Float64Array(areaCount);
  const counts = new Uint32Array(areaCount);

  for (let index = 0; index < grid.areaIds.length; index += 1) {
    const areaId = grid.areaIds[index];
    if (areaId >= areaCount) continue;
    sumX[areaId] += index % grid.width;
    sumY[areaId] += Math.floor(index / grid.width);
    counts[areaId] += 1;
  }

  const centroidX = new Float64Array(areaCount);
  const centroidY = new Float64Array(areaCount);
  for (let areaId = 0; areaId < areaCount; areaId += 1) {
    if (counts[areaId] === 0) continue;
    centroidX[areaId] = sumX[areaId] / counts[areaId];
    centroidY[areaId] = sumY[areaId] / counts[areaId];
  }

  const bestIndex = new Int32Array(areaCount);
  bestIndex.fill(-1);
  const bestDistance = new Float64Array(areaCount);
  bestDistance.fill(Number.POSITIVE_INFINITY);
  for (let index = 0; index < grid.areaIds.length; index += 1) {
    const areaId = grid.areaIds[index];
    if (areaId >= areaCount || counts[areaId] === 0) continue;
    const dx = (index % grid.width) - centroidX[areaId];
    const dy = Math.floor(index / grid.width) - centroidY[areaId];
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance[areaId]) {
      bestDistance[areaId] = distance;
      bestIndex[areaId] = index;
    }
  }

  const markers: BaseMarker[] = [];
  for (let areaId = 0; areaId < areaCount; areaId += 1) {
    if (counts[areaId] === 0) continue;
    const areaIndex = bestIndex[areaId];
    if (areaIndex < 0) continue;

    const key = regionKeysByAreaId?.[areaId] ?? `area_${areaId}`;
    if (!/_region_/i.test(key)) continue;
    const gx = areaIndex % grid.width;
    const gy = Math.floor(areaIndex / grid.width);
    markers.push({
      id: areaId,
      regionIndex: areaId,
      key,
      gx,
      gy,
      componentId: componentIds[areaIndex],
      ownership: ownershipByKey.get(key.toLowerCase()),
    });
  }
  return markers.sort((first, second) => first.id - second.id);
}

function mapArea(
  area: RegionPolygonArea,
  markers: BaseMarker[],
  lookupMarkerByAreaId: Map<number, BaseMarker> | undefined,
): EsfMapArea {
  const marker = lookupMarkerByAreaId
    ? lookupMarkerByAreaId.get(area.areaId)
    : area.areaId < markers.length
      ? markers[area.areaId]
      : undefined;
  return {
    componentId: area.componentId,
    areaId: area.areaId,
    pixelCount: area.pixelCount,
    loops: area.loops,
    colour: colourFromComponent(area.componentId),
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
  lookupBuffer: Buffer | undefined,
  pathfindingBuffer: Buffer | undefined,
  paths: { mapDataPath: string; startposPath: string; lookupPath: string | null },
): EsfMapBasePayload {
  const mapOpened = openEsfBuffer(mapDataBuffer);
  const mapDocument = parseEsfDocument(mapOpened.buffer);

  const ownershipData = parseOwnership(startposBuffer);
  const ownershipByKey = new Map(ownershipData.regions.map((region) => [region.key.toLowerCase(), region]));
  let renderGrid: PolygonGridInput;
  let polygons: ReturnType<typeof extractRegionPolygons>;
  let baseMarkers: BaseMarker[];
  let gridSource: "lookup" | "region-areas";
  let displayFlipY: boolean;
  let lookupMarkerByAreaId: Map<number, BaseMarker> | undefined;

  if (lookupBuffer) {
    const lookupGrid: TgaLookupGrid = extractLookupGridFromTga(lookupBuffer);
    const sourcePolygons = extractRegionPolygons(lookupGrid, { minLoopArea: 1 });
    const pointData = extractMapPointsWithTheatreBounds(mapOpened.buffer, mapDocument);

    const theatreMarkers =
      pointData.points.length > 0 && pointData.theatreBounds
        ? buildLookupMarkersFromTheatrePoints(
            pointData.points,
            pointData.theatreBounds,
            lookupGrid,
            sourcePolygons.componentIds,
            ownershipByKey,
          )
        : [];

    if (theatreMarkers.length > 0) {
      baseMarkers = theatreMarkers;
    } else {
      const regionKeysByAreaId = pathfindingBuffer
        ? parsePathfindingRegionKeys(pathfindingBuffer).regionKeys
        : undefined;
      baseMarkers = buildLookupAreaPoints(lookupGrid, sourcePolygons.componentIds, regionKeysByAreaId, ownershipByKey);
    }

    renderGrid = lookupGrid;
    polygons = sourcePolygons;
    gridSource = "lookup";
    displayFlipY = false;
    lookupMarkerByAreaId = new Map();
    for (const marker of baseMarkers) {
      const areaId = renderGrid.areaIds[marker.gy * renderGrid.width + marker.gx];
      if (!lookupMarkerByAreaId.has(areaId)) lookupMarkerByAreaId.set(areaId, marker);
    }
  } else {
    const regionGrid: RegionAreasGrid = extractRegionAreasGrid(mapOpened.buffer);
    const centers = extractRegionCenters(mapOpened.buffer, mapDocument);
    if (centers.length === 0) {
      throw new Error("The campaign map has no REGION_DATA region centres.");
    }
    const sourcePolygons = extractRegionPolygons(regionGrid, { minLoopArea: 1 });
    baseMarkers = centers.map((center) => {
      const gx = clampGridCoordinate(center.x, regionGrid.width);
      const gy = clampGridCoordinate(center.y, regionGrid.height);
      const index = gy * regionGrid.width + gx;
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

    renderGrid = buildMarkerPartitionGrid(regionGrid, sourcePolygons.componentIds, baseMarkers);
    polygons = extractRegionPolygons(renderGrid, { minLoopArea: 1 });
    gridSource = "region-areas";
    displayFlipY = true;
  }

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
    lookupPath: paths.lookupPath,
    backgroundImage: null,
    backgroundTextImage: null,
    startposWasCompressed: ownershipData.wasCompressed,
    gridSource,
    displayFlipY,
    width: renderGrid.width,
    height: renderGrid.height,
    areas: polygons.areas.map((area) => mapArea(area, baseMarkers, lookupMarkerByAreaId)),
    markers,
    componentCount: polygons.componentCount,
    totalLoops: polygons.totalLoops,
    totalVertices: polygons.totalVertices,
    regionCount: markers.length,
    ownedRegionCount: markers.filter((marker) => marker.ownerFaction !== null).length,
  };
}
