import {
  extractLookupGridFromTga,
  extractMapPointsWithTheatreBounds,
  extractRegionAreasGrid,
  extractRegionCenters,
  extractRegionPolygons,
  extractStartposRegions,
  openEsfBuffer,
  parsePathfindingCharacterGrid,
  parseEsfDocument,
  type MapPoint,
  type RegionAreasGrid,
  type RegionPolygonArea,
  type StartposRegion,
  type TgaLookupGrid,
  type TheatreBounds,
} from "../../tools/esf/src";
import type {
  EsfMapArea,
  EsfMapBasePayload,
  EsfMapCharacterCoordinateGrid,
  EsfMapCharacterPathfinding,
  EsfMapColour,
  EsfMapMarker,
} from "./types";
import { projectLogicalCoordinateToMap } from "./coordinates";

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

function parseCharacterPathfinding(
  buffer: Buffer | undefined,
  coordinateGrid: EsfMapCharacterCoordinateGrid,
): { parsed: ReturnType<typeof parsePathfindingCharacterGrid>; map: EsfMapCharacterPathfinding } | undefined {
  if (!buffer) return undefined;
  try {
    const parsed = parsePathfindingCharacterGrid(buffer);
    // PPD and REGION_DATA normally use the same grid. The renderer also supports differing sizes,
    // but warn because it usually indicates a map asset from a different map variant was selected.
    if (parsed.width !== coordinateGrid.width || parsed.height !== coordinateGrid.height) {
      console.warn(
        `Pathfinding grid ${parsed.width}x${parsed.height} differs from character grid ${coordinateGrid.width}x${coordinateGrid.height}.`,
      );
    }
    return {
      parsed,
      map: {
        width: parsed.width,
        height: parsed.height,
        usableCells: Buffer.from(parsed.usableCells).toString("base64"),
        seaCells: Buffer.from(parsed.seaCells).toString("base64"),
        riverCells: Buffer.from(parsed.riverCells).toString("base64"),
        beachCells: Buffer.from(parsed.beachCells).toString("base64"),
      },
    };
  } catch (error) {
    console.warn(
      `Could not decode character pathfinding data: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
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

const hslToColour = (hueDegrees: number, saturation: number, lightness: number): EsfMapColour => {
  const hue = (((hueDegrees % 360) + 360) % 360) / 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs((((hue * 360) / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const [red, green, blue] =
    hue < 1 / 6
      ? [chroma, secondary, 0]
      : hue < 2 / 6
        ? [secondary, chroma, 0]
        : hue < 3 / 6
          ? [0, chroma, secondary]
          : hue < 4 / 6
            ? [0, secondary, chroma]
            : hue < 5 / 6
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return [Math.round((red + match) * 255), Math.round((green + match) * 255), Math.round((blue + match) * 255)];
};

function colourFromComponent(index: number): EsfMapColour {
  let hash = index * 2654435761;
  hash ^= hash >>> 16;
  const hue = Math.abs(hash) % 360;
  const saturation = 0.5 + (Math.abs(hash >>> 8) % 30) / 100;
  const lightness = 0.36 + (Math.abs(hash >>> 16) % 16) / 100;
  return hslToColour(hue, saturation, lightness);
}

/** Minimum RGB distance used to keep touching map components visibly distinct. */
export const MIN_MAP_NEIGHBOUR_COLOUR_DISTANCE = 80;

const MAP_COLOUR_PALETTE = Array.from({ length: 12 }, (_, index) => hslToColour(index * 30, 0.72, 0.5));

const colourDistance = (first: EsfMapColour, second: EsfMapColour): number =>
  Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);

const buildComponentAdjacency = (
  componentIds: Uint32Array,
  width: number,
  height: number,
  componentCount: number,
): Set<number>[] => {
  const adjacency = Array.from({ length: componentCount }, () => new Set<number>());
  const addNeighbour = (first: number, second: number) => {
    if (first >= componentCount || second >= componentCount || first === second) return;
    adjacency[first].add(second);
    adjacency[second].add(first);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const component = componentIds[index];
      if (component >= componentCount) continue;
      if (x + 1 < width) addNeighbour(component, componentIds[index + 1]);
      if (y + 1 < height) addNeighbour(component, componentIds[index + width]);
    }
  }
  return adjacency;
};

interface ComponentDegreeEntry {
  component: number;
  degree: number;
}

const comesBeforeInDegreeHeap = (first: ComponentDegreeEntry, second: ComponentDegreeEntry): boolean =>
  first.degree < second.degree || (first.degree === second.degree && first.component < second.component);

/**
 * Produces a smallest-last ordering, which keeps the number of already-coloured neighbours low when
 * the order is reversed for the greedy assignment below.
 */
const smallestLastComponentOrder = (adjacency: Set<number>[]): number[] => {
  const degrees = adjacency.map((neighbours) => neighbours.size);
  const removed = new Uint8Array(adjacency.length);
  const heap: ComponentDegreeEntry[] = [];

  const push = (entry: ComponentDegreeEntry) => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (comesBeforeInDegreeHeap(heap[parent], heap[index])) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };

  const pop = (): ComponentDegreeEntry | undefined => {
    if (heap.length === 0) return undefined;
    const first = heap[0];
    const last = heap.pop();
    if (last && heap.length > 0) {
      heap[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let next = index;
        if (left < heap.length && comesBeforeInDegreeHeap(heap[left], heap[next])) next = left;
        if (right < heap.length && comesBeforeInDegreeHeap(heap[right], heap[next])) next = right;
        if (next === index) break;
        [heap[index], heap[next]] = [heap[next], heap[index]];
        index = next;
      }
    }
    return first;
  };

  for (let component = 0; component < adjacency.length; component += 1) {
    push({ component, degree: degrees[component] });
  }

  const order: number[] = [];
  while (order.length < adjacency.length) {
    const entry = pop();
    if (!entry || removed[entry.component] !== 0 || entry.degree !== degrees[entry.component]) continue;

    removed[entry.component] = 1;
    order.push(entry.component);
    for (const neighbour of adjacency[entry.component]) {
      if (removed[neighbour] !== 0) continue;
      degrees[neighbour] -= 1;
      push({ component: neighbour, degree: degrees[neighbour] });
    }
  }
  return order;
};

/** Assigns deterministic, high-contrast colours while taking shared map boundaries into account. */
export const buildNeighbourAwareColours = (
  componentIds: Uint32Array,
  width: number,
  height: number,
  componentCount: number,
): EsfMapColour[] => {
  if (componentCount <= 0) return [];

  const adjacency = buildComponentAdjacency(componentIds, width, height, componentCount);
  const colours = new Array<EsfMapColour | undefined>(componentCount);
  const order = smallestLastComponentOrder(adjacency);

  for (let orderIndex = order.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const component = order[orderIndex];
    const preferredColour = colourFromComponent(component);
    let bestCandidateIndex = 0;
    let bestCandidateDistance = Number.NEGATIVE_INFINITY;
    let bestPreferredDistance = Number.POSITIVE_INFINITY;
    let bestMeetsMinimum = false;

    for (let candidateIndex = 0; candidateIndex < MAP_COLOUR_PALETTE.length; candidateIndex += 1) {
      const candidate = MAP_COLOUR_PALETTE[candidateIndex];
      let nearestNeighbourDistance = Number.POSITIVE_INFINITY;
      for (const neighbour of adjacency[component]) {
        const neighbourColour = colours[neighbour];
        if (neighbourColour) {
          nearestNeighbourDistance = Math.min(nearestNeighbourDistance, colourDistance(candidate, neighbourColour));
        }
      }

      const meetsMinimum = nearestNeighbourDistance >= MIN_MAP_NEIGHBOUR_COLOUR_DISTANCE;
      const preferredDistance = colourDistance(candidate, preferredColour);
      const shouldUse =
        (meetsMinimum && !bestMeetsMinimum) ||
        (meetsMinimum === bestMeetsMinimum &&
          (meetsMinimum
            ? preferredDistance < bestPreferredDistance
            : nearestNeighbourDistance > bestCandidateDistance ||
              (nearestNeighbourDistance === bestCandidateDistance && preferredDistance < bestPreferredDistance)));
      if (!shouldUse) continue;

      bestCandidateIndex = candidateIndex;
      bestCandidateDistance = nearestNeighbourDistance;
      bestPreferredDistance = preferredDistance;
      bestMeetsMinimum = meetsMinimum;
    }

    colours[component] = MAP_COLOUR_PALETTE[bestCandidateIndex];
  }

  return colours.map((colour, component) => colour ?? colourFromComponent(component));
};

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
      const projected = projectLogicalCoordinateToMap(
        {
          width: grid.width,
          height: grid.height,
          logicalCoordinateBounds: theatreBounds,
        },
        point.x,
        point.y,
        true,
      );
      if (!projected) return undefined;
      const gx = projected.x;
      const gy = projected.y;
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
    .filter((marker): marker is NonNullable<typeof marker> => !!marker)
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
  colours: readonly EsfMapColour[],
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
    colour: colours[area.componentId] ?? colourFromComponent(area.componentId),
    regionKey: marker?.key,
    ownerFaction: marker?.ownership?.ownerFaction ?? null,
  };
}

function parseOwnership(startposBuffer: Buffer | undefined): {
  regions: StartposRegion[];
  wasCompressed: boolean;
} {
  if (!startposBuffer) return { regions: [], wasCompressed: false };
  try {
    const opened = openEsfBuffer(startposBuffer);
    const document = parseEsfDocument(opened.buffer);
    return {
      regions: extractStartposRegions(opened.buffer, document),
      wasCompressed: opened.wasCompressed,
    };
  } catch (error) {
    // The map geometry is independent of startpos ownership. Some campaigns ship a startpos
    // compression variant that this reader cannot decode, so keep the map usable without the
    // optional ownership overlay rather than failing the whole map load.
    console.warn(
      `Could not decode startpos ownership data; rendering without ownership: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { regions: [], wasCompressed: false };
  }
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
  // Imported characters use REGION_DATA's grid coordinate system even when the rendered map uses
  // a higher-resolution lookup texture. Keep that source frame so their positions can be scaled
  // into the rendered map and flipped in the same direction as the region-area fallback.
  const regionCoordinateGrid = extractRegionAreasGrid(mapOpened.buffer);
  const characterCoordinateGrid: EsfMapCharacterCoordinateGrid = {
    width: regionCoordinateGrid.width,
    height: regionCoordinateGrid.height,
    displayFlipY: true,
  };
  const parsedPathfinding = parseCharacterPathfinding(pathfindingBuffer, characterCoordinateGrid);
  const pointData = lookupBuffer ? extractMapPointsWithTheatreBounds(mapOpened.buffer, mapDocument) : undefined;

  if (lookupBuffer) {
    const lookupGrid: TgaLookupGrid = extractLookupGridFromTga(lookupBuffer);
    const sourcePolygons = extractRegionPolygons(lookupGrid, { minLoopArea: 1 });

    const theatreMarkers =
      pointData && pointData.points.length > 0 && pointData.theatreBounds
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
      const regionKeysByAreaId = parsedPathfinding?.parsed.regionKeys;
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
    const regionGrid: RegionAreasGrid = regionCoordinateGrid;
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
  const areaColours = buildNeighbourAwareColours(
    polygons.componentIds,
    renderGrid.width,
    renderGrid.height,
    polygons.componentCount,
  );

  return {
    mapDataPath: paths.mapDataPath,
    startposPath: paths.startposPath,
    lookupPath: paths.lookupPath,
    settlementTypes: [],
    settlementTypesByRegion: {},
    climates: [],
    climatesByRegion: {},
    backgroundImage: null,
    backgroundTextImage: null,
    startposWasCompressed: ownershipData.wasCompressed,
    gridSource,
    displayFlipY,
    characterCoordinateGrid,
    characterPathfinding: parsedPathfinding?.map ?? null,
    width: renderGrid.width,
    height: renderGrid.height,
    areas: polygons.areas.map((area) => mapArea(area, baseMarkers, lookupMarkerByAreaId, areaColours)),
    markers,
    factions: [],
    componentCount: polygons.componentCount,
    totalLoops: polygons.totalLoops,
    totalVertices: polygons.totalVertices,
    regionCount: markers.length,
    ownedRegionCount: markers.filter((marker) => marker.ownerFaction !== null).length,
  };
}
