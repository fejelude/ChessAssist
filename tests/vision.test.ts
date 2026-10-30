import { describe, it, expect } from "vitest";
import {
  checkerScore,
  locateBoard,
  recognize,
  type Pixels,
} from "../src/recognition/vision";
function image(): Pixels {
  const width = 480,
    height = 400,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = x >= 64 && x < 384 && y >= 40 && y < 360,
        light =
          (Math.floor((x - 64) / 40) + Math.floor((y - 40) / 40)) % 2 === 0;
      const rgb = inside
        ? light
          ? [225, 220, 205]
          : [115, 142, 119]
        : [18, 24, 21];
      const i = (y * width + x) * 4;
      data.set([...rgb, 255], i);
    }
  return { width, height, data };
}
describe("visual detection", () => {
  it("finds an axis-aligned checkerboard without a site-specific selector", () => {
    const im = image(),
      b = locateBoard(im);
    expect(b).toBeDefined();
    expect(b!.x).toBeCloseTo(64, 0);
    expect(b!.y).toBeCloseTo(40, 0);
    expect(b!.width).toBe(320);
  });
  it("scores real checker patterns and rejects uniform backgrounds", () => {
    const im = image();
    expect(checkerScore(im, { x: 64, y: 40, width: 320, height: 320 })).toBe(1);
    im.data.fill(100);
    expect(locateBoard(im)).toBeUndefined();
  });
  it("does not invent identities for unfamiliar occupied squares", () => {
    const im = image();
    for (let y = 52; y < 70; y++)
      for (let x = 75; x < 92; x++) {
        const i = (y * im.width + x) * 4;
        im.data.set([10, 10, 10, 255], i);
      }
    const r = recognize(im, { x: 64, y: 40, width: 320, height: 320 }, []);
    expect(r.cells[0].empty).toBe(false);
    expect(r.cells[0].code).toBeUndefined();
    expect(r.issues).toHaveLength(1);
    expect(r.cells[1].empty).toBe(true);
  });
});
