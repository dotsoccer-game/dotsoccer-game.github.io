# 斜め奥（画面の右上へ走る）：ユーザーの動画 7ebcd92c（赤青の選手）をドット単位で写したもの。幅27・高さ31、行28がふちの下＝足もと
# 本家：N（立ち姿に近い。手前の手は左下、奥の手は右の低い所）→ T（両腕を横へ広げ、片脚で着地）→ N → P（奥の腕を背中の前へ振って手は背中の右寄り、脚を前後に大きく開く）
# T・Pは約0.17秒（5コマ）、Nは約0.1秒（3コマ）。T・Pは頭が1〜2段沈み、足も浮く（動画で測った値）
import json
W, H = 27, 31
def blank(): return [['.'] * W for _ in range(H)]
def span(g, r, a, b, ch):
    for c in range(a, b + 1):
        if 0 <= r < H and 0 <= c < W: g[r][c] = ch
def outline(g):
    # 頭を1段上げたぶん、絵全体を1段下げる（足もとの行は run_art で +1 する）
    g.insert(0, ['.'] * W); g.pop()
    pts = [(r, c) for r in range(H) for c in range(W) if g[r][c] not in '.o']
    for r, c in pts:
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < H and 0 <= cc < W and g[rr][cc] == '.': g[rr][cc] = 'o'
NECK = -1   # 頭を胴に対して1段上げる（あごの下に首の段をつくり、肩が頭の横まで上がらないようにする）
def head(g, dx=0, dy=0):
    dy += NECK
    # 後ろ頭：ほとんど髪。右（進む向き）に耳とほおが少し
    S = lambda r, a, b, ch: span(g, r + dy, a + dx, b + dx, ch)
    S(1, 10, 17, 'h'); S(2, 9, 18, 'h'); S(3, 9, 19, 'h'); S(4, 8, 19, 'h'); S(4, 19, 19, 'H')
    S(5, 8, 17, 'H'); S(5, 18, 19, 's')
    S(6, 8, 16, 'H'); S(6, 17, 19, 's'); g[6 + dy][17 + dx] = 'S'
    S(7, 9, 16, 'H'); S(7, 17, 19, 's'); g[7 + dy][17 + dx] = 'S'
    S(8, 10, 16, 'H'); S(8, 17, 19, 's'); g[8 + dy][17 + dx] = 'S'
    S(9, 12, 15, 'H'); S(9, 16, 19, 's'); g[9 + dy][19 + dx] = 'S'
    S(5, 9, 14, 'h')
def stripe(g, rows, c=15):
    for r in rows:
        for cc in (c, c + 1):
            if g[r][cc] in 'bB': g[r][cc] = 'r'
def N():
    g = blank()
    sp = {10: (9, 19), 11: (7, 19), 12: (7, 20), 13: (6, 20), 14: (5, 20), 15: (5, 20), 16: (5, 21), 17: (8, 21)}
    for r, (a, b) in sp.items(): span(g, r, a, b, 'b')
    for r in range(12, 18): g[r][sp[r][1]] = 'B'
    span(g, 16, 5, 7, 's'); span(g, 17, 5, 7, 's'); g[17][7] = 'S'; g[17][8] = 'o'                 # 手前の手（左下）
    span(g, 18, 19, 21, 's'); span(g, 19, 19, 21, 's'); g[19][21] = 'S'                            # 奥の手（右・低い）
    for r in (18, 19, 20, 21): span(g, r, 7, 18, 'p')
    span(g, 21, 12, 14, 'o')
    for r in (22, 23, 24): span(g, r, 9, 12, 'c')                                                  # 手前の脚（左・短い）
    for r in (23, 24, 25, 26, 27): span(g, r, 16, 19, 'c')                                         # 奥の脚（右・長い）
    span(g, 22, 16, 18, 'p')
    head(g); stripe(g, range(10, 18)); outline(g); return g
def T():
    """両腕を横へ広げる（手前の腕は左へ短く、奥の腕は右へ長く）。脚は1本で着地。頭2段・足2段"""
    g = blank(); d = 2
    sp = {9: (6, 18), 10: (8, 19), 11: (8, 18), 12: (5, 16), 13: (6, 15), 14: (5, 16), 15: (5, 17), 16: (6, 17), 17: (6, 17)}
    for r, (a, b) in sp.items(): span(g, r + d, a, b, 'b')
    span(g, 10 + d, 3, 6, 'b'); span(g, 11 + d, 2, 6, 'B'); span(g, 12 + d, 2, 4, 's'); span(g, 13 + d, 2, 4, 'S')     # 手前の腕と手（左）
    span(g, 11 + d, 17, 20, 'B'); span(g, 12 + d, 17, 22, 'B'); span(g, 13 + d, 17, 22, 'B'); span(g, 14 + d, 19, 22, 'B'); span(g, 15 + d, 19, 21, 'B')
    span(g, 12 + d, 23, 24, 's'); span(g, 13 + d, 23, 24, 's'); span(g, 14 + d, 23, 24, 's'); span(g, 15 + d, 22, 24, 'S')   # 奥の腕と手（右）
    for r in (18, 19): span(g, r + d, 6, 16, 'p')
    span(g, 20 + d, 7, 15, 'p'); span(g, 20 + d, 11, 12, 'c')
    span(g, 21 + d, 10, 13, 'c'); span(g, 22 + d, 10, 13, 'c'); span(g, 23 + d, 11, 12, 'c')                       # 着地した脚（体の下）
    head(g, -1, d - 1); stripe(g, range(9 + d, 17 + d), 13); outline(g); return g
def P():
    """奥の腕を背中の前へ振る（灰色の袖、手は背中の右寄りの下）。手前の腕は胴の向こうに隠れる。脚は前後に大きく開く。頭1段・足2段"""
    g = blank(); d = 1
    sp = {7: (7, 15), 8: (8, 17), 9: (7, 17), 10: (6, 19), 11: (5, 19), 12: (4, 19), 13: (4, 19), 14: (4, 19), 15: (4, 18), 16: (4, 18)}
    for r, (a, b) in sp.items(): span(g, r + d, a, b, 'b')
    for r in (12, 13, 14): g[r + d][4] = 'B'
    span(g, 9 + d, 15, 17, 'B'); span(g, 10 + d, 13, 17, 'B'); span(g, 11 + d, 13, 17, 'B'); span(g, 12 + d, 14, 18, 'B'); span(g, 13 + d, 13, 16, 'B')   # 奥の腕（袖）
    span(g, 14 + d, 13, 16, 's'); span(g, 15 + d, 13, 16, 's'); span(g, 16 + d, 14, 16, 'S'); g[14 + d][12] = 'o'; g[15 + d][12] = 'o'                     # 奥の手
    for r in (17, 18, 19, 20): span(g, r + d, 5, 19, 'p')
    span(g, 20 + d, 9, 14, 'o')
    span(g, 18 + d, 4, 6, 'c'); span(g, 19 + d, 4, 6, 'c'); span(g, 20 + d, 5, 7, 'c'); span(g, 21 + d, 6, 7, 'c')           # 後ろの脚（左下へ）
    span(g, 21 + d, 20, 21, 'c'); span(g, 22 + d, 19, 21, 'c'); span(g, 23 + d, 19, 21, 'c'); g[24 + d][19] = 'c'           # 前の脚（右へ）
    head(g, 1, d - 1); stripe(g, range(8 + d, 17 + d), 10); outline(g); return g
if __name__ == '__main__':
    F = {k: [''.join(r) for r in f()] for k, f in (('BT', T), ('BN', N), ('BP', P))}
    json.dump(F, open('/tmp/claude-0/art3/bd2.json', 'w'))
