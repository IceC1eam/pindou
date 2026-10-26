# pindou — 拼豆图纸

选一张参考图（可选）、用 AI 生成，或从空白画布开始，按配置生成拼豆图纸，导出 PNG（含用量清单）。图片处理（取色、量化、绘制）都在浏览器里完成；只有使用 **AI 绘图** 时，描述（修改时还有当前图片）才会经本应用后端发给火山引擎。

`type: service`：后端同时托管 `public/` 静态前端并代理模型调用，密钥不在浏览器里。

```
public/palettes.js   通用色板（编号是占位）+ 合并品牌色板
public/palettes-brands.js  品牌色号数据（由 tools/build_brand_palettes.py 生成，勿手改）
public/quantize.js   颜色处理核心：Lab 最近色、限制用色数、抖动、亮度/对比度/饱和度（纯函数，可测试）
public/render.js     canvas 绘制（图纸、导出、烫豆表面贴图共用）
public/scene.js      桌面成品的正交投影、厚度、光影与镜头视角
public/app.js        界面与状态（含 AI 绘图面板）
backend/pindou/      main / api / ark（火山方舟客户端）/ quota（每日次数）/ config
tools/               build_brand_palettes.py：从 pypindou 的 palettes.json 重新生成品牌色号
tests/               node --test tests/*.test.js
backend/tests/       cd backend && python -m unittest discover -s tests -t .
```

界面分左右两栏：**左 = 参考图**（预览、上传/拖放/粘贴、AI 生图聊天、模型档位），**右 = 图纸**（取样与取色配置、画布、工具、用量清单）。

配置项：图片适配（裁剪/留空/拉伸）、宽高与锁定比例、色板、最多用色数、抖动、透明留空、亮度/对比度/饱和度、豆子样式、缩放、网格、色号、加粗线间隔、拼板分割线。
工具：查看（点格子高亮同色）/ 画笔 / 橡皮。手动修改后再改配置不会自动覆盖，需点“重新生成”。

## 缩放与拖动

| | 缩放 | 移动 |
|---|---|---|
| 电脑 | 鼠标滚轮（以光标为中心）、右下角 ＋ / － / 适应、显示设置里的缩放滑条 | 查看模式直接拖动；画笔/橡皮模式下按住空格（或鼠标中键）再拖动 |
| 手机/平板 | 双指捏合 | 查看模式单指拖动；画笔/橡皮模式单指涂画、双指移动 |

查看模式下轻点（不拖动）仍是“高亮同色”。缩放范围 4–64 像素/格，格子很多时上限会自动降低，避免画布过大。

## 烫豆效果预览

图纸下方的“烫豆效果预览”把同一份图纸画成不同**烫法**的样子——拼豆社区里常说的“正常烫、毛巾烫、澡巾烫”这一类：垫什么材料熨烫，表面就留下什么肌理。并排对比 8 种；点缩略图后，上方会把成品放在桌面上，镜头在正面和侧面间平滑往返，能看到熔接表面、轮廓和侧面厚度。可暂停镜头，并按当前视角导出桌面预览 PNG。

| 烫法 | 做法 | 表面特征 |
|---|---|---|
| 有孔烫 | 加热至相邻豆子熔接 | 圆孔缩小但仍可见，颗粒轮廓变浅 |
| 正常烫 | 隔烘焙纸较充分地平烫 | 表面熔成连续薄片，孔基本闭合，颜色鲜艳 |
| 毛巾烫 | 烘焙纸下垫纯棉厚毛巾，趁热揭纸 | 表面有细毛、哑光绒感，沾上毛巾纤维所以颜色略偏灰；适合小动物、玩偶 |
| 澡巾烫 | 垫粗澡巾，用力压进去 | 均匀的颗粒凹凸、复古做旧；没有细毛，颜色比毛巾烫鲜艳，也更好撕 |
| 编织烫 | 特定垫材 | 交织的藤编/布纹肌理，适合花篮、杯垫 |
| 格纹烫 | 格纹垫材（常带细闪底） | 规则格纹，平面上有立体光影 |
| 格利特烫 | 把豆子完全融化，常配半透明豆 | 星光闪烁、宝石般的光泽 |
| 亮面烫 | 光滑垫材 | 光滑反光的亮面，难度较高 |

各品牌的标准熔接程度不同：[Perler 官方教程](https://perler.com/blogs/projects/standard-fusing-method)建议保留中心孔，[Hama 官方教程](https://www.hamabeads.com/how-to-use/)描述为豆子一端彼此轻微熔接。这里的“正常烫”更接近较充分的平熔成品，用来预览接近闭孔的外观；“有孔烫”保留孔洞。垫材纹理和桌面光影是程序模拟的示意，真实效果取决于垫材、温度和手法。对比小图自动挑选整张图里颜色最丰富的 8×8 区域。

## 品牌色号

“色板 / 品牌色号”下拉分三组：通用（本应用的占位编号）、国内品牌（MARD 221/291 色、COCO、漫漫、盼盼、咪小窝、优肯 Artkal C）、国际品牌（Perler、Hama Midi、Artkal S、Nabbi）。选了品牌后，图纸里的色号、用量清单、导出的 PNG 都用该品牌的真实色号。

数据来自开源项目 [pypindou](https://github.com/HansBug/pypindou) 汇总的两个 MIT 数据源，署名与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。已排除“无法确认真实色号”（盼盼/咪小窝各 4 个）和特殊材质色（夜光、闪粉、透明/半透明、珠光、金属，以及优肯 C 系的 CG/CP/CT 系列）——它们的显示色只是示意，而且常常接近白色，会抢走白色背景；neon / 荧光色是正常鲜艳色，保留。MARD 有两套：“MARD 221 色”经两个来源交叉核对，“MARD 全系列 291 色”只有单一来源、个别色号（如 H1/H2）与 221 版不一致，界面会提示。**屏幕颜色与实物有色差**，下单前请对照实物色卡。

要增删品牌：改 `tools/build_brand_palettes.py` 里的 `PICK`，取得 pypindou 的 `pypindou/resources/palettes.json` 后运行 `python tools/build_brand_palettes.py <palettes.json>`，提交生成的 `public/palettes-brands.js`。

## AI 绘图

全部走火山方舟（一个 API Key）：

1. **无参考图时生成图片**：Seedream 文生图。
2. **理解需求、组装提示词**：文本模型把一句话需求改写成适合出图的提示词，并建议图纸宽高与用色数；文本模型不可用时自动降级为默认模板。提示词会显示出来，可改后点“用此提示词重画”。
3. **按描述修改图片**：Seedream 图生图，基于当前参考图修改（不是基于已量化的图纸，所以手动画的格子会被替换）。

生图以聊天形式进行：每次结果都留在对话里，点缩略图即可把它设为参考图（相当于回退），展开“提示词”可改后重画。浏览器里最多保留最近 12 张结果图。

**不让模型画像素。** 提示词只要求清晰的扁平插画（并明确禁止像素/马赛克/网格风格），模型画出来的图和上传的照片一样，走同一套固定的取色流程（`quantize.js`：缩放 → Lab 最近色 → 限色数）变成豆子格。格点对齐由这段确定性代码保证，模型的输出不会造成像素偏移。

### 两档模型

界面里的“质量档位”选择；每档 = 文本模型 + 图像模型：

| 档位 | 文本模型 | 图像模型 |
|---|---|---|
| 速度优先（默认） | `deepseek-v4-1-flash-261017` | `doubao-seedream-5-0-flash-260915` |
| 精度优先 | `doubao-seed-2-1-pro-260915` | `doubao-seedream-5-0-pro-260628` |

型号定义在 `backend/pindou/config.py` 的 `PRESETS`；型号会更新、旧型号会下线，可在服务器 `/var/lib/apps/pindou/ai.json` 覆盖（也可填推理接入点 ID `ep-…`）：

```json
{"default_preset": "fast", "daily_limit": 100,
 "presets": {"pro": {"image_model": "doubao-seedream-5-0-pro-260628"}}}
```

每天出图次数有上限（默认 100，北京时间自然日），出图失败不扣次数。`base_url` 只接受 `*.volces.com`，避免密钥被发往别处。

### 密钥（环境变量 `ARK_API_KEY`）

按模型名调用需要方舟控制台「API Key 管理」里创建的 **API Key**（一个字符串）。IAM 的 Access Key ID / Secret Access Key 是给管理类 API 签名用的，不能直接按模型名调用推理，本应用不使用。

密钥只走环境变量，由 systemd 的 `EnvironmentFile`（`/etc/portal/secrets/pindou.env`，root 600）注入，不进仓库、不落在应用数据目录。在本机 Bash 里通过 stdin 写入（不进命令行与历史）：

```bash
read -rs K; printf 'ARK_API_KEY=%s\n' "$K" | scripts/deploy.sh secret pindou; unset K
```

本地开发：`ARK_API_KEY=... APP_DATA=/tmp/pindou uvicorn pindou.main:app --port 8720`（在 `backend/` 下）。

## 自定义色卡

通用色板里的颜色是按常见色系估的近似值，编号 `P01…` 是占位编号，**不对应任何品牌色号**。
要加自己的一套：在 `palettes.js` 的 `palettes` 数组里按同样结构新增一项（`id` / `group` / `name` / `colors: [{code, name, hex, label}]`），界面的下拉会自动出现。
