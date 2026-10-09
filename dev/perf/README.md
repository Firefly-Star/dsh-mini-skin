# 性能测量（口径对齐 deep-whale #114）

`measure.mjs` 用**和 `dsh-deep-whale/docs/performance-issue-114.md` 相同的方法**测本插件，
这样三边（官方主题 / deep-whale / mini-skin）的数字可以直接并排放进文章或 README。

## 方法（照抄 114，别改）

- 读 CDP `Performance.getMetrics` 的**累计耗时差值**，不是单帧耗时；
- 四类整轮操作：**输入并清空 / 左栏收放 / 会话往返切换 / 右栏收放**；
- 每项**预热一次**，再**串行测三轮取算术平均**；
- 每轮校验当前皮肤是否真的生效（不生效的样本直接丢弃）；
- 每轮之间等 600 ms；
- 正式计时**不启用**诊断开关（SelectorStats / invalidation tracking 会显著放大耗时）。

## 先跑自检（不用浏览器）

```powershell
node dev/perf/measure.mjs --selftest   # 用 114 已发布的数字回算本脚本的计算层
node dev/perf/measure.mjs --dry-run    # 校验参数、皮肤探针与操作实现是否齐备
```

## 正式测量

需要一个**在跑、且当前皮肤已切到被测那套**的 DSH 实例，加一个带远程调试端口的 Chrome：

```powershell
# 1) 探针实例（独立 DSH_HOME，避免污染日常 profile；需要更宽权限）
dsh --profile web --no-open --port 0

# 2) 隔离 Chrome（headless 的软件渲染会失真，测性能请用有窗口模式）
chrome --remote-debugging-port=9335 --user-data-dir=<工作区>\_perf-chrome

# 3) 测（皮肤要先在界面上切好）
$env:DSH_PROBE_APP='http://127.0.0.1:<端口>/?token=<令牌>'
$env:DSH_PROBE_CDP='http://127.0.0.1:9335'
node dev/perf/measure.mjs --skin mini-skin --label mini-skin-1
node dev/perf/measure.mjs --skin official --label official-1
```

结果写到 `dev/perf/out/<label>.json`（**不入库**，见 `.gitignore`）。

### 两个额外场景（114 的四类里没有）

```powershell
node dev/perf/measure.mjs --skin mini-skin --scenario scroll,stream
```

- `scroll`：让对话区滚一段，采 rAF 帧间隔 → 报中位数 / p95 / 最长帧 / 长帧（>50 ms）占比；
- `stream`：**合成**负载 —— 在页面里以固定节奏改一段文本，模拟"每帧都有 DOM 变更"。
  它**不是**真实模型输出，结果里标了 `synthetic: true`，引用时必须一起标注。

真实流式的做法相同，只要让它真的在输出、然后只采帧即可。

## 指标口径的现实情况（重要）

新版 Chrome（≥131）从 `Performance.getMetrics` 里**移除了** `LayoutDuration` / `RecalcStyleDuration`
（`LayoutCount` / `RecalcStyleCount` 仍在）。所以脚本启动时会打印实际可用的指标名，并自动选算法：

| 口径 | 条件 | 含义 | 能否与 114 直接比 |
|---|---|---|---|
| `duration` | 有 Duration 字段 | 风格重算 + 布局的累计耗时（ms） | **能**，同口径 |
| `count-mean` | 只有 Count 字段 | ΔCount（**次数**），是估算的替代口径 | **不能**，数值不同量纲 |
| `none` | 都没有 | 只能报 rAF 帧间隔 | 不能 |

结果 JSON 里记了 `method` 字段。写文章时**必须把这个口径说清楚** ——
`count-mean` 的数字不能和 114 的表放在同一列里比大小。

## 已知限制

- **每次切换皮肤后要等页面稳定**：皮肤热切换本身会重放设置，刚切完就测会混进切换开销。
- **headless 是软件渲染**：GPU 合成 / 光栅化的差异全都会失真，性能数字必须用有窗口模式测。
- **`rightbar` 可能跳过**：宿主没挂右栏时脚本会明确打印"跳过"，不会拿空样本充数。
- **一条命令只测一套皮肤**：四类操作共享"当前激活皮肤"这个状态，必须串行、不可并行。
