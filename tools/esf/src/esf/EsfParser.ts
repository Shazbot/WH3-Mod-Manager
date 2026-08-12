import { BinaryReader } from "../binary/BinaryReader";
import { parseAbcaDocument } from "./codecs/abca";
import { parseCbabDocument } from "./codecs/cbab";
import { EsfDocument, EsfNode } from "./EsfTypes";

export const ABCA_CODEC_ID = 0x0000abca;
export const ABCB_CODEC_ID = 0x0000abcb;

/**
 * Reads the ESF header, string tables and codec metadata.
 *
 * Note that `document.root` only holds `HEADER` and `STRING_TABLE`; the record
 * tree is not materialised. Extractors stream over the node data instead, via
 * `walkCaabNodes` with `document.header.recordNamesOffset` and
 * `document.metadata`.
 */
export function parseEsfDocument(buffer: Buffer): EsfDocument {
  const reader = new BinaryReader(buffer);
  if (reader.length < 4) {
    throw new Error("Invalid ESF file: missing codec id.");
  }

  const codecId = reader.readUInt32LE(0);
  if (codecId === ABCA_CODEC_ID) {
    return parseAbcaDocument(buffer);
  }
  if (codecId === ABCB_CODEC_ID) {
    return parseCbabDocument(buffer);
  }

  throw new Error(
    `Unsupported ESF codec id 0x${codecId
      .toString(16)
      .padStart(8, "0")}. Supported: 0x${ABCA_CODEC_ID
      .toString(16)
      .padStart(8, "0")} (CAAB), 0x${ABCB_CODEC_ID.toString(16).padStart(8, "0")} (CBAB).`
  );
}

/** Convenience wrapper for {@link parseEsfDocument}; same shallow-root caveat applies. */
export function parseEsf(buffer: Buffer): EsfNode {
  return parseEsfDocument(buffer).root;
}
