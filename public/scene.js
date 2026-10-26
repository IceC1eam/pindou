/* 桌面上的烫豆成品：Canvas 2D 正交投影，无外部 3D 依赖。 */
(function (root) {
  "use strict";
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** angle 从正面 0 转到右侧约 1.2 弧度；elevation 是相机高出桌面的角度。 */
  function drawScene(ctx, o) {
    const { width, height, W, H, grid, palette, texture } = o;
    const angle = o.angle == null ? 0 : o.angle;
    const elevation = o.elevation == null ? 0.85 : o.elevation;
    const ca = Math.cos(angle), sa = Math.sin(angle), se = Math.sin(elevation), ce = Math.cos(elevation);
    const margin = Math.max(2.5, Math.min(W, H) * 0.1);
    const tx = W / 2 + margin, tz = H / 2 + margin;
    const thick = 0.32, edge = 0.7;
    // 正交镜头：世界坐标 x 为横向，z 为桌面纵向，y 为高度。
    const raw = (x, z, y = 0) => ({ x: x * ca - z * sa, y: (x * sa + z * ca) * se - y * ce });
    const corners = [[-tx, -tz], [tx, -tz], [tx, tz], [-tx, tz]];
    const bounds = corners.map(([x, z]) => raw(x, z));
    const us = bounds.map((p) => p.x), vs = bounds.map((p) => p.y);
    const minX = Math.min(...us), maxX = Math.max(...us);
    const minY = Math.min(...vs) - thick * ce, maxY = Math.max(...vs) + edge * ce;
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
    quad([[-tx, tz, 0], [tx, tz, 0], [tx, tz, -edge], [-tx, tz, -edge]], "#a77d5d");
    quad([[tx, -tz, 0], [tx, tz, 0], [tx, tz, -edge], [tx, -tz, -edge]], "#8d654b");
    const top = corners.map(([x, z]) => P(x, z));
    path(top);
    const wood = ctx.createLinearGradient(top[0].x, top[0].y, top[2].x, top[2].y);
    wood.addColorStop(0, "#d8b894"); wood.addColorStop(0.55, "#e2c5a4"); wood.addColorStop(1, "#caa681");
    ctx.fillStyle = wood; ctx.fill();
    ctx.save(); path(top); ctx.clip();
    ctx.strokeStyle = "rgba(104,68,41,.10)"; ctx.lineWidth = 1;
    for (let i = 0; i < 28; i++) {
      const z = -tz + (i + 0.35 * Math.sin(i * 2.7)) * (2 * tz / 28);
      const a = P(-tx, z), b = P(tx, z + 0.06 * Math.sin(i * 4.1));
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
  }

  root.PindouScene = { drawScene };
})(typeof self !== "undefined" ? self : this);
