# dsh-mini-skin

一个**只有样式表**的 DSH Web 皮肤：配色 token + 背景图（主画布 + 侧栏）+ 全直角契约 + 字标。**没有**观察器、**没有** DOM 装饰、**没有**图标重绘、**没有**构建步骤。

`lib/client.js` 就是产物。

## 设计约束（改动时请守住这几条）

1. **0 个 MutationObserver**；全包只有 1 个一次性 `DOMContentLoaded` 监听。
2. **CSS 里 0 个 `:has()`** —— 关系选择器跨大子树会引发全站失效传播，这是原皮肤滚动卡顿的根因。
3. **只用宿主公开钩子**：`[data-slot=…]`、`[data-window-drag]`、`aria-keyshortcuts`、`aria-label`。**不引用生成类名**（`_0cM…` / `uHd-Xa_…`），DSH 升级不会把它写断。
4. **只覆盖画布 token `--dsw-alias-bg-base`**，**绝不碰 `--dsw-alias-bg-layer-1/2/3`**：设置面板、菜单、卡片的填充间接来自层色（`--dsw-alias-settings-card-fill: var(--dsw-alias-bg-layer-2)`），碰了就会出现"拖滑块把设置面板也拖透明"。
5. **滑块语义 = 背景图强度**（100% 图最清楚，0% 被画布底色盖住），不是"表面不透明度"。
6. 唯一的宽选择器是那条 `border-radius: 0 !important` 全直角契约，属有意为之；要更保守可收敛成组件清单。

## 生效方式

以 link 方式装进 profile，**改文件后刷新页面即可**，无需重装、无需重启、无构建步骤。

## 设置面板

**设置 → 通用设置 → 背景图不透明度**（0–100，默认 52）。

- 写的是 `body` 上的**行内** token，拖动时按 `requestAnimationFrame` 合并（一帧最多一次样式重算）
- 值存 `localStorage`（键 `dsh-mini-skin:art-opacity`），刷新/重启保留
- 面板关闭时该行卸载，**平时零成本**

## 可调常量（都在 `lib/client.js` 顶部）

| 常量 | 作用 |
|---|---|
| `BACKGROUND` | 主画布背景图，`{ light, dark }`。`IMAGES.orca*Hero` / `orca*Active`，或任意 URL / data URI / `null` |
| `SIDEBAR_IMAGE` | 侧栏那一列的背景图，`{ light, dark }`。默认 maid-atelier 的左侧立绘 |
| `SIDEBAR_IMAGE_SIZE` | 默认 `"100% auto"`：宽度对齐侧栏、纵向按原始比例（**不拉伸**） |
| `SIDEBAR_IMAGE_POSITION` | 默认 `"center bottom"`：**贴最底部** |
| `CANVAS_RGB` | 画布底色分量（alpha 由滑块给） |
| `LIGHT_TEXT` / `DARK_TEXT` | 文字、边框、交互色等非背景 token，与滑块无关 |
| `DEFAULT_ART_OPACITY` | 滑块初值（52） |
| `IMAGES` | 内嵌图片（data URI），由 `_perf-probe` 的脚本生成，**不要手改** |

## 已还原 / 已跳过（对照 `orca-link/preview/dark.png`）

已还原：夜间书房场景、全直角契约、近黑配色、蓝色强调、`[DSH]` 方框字标、🔵 `LINK ACTIVE` 方点、蓝色方形发送键、直角细滚动条、侧栏立绘（换成 maid-atelier 的抠图）。

已跳过（附代价）：
- 图标全部重绘成直线图形 —— 需 36.7 KB JS + 观察器
- 预览图侧栏那张"桌前用电脑" —— 来自 761 KB 多帧状态图集，取帧属运行时逻辑
- 峰谷定价红绿灯 —— 时间/数据逻辑
- favicon / 启动错误页 / 设置覆层 / 场景在任务开始时交叉淡化

## 工具链（`../_perf-probe/`）

| 脚本 | 用途 |
|---|---|
| `assemble.mjs` | 把 `new-factory.txt` 拼进 bundle（保留前缀里的内嵌图片） |
| `embed-art.mjs` / `embed-maid-sidebar.mjs` | 把 webp 内嵌成 data URI |
| `shrink-maid.py` | Pillow 降采样重编码（1 MB 无损 → 136 KB 有损） |
| `probe-image.mjs` | 读 webp 的块类型/alpha/尺寸 |
| `measure.mjs` | 四个动作的样式重算/帧间隔测量（需探针实例 + 隔离 Chrome） |
| `nav-shot.mjs` / `nav-click-shot.mjs` / `test-slider.mjs` | 截图与滑块端到端验证 |

CDP 脚本从环境变量 `DSH_PROBE_CDP` 取调试地址（Chrome 有时只绑 IPv6，用 `http://[::1]:9333`）。

## 美术署名（CC BY-NC-SA 4.0，禁止商用）

- 主画布场景：来自 **dsh-deep-whale / ORCA LINK** —— 一创 上善，二创 Small-tailqwq → `artwork/NOTICE`
- 侧栏立绘：来自 **dsh-deep-whale / maid-atelier** —— 一创 上善，二创 ZipZipPipe，三创 Small-tailqwq → `artwork/NOTICE-maid-atelier`

许可正文见 `artwork/LICENSE-ARTWORK`。**代码**（`lib/` 里的 JS）是 MIT，与美术许可是两回事。

## 性能（同一套探针脚本，空会话 577 元素，1600×900）

| 指标（中位） | 官方 | **官方 + mini-skin** | orca-link 皮肤 |
|---|---:|---:|---:|
| 输入 41 字符·样式重算 | 22.1 ms | 23.3 ms | 207.9 ms |
| 输入·重算**次数** | 92 | **92** | 282 |
| 左栏收放·样式重算 | 47.5 ms | 32.7 ms | 146.3 ms |
| 空转帧间隔中位 | 8.3 ms | 8.3 ms | 8.3 ms |

bundle 约 425 KB（其中约 412 KB 是 5 张内嵌图；逻辑约 12 KB）。
