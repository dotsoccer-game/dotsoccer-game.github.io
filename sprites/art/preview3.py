import json, sys
from PIL import Image, ImageDraw
F = json.load(open('/tmp/claude-0/art3/frames.json'))
keys = sys.argv[1].split(',')
def mul(c, k): return tuple(max(0, min(255, round(v * k))) for v in c)
shirt = (246,246,246); hair = (222,146,40); skin = (240,184,140); socks = (20,40,220); shoe = (70,70,76); red = (230,50,30)
PAL = {'o': (40,36,42), 'h': hair, 'H': mul(hair,.72), 'b': shirt, 'B': (200,200,206), 'p': shirt, 'P': (200,200,206), 's': skin, 'S': mul(skin,.85),
       'c': socks, 'C': mul(socks,.8), 'x': shoe, 'r': red}
def sprite(rows):
    im = Image.new('RGBA', (len(rows[0]), len(rows)), (0,0,0,0))
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != '.': im.putpixel((c, r), PAL[ch] + (255,))
    return im
Z = 12; w, h = len(F[keys[0]][0]), len(F[keys[0]])
refs = sys.argv[2].split(',') if len(sys.argv) > 2 else []
cols = len(keys)
im = Image.new('RGB', (cols * (w * Z + 30) + 20, h * Z + 60 + 120 + (h * Z + 40 if refs else 0)), (60,143,44)); d = ImageDraw.Draw(im)
for i, k in enumerate(keys):
    sp = sprite(F[k]); X0 = 20 + i * (w * Z + 30)
    big = sp.resize((w * Z, h * Z), Image.NEAREST)
    for x in range(w + 1): d.line([(X0 + x * Z, 30), (X0 + x * Z, 30 + h * Z)], fill=(52,125,38))
    for y in range(h + 1): d.line([(X0, 30 + y * Z), (X0 + w * Z, 30 + y * Z)], fill=(52,125,38))
    im.paste(big, (X0, 30), big)
    d.line([(X0 - 8, 30 + 28 * Z), (X0 + w * Z + 8, 30 + 28 * Z)], fill=(255,255,255), width=2)
    d.text((X0, 8), k, fill=(255,255,255))
    s2 = sp.resize((round(w * 2.6), round(h * 2.6)), Image.NEAREST)
    im.paste(s2, (X0 + 100, 30 + h * Z + 30), s2)
if refs:
    crops = dict((i, (x, y)) for i, x, y in json.load(open('/tmp/claude-0/v7/crops.json')))
    for i, fi in enumerate(refs):
        fi = int(fi); cx, cy = crops[fi]
        r = Image.open('/tmp/claude-0/v7/f_%03d.png' % fi).convert('RGB').crop((cx - 45, cy - 50, cx + 45, cy + 60))
        r = r.resize((int(90 * 3.4), int(110 * 3.4)), Image.NEAREST)
        im.paste(r, (20 + i * (w * Z + 30), h * Z + 200))
        d.text((20 + i * (w * Z + 30), h * Z + 185), '本家 動画 %d' % fi, fill=(255,255,255))
im.save('/tmp/claude-0/art3/preview.png')
