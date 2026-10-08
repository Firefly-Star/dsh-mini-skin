# dsh-mini-skin

一个只注入样式表的 DSH 皮肤插件，带一个**自包含的皮肤库**。所有开关集中在 **设置 → 自定义皮肤** 一个分区里。

运行时成本刻意压到最低：**0 个 `MutationObserver`**、**1 个一次性监听**（`DOMContentLoaded`）、只依赖宿主的稳定钩子（`data-slot=*`）。图片数据一律留在样式表里，切换素材只改一个 `body` 属性；行内变量只存**极小值**（rgba 颜色、字体栈、px 偏移、blob URL）。

---

## 安装

```powershell
# 本地目录（link：改文件即时生效，开发用）
dsh plugin --profile web add '<绝对路径>\mini-skin'

# tarball（复制安装，工作区目录不再是运行依赖）
npm pack --pack-destination .
dsh plugin --profile web add '<绝对路径>\dsh-mini-skin-0.1.0.tgz'

# git / npm（发布后）
dsh plugin --profile web add 'github:<用户名>/<仓库>#path:/'
```

**重启语义**：客户端半边（`lib/client.js`）热更新即可；**节点半边（`lib/index.js`）改动必须重启 DSH**。皮肤库路由只在重启后存在。

---

## 功能

### 四种皮肤状态

| 状态 | 含义 |
|---|---|
| **官方皮肤** | 宿主原样：本插件的样式表、`body` 属性、行内变量**全部撤下**（插件本体仍在，设置分区照旧可用） |
| **内置皮肤** | 出厂那套：深色→暗色场景、浅色→亮色场景、侧栏→maid-atelier 立绘 |
| **皮肤库里的皮肤** | 插件自带目录中的 `.json` 包，名字取自包内 `name` |
| **自定义** | 当前设置的指纹与应用皮肤时记下的指纹不符（即你改过任何一项） |

### 深浅各一套预设

主内容背景图 / 不透明度、侧栏背景图 / 不透明度 / 水平 / 垂直位置 **按模式各存一份**，主题切换时自动套用当前模式那一套。

面板顶部的「**正在编辑**」选择编辑哪一套：切换它会调用宿主的 `theme.setTheme()` 把界面主题**真的切过去**，所以你改什么就能立刻看到什么（等同「外观」那行，会持久化）。在某一套里改任何值也会先确保该套生效。

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
- **导出 = 两件事都做**：下载 `<名称>-<日期>.json` **并且**存入皮肤库（状态行分别报告两边结果）。
- **导入**：系统文件选择器读一个 `.json`，图片写回本机存储后立即套用。

### 包格式（自包含）

```json
{
  "format": "dsh-mini-skin-pack",
  "version": 2,
  "name": "我的皮肤",
  "savedAt": "2026-...",
  "shared": { "square": true, "brandMark": "dsh", "linkChip": true, "uiFont": "system", "sidebarFont": "inherit", "packName": "我的皮肤" },
  "modes": {
    "dark":  { "canvasImage": "dark-hero", "canvasOpacity": 52, "sidebarImage": "maid-left", "sidebarOpacity": 100, "sidebarOffsetX": 0, "sidebarOffsetY": 0 },
    "light": { "canvasImage": "light-hero", "canvasOpacity": 52, "sidebarImage": "maid-left", "sidebarOpacity": 100, "sidebarOffsetX": 0, "sidebarOffsetY": 0 }
  },
  "images": { "sidebar:dark": "data:image/webp;base64,..." }
}
```

- **内置素材按名字引用**（`dark-hero` / `light-hero` / `maid-left` ...），不重复打包 -> 纯内置配置的包只有几 KB。
- **本地图片的字节内嵌**进 `images`（键为 `区域:模式`）-> 换台机器导入即用，**不需要原文件**。
- `activeSkin`（皮肤库身份）**不进包**：由导入方在导入后决定。
- 因此"自包含"是结构上的保证：只涉及本地图片，没有跨域 / 失效链接的可能。

---

## 数据与存储

| 位置 | 内容 |
|---|---|
| `localStorage['dsh-mini-skin:settings:v1']` | 设置 v2：`{ version, dark{10 项}, light{10 项}, square, brandMark, linkChip, uiFont, sidebarFont, packName, activeSkin }` |
| `IndexedDB['dsh-mini-skin'].images` | 本地图片本体，键为 `canvas:dark` / `canvas:light` / `sidebar:dark` / `sidebar:light` |
| `<DSH_HOME>/mini-skins/*.json` | 皮肤库 |

迁移：v1（扁平、无模式概念）会**同时写进两套预设**；更早的 `dsh-mini-skin:art-opacity` 单键也会被读取（**先判键存在**——`Number(null)` 是 0，曾经因此让全新安装的默认不透明度变成 0）。

---

## 文件

| 路径 | 说明 |
|---|---|
| `lib/index.js` | **节点半边**：皮肤库目录 + `/api/dsh/mini-skins` 路由（`ctx.inject(["webServer"], ...)` + `server.register`） |
| `lib/client.js` | **浏览器半边**（提交型产物，460 KB，含 5 张内嵌图）：样式表、生命周期、设置分区、皮肤库客户端 |
| `package.json` | `dsh.bundle.patch` / `dsh.client` / `exports`（含 `./locale/*.json`）/ `files` 白名单 |
| `cordis.patch.yml` | bundle patch：插入插件行 |
| `locale/{zh,en}.json` | 插件菜单的本地化名称与简介 |
| `assets/plugin-icon.svg` | 插件图标（自绘，无第三方美术） |
| `artwork/` | 署名与许可 |

---

## 开发

工厂源码在 `_perf-probe/new-factory.txt`，`assemble.mjs` 把它拼到 `lib/client.js` 的图片前缀之后。**不要手改 `lib/client.js` 里那段工厂**：它每次都会被覆盖。

```powershell
node _perf-probe/assemble.mjs          # 拼接（保留 412 KB 图片前缀 + 内嵌 5 张图）
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
node _perf-probe/verify-chain4.mjs
```

脚本要点（踩过的坑都在里面）：设置弹窗必须用**真实鼠标事件**（`Input.dispatchMouseEvent`）点击，`.click()` 无效；点击前要 `scrollIntoView`（面板会超出视口）；用 `<select>` 的 `value` + `change` 合成事件**驱动不了 React**。

**探针的硬限制**：探针实例**切不动宿主主题**（「外观」那三个方块点了不生效），所以"切主题 -> 换预设"这条路必须由人在真实界面里验。

---

## 已验证 / 未验证（如实）

**已在探针里实测通过**：插件装载（样式表 + `body` 属性）、画布与侧栏背景层真实绘制、侧栏定位 `0px 0px, 50% 100%`、面板渲染（7 下拉 / 4 滑块 / 4 数字框 / 11 按钮）、按模式取预设一致（含侧栏垂直偏移）、导出包生成（格式 / 命名 / 入库）、控制台**无异常**。

**只有静态核查**：勾选式 UI、皮肤库路由的运行时行为（节点半边只能重启后验）、导入流程。

**探针 / 实测抓出并修掉的真 bug**（留存记录）：

1. 行内样式写几百 KB 的 data URI -> 图不显示、换图无效（**图片数据必须留在样式表**）
2. 蒙版 `rgba()` 当作 `background-image` 图层 -> 整条声明失效（必须是 `linear-gradient()`）
3. 缺失的旧键 `Number(null) === 0` -> 全新安装默认不透明度为 0
4. 外层脚本 `const IMAGES` 在 HMR 重复求值时抛 `already been declared` -> 整份插件失效（改为可重复求值的 `window.__dshMiniSkinArt` 赋值）
5. 受控 `<select>` 的当前值不在选项里 -> 显示第一项（"不要背景图"），再选它因"值没变"不触发
6. 面板用 `inject` 捕获的**对象快照**初始化 -> 重新挂载后显示旧值（改为向插件取当前值）

---

## 许可

本仓库的**代码与美术分开许可**，两套条款各自独立：

| 范围 | 许可 | 文件 |
|---|---|---|
| **代码**：`lib/index.js`、`lib/client.js` 里的代码、`package.json`、`cordis.patch.yml`、`locale/*`、`assets/*`、构建工具 | **MIT** | [`LICENSE`](LICENSE) |
| **美术**：`artwork/` 下的图片资源，以及 `lib/client.js` 内嵌的图片数据 | **CC BY-NC-SA 4.0** | [`artwork/LICENSE-ARTWORK`](artwork/LICENSE-ARTWORK) |

署名链（必须随资源一起保留）：

- 场景图：`orca-link` —— 上善 -> Small-tailqwq，见 [`artwork/NOTICE`](artwork/NOTICE)
- 立绘：`maid-atelier` —— 上善 -> ZipZipPipe -> Small-tailqwq，见 [`artwork/NOTICE-maid-atelier`](artwork/NOTICE-maid-atelier)

注意事项：

- 美术是**非商业**许可：不得用于以商业优势或金钱报酬为主要目的的用途。
- 立绘经**降采样与重编码**后随包分发，属改编作品，按相同方式共享条款继续以 CC BY-NC-SA 4.0 分发。
- 复制本插件的图片资源时，**署名与许可必须一起带走**。
