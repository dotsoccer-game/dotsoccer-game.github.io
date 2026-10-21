# 背中向きの走り：全身のドット絵を1コマずつ設計する（18列×24行。行0〜8頭、9〜19胴、20〜23脚。足の裏の基準＝行23の上）
import json, sys
HEAD = ['.....oooooooo.....','....ooHhhhhHoo....','...ooHhhhhhhHoo...','...oHhhhhhhhhHo...','...oHhhhhhhhhHo...','...oHhhhhhhhhHo...','...oHHhhhhhhHHo...','...ooHHhhhhHHoo...','....ooHHHHHHoo....']
TORSO = ['....ooBbbbbBoo....','...oBbbbbbbbbBo...','...oBbbbbbbbbBo...','...obbbbbbbbbBo...','...obbbbbbbbbBo...','...obbbbbbbbBBo...','...obbbbbbbbBBo...','...oPppppppppPo...','....oppppppppo....','....oppppppPPo....','....opppoopPPo....']
def base():
    g = [list('..' + r + '..') for r in HEAD + TORSO] + [list('.' * 22) for _ in range(4)]
    return g
def put(g, side, pts):
    # side=+1：画面の右（選手の右）。side=-1：左右を写す（列 c → 17-c）
    for r, c, ch in pts:
        cc = (c + 2) if side > 0 else 19 - c
        g[r][cc] = ch
def outline(g):
    # 手足のまわりの空いた所にふちを付ける
    body = {(r, c) for r in range(24) for c in range(22) if g[r][c] not in '.o'}
    for r, c in list(body):
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            rr, cc = r+dr, c+dc
            if 0 <= rr < 24 and 0 <= cc < 22 and g[rr][cc] == '.': g[rr][cc] = 'o'
ARM_BACK = [  # 後ろへ振った腕（右側の座標）：肩から袖が外へ出て（上腕）、ひじで曲がり、前腕と手が下へ。手は胴から離す（腰に手を当てた形にしない）
    (10,14,'B'),(10,15,'b'),(10,16,'b'),
    (11,15,'b'),(11,16,'b'),(11,17,'B'),
    (12,17,'s'),(12,18,'s'),
    (13,17,'s'),(13,18,'S'),
    (14,17,'S'),
]
FWD_SHOULDER = [(10,3,'.'),(10,4,'o'),(11,3,'.'),(11,4,'o')]   # 前へ振った腕の側（左）：肩が奥へ回って1ドット細く見える
LEG_PLANT = [(20,10,'c'),(20,11,'c'),(20,12,'c'),(21,10,'c'),(21,11,'c'),(21,12,'c'),(22,10,'x'),(22,11,'x'),(22,12,'x')]   # 接地した右脚（列10〜12）
LEG_KICK = [  # 蹴り上げた左脚（列5〜7）：ひざ（くつ下1段）がいちばん下、その上に手前を向いた靴底が重なる
    (20,5,'c'),(20,6,'c'),(20,7,'c'),
    (17,5,'o'),(17,6,'o'),(17,7,'o'),(18,8,'o'),
    (18,5,'g'),(18,6,'g'),(18,7,'g'),(19,5,'t'),(19,6,'g'),(19,7,'t'),
]
def shade_socks(g):
    # くつ下の影はいつも右端（光の向きをそろえる）
    for r in range(24):
        row = g[r]; c = 0
        while c < 22:
            if row[c] in 'cC':
                e = c
                while e + 1 < 22 and row[e + 1] in 'cC': e += 1
                for k in range(c, e + 1): row[k] = 'c'
                if e > c: row[e] = 'C'
                c = e + 1
            else: c += 1
def frame_contact(side):
    """side=+1：右足接地（右腕が後ろ・左脚を蹴り上げ）／side=-1：左足接地"""
    g = base()
    put(g, side, FWD_SHOULDER)
    put(g, side, ARM_BACK)
    put(g, side, LEG_PLANT)
    put(g, side, LEG_KICK)   # 蹴り上げは反対の脚（LEG_KICKは左側の座標なので、side=+1 のときそのまま）
    outline(g); shade_socks(g)
    return [''.join(r) for r in g]
if __name__ == '__main__':
    F = {'RC': frame_contact(1), 'LC': frame_contact(-1)}
    for k, v in F.items():
        print(k); [print('%2d %s' % (i, r)) for i, r in enumerate(v)]
    json.dump(F, open('/tmp/claude-0/art/frames.json', 'w'), ensure_ascii=False, indent=0)

ARMS = {
  'A': ARM_BACK,
  'B': [(10,14,'B'),(10,15,'b'),(11,15,'b'),(11,16,'B'),(12,15,'s'),(12,16,'s'),(13,15,'S'),(13,16,'S')],
  'C': [(10,14,'B'),(10,15,'b'),(10,16,'b'),(11,15,'b'),(11,16,'b'),(11,17,'B'),(12,17,'s'),(12,18,'s'),(13,17,'s'),(13,18,'S'),(14,17,'S')],
  'D': [(10,14,'B'),(10,15,'b'),(11,15,'b'),(11,16,'B'),(12,16,'s'),(12,17,'s'),(13,16,'s'),(13,17,'S'),(14,16,'S')],
}
def variant(arm):
    g = base(); put(g, 1, FWD_SHOULDER); put(g, 1, arm); put(g, 1, LEG_PLANT); put(g, 1, LEG_KICK); outline(g); shade_socks(g)
    return [''.join(r) for r in g]
if len(sys.argv) > 1 and sys.argv[1] == 'arms':
    json.dump({k: variant(v) for k, v in ARMS.items()}, open('/tmp/claude-0/art/frames.json', 'w'))

# ===== 6コマの走り（接地2枚を元に、中間を作る）=====
# 腕の形（右腕の座標）：0 後ろへ振り切る → 1 前へ戻る（ひじが寄る）→ 2 胴の横を通る → 3・4 前へ振る（胴の向こうに隠れ、肩が1ドット細い）→ 5 後ろへ戻り始める（ひじが出る）
ARM_PH = {
  0: ARM_BACK,
  1: [(10,14,'B'),(10,15,'b'),(11,15,'b'),(11,16,'B'),(12,16,'s'),(13,16,'S')],
  2: [(11,15,'B'),(12,15,'S')],                                   # 胴の横を通る：手は胴の向こう、袖の端だけ
  3: 'hide', 4: 'hide',
  5: [(10,14,'B'),(10,15,'b'),(11,15,'b'),(11,16,'B'),(12,16,'s')],
}
HIDE_R = [(10,14,'.'),(10,13,'o'),(11,14,'.'),(11,13,'o')]   # 前へ振った腕の側の肩（右の座標）
# 脚の形（右脚の座標・列10〜12）：0 接地 → 1 蹴り出し（かかとが浮き、地面で靴底が見える）→ 2 持ち上げ（靴底が1段浮く）
#   → 3 ひざを曲げて蹴り上げ（靴底がパンツの下）→ 4 前へ戻す（すねが内側へ寄り、つま先は隠れる）→ 5 着地（かかとから細く）
LEG_PH = {
  0: LEG_PLANT,
  1: [(20,10,'c'),(20,11,'c'),(20,12,'c'),(21,10,'c'),(21,11,'c'),(21,12,'c'),(22,10,'g'),(22,11,'t'),(22,12,'g')],
  2: [(20,10,'c'),(20,11,'c'),(20,12,'c'),(21,10,'g'),(21,11,'t'),(21,12,'g')],
  3: [(20,10,'c'),(20,11,'c'),(20,12,'c'),(17,10,'o'),(17,11,'o'),(17,12,'o'),(18,9,'o'),
      (18,10,'g'),(18,11,'g'),(18,12,'g'),(19,10,'t'),(19,11,'g'),(19,12,'t')],
  4: [(20,10,'c'),(20,11,'c'),(20,12,'c'),(21,10,'c'),(21,11,'c')],
  5: [(20,10,'c'),(20,11,'c'),(20,12,'c'),(21,10,'c'),(21,11,'c'),(21,12,'c'),(22,10,'x'),(22,11,'x')],
}
def frame6(k):
    g = base()
    for side, ph in ((1, k), (-1, (k + 3) % 6)):   # 左の手足は右の3コマあと
        a = ARM_PH[ph]
        put(g, side, HIDE_R if a == 'hide' else a)
    for side, ph in ((1, k), (-1, (k + 3) % 6)):
        put(g, side, LEG_PH[ph])
    outline(g); shade_socks(g)
    return [''.join(r) for r in g]
if len(sys.argv) > 1 and sys.argv[1] == 'six':
    names = ['RC', 'M1', 'M2', 'LC', 'M4', 'M5']
    json.dump({n: frame6(i) for i, n in enumerate(names)}, open('/tmp/claude-0/art/frames.json', 'w'))
