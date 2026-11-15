import * as fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  extractCampaignTableIdentity,
  extractStartposRegionSlotTemplates,
  openEsfBuffer,
  parseEsfDocument,
} from "../tools/esf/src";

/** The wh3dump copies are gone; fall back to the loose startposes the game ships. */
const startposPath = (campaign: string) =>
  [
    `/mnt/k/projects/wh3dump/campaigns/${campaign}/startpos.esf`,
    `/mnt/k/SteamLibrary/steamapps/common/Total War WARHAMMER III/data/campaigns/${campaign}/startpos.esf`,
  ].find((candidate) => fs.existsSync(candidate)) ?? "";

const fixtures = [
  {
    path: startposPath("wh3_main_chaos"),
    campaign: "wh3_main_chaos",
    rowCount: 510,
  },
  {
    path: startposPath("wh3_main_combi"),
    campaign: "wh3_main_combi",
    // 1270 before DLC29 added great_drakes_rest, krakens_cove and helspire_bay (2 + 3 + 3 rows).
    rowCount: 1278,
  },
];

const available = fixtures.every((fixture) => !!fixture.path);

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
