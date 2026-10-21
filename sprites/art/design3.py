# カルチョビットAの背中（写真）と走り（動画）を、ドット単位で写し取って描き直す（23列×29行、列11が体の中心、行27がふちの下＝足もと）
# 動画から読んだ走り：A＝左腕を後ろへ振り出し右足を後ろへ蹴る／N＝待機と同じ／C＝Aの左右逆。A→N→C→N の4枚（A・Cは約0.13秒、Nは約0.1秒）
import json
W, H = 23, 29
def blank(): return [['.'] * W for _ in range(H)]
def span(g, r, c0, c1, ch):
    for c in range(c0, c1 + 1): g[r][c] = ch
def outline(g):
    pts = [(r, c) for r in range(H) for c in range(W) if g[r][c] not in '.o']
    for r, c in pts:
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < H and 0 <= cc < W and g[rr][cc] == '.': g[rr][cc] = 'o'
def head(g):
    span(g, 1, 8, 14, 'h')
    for r in (2, 3): span(g, r, 6, 16, 'h')
    span(g, 4, 6, 16, 'h'); g[4][6] = g[4][16] = 'H'
    span(g, 5, 6, 16, 'h'); span(g, 5, 6, 7, 'H'); span(g, 5, 15, 16, 'H')
    span(g, 6, 6, 16, 'H'); span(g, 6, 9, 13, 'h')   # 頭の上の明るい所は丸く、下と横が濃い
    span(g, 7, 6, 16, 'H')
    span(g, 8, 7, 15, 'H'); span(g, 9, 8, 14, 'H')
def stripe(g):
    for r in range(10, 18): g[r][13] = g[r][14] = 'r'
def shade(g, rows):
    # 胴の左右の内側1列を影の色に（写真の灰色の縁）
    for r in rows:
        cs = [c for c in range(W) if g[r][c] == 'b']
        if cs: g[r][cs[0]] = 'B'; g[r][cs[-1]] = 'B'
def stand():
    g = blank(); head(g)
    sp = {10: (6, 16), 11: (5, 17), 12: (4, 18), 13: (4, 18), 14: (3, 19), 15: (3, 19), 16: (2, 20)}
    for r, (a, b) in sp.items(): span(g, r, a, b, 'b')
    span(g, 17, 2, 5, 's'); span(g, 17, 6, 16, 'b'); span(g, 17, 17, 20, 's')
    span(g, 18, 2, 4, 's'); g[18][4] = 'S'; g[18][5] = 'o'; span(g, 18, 6, 16, 'b'); g[18][17] = 'o'; span(g, 18, 18, 20, 's'); g[18][20] = 'S'
    span(g, 19, 6, 16, 'b')
    for r in (20, 21): span(g, r, 6, 16, 'p')
    span(g, 22, 6, 10, 'p'); g[22][11] = 'o'; span(g, 22, 12, 16, 'p')
    for r in range(23, 27): span(g, r, 6, 8, 'c'); span(g, r, 14, 16, 'c')
    shade(g, range(12, 17)); stripe(g); outline(g)
    return g
def run_c():
    """右腕を後ろへ振り出し、左足を後ろへ蹴る（左腕は前へ振って隠れる）"""
    g = blank(); head(g)
    sp = {10: (6, 16), 11: (5, 17), 12: (4, 18), 13: (4, 19)}
    for r, (a, b) in sp.items(): span(g, r, a, b, 'b')
    span(g, 14, 4, 16, 'b'); g[14][17] = 'B'; span(g, 14, 18, 20, 'b')          # 袖が胴から離れて外へ
    span(g, 15, 4, 16, 'b'); g[15][19] = 'B'; span(g, 15, 20, 21, 's')           # 袖の先と手
    span(g, 16, 4, 16, 'b'); g[16][20] = 's'; g[16][21] = 'S'
    span(g, 17, 4, 16, 'b'); g[17][20] = 'S'
    for r in (18, 19): span(g, r, 4, 16, 'b')                                     # 左は手が見えず、胴の横がまっすぐ
    for r in (20, 21): span(g, r, 4, 16, 'p')
    span(g, 22, 4, 10, 'p'); g[22][11] = 'o'; span(g, 22, 12, 16, 'p')
    for r in range(23, 27): span(g, r, 14, 16, 'c')                               # 右足：接地（くつ下）
    span(g, 23, 5, 7, 'c')                                                        # 左足：後ろへ蹴る。くつ下の下に濃い靴が手前（下）へ出る
    for r in (24, 25, 26): span(g, r, 4, 7, 'x')
    span(g, 27, 4, 6, 'x')
    shade(g, range(12, 22)); stripe(g); outline(g)
    return g
def mirror(g):
    m = [list(reversed(row)) for row in g]
    # 背中の赤い線は左右を写さず、同じ位置に描き直す
    for r in range(H):
        for c in range(W):
            if m[r][c] == 'r': m[r][c] = 'b'
    stripe(m)
    return m
if __name__ == '__main__':
    N = stand(); C = run_c(); A = mirror(C)
    F = {'A': A, 'N': N, 'C': C}
    F = {k: [''.join(r) for r in v] for k, v in F.items()}
    json.dump(F, open('/tmp/claude-0/art3/frames.json', 'w'))
    for k in ('N', 'C'):
        print(k); [print('%2d %s' % (i, r)) for i, r in enumerate(F[k])]
