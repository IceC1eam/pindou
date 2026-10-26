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
  // 把同一份网格画成“熨烫后”的样子。只是示意：真实效果取决于豆子品牌、温度和烫的时间。
  const EFFECTS = [
    { id: "raw", name: "未烫", note: "圆豆带孔，还没熨烫" },
    { id: "light", name: "微烫", note: "刚刚贴合，孔还在" },
    { id: "flat", name: "烫平", note: "平整的方块，孔几乎闭合" },
    { id: "melt", name: "重烫", note: "熔合无缝，颜色交界处柔和过渡" },
    { id: "gloss", name: "成品质感", note: "烫平 + 光泽与投影" },
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

  function mix(rgb, to, t) {
    return `rgb(${rgb.map((v, i) => Math.round(v + (to[i] - v) * t)).join(",")})`;
  }

  /**
   * o: { W, H, grid, palette, cell, effect, pad?, bg?, crop?: {x, y, w, h} }
   * 返回画布像素尺寸 { width, height }。crop 只画网格的一块（用于并排对比的局部放大）。
   */
  function drawFused(ctx, o) {
    const { grid, palette, W, cell: c } = o;
    const crop = o.crop || { x: 0, y: 0, w: o.W, h: o.H };
    const pad = o.pad == null ? Math.round(c * 1.2) : o.pad;
    const width = crop.w * c + pad * 2, height = crop.h * c + pad * 2;
    ctx.fillStyle = o.bg || "#ecebe7";
    ctx.fillRect(0, 0, width, height);

    const cells = [];                          // 只收集有豆子的格子
    for (let j = 0; j < crop.h; j++) {
      for (let i = 0; i < crop.w; i++) {
        const idx = grid[(crop.y + j) * W + crop.x + i];
        if (idx >= 0) cells.push({ i, j, idx, px: pad + i * c, py: pad + j * c });
      }
    }
    const at = (i, j) => (i < 0 || j < 0 || i >= crop.w || j >= crop.h ? -1 : grid[(crop.y + j) * W + crop.x + i]);
    const fx = o.effect;

    if (fx === "gloss") {                      // 整块作品的投影
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.38)";
      ctx.shadowBlur = c * 0.55; ctx.shadowOffsetX = c * 0.14; ctx.shadowOffsetY = c * 0.26;
      ctx.fillStyle = "#777";
      for (const b of cells) ctx.fillRect(b.px, b.py, c, c);
      ctx.restore();
    }

    for (const b of cells) {
      const p = palette[b.idx], x = b.px, y = b.py;
      if (fx === "raw") {
        ctx.fillStyle = p.hex;
        ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.47, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = mix(p.rgb, [0, 0, 0], 0.28); ctx.lineWidth = Math.max(1, c * 0.05); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.28)";                    // 高光
        ctx.beginPath(); ctx.arc(x + c * 0.36, y + c * 0.33, c * 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,.42)";                         // 豆孔
        ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.16, 0, Math.PI * 2); ctx.fill();
      } else if (fx === "light") {
        ctx.fillStyle = p.hex;
        rr(ctx, x + c * 0.04, y + c * 0.04, c * 0.92, c * 0.92, c * 0.32); ctx.fill();
        ctx.strokeStyle = mix(p.rgb, [0, 0, 0], 0.22); ctx.lineWidth = Math.max(1, c * 0.04); ctx.stroke();
        ctx.fillStyle = "rgba(0,0,0,.34)";
        ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.11, 0, Math.PI * 2); ctx.fill();
      } else if (fx === "flat") {
        ctx.fillStyle = p.hex;
        rr(ctx, x + c * 0.01, y + c * 0.01, c * 0.98, c * 0.98, c * 0.1); ctx.fill();
        ctx.strokeStyle = mix(p.rgb, [0, 0, 0], 0.2); ctx.lineWidth = Math.max(1, c * 0.035); ctx.stroke();
        if (c >= 8) { ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.05, 0, Math.PI * 2); ctx.fill(); }
      } else if (fx === "melt") {
        ctx.fillStyle = p.hex;
        ctx.fillRect(x - 0.4, y - 0.4, c + 0.8, c + 0.8);           // 多出一点点，盖住缝
      } else {                                                      // gloss
        ctx.fillStyle = p.hex;
        rr(ctx, x + c * 0.01, y + c * 0.01, c * 0.98, c * 0.98, c * 0.12); ctx.fill();
        const g = ctx.createLinearGradient(x, y, x + c, y + c);
        g.addColorStop(0, "rgba(255,255,255,.42)"); g.addColorStop(0.5, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.2)");
        ctx.fillStyle = g;
        rr(ctx, x + c * 0.01, y + c * 0.01, c * 0.98, c * 0.98, c * 0.12); ctx.fill();
        if (c >= 8) { ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.05, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    if (fx === "melt") {                       // 不同颜色相邻处：沿交界画一条渐变，模拟熔化后的混色
      const half = c * 0.2;
      for (const b of cells) {
        const a = palette[b.idx];
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          const nIdx = at(b.i + di, b.j + dj);
          if (nIdx < 0 || nIdx === b.idx) continue;
          const n = palette[nIdx];
          const x1 = b.px + di * c, y1 = b.py + dj * c;                // 交界线上的点
          const g = di ? ctx.createLinearGradient(x1 - half, 0, x1 + half, 0) : ctx.createLinearGradient(0, y1 - half, 0, y1 + half);
          g.addColorStop(0, a.hex); g.addColorStop(1, n.hex);
          ctx.fillStyle = g;
          if (di) ctx.fillRect(x1 - half, b.py, half * 2, c); else ctx.fillRect(b.px, y1 - half, c, half * 2);
        }
      }
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
