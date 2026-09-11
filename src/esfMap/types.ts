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
  /** From `factions_tables`; applied to a region's marker when ownership is edited. */
  subculture?: string;
  /** Culture owning this faction, used by extended map building and unit roster filters. */
  culture?: string;
  /** Zero for a faction the roster offers but the startpos gives no land. */
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

export interface EsfMapClimateOption {
  key: string;
  label: string;
  colour: EsfMapColour;
  regionCount: number;
}

export type EsfMapGridSource = "lookup" | "region-areas";

export interface EsfMapImage {
  width: number;
  height: number;
  src: string;
}

/** Dimensions and orientation of the REGION_DATA grid used by imported character coordinates. */
export interface EsfMapCharacterCoordinateGrid {
  width: number;
  height: number;
  displayFlipY: boolean;
}

/** Bounds of the campaign's world-coordinate system used by REGION_KEYS settlement points. */
export interface EsfMapCoordinateBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface EsfMapPayload {
  campaignKey: string;
  availableCampaigns: EsfMapCampaignOption[];
  settlementTypes: EsfMapSettlementTypeOption[];
  settlementTypesByRegion: Record<string, string[]>;
  climates: EsfMapClimateOption[];
  climatesByRegion: Record<string, string | null>;
  mapDataPath: string;
  startposPath: string;
  lookupPath: string | null;
  backgroundImage: EsfMapImage | null;
  backgroundTextImage: EsfMapImage | null;
  startposWasCompressed: boolean;
  gridSource: EsfMapGridSource;
  displayFlipY: boolean;
  characterCoordinateGrid: EsfMapCharacterCoordinateGrid;
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
