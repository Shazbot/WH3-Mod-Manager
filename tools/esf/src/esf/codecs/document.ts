import { EsfDocument, EsfHeader, EsfNode, EsfRecordNode, EsfStringEntry, EsfValueNode } from "../EsfTypes";
import { CaabStringTables, readCaabHeader } from "./caabBinary";

function buildHeaderNode(header: EsfHeader): EsfRecordNode {
  const value = (name: string, numberValue: number): EsfValueNode => ({
    kind: "value",
    name,
    value: { type: "u32", value: numberValue },
  });

  return {
    kind: "record",
    name: "HEADER",
    children: [
      value("codec_id", header.codecId),
      value("unknown_1", header.unknown1),
      value("creation_date", header.creationDate),
      value("record_names_offset", header.recordNamesOffset),
      value("file_size", header.fileSize),
    ],
  };
}

function buildStringTableNode(stringTable: EsfStringEntry[]): EsfNode {
  return {
    kind: "array",
    name: "STRING_TABLE",
    children: stringTable.map((entry) => ({
      kind: "record",
      name: "STRING",
      children: [
        {
          kind: "value",
          name: "id",
          value: { type: "u32", value: entry.id },
        },
        {
          kind: "value",
          name: "text",
          value: { type: "string", value: entry.text },
        },
        {
          kind: "value",
          name: "offset",
          value: { type: "u32", value: entry.offset },
        },
        {
          kind: "value",
          name: "table",
          value: { type: "string", value: entry.table },
        },
      ],
    })),
  };
}

/**
 * Builds the header + string-table view of an ESF file. The returned `root` is
 * deliberately shallow: it does NOT contain the record tree. Walking the actual
 * node data is done by streaming over the buffer with `walkCaabNodes`, which is
 * what every extractor in `src/extract` uses.
 */
export function buildEsfDocument(
  buffer: Buffer,
  parseStringTables: (buffer: Buffer, recordNamesOffset: number) => CaabStringTables
): EsfDocument {
  const rawHeader = readCaabHeader(buffer);
  const tables = parseStringTables(buffer, rawHeader.recordNamesOffset);

  const header: EsfHeader = {
    codecId: rawHeader.codecId,
    unknown1: rawHeader.unknown1,
    creationDate: rawHeader.creationDate,
    recordNamesOffset: rawHeader.recordNamesOffset,
    fileSize: buffer.length,
  };

  return {
    header,
    root: {
      kind: "record",
      name: "ESF",
      children: [buildHeaderNode(header), buildStringTableNode(tables.entries)],
    },
    stringTable: tables.entries,
    metadata: {
      recordNames: tables.recordNames,
      utf8ById: tables.utf8ById,
      utf16ById: tables.utf16ById,
    },
  };
}
