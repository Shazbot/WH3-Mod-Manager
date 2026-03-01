import bs from "binary-search";
import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import appData from "../appData";
import { readFromExistingPack } from "../packFileSerializer";
import { Pack, PackedFile } from "../packFileTypes";
import { SkillAndIcons } from "../skills";
import { gameToPackWithDBTablesName, SupportedGames } from "../supportedGames";
import { collator } from "../utility/packFileSorting";
import Trie from "../utility/trie";

export type SkillsDataCacheCore = Omit<NonNullable<typeof appData.skillsData>, "locs" | "icons" | "skillsDataPackPaths">;

interface VanillaSkillsDataCoreCachePayload {
  version: number;
  game: SupportedGames;
  dbPackPath: string;
  dbPackSize: number;
  dbPackMtimeMs: number;
  core: SkillsDataCacheCore;
}

const VANILLA_SKILLS_DATA_CORE_CACHE_VERSION = 1;
const VANILLA_SKILLS_DATA_CORE_CACHE_FILE = "vanilla-skills-data-core-cache.bin";

let vanillaSkillsDataCoreCachePayload: VanillaSkillsDataCoreCachePayload | null = null;

export const getSkillAndEffectIconPaths = (
  skills: SkillAndIcons,
  skillsToEffects: Record<string, Effect[]>,
  effectsToEffectData: Record<string, EffectData>,
) => {
  const skillIconPathsSet = new Set(
    skills
      .map((skill) => `ui\\campaign ui\\skills\\${skill.iconPath}`)
      .concat(skills.map((skill) => `ui\\battle ui\\ability_icons\\${skill.iconPath}`)),
  );

  const effectIcons = new Set<string>();
  for (const skill of skills) {
    const effectsInSkill = skillsToEffects[skill.key] || [];
    for (const effect of effectsInSkill) {
      const effectIcon = effectsToEffectData[effect.effectKey]?.icon;
      if (effectIcon) {
        effectIcons.add(`ui\\campaign ui\\effect_bundles\\${effectIcon}`);
      }
    }
  }

  return Array.from(new Set([...skillIconPathsSet, ...effectIcons]));
};

export const getLocsFromPacks = (packs: Pack[], getLocsTrie: (pack: Pack) => Trie<string> | undefined) => {
  const locs: Record<string, Trie<string>> = {};
  for (const pack of packs) {
    const locsTrie = getLocsTrie(pack);
    if (locsTrie) locs[pack.name] = locsTrie;
  }
  return locs;
};

export const loadIconsFromPacks = async (packs: Pack[], iconPaths: string[]) => {
  for (const pack of packs) {
    await readFromExistingPack(pack, { filesToRead: iconPaths, skipParsingTables: true });
  }

  const icons: Record<string, string> = {};
  for (const pack of packs) {
    for (const iconPath of iconPaths) {
      const iconIndex = bs(pack.packedFiles, iconPath, (a: PackedFile, b: string) => collator.compare(a.name, b));
      if (iconIndex < 0) continue;
      const iconPackedFile = pack.packedFiles[iconIndex];
      if (!iconPackedFile.buffer) continue;
      icons[iconPath] = iconPackedFile.buffer.toString("base64");
    }
  }
  return icons;
};

const loadVanillaSkillsDataCoreCachePayload = async (userDataPath: string) => {
  if (vanillaSkillsDataCoreCachePayload !== null) return vanillaSkillsDataCoreCachePayload;
  try {
    const cacheFilePath = nodePath.join(userDataPath, VANILLA_SKILLS_DATA_CORE_CACHE_FILE);
    const compressed = await fs.promises.readFile(cacheFilePath);
    const json = await zstdDecompress(compressed);
    vanillaSkillsDataCoreCachePayload = JSON.parse(json.toString("utf8")) as VanillaSkillsDataCoreCachePayload;
    return vanillaSkillsDataCoreCachePayload;
  } catch {
    vanillaSkillsDataCoreCachePayload = null;
    return null;
  }
};

export const getVanillaSkillsDataCoreFromCache = async ({
  dataFolder,
  currentGame,
  userDataPath,
}: {
  dataFolder: string;
  currentGame: SupportedGames;
  userDataPath: string;
}) => {
  const dbPackPath = nodePath.join(dataFolder, gameToPackWithDBTablesName[currentGame]);
  let dbPackStat: fs.Stats;
  try {
    dbPackStat = await fs.promises.stat(dbPackPath);
  } catch {
    return undefined;
  }

  const payload = await loadVanillaSkillsDataCoreCachePayload(userDataPath);
  if (!payload) return undefined;
  if (payload.version !== VANILLA_SKILLS_DATA_CORE_CACHE_VERSION) return undefined;
  if (payload.game !== currentGame) return undefined;
  if (payload.dbPackPath !== dbPackPath) return undefined;
  if (payload.dbPackSize !== dbPackStat.size) return undefined;
  if (payload.dbPackMtimeMs !== dbPackStat.mtimeMs) return undefined;

  return payload.core;
};

export const saveVanillaSkillsDataCoreCache = async ({
  dataFolder,
  currentGame,
  userDataPath,
  skillsData,
}: {
  dataFolder: string;
  currentGame: SupportedGames;
  userDataPath: string;
  skillsData: NonNullable<typeof appData.skillsData>;
}) => {
  try {
    const dbPackPath = nodePath.join(dataFolder, gameToPackWithDBTablesName[currentGame]);
    const dbPackStat = await fs.promises.stat(dbPackPath);
    const { locs, icons, skillsDataPackPaths, ...core } = skillsData;
    const payload: VanillaSkillsDataCoreCachePayload = {
      version: VANILLA_SKILLS_DATA_CORE_CACHE_VERSION,
      game: currentGame,
      dbPackPath,
      dbPackSize: dbPackStat.size,
      dbPackMtimeMs: dbPackStat.mtimeMs,
      core: core as SkillsDataCacheCore,
    };
    const cacheFilePath = nodePath.join(userDataPath, VANILLA_SKILLS_DATA_CORE_CACHE_FILE);
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const compressed = await zstdCompress(json, 1);
    await fs.promises.writeFile(cacheFilePath, compressed);
    vanillaSkillsDataCoreCachePayload = payload;
  } catch (error) {
    console.error("Failed to save vanilla skills data core cache:", error);
  }
};

export const getDefaultSkillsSubtype = (subtypesToSet: Record<string, string[]>) => {
  if (subtypesToSet["wh_main_emp_karl_franz"]?.length) return "wh_main_emp_karl_franz";
  return Object.keys(subtypesToSet)[0];
};

export const cloneSkillsDataCore = (core: SkillsDataCacheCore): SkillsDataCacheCore =>
  JSON.parse(JSON.stringify(core)) as SkillsDataCacheCore;

export const createEmptySkillsDataCore = (): SkillsDataCacheCore => ({
  subtypesToSet: {},
  subtypeAndSets: [],
  setToNodes: {},
  nodeLinks: {},
  nodeToSkill: {},
  skillsToEffects: {},
  skills: [],
  effectsToEffectData: {},
  nodeToSkillLocks: {},
  effectToUnitAbilityEnables: {},
  unitAbilitiesByKey: {},
  unitSpecialAbilitiesByKey: {},
  bombardmentsByKey: {},
  projectilesByKey: {},
  explosionsByKey: {},
  vortexesByKey: {},
  abilityToPhaseIds: {},
  phasesById: {},
  phaseStatEffectsByPhaseId: {},
  uiUnitStatIconsByStat: {},
  kvDirectDamageMinUnary: 0,
  kvDirectDamageLarge: 0,
  abilityToAdditionalUiEffectKeys: {},
  additionalUiEffectsByKey: {},
  abilityToGroupKeys: {},
  specialAbilityGroupsByKey: {},
  abilityToAutoDeactivateFlags: {},
});
