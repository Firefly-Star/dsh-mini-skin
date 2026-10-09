# 用 mini-skin 框架还原 maid-atelier（深海女仆工坊）

按 `dsh-deep-whale/maid-atelier` 的源码与其 `preview/` 复刻的**最小可用还原**。
本目录在插件仓库里的位置是 `mini-skin/skins/maid-atelier/`。

**目录内容**

| 文件 | 说明 |
|---|---|
| `build-maid-scene.py` | 把宫殿 + 左女仆 + 右女仆合成为一张画布背景（亮/暗各一张） |
| `build-maid-pack.py` | 生成自包含皮肤包（图片 base64 内嵌），并做 Q 版素材的等比处理 |
| `scene-dark.webp` / `scene-light.webp` | 合成后的 1920×1080 场景图（各约 270 KB） |
| `maid-atelier.json` | 皮肤包（1.8 MB，8 个图片槽位内嵌）—— 复制到 `<DSH_HOME>/mini-skins/` 即可用 |

素材来自 `dsh-deep-whale/maid-atelier/assets/`（CC BY-NC-SA 4.0，署名链见本仓库
`artwork/NOTICE-maid-atelier` 与 `artwork/LICENSE-ARTWORK`；**本目录不含那些原始美术文件**，只由脚本引用）。

**怎么装**：把 `maid-atelier.json` 放进 `<DSH_HOME>/mini-skins/`（或直接用「导入皮肤包」），
然后在 设置 → 自定义皮肤 → 正在使用 里选「深海女仆工坊」。

> 皮肤包换过版本（女仆位置与侧栏 Q 版都改过）。**重选一次皮肤**（或在面板里点「重新应用」）
> 才会把新的图写回本机存储；只刷新页面不会更新已导入的图片。

---

## 一、原皮肤由什么构成（读源码得到）

`preview/dark.webp` 与 `preview/light.webp`（均 1920×1035）里能看到的，对应代码是这些部分：

| 视觉部分 | 实现 | 素材 |
|---|---|---|
| 宫殿大厅（亮/暗两张） | `[data-skin-chrome='character-stage']`，**绝对定位在对话列内部**，`background: var(--maid-palace-art) center bottom / cover` | `palace-day/night-v4.webp` 1586×992 |
| 左侧女仆 | `<img data-maid-character='left'>`，`bottom:0; left:clamp(8px,1.5%,24px); height:96%`（占**对话列**高度） | `maid-left-v5.webp` 1122×2019 |
| 右侧女仆 | `<img data-maid-character='right'>`，`right:clamp(8px,1.5%,24px); height:92%` | `maid-right-v7.webp` 1077×2048 |
| 聊天态后退 | `[data-maid-chat-active]` 时两位降到 64%/62%、opacity 0.9；≤1080px 再降到 0.74 | — |
| 输入框蕾丝边框 | **独立节点** `[data-skin-chrome='composer-frame']`，`inset:-20px -14px -18px`，九宫格 `border-image-slice:170 120 115 120` + 中央蝴蝶结与左右缎带切片 | `composer-frame-v4/shell-v1` 1800×588、ribbon cap/fill ×4、bow |
| 顶部连续蕾丝条 | `[data-skin-chrome='top-trim']`，`repeat-x`，`auto 51px` / 窄屏 `149px` | `bottom-trim-tile-v1.webp` 386×30 |
| 底部纹章 | 固定定位的节点，`center / contain` | `maid-bottom-crest-v1.webp` 720×412 |
| 侧栏四角装饰 | `[data-skin-chrome='sidebar-corners']` + 四个 `[data-skin-corner]` span | `maid-sidebar-corner-v1.webp` 1254×1254 |
| 工作区缎带/盾牌 | 树行上的 `border-image` + 行内标记 | `maid-workspace-ribbon-v2`、`shield-v2` |
| 设置弹窗边框 | `border-image-source: var(--maid-settings-frame-art)` | `maid-settings-frame-v1.webp` 2172×320 |
| 侧栏 Q 版角色 | 侧栏装饰层里的 `<img>` | `405917…webp` 89 KB |
| 玻璃模糊层 | 大量 `backdrop-filter: blur(8~16px) saturate(0.9~1.25)` | 无 |
| 标签页/应用图标 | `page-icons.ts` 随机三表情 + manifest | `icons/*.ico/png` |
| 模型感知立绘 | `MutationObserver` 监听输入区的模型按钮，按 pro/flash（含"戴眼镜"版）换图 | `maid-right-vision-v1.webp` |
| 手机导航三种布局 | `data-maid-nav-mode` + 抽屉/视口模块 | — |
| 输入框胶囊/滚动显隐 | `composer-capsule.ts` / `composer-scroll.ts`（滚动监听）+ 动画 | — |
| 拥挤检测 | `character-fit.ts`：`ResizeObserver` 量两个盒子的间距，加 `data-maid-figures-crowded` | — |

原皮肤规模：**129 个文件**，其中 `src/client/maid-atelier.module.css` 一个文件就是 **5995 行 / 249 KB**，
另有 24 个客户端 TS 模块（合计 163 KB），顶层美术素材 **5.3 MB**。

## 二、用我们的框架还原到了什么

mini-skin 只有三件事可用：**注入一张样式表**、**在 `body` 上打属性**、**行内写极小的自定义属性**。
没有节点插入、没有观察器、没有 JS 事件挂载。据此：

| 原皮肤部分 | 本次还原 | 用的槽位 |
|---|---|---|
| 宫殿 + 双女仆 | ✅ **烤成一张图**。按 `character-stage` / 两位女仆的 CSS 比例（96% / 92%、`center bottom / cover`）在 1920×1080 画布上合成；女仆额外内缩到**对话列内**（见下） | 画布背景（`canvas:模式:状态`） |
| 亮/暗切换 | ✅ 两张合成图分别给 light / dark 四套预设 | 同上 |
| 侧栏 Q 版小人 | ✅ 用 `sidebar-mascot` 那张素材（`405917…webp` 620×553），放在「顶部图」槽位、高 205px（≈ 原皮肤渲染出的 230×205 等比尺寸） | 顶部图（`character:模式:状态`） |

不透明度取 **78%**：原皮肤的宫殿是"透出宿主底色"的层，而我们的画布层必须自己带底色才能压住宿主 ——
78% 是这两件事的折中。想更清楚就把主内容不透明度往 90% 调，想更"贴皮肤"就往下调。

### 女仆为什么按"对话列"而不是"视口"摆放

原皮肤把 stage 和两位女仆都放在**对话列内部**（`[class*='centerCol']`），侧栏一开、对话列整体右移，
女仆跟着走。我们的画布层是 `body::before`，**固定在视口上、不随侧栏移动**，
所以第一版按视口边缘摆放时，侧栏那条 280px 的实心列（`--maid-sidebar-width: 280px`，网格首列）
把左边的女仆盖掉了大半。

现在改成按"**侧栏展开时**对话列的左右边界"摆放：对话列 = `280px..1920px`，女仆各让开 40px
（左女仆落在 x=320、右女仆右边界 1880），两位都完整可见；侧栏**收起**时
`background-position: center` 会把整张图右移约 140px，女仆仍在视口内（略偏右，不会切掉）。

### 侧栏为什么没有背景图

第一版把 `maid-left-v5` 当侧栏背景，结果是：侧栏那一层的规则是 `background-size: 100% 100%, 100% auto`
（见工厂里的 `[data-slot='sidebar.workspaces'] > *`），**横向被拉伸**；而且原皮肤侧栏里根本不是立绘，
是底部那个 Q 版小人。所以侧栏背景设成"无"，Q 版改走「顶部图」槽位 ——
那条路径按 `background-size: contain` 等比渲染，不会变形。

代价：Q 版的位置比原皮肤高（原皮肤在侧栏底部 `bottom: calc(swag + 94px)`，
我们的顶部图槽位只能坐在工作区面板顶端）。

### Q 版会跟着窗口高度缩放

图块的高度不是写死的 px，而是 `clamp(72px, 18vh, 你在设置里填的值)`：
窗口变矮时图和下面的工作区列表**一起缩**，不会出现"图不变、工作区先被压没"。
所以面板里那个「顶部图 · 尺寸」实际是**上限**，不是固定值。

（这条是在 mini-skin 插件侧修的，不是本皮肤特有：见插件仓库 `dev/new-factory.txt` 里
「顶部角色图」那段注释 —— 宿主侧栏是 `flex:1;min-height:0` 的列，写死 px 会让图和工作区抢空间。）

### 怎么复现合成

```powershell
python maid-skin\build-maid-scene.py   # 宫殿 + 双女仆 -> scene-{dark,light}.webp
python maid-skin\build-maid-pack.py    # -> maid-atelier.json（自包含，2.0 MB）
```

坐标全部来自原 CSS，改了原皮肤的 `height: 96%/92%` 或边缘内缩就要重跑。

---

## 三、什么还原不了（按"为什么"分类）

### A. 框架硬限制：需要插节点 / 需要 JS

| 部分 | 为什么不行 | 后果 |
|---|---|---|
| **输入框蕾丝边框 + 蝴蝶结** | 它是**卡片之外的独立节点**（`inset:-20px -14px` 把框画到卡片外），用九宫格 `border-image` + 中央蝴蝶结/左右缎带五个背景层。我们只能在既有元素上挂 `::before`/`::after`：宿主已经用掉卡片自身的伪元素，而且这个框必须画到卡片**外面** | 截图里最抢眼的那圈蕾丝没有了 |
| **顶/底蕾丝、侧栏四角、工作区缎带、设置弹窗边框** | 都是独立节点或按行标记的 `border-image` | 整套"装饰边框"必须放弃 |
| **模糊玻璃面板**（`backdrop-filter`） | 是宿主面板元素的样式，不是我们能在 `body` 上开关的；硬上会污染整个宿主 UI | 输入框/卡片失去磨砂质感 |
| **模型感知立绘**（含"flash 戴眼镜"） | 要 `MutationObserver` 读输入区模型名再换图 | 只剩"一套图" |
| **聊天态后退**（96%→64%/62%、opacity 0.9） | 要响应 `[data-maid-chat-active]` 换构图，而我们只有一张烤死的位图 | 进入对话后女仆不会缩小让位 |
| **拥挤检测**（`character-fit.ts`） | 要 `ResizeObserver` 量两个盒子的间距 | 侧栏/工作台挤压时不会自动叠让 |
| **输入框胶囊 / 滚动显隐** | 要滚动监听 + 动画状态机 | 无 |
| **标签页三表情随机图标 + PWA manifest** | 要改 `document.head` 与 manifest | 无 |
| **手机导航三种布局、侧栏抽屉、`--maid-workspace-row-height`** | 要按 `window.innerWidth` 打属性、要跨节点改行高 | 无 |
| **`sfwMode` 时段可见性**（按本机时间藏立绘） | 要定时器判断时间 | 无 |
| **多实例/热切换安全**（`AttributeLease`/`Projector` 逐项还原原值） | 我们的框架有 `shared.bodyClaims` 归属机制，但颗粒度是"整套设置"，做不到逐属性租借 | 极端热切换场景下不如它严谨 |

### B. 一个位图代替两个元素带来的构图损失

原皮肤把两位女仆作为**独立 `<img>` 绝对定位在对话列里**，各自按列高缩放。我们的画布层是
`body::before`（固定视口）**只有一张图**，所以：

1. **两位女仆只能烤进同一张位图**，无法单独开关、无法各自缩放；侧栏展开/收起时也不会像原皮肤那样跟着对话列移动。
2. **`cover` 之后只有一个缩放比例**：比 16:9 更**宽**的窗口上下裁，更**窄**的窗口左右裁。
   原皮肤在窄窗口是把女仆缩到 74% 可见度继续留在两侧；我们的位图被裁掉两侧时，
   女仆会先被切到。合成时已把女仆内缩到**对话列内 40px**（x=320 / 右边界 1880）来抗这件事，
   但窗口窄到对话列装不下时仍会切到。
3. **宫殿与女仆的锚点不同**：原皮肤宫殿是 `center bottom`（地板对齐底边）、女仆 `bottom: 0` 站在同一基线上。
   合成时我按 preview 把基线放在图高 90% 处（`STAND_BOTTOM = 970/1080`），所以**在 16:9 上最像截图**，
   窗口比例偏离越多，女仆相对地板的位置就越不准。
4. 女仆的整体尺度是**静态取舍**：原皮肤用 `height: 96%/92%` 占满对话列高度，还能靠
   `character-fit.ts` 在拥挤时自动缩到 64%/62%；我们一张烤死的图必须同时满足"侧栏开着不被挡"
   和"两位不互相顶到中间"，所以压到 **78%** 一档写死。
5. 原皮肤女仆还带 `filter: drop-shadow(...)`，暗色下还有 `brightness(0.84) saturate(0.92)`。
   这些在合成时**没有烤进去**（Pillow 做这些等于再做一版图），所以暗色下女仆比原皮肤略亮一点。

### C. 素材与许可带来的问题

1. **美术会重复分发一份。** mini-skin 只认"内置素材名"或"内嵌 base64"（README 里明确写了不支持远程 URL），
   所以 maid-atelier 的图要在本插件里**再存一份**。合成后 **1.8 MB**（画布 4 槽 ×354/362 KB + Q 版 4 槽 ×101 KB）；
   如果原样内嵌原素材会更糟（宫殿 273+264 KB、女仆 1010+1181 KB、外加十几种装饰件）。
   > 变通：包里其实支持 `canvasImage: "custom"` + `canvasImageUrl`（旧设置兼容分支）。只要 maid-atelier
   > 处于启用状态，它的素材就在同源路由 `skin-assets/maid-atelier/<hash>.webp` 上可取，那时包可以缩到几 KB。
   > 这次没走这条路，因为**它把皮肤的目标变成运行时依赖**：女仆皮肤一旦停用，我们的背景就空了。
2. **署名必须跟着走。** 这些美术是 CC BY-NC-SA 4.0（非商业）。本次没有把美术文件复制进本目录，
   只由脚本引用原目录 —— 上报或分发时请一并带上 `maid-atelier/NOTICE` 与 `LICENSE-ARTWORK`；
   若把 `maid-atelier.json`（内嵌位图）单独发出去，那就是在分发改编作品，署名链与许可必须随包。
3. **`maid-right-vision-v1.webp`（1.8 MB，戴眼镜版）与 `maid-right-v6`（508 KB）本次完全没用上** ——
   前者要靠模型感知才能触发，后者是更低清的旧版。

### D. 观感差异清单（对着 preview 能一眼看出来的）

- 没有输入框蕾丝框与蝴蝶结；
- 没有顶部连续蕾丝条、底部纹章、侧栏四角蕾丝、工作区缎带；
- Q 版小人**位置偏高**（原皮肤在侧栏底部、盖在工作区列表下沿，我们的顶部图槽位只能坐在工作区面板顶端）；
- 立绘不随对话状态缩小，窄窗口下整张位图一起裁；
- 侧栏展开/收起时女仆**不会跟着对话列移动**，只是整张图被裁切（原皮肤是实时跟随的）；
- 界面没有玻璃模糊，配色由"方形契约 + 字标"顶上，但深海蓝那套 token（约 200 行 `--dsw-*` 覆盖）没有复刻。

---

## 五、修过的两个问题（留档）

1. **打开侧栏后左边女仆被挡一半**：女仆原来按视口边缘摆放，被 280px 的侧栏实心列盖住。
   改为按"侧栏展开时对话列的边界"内缩摆放（详见上面"女仆为什么按对话列摆放"）。
2. **侧栏 Q 版小人不对**：原来把立绘塞进侧栏背景层，被 `background-size: 100% 100%` 横向拉伸、
   Q 版则完全没出现。改为：侧栏背景留空，Q 版走「顶部图」槽位、等比渲染、高 205px。

---

## 六、想更接近的话，按性价比排序的下一步

1. **把 Q 版挪到侧栏底部**：原皮肤是 `bottom: calc(swag + 94px)`。顶部图槽位做不到，
   但侧栏背景层可以 —— 把 Q 版**烤进侧栏背景位图**并靠 `background-position: left bottom` 定位即可；
   代价是背景层用 `100% 100%` 拉伸，得先把位图做成侧栏的真实宽高比（280×~1000）。
2. **补一圈"便宜"的装饰**：顶部蕾丝条（`bottom-trim-tile-v1` 386×30）与底部纹章（`maid-bottom-crest-v1`）都是单张 tile，
   本来最适合当**画布层的第一层背景**（`background-image: url(tile), url(scene)` + 各自 `background-repeat/position`）。
   但工厂现在把 `custom` 分支写成 `body.style.setProperty(CANVAS_CUSTOM_VAR, `url("${url}")`)` —— 单张、且被引号包住，
   塞不进多图；要走这条路得先改工厂（`applySettings` 里那两行 + `UrlInput` 的输入校验），属于小改动但要动源代码。
3. **复刻深海蓝 token 覆盖**：纯样式表，无节点依赖，是"最像"的一步，但要挑要覆盖的 `--dsw-*`
   变量（原皮肤约 200 行），并且宿主升级后要跟着改。
4. **两个状态用两张图**：把 `dark:work` 换成"女仆缩到 64%"的合成图，就能近似出"聊天态后退"。
   这是把 `character-fit` 那种动态行为降级成"按状态切换的静态构图"。

不建议去碰的：输入框蕾丝框、玻璃模糊、模型感知、滚动显隐 —— 这四样都必须插节点或挂事件，
等于要把 mini-skin 从"只注入样式表"改成"会做 DOM 操作"，那就不是这个框架了。
