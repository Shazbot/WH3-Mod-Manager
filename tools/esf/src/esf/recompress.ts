import { LzmaCompressor } from "@napi-rs/lzma";
import { CaabStringTables, parseCaabStringTables, parseCbabStringTables, readCaabHeader, walkCaabNodes } from "./codecs/caabBinary";
import { buildCaabTree, replaceByteRange } from "./codecs/caabTree";
import { cauleb128Length, writeCauleb128, writeCaabBuffer } from "./codecs/caabWriter";
import { decompressEsfBlock, findCompressedEsfBlock } from "./compressed";

const CODEC_CBAB = 0x0000abcb;
const MARKER_U8_ARRAY = 0x46;
const MARKER_U32 = 0x08;

/**
 * Shipped blocks use a 256 KB dictionary (properties `5d00000400`), which is
 * what liblzma's preset 0 produces. Higher presets compress better but declare
 * a larger dictionary, and the game sizes its decode buffer from that field, so
 * matching vanilla is worth more here than a smaller file.
 */
const VANILLA_PRESET = 0;

export interface CompressedEsfPieces {
  /** Raw LZMA stream with no container header of its own. */
  stream: Buffer;
  /** 5-byte properties blob: the lc/lp/pb byte plus a u32 dictionary size. */
  props: Buffer;
  uncompressedSize: number;
}

/**
 * Compresses an inner ESF into the three pieces the outer file stores. A
 * standard "alone" container is produced and then split: bytes 0..5 are the
 * properties, and everything past byte 13 is the stream. The 8-byte size in
 * between is dropped because the ESF keeps it in COMPRESSED_DATA_INFO instead.
 */
export async function compressEsfBlock(inner: Buffer): Promise<CompressedEsfPieces> {
  const compressor = new LzmaCompressor({ preset: VANILLA_PRESET });
  const chunks: Buffer[] = [];
  const chunkSize = 8 * 1024 * 1024;

  for (let offset = 0; offset < inner.length; offset += chunkSize) {
    const produced = compressor.update(inner.subarray(offset, Math.min(offset + chunkSize, inner.length)));
    if (produced && produced.length > 0) {
      chunks.push(Buffer.from(produced));
    }
  }
  chunks.push(await compressor.finish());

  const container = Buffer.concat(chunks);
  if (container.length < 13) {
    throw new Error(`LZMA container too short (${container.length} bytes).`);
  }

  return {
    props: Buffer.from(container.subarray(0, 5)),
    stream: Buffer.from(container.subarray(13)),
    uncompressedSize: inner.length,
  };
}

/** Encodes a u8 array value: marker, CAULEB128 payload length, then payload. */
function encodeU8Array(payload: Buffer): Buffer {
  const lengthWidth = cauleb128Length(payload.length);
  const out = Buffer.allocUnsafe(1 + lengthWidth + payload.length);
  out[0] = MARKER_U8_ARRAY;
  writeCauleb128(out, 1, payload.length);
  payload.copy(out, 1 + lengthWidth);
  return out;
}

/**
 * Encodes a u32 value using the full 4-byte form. The reader also accepts
 * shorter encodings for small numbers, but sizes here are always large enough
 * that the full form is what a re-encode would pick anyway.
 */
function encodeU32(value: number): Buffer {
  const out = Buffer.allocUnsafe(5);
  out[0] = MARKER_U32;
  out.writeUInt32LE(value, 1);
  return out;
}

interface BlockValueSpans {
  streamValue: { start: number; end: number };
  sizeValue: { start: number; end: number };
  propsValue: { start: number; end: number };
}

/** Locates the three values in the outer file that describe the compressed block. */
function findBlockValueSpans(buffer: Buffer, recordNamesOffset: number, tables: CaabStringTables): BlockValueSpans {
  let streamValue: { start: number; end: number } | null = null;
  let sizeValue: { start: number; end: number } | null = null;
  let propsValue: { start: number; end: number } | null = null;

  walkCaabNodes(
    buffer,
    { recordNamesOffset },
    { recordNames: tables.recordNames, utf8ById: tables.utf8ById, utf16ById: tables.utf16ById },
    {
      onValue(value, stack) {
        const parent = stack[stack.length - 1];
        if (value.startOffset === undefined || value.endOffset === undefined) {
          return;
        }
        const span = { start: value.startOffset, end: value.endOffset };

        if (parent === "COMPRESSED_DATA" && value.kind === "array" && value.marker === MARKER_U8_ARRAY && !streamValue) {
          streamValue = span;
          return;
        }
        if (parent !== "COMPRESSED_DATA_INFO") {
          return;
        }
        if (value.kind === "value" && value.type === "u32" && !sizeValue) {
          sizeValue = span;
          return;
        }
        if (value.kind === "array" && value.marker === MARKER_U8_ARRAY && !propsValue) {
          propsValue = span;
        }
      },
    }
  );

  if (!streamValue || !sizeValue || !propsValue) {
    throw new Error("Could not locate the compressed stream, its size and its properties in the outer ESF.");
  }
  return { streamValue, sizeValue, propsValue };
}

export interface RepackResult {
  buffer: Buffer;
  uncompressedSize: number;
  compressedSize: number;
  /** Size of the original compressed stream, for comparison. */
  originalCompressedSize: number;
}

/**
 * Rebuilds a compressed ESF around a new inner file. The outer file keeps every
 * one of its own records; only the stream, its declared size and its properties
 * are swapped, after which the enclosing block sizes are recomputed.
 */
export async function repackCompressedEsf(outer: Buffer, inner: Buffer): Promise<RepackResult> {
  const original = findCompressedEsfBlock(outer);
  if (!original) {
    throw new Error("Input is not a compressed ESF; there is nothing to repack.");
  }

  const header = readCaabHeader(outer);
  const parseTables = header.codecId === CODEC_CBAB ? parseCbabStringTables : parseCaabStringTables;
  const tables = parseTables(outer, header.recordNamesOffset);

  const spans = findBlockValueSpans(outer, header.recordNamesOffset, tables);
  const pieces = await compressEsfBlock(inner);

  const root = buildCaabTree(outer, header, tables);

  const replacements: [string, { start: number; end: number }, Buffer][] = [
    ["compressed stream", spans.streamValue, encodeU8Array(pieces.stream)],
    ["uncompressed size", spans.sizeValue, encodeU32(pieces.uncompressedSize)],
    ["LZMA properties", spans.propsValue, encodeU8Array(pieces.props)],
  ];

  for (const [label, span, data] of replacements) {
    if (!replaceByteRange(root, span.start, span.end, data)) {
      throw new Error(`Could not splice the ${label} at [${span.start}, ${span.end}).`);
    }
  }

  return {
    buffer: writeCaabBuffer({ header, tables, root, source: outer }),
    uncompressedSize: pieces.uncompressedSize,
    compressedSize: pieces.stream.length,
    originalCompressedSize: original.stream.length,
  };
}

/**
 * Repacks and then verifies by reopening the result and decompressing it,
 * confirming the inner bytes survived the trip. Compression is not
 * deterministic across encoders, so the stream itself is expected to differ
 * from the original; what has to match is what it decodes back to.
 */
export async function repackAndVerify(outer: Buffer, inner: Buffer): Promise<RepackResult> {
  const result = await repackCompressedEsf(outer, inner);

  const reopened = findCompressedEsfBlock(result.buffer);
  if (!reopened) {
    throw new Error("Repacked file no longer reports a compressed block.");
  }

  const decoded = decompressEsfBlock(reopened);
  if (!decoded.equals(inner)) {
    throw new Error(
      `Repacked stream decompresses to ${decoded.length} bytes that differ from the ${inner.length} bytes written.`
    );
  }

  return result;
}
