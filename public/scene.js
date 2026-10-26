/* 桌面上的烫豆成品：Canvas 2D 正交投影，无外部 3D 依赖。 */
(function (root) {
  "use strict";
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const OBJECTS = {
    iphone16: { name: "iPhone 16", widthMm: 71.6, heightMm: 147.6, depthMm: 7.8 },
    card: { name: "标准银行卡", widthMm: 85.6, heightMm: 53.98, depthMm: 0.76 },
  };

  /** 场景以一颗豆的中心间距为 1 单位，实物毫米尺寸换算成同一坐标系。 */
  function physicalLayout(W, H, beadMm, reference) {
    const mm = [2.5, 5, 10].includes(Number(beadMm)) ? Number(beadMm) : 5;
    const spec = OBJECTS[reference] || null;
    const gap = Math.max(2, 10 / mm);
    const object = spec && { ...spec, x: W / 2 + gap, z: -spec.heightMm / mm / 2,
      w: spec.widthMm / mm, h: spec.heightMm / mm, depth: spec.depthMm / mm };
    const margin = Math.max(2.5, Math.min(W, H) * 0.1);
    const left = -W / 2 - margin;
    const right = Math.max(W / 2, object ? object.x + object.w : W / 2) + margin;
    const back = Math.min(-H / 2, object ? object.z : -H / 2) - margin;
    const front = Math.max(H / 2, object ? object.z + object.h : H / 2) + margin;
    return { beadMm: mm, object, table: { left, right, back, front },
      artWidthMm: W * mm, artHeightMm: H * mm };
  }

  function rounded(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** angle 从正面 0 转到右侧约 1.2 弧度；elevation 是相机高出桌面的角度。 */
  function drawScene(ctx, o) {
    const { width, height, W, H, grid, palette, texture } = o;
    const angle = o.angle == null ? 0 : o.angle;
    const elevation = o.elevation == null ? 0.85 : o.elevation;
    const ca = Math.cos(angle), sa = Math.sin(angle), se = Math.sin(elevation), ce = Math.cos(elevation);
    const layout = physicalLayout(W, H, o.beadMm, o.reference);
    const { left, right, back, front } = layout.table;
    const thick = 0.32, edge = 12 / layout.beadMm;
    // 正交镜头：世界坐标 x 为横向，z 为桌面纵向，y 为高度。
    const raw = (x, z, y = 0) => ({ x: x * ca - z * sa, y: (x * sa + z * ca) * se - y * ce });
    const corners = [[left, back], [right, back], [right, front], [left, front]];
    const bounds = corners.map(([x, z]) => raw(x, z));
    const us = bounds.map((p) => p.x), vs = bounds.map((p) => p.y);
    const minX = Math.min(...us), maxX = Math.max(...us);
    const maxObjectHeight = Math.max(thick, layout.object ? layout.object.depth : 0);
    const minY = Math.min(...vs) - maxObjectHeight * ce, maxY = Math.max(...vs) + edge * ce;
    const scale = Math.min((width - 34) / (maxX - minX), (height - 38) / (maxY - minY));
    const ox = width / 2 - (minX + maxX) * scale / 2;
    const oy = height / 2 - (minY + maxY) * scale / 2;
    const P = (x, z, y = 0) => { const p = raw(x, z, y); return { x: ox + p.x * scale, y: oy + p.y * scale }; };
    const path = (points) => {
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
    };
    const quad = (coords, color) => { path(coords.map(([x, z, y]) => P(x, z, y))); ctx.fillStyle = color; ctx.fill(); };

    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#f5f0e8"); bg.addColorStop(1, "#dfd6c9");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);

    // 桌面厚度和桌面边缘，随镜头一起转动。
    quad([[left, front, 0], [right, front, 0], [right, front, -edge], [left, front, -edge]], "#a77d5d");
    quad([[right, back, 0], [right, front, 0], [right, front, -edge], [right, back, -edge]], "#8d654b");
    const top = corners.map(([x, z]) => P(x, z));
    path(top);
    const wood = ctx.createLinearGradient(top[0].x, top[0].y, top[2].x, top[2].y);
    wood.addColorStop(0, "#d8b894"); wood.addColorStop(0.55, "#e2c5a4"); wood.addColorStop(1, "#caa681");
    ctx.fillStyle = wood; ctx.fill();
    ctx.save(); path(top); ctx.clip();
    ctx.strokeStyle = "rgba(104,68,41,.10)"; ctx.lineWidth = 1;
    for (let i = 0; i < 28; i++) {
      const z = back + (i + 0.35 * Math.sin(i * 2.7)) * ((front - back) / 28);
      const a = P(left, z), b = P(right, z + 0.06 * Math.sin(i * 4.1));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(91,62,42,.25)"; ctx.lineWidth = 1.2; path(top); ctx.stroke();

    // 与桌面接触的柔和投影只由透明贴图的轮廓产生。
    const srcW = texture.width, srcH = texture.height;
    function imageAt(y, shadow) {
      const p0 = P(-W / 2, -H / 2, y), px = P(W / 2, -H / 2, y), pz = P(-W / 2, H / 2, y);
      ctx.save();
      if (shadow) {
        ctx.shadowColor = "rgba(43,31,23,.42)";
        ctx.shadowBlur = clamp(scale * 0.7, 8, 23);
        ctx.shadowOffsetX = scale * 0.22;
        ctx.shadowOffsetY = scale * 0.35;
      }
      ctx.transform((px.x - p0.x) / srcW, (px.y - p0.y) / srcW,
        (pz.x - p0.x) / srcH, (pz.y - p0.y) / srcH, p0.x, p0.y);
      ctx.drawImage(texture, 0, 0);
      ctx.restore();
    }
    imageAt(thick, true);

    // 只画朝向镜头的外露侧壁；熨好的作品是有厚度的一整片。
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const idx = grid[j * W + i];
      if (idx < 0 || !palette[idx]) continue;
      const x = i - W / 2, z = j - H / 2;
      const rgb = palette[idx].rgb;
      const side = (factor) => `rgb(${rgb.map((v) => Math.round(v * factor)).join(",")})`;
      if (j === H - 1 || grid[(j + 1) * W + i] < 0)
        quad([[x, z + 1, thick], [x + 1, z + 1, thick], [x + 1, z + 1, 0], [x, z + 1, 0]], side(0.73));
      if (i === W - 1 || grid[j * W + i + 1] < 0)
        quad([[x + 1, z, thick], [x + 1, z + 1, thick], [x + 1, z + 1, 0], [x + 1, z, 0]], side(0.62));
    }
    imageAt(thick, false);

    // 与豆子共用世界坐标，镜头转动时参照物和成品始终保持实际比例。
    if (layout.object) {
      const ob = layout.object, { x, z, w, h, depth } = ob;
      const card = o.reference === "card";
      quad([[x, z + h, depth], [x + w, z + h, depth], [x + w, z + h, 0], [x, z + h, 0]], card ? "#718a91" : "#61666f");
      quad([[x + w, z, depth], [x + w, z + h, depth], [x + w, z + h, 0], [x + w, z, 0]], card ? "#5a737a" : "#494d56");
      const p0 = P(x, z, depth), px = P(x + 1, z, depth), pz = P(x, z + 1, depth);
      ctx.save();
      ctx.transform(px.x - p0.x, px.y - p0.y, pz.x - p0.x, pz.y - p0.y, p0.x, p0.y);
      ctx.shadowColor = "rgba(25,25,30,.42)"; ctx.shadowBlur = clamp(scale * 0.6, 8, 24);
      ctx.shadowOffsetX = 0.18 * scale; ctx.shadowOffsetY = 0.25 * scale;
      rounded(ctx, 0, 0, w, h, card ? 3 / layout.beadMm : 8 / layout.beadMm);
      ctx.fillStyle = card ? "#e8eff0" : "#adb3be"; ctx.fill();
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      if (card) {
        const face = ctx.createLinearGradient(0, 0, w, h);
        face.addColorStop(0, "#184c65"); face.addColorStop(0.6, "#197c85"); face.addColorStop(1, "#68bbb5");
        rounded(ctx, 0.08, 0.08, w - 0.16, h - 0.16, 2.7 / layout.beadMm);
        ctx.fillStyle = face; ctx.fill();
        rounded(ctx, w * 0.12, h * 0.3, w * 0.18, h * 0.23, 1 / layout.beadMm);
        ctx.fillStyle = "#d8ca9e"; ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.font = `600 ${Math.max(0.8, h * 0.11)}px system-ui`;
        ctx.fillText("••••  ••••  ••••", w * 0.1, h * 0.75);
      } else {
        const inset = 0.8 / layout.beadMm;
        rounded(ctx, inset, inset, w - 2 * inset, h - 2 * inset, 7 / layout.beadMm);
        ctx.fillStyle = "#101620"; ctx.fill();
        const screen = ctx.createLinearGradient(0, inset, w, h - inset);
        screen.addColorStop(0, "#183655"); screen.addColorStop(0.45, "#4a4592"); screen.addColorStop(1, "#d793a2");
        rounded(ctx, inset * 1.5, inset * 1.5, w - 3 * inset, h - 3 * inset, 6.5 / layout.beadMm);
        ctx.fillStyle = screen; ctx.fill();
        rounded(ctx, w * 0.35, h * 0.035, w * 0.3, h * 0.043, h * 0.022);
        ctx.fillStyle = "#090c13"; ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.textAlign = "center";
        ctx.font = `500 ${Math.max(1.5, w * 0.18)}px system-ui`;
        ctx.fillText("9:41", w / 2, h * 0.24);
      }
      ctx.restore();
    }
    return layout;
  }

  root.PindouScene = { drawScene, physicalLayout, OBJECTS };
})(typeof self !== "undefined" ? self : this);
