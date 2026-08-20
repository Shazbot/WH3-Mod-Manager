import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

import { sortByNameAndLoadOrder } from "./modSortingHelpers";
import { buildRowFromValues } from "./utility/dbRowCells";
import { parseDBTablePath } from "./utility/packFileHelpers";
import type { DBVersion, NewPackedFile, Pack } from "./packFileTypes";

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

interface RpfmTsvMetadata {
  tableName: string;
  version: number;
  packedFileName: string;
}

const normalizePackedFileName = (fileName: string) =>
  fileName
    .replaceAll("/", "\\")
    .replace(/^\.\\/, "")
    .replace(/\.tsv$/i, "");

const getRpfmTsvMetadata = (line: string, fallbackPackedFileName: string): RpfmTsvMetadata | undefined => {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("#")) return;

  const [tableNamePart, versionPart, packedFileNamePart] = trimmedLine.slice(1).split(";");
  if (tableNamePart == null || versionPart == null || packedFileNamePart == null) return;

  const tableName = tableNamePart.trim();
  const version = Number(versionPart.trim());
  const packedFileName = normalizePackedFileName(packedFileNamePart.trim() || fallbackPackedFileName);
  if (!tableName || !Number.isInteger(version) || version < 0 || !packedFileName) {
    throw new Error(`Invalid RPFM TSV metadata: ${line}`);
  }

  return { tableName, version, packedFileName };
};

export const convertRpfmTsvToPackedFile = (
  contents: string,
  fallbackPackedFileName: string,
  tableSchemas: Record<string, DBVersion[]>,
  sourcePath: string,
): NewPackedFile | undefined => {
  const lines = contents.split(/\r?\n/);
  if (lines.length < 2) return;

  const metadata = getRpfmTsvMetadata(lines[1], fallbackPackedFileName);
  if (!metadata) return;

  const parsedPath = parseDBTablePath(metadata.packedFileName);
  if (!parsedPath) {
    throw new Error(`RPFM TSV metadata does not name a DB table: ${sourcePath}`);
  }
  if (parsedPath.dbName !== metadata.tableName) {
    throw new Error(
      `RPFM TSV table name does not match its path in ${sourcePath}: ${metadata.tableName} vs ${parsedPath.dbName}`,
    );
  }

  const schema = tableSchemas[metadata.tableName]?.find((version) => version.version === metadata.version);
  if (!schema) {
    throw new Error(`No schema for RPFM TSV ${metadata.tableName} version ${metadata.version} in ${sourcePath}`);
  }

  const headers = lines[0]
    .replace(/^\uFEFF/, "")
    .split("\t")
    .map((header) => header.trim());
  const headerSet = new Set(headers);
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  const unknownHeaders = headers.filter((header) => !schema.fields.some((field) => field.name === header));
  const missingHeaders = schema.fields.map((field) => field.name).filter((fieldName) => !headerSet.has(fieldName));
  if (headers.some((header) => !header) || duplicateHeaders.length > 0 || unknownHeaders.length > 0) {
    throw new Error(`RPFM TSV columns do not match the schema for ${metadata.tableName}: ${sourcePath}`);
  }
  if (missingHeaders.length > 0) {
    throw new Error(
      `RPFM TSV is missing columns for ${metadata.tableName}: ${missingHeaders.join(", ")} (${sourcePath})`,
    );
  }

  const schemaFields = lines.slice(2).reduce<NonNullable<NewPackedFile["schemaFields"]>>((fields, line) => {
    if (line === "") return fields;
    const values = line.split("\t");
    if (values.length > headers.length) {
      throw new Error(`RPFM TSV row has too many columns in ${sourcePath}`);
    }
    const rowValues: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowValues[header] = values[index] ?? "";
    });
    fields.push(...buildRowFromValues(schema, rowValues));
    return fields;
  }, []);

  return {
    name: metadata.packedFileName,
    version: metadata.version,
    tableSchema: schema,
    schemaFields,
  };
};

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
