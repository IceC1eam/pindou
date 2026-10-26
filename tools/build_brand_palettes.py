"""把 pypindou 的 palettes.json 里挑选的品牌色卡，转成前端用的 public/palettes-brands.js。

用法：python tools/build_brand_palettes.py <palettes.json> [输出文件]

palettes.json 来自 https://github.com/HansBug/pypindou（Apache-2.0）的 pypindou/resources/palettes.json，
它汇总了两个上游数据源（均为 MIT）：
  - HansBug/pindou-color-data  国内品牌：MARD / COCO / 漫漫 / 盼盼 / 咪小窝 / 优肯
  - maxcleme/beadcolors        国际品牌：Perler / Hama / Artkal / Nabbi
生成结果提交进仓库，运行时不依赖任何外部文件。要增删品牌改 PICK 重新生成即可。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# (pypindou 色板 id, 界面显示名, 分组)
PICK = [
    ("mard-221-alfonse-doudou", "MARD", "国内品牌"),
    ("mard-291-github", "MARD 全系列", "国内品牌"),
    ("coco-291", "COCO", "国内品牌"),
    ("manman-278", "漫漫", "国内品牌"),
    ("panpan-289", "盼盼", "国内品牌"),
    ("mixiaowo-290", "咪小窝", "国内品牌"),
    ("artkal-c-197-official", "优肯 Artkal C", "国内品牌"),
    ("beadcolors-perler", "Perler", "国际品牌"),
    ("beadcolors-hama", "Hama Midi", "国际品牌"),
    ("beadcolors-artkal_s", "Artkal S", "国际品牌"),
    ("beadcolors-nabbi", "Nabbi", "国际品牌"),
]
# 个别色板需要在界面里额外提示（色板 id -> 提示）
NOTES = {
    "mard-291-github": "MARD 全系列 291 色来自单一公开来源，其中个别色号的色值与 221 色核对版不一致（如 H1/H2 的白色互换）。需要精确对应色号时，优先用“MARD 221 色”，并以实物色卡为准。",
}
HEX = re.compile(r"#[0-9A-Fa-f]{6}")
# 特殊材质（夜光/闪粉/透明/半透明/珠光/金属）：显示色只是示意，而且常常接近白色，会抢走白色背景，所以不参与取色。
# neon / fluorescent 是正常的鲜艳色，保留。
SPECIAL_NAME = re.compile(r"glow|glitter|transp|transl|clear|pearl|metallic|sparkle", re.I)


def usable(c: dict) -> bool:
    """排除：未确认真实色号的、带透明度的、特殊材质（按名称，或数据备注为“从色卡图片取样的参考色”）、色值异常的。"""
    md = c.get("metadata") or {}
    return (not c.get("unidentified") and bool(HEX.fullmatch(c.get("hex", ""))) and not md.get("transparency")
            and not SPECIAL_NAME.search(str(c.get("name") or ""))
            and not str(md.get("notes") or "").startswith("Reference RGB sampled"))


def nearest(cols: list, rgb: tuple) -> str:
    """色板里离 rgb 最近的颜色（自检用：纯白/纯黑应落在普通的白/黑上，而不是某个特殊色）。"""
    def d(row):
        h = row[1].lstrip("#")
        return sum((int(h[i:i + 2], 16) - v) ** 2 for i, v in zip((0, 2, 4), rgb))
    best = min(cols, key=d)
    return f"{best[0]}{('/' + best[2]) if len(best) > 2 else ''}"


def build(src: Path) -> str:
    data = json.loads(src.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in data["palettes"]}
    out, dropped = [], []
    for pid, title, group in PICK:
        p = by_id[pid]
        cols, seen = [], set()
        for c in p["colors"]:
            if not usable(c):
                dropped.append(f"{pid}:{c.get('code')}")
                continue
            code = str(c["code"]).strip()
            if code in seen:
                continue
            seen.add(code)
            name = str(c.get("name") or "").strip()
            row = [code, c["hex"].upper()]
            if name and name != code:
                row.append(name)               # 名称和色号一样就不重复存
            cols.append(row)
        entry = {"id": "b-" + pid, "name": title, "group": group, "source": p["source"], "colors": cols}
        if pid in NOTES:
            entry["note"] = NOTES[pid]
        out.append(entry)
        print(f"  {title:14s} {len(cols):4d} 色  最接近纯白: {nearest(cols, (255, 255, 255)):28s} 最接近纯黑: {nearest(cols, (0, 0, 0))}", file=sys.stderr)
    print(f"{len(out)} palettes, {sum(len(p['colors']) for p in out)} colors; excluded {len(dropped)}: {', '.join(dropped[:12])}", file=sys.stderr)
    body = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    return f"""/* 品牌色卡数据（由 tools/build_brand_palettes.py 生成，请勿手改）。
 * 来源：HansBug/pypindou（Apache-2.0）汇总的 HansBug/pindou-color-data（MIT）与 maxcleme/beadcolors（MIT）。
 * 色值是屏幕上的近似值，和实物豆子有色差；每个颜色：[色号, 色值, 名称?]。详见 THIRD_PARTY_NOTICES.md。
 */
(function (root) {{
  root.PindouBrandPalettes = {body};
}})(typeof self !== "undefined" ? self : this);
"""


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "public" / "palettes-brands.js"
    dst.write_text(build(Path(sys.argv[1])), encoding="utf-8", newline="\n")
    print(f"wrote {dst} ({dst.stat().st_size} bytes)", file=sys.stderr)
