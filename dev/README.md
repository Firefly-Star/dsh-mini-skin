# dev — 源码与验证工具

`lib/client.js` 是**提交型产物**：它 = 一段图片前缀（5 张内嵌图，412 KB）+ `new-factory.txt` 的工厂体。
**唯一维护地是 `new-factory.txt`**；`lib/client.js` 里那段工厂每次都会被 `assemble.mjs` 覆盖。

## 重建

```powershell
node dev/assemble.mjs                 # new-factory.txt -> lib/client.js（保留图片前缀）
node --check lib/client.js            # 语法自检
```

只想从零重做图片前缀（需要原始素材，见下）：

```powershell
python dev/shrink-maid.py             # 立绘降采样 -> WebP
node dev/embed-art.mjs                # 素材 -> base64 前缀
```

## 文件

| 文件 | 大小 | 说明 |
|---|---:|---|
| `new-factory.txt` | 55.0 KB | 工厂源码（唯一维护地）：样式表、生命周期、设置分区、皮肤库客户端。改这里，不要改 lib/client.js 里的工厂体。 |
| `assemble.mjs` | 1.1 KB | 把 new-factory.txt 拼到 lib/client.js 的图片前缀之后并写出 lib/client.js。 |
| `embed-art.mjs` | 1.6 KB | 从原始素材重新生成图片前缀（5 张图 -> base64 data URI）。 |
| `shrink-maid.py` | 1.1 KB | 立绘的降采样与重编码（Pillow），生成内嵌用的 WebP。 |
| `verify-chain2.mjs` | 9.9 KB | 探针验证：插件装载、背景层绘制、设置分区渲染、控制台异常。 |
| `verify-chain4.mjs` | 8.9 KB | 探针验证：切主题换预设、导出包（真实鼠标事件驱动）。 |
| `close-chrome-9335.mjs` | 0.3 KB | 用 Browser.close 精确关掉探针 Chrome。 |

## 原始素材

本仓库**不包含**原始素材文件（它们来自 `orca-link` 与 `maid-atelier` 两个皮肤包，许可见 `artwork/`）。
要重新生成图片前缀，需要先把原始图放到 `_perf-probe/`（工作区约定路径）或按 `embed-art.mjs` 顶部常量调整路径：

- 场景图：`orca-link` 的 `assets/runtime/*.webp`（暗色空态 / 暗色工作态 / 亮色空态 / 亮色工作态）
- 立绘：`maid-atelier` 的 `maid-atelier-maid-left-v5.webp`

已经内嵌进 `lib/client.js` 的那 5 张图属于 CC BY-NC-SA 4.0 美术（见 `artwork/NOTICE*`）。

## 探针验证

验证脚本通过 CDP 驱动一个**隔离的无头 Chrome**去点一个**探针 DSH 实例**。要点（都是踩过的坑）：

1. 设置弹窗必须用**真实鼠标事件**（`Input.dispatchMouseEvent`）点击；`.click()` 在这个宿主里无效。
2. 点击前先 `scrollIntoView`：面板会超出视口，否则鼠标点空。
3. 用 `<select>` 的 `value` + 合成 `change` **驱动不了 React**（受控组件不会触发 onChange）。
4. 探针实例**切不动宿主主题**（「外观」那三个方块点了不生效），所以「切主题 -> 换预设」只能由人在真实界面里验。
5. 探针 Chrome 需要命名管道权限；被沙箱拒绝时表现为 `platform_channel.cc:112` / `couldn't create signal pipe`，需要一次性放宽权限。

```powershell
# 1) 探针实例（会写 ~/.dsh）
dsh --profile web --no-open --port 0
# 2) 隔离 Chrome
chrome --headless=new --no-sandbox --remote-debugging-port=9335 --user-data-dir=<工作区>\_probe-chrome
# 3) 跑
$env:DSH_PROBE_APP='http://127.0.0.1:<端口>/?token=<令牌>'; $env:DSH_PROBE_CDP='http://127.0.0.1:9335'
node dev/verify-chain4.mjs
# 4) 收尾
node dev/close-chrome-9335.mjs
```

## 唯一真源

`dev/new-factory.txt` 是工厂源码的**唯一真源**。任何镜像副本（例如开发机上 `_perf-probe/` 里的那份）都已退休为指路文件，不要在那里编辑。

## 发布到 npm 的注意事项（实测踩过）

本插件**没有发布到 npm**。若哪天要发布：

1. **本机 npm 源是 `https://registry.npmmirror.com`（阿里只读镜像）** —— 镜像站不接受注册、也不能发布，发布必须显式指定官方源：
   `npm publish --registry=https://registry.npmjs.org/ --access public`
2. **npm 已关闭“传统方式创建账号”**：`npm adduser --auth-type=legacy` 会返回 `403 / Account creation via legacy auth is unavailable`；只能走 <https://www.npmjs.com/signup>（该站在 Cloudflare 人机验证之后；无痕 + 禁用扩展、或换网络/换设备）。
3. 若 CLI 的浏览器授权页打不开：在网站建一个 Access Token 写进本机 `~/.npmrc`（不要提交），再执行上面的 publish 命令；注意 npm 正在收紧“绕过 2FA”的令牌在发布上的使用，必要时改用 `--otp=<六位码>`。

## 动画管线（从 orca-link 状态图集到皮肤）

原始素材：`orca-link` 的状态图集（`assets/runtime` 里那张 1888×2360 的 webp = **8 列 × 10 行、每格 236×236**，`STATUS_ATLAS_CELL = 236`）。原皮肤靠 `MutationObserver` + JS 逐状态切行、CSS `steps(8)` 循环；我们把它**离线烘焙成动画 WebP**，运行时零 JS。

```
dev/anim/slice-atlas.py          图集 → 每行一个动画（row0..row9）
dev/anim/build-standby-skin.py   空闲（standby，第 0 行）→ 皮肤「虎鲸动图立绘（空闲）」
dev/anim/build-orca-replica.py   工作（working，第 2 行）→ 皮肤「虎鲸链路（复刻）」
dev/anim/check-anim.py           校验：帧数 / 时长 / 是否真是动画
skins/*.webp                     烘焙好的动图（standby 6 帧 3.35s / working 8 帧 0.66s）
skins/*.json                     可直接放进 <DSH_HOME>/mini-skins/ 的皮肤包
```

关键数值（源码 `status-character.ts` 与实测）：

| 项 | 值 |
|---|---|
| 行映射 | `standby:0  syncing:1  working:2  approval:3  input:4  review:5  complete:6  fault:7  offline:8  ready:9` |
| 空闲帧序 | `[0,0,0,0,1,2,3,2,1]`，时长 `[700,700,700,700,130,90,110,90,130]`（一轮 3.35s） |
| 工作帧序 | `[0..7]`，固定 83ms/帧（12fps，一轮 0.66s） |
| 对齐 | 以 **standby 帧 0 的 alpha 质心**为全局锚点，逐帧补偿（实测 working 各帧需 +4.5…+6.4px）；值是**从图集算出来的**，图集换了要重算 |

## v3：四套预设与工作状态检测

- 预设键：dark:idle / dark:work / light:idle / light:work；图片槽位同步扩为「区域:模式:状态」（8 槽），旧的 canvas:dark 与更早的 canvas 仍会兜底读到。
- 检测：每 0.4 秒读 [data-state=running] 与 [data-composer-input][data-phase]（submitting/adjudicating）。刻意不用 MutationObserver（原皮肤用了整个 body 的观察器）。
- 动图闭环：循环接缝必须落在小变化上。曾用 [0,0,1,2,3,2,1,0]（首末同帧）导致接缝处帧 0 连播 720ms，肉眼可见地静止一下；改成回文式 [0,1,2,3,2,1] 后接缝像素差 4.19（与内部帧间同量级）。dev/anim/build-seamless-idle.py 会把接缝差异打印出来。
- 副作用：皮肤包已选中时受控下拉的同值不触发 onChange，所以换包后需要「官方皮肤 → 再选回」，或等一个「重新应用」按钮。
