# 正面の走り（本家の動画から）：N（待機と同じ）／A（画面の右の腕を前へ上げ、画面の左の脚はひざを上げる）／C（Aの左右逆）
import json, sys
sys.path.insert(0, '/tmp/claude-0/art3')
from design3 import W, H, blank, span, outline, shade
def head_front(g):
    # 本家の正面：髪は頭の上と横1列だけ。顔が大きく、縦長の目が上の方にある
    span(g, 1, 8, 14, 'h')
    span(g, 2, 6, 16, 'h')
    span(g, 3, 6, 16, 'h'); g[3][6] = g[3][16] = 'H'
    for r in (4, 5, 6, 7):
        span(g, r, 6, 16, 's'); g[r][6] = 'H'; g[r][16] = 'H'
    span(g, 4, 7, 15, 's'); g[4][7] = g[4][15] = 'h'; g[4][8] = 'h'                     # 前髪のはし
    for r in (4, 5, 6): g[r][9] = g[r][13] = 'e'                                        # 縦長の目
    span(g, 8, 7, 15, 's'); g[8][7] = g[8][15] = 'S'
    span(g, 9, 8, 14, 's'); g[9][8] = g[9][14] = 'S'
def stripe_front(g):
    for r in range(11, 18): g[r][11] = g[r][12] = 'r'
def body(g, left_hand=True, right_hand=True):
    sp = {10: (6, 16), 11: (5, 17), 12: (4, 18), 13: (4, 18), 14: (3, 19), 15: (3, 19), 16: (2, 20)}
    for r, (a, b) in sp.items(): span(g, r, a, b, 'b')
    span(g, 17, 6, 16, 'b'); span(g, 18, 6, 16, 'b'); span(g, 19, 6, 16, 'b')
    if left_hand:
        span(g, 17, 2, 5, 's'); span(g, 18, 2, 4, 's'); g[18][4] = 'S'; g[18][5] = 'o'
    if right_hand:
        span(g, 17, 17, 20, 's'); g[18][17] = 'o'; span(g, 18, 18, 20, 's'); g[18][20] = 'S'
    for r in (20, 21): span(g, r, 6, 16, 'p')
    span(g, 22, 6, 10, 'p'); g[22][11] = 'o'; span(g, 22, 12, 16, 'p')
def legs_stand(g):
    for r in range(23, 27): span(g, r, 6, 8, 'c'); span(g, r, 14, 16, 'c')
def stand():
    g = blank(); head_front(g); body(g); legs_stand(g)
    shade(g, range(12, 17)); stripe_front(g); outline(g); return g
def run_a():
    """画面の右の腕を前へ上げ（袖が斜め上へ、手は肩の高さの外）、画面の左の脚はひざを上げる（くつ下が短く見える）"""
    g = blank(); head_front(g); body(g, left_hand=True, right_hand=False)
    for r in (14, 15, 16): g[r][19] = '.'                                   # 右の腕が上がった分、胴の右はまっすぐ
    g[16][20] = '.'
    for c in (18,): g[16][c] = 'B'
    # 上げた腕：前へ振り上げた腕が、胸の高さで外へ張り出す（太い袖）。手は袖の先の下
    span(g, 10, 17, 19, 'b'); span(g, 9, 19, 20, 'b'); span(g, 10, 20, 21, 'b'); span(g, 11, 18, 21, 'b'); g[11][21] = 'B'; g[12][20] = 'B'
    g[12][21] = 's'; g[13][21] = 's'; g[13][20] = 'S'
    # 脚：左はひざを上げて短く、右は接地してまっすぐ
    span(g, 23, 5, 8, 'c'); span(g, 24, 5, 8, 'c')
    for r in range(23, 27): span(g, r, 14, 16, 'c')
    shade(g, range(12, 17)); stripe_front(g); outline(g); return g
def mirror(g):
    m = [list(reversed(row)) for row in g]
    for r in range(H):
        for c in range(W):
            if m[r][c] == 'r': m[r][c] = 'b'
    stripe_front(m); return m
if __name__ == '__main__':
    N = stand(); A = run_a(); C = mirror(A)
    F = {k: [''.join(r) for r in v] for k, v in {'FA': A, 'FN': N, 'FC': C}.items()}
    json.dump(F, open('/tmp/claude-0/art3/front.json', 'w'))
    for k in ('FN', 'FA'):
        print(k); [print('%2d %s' % (i, r)) for i, r in enumerate(F[k])]
