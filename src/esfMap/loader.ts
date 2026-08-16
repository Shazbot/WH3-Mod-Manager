import { readFromExistingPack, readPack } from "../packFileSerializer";
import type { Pack } from "../packFileTypes";
import appData from "../appData";
import { getVanillaPackPathsInLoadOrder } from "../utility/vanillaPackPaths";
import { collectVanillaFilesMatching, type VanillaPackIndex } from "../vanillaPackIndex/format";
import { getVanillaPackIndex } from "../vanillaPackIndex/store";
import { sortByNameAndLoadOrder } from "../modSortingHelpers";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { DEFAULT_ESF_CAMPAIGN } from "./constants";
import { buildEsfMapData } from "./data";
import type { EsfMapCampaignOption, EsfMapPayload } from "./types";

interface EsfFileCandidate {
  packPath?: string;
  filePath?: string;
  fileName: string;
  modIndex: number;
}

const normalizePackPath = (value: string): string => value.replace(/\//g, "\\").toLowerCase();

const isPackedFileNamed = (name: string, basename: string): boolean => {
  const normalized = normalizePackPath(name);
  return normalized === basename || normalized.endsWith(`\\${basename}`);
};

const scoreCandidate = (candidate: EsfFileCandidate, campaignHint: string, kind: "map" | "startpos"): number => {
  const path = normalizePackPath(candidate.fileName);
  const hint = campaignHint.toLowerCase();
  const mapHint = hint.replace(/_map_\d+$/, "");
  let score = 0;
  if (hint && path.includes(hint)) score += 1000;
  if (mapHint && mapHint !== hint && path.includes(mapHint)) score += 500;
  if (path.includes("wh3_main_combi")) score += 100;
  if (kind === "map" && path.includes("\\campaign_maps\\")) score += 30;
  if (kind === "startpos" && path.includes("\\campaigns\\")) score += 30;
  if (kind === "map" && path.includes("_map_3\\")) score += 5;
  return score;
};

const pickBestCandidate = (
  candidates: EsfFileCandidate[],
  campaignHint: string,
  kind: "map" | "startpos",
): EsfFileCandidate | undefined =>
  [...candidates].sort((first, second) => {
    const score = scoreCandidate(second, campaignHint, kind) - scoreCandidate(first, campaignHint, kind);
    if (score !== 0) return score;
    return first.fileName.localeCompare(second.fileName);
  })[0];

const campaignKeyFromPath = (fileName: string): string | undefined => {
  const normalized = normalizePackPath(fileName);
  const startposMatch = normalized.match(/(?:^|\\)campaigns\\([^\\]+)\\startpos\.esf$/i);
  if (startposMatch) return startposMatch[1];
  const mapDataMatch = normalized.match(/(?:^|\\)campaign_maps\\([^\\]+)\\map_data\.esf$/i);
  return mapDataMatch?.[1].replace(/_map_\d+$/i, "");
};

const campaignMatches = (candidate: EsfFileCandidate, campaignKey: string): boolean =>
  campaignKeyFromPath(candidate.fileName)?.toLowerCase() === campaignKey.toLowerCase();

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

const collectVanillaPackCandidates = async (
  vanillaIndex: VanillaPackIndex | undefined,
  vanillaPackPaths: string[],
  basename: string,
): Promise<EsfFileCandidate[]> => {
  if (vanillaIndex) {
    return Array.from(
      collectVanillaFilesMatching(vanillaIndex, (fileName) => isPackedFileNamed(fileName, basename)),
    ).map(([fileName, packName]) => ({
      packPath: nodePath.join(appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder ?? "", packName),
      fileName,
      modIndex: -1,
    }));
  }

  const candidates: EsfFileCandidate[] = [];
  for (const packPath of vanillaPackPaths) {
    try {
      const names = await getPackedFileNames(packPath);
      for (const fileName of names) {
        if (isPackedFileNamed(fileName, basename)) {
          candidates.push({ packPath, fileName, modIndex: -1 });
        }
      }
    } catch {
      // A single unreadable vanilla pack should not prevent the other packs from being searched.
    }
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

const collectModCandidates = async (mods: Mod[], basename: string): Promise<EsfFileCandidate[]> => {
  const candidates: EsfFileCandidate[] = [];
  const orderedMods = sortByNameAndLoadOrder(mods);
  for (let modIndex = 0; modIndex < orderedMods.length; modIndex += 1) {
    const mod = orderedMods[modIndex];
    try {
      const names = await getPackedFileNames(mod.path);
      for (const fileName of names) {
        if (isPackedFileNamed(fileName, basename)) {
          candidates.push({ packPath: mod.path, fileName, modIndex });
        }
      }
    } catch {
      // The manager can still display vanilla map data if one enabled mod is unreadable.
    }
  }
  return candidates;
};

const pickEffectiveModCandidate = (
  candidates: EsfFileCandidate[],
  campaignHint: string,
  kind: "map" | "startpos",
): EsfFileCandidate | undefined => {
  const highestModIndex = Math.max(...candidates.map((candidate) => candidate.modIndex), -1);
  if (highestModIndex < 0) return undefined;
  return pickBestCandidate(
    candidates.filter((candidate) => candidate.modIndex === highestModIndex),
    campaignHint,
    kind,
  );
};

const pickCandidateForCampaign = (
  modCandidates: EsfFileCandidate[],
  vanillaCandidates: EsfFileCandidate[],
  campaignKey: string,
  kind: "map" | "startpos",
): EsfFileCandidate | undefined => {
  const matchingMods = modCandidates.filter((candidate) => campaignMatches(candidate, campaignKey));
  const effectiveMod = pickEffectiveModCandidate(matchingMods, campaignKey, kind);
  if (effectiveMod) return effectiveMod;

  const matchingVanilla = vanillaCandidates.filter((candidate) => campaignMatches(candidate, campaignKey));
  return pickBestCandidate(matchingVanilla, campaignKey, kind);
};

const readPackedFileBuffer = async (candidate: EsfFileCandidate): Promise<Buffer> => {
  if (candidate.filePath) return fs.promises.readFile(candidate.filePath);
  if (!candidate.packPath) throw new Error(`No source pack was recorded for ${candidate.fileName}.`);

  const retainedPack = appData.packsData.find((pack) => pack.path === candidate.packPath);
  const pack: Pack = retainedPack
    ? await readFromExistingPack(retainedPack, { filesToRead: [candidate.fileName], skipParsingTables: true })
    : await readPack(candidate.packPath, { filesToRead: [candidate.fileName], skipParsingTables: true });
  const normalized = normalizePackPath(candidate.fileName);
  const packedFile = pack.packedFiles.find((file) => normalizePackPath(file.name) === normalized);
  if (!packedFile?.buffer) {
    throw new Error(`Could not read ${candidate.fileName} from ${candidate.packPath}.`);
  }
  return Buffer.from(packedFile.buffer);
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
  const vanillaIndex = await getVanillaPackIndex();
  const [vanillaMapCandidates, vanillaStartposCandidates, modMapCandidates, modStartposCandidates] = await Promise.all([
    collectVanillaPackCandidates(vanillaIndex, vanillaPackPaths, "map_data.esf"),
    collectVanillaStartposCandidates(dataFolder),
    collectModCandidates(enabledMods, "map_data.esf"),
    collectModCandidates(enabledMods, "startpos.esf"),
  ]);

  const allStartposCandidates = [...vanillaStartposCandidates, ...modStartposCandidates];
  const campaignByKey = new Map<string, string>();
  for (const candidate of allStartposCandidates) {
    const campaignKey = campaignKeyFromPath(candidate.fileName);
    if (campaignKey) campaignByKey.set(campaignKey.toLowerCase(), campaignKey);
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

  const startposCandidate = pickCandidateForCampaign(
    modStartposCandidates,
    vanillaStartposCandidates,
    requestedCampaignKey,
    "startpos",
  );
  const mapDataCandidate = pickCandidateForCampaign(
    modMapCandidates,
    vanillaMapCandidates,
    requestedCampaignKey,
    "map",
  );

  if (!startposCandidate) {
    throw new Error(`No startpos.esf was found for campaign ${requestedCampaignKey}.`);
  }
  if (!mapDataCandidate) {
    throw new Error("No campaign map_data.esf was found in the enabled mods or Warhammer 3's vanilla packs.");
  }

  const [mapDataBuffer, startposBuffer] = await Promise.all([
    readPackedFileBuffer(mapDataCandidate),
    readPackedFileBuffer(startposCandidate),
  ]);
  const map = buildEsfMapData(mapDataBuffer, startposBuffer, {
    mapDataPath: mapDataCandidate.fileName,
    startposPath: startposCandidate.fileName,
  });
  return { ...map, campaignKey: requestedCampaignKey, availableCampaigns };
}
