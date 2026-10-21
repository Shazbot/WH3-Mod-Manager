import { describe, expect, it } from "vitest";
import { parseTwAnimSkeleton } from "../src/visuals/twAnimSkeleton";

const writer = () => {
  const bytes: number[] = [];
  const view = new DataView(new ArrayBuffer(4));
  return {
    bytes,
    u32: (value: number) => {
      view.setUint32(0, value, true);
      bytes.push(...new Uint8Array(view.buffer));
    },
    i32: (value: number) => {
      view.setInt32(0, value, true);
      bytes.push(...new Uint8Array(view.buffer));
    },
    f32: (value: number) => {
      view.setFloat32(0, value, true);
      bytes.push(...new Uint8Array(view.buffer));
    },
    i16: (value: number) => {
      view.setInt16(0, value, true);
      bytes.push(...new Uint8Array(view.buffer.slice(0, 2)));
    },
    i8: (value: number) => bytes.push(value & 0xff),
    str: function (text: string) {
      this.i16(text.length);
      for (const char of text) bytes.push(char.charCodeAt(0));
    },
  };
};

describe("parseTwAnimSkeleton", () => {
  it("reads bones and the static frame of a v8 animation", () => {
    const w = writer();
    w.u32(8);
    w.u32(1);
    w.f32(20);
    w.str("skel");
    w.u32(0);
    w.f32(0.1);
    w.u32(2);
    w.str("root");
    w.i32(-1);
    w.str("ap_crewposition_1");
    w.i32(0);
    w.u32(0);
    w.u32(1);
    w.i8(-12);
    w.i8(-12);
    w.i8(-8);
    w.i8(-8);
    w.u32(0);
    w.u32(0);
    w.u32(2);
    w.u32(2);
    for (const value of [0, 0, 1, 1, 2, 3]) w.f32(value);
    for (const value of [0, 0, 0, 32767, 0, 32767, 0, 0]) w.i16(value);
    w.u32(0);
    w.u32(0);
    w.u32(0);

    const bones = parseTwAnimSkeleton(new Uint8Array(w.bytes));

    expect(bones.map((bone) => [bone.name, bone.parent])).toEqual([
      ["root", -1],
      ["ap_crewposition_1", 0],
    ]);
    expect(bones[0].translation).toEqual([0, 0, 1]);
    expect(bones[1].translation).toEqual([1, 2, 3]);
    expect(bones[0].rotation).toEqual([0, 0, 0, 1]);
    expect(bones[1].rotation).toEqual([0, 1, 0, 0]);
  });

  it("rejects unsupported versions", () => {
    const w = writer();
    w.u32(3);
    expect(() => parseTwAnimSkeleton(new Uint8Array(w.bytes))).toThrow(/version/);
  });
});
