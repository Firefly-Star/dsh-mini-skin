import base64, datetime, glob, json, os
from PIL import Image, ImageChops
WS = r"C:\Users\Summer\Documents\deepseek-harness\default-workspace"
d = os.path.join(WS, "_perf-probe", "sidebar-anim")
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
ANCHOR = centroid(cell(0, 0))

def build(name, row, seq, durs):
    frames = []
    for f in seq:
        img = cell(row, f); c = centroid(img)
        canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        canvas.paste(img, (int(round(ANCHOR[0] - c[0])), int(round(ANCHOR[1] - c[1]))))
        frames.append(canvas)
    out = os.path.join(d, name)
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=88, method=4)
    # 接缝差异：末帧 vs 首帧（降采样到 64x64 比较，0 = 完全相同）
    a = frames[-1].convert("RGB").resize((64, 64), Image.BILINEAR)
    b = frames[0].convert("RGB").resize((64, 64), Image.BILINEAR)
    diff = ImageChops.difference(a, b)
    seam = sum(sum(px) for px in diff.getdata()) / (64 * 64 * 3)
    print("  %-26s %d 帧  一轮 %.2fs  %6.1f KB   接缝差异=%.2f%s" % (
        name, len(frames), sum(durs) / 1000, os.path.getsize(out) / 1024, seam,
        "  ← 首末同帧(会卡顿)" if seq[0] == seq[-1] else ""))
    return out

print("旧版（你正在看到的）:")
old = os.path.join(d, "idle-gentle.webp")
o = Image.open(old)
print("  idle-gentle.webp           %d 帧  一轮 1.37s  %6.1f KB   接缝差异=0.00  ← 首末同帧(会卡顿)" % (getattr(o, "n_frames", 1), os.path.getsize(old) / 1024))
print("")
print("闭环候选:")
build("idle-seamless-gentle.webp", 0, [0, 1, 2, 3, 2, 1], [240, 170, 140, 160, 170, 240])
build("idle-seamless-lively.webp", 0, [0, 1, 2, 3, 2, 1], [150, 110, 90, 110, 110, 150])
build("idle-seamless-row1.webp", 1, [0, 1, 2, 3, 4, 5, 6, 7], [170] * 8)

def uri(name):
    return "data:image/webp;base64," + base64.b64encode(open(os.path.join(d, name), "rb").read()).decode()
def preset(canvas, f):
    return {"canvasImage": canvas, "canvasImageUrl": "", "canvasFileName": "", "canvasOpacity": 52,
            "sidebarImage": "file", "sidebarImageUrl": "", "sidebarFileName": f,
            "sidebarOpacity": 100, "sidebarOffsetX": 0, "sidebarOffsetY": 0}
NAME = "虎鲸链路 · 工作/空闲"
working, idle = uri("working.webp"), uri("idle-seamless-gentle.webp")
pack = {"format": "dsh-mini-skin-pack", "version": 3, "name": NAME,
        "savedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "shared": {"square": True, "brandMark": "dsh", "linkChip": True, "uiFont": "system", "sidebarFont": "inherit", "packName": NAME},
        "modes": {"dark:idle": preset("dark-hero", "idle-seamless-gentle.webp"),
                  "dark:work": preset("dark-active", "working.webp"),
                  "light:idle": preset("light-hero", "idle-seamless-gentle.webp"),
                  "light:work": preset("light-active", "working.webp")},
        "images": {"sidebar:dark:idle": idle, "sidebar:dark:work": working,
                   "sidebar:light:idle": idle, "sidebar:light:work": working}}
target = os.path.join(os.environ["DSH_HOME"], "mini-skins", "orca-link-4state.json")
with open(target, "w", encoding="utf-8") as fh:
    json.dump(pack, fh, ensure_ascii=False, indent=1)
print("")
print("皮肤包已更新（空闲 → idle-seamless-gentle 闭环）: " + str(round(os.path.getsize(target)/1024,1)) + " KB")
