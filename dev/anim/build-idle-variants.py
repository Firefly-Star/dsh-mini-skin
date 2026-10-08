import base64, datetime, glob, json, os
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
ANCHOR = centroid(cell(0, 0))     # 全局锚点：standby 帧 0

def build(name, row, seq, durs):
    frames = []
    for f in seq:
        img = cell(row, f); c = centroid(img)
        canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        canvas.paste(img, (int(round(ANCHOR[0] - c[0])), int(round(ANCHOR[1] - c[1]))))
        frames.append(canvas)
    out = os.path.join(WS, "_perf-probe", "sidebar-anim", name)
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=88, method=4)
    print("  %-26s %2d 帧  一轮 %.2fs  %6.1f KB" % (name, len(frames), sum(durs) / 1000, os.path.getsize(out) / 1024))
    return out

print("候选（都用 standby 那一行的原始帧）:")
a = build("idle-gentle.webp", 0, [0, 0, 1, 2, 3, 2, 1, 0], [240, 240, 140, 120, 130, 120, 140, 240])
build("idle-loop8.webp", 0, [0, 1, 2, 3, 4, 5, 6, 7], [170] * 8)
build("idle-row1.webp", 1, [0, 1, 2, 3, 4, 5, 6, 7], [170] * 8)

d = os.path.join(WS, "_perf-probe", "sidebar-anim")
def uri(name):
    return "data:image/webp;base64," + base64.b64encode(open(os.path.join(d, name), "rb").read()).decode()
def preset(canvas, sidebar_file, sidebar_opacity=100):
    return {"canvasImage": canvas, "canvasImageUrl": "", "canvasFileName": "", "canvasOpacity": 52,
            "sidebarImage": "file", "sidebarImageUrl": "", "sidebarFileName": sidebar_file,
            "sidebarOpacity": sidebar_opacity, "sidebarOffsetX": 0, "sidebarOffsetY": 0}
NAME = "虎鲸链路 · 工作/空闲"
working = uri("working.webp"); idle = uri("idle-gentle.webp")
pack = {"format": "dsh-mini-skin-pack", "version": 3, "name": NAME,
        "savedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "shared": {"square": True, "brandMark": "dsh", "linkChip": True, "uiFont": "system", "sidebarFont": "inherit", "packName": NAME},
        "modes": {"dark:idle": preset("dark-hero", "idle-gentle.webp"),
                  "dark:work": preset("dark-active", "working.webp"),
                  "light:idle": preset("light-hero", "idle-gentle.webp"),
                  "light:work": preset("light-active", "working.webp")},
        "images": {"sidebar:dark:idle": idle, "sidebar:dark:work": working,
                   "sidebar:light:idle": idle, "sidebar:light:work": working}}
lib = os.path.join(os.environ["DSH_HOME"], "mini-skins")
target = os.path.join(lib, "orca-link-4state.json")
with open(target, "w", encoding="utf-8") as fh:
    json.dump(pack, fh, ensure_ascii=False, indent=1)
print("")
print("皮肤包已更新（空闲改用 idle-gentle）: " + target + "  " + str(round(os.path.getsize(target)/1024,1)) + " KB")
