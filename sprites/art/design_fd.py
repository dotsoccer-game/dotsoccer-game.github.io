# 斜め手前（画面の右下へ走る）：本家の動画から。N（立ち姿に近い）→ P（手前の腕を胸の前へ振り、脚を前後に開く）→ N → T（両腕を横へ広げ、手前の脚で着地）
# 幅27・高さ29、列13が体の中心、行27がふちの下＝足もと
import json, sys
W, H = 27, 29
def blank(): return [['.'] * W for _ in range(H)]
def span(g, r, c0, c1, ch):
    for c in range(c0, c1 + 1):
        if 0 <= r < H and 0 <= c < W: g[r][c] = ch
def outline(g):
    pts = [(r, c) for r in range(H) for c in range(W) if g[r][c] not in '.o']
    for r, c in pts:
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < H and 0 <= cc < W and g[rr][cc] == '.': g[rr][cc] = 'o'
X = 2   # 23列の設計を27列へ（左右2列ずつ余白）
def head(g, dy=0):
    # 顔は右（進む向き）を向く：左に後ろ頭の髪、右に顔と目（目は2つとも右寄り）
    S = lambda r, a, b, ch: span(g, r + dy, a + X, b + X, ch)
    S(1, 8, 15, 'h'); S(2, 7, 16, 'h'); S(3, 6, 17, 'h'); g[3 + dy][6 + X] = 'H'
    S(4, 6, 17, 'h'); S(4, 6, 9, 'H')
    for r in (5, 6, 7):
        S(r, 6, 17, 's'); S(r, 6, 9 if r < 7 else 8, 'H')
        g[r + dy][12 + X] = 'e'; g[r + dy][16 + X] = 'e'
    S(8, 8, 17, 's'); g[8 + dy][8 + X] = 'H'; g[8 + dy][17 + X] = 'S'
    S(9, 9, 16, 's'); g[9 + dy][9 + X] = 'S'; g[9 + dy][16 + X] = 'S'
def stripe(g, dy=0, rows=range(11, 18)):
    for r in rows: g[r + dy][13 + X] = g[r + dy][14 + X] = 'r'
def torso(g, dy=0, spans=None):
    sp = spans or {10: (7, 17), 11: (6, 18), 12: (5, 18), 13: (4, 19), 14: (4, 19), 15: (4, 20), 16: (3, 20), 17: (3, 20), 18: (7, 17), 19: (7, 17)}
    for r, (a, b) in sp.items(): span(g, r + dy, a + X, b + X, 'b')
    for r in (20, 21): span(g, r + dy, 6 + X, 17 + X, 'p')
    span(g, 22 + dy, 6 + X, 11 + X, 'p'); span(g, 22 + dy, 13 + X, 17 + X, 'p')
def shade(g):
    for r in range(H):
        cs = [c for c in range(W) if g[r][c] == 'b']
        if len(cs) > 4: g[r][cs[-1]] = 'B'
def N():
    g = blank(); head(g); torso(g)
    span(g, 18, 3 + X, 6 + X, 's'); span(g, 19, 3 + X, 5 + X, 's'); g[19][5 + X] = 'S'; g[18][6 + X] = 'S'   # 手前の手（腰の横）
    span(g, 17, 18 + X, 20 + X, 's'); g[17][20 + X] = 'S'                                                         # 奥の手（少し高い）
    for r in range(23, 27): span(g, r, 7 + X, 10 + X, 'c')                                                        # 手前の脚（長い）
    for r in range(23, 26): span(g, r, 14 + X, 17 + X, 'c')                                                       # 奥の脚（1段上）
    shade(g); stripe(g); outline(g); return g
def P():
    """手前の腕を胸の前へ振り、脚を前後に開く（腰が2段下がる）"""
    g = blank(); d = 2; head(g, d)
    sp = {10: (7, 17), 11: (6, 18), 12: (5, 18), 13: (5, 19), 14: (5, 19), 15: (5, 19), 16: (5, 19), 17: (6, 19), 18: (7, 18), 19: (7, 18)}
    torso(g, d, sp)
    # 手前の腕：袖が胸の前へ、手は胸の真ん中
    span(g, 11 + d, 6 + X, 9 + X, 'b'); span(g, 12 + d, 5 + X, 10 + X, 'b'); span(g, 13 + d, 6 + X, 11 + X, 'B')   # 太い袖が胸の前へ
    for c in range(5 + X, 12 + X): pass
    span(g, 14 + d, 10 + X, 12 + X, 's'); span(g, 15 + d, 10 + X, 12 + X, 's'); g[15 + d][12 + X] = 'S'                  # こぶしは胸の真ん中
    g[14 + d][9 + X] = 'o'; g[15 + d][9 + X] = 'o'
    g[14 + d][20 + X] = 's'; g[15 + d][20 + X] = 'S'                                                               # 奥の手が背中側に少し
    # 脚：手前の脚は後ろ（左下）へ伸び、奥の脚は前（右下）へ
    span(g, 25, 4 + X, 7 + X, 'c'); span(g, 26, 3 + X, 6 + X, 'c'); span(g, 27, 2 + X, 5 + X, 'x')
    span(g, 25, 17 + X, 19 + X, 'c'); span(g, 26, 18 + X, 20 + X, 'c'); span(g, 27, 19 + X, 21 + X, 'x')
    shade(g); stripe(g, d, range(11, 13)); outline(g); return g
def T():
    """両腕を横へ広げてバランスをとり、手前の脚で着地（奥の脚は後ろで隠れる）"""
    g = blank(); d = 1; head(g, d)
    sp = {10: (7, 17), 11: (6, 18), 12: (5, 19), 13: (5, 19), 14: (6, 19), 15: (6, 19), 16: (6, 18), 17: (7, 18), 18: (7, 18), 19: (7, 17)}
    torso(g, d, sp)
    r0 = 12 + d
    span(g, r0, 3, 7 + X, 'b'); span(g, r0 + 1, 3, 7 + X, 'B'); span(g, r0, 1, 2, 's'); span(g, r0 + 1, 1, 2, 's'); g[r0 + 2][1] = 'S'    # 手前の腕（左へ）
    span(g, r0, 19 + X, 24, 'b'); span(g, r0 + 1, 19 + X, 23, 'B'); g[r0][25] = 's'; g[r0 + 1][25] = 's'; g[r0 + 1][24] = 's'; g[r0 + 2][25] = 'S'   # 奥の腕（右へ）
    span(g, 24, 12 + X, 15 + X, 'c'); span(g, 25, 13 + X, 16 + X, 'c'); span(g, 26, 14 + X, 17 + X, 'x')   # 手前の脚：前（右下）へ踏み出す
    span(g, 24, 7 + X, 9 + X, 'c'); span(g, 25, 6 + X, 8 + X, 'x')                                          # 奥の脚：後ろで靴の裏                                                                    # 奥の脚（後ろへ上げ、靴の裏）
    shade(g); stripe(g, d); outline(g); return g
if __name__ == '__main__':
    F = {k: [''.join(r) for r in f()] for k, f in (('DN', N), ('DP', P), ('DT', T))}
    json.dump(F, open('/tmp/claude-0/art3/fd.json', 'w'))
    for k in F: print(k); [print('%2d %s' % (i, r)) for i, r in enumerate(F[k])]
