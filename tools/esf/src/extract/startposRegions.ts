import { EsfDocument } from "../esf/EsfTypes";
import { walkCaabNodes } from "../esf/codecs/caabBinary";

export interface StartposRegion {
  /** 1-based index, sequential in REGIONS_ARRAY order. */
  regionIndex: number;
  key: string;
  /** Faction owning the region at campaign start. */
  ownerFaction: string | null;
  /** Subculture recorded for the region; not always the owner's own subculture. */
  subculture: string | null;
  /** Settlement level key, e.g. wh2_main_lzd_settlement_major_1. */
  settlementKey: string | null;
}

interface RegionWalkState {
  regionIndex: number | null;
  /**
   * ASCII values directly under REGION, in file order. Shipped WH3 startpos
   * files record exactly six: [key, owner faction, subculture, "", faction, ""].
   * Slot 4 holds a second faction key that differs from the owner for some
   * regions; its meaning is unconfirmed, so it is not surfaced.
   */
  regionStrings: string[];
  settlementStrings: string[];
}

function isRegionKey(key: string): boolean {
  return /_region_/i.test(key);
}

function newRegionState(): RegionWalkState {
  return { regionIndex: null, regionStrings: [], settlementStrings: [] };
}

/**
 * Reads campaign regions from a decompressed `startpos.esf`, which stores them
 * under WORLD/REGION_MANAGER/REGIONS_ARRAY rather than in the REGION_DATA and
 * REGION_KEYS records used by a campaign map's `map_data.esf`. Startpos regions
 * carry ownership rather than geometry, so there are no coordinates here.
 *
 * The buffer must already be decompressed; see `openEsfBuffer`.
 */
export function extractStartposRegions(
  buffer: Buffer,
  document: EsfDocument,
  options?: { includeNonRegion?: boolean }
): StartposRegion[] {
  if (!document.metadata) {
    return [];
  }

  const includeNonRegion = options?.includeNonRegion ?? false;
  const regions: StartposRegion[] = [];
  let current: RegionWalkState | null = null;

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
        if (record.name === "REGION" && stack[stack.length - 1] === "REGIONS_ARRAY") {
          current = newRegionState();
        }
      },
      onRecordEnd(record, stack) {
        if (record.name !== "REGION" || stack[stack.length - 1] !== "REGIONS_ARRAY" || !current) {
          return;
        }

        const state = current;
        current = null;

        const key = state.regionStrings[0];
        if (!key || state.regionIndex === null) {
          return;
        }

        if (!includeNonRegion && !isRegionKey(key)) {
          return;
        }

        // The settlement level key is the entry that is not the
        // "settlement:<region>" self-reference.
        const settlementKey =
          state.settlementStrings.find((text) => !text.startsWith("settlement:")) ?? null;

        regions.push({
          regionIndex: state.regionIndex,
          key,
          ownerFaction: state.regionStrings[1] || null,
          subculture: state.regionStrings[2] || null,
          settlementKey,
        });
      },
      onValue(value, stack) {
        if (!current || value.kind !== "value") {
          return;
        }

        const parent = stack[stack.length - 1];

        if (parent === "REGION") {
          if (value.type === "ascii") {
            const ascii = value.value as { id: number; text: string | null };
            current.regionStrings.push(ascii.text ?? "");
            return;
          }

          if (value.type === "u32" && current.regionIndex === null) {
            current.regionIndex = Number(value.value);
          }
          return;
        }

        if (parent === "SETTLEMENT" && value.type === "ascii") {
          const ascii = value.value as { id: number; text: string | null };
          if (ascii.text) {
            current.settlementStrings.push(ascii.text);
          }
        }
      },
    }
  );

  regions.sort((left, right) => left.regionIndex - right.regionIndex);
  return regions;
}
