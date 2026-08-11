import type { SerializedConnection, SerializedNode } from "./nodeGraph/types";
import { AmendedSchemaField, NewPackedFile, Pack, PackedFile } from "./packFileTypes";

export interface PreparedFlow {
  flowFileName: string;
  nodes: SerializedNode[];
  connections: SerializedConnection[];
  nodeConfigs: Record<string, unknown>;
}
export interface FlowExecutionContext {
  readPackCache: Map<string, Promise<Pack>>;
  tableFilesByPackAndTable: Map<string, PackedFile[]>;
  rowsByPackedFile: WeakMap<PackedFile, AmendedSchemaField[][]>;
  columnIndexesByPackedFile: WeakMap<PackedFile, Map<string, number>>;
  outputPackByPath: Map<string, NewPackedFile[]>;
  /**
   * Packs that must be read from somewhere other than their own path, keyed by the original path.
   *
   * A pack the user gave data overwrites is rewritten into whmm_overwrites/ before the game starts,
   * and that copy - not the original - is what the game would have loaded. A flow reading the
   * original would quietly work from pre-overwrite data.
   */
  packPathSubstitutes: Map<string, string>;
  isDebug: boolean;
}

const getFileName = (filePath: string) => filePath.replace(/^.*[\\/]/, "");

/** Whether a PackFiles entry is the pack that owns the currently executing flow. */
export const isFlowSourcePack = (
  candidate: Pick<PackFilesNodeFile, "name" | "path">,
  flowSourcePack: string | undefined,
): boolean => {
  if (!flowSourcePack) return false;
  const normalize = (value: string) => value.replace(/\//g, "\\").toLowerCase();
  const normalizedSource = normalize(flowSourcePack);
  const normalizedPath = normalize(candidate.path);
  if (normalizedSource === normalizedPath) return true;
  // A manual run knows the full owning path, so do not accidentally exclude another pack with the
  // same file name in a different folder. Automatic runs currently know only the pack name.
  if (normalizedSource.includes("\\")) return false;

  const sourceName = getFileName(normalizedSource);
  return normalize(candidate.name) === sourceName || getFileName(normalizedPath) === sourceName;
};

export const buildAutomaticFlowExecutionId = (packName: string, flowFileName: string): string => {
  const packBaseName = getFileName(packName).replace(/\.pack$/i, "");
  const flowBaseName = getFileName(flowFileName).replace(/\.[^.]+$/, "").replace(/\.pack$/i, "");

  if (!packBaseName || packBaseName.toLowerCase() === flowBaseName.toLowerCase()) {
    return flowBaseName || packBaseName;
  }
  if (!flowBaseName) {
    return packBaseName;
  }

  return `${packBaseName}_${flowBaseName}`;
};

export const buildFlowOutputPackBaseName = (flowExecutionId: string): string => {
  const timestampMatch = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(flowExecutionId);
  if (timestampMatch) {
    const [date, time] = flowExecutionId.split("_");
    const datePart = date.split("-").reverse().join("").slice(2);
    const timePart = time.replace(/-/g, "");
    return `dbflow_${datePart}_${timePart}`;
  }

  return `dbflow_${flowExecutionId.replace(/[-:]/g, "")}`;
};

export const createFlowExecutionContext = (isDebug = false): FlowExecutionContext => ({
  readPackCache: new Map<string, Promise<Pack>>(),
  tableFilesByPackAndTable: new Map<string, PackedFile[]>(),
  rowsByPackedFile: new WeakMap<PackedFile, AmendedSchemaField[][]>(),
  columnIndexesByPackedFile: new WeakMap<PackedFile, Map<string, number>>(),
  outputPackByPath: new Map<string, NewPackedFile[]>(),
  packPathSubstitutes: new Map<string, string>(),
  isDebug,
});

/** The path a flow should actually read for `packPath`, honouring any overwrite copy. */
export const resolveFlowSourcePackPath = (
  packPath: string,
  executionContext?: Pick<FlowExecutionContext, "packPathSubstitutes">,
): string => executionContext?.packPathSubstitutes.get(packPath) ?? packPath;
export const isFlowExecutionDebugEnabled = (): boolean =>
  process.env.NODE_ENV === "development" && process.env.WHMM_VERBOSE_FLOW_EXECUTION === "1";
export const flowExecutionDebugLog = (context: Pick<FlowExecutionContext, "isDebug"> | undefined, ...args: any[]) => {
  if (context?.isDebug || isFlowExecutionDebugEnabled()) {
    console.log(...args);
  }
};
export const areFlowFilesLoaded = (
  sourcePack: Pick<Pack, "packedFiles"> | undefined,
): sourcePack is Pick<Pack, "packedFiles"> => {
  if (!sourcePack) return false;
  const flowFiles = sourcePack.packedFiles.filter((file) => file.name.startsWith("whmmflows\\"));
  return (
    flowFiles.length > 0 &&
    flowFiles.every((file) => file.text !== undefined || file.buffer !== undefined)
  );
};
export const canReuseFlowSourcePack = (
  sourcePack: Pick<Pack, "packedFiles" | "lastChangedLocal" | "size"> | undefined,
  currentFile: { mtimeMs: number; size: number },
): sourcePack is Pick<Pack, "packedFiles" | "lastChangedLocal" | "size"> =>
  areFlowFilesLoaded(sourcePack) &&
  sourcePack.lastChangedLocal === currentFile.mtimeMs &&
  sourcePack.size === currentFile.size;
export const buildReadPackCacheKey = (packPath: string, packReadingOptions: PackReadingOptions): string => {
  const keyPayload = {
    packPath,
    skipParsingTables: packReadingOptions.skipParsingTables ?? false,
    skipSorting: packReadingOptions.skipSorting ?? false,
    readLocs: packReadingOptions.readLocs ?? false,
    readScripts: packReadingOptions.readScripts ?? false,
    readFlows: packReadingOptions.readFlows ?? false,
    tablesToRead: [...(packReadingOptions.tablesToRead ?? [])].sort(),
    filesToRead: [...(packReadingOptions.filesToRead ?? [])].sort(),
  };
  return JSON.stringify(keyPayload);
};
