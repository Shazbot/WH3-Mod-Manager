import { EsfDocument } from "../esf/EsfTypes";
import { walkCaabNodes } from "../esf/codecs/caabBinary";

/** A row from `start_pos_region_slot_templates_tables`, without its index column. */
export interface StartposRegionSlotTemplate {
  campaign: string;
  region: string;
  slotTemplate: string;
  slotType: string;
}

interface RegionState {
  key: string;
}

interface SlotState {
  strings: string[];
}

/**
 * Extracts the start-position region slot-template table from a decompressed
 * `startpos.esf`.
 *
 * The ESF stores one `REGION_SLOT` record per slot instance. Its direct ASCII
 * values begin with the instance key, followed by the slot template and slot
 * type. The database-shaped table does not include that instance/index value,
 * and repeated instances of the same template/type are represented once.
 */
export function extractStartposRegionSlotTemplates(
  buffer: Buffer,
  document: EsfDocument,
  campaign: string,
): StartposRegionSlotTemplate[] {
  if (!document.metadata || !campaign) return [];

  const rows: StartposRegionSlotTemplate[] = [];
  const seen = new Set<string>();
  let region: RegionState | null = null;
  let slot: SlotState | null = null;

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
        if (record.name === "REGION" && parent === "REGIONS_ARRAY") {
          region = { key: "" };
          return;
        }
        if (record.name === "REGION_SLOT" && parent === "REGION_SLOT_ARRAY") {
          slot = { strings: [] };
        }
      },
      onRecordEnd(record, stack) {
        const parent = stack[stack.length - 1];
        if (record.name === "REGION_SLOT" && parent === "REGION_SLOT_ARRAY") {
          if (region?.key && slot) {
            const slotTemplate = slot.strings[1] ?? "";
            const slotType = slot.strings[2] ?? "";
            if (slotTemplate && slotType) {
              const key = `${campaign}|${region.key}|${slotTemplate}|${slotType}`;
              if (!seen.has(key)) {
                seen.add(key);
                rows.push({ campaign, region: region.key, slotTemplate, slotType });
              }
            }
          }
          slot = null;
          return;
        }
        if (record.name === "REGION" && parent === "REGIONS_ARRAY") {
          region = null;
        }
      },
      onValue(value, stack) {
        if (!region || value.kind !== "value" || value.type !== "ascii") return;
        const text = (value.value as { id: number; text: string | null }).text ?? "";
        const parent = stack[stack.length - 1];
        if (parent === "REGION" && !region.key) {
          region.key = text;
          return;
        }
        if (parent === "REGION_SLOT" && slot) {
          slot.strings.push(text);
        }
      },
    },
  );

  return rows;
}
