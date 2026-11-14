export interface CampaignSaveWorkerRequest {
  filePath: string;
  /** `slot_templates_tables` key (lower case) -> resource, used to fill building slot resource keys. */
  resourceBySlotTemplate?: Record<string, string>;
}

export type CampaignSaveWorkerResponse =
  | { ok: true; campaignKey: string | null; text: string; warnings: string[] }
  | { ok: false; error: string };
