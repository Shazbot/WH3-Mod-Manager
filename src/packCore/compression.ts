import * as zlib from "node:zlib";
import { DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES } from "./types";

const zstdFrameMagic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const lz4FrameMagic = Buffer.from([0x04, 0x22, 0x4d, 0x18]);

type Lz4Module = { decompressFrame(data: string | Buffer): Promise<Buffer> };

let lz4Module: Lz4Module | undefined;

const loadLz4 = (): Lz4Module => {
  lz4Module ??= require("lz4-napi") as Lz4Module;
  return lz4Module;
};

const tryZstdDecompress = (payload: Buffer, maxOutputBytes: number): Buffer => {
  return Buffer.from(zlib.zstdDecompressSync(payload, { maxOutputLength: maxOutputBytes }));
};

const tryLz4FrameDecompress = async (payload: Buffer): Promise<Buffer> => {
  // lz4-napi exposes no output-size option; the configured cap is checked immediately after decode.
  const result = await loadLz4().decompressFrame(payload);
  return Buffer.from(result);
};

const tryZlibDecompress = (payload: Buffer, maxOutputBytes: number): Buffer => {
  try {
    return Buffer.from(zlib.inflateRawSync(payload, { maxOutputLength: maxOutputBytes }));
  } catch {
    return Buffer.from(zlib.inflateSync(payload, { maxOutputLength: maxOutputBytes }));
  }
};

/** Decompresses supported CA pack payload frames, loading native codecs only when needed. */
export const decompressPackedPayload = async (
  buffer: Buffer,
  context?: string,
  maxOutputBytes = DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES,
): Promise<Buffer> => {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new Error(`maxOutputBytes must be a non-negative safe integer, got ${maxOutputBytes}`);
  }

  const offsets: number[] = [];
  const addOffset = (offset: number) => {
    if (offset < 0 || offset >= buffer.length) return;
    if (!offsets.includes(offset)) offsets.push(offset);
  };
  addOffset(4);
  addOffset(0);
  for (let index = 0; index <= Math.min(32, buffer.length - 4); index++) {
    if (buffer.subarray(index, index + 4).equals(zstdFrameMagic)) addOffset(index);
    if (buffer.subarray(index, index + 4).equals(lz4FrameMagic)) addOffset(index);
  }
  addOffset(8);
  addOffset(12);
  addOffset(16);
  let lastError: unknown;

  const checked = (result: Buffer): Buffer => {
    if (result.length > maxOutputBytes) throw new Error(`decompressed payload exceeds ${maxOutputBytes} bytes`);
    return result;
  };

  for (const offset of offsets) {
    const payload = buffer.subarray(offset);
    if (payload.length < 4 || !payload.subarray(0, 4).equals(zstdFrameMagic)) continue;
    try {
      return checked(tryZstdDecompress(payload, maxOutputBytes));
    } catch (error) {
      lastError = error;
    }
  }
  for (const offset of offsets) {
    const payload = buffer.subarray(offset);
    if (payload.length < 4 || !payload.subarray(0, 4).equals(lz4FrameMagic)) continue;
    try {
      return checked(await tryLz4FrameDecompress(payload));
    } catch (error) {
      lastError = error;
    }
  }
  for (const offset of offsets) {
    const payload = buffer.subarray(offset);
    if (payload.length < 4) continue;
    try {
      return checked(tryZstdDecompress(payload, maxOutputBytes));
    } catch (error) {
      lastError = error;
    }
  }
  for (const offset of offsets) {
    const payload = buffer.subarray(offset);
    if (payload.length < 2) continue;
    try {
      return checked(tryZlibDecompress(payload, maxOutputBytes));
    } catch (error) {
      lastError = error;
    }
  }
  const contextSuffix = context ? ` (${context})` : "";
  throw new Error(
    `Failed to decompress packed payload${contextSuffix}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
};
