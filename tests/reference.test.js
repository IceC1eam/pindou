"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Ref = require("../public/reference.js").PindouReference;

test("裁剪选区可自由调整，也能按图像像素比例锁定并保持在边界内", () => {
  const free = Ref.cropRect({ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.5 }, 0, 200, 100);
  assert.ok(Math.abs(free.w - 0.7) < 1e-9);
  assert.ok(Math.abs(free.h - 0.3) < 1e-9);
  const locked = Ref.cropRect({ x: 0.1, y: 0.1 }, { x: 0.7, y: 0.7 }, 1, 200, 100);
  assert.ok(Math.abs(locked.w * 200 - locked.h * 100) < 1e-9);
  assert.ok(locked.x + locked.w <= 1 && locked.y + locked.h <= 1);
});

test("边缘色度键只去除边界连通的白色，保留被其他颜色包围的白色", () => {
  const W = 5, H = 5, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    const white = x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x === 2 && y === 2);
    data[k] = data[k + 1] = data[k + 2] = white ? 255 : 0;
    data[k + 3] = 255;
  }
  const out = Ref.edgeChromaKey({ width: W, height: H, data }, "#ffffff", 30);
  assert.equal(out.data[3], 0);
  assert.equal(out.data[(2 * W + 2) * 4 + 3], 255);
  assert.equal(out.data[(1 * W + 1) * 4 + 3], 255);
  assert.equal(data[3], 255); // 不改原图，容差可反复调整
});

test("容差与边缘主色支持偏灰的白边", () => {
  const data = Uint8ClampedArray.from([240, 240, 240, 255, 20, 20, 20, 255]);
  const image = { width: 2, height: 1, data };
  assert.ok(Ref.edgeChromaKey(image, "#ffffff", 10).data[3] > 0);
  assert.equal(Ref.edgeChromaKey(image, "#ffffff", 20).data[3], 0);
  const mostlyBlue = { width: 4, height: 1, data: Uint8ClampedArray.from([
    10, 20, 240, 255, 10, 20, 240, 255, 10, 20, 240, 255, 255, 255, 255, 255,
  ]) };
  assert.equal(Ref.dominantEdgeColor(mostlyBlue), "#0a14f0");
});
