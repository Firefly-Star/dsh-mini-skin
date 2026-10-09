"""生成「深海女仆工坊」mini-skin 皮肤包（自包含：合成场景以 base64 内嵌）。

四套预设都用同一张合成场景（宫殿 + 双女仆），只有亮/暗两张图不同 —— 原皮肤是
"主题切换换宫殿"，没有工作/空闲之分，所以这里 idle 与 work 给同一张，
将来想按状态区分（例如工作时把女仆缩到 64%）只需替换对应那套的图。

**侧栏不放背景图。** 原皮肤的侧栏装饰是"Q 版小人"（`[data-skin-chrome='sidebar-mascot']`：
`left: 52%; bottom: calc(swag + 94px); width: min(320px, 0.82 × 280px)`，即侧栏底部、宽 230px）。
我们的侧栏背景层是 `background-size: 100% 100%`，把立绘拉成整列背景会**横向拉伸**、
而且位置也不对，所以侧栏背景留空、改用「顶部图」槽位放那个 Q 版 ——
它是按 `contain` 等比渲染的，不会变形。

不透明度取 78%：既让宫殿透出宿主的底色（原皮肤是让 chat 面透明、露出整张宫殿），
又不至于把女仆糊掉。
"""
import base64, io, json, os, datetime

# 本脚本所在目录 = 产物目录（仓库里就是 skins/maid-atelier/）。
HERE = os.path.dirname(os.path.abspath(__file__))
# 素材来自隔壁的 dsh-deep-whale 仓库（本仓库不分发这些原图）。
# 默认按 "<仓库根>/../dsh-deep-whale/maid-atelier/assets" 解析；换机器时用
# MAID_ATELIER_ASSETS 指定绝对路径。
def _assets_dir():
    override = os.environ.get("MAID_ATELIER_ASSETS")
    if override:
        return override
    # 从脚本目录往上找 dsh-deep-whale/maid-atelier/assets（脚本在 skins/<皮肤>/ 下，
    # 也可能被单独拷出来跑，所以逐级向上找）。
    here = HERE
    for _ in range(4):
        guess = os.path.join(here, "dsh-deep-whale", "maid-atelier", "assets")
        if os.path.isdir(guess):
            return guess
        here = os.path.dirname(here)
    return os.path.join(HERE, "..", "..", "..", "dsh-deep-whale", "maid-atelier", "assets")


SRC = _assets_dir()
CHIBI = os.path.join(SRC, "runtime", "405917afdb68d725624bbf7e4f1619a35fc4004039b7d553c5528ca5f65308d3.webp")
NAME = "深海女仆工坊"
OPACITY = 78
# 原皮肤渲染出来的 Q 版尺寸：宽 230px、高约 205px（620x553 的素材等比缩到 230 宽）。
CHIBI_HEIGHT = 205


def webp_bytes(path, width=None):
    from PIL import Image

    image = Image.open(path).convert("RGBA")
    if width is not None and image.width > width:
        height = round(image.height * width / image.width)
        image = image.resize((width, height), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=88, method=5)
    return buffer.getvalue()


def data_url(path, width=None):
    return "data:image/webp;base64," + base64.b64encode(webp_bytes(path, width)).decode("ascii")


def preset(canvas_file):
    return {
        "canvasImage": "file",
        "canvasImageUrl": "",
        "canvasFileName": canvas_file,
        "canvasOpacity": OPACITY,
        "sidebarImage": "none",
        "sidebarImageUrl": "",
        "sidebarFileName": "",
        "sidebarOpacity": 100,
        "sidebarOffsetX": 0,
        "sidebarOffsetY": 0,
        "characterImage": "file",
        "characterFileName": "maid-chibi.webp",
        "characterHeight": CHIBI_HEIGHT,
    }


dark = data_url(os.path.join(HERE, "scene-dark.webp"))
light = data_url(os.path.join(HERE, "scene-light.webp"))
chibi = data_url(CHIBI)

pack = {
    "format": "dsh-mini-skin-pack",
    "version": 3,
    "name": "maid-atelier",
    # savedAt 是唯一的"每跑一次就变"的字段。要可复现的产物就设 MAID_SAVED_AT
    # （例如把它固定成仓库里那份的值），否则取当前时间。
    "savedAt": os.environ.get("MAID_SAVED_AT") or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    "shared": {
        "square": True,
        "brandMark": "dsh",
        "linkChip": True,
        "uiFont": "system",
        "sidebarFont": "inherit",
        "packName": NAME,
    },
    "modes": {
        "dark:idle": preset("scene-dark.webp"),
        "dark:work": preset("scene-dark.webp"),
        "light:idle": preset("scene-light.webp"),
        "light:work": preset("scene-light.webp"),
    },
    "images": {
        "canvas:dark:idle": dark,
        "canvas:dark:work": dark,
        "canvas:light:idle": light,
        "canvas:light:work": light,
        "character:dark:idle": chibi,
        "character:dark:work": chibi,
        "character:light:idle": chibi,
        "character:light:work": chibi,
    },
}

out = os.path.join(HERE, "maid-atelier.json")
with open(out, "w", encoding="utf-8") as fh:
    json.dump(pack, fh, ensure_ascii=False)
print(f"pack: {out}  {round(os.path.getsize(out) / 1024)} KB")
for key, value in pack["images"].items():
    print(f"   {key:22} {round(len(value) / 1024)} KB (base64)")
