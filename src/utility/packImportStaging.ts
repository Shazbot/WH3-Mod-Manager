import { serializePackFileDataToBuffer } from "../packFileSerializer";
import type { DBVersion, PackedFile } from "../packFileTypes";
import type { PackImportItem } from "./packImportPlan";
import { normalizePackFilePath } from "./packFilePathUtils";
import { convertRpfmTsvToPackedFile } from "./rpfmTsv";
import { getPackedFileViewerKind } from "./packFileViewing";

export type PackedFileTextDecoder = (packedFile: PackedFile) => string | undefined;

/**
 * The packed file an imported disk file is staged into `appData.unsavedPacksData` as.
 *
 * A converted table has to carry a serialized `buffer`, not just its parsed rows: both pack save
 * paths flatten an unsaved file with `file.buffer || Buffer.from(file.text || "")` and drop
 * `schemaFields`, so a table staged without one is written into the pack as zero bytes.
 *
 * `decodeText` is passed in because the main process decodes a UTF-8 BOM that the viewer's shared
 * `decodePackedTextBuffer` leaves in place.
 */
export const buildImportedPackedFile = (
  item: Pick<PackImportItem, "diskPath" | "packFilePath" | "isRpfmTsv">,
  buffer: Buffer,
  tableSchemas: Record<string, DBVersion[]>,
  decodeText: PackedFileTextDecoder,
): PackedFile => {
  if (item.isRpfmTsv) {
    const convertedFile = convertRpfmTsvToPackedFile(
      buffer.toString("utf8"),
      item.packFilePath,
      tableSchemas,
      item.diskPath,
    );
    if (!convertedFile?.schemaFields || !convertedFile.tableSchema) {
      throw new Error("The TSV did not contain an RPFM table metadata line");
    }

    const tableBuffer = serializePackFileDataToBuffer({
      name: convertedFile.name,
      schemaFields: convertedFile.schemaFields,
      tableSchema: convertedFile.tableSchema,
      version: convertedFile.version,
    });
    return {
      name: convertedFile.name,
      version: convertedFile.version,
      tableSchema: convertedFile.tableSchema,
      schemaFields: convertedFile.schemaFields,
      buffer: tableBuffer,
      file_size: tableBuffer.length,
      start_pos: -1,
      is_compressed: false,
    };
  }

  const importedFile: PackedFile = {
    name: normalizePackFilePath(item.packFilePath),
    buffer,
    file_size: buffer.length,
    start_pos: -1,
    is_compressed: false,
  };
  if (getPackedFileViewerKind(importedFile.name) === "text") {
    importedFile.text = decodeText(importedFile);
  }
  return importedFile;
};
