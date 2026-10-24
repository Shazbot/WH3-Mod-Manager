/**
 * Encoding of one table column for the vanilla DB cache.
 *
 * Numeric types other than I64 use a narrow numeric codec, strings use a shared dictionary, and I64
 * uses a fixed-width signed encoding so every 64-bit value remains exact. The numeric codec picks the
 * narrowest representation that still round-trips exactly.
 *
 * Exactness is the whole point: the cache stands in for `readPack`, so a decoded cell has to equal the
 * one a real parse produces. Every choice here is made by checking the values rather than trusting the
 * declared field type, so a column whose contents do not match its type degrades to a wider encoding
 * instead of being silently mangled.
 */

export const NUMERIC_ENCODING_INT_BITPACKED = 0;
export const NUMERIC_ENCODING_FLOAT32 = 1;
export const NUMERIC_ENCODING_FLOAT64 = 2;
export const ENCODING_DICTIONARY = 3;

const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;

const toI64 = (value: bigint | number | string): bigint => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`I64 Number input must be a safe integer: ${value}`);
    }
  } else if (typeof value === "string" && !/^-?\d+$/.test(value)) {
    throw new TypeError(`I64 string input must be a decimal integer: ${value}`);
  }

  const exact = typeof value === "bigint" ? value : BigInt(value);
  if (exact < MIN_I64 || exact > MAX_I64) throw new RangeError(`I64 value is out of range: ${exact}`);
  return exact;
};

/** Exact I64 encoding: u32 row count followed by signed little-endian 64-bit values. */
export const encodeI64Column = (values: readonly (bigint | number | string)[]): Uint8Array => {
  if (values.length > 0xffffffff) throw new RangeError(`I64 column has too many rows: ${values.length}`);
  const bytes = new Uint8Array(4 + values.length * 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, values.length, true);
  values.forEach((value, index) => view.setBigInt64(4 + index * 8, toI64(value), true));
  return bytes;
};

/** Exact I64 values as JSON-safe decimal strings. */
export const decodeI64Column = (bytes: Uint8Array): string[] => {
  if (bytes.length < 4) throw new Error("Truncated I64 column count");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (bytes.length !== 4 + count * 8) throw new Error("Invalid I64 column length");
  const values = new Array<string>(count);
  for (let index = 0; index < count; index++) {
    values[index] = view.getBigInt64(4 + index * 8, true).toString(10);
  }
  return values;
};

/** Range a frame-of-reference integer column can span before bit packing stops paying. */
const MAX_BITPACKED_WIDTH = 32;

const varintSize = (value: number) => {
  let size = 1;
  let remaining = value;
  while (remaining >= 0x80) {
    remaining = Math.floor(remaining / 0x80);
    size++;
  }
  return size;
};

const writeVarint = (bytes: Uint8Array, offset: number, value: number): number => {
  let remaining = value;
  let position = offset;
  while (remaining >= 0x80) {
    bytes[position++] = (remaining & 0x7f) | 0x80;
    remaining = Math.floor(remaining / 0x80);
  }
  bytes[position++] = remaining;
  return position;
};

const readVarint = (bytes: Uint8Array, offset: number): [value: number, nextOffset: number] => {
  let value = 0;
  let scale = 1;
  let position = offset;
  for (;;) {
    const byte = bytes[position++];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return [value, position];
    scale *= 0x80;
  }
};

const packedByteLength = (count: number, bitWidth: number) => Math.ceil((count * bitWidth) / 8);

/**
 * Writes `bitWidth` bits, most significant first.
 *
 * Bits are laid out big-endian within each byte so that a value never has to be reassembled from
 * pieces that were written in a different order than they are read.
 */
const writeBits = (bytes: Uint8Array, bitOffset: number, value: number, bitWidth: number): void => {
  let remaining = bitWidth;
  let position = bitOffset;
  while (remaining > 0) {
    const byteIndex = position >>> 3;
    const bitInByte = position & 7;
    const writable = Math.min(8 - bitInByte, remaining);
    const shifted = Math.floor(value / Math.pow(2, remaining - writable)) & ((1 << writable) - 1);
    bytes[byteIndex] |= shifted << (8 - bitInByte - writable);
    position += writable;
    remaining -= writable;
  }
};

const readBits = (bytes: Uint8Array, bitOffset: number, bitWidth: number): number => {
  let remaining = bitWidth;
  let position = bitOffset;
  let value = 0;
  while (remaining > 0) {
    const byteIndex = position >>> 3;
    const bitInByte = position & 7;
    const readable = Math.min(8 - bitInByte, remaining);
    const chunk = (bytes[byteIndex] >>> (8 - bitInByte - readable)) & ((1 << readable) - 1);
    // Multiplied rather than shifted: a 32-bit width would overflow a signed shift.
    value = value * Math.pow(2, readable) + chunk;
    position += readable;
    remaining -= readable;
  }
  return value;
};

/** Bits needed to hold 0..span inclusive. Zero when every value is the same. */
const bitWidthFor = (span: number): number => {
  let width = 0;
  let remaining = span;
  while (remaining > 0) {
    width++;
    remaining = Math.floor(remaining / 2);
  }
  return width;
};

/**
 * -0 is deliberately not an integer here. It survives a float round-trip but not the subtract-the-
 * minimum arithmetic of the bit-packed path, and `Object.is` is the only way to tell it from 0.
 */
const isExactInteger = (value: number) => Number.isInteger(value) && !Object.is(value, -0);

export const encodeNumericColumn = (values: readonly number[]): Uint8Array => {
  const rowCount = values.length;

  let allIntegers = true;
  let allFloat32 = true;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (allIntegers && !isExactInteger(value)) allIntegers = false;
    // fround is exact for anything a Float32Array can hold, so this is a round-trip test, not a guess.
    if (allFloat32 && Math.fround(value) !== value) allFloat32 = false;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }

  const span = rowCount === 0 ? 0 : maximum - minimum;
  if (allIntegers && rowCount > 0 && span <= 0xffffffff) {
    const bitWidth = bitWidthFor(span);
    if (bitWidth <= MAX_BITPACKED_WIDTH) {
      const headerSize = varintSize(rowCount) + 1 + 8 + 1;
      const bytes = new Uint8Array(headerSize + packedByteLength(rowCount, bitWidth));
      let offset = writeVarint(bytes, 0, rowCount);
      bytes[offset++] = NUMERIC_ENCODING_INT_BITPACKED;
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat64(offset, minimum, true);
      offset += 8;
      bytes[offset++] = bitWidth;
      for (let row = 0; row < rowCount; row++) {
        writeBits(bytes, offset * 8 + row * bitWidth, values[row] - minimum, bitWidth);
      }
      return bytes;
    }
  }

  const useFloat32 = allFloat32 && rowCount > 0;
  const valueSize = useFloat32 ? 4 : 8;
  const bytes = new Uint8Array(varintSize(rowCount) + 1 + rowCount * valueSize);
  let offset = writeVarint(bytes, 0, rowCount);
  bytes[offset++] = useFloat32 ? NUMERIC_ENCODING_FLOAT32 : NUMERIC_ENCODING_FLOAT64;

  // DataView rather than a typed-array view: the payload starts at whatever offset the header ended
  // at, and a Float64Array cannot be created over an unaligned byte offset.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let row = 0; row < rowCount; row++) {
    if (useFloat32) view.setFloat32(offset + row * 4, values[row], true);
    else view.setFloat64(offset + row * 8, values[row], true);
  }
  return bytes;
};

/**
 * Always a Float64Array, whatever the stored encoding. Exact I64 columns use `decodeI64Column` and do
 * not pass through this numeric path; this function also preserves the legacy GUI's Number view.
 */
export const decodeNumericColumn = (bytes: Uint8Array): Float64Array => {
  const [rowCount, afterRowCount] = readVarint(bytes, 0);
  const encoding = bytes[afterRowCount];
  let offset = afterRowCount + 1;
  const values = new Float64Array(rowCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (encoding === NUMERIC_ENCODING_INT_BITPACKED) {
    const minimum = view.getFloat64(offset, true);
    offset += 8;
    const bitWidth = bytes[offset++];
    for (let row = 0; row < rowCount; row++) {
      values[row] = minimum + readBits(bytes, offset * 8 + row * bitWidth, bitWidth);
    }
    return values;
  }

  if (encoding === NUMERIC_ENCODING_FLOAT32) {
    for (let row = 0; row < rowCount; row++) values[row] = view.getFloat32(offset + row * 4, true);
    return values;
  }

  if (encoding === NUMERIC_ENCODING_FLOAT64) {
    for (let row = 0; row < rowCount; row++) values[row] = view.getFloat64(offset + row * 8, true);
    return values;
  }

  throw new Error(`Unknown numeric column encoding: ${encoding}`);
};

/**
 * Encodes one string id per row, where the id is a rank in the shared string pool.
 *
 * The distinct ids are stored once, sorted and delta-coded, and each row gets a bit-packed index into
 * that list. A column of a few hundred distinct values across ten thousand rows therefore costs about
 * a byte a row rather than three.
 */
export const encodeDictionaryColumn = (poolIdsPerRow: readonly number[]): Uint8Array => {
  const rowCount = poolIdsPerRow.length;
  const distinctIds = Array.from(new Set(poolIdsPerRow)).sort((first, second) => first - second);
  const indexByPoolId = new Map(distinctIds.map((poolId, index) => [poolId, index]));
  const bitWidth = bitWidthFor(Math.max(0, distinctIds.length - 1));

  let dictionaryBytes = 0;
  let previousId = 0;
  for (const poolId of distinctIds) {
    dictionaryBytes += varintSize(poolId - previousId);
    previousId = poolId;
  }

  const headerSize = varintSize(rowCount) + 1 + varintSize(distinctIds.length) + dictionaryBytes + 1;
  const bytes = new Uint8Array(headerSize + packedByteLength(rowCount, bitWidth));

  let offset = writeVarint(bytes, 0, rowCount);
  bytes[offset++] = ENCODING_DICTIONARY;
  offset = writeVarint(bytes, offset, distinctIds.length);
  previousId = 0;
  for (const poolId of distinctIds) {
    offset = writeVarint(bytes, offset, poolId - previousId);
    previousId = poolId;
  }
  bytes[offset++] = bitWidth;

  for (let row = 0; row < rowCount; row++) {
    writeBits(bytes, offset * 8 + row * bitWidth, indexByPoolId.get(poolIdsPerRow[row])!, bitWidth);
  }
  return bytes;
};

/**
 * Just the distinct pool ids a column holds, in ascending order, without expanding the rows.
 *
 * What makes searching cheap: a column whose dictionary shares nothing with the query can be ruled out
 * after reading a few dozen varints, and its row data never has to be touched.
 */
export const decodeDictionaryColumnIds = (bytes: Uint8Array): Uint32Array | undefined => {
  const [, afterRowCount] = readVarint(bytes, 0);
  if (bytes[afterRowCount] !== ENCODING_DICTIONARY) {
    throw new Error(`Expected a dictionary column, got encoding ${bytes[afterRowCount]}`);
  }

  let offset = afterRowCount + 1;
  const [distinctCount, afterDistinctCount] = readVarint(bytes, offset);
  offset = afterDistinctCount;

  const distinctIds = new Uint32Array(distinctCount);
  let previousId = 0;
  for (let index = 0; index < distinctCount; index++) {
    // Undefined rather than nonsense when handed a truncated read: callers pass a bounded prefix of
    // the column to avoid pulling in row data they may not need, and have to be told when it was short.
    if (offset >= bytes.length) return undefined;
    const [delta, next] = readVarint(bytes, offset);
    previousId += delta;
    distinctIds[index] = previousId;
    offset = next;
  }
  return offset <= bytes.length ? distinctIds : undefined;
};

/** One pool id per row. Resolving those to strings is the caller's job, and is worth deferring. */
export const decodeDictionaryColumn = (bytes: Uint8Array): Uint32Array => {
  const [rowCount, afterRowCount] = readVarint(bytes, 0);
  const encoding = bytes[afterRowCount];
  if (encoding !== ENCODING_DICTIONARY) {
    throw new Error(`Expected a dictionary column, got encoding ${encoding}`);
  }

  let offset = afterRowCount + 1;
  const [distinctCount, afterDistinctCount] = readVarint(bytes, offset);
  offset = afterDistinctCount;

  const distinctIds = new Uint32Array(distinctCount);
  let previousId = 0;
  for (let index = 0; index < distinctCount; index++) {
    const [delta, next] = readVarint(bytes, offset);
    previousId += delta;
    distinctIds[index] = previousId;
    offset = next;
  }

  const bitWidth = bytes[offset++];
  const poolIds = new Uint32Array(rowCount);
  for (let row = 0; row < rowCount; row++) {
    poolIds[row] = distinctIds[readBits(bytes, offset * 8 + row * bitWidth, bitWidth)];
  }
  return poolIds;
};
