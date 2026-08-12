export class BinaryReader {
  private readonly buffer: Buffer;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  get length(): number {
    return this.buffer.length;
  }

  readUInt16LE(offset: number): number {
    this.assertReadable(offset, 2);
    return this.buffer.readUInt16LE(offset);
  }

  readUInt32LE(offset: number): number {
    this.assertReadable(offset, 4);
    return this.buffer.readUInt32LE(offset);
  }

  readSlice(offset: number, length: number): Buffer {
    this.assertReadable(offset, length);
    return this.buffer.subarray(offset, offset + length);
  }

  private assertReadable(offset: number, length: number): void {
    if (offset < 0 || length < 0 || offset + length > this.buffer.length) {
      throw new Error(
        `Out-of-bounds read at offset ${offset} for ${length} bytes (buffer length ${this.buffer.length})`
      );
    }
  }
}
