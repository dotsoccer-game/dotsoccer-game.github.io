# 正面の走り（ユーザーの動画 a4b1bcc7 をドット単位で写したもの）。23列×31行、列11が体の中心、行29がふちの下＝足もと
# 本家：N（待機と同じ）→ A（画面の右の腕を外へ振り出し、左の手は体の前の腰の高さ。右脚が前で長く濃い靴、左脚は後ろで短い）→ N → C（Aの左右逆）
# A・C では頭が2段沈み（あごが肩にかかる）、足も2段浮く（動画の頭と足の高さを測った値）
import json
W, H = 23, 31
def blank(): return [['.'] * W for _ in range(H)]
def span(g, r, a, b, ch):
    for c in range(a, b + 1): g[r][c] = ch
def put(g, pts):
    for r, c, ch in pts: g[r][c] = ch
def outline(g):
    pts = [(r, c) for r in range(H) for c in range(W) if g[r][c] not in '.o']
    for r, c in pts:
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < H and 0 <= cc < W and g[rr][cc] == '.': g[rr][cc] = 'o'
def head(g, dy=0):
    span(g, 1 + dy, 7, 15, 'h')
    for r in (2, 3): span(g, r + dy, 6, 16, 'h')
    r = 4 + dy; span(g, r, 6, 16, 's'); span(g, r, 6, 7, 'h'); span(g, r, 15, 16, 'h')       # 生えぎわ
    r = 5 + dy; span(g, r, 6, 16, 's'); g[r][6] = g[r][16] = 'h'
    for r in (6 + dy, 7 + dy, 8 + dy): span(g, r, 6, 16, 's'); g[r][6] = g[r][16] = 'S'
    for r in (4, 5, 6, 7): g[r + dy][9] = g[r + dy][13] = 'e'                                    # 縦長の目（4段）
    r = 9 + dy; span(g, r, 7, 15, 's'); g[r][7] = g[r][15] = 'S'
    r = 10 + dy; span(g, r, 7, 14, 's'); span(g, r, 10, 12, 'S'); g[r][7] = g[r][14] = 'S'     # あごの下の影
def stripe(g, rows):
    for r in rows: g[r][8] = g[r][9] = 'r'
def N():
    g = blank(); head(g)
    sp = {11: (6, 16), 12: (5, 17), 13: (4, 18), 14: (3, 19), 15: (2, 20), 16: (2, 20), 17: (1, 21), 18: (1, 21)}
    for r, (a, b) in sp.items(): span(g, r, a, b, 'b'); g[r][b] = 'B'
    span(g, 19, 5, 17, 'b'); span(g, 19, 1, 4, 's'); span(g, 19, 18, 21, 's'); g[19][21] = 'S'
    span(g, 20, 5, 17, 'b'); span(g, 20, 1, 3, 's'); g[20][3] = 'S'; g[20][4] = 'o'; g[20][18] = 'o'; span(g, 20, 19, 21, 's'); g[20][21] = 'S'
    for r in (21, 22, 23): span(g, r, 5, 17, 'p'); g[r][17] = 'P'
    span(g, 24, 5, 9, 'p'); span(g, 24, 13, 17, 'p'); g[24][17] = 'P'; span(g, 24, 10, 12, 'o')
    for r in range(25, 29): span(g, r, 5, 8, 'c'); span(g, r, 14, 17, 'c'); g[r][8] = g[r][17] = 'C'
    span(g, 25, 9, 13, 'o')
    stripe(g, range(11, 20)); outline(g); return g
def A():
    """画面の右の腕を外へ振り出し（袖が胴から離れ、手は外の下）、左の手は体の前で腰の高さ。右脚が前（長く、濃い靴が下に）、左脚は後ろ（くつ下が少しと靴だけ）"""
    g = blank(); d = 2; head(g, d)
    # 胴（あごの下がすぐ肩：頭が沈む）
    span(g, 11, 6, 7, 'b'); span(g, 11, 16, 18, 'b'); g[11][18] = 'B'
    span(g, 12, 4, 21, 'b'); span(g, 12, 8, 10, 's'); g[12][14] = 'B'; g[12][19] = g[12][20] = 'B'
    span(g, 13, 3, 21, 'b'); g[13][3] = 'B'; g[13][7] = 'B'; g[13][21] = 'B'
    span(g, 14, 3, 17, 'b'); g[14][18] = 'B'; span(g, 14, 19, 20, 'b'); g[14][21] = 's'                   # 右の袖が胴から離れる
    span(g, 15, 3, 17, 'b'); g[15][17] = 'B'; g[15][18] = 'o'; span(g, 15, 19, 20, 'b'); g[15][21] = 's'
    span(g, 16, 3, 5, 's'); g[16][5] = 'S'; span(g, 16, 6, 17, 'b'); g[16][17] = 'B'; g[16][18] = 'o'; g[16][19] = 'o'; g[16][20] = 's'; g[16][21] = 's'
    span(g, 17, 3, 5, 's'); g[17][5] = 'S'; span(g, 17, 6, 17, 'b'); g[17][17] = 'B'; g[17][6] = 'o'       # 左の手：体の前・腰の高さ（3ドット）
    span(g, 18, 3, 4, 'S'); g[18][5] = 'o'; span(g, 18, 6, 17, 'b'); g[18][17] = 'B'
    span(g, 19, 5, 17, 'b'); g[19][17] = 'B'
    span(g, 20, 5, 17, 'b'); g[20][17] = 'B'
    span(g, 21, 5, 17, 'p'); g[21][17] = 'P'
    span(g, 22, 5, 13, 'p'); span(g, 22, 10, 12, 'P'); span(g, 22, 14, 17, 'c'); g[22][17] = 'C'          # 右脚が前へ：太ももの下からくつ下
    span(g, 23, 5, 9, 'p'); span(g, 23, 10, 12, 'o'); g[23][13] = 'P'; span(g, 23, 14, 17, 'c'); g[23][17] = 'C'
    span(g, 24, 7, 8, 'c'); span(g, 24, 9, 10, 'x'); span(g, 24, 13, 16, 'c'); g[24][16] = 'C'             # 左脚：後ろで短いくつ下と靴
    span(g, 25, 13, 14, 'c'); span(g, 25, 15, 16, 'x')
    span(g, 26, 13, 17, 'x')                                                                               # 右の靴（濃い）が下に
    stripe(g, range(13, 20)); outline(g); return g
def mirror(g):
    m = [list(reversed(row)) for row in g]
    for r in range(H):
        for c in range(W):
            if m[r][c] == 'r': m[r][c] = 'b'
    # 正面の赤い線は左寄り（列8・9）のまま描き直す。左右を写した位置にあった線のぶんは白
    for r in range(H):
        if 'r' in ''.join(g[r]): m[r][8] = m[r][9] = 'r' if m[r][8] in 'bB' else m[r][8]
    return m
if __name__ == '__main__':
    n, a = N(), A(); c = mirror(a)
    F = {k: [''.join(r) for r in v] for k, v in {'FA': a, 'FN': n, 'FC': c}.items()}
    json.dump(F, open('/tmp/claude-0/art3/front2.json', 'w'))
    for k in ('FN', 'FA'): print(k); [print('%2d %s' % (i, r)) for i, r in enumerate(F[k])]
