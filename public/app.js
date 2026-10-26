(() => {
  "use strict";
  const Core = PindouCore, Pal = PindouPalettes, R = PindouRender;
  const $ = (id) => document.getElementById(id);
  const LS_KEY = "pindou.config.v1";
  const MIN_SIDE = 5, MAX_SIDE = 100, MAX_FILE = 15 * 1024 * 1024;

  const DEFAULTS = {
    width: 40, height: 40, lock: true, fit: "cover",
    palette: "full", maxColors: 24, dither: false, blank: true,
    brightness: 0, contrast: 0, saturation: 0,
    style: "circle", zoom: 22, showGrid: true, showCodes: true, emph: 5, board: 0,
  };
  // 改了这些要重新生成图纸；其余只影响显示
  const GEN_KEYS = new Set(["width", "height", "lock", "fit", "palette", "maxColors", "dither", "blank",
    "brightness", "contrast", "saturation"]);
  const KEYS = Object.keys(DEFAULTS);

  const clampSide = (n) => Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(n) || MIN_SIDE));

  // ---------- 配置（只存偏好，不含图片） ----------
  function loadCfg() {
    const cfg = { ...DEFAULTS };
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      for (const k of KEYS) if (typeof raw[k] === typeof DEFAULTS[k]) cfg[k] = raw[k];
    } catch { /* 没有存储或内容损坏：用默认值 */ }
    cfg.width = clampSide(cfg.width); cfg.height = clampSide(cfg.height);
    return cfg;
  }
  const saveCfg = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* 隐私模式等 */ } };
  const cfg = loadCfg();

  const state = {
    img: null,                 // { el, w, h, name }
    W: 0, H: 0, grid: null, palette: [],
    edited: false, stale: false,
    tool: "view", brush: -1, highlight: -1,
  };

  function toast(msg, bad) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "show" + (bad ? " bad" : "");
    clearTimeout(toast.h);
    toast.h = setTimeout(() => { t.className = ""; }, bad ? 6000 : 2500);
  }

  // ---------- 色板 ----------
  const palCache = {};
  function currentPalette() {
    const p = Pal.byId(cfg.palette);
    if (!palCache[p.id]) palCache[p.id] = Core.makePalette(p.colors);
    return palCache[p.id];
  }

  // ---------- 控件 ----------
  const ctl = (k) => $("c-" + k);
  const OUT = {
    maxColors: (v) => (v === 0 ? "不限" : v + " 色"),
    brightness: (v) => (v > 0 ? "+" + v : String(v)),
    contrast: (v) => (v > 0 ? "+" + v : String(v)),
    saturation: (v) => (v > 0 ? "+" + v : String(v)),
    zoom: (v) => v + " px",
  };

  function writeControls() {
    for (const k of KEYS) {
      const el = ctl(k);
      if (el.type === "checkbox") el.checked = cfg[k]; else el.value = String(cfg[k]);
      if (OUT[k]) $("o-" + k).textContent = OUT[k](cfg[k]);
    }
  }

  function readControl(k) {
    const el = ctl(k);
    if (el.type === "checkbox") return el.checked;
    return typeof DEFAULTS[k] === "number" ? Number(el.value) : el.value;
  }

  function initPaletteSelect() {
    ctl("palette").replaceChildren(...Pal.palettes.map((p) => {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name;
      return o;
    }));
    if (!Pal.palettes.some((p) => p.id === cfg.palette)) cfg.palette = DEFAULTS.palette;
  }

  function syncMaxColorsRange() {
    const n = currentPalette().length;
    ctl("maxColors").max = String(n);
    if (cfg.maxColors > n) cfg.maxColors = n;
  }

  function onControl(k) {
    let v = readControl(k);
    if (k === "width" || k === "height") v = clampSide(v);
    if (k === "board") v = Math.max(0, Math.min(MAX_SIDE, Math.round(v) || 0));
    cfg[k] = v;
    const ratio = state.img && cfg.lock ? state.img.h / state.img.w : null;
    if (ratio && (k === "width" || k === "lock")) cfg.height = clampSide(cfg.width * ratio);
    if (ratio && k === "height") cfg.width = clampSide(cfg.height / ratio);
    if (k === "palette") syncMaxColorsRange();
    writeControls();
    saveCfg();
    if (GEN_KEYS.has(k)) configChanged(k); else redraw();
  }

  // ---------- 生成 ----------
  let regenTimer = 0;
  const scheduleRegen = () => { clearTimeout(regenTimer); regenTimer = setTimeout(regenerate, 120); };

  function configChanged(k) {
    if (state.img) {
      if (state.edited) { state.stale = true; updateBanner(); } else scheduleRegen();
    } else {
      adaptBlank(k);
    }
  }

  /** 没有图片时，改尺寸/色板不丢已画内容：尺寸取交集，换色板按最接近的颜色重映射。 */
  function adaptBlank(k) {
    if (!state.grid) return regenerate();
    const oldPal = state.palette;
    const pal = currentPalette();
    if (k === "palette" && pal !== oldPal) {
      const all = pal.map((_, i) => i);
      state.grid = state.grid.map((idx) => (idx < 0 ? -1 : Core.nearest(pal, all, ...oldPal[idx].rgb)));
      state.palette = pal;
      state.brush = -1;
      renderSwatches();
    }
    if (cfg.width !== state.W || cfg.height !== state.H) {
      const next = new Int16Array(cfg.width * cfg.height).fill(-1);
      for (let y = 0; y < Math.min(state.H, cfg.height); y++)
        for (let x = 0; x < Math.min(state.W, cfg.width); x++) next[y * cfg.width + x] = state.grid[y * state.W + x];
      state.grid = next; state.W = cfg.width; state.H = cfg.height;
    }
    state.highlight = -1;
    redraw(); renderStats();
  }

  /** 把图片按适配方式取成 W×H 像素。逐级减半缩小，避免一步缩太多造成锯齿/丢细节。 */
  function rasterize(img, W, H, fit, whiteBg) {
    let sx = 0, sy = 0, sW = img.w, sH = img.h, dx = 0, dy = 0, dW = W, dH = H;
    if (fit === "cover") {
      const s = Math.max(W / img.w, H / img.h);
      sW = W / s; sH = H / s; sx = (img.w - sW) / 2; sy = (img.h - sH) / 2;
    } else if (fit === "contain") {
      const s = Math.min(W / img.w, H / img.h);
      dW = img.w * s; dH = img.h * s; dx = (W - dW) / 2; dy = (H - dH) / 2;
    }
    let src = img.el, rect = [sx, sy, sW, sH], cw = sW, ch = sH;
    while (cw > dW * 2 && ch > dH * 2) {
      const nw = Math.ceil(cw / 2), nh = Math.ceil(ch / 2);
      const c = document.createElement("canvas");
      c.width = nw; c.height = nh;
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(src, ...rect, 0, 0, nw, nh);
      src = c; rect = [0, 0, nw, nh]; cw = nw; ch = nh;
    }
    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    const g = out.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    if (whiteBg) { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); }
    g.drawImage(src, ...rect, dx, dy, dW, dH);
    return g.getImageData(0, 0, W, H);
  }

  function regenerate() {
    clearTimeout(regenTimer);
    const pal = currentPalette();
    state.palette = pal; state.W = cfg.width; state.H = cfg.height;
    if (state.img) {
      const data = rasterize(state.img, state.W, state.H, cfg.fit, !cfg.blank);
      Core.adjust(data.data, cfg);
      state.grid = Core.quantize(data.data, state.W, state.H, pal, {
        dither: cfg.dither, maxColors: cfg.maxColors, alphaCut: cfg.blank ? 128 : 0,
      }).grid;
    } else {
      state.grid = new Int16Array(state.W * state.H).fill(-1);
    }
    state.edited = false; state.stale = false; state.highlight = -1; state.brush = -1;
    updateBanner(); renderSwatches(); redraw(); renderStats();
  }

  function updateBanner() {
    $("stale").hidden = !state.stale;
    const b = $("b-regen");
    b.hidden = !state.edited;
    b.textContent = state.img ? "按当前配置重新生成" : "清空画布";
  }

  // ---------- 图片输入 ----------
  async function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("请选择图片文件", true);
    if (file.size > MAX_FILE) return toast("图片超过 15 MB，请先缩小", true);
    if (state.edited && !confirm("当前图纸有手动修改，载入新图片会丢弃它们。继续？")) return;
    const url = URL.createObjectURL(file);
    try {
      const el = new Image();
      el.src = url;
      await el.decode();
      if (!el.naturalWidth || !el.naturalHeight) throw new Error("no size");
      state.img = { el, w: el.naturalWidth, h: el.naturalHeight, name: file.name };
    } catch {
      return toast("无法读取这张图片", true);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (cfg.lock) cfg.height = clampSide(cfg.width * state.img.h / state.img.w);
    writeControls(); saveCfg(); showImgInfo();
    regenerate();
  }

  function clearImage() {
    if (state.edited && !confirm("当前图纸有手动修改，移除图片会清空画布。继续？")) return;
    state.img = null; $("file").value = "";
    showImgInfo(); regenerate();
  }

  function showImgInfo() {
    const has = !!state.img;
    $("b-clear-img").hidden = !has;
    $("img-info").textContent = has
      ? `${state.img.name} · ${state.img.w}×${state.img.h}。图片只在本机浏览器里处理，不会上传。`
      : "也可以拖放到这里或直接粘贴。不选图片则从空白画布开始手动绘制。图片只在本机浏览器里处理，不会上传。";
  }

  // ---------- 绘制 ----------
  const cv = $("cv");
  const ctx = cv.getContext("2d");
  let logical = { width: 0, height: 0, m: 0 };

  function drawOpts(cell, highlight) {
    return {
      W: state.W, H: state.H, grid: state.grid, palette: state.palette, cell,
      style: cfg.style, showGrid: cfg.showGrid, showCodes: cfg.showCodes,
      emph: cfg.emph, board: cfg.board, highlight, axis: true, textColor: Core.textColor,
    };
  }

  let rafPending = false;
  function redraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; paint(); });
  }

  function paint() {
    if (!state.grid) return;
    const sz = R.patternSize(state.W, state.H, cfg.zoom, true);
    let dpr = window.devicePixelRatio || 1;
    while (dpr > 1 && sz.width * dpr * sz.height * dpr > 16e6) dpr = Math.max(1, dpr - 0.5);   // 限制画布内存
    cv.width = Math.round(sz.width * dpr); cv.height = Math.round(sz.height * dpr);
    cv.style.width = sz.width + "px"; cv.style.height = sz.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R.drawPattern(ctx, drawOpts(cfg.zoom, state.highlight));
    logical = sz;
  }

  function renderStats() {
    const s = Core.summarize(state.grid, state.palette.length);
    $("stats").replaceChildren(...s.items.map((it) => {
      const p = state.palette[it.index];
      const li = document.createElement("li");
      li.dataset.idx = String(it.index);
      li.className = it.index === state.highlight ? "on" : "";
      const dot = document.createElement("span");
      dot.className = "dot"; dot.style.background = p.hex;
      const name = document.createElement("span");
      name.textContent = `${p.code} ${p.name}`;
      const n = document.createElement("span");
      n.className = "n"; n.textContent = "×" + it.count;
      li.append(dot, name, n);
      li.addEventListener("click", () => setHighlight(it.index === state.highlight ? -1 : it.index));
      return li;
    }));
    let t = s.total ? `· 共 ${s.total} 颗 · ${s.items.length} 色` : "· 还没有放豆";
    if (cfg.board > 0) t += ` · 约 ${Math.ceil(state.W / cfg.board) * Math.ceil(state.H / cfg.board)} 块拼板`;
    $("total").textContent = t;
    $("info").textContent = `${state.W} × ${state.H}`;
  }

  function setHighlight(idx) {
    state.highlight = idx;
    for (const li of $("stats").children) li.classList.toggle("on", Number(li.dataset.idx) === idx);
    redraw();
  }

  // ---------- 手动编辑 ----------
  function setTool(t) {
    state.tool = t;
    for (const [id, name] of [["t-view", "view"], ["t-pen", "pen"], ["t-erase", "erase"]])
      $(id).classList.toggle("on", name === t);
    $("swatches").hidden = t !== "pen";
    document.querySelector(".canvas-wrap").classList.toggle("drawing", t !== "view");
  }

  function renderSwatches() {
    $("swatches").replaceChildren(...state.palette.map((p, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sw" + (i === state.brush ? " on" : "");
      b.style.background = p.hex; b.title = `${p.code} ${p.name}`;
      b.setAttribute("aria-label", `${p.code} ${p.name}`);
      b.addEventListener("click", () => {
        state.brush = i;
        for (const el of $("swatches").children) el.classList.remove("on");
        b.classList.add("on");
      });
      return b;
    }));
  }

  function cellAt(ev) {
    const r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (logical.width / r.width) - logical.m;
    const y = (ev.clientY - r.top) * (logical.height / r.height) - logical.m;
    const cx = Math.floor(x / cfg.zoom), cy = Math.floor(y / cfg.zoom);
    return cx >= 0 && cy >= 0 && cx < state.W && cy < state.H ? cy * state.W + cx : -1;
  }

  let painting = false, dirty = false;
  function paintCell(i) {
    const v = state.tool === "erase" ? -1 : state.brush;
    if (state.tool === "pen" && v < 0) { toast("先在上方选一个颜色"); return; }
    if (state.grid[i] === v) return;
    state.grid[i] = v; dirty = true;
    if (!state.edited) { state.edited = true; updateBanner(); }
    redraw();
  }

  cv.addEventListener("pointerdown", (ev) => {
    const i = cellAt(ev);
    if (state.tool === "view") {
      const idx = i >= 0 ? state.grid[i] : -1;
      setHighlight(idx >= 0 && idx !== state.highlight ? idx : -1);
      return;
    }
    if (i < 0) return;
    ev.preventDefault();
    cv.setPointerCapture(ev.pointerId);
    painting = true;
    paintCell(i);
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!painting) return;
    const i = cellAt(ev);
    if (i >= 0) paintCell(i);
  });
  const endPaint = () => { if (painting && dirty) renderStats(); painting = false; dirty = false; };
  cv.addEventListener("pointerup", endPaint);
  cv.addEventListener("pointercancel", endPaint);

  // ---------- 导出 ----------
  function exportPng() {
    if (!state.grid) return;
    const s = Core.summarize(state.grid, state.palette.length);
    if (!s.total) return toast("图纸是空的，先放一些豆子", true);
    const cell = 32;
    const sz = R.patternSize(state.W, state.H, cell, true);
    const items = s.items.map((it) => ({ ...state.palette[it.index], count: it.count }));
    const width = Math.max(sz.width, 400);
    const lh = R.legendHeight(width, items.length);
    const c = document.createElement("canvas");
    c.width = width; c.height = sz.height + lh;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    R.drawPattern(g, drawOpts(cell, -1));
    R.drawLegend(g, {
      x: 0, y: sz.height, width, items, total: s.total, textColor: Core.textColor,
      title: `拼豆图纸 ${state.W}×${state.H} · 共 ${s.total} 颗 · ${items.length} 色`,
    });
    c.toBlob((blob) => {
      if (!blob) return toast("导出失败：图纸太大", true);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pindou-${state.W}x${state.H}.png`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }, "image/png");
  }

  // ---------- 事件 ----------
  for (const k of KEYS) {
    const el = ctl(k);
    const ev = el.type === "number" ? "change" : "input";
    el.addEventListener(ev, () => onControl(k));
  }
  $("b-reset-adj").addEventListener("click", () => {
    Object.assign(cfg, { brightness: 0, contrast: 0, saturation: 0 });
    writeControls(); saveCfg(); configChanged("brightness");
  });
  $("b-pick").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", (e) => loadFile(e.target.files[0]));
  $("b-clear-img").addEventListener("click", clearImage);
  $("b-regen").addEventListener("click", () => {
    if (state.edited && !confirm("将丢弃手动修改并重新生成。继续？")) return;
    regenerate();
  });
  $("b-export").addEventListener("click", exportPng);
  $("t-view").addEventListener("click", () => setTool("view"));
  $("t-pen").addEventListener("click", () => setTool("pen"));
  $("t-erase").addEventListener("click", () => setTool("erase"));

  const drop = $("drop");
  for (const t of ["dragenter", "dragover"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const t of ["dragleave", "drop"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));
  document.addEventListener("paste", (e) => {
    const f = [...(e.clipboardData ? e.clipboardData.files : [])].find((x) => x.type.startsWith("image/"));
    if (f) loadFile(f);
  });

  // ---------- 启动 ----------
  initPaletteSelect();
  syncMaxColorsRange();
  writeControls();
  showImgInfo();
  setTool("view");
  regenerate();
})();
