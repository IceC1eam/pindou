# pindou — 拼豆图纸

选一张参考图（可选）、用 AI 生成，或从空白画布开始，按配置生成拼豆图纸，导出 PNG（含用量清单）。图片处理（取色、量化、绘制）都在浏览器里完成；只有使用 **AI 绘图** 时，描述（修改时还有当前图片）才会经本应用后端发给火山引擎。

`type: service`：后端同时托管 `public/` 静态前端并代理模型调用，密钥不在浏览器里。

```
public/palettes.js   色板数据（通用色板，编号是占位，见下）
public/quantize.js   颜色处理核心：Lab 最近色、限制用色数、抖动、亮度/对比度/饱和度（纯函数，可测试）
public/render.js     canvas 绘制（预览与导出共用）
public/app.js        界面与状态（含 AI 绘图面板）
backend/pindou/      main / api / ark（火山方舟客户端）/ quota（每日次数）/ config
tests/               node --test tests/quantize.test.js
backend/tests/       cd backend && python -m unittest discover -s tests -t .
```

配置项：图片适配（裁剪/留空/拉伸）、宽高与锁定比例、色板、最多用色数、抖动、透明留空、亮度/对比度/饱和度、豆子样式、缩放、网格、色号、加粗线间隔、拼板分割线。
工具：查看（点格子高亮同色）/ 画笔 / 橡皮。手动修改后再改配置不会自动覆盖，需点“重新生成”。

## AI 绘图

全部走火山方舟（一个 API Key）：

1. **无参考图时生成图片**：Seedream 文生图。
2. **理解需求、组装提示词**：文本模型把一句话需求改写成适合出图的提示词，并建议图纸宽高与用色数；文本模型不可用时自动降级为默认模板。提示词会显示出来，可改后点“用此提示词重画”。
3. **按描述修改图片**：Seedream 图生图，基于当前源图修改（不是基于已量化的图纸，所以手动画的格子会被替换）。“回到上一张”可撤销一次。

**不让模型画像素。** 提示词只要求清晰的扁平插画（并明确禁止像素/马赛克/网格风格），模型画出来的图和上传的照片一样，走同一套固定的取色流程（`quantize.js`：缩放 → Lab 最近色 → 限色数）变成豆子格。格点对齐由这段确定性代码保证，模型的输出不会造成像素偏移。

### 两档模型

界面里的“质量档位”选择；每档 = 文本模型 + 图像模型：

| 档位 | 文本模型 | 图像模型 |
|---|---|---|
| 速度优先（默认） | `deepseek-v4-1-flash-261017` | `doubao-seedream-5-0-flash-260915` |
| 精度优先 | `doubao-seed-2-1-pro-260915` | `doubao-seedream-5-0-pro-260628` |

型号定义在 `backend/pindou/config.py` 的 `PRESETS`；型号会更新、旧型号会下线，可在服务器 `/var/lib/apps/pindou/ai.json` 覆盖（也可填推理接入点 ID `ep-…`）：

```json
{"default_preset": "fast", "daily_limit": 40,
 "presets": {"pro": {"image_model": "doubao-seedream-5-0-pro-260628"}}}
```

每天出图次数有上限（默认 40，北京时间自然日），出图失败不扣次数。`base_url` 只接受 `*.volces.com`，避免密钥被发往别处。

### 密钥（环境变量 `ARK_API_KEY`）

按模型名调用需要方舟控制台「API Key 管理」里创建的 **API Key**（一个字符串）。IAM 的 Access Key ID / Secret Access Key 是给管理类 API 签名用的，不能直接按模型名调用推理，本应用不使用。

密钥只走环境变量，由 systemd 的 `EnvironmentFile`（`/etc/portal/secrets/pindou.env`，root 600）注入，不进仓库、不落在应用数据目录。在本机 Bash 里通过 stdin 写入（不进命令行与历史）：

```bash
read -rs K; printf 'ARK_API_KEY=%s\n' "$K" | scripts/deploy.sh secret pindou; unset K
```

本地开发：`ARK_API_KEY=... APP_DATA=/tmp/pindou uvicorn pindou.main:app --port 8720`（在 `backend/` 下）。

## 换成真实品牌色卡

`palettes.js` 里的颜色是按常见色系估的近似值，编号 `P01…` 是本应用的占位编号，**不对应任何品牌色号**。
用自己手里那套豆子：在 `palettes.js` 的 `palettes` 数组里按同样结构新增一项（`code` / `name` / `hex`），界面的“色板”下拉会自动出现，用量清单会按你的真实编号显示。
