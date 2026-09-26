import { describe, expect, it } from "vitest";

import {
  areFlowFilesLoaded,
  buildAutomaticFlowExecutionId,
  buildFlowOutputPackBaseName,
  canReuseFlowSourcePack,
} from "../src/flowExecutionSupport";

const createPack = (packedFiles: Array<Partial<PackedFile> & Pick<PackedFile, "name">>) => ({
  packedFiles: packedFiles as PackedFile[],
});

describe("areFlowFilesLoaded", () => {
  it("rejects a metadata-only pack containing flow files", () => {
    expect(
      areFlowFilesLoaded(
        createPack([
          {
            name: "whmmflows\\example.json",
            file_size: 100,
            start_pos: 200,
          },
        ]),
      ),
    ).toBe(false);
  });

  it("accepts a pack when every flow file has loaded content", () => {
    expect(
      areFlowFilesLoaded(
        createPack([
          {
            name: "whmmflows\\one.json",
            buffer: Buffer.from("{}"),
          },
          {
            name: "whmmflows\\two.json",
            text: "{}",
          },
          {
            name: "db\\example_tables\\data__",
          },
        ]),
      ),
    ).toBe(true);
  });

  it("rejects a pack if any flow file is still metadata-only", () => {
    expect(
      areFlowFilesLoaded(
        createPack([
          {
            name: "whmmflows\\loaded.json",
            buffer: Buffer.from("{}"),
          },
          {
            name: "whmmflows\\metadata-only.json",
          },
        ]),
      ),
    ).toBe(false);
  });
});

describe("canReuseFlowSourcePack", () => {
  const loadedPack = {
    ...createPack([
      {
        name: "whmmflows\\example.json",
        buffer: Buffer.from("{}"),
      },
    ]),
    lastChangedLocal: 100,
    size: 200,
  };

  it("accepts loaded flow content when the cached pack matches the file on disk", () => {
    expect(canReuseFlowSourcePack(loadedPack, { mtimeMs: 100, size: 200 })).toBe(true);
  });

  it("rejects loaded flow content after the pack timestamp changes", () => {
    expect(canReuseFlowSourcePack(loadedPack, { mtimeMs: 101, size: 200 })).toBe(false);
  });

  it("rejects loaded flow content after the pack size changes", () => {
    expect(canReuseFlowSourcePack(loadedPack, { mtimeMs: 100, size: 201 })).toBe(false);
  });
});

describe("automatic flow output names", () => {
  it("does not repeat the name when the pack and flow have the same base name", () => {
    const executionId = buildAutomaticFlowExecutionId("pj_unitmultiplier.pack", "whmmflows\\pj_unitmultiplier.json");

    expect(executionId).toBe("pj_unitmultiplier");
    expect(buildFlowOutputPackBaseName(executionId)).toBe("dbflow_pj_unitmultiplier");
  });

  it("keeps distinct flow names so multiple flows in one pack get unique outputs", () => {
    const firstExecutionId = buildAutomaticFlowExecutionId("pj_unitmultiplier.pack", "whmmflows\\increase_units.json");
    const secondExecutionId = buildAutomaticFlowExecutionId(
      "pj_unitmultiplier.pack",
      "whmmflows\\increase_health.json",
    );

    expect(buildFlowOutputPackBaseName(firstExecutionId)).toBe("dbflow_pj_unitmultiplier_increase_units");
    expect(buildFlowOutputPackBaseName(secondExecutionId)).toBe("dbflow_pj_unitmultiplier_increase_health");
  });

  it("does not mistake a regular one-underscore flow ID for a timestamp", () => {
    expect(buildFlowOutputPackBaseName("example_custom")).toBe("dbflow_example_custom");
  });
});
