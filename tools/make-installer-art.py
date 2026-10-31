"""生成安装向导用的 banner / dialog 位图（493x58 与 493x312，24 位 BMP）。

WixUI 会把正文文字直接叠在 dialog 位图上（默认深色字），所以背景必须是浅色的：
右侧放品牌图形与版本号，左侧留白给安装向导自己的文字。
banner 是标题条，WixUI 会在上面画白色文字，因此只放图标不放字。
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ICON = Path("app.ico")
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\segoeuib.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def icon_image(size: int) -> Image.Image:
    ico = Image.open(ICON)
    best = max(ico.info.get("sizes", [(256, 256)]))
    ico.size = best
    return ico.copy().convert("RGBA").resize((size, size), Image.LANCZOS)


def dark_strip(size: tuple[int, int]) -> Image.Image:
    """标题条：深色 + 左侧蓝紫光晕。"""
    w, h = size
    im = Image.new("RGB", (w, h), (26, 26, 32))
    glow = Image.new("RGB", (w, h), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-w * 0.2, -h * 1.2, w * 0.7, h * 1.6], fill=(44, 76, 128))
    gd.ellipse([w * 0.05, -h * 0.6, w * 0.6, h * 1.2], fill=(70, 46, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    return Image.blend(im, glow, 0.5)


def light_panel(size: tuple[int, int]) -> Image.Image:
    """正文背景：浅色渐变，左侧留白给文字。"""
    w, h = size
    im = Image.new("RGB", (w, h), (247, 248, 251))
    px = im.load()
    for y in range(h):
        for x in range(w):
            t = (x / w) * 0.6 + (y / h) * 0.4
            px[x, y] = (int(247 - 16 * t), int(248 - 20 * t), int(251 - 8 * t))
    tint = Image.new("RGB", (w, h), (255, 255, 255))
    td = ImageDraw.Draw(tint)
    td.ellipse([w * 0.55, -h * 0.25, w * 1.25, h * 1.15], fill=(196, 206, 244))
    td.ellipse([w * 0.72, h * 0.25, w * 1.3, h * 1.3], fill=(214, 198, 240))
    tint = tint.filter(ImageFilter.GaussianBlur(46))
    return Image.blend(im, tint, 0.55)


def make_banner() -> Image.Image:
    im = dark_strip((493, 58))
    ic = icon_image(36)
    im.paste(ic, (14, 11), ic)
    return im


def make_dialog() -> Image.Image:
    im = light_panel((493, 312))
    big = icon_image(150)
    im.paste(big, (493 - 150 - 26, 48), big)
    d = ImageDraw.Draw(im)
    word = "Aurora"
    f_word = load_font(24)
    ww = d.textlength(word, font=f_word)
    d.text((493 - 26 - ww, 206), word, font=f_word, fill=(52, 54, 66))
    ver = "v1.0.0"
    f_ver = load_font(12)
    vw = d.textlength(ver, font=f_ver)
    d.text((493 - 26 - vw, 240), ver, font=f_ver, fill=(130, 134, 148))
    return im


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "installer")
    out.mkdir(parents=True, exist_ok=True)
    make_banner().save(out / "banner.bmp", "BMP")
    make_dialog().save(out / "dialog.bmp", "BMP")
    print(f"wrote {out / 'banner.bmp'} and {out / 'dialog.bmp'}")
