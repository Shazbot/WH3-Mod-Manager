import { EsfDocument } from "../esf/EsfTypes";
import { CaabValue, walkCaabNodes } from "../esf/codecs/caabBinary";

/** Mirrors `ExtendedMapDocument` (src/esfMap/extended.ts); kept local so the tools package has no `src/` imports. */
export interface CampaignStateBuildingSlot {
  building: string;
  type: string;
  template: string;
  resource_key?: string;
}
export interface CampaignStateRegion {
  faction: string | null;
  buildings: CampaignStateBuildingSlot[] | null;
  region: string;
  /** settlement_types key; "" for an ordinary settlement. */
  settlement_type?: string;
}
export interface CampaignStateUnit {
  id: number;
  xp: number;
  health: number;
  unit_key: string;
}
export interface CampaignStateCharacter {
  y: number;
  x: number;
  subtype: string;
  id: number;
  rank: number;
  units?: CampaignStateUnit[];
}
export interface CampaignStateDiplomacy {
  mil_ally: string[];
  non_aggression: string[];
  trade: string[];
  war: string[];
  vassals: string[];
  mil_access: string[];
  def_ally: string[];
}
export interface CampaignStateFaction {
  faction: string;
  chars: CampaignStateCharacter[];
  diplo: CampaignStateDiplomacy;
}
export interface CampaignState {
  /** Campaign key such as `wh3_main_combi`, or null when it cannot be read. */
  campaignKey: string | null;
  regions: CampaignStateRegion[];
  faction_to_chars: CampaignStateFaction[];
  /** Human-readable notes about fields that could not be decoded and were left empty or defaulted. */
  warnings: string[];
}

interface FactionAcc {
  id: number | null;
  key: string;
  chars: CharAcc[];
  forces: ForceAcc[];
  oldVals: { kind: string; type?: string; value: unknown }[];
}
interface CharAcc {
  u32s: number[];
  type: string;
  x: number | null;
  y: number | null;
  u16s: number;
  /** u16 values stored directly on CHARACTER; 65535/65535 unless the character is hidden off the map. */
  directU16s: number[];
}
interface ForceAcc {
  u32s: number[];
  /** First direct ascii: "ARMY", "HORDE", "CHAOTIC_PLAN_SCHEMERS", ... */
  type: string;
  units: UnitAcc[];
}
interface UnitAcc {
  key: string;
  u32s: number[];
  rank: number | null;
}
interface FamilyAcc {
  familyId: number | null;
  detailU32: number | null;
  detailAscii: string[];
  scaling: number | null;
}
interface SlotAcc {
  strings: string[];
  building: string | null;
}
interface RegionAcc {
  u32s: number[];
  strings: string[];
  bools: boolean[];
  slots: SlotAcc[];
  /** Direct asciis of the region's SETTLEMENT: ["settlement:<region>", settlement type, level key, ""]. */
  settlementStrings: string[];
}

const SCALING_SKILL = "wh3_main_skill_agent_action_success_scaling";
const MAX_UNITS = 20;
const OLD_GROUP_SIZE = 15;
/** Off-map position used by the in-game exporter for hidden characters. */
const OFF_MAP = 65535;
/** Codes in the u32 list closing each OLD_DIPLOMACY_RELATIONSHIP block. */
const DIPLO_CODE_NON_AGGRESSION = 1659;
const DIPLO_CODE_TRADE = 4051;
/** Force types whose generals the game keeps off the map. */
const HIDDEN_FORCE_TYPES = new Set(["CHAOTIC_PLAN_SCHEMERS"]);

const text = (value: CaabValue): string => {
  const v = value.value as { text?: string | null } | null;
  return v && typeof v === "object" ? (v.text ?? "") : "";
};

function emptyDiplo(): CampaignStateDiplomacy {
  return { mil_ally: [], non_aggression: [], trade: [], war: [], vassals: [], mil_access: [], def_ally: [] };
}

/**
 * Reads the campaign state from a decompressed CAMPAIGN_STARTPOS or CAMPAIGN_SAVE_GAME ESF: region owners and
 * building slots, characters with their armies, and the diplomacy that is stored decodably.
 *
 * Decoded layouts, verified against a WH3 save and the in-game extended-map export of the same save:
 * - FACTION: direct u32 id, ascii key. CHARACTER: u32 [id, familyMemberId, militaryForceId, ...], ascii type;
 *   LOCOMOTABLE holds the logical x/y as its first two u16 values. "colonel" characters are garrison commanders
 *   and characters whose last direct u32 is non-zero are out of play (wounded/pooled); the exporter omits both.
 *   Hidden characters (direct u16 pair set, generals without a force or of a hidden force type) are off-map.
 * - FAMILY_MEMBER: first u32 is its id; CHARACTER_DETAILS holds the character id as its first direct u32 and has the direct ascii
 *   list [faction, "", type, subtype, ...].
 * - MILITARY_FORCE: u32 [forceId, commanderCharacterId], first ascii is the force type. UNIT: u32 [unitId, current, max, commanderCharacterId,
 *   experiencePoints], then u8 rank (0-9), UNIT_RECORD_KEY holds the unit key. Health is current/max soldiers.
 * - REGION: the fourth direct u32 is the owning faction id, second direct bool = abandoned. The direct asciis
 *   [key, owner, subculture, "", owner, ""] lag behind some scripted transfers, so they are only a fallback.
 * - SETTLEMENT (directly under REGION): ascii ["settlement:<region>", settlement type, level key, ""]; the type is
 *   empty for an ordinary settlement.
 * - REGION_SLOT: ascii [instanceKey, template, type]; the building is the first ascii of its BUILDING_BASE.
 * - OLD_DIPLOMACY_RELATIONSHIP: 15 direct values per other faction (two are empty arrays); [0] other
 *   faction id, [2] stance ("neutral", "war", "military_allies", "defensive_allies", "master" = this faction is the other's
 *   master, "vassal" = it is the other's vassal; [7] / [6] hold the turn the master / vassal treaty was signed), [12] is -1 when military access is granted,
 *   [14] a u32 list where 1659 marks a non-aggression pact and 4051 a trade agreement.
 */
export interface CampaignStateOptions {
  /**
   * `slot_templates_tables` key -> resource, keyed in lower case. Saves do not store a slot's resource, but the game
   * derives it from the slot template, so the caller supplies the DB mapping.
   */
  resourceBySlotTemplate?: Record<string, string>;
}

export function extractCampaignState(
  buffer: Buffer,
  document: EsfDocument,
  options: CampaignStateOptions = {},
): CampaignState {
  const warnings: string[] = [];
  if (!document.metadata) {
    return { campaignKey: null, regions: [], faction_to_chars: [], warnings };
  }

  let preopenKey: string | null = null;
  let setupKey: string | null = null;
  const factions: FactionAcc[] = [];
  let faction: FactionAcc | null = null;
  let character: CharAcc | null = null;
  let force: ForceAcc | null = null;
  let unit: UnitAcc | null = null;
  let family: FamilyAcc | null = null;
  const families = new Map<number, { charId: number; type: string; subtype: string; scaling: number | null }>();
  let region: RegionAcc | null = null;
  let slot: SlotAcc | null = null;
  const regionAccs: RegionAcc[] = [];
  let skillName = "";

  walkCaabNodes(
    buffer,
    { recordNamesOffset: document.header.recordNamesOffset },
    {
      recordNames: document.metadata.recordNames,
      utf8ById: document.metadata.utf8ById,
      utf16ById: document.metadata.utf16ById,
    },
    {
      onRecordStart(record, stack) {
        const parent = stack[stack.length - 1];
        switch (record.name) {
          case "FACTION":
            if (parent === "FACTION_ARRAY" && stack[stack.length - 2] === "WORLD") {
              faction = { id: null, key: "", chars: [], forces: [], oldVals: [] };
            }
            break;
          case "CHARACTER":
            if (faction && parent === "CHARACTER_ARRAY") {
              character = { u32s: [], type: "", x: null, y: null, u16s: 0, directU16s: [] };
            }
            break;
          case "MILITARY_FORCE":
            if (faction && parent === "ARMY_ARRAY") force = { u32s: [], type: "", units: [] };
            break;
          case "UNIT":
            if (force && parent === "UNITS_ARRAY" && stack[stack.length - 2] === "UNIT_CONTAINER") {
              unit = { key: "", u32s: [], rank: null };
            }
            break;
          case "FAMILY_MEMBER":
            if (parent === "FAMILY_TREE") family = { familyId: null, detailU32: null, detailAscii: [], scaling: null };
            break;
          case "REGION":
            if (parent === "REGIONS_ARRAY")
              region = { u32s: [], strings: [], bools: [], slots: [], settlementStrings: [] };
            break;
          case "REGION_SLOT":
            if (region && parent === "REGION_SLOT_ARRAY") slot = { strings: [], building: null };
            break;
          default:
            break;
        }
      },
      onRecordEnd(record, stack) {
        const parent = stack[stack.length - 1];
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
              const type = family.detailAscii[2];
              const subtype = family.detailAscii[3];
              if (family.familyId !== null && family.detailU32 !== null && type && subtype) {
                families.set(family.familyId, { charId: family.detailU32, type, subtype, scaling: family.scaling });
              }
              family = null;
            }
            break;
          case "REGION":
            if (region && parent === "REGIONS_ARRAY") {
              regionAccs.push(region);
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

        if (value.kind === "value" && value.type === "ascii") {
          if (parent === "CAMPAIGN_PREOPEN_MAP_INFO" && stack[stack.length - 2] === "CAMPAIGN_STARTPOS") {
            if (preopenKey === null) preopenKey = text(value);
          } else if (
            parent === "CAMPAIGN_SETUP" &&
            stack[stack.length - 2] === "CAMPAIGN_ENV" &&
            (stack.length === 2 || stack.length === 3)
          ) {
            if (setupKey === null) setupKey = text(value);
          }
        }

        if (parent === "OLD_DIPLOMACY_RELATIONSHIP" && faction && stack[stack.length - 2] === "OLD_DIPLOMACY_MANAGER") {
          faction.oldVals.push({
            kind: value.kind,
            type: value.kind === "value" ? value.type : undefined,
            value:
              value.kind === "value"
                ? value.value
                : buffer.subarray(value.value.payloadOffset, value.value.payloadOffset + value.value.payloadByteLength),
          });
          return;
        }

        if (value.kind !== "value") return;

        switch (parent) {
          case "FACTION":
            if (faction && stack[stack.length - 2] === "FACTION_ARRAY") {
              if (value.type === "u32" && faction.id === null) faction.id = Number(value.value);
              else if (value.type === "ascii" && !faction.key) faction.key = text(value);
            }
            break;
          case "CHARACTER":
            if (character && faction) {
              if (value.type === "u32") character.u32s.push(Number(value.value));
              else if (value.type === "u16") character.directU16s.push(Number(value.value));
              else if (value.type === "ascii" && !character.type) character.type = text(value);
            }
            break;
          case "LOCOMOTABLE":
            if (character && value.type === "u16" && character.u16s < 2) {
              if (character.u16s === 0) character.x = Number(value.value);
              else character.y = Number(value.value);
              character.u16s += 1;
            }
            break;
          case "MILITARY_FORCE":
            if (force && value.type === "u32" && force.u32s.length < 2) force.u32s.push(Number(value.value));
            else if (force && value.type === "ascii" && !force.type) force.type = text(value);
            break;
          case "UNIT":
            if (unit) {
              if (value.type === "u32" && unit.u32s.length < 5) unit.u32s.push(Number(value.value));
              else if (value.type === "u8" && unit.rank === null) unit.rank = Number(value.value);
            }
            break;
          case "UNIT_RECORD_KEY":
            if (unit && value.type === "ascii" && !unit.key) unit.key = text(value);
            break;
          case "FAMILY_MEMBER":
            if (family && value.type === "u32" && family.familyId === null) family.familyId = Number(value.value);
            break;
          case "CHARACTER_DETAILS":
            if (family) {
              if (value.type === "u32" && family.detailU32 === null) family.detailU32 = Number(value.value);
              else if (value.type === "ascii") family.detailAscii.push(text(value));
            }
            break;
          case "CAMPAIGN_SKILLS_BLOCK":
            if (family) {
              if (value.type === "ascii") skillName = text(value);
              else if (value.type === "u32" && skillName === SCALING_SKILL) {
                family.scaling = Number(value.value);
                skillName = "";
              }
            }
            break;
          case "REGION":
            if (region && value.type === "u32") region.u32s.push(Number(value.value));
            else if (region && value.type === "ascii") region.strings.push(text(value));
            else if (region && value.type === "bool") region.bools.push(Boolean(value.value));
            break;
          case "REGION_SLOT":
            if (slot && value.type === "ascii") slot.strings.push(text(value));
            break;
          case "SETTLEMENT":
            if (region && value.type === "ascii" && stack[stack.length - 2] === "REGION")
              region.settlementStrings.push(text(value));
            break;
          case "BUILDING_BASE":
            if (slot && slot.building === null && value.type === "ascii") slot.building = text(value);
            break;
          default:
            break;
        }
      },
    },
  );

  const campaignKey = preopenKey || setupKey || null;

  // Factions, characters, armies, diplomacy.
  const idToKey = new Map<number, string>();
  for (const f of factions) if (f.id !== null && f.key) idToKey.set(f.id, f.key);

  // Regions.
  const regions: CampaignStateRegion[] = [];
  const seenRegions = new Set<string>();
  for (const acc of regionAccs) {
    const key = acc.strings[0];
    if (!key || !/_region_/i.test(key) || seenRegions.has(key.toLowerCase())) continue;
    seenRegions.add(key.toLowerCase());
    const buildings: CampaignStateBuildingSlot[] = [];
    for (const s of acc.slots) {
      const template = s.strings[1];
      const type = s.strings[2];
      if (!template || !type) continue;
      const resource = options.resourceBySlotTemplate?.[template.toLowerCase()];
      buildings.push({ building: s.building ?? "", type, template, ...(resource ? { resource_key: resource } : {}) });
    }
    // The fourth direct u32 is the owner's faction id; the second direct bool marks an abandoned (ownerless) region,
    // whose ruined slots the exporter leaves out.
    const abandoned = acc.bools[1] === true;
    const ownerId = acc.u32s[3];
    const owner = abandoned
      ? null
      : (ownerId === undefined ? undefined : idToKey.get(ownerId)) || acc.strings[4] || acc.strings[1] || null;
    regions.push({
      faction: owner,
      buildings: !abandoned && buildings.length ? buildings : null,
      region: key,
      settlement_type: acc.settlementStrings[1] ?? "",
    });
  }

  const characterIds = new Set<number>();
  const unitIds = new Set<number>();
  const factionKeys = new Set<string>();
  const out: CampaignStateFaction[] = [];
  let unitsTruncated = false;
  let diploMalformed = false;

  for (const f of factions) {
    if (!f.key || factionKeys.has(f.key.toLowerCase())) continue;
    const forcesById = new Map<number, ForceAcc>();
    const forceByCommander = new Map<number, ForceAcc>();
    for (const force of f.forces) {
      if (force.u32s.length < 2) continue;
      forcesById.set(force.u32s[0], force);
      forceByCommander.set(force.u32s[1], force);
    }

    const chars: CampaignStateCharacter[] = [];
    for (const c of f.chars) {
      const [charId, familyId, forceId] = c.u32s;
      const member = familyId === undefined ? undefined : families.get(familyId);
      if (
        charId === undefined ||
        !member ||
        member.charId !== charId ||
        member.type !== c.type ||
        c.x === null ||
        c.y === null ||
        characterIds.has(charId)
      )
        continue;
      if (c.type === "colonel" || c.u32s[c.u32s.length - 1] !== 0) continue;
      characterIds.add(charId);
      const army = (forceId ? forcesById.get(forceId) : undefined) ?? forceByCommander.get(charId);
      // Ranks are not stored directly; the success-scaling skill tracks rank - 1, and matched every character of the
      // in-game export. Characters without it are rank 1 there too.
      const rank = member.scaling !== null ? Math.min(50, Math.max(1, member.scaling + 1)) : 1;
      const hidden =
        c.directU16s.some((value) => value !== OFF_MAP) ||
        (c.type === "general" && (!army || HIDDEN_FORCE_TYPES.has(army.type)));
      const entry: CampaignStateCharacter = {
        y: hidden ? OFF_MAP : c.y,
        x: hidden ? OFF_MAP : c.x,
        subtype: member.subtype,
        id: charId,
        rank,
      };
      if (army) {
        const units: CampaignStateUnit[] = [];
        for (const u of army.units) {
          if (!u.key || u.u32s.length < 3 || unitIds.has(u.u32s[0])) continue;
          if (units.length >= MAX_UNITS) {
            unitsTruncated = true;
            break;
          }
          unitIds.add(u.u32s[0]);
          const [id, current, max] = u.u32s;
          const health = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 100;
          units.push({ id, xp: Math.min(9, Math.max(0, u.rank ?? 0)), health, unit_key: u.key });
        }
        if (units.length) entry.units = units;
      }
      chars.push(entry);
    }

    const diplo = emptyDiplo();
    if (f.oldVals.length % OLD_GROUP_SIZE !== 0) diploMalformed = true;
    else {
      for (let i = 0; i < f.oldVals.length; i += OLD_GROUP_SIZE) {
        const g = f.oldVals.slice(i, i + OLD_GROUP_SIZE);
        if (g[0].type !== "u32" || g[2].type !== "ascii" || g[12].type !== "i32" || !Buffer.isBuffer(g[14].value)) {
          diploMalformed = true;
          break;
        }
        const other = idToKey.get(Number(g[0].value));
        if (!other) continue;
        const stance = (g[2].value as { text?: string | null }).text ?? "";
        if (stance === "war") diplo.war.push(other);
        else if (stance === "military_allies") diplo.mil_ally.push(other);
        else if (stance === "defensive_allies") diplo.def_ally.push(other);
        else if (stance === "master") diplo.vassals.push(other);
        if (Number(g[12].value) === -1) diplo.mil_access.push(other);
        const codes = g[14].value as Buffer;
        for (let offset = 0; offset + 4 <= codes.length; offset += 4) {
          const code = codes.readUInt32LE(offset);
          if (code === DIPLO_CODE_NON_AGGRESSION) diplo.non_aggression.push(other);
          else if (code === DIPLO_CODE_TRADE) diplo.trade.push(other);
        }
      }
    }

    // Like the in-game exporter, list only factions with characters; others may still be named in diplomacy.
    if (!chars.length) continue;
    factionKeys.add(f.key.toLowerCase());
    out.push({ faction: f.key, chars, diplo });
  }

  if (!options.resourceBySlotTemplate) {
    warnings.push("Building resource keys could not be resolved without the slot template table and were left out.");
  }
  if (unitsTruncated) warnings.push("Armies with more than 20 units were truncated to 20.");
  if (diploMalformed) warnings.push("Some diplomacy records had an unexpected layout and were skipped.");

  return { campaignKey, regions, faction_to_chars: out, warnings };
}
