import type { DBVersion, Field, NewPackedFile } from "../packFileTypes";
import type { PackGame } from "./gameContext";

export const DEFAULT_MAX_INDEX_BYTES = 128 * 1024 * 1024;
export const DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES = 256 * 1024 * 1024;

/** Runtime context required by pack operations; no application state is consulted implicitly. */
export interface PackCoreContext {
  game: PackGame;
  maxIndexBytes?: number;
  maxLogicalPayloadBytes?: number;
}

export interface CorePackHeader {
  signature: Buffer;
  byteMask: number;
  refFileCount: number;
  dependencyIndexSize: number;
  fileCount: number;
  fileIndexSize: number;
  headerBuffer: Buffer;
  rawHeader: Buffer;
}

export interface CorePackEntry {
  name: string;
  file_size: number;
  start_pos: number;
  is_compressed: boolean;
  /** Present only when the PFH index's 0x40 filename-hash flag is set. */
  file_name_hash?: number;
}

export interface CorePack {
  path: string;
  game: PackGame;
  fileSize: number;
  dataStart: number;
  header: CorePackHeader;
  dependencyBytes: Buffer;
  dependencies: string[];
  entries: CorePackEntry[];
  trailingBytes: Buffer;
}

export interface RawPackWriteEntry {
  name: string;
  is_compressed?: boolean;
  file_name_hash?: number;
  buffer?: Buffer;
  /** Copy this entry's stored bytes directly from the source pack. */
  source?: { path: string; start_pos: number; file_size: number };
}

export interface RawPackWriteMetadata {
  game: PackGame;
  byteMask: number;
  /** Accepted for compatibility; the writer derives the header count from the serialized dependency names. */
  refFileCount: number;
  headerBuffer: Buffer;
  dependencies: readonly string[];
  /** Pass through original bytes when dependencies are unchanged. */
  dependencyBytes?: Buffer;
  trailingBytes?: Buffer;
  packType?: "mod" | "movie";
}

export interface ExactFieldResult {
  fields: Field[];
  nextPosition: number;
}

/** Parsed DB preamble retained byte-for-byte for lossless row edits. */
export interface DbTablePreamble {
  guid?: string;
  version?: number;
  /** Bytes before the row count, including GUID/version markers and the table flag byte. */
  bytes: Buffer;
  rowCount: number;
  rowCountBytes: Buffer;
  dataPosition: number;
}

export interface ParsedDbCell {
  fieldIndex: number;
  fields: Field[];
  bytes: Buffer;
}

export interface ParsedDbRow {
  cells: ParsedDbCell[];
}

export interface ParsedDbTable {
  preamble: DbTablePreamble;
  schema: DBVersion;
  rows: ParsedDbRow[];
  trailingBytes: Buffer;
}

export interface DbCellPatch {
  rowIndex: number;
  fieldIndex: number;
  fields: Field[];
}

export type DbSerializedCell = { fields: Field[] } | { bytes: Buffer };

export type CoreNewPackedFile = NewPackedFile & {
  is_compressed?: boolean;
  file_name_hash?: number;
  /** Existing DB table preamble to preserve byte-for-byte when serializing edited fields. */
  dbPreamble?: Buffer;
};
