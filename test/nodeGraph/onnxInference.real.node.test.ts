import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { joinOnnxPackPath, parseOnnxBundleMetadata } from "../../src/nodeGraph/onnxFlow";
import { runOnnxInference } from "../../src/nodeGraph/onnxInference";
import { readPack } from "../../src/packFileSerializer";
import { normalizePackFilePathKey } from "../../src/utility/packFilePathUtils";

const SAMPLE_PACK = "/mnt/k/SteamLibrary/steamapps/workshop/content/1142710/3827334042/radious_stat_scaler.pack";
const canReadSamplePack = fs.existsSync(SAMPLE_PACK);

const packedBytes = (entry: PackedFile | undefined, name: string): Buffer => {
  if (entry?.buffer) return Buffer.from(entry.buffer);
  if (entry?.text !== undefined) return Buffer.from(entry.text, "utf8");
  throw new Error(`Sample pack entry '${name}' was not loaded`);
};

describe.skipIf(!canReadSamplePack)("real ONNX bundle inference", () => {
  it("runs every sample prediction model on CPU", async () => {
    const paths = {
      modelsManifest: "onnx_models/models.json",
      preprocessorManifest: "onnx_models/preprocessor.json",
      preprocessor: "onnx_models/preprocessor.onnx",
    };
    const index = await readPack(SAMPLE_PACK, { skipParsingTables: true, skipSorting: true });
    const entryNames = new Map(index.packedFiles.map((entry) => [normalizePackFilePathKey(entry.name), entry.name]));
    const manifestNames = [paths.modelsManifest, paths.preprocessorManifest].map((name) =>
      entryNames.get(normalizePackFilePathKey(name)),
    );
    if (manifestNames.some((name) => !name)) throw new Error("Sample pack is missing ONNX manifests");
    const manifests = await readPack(SAMPLE_PACK, {
      skipParsingTables: true,
      skipSorting: true,
      filesToRead: manifestNames as string[],
    });
    const manifestMap = new Map(manifests.packedFiles.map((entry) => [normalizePackFilePathKey(entry.name), entry]));
    const modelsText = packedBytes(
      manifestMap.get(normalizePackFilePathKey(paths.modelsManifest.replace(/\//g, "\\"))),
      paths.modelsManifest,
    ).toString("utf8");
    const preprocessorText = packedBytes(
      manifestMap.get(normalizePackFilePathKey(paths.preprocessorManifest.replace(/\//g, "\\"))),
      paths.preprocessorManifest,
    ).toString("utf8");
    const metadata = parseOnnxBundleMetadata(modelsText, preprocessorText);
    const fileModels = metadata.models.filter((candidate) => candidate.file);
    if (fileModels.length === 0) throw new Error("Sample pack contains no file-backed prediction model");
    const payloadPaths = [
      paths.preprocessor,
      ...fileModels.map((model) => joinOnnxPackPath("onnx_models", model.file!)),
    ];
    const indexedPayloads = payloadPaths.map((name) =>
      entryNames.get(normalizePackFilePathKey(name.replace(/\//g, "\\"))),
    );
    if (indexedPayloads.some((name) => !name)) throw new Error("Sample pack is missing an ONNX model payload");
    const payloadPack = await readPack(SAMPLE_PACK, {
      skipParsingTables: true,
      skipSorting: true,
      filesToRead: indexedPayloads as string[],
    });
    const payloadByPath = new Map(
      payloadPack.packedFiles.map((entry) => [normalizePackFilePathKey(entry.name), entry]),
    );
    const predictions = await runOnnxInference({
      preprocessorBytes: packedBytes(
        payloadByPath.get(normalizePackFilePathKey(paths.preprocessor.replace(/\//g, "\\"))),
        paths.preprocessor,
      ),
      preprocessorOutput: metadata.preprocessorOutput,
      inputs: metadata.inputs,
      inputBindings: Object.fromEntries(
        metadata.inputs.map((input) => [
          input.name,
          {
            kind: "constant" as const,
            value: input.type === "string" ? metadata.categoricalMissing : 0,
          },
        ]),
      ),
      categoricalMissing: metadata.categoricalMissing,
      rows: [[]],
      models: metadata.models.map((definition) => ({
        definition,
        ...(definition.file
          ? {
              bytes: packedBytes(
                payloadByPath.get(
                  normalizePackFilePathKey(joinOnnxPackPath("onnx_models", definition.file).replace(/\//g, "\\")),
                ),
                definition.file,
              ),
            }
          : {}),
      })),
      resolvePath: () => undefined,
    });
    expect(Object.keys(predictions)).toHaveLength(metadata.models.length);
    for (const model of metadata.models) {
      expect(predictions[model.key]).toHaveLength(1);
      expect(Number.isFinite(predictions[model.key][0])).toBe(true);
    }
    const resultFile = process.env.WHMM_ONNX_TEST_RESULT_FILE;
    if (resultFile) fs.writeFileSync(resultFile, JSON.stringify({ predictions, modelCount: metadata.models.length }));
  }, 120_000);
});
