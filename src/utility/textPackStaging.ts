import type { PackedFile } from "../packFileTypes";
import { normalizePackFilePathKey } from "./packFilePathUtils";

const normalizeTextForComparison = (text: string) => text.replace(/\r\n?/g, "\n");

/**
 * Applies a text-file edit to the staged files for a pack.
 *
 * Returning to the original text removes the staged override instead of storing a second copy of
 * the original file. `originalText` is optional because callers may not be able to read the source
 * pack (for example, a newly created in-memory pack).
 */
export const applyTextPackedFileEdit = (
  unsavedFiles: readonly PackedFile[],
  filePath: string,
  text: string,
  originalText?: string,
): PackedFile[] => {
  const fileKey = normalizePackFilePathKey(filePath);
  const existingFile = unsavedFiles.find((file) => normalizePackFilePathKey(file.name) === fileKey);

  if (originalText !== undefined && normalizeTextForComparison(text) === normalizeTextForComparison(originalText)) {
    return unsavedFiles.filter((file) => normalizePackFilePathKey(file.name) !== fileKey);
  }

  const buffer = Buffer.from(text, "utf8");
  const nextUnsavedFile = {
    name: existingFile?.name ?? filePath,
    file_size: buffer.length,
    start_pos: -1,
    text,
    buffer,
  } as PackedFile;

  return unsavedFiles.filter((file) => normalizePackFilePathKey(file.name) !== fileKey).concat(nextUnsavedFile);
};
