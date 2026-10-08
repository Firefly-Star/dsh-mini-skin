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
