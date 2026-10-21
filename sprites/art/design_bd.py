# 斜め奥（画面の右上へ走る）：本家の練習の動画から。N → P（脚を前後に大きく開き、手前の腕を背中の前へ振る）→ N → T（両腕を横へ広げ、後ろの足の靴が見える）
import json, sys
sys.path.insert(0, '/tmp/claude-0/art3')
import design_fd as F
from design_fd import W, H, blank, span, outline, torso, X
def head(g, dy=0):
    # 後ろ頭：ほとんど髪。右（進む向き）の端に耳とほおが少し見える
    S = lambda r, a, b, ch: span(g, r + dy, a + X, b + X, ch)
    S(1, 8, 14, 'h')
    for r in (2, 3): S(r, 6, 16, 'h')
    S(4, 6, 16, 'h'); g[4 + dy][6 + X] = 'H'
    for r in (5, 6, 7):
        S(r, 6, 16, 'H' if r > 5 else 'h'); S(r, 6, 7, 'H'); S(r, 15, 16, 's'); g[r + dy][16 + X] = 'S'
    S(5, 8, 14, 'h')
    S(8, 7, 15, 'H'); g[8 + dy][14 + X] = 's'; g[8 + dy][15 + X] = 'S'
    S(9, 8, 14, 'H')
def stripe(g, dy=0, rows=range(10, 18)):
    for r in rows: g[r + dy][14 + X] = g[r + dy][15 + X] = 'r'
def shade(g):
    for r in range(H):
        cs = [c for c in range(W) if g[r][c] == 'b']
        if len(cs) > 4: g[r][cs[0]] = 'B'
def N():
    g = blank(); head(g); torso(g)
    span(g, 18, 3 + X, 6 + X, 's'); span(g, 19, 3 + X, 5 + X, 's'); g[19][5 + X] = 'S'                  # 手前の手（左）
    span(g, 17, 18 + X, 20 + X, 's'); g[17][20 + X] = 'S'                                                 # 奥の手（右・少し高い）
    for r in range(23, 27): span(g, r, 7 + X, 9 + X, 'c')                                                 # 手前の脚
    for r in range(23, 26): span(g, r, 14 + X, 16 + X, 'c')                                               # 奥の脚（1段上）
    shade(g); stripe(g); outline(g); return g
def P():
    g = blank(); d = 2; head(g, d)
    sp = {10: (7, 17), 11: (6, 18), 12: (5, 18), 13: (5, 19), 14: (5, 19), 15: (5, 19), 16: (5, 19), 17: (6, 19), 18: (7, 18), 19: (7, 18)}
    torso(g, d, sp); stripe(g, d)
    # 手前の腕：前へ振って背中の向こう側へ。袖が斜めに見え、手は背中の右寄りに少し
    span(g, 12 + d, 5 + X, 8 + X, 'B'); span(g, 13 + d, 6 + X, 10 + X, 'B'); span(g, 14 + d, 9 + X, 11 + X, 'B'); span(g, 15 + d, 11 + X, 12 + X, 's'); g[16 + d][12 + X] = 'S'
    span(g, 13 + d, 20 + X, 21 + X, 'b'); g[14 + d][21 + X] = 's'; g[15 + d][21 + X] = 'S'                   # 奥の腕：後ろへ振って右に出る
    # 脚：手前の脚は後ろ（左下）へ伸びて靴の裏、奥の脚は前（右上）へ踏み出す
    span(g, 25, 4 + X, 7 + X, 'c'); span(g, 26, 3 + X, 6 + X, 'c'); span(g, 27, 2 + X, 5 + X, 'x')
    span(g, 25, 17 + X, 19 + X, 'c'); span(g, 26, 18 + X, 20 + X, 'c')
    shade(g); outline(g); return g
def T():
    g = blank(); d = 1; head(g, d)
    sp = {10: (7, 17), 11: (6, 18), 12: (5, 19), 13: (5, 19), 14: (6, 19), 15: (6, 19), 16: (6, 18), 17: (7, 18), 18: (7, 18), 19: (7, 17)}
    torso(g, d, sp)
    r0 = 13 + d
    span(g, r0, 3, 7 + X, 'b'); span(g, r0 + 1, 3, 7 + X, 'B'); span(g, r0 + 1, 1, 2, 's'); span(g, r0 + 2, 1, 2, 's'); g[r0 + 2][2] = 'S'   # 手前の腕（左へ、手は少し下）
    span(g, r0, 19 + X, 24, 'b'); span(g, r0 + 1, 19 + X, 23, 'B'); g[r0 + 1][25] = 's'; g[r0 + 2][25] = 's'; g[r0 + 2][24] = 'S'         # 奥の腕（右へ）
    for r in range(24, 27): span(g, r, 13 + X, 15 + X, 'c')                                                                                # 奥の脚：前で着地
    span(g, 24, 7 + X, 9 + X, 'c'); span(g, 25, 6 + X, 9 + X, 'x'); span(g, 26, 6 + X, 8 + X, 'x')                                          # 手前の脚：後ろへけって、濃い靴が手前（下）に
    shade(g); stripe(g, d); outline(g); return g
if __name__ == '__main__':
    Fs = {k: [''.join(r) for r in f()] for k, f in (('BN', N), ('BP', P), ('BT', T))}
    json.dump(Fs, open('/tmp/claude-0/art3/bd.json', 'w'))
