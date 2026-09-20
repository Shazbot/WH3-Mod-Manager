import { TextDecoder } from "node:util";

export const WH3_ASSET_HOST_PROTOCOL_VERSION = 2;
export const WH3_ASSET_HOST_MAX_FRAME_BYTES = 1024 * 1024;
const FRAME_HEADER_BYTES = 4;

export type Wh3AssetHostProtocolErrorCode =
  | "EmptyFrame"
  | "FrameTooLarge"
  | "TruncatedFrame"
  | "InvalidUtf8"
  | "MalformedJson"
  | "InvalidJsonValue";

export class Wh3AssetHostProtocolError extends Error {
  readonly code: Wh3AssetHostProtocolErrorCode;

  constructor(code: Wh3AssetHostProtocolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Wh3AssetHostProtocolError";
    this.code = code;
  }
}

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

const protocolError = (
  code: Wh3AssetHostProtocolErrorCode,
  message: string,
  cause?: unknown,
): Wh3AssetHostProtocolError =>
  new Wh3AssetHostProtocolError(code, message, cause === undefined ? undefined : { cause });

/**
 * Encodes one WH3AssetHost JSON message as an unsigned little-endian payload
 * length followed by UTF-8 JSON bytes.
 */
export const encodeWh3AssetHostFrame = (value: unknown): Buffer => {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw protocolError("InvalidJsonValue", "The value could not be serialized as JSON.", error);
  }

  if (json === undefined) {
    throw protocolError("InvalidJsonValue", "The value could not be serialized as a JSON payload.");
  }

  const payload = Buffer.from(json, "utf8");
  if (payload.length === 0) {
    throw protocolError("EmptyFrame", "A frame payload must contain at least one byte.");
  }
  if (payload.length > WH3_ASSET_HOST_MAX_FRAME_BYTES) {
    throw protocolError(
      "FrameTooLarge",
      `The frame payload exceeds the ${WH3_ASSET_HOST_MAX_FRAME_BYTES}-byte limit.`,
    );
  }

  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, FRAME_HEADER_BYTES);
  return frame;
};

/**
 * Incremental decoder for the WH3AssetHost byte-mode named-pipe protocol.
 * A single push may contain a partial frame, one frame, or several frames.
 */
export class Wh3AssetHostFrameDecoder {
  private buffered = Buffer.alloc(0);

  get bufferedByteLength(): number {
    return this.buffered.length;
  }

  push(chunk: Buffer | Uint8Array): unknown[] {
    if (chunk.byteLength === 0) return [];

    const incoming = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.buffered =
      this.buffered.length === 0
        ? Buffer.from(incoming)
        : Buffer.concat([this.buffered, incoming], this.buffered.length + incoming.length);

    const messages: unknown[] = [];
    let offset = 0;

    while (this.buffered.length - offset >= FRAME_HEADER_BYTES) {
      const payloadLength = this.buffered.readUInt32LE(offset);
      if (payloadLength === 0) {
        throw protocolError("EmptyFrame", "A frame payload must contain at least one byte.");
      }
      if (payloadLength > WH3_ASSET_HOST_MAX_FRAME_BYTES) {
        throw protocolError(
          "FrameTooLarge",
          `The frame payload exceeds the ${WH3_ASSET_HOST_MAX_FRAME_BYTES}-byte limit.`,
        );
      }

      const frameLength = FRAME_HEADER_BYTES + payloadLength;
      if (this.buffered.length - offset < frameLength) break;

      const payload = this.buffered.subarray(offset + FRAME_HEADER_BYTES, offset + frameLength);
      let json: string;
      try {
        json = strictUtf8Decoder.decode(payload);
      } catch (error) {
        throw protocolError("InvalidUtf8", "The frame payload was not valid UTF-8.", error);
      }

      try {
        messages.push(JSON.parse(json));
      } catch (error) {
        throw protocolError("MalformedJson", "The frame payload was not valid JSON.", error);
      }

      offset += frameLength;
    }

    if (offset > 0) {
      this.buffered = offset === this.buffered.length ? Buffer.alloc(0) : Buffer.from(this.buffered.subarray(offset));
    }

    return messages;
  }

  /**
   * Call when the pipe reaches EOF. Any buffered bytes mean the peer closed in
   * the middle of a frame and must be treated as a protocol failure.
   */
  finish(): void {
    if (this.buffered.length !== 0) {
      throw protocolError("TruncatedFrame", "The pipe ended before the current frame was complete.");
    }
  }

  reset(): void {
    this.buffered = Buffer.alloc(0);
  }
}
