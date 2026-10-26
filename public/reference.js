/* 参考图的裁剪选区和边缘色度键。算法不依赖 DOM，供浏览器和测试共用。 */
(function (root) {
  "use strict";
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // 归一化坐标。ratio 是原图像素中的宽高比；自由裁剪传 0。
  function cropRect(start, end, ratio, imageWidth, imageHeight) {
    const dx = end.x - start.x, dy = end.y - start.y;
    let w = Math.abs(dx), h = Math.abs(dy);
    if (ratio > 0) {
      const normalizedRatio = ratio * imageHeight / imageWidth;
      if (w / Math.max(h, 1e-6) > normalizedRatio) h = w / normalizedRatio;
      else w = h * normalizedRatio;
      const maxW = dx < 0 ? start.x : 1 - start.x;
      const maxH = dy < 0 ? start.y : 1 - start.y;
      const fit = Math.min(1, maxW / Math.max(w, 1e-6), maxH / Math.max(h, 1e-6));
      w *= fit; h *= fit;
    }
    const x = clamp(start.x + (dx < 0 ? -w : 0), 0, 1);
    const y = clamp(start.y + (dy < 0 ? -h : 0), 0, 1);
    return { x, y, w: clamp(w, 0, 1 - x), h: clamp(h, 0, 1 - y) };
  }

  function colorFromHex(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) throw new TypeError("无效的颜色");
    return [0, 2, 4].map((n) => parseInt(m[1].slice(n, n + 2), 16));
  }

  /** 只处理与四条图像边界连通、且接近目标颜色的像素；保留不连通的同色区域。 */
  function edgeChromaKey(image, hex, tolerance) {
    const { width: W, height: H, data: src } = image;
    const target = colorFromHex(hex), limit = clamp(Math.round(tolerance), 0, 100), feather = 24;
    const n = W * H, dst = new Uint8ClampedArray(src);
    const seen = new Uint8Array(n), queue = new Int32Array(n);
    let head = 0, tail = 0;
    const distance = (i) => {
      const k = i * 4;
      return Math.max(Math.abs(src[k] - target[0]), Math.abs(src[k + 1] - target[1]), Math.abs(src[k + 2] - target[2]));
    };
    const add = (i) => {
      if (seen[i]) return;
      seen[i] = 1;
      if (src[i * 4 + 3] === 0 || distance(i) <= limit + feather) queue[tail++] = i;
    };
    for (let x = 0; x < W; x++) { add(x); add((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { add(y * W); add(y * W + W - 1); }
    while (head < tail) {
      const i = queue[head++], x = i % W, y = (i - x) / W;
      const k = i * 4, dist = distance(i);
      const keep = clamp((dist - limit) / feather, 0, 1);
      dst[k + 3] = Math.round(src[k + 3] * keep);
      // 半透明边缘消除目标底色的混色，减少白边。
      if (keep > 0 && keep < 1 && src[k + 3]) {
        for (let c = 0; c < 3; c++) dst[k + c] = clamp(Math.round((src[k + c] - target[c] * (1 - keep)) / keep), 0, 255);
      }
      if (x > 0) add(i - 1);
      if (x + 1 < W) add(i + 1);
      if (y > 0) add(i - W);
      if (y + 1 < H) add(i + W);
    }
    return { width: W, height: H, data: dst };
  }

  /** 在边界上找出现最多的近似颜色，作为白边以外背景的快捷取色。 */
  function dominantEdgeColor(image) {
    const { width: W, height: H, data } = image;
    const bins = new Map(), step = Math.max(1, Math.floor(2 * (W + H) / 1200));
    const add = (x, y) => {
      const k = (y * W + x) * 4;
      if (data[k + 3] < 128) return;
      const id = ((data[k] >> 4) << 8) | ((data[k + 1] >> 4) << 4) | (data[k + 2] >> 4);
      const b = bins.get(id) || [0, 0, 0, 0];
      b[0]++; b[1] += data[k]; b[2] += data[k + 1]; b[3] += data[k + 2];
      bins.set(id, b);
    };
    for (let x = 0; x < W; x += step) { add(x, 0); add(x, H - 1); }
    for (let y = 0; y < H; y += step) { add(0, y); add(W - 1, y); }
    let best = null;
    for (const b of bins.values()) if (!best || b[0] > best[0]) best = b;
    if (!best) return "#ffffff";
    return "#" + best.slice(1).map((v) => Math.round(v / best[0]).toString(16).padStart(2, "0")).join("");
  }

  root.PindouReference = { cropRect, edgeChromaKey, dominantEdgeColor };
})(typeof self !== "undefined" ? self : this);
