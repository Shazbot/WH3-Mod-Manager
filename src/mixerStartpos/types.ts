export interface MixerStartposWorkerRequest {
  inputPath: string;
  outputPath: string;
  keys: string[];
}

export type MixerStartposWorkerResponse =
  { ok: true; removedCount: number; keptRegionOwners: string[] } | { ok: false; error: string };
