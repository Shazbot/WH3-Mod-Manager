import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { compressFrameSync } from "lz4-napi";
import { afterEach, describe, expect, it } from "vitest";

import { parseAndValidateNativePatchManifest, MAX_MANIFEST_BYTES } from "../src/nativePatches/manifest";
import { buildNativePatchLaunchPlan, type NativePatchPack } from "../src/nativePatches/planner";

const temporaryDirectories: string[] = [];
const digest = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const targetBytes = Buffer.from("review target");
const manifest = (version = 2): Record<string, any> => ({
  format: "wh3-native-patch",
  format_version: version,
  package: { id: "review.feature", version: "1.0.0", name: "Review fixture" },
  requires_loader: {
    min_version: "2.0.0",
    capabilities: [
      "blocks.v1",
      "fixups.v1",
      "win64-unwind.v1",
      "startup-activation.v1",
      ...(version === 2 ? ["signatures.v2"] : []),
    ],
  },
  target: {
    id: "game",
    filename: "Warhammer3.exe",
    machine: "amd64",
    ...(version === 1 ? { sha256: digest(targetBytes) } : {}),
  },
  lifecycle: { apply: "startup", before: "game_initialization", change: "restart", lifetime: "process" },
  allocation_policy: { type: "module_window", module: "game", min_rva: "after_image", max_rva_exclusive: "0x80000000" },
  requires: [],
  conflicts: [],
  claims: [],
  blocks: [{ id: "state", size: 32, alignment: 16, protection: "rw", source: { zero: true } }],
  symbols: {},
  guards: [],
  writes: [],
  fixups: [],
  runtime_functions: [],
  ...(version === 2 ? { signatures: [] } : {}),
});
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const directory = () => {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-native-review-"));
  temporaryDirectories.push(result);
  return result;
};
const pack = (entries: Record<string, Buffer>, priority: number): NativePatchPack => {
  const packPath = path.join(directory(), "fixture.pack");
  let offset = 0;
  const packedFiles = Object.entries(entries).map(([name, bytes]) => {
    const entry = { name, file_size: bytes.length, start_pos: offset };
    offset += bytes.length;
    return entry;
  });
  fs.writeFileSync(packPath, Buffer.concat(Object.values(entries)));
  return { path: packPath, priority, pack: { path: packPath, packedFiles } };
};
const prepare = (packs: NativePatchPack[], effectiveContentPacks = packs) => {
  const targetPath = path.join(directory(), "Warhammer3.exe");
  fs.writeFileSync(targetPath, targetBytes);
  return buildNativePatchLaunchPlan({ runId: "review", targetPath, enabledPacks: packs, effectiveContentPacks });
};

afterEach(() => {
  for (const folder of temporaryDirectories.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

describe("native patch reviewer regressions", () => {
  it("reads ordinary LZ4 frames without a declared content size", async () => {
    const compressed = compressFrameSync(encode(manifest()));
    expect(compressed[4] & 8).toBe(0);
    const source = pack({ "whmm_patches/patch.wh3patch.json": compressed }, 0);
    source.pack.packedFiles[0].is_compressed = true;
    expect((await prepare([source]))?.packages).toHaveLength(1);
  });

  it("validates checksummed LZ4 frames using standard xxHash32", async () => {
    const compressed = compressFrameSync(encode(manifest()), { contentChecksum: true, blockChecksums: true });
    const source = pack({ "whmm_patches/patch.wh3patch.json": compressed }, 0);
    source.pack.packedFiles[0].is_compressed = true;
    expect((await prepare([source]))?.packages).toHaveLength(1);
  });

  it("accepts v2 without an EXE hash and enforces a supplied hash", async () => {
    const value = manifest();
    expect((await prepare([pack({ "whmm_patches/patch.wh3patch.json": encode(value) }, 0)]))?.packages).toHaveLength(1);
    value.target.sha256 = "00".repeat(32);
    await expect(prepare([pack({ "whmm_patches/patch.wh3patch.json": encode(value) }, 0)])).rejects.toThrow(
      /SHA-256 mismatch/i,
    );
  });

  it("retains v1 EXE hash enforcement", () => {
    const value = manifest(1);
    delete value.target.sha256;
    expect(() => parseAndValidateNativePatchManifest(encode(value))).toThrow(/sha256/i);
  });

  it("accepts ordinary v1 symbol fixups without requiring v2 capabilities", async () => {
    const value = manifest(1);
    value.symbols = { address: { block: "state", offset: 8 } };
    value.fixups = [{ kind: "abs64", at: { block: "state", offset: 0 }, target: { symbol: "address" }, addend: 0 }];
    expect((await prepare([pack({ "whmm_patches/patch.wh3patch.json": encode(value) }, 0)]))?.packages).toHaveLength(1);
  });

  it("rejects finite JavaScript values that overflow float32 storage", () => {
    const value = manifest();
    value.parameters = [
      { id: "overflow", type: "f32", default: 1e100, min: 0, max: 1e101, at: { block: "state", offset: 0 } },
    ];
    expect(() => parseAndValidateNativePatchManifest(encode(value))).toThrow(/f32|float|finite/i);
  });

  it("rejects duplicate keys even when their escape spellings differ", () => {
    expect(() => parseAndValidateNativePatchManifest(Buffer.from('{"format":1,"\\u0066ormat":2}'))).toThrow(
      /duplicate object key/i,
    );
  });

  it("chooses a higher version in a lower-priority pack even at the same virtual path", async () => {
    const higher = manifest();
    higher.package.version = "2.0.0";
    const result = await prepare([
      pack({ "whmm_patches/patch.wh3patch.json": encode(higher) }, 0),
      pack({ "whmm_patches/patch.wh3patch.json": encode(manifest()) }, 10),
    ]);
    expect(result?.packages[0].manifest.package.version).toBe("2.0.0");
  });

  it("uses pack priority for equal SemVer precedence including build metadata", async () => {
    const low = manifest();
    low.package.version = "1.0.0+low";
    const high = manifest();
    high.package.version = "1.0.0+high";
    const higherPack = pack({ "whmm_patches/b.wh3patch.json": encode(high) }, 10);
    const result = await prepare([higherPack, pack({ "whmm_patches/a.wh3patch.json": encode(low) }, 0)]);
    expect(result?.packages[0].sourcePackPath).toBe(higherPack.path);
  });

  it("uses normalized paths for equal-version ties inside a pack", async () => {
    const result = await prepare([
      pack(
        {
          "whmm_patches/B.wh3patch.json": encode(manifest()),
          "whmm_patches/a.wh3patch.json": encode(manifest()),
        },
        0,
      ),
    ]);
    expect(result?.packages[0].manifestPath.toLowerCase()).toBe("whmm_patches/a.wh3patch.json");
  });

  it.skipIf(process.platform === "win32")("keeps case-distinct physical packs separate on Linux", async () => {
    const high = pack({ "whmm_patches/z.wh3patch.json": encode(manifest()) }, 10);
    const low = pack({ "whmm_patches/a.wh3patch.json": encode(manifest()) }, 0);
    const distinctPath = path.join(path.dirname(high.path), "FIXTURE.pack");
    fs.copyFileSync(low.path, distinctPath);
    low.path = distinctPath;
    low.pack.path = distinctPath;
    const result = await prepare([high, low]);
    expect(result?.packages[0].sourcePackPath).toBe(high.path);
  });

  it("resolves external payloads exclusively within the selected origin", async () => {
    const value = manifest();
    const payload = Buffer.alloc(32, 7);
    value.blocks[0].source = { file: "payload.bin", sha256: digest(payload) };
    const definition = pack({ "whmm_patches/feature.wh3patch.json": encode(value) }, 10);
    const other = pack({ "whmm_patches/payload.bin": payload }, 0);
    await expect(prepare([definition, other])).rejects.toThrow(/payload.*exactly one/i);
  });

  it("checks assets against the effective winning pack", async () => {
    const value = manifest();
    const original = Buffer.from("original");
    value.assets = [
      {
        id: "script",
        virtual_path: "script/companion.lua",
        sha256: digest(original),
        type: "pack_entry",
        required: true,
      },
    ];
    const definition = pack({ "whmm_patches/patch.wh3patch.json": encode(value), "script/companion.lua": original }, 0);
    const replacement = pack({ "script/companion.lua": Buffer.from("replacement") }, 10);
    await expect(prepare([definition], [definition, replacement])).rejects.toThrow(/asset hash mismatch/i);
  });

  it("deduplicates ASCII keys in declaration order", () => {
    const value = manifest();
    value.parameters = [
      {
        id: "keys",
        type: "ascii_key_list",
        default: ["a", "b", "a"],
        capacity: 2,
        max_key_bytes: 4,
        count_at: { block: "state", offset: 0 },
        entries_at: { block: "state", offset: 4 },
      },
    ];
    const parsed = parseAndValidateNativePatchManifest(encode(value));
    expect(parsed.parameters[0].default).toEqual(["a", "b"]);
  });

  it("rejects a write-relative displacement anchor outside the write buffer", async () => {
    const value = manifest();
    value.writes = [{ id: "hook", at: { module: "game", rva: "0x1000" }, expected: "9090909090", bytes: "e900000000" }];
    value.fixups = [
      {
        kind: "rel32",
        at: { write: "hook", offset: 1 },
        target: { block: "state", offset: 0 },
        addend: 0,
        relative_to: { write: "hook", offset: 6 },
      },
    ];
    await expect(prepare([pack({ "whmm_patches/patch.wh3patch.json": encode(value) }, 0)])).rejects.toThrow(
      /relative_to|anchor|write.*(offset|range|bound)/i,
    );
  });

  it("rejects traversal in discovered patch manifest paths", async () => {
    await expect(prepare([pack({ "whmm_patches/../patch.wh3patch.json": encode(manifest()) }, 0)])).rejects.toThrow(
      /path|traversal/i,
    );
  });

  it("checks manifest entry sizes before allocating a read buffer", async () => {
    const value = pack({ "whmm_patches/patch.wh3patch.json": encode(manifest()) }, 0);
    value.pack.packedFiles[0].file_size = MAX_MANIFEST_BYTES + 1;
    fs.truncateSync(value.path, MAX_MANIFEST_BYTES + 1);
    await expect(prepare([value])).rejects.toThrow(/limit|exceed|too large/i);
  });
});
