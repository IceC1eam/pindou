"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PindouRender: R } = require("../public/render.js");
const { PindouScene: Scene } = require("../public/scene.js");

/** 记录调用的假 2d 上下文：只关心“画了多少次”，不真的绘制。 */
function fakeCtx() {
  const calls = {};
  const count = (n) => (...a) => { calls[n] = (calls[n] || 0) + 1; return /^create(Linear|Radial)Gradient$/.test(n) ? { addColorStop() {} } : undefined; };
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

test("烫法列表：正常烫、毛巾烫、澡巾烫等社区常见做法都在", () => {
  const names = [...R.EFFECTS.map((f) => f.name)];
  for (const n of ["有孔烫", "正常烫", "毛巾烫", "澡巾烫", "编织烫", "格纹烫", "格利特烫", "亮面烫"]) assert.ok(names.includes(n), n);
  assert.equal(new Set(R.EFFECTS.map((f) => f.id)).size, R.EFFECTS.length);
  assert.ok(R.EFFECTS.every((f) => f.note.length > 8));
});

const fakeCanvas = (made) => () => { made.push(1); const { ctx } = fakeCtx(); return { width: 0, height: 0, getContext: () => ctx }; };
const sample = () => ({ W: 4, H: 3, grid: Int16Array.from([0, 0, 1, 1, 0, 2, 2, 1, -1, -1, 2, 0]), palette: pal });

test("every effect draws and reports the right canvas size", () => {
  for (const f of R.EFFECTS) {
    const { ctx } = fakeCtx();
    const size = R.drawFused(ctx, { ...sample(), cell: 10, effect: f.id, pad: 5, makeCanvas: fakeCanvas([]) });
    assert.deepEqual(size, { width: 4 * 10 + 10, height: 3 * 10 + 10 }, f.id);
  }
});

test("垫材类烫法（毛巾/澡巾/编织/格纹/格利特）用纹理瓦片并只在豆子上叠加；平烫、有孔烫不用", () => {
  for (const id of ["towel", "loofah", "weave", "lattice", "glitter"]) {
    const { ctx, calls } = fakeCtx(), made = [];
    R.drawFused(ctx, { ...sample(), cell: 10, effect: id, pad: 5, makeCanvas: fakeCanvas(made) });
    assert.equal(calls.createPattern, 1, id);
    assert.equal(calls.clip, 1, id);                       // 裁剪到有豆子的格子
  }
  for (const id of ["holes", "flat"]) {
    const { ctx, calls } = fakeCtx();
    R.drawFused(ctx, { ...sample(), cell: 10, effect: id, pad: 5, makeCanvas: fakeCanvas([]) });
    assert.equal(calls.createPattern, undefined, id);
    assert.equal(calls.clip, undefined, id);
  }
  const { ctx, calls } = fakeCtx();
  R.drawFused(ctx, { ...sample(), cell: 10, effect: "gloss", pad: 5, makeCanvas: fakeCanvas([]) });
  assert.equal(calls.createPattern, undefined);             // 亮面只叠一道反光带，不要瓦片
  assert.equal(calls.clip, 1);
});

test("纹理瓦片按（烫法、格子大小）缓存，重绘不会重新生成", () => {
  const made = [];
  for (let k = 0; k < 3; k++) R.drawFused(fakeCtx().ctx, { ...sample(), cell: 13, effect: "weave", pad: 0, makeCanvas: fakeCanvas(made) });
  assert.equal(made.length, 1);
  R.drawFused(fakeCtx().ctx, { ...sample(), cell: 14, effect: "weave", pad: 0, makeCanvas: fakeCanvas(made) });
  assert.equal(made.length, 2);                             // 格子大小变了才重新做
});

test("没有离屏画布可用时（如 Node），带纹理的烫法也能画，只是没有纹理", () => {
  const { ctx, calls } = fakeCtx();
  R.drawFused(ctx, { ...sample(), cell: 10, effect: "towel", pad: 0 });
  assert.equal(calls.createPattern, undefined);
});

test("crop only draws the requested cells", () => {
  const W = 6, H = 6, g = new Int16Array(W * H).fill(0);
  const { ctx, calls } = fakeCtx();
  const size = R.drawFused(ctx, { W, H, grid: g, palette: pal, cell: 8, effect: "loofah", pad: 2, crop: { x: 1, y: 1, w: 2, h: 2 } });
  assert.deepEqual(size, { width: 20, height: 20 });
  assert.equal(calls.fillRect, 1 + 4);        // 背景 + 4 格（没有离屏画布，不画纹理）
});

test("透明的成品贴图只画豆子，桌面场景在正面和侧面采用不同投影", () => {
  const { ctx: transparent, calls: transparentCalls } = fakeCtx();
  R.drawFused(transparent, { ...sample(), cell: 10, effect: "flat", pad: 0, transparent: true });
  assert.equal(transparentCalls.fillRect, 10); // 10 颗豆子，没有背景矩形

  const transforms = [];
  const texture = { width: 40, height: 30 };
  for (const angle of [0, 1.18]) {
    const { ctx, calls } = fakeCtx();
    ctx.transform = (...args) => transforms.push(args);
    Scene.drawScene(ctx, { ...sample(), texture, width: 640, height: 360, angle, elevation: 0.7 });
    assert.equal(calls.drawImage, 2); // 成品轮廓投影 + 正面贴图
    assert.ok(calls.fill > 2);        // 桌面和外露侧壁
  }
  assert.notDeepEqual(transforms[0].slice(0, 4), transforms[2].slice(0, 4));
});
