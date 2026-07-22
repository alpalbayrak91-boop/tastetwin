from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "brand" / "tastetwin-icon.png"
BRAND = ROOT / "public" / "brand"
EXTENSION = ROOT / "extension" / "icons"
ELECTRON = ROOT / "electron"


def square_icon(image: Image.Image, size: int) -> Image.Image:
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        raise RuntimeError("Logo has no visible pixels")
    cropped = image.crop(bounds)
    inner = max(1, round(size * 0.88))
    cropped.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    result.alpha_composite(cropped, ((size - cropped.width) // 2, (size - cropped.height) // 2))
    return result


source = Image.open(SOURCE).convert("RGBA")
BRAND.mkdir(parents=True, exist_ok=True)
EXTENSION.mkdir(parents=True, exist_ok=True)
ELECTRON.mkdir(parents=True, exist_ok=True)

master = square_icon(source, 1024)
master.save(SOURCE, optimize=True)
for size in (16, 32, 48, 128):
    square_icon(master, size).save(EXTENSION / f"icon-{size}.png", optimize=True)

square_icon(master, 32).save(ROOT / "public" / "favicon-32.png", optimize=True)
square_icon(master, 256).save(BRAND / "tastetwin-icon-256.png", optimize=True)
square_icon(master, 256).save(ELECTRON / "tastetwin-icon-256.png", optimize=True)
square_icon(master, 256).save(
    ELECTRON / "tastetwin-icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("TasteTwin icon set created")
