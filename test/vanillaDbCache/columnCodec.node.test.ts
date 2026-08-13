import { describe, expect, it } from "vitest";

import {
  NUMERIC_ENCODING_FLOAT32,
  NUMERIC_ENCODING_FLOAT64,
  NUMERIC_ENCODING_INT_BITPACKED,
  decodeDictionaryColumn,
  decodeNumericColumn,
  encodeDictionaryColumn,
  encodeNumericColumn,
} from "../../src/vanillaDbCache/columnCodec";

/** The encoding byte, which sits after a row-count varint of however many bytes that took. */
const encodingOf = (bytes: Uint8Array) => {
  let offset = 0;
  while ((bytes[offset] & 0x80) !== 0) offset++;
  return bytes[offset + 1];
};

const roundTripNumeric = (values: number[]) => Array.from(decodeNumericColumn(encodeNumericColumn(values)));

describe("numeric column codec", () => {
  it("round trips booleans, which are raw bytes rather than bits", () => {
    // readPack stores whatever byte was there, so a stray value has to survive as itself.
    const values = [0, 1, 1, 0, 1, 7, 255];

    expect(roundTripNumeric(values)).toEqual(values);
  });

  it("bit packs a boolean column down to a bit a row", () => {
    const values = Array.from({ length: 800 }, (_unused, index) => index % 2);
    const bytes = encodeNumericColumn(values);

    expect(encodingOf(bytes)).toBe(NUMERIC_ENCODING_INT_BITPACKED);
    expect(bytes.length).toBeLessThan(800 / 8 + 20);
  });

  it("costs almost nothing for a column where every value is the same", () => {
    const bytes = encodeNumericColumn(new Array(10_000).fill(0));

    expect(bytes.length).toBeLessThan(20);
    expect(Array.from(decodeNumericColumn(bytes))).toEqual(new Array(10_000).fill(0));
  });

  it("round trips negative integers by rebasing on the minimum", () => {
    const values = [-1, -1, 0, 5, -32768, 32767];

    expect(roundTripNumeric(values)).toEqual(values);
    expect(encodingOf(encodeNumericColumn(values))).toBe(NUMERIC_ENCODING_INT_BITPACKED);
  });

  it("round trips the full signed 32 bit range", () => {
    const values = [-2147483648, 0, 2147483647];

    expect(roundTripNumeric(values)).toEqual(values);
  });

  it("round trips integers whose span is too wide to bit pack", () => {
    // Powers of two are exactly float32 representable, so these land on the float path rather than
    // float64 - narrower, and still exact, which is the only thing the encoding has to guarantee.
    const values = [0, 2 ** 40, -(2 ** 40)];

    expect(roundTripNumeric(values)).toEqual(values);
    expect(encodingOf(encodeNumericColumn(values))).not.toBe(NUMERIC_ENCODING_INT_BITPACKED);
  });

  it("uses float64 for a wide integer no float32 can hold", () => {
    const values = [0, Number.MAX_SAFE_INTEGER];

    expect(roundTripNumeric(values)).toEqual(values);
    expect(encodingOf(encodeNumericColumn(values))).toBe(NUMERIC_ENCODING_FLOAT64);
  });

  it("round trips I64 values that readPack has already narrowed to a double", () => {
    const values = [0, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER];

    expect(roundTripNumeric(values)).toEqual(values);
  });

  it("stores F32 values as float32 and returns them unchanged", () => {
    // These are the doubles readFloatLE produces, so they are exactly float32 representable.
    const values = [0.5, -0.25, Math.fround(3.14159), Math.fround(1e-8)];
    const bytes = encodeNumericColumn(values);

    expect(encodingOf(bytes)).toBe(NUMERIC_ENCODING_FLOAT32);
    expect(Array.from(decodeNumericColumn(bytes))).toEqual(values);
  });

  it("falls back to float64 for a value float32 cannot hold exactly", () => {
    const values = [0.5, 0.1];
    const bytes = encodeNumericColumn(values);

    expect(encodingOf(bytes)).toBe(NUMERIC_ENCODING_FLOAT64);
    expect(Array.from(decodeNumericColumn(bytes))).toEqual(values);
  });

  it("keeps negative zero distinct from zero", () => {
    // The bit-packed path would lose the sign through its subtract-the-minimum arithmetic.
    const decoded = decodeNumericColumn(encodeNumericColumn([-0, 0, 1]));

    expect(Object.is(decoded[0], -0)).toBe(true);
    expect(Object.is(decoded[1], 0)).toBe(true);
  });

  it("round trips special float values", () => {
    const decoded = decodeNumericColumn(encodeNumericColumn([Number.NaN, Infinity, -Infinity, 1.5]));

    expect(Number.isNaN(decoded[0])).toBe(true);
    expect(decoded[1]).toBe(Infinity);
    expect(decoded[2]).toBe(-Infinity);
    expect(decoded[3]).toBe(1.5);
  });

  it("handles an empty column", () => {
    expect(roundTripNumeric([])).toEqual([]);
  });

  it("round trips at every bit width up to 32", () => {
    // Bit packing straddles byte boundaries differently at each width, so each one is its own case.
    for (let bitWidth = 1; bitWidth <= 32; bitWidth++) {
      const maximum = bitWidth === 32 ? 0xffffffff : 2 ** bitWidth - 1;
      const values = [0, 1, Math.floor(maximum / 2), maximum, 0, maximum];

      expect(roundTripNumeric(values), `bit width ${bitWidth}`).toEqual(values);
    }
  });

  it("round trips a long run with values crossing byte boundaries", () => {
    const values = Array.from({ length: 1000 }, (_unused, index) => (index * 7919) % 1000);

    expect(roundTripNumeric(values)).toEqual(values);
  });
});

describe("dictionary column codec", () => {
  const roundTripDictionary = (poolIds: number[]) =>
    Array.from(decodeDictionaryColumn(encodeDictionaryColumn(poolIds)));

  it("round trips pool ids", () => {
    const poolIds = [5, 5, 900, 1, 5, 900];

    expect(roundTripDictionary(poolIds)).toEqual(poolIds);
  });

  it("stores a repeated value once, so a low cardinality column stays small", () => {
    const poolIds = Array.from({ length: 10_000 }, (_unused, index) => 300_000 + (index % 4));
    const bytes = encodeDictionaryColumn(poolIds);

    // Four distinct ids means two bits a row, rather than three bytes a row stored raw.
    expect(bytes.length).toBeLessThan(10_000 / 4 + 40);
    expect(Array.from(decodeDictionaryColumn(bytes))).toEqual(poolIds);
  });

  it("handles a column where every row is the same value", () => {
    const poolIds = new Array(500).fill(42);
    const bytes = encodeDictionaryColumn(poolIds);

    expect(bytes.length).toBeLessThan(20);
    expect(Array.from(decodeDictionaryColumn(bytes))).toEqual(poolIds);
  });

  it("handles a column where every row differs", () => {
    const poolIds = Array.from({ length: 500 }, (_unused, index) => index * 613);

    expect(roundTripDictionary(poolIds)).toEqual(poolIds);
  });

  it("handles pool ids near the top of the range", () => {
    const poolIds = [0, 4_294_967_295, 1];

    expect(roundTripDictionary(poolIds)).toEqual(poolIds);
  });

  it("handles an empty column", () => {
    expect(roundTripDictionary([])).toEqual([]);
  });

  it("refuses to decode a numeric column as a dictionary", () => {
    // The encoding byte is the only thing separating them, and misreading one as the other would
    // produce plausible nonsense rather than an error.
    expect(() => decodeDictionaryColumn(encodeNumericColumn([1, 2, 3]))).toThrow();
  });
});
