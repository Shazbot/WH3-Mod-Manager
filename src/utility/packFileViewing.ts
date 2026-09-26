import { isLoadOrderRulesPackedFilePath } from "./loadOrderRulesFile";

export type PackedFileViewerKind = "text" | "image";

export const DDS_FILE_EXTENSION = ".dds";

export const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".htm",
  ".html",
  ".js",
  ".json",
  ".lua",
  ".md",
  ".txt",
  ".variantmeshdefinition",
  ".wsmodel",
  ".xml",
  ".xml.material",
]);

/** Fast path for callers that already hold a lowercased packed-file path. */
export const isTextPackedFilePath = (lowerFilePath: string): boolean => {
  const normalized = lowerFilePath;
  if (normalized.startsWith("whmmflows\\")) return true;
  // .whmm is not a text extension, but the rules file is text and has to stay openable so that a
  // viewer which does not know about the dedicated editor still shows something useful.
  if (isLoadOrderRulesPackedFilePath(normalized)) return true;
  const extension = normalized.endsWith(".xml.material")
    ? ".xml.material"
    : normalized.slice(normalized.lastIndexOf("."));
  return TEXT_FILE_EXTENSIONS.has(extension);
};

const IMAGE_FILE_MIME_TYPES: Record<string, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export const getPackedFileLowerExtension = (filePath: string): string => {
  const lowerFilePath = filePath.toLowerCase();
  if (lowerFilePath.endsWith(".xml.material")) {
    return ".xml.material";
  }

  const lastDotIndex = lowerFilePath.lastIndexOf(".");
  return lastDotIndex >= 0 ? lowerFilePath.slice(lastDotIndex) : "";
};

export const getPackedFileViewerKind = (filePath: string): PackedFileViewerKind | undefined => {
  const normalizedFilePath = filePath.replace(/\//g, "\\").toLowerCase();
  if (normalizedFilePath.startsWith("whmmflows\\") || isLoadOrderRulesPackedFilePath(normalizedFilePath)) {
    return "text";
  }

  if (isTextPackedFilePath(normalizedFilePath)) {
    return "text";
  }
  const extension = getPackedFileLowerExtension(filePath);
  if (IMAGE_FILE_MIME_TYPES[extension] || extension === DDS_FILE_EXTENSION) {
    return "image";
  }
  return undefined;
};

export const isDdsPackedFilePath = (filePath: string): boolean =>
  getPackedFileLowerExtension(filePath) === DDS_FILE_EXTENSION;

export const isOpenablePackedFilePath = (filePath: string): boolean => getPackedFileViewerKind(filePath) != null;

export const getPackedFileMimeType = (filePath: string): string | undefined => {
  const extension = getPackedFileLowerExtension(filePath);
  return IMAGE_FILE_MIME_TYPES[extension];
};

export const decodePackedTextBuffer = (buffer: Buffer): string => {
  if (buffer.subarray(0, 2).toString("hex") === "fffe") {
    return buffer.subarray(2).toString("utf16le");
  }
  return buffer.toString("utf8");
};
