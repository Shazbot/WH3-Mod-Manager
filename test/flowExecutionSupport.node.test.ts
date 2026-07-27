import { describe, expect, it } from "vitest";

import { areFlowFilesLoaded, canReuseFlowSourcePack } from "../src/flowExecutionSupport";

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
