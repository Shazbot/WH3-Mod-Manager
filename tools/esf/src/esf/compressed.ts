import { lzma } from "@napi-rs/lzma";
import { parseCaabStringTables, parseCbabStringTables, readCaabHeader, walkCaabNodes } from "./codecs/caabBinary";

const CODEC_CBAB = 0x0000abcb;

/** Byte array marker used for the raw LZMA stream and the properties blob. */
const MARKER_U8_ARRAY = 0x46;

export interface CompressedEsfBlock {
  /** Raw LZMA stream, with no container header of its own. */
  stream: Buffer;
  /** Size the stream decompresses to, from COMPRESSED_DATA_INFO. */
  uncompressedSize: number;
  /** 5-byte LZMA properties blob (lc/lp/pb byte + 4-byte dictionary size). */
  props: Buffer;
}

/**
 * Locates a `COMPRESSED_DATA` / `COMPRESSED_DATA_INFO` pair, as used by
 * `startpos.esf`, which stores the whole campaign state as an LZMA stream.
 * Returns null for ESF files that are not wrapped this way (e.g. `map_data.esf`).
 */
export function findCompressedEsfBlock(buffer: Buffer): CompressedEsfBlock | null {
  const header = readCaabHeader(buffer);
  const tables =
    header.codecId === CODEC_CBAB
      ? parseCbabStringTables(buffer, header.recordNamesOffset)
      : parseCaabStringTables(buffer, header.recordNamesOffset);

  if (!tables.recordNames.includes("COMPRESSED_DATA")) {
    return null;
  }

  let stream: Buffer | null = null;
  let uncompressedSize: number | null = null;
  let props: Buffer | null = null;

  walkCaabNodes(
    buffer,
    { recordNamesOffset: header.recordNamesOffset },
    {
      recordNames: tables.recordNames,
      utf8ById: tables.utf8ById,
      utf16ById: tables.utf16ById,
    },
    {
      onValue(value, stack) {
        const parent = stack[stack.length - 1];

        if (parent === "COMPRESSED_DATA" && value.kind === "array" && value.marker === MARKER_U8_ARRAY && !stream) {
          stream = value.value.payload;
          return;
        }

        if (parent !== "COMPRESSED_DATA_INFO") {
          return;
        }

        if (value.kind === "value" && value.type === "u32" && uncompressedSize === null) {
          uncompressedSize = Number(value.value);
          return;
        }

        if (value.kind === "array" && value.marker === MARKER_U8_ARRAY && !props) {
          props = value.value.payload;
        }
      },
    }
  );

  if (!stream || uncompressedSize === null || !props) {
    throw new Error(
      "ESF declares COMPRESSED_DATA but the stream, its size or its LZMA properties could not be read."
    );
  }

  return { stream, uncompressedSize, props };
}

/**
 * Rebuilds a standard "LZMA alone" container from the pieces the ESF stores
 * separately (5 properties bytes, then the uncompressed size as a 64-bit
 * little-endian value, then the stream) and decompresses it.
 */
export function decompressEsfBlock(block: CompressedEsfBlock): Buffer {
  if (block.props.length !== 5) {
    throw new Error(`Unexpected LZMA properties length ${block.props.length}; expected 5.`);
  }

  const header = Buffer.alloc(13);
  block.props.copy(header, 0);
  header.writeBigUInt64LE(BigInt(block.uncompressedSize), 5);

  const decompressed = lzma.decompressSync(Buffer.concat([header, block.stream]));

  if (decompressed.length !== block.uncompressedSize) {
    throw new Error(
      `LZMA output size mismatch: got ${decompressed.length} bytes, expected ${block.uncompressedSize}.`
    );
  }

  return decompressed;
}

export interface OpenedEsfBuffer {
  /** The ESF bytes to parse: the inner file when the input was compressed. */
  buffer: Buffer;
  wasCompressed: boolean;
  /** Decompressed byte count, when the input was compressed. */
  uncompressedSize: number | null;
}

/**
 * Returns the ESF bytes that actually hold the record tree, transparently
 * unwrapping an LZMA `COMPRESSED_DATA` block when one is present. Use this
 * instead of reading a file straight into `parseEsfDocument` if the input might
 * be a `startpos.esf`.
 */
export function openEsfBuffer(buffer: Buffer): OpenedEsfBuffer {
  const block = findCompressedEsfBlock(buffer);
  if (!block) {
    return { buffer, wasCompressed: false, uncompressedSize: null };
  }

  return {
    buffer: decompressEsfBlock(block),
    wasCompressed: true,
    uncompressedSize: block.uncompressedSize,
  };
}
