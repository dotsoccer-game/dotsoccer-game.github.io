// ゴールとボールの確認：本物の試合（オールS同士）の中から、ゴールまわりの場面だけをくり返し再生する
//  画面右上に「上から見た図」と「横から見た図」を出し、ボールがゴールの中・外・ネット・柱のどこにあるかを数字でも見せる
(() => {
  const D = window.__demo; if (!D) return;
  window.__noShow = true;   // ゴールの演出・判定のリプレイ・ハーフタイムは出さない
  const SC = window.__GOAL_SCENES || {};
  const C = window.DotSoccer.CONST, POST = C.POST, BAR = C.BAR, DEP = 2.6;
  const KINDS = [
    ['csroll', 'コントロールショットのコロコロ', -2.0, 2.8, 'GKがニアの柱に寄っている（ニアへ動いている）時だけ、反応が遅れてファーへ転がる球が入る。GKがニアに寄っていなければ、GKが構えて止める'],
    ['ctrl', 'コントロールショット（ファーが空いている時）', -0.8, 3.0, 'GKがニアに寄っている（＝ファーが空いている）時に、ファーの隅へ巻いて置く'],
    ['nearup', 'ニア上ぶち抜き（ニアが空いている時）', -0.5, 2.8, 'GKが中央寄りでニアの上が空いている時に、グッと溜めてニアの上へ撃ち抜く'],
    ['drive', 'ドライブシュート（バイタルエリアから）', -0.8, 3.4, 'PAの外、ペナルティアーク手前のバイタルエリア（中央）から撃つ。バーを越えると見せて急に落ちる'],
    ['chain', '技のつなぎ（ドリブル技→シュート技）', -0.6, 3.6, '持っている技どうしは続けて出せる。ただし前の技の足さばきが終わってから、次の技に入る（一つずつ何をしたか分かる）'],
    ['fkshot', 'FKマイスターのシュート技', -1.0, 3.6, 'FKマイスターを持っていて、無回転・ドライブ・コントロールショットのどれかを持っている選手は、直接FKでその技を使う'],
    ['goal', 'ゴール（ネットに入る）', -1.5, 3.2, 'シュートがゴールの口（柱の内側・バーの下）を通って、ネットに入る'],
    ['after', 'ゴールのあと（ネットの中のボール）', -0.8, 6.5, 'ネットの中で揺れて落ち、ゴールの口から出てセンターへ戻る'],
    ['side', '外のサイドネットに当たる', -1.5, 3.0, 'ゴールの横に外れた球が、外側のサイドネットに当たって止まり、外に落ちる（中には入らない）'],
    ['back', '後ろのネットに当たる', -1.5, 3.0, 'ゴールの裏から来た球が、後ろのネットに当たって止まる'],
    ['post', 'ポストに当たる', -1.5, 2.6, '柱に当たって跳ね返る（跳ね返った球には、GKは反応できない。キャッチもパンチングもしない）'],
    ['bar', 'クロスバーに当たる', -1.5, 2.6, 'バーに当たって跳ね返る（跳ね返った球には、GKは反応できない。キャッチもパンチングもしない）'],
    ['wide', 'ゴールのすぐ横に外れる', -1.5, 2.6, '柱のすぐ外を通ってゴールラインを割る（ネットには触れない）'],
    ['over', 'バーのすぐ上に外れる', -1.5, 2.6, 'バーのすぐ上を越えていく（天井のネットに当たった時は、はずんでそのまま後ろへ落ちる）'],
    ['wallhit', '外れた球がゴール裏の壁へ', -1.5, 3.8, '勢いの余った球は、ゴール裏・奥の壁まで飛んで当たって跳ね返る（見えない壁で止まらない）'],
    ['stands', '外れた球が観客席へ', -1.5, 3.8, '壁より高く飛んだ球は、観客席に飛び込む'],
    ['lineclear', 'DFのゴールライン際のクリア', -1.8, 2.6, 'ゴールに向かう球に、DFがスライディングで足を伸ばしてかき出す（ゴールを割らせない）'],
    ['save', 'ゴールライン際のセーブ', -1.5, 2.4, 'GKがゴールライン際で止める・はじく'],
  ].filter(([k]) => (SC[k] || []).length);
  let kind = KINDS[0] ? KINDS[0][0] : null, idx = 0, sp = 0.5, cur = null, loaded = null, paused = false;
  const K = (k) => KINDS.find((x) => x[0] === k);
  const NM = { bodyFeint: 'ボディフェイント', scissors: 'シザース', doubleScissors: 'ダブルシザース', doubleTouch: 'ダブルタッチ', roulette: 'マルセイユルーレット', elastico: 'エラシコ', nutmeg: '股抜き', cutIn: 'カットイン', heelLift: 'ヒールリフト', kickFeint: 'キックフェイント', nearPost: 'ニア上ぶち抜き', powerMid: '強烈ミドル', controlShot: 'コントロールショット', knuckle: '無回転シュート', driveShot: 'ドライブシュート', toeKick: 'トゥーキック' };
  function loadSeed(seed) {
    if (loaded === seed) return;
    document.querySelector('#level').value = 's'; const op = document.querySelector('#opponent'); if (op) op.value = 'バランス型';
    document.getElementById('seed').value = String(seed);
    D.start(); D.stop(); loaded = seed;
  }
  const win = () => { const k = K(kind); return [cur.t + k[2], cur.t + k[3]]; };
  function go() {
    const L = SC[kind] || []; if (!L.length) return;
    idx = (idx + L.length) % L.length; cur = L[idx];
    loadSeed(cur.seed); if (cur.i >= 0) D.select(cur.i);
    const [a] = win(); D.seek(Math.max(0.2, a)); D.setSpeed(sp); if (!paused) D.play(); info();
    const c0 = cur; setTimeout(() => { if (cur === c0) { D.seek(Math.max(0.2, a)); D.setSpeed(sp); } }, 200);
  }
  function tick() {
    if (!cur) return;
    const [a, b] = win(), t = D.time();
    if (!paused && (t > b || t < a - 1)) { D.seek(Math.max(0.2, a)); D.setSpeed(sp); if (!D.playing) D.play(); }
    drawMap();
  }
  // ---- 操作パネル ----
  const css = document.createElement('style');
  css.textContent = `#gl{position:fixed;left:8px;top:58px;z-index:50;background:rgba(10,24,16,.92);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;padding:8px 10px;font:13px/1.45 system-ui,sans-serif;max-width:min(560px,calc(100vw - 16px));box-sizing:border-box}
  #gl b{color:#ffe05a}#gl select,#gl button{font:13px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:5px 8px;margin:2px}
  #gl button.on{background:#3d7a4f;border-color:#9fe0b0}#gl .row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px}#gl .msg{color:#bcd3c2;margin-top:4px}#gl .what{color:#fff;margin-top:2px}
  #glMap{position:fixed;right:8px;top:58px;z-index:50;background:rgba(10,24,16,.92);border:1px solid #3d6b4a;border-radius:10px;padding:6px;color:#e8f2ea;font:12px system-ui,sans-serif}
  #glMap canvas{display:block;width:260px!important;max-width:none!important}#glMap #glTop{height:170px!important}#glMap #glSide{height:120px!important}#glNow{max-width:260px}#glNow{margin-top:4px;font-weight:600}
  @media (max-width:760px){#glMap{top:auto;bottom:70px}}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'gl';
  box.innerHTML = `<div class="row"><b>ゴールとボールの確認</b><select id="glK">${KINDS.map(([k, n]) => `<option value="${k}">${n}（${SC[k].length}）</option>`).join('')}</select>
    <button id="glP">◀ 前の場面</button><button id="glN">次の場面 ▶</button></div>
    <div class="row">速さ <button data-s="1">1倍</button><button data-s="0.5" class="on">1/2</button><button data-s="0.25">1/4</button><button data-s="0.1">1/10</button>
    <button id="glStop">一時停止</button><button id="glB">◀ コマ戻し</button><button id="glF">コマ送り ▶</button><button id="glZ">近くで見る</button></div>
    <div class="what" id="glW"></div><div class="msg" style="opacity:.7">版 ${window.__appVer || '?'}</div><div class="msg" id="glM"></div>`;
  document.body.appendChild(box);
  const map = document.createElement('div'); map.id = 'glMap';
  map.innerHTML = `<div>上から見たゴール</div><canvas id="glTop" width="260" height="170"></canvas><div>横から見たゴール</div><canvas id="glSide" width="260" height="120"></canvas><div id="glNow"></div>`;
  document.body.appendChild(map);
  function info() {
    const L = SC[kind] || [], k = K(kind); if (!L.length) return;
    document.getElementById('glW').textContent = '見るところ：' + k[4];
    const c = L[(idx + L.length) % L.length], m = Math.floor(c.t * ((D.match && D.match.clockScale) || 12) / 60);
    document.getElementById('glM').textContent = `${idx + 1} / ${L.length} 場面目：試合番号${c.seed}・${m}分ごろ${c.res ? (c.res === 'goal' ? '・結果：ゴール（GKがニア寄り）' : '・結果：GKが止める') : ''}${c.k ? '・技：' + c.k.split('→').map((x) => NM[x] || x).join(' → ') : ''}（同じ場面をくり返し再生）`;
  }
  // ---- 上から・横から見た図（ボールの通り道と今の位置） ----
  function ballAt(t) {
    const M = D.match, F = M.frames, dt = M.frameDt || 0.1, k = t / dt, i = Math.max(0, Math.min(F.length - 2, Math.floor(k))), u = Math.max(0, Math.min(1, k - i));
    const a = F[i], b = F[i + 1]; return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
  }
  function where(x, y, z) {
    const gl = x < 52.5 ? 0 : 105, behind = (x - gl) * (gl ? 1 : -1), dy = Math.abs(y - 34), roof = BAR - BAR * 0.08 * Math.max(0, Math.min(1, behind / DEP));
    if (behind <= 0) return 'ピッチの中';
    if (dy < POST && behind < DEP && z < roof) return 'ゴールの中（ネットの内側）';
    if (dy < POST && behind < DEP + 0.3 && z >= roof - 0.05 && z < roof + 0.4) return 'ゴールの上（天井のネットの外）';
    if (behind >= DEP && dy < POST + 0.3) return 'ゴールの裏（ネットの外）';
    if (dy >= POST && dy < POST + 0.4 && behind < DEP) return 'サイドネットの外側';
    return 'ゴールラインの外（ゴールの外）';
  }
  function drawMap() {
    if (!cur || !D.match) return;
    const t = D.time(), [a, b] = win(), [bx0] = ballAt(cur.t + 0.6), gl = bx0 < 52.5 ? 0 : 105, s = gl ? 1 : -1;
    const T = document.getElementById('glTop').getContext('2d'), Sd = document.getElementById('glSide').getContext('2d');
    // 上から：横（x）はゴールラインから -6m〜+4m、縦（y）はゴール中央 ±8m
    const TX = (x) => 20 + ((x - gl) * s + 6) * 14, TY = (y) => 85 + (y - 34) * 9.5;
    T.clearRect(0, 0, 260, 170); T.fillStyle = '#2f7a3d'; T.fillRect(0, 0, TX(gl) , 170); T.fillStyle = '#25502e'; T.fillRect(TX(gl), 0, 260, 170);
    T.strokeStyle = '#fff'; T.lineWidth = 2; T.beginPath(); T.moveTo(TX(gl), 0); T.lineTo(TX(gl), 170); T.stroke();
    T.fillStyle = 'rgba(255,255,255,.18)'; T.fillRect(TX(gl), TY(34 - POST), DEP * 14, POST * 2 * 9.5);
    T.strokeStyle = 'rgba(255,255,255,.85)'; T.lineWidth = 1.5; T.strokeRect(TX(gl), TY(34 - POST), DEP * 14, POST * 2 * 9.5);
    T.fillStyle = '#ddd'; for (const py of [34 - POST, 34 + POST]) { T.beginPath(); T.arc(TX(gl), TY(py), 3.5, 0, 7); T.fill(); }
    // 横から：横（x）は同じ、縦（z）は 0〜5m
    const SY = (z) => 108 - z * 19;
    Sd.clearRect(0, 0, 260, 120); Sd.fillStyle = '#1d3a24'; Sd.fillRect(0, 0, 260, 120); Sd.fillStyle = '#2f7a3d'; Sd.fillRect(0, SY(0), 260, 12);
    Sd.strokeStyle = 'rgba(255,255,255,.85)'; Sd.lineWidth = 1.5; Sd.beginPath(); Sd.moveTo(TX(gl), SY(0)); Sd.lineTo(TX(gl), SY(BAR)); Sd.lineTo(TX(gl + s * DEP), SY(BAR * 0.92)); Sd.lineTo(TX(gl + s * DEP), SY(0)); Sd.stroke();
    Sd.fillStyle = 'rgba(255,255,255,.12)'; Sd.beginPath(); Sd.moveTo(TX(gl), SY(0)); Sd.lineTo(TX(gl), SY(BAR)); Sd.lineTo(TX(gl + s * DEP), SY(BAR * 0.92)); Sd.lineTo(TX(gl + s * DEP), SY(0)); Sd.fill();
    Sd.strokeStyle = '#ddd'; Sd.lineWidth = 3; Sd.beginPath(); Sd.moveTo(TX(gl), SY(0)); Sd.lineTo(TX(gl), SY(BAR)); Sd.stroke();
    // 通り道
    const pts = []; for (let tt = a; tt <= b; tt += 0.05) pts.push(ballAt(tt));
    for (const [ctx, fy] of [[T, (p) => TY(p[1])], [Sd, (p) => SY(p[2])]]) {
      ctx.strokeStyle = 'rgba(255,224,90,.75)'; ctx.lineWidth = 1.5; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(TX(p[0]), fy(p)) : ctx.moveTo(TX(p[0]), fy(p)))); ctx.stroke();
    }
    const p = ballAt(t);
    for (const [ctx, y] of [[T, TY(p[1])], [Sd, SY(p[2])]]) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(TX(p[0]), y, 4.5, 0, 7); ctx.fill(); ctx.stroke(); }
    const behind = (p[0] - gl) * s;
    document.getElementById('glNow').textContent = `ボール：${where(p[0], p[1], p[2])}　ラインから${behind >= 0 ? '奥へ' : '手前'}${Math.abs(behind).toFixed(1)}m・中央から${Math.abs(p[1] - 34).toFixed(1)}m・高さ${p[2].toFixed(1)}m`;
  }
  const setPaused = (v) => { paused = v; document.getElementById('glStop').textContent = v ? '再生' : '一時停止'; if (v) D.setSpeed(0.0001); else { D.setSpeed(sp); D.play(); } };
  const step = (d) => { setPaused(true); D.seek(Math.max(0.2, D.time() + d)); D.setSpeed(0.0001); D.play(); };
  document.getElementById('glK').onchange = (e) => { kind = e.target.value; idx = 0; go(); };
  document.getElementById('glP').onclick = () => { idx--; go(); };
  document.getElementById('glN').onclick = () => { idx++; go(); };
  document.getElementById('glStop').onclick = () => setPaused(!paused);
  document.getElementById('glB').onclick = () => step(-0.05);
  document.getElementById('glF').onclick = () => step(0.05);
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sp = +b.dataset.s; box.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); if (paused) setPaused(false); else D.setSpeed(sp); });
  document.getElementById('glZ').onclick = () => { const z = document.querySelector('[data-zoom="near"]'); if (z) z.click(); };
  setTimeout(() => { if (kind) go(); setInterval(tick, 50); }, 300);
})();
