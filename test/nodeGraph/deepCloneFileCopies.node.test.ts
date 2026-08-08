import { describe, expect, it, vi } from "vitest";

import { buildFileCopyOutputs } from "../../src/flowDeepClone";
import type { Pack } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const portholes = "ui\\units\\minspec_portholes\\";
const UI_PACK = "C:\\game\\data\\ui.pack";
const MOD_PACK = "C:\\game\\data\\my_mod.pack";

const fileCopies = [
  { sourceName: `${portholes}greatswords.png`, targetName: `${portholes}abc_greatswords.png` },
  { sourceName: `${portholes}greatswords_mask1.png`, targetName: `${portholes}abc_greatswords_mask1.png` },
];

const index = new Map([
  [`${portholes}greatswords.png`, UI_PACK],
  [`${portholes}greatswords_mask1.png`, UI_PACK],
]);

const bytesFor = (name: string) => Buffer.from(`bytes:${name}`);

describe("buildFileCopyOutputs", () => {
  it("turns copies into save entries carrying the source bytes at the exact target path", async () => {
    const warnings: string[] = [];
    const outputs = await buildFileCopyOutputs(
      fileCopies,
      index,
      async (_packPath, names) => new Map(names.map((name) => [name, bytesFor(name)])),
      {} as Pack,
      (message) => warnings.push(message),
    );

    expect(warnings).toEqual([]);
    expect(outputs).toHaveLength(2);
    // outputFileName is what makes the save node write the verbatim path rather than a db name.
    expect(outputs.map((output) => output.outputFileName)).toEqual([
      `${portholes}abc_greatswords.png`,
      `${portholes}abc_greatswords_mask1.png`,
    ]);
    expect(outputs[0].table.buffer).toEqual(bytesFor(`${portholes}greatswords.png`));
    expect(outputs[0].table.file_size).toBe(bytesFor(`${portholes}greatswords.png`).length);
  });

  it("opens each source pack once, however many files come from it", async () => {
    const readPackedFiles = vi.fn(
      async (_packPath: string, names: string[]) => new Map(names.map((name) => [name, bytesFor(name)])),
    );

    await buildFileCopyOutputs(fileCopies, index, readPackedFiles, {} as Pack, () => undefined);

    expect(readPackedFiles).toHaveBeenCalledTimes(1);
    expect(readPackedFiles.mock.calls[0][1]).toEqual(fileCopies.map((fileCopy) => fileCopy.sourceName));
  });

  it("groups by source pack so a mod override is read from its own pack", async () => {
    const splitIndex = new Map([
      [`${portholes}greatswords.png`, MOD_PACK],
      [`${portholes}greatswords_mask1.png`, UI_PACK],
    ]);
    const readPackedFiles = vi.fn(
      async (_packPath: string, names: string[]) => new Map(names.map((name) => [name, bytesFor(name)])),
    );

    const outputs = await buildFileCopyOutputs(
      fileCopies,
      splitIndex,
      readPackedFiles,
      {} as Pack,
      () => undefined,
    );

    expect(outputs).toHaveLength(2);
    expect(readPackedFiles.mock.calls.map((call) => call[0]).toSorted()).toEqual([MOD_PACK, UI_PACK]);
  });

  it("reports a copy whose pack is unknown instead of dropping it silently", async () => {
    const warnings: string[] = [];
    const outputs = await buildFileCopyOutputs(
      fileCopies,
      new Map(),
      async () => new Map(),
      {} as Pack,
      (message) => warnings.push(message),
    );

    expect(outputs).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("No pack holds");
  });

  it("reports a file whose bytes could not be read", async () => {
    const warnings: string[] = [];
    const outputs = await buildFileCopyOutputs(
      fileCopies,
      index,
      async () => new Map([[`${portholes}greatswords.png`, bytesFor(`${portholes}greatswords.png`)]]),
      {} as Pack,
      (message) => warnings.push(message),
    );

    expect(outputs).toHaveLength(1);
    expect(warnings).toEqual([`No content for ${portholes}greatswords_mask1.png`]);
  });

  it("reports a pack that fails to open rather than aborting the clone", async () => {
    const warnings: string[] = [];
    const outputs = await buildFileCopyOutputs(
      fileCopies,
      index,
      async () => {
        throw new Error("corrupt pack");
      },
      {} as Pack,
      (message) => warnings.push(message),
    );

    expect(outputs).toEqual([]);
    expect(warnings[0]).toContain("corrupt pack");
  });
});
