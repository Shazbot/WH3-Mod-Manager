/**
 * A small pure-JS LZ4 frame codec for tests that run under plain node, where the native
 * `lz4-napi` binary of the app is not installed. Greedy matching only: the output is valid LZ4
 * frames but larger and slower to produce than the native encoder's.
 */

const MAGIC = 0x184d2204;
const BLOCK_MAX = 4 * 1024 * 1024;
const PRIME1 = 2654435761;
const PRIME2 = 2246822519;
const PRIME3 = 3266489917;
const PRIME4 = 668265263;
const PRIME5 = 374761393;

const rotl = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) >>> 0;

/** xxHash32 of a short buffer (only the frame header descriptor is hashed). */
const xxh32 = (data: Buffer, seed = 0): number => {
  let hash = (seed + PRIME5 + data.length) >>> 0;
  let offset = 0;
  while (offset + 4 <= data.length) {
    hash = (hash + Math.imul(data.readUInt32LE(offset), PRIME3)) >>> 0;
    hash = Math.imul(rotl(hash, 17), PRIME4) >>> 0;
    offset += 4;
  }
  while (offset < data.length) {
    hash = (hash + Math.imul(data[offset], PRIME5)) >>> 0;
    hash = Math.imul(rotl(hash, 11), PRIME1) >>> 0;
    offset += 1;
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, PRIME2) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, PRIME3) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
};

const compressBlock = (input: Buffer): Buffer | undefined => {
  const out: number[] = [];
  const table = new Int32Array(1 << 16).fill(-1);
  let anchor = 0;
  let position = 0;
  const limit = input.length - 12;
  const pushLength = (length: number) => {
    while (length >= 255) {
      out.push(255);
      length -= 255;
    }
    out.push(length);
  };
  while (position < limit) {
    const sequence = input.readUInt32LE(position);
    const slot = Math.imul(sequence, PRIME1) >>> 16;
    const candidate = table[slot];
    table[slot] = position;
    if (candidate >= 0 && position - candidate < 65536 && input.readUInt32LE(candidate) === sequence) {
      let matchLength = 4;
      const maxLength = input.length - 5 - position;
      while (matchLength < maxLength && input[candidate + matchLength] === input[position + matchLength]) matchLength++;
      const literalLength = position - anchor;
      out.push((Math.min(literalLength, 15) << 4) | Math.min(matchLength - 4, 15));
      if (literalLength >= 15) pushLength(literalLength - 15);
      for (let index = anchor; index < position; index++) out.push(input[index]);
      out.push((position - candidate) & 255, (position - candidate) >> 8);
      if (matchLength - 4 >= 15) pushLength(matchLength - 4 - 15);
      position += matchLength;
      anchor = position;
    } else {
      position++;
    }
  }
  const literalLength = input.length - anchor;
  out.push(Math.min(literalLength, 15) << 4);
  if (literalLength >= 15) pushLength(literalLength - 15);
  for (let index = anchor; index < input.length; index++) out.push(input[index]);
  return out.length < input.length ? Buffer.from(out) : undefined;
};

export const lz4CompressFrame = async (data: Buffer | string): Promise<Buffer> => {
  const input = typeof data === "string" ? Buffer.from(data) : data;
  const descriptor = Buffer.from([0x60, 0x70]);
  const header = Buffer.alloc(7);
  header.writeUInt32LE(MAGIC, 0);
  descriptor.copy(header, 4);
  header[6] = (xxh32(descriptor) >>> 8) & 255;
  const parts: Buffer[] = [header];
  for (let start = 0; start < input.length; start += BLOCK_MAX) {
    const chunk = input.subarray(start, Math.min(input.length, start + BLOCK_MAX));
    const compressed = compressBlock(chunk);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(compressed ? compressed.length : (chunk.length | 0x80000000) >>> 0, 0);
    parts.push(size, compressed ?? chunk);
  }
  parts.push(Buffer.alloc(4));
  return Buffer.concat(parts);
};

const decompressBlock = (block: Buffer, output: number[]) => {
  let position = 0;
  while (position < block.length) {
    const token = block[position++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let extra;
      do {
        extra = block[position++];
        literalLength += extra;
      } while (extra === 255);
    }
    for (let index = 0; index < literalLength; index++) output.push(block[position++]);
    if (position >= block.length) return;
    const offset = block[position] | (block[position + 1] << 8);
    position += 2;
    let matchLength = (token & 15) + 4;
    if ((token & 15) === 15) {
      let extra;
      do {
        extra = block[position++];
        matchLength += extra;
      } while (extra === 255);
    }
    const from = output.length - offset;
    for (let index = 0; index < matchLength; index++) output.push(output[from + index]);
  }
};

export const lz4DecompressFrame = async (data: Buffer | string): Promise<Buffer> => {
  const input = typeof data === "string" ? Buffer.from(data) : data;
  if (input.readUInt32LE(0) !== MAGIC) throw new Error("not an LZ4 frame");
  let position = 7;
  const parts: Buffer[] = [];
  for (;;) {
    const size = input.readUInt32LE(position);
    position += 4;
    if (size === 0) break;
    const length = size & 0x7fffffff;
    const block = input.subarray(position, position + length);
    position += length;
    if (size & 0x80000000) parts.push(Buffer.from(block));
    else {
      const output: number[] = [];
      decompressBlock(block, output);
      parts.push(Buffer.from(output));
    }
  }
  return Buffer.concat(parts);
};
