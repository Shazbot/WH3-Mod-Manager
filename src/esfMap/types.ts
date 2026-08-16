export type EsfMapColour = [number, number, number];

export interface EsfMapArea {
  componentId: number;
  areaId: number;
  pixelCount: number;
  loops: number[][];
  colour: EsfMapColour;
  regionKey?: string;
  ownerFaction?: string | null;
}

export interface EsfMapMarker {
  id: number;
  regionIndex: number;
  key: string;
  gx: number;
  gy: number;
  areaId: number;
  componentId: number;
  ownerFaction: string | null;
  subculture: string | null;
  settlementKey: string | null;
}

export interface EsfMapPayload {
  mapDataPath: string;
  startposPath: string;
  startposWasCompressed: boolean;
  width: number;
  height: number;
  areas: EsfMapArea[];
  markers: EsfMapMarker[];
  componentCount: number;
  totalLoops: number;
  totalVertices: number;
  regionCount: number;
  ownedRegionCount: number;
}

export type EsfMapResponse = { success: true; map: EsfMapPayload } | { success: false; error: string };
