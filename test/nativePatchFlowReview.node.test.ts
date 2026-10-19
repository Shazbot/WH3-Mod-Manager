import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createNativePatchFlowContribution,
  normalizeNativePatchFlowInputs,
  parseNativePatchFlowTemplate,
} from "../src/nativePatches/flowTemplate";
import { buildNativePatchLaunchPlan, type NativePatchPack } from "../src/nativePatches/planner";

const directories: string[] = [];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const digest = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const fixture = (version = "1.0.0"): Record<string, any> => ({
  format: "wh3-native-patch-template",
  format_version: 1,
  template: { id: "review.flow", version, name: "Flow review" },
  native_patch: {
    format: "wh3-native-patch",
    format_version: 3,
    package: { id: "review.flow", version, name: "Flow review" },
    requires_loader: { min_version: "2.2.0", capabilities: ["blocks.v1", "table-parameters.v1"] },
    target: { id: "game", filename: "Warhammer3.exe", machine: "amd64" },
    lifecycle: { apply: "startup", before: "game_initialization", change: "restart", lifetime: "process" },
    allocation_policy: {
      type: "module_window",
      module: "game",
      min_rva: "after_image",
      max_rva_exclusive: "0x80000000",
    },
    requires: [],
    conflicts: [],
    claims: [],
    blocks: [{ id: "state", size: 260, alignment: 4, protection: "rw", source: { zero: true } }],
    symbols: {},
    signatures: [],
    guards: [],
    writes: [],
    fixups: [],
    runtime_functions: [],
    assets: [],
    parameters: [
      {
        id: "mapping_data",
        type: "table",
        capacity: 8,
        columns: [
          { name: "flag", type: "ascii", max_bytes: 15 },
          { name: "unit_set", type: "ascii", max_bytes: 15 },
        ],
        count_at: { block: "state", offset: 0 },
        entries_at: { block: "state", offset: 4 },
      },
    ],
  },
  inputs: {
    scalars: [],
    tables: [
      {
        id: "mappings",
        table_name: "Mappings",
        parameter: "mapping_data",
        max_rows: 8,
        group_by: "flag",
        value_column: "unit_set",
        provider_merge: "identical_by_group",
      },
    ],
  },
});

const contribution = (
  root: Record<string, any>,
  rows: Array<Record<string, unknown>>,
  nodeId: string,
  options: {
    raw?: Buffer;
    payloads?: Array<{ path: string; sha256: string; bytes: Buffer }>;
    scalars?: Record<string, unknown>;
  } = {},
) => {
  const template = parseNativePatchFlowTemplate(options.raw ?? encode(root));
  return encode(
    createNativePatchFlowContribution({
      template,
      inputs: normalizeNativePatchFlowInputs(template, options.scalars ?? {}, { mappings: rows }),
      provenance: { sourcePack: `${nodeId}.pack`, flowFile: `whmmflows/${nodeId}.json`, nodeId },
      payloads: options.payloads ?? [],
    }),
  );
};
const pack = (entries: Record<string, Buffer>, label: string): NativePatchPack => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-flow-review-"));
  directories.push(directory);
  const packPath = path.join(directory, `${label}.pack`);
  let offset = 0;
  const packedFiles = Object.entries(entries).map(([name, bytes]) => {
    const entry = { name, start_pos: offset, file_size: bytes.length };
    offset += bytes.length;
    return entry;
  });
  fs.writeFileSync(packPath, Buffer.concat(Object.values(entries)));
  return { path: packPath, priority: 0, displayName: label, pack: { path: packPath, packedFiles } };
};
const prepare = (packs: NativePatchPack[]) =>
  buildNativePatchLaunchPlan({
    runId: "flow-review",
    targetPath: "unused-for-unhashed-fixture.exe",
    enabledPacks: packs,
    effectiveContentPacks: packs,
  });
const entry = "whmm_patch_contributions/v1/review.wh3patchcontrib.json";
const row = (flag: string, unit_set: string) => ({ flag, unit_set });

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("native patch flow reviewer regressions", () => {
  it("uses the validated manifest defaults when optional arrays are omitted", () => {
    const root = fixture();
    root.inputs.tables = [];
    delete root.native_patch.parameters;
    delete root.native_patch.assets;
    const template = parseNativePatchFlowTemplate(encode(root));
    expect(template.native_patch.parameters).toEqual([]);
    expect(template.native_patch.assets).toEqual([]);
    expect(normalizeNativePatchFlowInputs(template, {}, {})).toEqual({ scalars: {}, tables: {} });
  });

  it("merges different mods into one package without losing either mapping", async () => {
    const root = fixture();
    const plan = await prepare([
      pack({ [entry]: contribution(root, [row("flag_b", "set_b")], "node_b") }, "mod_b"),
      pack({ [entry]: contribution(root, [row("flag_a", "set_a")], "node_a") }, "mod_a"),
    ]);
    expect(plan?.packages).toHaveLength(1);
    const bytes = Buffer.from(plan!.packages[0].blocks[0].bytesBase64, "base64");
    expect(bytes.readUInt32LE(0)).toBe(2);
    expect(bytes.subarray(4, 10).toString("ascii")).toBe("flag_a");
    expect(bytes.subarray(36, 42).toString("ascii")).toBe("flag_b");
  });

  it("accepts identical definitions despite row order and duplicate rows", async () => {
    const root = fixture();
    const plan = await prepare([
      pack({ [entry]: contribution(root, [row("flag_a", "set_b"), row("flag_a", "set_a")], "first") }, "first"),
      pack(
        {
          [entry]: contribution(
            root,
            [row("flag_a", "set_a"), row("flag_a", "set_b"), row("flag_a", "set_a")],
            "second",
          ),
        },
        "second",
      ),
    ]);
    expect(Buffer.from(plan!.packages[0].blocks[0].bytesBase64, "base64").readUInt32LE(0)).toBe(2);
  });

  it("names both sources on conflicting definitions even under silent failure policy", async () => {
    const root = fixture();
    root.native_patch.on_failure = "silent";
    await expect(
      prepare([
        pack({ [entry]: contribution(root, [row("flag_a", "set_a")], "first") }, "first"),
        pack({ [entry]: contribution(root, [row("flag_a", "set_b")], "second") }, "second"),
      ]),
    ).rejects.toThrow(/conflicting.*first.*second/);
  });

  it("rejects different template versions instead of discarding older mappings", async () => {
    await expect(
      prepare([
        pack({ [entry]: contribution(fixture("1.0.0"), [row("flag_a", "set_a")], "first") }, "first"),
        pack({ [entry]: contribution(fixture("2.0.0"), [row("flag_b", "set_b")], "second") }, "second"),
      ]),
    ).rejects.toThrow(/incompatible.*first.*second/);
  });

  it("accepts canonical-equivalent templates with different whitespace", async () => {
    const root = fixture();
    const plan = await prepare([
      pack({ [entry]: contribution(root, [row("flag_a", "set_a")], "first") }, "first"),
      pack(
        {
          [entry]: contribution(root, [row("flag_b", "set_b")], "second", {
            raw: Buffer.from(JSON.stringify(root, null, 2)),
          }),
        },
        "second",
      ),
    ]);
    expect(plan?.packages).toHaveLength(1);
  });

  it("rejects a same-ID standalone package rather than choosing one provider", async () => {
    const root = fixture();
    await expect(
      prepare([
        pack({ [entry]: contribution(root, [row("flag_a", "set_a")], "first") }, "first"),
        pack({ "whmm_patches/review.wh3patch.json": encode(root.native_patch) }, "standalone"),
      ]),
    ).rejects.toThrow(/collides with standalone/);
  });

  it("materializes blocks independently when they share one embedded payload", async () => {
    const root = fixture();
    const payload = Buffer.alloc(260, 7);
    const hash = digest(payload);
    root.native_patch.blocks[0].source = { file: "shared.bin", sha256: hash };
    root.native_patch.blocks.push({
      id: "other",
      size: 260,
      alignment: 4,
      protection: "rw",
      source: { file: "shared.bin", sha256: hash },
    });
    root.native_patch.parameters.push({
      id: "enabled",
      type: "bool",
      default: false,
      at: { block: "other", offset: 4 },
    });
    root.inputs.scalars.push({ id: "enabled", parameter: "enabled" });
    const plan = await prepare([
      pack(
        {
          [entry]: contribution(root, [row("flag_a", "set_a")], "first", {
            payloads: [{ path: "shared.bin", sha256: hash, bytes: payload }],
            scalars: { enabled: true },
          }),
        },
        "first",
      ),
    ]);
    const blocks = new Map(
      plan!.packages[0].blocks.map((block) => [block.id, Buffer.from(block.bytesBase64, "base64")]),
    );
    expect(blocks.get("state")!.readUInt32LE(0)).toBe(1);
    expect(blocks.get("state")![4]).toBe("f".charCodeAt(0));
    expect(blocks.get("other")!.readUInt32LE(0)).toBe(0x07070707);
    expect(blocks.get("other")![4]).toBe(1);
    expect(payload.equals(Buffer.alloc(260, 7))).toBe(true);
  });

  it("does not activate a template without a saved contribution", async () => {
    expect(
      await prepare([pack({ "whmm_patch_templates/review.wh3template.json": encode(fixture()) }, "template_only")]),
    ).toBeUndefined();
  });

  it("accepts multi-megabyte embedded payloads within the declared limits", async () => {
    const root = fixture();
    const payload = Buffer.alloc(4 * 1024 * 1024);
    const hash = digest(payload);
    root.native_patch.blocks[0].size = payload.length;
    root.native_patch.blocks[0].source = { file: "large.bin", sha256: hash };
    const plan = await prepare([
      pack(
        {
          [entry]: contribution(root, [row("flag_a", "set_a")], "large", {
            payloads: [{ path: "large.bin", sha256: hash, bytes: payload }],
          }),
        },
        "large",
      ),
    ]);
    expect(plan?.packages[0].blocks[0].size).toBe(payload.length);
  });

  it("rejects table fields overlapping the count field", async () => {
    const root = fixture();
    root.native_patch.parameters[0].entries_at.offset = 0;
    await expect(
      prepare([pack({ [entry]: contribution(root, [row("flag_a", "set_a")], "first") }, "first")]),
    ).rejects.toThrow(/overlaps/);
  });

  it("rejects invalid contribution destinations before optional-patch policy handling", async () => {
    const root = fixture();
    root.native_patch.on_failure = "silent";
    root.native_patch.parameters[0].entries_at.offset = 0;
    await expect(
      prepare([pack({ [entry]: contribution(root, [row("flag_a", "set_a")], "first") }, "first")]),
    ).rejects.toThrow(/overlaps/);
  });
});
