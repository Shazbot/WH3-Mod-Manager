import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createNativePatchFlowContribution,
  normalizeNativePatchFlowInputs,
  parseNativePatchFlowTemplate,
} from "../src/nativePatches/flowTemplate";
import { buildNativePatchLaunchPlan } from "../src/nativePatches/planner";

const directory = path.join(process.cwd(), "docs/examples/target-unit-sets");
const bytes = fs.readFileSync(path.join(directory, "target_unit_sets.experimental.wh3patchtemplate.json"));

describe("expanded target-unit template integration", () => {
  it("loads the actual exported payload with matching identities and expected-byte guards", () => {
    const template = parseNativePatchFlowTemplate(bytes);
    expect(template.template).toMatchObject({ id: "wh3.target-unit-sets", version: "0.1.0" });
    expect(template.template.id).toBe(template.native_patch.package.id);
    expect(template.template.version).toBe(template.native_patch.package.version);
    expect(template.native_patch.target.sha256).toBeUndefined();
    expect(template.native_patch.writes).toHaveLength(39);
    expect(template.native_patch.writes.every((write) => write.expected.length > 0)).toBe(true);
    expect(template.native_patch.fixups).toHaveLength(210);
    expect(template.native_patch.runtime_functions).toHaveLength(103);
    for (const block of template.native_patch.blocks) {
      if ("base64" in block.source) {
        const payload = Buffer.from(block.source.base64, "base64");
        expect(payload.length).toBe(block.size);
        expect(crypto.createHash("sha256").update(payload).digest("hex")).toBe(block.source.sha256);
      }
    }
    expect(template.inputs.tables).toEqual([
      expect.objectContaining({
        id: "mappings",
        parameter: "mapping_data",
        max_rows: 100000,
        group_by: "flag",
        value_column: "unit_set",
        provider_merge: "identical_by_group",
      }),
    ]);
  });

  it("prepares user mappings without reading or hashing the target executable", async () => {
    const template = parseNativePatchFlowTemplate(bytes);
    const contribution = createNativePatchFlowContribution({
      template,
      inputs: normalizeNativePatchFlowInputs(
        template,
        {},
        {
          mappings: [
            { flag: "my_custom_flag", unit_set: "my_unit_set_b" },
            { flag: "my_custom_flag", unit_set: "my_unit_set_a" },
          ],
        },
      ),
      provenance: { sourcePack: "user.pack", flowFile: "whmmflows/target_unit_sets.json", nodeId: "patch" },
      payloads: [],
    });
    const raw = Buffer.from(JSON.stringify(contribution));
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-target-unit-template-"));
    try {
      const packPath = path.join(temporary, "contribution.pack");
      fs.writeFileSync(packPath, raw);
      const pack = {
        path: packPath,
        priority: 0,
        pack: {
          path: packPath,
          packedFiles: [
            {
              name: "whmm_patch_contributions/v1/target.wh3patchcontrib.json",
              start_pos: 0,
              file_size: raw.length,
            },
          ],
        },
      };
      const plan = await buildNativePatchLaunchPlan({
        runId: "target-unit-template-test",
        targetPath: path.join(temporary, "unopened-executable.exe"),
        enabledPacks: [pack],
        effectiveContentPacks: [pack],
      });
      expect(plan?.targetSha256).toBeUndefined();
      expect(plan?.packages).toHaveLength(1);
      const prepared = plan!.packages[0];
      expect(prepared.manifest.writes).toEqual(template.native_patch.writes);
      const mappings = Buffer.from(
        prepared.blocks.find((block) => block.id === "mapping_storage")!.bytesBase64,
        "base64",
      );
      expect(mappings.readUInt32LE(0)).toBe(2);
      expect(mappings.subarray(16, 30).toString("ascii")).toBe("my_custom_flag");
      expect(mappings.subarray(272, 285).toString("ascii")).toBe("my_unit_set_a");
      expect(mappings.subarray(784, 797).toString("ascii")).toBe("my_unit_set_b");
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it.each([
    ["id", "target_unit_sets"],
    ["version", "0.2.0"],
  ])("rejects an exported template whose %s drifts from its native package", (field, value) => {
    const invalid = JSON.parse(bytes.toString("utf8"));
    invalid.template[field] = value;
    expect(() => parseNativePatchFlowTemplate(Buffer.from(JSON.stringify(invalid)))).toThrow(
      "template identity must match native_patch.package id and version",
    );
  });
});
