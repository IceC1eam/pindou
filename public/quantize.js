/* 颜色处理核心（纯函数，不依赖 DOM，可在 Node 下测试）：
 *   RGBA 像素 → 色板索引网格。支持亮度/对比度/饱和度预处理、限制用色数、Floyd–Steinberg 抖动。
 * 颜色距离在 CIE Lab 空间里算（比直接 RGB 更接近肉眼的“像不像”）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PindouCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EMPTY = -1;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function srgbToLab(r, g, b) {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
    const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /** [{code,name,hex}] → 带 rgb / lab 的色板 */
  function makePalette(colors) {
    return colors.map((c) => {
      const rgb = hexToRgb(c.hex);
      return { ...c, rgb, lab: srgbToLab(rgb[0], rgb[1], rgb[2]) };
    });
  }

  const labDist = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

  function nearest(palette, active, r, g, b) {
    const [L, A, B] = srgbToLab(r, g, b);
    let best = active[0], bd = Infinity;
    for (let k = 0; k < active.length; k++) {
      const p = palette[active[k]].lab;
      const d = (p[0] - L) ** 2 + (p[1] - A) ** 2 + (p[2] - B) ** 2;
      if (d < bd) { bd = d; best = active[k]; }
    }
    return best;
  }

  /** 原地调整 RGBA：brightness / contrast / saturation 均为 -100..100 */
  function adjust(data, o = {}) {
    const brightness = o.brightness || 0, contrast = o.contrast || 0, saturation = o.saturation || 0;
    if (!brightness && !contrast && !saturation) return data;
    const b = brightness * 2.55, c = contrast * 2.55;
    const f = (259 * (c + 255)) / (255 * (259 - c));
    const s = 1 + saturation / 100;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      for (let k = 0; k < 3; k++) {
        let v = gray + (data[i + k] - gray) * s;
        v = f * (v + b - 128) + 128;
        data[i + k] = v;                      // Uint8ClampedArray 自动夹取到 0..255
      }
    }
    return data;
  }

  function count(grid, n) {
    const out = new Array(n).fill(0);
    for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) out[grid[i]]++;
    return out;
  }

  function mapPass(buf, opaque, w, h, palette, active, dither) {
    const b = dither ? Float32Array.from(buf) : buf;
    const grid = new Int16Array(w * h).fill(EMPTY);
    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
    const push = (x, y, er, eg, eb, k) => {
      if (x < 0 || x >= w || y >= h) return;
      const j = y * w + x;
      if (!opaque[j]) return;
      b[j * 3] += er * k; b[j * 3 + 1] += eg * k; b[j * 3 + 2] += eb * k;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!opaque[i]) continue;
        const r = clamp(b[i * 3]), g = clamp(b[i * 3 + 1]), bl = clamp(b[i * 3 + 2]);
        const idx = nearest(palette, active, r, g, bl);
        grid[i] = idx;
        if (dither) {
          const [pr, pg, pb] = palette[idx].rgb;
          const er = r - pr, eg = g - pg, eb = bl - pb;
          push(x + 1, y, er, eg, eb, 7 / 16);
          push(x - 1, y + 1, er, eg, eb, 3 / 16);
          push(x, y + 1, er, eg, eb, 5 / 16);
          push(x + 1, y + 1, er, eg, eb, 1 / 16);
        }
      }
    }
    return grid;
  }

  /**
   * rgba: w*h*4 的像素；返回 { grid: Int16Array（色板索引，-1=无豆）, counts }
   * opts: { dither, maxColors（0=不限）, alphaCut（alpha 低于它视为无豆，默认 128） }
   */
  function quantize(rgba, w, h, palette, opts = {}) {
    const alphaCut = opts.alphaCut == null ? 128 : opts.alphaCut;
    const n = w * h;
    const opaque = new Uint8Array(n);
    const buf = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      opaque[i] = rgba[i * 4 + 3] >= alphaCut ? 1 : 0;
      buf[i * 3] = rgba[i * 4]; buf[i * 3 + 1] = rgba[i * 4 + 1]; buf[i * 3 + 2] = rgba[i * 4 + 2];
    }
    let active = palette.map((_, i) => i);
    const max = opts.maxColors | 0;
    if (max > 0 && max < palette.length) {
      // 先用全色板映射一遍统计用量，再贪心选 max 个颜色：先取用量最大的，之后每次取
      // “用量 × 与已选颜色的最小距离”最大的——避免相近的几个深色把用量小但色相独特的区域（如一角蓝天）挤掉
      const cnt = count(mapPass(buf, opaque, w, h, palette, active, false), palette.length);
      const cand = active.filter((i) => cnt[i] > 0);
      if (cand.length) {
        const chosen = [cand.reduce((a, b) => (cnt[b] > cnt[a] ? b : a))];
        const minD = new Map(cand.map((i) => [i, labDist(palette[i].lab, palette[chosen[0]].lab)]));
        while (chosen.length < Math.min(max, cand.length)) {
          let best = -1, bs = -1;
          for (const i of cand) {
            if (chosen.includes(i)) continue;
            const s = cnt[i] * Math.sqrt(minD.get(i));
            if (s > bs) { bs = s; best = i; }
          }
          chosen.push(best);
          for (const i of cand) minD.set(i, Math.min(minD.get(i), labDist(palette[i].lab, palette[best].lab)));
        }
        active = chosen;
      }
    }
    const grid = mapPass(buf, opaque, w, h, palette, active, !!opts.dither);
    return { grid, counts: count(grid, palette.length) };
  }

  /** 色块上文字用黑还是白 */
  function textColor(rgb) {
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 150 ? "#111" : "#fff";
  }

  /** 统计：按用量降序 [{index, count}]，以及总数 */
  function summarize(grid, paletteLength) {
    const cnt = count(grid, paletteLength);
    const items = cnt.map((c, index) => ({ index, count: c })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
    return { items, total: items.reduce((s, x) => s + x.count, 0) };
  }

  return { EMPTY, hexToRgb, srgbToLab, makePalette, nearest, adjust, quantize, textColor, summarize };
});
