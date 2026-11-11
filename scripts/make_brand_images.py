"""Makes the share image (public/og.png, 1200x630) and the home-screen icon (public/apple-touch-icon.png, 180x180).

    python3 scripts/make_brand_images.py

Needs Pillow and the Inter font (the paths below). The output PNGs are committed, so this only runs when the look changes."""
from PIL import Image, ImageDraw, ImageFont
import pathlib
out = pathlib.Path(__file__).resolve().parent.parent / "public"
F = "/usr/share/fonts/opentype/inter/"
GROUND, INK, MUTED, GREEN, WASH, HAIR = "#FAFAF8", "#131815", "#5C6660", "#116149", "#E7F2EC", "#E3E5E0"

def mark(d, x, y, s, r):
    d.rounded_rectangle([x, y, x + s, y + s], radius=r, fill=GREEN)
    k = s / 64
    d.polygon([(x + 22*k, y + 48*k), (x + 22*k, y + 16*k), (x + 44*k, y + 16*k), (x + 44*k, y + 23*k), (x + 30*k, y + 23*k), (x + 30*k, y + 29*k), (x + 42*k, y + 29*k), (x + 42*k, y + 36*k), (x + 30*k, y + 36*k), (x + 30*k, y + 48*k)], fill="white")
    d.ellipse([x + 42*k, y + 42*k, x + 50*k, y + 50*k], fill="#9CC8B4")

# share image
im = Image.new("RGB", (1200, 630), GROUND); d = ImageDraw.Draw(im)
mark(d, 72, 72, 96, 22)
d.text((190, 98), "Fly AI", font=ImageFont.truetype(F + "Inter-Bold.otf", 44), fill=INK)
d.text((72, 232), "AI fly guide and", font=ImageFont.truetype(F + "InterDisplay-Bold.otf", 84), fill=INK)
d.text((72, 330), "fly fishing picker", font=ImageFont.truetype(F + "InterDisplay-Bold.otf", 84), fill=GREEN)
d.text((72, 462), "Flies ranked for your river and date, with the reports behind", font=ImageFont.truetype(F + "Inter-Regular.otf", 32), fill=MUTED)
d.text((72, 506), "every pick. River reports and fly shop pages that AI tools can read.", font=ImageFont.truetype(F + "Inter-Regular.otf", 32), fill=MUTED)
d.rectangle([0, 618, 1200, 630], fill=GREEN)
im.save(out / "og.png", optimize=True)

# home-screen icon
ic = Image.new("RGB", (180, 180), GREEN); d = ImageDraw.Draw(ic)
k = 180 / 64
d.polygon([(22*k, 48*k), (22*k, 16*k), (44*k, 16*k), (44*k, 23*k), (30*k, 23*k), (30*k, 29*k), (42*k, 29*k), (42*k, 36*k), (30*k, 36*k), (30*k, 48*k)], fill="white")
d.ellipse([42*k, 42*k, 50*k, 50*k], fill="#9CC8B4")
ic.save(out / "apple-touch-icon.png", optimize=True)
print("wrote og.png and apple-touch-icon.png")
