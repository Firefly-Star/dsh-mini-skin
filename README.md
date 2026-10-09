# dsh-mini-skin

一个只注入样式表的 DSH 皮肤插件，带一个**自包含的皮肤库**。所有开关集中在 **设置 → 自定义皮肤** 一个分区里。

运行时成本刻意压到最低：**0 个 `MutationObserver`**、**1 个一次性监听**（`DOMContentLoaded`）、只依赖宿主的稳定钩子（`data-slot=*`）。图片数据一律留在样式表里，切换素材只改一个 `body` 属性；行内变量只存**极小值**（rgba 颜色、字体栈、px 偏移、blob URL）。

---

## 安装

```powershell
# GitHub（推荐：一行装，不需要 npm 账号）
dsh plugin --profile web add 'github:Firefly-Star/dsh-mini-skin'

# 本地目录（link：改文件即时生效，开发用）
dsh plugin --profile web add '<绝对路径>\mini-skin'

# tarball（复制安装，工作区目录不再是运行依赖）
npm pack --pack-destination .
dsh plugin --profile web add '<绝对路径>\dsh-mini-skin-0.1.0.tgz'
```

本插件**未发布到 npm**（npm 上没有 `dsh-mini-skin`）：请用上面的 GitHub 或 tarball 方式安装。从 GitHub/tarball 安装是**复制**安装——本地源码的改动不会再影响已装版本。

**重启语义**：客户端半边（`lib/client.js`）热更新即可；**节点半边（`lib/index.js`）改动必须重启 DSH**。皮肤库路由只在重启后存在。

---

## 功能

### 三种皮肤状态

| 状态 | 含义 |
|---|---|
| **官方皮肤** | 宿主原样：本插件的样式表、`body` 属性、行内变量**全部撤下**（插件本体仍在，设置分区照旧可用）。它自己也是一份皮肤包 —— 见下 |
| **皮肤库里的皮肤** | `<DSH_HOME>/mini-skins/` 里的 `.json` 包，名字取自包内 `name` |
| **自定义** | 当前设置的指纹与应用皮肤时记下的指纹不符（即你改过任何一项） |

**官方皮肤是一份包文件，不是代码里的常量。** 它就是库里的 `official.json`：深色→暗色场景、浅色→亮色场景、侧栏→maid-atelier 立绘，主内容不透明度 52 / 侧栏 100，素材按名字引用（`dark-hero` / `maid-left` …），所以只有 1.7 KB、不带图片字节。插件在**每次读取皮肤库列表时**检查它是否还在，缺了就补一份（判据是**包名**，所以你自己另存或改名的那份不会被覆盖）。你在面板里选「官方皮肤」时，客户端是真的去读这个文件来推导配置 —— 「宿主原样」这层语义（撤下插件的一切）仍然是渲染规则，配置本身已经全部外置。

`official.json` 不单独出现在「正在使用」的下拉里，因为那一项就是它。

### 四套预设：主题 × 状态

主内容背景图 / 不透明度、侧栏背景图 / 不透明度 / 水平 / 垂直位置 **按四个组合各存一份**：dark:idle / dark:work / light:idle / light:work。

生效组合 = 当前主题 × 当前状态（是否正在工作）；主题事件与状态变化都会重放设置。

**工作状态怎么检测**：宿主只在 DOM 上暴露状态（没有服务、没有事件），所以每 0.4 秒读一次 DOM。判据按可靠性排序：

1. **`[data-chat-running]`** —— 会话级的"整轮在跑"标记（chat 视图的 `RunningStatus`，源码注释写明 *mount only while the Session is running*）。它覆盖**整轮**：思考、流式输出、执行工具、压缩上下文……只要这一轮没结束就在。这是首选判据。
2. `[data-state='running']` —— 单个节点（推理行 / 工具卡 / 命令卡）**自己**还在流式时的标记，会被 settle 掉，只作兜底。
3. `[data-composer-input][data-phase]` —— 只有"提交中 / 裁决中"两个瞬时相位，同样只作兜底，**不代表整轮在跑**。

> 教训：只用了 2) 和 3) 的版本把"执行工具 / 纯深度思考"误判成空闲——那两个相位在这两种时刻都不成立。

原皮肤为此挂了整个 body 的 MutationObserver；本插件改用一个定时器（每轮一两次 querySelector）—— 代价是切换最多延迟 0.4 秒，收益是保住 0 观察器。

面板顶部的「**正在编辑**」是四选一：切换它会调用宿主的 theme.setTheme() 把界面主题真的切过去、并临时把预览状态切到空闲或工作，所以你改什么就能立刻看到什么；关掉面板后交还给自动检测。在某一套里改任何值也会先确保该套生效。

### 背景图（勾选式）

```
主内容
  [x] 有背景图
  |-- 背景图     本地文件… / （禁用项）内置素材：亮色场景（来自皮肤）
  |   已选择本地文件：xxx.webp        <- 勾了没选时显示「尚未选择图片。」
  |   不透明度   ----o----  [52] %
  [ ] 有背景图   -> 素材 / 不透明度 / 位置全部隐藏，该模式素材设为「无」
侧栏  同一套（含水平 / 垂直位置）
```

- 勾选 = 该模式素材为 `file`；取消 = `none`。存储与皮肤包格式与选择无关。
- 素材只支持**本地图片**（系统文件选择器，图片本体存 IndexedDB）。**不支持远程 URL**：`custom` 分支仅作为旧设置的兼容兜底保留。
- 内置素材（场景 / 立绘）**不能**在这里挑选——它们属于"皮肤"这一层；下拉里只以**禁用项**出现，告诉你"现在是什么、来自哪"。

### 其它

- **方形契约**（可关）：按钮、输入框、卡片、弹窗圆角归零
- **字体**：界面字体（覆盖宿主的 `--dsw-font-family`）+ 侧栏字体（只作用于侧栏列）
- **品牌字标**：`DSH` 方框字标 / 宿主原样
- **LINK ACTIVE 标签**开关

---

## 皮肤库（插件自己的目录）

节点半边把 `<DSH_HOME>/mini-skins/` 通过一条同源路由暴露给浏览器半边：

```
GET                  -> { dir, skins: [{ file, name, savedAt, bytes, ok, error }] }
GET  ?file=<名字>     -> 该包的完整 JSON
POST { pack }        -> 写进库（重名自动加时间戳后缀）
DELETE ?file=<名字>   -> 删除
```

- 只处理目录里**直接的 `*.json`**；请求只能**点名文件**，不能给路径（`basename` + 白名单正则双重校验）。
- 解析不了的文件**不隐藏**，在下拉里**标灰并给出原因**（`JSON 解析失败` / `format 不符` / `读取失败：<code>`）。
- **官方皮肤包固定落到 `official.json`**：客户端按文件名引用它，否则"按包名自动命名"会为中文名再写一份、库里出现两个官方皮肤。
- 列表里的 `official.json` 被客户端过滤掉（下拉里那一项就是它）。
- **导出 = 两件事都做**：下载 `<名称>-<日期>.json` **并且**存入皮肤库（状态行分别报告两边结果）。
- **导入**：系统文件选择器读一个 `.json`，图片写回本机存储后立即套用。
- 当前皮肤的那个包**被删或改名**时，客户端启动会按**包名**在库里找同名的一份接手，让活动皮肤认得回来。

### 包格式（自包含）

```json
{
  "format": "dsh-mini-skin-pack",
  "version": 3,
  "name": "我的皮肤",
  "savedAt": "2026-...",
  "shared": { "square": true, "brandMark": "dsh", "linkChip": true, "uiFont": "system", "sidebarFont": "inherit", "packName": "我的皮肤" },
  "modes": {
    "dark:idle":  { "canvasImage": "dark-hero", "canvasOpacity": 90, "sidebarImage": "maid-left", "sidebarOpacity": 100, "sidebarOffsetX": 0, "sidebarOffsetY": 0 },
    "dark:work":  { "canvasImage": "dark-active", "canvasOpacity": 90, "sidebarImage": "maid-left", "sidebarOpacity": 100, "sidebarOffsetX": 0, "sidebarOffsetY": 0 },
    "light:idle": { "canvasImage": "light-hero", "canvasOpacity": 65, "sidebarImage": "maid-left", "sidebarOpacity": 100, "sidebarOffsetX": 0, "sidebarOffsetY": 0 },
    "light:work": { "canvasImage": "light-active", "canvasOpacity": 65, "sidebarImage": "maid-left", "sidebarOpacity": 100, "sidebarOffsetX": 0, "sidebarOffsetY": 0 }
  },
  "images": { "sidebar:dark:idle": "data:image/webp;base64,..." }
}
```

- 四套预设键：`dark:idle` / `dark:work` / `light:idle` / `light:work`；v2 的 `dark` / `light` 仍能导入（映射到该主题的两套）。
- **内置素材按名字引用**（`dark-hero` / `light-hero` / `maid-left` ...），不重复打包 -> 纯内置配置的包只有几 KB（`skins/official.json` 1.7 KB 就是这么来的）。
- **本地图片的字节内嵌**进 `images`（键为 `区域:模式:状态`）-> 换台机器导入即用，**不需要原文件**。
- `activeSkin`（皮肤库身份）**不进包**：由导入方在导入后决定。
- 因此"自包含"是结构上的保证：只涉及本地图片，没有跨域 / 失效链接的可能。

---

## 数据与存储

| 位置 | 内容 |
|---|---|
| `localStorage['dsh-mini-skin:settings:v1']` | 设置 v2：`{ version, dark{10 项}, light{10 项}, square, brandMark, linkChip, uiFont, sidebarFont, packName, activeSkin }` |
| `IndexedDB['dsh-mini-skin'].images` | 本地图片本体，键为**图片槽位** `区域:模式:状态`（`canvas:dark:idle` … `character:light:work`）；读出来的 blob URL 按槽位惰性缓存，卸载时只回收缓存里实际存在的那些 |
| `<DSH_HOME>/mini-skins/*.json` | 皮肤库 |

迁移：v1（扁平、无模式概念）会**同时写进两套预设**；更早的 `dsh-mini-skin:art-opacity` 单键也会被读取（**先判键存在**——`Number(null)` 是 0，曾经因此让全新安装的默认不透明度变成 0）。

---

## 文件

| 路径 | 说明 |
|---|---|
| `lib/index.js` | **节点半边**：皮肤库目录 + `/api/dsh/mini-skins` 路由（`ctx.inject(["webServer"], ...)` + `server.register`）+ 官方皮肤包的持有与自愈 |
| `lib/client.js` | **浏览器半边**（提交型产物，约 473 KB，含 5 张内嵌图）：样式表、生命周期、设置分区、皮肤库客户端 |
| `package.json` | `dsh.bundle.patch` / `dsh.client` / `exports`（含 `./locale/*.json`）/ `files` 白名单 |
| `cordis.patch.yml` | bundle patch：插入插件行 |
| `locale/{zh,en}.json` | 插件菜单的本地化名称与简介 |
| `assets/plugin-icon.svg` | 插件图标（自绘，无第三方美术） |
| `artwork/` | 署名与许可 |
| `skins/official.json` | 官方皮肤包（1.7 KB，纯内置素材引用）：深色→暗色场景、浅色→亮色场景、侧栏→立绘 |
| `skins/orca-link.json` | 虎鲸链路示例包（四态：深色 90% / 亮色 65% 主内容不透明度 + 8 张动图槽位） |
| `skins/深海女仆/` | **深海女仆**：把 maid-atelier 的宫殿 + 双女仆合成成一张画布图。含两个构建脚本、两张合成场景图、Q 版小人、1.8 MB 的自包含包，以及一份"哪些还原得了 / 哪些还原不了"的分析（见该目录 `README.md`） |
| `dev/anim/` | 动画管线（图集切片、质心对齐、皮肤包生成、接缝校验）：**产出落在 `$DSH_HOME/mini-skins`，不写回本仓库**，留作复现手段 |

### 皮肤包（`skins/`）

`skins/` 下是**可以直接放进 `<DSH_HOME>/mini-skins/` 的皮肤包**：

| 包 | 说明 |
|---|---|
| `深海女仆/深海女仆.json` | 深海女仆：合成场景 + Q 版小人，8 个槽位内嵌 |
| `orca-link.json` | 虎鲸链路：四态预设 + 8 张动图槽位内嵌 |
| `official.json` | 官方皮肤。节点半边在库缺它时会补一份（按**包名**判断，不覆盖你改过的） |

三个包的素材都是**内嵌 base64**（mini-skin 不支持远程 URL），所以文件本身就有 1~2 MB。

**重新生成「深海女仆」那个包**（需要隔壁 `dsh-deep-whale` 仓库的素材，本仓库不分发那些原图）：

```powershell
cd skins\深海女仆
python build-deep-sea-maid-scene.py   # 宫殿 + 双女仆 -> scene-{dark,light}.webp
python build-deep-sea-maid-pack.py    # -> 深海女仆.json
```

脚本从 `<仓库根>/../dsh-deep-whale/maid-atelier/assets` 找素材；换机器时用环境变量
`MAID_ATELIER_ASSETS` 指绝对路径。`savedAt` 每次构建都会变，要可复现的产物就设
`MAID_SAVED_AT`（固定成仓库里那份的值即可逐字节重现）。

---

## 开发

工厂源码在 `dev/new-factory.txt`，`assemble.mjs` 把它拼到 `lib/client.js` 的图片前缀之后。**不要手改 `lib/client.js` 里那段工厂**：它每次都会被覆盖。

```powershell
node dev/assemble.mjs          # 拼接（保留 412 KB 图片前缀 + 内嵌 5 张图）
node --check mini-skin/lib/client.js   # 语法
```

### 验证（探针）

验证脚本通过 CDP 驱动一个隔离的无头 Chrome，对着一个探针 DSH 实例跑真实交互：

```powershell
# 1) 探针实例（写 ~/.dsh，需要更宽权限）
dsh --profile web --no-open --port 0
# 2) 隔离 Chrome（需要命名管道权限）
chrome --headless=new --no-sandbox --remote-debugging-port=9335 --user-data-dir=<工作区>\_probe-chrome
# 3) 跑脚本
$env:DSH_PROBE_APP='http://127.0.0.1:<端口>/?token=<令牌>'; $env:DSH_PROBE_CDP='http://127.0.0.1:9335'
node dev/verify-chain4.mjs
```

脚本要点（踩过的坑都在里面）：设置弹窗必须用**真实鼠标事件**（`Input.dispatchMouseEvent`）点击，`.click()` 无效；点击前要 `scrollIntoView`（面板会超出视口）；用 `<select>` 的 `value` + `change` 合成事件**驱动不了 React**。

**探针的硬限制**：探针实例**切不动宿主主题**（「外观」那三个方块点了不生效），所以"切主题 -> 换预设"这条路必须由人在真实界面里验。

---

## 已验证 / 未验证（如实）

**已在探针里实测通过**：插件装载（样式表 + `body` 属性）、画布与侧栏背景层真实绘制、侧栏定位 `0px 0px, 50% 100%`、面板渲染（7 下拉 / 4 滑块 / 4 数字框 / 11 按钮）、按模式取预设一致（含侧栏垂直偏移）、导出包生成（格式 / 命名 / 入库）、控制台**无异常**。

**已用无头 Chrome 实测（软件渲染）**：侧栏 268x268 下「无背景 / 静态图 / 空闲动图(6帧1.12s) / 工作动图(8帧0.66s) / 工作动图全屏」五档，帧距中位数均为 8.3ms(120Hz)、p95 8.4-8.5ms、最大不超过 18ms，Task% 差异全在 ±0.5% 噪声内（基线反而最高），Layout/Recalc 均为 0.00 —— 即动图代价**在噪声之下**。无头是软件渲染，真机 GPU 表现建议用 DevTools → Rendering → Frame Rendering Stats 复核。

**只有静态核查**：勾选式 UI、皮肤库路由的运行时行为、导入流程、v3 四套预设的迁移路径。

**已在真实界面确认**（用户实测，2026-10-09）：

- 面板改任何值不再被回退（bug 7）
- 执行工具 / 纯深度思考时保持工作态（bug 8）
- 深海女仆皮肤进出工作态不再闪（bug 12 + 13）—— 这一条最初两次修复都没治住，最后定位到"每个槽位各建一个 blob URL"，按内容去重后才消失
- 顶图不再把侧栏工作区列表挤掉（`clamp(72px, 18vh, 上限)`）

**仍未验证**：「官方皮肤改为库里的 `official.json`」这条做了静态核查 + 一次真实路由的入库/读取往返（1787 字节、四套预设键正确、库列表里只剩官方与虎鲸链路两份），**还没在界面上点过** —— 需要重启 DSH 让节点半边的新代码生效后再验一次。

**探针 / 实测抓出并修掉的真 bug**（留存记录）：

1. 行内样式写几百 KB 的 data URI -> 图不显示、换图无效（**图片数据必须留在样式表**）
2. 蒙版 `rgba()` 当作 `background-image` 图层 -> 整条声明失效（必须是 `linear-gradient()`）
3. 缺失的旧键 `Number(null) === 0` -> 全新安装默认不透明度为 0
4. 外层脚本 `const IMAGES` 在 HMR 重复求值时抛 `already been declared` -> 整份插件失效（改为可重复求值的 `window.__dshMiniSkinArt` 赋值）
5. 受控 `<select>` 的当前值不在选项里 -> 显示第一项（"不要背景图"），再选它因"值没变"不触发
6. 面板用 `inject` 捕获的**对象快照**初始化 -> 重新挂载后显示旧值（改为向插件取当前值）7. **面板改任何值都会被"重新读皮肤包"覆盖回去**（过 0.几秒回退成当前皮肤的原配置）。根因：改值走的是 `reapply()`，而它为了"磁盘上更新过的包点了也能生效"会重新读包、**把读回来的旧配置写回 settings 并落盘**。修法：改值只走纯套用的 `preview()`（不落盘、不读包），`reapply()` 也改成只影响页面、绝不写回设置
8. 工作状态误判：只用 `[data-state='running']` + composer `data-phase` 时，**执行工具 / 纯深度思考**会被判成空闲（那两个相位在这两种时刻都不成立）。改为以会话级的 `[data-chat-running]` 为首选判据
9. `fileUrls` 只预置了四个旧的两段键（`canvas:dark`…），而读写都用三段键（`canvas:dark:idle`）—— 对象上根本没有那些键，读到的是 `undefined`：行内出现 `url("undefined")` 让图不显示，`undefined !== null` 又让卸载时 `revokeObjectURL(undefined)` 抛异常、把整段清理中断。改为 Map + 惰性读取（读到才缓存，读不到就是"没有这张图"）
10. 「官方皮肤」以前把配置写死在代码里（一个 `builtin` 状态 + 一组默认常量），于是"官方"与"包"两套语义并存、面板里出现两个近义条目。改为：官方皮肤就是库里的 `official.json`，插件在读取列表时保证它存在（判据是**包名**，不覆盖用户改过的那份）；面板里 `official.json` 不再单独出现
11. 官方皮肤包入库时按包名生成文件名，中文名被净化成别的名字，客户端按 `official.json` 找不到它 → 库里出现两个官方皮肤。改为：官方包固定落到 `official.json`
12. **切空闲/工作态时画面闪一下**（四套预设指向同一张图也照样闪）。根因有两层：① 状态一变就重写整套设置，而图片是以 blob URL 写在 `body` 的行内自定义属性上的 —— 重写自定义属性会让 `body` 子树整体失效、那张 1920×1080 的背景重新解码，于是有一帧是空的；② 更要命的是**导入时每个槽位各建了一个 blob URL**，所以四套状态虽然存的是同一份字节，属性值却真的在 `A → B` 之间变，①的"值没变就不写"守卫拦不住。修法：按**内容指纹**（size + text）复用同一个 blob URL（同字节的图共用 URL，状态切换时值根本不变），再加"值没变就不写"的守卫。数值型变量照写，保证拖动滑块一定生效。这是插件级的修复：任何"多套状态共用一张图"的皮肤都会闪，而四套图确实不同的配置照样正常重放
13. 去重之后才暴露的配套坑：`artStore` / `artRevoke` 原来无条件 `revokeObjectURL`，而一个 URL 现在会被多个槽位共用 —— 必须改成"没有别的槽位还引用它"才回收，否则会把某张图从活着的槽位底下抽走。另外 `clearSettings` 是直接 `removeProperty`（绕过了写入缓存），那里要把缓存一起清掉，否则下次激活时属性会被当成"重复"而永远不再出现

---

## 许可

本仓库的**代码与美术分开许可**，两套条款各自独立：

| 范围 | 许可 | 文件 |
|---|---|---|
| **代码**：`lib/index.js`、`lib/client.js` 里的代码、`package.json`、`cordis.patch.yml`、`locale/*`、`assets/*`、`skins/*/*.py`、构建工具 | **MIT** | [`LICENSE`](LICENSE) |
| **美术**：`artwork/` 下的图片资源、`lib/client.js` 内嵌的图片数据、`skins/深海女仆/` 下的合成图与包内图片 | **CC BY-NC-SA 4.0** | [`artwork/LICENSE-ARTWORK`](artwork/LICENSE-ARTWORK) |

署名链（必须随资源一起保留）：

- 场景图：`orca-link` —— 上善 -> Small-tailqwq，见 [`artwork/NOTICE`](artwork/NOTICE)
- 立绘 / 宫殿 / Q 版小人：`maid-atelier` —— 上善 -> ZipZipPipe -> Small-tailqwq，见 [`artwork/NOTICE-maid-atelier`](artwork/NOTICE-maid-atelier)

注意事项：

- 美术是**非商业**许可：不得用于以商业优势或金钱报酬为主要目的的用途。
- 立绘经**降采样与重编码**后随包分发，属改编作品，按相同方式共享条款继续以 CC BY-NC-SA 4.0 分发。
- `skins/深海女仆/` 里的合成场景、Q 版小人、以及包内 base64 图片同样是**改编作品**：
  分了它就要把上面的署名链与许可一起带走。该目录只放脚本与产物，**不复制** maid-atelier 的原始素材文件。
- 复制本插件的图片资源时，**署名与许可必须一起带走**。
