# 背中向きの走り（全身ドット絵）第2版：カルチョビットAのフォルム
# 試合で使っている待機の背中（四角い肩・太い腕が胴とつながる・大きな手）を元の形にする。18列で書いて、左右2列ずつ足して22列にする
import json, sys
sys.path.insert(0, '/tmp/claude-0/art')
from design import HEAD, put, outline, shade_socks, LEG_PH
STAND = [  # 行9〜19（胴・腕・手・パンツ）。待機の背中の絵をそのまま写したもの
    '..obbBbbbbbbBbbo..',
    '..obbbbbbbbbbbBo..',
    '.obbbbbbbbbbbbBBo.',
    '.obbbbbbbbbbbbBBo.',
    '.obbbbbbbbbbbbBBo.',
    '.obbbbbbbbbbbbBBo.',
    'osssbbbbbbbbbBssso',
    'osssoppppppppossso',
    '.ooooppppppppoooo.',
    '....oppppppPPo....',
    '....opppoopPPo....',
]
def base():
    return [list('..' + r + '..') for r in HEAD + STAND] + [list('.' * 22) for _ in range(4)]
# 右腕の座標で書く（左腕は左右を写す）。まず待機の腕と手を消してから、形を描く
CLEAR = [(r, c, '.') for r in range(11, 17) for c in (15, 16, 17)] + [(r, 14, 'o') for r in (15, 16)] + [(11,15,'B'),(12,15,'B'),(13,15,'B'),(14,15,'B')]
def arm_cells(ph):
    if ph == 'stand': return []
    cells = list(CLEAR)
    edge = lambda rows: [(r, 15, 'o') for r in rows] + [(r, 14, 'B') for r in rows]
    if ph == 0:    # 後ろへ振り切る：太い袖が外へ張り出し（上腕）、ひじで曲がって、前腕と大きな手が外の下へ
        cells += [(11,15,'b'),(11,16,'B'),(12,15,'b'),(12,16,'b'),(12,17,'B'),(13,16,'b'),(13,17,'B'),
                  (14,17,'s'),(14,18,'S'),(15,16,'s'),(15,17,'s'),(15,18,'S'),(16,16,'S'),(16,17,'S')]
        cells += [(14,15,'o'),(13,15,'B')]
    elif ph == 1:  # 前へ戻る：袖は胴の横、前腕と手が少し後ろ（外の下）に残る
        cells += [(11,15,'b'),(12,15,'b'),(12,16,'B'),(13,15,'b'),(13,16,'B'),(14,16,'s'),(14,17,'S'),(15,16,'s'),(15,17,'S')]
        cells += [(14,15,'o'),(15,15,'o')]
    elif ph == 2:  # 胴の横を通る：袖だけ（手は胴の向こう）
        cells += [(11,15,'b'),(12,15,'b'),(13,15,'B')] + [(14,15,'o')]
    elif ph in (3, 4):  # 前へ振る：腕は胴の向こうに隠れ、その側の胴が1ドット細く見える
        cells += edge([11, 12, 13, 14])
    elif ph == 5:  # 後ろへ戻り始める：ひじ（袖の張り出し）だけ外へ出る
        cells += [(11,15,'b'),(12,15,'b'),(12,16,'B'),(13,15,'B'),(13,16,'B')] + [(14,15,'o')]
    return cells
def frame6(k):
    g = base()
    for side, ph in ((1, k), (-1, (k + 3) % 6)):
        put(g, side, arm_cells(ph))
    for side, ph in ((1, k), (-1, (k + 3) % 6)):
        put(g, side, LEG_PH[ph])
    # 不要になったふち（中が空いた所の線）を消して、ふちを付け直す
    for r in range(11, 18):
        for c in list(range(0, 6)) + list(range(16, 22)):
            if g[r][c] == 'o':
                nb = [g[rr][cc] for rr, cc in ((r+1,c),(r-1,c),(r,c+1),(r,c-1)) if 0 <= rr < 24 and 0 <= cc < 22]
                if all(ch in '.o' for ch in nb): g[r][c] = '.'
    outline(g); shade_socks(g)
    return [''.join(r) for r in g]
def stand():
    g = base(); put(g, 1, [(20,10,'c'),(20,11,'c'),(20,12,'c'),(21,10,'c'),(21,11,'c'),(21,12,'c'),(22,10,'x'),(22,11,'x'),(22,12,'x')])
    put(g, -1, [(20,10,'c'),(20,11,'c'),(20,12,'c'),(21,10,'c'),(21,11,'c'),(21,12,'c'),(22,10,'x'),(22,11,'x'),(22,12,'x')])
    outline(g); shade_socks(g); return [''.join(r) for r in g]
if __name__ == '__main__':
    names = ['RC', 'M1', 'M2', 'LC', 'M4', 'M5']
    F = {n: frame6(i) for i, n in enumerate(names)}; F['ST'] = stand()
    json.dump(F, open('/tmp/claude-0/art/frames.json', 'w'))
    for n in ['RC', 'M1', 'M2']:
        print(n); [print('%2d %s' % (i, r)) for i, r in enumerate(F[n])]
