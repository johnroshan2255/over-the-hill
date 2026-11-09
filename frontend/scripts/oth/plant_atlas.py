# OVERHILL — THE PLANTS' LEAF ATLAS (docs/MULTIPLAYER.md step 5 — PLANT: the building kit's saplings, hedge, flower bed
# and vegetable patch; the user: "good looking quality things … not just squares"). One 1024² RGBA atlas of CUT-OUT
# foliage cards, composed from ambientCG's CC0 scans (single leaves cut out of their sheets by their opacity, then laid
# as a real plant lays them) and flower heads drawn here:
#   top-left      BROAD — a leafy spray: a twig, ~18 beech leaves (LeafSet024) along it, turned out from it
#   top-right     CONIFER — a fan of fir sprigs (LeafSet019)
#   bottom-left   GRASS (Foliage005's blades in a tuft) | GREENS (LeafSet022's leaves: a chard / lettuce leaf rosette)
#   bottom-right  FLOWERS, 2 × 2: white daisies, buttercups, poppies, lupin-blue asters (petals drawn, 4× supersampled)
# The transparent texels take their neighbours' colour (no dark fringe as the mips blend into the cut). buildkit.py
# maps its foliage cards onto these tiles (PLANT_TILES — the same rects), the game draws them with ALPHA_CUT.
#   python3 scripts/oth/plant_atlas.py   → src/assets/textures/kit/leaf.webp (+ leaf_n.webp: flat, the cards bend the light)
import os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ACG = os.path.join(HERE, '.cache', 'ambientcg')
OUT = os.path.join(HERE, '..', '..', 'src', 'assets', 'textures', 'kit')
N = 1024
rng = np.random.default_rng(5)
R = lambda a=0.0, b=1.0: float(rng.uniform(a, b))


def cutouts(asset, min_px=2000):
    """The single leaves of an ambientCG leaf sheet: each connected piece of its opacity, cropped (RGBA)."""
    col = Image.open(os.path.join(ACG, asset, f'{asset}_1K-JPG_Color.jpg')).convert('RGB')
    op = np.asarray(Image.open(os.path.join(ACG, asset, f'{asset}_1K-JPG_Opacity.jpg')).convert('L'))
    lab, n = ndimage.label(op > 100)
    out = []
    for k, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None: continue
        m = (lab[sl] == k + 1)
        if m.sum() < min_px: continue
        rgba = np.dstack([np.asarray(col)[sl], (np.asarray(op)[sl] * m).astype(np.uint8)])
        out.append(Image.fromarray(rgba, 'RGBA'))
    return out


def paste(tile, leaf, cx, cy, length, angle, tone=1.0):
    """Leaf (its stem at the bottom of the crop, pointing up) laid with its stem at (cx, cy), `length` px long, pointing
    at `angle` (radians, 0 = up, + clockwise), its colour times `tone`."""
    w, h = leaf.size
    s = length / h
    im = leaf.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    if tone != 1.0:
        a = np.asarray(im).astype(np.float32); a[..., :3] = np.clip(a[..., :3] * tone, 0, 255); im = Image.fromarray(a.astype(np.uint8), 'RGBA')
    # rotate about the stem (bottom centre): pad so the stem is the image centre, then rotate
    W, H = im.size
    pad = Image.new('RGBA', (W, 2 * H), (0, 0, 0, 0)); pad.paste(im, (0, 0))
    rot = pad.rotate(-math.degrees(angle), resample=Image.BICUBIC, expand=True)
    tile.alpha_composite(rot, (int(cx - rot.size[0] / 2), int(cy - rot.size[1] / 2)))


def orient_up(leaf):
    """A sheet's leaf turned so its long axis runs up (its stem end at the bottom: the narrower end)."""
    a = np.asarray(leaf)[..., 3] > 0
    ys, xs = np.nonzero(a)
    c = np.cov(np.vstack([xs, ys]))
    ev, evec = np.linalg.eigh(c)
    vx, vy = evec[:, 1]
    ang = math.degrees(math.atan2(vx, vy))
    im = leaf.rotate(-ang, resample=Image.BICUBIC, expand=True)
    im = im.crop(im.getbbox())
    al = np.asarray(im)[..., 3] > 0
    top, bot = al[: al.shape[0] // 5].sum(), al[-al.shape[0] // 5:].sum()
    if bot > top: im = im.rotate(180, expand=True)   # (the wide end up; the stem's narrow end at the bottom)
    return im


def bleed(img, it=24):
    """The transparent texels given their neighbours' colour (dilated outward)."""
    a = np.asarray(img).astype(np.float32)
    rgb, al = a[..., :3].copy(), a[..., 3] > 8
    known = al.copy()
    for _ in range(it):
        if known.all(): break
        acc = np.zeros_like(rgb); cnt = np.zeros(known.shape, np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0: continue
                k = np.roll(np.roll(known, dy, 0), dx, 1)
                acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * k[..., None]; cnt += k
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow, None]
        known |= grow
    rgb[~known] = rgb[known].mean(0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a[..., 3]]).astype(np.uint8), 'RGBA')


atlas = Image.new('RGBA', (N, N), (0, 0, 0, 0))

# ---- BROAD: a twig with leaves turned out along it (top-left, 512²)
beech = [orient_up(l) for l in cutouts('LeafSet024')]
t = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(t)
pts = [(256 + 14 * math.sin(k / 10 * 2.4), 505 - k * 40) for k in range(11)]
d.line(pts, fill=(78, 58, 40, 255), width=6)
# (side twigs: the leaves on short stalks off the main one, splayed — a spray, not a column)
for k in range(22):
    f = (k + 0.5) / 22
    i = min(10, int(f * 10)); px, py = pts[i]
    side = -1 if k % 2 else 1
    ang = side * R(0.75, 1.35) * (1.0 - 0.45 * f)
    L = (118 + 40 * (1 - f)) * R(0.8, 1.05)
    sx, sy = px + math.sin(ang) * L * 0.22, py - math.cos(ang) * L * 0.22
    d.line([(px, py), (sx, sy)], fill=(84, 66, 44, 255), width=3)
    paste(t, beech[k % len(beech)], sx, sy, L, ang + side * R(-0.1, 0.25), R(0.74, 1.06))
paste(t, beech[1], pts[-1][0], pts[-1][1] + 10, 120, R(-0.15, 0.15), 0.95)
atlas.paste(t, (0, 0))

# ---- CONIFER: a fan of fir sprigs from the bottom middle (top-right, 512²)
fir = [orient_up(l) for l in cutouts('LeafSet019')]
t = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
for k, a in enumerate(np.linspace(-0.85, 0.85, 7)):
    paste(t, fir[k % len(fir)], 256 + a * 30, 505, 470 - abs(a) * 120, a, R(0.8, 1.05))
paste(t, fir[0], 256, 505, 480, 0.0, 1.0)
atlas.paste(t, (512, 0))

# ---- GRASS: a tuft of blades — drawn (each tapered, bowed, a shade lighter along its midrib), bottom-left 256 × 512
def blade(L, w, bend, col):
    S = 4
    im = Image.new('RGBA', (int(w * 2 + abs(bend) * 2 + 8) * S, int(L + 8) * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    cx = im.size[0] / 2
    left, right, mid = [], [], []
    for k in range(25):
        t = k / 24; y = (L + 4 - t * L) * S; x = cx + bend * t * t * S
        ww = w * (1 - t ** 1.6) * S
        left.append((x - ww, y)); right.append((x + ww, y)); mid.append((x, y))
    d.polygon(left + right[::-1], fill=col + (255,))
    d.line(mid, fill=tuple(min(255, int(v * 1.25)) for v in col) + (255,), width=max(1, int(w * S * 0.25)))
    return im.resize((im.size[0] // S, im.size[1] // S), Image.LANCZOS)
t = Image.new('RGBA', (256, 512), (0, 0, 0, 0))
for k in range(26):
    a = R(-0.5, 0.5)
    g = (int(R(52, 84)), int(R(96, 132)), int(R(30, 50)))
    b = blade(R(300, 490), R(5, 9), R(-60, 60), g)
    paste(t, b, 128 + a * 50, 510, b.size[1], a * 0.8)
atlas.paste(t, (0, 512))

# ---- GREENS: a rosette of broad leaves (chard / lettuce — LeafSet022), bottom-middle (256 × 512)
greens = [orient_up(l) for l in cutouts('LeafSet022')]
# (the cleanest leaves: fewest dark blemishes)
greens.sort(key=lambda l: (np.asarray(l)[..., :3].mean(-1)[np.asarray(l)[..., 3] > 0] < 60).mean())
greens = greens[:3]
t = Image.new('RGBA', (256, 512), (0, 0, 0, 0))
for k, a in enumerate((-0.62, 0.6, -0.34, 0.32, -0.1, 0.12)):
    L = (460 - abs(a) * 170) * R(0.9, 1.0)
    g = greens[k % len(greens)]
    paste(t, g.resize((int(g.size[0] * 0.62), g.size[1])), 128 + a * 30, 508, L, a, R(0.9, 1.1))
atlas.paste(t, (256, 512))

# ---- FLOWERS: four heads, 256² each (bottom-right) — drawn at 4×, the petals each their own shade
def flower(petal, centre, n, plen, pw, cr, cup=0.0):
    S = 1024
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    c = S / 2
    for k in range(n):
        a = k / n * 2 * math.pi + R(-0.08, 0.08)
        L = plen * R(0.88, 1.08) * S
        tone = R(0.86, 1.06)
        col = tuple(int(min(255, v * tone)) for v in petal) + (255,)
        # a petal: an ellipse along its direction (drawn as a polygon)
        poly = []
        for s in range(24):
            u = s / 23 * math.pi
            r = math.sin(u) * pw * S * (1 - cup * math.cos(u))
            along = (1 - math.cos(u)) / 2 * L + cr * S * 0.6
            poly.append((c + math.sin(a) * along + math.cos(a) * r, c - math.cos(a) * along + math.sin(a) * r))
        for s in range(23, -1, -1):
            u = s / 23 * math.pi
            r = -math.sin(u) * pw * S * (1 - cup * math.cos(u))
            along = (1 - math.cos(u)) / 2 * L + cr * S * 0.6
            poly.append((c + math.sin(a) * along + math.cos(a) * r, c - math.cos(a) * along + math.sin(a) * r))
        d.polygon(poly, fill=col)
        # (a vein down its middle, a shade darker)
        d.line([(c + math.sin(a) * cr * S, c - math.cos(a) * cr * S), (c + math.sin(a) * L * 0.9, c - math.cos(a) * L * 0.9)], fill=tuple(int(v * 0.86 * tone) for v in petal) + (255,), width=6)
    # the centre: a disc of florets, dotted
    d.ellipse([c - cr * S, c - cr * S, c + cr * S, c + cr * S], fill=centre + (255,))
    for k in range(int(cr * 400)):
        a = R(0, 2 * math.pi); r = math.sqrt(R()) * cr * S * 0.92
        x, y = c + math.cos(a) * r, c + math.sin(a) * r
        sh = R(0.6, 1.15)
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=tuple(int(min(255, v * sh)) for v in centre) + (255,))
    # (shaded: darker into the heart, lit along the petals' outer halves, a fine grain)
    a = np.asarray(im).astype(np.float32)
    yy, xx = np.mgrid[0:S, 0:S]; r = np.hypot(xx - c, yy - c) / (S * plen + 1)
    shade = 0.72 + 0.38 * np.clip(r * 1.4, 0, 1) - 0.1 * np.clip(r - 0.75, 0, 1)
    grain = 1 + (rng.random((S, S)) - 0.5) * 0.08
    a[..., :3] = np.clip(a[..., :3] * (shade * grain)[..., None], 0, 255)
    im = Image.fromarray(a.astype(np.uint8), 'RGBA')
    return im.filter(ImageFilter.GaussianBlur(1.2)).resize((256, 256), Image.LANCZOS)

heads = [
    flower((242, 240, 232), (222, 168, 30), 21, 0.36, 0.035, 0.085),        # daisy
    flower((250, 206, 34), (196, 150, 20), 5, 0.3, 0.13, 0.07, 0.2),         # buttercup
    flower((214, 38, 30), (30, 24, 28), 4, 0.34, 0.2, 0.08, 0.15),           # poppy
    flower((128, 102, 214), (236, 196, 60), 14, 0.34, 0.06, 0.07),           # aster
]
for k, h in enumerate(heads):
    atlas.paste(h, (512 + (k % 2) * 256, 512 + (k // 2) * 256))

atlas = bleed(atlas)
os.makedirs(OUT, exist_ok=True)
atlas.save(os.path.join(OUT, 'leaf.webp'), 'WEBP', quality=90, method=6, exact=False)
Image.new('RGB', (64, 64), (128, 128, 255)).save(os.path.join(OUT, 'leaf_n.webp'), 'WEBP', quality=95)
# a look at it, over grey
prev = Image.new('RGBA', atlas.size, (90, 96, 90, 255)); prev.alpha_composite(atlas)
prev.convert('RGB').save(os.path.join(HERE, '.cache', 'leaf_atlas_preview.jpg'), quality=88)
print('[atlas] wrote', os.path.join(OUT, 'leaf.webp'), f'{os.path.getsize(os.path.join(OUT, "leaf.webp")) / 1e3:.0f} kB')
