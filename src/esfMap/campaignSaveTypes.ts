export interface CampaignSaveWorkerRequest {
  filePath: string;
  /** `slot_templates_tables` key (lower case) -> resource, used to fill building slot resource keys. */
  resourceBySlotTemplate?: Record<string, string>;
}

export type CampaignSaveWorkerResponse =
  { ok: true; campaignKey: string | null; text: string; warnings: string[] } | { ok: false; error: string };

/** Edits to write into a save; mirrors `CampaignEdits` in tools/esf/src/edit/applyCampaignEdits.ts. */
export type CampaignSaveEdits = import("../../tools/esf/src").CampaignEdits;

export interface CampaignSaveWriteWorkerRequest {
  sourcePath: string;
  outputPath: string;
  edits: CampaignSaveEdits;
}

export type CampaignSaveWriteWorkerResponse =
  { ok: true; applied: string[]; skipped: string[] } | { ok: false; error: string };
