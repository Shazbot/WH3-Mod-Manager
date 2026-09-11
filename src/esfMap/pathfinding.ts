import type { EsfMapCharacterCoordinateGrid, EsfMapCharacterPathfinding } from "./types";

export interface CharacterMapPoint {
  x: number;
  y: number;
}

type CharacterPathfindingMap = {
  width: number;
  height: number;
  characterCoordinateGrid: EsfMapCharacterCoordinateGrid;
  characterPathfinding: EsfMapCharacterPathfinding | null;
};

type DecodedCharacterPathfinding = {
  usableCells: Uint8Array;
  seaCells: Uint8Array;
  riverCells: Uint8Array;
  beachCells: Uint8Array;
};

type CharacterTerrain = keyof typeof CHARACTER_TERRAIN_COLOURS;

export const CHARACTER_TERRAIN_COLOURS = {
  unusable: "rgba(255, 0, 0, 0.42)",
  sea: "rgba(35, 125, 255, 0.52)",
  river: "rgba(0, 205, 190, 0.62)",
  beach: "rgba(255, 195, 45, 0.62)",
} as const;

const decodedBitsets = new Map<string, Uint8Array>();

const decodeBase64 = (encoded: string): Uint8Array => {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  const nodeBuffer = (
    globalThis as typeof globalThis & {
      Buffer?: { from(value: string, encoding: "base64"): Uint8Array };
    }
  ).Buffer;
  if (nodeBuffer) return Uint8Array.from(nodeBuffer.from(encoded, "base64"));
  throw new Error("This environment cannot decode pathfinding data.");
};

const decodedBitset = (encoded: string, cacheKey: string): Uint8Array => {
  const cached = decodedBitsets.get(cacheKey);
  if (cached) return cached;
  const decoded = decodeBase64(encoded);
  decodedBitsets.set(cacheKey, decoded);
  return decoded;
};

const decodedPathfinding = (pathfinding: EsfMapCharacterPathfinding): DecodedCharacterPathfinding => {
  const prefix = `${pathfinding.width}x${pathfinding.height}`;
  return {
    usableCells: decodedBitset(pathfinding.usableCells, `${prefix}:usable:${pathfinding.usableCells}`),
    seaCells: decodedBitset(pathfinding.seaCells, `${prefix}:sea:${pathfinding.seaCells}`),
    riverCells: decodedBitset(pathfinding.riverCells, `${prefix}:river:${pathfinding.riverCells}`),
    beachCells: decodedBitset(pathfinding.beachCells, `${prefix}:beach:${pathfinding.beachCells}`),
  };
};

const usableBitset = (pathfinding: EsfMapCharacterPathfinding): Uint8Array => {
  const cacheKey = `${pathfinding.width}x${pathfinding.height}:usable:${pathfinding.usableCells}`;
  const cached = decodedBitsets.get(cacheKey);
  if (cached) return cached;
  const decoded = decodeBase64(pathfinding.usableCells);
  decodedBitsets.set(cacheKey, decoded);
  return decoded;
};

const isUsableCell = (bitset: Uint8Array, index: number): boolean =>
  index >= 0 && (bitset[index >> 3] & (1 << (index & 7))) !== 0;

const normalizedCoordinate = (value: number, sourceSize: number, targetSize: number): number => {
  if (sourceSize <= 1 || targetSize <= 1) return 0;
  return (value / (sourceSize - 1)) * (targetSize - 1);
};

const isValidCharacterPoint = (point: CharacterMapPoint, grid: EsfMapCharacterCoordinateGrid): boolean =>
  Number.isSafeInteger(point.x) &&
  Number.isSafeInteger(point.y) &&
  point.x >= 0 &&
  point.y >= 0 &&
  point.x < grid.width &&
  point.y < grid.height;

/** Returns whether a source-grid character point is a valid placeable cell. */
export const isCharacterPointUsable = (map: CharacterPathfindingMap, point: CharacterMapPoint): boolean => {
  const pathfinding = map.characterPathfinding;
  if (!pathfinding) return true;
  if (!isValidCharacterPoint(point, map.characterCoordinateGrid)) return false;

  const x = Math.round(normalizedCoordinate(point.x, map.characterCoordinateGrid.width, pathfinding.width));
  const y = Math.round(normalizedCoordinate(point.y, map.characterCoordinateGrid.height, pathfinding.height));
  return isUsableCell(usableBitset(pathfinding), y * pathfinding.width + x);
};

/**
 * Snaps an in-map character coordinate to the nearest PPD cell that supports character movement.
 * Coordinates outside the source grid, including the map_out3 65535 off-map sentinel, are kept as-is.
 */
export const snapCharacterPointToUsable = (
  map: CharacterPathfindingMap,
  point: CharacterMapPoint,
): CharacterMapPoint => {
  const pathfinding = map.characterPathfinding;
  if (!pathfinding || !isValidCharacterPoint(point, map.characterCoordinateGrid)) return point;
  if (isCharacterPointUsable(map, point)) return point;

  const bitset = usableBitset(pathfinding);
  const targetX = normalizedCoordinate(point.x, map.characterCoordinateGrid.width, pathfinding.width);
  const targetY = normalizedCoordinate(point.y, map.characterCoordinateGrid.height, pathfinding.height);
  const centerX = Math.round(targetX);
  const centerY = Math.round(targetY);
  const maxRadius = Math.max(pathfinding.width, pathfinding.height);
  let nearestX = -1;
  let nearestY = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  const consider = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= pathfinding.width || y >= pathfinding.height) return;
    if (!isUsableCell(bitset, y * pathfinding.width + x)) return;
    const distance = (x - targetX) ** 2 + (y - targetY) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestX = x;
      nearestY = y;
    }
  };

  // Search square rings. Once the nearest known cell is closer than every point outside the
  // current ring, the result is the exact Euclidean nearest cell without scanning the whole map.
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    const minX = Math.max(0, centerX - radius);
    const maxX = Math.min(pathfinding.width - 1, centerX + radius);
    const minY = Math.max(0, centerY - radius);
    const maxY = Math.min(pathfinding.height - 1, centerY + radius);
    if (radius === 0) consider(centerX, centerY);
    else {
      for (let x = minX; x <= maxX; x += 1) {
        consider(x, minY);
        if (maxY !== minY) consider(x, maxY);
      }
      for (let y = minY + 1; y < maxY; y += 1) {
        consider(minX, y);
        if (maxX !== minX) consider(maxX, y);
      }
    }
    if (nearestX >= 0 && nearestDistance <= (radius + 0.5) ** 2) break;
  }

  if (nearestX < 0) return point;
  return {
    x: Math.round(normalizedCoordinate(nearestX, pathfinding.width, map.characterCoordinateGrid.width)),
    y: Math.round(normalizedCoordinate(nearestY, pathfinding.height, map.characterCoordinateGrid.height)),
  };
};

/** Paints PPD terrain classes over the map surface while leaving the character layer interactive. */
export const drawCharacterTerrainAreas = (context: CanvasRenderingContext2D, map: CharacterPathfindingMap) => {
  const pathfinding = map.characterPathfinding;
  if (!pathfinding) return;

  const decoded = decodedPathfinding(pathfinding);
  const scaleX = map.width / pathfinding.width;
  const scaleY = map.height / pathfinding.height;
  const flipY = map.characterCoordinateGrid.displayFlipY;
  context.save();

  for (let sourceY = 0; sourceY < pathfinding.height; sourceY += 1) {
    let runStart = -1;
    let runTerrain: CharacterTerrain | undefined;
    const paintRun = (runEnd: number) => {
      if (runStart < 0) return;
      const left = Math.floor(runStart * scaleX);
      const right = Math.ceil((runEnd + 1) * scaleX);
      const top = flipY ? Math.floor(map.height - (sourceY + 1) * scaleY) : Math.floor(sourceY * scaleY);
      const bottom = flipY ? Math.ceil(map.height - sourceY * scaleY) : Math.ceil((sourceY + 1) * scaleY);
      context.fillStyle = CHARACTER_TERRAIN_COLOURS[runTerrain!];
      context.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
      runStart = -1;
      runTerrain = undefined;
    };

    for (let sourceX = 0; sourceX < pathfinding.width; sourceX += 1) {
      const cellIndex = sourceY * pathfinding.width + sourceX;
      const terrain: CharacterTerrain | undefined = isUsableCell(decoded.seaCells, cellIndex)
        ? "sea"
        : isUsableCell(decoded.riverCells, cellIndex)
          ? "river"
          : isUsableCell(decoded.beachCells, cellIndex)
            ? "beach"
            : isUsableCell(decoded.usableCells, cellIndex)
              ? undefined
              : "unusable";
      if (terrain !== runTerrain) {
        if (runStart >= 0) paintRun(sourceX - 1);
        if (terrain) {
          runStart = sourceX;
          runTerrain = terrain;
        }
      }
    }
    if (runStart >= 0) paintRun(pathfinding.width - 1);
  }
  context.restore();
};
