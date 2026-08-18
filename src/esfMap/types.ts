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

export interface EsfMapFaction {
  key: string;
  label: string;
  flagPath?: string;
  /** Runtime asset-protocol URL; omitted from the persisted map cache. */
  flagUrl?: string;
  regionCount: number;
}

export interface EsfMapCampaignOption {
  key: string;
  label: string;
}

export interface EsfMapSettlementTypeOption {
  key: string;
  label: string;
}

export type EsfMapGridSource = "lookup" | "region-areas";

export interface EsfMapImage {
  width: number;
  height: number;
  src: string;
}

export interface EsfMapPayload {
  campaignKey: string;
  availableCampaigns: EsfMapCampaignOption[];
  settlementTypes: EsfMapSettlementTypeOption[];
  settlementTypesByRegion: Record<string, string[]>;
  mapDataPath: string;
  startposPath: string;
  lookupPath: string | null;
  backgroundImage: EsfMapImage | null;
  backgroundTextImage: EsfMapImage | null;
  startposWasCompressed: boolean;
  gridSource: EsfMapGridSource;
  displayFlipY: boolean;
  width: number;
  height: number;
  areas: EsfMapArea[];
  markers: EsfMapMarker[];
  factions: EsfMapFaction[];
  componentCount: number;
  totalLoops: number;
  totalVertices: number;
  regionCount: number;
  ownedRegionCount: number;
}

export type EsfMapBasePayload = Omit<EsfMapPayload, "campaignKey" | "availableCampaigns">;

export type EsfMapResponse = { success: true; map: EsfMapPayload } | { success: false; error: string };
