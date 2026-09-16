import { describe, expect, it } from "vitest";
import {
  WH3_ASSET_HOST_MAX_FRAME_BYTES,
  Wh3AssetHostFrameDecoder,
  Wh3AssetHostProtocolError,
  encodeWh3AssetHostFrame,
} from "../src/wh3AssetHostProtocol";

const rawFrame = (payload: Buffer): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
};

const expectProtocolError = (run: () => unknown, code: Wh3AssetHostProtocolError["code"]) => {
  try {
    run();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(Wh3AssetHostProtocolError);
    expect(error).toMatchObject({ code });
  }
};

describe("WH3AssetHost frame protocol", () => {
  it("encodes the payload length as a four-byte little-endian header", () => {
    const message = { protocolVersion: 1, requestId: "abc", command: "hello" };
    const frame = encodeWh3AssetHostFrame(message);
    const payload = Buffer.from(JSON.stringify(message), "utf8");

    expect(frame.readUInt32LE(0)).toBe(payload.length);
    expect(frame.subarray(4)).toEqual(payload);
  });

  it("buffers a split header until all four bytes arrive", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const frame = encodeWh3AssetHostFrame({ requestId: "1" });

    expect(decoder.push(frame.subarray(0, 2))).toEqual([]);
    expect(decoder.bufferedByteLength).toBe(2);
    expect(decoder.push(frame.subarray(2))).toEqual([{ requestId: "1" }]);
    expect(decoder.bufferedByteLength).toBe(0);
  });

  it("buffers a split payload until the entire frame arrives", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const frame = encodeWh3AssetHostFrame({ result: { hostVersion: "1.2.3" } });
    const splitAt = frame.length - 3;

    expect(decoder.push(frame.subarray(0, splitAt))).toEqual([]);
    expect(decoder.bufferedByteLength).toBe(splitAt);
    expect(decoder.push(frame.subarray(splitAt))).toEqual([{ result: { hostVersion: "1.2.3" } }]);
  });

  it("decodes several complete frames from one pipe chunk", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const chunk = Buffer.concat([
      encodeWh3AssetHostFrame({ requestId: "1", success: true }),
      encodeWh3AssetHostFrame({ requestId: "2", success: false }),
      encodeWh3AssetHostFrame({ requestId: "3", result: null }),
    ]);

    expect(decoder.push(chunk)).toEqual([
      { requestId: "1", success: true },
      { requestId: "2", success: false },
      { requestId: "3", result: null },
    ]);
    expect(decoder.bufferedByteLength).toBe(0);
  });

  it("returns complete frames while retaining a trailing partial frame", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const first = encodeWh3AssetHostFrame({ requestId: "1" });
    const second = encodeWh3AssetHostFrame({ requestId: "2" });
    const secondPrefixLength = 7;

    expect(decoder.push(Buffer.concat([first, second.subarray(0, secondPrefixLength)]))).toEqual([
      { requestId: "1" },
    ]);
    expect(decoder.bufferedByteLength).toBe(secondPrefixLength);
    expect(decoder.push(second.subarray(secondPrefixLength))).toEqual([{ requestId: "2" }]);
  });

  it("accepts Uint8Array chunks as produced by generic stream wrappers", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const frame = encodeWh3AssetHostFrame({ command: "hello" });
    const chunk = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);

    expect(decoder.push(chunk)).toEqual([{ command: "hello" }]);
  });

  it("rejects zero-length frames", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    expectProtocolError(() => decoder.push(Buffer.alloc(4)), "EmptyFrame");
  });

  it("rejects a declared payload above the one-megabyte protocol limit before buffering it", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(WH3_ASSET_HOST_MAX_FRAME_BYTES + 1, 0);

    expectProtocolError(() => decoder.push(header), "FrameTooLarge");
  });

  it("rejects values whose JSON representation exceeds the protocol limit", () => {
    const value = "x".repeat(WH3_ASSET_HOST_MAX_FRAME_BYTES + 1);
    expectProtocolError(() => encodeWh3AssetHostFrame(value), "FrameTooLarge");
  });

  it("rejects values that JSON.stringify cannot serialize into a payload", () => {
    expectProtocolError(() => encodeWh3AssetHostFrame(undefined), "InvalidJsonValue");
    expectProtocolError(() => encodeWh3AssetHostFrame(1n), "InvalidJsonValue");
  });

  it("rejects invalid UTF-8 instead of accepting replacement characters", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const frame = rawFrame(Buffer.from([0xc3, 0x28]));

    expectProtocolError(() => decoder.push(frame), "InvalidUtf8");
  });

  it("rejects malformed JSON payloads", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const frame = rawFrame(Buffer.from("{", "utf8"));

    expectProtocolError(() => decoder.push(frame), "MalformedJson");
  });

  it("reports a truncated header when the pipe ends", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    decoder.push(Buffer.from([1, 2, 3]));

    expectProtocolError(() => decoder.finish(), "TruncatedFrame");
  });

  it("reports a truncated payload when the pipe ends", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    const frame = encodeWh3AssetHostFrame({ requestId: "partial" });
    decoder.push(frame.subarray(0, frame.length - 1));

    expectProtocolError(() => decoder.finish(), "TruncatedFrame");
  });

  it("finishes cleanly when no bytes remain buffered", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    decoder.push(encodeWh3AssetHostFrame({ requestId: "complete" }));

    expect(() => decoder.finish()).not.toThrow();
  });

  it("can be reset after abandoning a partial frame", () => {
    const decoder = new Wh3AssetHostFrameDecoder();
    decoder.push(Buffer.from([1, 2]));
    decoder.reset();

    expect(decoder.bufferedByteLength).toBe(0);
    expect(decoder.push(encodeWh3AssetHostFrame({ requestId: "next" }))).toEqual([{ requestId: "next" }]);
  });
});
