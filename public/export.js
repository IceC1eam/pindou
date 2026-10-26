/* 图纸排版和无需第三方依赖的单页 PDF 导出。 */
(function (root) {
  "use strict";
  const R = root.PindouRender || (typeof require === "function" ? require("./render.js").PindouRender : null);
  const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  const MARGIN = 24;

  function titleLines(title, width) {
    const chars = Math.max(8, Math.floor((width - MARGIN * 2) / 27));
    return title ? (title.match(new RegExp(`.{1,${chars}}`, "gu")) || []) : [];
  }

  function sheetSize(o) {
    const pattern = R.patternSize(o.W, o.H, o.cell, o.gridLines);
    const width = Math.max(500, pattern.width + MARGIN * 2);
    const lines = titleLines(o.title, width);
    const header = MARGIN + lines.length * 36 + (lines.length ? 14 : 0) + (o.summary ? 32 : 0);
    const reference = o.reference ? Math.min(220, 360 * o.reference.height / o.reference.width) + 48 : 0;
    const legend = o.legend ? R.legendHeight(width - MARGIN * 2, o.items.length) + 12 : 0;
    return { width, height: Math.ceil(header + pattern.height + legend + reference + MARGIN), header, pattern, legend, reference, lines };
  }

  function drawSheet(ctx, o) {
    const s = sheetSize(o);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, s.width, s.height);
    let y = MARGIN;
    ctx.fillStyle = "#20242c";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `700 26px ${FONT}`;
    for (const line of s.lines) { ctx.fillText(line, MARGIN, y, s.width - MARGIN * 2); y += 36; }
    if (s.lines.length) y += 14;
    if (o.summary) {
      ctx.fillStyle = "#586170";
      ctx.font = `16px ${FONT}`;
      ctx.fillText(`${o.W} × ${o.H} 格  ·  共 ${o.total} 颗  ·  ${o.items.length} 色`, MARGIN, y);
      y += 32;
    }
    ctx.save();
    ctx.translate(MARGIN, y);
    R.drawPattern(ctx, {
      W: o.W, H: o.H, grid: o.grid, palette: o.palette, cell: o.cell,
      style: o.style, showGrid: o.gridLines, showCodes: o.codes,
      emph: o.gridLines ? o.emph : 0, board: o.board ? o.boardSize : 0,
      highlight: -1, axis: o.gridLines, textColor: o.textColor,
    });
    ctx.restore();
    y += s.pattern.height;
    if (o.legend) {
      y += 12;
      R.drawLegend(ctx, { x: MARGIN, y, width: s.width - MARGIN * 2, items: o.items,
        total: o.total, textColor: o.textColor, title: "颜色用量清单" });
      y += R.legendHeight(s.width - MARGIN * 2, o.items.length);
    }
    if (o.reference) {
      y += 16;
      ctx.fillStyle = "#333";
      ctx.font = `600 14px ${FONT}`;
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText("参考图", MARGIN, y);
      y += 28;
      const h = Math.min(220, 360 * o.reference.height / o.reference.width);
      ctx.drawImage(o.reference, MARGIN, y, h * o.reference.width / o.reference.height, h);
    }
    if (o.watermark) {
      ctx.save();
      ctx.translate(s.width / 2, s.height / 2);
      ctx.rotate(-Math.PI / 6);
      ctx.globalAlpha = Math.max(0.05, Math.min(0.4, o.opacity));
      ctx.fillStyle = "#34415a";
      ctx.font = `700 ${Math.max(30, Math.min(64, s.width / 11))}px ${FONT}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(o.watermark, 0, 0, s.width * 0.84);
      ctx.restore();
    }
    return s;
  }

  function pdfFromJpeg(jpeg, pixelWidth, pixelHeight) {
    const bytes = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
    const encoder = new TextEncoder();
    const chunks = []; let length = 0;
    const append = (part) => { const b = typeof part === "string" ? encoder.encode(part) : part; chunks.push(b); length += b.length; };
    const portrait = pixelHeight >= pixelWidth;
    const pageW = portrait ? 595.28 : 841.89, pageH = portrait ? 841.89 : 595.28;
    const scale = Math.min((pageW - 36) / pixelWidth, (pageH - 36) / pixelHeight);
    const w = +(pixelWidth * scale).toFixed(3), h = +(pixelHeight * scale).toFixed(3);
    const x = +((pageW - w) / 2).toFixed(3), y = +((pageH - h) / 2).toFixed(3);
    const content = `q\n${w} 0 0 ${h} ${x} ${y} cm\n/Im0 Do\nQ\n`;
    const offsets = [0];
    append("%PDF-1.4\n");
    const obj = (n, body) => { offsets[n] = length; append(`${n} 0 obj\n${body}\nendobj\n`); };
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    offsets[4] = length;
    append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
    append(bytes);
    append("\nendstream\nendobj\n");
    obj(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
    const xref = length;
    append("xref\n0 6\n0000000000 65535 f \n");
    for (let n = 1; n <= 5; n++) append(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
    append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: "application/pdf" });
  }

  const api = { sheetSize, drawSheet, pdfFromJpeg };
  root.PindouExport = api;
  if (typeof module !== "undefined" && module.exports) module.exports.PindouExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
