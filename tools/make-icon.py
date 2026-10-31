"""把设计的 PNG 转成 Windows 应用图标（去白底 + 多尺寸 ICO）。

用法：
    python tools/make-icon.py "C:\\path\\设计图.png" D:\\Aurora\\app.ico

做法：
1. 从边缘泛洪找出与边框相连的"近白"像素，作为背景去掉（内部高光保留）；
2. 用 alpha 反预乘去掉白色描边（白底去背景最常见的白边问题）；
3. alpha 轻微羽化，避免锯齿；
4. 按内容裁边，留 6% 边距，输出 1024 透明 PNG 与 16~256 多尺寸 ICO。
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


def white_background_mask(arr: np.ndarray) -> np.ndarray:
    """返回"与图边相连的近白区域"的布尔掩码。"""
    rgb = arr[:, :, :3].astype(np.int16)
    lo = rgb.min(axis=2)
    hi = rgb.max(axis=2)
    near_white = (lo >= 236) & ((hi - lo) <= 12)

    # 只在边框上找起点，避免把内部高光当背景
    h, w = near_white.shape
    seeds = []
    for x in range(w):
        seeds.append((x, 0))
        seeds.append((x, h - 1))
    for y in range(h):
        seeds.append((0, y))
        seeds.append((w - 1, y))

    mask_img = Image.fromarray(np.where(near_white, 255, 0).astype(np.uint8), "L")
    for sx, sy in seeds:
        if mask_img.getpixel((sx, sy)) == 255:
            ImageDraw.floodfill(mask_img, (sx, sy), 128, thresh=0)
    return np.array(mask_img) == 128


def unmatt_white(arr: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """白色背景去背景后的反预乘：c' = (c - (1-a)*255) / a。"""
    a = (alpha.astype(np.float32) / 255.0)[:, :, None]
    rgb = arr[:, :, :3].astype(np.float32)
    safe = np.clip(a, 1e-3, 1.0)
    rgb = (rgb - (1.0 - a) * 255.0) / safe
    return np.clip(rgb, 0, 255)


def build_icon(src: Path, out_ico: Path, out_png: Path) -> None:
    im = Image.open(src).convert("RGBA")
    arr = np.array(im)

    # 源图已经带透明背景（很多设计稿就是透明 PNG）时直接用它的 alpha，
    # 只有不透明白底图才做泛洪去背景 + 反预乘。
    src_alpha = arr[:, :, 3]
    has_alpha = float((src_alpha < 250).mean()) > 0.02
    if has_alpha:
        alpha = src_alpha.copy()
        rgb = arr[:, :, :3].astype(np.float32)
        print("source: transparent PNG, keep its alpha")
    else:
        bg = white_background_mask(arr)
        alpha = np.where(bg, 0, 255).astype(np.uint8)
        alpha = np.array(Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.8)))
        rgb = unmatt_white(arr, alpha)
        print("source: opaque, removed white background")

    rgba = np.dstack([rgb, alpha]).astype(np.uint8)
    flat = Image.fromarray(rgba, "RGBA")

    # 按内容裁边（先不留边距，边距按输出尺寸再补）
    box = flat.split()[3].getbbox()
    content = flat.crop(box) if box else flat

    def frame(size: int) -> Image.Image:
        # 小尺寸留边少一点，图形才看得清；大尺寸留 6% 更透气
        pad_ratio = 0.0 if size <= 24 else (0.03 if size <= 48 else 0.06)
        side = int(round(max(content.size) * (1 + pad_ratio * 2)))
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        inner = content.resize(
            (int(round(content.width * (1 - pad_ratio))), int(round(content.height * (1 - pad_ratio)))),
            Image.LANCZOS,
        ) if pad_ratio else content
        canvas.paste(inner, ((side - inner.width) // 2, (side - inner.height) // 2), inner)
        return canvas.resize((size, size), Image.LANCZOS)

    master = frame(1024)
    master.save(out_png, "PNG")

    frames = [frame(s) for s in SIZES]
    frames[-1].save(out_ico, format="ICO", sizes=[(s, s) for s in SIZES], append_images=frames[:-1])
    print(f"icon -> {out_ico}  ({out_ico.stat().st_size / 1024:.1f} KB, {len(SIZES)} sizes)")
    print(f"png  -> {out_png}  ({out_png.stat().st_size / 1024:.1f} KB, 1024x1024)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit('usage: make-icon.py <source.png> <out.ico> [out.png]')
    src = Path(sys.argv[1])
    ico = Path(sys.argv[2])
    png = Path(sys.argv[3]) if len(sys.argv) > 3 else ico.with_suffix(".png")
    build_icon(src, ico, png)
