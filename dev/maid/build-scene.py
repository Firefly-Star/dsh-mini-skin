"""
把 maid-atelier 的三层素材（宫殿背景 + 左女仆 + 右女仆）合成为**一张**画布背景图。

为什么要合：mini-skin 的框架只能注入样式表，不能插入节点。原皮肤把宫殿和两位女仆
放在**对话列内部**的一个 stage 里，各自绝对定位、按 stage 高度百分比缩放（96% / 92%）。
我们的画布层是 body::before，固定在视口上，只能给一张图给一个 background-size ——
所以两位女仆必须和宫殿烤进同一张位图，按原皮肤的构图比例摆放。

坐标取自 `src/client/maid-atelier.module.css`：
  [data-skin-chrome='character-stage']  background: var(--maid-palace-art) center bottom / cover
  [data-maid-character='left']          bottom: 0; left: clamp(8px, 1.5%, 24px); height: 96%
  [data-maid-character='right']         right: clamp(8px, 1.5%, 24px); bottom: 0; height: 92%

**为什么女仆不贴视口边缘**：原皮肤把 stage 和两位女仆都放在**对话列内部**，侧栏一开，
对话列整体右移（dsh-client-ui-layout：`--maid-sidebar-width: 280px`，网格首列），女仆跟着走。
我们的画布层是 `body::before`，固定在视口上、不随侧栏移动，所以如果按视口边缘摆放，
侧栏（280px 实心列）就会盖住左边的女仆。这里改成按"**侧栏展开时**对话列的左右边界"内缩摆放：
对话列 = 280px..1920px，女仆各让开约 40px，于是两种侧栏状态都完整可见
（侧栏收起时 `background-position: center` 会把整张图右移 140px，女仆仍在视口内）。
"""
from PIL import Image
import os

# 本脚本所在目录 = 产物目录（仓库里就是 skins/maid-atelier/）。
OUT = os.path.dirname(os.path.abspath(__file__))
# 素材来自隔壁的 dsh-deep-whale 仓库（本仓库不分发这些原图）。
# 默认按 "<仓库根>/../dsh-deep-whale/maid-atelier/assets" 解析；换机器时用
# MAID_ATELIER_ASSETS 指定绝对路径。
def _assets_dir():
    override = os.environ.get("MAID_ATELIER_ASSETS")
    if override:
        return override
    # 从脚本目录往上找 dsh-deep-whale/maid-atelier/assets（脚本在 skins/<皮肤>/ 下，
    # 也可能被单独拷出来跑，所以逐级向上找）。
    here = OUT
    for _ in range(4):
        guess = os.path.join(here, "dsh-deep-whale", "maid-atelier", "assets")
        if os.path.isdir(guess):
            return guess
        here = os.path.dirname(here)
    return os.path.join(OUT, "..", "..", "dsh-deep-whale", "maid-atelier", "assets")


SRC = _assets_dir()

W, H = 1920, 1080
SIDEBAR_W = 280          # --maid-sidebar-width（侧栏展开时的实心列宽）
COLUMN_MARGIN = 40       # 女仆与对话列边界之间留的余量
STAND_BOTTOM = 970       # 女仆"站"在画布上的基线

LAYERS = [
    # (文件, 高度系数, 锚边, 该边距画布边缘的像素)
    ("maid-atelier-maid-left-v5.webp", 0.96, "left", SIDEBAR_W + COLUMN_MARGIN),
    ("maid-atelier-maid-right-v7.webp", 0.92, "right", COLUMN_MARGIN),
]
# 原来的 0.92 是从 preview(1920x1035) 反推的显示比例；再压一档，让两位女仆在
# 对话列里"站得下"而不互相顶到中间（原皮肤靠 character-fit.ts 动态让位，我们只能静态取舍）。
MAID_SCALE = 0.78
BACKDROPS = [
    ("maid-atelier-palace-night-v4.webp", "scene-dark.webp"),
    ("maid-atelier-palace-day-v4.webp", "scene-light.webp"),
]


def cover(img, w, h, anchor="center bottom"):
    """等价于 CSS background-size:cover + background-position:center bottom。"""
    iw, ih = img.size
    scale = max(w / iw, h / ih)
    nw, nh = round(iw * scale), round(ih * scale)
    resized = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = 0 if "bottom" in anchor else (nh - h) // 2
    return resized.crop((left, top, left + w, top + h))


def build(palace_name, out_name):
    palace = Image.open(os.path.join(SRC, palace_name)).convert("RGBA")
    canvas = cover(palace, W, H)

    for file, ratio, side, inset in LAYERS:
        figure = Image.open(os.path.join(SRC, file)).convert("RGBA")
        target_h = round(H * ratio * MAID_SCALE)
        target_w = round(figure.width * target_h / figure.height)
        figure = figure.resize((target_w, target_h), Image.LANCZOS)
        x = inset if side == "left" else W - inset - target_w
        y = STAND_BOTTOM - target_h
        canvas.alpha_composite(figure, (x, y))
        print(f"   {side:5} {file}  {target_w}x{target_h}  at ({x},{y})  右边界={x + target_w}")

    path = os.path.join(OUT, out_name)
    canvas.convert("RGB").save(path, "WEBP", quality=86, method=5)
    print(f"   -> {out_name}  {round(os.path.getsize(path) / 1024)} KB")


os.makedirs(OUT, exist_ok=True)
for palace, out in BACKDROPS:
    print(f"== {out}")
    build(palace, out)
