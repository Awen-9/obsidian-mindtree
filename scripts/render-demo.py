import json
from PIL import Image, ImageDraw, ImageFont

REPO = r"D:\Dev\Repos\Awen-9\obsidian-mindtree"

with open(REPO + r"\scripts\demo-layout.json", encoding="utf-8") as f:
    data = json.load(f)

SCALE = 2
PAD = 32

font_candidates = [
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
]


def load_font(size):
    for p in font_candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def render(nodes, out_path):
    min_x = min(n["x"] for n in nodes)
    min_y = min(n["y"] for n in nodes)
    max_x = max(n["x"] + n["w"] for n in nodes)
    max_y = max(n["y"] + n["h"] for n in nodes)

    W = int((max_x - min_x + PAD * 2) * SCALE)
    H = int((max_y - min_y + PAD * 2) * SCALE)

    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)

    def tx(v):
        return (v - min_x + PAD) * SCALE

    def ty(v):
        return (v - min_y + PAD) * SCALE

    by_text = {n["text"]: n for n in nodes}

    # edges
    for n in nodes:
        parent_text = n["parent"]
        if parent_text is None:
            continue
        p = by_text[parent_text]
        sx = tx(p["x"] + p["w"]) if n["side"] > 0 else tx(p["x"])
        ex = tx(n["x"]) if n["side"] > 0 else tx(n["x"] + n["w"])
        sy = ty(p["y"] + p["h"] / 2)
        ey = ty(n["y"] + n["h"] / 2)
        mx = (sx + ex) / 2
        pts = []
        for i in range(25):
            t = i / 24
            bx = (1 - t) ** 3 * sx + 3 * (1 - t) ** 2 * t * mx + 3 * (1 - t) * t ** 2 * mx + t ** 3 * ex
            by = (1 - t) ** 3 * sy + 3 * (1 - t) ** 2 * t * sy + 3 * (1 - t) * t ** 2 * ey + t ** 3 * ey
            pts.append((bx, by))
        d.line(pts, fill="#b6aed6", width=2 * SCALE)

    # nodes
    for n in nodes:
        x0, y0 = tx(n["x"]), ty(n["y"])
        x1, y1 = tx(n["x"] + n["w"]), ty(n["y"] + n["h"])
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2
        text = n["text"]

        if n["kind"] == "root":
            d.rounded_rectangle([x0, y0, x1, y1], radius=12 * SCALE, fill="#7c3aed")
            font = load_font(16 * SCALE)
            d.text((cx, cy), text, fill="#ffffff", font=font, anchor="mm")
        elif n["depth"] == 1:
            d.rounded_rectangle([x0, y0, x1, y1], radius=8 * SCALE, fill="#ede9fe", outline="#7c3aed", width=2 * SCALE)
            font = load_font(14 * SCALE)
            d.text((cx, cy), text, fill="#1e1b2e", font=font, anchor="mm")
        else:
            font = load_font(13 * SCALE)
            d.text((x0, cy), text, fill="#3b3852", font=font, anchor="lm")

        # folded badge
        if n["folded"]:
            badge = f"+{n['count']}"
            bfont = load_font(10 * SCALE)
            bb = d.textbbox((0, 0), badge, font=bfont)
            bw = bb[2] - bb[0] + 8 * SCALE
            bh = bb[3] - bb[1] + 4 * SCALE
            bx0 = x1 + 4 * SCALE
            by0 = cy - bh / 2
            d.rounded_rectangle([bx0, by0, bx0 + bw, by0 + bh], radius=bh / 2, fill="#7c3aed")
            d.text((bx0 + bw / 2, by0 + bh / 2), badge, fill="#ffffff", font=bfont, anchor="mm")

    img.save(out_path)
    print("saved", out_path, f"{W}x{H}")


render(data["full"], REPO + r"\docs\map.png")
render(data["folded"], REPO + r"\docs\recall.png")
