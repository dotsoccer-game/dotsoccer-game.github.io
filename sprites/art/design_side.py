# 真横（画面の右へ走る）：ユーザーの動画 75541e4f をドット単位で写したもの。幅27・高さ31、行29がふちの下＝足もと
# 本家：A（手前の腕を前へ・奥の腕を後ろへ上げる、脚を前後に大きく開く）→ N（腕を曲げて手は腰の前、脚はそろう）→ B（奥の腕を前へ・手前の腕は後ろで手が腰の後ろ、脚を開く）→ N
# 長さはどれも約0.1秒（3コマ）。A・Bは頭が1段沈み、体が前へ傾く（頭が前に出る）
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
    # 横顔：後ろ（左）と上は髪、右に顔と目1つ。あごは肩の高さまで
    S = lambda r, a, b, ch: span(g, r + dy, a + dx, b + dx, ch)
    S(1, 11, 18, 'h'); S(2, 9, 20, 'h'); S(3, 8, 21, 'h'); S(4, 8, 21, 'h'); S(4, 8, 10, 'H')
    for r in (5, 6, 7): S(r, 8, 21, 's'); S(r, 8, 15, 'H' if r > 5 else 'h'); S(r, 8, 9, 'H')
    S(8, 9, 21, 's'); S(8, 9, 15, 'H')
    S(9, 10, 21, 's'); S(9, 10, 14, 'H'); g[9 + dy][21 + dx] = 'S'
    S(10, 15, 21, 's'); g[10 + dy][21 + dx] = 'S'
    for r in (5, 6, 7, 8): g[r + dy][19 + dx] = 'e'
    g[5 + dy][16 + dx] = 'h'                                             # もみあげの先
def N():
    g = blank(); head(g)
    span(g, 10, 10, 14, 'b'); span(g, 11, 9, 14, 'b')
    # 背中は首の後ろから腰へまっすぐ斜めに下りる（途中でふくらませない＝猫背にしない）。本家の待機と同じ形
    span(g, 12, 7, 19, 'b'); span(g, 13, 7, 18, 'b'); span(g, 14, 6, 18, 'b'); span(g, 15, 6, 19, 'b'); span(g, 16, 5, 19, 'b'); span(g, 17, 5, 11, 'b'); span(g, 18, 5, 11, 'b')
    for r in range(12, 19):
        cs = [c for c in range(W) if g[r][c] == 'b']; g[r][cs[-1]] = 'B'
    # 手前の腕：肩から下へ（袖）、ひじで前へ曲げて、手は腰の前
    for r in (13, 14, 15, 16): span(g, r, 11, 14, 'b'); g[r][10] = 'o'; g[r][14] = 'B'          # 袖の後ろのふちだけ線、前は影
    span(g, 17, 11, 17, 'B'); g[17][10] = 'o'; span(g, 18, 12, 17, 'B'); span(g, 19, 13, 15, 's'); span(g, 20, 13, 15, 's'); g[20][15] = 'S'
    span(g, 19, 5, 11, 'p'); span(g, 20, 5, 11, 'p'); span(g, 21, 5, 12, 'p'); span(g, 22, 6, 15, 'p'); span(g, 23, 7, 13, 'p')
    span(g, 21, 13, 15, 'S')
    span(g, 24, 7, 8, 'c'); span(g, 24, 9, 12, 'p')
    for r in (25, 26, 27): span(g, r, 7, 13, 'c'); g[r][13] = 'C'
    span(g, 28, 7, 11, 'c'); span(g, 28, 12, 13, 'x')
    outline(g); return g
def A():
    """手前の腕を前へ（袖が前へ伸び、手は胸の前の先）、奥の腕は後ろへ上げる（手が肩の後ろ）。脚は前後に大きく開き、後ろの足は上がる。頭1段沈み、3ドット前へ"""
    g = blank(); d = 1
    span(g, 10 + d, 17, 20, 'b'); span(g, 11 + d, 14, 21, 'b')
    span(g, 12 + d, 9, 21, 'b'); span(g, 13 + d, 9, 22, 'b'); span(g, 14 + d, 7, 22, 'b'); span(g, 15 + d, 8, 22, 'b'); span(g, 16 + d, 9, 22, 'b'); span(g, 17 + d, 9, 21, 'b')
    # 奥の腕：後ろ上へ（灰色の袖）、手は肩の後ろ
    span(g, 9 + d, 9, 15, 'B'); span(g, 10 + d, 8, 16, 'B'); span(g, 11 + d, 6, 13, 'B'); span(g, 12 + d, 6, 8, 's'); span(g, 13 + d, 6, 8, 's'); g[13 + d][6] = 'S'; g[14 + d][7] = 'S'
    # 手前の腕：前へまっすぐ（袖）、手は先
    span(g, 12 + d, 16, 22, 'o'); g[13 + d][15] = 'o'; g[14 + d][15] = 'o'; g[15 + d][15] = 'o'
    for r in (13, 14, 15): span(g, r + d, 16, 22, 'b')
    span(g, 15 + d, 16, 22, 'B'); span(g, 16 + d, 16, 22, 'o')
    span(g, 13 + d, 23, 25, 's'); span(g, 14 + d, 23, 25, 's'); span(g, 15 + d, 23, 24, 'S')
    # 脚：パンツが前後に開き、後ろの脚は後ろ上へ、前の脚は前下へ
    span(g, 18 + d, 4, 22, 'p'); span(g, 19 + d, 7, 20, 'p'); span(g, 20 + d, 6, 20, 'p'); span(g, 21 + d, 6, 21, 'p'); span(g, 21 + d, 10, 13, 'o')
    span(g, 19 + d, 3, 6, 'c'); span(g, 20 + d, 2, 5, 'c'); span(g, 21 + d, 2, 5, 'c'); span(g, 22 + d, 2, 5, 'x')
    span(g, 22 + d, 20, 21, 'c'); span(g, 23 + d, 18, 22, 'c'); span(g, 24 + d, 19, 22, 'c'); span(g, 25 + d, 19, 21, 'x')
    head(g, 3, d); outline(g); return g
def B():
    """奥の腕を前へ（灰色の袖が胸の前、手は先）、手前の腕は後ろ（手は腰の後ろの下）。脚は前後に開き、前の脚で着地。頭1段沈み、2ドット前へ"""
    g = blank(); d = 1
    span(g, 10 + d, 11, 17, 'b'); span(g, 11 + d, 8, 18, 'b')
    span(g, 12 + d, 7, 17, 'b'); span(g, 13 + d, 6, 17, 'b'); span(g, 14 + d, 6, 17, 'b'); span(g, 15 + d, 6, 16, 'b'); span(g, 16 + d, 10, 16, 'b'); span(g, 17 + d, 10, 17, 'b')
    # 奥の腕：前へ（灰色の袖）、手は先
    span(g, 11 + d, 18, 21, 'B'); span(g, 12 + d, 18, 22, 'B'); span(g, 13 + d, 18, 22, 'B'); span(g, 14 + d, 17, 23, 'B'); span(g, 15 + d, 16, 23, 'B'); span(g, 16 + d, 16, 18, 'B')
    span(g, 13 + d, 23, 25, 's'); span(g, 14 + d, 24, 25, 's'); span(g, 15 + d, 24, 25, 'S')
    # 手前の腕：後ろへ（袖は胴の後ろ側、手は腰の後ろの下）
    span(g, 12 + d, 9, 12, 'b'); g[13 + d][12] = 'o'; span(g, 14 + d, 6, 7, 's'); span(g, 15 + d, 6, 8, 's'); span(g, 16 + d, 6, 9, 's'); span(g, 17 + d, 7, 9, 's'); g[17 + d][9] = 'S'
    # 脚
    span(g, 18 + d, 5, 16, 'p'); span(g, 19 + d, 5, 15, 'p'); span(g, 20 + d, 5, 17, 'p'); span(g, 21 + d, 6, 17, 'p'); span(g, 21 + d, 9, 12, 'o')
    span(g, 18 + d, 3, 4, 'c'); span(g, 19 + d, 2, 4, 'c'); span(g, 20 + d, 1, 3, 'c'); span(g, 21 + d, 1, 3, 'x')
    span(g, 22 + d, 15, 18, 'c'); span(g, 23 + d, 14, 18, 'c'); span(g, 24 + d, 14, 18, 'c'); span(g, 25 + d, 15, 18, 'c'); span(g, 26 + d, 16, 18, 'x')
    head(g, 2, d); outline(g); return g
if __name__ == '__main__':
    F = {k: [''.join(r) for r in f()] for k, f in (('SA', A), ('SN', N), ('SB', B))}
    json.dump(F, open('/tmp/claude-0/art3/side.json', 'w'))
