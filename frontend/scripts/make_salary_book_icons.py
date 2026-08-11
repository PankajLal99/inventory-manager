"""Generate Salary Book PWA icons (PNG) from a simple vector-like draw."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'public'
ICONS = ROOT / 'icons'
ICONS.mkdir(parents=True, exist_ok=True)

BG = (4, 120, 87, 255)  # emerald-700
WHITE = (255, 255, 255, 255)
CREAM = (236, 253, 245, 255)


def draw_icon(size: int, pad_ratio: float = 0.18) -> Image.Image:
    img = Image.new('RGBA', (size, size), BG)
    draw = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    # Open book
    left = pad
    right = size - pad
    top = int(size * 0.28)
    bottom = int(size * 0.78)
    mid = size // 2
    spine_w = max(2, size // 48)
    # pages
    draw.polygon([(left, top + size // 18), (mid - spine_w, top), (mid - spine_w, bottom), (left, bottom - size // 18)], fill=WHITE)
    draw.polygon([(right, top + size // 18), (mid + spine_w, top), (mid + spine_w, bottom), (right, bottom - size // 18)], fill=CREAM)
    # spine
    draw.rectangle([mid - spine_w, top, mid + spine_w, bottom], fill=(16, 185, 129, 255))
    # lines on left page
    line_color = (4, 120, 87, 180)
    for i in range(4):
        y = top + int((bottom - top) * (0.28 + i * 0.14))
        x0 = left + size // 12
        x1 = mid - size // 14
        draw.line([(x0, y), (x1, y)], fill=line_color, width=max(1, size // 64))
    return img


def save(img: Image.Image, name: str):
    path = ICONS / name
    img.convert('RGB').save(path, 'PNG', optimize=True)
    print(path)


def main():
    save(draw_icon(180, 0.2), 'salary-book-180.png')
    save(draw_icon(192, 0.2), 'salary-book-192.png')
    save(draw_icon(512, 0.2), 'salary-book-512.png')
    # maskable: extra safe-zone padding
    mask = Image.new('RGB', (512, 512), BG[:3])
    inner = draw_icon(360, 0.2)
    mask.paste(inner.convert('RGB'), ((512 - 360) // 2, (512 - 360) // 2))
    (ICONS / 'salary-book-512-maskable.png').parent.mkdir(parents=True, exist_ok=True)
    mask.save(ICONS / 'salary-book-512-maskable.png', 'PNG', optimize=True)
    print(ICONS / 'salary-book-512-maskable.png')


if __name__ == '__main__':
    main()
