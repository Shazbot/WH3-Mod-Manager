import { CaabStringTables, CaabValue, walkCaabNodes } from "../esf/codecs/caabBinary";
import { CaabItem, CaabRecordNode, replaceByteRange, replaceByteRanges } from "../esf/codecs/caabTree";
import {
  FACTION_ID_BASE,
  FACTION_INDEXED_RECORDS,
  FACTION_INDEXED_EXTRA_ROW_ORDER,
  decodeU32,
  encodeAscii,
  encodeU32,
  findFirstRecord,
  findRecords,
  findRecordsByName,
  relationshipGroupId,
  validateFactionIdPermutation,
} from "./addFaction";
import { collectCaiFactionIdSpans, readLeadingValues } from "./caiFactionIds";
import { removeCaiMobileReferences, removeCaiDependentReferenceArrays } from "./caiMobileReferences";
import { removeOrphanCaiTechnologies } from "./caiTechnologies";
import { removeCaiMilitaryForceSlots } from "./caiMilitaryForceSlots";
import { remapCaiSettlementReferences } from "./caiSettlementReferences";
import { remapFactionKeyedRows } from "./factionKeyedRows";
import { remapProvinceFactionOwners } from "./provinceFactionIds";
import { remapRegionFactionOwners } from "./regionFactionIds";
import { removeCaiMobileDependents } from "./caiMobileDependents";
import { collectFactionArrayIdSpans, collectIndexedFactionIdSpans } from "./factionIdSpans";

export interface RemoveFactionOptions {
  /** Exact faction key. */
  factionKey: string;
  /** Required when the faction key occurs in a region record; its owner/reference fields are reassigned. */
  transferTo?: string;
}

export interface RemoveFactionReport {
  removedKey: string;
  removedIndex: number;
  removedId: number;
  factionsBefore: number;
  factionsAfter: number;
  relationshipsTrimmed: number;
  factionIdsRemapped: number;
  factionIdReferencesRemapped: { recordName: string; count: number }[];
  pairsRemoved: number;
  listsTrimmed: { name: string; instances: number; from: number; to: number }[];
  influenceMapsRemoved: number;
  caiBeliefGroupsRemoved: number;
  familyMembersRemoved: number;
  nameManagerRemoved: boolean;
  caiCharactersRemoved: number;
  caiCharacterPostsRemoved: number;
  caiResourceMobilesRemoved: number;
  caiUnitsRemoved: number;
  caiFactionManagersRemoved: number;
  caiStrategicStanceRowsRemoved: number;
  caiBdiComponentsRemoved: number;
  caiMobileReferencesRemoved: number;
  caiDependentReferencesRemoved: number;
  caiMobileBeliefsRemoved: number;
  caiMobileInfluenceMapsRemoved: number;
  caiBdiBlockOwnershipRowsRemoved: number;
  regionReferencesReassigned: number;
  regionOwnerIdsRemapped: number;
  provinceOwnerIdsRemapped: number;
  factionKeyedRows: { removed: number; remapped: number };
  caiSettlementReferences: { ownersRemapped: number; garrisonReferencesCleared: number };
  caiMilitaryForceBuildingSlotsRemoved: number;
  caiTechnologiesRemoved: number;
}

function factionKeyOf(record: CaabRecordNode, source: Buffer, tables: CaabStringTables): string | null {
  const group = record.groups[0];
  if (!group) return null;
  for (const item of group) {
    if (item.kind !== "raw") continue;
    for (let offset = item.start; offset + 5 <= item.end; offset += 1) {
      if (source[offset] !== 0x0f) continue;
      const text = tables.utf8ById.get(source.readUInt32LE(offset + 1));
      if (text) return text;
    }
  }
  return null;
}

function factionRecordForKey(
  root: CaabRecordNode,
  source: Buffer,
  tables: CaabStringTables,
  key: string
): { index: number; record: CaabRecordNode } | null {
  const factionArray = findFirstRecord(root, "FACTION_ARRAY");
  if (!factionArray) return null;
  const wanted = key.trim().toLowerCase();
  for (let index = 0; index < factionArray.groups.length; index += 1) {
    const record = factionArray.groups[index].find((item): item is CaabRecordNode => item.kind === "record");
    if (record && factionKeyOf(record, source, tables)?.toLowerCase() === wanted) return { index, record };
  }
  return null;
}

export function collectFactionKeys(root: CaabRecordNode, source: Buffer, tables: CaabStringTables): string[] {
  const factionArray = findFirstRecord(root, "FACTION_ARRAY");
  if (!factionArray) throw new Error("FACTION_ARRAY not found.");
  return factionArray.groups.map((group, index) => {
    const record = group.find((item): item is CaabRecordNode => item.kind === "record");
    const key = record ? factionKeyOf(record, source, tables) : null;
    if (!key) throw new Error(`Could not read the faction key at FACTION_ARRAY index ${index}.`);
    return key;
  });
}

export function pairOf(group: CaabItem[], source: Buffer): { a: number; b: number } | null {
  const first = group[0];
  if (!first || (first.kind !== "raw" && first.kind !== "bytes")) return null;
  const buffer = first.kind === "raw" ? source : first.data;
  const offset = first.kind === "raw" ? first.start : 0;
  const a = decodeU32(buffer, offset);
  const b = decodeU32(buffer, offset + a.width);
  return { a: a.value, b: b.value };
}

export function rewriteLeadingU32(group: CaabItem[], source: Buffer, value: number): void {
  const first = group[0];
  if (!first || (first.kind !== "raw" && first.kind !== "bytes")) {
    throw new Error("Could not locate a leading faction ID for rewriting.");
  }
  const buffer = first.kind === "raw" ? source : first.data;
  const offset = first.kind === "raw" ? first.start : 0;
  const old = decodeU32(buffer, offset);
  const tail = first.kind === "raw" ? source.subarray(offset + old.width, first.end) : first.data.subarray(old.width);
  group[0] = { kind: "bytes", data: Buffer.concat([encodeU32(value), tail]) };
}

export function rewritePairIds(group: CaabItem[], source: Buffer, aValue: number, bValue: number): void {
  const first = group[0];
  if (!first || (first.kind !== "raw" && first.kind !== "bytes")) {
    throw new Error("Could not locate pairwise faction IDs for rewriting.");
  }
  const buffer = first.kind === "raw" ? source : first.data;
  const offset = first.kind === "raw" ? first.start : 0;
  const a = decodeU32(buffer, offset);
  const b = decodeU32(buffer, offset + a.width);
  const tail = first.kind === "raw" ? source.subarray(offset + a.width + b.width, first.end) : first.data.subarray(a.width + b.width);
  group[0] = { kind: "bytes", data: Buffer.concat([encodeU32(aValue), encodeU32(bValue), tail]) };
}

function keyIds(tables: CaabStringTables, key: string): Set<number> {
  return new Set([...tables.utf8ById].filter(([, text]) => text === key).map(([id]) => id));
}

export function itemReferencesKey(item: CaabItem, source: Buffer, ids: Set<number>): boolean {
  if (ids.size === 0) return false;
  if (item.kind === "raw") {
    for (let offset = item.start; offset + 5 <= item.end; offset += 1) {
      if (source[offset] === 0x0f && ids.has(source.readUInt32LE(offset + 1))) return true;
    }
    return false;
  }
  if (item.kind === "record") return item.groups.some((group) => group.some((child) => itemReferencesKey(child, source, ids)));
  return false;
}

function regionKeySpans(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: CaabStringTables,
  key: string
): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  walkCaabNodes(source, header, tables, {
    onValue(value: CaabValue, stack: string[]) {
      if (
        value.kind !== "value" ||
        value.type !== "ascii" ||
        stack[stack.length - 1] !== "REGION" ||
        !stack.includes("REGIONS_ARRAY") ||
        value.startOffset === undefined ||
        value.endOffset === undefined
      ) {
        return;
      }
      const ascii = value.value as { id: number; text: string | null };
      if (ascii.text?.toLowerCase() === key.toLowerCase()) {
        spans.push({ start: value.startOffset, end: value.endOffset });
      }
    },
  });
  return spans;
}

function collectFactionCharacterIds(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: CaabStringTables,
  targetFactionIndex: number
): Set<number> {
  const ids = new Set<number>();
  let insideTarget = false;
  let factionIndex = -1;
  let current: { start: number; valueIndex: number; id?: number } | null = null;

  walkCaabNodes(source, header, tables, {
    onRecordStart(record, parent) {
      if (record.name === "FACTION" && parent[parent.length - 1] === "FACTION_ARRAY") {
        factionIndex += 1;
        insideTarget = factionIndex === targetFactionIndex;
      }
      if (insideTarget && record.name === "CHARACTER" && parent[parent.length - 1] === "CHARACTER_ARRAY") {
        current = { start: record.startOffset, valueIndex: 0 };
      }
    },
    onValue(value, stack) {
      if (!insideTarget || !current || stack[stack.length - 1] !== "CHARACTER" || value.kind !== "value") return;
      // CHARACTER stores its direct character ID as its first serialized value.
      if (current.valueIndex === 0) {
        if (value.type !== "u32" || typeof value.value !== "number") {
          throw new Error("Could not read a faction CHARACTER id.");
        }
        current.id = value.value;
      }
      current.valueIndex += 1;
    },
    onRecordEnd(record, parent) {
      if (record.name === "CHARACTER" && current?.start === record.startOffset) {
        if (current.id === undefined) throw new Error("Faction CHARACTER has no readable ID.");
        ids.add(current.id);
        current = null;
      }
      if (record.name === "FACTION" && parent[parent.length - 1] === "FACTION_ARRAY") {
        insideTarget = false;
      }
    },
  });

  return ids;
}

function collectFactionArmyIds(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: CaabStringTables,
  targetFactionIndex: number
): { militaryForceIds: Set<number>; unitIds: Set<number> } {
  const militaryForceIds = new Set<number>();
  const unitIds = new Set<number>();
  let insideTarget = false;
  let factionIndex = -1;
  const active: { start: number; name: string; valueIndex: number; id?: number }[] = [];

  walkCaabNodes(source, header, tables, {
    onRecordStart(record, parent) {
      if (record.name === "FACTION" && parent[parent.length - 1] === "FACTION_ARRAY") {
        factionIndex += 1;
        insideTarget = factionIndex === targetFactionIndex;
      }
      if (
        insideTarget &&
        ((record.name === "MILITARY_FORCE" && parent[parent.length - 1] === "ARMY_ARRAY") ||
          (record.name === "UNIT" && parent[parent.length - 1] === "UNITS_ARRAY"))
      ) {
        active.push({ start: record.startOffset, name: record.name, valueIndex: 0 });
      }
    },
    onValue(value, stack) {
      if (!insideTarget || value.kind !== "value" || value.type !== "u32" || typeof value.value !== "number") return;
      const frame = [...active].reverse().find((item) => item.name === stack[stack.length - 1]);
      if (!frame) return;
      if (frame.valueIndex === 0) frame.id = value.value;
      frame.valueIndex += 1;
    },
    onRecordEnd(record, parent) {
      const frameIndex = active.findIndex((item) => item.start === record.startOffset);
      if (frameIndex >= 0) {
        const [frame] = active.splice(frameIndex, 1);
        if (frame.id === undefined) throw new Error(`Faction ${frame.name} has no readable ID.`);
        (frame.name === "MILITARY_FORCE" ? militaryForceIds : unitIds).add(frame.id);
      }
      if (record.name === "FACTION" && parent[parent.length - 1] === "FACTION_ARRAY") {
        insideTarget = false;
      }
    },
  });

  return { militaryForceIds, unitIds };
}

function removeCaiCharacterPostReferences(
  root: CaabRecordNode,
  source: Buffer,
  characterIds: Set<number>,
  unitIds: Set<number>,
  resourceMobileIds: Set<number>,
  removedCaiFactionObjectId: number
): {
  caiCharactersRemoved: number;
  caiCharacterPostsRemoved: number;
  retainedCaiObjectIds: Set<number>;
} {
  const worldCharacters = findFirstRecord(root, "CAI_WORLD_CHARACTERS");
  if (!worldCharacters) throw new Error("CAI_WORLD_CHARACTERS not found.");
  let caiCharactersRemoved = 0;
  for (let index = worldCharacters.groups.length - 1; index >= 0; index -= 1) {
    const character = worldCharacters.groups[index].find(
      (item): item is CaabRecordNode => item.kind === "record" && item.name === "CAI_CHARACTER"
    );
    if (!character) continue;
    const characterId = readLeadingValues(character, source, 4).find((value) => value.slot === 3)?.value;
    if (characterId === undefined || !characterIds.has(characterId)) continue;
    worldCharacters.groups.splice(index, 1);
    worldCharacters.groupSizeWidths.splice(index, 1);
    caiCharactersRemoved += 1;
  }

  // Keys can collide across character, unit, and resource-mobile IDs. Keep a
  // post row whenever a surviving CAI-world object still references its key.
  const retainedCaiObjectIds = new Set<number>();
  for (const group of worldCharacters.groups) {
    const character = group.find((item) => item.kind === "record" && item.name === "CAI_CHARACTER");
    if (!character || character.kind !== "record") continue;
    for (const value of readLeadingValues(character, source, 32)) {
      if (!value.signed && value.value > 0) retainedCaiObjectIds.add(value.value);
    }
  }

  const worldUnits = findFirstRecord(root, "CAI_WORLD_UNITS");
  if (!worldUnits) throw new Error("CAI_WORLD_UNITS not found.");
  for (const group of worldUnits.groups) {
    const unit = group.find((item) => item.kind === "record" && item.name === "CAI_UNIT");
    if (!unit || unit.kind !== "record") continue;
    const values = readLeadingValues(unit, source, 32);
    const id = values.find((value) => value.slot === 1)?.value;
    if (id !== undefined && !unitIds.has(id)) {
      for (const value of values) {
        if (!value.signed && value.value > 0) retainedCaiObjectIds.add(value.value);
      }
    }
  }

  const worldResourceMobiles = findFirstRecord(root, "CAI_WORLD_RESOURCE_MOBILES");
  if (!worldResourceMobiles) throw new Error("CAI_WORLD_RESOURCE_MOBILES not found.");
  for (const group of worldResourceMobiles.groups) {
    const mobile = group.find((item) => item.kind === "record" && item.name === "CAI_RESOURCE_MOBILE");
    if (!mobile || mobile.kind !== "record") continue;
    const values = readLeadingValues(mobile, source, 32);
    const id = values.find((value) => value.slot === 0)?.value;
    if (id !== undefined && !resourceMobileIds.has(id)) {
      for (const value of values) {
        if (!value.signed && value.value > 0) retainedCaiObjectIds.add(value.value);
      }
    }
  }

  const caiCharacterPostsRemoved = removeCaiFactionPosts(root, source, removedCaiFactionObjectId);

  return { caiCharactersRemoved, caiCharacterPostsRemoved, retainedCaiObjectIds };
}

/** Remove post groups by their CAI faction owner, not by IDs in the post body. */
export function removeCaiFactionPosts(
  root: CaabRecordNode,
  source: Buffer,
  removedCaiFactionObjectId: number
): number {
  const posts = findFirstRecord(root, "CAI_CHARACTER_POSTS");
  if (!posts) throw new Error("CAI_CHARACTER_POSTS not found.");
  let removed = 0;
  for (let index = posts.groups.length - 1; index >= 0; index -= 1) {
    const group = posts.groups[index];
    if (firstU32InRecord(group, "OWNED_DIRECT", source) !== removedCaiFactionObjectId) continue;
    posts.groups.splice(index, 1);
    posts.groupSizeWidths.splice(index, 1);
    removed += 1;
  }
  return removed;
}

function collectCaiResourceMobileIds(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: CaabStringTables,
  militaryForceIds: Set<number>
): Set<number> {
  const ids = new Set<number>();
  if (militaryForceIds.size === 0) return ids;
  let current: { start: number; valueIndex: number; mobileId?: number; forceId?: number } | null = null;

  walkCaabNodes(source, header, tables, {
    onRecordStart(record, parent) {
      if (record.name === "CAI_RESOURCE_MOBILE" && parent[parent.length - 1] === "CAI_WORLD_RESOURCE_MOBILES") {
        current = { start: record.startOffset, valueIndex: 0 };
      }
    },
    onValue(value, stack) {
      if (!current || stack[stack.length - 1] !== "CAI_RESOURCE_MOBILE" || value.kind !== "value") return;
      if (current.valueIndex === 0 && value.type === "u32" && typeof value.value === "number") {
        current.mobileId = value.value;
      }
      // This visitor counts scalar values (including the bool) and skips arrays,
      // so the owner is slot 9 even though it is the ninth integer field too.
      if (current.valueIndex === 9 && value.type === "u32" && typeof value.value === "number") {
        current.forceId = value.value;
      }
      current.valueIndex += 1;
    },
    onRecordEnd(record) {
      if (record.name !== "CAI_RESOURCE_MOBILE" || current?.start !== record.startOffset) return;
      if (current.forceId !== undefined && militaryForceIds.has(current.forceId)) {
        if (current.mobileId === undefined) throw new Error("Target CAI_RESOURCE_MOBILE has no readable ID.");
        ids.add(current.mobileId);
      }
      current = null;
    },
  });

  return ids;
}

function removeCaiRows(
  root: CaabRecordNode,
  source: Buffer,
  containerName: string,
  rowName: string,
  shouldRemove: (row: CaabRecordNode) => boolean,
  retainedCaiObjectIds: ReadonlySet<number>
): number {
  const container = findFirstRecord(root, containerName);
  if (!container) throw new Error(`${containerName} not found.`);
  let removed = 0;
  for (let index = container.groups.length - 1; index >= 0; index -= 1) {
    const group = container.groups[index];
    const row = group.find((item) => item.kind === "record" && item.name === rowName);
    if (!row || row.kind !== "record" || !shouldRemove(row)) continue;
    if (groupHasRetainedBdiComponent(group, source, retainedCaiObjectIds)) continue;
    // CAI entity groups also carry their BDI/property-set siblings. Keep the
    // whole group when another surviving CAI object still references its BDI.
    container.groups.splice(index, 1);
    container.groupSizeWidths.splice(index, 1);
    removed += 1;
  }
  return removed;
}

export function groupHasRetainedBdiComponent(
  group: CaabItem[],
  source: Buffer,
  retainedCaiObjectIds: ReadonlySet<number>
): boolean {
  if (retainedCaiObjectIds.size === 0) return false;
  return group.some(
    (item) =>
      item.kind === "record" &&
      item.name === "CAI_BDI_COMPONENT" &&
      readLeadingValues(item, source, 1).some((value) => !value.signed && retainedCaiObjectIds.has(value.value))
  );
}

export function firstU32InGroup(group: CaabItem[], source: Buffer): number | undefined {
  const first = group.find((item) => item.kind === "raw" || item.kind === "bytes");
  if (!first) return undefined;
  try {
    return first.kind === "raw"
      ? decodeU32(source, first.start).value
      : decodeU32(first.data, 0).value;
  } catch {
    return undefined;
  }
}

export function firstU32InRecord(group: CaabItem[], recordName: string, source: Buffer): number | undefined {
  const record = group.find((item) => item.kind === "record" && item.name === recordName);
  if (!record || record.kind !== "record") return undefined;
  return readLeadingValues(record, source, 1)[0]?.value;
}

function removeCaiFactionStanceRows(
  root: CaabRecordNode,
  source: Buffer,
  removedCaiFactionObjectId: number
): number {
  let removed = 0;
  for (const node of findRecords(root, "CAI_FACTION_STRATEGIC_STANCE")) {
    let removedFromNode = 0;
    for (let index = node.groups.length - 1; index >= 0; index -= 1) {
      if (firstU32InGroup(node.groups[index], source) !== removedCaiFactionObjectId) continue;
      node.groups.splice(index, 1);
      node.groupSizeWidths.splice(index, 1);
      removed += 1;
      removedFromNode += 1;
    }
    if (removedFromNode > 1) {
      throw new Error("A CAI_FACTION_STRATEGIC_STANCE row contains the removed CAI faction key more than once.");
    }
  }
  return removed;
}

function removeCaiFactionInterfaceManager(
  root: CaabRecordNode,
  source: Buffer,
  removedCaiFactionObjectId: number
): number {
  const managers = findFirstRecord(root, "CAI_INTERFACE_MANAGERS");
  if (!managers) throw new Error("CAI_INTERFACE_MANAGERS not found.");
  let removed = 0;
  for (let index = managers.groups.length - 1; index >= 0; index -= 1) {
    if (firstU32InRecord(managers.groups[index], "CAI_FACTION_MANAGER", source) !== removedCaiFactionObjectId) {
      continue;
    }
    managers.groups.splice(index, 1);
    managers.groupSizeWidths.splice(index, 1);
    removed += 1;
  }
  return removed;
}

export const CAI_FACTION_BELIEF_ID_SLOTS: Readonly<Record<string, readonly number[]>> = {
  CAI_ATTITUDE_ANALYSIS: [0, 1],
  CAI_DIRECT_ATTITUDE_ANALYSIS: [0, 1],
  CAI_INTERACTION_LOG: [0, 1],
  CAI_FACTION_STRENGTH_ANALYSIS: [0],
  CAI_BASIC_REGION_GROUP_ANALYSIS: [0],
  CAI_DIPLOMATIC_ANALYSIS: [0],
  CAI_RESPECT_ANALYSIS: [1],
  CAI_OWNED_REGIONS_ANALYSIS: [0],
  CAI_ACTIVE_RECRUITMENT_ANALYSIS: [0],
  CAI_IMPORTANT_FACTION_ANALYSIS: [0],
};

/** Native basic-region-group loader reads three object arrays before its faction owner. */
export function readFactionBeliefValues(record: CaabRecordNode, source: Buffer, limit: number) {
  if (record.name !== "CAI_BASIC_REGION_GROUP_ANALYSIS") return readLeadingValues(record, source, limit);
  if (record.version !== 0) throw new Error("Unsupported CAI_BASIC_REGION_GROUP_ANALYSIS version.");
  const span = record.groups[0]?.[0];
  if (span?.kind !== "raw") throw new Error("Basic region-group prefix is missing.");
  let at = span.start;
  const widths: Record<number, number> = { 0x56: 1, 0x57: 2, 0x58: 3, 0x48: 4 };
  for (let index = 0; index < 3; index++) {
    const width = widths[source[at++]];
    if (!width) throw new Error("Invalid basic region-group object array.");
    let length = 0, finished = false;
    for (let count = 0; count < 5 && at < span.end; count++) {
      const byte = source[at++]; length = length * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) { finished = true; break; }
    }
    if (!finished || length % width || at + length > span.end) throw new Error("Truncated basic region-group object array.");
    at += length;
  }
  return readLeadingValues({ ...record, groups: [[{ kind: "raw", start: at, end: span.end }]] }, source, limit);
}

export function beliefGroupReferencesFactionKey(group: CaabItem[], source: Buffer, factionKey: number): boolean {
  return group.some((item) => {
    if (item.kind !== "record") return false;
    const slots = CAI_FACTION_BELIEF_ID_SLOTS[item.name];
    if (!slots) return false;
    const values = readFactionBeliefValues(item, source, Math.max(...slots) + 1);
    return slots.some((slot) => {
      const value = values.find((candidate) => candidate.slot === slot);
      return value !== undefined && !value.signed && value.value === factionKey;
    });
  });
}

export function validateCaiFactionBeliefReferences(root: CaabRecordNode, source: Buffer): number {
  const world = findFirstRecord(root, "CAI_WORLD_FACTIONS");
  if (!world) throw new Error("CAI_WORLD_FACTIONS missing.");
  const live = new Set(world.groups.map(group => firstU32InRecord(group, "OWNED_DIRECT", source)));
  let checked = 0;
  const rowsByName = findRecordsByName(root, new Set(Object.keys(CAI_FACTION_BELIEF_ID_SLOTS)));
  for (const [name, slots] of Object.entries(CAI_FACTION_BELIEF_ID_SLOTS)) for (const row of rowsByName.get(name)!) {
    const values = readFactionBeliefValues(row, source, Math.max(...slots) + 1);
    for (const slot of slots) {
      const id = values[slot];
      if (!id || id.signed || (id.value !== 0 && !live.has(id.value))) throw new Error(`${name} references missing AI faction ${id?.value}.`);
      checked++;
    }
  }
  return checked;
}

function removeCaiFactionBeliefGroups(
  root: CaabRecordNode,
  source: Buffer,
  removedCaiFactionObjectId: number,
  retainedCaiObjectIds: ReadonlySet<number>
): number {
  let removed = 0;
  for (const beliefs of findRecords(root, "CAI_BDI_POOL_BELIEFS")) {
    for (let index = beliefs.groups.length - 1; index >= 0; index -= 1) {
      const group = beliefs.groups[index];
      if (!beliefGroupReferencesFactionKey(group, source, removedCaiFactionObjectId)) continue;
      if (groupHasRetainedBdiComponent(group, source, retainedCaiObjectIds)) continue;
      beliefs.groups.splice(index, 1);
      beliefs.groupSizeWidths.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}

export function collectCaiBdiComponentIds(root: CaabRecordNode, source: Buffer): Set<number> {
  const ids = new Set<number>();
  for (const component of findRecords(root, "CAI_BDI_COMPONENT")) {
    const id = readLeadingValues(component, source, 1)[0];
    if (!id || id.signed) {
      throw new Error("A CAI_BDI_COMPONENT record has no readable unsigned component ID.");
    }
    ids.add(id.value);
  }
  return ids;
}

/**
 * Block-ownership groups are keyed by CAI_BDI_COMPONENT IDs, not faction
 * positions. They occur both in the global respect-analysis table and in
 * nested belief-pool lists, so remove references to every component that the
 * faction cleanup removed instead of editing only the global row.
 */
function removeCaiBdiComponentOwnershipReferences(
  root: CaabRecordNode,
  source: Buffer,
  removedComponentIds: ReadonlySet<number>
): number {
  if (removedComponentIds.size === 0) return 0;

  let removedRows = 0;
  for (const ownership of findRecords(root, "CAI_BDI_COMPONENT_BLOCK_OWNS")) {
    for (let index = ownership.groups.length - 1; index >= 0; index -= 1) {
      const componentId = firstU32InGroup(ownership.groups[index], source);
      if (componentId === undefined || !removedComponentIds.has(componentId)) continue;
      ownership.groups.splice(index, 1);
      ownership.groupSizeWidths.splice(index, 1);
      removedRows += 1;
    }
  }

  for (const ownership of findRecords(root, "CAI_BDI_COMPONENT_BLOCK_OWNS")) {
    for (const group of ownership.groups) {
      const componentId = firstU32InGroup(group, source);
      if (componentId !== undefined && removedComponentIds.has(componentId)) {
        throw new Error(`Stale CAI_BDI_COMPONENT_BLOCK_OWNS reference to removed component ${componentId}.`);
      }
    }
  }
  return removedRows;
}

/** Remove a historical map together with its key and update the serialized count. */
export function removeCaiFactionInfluenceMap(
  root: CaabRecordNode,
  source: Buffer,
  removedCaiFactionObjectId: number
): number {
  const influence = findFirstRecord(root, "CAI_INFLUENCE_MAP_MANAGER");
  const mapGroup = influence?.groups[0];
  if (!influence || !mapGroup) throw new Error("CAI_INFLUENCE_MAP_MANAGER is missing its map group.");
  const group: CaabItem[] = mapGroup;

  function valuesBefore(index: number): { value: number; start: number; end: number }[] {
    const previous = group[index - 1];
    if (!previous || previous.kind !== "raw") {
      throw new Error("Historical influence map is missing its serialized key.");
    }
    const values: { value: number; start: number; end: number }[] = [];
    for (let offset = previous.start; offset < previous.end;) {
      const decoded = decodeU32(source, offset);
      const end = offset + decoded.width;
      if (end > previous.end) throw new Error("Historical influence-map key exceeds its raw span.");
      values.push({ value: decoded.value, start: offset, end });
      offset = end;
    }
    return values;
  }

  const historical = group.flatMap((item, index) =>
    item.kind === "record" && item.name === "CAI_HISTORICAL_INFLUENCE_MAP"
      ? [{ record: item, values: valuesBefore(index) }]
      : []
  );
  const prefix = historical[0]?.values;
  const count = prefix?.[prefix.length - 2];
  if (!count) throw new Error("Historical influence-map count is missing.");
  if (count.value !== historical.length) {
    throw new Error(`CAI_INFLUENCE_MAP_MANAGER declares ${count.value} historical maps but contains ${historical.length}.`);
  }

  const matches = historical.filter((row) => row.values[row.values.length - 1]?.value === removedCaiFactionObjectId);
  if (matches.length !== 1) {
    throw new Error(`Expected one CAI_HISTORICAL_INFLUENCE_MAP paired with CAI faction key ${removedCaiFactionObjectId}, found ${matches.length}.`);
  }
  const match = matches[0];
  const key = match.values[match.values.length - 1];
  // The first map can share a raw span with the count. Delete only the key's
  // bytes, rather than deleting the entire preceding raw item.
  const replaced = replaceByteRanges(influence, [
    { start: count.start, end: count.end, data: encodeU32(count.value - 1) },
    { start: key.start, end: key.end, data: Buffer.alloc(0) },
  ]);
  if (replaced !== 2) throw new Error("Could not update the historical influence-map count and key.");
  group.splice(group.indexOf(match.record), 1);
  return 1;
}

/** Removes one faction by key and compacts the affected faction-ID tables. */
export function removeFaction(
  source: Buffer,
  header: { recordNamesOffset: number },
  tables: CaabStringTables,
  root: CaabRecordNode,
  options: RemoveFactionOptions
): RemoveFactionReport {
  const factionArray = findFirstRecord(root, "FACTION_ARRAY");
  if (!factionArray || factionArray.groups.length === 0) throw new Error("FACTION_ARRAY is missing or empty.");

  const match = factionRecordForKey(root, source, tables, options.factionKey);
  if (!match) throw new Error(`Faction "${options.factionKey}" is not in this startpos.`);
  const factionsBefore = factionArray.groups.length;
  const removedIndex = match.index;
  const removedKey = factionKeyOf(match.record, source, tables);
  if (!removedKey) throw new Error(`Could not identify the faction key for "${options.factionKey}".`);
  const removedId = removedIndex + FACTION_ID_BASE;
  const caiBdiComponentIdsBefore = collectCaiBdiComponentIds(root, source);
  const ids = keyIds(tables, removedKey);
  const characterIds = collectFactionCharacterIds(source, header, tables, removedIndex);
  const factionArmyIds = collectFactionArmyIds(source, header, tables, removedIndex);
  const militaryForceSlots = new Set(findRecords(match.record, "MILITARY_FORCE_SLOT").map(node => readLeadingValues(node, source, 1)[0]!.value));
  const caiMobileIds = collectCaiResourceMobileIds(source, header, tables, factionArmyIds.militaryForceIds);
  const worldFactions = findFirstRecord(root, "CAI_WORLD_FACTIONS");
  if (!worldFactions) throw new Error("CAI_WORLD_FACTIONS not found.");
  if (worldFactions.groups.length !== factionsBefore && worldFactions.groups.length !== factionsBefore + 1) {
    throw new Error(`CAI_WORLD_FACTIONS has ${worldFactions.groups.length} rows for ${factionsBefore} factions.`);
  }
  const removedCaiFactionObjectId = firstU32InRecord(
    worldFactions.groups[removedIndex] ?? [],
    "OWNED_DIRECT",
    source
  );
  if (removedCaiFactionObjectId === undefined) {
    throw new Error(`CAI_WORLD_FACTIONS row ${removedIndex} has no readable OWNED_DIRECT key.`);
  }
  const caiPostCleanup = removeCaiCharacterPostReferences(
    root,
    source,
    characterIds,
    factionArmyIds.unitIds,
    caiMobileIds,
    removedCaiFactionObjectId
  );
  const mobileWorld = findFirstRecord(root, "CAI_WORLD_RESOURCE_MOBILES")!;
  const mobileComponentsBefore = collectCaiBdiComponentIds(mobileWorld, source);
  const caiResourceMobilesRemoved = removeCaiRows(
    root,
    source,
    "CAI_WORLD_RESOURCE_MOBILES",
    "CAI_RESOURCE_MOBILE",
    (row) => readLeadingValues(row, source, 1).some((value) => value.slot === 0 && caiMobileIds.has(value.value)),
    caiPostCleanup.retainedCaiObjectIds
  );
  const mobileComponentsAfter = collectCaiBdiComponentIds(mobileWorld, source);
  const removedMobileComponents = new Set([...mobileComponentsBefore].filter(id => !mobileComponentsAfter.has(id)));
  const mobileDependents = removeCaiMobileDependents(root, source, removedMobileComponents);
  const caiUnitsRemoved = removeCaiRows(
    root,
    source,
    "CAI_WORLD_UNITS",
    "CAI_UNIT",
    (row) => readLeadingValues(row, source, 2).some((value) => value.slot === 1 && factionArmyIds.unitIds.has(value.value)),
    caiPostCleanup.retainedCaiObjectIds
  );
  const explicitFactionIds = [
    ...collectFactionArrayIdSpans(source, header, tables, factionsBefore),
    ...collectIndexedFactionIdSpans(source, header, tables, factionsBefore),
  ];

  const regionRefs = regionKeySpans(source, header, tables, removedKey);
  let transferKey: string | undefined;
  let transferId: number | undefined;
  if (regionRefs.length > 0) {
    if (!options.transferTo) {
      throw new Error(
        `"${removedKey}" appears ${regionRefs.length} time(s) under REGIONS_ARRAY. Supply --transfer-to <existing-faction-key> so the output has no region reference to the removed faction.`
      );
    }
    const transfer = factionRecordForKey(root, source, tables, options.transferTo);
    if (!transfer || transfer.index === removedIndex) {
      throw new Error(`Transfer faction "${options.transferTo}" is not a different faction in this startpos.`);
    }
    transferKey = factionKeyOf(transfer.record, source, tables) ?? undefined;
    transferId = [...tables.utf8ById].find(([, text]) => text === transferKey)?.[0];
    if (transferId === undefined) throw new Error(`No UTF-8 string-table entry for transfer faction "${options.transferTo}".`);
    for (const span of regionRefs.sort((a, b) => b.start - a.start)) {
      if (!replaceByteRange(root, span.start, span.end, encodeAscii(transferId))) {
        throw new Error(`Could not rewrite a REGIONS_ARRAY reference to "${removedKey}" at ${span.start}.`);
      }
    }
  }

  const regionIdRemapping = new Map<number, number>([[1, 1]]);
  for (let i = 0; i < factionsBefore; i++) {
    const id = i + FACTION_ID_BASE;
    if (id !== removedId) regionIdRemapping.set(id, id > removedId ? id - 1 : id);
  }
  const ownerTransfers = new Map<number, number>();
  const caiOwnerTransfers = new Map<number, number>();
  if (transferKey) {
    const recipient = factionRecordForKey(root, source, tables, transferKey);
    if (!recipient) throw new Error(`Region recipient ${transferKey} is missing.`);
    ownerTransfers.set(removedId, recipient.index + FACTION_ID_BASE);
    const recipientCaiOwner = firstU32InRecord(worldFactions.groups[recipient.index], "OWNED_DIRECT", source);
    if (recipientCaiOwner === undefined) throw new Error("AI transfer recipient missing.");
    caiOwnerTransfers.set(removedCaiFactionObjectId, recipientCaiOwner);
  }
  const regionOwnerIdsRemapped = remapRegionFactionOwners(root, source, header, tables, regionIdRemapping, ownerTransfers);
  const provinceOwnerIdsRemapped = remapProvinceFactionOwners(root, source, header, tables, regionIdRemapping, ownerTransfers);
  const factionKeyedRows = remapFactionKeyedRows(root, source, regionIdRemapping, new Set([removedId]));

  // Remove the target relationship and decrement every surviving ID above it.
  let relationshipsTrimmed = 0;
  for (let index = 0; index < factionsBefore; index += 1) {
    if (index === removedIndex) continue;
    const record = factionArray.groups[index].find((item): item is CaabRecordNode => item.kind === "record");
    if (!record) throw new Error(`Faction record missing at index ${index}.`);
    const relationship = findFirstRecord(record, "OLD_DIPLOMACY_RELATIONSHIP");
    if (!relationship) throw new Error(`Faction at index ${index} has no OLD_DIPLOMACY_RELATIONSHIP.`);
    let foundRemovedId = false;
    for (let position = relationship.groups.length - 1; position >= 0; position -= 1) {
      const group = relationship.groups[position];
      const id = relationshipGroupId(group, source);
      if (id === removedId) {
        relationship.groups.splice(position, 1);
        relationship.groupSizeWidths.splice(position, 1);
        foundRemovedId = true;
        relationshipsTrimmed += 1;
      } else if (id > removedId) {
        rewriteLeadingU32(group, source, id - 1);
      }
    }
    if (!foundRemovedId) throw new Error(`Faction at index ${index} has no relationship to removed faction id ${removedId}.`);
  }

  // The pairwise matrix carries explicit faction IDs, so remove the target's
  // pairs and compact the IDs above it in every remaining pair.
  let pairsRemoved = 0;
  const manager = findFirstRecord(root, "DIPLOMACY_MANAGER");
  const pairwise = manager ? findFirstRecord(manager, "DIPLOMACY_RELATIONSHIP") : null;
  if (!pairwise) throw new Error("DIPLOMACY_MANAGER/DIPLOMACY_RELATIONSHIP not found.");
  for (let index = pairwise.groups.length - 1; index >= 0; index -= 1) {
    const group = pairwise.groups[index];
    const pair = pairOf(group, source);
    if (!pair) throw new Error(`Could not decode pairwise diplomacy entry ${index}.`);
    if (pair.a === removedId || pair.b === removedId) {
      pairwise.groups.splice(index, 1);
      pairwise.groupSizeWidths.splice(index, 1);
      pairsRemoved += 1;
      continue;
    }
    const nextA = pair.a > removedId ? pair.a - 1 : pair.a;
    const nextB = pair.b > removedId ? pair.b - 1 : pair.b;
    if (nextA !== pair.a || nextB !== pair.b) rewritePairIds(group, source, nextA, nextB);
  }

  // CAI_FACTION rows store their faction ID as the second serialized u32.
  // Validate row order, then compact IDs above the removed faction before the
  // indexed-list pass removes its CAI_WORLD_FACTIONS row.
  const caiFactionIds = collectCaiFactionIdSpans(source, header, tables);
  if (caiFactionIds.length !== worldFactions.groups.length) {
    throw new Error(`Found ${caiFactionIds.length} CAI faction rows for ${worldFactions.groups.length} world rows.`);
  }
  const idsToRemap: typeof caiFactionIds = [];
  for (const factionId of caiFactionIds) {
    const expectedId = factionId.rowIndex < factionsBefore
      ? factionId.rowIndex + FACTION_ID_BASE
      : 1;
    if (factionId.value !== expectedId) {
      throw new Error(`CAI_FACTION row ${factionId.rowIndex} has id ${factionId.value}; expected ${expectedId}.`);
    }
    if (factionId.value > removedId) idsToRemap.push(factionId);
  }
  const allFactionIdSpans = [
    ...explicitFactionIds,
    ...idsToRemap.map((span) => ({ ...span, recordName: "CAI_FACTION" })),
  ];
  const idReplacements = allFactionIdSpans
    .filter((span) => span.value > removedId)
    .map((span) => ({ start: span.start, end: span.end, data: encodeU32(span.value - 1) }));
  let factionIdsRemapped = replaceByteRanges(root, idReplacements);
  if (factionIdsRemapped !== idReplacements.length) {
    throw new Error(`Rewrote ${factionIdsRemapped} of ${idReplacements.length} faction ID fields.`);
  }
  const factionIdReferenceCounts = new Map<string, number>();
  for (const factionId of allFactionIdSpans) {
    if (factionId.value <= removedId) continue;
    factionIdReferenceCounts.set(factionId.recordName, (factionIdReferenceCounts.get(factionId.recordName) ?? 0) + 1);
  }

  // These known arrays use faction order. Their N+1 layouts specify whether
  // the id-1 participant is leading or trailing.
  const listsTrimmed: RemoveFactionReport["listsTrimmed"] = [];
  for (const name of FACTION_INDEXED_RECORDS) {
    // This matrix is keyed by CAI object IDs, not FACTION_ARRAY position.
      // Block ownership rows are keyed by CAI_BDI_COMPONENT IDs, not faction order.
      if (name === "CAI_FACTION_STRATEGIC_STANCE" || name === "CAI_BDI_COMPONENT_BLOCK_OWNS") continue;
    const instances = findRecords(root, name).filter(
      (node) => node.groups.length === factionsBefore || node.groups.length === factionsBefore + 1
    );
    for (const node of instances) {
      const extraRowOrder = FACTION_INDEXED_EXTRA_ROW_ORDER[name];
      const factionPosition = removedIndex + (
        node.groups.length === factionsBefore + 1 && extraRowOrder === "leading" ? 1 : 0
      );
      node.groups.splice(factionPosition, 1);
      node.groupSizeWidths.splice(factionPosition, 1);
    }
    if (instances.length > 0) {
      listsTrimmed.push({ name, instances: instances.length, from: factionsBefore, to: factionsBefore - 1 });
    }
  }

  const caiStrategicStanceRowsRemoved = removeCaiFactionStanceRows(
    root,
    source,
    removedCaiFactionObjectId
  );
  if (caiStrategicStanceRowsRemoved === 0) {
    throw new Error(`No CAI_FACTION_STRATEGIC_STANCE row references CAI faction key ${removedCaiFactionObjectId}.`);
  }
  listsTrimmed.push({
    name: "CAI_FACTION_STRATEGIC_STANCE",
    instances: caiStrategicStanceRowsRemoved,
    from: factionsBefore,
    to: factionsBefore - 1,
  });

  const caiFactionManagersRemoved = removeCaiFactionInterfaceManager(
    root,
    source,
    removedCaiFactionObjectId
  );
  if (caiFactionManagersRemoved !== 1) {
    throw new Error(
      `Expected one CAI_INTERFACE_MANAGERS group for CAI faction key ${removedCaiFactionObjectId}, found ${caiFactionManagersRemoved}.`
    );
  }

  // Trade-route rows are keyed by faction ID and stored in a permutation, not
  // FACTION_ARRAY order. Remove and compact by the key rather than by row index.
  const tradeRoutes = findFirstRecord(root, "INTERNATIONAL_TRADE_ROUTES");
  if (tradeRoutes) {
    const tradeRouteIds = validateFactionIdPermutation(
      tradeRoutes.groups,
      source,
      "INTERNATIONAL_TRADE_ROUTES",
      factionsBefore
    );
    let tradeRouteRowsRemoved = 0;
    let tradeRouteIdsRemapped = 0;
    for (let index = tradeRoutes.groups.length - 1; index >= 0; index -= 1) {
      const id = tradeRouteIds[index];
      if (id === removedId) {
        tradeRoutes.groups.splice(index, 1);
        tradeRoutes.groupSizeWidths.splice(index, 1);
        tradeRouteRowsRemoved += 1;
      } else if (id > removedId) {
        rewriteLeadingU32(tradeRoutes.groups[index], source, id - 1);
        tradeRouteIdsRemapped += 1;
      }
    }
    if (tradeRouteRowsRemoved !== 1) {
      throw new Error(
        "Expected one INTERNATIONAL_TRADE_ROUTES row for faction id " + removedId + ", found " + tradeRouteRowsRemoved + "."
      );
    }
    if (tradeRouteIdsRemapped > 0) {
      factionIdsRemapped += tradeRouteIdsRemapped;
      factionIdReferenceCounts.set("INTERNATIONAL_TRADE_ROUTES", tradeRouteIdsRemapped);
    }
    listsTrimmed.push({
      name: "INTERNATIONAL_TRADE_ROUTES",
      instances: 1,
      from: factionsBefore,
      to: factionsBefore - 1,
    });
  }

  const influenceMapsRemoved = removeCaiFactionInfluenceMap(root, source, removedCaiFactionObjectId);
  const caiBeliefGroupsRemoved = removeCaiFactionBeliefGroups(
    root,
    source,
    removedCaiFactionObjectId,
    caiPostCleanup.retainedCaiObjectIds
  );
  const caiMilitaryForceBuildingSlotsRemoved = removeCaiMilitaryForceSlots(root, source, militaryForceSlots);
  const caiTechnologiesRemoved = removeOrphanCaiTechnologies(root, source);
  const caiBdiComponentIdsAfter = collectCaiBdiComponentIds(root, source);
  const removedCaiBdiComponentIds = new Set(
    [...caiBdiComponentIdsBefore].filter((id) => !caiBdiComponentIdsAfter.has(id))
  );
  const caiSettlementReferences = remapCaiSettlementReferences(root, source, header, tables, caiOwnerTransfers, removedCaiBdiComponentIds);
  const caiMobileReferencesRemoved = removeCaiMobileReferences(
    root, source, header, tables, removedCaiBdiComponentIds
  );
  const caiDependentReferencesRemoved = removeCaiDependentReferenceArrays(
    root, source, header, tables, removedCaiBdiComponentIds
  );
  const caiBdiBlockOwnershipRowsRemoved = removeCaiBdiComponentOwnershipReferences(
    root,
    source,
    removedCaiBdiComponentIds
  );

  // Remove faction-keyed family and name-manager records.
  let familyMembersRemoved = 0;
  const familyTree = findFirstRecord(root, "FAMILY_TREE");
  if (familyTree?.groups[0]) {
    const group = familyTree.groups[0];
    const declaredMemberCount = readLeadingValues(familyTree, source, 1)[0]?.value;
    const actualMemberCount = group.filter(
      (item) => item.kind === "record" && item.name === "FAMILY_MEMBER"
    ).length;
    if (declaredMemberCount !== actualMemberCount) {
      throw new Error(
        `FAMILY_TREE declares ${declaredMemberCount} FAMILY_MEMBER rows, but contains ${actualMemberCount}.`
      );
    }
    for (let index = group.length - 1; index >= 0; index -= 1) {
      const item = group[index];
      if (item.kind === "record" && item.name === "FAMILY_MEMBER" && itemReferencesKey(item, source, ids)) {
        group.splice(index, 1);
        familyMembersRemoved += 1;
      }
    }
    if (familyMembersRemoved > 0) {
      rewriteLeadingU32(group, source, actualMemberCount - familyMembersRemoved);
    }
  }

  let nameManagerRemoved = false;
  const nameManager = findFirstRecord(root, "CHARACTER_NAME_MANAGER");
  const nameFactions = nameManager ? findFirstRecord(nameManager, "FACTIONS") : null;
  if (nameFactions) {
    const position = nameFactions.groups.findIndex((group) => group.some((item) => itemReferencesKey(item, source, ids)));
    if (position >= 0) {
      nameFactions.groups.splice(position, 1);
      nameFactions.groupSizeWidths.splice(position, 1);
      nameManagerRemoved = true;
    }
  }

  factionArray.groups.splice(removedIndex, 1);
  factionArray.groupSizeWidths.splice(removedIndex, 1);

  return {
    removedKey,
    removedIndex,
    removedId,
    factionsBefore,
    factionsAfter: factionArray.groups.length,
    relationshipsTrimmed,
    factionIdsRemapped,
    factionIdReferencesRemapped: [...factionIdReferenceCounts]
      .map(([recordName, count]) => ({ recordName, count }))
      .sort((a, b) => a.recordName.localeCompare(b.recordName)),
    pairsRemoved,
    listsTrimmed,
    influenceMapsRemoved,
    caiBeliefGroupsRemoved,
    familyMembersRemoved,
    nameManagerRemoved,
    caiCharactersRemoved: caiPostCleanup.caiCharactersRemoved,
    caiCharacterPostsRemoved: caiPostCleanup.caiCharacterPostsRemoved,
    caiResourceMobilesRemoved,
    caiUnitsRemoved,
    caiFactionManagersRemoved,
    caiStrategicStanceRowsRemoved,
    caiBdiComponentsRemoved: removedCaiBdiComponentIds.size,
    caiMobileReferencesRemoved,
    caiDependentReferencesRemoved,
    caiMobileBeliefsRemoved: mobileDependents.beliefsRemoved,
    caiMobileInfluenceMapsRemoved: mobileDependents.mapsRemoved,
    caiBdiBlockOwnershipRowsRemoved,
    regionReferencesReassigned: regionRefs.length,
    regionOwnerIdsRemapped,
    provinceOwnerIdsRemapped,
    factionKeyedRows,
    caiSettlementReferences,
    caiMilitaryForceBuildingSlotsRemoved,
    caiTechnologiesRemoved,
  };
}

/** Re-parses a written file and reports any surviving ASCII references to the removed key. */
export function findFactionKeyReferences(
  buffer: Buffer,
  header: { recordNamesOffset: number },
  tables: CaabStringTables,
  key: string
): string[] {
  const contexts = new Set<string>();
  walkCaabNodes(buffer, header, tables, {
    onValue(value: CaabValue, stack: string[]) {
      if (value.kind !== "value" || value.type !== "ascii") return;
      const ascii = value.value as { id: number; text: string | null };
      if (ascii.text?.toLowerCase() === key.toLowerCase()) contexts.add(stack.join("/"));
    },
  });
  return [...contexts];
}

/** Backwards-compatible alias for callers of the first last-entry-only prototype. */
export const removeLastFaction = removeFaction;
