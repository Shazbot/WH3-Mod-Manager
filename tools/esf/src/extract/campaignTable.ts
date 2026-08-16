import { EsfDocument } from "../esf/EsfTypes";
import { CaabValue, walkCaabNodes } from "../esf/codecs/caabBinary";

/**
 * The subset of a `campaigns_tables` row which is persisted in startpos.esf.
 *
 * The DB-only/localised columns (onscreen_name, description, exportable,
 * bullet_list, mask, mp_sort_order and game) cannot be recovered from an ESF
 * and are intentionally not represented here.
 */
export interface StartposCampaignTableRow {
  campaignName: string;
  mapName: string;
  displayLocation: string;
  availableForMp: boolean;
  scriptPath: string;
  battlePath: string;
  terrainLocation: string;
}

export interface StartposCampaignTableIdentity {
  campaignName: string;
  mapName: string;
}

interface RecordValues {
  strings: string[];
  booleans: boolean[];
}

function emptyRecordValues(): RecordValues {
  return { strings: [], booleans: [] };
}

function readDirectValue(value: CaabValue, target: RecordValues): void {
  if (value.kind !== "value") {
    return;
  }

  if (value.type === "ascii") {
    const stringValue = value.value as { id: number; text: string | null };
    target.strings.push(stringValue.text ?? "");
    return;
  }

  if (value.type === "bool") {
    target.booleans.push(Boolean(value.value));
  }
}

function matchesStack(stack: string[], expected: string[]): boolean {
  return stack.length === expected.length && stack.every((name, index) => name === expected[index]);
}

/**
 * Reads the two campaign identity fields duplicated in the outer, uncompressed
 * startpos wrapper. This deliberately works on either the original compressed
 * file or an already decompressed ESF.
 */
export function extractCampaignTableIdentity(
  buffer: Buffer,
  document: EsfDocument,
): StartposCampaignTableIdentity | null {
  if (!document.metadata) {
    return null;
  }

  const preopen = emptyRecordValues();
  walkCaabNodes(
    buffer,
    { recordNamesOffset: document.header.recordNamesOffset },
    {
      recordNames: document.metadata.recordNames,
      utf8ById: document.metadata.utf8ById,
      utf16ById: document.metadata.utf16ById,
    },
    {
      onValue(value, stack) {
        if (matchesStack(stack, ["CAMPAIGN_STARTPOS", "CAMPAIGN_PREOPEN_MAP_INFO"])) {
          readDirectValue(value, preopen);
        }
      },
    },
  );

  const campaignName = preopen.strings[0];
  const mapName = preopen.strings[1];
  return campaignName && mapName ? { campaignName, mapName } : null;
}

/**
 * Reconstructs the fields of `campaigns_tables` that the game serialises into
 * a decompressed WH3 startpos.
 *
 * The data is split between three records:
 *
 * - CAMPAIGN_PREOPEN_MAP_INFO: campaign_name and map_name
 * - CAMPAIGN_SETUP: script_path
 * - CAMPAIGN_MAP_DATA: display_location, available_for_mp, battle_path and
 *   terrain_location
 *
 * The buffer must already be decompressed; see `openEsfBuffer`.
 */
export function extractCampaignTableRow(buffer: Buffer, document: EsfDocument): StartposCampaignTableRow | null {
  if (!document.metadata) {
    return null;
  }

  const preopen = emptyRecordValues();
  const setup = emptyRecordValues();
  const mapData = emptyRecordValues();

  walkCaabNodes(
    buffer,
    { recordNamesOffset: document.header.recordNamesOffset },
    {
      recordNames: document.metadata.recordNames,
      utf8ById: document.metadata.utf8ById,
      utf16ById: document.metadata.utf16ById,
    },
    {
      onValue(value, stack) {
        if (matchesStack(stack, ["CAMPAIGN_STARTPOS", "CAMPAIGN_PREOPEN_MAP_INFO"])) {
          readDirectValue(value, preopen);
          return;
        }

        if (matchesStack(stack, ["CAMPAIGN_STARTPOS", "CAMPAIGN_ENV", "CAMPAIGN_SETUP"])) {
          readDirectValue(value, setup);
          return;
        }

        if (matchesStack(stack, ["CAMPAIGN_STARTPOS", "CAMPAIGN_ENV", "CAMPAIGN_MODEL", "CAMPAIGN_MAP_DATA"])) {
          readDirectValue(value, mapData);
        }
      },
    },
  );

  const campaignName = preopen.strings[0];
  const mapName = preopen.strings[1];
  const scriptPath = setup.strings.find((value) => value.startsWith("script/campaign/"));

  // CAMPAIGN_MAP_DATA v0 stores:
  // [map directory, display directory, map_name, battle_path,
  //  terrain_location, available_for_mp, display_location].
  const battlePath = mapData.strings[3];
  const terrainLocation = mapData.strings[4];
  const displayLocation = mapData.strings[5];
  const availableForMp = mapData.booleans[0];

  if (
    !campaignName ||
    !mapName ||
    !scriptPath ||
    !battlePath ||
    !terrainLocation ||
    !displayLocation ||
    availableForMp === undefined ||
    setup.strings[0] !== campaignName ||
    mapData.strings[2] !== mapName
  ) {
    return null;
  }

  return {
    campaignName,
    mapName,
    displayLocation,
    availableForMp,
    scriptPath,
    battlePath,
    terrainLocation,
  };
}
