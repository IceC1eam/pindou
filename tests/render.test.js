"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PindouRender: R } = require("../public/render.js");

/** 记录调用的假 2d 上下文：只关心“画了多少次”，不真的绘制。 */
function fakeCtx() {
  const calls = {};
  const count = (n) => (...a) => { calls[n] = (calls[n] || 0) + 1; return n === "createLinearGradient" ? { addColorStop() {} } : undefined; };
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : count(String(k))),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, calls };
}

const pal = [0, 1, 2].map((i) => ({ hex: ["#ff0000", "#00ff00", "#0000ff"][i], rgb: [i === 0 ? 255 : 0, i === 1 ? 255 : 0, i === 2 ? 255 : 0] }));

test("pickCrop prefers the window with the most colors", () => {
  const W = 20, H = 20, g = new Int16Array(W * H).fill(-1);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) g[y * W + x] = 0;
  g[14 * W + 14] = 1; g[13 * W + 14] = 2;
  const c = R.pickCrop(W, H, g, 8);
  assert.ok(c.x <= 14 && c.x + 8 > 14 && c.y <= 13 && c.y + 8 > 14, JSON.stringify(c));
  assert.equal(R.pickCrop(5, 5, new Int16Array(25).fill(-1), 8).w, 5);   // 比 k 小的图：取整张
});

test("every effect draws and reports the right canvas size", () => {
  const W = 4, H = 3, g = Int16Array.from([0, 0, 1, 1, 0, 2, 2, 1, -1, -1, 2, 0]);
  for (const f of R.EFFECTS) {
    const { ctx } = fakeCtx();
    const size = R.drawFused(ctx, { W, H, grid: g, palette: pal, cell: 10, effect: f.id, pad: 5 });
    assert.deepEqual(size, { width: 4 * 10 + 10, height: 3 * 10 + 10 }, f.id);
  }
});

test("melt blends only where neighbours differ; flat does not", () => {
  const W = 3, H = 1;
  const same = Int16Array.from([0, 0, 0]), differ = Int16Array.from([0, 1, 0]);
  const run = (g, effect) => { const { ctx, calls } = fakeCtx(); R.drawFused(ctx, { W, H, grid: g, palette: pal, cell: 10, effect, pad: 0 }); return calls.createLinearGradient || 0; };
  assert.equal(run(same, "melt"), 0);
  assert.equal(run(differ, "melt"), 2);       // 两条交界
  assert.equal(run(differ, "flat"), 0);
});

test("crop only draws the requested cells", () => {
  const W = 6, H = 6, g = new Int16Array(W * H).fill(0);
  const { ctx, calls } = fakeCtx();
  const size = R.drawFused(ctx, { W, H, grid: g, palette: pal, cell: 8, effect: "melt", pad: 2, crop: { x: 1, y: 1, w: 2, h: 2 } });
  assert.deepEqual(size, { width: 20, height: 20 });
  assert.equal(calls.fillRect, 1 + 4);        // 背景 + 4 格
});
