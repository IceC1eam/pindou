const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../public/quantize.js");
const { palettes } = require("../public/palettes.js");

const pal = C.makePalette([
  { code: "A", name: "黑", hex: "#000000" },
  { code: "B", name: "白", hex: "#FFFFFF" },
  { code: "C", name: "红", hex: "#FF0000" },
]);
const px = (...cells) => Uint8ClampedArray.from(cells.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));

test("Lab：白 L≈100，黑 L≈0，灰居中", () => {
  assert.ok(Math.abs(C.srgbToLab(255, 255, 255)[0] - 100) < 0.5);
  assert.ok(C.srgbToLab(0, 0, 0)[0] < 0.5);
  const mid = C.srgbToLab(119, 119, 119)[0];
  assert.ok(mid > 45 && mid < 55);
});

test("每个像素映射到最近的色板颜色", () => {
  const { grid } = C.quantize(px([10, 10, 10], [250, 250, 250], [230, 20, 20]), 3, 1, pal);
  assert.deepEqual(Array.from(grid), [0, 1, 2]);
});

test("透明像素不放豆，且不影响统计", () => {
  const { grid, counts } = C.quantize(px([0, 0, 0, 0], [255, 255, 255, 255]), 2, 1, pal);
  assert.deepEqual(Array.from(grid), [-1, 1]);
  assert.deepEqual(counts, [0, 1, 0]);
});

test("alphaCut=0 时透明像素也按颜色放豆", () => {
  const { grid } = C.quantize(px([0, 0, 0, 0]), 1, 1, pal, { alphaCut: 0 });
  assert.equal(grid[0], 0);
});

test("maxColors 限制实际使用的颜色数，保留用量最多的", () => {
  const cells = [...Array(6).fill([0, 0, 0]), ...Array(3).fill([255, 255, 255]), [255, 0, 0]];
  const { counts } = C.quantize(px(...cells), 10, 1, pal, { maxColors: 2 });
  assert.equal(counts.filter((c) => c > 0).length, 2);
  assert.equal(counts[2], 0);                       // 红只出现 1 次，被舍弃
  assert.equal(counts[0] + counts[1], 10);
});

test("maxColors 不会因相近深色用量大，就丢掉用量小但色相独特的区域", () => {
  const p3 = C.makePalette([{ hex: "#000000" }, { hex: "#101010" }, { hex: "#2C6FC4" }]);
  const cells = [...Array(5).fill([0, 0, 0]), ...Array(5).fill([16, 16, 16]), ...Array(4).fill([44, 111, 196])];
  const { counts } = C.quantize(px(...cells), 14, 1, p3, { maxColors: 2 });
  assert.equal(counts[2], 4);                       // 蓝色保留
});

test("抖动：中灰用黑白两色交错表示，而不是全部同色", () => {
  const two = C.makePalette([{ hex: "#000000" }, { hex: "#FFFFFF" }]);
  const gray = Array(64).fill([128, 128, 128]);
  const plain = C.quantize(px(...gray), 8, 8, two, { dither: false }).counts;
  const dith = C.quantize(px(...gray), 8, 8, two, { dither: true }).counts;
  assert.ok(plain[0] === 64 || plain[1] === 64);
  assert.ok(dith[0] > 10 && dith[1] > 10);
});

test("adjust：亮度提高变亮，饱和度 -100 变灰，全 0 不改动", () => {
  const a = px([100, 100, 100]);
  C.adjust(a, { brightness: 20 });
  assert.ok(a[0] > 100);
  const b = px([200, 50, 50]);
  C.adjust(b, { saturation: -100 });
  assert.ok(Math.abs(b[0] - b[1]) <= 1 && Math.abs(b[1] - b[2]) <= 1);
  const c = px([12, 34, 56]);
  C.adjust(c, {});
  assert.deepEqual(Array.from(c), [12, 34, 56, 255]);
});

test("summarize 按用量降序", () => {
  const s = C.summarize(Int16Array.from([1, 1, 1, 0, -1, 2, 2]), 3);
  assert.deepEqual(s.items, [{ index: 1, count: 3 }, { index: 2, count: 2 }, { index: 0, count: 1 }]);
  assert.equal(s.total, 6);
});

test("内置色板：编号唯一、色值合法、基础是通用的子集", () => {
  for (const p of palettes) {
    const codes = new Set(p.colors.map((c) => c.code));
    assert.equal(codes.size, p.colors.length);
    for (const c of p.colors) assert.match(c.hex, /^#[0-9A-Fa-f]{6}$/);
  }
  const full = new Set(palettes.find((p) => p.id === "full").colors.map((c) => c.code));
  for (const c of palettes.find((p) => p.id === "basic").colors) assert.ok(full.has(c.code));
});
