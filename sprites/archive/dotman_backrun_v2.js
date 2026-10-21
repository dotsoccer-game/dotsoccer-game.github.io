// ドット絵の選手。見た目のお手本＝GPTのちびキャラ（立ち姿8方向）。
// 頭と胴は、お手本を1ドットずつ描き起こした絵（5方向＋左右反転）。
// 腕と脚は関節の角度から同じドットの大きさで描くので、走り・パス・シュートも同じ絵柄になる。
// 向きは16方向。つま先の位置も計算で返す（ボールを当てる位置に使う）。
(function () {
const VIEWS = {
  // カルチョビットA（本家のマス目画像から読み取り）：幅18（8と9の間が体の中心）。23行目が足の裏のふち。
  // ここは頭・胴・パンツ（19行目まで）。腕と脚（くつ下・スパイク）は別に描く。
  // o=ふち h=髪 H=髪の影 s=肌 S=肌の影 e=目 b=シャツ B=シャツの影 L=シャツの明るい所 p=パンツ P=パンツの影
  F: [
    '.....oooooooo.....',
    '....ooHhhhhHoo....',
    '...ooHhhhhhhHoo...',
    '...oHHhhhhhhHHo...',
    '...oHHsessesHHo...',
    '...oHSsessesSHo...',
    '...oHSsessesSHo...',
    '...ooSssssssSoo...',
    '....ooSssssSoo....',
    '...ooLbbbbbbBoo...',
    '..ooLLbbbbbbBBoo..',
    '..oLLbbbbbbbbBBo..',
    '.ooLbbbbbbbbbbBoo.',
    '.oLbbbbbbbbbbbbBo.',
    '.obbbbbbbbbbbbbBo.',
    '.obbbbbbbbbbbbBBo.',
    '.ooooppppppppoooo.',
    '....oppppppppo....',
    '....oppppppPPo....',
    '....opppoopPPo....',
  ],
  FL: [
    '.....oooooooo.....',
    '....ooHhhhhHoo....',
    '...ooHhhhhhhHoo...',
    '...oHHhhhhhhHHo...',
    '...oHsessesHHHo...',
    '...oSsessesSHHo...',
    '...oSsessesSHHo...',
    '...ooSsssssSHoo...',
    '....ooSssssSoo....',
    '.....ooLbbBoo.....',
    '.....oLbbbbBo.....',
    '.....oLbbbbBo.....',
    '.....obbbbbBo.....',
    '.....obbbbbBo.....',
    '.....obbbbBBo.....',
    '.....obbbbBBo.....',
    '....oppppppppo....',
    '....opppppppPo....',
    '....opppppppPo....',
    '....opppooppPo....',
  ],
  L: [
    '.....oooooooo.....',
    '....ooHhhhhHoo....',
    '...ooHhhhhhhHoo...',
    '...oHhhhhhhhhHo...',
    '...ossesHhhhHHo...',
    '...ossesHhhhHHo...',
    '...ossesHhhhHHo...',
    '...oosssssHHHoo...',
    '....oossssHHoo....',
    '....ooLbbbbBoo....',
    '....oLbbbbbbBo....',
    '....oLbbbbbbBo....',
    '....obbbbbbbBo....',
    '....obbbbbbbBo....',
    '....obbbbbbBBo....',
    '....obbbbbbBBo....',
    '....oppppppppo....',
    '....oppppppppo....',
    '....opppppppPo....',
    '....opppppppPo....',
  ],
  BL: [
    '.....oooooooo.....',
    '....ooHhhhhHoo....',
    '...ooHhhhhhhHoo...',
    '...oHhhhhhhhhHo...',
    '...oShhhhhhhHHo...',
    '...oShhhhhhhHHo...',
    '...oShhhhhhHHHo...',
    '...ooShhhhhHHoo...',
    '....ooHHHHHHoo....',
    '.....ooBbbBoo.....',
    '.....oLbbbbBo.....',
    '.....oLbbbbBo.....',
    '.....obbbbbBo.....',
    '.....obbbbbBo.....',
    '.....obbbbBBo.....',
    '.....obbbbBBo.....',
    '....oppppppppo....',
    '....opppppppPo....',
    '....opppppppPo....',
    '....opppooppPo....',
  ],
  B: [
    '.....oooooooo.....',
    '....ooHhhhhHoo....',
    '...ooHhhhhhhHoo...',
    '...oHhhhhhhhhHo...',
    '...oHhhhhhhhhHo...',
    '...oHhhhhhhhhHo...',
    '...oHHhhhhhhHHo...',
    '...ooHHhhhhHHoo...',
    '....ooHHHHHHoo....',
    '...ooBbbbbbbBoo...',
    '..ooBBbbbbbbBBoo..',
    '..oBBbbbbbbbbBBo..',
    '.ooBbbbbbbbbbbBoo.',
    '.oBbbbbbbbbbbbbBo.',
    '.obbbbbbbbbbbbbBo.',
    '.obbbbbbbbbbbbBBo.',
    '.ooooppppppppoooo.',
    '....oppppppppo....',
    '....oppppppPPo....',
    '....opppoopPPo....',
  ],
};
  // 参考の16方向に合わせた組み合わせ用の部品
  // L2：ほぼ横向き（67.5°）の頭。目は1つ、顔は横顔より1ドット広い
  VIEWS.L2 = [
    '.....oooooooo.....',
    '....ooHhhhhHoo....',
    '...ooHhhhhhhHoo...',
    '...oHhhhhhhhhHo...',
    '...ossessHhhHHo...',
    '...ossessHhhHHo...',
    '...ossessHhhHHo...',
    '...oossssSHHHoo...',
    '....oossssHHoo....',
  ];
  // N7：ななめ（45°）の胴。正面より1ドット細い／BN7：その背中側
  VIEWS.N7 = [
    '....ooLbbbbBoo....',
    '.....oLbbbbbBo....',
    '.....oLbbbbbBo....',
    '.....obbbbbbBo....',
    '.....obbbbbbBo....',
    '.....obbbbbBBo....',
    '.....obbbbbBBo....',
    '....oppppppppPo...',
    '....opppppppPPo...',
    '....opppppppPPo...',
    '....opppooppPPo...',
  ];
  VIEWS.BN7 = VIEWS.N7.map((r) => r.replace(/L/g, 'B'));
  // 背中向きの走り用の胴：肩・袖をふくらませない形で全コマ共通（腕は胴の後ろから出す）
  VIEWS.BR = [
    '....ooBbbbbBoo....',
    '...oBbbbbbbbbBo...',
    '...oBbbbbbbbbBo...',
    '...obbbbbbbbbBo...',
    '...obbbbbbbbbBo...',
    '...obbbbbbbbBBo...',
    '...obbbbbbbbBBo...',
    '...oPppppppppPo...',
    '....oppppppppo....',
    '....oppppppPPo....',
    '....opppoopPPo....',
  ];
  const OUT = [28, 24, 30];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mul = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  const W = 34, H = 34, PX = 17, PY = 31;
  const DEPTH = 0.45;
  function palette(o) {
    const shirt = hex(o.shirt || '#1e64e6'), shorts = hex(o.shorts || '#ffffff'), socks = hex(o.socks || '#d23c3c'), shoe = hex(o.shoe || '#2c2c30');
    const skin = hex(o.skin || '#f2b27a'), hair = hex(o.hair || '#8a5426');
    const P = { shirt, shirtD: mul(shirt, 0.78), shorts, shortsD: mul(shorts, 0.82), socks, socksD: mul(socks, 0.8),
      shirtL: mul(shirt, 1.3), shoe, shoeD: mul(shoe, 0.7), skin, skinD: mul(skin, 0.88), hair, hairD: mul(hair, 0.72), glove: o.glove ? hex(o.glove) : null, eye: [34, 20, 14] };
    P.ch = { o: OUT, h: P.hair, H: P.hairD, L: P.shirtL, s: P.skin, S: P.skinD, e: P.eye, b: P.shirt, B: P.shirtD, p: P.shorts, P: P.shortsD };
    return P;
  }
  // 16方向 → お手本のどの絵を使うか（奇数の向きは、近いななめの絵）
  // 16方向ごとの [頭, 胴, 左右反転, 両腕を胴の横に出すか, 胴の半分の幅]（参考の16方向の絵に合わせる）
  const VIEW16 = [
    ['L', 'L', 1, 0, 4], ['L2', 'L', 1, 0, 4], ['FL', 'N7', 1, 1, 3.9], ['FL', 'F', 1, 1, 4.4],
    ['F', 'F', 0, 1, 4.4], ['FL', 'F', 0, 1, 4.4], ['FL', 'N7', 0, 1, 3.9], ['L2', 'L', 0, 0, 4],
    ['L', 'L', 0, 0, 4], ['BL', 'BN7', 0, 1, 3.9], ['BL', 'BN7', 0, 1, 3.9], ['B', 'B', 0, 1, 4.4],
    ['B', 'B', 0, 1, 4.4], ['B', 'B', 1, 1, 4.4], ['BL', 'BN7', 1, 1, 3.9], ['BL', 'BN7', 1, 1, 3.9],
  ];
  function makeProj(facing) {
    const fx = Math.cos(facing), fy = Math.sin(facing), rx = -fy, ry = fx;
    return (r, u, f) => { const wx = r * rx + f * fx, wy = r * ry + f * fy; return { x: PX + wx, y: PY - u + wy * DEPTH, d: wy }; };
  }
  function Buf() { this.c = new Uint8ClampedArray(W * H * 4); }
  Buf.prototype.put = function (x, y, col) { x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; this.c[i] = col[0]; this.c[i + 1] = col[1]; this.c[i + 2] = col[2]; this.c[i + 3] = 255; };
  Buf.prototype.get = function (x, y) { if (x < 0 || y < 0 || x >= W || y >= H) return 0; return this.c[(y * W + x) * 4 + 3]; };
  function fillShape(buf, inside, bb, col, colD, opt) {
    opt = opt || {};
    const x0 = Math.max(0, Math.floor(bb[0]) - 2), x1 = Math.min(W - 1, Math.ceil(bb[2]) + 2), y0 = Math.max(0, Math.floor(bb[1]) - 2), y1 = Math.min(H - 1, Math.ceil(bb[3]) + 2);
    const ins = (x, y) => inside(x + 0.5, y + 0.5);
    if (!opt.noOutline) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (ins(x, y)) continue;
      if (!(ins(x + 1, y) || ins(x - 1, y) || ins(x, y + 1) || ins(x, y - 1))) continue;
      if (opt.soft && buf.get(x, y)) continue;   // すでに絵がある所（胴など）にはふちを描かない
      buf.put(x, y, OUT);
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!ins(x, y)) continue;
      const sh = colD && (!ins(x + 1, y) && ins(x - 1, y) || !ins(x, y + 1) && opt.shadeBottom);
      buf.put(x, y, sh ? colD : col);
    }
  }
  const capsule = (a, b, r) => (x, y) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy || 1e-6; let t = ((x - a.x) * vx + (y - a.y) * vy) / L; t = Math.max(0, Math.min(1, t)); const dx = x - (a.x + vx * t), dy = y - (a.y + vy * t); return dx * dx + dy * dy <= r * r; };
  const ellipse = (c, rx, ry) => (x, y) => ((x - c.x) / rx) ** 2 + ((y - c.y) / ry) ** 2 <= 1;
  const bbOf = (pts, pad) => [Math.min(...pts.map((p) => p.x)) - pad, Math.min(...pts.map((p) => p.y)) - pad, Math.max(...pts.map((p) => p.x)) + pad, Math.max(...pts.map((p) => p.y)) + pad];
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  // ---- ポーズ（関節の角度）：[振り, 曲げ, 開き] ----
  const STAND = { lL: [0, 0.04, 0.05], lR: [0, 0.04, 0.05], aL: [0.0, 0.1, 0.3], aR: [0.0, 0.1, 0.3], bob: 0 };
  // 走り：本家と同じく「右足を出す → そろう → 左足を出す → そろう」の4つの形だけ。手足はまっすぐ（ひざ・ひじを曲げない）
  // 腕：前に振る腕は胸の高さまで上げる（ひじを少し曲げる）、後ろの腕は体の横から後ろへ開く（本家の動画どおり）
  // 横・ななめ（本家の動画）：足は前後に大きく開いて三角に、腕は前の腕を前へ・後ろの腕を後ろへ水平に近く伸ばす
  const ARM_F = [1.2, 0.35, 0.3], ARM_B = [-1.05, 0.2, 0.4];
  const RUN_S = (k) => ({ lL: [1.0 * k, 0.05, 0.12], lR: [-0.95 * k, 0.1, 0.12], aL: k > 0 ? ARM_B : ARM_F, aR: k > 0 ? ARM_F : ARM_B, bob: 1 });
  const RUN_N = { lL: [0.1, 0.05, 0.06], lR: [-0.1, 0.05, 0.06], aL: [0.15, 0.05, 0.3], aR: [-0.15, 0.05, 0.3], bob: 0 };
  const RUN = [RUN_S(1), RUN_S(1), RUN_S(1), RUN_N, RUN_S(-1), RUN_S(-1), RUN_S(-1), RUN_N];
  function runPose(i) { return RUN[((i % 8) + 8) % 8]; }
  // 正面・背中（本家の動画）：片足をひざから持ち上げ、反対の腕を肩の高さまで真横に上げる。もう片方の腕は下ろしたまま
  const RUN_FS = (k) => ({ lL: k > 0 ? [0.3, 1.4, 0.05] : [0, 0.05, 0.08], lR: k > 0 ? [0, 0.05, 0.08] : [0.3, 1.4, 0.05],
    aL: k > 0 ? [0, 0.05, 0.3] : [0, 0, 1.05], aR: k > 0 ? [0, 0, 1.05] : [0, 0.05, 0.3], bob: 1 });
  const RUN_FN = { lL: [0, 0.04, 0.06], lR: [0, 0.04, 0.06], aL: [0, 0.05, 0.45], aR: [0, 0.05, 0.45], bob: 0 };
  const RUN_F = [RUN_FS(1), RUN_FS(1), RUN_FS(1), RUN_FN, RUN_FS(-1), RUN_FS(-1), RUN_FS(-1), RUN_FN];
  // ななめ（本家の動画）：①片足を持ち上げて両腕を真横 → そろう → ②両足を大きく開いて片腕が胴を横切る → そろう
  const RUN_D1 = Object.assign({}, RUN_FS(1), { scr: 'T' }), RUN_D2 = Object.assign({}, RUN_S(-1), { scr: 'X' });
  const RUN_D = [RUN_D1, RUN_D1, RUN_D1, RUN_FN, RUN_D2, RUN_D2, RUN_D2, RUN_FN];
  // 走りの腕（正面・背中・ななめ）：画面の上で、肩からひじ・手までのずれ（ドット）。x は外向きが＋
  const AS = { HANG: { e: [0.5, 2.6], h: [0.7, 4.6] }, NEUT: { e: [0.9, 2.4], h: [1.3, 4.3] }, RAISE: { e: [1.1, 2.6], h: [1.2, 0.9] },
    OUTL: { e: [1.6, 2.1], h: [2.6, 0.7] }, T: { e: [2.3, 0.5], h: [4.1, 0.8] }, ACROSS: { e: [-1.2, 2.4], h: [-3.4, 2.0], cross: 1 } };
  // パス：構え → 振りかぶり（蹴り足を後ろへ） → 接触（まっすぐ前へ） → 振り抜き
  const PASS = [
    { lL: [0.1, 0.05, 0.1], lR: [-0.15, 0.05, 0.1], aL: [0.3, 0.05, 0.4], aR: [-0.3, 0.05, 0.4], bob: 0 },
    { lL: [0.15, 0.05, 0.08], lR: [-0.9, 0.45, 0.1], aL: [0.8, 0.05, 0.6], aR: [-0.8, 0.05, 0.5], bob: 1 },
    { lL: [0.1, 0.05, 0.08], lR: [0.75, 0.05, 0.14], aL: [-0.5, 0.05, 0.6], aR: [0.6, 0.05, 0.5], bob: 1 },
    { lL: [0.0, 0.05, 0.06], lR: [1.15, 0.05, 0.14], aL: [-0.7, 0.05, 0.5], aR: [0.7, 0.05, 0.45], bob: 0 },
  ];
  const SHOT = [
    { lL: [0.1, 0.05, 0.1], lR: [-0.2, 0.05, 0.1], aL: [0.4, 0.05, 0.5], aR: [-0.4, 0.05, 0.5], bob: 0 },
    { lL: [0.2, 0.05, 0.08], lR: [-1.2, 0.6, 0.08], aL: [1.0, 0.05, 0.8], aR: [-1.0, 0.05, 0.7], bob: 1 },
    { lL: [0.1, 0.05, 0.08], lR: [0.8, 0.05, 0.1], aL: [-0.6, 0.05, 0.8], aR: [0.7, 0.05, 0.7], bob: 1 },
    { lL: [0.0, 0.05, 0.06], lR: [1.45, 0.05, 0.1], aL: [-0.9, 0.05, 0.7], aR: [0.9, 0.05, 0.6], bob: 0 },
  ];
  // 試合の動き（前の絵からの置きかえ）
  const CHEER = { lL: [0, 0.04, 0.06], lR: [0, 0.04, 0.06], aL: [0.15, 0, 2.75], aR: [0.15, 0, 2.75], bob: 0, armK: 1.45 };              // バンザイ（両腕を上へ）
  const JUMP = { lL: [-0.1, 0.8, 0.12], lR: [-0.3, 1.05, 0.12], aL: [0.3, 0.6, 0.45], aR: [0.3, 0.6, 0.45], bob: 0 };   // ヘディング・ジャンプ（ひざを曲げて、腕を広げる）
  const LUNGE = { lL: [1.0, 0.7, 0.1], lR: [-0.95, 0.05, 0.1], aL: [-0.5, 0.3, 0.4], aR: [0.6, 0.4, 0.4], bob: 2 };     // 踏み込み（フェイント・競り合い）
  const SOLE = { lL: [0, 0.04, 0.06], lR: [0.65, 0.35, 0.1], aL: [0, 0.1, 0.4], aR: [0, 0.1, 0.4], bob: 0 };          // 足裏でボールを押さえる
  const CROUCH = { lL: [0.35, 0.85, 0.16], lR: [0.35, 0.85, 0.16], aL: [0.3, 0.4, 0.4], aR: [0.3, 0.4, 0.4], bob: 2 };  // 腰を落とす
  // 4コマの走り（背中向きから確認中）：①右足接地 → ②浮く（右でけり出し）→ ③左足接地 → ④浮く（左でけり出し）
  // 脚は太もも（振り）とひざ（曲げ）で動かす。腕はひじを曲げ、右脚が前のときは左腕が前（体の近くで小さく振る）
  // 腕の値：[振り, ひじの曲げ, 外への開き]　脚の値：[振り, ひざの曲げ, 外への開き]
  const R4_CONTACT = (k) => {   // k=1：右足接地（右脚は下で体重を受ける、左脚はひざを曲げて後ろへ＝スパイクの裏が見える）
    const plant = [0.25, 0.15, 0.05], back = [-0.45, 1.25, 0.05];
    const aF = [0.65, 1.3, 0.3], aB = [-0.6, 0.9, 0.3];
    return k > 0 ? { lR: plant, lL: back, aL: aF, aR: aB, bob: 1, arm3d: 1 } : { lL: plant, lR: back, aR: aF, aL: aB, bob: 1, arm3d: 1 };
  };
  const R4_FLOAT = (k) => {     // k=1：右でけり出して浮く（右脚は後ろへ、左ひざが前へ出てくる）
    const push = [-0.35, 0.55, 0.05], knee = [0.35, 0.7, 0.05];
    const aF = [0.25, 1.2, 0.25], aB = [-0.2, 1.0, 0.25];
    return k > 0 ? { lR: push, lL: knee, aL: aF, aR: aB, bob: 0, arm3d: 1 } : { lL: push, lR: knee, aR: aF, aL: aB, bob: 0, arm3d: 1 };
  };
  const RUN4 = [R4_CONTACT(1), R4_FLOAT(1), R4_CONTACT(-1), R4_FLOAT(-1)];
  const POSES = { stand: () => STAND, run: runPose, run4: (i) => RUN4[((i % 4) + 4) % 4], pass: (i) => PASS[i], shot: (i) => SHOT[i],
    cheer: () => CHEER, jump: () => JUMP, lunge: () => LUNGE, sole: () => SOLE, crouch: () => CROUCH };

  const HIP_U = 7.4, HIP_R = 2.5, THIGH = 2.6, SHIN = 2.3, SHO_U = 13.2, SHO_R = 4.6, UARM = 2.6, FARM = 2.3;
  function limb(root, ang, l1, l2, side, isArm) {
    const [sw, bend, out] = ang, a1 = sw, a2 = isArm ? sw + bend : sw - bend, o = side * out;
    const j1 = { r: root.r + Math.sin(o) * l1, u: root.u - Math.cos(a1) * Math.cos(o) * l1, f: root.f + Math.sin(a1) * l1 };
    const wide = isArm && out > 0.8;   // 腕を真横に上げるときは、ひじから先もまっすぐ横へ
    const j2 = wide ? { r: j1.r + Math.sin(o) * l2, u: j1.u - Math.cos(a2) * Math.cos(o) * l2, f: j1.f + Math.sin(a2) * l2 * Math.cos(o) }
      : { r: j1.r + Math.sin(o) * l2 * 0.4, u: j1.u - Math.cos(a2) * l2, f: j1.f + Math.sin(a2) * l2 };
    return [j1, j2];
  }

  function render(opt) {
    const P = palette(opt), facing = opt.facing;
    const d16 = ((Math.round(facing / (Math.PI / 8)) % 16) + 16) % 16;
    const [hk, tk, mir, beside, half] = VIEW16[d16], vk = hk;
    const backBase = hk === 'B' && (opt.pose === 'run4' || ((opt.pose || 'stand') === 'stand' && opt.unifyBack));   // 背中向きの走りと待機は同じ胴（肩幅・袖幅・輪郭をそろえる）。試合へ組み込むまでは unifyBack を付けたときだけ
    const torsoK = backBase ? 'BR' : tk;
    const torso = VIEWS[torsoK].length > 11 ? VIEWS[torsoK].slice(9) : VIEWS[torsoK];
    const spr = VIEWS[hk].slice(0, 9).concat(torso);
    const frontish = Math.abs(Math.sin(facing)) > 0.8;   // 正面・背中寄り（16方向の3,4,5,11,12,13）
    const fi = (((opt.frame || 0) % 8) + 8) % 8, isRun = opt.pose === 'run';
    const backish = Math.sin(facing) < 0;
    // 正面・背中・手前ななめは「片手を上げて片足を持ち上げる」走り、奥ななめは「両腕を横／両足を開く」走り（本家の動画どおり）
    let pose = isRun && (frontish || (VIEW16[d16][3] && !backish)) ? RUN_F[fi] : isRun && VIEW16[d16][3] ? RUN_D[fi] : POSES[opt.pose || 'stand'](opt.frame || 0);
    const sideRun = opt.pose === 'run' && Math.abs(Math.cos(facing)) > 0.9;   // 横向きの走り：腕を前後へ水平に近く大きく振り、体からはみ出させる
    if (sideRun) { const big = (a) => a[0] > 0.6 ? [1.5, 0.15, 0.2] : a[0] < -0.6 ? [-1.45, 0.1, 0.2] : a; pose = Object.assign({}, pose, { aL: big(pose.aL), aR: big(pose.aR) }); }
    const kickL = Math.cos(facing) < -0.2 && (opt.pose === 'pass' || opt.pose === 'shot');
    if (kickL) pose = Object.assign({}, pose, { lL: pose.lR, lR: pose.lL, aL: pose.aR, aR: pose.aL });
    const pr = makeProj(facing), buf = new Buf(), bob = backBase ? 0 : (pose.bob || 0);
    const Q = (r, u, f) => pr(r, u - bob, f);
    // 脚（いつも胴の後ろ。奥の脚から）
    const legs = {}, legDraw = [], postDraw = [];
    // 背中向きの走り（本家どおり）：脚の長さは変えず、「接地した脚＝くつ下2段＋スパイク1段」「ひざを曲げた脚＝くつ下1段＋スパイクの裏2段」を描き分ける
    const backRun = backBase;   // 背中向きの走り・待機は、脚と腕をドット単位で描く
    // ①右足接地（左脚はひざを曲げて靴を高く・右腕が後ろ）②中間（左足が前へ）③左足接地 ④中間（右足が前へ）
    const BR = [{ R: 'plant', L: 'high', armBack: 1 }, { R: 'plant', L: 'mid', armSmall: -1 }, { L: 'plant', R: 'high', armBack: -1 }, { L: 'plant', R: 'mid', armSmall: 1 }][(((opt.frame || 0) % 4) + 4) % 4];
    const BRS = opt.pose === 'run4' ? BR : { R: 'plant', L: 'plant', hang: true };   // 待機：両足接地・両腕は下ろす
    if (backRun) for (const side of [-1, 1]) {
      const cx = Math.floor(PX - 0.5 + side * 3), st = BRS[side < 0 ? 'L' : 'R'];
      const box = (x0, x1, y0, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
      // plant＝くつ下2段＋スパイク1段（地面に残す）／mid＝靴を1段上げる（前へ運ぶ途中）
      // high＝ひざを曲げてかかとを後ろへ蹴り上げた形：ひざ（くつ下1段）の上に、手前を向いた靴底（濃い色＋スパイクの粒）が重なる。地面との間はすき間2段
      if (st !== 'high') {
        // 接地中の足を体に対して後ろ（画面の下）へ1段送る（滑り対策）：脚の長さは変えず、くつ下とスパイクを丸ごと下げ、空いた所にもも（パンツの色）が見える
        const pb = st === 'plant' && opt.pose === 'run4' ? (opt.plantBack || 0) : 0;
        const shoeY = (st === 'plant' ? PY - 2 : PY - 3) + pb;
        legs[side] = { toe: { x: cx + 0.5, y: shoeY + 0.5 }, knee: { x: cx + 0.5, y: PY - 5 + pb }, foot: { x: cx + 0.5, y: shoeY + 0.5 } };
        legDraw.push({ z: 0, draw: () => {
          if (pb) fillShape(buf, box(cx - 1, cx + 2, PY - 6, PY - 4 + pb), [cx - 2, PY - 7, cx + 3, PY - 3 + pb], P.shorts, P.shortsD);
          fillShape(buf, box(cx - 1, cx + 2, pb ? PY - 4 + pb : PY - 6, shoeY), [cx - 2, PY - 7, cx + 3, shoeY + 1], P.socks, P.socksD);
          fillShape(buf, box(cx - 1, cx + 2, shoeY, shoeY + 1), [cx - 2, shoeY - 1, cx + 3, shoeY + 2], P.shoe, null, { soft: true });
        } });
      } else {
        // 後ろから見ると、ひざがいちばん下・その上に手前を向いた靴底が来る（かかとを蹴り上げた形）
        const kneeB = PY - 4, soleY = PY - 6, sx = cx - 1;
        const sole = [84, 82, 90], stud = [168, 166, 174];
        legs[side] = { toe: { x: cx + 0.5, y: soleY + 1 }, knee: { x: cx + 0.5, y: kneeB + 0.5 }, foot: { x: cx + 0.5, y: soleY + 1 } };
        legDraw.push({ z: 0, draw: () => { fillShape(buf, box(cx - 1, cx + 2, PY - 7, kneeB + 1), [cx - 2, PY - 8, cx + 3, kneeB + 2], P.socks, P.socksD); } });
        postDraw.push(() => {
          for (let x = sx - 1; x <= sx + 3; x++) buf.put(x, soleY - 1, OUT);
          for (let y = soleY; y < soleY + 2; y++) { buf.put(sx - 1, y, OUT); buf.put(sx + 3, y, OUT); for (let x = sx; x < sx + 3; x++) buf.put(x, y, sole); }
          buf.put(sx, soleY + 1, stud); buf.put(sx + 2, soleY + 1, stud);   // スパイクの粒
        });
      }
    }
    if (!backRun) for (const side of [-1, 1]) {
      const ang = side < 0 ? pose.lL : pose.lR;
      const hip = { r: side * HIP_R, u: HIP_U, f: 0 };
      const [knee, ank] = limb(hip, ang, THIGH, SHIN, side, false);
      const toe = { r: ank.r, u: ank.u, f: ank.f + 1.0 };
      const Hh = Q(hip.r, hip.u, hip.f), K = Q(knee.r, knee.u, knee.f), A = Q(ank.r, Math.max(2.5, ank.u), ank.f), T = Q(toe.r, Math.max(2.5, toe.u), toe.f);
      const sn = (p) => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });
      [K.x, K.y] = [sn(K).x, sn(K).y]; [A.x, A.y] = [sn(A).x, sn(A).y]; [T.x, T.y] = [sn(T).x, sn(T).y]; [Hh.x, Hh.y] = [sn(Hh).x, sn(Hh).y];
      const As = { x: A.x, y: A.y + 1.0 }, Ts = { x: T.x, y: T.y + 1.0 };
      legs[side] = { toe: { x: Ts.x, y: Ts.y }, knee: { x: K.x, y: K.y }, foot: { x: As.x, y: As.y } };
      legDraw.push({ z: (K.d + A.d) / 2, draw: () => {
        // くつ下（パンツの下から）＋スパイク（いちばん下の1段・つま先へ少しのびる）
        fillShape(buf, capsule(Hh, K, 1.5 + 0.3 * Math.abs(Math.cos(facing))), bbOf([Hh, K], 2), P.shorts, P.shortsD);   // もも＝パンツの色（蹴り上げると見える）
        const KS = lerp(K, A, 0.15), side = Math.abs(Math.cos(facing)), lr = 1.3 + 0.4 * side;   // 横向きほど脚を太く
        fillShape(buf, capsule(KS, A, lr), bbOf([KS, A], 2), P.socks, P.socksD);
        const sp = (x, y) => capsule({ x: As.x, y: As.y * 2.4 }, { x: Ts.x, y: Ts.y * 2.4 }, 1.35)(x, y * 2.4);   // 横長（高さ1段）のスパイク
        fillShape(buf, sp, bbOf([As, Ts], 2), P.shoe, null, { soft: true });
      } });
    }
    legDraw.sort((a, b) => a.z - b.z).forEach((p) => p.draw());
    // 腕（奥の腕は胴の後ろ、手前の腕は胴の前）
    const arms = [], handsAt = {};
    for (const side of [-1, 1]) {
      const ang = side < 0 ? pose.aL : pose.aR;
      const sh = { r: side * SHO_R, u: SHO_U, f: -0.3 };
      const AK = pose.armK || 1;
      const [el, hand] = limb(sh, ang, UARM * AK, FARM * AK, side, true);
      const S = Q(sh.r, sh.u, sh.f), E = Q(el.r, el.u, el.f), Hd = Q(hand.r, hand.u, hand.f);
      // 走り（正面・背中・ななめ）：本家と同じ短い腕の形を、画面の上のずれで直接決める
      let spec = null, sgS = 0;
      if (backRun) {
        // 背中の走りの腕（ドット単位で決める）：肩を支点に前後へ振るだけで、左右には開かない。
        // 前へ振った腕は胴の向こうに隠す。後ろへ振った腕は、上腕を胴にそわせ（袖が1ドットだけ横に出る）、ひじを曲げた先の手が腰の前に少し出る。
        // 中間のコマは、次に後ろへ振る腕の手だけが腰の横に小さく見える（両腕を同時に全部は見せない）
        const st = BRS.hang ? 'hang' : BRS.armBack === side ? 'back' : BRS.armSmall === side ? 'small' : null;
        if (!st) continue;
        const xo = side > 0 ? PX + 5 : PX - 6, X = (d) => xo + side * d;   // 胴の横のふち（背中の絵の3列目／14列目）
        const pts = st === 'back'
          ? { behind: [[1, 18, P.shirt], [1, 19, P.shirt], [1, 20, P.shirtD]], front: [[1, 21, P.skin], [1, 22, P.skinD], [0, 22, P.skin]] }
          : st === 'hang' ? { behind: [[1, 18, P.shirt], [1, 19, P.shirt], [1, 20, P.shirtD], [1, 21, P.skin], [1, 22, P.skinD]], front: [] }   // 待機：腕を下ろして胴にそわせる
          : { behind: [[1, 21, P.skin], [1, 22, P.skinD]], front: [] };
        const stampOut = (list) => { const has = new Set(list.map(([d, y]) => X(d) + ',' + y));
          for (const [d, y] of list) for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = X(d) + ox, yy = y + oy; if (!has.has(xx + ',' + yy) && !buf.get(xx, yy)) buf.put(xx, yy, OUT); } };
        handsAt[side] = { x: X(1) + 0.5, y: 22.5, elbow: { x: X(1) + 0.5, y: 20.5 } };
        arms.push({ z: -1, fwd: false, draw: () => { for (const [d, y, c] of pts.behind) buf.put(X(d), y, c); stampOut(pts.behind); } });
        if (pts.front.length) postDraw.push(() => { for (const [d, y, c] of pts.front) buf.put(X(d), y, c); stampOut(pts.behind.concat(pts.front)); });
        continue;
      }
      if (!backRun && beside && isRun && !pose.arm3d) {
        sgS = Math.sign(S.x - PX) || (side * -Math.sin(facing) >= 0 ? 1 : -1);
        const liftSide = Math.sign(Q((pose.lL[1] > 1 ? -1 : 1) * HIP_R, HIP_U, 0).x - PX);   // 持ち上げた足が画面のどちら側か
        const lifted = pose.lL[1] > 1 || pose.lR[1] > 1, lead = Math.cos(facing) >= 0 ? 1 : -1;
        if (pose.scr === 'T') spec = AS.T;
        else if (pose.scr === 'X') spec = sgS === lead ? AS.ACROSS : null;
        else if (lifted) spec = sgS === -liftSide ? (backish ? AS.OUTL : AS.RAISE) : AS.HANG;
        else spec = AS.NEUT;
        if (!spec) continue;   // 体の後ろに隠れる腕
      }
      if (spec) {
        const sx = PX + sgS * (half + 0.4), sy = Q(0, sh.u, 0).y;
        S.x = sx; S.y = sy; E.x = sx + sgS * spec.e[0]; E.y = sy + spec.e[1]; Hd.x = sx + sgS * spec.h[0]; Hd.y = sy + spec.h[1];
      } else if (beside) {
        // 肩の位置は画面で決める（胴の横）。腕の振り（前後）だけ3Dで計算して、外への開きは小さく固定
        const sg = Math.sign(S.x - PX) || (side * -Math.sin(facing) >= 0 ? 1 : -1);
        const spl = (opt.pose === 'run' && frontish) || opt.pose === 'cheer' ? ang[2] : Math.min(ang[2], 0.35);   // 腕を大きく開くのはバンザイだけ（ほかは本家どおり短く）   // 正面・背中の走りは、上げる腕を真横へ
        const [el2, hand2] = limb(sh, [ang[0], ang[1], spl], UARM * AK, FARM * AK, side, true);
        const S0 = Q(sh.r, sh.u, sh.f), E0 = Q(el2.r, el2.u, el2.f), H0 = Q(hand2.r, hand2.u, hand2.f);
        const sx = PX + sg * (half + 0.4);
        const sy = Q(0, sh.u, 0).y;   // 肩の高さは左右で同じ（奥の腕だけ短く見えないように）
        S.x = sx; S.y = sy; E.x = sx + (E0.x - S0.x) + sg * 0.3; E.y = sy + (E0.y - S0.y); Hd.x = sx + (H0.x - S0.x) + sg * 0.4; Hd.y = sy + (H0.y - S0.y);
      }
      if (!spec && isRun && !beside) {   // 横向きの走り：腕は短く（本家の横向きは手が体から少し出るだけ）
        E.x = S.x + (E.x - S.x) * 0.7; E.y = S.y + (E.y - S.y) * 0.7; Hd.x = S.x + (Hd.x - S.x) * 0.7; Hd.y = S.y + (Hd.y - S.y) * 0.7;
      }
      const cross = spec && spec.cross;
      handsAt[side] = { x: Hd.x, y: Hd.y, elbow: { x: E.x, y: E.y } };
      arms.push({ z: (S.d + E.d + Hd.d) / 3, fwd: hand.f > 1.2, draw: () => {
        // 腕：シャツの色の短い棒、先に肌色の手
        // 胴の前に重なる腕は、ふちを胴の上に描かず、影の色で形を見せる
        const over = cross || (Math.abs(Math.cos(facing)) > 0.9 && !sideRun) || (Math.abs(Hd.x - PX) < 3.5 && Math.abs(S.x - PX) < 3.5);   // 横向きの腕は胴に重なる
        if (spec && spec.br) fillShape(buf, (x, y) => capsule(S, E, 1.3)(x, y) || capsule(E, Hd, 1.2)(x, y), bbOf([S, E, Hd], 2), P.shirt, P.shirtD);   // 背中の走り：肩は描かず、ひじから先だけ（胴の後ろから少し出る）
        else fillShape(buf, (x, y) => capsule(S, E, 1.5)(x, y) || capsule(E, Hd, 1.4)(x, y), bbOf([S, E, Hd], 2), over ? P.shirtD : P.shirt, null, { soft: true });
        fillShape(buf, ellipse({ x: Hd.x, y: Hd.y + 0.5 }, 1.5, 1.0), bbOf([Hd], 2), P.glove || P.skin, null, { soft: true });
      } });
    }
    arms.sort((a, b) => a.z - b.z);
    const isBack = (a) => backRun || (a.z < -0.8 && !a.fwd && !beside);   // 背中の走り：腕は胴の後ろに描き、胴の輪郭（肩・脇）を崩さない   // 3と5は正面と同じく両腕を胴の横に見せる   // 奥の腕は胴の後ろ（前へ振った腕は前に出す）
    const back = arms.filter(isBack), front = arms.filter((a) => !isBack(a));
    back.forEach((p) => p.draw());
    // 頭と胴（お手本の絵）
    const oy = PY - 24 - bob;
    for (let r = 0; r < spr.length; r++) { const row = spr[r]; for (let c = 0; c < 18; c++) { const ch = row[c]; if (ch === '.') continue; buf.put(mir ? PX + 8 - c : PX + c - 9, oy + r, P.ch[ch]); } }
    front.forEach((p) => p.draw());
    postDraw.forEach((d) => d());
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').putImageData(new ImageData(buf.c, W, H), 0, 0);
    return { cv, px: PX, py: PY, toeR: legs[1].toe, toeL: legs[-1].toe, toeK: kickL ? legs[-1].toe : legs[1].toe, view: vk + (mir ? '*' : ''), joints: { footL: legs[-1].foot, footR: legs[1].foot, kneeL: legs[-1].knee, kneeR: legs[1].knee, handL: handsAt[-1], handR: handsAt[1] } };
  }
  const cache = new Map();
  function frame(opt) { const k = JSON.stringify(opt); let f = cache.get(k); if (!f) { f = render(opt); cache.set(k, f); } return f; }
  const DIRS = 16;
  const dirAngle = (d) => d * Math.PI * 2 / DIRS;
  const angleDir = (a) => ((Math.round(a / (Math.PI * 2 / DIRS)) % DIRS) + DIRS) % DIRS;
  window.DotMan = { frame, render, dirAngle, angleDir, DIRS, W, H, PX, PY, DEPTH, POSES, VIEWS };
})();
