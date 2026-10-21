# 斜め手前（画面の右下へ走る）：ユーザーの動画 d0e13d70（キーパーが走る場面）をドット単位で写したもの
# 本家：N（立ち姿に近い）→ T（両腕を横へ広げ、片脚で着地）→ N → P（手前の腕を胸の前へ振り、脚を前後に開く）。T・Pは約0.17秒（5コマ）、Nは約0.1秒（3コマ）
# T・Pのコマでは頭が1〜2段沈み、足も浮く（動画で測った値）。幅27・高さ31、列12が体の中心、行29がふちの下＝足もと
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
    # 顔は右下（進む向き）を向く：左に後ろ頭の髪、右寄りに顔と目
    S = lambda r, a, b, ch: span(g, r + dy, a + dx, b + dx, ch)
    S(1, 10, 15, 'h'); S(2, 9, 16, 'h'); S(3, 8, 17, 'h'); S(4, 7, 18, 'h'); S(4, 7, 9, 'H')
    S(5, 7, 18, 's'); S(5, 7, 11, 'H'); S(5, 18, 18, 'S')
    S(6, 7, 18, 's'); S(6, 7, 11, 'H'); S(6, 18, 18, 'H')
    S(7, 8, 19, 's'); S(7, 8, 10, 'H'); S(7, 18, 19, 'H')
    S(8, 9, 19, 's'); S(8, 9, 10, 'H'); S(8, 18, 19, 'H')
    S(9, 10, 19, 's'); S(9, 10, 10, 'H'); S(9, 19, 19, 'H')
    S(10, 11, 18, 's'); S(10, 11, 11, 'H'); S(10, 18, 18, 'S')
    for r in (5, 6, 7, 8): g[r + dy][13 + dx] = g[r + dy][17 + dx] = 'e'                 # 縦長の目
def stripe(g, rows, c=10):
    for r in rows:
        if g[r][c] in 'bB': g[r][c] = 'r'
        if g[r][c + 1] in 'bB': g[r][c + 1] = 'r'
def shade_right(g, rows):
    for r in rows:
        cs = [c for c in range(W) if g[r][c] == 'b']
        if cs: g[r][cs[-1]] = 'B'
def N():
    g = blank()
    sp = {11: (8, 18), 12: (7, 19), 13: (6, 19), 14: (5, 19), 15: (5, 21), 16: (4, 20), 17: (4, 20), 18: (3, 19), 19: (3, 18), 20: (3, 18), 21: (7, 18)}
    for r, (a, b) in sp.items(): span(g, r, a, b, 'b')
    span(g, 20, 3, 5, 's'); span(g, 21, 4, 5, 'S'); g[21][6] = 'o'                      # 手前の手（腰の横）
    span(g, 17, 20, 21, 's'); g[18][20] = 'S'                                           # 奥の手（少し高い）
    for r in (22, 23): span(g, r, 6, 18, 'p')
    g[23][14] = 'o'
    span(g, 24, 6, 11, 'p'); span(g, 24, 12, 14, 'o'); g[24][15] = 'p'
    for r in (24, 25, 26): span(g, r, 16, 18, 'c')                                      # 奥の脚（短い）
    for r in (25, 26, 27, 28): span(g, r, 8, 11, 'c')                                   # 手前の脚（長い）
    head(g); stripe(g, range(12, 21)); shade_right(g, range(12, 21)); outline(g); return g
def T():
    """両腕を横へ広げる。脚は1本で着地（ひざが前、足は体の下）。頭1段・足2段"""
    g = blank(); d = 1
    sp = {11: (6, 10), 12: (4, 21), 13: (3, 19), 14: (2, 20), 15: (1, 23), 16: (5, 22), 17: (6, 17), 18: (6, 16), 19: (6, 16), 20: (6, 16), 21: (7, 16)}
    for r, (a, b) in sp.items(): span(g, r, a, b, 'b')
    span(g, 16, 1, 4, 'b'); span(g, 16, 1, 3, 'B')                                     # 手前の腕（左へ）
    span(g, 17, 1, 3, 's'); g[17][3] = 'S'                                              # 手前の手
    span(g, 14, 21, 23, 'b'); span(g, 15, 23, 23, 'B'); span(g, 16, 23, 23, 's'); g[17][23] = 'S'   # 奥の腕と手（右へ）
    span(g, 22, 9, 16, 'p')
    span(g, 23, 10, 14, 'p'); span(g, 23, 15, 17, 'c')
    span(g, 24, 13, 14, 'c'); span(g, 24, 15, 16, 'x')
    g[25][12] = 'c'; span(g, 25, 13, 15, 'x')
    span(g, 26, 12, 14, 'x')
    head(g, 1, d); stripe(g, range(13, 21)); shade_right(g, range(13, 21)); outline(g); return g
def P():
    """手前の腕を胸の前へ振り（こぶしは胸の真ん中）、脚を前後に開く：手前の脚は後ろ（左下）で靴が平ら、奥の脚は前（右下）で濃い靴。頭1段・足2段"""
    g = blank(); d = 1
    sp = {12: (7, 18), 13: (7, 20), 14: (6, 20), 15: (6, 18), 16: (6, 17), 17: (4, 17), 18: (4, 17), 19: (3, 17), 20: (3, 19), 21: (2, 18)}
    for r, (a, b) in sp.items(): span(g, r, a, b, 'b')
    span(g, 15, 19, 20, 's'); g[16][19] = 'S'                                           # 奥の手（後ろへ振って右に少し）
    # 手前の腕：肩から胸の前へ（影の線）、こぶしは胸の真ん中
    span(g, 14, 6, 8, 'B'); span(g, 15, 7, 9, 'B'); span(g, 16, 9, 10, 'B'); span(g, 16, 11, 12, 's'); span(g, 17, 11, 12, 's'); g[17][12] = 'S'; g[17][10] = 'o'
    # 脚
    span(g, 22, 2, 7, 'p'); span(g, 22, 8, 14, 'o'); span(g, 22, 15, 17, 'p'); span(g, 21, 19, 20, 'c'); span(g, 22, 18, 19, 'c')
    span(g, 23, 3, 4, 'c'); span(g, 23, 5, 6, 'x'); span(g, 23, 18, 20, 'c'); span(g, 23, 21, 22, 'x')
    span(g, 24, 2, 6, 'x'); g[24][3] = 'c'; g[24][4] = 'c'; g[24][19] = 'c'; span(g, 24, 20, 22, 'x')
    span(g, 25, 18, 20, 'x')
    head(g, 1, d); stripe(g, range(13, 16)); stripe(g, range(18, 21)); shade_right(g, range(13, 21)); outline(g); return g
if __name__ == '__main__':
    F = {k: [''.join(r) for r in f()] for k, f in (('DT', T), ('DN', N), ('DP', P))}
    json.dump(F, open('/tmp/claude-0/art3/fd2.json', 'w'))
    for k in F: print(k); [print('%2d %s' % (i, r)) for i, r in enumerate(F[k])]
