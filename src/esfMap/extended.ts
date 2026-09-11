import type { BuiltBuildingsData, BuildingVariantRow, RegionSlot } from "../buildingsData/types";
import { expandChainSet, pickCultureVariant } from "../buildingsData/derive";
import type { UnitViewerCatalogUnit } from "../unitViewer/types";

/** The on-disk representation emitted by map_out3.json. */
export interface ExtendedMapBuildingSlot {
  building: string;
  type: string;
  template: string;
  resource_key?: string;
}

export interface ExtendedMapRegion {
  faction: string | null;
  buildings: ExtendedMapBuildingSlot[] | null;
  region: string;
}

export interface ExtendedMapUnit {
  id: number;
  xp: number;
  health: number;
  unit_key: string;
}

export interface ExtendedMapCharacter {
  y: number;
  x: number;
  subtype: string;
  id: number;
  rank: number;
  units?: ExtendedMapUnit[];
}

export interface ExtendedMapFactionCharacters {
  chars: ExtendedMapCharacter[];
  faction: string;
}

export interface ExtendedMapDocument {
  regions: ExtendedMapRegion[];
  faction_to_chars: ExtendedMapFactionCharacters[];
}

export type ParsedMapFile =
  | { format: "legacy"; ownership: Record<string, string | null> }
  | { format: "extended"; document: ExtendedMapDocument };

export type ParseMapFileResult = ParsedMapFile | { error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const describePath = (path: string) => (path ? ` at ${path}` : "");

const integer = (value: unknown, path: string, min?: number, max?: number): number | string => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return `Expected an integer${describePath(path)}.`;
  if (min !== undefined && value < min) return `Expected a value of at least ${min}${describePath(path)}.`;
  if (max !== undefined && value > max) return `Expected a value of at most ${max}${describePath(path)}.`;
  return value;
};

const finiteNumber = (value: unknown, path: string, min?: number, max?: number): number | string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return `Expected a finite number${describePath(path)}.`;
  if (min !== undefined && value < min) return `Expected a value of at least ${min}${describePath(path)}.`;
  if (max !== undefined && value > max) return `Expected a value of at most ${max}${describePath(path)}.`;
  return value;
};

const requiredString = (value: unknown, allowEmpty = false): string | undefined => {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) return undefined;
  return value;
};

const parseBuildingSlot = (value: unknown, path: string): ExtendedMapBuildingSlot | string => {
  if (!isRecord(value)) return `Expected a building slot object${describePath(path)}.`;
  const building = requiredString(value.building, true);
  if (building === undefined) return `Expected a string at ${path}.building.`;
  if (building !== "" && !building.trim()) return `Expected an empty or non-whitespace string at ${path}.building.`;
  const type = requiredString(value.type);
  if (type === undefined) return `Expected a non-empty string at ${path}.type.`;
  const template = requiredString(value.template);
  if (template === undefined) return `Expected a non-empty string at ${path}.template.`;
  const slot: ExtendedMapBuildingSlot = { building, type, template };
  if (value.resource_key !== undefined) {
    const resource = requiredString(value.resource_key);
    if (resource === undefined) return `Expected a non-empty string at ${path}.resource_key.`;
    slot.resource_key = resource;
  }
  return slot;
};

const parseUnit = (value: unknown, path: string): ExtendedMapUnit | string => {
  if (!isRecord(value)) return `Expected a unit object${describePath(path)}.`;
  const id = integer(value.id, `${path}.id`, 0);
  if (typeof id !== "number") return id;
  const xp = integer(value.xp, `${path}.xp`, 0, 9);
  if (typeof xp !== "number") return xp;
  const health = finiteNumber(value.health, `${path}.health`, 0, 100);
  if (typeof health !== "number") return health;
  const unitKey = requiredString(value.unit_key);
  if (unitKey === undefined) return `Expected a non-empty string at ${path}.unit_key.`;
  return { id, xp, health, unit_key: unitKey };
};

const parseCharacter = (value: unknown, path: string): ExtendedMapCharacter | string => {
  if (!isRecord(value)) return `Expected a character object${describePath(path)}.`;
  const y = integer(value.y, `${path}.y`, 0);
  if (typeof y !== "number") return y;
  const x = integer(value.x, `${path}.x`, 0);
  if (typeof x !== "number") return x;
  const subtype = requiredString(value.subtype);
  if (subtype === undefined) return `Expected a non-empty string at ${path}.subtype.`;
  const id = integer(value.id, `${path}.id`, 0);
  if (typeof id !== "number") return id;
  const rank = integer(value.rank, `${path}.rank`, 1, 50);
  if (typeof rank !== "number") return rank;
  const character: ExtendedMapCharacter = { y, x, subtype, id, rank };
  if (value.units !== undefined) {
    if (!Array.isArray(value.units)) return `Expected an array of units at ${path}.units.`;
    const units: ExtendedMapUnit[] = [];
    for (const [index, unitValue] of value.units.entries()) {
      const unit = parseUnit(unitValue, `${path}.units[${index}]`);
      if (typeof unit === "string") return unit;
      units.push(unit);
    }
    if (units.length > 20) return `An army may contain at most 20 units${describePath(`${path}.units`)}.`;
    character.units = units;
  }
  return character;
};

const parseExtendedDocument = (
  parsed: Record<string, unknown>,
): { document: ExtendedMapDocument } | { error: string } => {
  if (!Array.isArray(parsed.regions)) return { error: "Expected an extended map file with a regions array." };
  if (!Array.isArray(parsed.faction_to_chars))
    return { error: "Expected an extended map file with a faction_to_chars array." };

  const regions: ExtendedMapRegion[] = [];
  const regionKeys = new Set<string>();
  for (const [index, value] of parsed.regions.entries()) {
    const path = `regions[${index}]`;
    if (!isRecord(value)) return { error: `Expected a region object at ${path}.` };
    const region = requiredString(value.region);
    if (region === undefined) return { error: `Expected a non-empty string at ${path}.region.` };
    const regionKey = region.toLowerCase();
    if (regionKeys.has(regionKey)) return { error: `Duplicate region key "${region}" at ${path}.` };
    regionKeys.add(regionKey);
    let faction: string | null;
    if (value.faction === null) faction = null;
    else {
      const parsedFaction = requiredString(value.faction);
      if (parsedFaction === undefined) return { error: `Expected a non-empty string at ${path}.faction.` };
      faction = parsedFaction;
    }
    let buildings: ExtendedMapBuildingSlot[] | null;
    if (value.buildings === null || value.buildings === undefined) buildings = null;
    else {
      if (!Array.isArray(value.buildings)) return { error: `Expected an array or null at ${path}.buildings.` };
      buildings = [];
      for (const [slotIndex, slotValue] of value.buildings.entries()) {
        const slot = parseBuildingSlot(slotValue, `${path}.buildings[${slotIndex}]`);
        if (typeof slot === "string") return { error: slot };
        buildings.push(slot);
      }
    }
    regions.push({ faction, buildings, region });
  }

  const faction_to_chars: ExtendedMapFactionCharacters[] = [];
  const factionKeys = new Set<string>();
  const characterIds = new Set<number>();
  const unitIds = new Set<number>();
  for (const [index, value] of parsed.faction_to_chars.entries()) {
    const path = `faction_to_chars[${index}]`;
    if (!isRecord(value)) return { error: `Expected a faction character group object at ${path}.` };
    const faction = requiredString(value.faction);
    if (faction === undefined) return { error: `Expected a non-empty string at ${path}.faction.` };
    const factionKey = faction.toLowerCase();
    if (factionKeys.has(factionKey)) return { error: `Duplicate faction character group "${faction}" at ${path}.` };
    factionKeys.add(factionKey);
    if (!Array.isArray(value.chars)) return { error: `Expected an array at ${path}.chars.` };
    const chars: ExtendedMapCharacter[] = [];
    for (const [charIndex, charValue] of value.chars.entries()) {
      const character = parseCharacter(charValue, `${path}.chars[${charIndex}]`);
      if (typeof character === "string") return { error: character };
      if (characterIds.has(character.id)) return { error: `Duplicate character id ${character.id}.` };
      characterIds.add(character.id);
      for (const unit of character.units ?? []) {
        if (unitIds.has(unit.id)) return { error: `Duplicate unit id ${unit.id}.` };
        unitIds.add(unit.id);
      }
      chars.push(character);
    }
    faction_to_chars.push({ chars, faction });
  }
  return { document: { regions, faction_to_chars } };
};

/** Parses either the old flat ownership object or the extended map_out3 document. */
export const parseMapFile = (text: string): ParseMapFileResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!isRecord(parsed)) return { error: "Expected a JSON object." };
  const hasRegionsField = Object.prototype.hasOwnProperty.call(parsed, "regions");
  const hasFactionCharactersField = Object.prototype.hasOwnProperty.call(parsed, "faction_to_chars");
  // A legacy ownership object is allowed to use any region key, including the literal words
  // "regions" and "faction_to_chars". Array-shaped markers switch formats immediately; when both
  // reserved keys are scalar, retain the old flat-object behavior if every value is a valid owner,
  // while malformed two-key documents still receive the useful extended schema error.
  const isValidLegacyShape = Object.values(parsed).every((value) => value === null || typeof value === "string");
  if (
    Array.isArray(parsed.regions) ||
    Array.isArray(parsed.faction_to_chars) ||
    (hasRegionsField && hasFactionCharactersField && !isValidLegacyShape)
  ) {
    const extended = parseExtendedDocument(parsed);
    return "error" in extended ? extended : { format: "extended", document: extended.document };
  }
  const ownership: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const regionKey = key.trim();
    if (!regionKey) continue;
    if (value !== null && typeof value !== "string")
      return { error: `Region "${regionKey}" has a ${typeof value} owner; expected a faction key or null.` };
    ownership[regionKey] = typeof value === "string" ? value.trim() || null : null;
  }
  return { format: "legacy", ownership };
};

/** Strict extended-only parser for callers that already selected the map_out3 format. */
export const parseExtendedMapFile = (text: string): { document: ExtendedMapDocument } | { error: string } => {
  const parsed = parseMapFile(text);
  if ("error" in parsed) return parsed;
  return parsed.format === "extended" ? { document: parsed.document } : { error: "Expected an extended map file." };
};

export const parseExtendedMap = parseExtendedMapFile;

/** A JSON-safe clone used to keep the imported document immutable while edits accumulate. */
export const cloneExtendedMap = (document: ExtendedMapDocument): ExtendedMapDocument =>
  JSON.parse(JSON.stringify(document)) as ExtendedMapDocument;

/**
 * Adds virtual empty slots up to the settlement's active-slot count. The returned slots are only a
 * render/edit surface; callers append them to the document through `add_building_slot` when one is
 * actually changed, so merely opening a settlement never creates a delta.
 */
export const fillExtendedBuildingSlots = (
  buildings: ExtendedMapBuildingSlot[],
  slotTemplates: RegionSlot[],
  maxSlotCount?: number,
): ExtendedMapBuildingSlot[] => {
  const slots = [...buildings];
  if (typeof maxSlotCount !== "number" || !Number.isSafeInteger(maxSlotCount) || maxSlotCount <= slots.length)
    return slots;

  const normalSlotTemplates = slotTemplates.filter(
    (slot) => !slot.isForeignSlot && slot.slotType.toLowerCase() !== "foreign",
  );
  for (let slotIndex = slots.length; slotIndex < maxSlotCount; slotIndex += 1) {
    const template = normalSlotTemplates[slotIndex];
    if (!template) break;
    slots.push({ building: "", type: template.slotType, template: template.slotTemplate });
  }
  return slots;
};

export const formatExtendedMapJson = (document: ExtendedMapDocument): string =>
  `${JSON.stringify(document, undefined, 2)}\n`;

export interface ExtendedMapEditState {
  baseline: ExtendedMapDocument;
  document: ExtendedMapDocument;
  nextUnitId: number;
}

export const createExtendedMapEditState = (baseline: ExtendedMapDocument): ExtendedMapEditState => {
  const document = cloneExtendedMap(baseline);
  const maxUnitId = document.faction_to_chars.reduce(
    (max, group) =>
      group.chars.reduce(
        (groupMax, character) =>
          (character.units ?? []).reduce((characterMax, unit) => Math.max(characterMax, unit.id), groupMax),
        max,
      ),
    -1,
  );
  if (maxUnitId >= Number.MAX_SAFE_INTEGER) throw new Error("No safe id is available for a new unit.");
  return { baseline: cloneExtendedMap(baseline), document, nextUnitId: maxUnitId + 1 };
};

export type ExtendedMapEditAction =
  | { type: "set_building"; region: string; slotIndex: number; building: ExtendedMapBuildingSlot }
  | { type: "add_building_slot"; region: string; slotIndex: number; building: ExtendedMapBuildingSlot }
  | {
      type: "update_character";
      faction: string;
      characterId: number;
      changes: Partial<Pick<ExtendedMapCharacter, "x" | "y" | "rank" | "subtype">>;
    }
  | { type: "remove_character"; faction: string; characterId: number }
  | { type: "add_unit"; faction: string; characterId: number; unit?: Partial<ExtendedMapUnit>; index?: number }
  | { type: "remove_unit"; faction: string; characterId: number; unitId: number }
  | {
      type: "update_unit";
      faction: string;
      characterId: number;
      unitId: number;
      changes: Partial<Pick<ExtendedMapUnit, "unit_key" | "xp" | "health">>;
    };

const findGroup = (document: ExtendedMapDocument, faction: string) =>
  typeof faction === "string"
    ? document.faction_to_chars.find((group) => group.faction.toLowerCase() === faction.toLowerCase())
    : undefined;

const findCharacter = (document: ExtendedMapDocument, faction: string, characterId: number) =>
  findGroup(document, faction)?.chars.find((character) => character.id === characterId);

const validateCharacterChange = (changes: ExtendedMapEditAction & { type: "update_character" }) => {
  if (!changes || typeof changes.changes !== "object" || changes.changes === null || Array.isArray(changes.changes))
    throw new Error("Character changes must be an object.");
  if (changes.changes.x !== undefined && (!Number.isSafeInteger(changes.changes.x) || changes.changes.x < 0))
    throw new Error("Character x must be a non-negative integer.");
  if (changes.changes.y !== undefined && (!Number.isSafeInteger(changes.changes.y) || changes.changes.y < 0))
    throw new Error("Character y must be a non-negative integer.");
  if (
    changes.changes.rank !== undefined &&
    (!Number.isSafeInteger(changes.changes.rank) || changes.changes.rank < 1 || changes.changes.rank > 50)
  )
    throw new Error("Character rank must be an integer from 1 to 50.");
  if (
    changes.changes.subtype !== undefined &&
    (typeof changes.changes.subtype !== "string" || !changes.changes.subtype.trim())
  )
    throw new Error("Character subtype cannot be empty.");
};

const validateBuildingSlot = (building: ExtendedMapBuildingSlot) => {
  if (!building || typeof building !== "object") throw new Error("Building slot must be an object.");
  if (typeof building.building !== "string") throw new Error("Building key must be a string.");
  if (building.building !== "" && !building.building.trim()) throw new Error("Building key cannot be whitespace.");
  if (typeof building.type !== "string" || !building.type.trim())
    throw new Error("Building slot type cannot be empty.");
  if (typeof building.template !== "string" || !building.template.trim())
    throw new Error("Building slot template cannot be empty.");
  if (
    building.resource_key !== undefined &&
    (typeof building.resource_key !== "string" || !building.resource_key.trim())
  )
    throw new Error("Building resource key cannot be empty.");
};

/** Applies one validated edit. Invalid actions throw a user-facing error rather than corrupting the document. */
export const applyExtendedMapEdit = (
  state: ExtendedMapEditState,
  action: ExtendedMapEditAction,
): ExtendedMapEditState => {
  const document = cloneExtendedMap(state.document);
  if (action.type === "set_building") {
    validateBuildingSlot(action.building);
    if (typeof action.region !== "string" || !action.region.trim()) throw new Error("Region key is required.");
    if (!Number.isSafeInteger(action.slotIndex) || action.slotIndex < 0)
      throw new Error("Building slot index must be a non-negative integer.");
    const region = document.regions.find((candidate) => candidate.region.toLowerCase() === action.region.toLowerCase());
    if (!region || !region.buildings || !region.buildings[action.slotIndex])
      throw new Error("Building slot was not found.");
    region.buildings[action.slotIndex] = {
      building: action.building.building,
      type: action.building.type,
      template: action.building.template,
      ...(action.building.resource_key ? { resource_key: action.building.resource_key } : {}),
    };
  } else if (action.type === "add_building_slot") {
    validateBuildingSlot(action.building);
    if (typeof action.region !== "string" || !action.region.trim()) throw new Error("Region key is required.");
    if (!Number.isSafeInteger(action.slotIndex) || action.slotIndex < 0)
      throw new Error("Building slot index must be a non-negative integer.");
    const region = document.regions.find((candidate) => candidate.region.toLowerCase() === action.region.toLowerCase());
    if (!region || !region.buildings) throw new Error("Building slots were not found.");
    if (action.slotIndex !== region.buildings.length) throw new Error("New building slots must be appended in order.");
    region.buildings.push({
      building: action.building.building,
      type: action.building.type,
      template: action.building.template,
      ...(action.building.resource_key ? { resource_key: action.building.resource_key } : {}),
    });
  } else if (action.type === "update_character") {
    validateCharacterChange(action);
    const character = findCharacter(document, action.faction, action.characterId);
    if (!character) throw new Error("Character was not found.");
    Object.assign(character, action.changes);
  } else if (action.type === "remove_character") {
    const group = findGroup(document, action.faction);
    if (!group) throw new Error("Character was not found.");
    const characterIndex = group.chars.findIndex((character) => character.id === action.characterId);
    if (characterIndex < 0) throw new Error("Character was not found.");
    group.chars.splice(characterIndex, 1);
  } else {
    const character = findCharacter(document, action.faction, action.characterId);
    if (!character) throw new Error("Character was not found.");
    if (!character.units) character.units = [];
    if (action.type === "add_unit") {
      if (action.index !== undefined && (!Number.isSafeInteger(action.index) || action.index < 0))
        throw new Error("Unit insertion index must be a non-negative integer.");
      if (character.units.length >= 20) throw new Error("An army may contain at most 20 units.");
      if (!Number.isSafeInteger(state.nextUnitId) || state.nextUnitId < 0)
        throw new Error("No safe id is available for a new unit.");
      const unitKey = action.unit?.unit_key;
      if (typeof unitKey !== "string" || !unitKey.trim()) throw new Error("A unit key is required.");
      const unit: ExtendedMapUnit = {
        id: state.nextUnitId,
        xp: action.unit?.xp ?? 0,
        health: action.unit?.health ?? 100,
        unit_key: unitKey.trim(),
      };
      if (!Number.isSafeInteger(unit.xp) || unit.xp < 0 || unit.xp > 9)
        throw new Error("Unit XP must be an integer from 0 to 9.");
      if (!Number.isFinite(unit.health) || unit.health < 0 || unit.health > 100)
        throw new Error("Unit health must be a number from 0 to 100.");
      const index =
        action.index === undefined
          ? character.units.length
          : Math.max(0, Math.min(character.units.length, action.index));
      character.units.splice(index, 0, unit);
      return { ...state, document, nextUnitId: state.nextUnitId + 1 };
    }
    const unitIndex = character.units.findIndex((unit) => unit.id === action.unitId);
    if (unitIndex < 0) throw new Error("Unit was not found.");
    if (action.type === "remove_unit") character.units.splice(unitIndex, 1);
    else {
      if (!action.changes || typeof action.changes !== "object" || Array.isArray(action.changes))
        throw new Error("Unit changes must be an object.");
      if (
        action.changes.unit_key !== undefined &&
        (typeof action.changes.unit_key !== "string" || !action.changes.unit_key.trim())
      )
        throw new Error("A unit key is required.");
      if (
        action.changes.xp !== undefined &&
        (!Number.isSafeInteger(action.changes.xp) || action.changes.xp < 0 || action.changes.xp > 9)
      )
        throw new Error("Unit XP must be an integer from 0 to 9.");
      if (
        action.changes.health !== undefined &&
        (!Number.isFinite(action.changes.health) || action.changes.health < 0 || action.changes.health > 100)
      )
        throw new Error("Unit health must be a number from 0 to 100.");
      Object.assign(character.units[unitIndex], {
        ...action.changes,
        ...(action.changes.unit_key !== undefined ? { unit_key: action.changes.unit_key.trim() } : {}),
      });
    }
  }
  return { ...state, document };
};

export interface ExtendedMapDelta {
  version: 1;
  actions: ExtendedMapDeltaAction[];
}

export type ExtendedMapDeltaAction =
  | {
      type: "set_building";
      region: string;
      slotIndex: number;
      before: ExtendedMapBuildingSlot;
      after: ExtendedMapBuildingSlot;
    }
  | {
      type: "add_building_slot";
      region: string;
      slotIndex: number;
      building: ExtendedMapBuildingSlot;
    }
  | {
      type: "update_character";
      faction: string;
      characterId: number;
      changes: Partial<Record<"x" | "y" | "rank" | "subtype", { before: number | string; after: number | string }>>;
    }
  | { type: "remove_character"; faction: string; characterId: number; index: number; character: ExtendedMapCharacter }
  | { type: "add_unit"; faction: string; characterId: number; index: number; unit: ExtendedMapUnit }
  | { type: "remove_unit"; faction: string; characterId: number; index: number; unit: ExtendedMapUnit }
  | {
      type: "update_unit";
      faction: string;
      characterId: number;
      unitId: number;
      index: number;
      changes: Partial<Record<"unit_key" | "xp" | "health", { before: number | string; after: number | string }>>;
    };

const equal = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);

/** Builds a deterministic sidecar delta. Reverted edits naturally disappear because this compares baselines. */
export const buildExtendedMapDelta = (before: ExtendedMapDocument, after: ExtendedMapDocument): ExtendedMapDelta => {
  const actions: ExtendedMapDeltaAction[] = [];
  const beforeRegions = new Map(before.regions.map((region) => [region.region.toLowerCase(), region]));
  for (const afterRegion of after.regions) {
    const beforeRegion = beforeRegions.get(afterRegion.region.toLowerCase());
    if (!beforeRegion || !beforeRegion.buildings || !afterRegion.buildings) continue;
    const count = Math.max(beforeRegion.buildings.length, afterRegion.buildings.length);
    for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
      const oldSlot = beforeRegion.buildings[slotIndex];
      const newSlot = afterRegion.buildings[slotIndex];
      if (oldSlot && newSlot && !equal(oldSlot, newSlot))
        actions.push({ type: "set_building", region: afterRegion.region, slotIndex, before: oldSlot, after: newSlot });
      else if (!oldSlot && newSlot)
        actions.push({ type: "add_building_slot", region: afterRegion.region, slotIndex, building: newSlot });
    }
  }

  const beforeGroups = new Map(before.faction_to_chars.map((group) => [group.faction.toLowerCase(), group]));
  for (const afterGroup of after.faction_to_chars) {
    const beforeGroup = beforeGroups.get(afterGroup.faction.toLowerCase());
    if (!beforeGroup) continue;
    const beforeChars = new Map(beforeGroup.chars.map((character, index) => [character.id, { character, index }]));
    const afterCharacterIds = new Set(afterGroup.chars.map((character) => character.id));
    for (const [id, beforeEntry] of beforeChars) {
      if (!afterCharacterIds.has(id))
        actions.push({
          type: "remove_character",
          faction: afterGroup.faction,
          characterId: id,
          index: beforeEntry.index,
          character: beforeEntry.character,
        });
    }
    for (const afterCharacter of afterGroup.chars) {
      const beforeCharacter = beforeChars.get(afterCharacter.id)?.character;
      if (!beforeCharacter) continue;
      const characterChanges: NonNullable<Extract<ExtendedMapDeltaAction, { type: "update_character" }>["changes"]> =
        {};
      for (const field of ["x", "y", "rank", "subtype"] as const) {
        if (beforeCharacter[field] !== afterCharacter[field])
          characterChanges[field] = { before: beforeCharacter[field], after: afterCharacter[field] };
      }
      if (Object.keys(characterChanges).length > 0)
        actions.push({
          type: "update_character",
          faction: afterGroup.faction,
          characterId: afterCharacter.id,
          changes: characterChanges,
        });

      const oldUnits = beforeCharacter.units ?? [];
      const newUnits = afterCharacter.units ?? [];
      const oldById = new Map(oldUnits.map((unit, index) => [unit.id, { unit, index }]));
      const newById = new Map(newUnits.map((unit, index) => [unit.id, { unit, index }]));
      for (const [id, oldEntry] of oldById) {
        if (!newById.has(id))
          actions.push({
            type: "remove_unit",
            faction: afterGroup.faction,
            characterId: afterCharacter.id,
            index: oldEntry.index,
            unit: oldEntry.unit,
          });
      }
      for (const [id, newEntry] of newById) {
        const oldEntry = oldById.get(id);
        if (!oldEntry) {
          actions.push({
            type: "add_unit",
            faction: afterGroup.faction,
            characterId: afterCharacter.id,
            index: newEntry.index,
            unit: newEntry.unit,
          });
          continue;
        }
        const unitChanges: NonNullable<Extract<ExtendedMapDeltaAction, { type: "update_unit" }>["changes"]> = {};
        for (const field of ["unit_key", "xp", "health"] as const) {
          if (oldEntry.unit[field] !== newEntry.unit[field])
            unitChanges[field] = { before: oldEntry.unit[field], after: newEntry.unit[field] };
        }
        if (Object.keys(unitChanges).length > 0)
          actions.push({
            type: "update_unit",
            faction: afterGroup.faction,
            characterId: afterCharacter.id,
            unitId: id,
            index: newEntry.index,
            changes: unitChanges,
          });
      }
    }
  }
  const typeOrder: Record<ExtendedMapDeltaAction["type"], number> = {
    set_building: 0,
    add_building_slot: 1,
    update_character: 2,
    remove_character: 3,
    add_unit: 4,
    remove_unit: 5,
    update_unit: 6,
  };
  actions.sort((first, second) => {
    const firstKey =
      "region" in first ? first.region.toLowerCase() : `${first.faction.toLowerCase()}|${first.characterId}`;
    const secondKey =
      "region" in second ? second.region.toLowerCase() : `${second.faction.toLowerCase()}|${second.characterId}`;
    return (
      firstKey.localeCompare(secondKey) ||
      typeOrder[first.type] - typeOrder[second.type] ||
      ("slotIndex" in first ? first.slotIndex : "unitId" in first ? first.unitId : "index" in first ? first.index : 0) -
        ("slotIndex" in second
          ? second.slotIndex
          : "unitId" in second
            ? second.unitId
            : "index" in second
              ? second.index
              : 0)
    );
  });
  return { version: 1, actions };
};

export interface ExtendedBuildingOption {
  building: string;
  chain: string;
  level: number;
  title: string;
  variant?: BuildingVariantRow;
}

/**
 * Resolves the effective building choices for one imported slot. The buildings panel and this
 * helper use the same variant/availability rules; callers should still keep the slot's type when
 * presenting the returned chain levels because a template can be shared by more than one slot type.
 */
export const resolveExtendedBuildingOptions = (
  data: BuiltBuildingsData,
  query: { campaign: string; region: string; faction?: string; slot: Pick<RegionSlot, "slotTemplate" | "slotType"> },
): ExtendedBuildingOption[] => {
  const faction = query.faction
    ? data.factions.find((candidate) => candidate.key.toLowerCase() === query.faction!.toLowerCase())
    : undefined;
  const culture = faction?.culture;
  const subculture = faction?.subculture;
  const candidateChains = new Set<string>();
  const removals: string[][] = [];
  for (const row of data.permittedByTemplate[query.slot.slotTemplate] ?? []) {
    const chains = row.chain
      ? [row.chain]
      : row.superChain
        ? (data.superChains[row.superChain] ?? [])
        : row.chainSet
          ? [...expandChainSet(data, row.chainSet)]
          : [];
    if (row.remove) removals.push(chains);
    else for (const chain of chains) candidateChains.add(chain);
  }
  for (const superChain of data.superChainsByTemplate[query.slot.slotTemplate] ?? [])
    for (const chain of data.superChains[superChain] ?? []) candidateChains.add(chain);
  for (const chains of removals) for (const chain of chains) candidateChains.delete(chain);
  const cultureBySubculture = new Map(data.subcultures.map((entry) => [entry.key, entry.culture]));
  const cultureByFaction = new Map(data.factions.map((entry) => [entry.key, entry.culture]));
  const options: ExtendedBuildingOption[] = [];
  for (const chain of candidateChains) {
    const availabilityIds = data.availabilitySetsByChain[chain] ?? [];
    if (
      availabilityIds.length > 0 &&
      !availabilityIds.some((setId) =>
        (data.availabilitiesBySetId[setId] ?? []).some(
          (row) =>
            (!row.campaign || row.campaign === query.campaign) &&
            (!row.culture || !culture || row.culture === culture) &&
            (!row.subCulture ||
              row.subCulture === subculture ||
              (!subculture && cultureBySubculture.get(row.subCulture) === culture)) &&
            (!row.faction ||
              row.faction === query.faction ||
              (!query.faction && cultureByFaction.get(row.faction) === culture)),
        ),
      )
    )
      continue;
    for (const levelKey of data.levelKeysByChain[chain] ?? []) {
      const level = data.levelsByKey[levelKey];
      if (!level || !level.visibleInUi) continue;
      const variantResult = pickCultureVariant(
        data,
        levelKey,
        { campaign: query.campaign, region: query.region, faction: query.faction, culture, subculture },
        (key) => cultureBySubculture.get(key),
        (key) => cultureByFaction.get(key),
      );
      if (!variantResult.variant || variantResult.disabledBy) continue;
      options.push({
        building: levelKey,
        chain,
        level: level.level,
        title:
          data.variantLoc[
            `${levelKey}|${variantResult.variant.culture}|${variantResult.variant.subculture}|${variantResult.variant.faction}`
          ]?.name ?? levelKey,
        variant: variantResult.variant,
      });
    }
  }
  return options.sort(
    (first, second) =>
      first.level - second.level ||
      first.title.localeCompare(second.title) ||
      first.building.localeCompare(second.building),
  );
};

export interface ExtendedUnitOption {
  key: string;
  name: string;
  caste: string;
  isLord: boolean;
}

/** Filters Unit Viewer units to the owning faction's subculture roster. */
export const resolveExtendedUnitOptions = (
  units: UnitViewerCatalogUnit[],
  subculture?: string,
  leadersOnly = false,
): ExtendedUnitOption[] =>
  units
    .filter(
      (unit) =>
        (!subculture || unit.subcultureKeys.some((key) => key.toLowerCase() === subculture.toLowerCase())) &&
        (leadersOnly ? unit.caste.toLowerCase() === "lord" : unit.caste.toLowerCase() !== "lord"),
    )
    .map((unit) => ({ key: unit.key, name: unit.name, caste: unit.caste, isLord: unit.caste.toLowerCase() === "lord" }))
    .sort((first, second) => first.name.localeCompare(second.name) || first.key.localeCompare(second.key));
