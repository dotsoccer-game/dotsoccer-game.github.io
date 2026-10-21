# 真横の立ち姿（止まっているとき専用）：ユーザーの写真 176eeaf4 をドット単位で写したもの
# 写真は左向き → 右向きに左右を写して使う。体は頭の真下にまっすぐ立ち（腰は出ない）、手は体の前のおなかの高さ、脚は1本に重なって見える
import json
W, H = 27, 31
g = [['.'] * W for _ in range(H)]
def put(r, c0, c1, ch):
    for c in range(c0, c1 + 1): g[r + 3][20 - c] = ch          # 写真の行 r・列 c（左向き）→ 絵の行 r+3・列 20-c（右向き）
put(2, 4, 10, 'h'); put(3, 3, 11, 'h'); put(4, 2, 12, 'h')
put(5, 2, 12, 'h'); put(5, 2, 4, 's'); put(5, 3, 3, 'e'); put(5, 12, 12, 'H')
put(6, 2, 12, 'h'); put(6, 2, 5, 's'); put(6, 3, 3, 'e'); put(6, 12, 12, 'H')
put(7, 2, 12, 'h'); put(7, 2, 5, 's'); put(7, 3, 3, 'e'); put(7, 11, 12, 'H')
put(8, 2, 11, 'h'); put(8, 2, 5, 's'); put(8, 3, 3, 'e'); put(8, 10, 11, 'H')
put(9, 2, 10, 'h'); put(9, 2, 5, 's'); put(9, 10, 10, 'H'); put(9, 5, 5, 'S')
put(10, 2, 9, 'h'); put(10, 2, 6, 's'); put(10, 9, 9, 'H'); put(10, 6, 6, 'S')
for r in range(11, 21):                                           # シャツ：頭の真下にまっすぐ
    c1 = 10 if r in (11, 12) else 11
    put(r, 3, c1, 'b'); put(r, c1, c1, 'B')
put(18, 5, 8, 's'); put(19, 6, 8, 's'); put(19, 8, 8, 'S')        # 手：体の前・おなかの高さ
for r in (21, 22): put(r, 3, 10, 'p'); put(r, 10, 10, 'P')         # パンツ
put(23, 3, 10, 'p'); put(23, 5, 8, 'P')
for r in (24, 25, 26): put(r, 5, 7, 'c'); put(r, 7, 7, 'C')        # 脚（1本に重なる）
pts = [(r, c) for r in range(H) for c in range(W) if g[r][c] not in '.o']
for r, c in pts:
    for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
        rr, cc = r + dr, c + dc
        if 0 <= rr < H and 0 <= cc < W and g[rr][cc] == '.': g[rr][cc] = 'o'
rows = [''.join(r) for r in g]
json.dump({'SS': rows}, open('/tmp/claude-0/art3/side_stand.json', 'w'))
for i, r in enumerate(rows): print('%2d %s' % (i, r))
