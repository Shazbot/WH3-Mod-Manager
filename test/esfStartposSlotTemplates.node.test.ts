import * as fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  extractCampaignTableIdentity,
  extractStartposRegionSlotTemplates,
  openEsfBuffer,
  parseEsfDocument,
} from "../tools/esf/src";

const fixtures = [
  {
    path: "/mnt/k/projects/wh3dump/campaigns/wh3_main_chaos/startpos.esf",
    campaign: "wh3_main_chaos",
    rowCount: 510,
  },
  {
    path: "/mnt/k/projects/wh3dump/campaigns/wh3_main_combi/startpos.esf",
    campaign: "wh3_main_combi",
    rowCount: 1270,
  },
];

const available = fixtures.every((fixture) => fs.existsSync(fixture.path));

describe.skipIf(!available)("startpos region slot-template extraction", () => {
  for (const fixture of fixtures) {
    it(`extracts ${fixture.campaign} without the ESF index column`, () => {
      const compressed = fs.readFileSync(fixture.path);
      const identity = extractCampaignTableIdentity(compressed, parseEsfDocument(compressed));
      const opened = openEsfBuffer(compressed);
      const rows = extractStartposRegionSlotTemplates(
        opened.buffer,
        parseEsfDocument(opened.buffer),
        identity?.campaignName ?? "",
      );

      expect(identity?.campaignName).toBe(fixture.campaign);
      expect(rows).toHaveLength(fixture.rowCount);
      expect(rows.every((row) => !("id" in row))).toBe(true);
      expect(new Set(rows.map((row) => `${row.campaign}|${row.region}|${row.slotTemplate}|${row.slotType}`)).size).toBe(
        rows.length,
      );
    });
  }
});
