import { readFromExistingPack, readPack } from "../packFileSerializer";
import type { Pack } from "../packFileTypes";
import appData from "../appData";
import { getVanillaPackPathsInLoadOrder } from "../utility/vanillaPackPaths";
import { collectVanillaFilesMatching, type VanillaPackIndex } from "../vanillaPackIndex/format";
import { getVanillaPackIndex } from "../vanillaPackIndex/store";
import { sortByNameAndLoadOrder } from "../modSortingHelpers";
import * as nodePath from "node:path";
import { buildEsfMapData } from "./data";
import type { EsfMapPayload } from "./types";

interface EsfFileCandidate {
  packPath: string;
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

const campaignHintFromStartpos = (startposPath: string | undefined): string => {
  const normalized = startposPath ? normalizePackPath(startposPath) : "";
  const campaignMatch = normalized.match(/\\campaigns\\([^\\]+)\\startpos\.esf$/i);
  return campaignMatch?.[1] ?? "wh3_main_combi";
};

const getPackedFileNames = async (packPath: string): Promise<string[]> => {
  const retainedPack = appData.packsData.find((pack) => pack.path === packPath);
  if (retainedPack) return retainedPack.packedFiles.map((packedFile) => packedFile.name);
  return (await readPack(packPath, { skipParsingTables: true })).packedFiles.map((packedFile) => packedFile.name);
};

const collectVanillaCandidates = async (
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

const readPackedFileBuffer = async (candidate: EsfFileCandidate): Promise<Buffer> => {
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

export async function loadEsfMapData(enabledMods: Mod[]): Promise<EsfMapPayload> {
  if (appData.currentGame !== "wh3") {
    throw new Error("The campaign map is available only for Warhammer 3.");
  }

  const vanillaPackPaths = getVanillaPackPathsInLoadOrder();
  const vanillaIndex = await getVanillaPackIndex();
  const [vanillaMapCandidates, vanillaStartposCandidates, modMapCandidates, modStartposCandidates] = await Promise.all([
    collectVanillaCandidates(vanillaIndex, vanillaPackPaths, "map_data.esf"),
    collectVanillaCandidates(vanillaIndex, vanillaPackPaths, "startpos.esf"),
    collectModCandidates(enabledMods, "map_data.esf"),
    collectModCandidates(enabledMods, "startpos.esf"),
  ]);

  const preliminaryStartpos =
    pickEffectiveModCandidate(modStartposCandidates, "wh3_main_combi", "startpos") ??
    pickBestCandidate(vanillaStartposCandidates, "wh3_main_combi", "startpos");
  const campaignHint = campaignHintFromStartpos(preliminaryStartpos?.fileName);
  const startposCandidate =
    pickEffectiveModCandidate(modStartposCandidates, campaignHint, "startpos") ??
    pickBestCandidate(vanillaStartposCandidates, campaignHint, "startpos");
  const mapDataCandidate =
    pickEffectiveModCandidate(modMapCandidates, campaignHint, "map") ??
    pickBestCandidate(vanillaMapCandidates, campaignHint, "map");

  if (!startposCandidate) {
    throw new Error("No startpos.esf was found in the enabled mods or Warhammer 3's vanilla packs.");
  }
  if (!mapDataCandidate) {
    throw new Error("No campaign map_data.esf was found in the enabled mods or Warhammer 3's vanilla packs.");
  }

  const [mapDataBuffer, startposBuffer] = await Promise.all([
    readPackedFileBuffer(mapDataCandidate),
    readPackedFileBuffer(startposCandidate),
  ]);
  return buildEsfMapData(mapDataBuffer, startposBuffer, {
    mapDataPath: mapDataCandidate.fileName,
    startposPath: startposCandidate.fileName,
  });
}
