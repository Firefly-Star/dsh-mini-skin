import base64, glob, json, os, datetime
from PIL import Image

WS = r"C:\Users\Summer\Documents\deepseek-harness\default-workspace"
atlas = None
for p in sorted(glob.glob(os.path.join(WS, r"dsh-deep-whale\orca-link\assets\runtime\*.webp")), key=os.path.getsize, reverse=True):
    if Image.open(p).size == (1888, 2360):
        atlas = p; break
im = Image.open(atlas).convert("RGBA")
CELL, ROW = 236, 0
SEQ = [0, 0, 0, 0, 1, 2, 3, 2, 1]
DUR = [700, 700, 700, 700, 130, 90, 110, 90, 130]

def cell(f):
    return im.crop((f * CELL, ROW * CELL, (f + 1) * CELL, (ROW + 1) * CELL))

def centroid(img, n=64):
    a = img.getchannel("A").resize((n, n), Image.BILINEAR)
    px = a.load(); sx = sy = sw = 0.0
    for y in range(n):
        for x in range(n):
            w = px[x, y]
            if w:
                sx += (x + 0.5) * w; sy += (y + 0.5) * w; sw += w
    if sw == 0: return (CELL / 2, CELL / 2)
    return (sx / sw * (CELL / n), sy / sw * (CELL / n))

c0 = centroid(cell(SEQ[0]))
print("锚点(standby 帧 0 质心): (%.1f, %.1f)" % c0)
frames = []
for i, f in enumerate(SEQ):
    img = cell(f); c = centroid(img)
    dx, dy = c0[0] - c[0], c0[1] - c[1]
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    canvas.paste(img, (int(round(dx)), int(round(dy))))
    frames.append(canvas)
    print("  step %d  帧 %d  对齐偏移 (%+.1f, %+.1f)" % (i, f, dx, dy))

outdir = os.path.join(WS, "_perf-probe", "sidebar-anim")
out = os.path.join(outdir, "standby.webp")
frames[0].save(out, save_all=True, append_images=frames[1:], duration=DUR, loop=0, quality=88, method=4)
still = os.path.join(outdir, "standby-still.webp")
frames[0].save(still, quality=88, method=4)
kb = round(os.path.getsize(out) / 1024, 1)
print("")
print("动图: %s  %s 帧 / 总 %.2fs / %s KB" % (out, len(frames), sum(DUR) / 1000, kb))
print("静态对照: %s  %s KB" % (still, round(os.path.getsize(still) / 1024, 1)))

data = "data:image/webp;base64," + base64.b64encode(open(out, "rb").read()).decode()
def mode():
    return {"canvasImage": "none", "canvasImageUrl": "", "canvasFileName": "", "canvasOpacity": 52,
            "sidebarImage": "file", "sidebarImageUrl": "", "sidebarFileName": "standby.webp",
            "sidebarOpacity": 100, "sidebarOffsetX": 0, "sidebarOffsetY": 0}
NAME = "虎鲸动图立绘（空闲）"
pack = {"format": "dsh-mini-skin-pack", "version": 2, "name": NAME,
        "savedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "shared": {"square": True, "brandMark": "dsh", "linkChip": True, "uiFont": "system", "sidebarFont": "inherit", "packName": NAME},
        "modes": {"dark": mode(), "light": mode()},
        "images": {"sidebar:dark": data, "sidebar:light": data}}
lib = os.path.join(os.environ["DSH_HOME"], "mini-skins")
os.makedirs(lib, exist_ok=True)
target = os.path.join(lib, "whale-standby-anim.json")
with open(target, "w", encoding="utf-8") as fh:
    json.dump(pack, fh, ensure_ascii=False, indent=1)
print("")
print("皮肤包已写入皮肤库: %s  (%s KB)" % (target, round(os.path.getsize(target) / 1024, 1)))
