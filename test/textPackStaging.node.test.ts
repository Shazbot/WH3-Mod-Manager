import { describe, expect, it } from "vitest";
import type { PackedFile } from "../src/packFileTypes";
import { applyTextPackedFileEdit } from "../src/utility/textPackStaging";

const file = (name: string, text: string): PackedFile => ({
  name,
  file_size: Buffer.byteLength(text),
  start_pos: -1,
  text,
});

describe("text pack staging", () => {
  it("removes an override when text returns to the original file", () => {
    const original = [file("scripts\\same.lua", "original")];

    expect(applyTextPackedFileEdit(original, "scripts/same.lua", "original", "original")).toEqual([]);
  });

  it("treats CodeMirror's normalized line endings as the original text", () => {
    const original = [file("scripts\\same.lua", "first\r\nsecond\r\n")];

    expect(applyTextPackedFileEdit(original, "scripts/same.lua", "first\nsecond\n", "first\r\nsecond\r\n")).toEqual([]);
  });

  it("replaces only the edited file when the text is different", () => {
    const other = file("scripts\\other.lua", "other");
    const next = applyTextPackedFileEdit(
      [file("scripts\\same.lua", "old"), other],
      "scripts/same.lua",
      "new",
      "original",
    );

    expect(next.map((packedFile) => packedFile.name)).toEqual(["scripts\\other.lua", "scripts\\same.lua"]);
    expect(next.find((packedFile) => packedFile.name === "scripts\\same.lua")?.text).toBe("new");
  });

  it("does not treat an unreadable original as a no-op", () => {
    const next = applyTextPackedFileEdit([], "scripts\\same.lua", "text");

    expect(next).toHaveLength(1);
    expect(next[0].text).toBe("text");
  });
});
