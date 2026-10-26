/* 把网格画到 canvas：屏幕预览和导出 PNG 共用同一个绘制函数。 */
(function (root) {
  "use strict";
  const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

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
    const showText = o.showCodes && c >= 20;
    const hasHl = o.highlight >= 0;
    if (showText) { ctx.font = `600 ${Math.floor(c * 0.34)}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; }
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
          ctx.fillText(p.code.replace(/^\D+/, ""), px + c / 2, py + c / 2 + 0.5);
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
      ctx.font = `600 9px ${FONT}`; ctx.textAlign = "center";
      ctx.fillText(it.code.replace(/^\D+/, ""), cx + 11, cy + 0.5);
      ctx.fillStyle = "#333"; ctx.font = `13px ${FONT}`; ctx.textAlign = "left";
      ctx.fillText(`${it.name}  ×${it.count}`, cx + 28, cy + 0.5);
    });
    return legendHeight(width, items.length);
  }

  root.PindouRender = { patternSize, drawPattern, legendHeight, drawLegend };
})(typeof self !== "undefined" ? self : this);
