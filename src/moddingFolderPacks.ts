import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

import { sortByNameAndLoadOrder } from "./modSortingHelpers";
import type { DBVersion, NewPackedFile, Pack } from "./packFileTypes";
import { convertRpfmTsvToPackedFile } from "./utility/rpfmTsv";

export { convertRpfmTsvToPackedFile } from "./utility/rpfmTsv";

export const WHMM_MODDING_FOLDER = "whmm_modding";

export interface ModdingFolderPackResult {
  folderPath: string;
  packName: string;
  packPath: string;
  sourceMod?: Mod;
}

export type ModdingPackReader = (packPath: string, options: PackReadingOptions) => Promise<Pack>;
export type ModdingPackWriter = (
  packFiles: NewPackedFile[],
  packPath: string,
  existingPackToAppend?: Pack,
  replaceDuplicates?: boolean,
) => Promise<unknown>;
export type ModdingSchemaReader = () => Promise<Record<string, DBVersion[]>>;

export const replaceEnabledModsWithGeneratedPacks = (enabledMods: Mod[], generatedMods: Mod[]): Mod[] => {
  const generatedByName = new Map(generatedMods.map((mod) => [mod.name, mod]));
  return sortByNameAndLoadOrder([...enabledMods.filter((mod) => !generatedByName.has(mod.name)), ...generatedMods]);
};

const isBackedUpFolder = (name: string) => name === "whmm_backups";

export const getModdingPackName = (folderName: string): string =>
  folderName.toLowerCase().endsWith(".pack") ? folderName : `${folderName}.pack`;

const getFolderPackFiles = async (
  folderPath: string,
  rootPath: string,
  getTableSchemas: ModdingSchemaReader,
): Promise<NewPackedFile[]> => {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files: NewPackedFile[] = [];

  for (const entry of entries.toSorted((first, second) => first.name.localeCompare(second.name))) {
    if (entry.isDirectory()) {
      if (isBackedUpFolder(entry.name)) continue;
      files.push(...(await getFolderPackFiles(nodePath.join(folderPath, entry.name), rootPath, getTableSchemas)));
      continue;
    }
    if (!entry.isFile()) continue;

    const filePath = nodePath.join(folderPath, entry.name);
    const buffer = await fs.readFile(filePath);
    const relativeFileName = nodePath.relative(rootPath, filePath).split(nodePath.sep).join("\\");
    if (entry.name.toLowerCase().endsWith(".tsv")) {
      const tsvContents = buffer.toString("utf8");
      const metadataLine = tsvContents.split(/\r?\n/, 2)[1];
      if (metadataLine?.trim().startsWith("#")) {
        const convertedFile = convertRpfmTsvToPackedFile(
          tsvContents,
          relativeFileName,
          await getTableSchemas(),
          filePath,
        );
        if (convertedFile) {
          files.push(convertedFile);
          continue;
        }
      }
    }
    files.push({
      name: relativeFileName,
      buffer,
      file_size: buffer.length,
    });
  }

  return files;
};

const getModdingFolders = async (moddingPath: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(moddingPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !isBackedUpFolder(entry.name))
      .sort((first, second) => first.name.localeCompare(second.name))
      .map((entry) => nodePath.join(moddingPath, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

export const createModdingFolderPacks = async (
  moddingPath: string,
  outputPath: string,
  enabledMods: Mod[],
  readPack: ModdingPackReader,
  writePack: ModdingPackWriter,
  getTableSchemas: ModdingSchemaReader,
): Promise<ModdingFolderPackResult[]> => {
  const folders = await getModdingFolders(moddingPath);
  if (folders.length === 0) return [];

  await fs.mkdir(outputPath, { recursive: true });
  const results: ModdingFolderPackResult[] = [];
  const outputNames = new Set<string>();
  let tableSchemasPromise: Promise<Record<string, DBVersion[]>> | undefined;
  const getTableSchemasOnce = () => (tableSchemasPromise ??= getTableSchemas());

  for (const folderPath of folders) {
    const folderName = nodePath.basename(folderPath);
    const packName = getModdingPackName(folderName);
    if (outputNames.has(packName.toLowerCase())) {
      throw new Error(`Multiple modding folders would create the same pack: ${packName}`);
    }
    outputNames.add(packName.toLowerCase());

    const packFiles = await getFolderPackFiles(folderPath, folderPath, getTableSchemasOnce);
    if (packFiles.length === 0) continue;

    const packedFileNames = new Set<string>();
    for (const packFile of packFiles) {
      const nameKey = packFile.name.toLowerCase();
      if (packedFileNames.has(nameKey)) {
        throw new Error(`Multiple files in modding folder would create the same packed file: ${packFile.name}`);
      }
      packedFileNames.add(nameKey);
    }

    const sourceMod = enabledMods.find((mod) => mod.name === packName);
    const existingPack = sourceMod ? await readPack(sourceMod.path, { skipParsingTables: true }) : undefined;
    const packPath = nodePath.join(outputPath, packName);
    await writePack(packFiles, packPath, existingPack, existingPack != undefined);
    results.push({ folderPath, packName, packPath, sourceMod });
  }

  return results;
};
