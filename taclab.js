// 版879：動き方の確認：本物の試合（オールS同士）の中から、版878で入れた動きの場面だけを種類ごとにくり返し再生する。動いた選手を選んで（足もとの印）、カメラで追う
(() => {
  const D = window.__demo; if (!D) return;
  window.__noShow = true;
  const SC = window.__TAC_SCENES || {};
  const KINDS = [
    ['pressback', 'プレスバック', -2.0, 3.0, '印の選手に注目。中盤で相手がボールを受けた瞬間、ボールより前にいた印の選手が全速で戻って、相手を後ろから挟む'],
    ['stepup', 'クリア後のライン押し上げ', -1.0, 3.5, '印のDFに注目。クリアした直後、相手が自由に持てていなければ、DFラインが一気に前へ上がる'],
    ['follow', 'シュート後の詰め', -1.2, 2.6, '印の選手に注目。味方がシュートを打った瞬間、GKがはじきそうな所（ゴールの斜め前）へ走り込む'],
    ['twin', '2トップの役割分担', -2.0, 3.2, '印のFWに注目。相棒のFWが下がって受けに行ったら、印のFWは空いた裏へ抜ける'],
    ['sbgo', 'SBのオーバーラップ（前向きの時）', -1.2, 3.4, '印のSBに注目。持っている味方が前を向いている時だけ、外を追い越して上がる'],
    ['sbhold', 'SBが待つ（後ろ向きの時）', -1.2, 3.0, '印のSBに注目。持っている味方が後ろ向き（背中から寄せられている）の時は、上がらずに出せる所で待つ'],
    ['wait', '待つドリブル', -0.8, 4.0, '印のSBに注目。サイドで1対1になった味方は、急いで仕掛けずに少し内へゆっくり運んで時間をつくり、そのあいだに印のSBが外を追い越していく'],
    ['waitgo', '待つドリブル→追い越したSBへ', -3.0, 2.0, '印の選手に注目。SBが外を追い越したところで、パスを出して2対1にする'],
    ['cklate', 'CK：おとり→ファーに遅れて入る', -1.0, 3.2, '印の選手に注目。ほかの選手がニアへ走り込んで相手を引きつけ、エリアの外にいた印の選手がファーへ遅れて走り込んで合わせる'],
  ].filter(([k]) => (SC[k] || []).length);
  let kind = KINDS[0] ? KINDS[0][0] : null, idx = 0, sp = 0.5, cur = null, loaded = null, paused = false;
  const K = (k) => KINDS.find((x) => x[0] === k);
  function loadSeed(seed) {
    if (loaded === seed) return;
    document.querySelector('#level').value = 's'; const op = document.querySelector('#opponent'); if (op) op.value = 'バランス型';
    document.getElementById('seed').value = String(seed);
    D.start(); D.stop(); loaded = seed; window.__noShow = true;
  }
  const win = () => { const k = K(kind); return [cur.t + k[2], cur.t + k[3]]; };
  function go() {
    const L = SC[kind] || []; if (!L.length) return;
    idx = (idx + L.length) % L.length; cur = L[idx];
    loadSeed(cur.seed); if (cur.i != null) D.select(cur.i); 
    const [a] = win(); D.seek(Math.max(0.2, a)); D.setSpeed(sp); if (!paused) D.play(); info();
    const c0 = cur; setTimeout(() => { if (cur === c0) { D.seek(Math.max(0.2, a)); D.setSpeed(sp); } }, 200);
  }
  function tick() {
    if (!cur) return;
    const [a, b] = win(), t = D.time();
    if (!paused && (t > b || t < a - 1)) { D.seek(Math.max(0.2, a)); D.setSpeed(sp); if (!D.playing) D.play(); }
    
  }
  const css = document.createElement('style');
  css.textContent = `#clubScreen,.std-wrap{display:none!important}#gl{position:fixed;left:8px;top:58px;z-index:50;background:rgba(10,24,16,.92);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;padding:8px 10px;font:11px/1.35 system-ui,sans-serif;max-width:min(400px,calc(100vw - 110px));padding:5px 7px;box-sizing:border-box}
  #gl b{color:#ffe05a}#gl select,#gl button{font:11px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:3px 6px;margin:1px}
  #gl button.on{background:#3d7a4f;border-color:#9fe0b0}#gl .row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px}#gl .msg{color:#bcd3c2;margin-top:1px;font-size:10px}#gl .what{color:#fff;margin-top:2px}#gl.mini>:not(:first-child){display:none}#gl.mini #glP,#gl.mini #glN{display:none}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'gl';
  box.innerHTML = `<div class="row"><b id="glT" style="cursor:pointer">動き方 ▾</b><select id="glK">${KINDS.map(([k, n]) => `<option value="${k}">${n}（${SC[k].length}）</option>`).join('')}</select>
    <button id="glP">◀</button><button id="glN">▶</button></div>
    <div class="row"><button data-s="1">1倍</button><button data-s="0.5" class="on">1/2</button><button data-s="0.25">1/4</button><button data-s="0.1">1/10</button>
    <button id="glStop">停止</button><button id="glB">◀コマ</button><button id="glF">コマ▶</button><button id="glZ">近い</button><button id="glZ2">ふつう</button><button id="glZ3">遠い</button></div>
    <div class="what" id="glW"></div><div class="msg" id="glM"></div>`;
  document.body.appendChild(box);
  function info() {
    const L = SC[kind] || [], k = K(kind); if (!L.length) return;
    document.getElementById('glW').textContent = '' + k[4];
    const c = L[(idx + L.length) % L.length], m = Math.floor(c.t * ((D.match && D.match.clockScale) || 12) / 60);
    document.getElementById('glM').textContent = `${idx + 1} / ${L.length} 場面目：試合番号${c.seed}・${m}分ごろ（版 ${window.__appVer || '?'}）`;
  }
  const setPaused = (v) => { paused = v; document.getElementById('glStop').textContent = v ? '再生' : '停止'; if (v) D.setSpeed(0.0001); else { D.setSpeed(sp); D.play(); } };
  const step = (d) => { setPaused(true); D.seek(Math.max(0.2, D.time() + d)); D.setSpeed(0.0001); D.play(); };
  document.getElementById('glT').onclick = () => { box.classList.toggle('mini'); document.getElementById('glT').textContent = '動き方 ' + (box.classList.contains('mini') ? '▸' : '▾'); };
  document.getElementById('glK').onchange = (e) => { kind = e.target.value; idx = 0; go(); };
  document.getElementById('glP').onclick = () => { idx--; go(); };
  document.getElementById('glN').onclick = () => { idx++; go(); };
  document.getElementById('glStop').onclick = () => setPaused(!paused);
  document.getElementById('glB').onclick = () => step(-0.05);
  document.getElementById('glF').onclick = () => step(0.05);
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sp = +b.dataset.s; box.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); if (paused) setPaused(false); else D.setSpeed(sp); });
  document.getElementById('glZ3').onclick = () => { const z = document.querySelector('[data-zoom="far"]'); if (z) z.click(); };
  document.getElementById('glZ2').onclick = () => { const z = document.querySelector('[data-zoom="normal"]'); if (z) z.click(); };
  document.getElementById('glZ').onclick = () => { const z = document.querySelector('[data-zoom="near"]'); if (z) z.click(); };
  setTimeout(() => { if (kind) go(); setInterval(tick, 50); }, 300);   // 動き方は広く見たいので、ふつうの距離から（近くで見るボタンで寄れる）
})();
