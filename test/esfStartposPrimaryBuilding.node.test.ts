import * as fs from "node:fs";
import { describe, expect, it } from "vitest";

import { extractStartposRegions, openEsfBuffer, parseEsfDocument } from "../tools/esf/src";

const startposPath =
  "/mnt/k/SteamLibrary/steamapps/common/Total War WARHAMMER III/data/campaigns/wh3_main_combi/startpos.esf";

describe.skipIf(!fs.existsSync(startposPath))("startpos primary building extraction", () => {
  it("reads each region's primary slot building", () => {
    const opened = openEsfBuffer(fs.readFileSync(startposPath));
    const regions = extractStartposRegions(opened.buffer, parseEsfDocument(opened.buffer));
    const altdorf = regions.find((region) => region.key === "wh3_main_combi_region_altdorf");
    expect(altdorf?.primaryBuilding).toMatch(/emp/);

    const owned = regions.filter((region) => region.ownerFaction);
    const withPrimary = owned.filter((region) => region.primaryBuilding);
    expect(withPrimary.length / owned.length).toBeGreaterThan(0.9);
    const differing = withPrimary.filter((region) => region.primaryBuilding !== region.settlementKey);
    console.log(
      `altdorf=${altdorf?.primaryBuilding} settlementKey=${altdorf?.settlementKey} owned=${owned.length} withPrimary=${withPrimary.length} differing=${differing.length}`,
      differing.slice(0, 3).map((region) => [region.key, region.primaryBuilding, region.settlementKey]),
    );
  });
});
