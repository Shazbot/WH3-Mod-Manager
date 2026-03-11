export type PackedFileViewerKind = "text" | "image";

const TEXT_FILE_EXTENSIONS = new Set([
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
  const extension = getPackedFileLowerExtension(filePath);
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return "text";
  }
  if (IMAGE_FILE_MIME_TYPES[extension]) {
    return "image";
  }
  return undefined;
};

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
