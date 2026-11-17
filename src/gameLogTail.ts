import * as fs from "fs";

/** Decodes as UTF-8, falling back to latin1 when the bytes are not valid UTF-8. */
export const decodeLogBytes = (buffer: Buffer): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    return buffer.toString("latin1");
  }
};

const splitLines = (text: string) => text.split(/\r?\n/);

export type GameLogTailOptions = {
  onAppend: (lines: string[]) => void;
  /** Called after truncation with the file's full contents, instead of onAppend. */
  onReset?: (lines: string[]) => void;
  intervalMs?: number;
};

/**
 * Follows one growing log file. The game holds the file open on Windows, so fs events are
 * unreliable and the size is polled instead. Only complete lines are emitted; a trailing partial
 * line is left unread (the offset stops at the last newline) until its newline arrives.
 */
export class GameLogTail {
  private offset = 0;
  private timer: NodeJS.Timeout | undefined;
  private isReading = false;
  private isClosed = false;

  constructor(
    private readonly filePath: string,
    private readonly options: GameLogTailOptions,
  ) {}

  /** Reads the whole file and returns its complete lines, then starts following it. */
  async open(): Promise<string[]> {
    const lines = await this.readFrom(0);
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs ?? 500);
    return lines;
  }

  close() {
    this.isClosed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async readFrom(start: number): Promise<string[]> {
    this.offset = start;
    return this.readNew();
  }

  private async readNew(): Promise<string[]> {
    const handle = await fs.promises.open(this.filePath, "r");
    try {
      const { size } = await handle.stat();
      if (size <= this.offset) return [];
      const buffer = Buffer.alloc(size - this.offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
      // Cut at the last newline byte so a multi-byte character is never split between reads.
      const chunk = buffer.subarray(0, bytesRead);
      const lastNewline = chunk.lastIndexOf(0x0a);
      if (lastNewline === -1) {
        // No complete line yet; leave the offset so the next poll re-reads the partial line.
        return [];
      }
      const complete = chunk.subarray(0, lastNewline + 1);
      this.offset += complete.length;
      const text = decodeLogBytes(complete);
      const lines = splitLines(text);
      lines.pop(); // empty string after the final newline
      return lines;
    } finally {
      await handle.close();
    }
  }

  private async poll() {
    if (this.isReading || this.isClosed) return;
    this.isReading = true;
    try {
      const { size } = await fs.promises.stat(this.filePath);
      if (size < this.offset) {
        const lines = await this.readFrom(0);
        if (!this.isClosed) (this.options.onReset ?? this.options.onAppend)(lines);
        return;
      }
      if (size === this.offset) return;
      const lines = await this.readNew();
      if (!this.isClosed && lines.length > 0) this.options.onAppend(lines);
    } catch {
      // The file may be mid-rotation or briefly locked; try again on the next tick.
    } finally {
      this.isReading = false;
    }
  }
}
