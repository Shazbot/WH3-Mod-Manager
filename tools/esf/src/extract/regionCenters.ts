import { EsfDocument } from "../esf/EsfTypes";
import { CaabValue, walkCaabNodes } from "../esf/codecs/caabBinary";

export interface RegionCenterPoint {
  id: number;
  key: string;
  x: number;
  y: number;
  gridSpace: true;
}

interface RegionWalkState {
  regionIndex: number | null;
  key: string | null;
  centerX: number | null;
  centerY: number | null;
  bestAreaType: number | null;
  bestAreaWeight: number;
  currentAreaType: number | null;
  currentAreaU16: number[];
  currentAreaWeight: number;
}

function numericValue(value: CaabValue): number | null {
  if (value.kind !== "value") {
    return null;
  }

  switch (value.type) {
    case "u8":
    case "u16":
    case "u32":
    case "i8":
    case "i16":
    case "i32":
      return Number(value.value);
    default:
      return null;
  }
}

function isRegionKey(key: string): boolean {
  return /_region_/i.test(key);
}

function shouldReplaceAreaCandidate(
  bestType: number | null,
  bestWeight: number,
  nextType: number | null,
  nextWeight: number
): boolean {
  if (bestType === null) {
    return true;
  }

  if (bestType === 0) {
    return nextType === 0 && nextWeight > bestWeight;
  }

  if (nextType === 0) {
    return true;
  }

  return nextWeight > bestWeight;
}

export function extractRegionCenters(
  buffer: Buffer,
  document: EsfDocument,
  options?: { includeNonRegion?: boolean }
): RegionCenterPoint[] {
  if (!document.metadata) {
    return [];
  }

  const includeNonRegion = options?.includeNonRegion ?? false;
  const points: RegionCenterPoint[] = [];
  let currentRegion: RegionWalkState | null = null;

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
        if (record.name === "REGION_DATA") {
          currentRegion = {
            regionIndex: null,
            key: null,
            centerX: null,
            centerY: null,
            bestAreaType: null,
            bestAreaWeight: Number.NEGATIVE_INFINITY,
            currentAreaType: null,
            currentAreaU16: [],
            currentAreaWeight: Number.NEGATIVE_INFINITY,
          };
          return;
        }

        if (record.name === "REGION_AREA_DATA" && currentRegion) {
          currentRegion.currentAreaType = null;
          currentRegion.currentAreaU16 = [];
          currentRegion.currentAreaWeight = Number.NEGATIVE_INFINITY;
        }
      },
      onRecordEnd(record) {
        if (!currentRegion) {
          return;
        }

        if (record.name === "REGION_AREA_DATA") {
          const values = currentRegion.currentAreaU16;
          if (values.length >= 7) {
            const centerX = values[values.length - 2];
            const centerY = values[values.length - 1];
            const candidateWeight =
              Number.isFinite(currentRegion.currentAreaWeight) ? currentRegion.currentAreaWeight : values[0];

            if (
              shouldReplaceAreaCandidate(
                currentRegion.bestAreaType,
                currentRegion.bestAreaWeight,
                currentRegion.currentAreaType,
                candidateWeight
              )
            ) {
              currentRegion.bestAreaType = currentRegion.currentAreaType;
              currentRegion.bestAreaWeight = candidateWeight;
              currentRegion.centerX = centerX;
              currentRegion.centerY = centerY;
            }
          }
          return;
        }

        if (record.name === "REGION_DATA") {
          if (
            currentRegion.regionIndex !== null &&
            currentRegion.key &&
            currentRegion.centerX !== null &&
            currentRegion.centerY !== null &&
            (includeNonRegion || isRegionKey(currentRegion.key))
          ) {
            points.push({
              id: currentRegion.regionIndex,
              key: currentRegion.key,
              x: currentRegion.centerX,
              y: currentRegion.centerY,
              gridSpace: true,
            });
          }
          currentRegion = null;
        }
      },
      onValue(value, stack) {
        if (!currentRegion || stack.length === 0) {
          return;
        }

        const currentRecord = stack[stack.length - 1];
        const numeric = numericValue(value);

        if (currentRecord === "REGION_INDEX" && numeric !== null) {
          currentRegion.regionIndex = numeric;
          return;
        }

        if (
          currentRecord === "REGION_DATA" &&
          value.kind === "value" &&
          value.type === "ascii" &&
          currentRegion.key === null
        ) {
          const asciiValue = value.value as { id: number; text: string | null };
          currentRegion.key = asciiValue.text ?? null;
          return;
        }

        if (
          currentRecord === "REGION_AREA_DATA" &&
          value.kind === "value" &&
          value.type === "u8" &&
          currentRegion.currentAreaType === null
        ) {
          currentRegion.currentAreaType = Number(value.value);
          return;
        }

        if (
          currentRecord === "REGION_AREA_DATA" &&
          value.kind === "value" &&
          value.type === "u16"
        ) {
          currentRegion.currentAreaU16.push(Number(value.value));
          return;
        }

        if (
          currentRecord === "REGION_AREA_DATA" &&
          value.kind === "value" &&
          value.type === "u32" &&
          !Number.isFinite(currentRegion.currentAreaWeight)
        ) {
          currentRegion.currentAreaWeight = Number(value.value);
        }
      },
    }
  );

  points.sort((left, right) => left.id - right.id);
  return points;
}
