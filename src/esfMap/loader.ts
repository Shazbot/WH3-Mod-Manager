import { readFromExistingPack, readPack } from "../packFileSerializer";
import type { Pack } from "../packFileTypes";
import appData from "../appData";
import { getVanillaPackPathsInLoadOrder } from "../utility/vanillaPackPaths";
import { getVanillaLocalisationPackPaths } from "../vanillaLocCache/packs";
import { collectVanillaFilesUnderPrefix, type VanillaPackIndex } from "../vanillaPackIndex/format";
import { getVanillaPackIndex } from "../vanillaPackIndex/store";
import { sortByNameAndLoadOrder } from "../modSortingHelpers";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import {
  extractCampaignTableIdentity,
  extractStartposRegionSlotTemplates,
  openEsfBuffer,
  parseEsfDocument,
  type StartposCampaignTableIdentity,
} from "../../tools/esf/src";
import { DEFAULT_ESF_CAMPAIGN } from "./constants";
import { buildEsfMapData } from "./data";
import { encodeDdsAsPng } from "./dds";
import type { EsfMapCampaignOption, EsfMapImage, EsfMapPayload } from "./types";

interface EsfFileCandidate {
  packPath?: string;
  filePath?: string;
  fileName: string;
  modIndex: number;
}

interface EsfCampaignStartposCandidate extends EsfFileCandidate, StartposCampaignTableIdentity {
  buffer: Buffer;
}

type EsfAssetKind = "map" | "startpos" | "lookup" | "pathfinding" | "background" | "background-text";

const normalizePackPath = (value: string): string => value.replace(/\//g, "\\").toLowerCase();

const isPackedFileNamed = (name: string, basename: string): boolean => {
  const normalized = normalizePackPath(name);
  return normalized === basename || normalized.endsWith(`\\${basename}`);
};

const isLookupFileNamed = (name: string): boolean => {
  const normalized = normalizePackPath(name);
  const basename = normalized.slice(normalized.lastIndexOf("\\") + 1);
  return (
    !basename.includes("small_lookup") && (basename.endsWith("_lookup.tga") || basename.endsWith("_lookup_minimap.tga"))
  );
};

const isPathfindingFileNamed = (name: string): boolean => isPackedFileNamed(name, "pathfinding.ppd");

const isCampaignMapBackgroundFileNamed = (name: string, textLayer: boolean): boolean => {
  const normalized = normalizePackPath(name);
  const basename = normalized.slice(normalized.lastIndexOf("\\") + 1);
  return textLayer ? basename.endsWith("_map_text.dds") : basename.endsWith("_map.dds");
};

const isCampaignMapAsset = (name: string): boolean =>
  isPackedFileNamed(name, "map_data.esf") ||
  isLookupFileNamed(name) ||
  isPathfindingFileNamed(name) ||
  isCampaignMapBackgroundFileNamed(name, false) ||
  isCampaignMapBackgroundFileNamed(name, true);

const mapFolderFromPath = (fileName: string): string | undefined => {
  const normalized = normalizePackPath(fileName);
  return normalized.match(/(?:^|\\)campaign_maps\\([^\\]+)(?:\\|$)/i)?.[1];
};

const scoreCandidate = (candidate: EsfFileCandidate, campaignHint: string, kind: EsfAssetKind): number => {
  const path = normalizePackPath(candidate.fileName);
  const hint = campaignHint.toLowerCase();
  const mapHint = hint.replace(/_map_\d+$/, "");
  const basename = path.slice(path.lastIndexOf("\\") + 1);
  const mapFolder = mapFolderFromPath(path);
  let score = 0;
  if (hint && path.includes(hint)) score += 1000;
  if (mapHint && mapHint !== hint && path.includes(mapHint)) score += 500;
  if (path.includes("wh3_main_combi")) score += 100;
  if ((kind === "map" || kind === "lookup" || kind === "pathfinding") && mapFolder) {
    score += 30;
  }
  if (kind === "startpos" && path.includes("\\campaigns\\")) score += 30;
  if (kind === "map") {
    const mapVariant = mapFolder?.match(/_map_(\d+)$/i)?.[1];
    if (mapVariant) score += Math.max(0, 20 - Number(mapVariant));
  }
  if (kind === "lookup" && mapFolder) {
    const mapBase = mapFolder.replace(/_map_\d+$/i, "");
    if (basename === `${mapBase}_lookup.tga`) score += 20;
    else if (basename === `${mapBase}_lookup_minimap.tga`) score += 10;
    else if (basename.endsWith("_lookup.tga")) score += 5;
  }
  if ((kind === "background" || kind === "background-text") && mapFolder) {
    const mapBase = mapFolder.replace(/_map_\d+$/i, "");
    const suffix = kind === "background-text" ? "_map_text.dds" : "_map.dds";
    if (basename === `${mapBase}${suffix}`) score += 20;
  }
  return score;
};

const pickBestCandidate = <Candidate extends EsfFileCandidate>(
  candidates: Candidate[],
  campaignHint: string,
  kind: EsfAssetKind,
): Candidate | undefined =>
  [...candidates].sort((first, second) => {
    const score = scoreCandidate(second, campaignHint, kind) - scoreCandidate(first, campaignHint, kind);
    if (score !== 0) return score;
    return first.fileName.localeCompare(second.fileName);
  })[0];

const formatCampaignLabel = (campaignKey: string): string =>
  campaignKey
    .replace(/^wh3_main_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const getPackedFileNames = async (packPath: string): Promise<string[]> => {
  const retainedPack = appData.packsData.find((pack) => pack.path === packPath);
  if (retainedPack) return retainedPack.packedFiles.map((packedFile) => packedFile.name);
  return (await readPack(packPath, { skipParsingTables: true })).packedFiles.map((packedFile) => packedFile.name);
};

const collectVanillaCampaignMapCandidates = async (
  vanillaIndex: VanillaPackIndex | undefined,
  vanillaPackPaths: string[],
  englishLocalizationPackPaths: string[],
): Promise<EsfFileCandidate[]> => {
  let candidates: EsfFileCandidate[];
  if (vanillaIndex) {
    candidates = Array.from(collectVanillaFilesUnderPrefix(vanillaIndex, "campaign_maps\\"))
      .filter(([fileName]) => isCampaignMapAsset(fileName))
      .map(([fileName, packName]) => ({
        packPath: nodePath.join(appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder ?? "", packName),
        fileName,
        modIndex: -1,
      }));
  } else {
    candidates = [];
    for (const packPath of vanillaPackPaths) {
      try {
        const names = await getPackedFileNames(packPath);
        for (const fileName of names) {
          if (isCampaignMapAsset(fileName)) {
            candidates.push({ packPath, fileName, modIndex: -1 });
          }
        }
      } catch {
        // A single unreadable vanilla pack should not prevent the other packs from being searched.
      }
    }
  }

  // The vanilla files index correctly records the last vanilla pack that wins a path, but that
  // can be a non-English local_* pack. Map text is an image asset rather than a loc table, so
  // make the English local packs explicit here, in the same sorted order used by Unit Viewer.
  // Replace only matching text assets so the normal vanilla pack selection remains unchanged for
  // map data, lookup textures, and pathfinding files.
  const englishTextCandidatesByPath = new Map<string, EsfFileCandidate>();
  for (const packPath of englishLocalizationPackPaths) {
    try {
      const names = await getPackedFileNames(packPath);
      for (const fileName of names) {
        if (isCampaignMapBackgroundFileNamed(fileName, true)) {
          englishTextCandidatesByPath.set(normalizePackPath(fileName), { packPath, fileName, modIndex: -1 });
        }
      }
    } catch {
      // A missing or unreadable localization pack should leave the indexed vanilla candidate in place.
    }
  }
  if (englishTextCandidatesByPath.size > 0) {
    candidates = candidates.filter(
      (candidate) =>
        !isCampaignMapBackgroundFileNamed(candidate.fileName, true) ||
        !englishTextCandidatesByPath.has(normalizePackPath(candidate.fileName)),
    );
    candidates.push(...englishTextCandidatesByPath.values());
  }
  return candidates;
};

/** Vanilla startpos files are loose files under data/campaigns, not pack members. */
const collectVanillaStartposCandidates = async (dataFolder: string): Promise<EsfFileCandidate[]> => {
  const campaignsFolder = nodePath.join(dataFolder, "campaigns");
  let campaignEntries: fs.Dirent[];
  try {
    campaignEntries = await fs.promises.readdir(campaignsFolder, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: EsfFileCandidate[] = [];
  for (const campaignEntry of campaignEntries) {
    if (!campaignEntry.isDirectory()) continue;
    const campaignFolder = nodePath.join(campaignsFolder, campaignEntry.name);
    let files: string[];
    try {
      files = await fs.promises.readdir(campaignFolder);
    } catch {
      continue;
    }
    const startposName = files.find((fileName) => fileName.toLowerCase() === "startpos.esf");
    if (!startposName) continue;
    candidates.push({
      filePath: nodePath.join(campaignFolder, startposName),
      fileName: `campaigns\\${campaignEntry.name}\\${startposName}`,
      modIndex: -1,
    });
  }
  return candidates;
};

/** Returns the loose vanilla startpos files so callers can include them in cache identities. */
export const getVanillaStartposFilePaths = async (dataFolder: string): Promise<string[]> =>
  (await collectVanillaStartposCandidates(dataFolder))
    .map((candidate) => candidate.filePath)
    .filter((filePath): filePath is string => !!filePath);

const collectModCandidates = async (
  mods: Mod[],
  matches: (fileName: string) => boolean,
): Promise<EsfFileCandidate[]> => {
  const candidates: EsfFileCandidate[] = [];
  const orderedMods = sortByNameAndLoadOrder(mods);
  for (let modIndex = 0; modIndex < orderedMods.length; modIndex += 1) {
    const mod = orderedMods[modIndex];
    try {
      const names = await getPackedFileNames(mod.path);
      for (const fileName of names) {
        if (matches(fileName)) {
          candidates.push({ packPath: mod.path, fileName, modIndex });
        }
      }
    } catch {
      // The manager can still display vanilla map data if one enabled mod is unreadable.
    }
  }
  return candidates;
};

const pickEffectiveModCandidate = <Candidate extends EsfFileCandidate>(
  candidates: Candidate[],
  campaignHint: string,
  kind: EsfAssetKind,
): Candidate | undefined => {
  const highestModIndex = Math.max(...candidates.map((candidate) => candidate.modIndex), -1);
  if (highestModIndex < 0) return undefined;
  return pickBestCandidate(
    candidates.filter((candidate) => candidate.modIndex === highestModIndex),
    campaignHint,
    kind,
  );
};

const mapFolderMatches = (candidate: EsfFileCandidate, mapFolder: string): boolean =>
  mapFolderFromPath(candidate.fileName)?.toLowerCase() === mapFolder.toLowerCase();

const pickCandidateForMapFolder = (
  modCandidates: EsfFileCandidate[],
  vanillaCandidates: EsfFileCandidate[],
  mapFolder: string,
  kind: EsfAssetKind,
): EsfFileCandidate | undefined => {
  const matchingMods = modCandidates.filter((candidate) => mapFolderMatches(candidate, mapFolder));
  const effectiveMod = pickEffectiveModCandidate(matchingMods, mapFolder, kind);
  if (effectiveMod) return effectiveMod;

  const matchingVanilla = vanillaCandidates.filter((candidate) => mapFolderMatches(candidate, mapFolder));
  return pickBestCandidate(matchingVanilla, mapFolder, kind);
};

/**
 * Reads packed candidates grouped by their source pack. The pack reader keeps one file descriptor
 * open while it processes `filesToRead`, so grouping the map layers avoids reopening data_maps.pack
 * once for map_data, lookup, pathfinding, and each background layer.
 */
const readPackedFileBuffers = async (candidates: EsfFileCandidate[]): Promise<Map<EsfFileCandidate, Buffer>> => {
  const buffers = new Map<EsfFileCandidate, Buffer>();
  const candidatesByPack = new Map<string, EsfFileCandidate[]>();

  await Promise.all(
    candidates.map(async (candidate) => {
      if (candidate.filePath) {
        buffers.set(candidate, await fs.promises.readFile(candidate.filePath));
        return;
      }
      if (!candidate.packPath) throw new Error(`No source pack was recorded for ${candidate.fileName}.`);
      const packCandidates = candidatesByPack.get(candidate.packPath) ?? [];
      packCandidates.push(candidate);
      candidatesByPack.set(candidate.packPath, packCandidates);
    }),
  );

  await Promise.all(
    [...candidatesByPack].map(async ([packPath, packCandidates]) => {
      const retainedPack = appData.packsData.find((pack) => pack.path === packPath);
      const pack: Pack = retainedPack
        ? await readFromExistingPack(retainedPack, {
            filesToRead: packCandidates.map((candidate) => candidate.fileName),
            skipParsingTables: true,
          })
        : await readPack(packPath, {
            filesToRead: packCandidates.map((candidate) => candidate.fileName),
            skipParsingTables: true,
          });

      for (const candidate of packCandidates) {
        const normalized = normalizePackPath(candidate.fileName);
        const packedFile = pack.packedFiles.find((file) => normalizePackPath(file.name) === normalized);
        if (!packedFile?.buffer) {
          throw new Error(`Could not read ${candidate.fileName} from ${candidate.packPath}.`);
        }
        buffers.set(candidate, Buffer.from(packedFile.buffer));
      }
    }),
  );

  return buffers;
};

const readPackedFileBuffer = async (candidate: EsfFileCandidate): Promise<Buffer> => {
  const buffer = (await readPackedFileBuffers([candidate])).get(candidate);
  if (!buffer) throw new Error(`Could not read ${candidate.fileName}.`);
  return buffer;
};

const readCampaignStartposCandidates = async (
  candidates: EsfFileCandidate[],
): Promise<EsfCampaignStartposCandidate[]> => {
  const extracted = await Promise.all(
    candidates.map(async (candidate): Promise<EsfCampaignStartposCandidate | undefined> => {
      try {
        const buffer = await readPackedFileBuffer(candidate);
        const identity = extractCampaignTableIdentity(buffer, parseEsfDocument(buffer));
        return identity ? { ...candidate, ...identity, buffer } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return extracted.filter((candidate): candidate is EsfCampaignStartposCandidate => candidate !== undefined);
};

/**
 * Reads the database-shaped region slot-template rows from the effective startpos for every
 * campaign. Vanilla startpos files are loose under `data/campaigns`; enabled-mod startpos files
 * are packed and follow the same campaign identity selection as the map tab.
 */
export async function loadStartposRegionSlotTemplates(
  enabledMods: Mod[],
): Promise<Array<{ campaign: string; region: string; slot_template: string; slot_type: string }>> {
  if (appData.currentGame !== "wh3") return [];
  const dataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
  if (!dataFolder) return [];

  const [vanillaCandidates, modCandidates] = await Promise.all([
    collectVanillaStartposCandidates(dataFolder),
    collectModCandidates(enabledMods, (fileName) => isPackedFileNamed(fileName, "startpos.esf")),
  ]);
  const candidates = await readCampaignStartposCandidates([...vanillaCandidates, ...modCandidates]);
  const campaignNames = [...new Set(candidates.map((candidate) => candidate.campaignName))].sort((first, second) =>
    first.localeCompare(second),
  );
  const rows: Array<{ campaign: string; region: string; slot_template: string; slot_type: string }> = [];

  for (const campaignName of campaignNames) {
    const candidate = pickStartposCandidateForCampaign(candidates, campaignName);
    if (!candidate) continue;
    try {
      const opened = openEsfBuffer(candidate.buffer);
      const document = parseEsfDocument(opened.buffer);
      rows.push(
        ...extractStartposRegionSlotTemplates(opened.buffer, document, candidate.campaignName).map((row) => ({
          campaign: row.campaign,
          region: row.region,
          slot_template: row.slotTemplate,
          slot_type: row.slotType,
        })),
      );
    } catch (error) {
      console.warn(
        `Could not extract startpos slot templates from ${candidate.fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return rows;
}

const pickStartposCandidateForCampaign = (
  candidates: EsfCampaignStartposCandidate[],
  campaignName: string,
): EsfCampaignStartposCandidate | undefined => {
  const matchingCandidates = candidates.filter(
    (candidate) => candidate.campaignName.toLowerCase() === campaignName.toLowerCase(),
  );
  const effectiveMod = pickEffectiveModCandidate(
    matchingCandidates.filter((candidate) => candidate.modIndex >= 0),
    campaignName,
    "startpos",
  );
  if (effectiveMod) return effectiveMod;
  return pickBestCandidate(
    matchingCandidates.filter((candidate) => candidate.modIndex < 0),
    campaignName,
    "startpos",
  );
};

const convertDdsToMapImage = (
  buffer: Buffer,
  candidate: EsfFileCandidate,
  width: number,
  height: number,
): EsfMapImage => {
  try {
    return {
      width,
      height,
      src: `data:image/png;base64,${encodeDdsAsPng(buffer, width, height).toString("base64")}`,
    };
  } catch (error) {
    throw new Error(
      `Could not decode ${candidate.fileName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export async function loadEsfMapData(
  enabledMods: Mod[],
  requestedCampaign = DEFAULT_ESF_CAMPAIGN,
): Promise<EsfMapPayload> {
  if (appData.currentGame !== "wh3") {
    throw new Error("The campaign map is available only for Warhammer 3.");
  }

  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
  if (!dataFolder) throw new Error("The Warhammer 3 data folder is not configured.");

  const vanillaPackPaths = getVanillaPackPathsInLoadOrder();
  const englishLocalizationPackPaths = getVanillaLocalisationPackPaths(
    appData.allVanillaPackNames,
    appData.currentLanguage,
    dataFolder,
    true,
  );
  const vanillaIndex = await getVanillaPackIndex();
  const [vanillaMapAssets, vanillaStartposCandidates, modMapAssets, modStartposCandidates] = await Promise.all([
    collectVanillaCampaignMapCandidates(vanillaIndex, vanillaPackPaths, englishLocalizationPackPaths),
    collectVanillaStartposCandidates(dataFolder),
    collectModCandidates(enabledMods, isCampaignMapAsset),
    collectModCandidates(enabledMods, (fileName) => isPackedFileNamed(fileName, "startpos.esf")),
  ]);
  const vanillaMapCandidates = vanillaMapAssets.filter((candidate) =>
    isPackedFileNamed(candidate.fileName, "map_data.esf"),
  );
  const vanillaLookupCandidates = vanillaMapAssets.filter((candidate) => isLookupFileNamed(candidate.fileName));
  const vanillaPathfindingCandidates = vanillaMapAssets.filter((candidate) =>
    isPathfindingFileNamed(candidate.fileName),
  );
  const vanillaBackgroundCandidates = vanillaMapAssets.filter((candidate) =>
    isCampaignMapBackgroundFileNamed(candidate.fileName, false),
  );
  const vanillaBackgroundTextCandidates = vanillaMapAssets.filter((candidate) =>
    isCampaignMapBackgroundFileNamed(candidate.fileName, true),
  );
  const modMapCandidates = modMapAssets.filter((candidate) => isPackedFileNamed(candidate.fileName, "map_data.esf"));
  const modLookupCandidates = modMapAssets.filter((candidate) => isLookupFileNamed(candidate.fileName));
  const modPathfindingCandidates = modMapAssets.filter((candidate) => isPathfindingFileNamed(candidate.fileName));
  const modBackgroundCandidates = modMapAssets.filter((candidate) =>
    isCampaignMapBackgroundFileNamed(candidate.fileName, false),
  );
  const modBackgroundTextCandidates = modMapAssets.filter((candidate) =>
    isCampaignMapBackgroundFileNamed(candidate.fileName, true),
  );

  const allStartposCandidates = await readCampaignStartposCandidates([
    ...vanillaStartposCandidates,
    ...modStartposCandidates,
  ]);
  const campaignByKey = new Map<string, string>();
  for (const candidate of allStartposCandidates) {
    campaignByKey.set(candidate.campaignName.toLowerCase(), candidate.campaignName);
  }
  const availableCampaigns: EsfMapCampaignOption[] = Array.from(campaignByKey.values())
    .sort((first, second) => {
      if (first.toLowerCase() === DEFAULT_ESF_CAMPAIGN) return -1;
      if (second.toLowerCase() === DEFAULT_ESF_CAMPAIGN) return 1;
      return first.localeCompare(second);
    })
    .map((campaignKey) => ({ key: campaignKey, label: formatCampaignLabel(campaignKey) }));

  const requestedCampaignKey =
    campaignByKey.get(requestedCampaign.toLowerCase()) ??
    campaignByKey.get(DEFAULT_ESF_CAMPAIGN) ??
    availableCampaigns[0]?.key;
  if (!requestedCampaignKey) {
    throw new Error("No campaign startpos.esf was found in the enabled mods or Warhammer 3's data/campaigns folders.");
  }

  const startposCandidate = pickStartposCandidateForCampaign(allStartposCandidates, requestedCampaignKey);
  const mapDataCandidate = startposCandidate
    ? pickCandidateForMapFolder(modMapCandidates, vanillaMapCandidates, startposCandidate.mapName, "map")
    : undefined;

  if (!startposCandidate) {
    throw new Error(`No startpos.esf was found for campaign ${requestedCampaignKey}.`);
  }
  if (!mapDataCandidate) {
    throw new Error(
      `No campaign map_data.esf was found for map ${startposCandidate.mapName} in the enabled mods or Warhammer 3's vanilla packs.`,
    );
  }

  const mapFolder = mapFolderFromPath(mapDataCandidate.fileName) ?? startposCandidate.mapName;
  const lookupCandidate = mapFolder
    ? pickCandidateForMapFolder(modLookupCandidates, vanillaLookupCandidates, mapFolder, "lookup")
    : undefined;
  const pathfindingCandidate = mapFolder
    ? pickCandidateForMapFolder(modPathfindingCandidates, vanillaPathfindingCandidates, mapFolder, "pathfinding")
    : undefined;
  const backgroundCandidate = mapFolder
    ? pickCandidateForMapFolder(modBackgroundCandidates, vanillaBackgroundCandidates, mapFolder, "background")
    : undefined;
  const backgroundTextCandidate = mapFolder
    ? pickCandidateForMapFolder(
        modBackgroundTextCandidates,
        vanillaBackgroundTextCandidates,
        mapFolder,
        "background-text",
      )
    : undefined;

  const mapAssetCandidates = [
    mapDataCandidate,
    lookupCandidate,
    pathfindingCandidate,
    backgroundCandidate,
    backgroundTextCandidate,
  ].filter((candidate): candidate is EsfFileCandidate => !!candidate);
  const mapAssetBuffers = await readPackedFileBuffers(mapAssetCandidates);
  const mapDataBuffer = mapAssetBuffers.get(mapDataCandidate);
  if (!mapDataBuffer) throw new Error(`Could not read ${mapDataCandidate.fileName}.`);
  const lookupBuffer = lookupCandidate ? mapAssetBuffers.get(lookupCandidate) : undefined;
  const pathfindingBuffer = pathfindingCandidate ? mapAssetBuffers.get(pathfindingCandidate) : undefined;
  const backgroundBuffer = backgroundCandidate ? mapAssetBuffers.get(backgroundCandidate) : undefined;
  const backgroundTextBuffer = backgroundTextCandidate ? mapAssetBuffers.get(backgroundTextCandidate) : undefined;
  const startposBuffer = startposCandidate.buffer;
  const map = buildEsfMapData(mapDataBuffer, startposBuffer, lookupBuffer, pathfindingBuffer, {
    mapDataPath: mapDataCandidate.fileName,
    startposPath: startposCandidate.fileName,
    lookupPath: lookupCandidate?.fileName ?? null,
  });
  return {
    ...map,
    backgroundImage:
      backgroundBuffer && backgroundCandidate
        ? convertDdsToMapImage(backgroundBuffer, backgroundCandidate, map.width, map.height)
        : null,
    backgroundTextImage:
      backgroundTextBuffer && backgroundTextCandidate
        ? convertDdsToMapImage(backgroundTextBuffer, backgroundTextCandidate, map.width, map.height)
        : null,
    campaignKey: startposCandidate.campaignName,
    availableCampaigns,
  };
}
