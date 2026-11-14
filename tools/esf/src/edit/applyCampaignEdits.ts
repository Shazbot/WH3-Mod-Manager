import {
  parseCaabStringTables,
  parseCbabStringTables,
  readCaabHeader,
  walkCaabNodes,
  CaabStringTables,
} from "../esf/codecs/caabBinary";
import { buildCaabTree, replaceByteRanges, CaabByteReplacement } from "../esf/codecs/caabTree";
import { cauleb128Length, writeCaabBuffer, writeCauleb128 } from "../esf/codecs/caabWriter";
import { openEsfBuffer } from "../esf/compressed";
import { repackAndVerify } from "../esf/recompress";
import { parseEsfDocument } from "../esf/EsfParser";
import { extractCampaignState, CampaignState } from "../extract/campaignState";
import { appendUtf8String, encodeAscii, encodeU32 } from "./addFaction";

/**
 * Applies map-panel edits to a decompressed or compressed WH3 campaign save. Mirrors the shapes of
 * `ExtendedMapDeltaAction` (src/esfMap/extended.ts) so the tools package keeps no `src/` imports.
 *
 * Written (layouts documented in extract/campaignState.ts):
 * - Character move: LOCOMOTABLE logical u16 x/y, its world coord2d (linear fit logical -> world over every on-map character
 *   of the save) and the LINE_OF_SIGHT bounding coord2d pair, shifted by the same world delta.
 * - Unit health: UNIT current soldiers = round(max * health / 100).
 * - Unit rank ("xp" in the map document): the u8 rank and the xp points u32 set to the land threshold of that rank
 *   (unit_experience_thresholds_tables land_level_NN; the save's own units match it for ranks 1-4 and 6).
 * - Building in an occupied slot: the first ascii of its BUILDING_BASE.
 * - Diplomacy (`set_diplomacy`, `make_peace`): both factions' OLD_DIPLOMACY_RELATIONSHIP blocks for the pair, verified against
 *   paired in-game saves: war = stance "war" (else "neutral"), military alliance = stance "military_allies", military access = the
 *   i32 at [12] (-1 / 0), non-aggression pact = code 1659 appended to the u32 list at [14], trade agreement = code 4051 prepended.
 *   Nothing else changed in those saves except derived data (shroud, AI scores, favour, event feed), which is left alone.
 * Everything else is reported in `skipped`.
 */
type Change<T> = { before: T; after: T };
export interface CampaignEditBuildingSlot {
  building: string;
  type: string;
  template: string;
}
export interface CampaignEditAction {
  type: string;
  region?: string;
  slotIndex?: number;
  /** A building slot for `set_building`; the relation fields of `faction` towards `targetFaction` for `set_diplomacy`. */
  before?: CampaignEditBuildingSlot | string[];
  after?: CampaignEditBuildingSlot | string[];
  faction?: string;
  targetFaction?: string;
  characterId?: number;
  unitId?: number;
  changes?: Partial<Record<"x" | "y" | "rank" | "subtype" | "xp" | "health" | "unit_key", Change<number | string>>>;
}
export interface CampaignEdits {
  /** Region key -> new owner faction key (null = abandoned). */
  ownership?: Record<string, string | null>;
  actions: CampaignEditAction[];
  /**
   * Campaign turn stamped into new vassal treaties (the blocks keep the signing turn). The save's own turn counter was not found,
   * so callers should pass it; otherwise the highest treaty turn already in the save (at least 1) is used.
   */
  turn?: number;
}
export interface ApplyCampaignEditsOptions {
  /** Rewrite the file even when no edit applied (used by round-trip checks). */
  alwaysRewrite?: boolean;
  /**
   * Diagnostics only: transfer a region to a faction that holds no province record in that province, leaving the province
   * record (and its AI wrapper) uncreated. The game creates both with fresh AI components; without them the save is not
   * known to load, so the exporter never sets this.
   */
  allowMissingProvinceManager?: boolean;
}
export interface ApplyCampaignEditsResult {
  buffer: Buffer;
  applied: string[];
  skipped: string[];
}

/** unit_experience_thresholds_tables `land_level_01..09`; rank 0 is 0 points. */
export const LAND_RANK_XP_THRESHOLDS = [0, 700, 1500, 2400, 3400, 4600, 7000, 10600, 15500, 22000];
const OFF_MAP = 65535;
/** Index of the next-building-id counter among the direct values of CAMPAIGN_COMMAND_QUEUE_INDEX_TABLES (1363 -> 1364 after one upgrade). */
const QUEUE_BUILDING_ID_INDEX = 5;
/** Bytes per element of the id-list array markers (the 3-byte form is big-endian, the others little-endian). */
const ID_LIST_WIDTHS: Record<number, number> = { 0x56: 1, 0x57: 2, 0x58: 3, 0x48: 4 };
const DIPLO_GROUP_SIZE = 15;
/** Array marker of the u32 code list closing each OLD_DIPLOMACY_RELATIONSHIP block. */
const DIPLO_CODES_MARKER = 0x4f;
const DIPLO_CODE_NON_AGGRESSION = 1659;
const DIPLO_CODE_TRADE = 4051;
const DIPLO_STANCES = new Set(["neutral", "war", "military_allies", "defensive_allies", "master", "vassal"]);
const DIPLO_FIELDS = ["mil_ally", "non_aggression", "trade", "war", "vassals", "mil_access", "def_ally"] as const;
/** Fields stored as the stance string; a pair holds at most one. */
const DIPLO_STANCE_FIELDS = ["war", "mil_ally", "def_ally", "vassals"] as const;
type DiploField = (typeof DIPLO_FIELDS)[number];

type Span = { start: number; end: number };
const text = (value: unknown): string => {
  const v = value as { text?: string | null } | null;
  return v && typeof v === "object" ? (v.text ?? "") : "";
};

interface CharInfo {
  u32s: number[];
  type: string;
  directU16s: number[];
  locoCoord: (Span & { x: number; y: number }) | null;
  locoU16s: (Span & { value: number })[];
  los: (Span & { x: number; y: number })[];
}
interface UnitInfo {
  u32s: number[];
  u32Spans: Span[];
  rank: (Span & { value: number }) | null;
}
interface ForceInfo {
  u32s: number[];
  type: string;
  units: UnitInfo[];
}
interface DiploBlock {
  other: number;
  stance: (Span & { text: string }) | null;
  access: (Span & { value: number }) | null;
  /** [6]: turn this faction became the other's vassal; [7]: turn it became the other's master. */
  vassalSince: (Span & { value: number }) | null;
  masterSince: (Span & { value: number }) | null;
  codes: (Span & { values: number[] }) | null;
}
interface FactionInfo {
  id: number | null;
  key: string;
  chars: CharInfo[];
  forces: ForceInfo[];
  diplo: DiploBlock[];
}
interface SlotInfo {
  strings: string[];
  building: (Span & { text: string }) | null;
  /** BUILDING_BASE direct values: u32 id before the key, the two f32 "building level" values after it. */
  baseId: (Span & { value: number }) | null;
  baseFloats: (Span & { value: number })[];
}
interface RegionInfo {
  strings: string[];
  bools: boolean[];
  slots: SlotInfo[];
  /** Direct u32 values with spans: [0] region id, [3] defence-ish constant, [4] owner faction id (see campaignState.ts). */
  u32s: (Span & { value: number })[];
  /** SETTLEMENT/GARRISON_RESIDENCE direct u32 [6]: id of the garrison MILITARY_FORCE. */
  garrisonForce: number;
}
/** A sorted-or-appended id list stored as an array value (width by marker). */
interface IdList extends Span {
  marker: number;
  values: number[];
}
interface ProvinceManager {
  province: number;
  id: number;
  faction: number;
  regions: IdList | null;
}
/** Parallel arrays of the AI world (CAI_WORLD), indexed alike; see the ownership section of the header comment. */
interface CaiInfo {
  factionOwners: number[];
  settlementRegions: number[];
  settlementOwners: (Span & { value: number })[];
  mobiles: { id: number; force: number }[];
  mobileBdi: number[];
  mobileOwners: Span[];
  characterIds: number[];
  characterOwners: Span[];
  factionLists: Map<number, Map<number, IdList>>;
  regionBdi: number[];
  regionOfRegion: number[];
  factionProvinces: { fpm: number; regions: IdList | null }[];
}

function collect(buffer: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables) {
  const factions: FactionInfo[] = [];
  const families = new Map<number, { charId: number; type: string }>();
  const regions: RegionInfo[] = [];
  let faction: FactionInfo | null = null;
  let character: CharInfo | null = null;
  let force: ForceInfo | null = null;
  let unit: UnitInfo | null = null;
  let family: { id: number | null; charId: number | null; ascii: string[] } | null = null;
  let region: RegionInfo | null = null;
  let slot: SlotInfo | null = null;
  const counters: number[] = [];
  const provinceManagers: ProvinceManager[] = [];
  let provinceIndex = -1;
  let caiFactionIndex = -1;
  const cai: CaiInfo = {
    factionOwners: [], settlementRegions: [], settlementOwners: [], mobiles: [], mobileBdi: [], mobileOwners: [], characterIds: [],
    characterOwners: [], factionLists: new Map(), regionBdi: [], regionOfRegion: [], factionProvinces: [],
  };
  let diploIndex = 0;
  let queueIndex = 0;
  let queueBuildingCounter: (Span & { value: number }) | null = null;
  const span = (v: { startOffset?: number; endOffset?: number }): Span => ({ start: v.startOffset ?? -1, end: v.endOffset ?? -1 });

  walkCaabNodes(buffer, header, tables, {
    onRecordStart(record, stack) {
      const parent = stack[stack.length - 1];
      counters.push(0);
      if (record.name === "PROVINCE" && parent === "PROVINCE_ARRAY") provinceIndex += 1;
      if (record.name === "FACTION_PROVINCE_MANAGER" && parent === "FACTION_PROVINCE_MANAGER_ARRAY")
        provinceManagers.push({ province: provinceIndex, id: -1, faction: -1, regions: null });
      if (record.name === "CAI_FACTION" && parent === "CAI_WORLD_FACTIONS") caiFactionIndex += 1;
      if (record.name === "CAI_FACTION_PROVINCE" && parent === "CAI_FACTION_PROVINCES") cai.factionProvinces.push({ fpm: -1, regions: null });
      if (record.name === "CAI_RESOURCE_MOBILE" && parent === "CAI_WORLD_RESOURCE_MOBILES") cai.mobiles.push({ id: -1, force: -1 });
      switch (record.name) {
        case "FACTION":
          if (parent === "FACTION_ARRAY" && stack[stack.length - 2] === "WORLD") {
            faction = { id: null, key: "", chars: [], forces: [], diplo: [] };
            diploIndex = 0;
          }
          break;
        case "CHARACTER":
          if (faction && parent === "CHARACTER_ARRAY")
            character = { u32s: [], type: "", directU16s: [], locoCoord: null, locoU16s: [], los: [] };
          break;
        case "MILITARY_FORCE":
          if (faction && parent === "ARMY_ARRAY") force = { u32s: [], type: "", units: [] };
          break;
        case "UNIT":
          if (force && parent === "UNITS_ARRAY" && stack[stack.length - 2] === "UNIT_CONTAINER")
            unit = { u32s: [], u32Spans: [], rank: null };
          break;
        case "FAMILY_MEMBER":
          if (parent === "FAMILY_TREE") family = { id: null, charId: null, ascii: [] };
          break;
        case "REGION":
          if (parent === "REGIONS_ARRAY") region = { strings: [], bools: [], slots: [], u32s: [], garrisonForce: 0 };
          break;
        case "CAMPAIGN_COMMAND_QUEUE_INDEX_TABLES":
          queueIndex = 0;
          break;
        case "REGION_SLOT":
          if (region && parent === "REGION_SLOT_ARRAY") slot = { strings: [], building: null, baseId: null, baseFloats: [] };
          break;
        default:
          break;
      }
    },
    onRecordEnd(record, stack) {
      const parent = stack[stack.length - 1];
      counters.pop();
      switch (record.name) {
        case "FACTION":
          if (faction && parent === "FACTION_ARRAY") {
            factions.push(faction);
            faction = null;
          }
          break;
        case "CHARACTER":
          if (faction && character && parent === "CHARACTER_ARRAY") {
            faction.chars.push(character);
            character = null;
          }
          break;
        case "MILITARY_FORCE":
          if (faction && force && parent === "ARMY_ARRAY") {
            faction.forces.push(force);
            force = null;
          }
          break;
        case "UNIT":
          if (force && unit && parent === "UNITS_ARRAY") {
            force.units.push(unit);
            unit = null;
          }
          break;
        case "FAMILY_MEMBER":
          if (family && parent === "FAMILY_TREE") {
            if (family.id !== null && family.charId !== null && family.ascii[2]) {
              families.set(family.id, { charId: family.charId, type: family.ascii[2] });
            }
            family = null;
          }
          break;
        case "REGION":
          if (region && parent === "REGIONS_ARRAY") {
            regions.push(region);
            region = null;
          }
          break;
        case "REGION_SLOT":
          if (region && slot && parent === "REGION_SLOT_ARRAY") {
            region.slots.push(slot);
            slot = null;
          }
          break;
        default:
          break;
      }
    },
    onValue(value, stack) {
      const parent = stack[stack.length - 1];
      const k = counters.length ? counters[counters.length - 1]++ : 0;
      const grand = stack[stack.length - 2];
      const num = value.kind === "value" && typeof value.value === "number" ? value.value : null;
      const list = (): IdList | null => {
        const width = value.kind === "array" ? ID_LIST_WIDTHS[value.marker] : undefined;
        if (value.kind !== "array" || !width || value.value.payloadByteLength % width) return null;
        const payload = buffer.subarray(value.value.payloadOffset, value.value.payloadOffset + value.value.payloadByteLength);
        const values: number[] = [];
        for (let at = 0; at < payload.length; at += width) values.push(width === 3 ? payload.readUIntBE(at, 3) : width === 1 ? payload[at] : width === 2 ? payload.readUInt16LE(at) : payload.readUInt32LE(at));
        return { ...span(value), marker: value.marker, values };
      };
      if (parent === "FACTION_PROVINCE_MANAGER" && grand === "FACTION_PROVINCE_MANAGER_ARRAY") {
        const pm = provinceManagers[provinceManagers.length - 1];
        if (k === 0 && num !== null) pm.id = num;
        else if (k === 1 && num !== null) pm.faction = num;
        else if (k === 2) pm.regions = list();
      } else if (parent === "OWNED_DIRECT" && k === 0 && num !== null) {
        if (grand === "CAI_WORLD_FACTIONS") cai.factionOwners.push(num);
        else if (grand === "CAI_WORLD_SETTLEMENTS") cai.settlementOwners.push({ ...span(value), value: num });
        else if (grand === "CAI_WORLD_RESOURCE_MOBILES") cai.mobileOwners.push(span(value));
      } else if (parent === "OWNED_INDIRECT" && grand === "CAI_WORLD_CHARACTERS" && k === 0) cai.characterOwners.push(span(value));
      else if (parent === "CAI_SETTLEMENT" && grand === "CAI_WORLD_SETTLEMENTS" && k === 2 && num !== null) cai.settlementRegions.push(num);
      else if (parent === "CAI_RESOURCE_MOBILE" && grand === "CAI_WORLD_RESOURCE_MOBILES" && num !== null) {
        const m = cai.mobiles[cai.mobiles.length - 1];
        if (k === 0) m.id = num;
        else if (k === 11) m.force = num;
      } else if (parent === "CAI_BDI_COMPONENT" && k === 0 && num !== null) {
        if (grand === "CAI_WORLD_RESOURCE_MOBILES") cai.mobileBdi.push(num);
        else if (grand === "CAI_WORLD_REGIONS") cai.regionBdi.push(num);
      } else if (parent === "CAI_CHARACTER" && grand === "CAI_WORLD_CHARACTERS" && k === 3 && num !== null) cai.characterIds.push(num);
      else if (parent === "CAI_REGION" && grand === "CAI_WORLD_REGIONS" && k === 10 && num !== null) cai.regionOfRegion.push(num);
      else if (parent === "CAI_FACTION" && grand === "CAI_WORLD_FACTIONS" && (k === 0 || k === 3 || k === 4)) {
        const l = list();
        if (l) {
          const byIndex = cai.factionLists.get(caiFactionIndex) ?? new Map<number, IdList>();
          byIndex.set(k, l);
          cai.factionLists.set(caiFactionIndex, byIndex);
        }
      } else if (parent === "CAI_FACTION_PROVINCE" && grand === "CAI_FACTION_PROVINCES") {
        const fp = cai.factionProvinces[cai.factionProvinces.length - 1];
        if (k === 0 && num !== null) fp.fpm = num;
        else if (k === 2) fp.regions = list();
      } else if (parent === "GARRISON_RESIDENCE" && region && k === 6 && num !== null) region.garrisonForce = num;
      if (parent === "OLD_DIPLOMACY_RELATIONSHIP" && faction && stack[stack.length - 2] === "OLD_DIPLOMACY_MANAGER") {
        const at = diploIndex % DIPLO_GROUP_SIZE;
        diploIndex += 1;
        if (at === 0) faction.diplo.push({ other: value.kind === "value" ? Number(value.value) : -1, stance: null, access: null, vassalSince: null, masterSince: null, codes: null });
        const block = faction.diplo[faction.diplo.length - 1];
        if (at === 2 && value.kind === "value" && value.type === "ascii") block.stance = { ...span(value), text: text(value.value) };
        else if ((at === 6 || at === 7) && value.kind === "value" && value.type === "i32") {
          const entry = { ...span(value), value: Number(value.value) };
          if (at === 6) block.vassalSince = entry;
          else block.masterSince = entry;
        } else if (at === 12 && value.kind === "value" && value.type === "i32") block.access = { ...span(value), value: Number(value.value) };
        else if (at === 14 && value.kind === "array") {
          const payload = buffer.subarray(value.value.payloadOffset, value.value.payloadOffset + value.value.payloadByteLength);
          if (payload.length % 4 === 0 && value.marker === DIPLO_CODES_MARKER) {
            block.codes = { ...span(value), values: Array.from({ length: payload.length / 4 }, (_, i) => payload.readUInt32LE(i * 4)) };
          }
        }
        return;
      }
      if (value.kind !== "value") return;
      switch (parent) {
        case "FACTION":
          if (faction && stack[stack.length - 2] === "FACTION_ARRAY") {
            if (value.type === "u32" && faction.id === null) faction.id = Number(value.value);
            else if (value.type === "ascii" && !faction.key) faction.key = text(value.value);
          }
          break;
        case "CHARACTER":
          if (character && faction) {
            if (value.type === "u32") character.u32s.push(Number(value.value));
            else if (value.type === "u16") character.directU16s.push(Number(value.value));
            else if (value.type === "ascii" && !character.type) character.type = text(value.value);
          }
          break;
        case "LOCOMOTABLE":
          if (character && stack[stack.length - 2] === "CHARACTER") {
            if (value.type === "coord2d" && !character.locoCoord) {
              const c = value.value as { x: number; y: number };
              character.locoCoord = { ...span(value), x: c.x, y: c.y };
            } else if (value.type === "u16" && character.locoU16s.length < 2) {
              character.locoU16s.push({ ...span(value), value: Number(value.value) });
            }
          }
          break;
        case "LINE_OF_SIGHT":
          if (character && stack[stack.length - 2] === "CHARACTER" && value.type === "coord2d" && character.los.length < 2) {
            const c = value.value as { x: number; y: number };
            character.los.push({ ...span(value), x: c.x, y: c.y });
          }
          break;
        case "MILITARY_FORCE":
          if (force && value.type === "u32" && force.u32s.length < 2) force.u32s.push(Number(value.value));
          else if (force && value.type === "ascii" && !force.type) force.type = text(value.value);
          break;
        case "UNIT":
          if (unit) {
            if (value.type === "u32" && unit.u32s.length < 5) {
              unit.u32s.push(Number(value.value));
              unit.u32Spans.push(span(value));
            } else if (value.type === "u8" && unit.rank === null) unit.rank = { ...span(value), value: Number(value.value) };
          }
          break;
        case "FAMILY_MEMBER":
          if (family && value.type === "u32" && family.id === null) family.id = Number(value.value);
          break;
        case "CHARACTER_DETAILS":
          if (family) {
            if (value.type === "u32" && family.charId === null) family.charId = Number(value.value);
            else if (value.type === "ascii") family.ascii.push(text(value.value));
          }
          break;
        case "REGION":
          if (region && value.type === "u32" && region.u32s.length < 5) region.u32s.push({ ...span(value), value: Number(value.value) });
          if (region && value.type === "ascii") region.strings.push(text(value.value));
          else if (region && value.type === "bool") region.bools.push(Boolean(value.value));
          break;
        case "REGION_SLOT":
          if (slot && value.type === "ascii") slot.strings.push(text(value.value));
          break;
        case "BUILDING_BASE":
          if (slot && slot.building === null) {
            if (value.type === "ascii") slot.building = { ...span(value), text: text(value.value) };
            else if (value.type === "u32" && !slot.baseId) slot.baseId = { ...span(value), value: Number(value.value) };
          } else if (slot && value.type === "f32" && slot.baseFloats.length < 2) slot.baseFloats.push({ ...span(value), value: Number(value.value) });
          break;
        case "CAMPAIGN_COMMAND_QUEUE_INDEX_TABLES":
          if (stack[stack.length - 2] === "CAMPAIGN_MODEL") {
            if (queueIndex === QUEUE_BUILDING_ID_INDEX && value.type === "u32") queueBuildingCounter = { ...span(value), value: Number(value.value) };
            queueIndex += 1;
          }
          break;
        default:
          break;
      }
    },
  });
  return { factions, families, regions, queueBuildingCounter: queueBuildingCounter as (Span & { value: number }) | null, provinceManagers, cai };
}

/**
 * Faction references inside a garrison's records, found by a second small pass: every ascii inside the listed MILITARY_FORCEs
 * and FAMILY_MEMBERs (faction keys: unit COMMANDER_DETAILS, family member, CHARACTER_DETAILS, art set info) and each unit's
 * UNIT_HISTORY first u32 (owner faction id). The in-game copy of a transferred garrison differs from the old one only there
 * (plus fresh ids and names), verified on `grunburg` -> `grunburg given`.
 */
function collectGarrisonReferences(buffer: Buffer, header: { recordNamesOffset: number }, tables: CaabStringTables, forceIds: Set<number>, familyIds: Set<number>) {
  const ascii: (Span & { text: string; owner: number })[] = [];
  const history: (Span & { value: number; owner: number })[] = [];
  const frames: { name: string; direct: number; keep: boolean }[] = [];
  let forceDepth = -1;
  let familyDepth = -1;
  const span = (v: { startOffset?: number; endOffset?: number }): Span => ({ start: v.startOffset ?? -1, end: v.endOffset ?? -1 });
  let currentForce = -1;
  let currentFamily = -1;
  walkCaabNodes(buffer, header, tables, {
    onRecordStart(record, stack) {
      frames.push({ name: record.name, direct: 0, keep: false });
      const parent = stack[stack.length - 1];
      if (record.name === "MILITARY_FORCE" && parent === "ARMY_ARRAY") forceDepth = frames.length - 1;
      if (record.name === "FAMILY_MEMBER" && parent === "FAMILY_TREE") familyDepth = frames.length - 1;
    },
    onRecordEnd() {
      const f = frames.pop()!;
      void f;
      if (forceDepth === frames.length) { forceDepth = -1; currentForce = -1; }
      if (familyDepth === frames.length) { familyDepth = -1; currentFamily = -1; }
    },
    onValue(value, stack) {
      const frame = frames[frames.length - 1];
      const k = frame.direct++;
      if (value.kind !== "value") return;
      if (forceDepth >= 0 && frames.length - 1 === forceDepth && k === 0 && value.type === "u32") currentForce = forceIds.has(Number(value.value)) ? Number(value.value) : -1;
      if (familyDepth >= 0 && frames.length - 1 === familyDepth && k === 0 && value.type === "u32") currentFamily = familyIds.has(Number(value.value)) ? Number(value.value) : -1;
      if (forceDepth >= 0 && currentForce >= 0) {
        if (value.type === "ascii") ascii.push({ ...span(value), text: text(value.value), owner: currentForce });
        else if (value.type === "u32" && stack[stack.length - 1] === "UNIT_HISTORY" && k === 0) history.push({ ...span(value), value: Number(value.value), owner: currentForce });
      }
      if (familyDepth >= 0 && currentFamily >= 0 && value.type === "ascii") ascii.push({ ...span(value), text: text(value.value), owner: -currentFamily });
    },
  });
  return { ascii, history };
}

/** Smallest array marker that holds every value (matches the game: Empire's [3] list narrowed from 3 to 2 bytes per id after a removal). */
function encodeIdList(values: number[]): Buffer {
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  const marker = max < 0x100 ? 0x56 : max < 0x10000 ? 0x57 : max < 0x1000000 ? 0x58 : 0x48;
  const width = ID_LIST_WIDTHS[marker];
  const length = values.length * width;
  const prefix = cauleb128Length(length);
  const out = Buffer.alloc(1 + prefix + length);
  out[0] = marker;
  writeCauleb128(out, 1, length);
  values.forEach((v, i) => {
    if (width === 3) out.writeUIntBE(v, 1 + prefix + i * 3, 3);
    else if (width === 1) out[1 + prefix + i] = v;
    else if (width === 2) out.writeUInt16LE(v, 1 + prefix + i * 2);
    else out.writeUInt32LE(v, 1 + prefix + i * 4);
  });
  return out;
}

type TreeRecord = ReturnType<typeof buildCaabTree>;
const childRecord = (node: TreeRecord, name: string): TreeRecord | undefined => {
  for (const group of node.groups) for (const item of group) if (item.kind === "record" && item.name === name) return item;
  return undefined;
};
/** Moves whole array elements between factions' CHARACTER_ARRAY / ARMY_ARRAY records (one group per element). */
function moveGarrisons(root: TreeRecord, moves: { from: number; to: number; kind: "CHARACTER_ARRAY" | "ARMY_ARRAY"; index: number }[]) {
  const world = childRecord(childRecord(childRecord(root, "CAMPAIGN_ENV")!, "CAMPAIGN_MODEL")!, "WORLD")!;
  const factionArray = childRecord(world, "FACTION_ARRAY")!;
  const factionNode = (i: number) => factionArray.groups[i].find((x) => x.kind === "record") as TreeRecord;
  // Resolve every group first: removals shift indices.
  const resolved = moves.map((m) => {
    const fromArray = childRecord(factionNode(m.from), m.kind)!;
    const toArray = childRecord(factionNode(m.to), m.kind)!;
    const group = fromArray.groups[m.index];
    return { fromArray, toArray, group, width: fromArray.groupSizeWidths[m.index] };
  });
  for (const r of resolved) {
    const at = r.fromArray.groups.indexOf(r.group);
    r.fromArray.groups.splice(at, 1);
    r.fromArray.groupSizeWidths.splice(at, 1);
    // An array without elements has no groups at all (verified on the real save), so an emptied source stays empty.
    r.toArray.groups.push(r.group);
    r.toArray.groupSizeWidths.push(r.width);
  }
}

function linearFit(xs: number[], ys: number[]): { a: number; b: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const a = sxy / sxx;
  return { a, b: my - a * mx };
}

const encodeU16 = (value: number): Buffer => {
  const out = Buffer.alloc(3);
  out[0] = 0x07;
  out.writeUInt16LE(value, 1);
  return out;
};
const encodeF32 = (value: number): Buffer => {
  const out = Buffer.alloc(5);
  out[0] = 0x0a;
  out.writeFloatLE(value, 1);
  return out;
};
const encodeI32 = (value: number): Buffer => {
  const out = Buffer.alloc(5);
  out[0] = 0x04;
  out.writeInt32LE(value, 1);
  return out;
};
/** Array value: marker, CAULEB128 byte length, little-endian u32 payload. */
const encodeU32Array = (values: number[]): Buffer => {
  const length = values.length * 4;
  const out = Buffer.alloc(1 + cauleb128Length(length) + length);
  out[0] = DIPLO_CODES_MARKER;
  writeCauleb128(out, 1, length);
  values.forEach((v, i) => out.writeUInt32LE(v, 1 + cauleb128Length(length) + i * 4));
  return out;
};
const encodeCoord2d = (x: number, y: number): Buffer => {
  const out = Buffer.alloc(9);
  out[0] = 0x0c;
  out.writeFloatLE(x, 1);
  out.writeFloatLE(y, 5);
  return out;
};

const healthPercent = (current: number, max: number): number => (max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 100);

/** Synchronous core on a decompressed CAAB/CBAB buffer. Verifies by re-extracting the output. */
export function applyCampaignEditsToEsf(source: Buffer, edits: CampaignEdits, options: ApplyCampaignEditsOptions = {}): ApplyCampaignEditsResult {
  const header = readCaabHeader(source);
  const tables = (header.codecId === 0xabcb ? parseCbabStringTables : parseCaabStringTables)(source, header.recordNamesOffset);
  const baseline = extractCampaignState(source, parseEsfDocument(source));
  const { factions, families, regions, queueBuildingCounter, provinceManagers, cai } = collect(source, header, tables);

  const applied: string[] = [];
  const skipped: string[] = [];

  // Logical -> world fit over every on-map character.
  const fitX: number[] = [], fitY: number[] = [], worldX: number[] = [], worldY: number[] = [];
  for (const f of factions)
    for (const c of f.chars)
      if (c.locoCoord && c.locoU16s.length === 2 && c.locoU16s.every((u) => u.value !== OFF_MAP)) {
        fitX.push(c.locoU16s[0].value);
        fitY.push(c.locoU16s[1].value);
        worldX.push(c.locoCoord.x);
        worldY.push(c.locoCoord.y);
      }
  const fx = linearFit(fitX, worldX);
  const fy = linearFit(fitY, worldY);

  const factionsByKey = new Map<string, FactionInfo[]>();
  for (const f of factions) {
    const k = f.key.toLowerCase();
    factionsByKey.set(k, [...(factionsByKey.get(k) ?? []), f]);
  }
  const findCharacter = (factionKey: string | undefined, id: number) => {
    for (const f of factionsByKey.get((factionKey ?? "").toLowerCase()) ?? []) {
      for (const c of f.chars) {
        const [charId, familyId, forceId] = c.u32s;
        if (charId !== id) continue;
        const member = familyId === undefined ? undefined : families.get(familyId);
        if (!member || member.charId !== charId || member.type !== c.type || c.type === "colonel") return undefined;
        if (c.u32s[c.u32s.length - 1] !== 0) return undefined;
        const army =
          (forceId ? f.forces.find((x) => x.u32s[0] === forceId) : undefined) ?? f.forces.find((x) => x.u32s[1] === charId);
        return { character: c, army };
      }
    }
    return undefined;
  };

  // Expected post-state, built on a clone of the baseline.
  const expected: CampaignState = JSON.parse(JSON.stringify(baseline));
  const replacements = new Map<number, CaabByteReplacement>();
  const put = (span: Span, data: Buffer) => replacements.set(span.start, { start: span.start, end: span.end, data });
  const newStrings = new Map<string, number>();
  const stringIds = new Map<string, number>();
  for (const [id, s] of tables.utf8ById) if (!stringIds.has(s)) stringIds.set(s, id);
  const stringId = (s: string) => {
    let id = stringIds.get(s) ?? newStrings.get(s);
    if (id === undefined) {
      id = appendUtf8String(tables, s);
      newStrings.set(s, id);
    }
    return id;
  };

  const regionByKey = new Map<string, RegionInfo>();
  for (const r of regions) {
    const key = r.strings[0];
    if (key && /_region_/i.test(key) && !regionByKey.has(key.toLowerCase())) regionByKey.set(key.toLowerCase(), r);
  }

  const moveSpans = (c: CharInfo, x: number, y: number): string | null => {
    if (!fx || !fy) return "the save has too few on-map characters to calibrate logical to world coordinates";
    if (!c.locoCoord || c.locoU16s.length < 2) return "the character has no position record";
    const wx = fx.a * x + fx.b;
    const wy = fy.a * y + fy.b;
    put(c.locoU16s[0], encodeU16(x));
    put(c.locoU16s[1], encodeU16(y));
    put(c.locoCoord, encodeCoord2d(wx, wy));
    const dx = wx - c.locoCoord.x;
    const dy = wy - c.locoCoord.y;
    for (const bound of c.los) put(bound, encodeCoord2d(bound.x + dx, bound.y + dy));
    return null;
  };

  // Building level values per chain ("wh_main_emp_barracks_#" -> level number and f32 value) read from the save's own buildings.
  const chainOf = (key: string): { chain: string; level: number } | null => {
    const m = /^(.*?)_(\d+)((?:_[a-z]+)?)$/.exec(key);
    return m ? { chain: `${m[1]}_#${m[3]}`, level: Number(m[2]) } : null;
  };
  const chainValues = new Map<string, { level: number; value: number }>();
  const exactValues = new Map<string, number>();
  for (const r of regions)
    for (const sl of r.slots) {
      if (!sl.building?.text || sl.baseFloats.length < 2 || sl.baseFloats[0].value !== sl.baseFloats[1].value) continue;
      exactValues.set(sl.building.text, sl.baseFloats[0].value);
      const c = chainOf(sl.building.text);
      if (c && !chainValues.has(c.chain)) chainValues.set(c.chain, { level: c.level, value: sl.baseFloats[0].value });
    }
  const buildingLevelValue = (key: string): number | null => {
    const exact = exactValues.get(key);
    if (exact !== undefined) return exact;
    const c = chainOf(key);
    const ref = c ? chainValues.get(c.chain) : undefined;
    return c && ref ? ref.value + (c.level - ref.level) : null;
  };
  let buildingIds = 0;
  // Region ownership transfers. See the header comment for the evidence and the approach (the garrison is moved, not recreated).
  const listsToWrite = new Set<IdList>();
  const moves: { from: number; to: number; kind: "CHARACTER_ARRAY" | "ARMY_ARRAY"; index: number }[] = [];
  const garrisonJobs: { forceId: number; familyId: number; oldKey: string; newKey: string; oldId: number; newId: number }[] = [];
  const transfers: { regionId: number; targetId: number; forceId: number; charId: number; fromIndex: number; toIndex: number; pm: ProvinceManager | null }[] = [];
  const factionIndexById = new Map<number, number>();
  factions.forEach((f, i) => {
    if (f.id !== null && !factionIndexById.has(f.id)) factionIndexById.set(f.id, i);
  });
  const removeFrom = (list: IdList | undefined, id: number): boolean => {
    const at = list ? list.values.indexOf(id) : -1;
    if (!list || at < 0) return false;
    list.values.splice(at, 1);
    listsToWrite.add(list);
    return true;
  };
  const addTo = (list: IdList | undefined, id: number, sorted: boolean): boolean => {
    if (!list || list.values.includes(id)) return false;
    if (sorted && list.values.every((v, i, all) => i === 0 || all[i - 1] <= v)) {
      const at = list.values.findIndex((v) => v > id);
      list.values.splice(at < 0 ? list.values.length : at, 0, id);
    } else list.values.push(id);
    listsToWrite.add(list);
    return true;
  };
  for (const [regionKey, target] of Object.entries(edits.ownership ?? {})) {
    const label = `Region ${regionKey} -> ${target ?? "abandoned"}`;
    if (target === null || target === undefined) {
      skipped.push(`${label}: abandoning a region cannot be written to saves (no verified encoding).`);
      continue;
    }
    const region = regionByKey.get(regionKey.toLowerCase());
    const expectedRegion = expected.regions.find((r) => r.region.toLowerCase() === regionKey.toLowerCase());
    const toFaction = factionsByKey.get(target.toLowerCase())?.[0];
    if (!region || !expectedRegion || region.bools[1] === true || region.u32s.length < 4) {
      skipped.push(`${label}: region not found, or it is abandoned.`);
      continue;
    }
    if (!toFaction || toFaction.id === null) {
      skipped.push(`${label}: faction ${target} not found in the save.`);
      continue;
    }
    const regionId = region.u32s[0].value;
    const ownerId = region.u32s[3].value;
    const fromIndex = factionIndexById.get(ownerId);
    const toIndex = factions.indexOf(toFaction);
    if (fromIndex === undefined) {
      skipped.push(`${label}: the current owner (faction id ${ownerId}) is not in the save.`);
      continue;
    }
    if (fromIndex === toIndex) {
      applied.push(`${label}: already owned by ${toFaction.key}.`);
      continue;
    }
    const from = factions[fromIndex];
    const ownerPm = provinceManagers.find((pm) => pm.faction === ownerId && pm.regions?.values.includes(regionId));
    const targetPm = ownerPm ? provinceManagers.find((pm) => pm.province === ownerPm.province && pm.faction === toFaction.id) : undefined;
    if (!ownerPm?.regions) {
      skipped.push(`${label}: no province record of ${from.key} lists the region.`);
      continue;
    }
    if (ownerPm.regions.values.length < 2) {
      skipped.push(`${label}: it is ${from.key}'s only region in its province; the game would delete that province record.`);
      continue;
    }
    if (!targetPm?.regions && !options.allowMissingProvinceManager) {
      skipped.push(
        `${label}: ${toFaction.key} holds no region in this province, so the game would create a province manager with new AI components, which cannot be reproduced reliably.`,
      );
      continue;
    }
    // Garrison: the colonel CHARACTER and MILITARY_FORCE named by GARRISON_RESIDENCE move to the new owner.
    const forceIndex = region.garrisonForce ? from.forces.findIndex((f) => f.u32s[0] === region.garrisonForce) : -1;
    const force = forceIndex >= 0 ? from.forces[forceIndex] : undefined;
    const charIndex = force ? from.chars.findIndex((c) => c.u32s[0] === force.u32s[1]) : -1;
    const colonel = charIndex >= 0 ? from.chars[charIndex] : undefined;
    if (region.garrisonForce && (!force || !colonel || colonel.type !== "colonel" || !families.has(colonel.u32s[1]))) {
      skipped.push(`${label}: the region's garrison force ${region.garrisonForce} was not found among ${from.key}'s armies.`);
      continue;
    }

    put(region.u32s[3], encodeU32(toFaction.id));
    expectedRegion.faction = toFaction.key;
    removeFrom(ownerPm.regions, regionId);
    if (targetPm?.regions) addTo(targetPm.regions, regionId, false);
    const notes: string[] = [];
    // AI world: settlement owner, then (with the garrison) the garrison's mobile and character owners and the faction id lists.
    const toCai = cai.factionOwners[toIndex];
    const fromCai = cai.factionOwners[fromIndex];
    const settlementAt = cai.settlementRegions.indexOf(regionId);
    if (toCai !== undefined && settlementAt >= 0 && cai.settlementOwners[settlementAt]?.value === fromCai) put(cai.settlementOwners[settlementAt], encodeU32(toCai));
    else notes.push("AI settlement owner left unchanged");
    const fromLists = cai.factionLists.get(fromIndex);
    const toLists = cai.factionLists.get(toIndex);
    const regionCai = cai.regionBdi[cai.regionOfRegion.indexOf(regionId)];
    if (regionCai !== undefined && fromLists?.get(0)?.values.includes(regionCai) && toLists?.get(0)) {
      removeFrom(fromLists.get(0), regionCai);
      addTo(toLists.get(0), regionCai, false);
    } else notes.push("AI faction region list left unchanged");
    const fromFp = cai.factionProvinces.find((fp) => fp.fpm === ownerPm.id);
    const toFp = targetPm ? cai.factionProvinces.find((fp) => fp.fpm === targetPm.id) : undefined;
    if (regionCai !== undefined && fromFp?.regions?.values.includes(regionCai) && toFp?.regions) {
      removeFrom(fromFp.regions, regionCai);
      addTo(toFp.regions, regionCai, false);
    } else notes.push("AI province lists left unchanged");
    if (force && colonel) {
      const mobileAt = cai.mobiles.findIndex((m) => m.force === force.u32s[0]);
      const charAt = cai.characterIds.indexOf(colonel.u32s[0]);
      if (toCai !== undefined && mobileAt >= 0 && cai.mobileOwners[mobileAt]) put(cai.mobileOwners[mobileAt], encodeU32(toCai));
      else notes.push("AI garrison force owner left unchanged");
      if (toCai !== undefined && charAt >= 0 && cai.characterOwners[charAt]) put(cai.characterOwners[charAt], encodeU32(toCai));
      else notes.push("AI garrison character owner left unchanged");
      if (mobileAt >= 0 && fromLists?.get(3)?.values.includes(cai.mobileBdi[mobileAt]) && fromLists.get(4)?.values.includes(cai.mobiles[mobileAt].id) && toLists?.get(3) && toLists.get(4)) {
        removeFrom(fromLists.get(3), cai.mobileBdi[mobileAt]);
        removeFrom(fromLists.get(4), cai.mobiles[mobileAt].id);
        addTo(toLists.get(3), cai.mobileBdi[mobileAt], true);
        addTo(toLists.get(4), cai.mobiles[mobileAt].id, true);
      } else notes.push("AI faction component lists left unchanged");
      moves.push({ from: fromIndex, to: toIndex, kind: "CHARACTER_ARRAY", index: charIndex });
      moves.push({ from: fromIndex, to: toIndex, kind: "ARMY_ARRAY", index: forceIndex });
      garrisonJobs.push({ forceId: force.u32s[0], familyId: colonel.u32s[1], oldKey: from.key, newKey: toFaction.key, oldId: ownerId, newId: toFaction.id });
    }
    transfers.push({ regionId, targetId: toFaction.id, forceId: force?.u32s[0] ?? 0, charId: colonel?.u32s[0] ?? 0, fromIndex, toIndex, pm: targetPm ?? null });
    applied.push(`${label}: owner ${from.key} -> ${toFaction.key}${force ? ", garrison moved" : ""}${targetPm ? "" : ", province record not created (diagnostic mode)"}${notes.length ? ` (${notes.join("; ")})` : ""}.`);
  }
  if (garrisonJobs.length) {
    const refs = collectGarrisonReferences(source, header, tables, new Set(garrisonJobs.map((j) => j.forceId)), new Set(garrisonJobs.map((j) => j.familyId)));
    for (const a of refs.ascii) {
      const job = garrisonJobs.find((j) => (a.owner >= 0 ? j.forceId === a.owner : j.familyId === -a.owner));
      if (job && a.text === job.oldKey) put(a, encodeAscii(stringId(job.newKey)));
    }
    for (const h of refs.history) {
      const job = garrisonJobs.find((j) => j.forceId === h.owner);
      if (job && h.value === job.oldId) put(h, encodeU32(job.newId));
    }
  }
  for (const list of listsToWrite) put(list, encodeIdList(list.values));

  let turnCache: number | null = null;
  const signingTurn = (): number => {
    if (turnCache === null) {
      let highest = 1;
      for (const f of factions) for (const d of f.diplo) highest = Math.max(highest, d.vassalSince?.value ?? 0, d.masterSince?.value ?? 0);
      turnCache = edits.turn !== undefined && Number.isInteger(edits.turn) && edits.turn > 0 ? edits.turn : highest;
    }
    return turnCache;
  };

  for (const action of edits.actions) {
    const label = (() => {
      switch (action.type) {
        case "update_character": return `Character ${action.characterId} (${action.faction})`;
        case "update_unit": return `Unit ${action.unitId} of character ${action.characterId} (${action.faction})`;
        case "set_building": return `Building ${action.region} slot ${action.slotIndex}`;
        default: return action.type;
      }
    })();

    if (action.type === "update_character" && action.characterId !== undefined) {
      const changes = action.changes ?? {};
      const found = findCharacter(action.faction, action.characterId);
      const expectedChar = expected.faction_to_chars
        .find((g) => g.faction.toLowerCase() === (action.faction ?? "").toLowerCase())
        ?.chars.find((c) => c.id === action.characterId);
      for (const field of ["rank", "subtype"] as const)
        if (changes[field]) skipped.push(`${label}: ${field} changes cannot be written to saves.`);
      if (changes.x || changes.y) {
        const x = Number(changes.x?.after ?? expectedChar?.x);
        const y = Number(changes.y?.after ?? expectedChar?.y);
        if (!found || !expectedChar) skipped.push(`${label}: character not found in the save.`);
        else if (expectedChar.x === OFF_MAP || x === OFF_MAP || y === OFF_MAP) skipped.push(`${label}: off-map characters cannot be moved.`);
        else if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 0xfffe || y > 0xfffe) skipped.push(`${label}: position (${x}, ${y}) is out of range.`);
        else {
          const reason = moveSpans(found.character, x, y);
          if (reason) skipped.push(`${label}: ${reason}.`);
          else {
            expectedChar.x = x;
            expectedChar.y = y;
            applied.push(`${label}: moved to (${x}, ${y}).`);
          }
        }
      }
      continue;
    }

    if (action.type === "update_unit" && action.characterId !== undefined) {
      const changes = action.changes ?? {};
      const found = findCharacter(action.faction, action.characterId);
      const unit = found?.army?.units.find((u) => u.u32s[0] === action.unitId);
      const expectedUnit = expected.faction_to_chars
        .find((g) => g.faction.toLowerCase() === (action.faction ?? "").toLowerCase())
        ?.chars.find((c) => c.id === action.characterId)
        ?.units?.find((u) => u.id === action.unitId);
      if (changes.unit_key) skipped.push(`${label}: unit type changes cannot be written to saves.`);
      if (changes.health || changes.xp) {
        if (!unit || !expectedUnit || unit.u32s.length < 5) {
          skipped.push(`${label}: unit not found in the save.`);
          continue;
        }
        if (changes.health) {
          const max = unit.u32s[2];
          const target = Number(changes.health.after);
          if (max <= 0 || !Number.isFinite(target)) skipped.push(`${label}: health cannot be set.`);
          else {
            const current = Math.min(max, Math.max(0, Math.round((max * target) / 100)));
            put(unit.u32Spans[1], encodeU32(current));
            expectedUnit.health = healthPercent(current, max);
            applied.push(`${label}: health ${current}/${max}.`);
          }
        }
        if (changes.xp) {
          const rank = Number(changes.xp.after);
          const currentRank = unit.rank?.value ?? 0;
          const currentXp = unit.u32s[4];
          if (!unit.rank || !Number.isInteger(rank) || rank < 0 || rank >= LAND_RANK_XP_THRESHOLDS.length) {
            skipped.push(`${label}: rank ${changes.xp.after} has no known experience threshold.`);
          } else if (currentXp !== LAND_RANK_XP_THRESHOLDS[currentRank] && !(currentRank === 0 && currentXp < LAND_RANK_XP_THRESHOLDS[1])) {
            skipped.push(`${label}: the unit uses a non-standard experience threshold (${currentXp} points at rank ${currentRank}).`);
          } else {
            put(unit.rank, Buffer.from([0x06, rank]));
            put(unit.u32Spans[4], encodeU32(LAND_RANK_XP_THRESHOLDS[rank]));
            expectedUnit.xp = rank;
            applied.push(`${label}: rank ${rank} (${LAND_RANK_XP_THRESHOLDS[rank]} xp).`);
          }
        }
      }
      continue;
    }

    if (action.type === "set_building" && action.region && action.slotIndex !== undefined) {
      const after = action.after as CampaignEditBuildingSlot | undefined;
      const before = action.before as CampaignEditBuildingSlot | undefined;
      const region = regionByKey.get(action.region.toLowerCase());
      const expectedRegion = expected.regions.find((r) => r.region.toLowerCase() === action.region!.toLowerCase());
      if (!region || !expectedRegion?.buildings) {
        skipped.push(`${label}: region not found or abandoned.`);
        continue;
      }
      const slots = region.slots.filter((s) => s.strings[1] && s.strings[2]);
      const slot = slots[action.slotIndex];
      if (!slot || !after || !before) skipped.push(`${label}: slot not found.`);
      else if (!before.building || !after.building) skipped.push(`${label}: ${!before.building && after.building ? "starting a building in an empty slot queues a construction item, costs and a treasury transaction, which cannot be reproduced" : "clearing a slot cannot be written to saves"}.`);
      else if (!slot.building || slot.building.text !== before.building) skipped.push(`${label}: the save holds "${slot.building?.text ?? ""}", not "${before.building}".`);
      else if (after.type !== slot.strings[2] || after.template !== slot.strings[1]) skipped.push(`${label}: changing the slot type or template is not supported.`);
      else if (slot.strings[2] === "primary") skipped.push(`${label}: a primary building change also opens or closes settlement slots, which cannot be reproduced reliably.`);
      else if (!slot.baseId || slot.baseFloats.length < 2 || !queueBuildingCounter) skipped.push(`${label}: the slot's building record has an unexpected layout.`);
      else {
        const level = buildingLevelValue(after.building);
        if (level === null) {
          skipped.push(`${label}: the level value of ${after.building} cannot be derived from buildings in this save.`);
          continue;
        }
        // The game gives the replacing building a fresh id from the shared counter and sets both f32 level values (5 -> 9 for
        // altdorf_1 -> altdorf_5 equals the key's level difference); the owner string and flags are unchanged.
        buildingIds += 1;
        put(slot.building, encodeAscii(stringId(after.building)));
        put(slot.baseId, encodeU32(queueBuildingCounter.value + buildingIds - 1));
        for (const f of slot.baseFloats) put(f, encodeF32(level));
        expectedRegion.buildings[action.slotIndex].building = after.building;
        applied.push(`${label}: ${before.building} -> ${after.building}.`);
      }
      continue;
    }

    if ((action.type === "set_diplomacy" || action.type === "make_peace") && action.faction && action.targetFaction) {
      const pair = `${action.type === "make_peace" ? "Peace" : "Diplomacy"} ${action.faction} / ${action.targetFaction}`;
      const a = factionsByKey.get(action.faction.toLowerCase())?.[0];
      const b = factionsByKey.get(action.targetFaction.toLowerCase())?.[0];
      if (!a || !b || a === b || a.id === null || b.id === null) {
        skipped.push(`${pair}: faction not found in the save.`);
        continue;
      }
      const expectedA = expected.faction_to_chars.find((g) => g.faction.toLowerCase() === a.key.toLowerCase());
      const expectedB = expected.faction_to_chars.find((g) => g.faction.toLowerCase() === b.key.toLowerCase());
      const blockAB = a.diplo.find((d) => d.other === b.id);
      const blockBA = b.diplo.find((d) => d.other === a.id);
      if (!blockAB || !blockBA) {
        skipped.push(`${pair}: the save has no relationship record for this pair.`);
        continue;
      }
      // Wanted relation set of a -> b. make_peace only ends a war; set_diplomacy states the whole set.
      const current = new Set<DiploField>();
      if (blockAB.stance?.text === "war") current.add("war");
      if (blockAB.stance?.text === "military_allies") current.add("mil_ally");
      if (blockAB.stance?.text === "defensive_allies") current.add("def_ally");
      if (blockAB.stance?.text === "master") current.add("vassals");
      if (blockAB.access?.value === -1) current.add("mil_access");
      if (blockAB.codes?.values.includes(DIPLO_CODE_NON_AGGRESSION)) current.add("non_aggression");
      if (blockAB.codes?.values.includes(DIPLO_CODE_TRADE)) current.add("trade");
      let wanted: Set<DiploField>;
      if (action.type === "make_peace") {
        wanted = new Set(current);
        wanted.delete("war");
      } else {
        const known = (list: unknown): DiploField[] | null =>
          Array.isArray(list) && list.every((f) => (DIPLO_FIELDS as readonly string[]).includes(f)) ? (list as DiploField[]) : null;
        const before = known(action.before);
        const after = known(action.after);
        if (!before || !after) {
          skipped.push(`${pair}: the change has no before/after relation lists.`);
          continue;
        }
        // Apply the before -> after difference on the save's own state, so relations the document cannot show stay as they are.
        wanted = new Set(current);
        for (const f of DIPLO_FIELDS) {
          if (after.includes(f)) wanted.add(f);
          else if (before.includes(f)) wanted.delete(f);
        }
        // Setting an exclusive stance replaces the one it was swapped from (the map UI clears the pair when declaring war).
        const added = DIPLO_STANCE_FIELDS.filter((f) => after.includes(f) && !before.includes(f));
        if (added.length === 1) for (const f of DIPLO_STANCE_FIELDS) if (f !== added[0]) wanted.delete(f);
        if (wanted.has("war")) for (const f of ["non_aggression", "trade", "mil_access"] as const) wanted.delete(f);
      }
      if (DIPLO_STANCE_FIELDS.filter((f) => wanted.has(f)).length > 1) {
        skipped.push(`${pair}: war, alliances and vassalage cannot be combined on one pair.`);
        continue;
      }
      if (blockAB.stance?.text === "vassal") {
        skipped.push(`${pair}: ${a.key} is the vassal of ${b.key}; edit the pair from the master's side.`);
        continue;
      }
      const unknownStance = [blockAB, blockBA].find((blk) => !blk.stance || !DIPLO_STANCES.has(blk.stance.text));
      if (unknownStance) {
        skipped.push(`${pair}: the pair has an unrecognised stance "${unknownStance.stance?.text ?? ""}".`);
        continue;
      }
      if ([blockAB, blockBA].some((blk) => !blk.access || !blk.codes || !blk.vassalSince || !blk.masterSince)) {
        skipped.push(`${pair}: the pair's relationship record has an unexpected layout.`);
        continue;
      }
      const stanceBase = wanted.has("war") ? "war" : wanted.has("mil_ally") ? "military_allies" : wanted.has("def_ally") ? "defensive_allies" : "neutral";
      const isMaster = wanted.has("vassals");
      let changed = false;
      for (const [blk, role] of [[blockAB, "master"], [blockBA, "vassal"]] as const) {
        const stance = isMaster ? role : stanceBase;
        if (blk.stance!.text !== stance) {
          put(blk.stance!, encodeAscii(stringId(stance)));
          changed = true;
        }
        // The signing turn is kept on both sides: [7] on the master's block, [6] on the vassal's.
        const stamps = [[blk.masterSince, isMaster && role === "master"], [blk.vassalSince, isMaster && role === "vassal"]] as const;
        for (const [stamp, set] of stamps) {
          if (!stamp) continue;
          const target = set ? (stamp.value > 0 ? stamp.value : signingTurn()) : 0;
          if (stamp.value !== target) {
            put(stamp, encodeI32(target));
            changed = true;
          }
        }
        if ((blk.access!.value === -1) !== wanted.has("mil_access")) {
          put(blk.access!, encodeI32(wanted.has("mil_access") ? -1 : 0));
          changed = true;
        }
        let codes = blk.codes!.values;
        if (codes.includes(DIPLO_CODE_NON_AGGRESSION) !== wanted.has("non_aggression"))
          codes = wanted.has("non_aggression") ? [...codes, DIPLO_CODE_NON_AGGRESSION] : codes.filter((c) => c !== DIPLO_CODE_NON_AGGRESSION);
        if (codes.includes(DIPLO_CODE_TRADE) !== wanted.has("trade"))
          codes = wanted.has("trade") ? [DIPLO_CODE_TRADE, ...codes] : codes.filter((c) => c !== DIPLO_CODE_TRADE);
        if (codes !== blk.codes!.values) {
          put(blk.codes!, encodeU32Array(codes));
          changed = true;
        }
      }
      if (!changed) {
        applied.push(`${pair}: already in the requested state.`);
        continue;
      }
      for (const [group, other] of [[expectedA, b.key], [expectedB, a.key]] as const) {
        if (!group) continue;
        const lists: Record<string, string[]> = group.diplo as unknown as Record<string, string[]>;
        for (const f of ["war", "mil_ally", "def_ally", "mil_access", "non_aggression", "trade", "vassals"] as const) {
          // `vassals` lists the vassals of the master only; the other side shows nothing.
          const mine = f === "vassals" ? wanted.has("vassals") && group === expectedA : wanted.has(f);
          const list = lists[f];
          const index = list.findIndex((k) => k.toLowerCase() === other.toLowerCase());
          if (mine && index < 0) list.push(other);
          else if (!mine && index >= 0) list.splice(index, 1);
        }
      }
      applied.push(`${pair}: ${wanted.size ? [...wanted].join(", ") : "no treaties"}.`);
      continue;
    }

    const why: Record<string, string> = {
      add_building_slot: "adding a building slot cannot be written to saves yet.",
      add_character: "adding characters cannot be written to saves.",
      remove_character: "removing characters cannot be written to saves.",
      add_unit: "adding units cannot be written to saves.",
      remove_unit: "removing units cannot be written to saves.",
      set_diplomacy: "diplomacy needs faction and targetFaction.",
      make_peace: "peace needs faction and targetFaction.",
      confederate: "confederation cannot be written to saves.",
    };
    skipped.push(`${action.type}${action.faction ? ` (${action.faction}${action.targetFaction ? ` / ${action.targetFaction}` : ""})` : ""}: ${why[action.type] ?? "unsupported action."}`);
  }

  if (buildingIds && queueBuildingCounter) put(queueBuildingCounter, encodeU32(queueBuildingCounter.value + buildingIds));
  if (!replacements.size && !options.alwaysRewrite) return { buffer: source, applied, skipped };

  const root = buildCaabTree(source, header, tables);
  replaceByteRanges(root, [...replacements.values()]);
  if (moves.length) moveGarrisons(root, moves);
  const buffer = writeCaabBuffer({ header, tables, root, source });

  // Re-read the output: exactly the applied edits may differ from the source.
  const actual = extractCampaignState(buffer, parseEsfDocument(buffer));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(actual.regions, expected.regions)) throw new Error("Verification failed: re-extracted regions differ from the expected edit result.");
  const noDiplo = (state: CampaignState) => state.faction_to_chars.map(({ diplo: _diplo, ...rest }) => rest);
  if (!same(noDiplo(actual), noDiplo(expected))) throw new Error("Verification failed: re-extracted characters differ from the expected edit result.");
  if (transfers.length) {
    const h2 = readCaabHeader(buffer);
    const t2 = (h2.codecId === 0xabcb ? parseCbabStringTables : parseCaabStringTables)(buffer, h2.recordNamesOffset);
    const out = collect(buffer, h2, t2);
    for (const t of transfers) {
      const r = out.regions.find((x) => x.u32s[0]?.value === t.regionId);
      const fail = (what: string) => {
        throw new Error(`Verification failed: ${what} (region id ${t.regionId}).`);
      };
      if (r?.u32s[3]?.value !== t.targetId) fail("the region owner was not updated");
      if (out.provinceManagers.some((pm) => pm.faction !== t.targetId && pm.regions?.values.includes(t.regionId))) fail("a province record of another faction still lists the region");
      if (t.pm && !out.provinceManagers.find((pm) => pm.id === t.pm!.id)?.regions?.values.includes(t.regionId)) fail("the new owner's province record does not list the region");
      if (t.forceId) {
        if (!out.factions[t.toIndex].forces.some((f) => f.u32s[0] === t.forceId) || out.factions[t.fromIndex].forces.some((f) => f.u32s[0] === t.forceId)) fail("the garrison force was not moved");
        if (!out.factions[t.toIndex].chars.some((c) => c.u32s[0] === t.charId) || out.factions[t.fromIndex].chars.some((c) => c.u32s[0] === t.charId)) fail("the garrison character was not moved");
      }
    }
  }
  const sortDiplo = (state: CampaignState) =>
    JSON.stringify(
      state.faction_to_chars.map((f) => [f.faction, Object.entries(f.diplo).map(([k, v]) => [k, [...(v as string[])].sort()])]),
    );
  if (sortDiplo(actual) !== sortDiplo(expected)) throw new Error("Verification failed: re-extracted diplomacy differs from the expected edit result.");
  return { buffer, applied, skipped };
}

/** Full pipeline on a (possibly compressed) save: apply, verify by re-extraction, repack and verify the stream. */
export async function applyCampaignEdits(outer: Buffer, edits: CampaignEdits, options: ApplyCampaignEditsOptions = {}): Promise<ApplyCampaignEditsResult> {
  const opened = openEsfBuffer(outer);
  const result = applyCampaignEditsToEsf(opened.buffer, edits, options);
  if (result.buffer === opened.buffer) return { ...result, buffer: outer };
  const buffer = opened.wasCompressed ? (await repackAndVerify(outer, result.buffer)).buffer : result.buffer;
  return { ...result, buffer };
}
