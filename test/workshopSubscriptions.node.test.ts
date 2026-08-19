import { describe, expect, it } from "vitest";

import { parseWorkshopSubscriptionTimes } from "../src/workshopSubscriptions";

describe("Steam Workshop subscription metadata", () => {
  it("reads the per-item subscription timestamps from Steam's VDF", () => {
    const subscriptions = parseWorkshopSubscriptionTimes(`
      "subscribedfiles"
      {
        "appID" "1142710"
        "0"
        {
          "publishedfileid" "1234567890"
          "time_subscribed" "1700000000"
        }
        "1"
        {
          "publishedfileid" "987654321"
          "time_subscribed" "1700000100"
          "disabled_locally" "0"
        }
      }
    `);

    expect([...subscriptions]).toEqual([
      ["1234567890", 1_700_000_000_000],
      ["987654321", 1_700_000_100_000],
    ]);
  });

  it("ignores malformed, missing, and zero timestamps", () => {
    const subscriptions = parseWorkshopSubscriptionTimes(`
      "subscribedfiles"
      {
        "0" { "publishedfileid" "not-an-id" "time_subscribed" "1700000000" }
        "1" { "publishedfileid" "123" "time_subscribed" "0" }
        "2" { "publishedfileid" "456" }
      }
    `);

    expect(subscriptions).toEqual(new Map());
  });

  it("returns no timestamps for invalid VDF", () => {
    expect(parseWorkshopSubscriptionTimes("not vdf")).toEqual(new Map());
  });
});
