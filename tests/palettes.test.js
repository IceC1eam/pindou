"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../public/quantize.js");

// 和浏览器一样：先加载 palettes-brands.js，再加载 palettes.js
function load(withBrands) {
  const ctx = { self: {} };
  vm.createContext(ctx);
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, "../public", f), "utf8"), ctx);
  if (withBrands) run("palettes-brands.js");
  run("palettes.js");
  return ctx.self.PindouPalettes;
}

test("没有品牌数据时只有通用色板", () => {
  const P = load(false);
  assert.deepEqual([...P.palettes.map((p) => p.id)], ["basic", "full"]);   // 展开成本环境的数组（vm 里的数组原型不同）
});

test("品牌色板：分组、数量与主流品牌都在", () => {
  const P = load(true);
  const groups = new Set(P.palettes.map((p) => p.group));
  assert.deepEqual([...groups], ["通用", "国内品牌", "国际品牌"]);
  const names = P.palettes.map((p) => p.name).join("|");
  for (const brand of ["MARD", "COCO", "漫漫", "盼盼", "咪小窝", "优肯", "Perler", "Hama", "Artkal", "Nabbi"]) assert.ok(names.includes(brand), brand);
  assert.equal(new Set(P.palettes.map((p) => p.id)).size, P.palettes.length);
  assert.equal(P.byId("不存在").id, "basic");           // 找不到时回退
});

test("每套品牌色板的数据都能用：色值合法、色号不重复、标签够短、能建 Lab 色板", () => {
  const P = load(true);
  for (const p of P.palettes.filter((x) => x.brand)) {
    assert.ok(p.colors.length >= 30, p.id);
    const codes = new Set();
    for (const c of p.colors) {
      assert.match(c.hex, /^#[0-9A-F]{6}$/, `${p.id} ${c.code}`);
      assert.ok(!codes.has(c.code), `${p.id} 重复色号 ${c.code}`);
      codes.add(c.code);
      assert.ok(c.label && c.label.length <= 6, `${p.id} ${c.code} -> ${c.label}`);
      assert.equal(typeof c.name, "string");
    }
    const pal = C.makePalette(p.colors);
    const probe = p.colors[Math.floor(p.colors.length / 2)];
    const [r, g, b] = C.hexToRgb(probe.hex);
    const idx = C.nearest(pal, pal.map((_, i) => i), r, g, b);
    assert.equal(pal[idx].hex, probe.hex, `${p.id}：精确色值应映射回自己`);
  }
});

test("色号标签：通用色板去前缀，品牌保留完整色号，Perler 去掉 80- 前缀", () => {
  const P = load(true);
  assert.equal(P.byId("full").colors[0].label, "01");
  assert.equal(P.byId("b-mard-221-alfonse-doudou").colors[0].label, "A1");
  const perler = P.byId("b-beadcolors-perler").colors[0];
  assert.equal(perler.code.startsWith("80-"), true);
  assert.equal(perler.label, perler.code.slice(3));
  assert.equal(P.byId("b-beadcolors-hama").colors[0].name, "White");   // 有名称的保留名称
  assert.equal(P.byId("b-coco-291").colors[0].name, "");               // 名称和色号相同的不重复
});

test("已排除未确认色号与特殊材质色（夜光/闪粉/透明/珠光/金属），白色背景不会被它们抢走", () => {
  const P = load(true);
  for (const p of P.palettes) for (const c of p.colors) {
    assert.ok(!/^UNKNOWN/i.test(c.code), c.code);
    assert.ok(!/glow|glitter|transp|transl|clear|pearl|metallic/i.test(c.name), `${p.id} ${c.code} ${c.name}`);
  }
  const c197 = P.byId("b-artkal-c-197-official");
  assert.ok(!c197.colors.some((c) => /^C[TGP]\d+/.test(c.code)));      // CT/CG/CP 系列：数据备注为“从色卡图片取样的参考色”，不是真实 RGB
  // 纯白像素应落在各品牌普通的白色上
  for (const p of P.palettes.filter((x) => x.brand)) {
    const pal = C.makePalette(p.colors);
    const i = C.nearest(pal, pal.map((_, k) => k), 255, 255, 255);
    assert.ok(pal[i].lab[0] > 90, `${p.id}：最接近白色的是 ${pal[i].code} ${pal[i].name} ${pal[i].hex}`);
  }
});

test("MARD 全系列带有提示，其它品牌没有", () => {
  const P = load(true);
  assert.match(P.byId("b-mard-291-github").note, /221/);
  assert.equal(P.byId("b-mard-221-alfonse-doudou").note, "");
});
