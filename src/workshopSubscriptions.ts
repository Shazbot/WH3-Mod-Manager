import * as VDF from "@node-steam/vdf";

type VdfRecord = Record<string, unknown>;

const isVdfRecord = (value: unknown): value is VdfRecord => value !== null && typeof value === "object";

/**
 * Reads the subscription timestamps Steam stores in <appid>_subscriptions.vdf.
 * The file is user data rather than Workshop item metadata, so this is the actual subscription time and
 * not the time the item was published or last downloaded.
 */
export function parseWorkshopSubscriptionTimes(contents: string): Map<string, number> {
  let parsed: unknown;
  try {
    parsed = VDF.parse(contents);
  } catch {
    return new Map();
  }

  const subscribedFiles = isVdfRecord(parsed) ? parsed.subscribedfiles : undefined;
  if (!isVdfRecord(subscribedFiles)) return new Map();

  const subscriptionTimes = new Map<string, number>();
  for (const value of Object.values(subscribedFiles)) {
    if (!isVdfRecord(value)) continue;

    const workshopId = String(value.publishedfileid ?? "");
    const subscribedSeconds = Number(value.time_subscribed);
    if (!/^\d+$/.test(workshopId) || !Number.isFinite(subscribedSeconds) || subscribedSeconds <= 0) continue;

    subscriptionTimes.set(workshopId, subscribedSeconds * 1000);
  }

  return subscriptionTimes;
}
