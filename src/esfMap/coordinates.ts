import type { EsfMapCharacterCoordinateGrid, EsfMapCoordinateBounds } from "./types";

export interface EsfMapLogicalCoordinateFrame {
  width: number;
  height: number;
  logicalCoordinateBounds: EsfMapCoordinateBounds;
}

export interface EsfMapCharacterCoordinateFrame {
  width: number;
  height: number;
  displayFlipY: boolean;
  characterCoordinateGrid?: EsfMapCharacterCoordinateGrid | null;
}

export interface EsfMapPoint {
  x: number;
  y: number;
}

const clamp = (value: number, limit: number) => Math.max(0, Math.min(limit - 1, value));

const roundedMapPoint = (
  x: number,
  y: number,
  width: number,
  height: number,
  clampToMap: boolean,
): EsfMapPoint | undefined => {
  const mapX = Math.round(x);
  const mapY = Math.round(y);
  if (clampToMap) return { x: clamp(mapX, width), y: clamp(mapY, height) };
  if (mapX < 0 || mapY < 0 || mapX >= width || mapY >= height) return undefined;
  return { x: mapX, y: mapY };
};

/** Converts a campaign world coordinate (origin at the lower left) to a map grid point. */
export const projectLogicalCoordinateToMap = (
  frame: EsfMapLogicalCoordinateFrame,
  logicalX: number,
  logicalY: number,
  clampToMap = false,
): EsfMapPoint | undefined => {
  if (!Number.isFinite(logicalX) || !Number.isFinite(logicalY) || frame.width <= 0 || frame.height <= 0)
    return undefined;

  const bounds = frame.logicalCoordinateBounds;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (!(spanX > 0) || !(spanY > 0)) return undefined;

  const normalizedX = (logicalX - bounds.minX) / spanX;
  const normalizedY = (logicalY - bounds.minY) / spanY;
  if (!clampToMap && (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1)) return undefined;

  return roundedMapPoint(
    normalizedX * (frame.width - 1),
    (1 - normalizedY) * (frame.height - 1),
    frame.width,
    frame.height,
    clampToMap,
  );
};

const characterGridForFrame = (frame: EsfMapCharacterCoordinateFrame): EsfMapCharacterCoordinateGrid =>
  frame.characterCoordinateGrid ?? {
    width: frame.width,
    height: frame.height,
    displayFlipY: frame.displayFlipY,
  };

/** Converts an imported character's REGION_DATA grid coordinate to the rendered map grid. */
export const projectCharacterCoordinateToMap = (
  frame: EsfMapCharacterCoordinateFrame,
  characterX: number,
  characterY: number,
): EsfMapPoint | undefined => {
  if (!Number.isFinite(characterX) || !Number.isFinite(characterY) || characterX === 65535 || characterY === 65535)
    return undefined;

  const source = characterGridForFrame(frame);
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    characterX < 0 ||
    characterY < 0 ||
    characterX >= source.width ||
    characterY >= source.height
  )
    return undefined;

  const normalizedX = source.width > 1 ? characterX / (source.width - 1) : 0;
  const normalizedY = source.height > 1 ? characterY / (source.height - 1) : 0;
  return roundedMapPoint(
    normalizedX * (frame.width - 1),
    (source.displayFlipY ? 1 - normalizedY : normalizedY) * (frame.height - 1),
    frame.width,
    frame.height,
    false,
  );
};

/** Converts a rendered map point back to the REGION_DATA grid used in an extended map file. */
export const mapPointToCharacterCoordinate = (
  frame: EsfMapCharacterCoordinateFrame,
  mapPoint: EsfMapPoint,
): EsfMapPoint | undefined => {
  if (
    !Number.isFinite(mapPoint.x) ||
    !Number.isFinite(mapPoint.y) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    mapPoint.x < 0 ||
    mapPoint.y < 0 ||
    mapPoint.x >= frame.width ||
    mapPoint.y >= frame.height
  )
    return undefined;

  const source = characterGridForFrame(frame);
  if (source.width <= 0 || source.height <= 0) return undefined;

  const normalizedX = frame.width > 1 ? mapPoint.x / (frame.width - 1) : 0;
  const normalizedY = frame.height > 1 ? mapPoint.y / (frame.height - 1) : 0;
  return {
    x: Math.round(normalizedX * (source.width - 1)),
    y: Math.round((source.displayFlipY ? 1 - normalizedY : normalizedY) * (source.height - 1)),
  };
};
