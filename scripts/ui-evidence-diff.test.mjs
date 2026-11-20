import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { compareImages } from "./ui-evidence-diff.mjs";

const DARK = [17, 17, 19];

function view() {
  const png = new PNG({ width: 40, height: 20 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...DARK, 255], i);
  return png;
}

function withRow(png, y, shift) {
  const out = new PNG({ width: png.width, height: png.height });
  png.data.copy(out.data);
  for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    for (let c = 0; c < 3; c++) out.data[i + c] = png.data[i + c] + shift;
  }
  return out;
}

void test("compositing dither below the threshold is unchanged", () => {
  assert.equal(compareImages(view(), withRow(view(), 5, 6)).changedPixels, 0);
});

void test("a 1px border colour change is detected", () => {
  assert.equal(compareImages(view(), withRow(view(), 5, 20)).changedPixels, 40);
});

void test("the before and after panels keep their colour", () => {
  const before = view();
  const after = withRow(view(), 5, 20);
  const result = compareImages(before, after);
  assert.deepEqual([...result.before.subarray(0, 4)], [...DARK, 255]);
  assert.deepEqual(
    [...result.after.subarray(5 * 40 * 4, 5 * 40 * 4 + 3)],
    DARK.map((v) => v + 20),
  );
});
