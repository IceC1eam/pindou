(() => {
  "use strict";
  const Core = PindouCore, Pal = PindouPalettes, R = PindouRender, Ref = PindouReference, Scene = PindouScene;
  const $ = (id) => document.getElementById(id);
  const show = (id, on) => { $(id).hidden = !on; };
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
  let refTool = "", crop = null, cropDrag = null;

  // 应用挂在 /pindou/ 下：一律用相对路径；写请求带 X-Requested-With（网关的 CSRF 约定）
  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
    if (init.method !== "GET") init.headers["X-Requested-With"] = "portal";
    if (opts.body) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    let r;
    try { r = await fetch(path.replace(/^\//, ""), init); }
    catch { throw { status: 0, kind: "network", message: "无法连接服务器" }; }
    let data = {};
    try { data = await r.json(); } catch { /* 非 JSON */ }
    if (!r.ok) {
      const e = data.error || {};
      throw { status: r.status, kind: e.kind || "http", message: e.message || "请求失败（" + r.status + "）" };
    }
    return data;
  }

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

  /** 色号的完整文字：有名称就“色号 名称”，名称和色号一样（或没有）就只写色号。 */
  const colorText = (p) => (p.name && p.name !== p.code ? `${p.code} ${p.name}` : p.code);

  function initPaletteSelect() {
    const groups = new Map();                        // 通用 / 国内品牌 / 国际品牌 分组显示
    for (const p of Pal.palettes) {
      if (!groups.has(p.group)) { const g = document.createElement("optgroup"); g.label = p.group; groups.set(p.group, g); }
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name;
      groups.get(p.group).append(o);
    }
    ctl("palette").replaceChildren(...groups.values());
    if (!Pal.palettes.some((p) => p.id === cfg.palette)) cfg.palette = DEFAULTS.palette;
  }

  function syncMaxColorsRange() {
    const n = currentPalette().length;
    ctl("maxColors").max = String(n);
    if (cfg.maxColors > n) cfg.maxColors = n;
    const p = Pal.byId(cfg.palette);
    $("pal-note").textContent = p.note || (p.brand
      ? "品牌色号取自公开色卡数据（见 README），屏幕颜色与实物豆子有色差，下单前请对照实物色卡。"
      : "通用色板的编号 P01… 是本应用的占位编号，不对应任何品牌。");
  }

  function onControl(k) {
    let v = readControl(k);
    if (k === "zoom") return setZoom(v);
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
      clampZoomToGrid();
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
    clampZoomToGrid();
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
    if (ai.busy) return toast("AI 正在处理，请完成后再更换参考图", true);
    if (state.img) return toast("请先清除当前图片，再上传另一张参考图", true);
    if (!file.type.startsWith("image/")) return toast("请选择图片文件", true);
    if (file.size > MAX_FILE) return toast("图片超过 15 MB，请先缩小", true);
    if (state.edited && !confirm("当前图纸有手动修改，载入新图片会丢弃它们。继续？")) return;
    const url = URL.createObjectURL(file);
    let el;
    try {
      el = new Image();
      el.src = url;
      await el.decode();
      if (!el.naturalWidth || !el.naturalHeight) throw new Error("no size");
    } catch {
      return toast("无法读取这张图片", true);
    } finally {
      URL.revokeObjectURL(url);
    }
    useImage(el, file.name);
  }

  /** 采用一张已解码的图片作为源图（本地选择或 AI 结果共用）。 */
  function useImage(el, name) {
    const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
    state.img = { base: el, el, w, h, name, key: null };
    $("key-color").value = "#ffffff";
    $("key-tolerance").value = "30"; $("key-value").textContent = "30";
    setRefTool("");
    if (cfg.lock) cfg.height = clampSide(cfg.width * state.img.h / state.img.w);
    writeControls(); saveCfg(); showImgInfo();
    regenerate();
  }

  function clearImage() {
    if (ai.busy) return toast("AI 正在处理，请稍后清除当前图片", true);
    if (state.edited && !confirm("当前图纸有手动修改，移除图片会清空画布。继续？")) return;
    clearToBlank();
  }

  function showImgInfo() {
    const has = !!state.img;
    $("b-pick").hidden = has;
    $("b-crop").hidden = !has;
    $("b-key").hidden = !has;
    $("b-clear-img").hidden = !has;
    $("key-reset").hidden = !has || !state.img.key;
    $("drop").classList.toggle("has-image", has);
    $("ai-text").placeholder = has ? "例如：把当前图片的背景改成蓝色" : "例如：一只戴红围巾的橘猫，可爱简洁";
    $("img-info").textContent = has
      ? `${state.img.name} · ${state.img.w}×${state.img.h}${state.img.key ? " · 已去边" : ""}`
      : "不选图片则从空白画布开始手动绘制。";
    drawRef();
    updateAiUi();
  }

  /** 左侧参考图预览；透明处由底部棋盘格显示。 */
  function drawRef() {
    const has = !!state.img;
    show("ref-cv", has); show("ref-empty", !has);
    if (!has) return;
    const c = $("ref-cv"), s = Math.min(4, 900 / Math.max(state.img.w, state.img.h));
    c.width = Math.max(1, Math.round(state.img.w * s)); c.height = Math.max(1, Math.round(state.img.h * s));
    const g = c.getContext("2d");
    g.drawImage(state.img.el, 0, 0, c.width, c.height);
    if (refTool === "crop" && crop) {
      const x = crop.x * c.width, y = crop.y * c.height, w = crop.w * c.width, h = crop.h * c.height;
      g.fillStyle = "rgba(12,13,18,.53)";
      g.fillRect(0, 0, c.width, y); g.fillRect(0, y, x, h);
      g.fillRect(x + w, y, c.width - x - w, h); g.fillRect(0, y + h, c.width, c.height - y - h);
      g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
      g.setLineDash([6, 4]); g.strokeStyle = "#14161a"; g.lineWidth = 1; g.strokeRect(x + 3, y + 3, Math.max(0, w - 6), Math.max(0, h - 6)); g.setLineDash([]);
    }
    $("crop-apply").disabled = !crop || crop.w * state.img.w < 8 || crop.h * state.img.h < 8;
  }

  // ---------- 参考图裁剪与边缘色度键 ----------
  function setRefTool(tool) {
    refTool = tool;
    crop = null; cropDrag = null;
    $("crop-tools").hidden = tool !== "crop";
    $("key-tools").hidden = tool !== "key";
    $("drop").classList.toggle("cropping", tool === "crop");
    $("b-crop").classList.toggle("on", tool === "crop");
    $("b-key").classList.toggle("on", tool === "key");
    drawRef();
  }

  function cropRatio() {
    const mode = $("crop-ratio").value;
    if (mode === "free") return 0;
    if (mode === "image") return state.img.w / state.img.h;
    return cfg.width / cfg.height;
  }

  function refPoint(e) {
    const r = $("ref-cv").getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }

  function startCrop(e) {
    if (refTool !== "crop" || !state.img || ai.busy) return;
    e.preventDefault();
    const p = refPoint(e);
    const inside = crop && p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h;
    cropDrag = { start: p, before: inside ? { ...crop } : null };
    if (!inside) crop = null;
    $("ref-cv").setPointerCapture(e.pointerId);
    drawRef();
  }

  function moveCrop(e) {
    if (!cropDrag || !state.img) return;
    e.preventDefault();
    const p = refPoint(e), d = cropDrag;
    if (d.before) crop = { ...d.before,
      x: Math.max(0, Math.min(1 - d.before.w, d.before.x + p.x - d.start.x)),
      y: Math.max(0, Math.min(1 - d.before.h, d.before.y + p.y - d.start.y)) };
    else crop = Ref.cropRect(d.start, p, cropRatio(), state.img.w, state.img.h);
    drawRef();
  }

  function endCrop(e) {
    if (!cropDrag) return;
    moveCrop(e);
    cropDrag = null;
  }

  function applyCrop() {
    if (!state.img || ai.busy || !crop || $("crop-apply").disabled || !confirmReplace()) return;
    const im = state.img, source = im.base;
    const W = source.naturalWidth || source.width, H = source.naturalHeight || source.height;
    const sx = Math.round(crop.x * W), sy = Math.round(crop.y * H);
    const sw = Math.min(W - sx, Math.max(1, Math.round(crop.w * W)));
    const sh = Math.min(H - sy, Math.max(1, Math.round(crop.h * H)));
    const scale = Math.min(1, 3000 / Math.max(sw, sh));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw * scale)); out.height = Math.max(1, Math.round(sh * scale));
    const before = { base: im.base, el: im.el, w: im.w, h: im.h, name: im.name };
    try {
      out.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
      im.base = out;
      if (im.key) rebuildKey();
      else { im.el = out; im.w = out.width; im.h = out.height; }
    } catch {
      Object.assign(im, before);
      return toast("裁剪失败：图片过大或无法读取像素", true);
    }
    im.name = im.name.replace(/（已裁剪）$/, "") + "（已裁剪）";
    if (cfg.lock) cfg.height = clampSide(cfg.width * im.h / im.w);
    writeControls(); saveCfg(); setRefTool(""); showImgInfo(); regenerate();
  }

  function rebuildKey() {
    const im = state.img, source = im.base;
    const W = source.naturalWidth || source.width, H = source.naturalHeight || source.height;
    const scale = Math.min(1, 2400 / Math.max(W, H));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(W * scale)); out.height = Math.max(1, Math.round(H * scale));
    const g = out.getContext("2d", { willReadFrequently: true });
    g.drawImage(source, 0, 0, out.width, out.height);
    const keyed = Ref.edgeChromaKey(g.getImageData(0, 0, out.width, out.height), im.key.color, im.key.tolerance);
    g.putImageData(new ImageData(keyed.data, keyed.width, keyed.height), 0, 0);
    im.el = out; im.w = out.width; im.h = out.height;
  }

  function applyKey() {
    if (!state.img || ai.busy || !confirmReplace()) return;
    const im = state.img, previous = im.key;
    im.key = { color: $("key-color").value, tolerance: Number($("key-tolerance").value) };
    try { rebuildKey(); }
    catch (e) { im.key = previous; return toast("去边失败：图片过大或无法读取像素", true); }
    showImgInfo(); regenerate();
  }

  function resetKey() {
    if (!state.img || !state.img.key || ai.busy || !confirmReplace()) return;
    const im = state.img;
    im.key = null; im.el = im.base;
    im.w = im.base.naturalWidth || im.base.width;
    im.h = im.base.naturalHeight || im.base.height;
    showImgInfo(); regenerate();
  }

  function sampleKeyColor() {
    if (!state.img) return;
    const source = state.img.base, c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(source, 0, 0, c.width, c.height);
    $("key-color").value = Ref.dominantEdgeColor(g.getImageData(0, 0, c.width, c.height));
  }

  // ---------- AI（服务端代理火山方舟；密钥不在浏览器里） ----------
  const ai = { enabled: false, remaining: 0, busy: "", presets: [] };
  const PRESET_KEY = "pindou.ai.preset";
  const chat = [];                           // 只保留文字记录，图片始终只有 state.img 一张
  const preset = () => $("ai-preset").value || undefined;
  const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function updateAiUi() {
    const off = !ai.enabled || !!ai.busy || ai.remaining <= 0;
    const has = !!state.img;
    $("ai-gen").hidden = has;
    $("ai-edit").hidden = !has;
    $("ai-gen").disabled = off;
    $("ai-edit").disabled = off;
    $("b-pick").disabled = !!ai.busy;
    $("b-clear-img").disabled = !!ai.busy;
    $("b-crop").disabled = !!ai.busy;
    $("b-key").disabled = !!ai.busy;
    $("crop-apply").disabled = !!ai.busy || !crop || !state.img || crop.w * state.img.w < 8 || crop.h * state.img.h < 8;
    $("key-apply").disabled = !!ai.busy;
    $("key-reset").disabled = !!ai.busy;
    $("ai-preset").disabled = !!ai.busy;
    const st = $("ai-status");
    st.classList.remove("bad");
    if (ai.busy) st.textContent = ai.busy;
    else if (!ai.enabled) { st.textContent = "AI 功能尚未启用（服务器还没有配置密钥）。"; st.classList.add("bad"); }
    else st.textContent = ai.remaining < 10 ? `今日还可出图 ${ai.remaining} 次` : "";
    st.hidden = !st.textContent;
    renderChat();
  }

  function chatItem(m) {
    const li = mk("li", "msg " + m.role);
    if (m.role === "user") {
      li.append(mk("span", "tag", m.mode === "edit" ? "修改" : "生成"), mk("div", "bubble", m.text));
      return li;
    }
    if (m.role === "err") { li.append(mk("div", "bubble", m.text)); return li; }
    li.append(mk("div", "bubble", m.text || "已更新当前参考图。"));
    return li;
  }

  function renderChat() {
    const log = $("chat-log");
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
    const items = chat.map(chatItem);
    if (ai.busy) items.push(mk("li", "msg ai pending", ai.busy));
    log.replaceChildren(...items);
    log.hidden = items.length === 0;
    if (stick || ai.busy) log.scrollTop = log.scrollHeight;
  }

  function toLogin() { location.href = "/?next=" + encodeURIComponent(location.pathname); }

  async function loadAiStatus() {
    try {
      const s = await api("api/ai/status");
      ai.enabled = s.enabled; ai.remaining = s.remaining; ai.presets = s.presets;
      let saved = "";
      try { saved = localStorage.getItem(PRESET_KEY) || ""; } catch { /* 隐私模式等 */ }
      const sel = $("ai-preset");
      sel.replaceChildren(...s.presets.map((p) => {
        const o = document.createElement("option");
        o.value = p.id; o.textContent = p.label;
        return o;
      }));
      sel.value = s.presets.some((p) => p.id === saved) ? saved : s.default_preset;
    } catch (e) {
      if (e.status === 401) return toLogin();
      ai.enabled = false;
    }
    updateAiUi();
  }

  function setAiBusy(msg) { ai.busy = msg || ""; updateAiUi(); }

  function aiFail(e) {
    if (e.status === 401) return toLogin();
    chat.push({ role: "err", text: e.message });
    toast(e.message, true);
    if (e.kind === "quota") ai.remaining = 0;
  }

  /** 把一张源图缩到 1536 以内、白底铺平后转 JPEG，作为“待修改”的图片发给服务端。 */
  function sourceDataUrl(im) {
    const s = Math.min(1, 1536 / Math.max(im.w, im.h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(im.w * s)); c.height = Math.max(1, Math.round(im.h * s));
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(im.el, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.92);
  }

  /** 修改只使用当前参考图作为底图；完成后直接替换它。 */
  async function aiDraw(mode, plan, base, reply) {
    setAiBusy("正在画图，通常需要 10–40 秒…");
    const body = { mode, prompt: plan.prompt, ratio: plan.ratio || "1:1", preset: preset() };
    if (mode === "edit") body.image = sourceDataUrl(base);
    const res = await api("api/ai/image", { method: "POST", body });
    ai.remaining = res.remaining;
    const el = new Image();
    el.src = res.image;
    await el.decode();
    if (mode === "generate") {              // 新图：采用助理建议的尺寸与用色数；修改时保持你现有的配置
      if (plan.width) cfg.width = clampSide(plan.width);
      if (plan.height && !cfg.lock) cfg.height = clampSide(plan.height);
      if (plan.max_colors) cfg.maxColors = Math.min(plan.max_colors, currentPalette().length);
    }
    const name = mode === "edit" ? "AI 修改的图片" : "AI 生成的图片";
    chat.push({ role: "ai", text: reply || "已更新当前参考图。" });
    useImage(el, name);
  }

  const confirmReplace = () => !state.edited || confirm("当前图纸有手动修改，更换参考图会丢弃它们。继续？");

  async function aiRun(mode) {
    if (ai.busy) return;
    if (mode === "generate" && state.img) return toast("请先清除当前图片，再生成新图", true);
    if (mode === "edit" && !state.img) return toast("请先上传或生成一张参考图", true);
    const text = $("ai-text").value.trim();
    if (!text) return toast("先描述一下你想要的内容", true);
    if (!confirmReplace()) return;
    const base = state.img;
    chat.push({ role: "user", mode, text });
    $("ai-text").value = "";
    try {
      setAiBusy("正在理解你的需求…");
      const plan = await api("api/ai/plan", { method: "POST", body: { text, mode, preset: preset() } });
      await aiDraw(mode, plan, base, plan.reply);
    } catch (e) {
      aiFail(e);
      if (!$("ai-text").value) $("ai-text").value = text;     // 失败了把话还给用户，方便重试
    } finally { setAiBusy(""); }
  }

  function clearToBlank() {
    state.img = null; $("file").value = "";
    setRefTool("");
    showImgInfo(); regenerate();
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
    updateZoomUi();
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
      name.textContent = colorText(p);
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
    schedulePreview();
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
    $("wrap").classList.toggle("drawing", t !== "view");
  }

  function renderSwatches() {
    $("swatches").replaceChildren(...state.palette.map((p, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sw" + (i === state.brush ? " on" : "");
      b.style.background = p.hex; b.title = colorText(p);
      b.setAttribute("aria-label", colorText(p));
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

  // ---------- 视图：缩放与拖动 ----------
  // PC：滚轮缩放（以光标为中心）、拖动移动、画笔/橡皮模式下按住空格或鼠标中键拖动。
  // 触屏：查看模式单指拖动；画笔/橡皮模式单指涂画；任何模式双指捏合缩放并移动。
  const wrap = $("wrap");
  const MIN_ZOOM = 4, BASE_ZOOM = 22;
  function maxZoom() { return Math.max(12, Math.min(64, Math.floor(Math.sqrt(25e6 / Math.max(1, state.W * state.H))))); }
  const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(maxZoom(), Math.round(z)));
  function clampZoomToGrid() { if (cfg.zoom > maxZoom()) { cfg.zoom = maxZoom(); writeControls(); } }
  let zf = cfg.zoom;                       // 滚轮累积用的浮点缩放（整数缩放对触控板的小步长不灵敏）

  function updateZoomUi() {
    $("z-label").textContent = Math.round(cfg.zoom / BASE_ZOOM * 100) + "%";
    $("z-out").disabled = cfg.zoom <= MIN_ZOOM;
    $("z-in").disabled = cfg.zoom >= maxZoom();
  }

  /** 视口内一点 → 它下面的格子坐标（小数）。 */
  function viewCell(px, py) {
    return { cx: (wrap.scrollLeft + px - logical.m) / cfg.zoom, cy: (wrap.scrollTop + py - logical.m) / cfg.zoom };
  }

  /** 缩放到 z，并让格子坐标 (cx, cy) 落在视口点 (px, py) 上。 */
  function placeView(z, cx, cy, px, py) {
    z = clampZoom(z);
    if (z !== cfg.zoom) { cfg.zoom = z; saveCfg(); paint(); }     // 同步重画，下面才能按新尺寸设置滚动位置
    writeControls();
    wrap.scrollLeft = cx * z + logical.m - px;
    wrap.scrollTop = cy * z + logical.m - py;
    updateZoomUi();
  }

  function setZoom(z, px = wrap.clientWidth / 2, py = wrap.clientHeight / 2) {
    const { cx, cy } = viewCell(px, py);
    placeView(z, cx, cy, px, py);
  }

  function fitZoom() {
    const m = logical.m || 28;
    const zw = Math.floor((wrap.clientWidth - m - 10) / state.W);
    const zh = Math.floor((window.innerHeight * 0.78 - m - 10) / state.H);   // 画布区最高 78vh；不能用它此刻的高度（缩小后会变矮）
    placeView(Math.min(zw, zh), 0, 0, m, m);
    zf = cfg.zoom;
  }

  wrap.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    if (Math.abs(zf - cfg.zoom) > 1) zf = cfg.zoom;
    zf = Math.max(MIN_ZOOM, Math.min(maxZoom(), zf * Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0018))));
    const r = wrap.getBoundingClientRect();
    setZoom(zf, ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  const zoomStep = (dir) => setZoom(cfg.zoom + dir * Math.max(1, Math.round(cfg.zoom * 0.2)));
  $("z-in").addEventListener("click", () => { zoomStep(1); zf = cfg.zoom; });
  $("z-out").addEventListener("click", () => { zoomStep(-1); zf = cfg.zoom; });
  $("z-fit").addEventListener("click", fitZoom);

  // ---------- 指针：涂画 / 拖动 / 捏合 ----------
  const pts = new Map();                   // 当前按下的指针
  let painting = false, dirty = false, pan = null, pinch = null, spaceDown = false, hover = false;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = () => {
    const [a, b] = [...pts.values()], r = wrap.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top, d: dist(a, b) };
  };

  function paintCell(i) {
    const v = state.tool === "erase" ? -1 : state.brush;
    if (state.tool === "pen" && v < 0) { toast("先在上方选一个颜色"); return; }
    if (state.grid[i] === v) return;
    state.grid[i] = v; dirty = true;
    if (!state.edited) { state.edited = true; updateBanner(); }
    redraw();
  }

  const endPaint = () => { if (painting && dirty) renderStats(); painting = false; dirty = false; };

  function highlightAt(ev) {
    const i = cellAt(ev);
    const idx = i >= 0 ? state.grid[i] : -1;
    setHighlight(idx >= 0 && idx !== state.highlight ? idx : -1);
  }

  cv.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button === 2) return;
    try { cv.setPointerCapture(ev.pointerId); } catch { /* 触点已失效 */ }
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 2) {                  // 双指：放弃正在进行的涂画/拖动，转为捏合
      endPaint(); pan = null; wrap.classList.remove("panning");
      const m = mid();
      pinch = { d0: Math.max(1, m.d), z0: cfg.zoom, ...viewCell(m.x, m.y) };
      return;
    }
    if (pts.size > 2) return;
    ev.preventDefault();
    if (state.tool === "view" || ev.button === 1 || spaceDown) {
      pan = { x: ev.clientX, y: ev.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop, moved: false, tap: ev.button === 0 && !spaceDown };
      wrap.classList.add("panning");
      return;
    }
    const i = cellAt(ev);
    if (i < 0) return;
    painting = true;
    paintCell(i);
  });

  cv.addEventListener("pointermove", (ev) => {
    const p = pts.get(ev.pointerId);
    if (!p) return;
    p.x = ev.clientX; p.y = ev.clientY;
    if (pinch && pts.size === 2) {
      const m = mid();
      placeView(pinch.z0 * m.d / pinch.d0, pinch.cx, pinch.cy, m.x, m.y);
      zf = cfg.zoom;
      return;
    }
    if (pan) {
      const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) > 4) pan.moved = true;
      if (pan.moved) { wrap.scrollLeft = pan.sl - dx; wrap.scrollTop = pan.st - dy; }
      return;
    }
    if (painting) {
      const i = cellAt(ev);
      if (i >= 0) paintCell(i);
    }
  });

  function endPointer(ev) {
    if (!pts.delete(ev.pointerId)) return;
    if (pinch) { if (pts.size < 2) pinch = null; return; }   // 捏合结束后剩下的手指不当作点击/涂画
    if (pan) {
      if (!pan.moved && pan.tap && state.tool === "view" && ev.type === "pointerup") highlightAt(ev);   // 轻点 = 高亮同色
      pan = null; wrap.classList.remove("panning");
    }
    endPaint();
  }
  cv.addEventListener("pointerup", endPointer);
  cv.addEventListener("pointercancel", endPointer);

  wrap.addEventListener("mouseenter", () => { hover = true; });
  wrap.addEventListener("mouseleave", () => { hover = false; });
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !hover || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (document.activeElement.tagName === "BUTTON") document.activeElement.blur();   // 刚点过色块时，空格不能变成“再点一次”
    e.preventDefault(); spaceDown = true; wrap.classList.add("hand");
  });
  document.addEventListener("keyup", (e) => { if (e.code === "Space") { spaceDown = false; wrap.classList.remove("hand"); } });

  // ---------- 烫豆效果预览 ----------
  const EFFECT_KEY = "pindou.effect";
  const CMP_CELL = 16, CMP_K = 8, CMP_PAD = 6;
  let effect = "flat", pvTimer = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let cameraPlaying = !reducedMotion.matches, cameraPhase = 0, cameraLast = 0, cameraFrame = 0;
  let sceneData = null, sceneWidth = 0, sceneHeight = 0;
  try { const e = localStorage.getItem(EFFECT_KEY); if (R.EFFECTS.some((x) => x.id === e)) effect = e; } catch { /* 隐私模式等 */ }
  const cmpCv = new Map();                 // 效果 id → 对比小图的 canvas

  /** 按设备像素比设置画布大小（最多 2 倍），返回 2d 上下文。 */
  const pvDpr = () => Math.min(2, window.devicePixelRatio || 1);
  function sizedCanvas(c, w, h) {
    const dpr = pvDpr();
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + "px"; c.style.height = h + "px";
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 120); }

  function drawPreviewScene() {
    if (!sceneData) return;
    const progress = (1 - Math.cos(cameraPhase)) / 2;   // 两端速度归零，正面 ↔ 侧面平滑往返
    Scene.drawScene($("pv").getContext("2d"), { ...sceneData, width: sceneWidth, height: sceneHeight,
      angle: progress * 1.18, elevation: 0.92 - progress * 0.47 });
  }

  function animateCamera(now) {
    cameraFrame = 0;
    if (!cameraPlaying || !sceneData || !$("pv-box").open || document.hidden) return;
    if (cameraLast && now - cameraLast < 32) {
      cameraFrame = requestAnimationFrame(animateCamera);
      return;
    }
    if (cameraLast) cameraPhase += Math.min(now - cameraLast, 100) * Math.PI * 2 / 14000;
    if (cameraPhase > Math.PI * 2) cameraPhase %= Math.PI * 2;
    cameraLast = now;
    drawPreviewScene();
    cameraFrame = requestAnimationFrame(animateCamera);
  }

  function syncCamera() {
    $("pv-motion").textContent = cameraPlaying ? "暂停镜头" : "播放镜头";
    $("pv-motion").setAttribute("aria-pressed", String(!cameraPlaying));
    cancelAnimationFrame(cameraFrame); cameraFrame = 0; cameraLast = 0;
    if (cameraPlaying && sceneData && $("pv-box").open && !document.hidden)
      cameraFrame = requestAnimationFrame(animateCamera);
  }

  function setEffect(id) {
    effect = id;
    try { localStorage.setItem(EFFECT_KEY, id); } catch { /* 隐私模式等 */ }
    renderPreview();
  }

  function initPreview() {
    $("pv-cmp").replaceChildren(...R.EFFECTS.map((f) => {
      const b = mk("button", "cmp");
      b.type = "button"; b.title = f.note;
      const c = mk("canvas");
      cmpCv.set(f.id, c);
      b.append(c, mk("span", "cn", f.name));
      b.addEventListener("click", () => setEffect(f.id));
      return b;
    }));
  }

  function renderPreview() {
    if (!$("pv-box").open || !state.grid) return;
    const total = Core.summarize(state.grid, state.palette.length).total;
    show("pv-empty", !total); show("pv-body", !!total);
    if (!total) { sceneData = null; syncCamera(); return; }
    const avail = Math.max(160, $("pv-main").clientWidth);
    const cell = Math.max(4, Math.min(20, Math.floor(1200 / Math.max(state.W, state.H))));
    const base = { W: state.W, H: state.H, grid: state.grid, palette: state.palette };
    const texture = document.createElement("canvas");
    texture.width = state.W * cell; texture.height = state.H * cell;
    R.drawFused(texture.getContext("2d"), { ...base, cell, effect, pad: 0, transparent: true });
    sceneData = { ...base, texture };
    sceneWidth = avail;
    sceneHeight = Math.max(290, Math.min(500, Math.round(avail * 0.65)));
    sizedCanvas($("pv"), sceneWidth, sceneHeight);
    drawPreviewScene();
    syncCamera();
    const crop = R.pickCrop(state.W, state.H, state.grid, CMP_K);
    for (const f of R.EFFECTS) {
      const c = cmpCv.get(f.id);
      R.drawFused(sizedCanvas(c, crop.w * CMP_CELL + 2 * CMP_PAD, crop.h * CMP_CELL + 2 * CMP_PAD),
        { ...base, cell: CMP_CELL, effect: f.id, pad: CMP_PAD, crop, dpr: pvDpr() });
      c.parentElement.classList.toggle("on", f.id === effect);
    }
    $("pv-note").textContent = "· " + R.EFFECTS.find((f) => f.id === effect).note;
  }

  function exportEffect() {
    if (!sceneData) return toast("图纸是空的，先放一些豆子", true);
    const factor = Math.max(1, Math.min(3, 1800 / sceneWidth));
    const c = document.createElement("canvas");
    c.width = Math.round(sceneWidth * factor); c.height = Math.round(sceneHeight * factor);
    const g = c.getContext("2d"); g.scale(factor, factor);
    const progress = (1 - Math.cos(cameraPhase)) / 2;
    Scene.drawScene(g, { ...sceneData, width: sceneWidth, height: sceneHeight,
      angle: progress * 1.18, elevation: 0.92 - progress * 0.47 });
    c.toBlob((blob) => {
      if (!blob) return toast("导出失败：图纸太大", true);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pindou-${effect}-${state.W}x${state.H}.png`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }, "image/png");
  }

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
  $("b-crop").addEventListener("click", () => setRefTool(refTool === "crop" ? "" : "crop"));
  $("b-key").addEventListener("click", () => setRefTool(refTool === "key" ? "" : "key"));
  $("crop-ratio").addEventListener("change", () => { crop = null; drawRef(); });
  $("crop-apply").addEventListener("click", applyCrop);
  $("crop-clear").addEventListener("click", () => { crop = null; drawRef(); });
  $("crop-cancel").addEventListener("click", () => setRefTool(""));
  $("ref-cv").addEventListener("pointerdown", startCrop);
  $("ref-cv").addEventListener("pointermove", moveCrop);
  $("ref-cv").addEventListener("pointerup", endCrop);
  $("ref-cv").addEventListener("pointercancel", () => { cropDrag = null; });
  $("key-tolerance").addEventListener("input", () => { $("key-value").textContent = $("key-tolerance").value; });
  $("key-sample").addEventListener("click", sampleKeyColor);
  $("key-apply").addEventListener("click", applyKey);
  $("key-reset").addEventListener("click", resetKey);
  $("b-regen").addEventListener("click", () => {
    if (state.edited && !confirm("将丢弃手动修改并重新生成。继续？")) return;
    regenerate();
  });
  $("b-export").addEventListener("click", exportPng);
  $("pv-export").addEventListener("click", exportEffect);
  $("pv-motion").addEventListener("click", () => { cameraPlaying = !cameraPlaying; syncCamera(); });
  $("pv-box").addEventListener("toggle", () => { if ($("pv-box").open) schedulePreview(); else syncCamera(); });
  document.addEventListener("visibilitychange", syncCamera);
  window.addEventListener("resize", schedulePreview);
  $("ai-gen").addEventListener("click", () => aiRun("generate"));
  $("ai-edit").addEventListener("click", () => aiRun("edit"));
  $("ai-preset").addEventListener("change", () => {
    try { localStorage.setItem(PRESET_KEY, $("ai-preset").value); } catch { /* 隐私模式等 */ }
    updateAiUi();
  });
  $("t-view").addEventListener("click", () => setTool("view"));
  $("t-pen").addEventListener("click", () => setTool("pen"));
  $("t-erase").addEventListener("click", () => setTool("erase"));

  const drop = $("drop");
  for (const t of ["dragenter", "dragover"]) drop.addEventListener(t, (e) => { e.preventDefault(); if (!state.img && !ai.busy) drop.classList.add("over"); });
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
  initPreview();
  syncCamera();
  regenerate();
  loadAiStatus();
})();
