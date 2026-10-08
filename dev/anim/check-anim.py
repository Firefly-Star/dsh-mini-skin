import glob, os
from PIL import Image
WS = r"C:\Users\Summer\Documents\deepseek-harness\default-workspace\dsh-deep-whale"
for skin in ("maid-atelier", "orca-link"):
    rt = os.path.join(WS, skin, "assets", "runtime")
    files = sorted(glob.glob(os.path.join(rt, "*")), key=os.path.getsize, reverse=True)
    print("=== " + skin + " (" + str(len(files)) + " files) ===")
    for p in files[:12]:
        name = os.path.basename(p)
        try:
            im = Image.open(p)
            n = getattr(im, "n_frames", 1)
            mark = "  <== 动画!" if n > 1 else ""
            print("  " + name[:16] + ".. " + str(round(os.path.getsize(p)/1024,1)).rjust(8) + " KB  " + str(im.format).ljust(4) + " " + str(im.mode).ljust(5) + " " + str(im.size[0]) + "x" + str(im.size[1]) + "  frames=" + str(n) + "  dur=" + str(im.info.get("duration")) + "  loop=" + str(im.info.get("loop")) + mark)
        except Exception as e:
            print("  " + name[:16] + ".. 打不开: " + str(e))
    print("")
