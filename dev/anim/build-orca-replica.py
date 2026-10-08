import base64, glob, json, os, datetime
from PIL import Image

WS = r"C:\Users\Summer\Documents\deepseek-harness\default-workspace"
atlas = None
for p in sorted(glob.glob(os.path.join(WS, r"dsh-deep-whale\orca-link\assets\runtime\*.webp")), key=os.path.getsize, reverse=True):
    if Image.open(p).size == (1888, 2360):
        atlas = p; break
im = Image.open(atlas).convert("RGBA")
CELL = 236

def cell(row, f):
    return im.crop((f * CELL, row * CELL, (f + 1) * CELL, (row + 1) * CELL))

def centroid(img, n=64):
    a = img.getchannel("A").resize((n, n), Image.BILINEAR); px = a.load()
    sx = sy = sw = 0.0
    for y in range(n):
        for x in range(n):
            w = px[x, y]
            if w: sx += (x + 0.5) * w; sy += (y + 0.5) * w; sw += w
    return (sx / sw * (CELL / n), sy / sw * (CELL / n)) if sw else (CELL / 2, CELL / 2)

ANCHOR = centroid(cell(0, 0))            # 源码：以 standby 帧 0 的质心为全局锚点
print("全局锚点(standby 帧0) = (%.1f, %.1f)" % ANCHOR)

SEQ = [0, 1, 2, 3, 4, 5, 6, 7]           # working（敲键盘）: 8 帧全不同
DUR = 83                                  # FRAME_INTERVAL_MS_BY_STATUS.working
frames = []
for f in SEQ:
    img = cell(2, f); c = centroid(img)
    dx, dy = ANCHOR[0] - c[0], ANCHOR[1] - c[1]
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    canvas.paste(img, (int(round(dx)), int(round(dy))))
    frames.append(canvas)
    print("  帧 %d 对齐 (%+.1f, %+.1f)" % (f, dx, dy))

d = os.path.join(WS, "_perf-probe", "sidebar-anim")
out = os.path.join(d, "working.webp")
frames[0].save(out, save_all=True, append_images=frames[1:], duration=DUR, loop=0, quality=88, method=4)
kb = round(os.path.getsize(out) / 1024, 1)
check = Image.open(out)
print("")
print("敲键盘动图: %s  %d 帧(写盘后 %d) / %dms 一帧 / 一轮 %.2fs / %s KB" % (out, len(frames), getattr(check, "n_frames", 1), DUR, len(frames) * DUR / 1000, kb))

data = "data:image/webp;base64," + base64.b64encode(open(out, "rb").read()).decode()
def mode(canvas):
    return {"canvasImage": canvas, "canvasImageUrl": "", "canvasFileName": "",
            "canvasOpacity": 52, "sidebarImage": "file", "sidebarImageUrl": "",
            "sidebarFileName": "working.webp", "sidebarOpacity": 100,
            "sidebarOffsetX": 0, "sidebarOffsetY": 0}
NAME = "虎鲸链路（复刻）"
pack = {"format": "dsh-mini-skin-pack", "version": 2, "name": NAME,
        "savedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "shared": {"square": True, "brandMark": "dsh", "linkChip": True, "uiFont": "system", "sidebarFont": "inherit", "packName": NAME},
        "modes": {"dark": mode("dark-hero"), "light": mode("light-hero")},
        "images": {"sidebar:dark": data, "sidebar:light": data}}
lib = os.path.join(os.environ["DSH_HOME"], "mini-skins")
os.makedirs(lib, exist_ok=True)
target = os.path.join(lib, "orca-link-replica.json")
with open(target, "w", encoding="utf-8") as fh:
    json.dump(pack, fh, ensure_ascii=False, indent=1)
print("皮肤包: %s  (%s KB)" % (target, round(os.path.getsize(target) / 1024, 1)))
print("  深色: 主内容=暗色场景  侧栏=敲键盘动图")
print("  浅色: 主内容=亮色场景  侧栏=敲键盘动图")
