import json, sys
from PIL import Image, ImageDraw
F = json.load(open('/tmp/claude-0/art/frames.json'))
keys = sys.argv[1].split(',') if len(sys.argv) > 1 else list(F)
def mul(c, k): return tuple(max(0, min(255, round(v * k))) for v in c)
shirt = (244,244,244); hair = (216,144,44); skin = (242,178,122); socks = (26,52,208); shoe = (44,44,48)
PAL = {'o': (28,24,30), 'h': hair, 'H': mul(hair,.72), 'b': shirt, 'B': mul(shirt,.78), 'p': shirt, 'P': mul(shirt,.82), 's': skin, 'S': mul(skin,.88),
       'c': socks, 'C': mul(socks,.8), 'x': shoe, 'X': mul(shoe,.7), 'g': (84,82,90), 't': (168,166,174), 'L': mul(shirt,1.3)}
def sprite(rows):
    im = Image.new('RGBA', (22, 24), (0,0,0,0))
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != '.': im.putpixel((c, r), PAL[ch] + (255,))
    return im
Z, G = 14, 3   # 拡大と、試合の大きさ（2.6を見やすく3で近似したもの…下で2.6でも出す）
W = len(keys) * (22 * Z + 30) + 40
im = Image.new('RGB', (W, 24 * Z + 200), (60,143,44)); d = ImageDraw.Draw(im)
for i, k in enumerate(keys):
    sp = sprite(F[k]); X0 = 20 + i * (22 * Z + 30)
    im.paste(sp.resize((22 * Z, 24 * Z), Image.NEAREST), (X0, 30), sp.resize((22 * Z, 24 * Z), Image.NEAREST))
    for x in range(23): d.line([(X0 + x * Z, 30), (X0 + x * Z, 30 + 24 * Z)], fill=(50,120,40))
    for y in range(25): d.line([(X0, 30 + y * Z), (X0 + 22 * Z, 30 + y * Z)], fill=(50,120,40))
    im.paste(sp.resize((22 * Z, 24 * Z), Image.NEAREST), (X0, 30), sp.resize((22 * Z, 24 * Z), Image.NEAREST))
    d.line([(X0 - 10, 30 + 23 * Z), (X0 + 22 * Z + 10, 30 + 23 * Z)], fill=(255,255,255), width=2)   # 足の裏の高さ
    d.text((X0, 8), k, fill=(255,255,255))
    s2 = sp.resize((round(22 * 2.6), round(24 * 2.6)), Image.NEAREST)
    im.paste(s2, (X0 + 60, 30 + 24 * Z + 40), s2)
im.save('/tmp/claude-0/art/preview.png')
