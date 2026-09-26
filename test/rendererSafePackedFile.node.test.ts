import { findNonSerializableValue } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({ decompress: vi.fn() }));

import type { PackedFile } from "../src/packFileTypes";
import { preparePackedFileForViewer, serializePackFileDataToBuffer } from "../src/packFileSerializer";
import { toRendererSafePackedFile } from "../src/utility/rendererSafePackedFile";

describe("renderer-safe packed files", () => {
  it("replaces nested buffers with serializable byte arrays without changing serialized output", () => {
    const packedFile: PackedFile = {
      name: "db\\example_tables\\clone_",
      file_size: 0,
      start_pos: -1,
      buffer: Buffer.from([99]),
      tableSchema: {
        version: 1,
        fields: [{ name: "key", field_type: "StringU8", is_key: true, default_value: "" }],
      },
      schemaFields: [
        {
          type: "Buffer",
          fields: [{ type: "Buffer", val: Buffer.from([3, 0, 97, 98, 99]) }],
        },
      ],
    };

    const rendererFile = toRendererSafePackedFile(packedFile);

    expect(rendererFile.buffer).toBeUndefined();
    expect(rendererFile.schemaFields?.[0].fields[0].val).toEqual([3, 0, 97, 98, 99]);
    expect(findNonSerializableValue(rendererFile)).toBe(false);
    expect(serializePackFileDataToBuffer(rendererFile)).toEqual(
      serializePackFileDataToBuffer({ ...packedFile, buffer: undefined }),
    );
    expect(Buffer.isBuffer(packedFile.schemaFields?.[0].fields[0].val)).toBe(true);
  });

  it("does not prepare an index-only DB descriptor as an empty table", () => {
    const indexedFile = {
      name: "db\\example_tables\\clone_",
      file_size: 20,
      start_pos: 100,
    } as PackedFile;

    expect(preparePackedFileForViewer({ name: "example.pack", path: "K:\\mods\\example.pack" }, indexedFile)).toBe(
      indexedFile,
    );
  });
});
