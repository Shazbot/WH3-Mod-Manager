import { EsfDocument } from "../esf/EsfTypes";
import { walkCaabNodes } from "../esf/codecs/caabBinary";

export interface MapPoint {
  id: number;
  key: string;
  x: number;
  y: number;
  gridSpace?: boolean;
}

export interface TheatreBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapPointExtractionResult {
  points: MapPoint[];
  theatreBounds: TheatreBounds | null;
}

interface TheatreState {
  min: { x: number; y: number } | null;
  max: { x: number; y: number } | null;
  pointIds: Set<number>;
}

function isRegionKey(key: string): boolean {
  return /_region_/i.test(key);
}

export function extractMapPointsWithTheatreBounds(
  buffer: Buffer,
  document: EsfDocument,
  options?: { includeNonRegion?: boolean }
): MapPointExtractionResult {
  if (!document.metadata) {
    return {
      points: [],
      theatreBounds: null,
    };
  }

  const includeNonRegion = options?.includeNonRegion ?? false;
  const pointsById = new Map<number, MapPoint>();
  let pendingAscii: { id: number; key: string } | null = null;
  let currentTheatre: TheatreState | null = null;
  const theatreSelection: { best: TheatreState | null } = { best: null };

  walkCaabNodes(
    buffer,
    { recordNamesOffset: document.header.recordNamesOffset },
    {
      recordNames: document.metadata.recordNames,
      utf8ById: document.metadata.utf8ById,
      utf16ById: document.metadata.utf16ById,
    },
    {
      onRecordStart(record) {
        if (record.name === "THEATRE") {
          currentTheatre = {
            min: null,
            max: null,
            pointIds: new Set<number>(),
          };
        }
      },
      onRecordEnd(record) {
        if (record.name !== "THEATRE" || !currentTheatre) {
          return;
        }

        if (!currentTheatre.min || !currentTheatre.max) {
          currentTheatre = null;
          return;
        }

        if (!theatreSelection.best || currentTheatre.pointIds.size > theatreSelection.best.pointIds.size) {
          theatreSelection.best = currentTheatre;
        }

        currentTheatre = null;
      },
      onValue(value, stack) {
        if (stack.length === 0 || value.kind !== "value") {
          return;
        }

        const currentRecord = stack[stack.length - 1];
        if (currentRecord === "THEATRE" && value.type === "coord2d" && currentTheatre) {
          const coordValue = value.value as { x: number; y: number };
          if (!currentTheatre.min) {
            currentTheatre.min = { x: coordValue.x, y: coordValue.y };
          } else if (!currentTheatre.max) {
            currentTheatre.max = { x: coordValue.x, y: coordValue.y };
          }
          return;
        }

        if (currentRecord !== "REGION_KEYS") {
          return;
        }

        if (value.type === "ascii") {
          const asciiValue = value.value as { id: number; text: string | null };
          if (!asciiValue.text) {
            pendingAscii = null;
            return;
          }

          if (!includeNonRegion && !isRegionKey(asciiValue.text)) {
            pendingAscii = null;
            return;
          }

          pendingAscii = {
            id: asciiValue.id,
            key: asciiValue.text,
          };
          return;
        }

        if (value.type === "coord2d" && pendingAscii) {
          const coordValue = value.value as { x: number; y: number };
          if (!pointsById.has(pendingAscii.id)) {
            pointsById.set(pendingAscii.id, {
              id: pendingAscii.id,
              key: pendingAscii.key,
              x: coordValue.x,
              y: coordValue.y,
            });
          }
          if (currentTheatre) {
            currentTheatre.pointIds.add(pendingAscii.id);
          }
          pendingAscii = null;
        }
      },
    }
  );

  const bestTheatre = theatreSelection.best;
  let theatreBounds: TheatreBounds | null = null;
  if (bestTheatre && bestTheatre.min && bestTheatre.max) {
    theatreBounds = {
      minX: bestTheatre.min.x,
      minY: bestTheatre.min.y,
      maxX: bestTheatre.max.x,
      maxY: bestTheatre.max.y,
    };
  }

  return {
    points: [...pointsById.values()].sort((left, right) => left.id - right.id),
    theatreBounds,
  };
}

export function extractMapPoints(
  buffer: Buffer,
  document: EsfDocument,
  options?: { includeNonRegion?: boolean }
): MapPoint[] {
  return extractMapPointsWithTheatreBounds(buffer, document, options).points;
}
