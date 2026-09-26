/** Campaign types that the manager deliberately does not expose in campaign-based panels. */
export const IGNORED_CAMPAIGN_TYPES: ReadonlySet<string> = new Set(["wh3_main_prologue"]);

export const isIgnoredCampaignType = (campaignType: string | undefined | null): boolean =>
  campaignType != null && IGNORED_CAMPAIGN_TYPES.has(campaignType.trim().toLowerCase());
