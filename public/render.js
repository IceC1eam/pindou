/* 把网格画到 canvas：屏幕预览和导出 PNG 共用同一个绘制函数。 */
(function (root) {
  "use strict";
  const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

  /** 豆子里色号的字号：色号越长越小，保证放得进一格。结果按色板缓存最长的色号长度。 */
  const labelLen = new WeakMap();
  function codeFontSize(palette, c) {
    let n = labelLen.get(palette);
    if (n == null) { n = palette.reduce((m, p) => Math.max(m, (p.label || p.code).length), 1); labelLen.set(palette, n); }
    return Math.floor(Math.min(c * 0.34, (c * 0.92) / (n * 0.6)));
  }

  /** 图纸占用的像素尺寸（含坐标轴留白） */
  function patternSize(W, H, cell, axis) {
    const m = axis ? 28 : 8;
    return { m, width: m + W * cell + 8, height: m + H * cell + 8 };
  }

  /**
   * o: { W, H, grid, palette, cell, style: "circle"|"square", showGrid, showCodes, emph, board,
   *      highlight, axis, textColor }
   */
  function drawPattern(ctx, o) {
    const { W, H, grid, palette, cell: c } = o;
    const { m, width, height } = patternSize(W, H, c, o.axis);
    const x0 = m, y0 = m;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // 坐标：每 emph（默认 5）格标一个序号，第 1 格也标
    if (o.axis) {
      const step = o.emph || 5;
      ctx.fillStyle = "#777";
      ctx.font = `${Math.max(10, Math.min(13, c * 0.5))}px ${FONT}`;
      ctx.textBaseline = "middle";
      for (let i = 0; i < W; i++) {
        const n = i + 1;
        if (n !== 1 && n % step) continue;
        ctx.textAlign = "center";
        ctx.fillText(String(n), x0 + i * c + c / 2, m / 2);
      }
      for (let j = 0; j < H; j++) {
        const n = j + 1;
        if (n !== 1 && n % step) continue;
        ctx.textAlign = "right";
        ctx.fillText(String(n), x0 - 6, y0 + j * c + c / 2);
      }
    }

    // 细网格（画在豆子下面）
    if (o.showGrid) {
      ctx.strokeStyle = "rgba(128,128,128,.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= W; i++) { ctx.moveTo(x0 + i * c + 0.5, y0); ctx.lineTo(x0 + i * c + 0.5, y0 + H * c); }
      for (let j = 0; j <= H; j++) { ctx.moveTo(x0, y0 + j * c + 0.5); ctx.lineTo(x0 + W * c, y0 + j * c + 0.5); }
      ctx.stroke();
    }

    // 豆子
    const fs = codeFontSize(palette, c);
    const showText = o.showCodes && c >= 20 && fs >= 6;
    const hasHl = o.highlight >= 0;
    if (showText) { ctx.font = `600 ${fs}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = grid[y * W + x];
        if (idx < 0) continue;
        const p = palette[idx];
        const px = x0 + x * c, py = y0 + y * c;
        ctx.globalAlpha = hasHl && idx !== o.highlight ? 0.16 : 1;
        ctx.fillStyle = p.hex;
        if (o.style === "square") {
          ctx.fillRect(px + 1, py + 1, c - 1, c - 1);
        } else {
          ctx.beginPath();
          ctx.arc(px + c / 2, py + c / 2, c * 0.46, 0, Math.PI * 2);
          ctx.fill();
          if (!showText && c >= 14) {                       // 豆孔
            ctx.fillStyle = "rgba(0,0,0,.16)";
            ctx.beginPath();
            ctx.arc(px + c / 2, py + c / 2, c * 0.13, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (showText) {
          ctx.fillStyle = o.textColor(p.rgb);
          ctx.fillText(p.label || p.code, px + c / 2, py + c / 2 + 0.5);
        }
      }
    }
    ctx.globalAlpha = 1;

    // 每 emph 格加粗线 / 拼板分割线
    const line = (every, style, w) => {
      if (!every) return;
      ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath();
      for (let i = every; i < W; i += every) { ctx.moveTo(x0 + i * c + 0.5, y0); ctx.lineTo(x0 + i * c + 0.5, y0 + H * c); }
      for (let j = every; j < H; j += every) { ctx.moveTo(x0, y0 + j * c + 0.5); ctx.lineTo(x0 + W * c, y0 + j * c + 0.5); }
      ctx.stroke();
    };
    if (o.showGrid) line(o.emph, "rgba(90,90,90,.75)", 1.5);
    line(o.board, "#e0262c", 2.5);

    ctx.strokeStyle = "rgba(60,60,60,.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, W * c, H * c);
    return { width, height };
  }

  /** 用量清单（导出用）。items: [{ code, name, hex, count }] */
  const LEGEND_COL = 190, LEGEND_ROW = 30;
  function legendHeight(width, n) {
    const cols = Math.max(1, Math.floor((width - 16) / LEGEND_COL));
    return Math.ceil(n / cols) * LEGEND_ROW + 44;
  }

  function drawLegend(ctx, o) {
    const { x, y, width, items, total, textColor } = o;
    const cols = Math.max(1, Math.floor((width - 16) / LEGEND_COL));
    ctx.fillStyle = "#333";
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(o.title, x + 8, y + 14);
    items.forEach((it, i) => {
      const cx = x + 8 + (i % cols) * LEGEND_COL, cy = y + 44 + Math.floor(i / cols) * LEGEND_ROW;
      ctx.fillStyle = it.hex;
      ctx.beginPath(); ctx.arc(cx + 11, cy, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = textColor(it.rgb);
      const lab = it.label || it.code;
      ctx.font = `600 ${lab.length > 4 ? 6 : lab.length > 2 ? 8 : 9}px ${FONT}`; ctx.textAlign = "center";
      ctx.fillText(lab, cx + 11, cy + 0.5);
      ctx.fillStyle = "#333"; ctx.font = `13px ${FONT}`; ctx.textAlign = "left";
      ctx.fillText(`${it.name || it.code}  ×${it.count}`, cx + 28, cy + 0.5);
    });
    return legendHeight(width, items.length);
  }

  // ---------------- 烫豆效果预览 ----------------
  // 同一份图纸画成不同“烫法”的样子。烫法是拼豆社区里常见的表面质感做法：垫什么材料熨烫，就留下什么肌理。
  // 纹理全部是程序生成的示意（固定随机种子，重绘不会闪烁），真实效果取决于垫材、温度和手法。
  const EFFECTS = [
    { id: "holes", name: "有孔烫", note: "豆子已经熔接成片，仍保留缩小的圆孔与浅浅的颗粒轮廓" },
    { id: "flat", name: "正常烫", note: "豆子熔成连续薄片，接缝很浅，中心孔基本闭合" },
    { id: "towel", name: "毛巾烫", note: "垫纯棉毛巾：表面有细毛、哑光绒感，沾上毛巾纤维所以颜色略偏灰，适合小动物、玩偶" },
    { id: "loofah", name: "澡巾烫", note: "垫粗澡巾：均匀的颗粒凹凸，复古做旧；没有细毛，颜色比毛巾烫鲜艳，也更好撕" },
    { id: "weave", name: "编织烫", note: "交织的藤编/布纹肌理，适合花篮、杯垫" },
    { id: "lattice", name: "格纹烫", note: "规则的格纹，平面上有立体光影，带细闪" },
    { id: "glitter", name: "格利特烫", note: "星光闪烁、宝石般的光泽，配半透明豆更明显" },
    { id: "gloss", name: "亮面烫", note: "光滑反光的亮面，难度较高" },
  ];

  function rr(ctx, x, y, w, h, r) {            // 圆角矩形（不依赖较新的 ctx.roundRect）
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function rng(seed) {                          // 固定种子的伪随机数，保证纹理每次一样
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 纹理瓦片：g 是瓦片的 2d 上下文，T 瓦片边长（CSS 像素），c 一颗豆的边长 ----
  const TAU = Math.PI * 2;

  function towelTile(g, T, c) {                 // 毛巾：毛圈 + 细毛
    const R = rng(11), n = Math.max(2, Math.round(T / (c * 0.22))), sp = T / n;
    g.lineWidth = Math.max(0.6, c * 0.035);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = (i + 0.5 + (R() - 0.5) * 0.4) * sp, y = (j + 0.5 + (R() - 0.5) * 0.4) * sp;
      g.strokeStyle = R() < 0.5 ? "rgba(255,255,255,.20)" : "rgba(0,0,0,.14)";
      g.beginPath(); g.arc(x, y, sp * 0.36, R() * TAU, R() * TAU + 4); g.stroke();
    }
    const hairs = Math.round((T * T) / (c * c) * 70);            // 密而短的细毛，不是长线条
    g.lineWidth = Math.max(0.4, c * 0.018);
    for (let k = 0; k < hairs; k++) {
      const x = R() * T, y = R() * T, a = R() * TAU, l = c * (0.06 + R() * 0.12);
      g.strokeStyle = R() < 0.55 ? "rgba(255,255,255,.26)" : "rgba(0,0,0,.16)";
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 1) * l * 0.5, y + Math.sin(a + 1) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  }

  function loofahTile(g, T, c) {                // 澡巾：均匀的颗粒凹凸（可无缝平铺）
    const R = rng(23), n = Math.max(3, Math.round(T / (c * 0.2))), sp = T / n;
    g.fillStyle = "rgba(0,0,0,.10)"; g.fillRect(0, 0, T, T);                    // 凹处
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const r = sp * (0.34 + R() * 0.16), x = (i + 0.5 + (R() - 0.5) * 0.5) * sp, y = (j + 0.5 + (R() - 0.5) * 0.5) * sp;
      for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) {
        const cx = x + dx, cy = y + dy;
        if (cx < -r || cy < -r || cx > T + r || cy > T + r) continue;
        const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        gr.addColorStop(0, "rgba(255,255,255,.36)"); gr.addColorStop(0.6, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(0,0,0,.32)");
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      }
    }
  }

  function weaveTile(g, T, c) {                 // 编织：横竖交替的条带，明暗方向相反
    const s = T / 8;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const x = i * s, y = j * s, horiz = (i + j) % 2 === 0;
      const gr = horiz ? g.createLinearGradient(x, y, x, y + s) : g.createLinearGradient(x, y, x + s, y);
      gr.addColorStop(0, "rgba(255,255,255,.32)"); gr.addColorStop(0.5, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(0,0,0,.32)");
      g.fillStyle = gr; g.fillRect(x, y, s, s);
      g.strokeStyle = "rgba(0,0,0,.22)"; g.lineWidth = Math.max(0.6, c * 0.03); g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    }
  }

  function latticeTile(g, T, c) {               // 格纹：一格一格的小凸块（亮边在左上、暗边在右下）+ 细闪
    const R = rng(37), n = Math.max(2, Math.round(T / (c * 0.5))), s = T / n, e = Math.max(1, s * 0.16);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = i * s, y = j * s;
      g.fillStyle = "rgba(255,255,255,.30)"; g.fillRect(x, y, s, e); g.fillRect(x, y, e, s);
      g.fillStyle = "rgba(0,0,0,.30)"; g.fillRect(x, y + s - e, s, e); g.fillRect(x + s - e, y, e, s);
    }
    const dots = Math.round((T * T) / (c * c) * 10);
    for (let k = 0; k < dots; k++) {
      g.fillStyle = `rgba(255,255,255,${0.4 + R() * 0.5})`;
      g.beginPath(); g.arc(R() * T, R() * T, c * (0.015 + R() * 0.03), 0, TAU); g.fill();
    }
  }

  function glitterTile(g, T, c) {               // 格利特：细密的亮点 + 少量十字星芒 + 零星彩色反光
    const R = rng(51), area = (T * T) / (c * c);
    for (let k = 0, n = Math.round(area * 30); k < n; k++) {
      g.fillStyle = R() < 0.1 ? `hsla(${Math.round(R() * 360)},90%,78%,.55)` : `rgba(255,255,255,${0.3 + R() * 0.5})`;
      g.beginPath(); g.arc(R() * T, R() * T, c * (0.012 + R() * 0.026), 0, TAU); g.fill();
    }
    g.lineCap = "round";
    for (let k = 0, n = Math.round(area * 1.1); k < n; k++) {
      const x = R() * T, y = R() * T, r = c * (0.05 + R() * 0.07);
      g.strokeStyle = `rgba(255,255,255,${0.55 + R() * 0.35})`; g.lineWidth = Math.max(0.6, c * 0.022);
      g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
    }
  }

  // 每种烫法在“熔合的豆子”之上叠加的东西：tint 整体色调；tile 重复纹理；band 大面积反光
  const OVERLAY = {
    towel: { tile: towelTile, tint: "rgba(128,128,128,.15)" },       // 毛巾纤维沾在表面，所以偏灰
    loofah: { tile: loofahTile },
    weave: { tile: weaveTile },
    lattice: { tile: latticeTile },
    glitter: { tile: glitterTile, tint: "rgba(255,255,255,.10)" },
    gloss: { band: true },
  };
  const tiles = new Map();

  function getTile(fx, c, dpr, make) {
    const T = Math.max(24, Math.round(c * 4)), key = `${fx}|${T}|${dpr}`;
    if (!tiles.has(key)) {
      const cv = make();
      cv.width = Math.round(T * dpr); cv.height = Math.round(T * dpr);
      const g = cv.getContext("2d");
      g.scale(dpr, dpr);
      OVERLAY[fx].tile(g, T, c);
      tiles.set(key, { cv, T });
      if (tiles.size > 40) tiles.delete(tiles.keys().next().value);
    }
    return tiles.get(key);
  }

  /** 一颗豆子熔合后的底色形态（纹理叠在它们上面）。 */
  function paintBead(ctx, fx, p, x, y, c, transparent, bg) {
    if (fx === "holes") {                       // 熔接后的圆角方块相互贴合，孔缩小但仍可见
      ctx.fillStyle = p.hex;
      rr(ctx, x - 0.15, y - 0.15, c + 0.3, c + 0.3, c * 0.22); ctx.fill();
      ctx.strokeStyle = "rgba(50,35,30,.10)"; ctx.lineWidth = Math.max(0.5, c * 0.018); ctx.stroke();
      ctx.save();
      if (transparent) ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = transparent ? "#000" : bg;
      ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.085, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.fillStyle = p.hex;
    if (fx === "flat" || fx === "glitter" || fx === "gloss") {
      ctx.fillRect(x - 0.25, y - 0.25, c + 0.5, c + 0.5);
      ctx.strokeStyle = "rgba(45,35,30,.075)"; ctx.lineWidth = Math.max(0.5, c * 0.012);
      ctx.strokeRect(x + 0.25, y + 0.25, c - 0.5, c - 0.5);
      if (fx === "flat") {                      // 孔基本闭合，只剩一点点凹痕
        if (c >= 13) { ctx.fillStyle = "rgba(40,30,25,.10)"; ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.025, 0, TAU); ctx.fill(); }
      } else {                                  // 光泽：每颗豆左上亮、右下暗
        const strong = fx === "gloss";
        const g = ctx.createLinearGradient(x, y, x + c, y + c);
        g.addColorStop(0, `rgba(255,255,255,${strong ? 0.55 : 0.3})`);
        g.addColorStop(0.5, "rgba(255,255,255,0)");
        g.addColorStop(1, `rgba(0,0,0,${strong ? 0.22 : 0.16})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, c, c);
      }
      return;
    }
    ctx.fillRect(x - 0.4, y - 0.4, c + 0.8, c + 0.8);              // 垫了材料的烫法：豆子完全熔进纹理里，只留很淡的接缝
    ctx.strokeStyle = "rgba(0,0,0,.08)"; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, c - 1, c - 1);
  }

  /**
   * o: { W, H, grid, palette, cell, effect, pad?, bg?, transparent?, dpr?, makeCanvas?, crop?: {x, y, w, h} }
   * 返回画布像素尺寸 { width, height }。crop 只画网格的一块（用于并排对比的局部放大）。
   * makeCanvas：生成离屏画布的函数（默认用 document.createElement("canvas")），纹理瓦片用。
   */
  function drawFused(ctx, o) {
    const { grid, palette, W, cell: c } = o;
    const crop = o.crop || { x: 0, y: 0, w: o.W, h: o.H };
    const pad = o.pad == null ? Math.round(c * 1.2) : o.pad;
    const width = crop.w * c + pad * 2, height = crop.h * c + pad * 2;
    if (!o.transparent) {
      ctx.fillStyle = o.bg || "#ecebe7";
      ctx.fillRect(0, 0, width, height);
    }

    const cells = [];                          // 只收集有豆子的格子
    for (let j = 0; j < crop.h; j++) {
      for (let i = 0; i < crop.w; i++) {
        const idx = grid[(crop.y + j) * W + crop.x + i];
        if (idx >= 0) cells.push({ idx, px: pad + i * c, py: pad + j * c });
      }
    }
    const fx = o.effect;
    for (const b of cells) paintBead(ctx, fx, palette[b.idx], b.px, b.py, c, !!o.transparent, o.bg || "#ecebe7");

    const ov = OVERLAY[fx];
    if (ov && cells.length) {                  // 只在有豆子的地方叠纹理
      const make = o.makeCanvas || (typeof document !== "undefined" ? () => document.createElement("canvas") : null);
      const x0 = pad, y0 = pad, w = crop.w * c, h = crop.h * c;
      ctx.save();
      ctx.beginPath();
      for (const b of cells) ctx.rect(b.px, b.py, c, c);
      ctx.clip();
      if (ov.tint) { ctx.fillStyle = ov.tint; ctx.fillRect(x0, y0, w, h); }
      if (ov.tile && make) {
        const dpr = o.dpr || 1, t = getTile(fx, c, dpr, make);
        const pat = ctx.createPattern(t.cv, "repeat");
        if (pat && pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().translate(x0, y0).scale(1 / dpr));
        ctx.fillStyle = pat;
        ctx.fillRect(x0, y0, w, h);
      }
      if (ov.band) {                           // 整块作品上一道斜向的反光带
        const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.3, "rgba(255,255,255,.32)");
        g.addColorStop(0.42, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.10)");
        ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
      }
      ctx.restore();
    }
    return { width, height };
  }

  /** 并排对比用的局部：在整张图里挑颜色最丰富的 k×k（同分取更靠近中央的），这样各种烫法的差别看得最清楚。 */
  function pickCrop(W, H, grid, k) {
    k = Math.min(k, W, H);
    const seen = new Int32Array(1024);        // 用“代号”标记代替每个窗口新建 Set
    let gen = 0, best = { x: 0, y: 0, score: -1 };
    for (let y = 0; y + k <= H; y++) {
      for (let x = 0; x + k <= W; x++) {
        gen++;
        let kinds = 0, filled = 0;
        for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
          const v = grid[(y + j) * W + x + i];
          if (v < 0) continue;
          filled++;
          if (v < 1024 && seen[v] !== gen) { seen[v] = gen; kinds++; }
        }
        const score = kinds * 1000 + filled - (Math.abs(x + k / 2 - W / 2) + Math.abs(y + k / 2 - H / 2)) * 0.01;
        if (score > best.score) best = { x, y, score };
      }
    }
    return { x: best.x, y: best.y, w: k, h: k };
  }

  root.PindouRender = { patternSize, drawPattern, legendHeight, drawLegend, EFFECTS, drawFused, pickCrop };
})(typeof self !== "undefined" ? self : this);
