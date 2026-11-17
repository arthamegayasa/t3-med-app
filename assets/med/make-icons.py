"""T3 Med: draws the fork's icon and writes every size the desktop packaging and the web client use.

Run from the repository root with Python 3 and Pillow (`pip install --user pillow`):

    python assets/med/make-icons.py

The mark is a white cross on a teal tile. Each size is drawn on its own, eight times larger
and scaled down, so the 16 px icon is a sharp cross and not a blurred copy of the large one.
The outputs are tracked; rerun this only to change the mark.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent
TILE = (15, 118, 110, 255)  # teal 700
TILE_LIGHT = (20, 184, 166, 255)  # teal 500, the top of the tile
MARK = (255, 255, 255, 255)
SCALE = 8
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def tile(size: int, *, inset: float = 0.0, rounded: bool = True) -> Image.Image:
    """One icon of `size` pixels. `inset` is the transparent margin as a share of the size."""
    big = size * SCALE
    margin = round(big * inset)
    body = big - 2 * margin

    gradient = Image.new("RGBA", (1, 2))
    gradient.putpixel((0, 0), TILE_LIGHT)
    gradient.putpixel((0, 1), TILE)
    fill = gradient.resize((body, body), Image.Resampling.BILINEAR)

    mask = Image.new("L", (body, body), 0)
    radius = round(body * 0.22) if rounded else 0
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, body - 1, body - 1), radius=radius, fill=255)

    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    image.paste(fill, (margin, margin), mask)

    # Thicker arms on the smallest sizes, where a thin cross would fade into the tile.
    arm = body * (0.24 if size <= 24 else 0.2)
    reach = body * 0.3
    centre = big / 2
    draw = ImageDraw.Draw(image)
    corner = round(arm * 0.18)
    draw.rounded_rectangle(
        (centre - arm / 2, centre - reach, centre + arm / 2, centre + reach), radius=corner, fill=MARK
    )
    draw.rounded_rectangle(
        (centre - reach, centre - arm / 2, centre + reach, centre + arm / 2), radius=corner, fill=MARK
    )
    return image.resize((size, size), Image.Resampling.LANCZOS)


def write_ico(name: str) -> None:
    frames = [tile(size) for size in ICO_SIZES]
    frames[-1].save(
        OUT / name,
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=frames[:-1],
    )


def main() -> None:
    write_ico("t3med-windows.ico")
    write_ico("t3med-web-favicon.ico")
    tile(16).save(OUT / "t3med-web-favicon-16x16.png")
    tile(32).save(OUT / "t3med-web-favicon-32x32.png")
    # iOS rounds the corners itself and shows transparency as black.
    tile(180, rounded=False).convert("RGB").save(OUT / "t3med-web-apple-touch-180.png")
    tile(192).save(OUT / "t3med-web-icon-192x192.png")
    tile(512).save(OUT / "t3med-web-icon-512x512.png")
    tile(1024).save(OUT / "t3med-universal-1024.png")
    # The classic macOS safe area: an 824 px body inset 100 px on every side.
    tile(1024, inset=100 / 1024).save(OUT / "t3med-macos-1024.png")


if __name__ == "__main__":
    main()
