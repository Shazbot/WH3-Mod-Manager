import { CaabRecordNode } from "../esf/codecs/caabTree";
import { findRecords } from "./addFaction";
import { readLeadingValues } from "./caiFactionIds";

/** CAI_BUILDING_SLOT v0 direct u32 slot1 is a MILITARY_FORCE_SLOT ID.
 * Slots0/2 use other campaign ID domains, even when their numeric values collide.
 */
export function removeCaiMilitaryForceSlots(root: CaabRecordNode, source: Buffer, removedSlotIds: ReadonlySet<number>): number {
  let removed = 0;
  for (const world of findRecords(root, "CAI_WORLD_BUILDING_SLOTS")) {
    const groups = [], widths = [];
    for (let i = 0; i < world.groups.length; i++) {
      const group = world.groups[i], slot = group.find((node): node is CaabRecordNode => node.kind === "record" && node.name === "CAI_BUILDING_SLOT");
      if (!slot || slot.version !== 0) throw new Error("Unsupported AI building-slot row.");
      const values = readLeadingValues(slot, source, 3);
      if (values.length !== 3 || values.some(value => value.signed)) throw new Error("Malformed AI building-slot campaign references.");
      if (values[1].value !== 0 && removedSlotIds.has(values[1].value)) { removed++; continue; }
      groups.push(group); widths.push(world.groupSizeWidths[i]);
    }
    world.groups = groups; world.groupSizeWidths = widths;
  }
  return removed;
}

export function validateCaiMilitaryForceSlots(root: CaabRecordNode, source: Buffer): void {
  const live = new Set(findRecords(root, "MILITARY_FORCE_SLOT").map(node => {
    const id = readLeadingValues(node, source, 1)[0];
    if (!id || id.signed) throw new Error("Military-force slot ID missing.");
    return id.value;
  }));
  for (const world of findRecords(root, "CAI_WORLD_BUILDING_SLOTS")) for (const group of world.groups) {
    const slot = group.find((node): node is CaabRecordNode => node.kind === "record" && node.name === "CAI_BUILDING_SLOT");
    if (!slot || slot.version !== 0) throw new Error("Unsupported AI building-slot row.");
    const id = readLeadingValues(slot, source, 2)[1];
    if (!id || id.signed || (id.value !== 0 && !live.has(id.value))) throw new Error(`AI building slot references missing military-force slot ${id?.value}.`);
  }
}
