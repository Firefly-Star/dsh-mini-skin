import glob, os
from PIL import Image
WS = r"C:\Users\Summer\Documents\deepseek-harness\default-workspace"
cands = glob.glob(os.path.join(WS, r"dsh-deep-whale\orca-link\assets\runtime\*.webp"))
atlas_path = None
for p in sorted(cands, key=os.path.getsize, reverse=True):
    im = Image.open(p)
    if im.size == (1888, 2360):
        atlas_path = p; break
if atlas_path is None:
    print("没找到 1888x2360 的图集"); raise SystemExit(1)
print("图集: " + os.path.basename(atlas_path) + "  " + str(round(os.path.getsize(atlas_path)/1024,1)) + " KB")

im = Image.open(atlas_path).convert("RGBA")
W, H = im.size
COLS, ROWS = 8, 10
cw, ch = W // COLS, H // ROWS
outdir = os.path.join(WS, "_perf-probe", "sidebar-anim")
os.makedirs(outdir, exist_ok=True)
print("格子: " + str(cw) + "x" + str(ch) + "  列x行 = " + str(COLS) + "x" + str(ROWS))
print("")
for r in range(ROWS):
    frames = [im.crop((c*cw, r*ch, (c+1)*cw, (r+1)*ch)) for c in range(COLS)]
    # 是否这一行有内容（有些行可能是空的）
    bbox = frames[0].getchannel("A").getbbox()
    out = os.path.join(outdir, "row" + str(r) + ".webp")
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=120, loop=0, quality=82, method=4)
    kb = round(os.path.getsize(out)/1024, 1)
    print("  row" + str(r) + ".webp  " + str(kb).rjust(7) + " KB   首帧内容区=" + str(bbox))
print("")
print("输出目录: " + outdir)
