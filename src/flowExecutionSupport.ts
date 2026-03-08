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
  isDebug: boolean;
}
export const createFlowExecutionContext = (isDebug = false): FlowExecutionContext => ({
  readPackCache: new Map<string, Promise<Pack>>(),
  tableFilesByPackAndTable: new Map<string, PackedFile[]>(),
  rowsByPackedFile: new WeakMap<PackedFile, AmendedSchemaField[][]>(),
  columnIndexesByPackedFile: new WeakMap<PackedFile, Map<string, number>>(),
  outputPackByPath: new Map<string, NewPackedFile[]>(),
  isDebug,
});
export const isFlowExecutionDebugEnabled = (): boolean =>
  process.env.NODE_ENV === "development" && process.env.WHMM_VERBOSE_FLOW_EXECUTION === "1";
export const flowExecutionDebugLog = (context: Pick<FlowExecutionContext, "isDebug"> | undefined, ...args: any[]) => {
  if (context?.isDebug || isFlowExecutionDebugEnabled()) {
    console.log(...args);
  }
};
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
