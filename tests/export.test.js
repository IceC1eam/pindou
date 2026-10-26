"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PindouExport: Export } = require("../public/export.js");

const base = { W: 20, H: 12, cell: 32, gridLines: true, title: "拼豆图纸", summary: true,
  legend: true, reference: null, items: [{ code: "A", count: 2 }] };

test("导出内容开关会改变实际纸张尺寸", () => {
  const full = Export.sheetSize(base);
  const plain = Export.sheetSize({ ...base, title: "", summary: false, legend: false, gridLines: false });
  assert.ok(full.height > plain.height + 80);
  assert.ok(full.pattern.width > plain.pattern.width);
  const withReference = Export.sheetSize({ ...base, reference: { width: 400, height: 200 } });
  assert.ok(withReference.height > full.height + 100);
});

test("PDF 包含 JPEG 图片且交叉引用偏移准确", async () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
  const blob = Export.pdfFromJpeg(jpeg, 800, 600);
  assert.equal(blob.type, "application/pdf");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.match(text, /\/Subtype \/Image \/Width 800 \/Height 600/);
  assert.ok(text.includes("/Filter /DCTDecode /Length 4"));
  const xref = Number(text.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(text.slice(xref, xref + 4), "xref");
  const entries = text.slice(xref).match(/^\d{10} 00000 n /gm);
  assert.equal(entries.length, 5);
  for (let n = 1; n <= 5; n++) {
    const offset = Number(entries[n - 1].slice(0, 10));
    assert.equal(text.slice(offset, offset + 7), `${n} 0 obj`);
  }
});
