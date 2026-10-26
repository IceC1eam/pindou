# 第三方数据声明

`public/palettes-brands.js` 里的品牌色卡数据由 `tools/build_brand_palettes.py` 从下列开源数据整理生成。本应用没有修改色值，只做了筛选（排除未确认真实色号与透明/荧光材质色）和格式转换。

| 数据 | 内容 | 许可 |
|---|---|---|
| [HansBug/pypindou](https://github.com/HansBug/pypindou)（提交 `0ce1993`）的 `pypindou/resources/palettes.json` | 汇总了下面两个数据源的整合文件 | Apache-2.0 |
| [HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data) | 国内品牌：MARD、COCO、漫漫、盼盼、咪小窝、优肯 | MIT，Copyright (c) 2026 HansBug |
| [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors) | 国际品牌：Perler、Hama、Artkal、Nabbi | MIT，Copyright (c) 2020 maxcleme |

MIT 许可条款（适用于上面两个数据源）：

> Permission is hereby granted, free of charge, to any person obtaining a copy of this data and associated documentation files (the "Data"), to deal in the Data without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Data, and to permit persons to whom the Data is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Data.
>
> THE DATA IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE DATA OR THE USE OR OTHER DEALINGS IN THE DATA.

Apache-2.0 许可全文见 <https://www.apache.org/licenses/LICENSE-2.0>。

## 关于颜色准确性

色值是屏幕显示用的近似值（有的来自官方 RGB 色卡 PDF，有的来自公开工具的显示色），与实物豆子在不同批次、光线下都会有色差。要按图纸买豆子，请以品牌的实物色卡为准。
