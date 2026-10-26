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

test("裁剪框四边和四角都可拖动；锁定比例时边缘仍能缩放", () => {
  const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  const east = Ref.resizeCrop(r, "e", { x: 0.8, y: 0.4 }, 0, 100, 100);
  assert.ok(Math.abs(east.x - 0.2) < 1e-9 && Math.abs(east.w - 0.6) < 1e-9 && Math.abs(east.h - 0.4) < 1e-9);
  const west = Ref.resizeCrop(r, "w", { x: 0.1, y: 0.4 }, 0, 100, 100);
  assert.ok(Math.abs(west.x - 0.1) < 1e-9 && Math.abs(west.x + west.w - 0.6) < 1e-9);
  const north = Ref.resizeCrop(r, "n", { x: 0.4, y: 0.1 }, 0, 100, 100);
  assert.ok(Math.abs(north.y - 0.1) < 1e-9 && Math.abs(north.y + north.h - 0.6) < 1e-9);
  const corner = Ref.resizeCrop(r, "se", { x: 0.7, y: 0.7 }, 1, 100, 100);
  assert.ok(Math.abs(corner.w - 0.5) < 1e-9 && Math.abs(corner.h - 0.5) < 1e-9);
  const lockedEdge = Ref.resizeCrop(r, "e", { x: 0.8, y: 0.4 }, 1, 100, 100);
  assert.ok(Math.abs(lockedEdge.w - lockedEdge.h) < 1e-9);
  assert.ok(Math.abs(lockedEdge.y + lockedEdge.h / 2 - 0.4) < 1e-9);
  for (const handle of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    const resized = Ref.resizeCrop(r, handle, { x: 2, y: -1 }, 1, 100, 100);
    assert.ok(resized.x >= -1e-9 && resized.y >= -1e-9 && resized.x + resized.w <= 1 + 1e-9 && resized.y + resized.h <= 1 + 1e-9, handle);
    assert.ok(Math.abs(resized.w - resized.h) < 1e-9, handle);
  }
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
