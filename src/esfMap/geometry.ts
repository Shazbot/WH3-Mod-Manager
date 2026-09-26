import type { EsfMapArea } from "./types";

export interface EsfMapRegionPoint {
  x: number;
  y: number;
}

interface RegionCentroidAccumulator {
  signedArea: number;
  signedMomentX: number;
  signedMomentY: number;
  absoluteArea: number;
  absoluteMomentX: number;
  absoluteMomentY: number;
}

const CENTROID_EPSILON = 1e-9;

/**
 * Returns polygon centroids for each region represented by the supplied map areas.
 *
 * The extracted loops retain their winding, so holes subtract from the centroid just as they
 * subtract from the polygon's area. Multiple disconnected areas belonging to one region are
 * combined by area. The absolute-area moments are only a fallback for malformed or oppositely
 * wound loops whose signed areas cancel out.
 */
export const computeRegionGeometricCenters = (
  areas: Pick<EsfMapArea, "regionKey" | "loops">[],
): Map<string, EsfMapRegionPoint> => {
  const accumulators = new Map<string, RegionCentroidAccumulator>();

  for (const area of areas) {
    const regionKey = area.regionKey?.trim().toLowerCase();
    if (!regionKey) continue;

    const accumulator = accumulators.get(regionKey) ?? {
      signedArea: 0,
      signedMomentX: 0,
      signedMomentY: 0,
      absoluteArea: 0,
      absoluteMomentX: 0,
      absoluteMomentY: 0,
    };
    accumulators.set(regionKey, accumulator);

    for (const loop of area.loops) {
      if (loop.length < 6 || loop.length % 2 !== 0) continue;

      let twiceArea = 0;
      let momentX = 0;
      let momentY = 0;
      for (let index = 0; index < loop.length; index += 2) {
        const nextIndex = (index + 2) % loop.length;
        const x = loop[index];
        const y = loop[index + 1];
        const nextX = loop[nextIndex];
        const nextY = loop[nextIndex + 1];
        const cross = x * nextY - nextX * y;
        twiceArea += cross;
        momentX += (x + nextX) * cross;
        momentY += (y + nextY) * cross;
      }

      const signedArea = twiceArea / 2;
      const loopMomentX = momentX / 6;
      const loopMomentY = momentY / 6;
      const absoluteArea = Math.abs(signedArea);
      if (absoluteArea <= CENTROID_EPSILON) continue;

      accumulator.signedArea += signedArea;
      accumulator.signedMomentX += loopMomentX;
      accumulator.signedMomentY += loopMomentY;
      accumulator.absoluteArea += absoluteArea;
      accumulator.absoluteMomentX += Math.sign(signedArea) * loopMomentX;
      accumulator.absoluteMomentY += Math.sign(signedArea) * loopMomentY;
    }
  }

  const centers = new Map<string, EsfMapRegionPoint>();
  for (const [regionKey, accumulator] of accumulators) {
    const useSignedMoments = Math.abs(accumulator.signedArea) > CENTROID_EPSILON;
    const area = useSignedMoments ? accumulator.signedArea : accumulator.absoluteArea;
    if (Math.abs(area) <= CENTROID_EPSILON) continue;

    centers.set(regionKey, {
      x: (useSignedMoments ? accumulator.signedMomentX : accumulator.absoluteMomentX) / area,
      y: (useSignedMoments ? accumulator.signedMomentY : accumulator.absoluteMomentY) / area,
    });
  }

  return centers;
};
