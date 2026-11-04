// 版1028：体のぶつけ合い（デュエル）の確認：本物の試合（オールS同士）の中から、体をぶつけ合う場面だけを種類ごとにくり返し再生する
(() => {
  const D = window.__demo; if (!D) return;
  window.__noShow = true;
  const SC = window.__DUEL_SCENES || {};
  const KINDS = [
    ['run', '並走して肩で押し合う', -1.6, 1.8, '版1028：ドリブルする選手と、横から追いついた守備者が、走りながら肩をぶつけ合う（ドン、ドンと何度か）。押し負けた方は半歩はじかれる。最後に奪う・抜くが決まる（フィジカルが強い方が有利。ショルダーチャージを持つ選手は強い）'],
    ['back', '背負って押し合う', -1.6, 1.8, '版1028：相手を背中に背負ってボールを守る選手と、後ろから体を当てる守備者。背負う側はフィジカル・テクニック・メンタル（ポストプレーを持つ選手は強い）'],
    ['front', '正面から体を当てる', -1.4, 1.6, '版1028：正面から奪いに来た相手と、体をぶつけ合ってから、奪う・抜くが決まる'],
    ['touch', '近づいた時の体の当たり', -1.4, 1.4, '版1028：奪いに行く前でも、体が触れるほど近づいたら肩・体が当たる（押し合いながら走る）'],
    ['loose', 'こぼれ球の取り合い', -1.6, 1.6, '版1028：転がっている球に敵と味方が同時に向かった時、体をぶつけ合い、押し勝った方が先に触る（フィジカル・瞬発力。ショルダーチャージ・こぼれ球の嗅覚を持つ選手は強い）'],
    ['air', '空中戦の競り合い', -1.6, 1.6, '版1028：ヘディングで同時に跳んだ2人が、空中で体をぶつけ合う。勝った方が頭で触る'],
  ].filter(([k]) => (SC[k] || []).length);
  let kind = KINDS[0] ? KINDS[0][0] : null, idx = 0, sp = 0.5, cur = null, loaded = null, paused = false;
  const K = (k) => KINDS.find((x) => x[0] === k);
  function loadSeed(seed, lab) {
    const key = seed + (lab ? 'L' : ''); if (loaded === key) return;
       // 版1016：ポストに当たって入る場面を作る（確認画面だけ）   // 版946：確認画面だけの新しい止め方（近い距離のシュートを、飛ばずに足・体で止める）
    document.querySelector('#level').value = 's'; const op = document.querySelector('#opponent'); if (op) op.value = 'バランス型';
    document.getElementById('seed').value = String(seed);
    D.start(); D.stop(); loaded = key;
  }
  const win = () => { const k = K(kind); return [cur.t + k[2], cur.t + k[3]]; };
  function go() {
    const L = SC[kind] || []; if (!L.length) return;
    idx = (idx + L.length) % L.length; cur = L[idx];
    loadSeed(cur.seed, cur.lab); 
    const [a] = win(); D.seek(Math.max(0.2, a)); D.setSpeed(sp); if (!paused) D.play(); info();
    const c0 = cur; setTimeout(() => { if (cur === c0) { D.seek(Math.max(0.2, a)); D.setSpeed(sp); } }, 200);
  }
  function tick() {
    if (!cur) return;
    const [a, b] = win(), t = D.time();
    if (!paused && (t > b || t < a - 1)) { D.seek(Math.max(0.2, a)); D.setSpeed(sp); if (!D.playing) D.play(); }
    
  }
  const css = document.createElement('style');
  css.textContent = `#clubScreen,.std-wrap{display:none!important}#gl{position:fixed;left:6px;bottom:6px;z-index:50;background:rgba(10,24,16,.78);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;padding:4px 6px;font:12px/1.4 system-ui,sans-serif;max-width:min(520px,calc(100vw - 12px));box-sizing:border-box}
  #gl b{color:#ffe05a}#gl select,#gl button{font:12px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:4px 7px;margin:1px}#gl select{max-width:170px}
  #gl button.on{background:#3d7a4f;border-color:#9fe0b0}#gl .row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 4px}#gl .msg{color:#bcd3c2;margin-top:3px}#gl .what{color:#fff;margin-top:3px}#gl #glMore{display:none}#gl.open #glMore{display:block}#gl #glC{color:#bcd3c2;white-space:nowrap}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'gl';   // 版1014：確認画面の操作は小さく、画面の下にまとめる（選手の動きが見えるように）。説明・コマ送りは「…」で開く
  box.innerHTML = `<div class="row"><select id="glK">${KINDS.map(([k, n]) => `<option value="${k}">${n}（${SC[k].length}）</option>`).join('')}</select>
    <button id="glP">◀</button><span id="glC"></span><button id="glN">▶</button><button id="glS">1/2倍</button><button id="glStop">一時停止</button><button id="glT">…</button></div>
    <div id="glMore"><div class="row">速さ <button data-s="1">1倍</button><button data-s="0.5" class="on">1/2</button><button data-s="0.25">1/4</button><button data-s="0.1">1/10</button>
    <button id="glB">◀ コマ戻し</button><button id="glF">コマ送り ▶</button><button id="glZ">近くで見る</button></div>
    <div class="what" id="glW"></div><div class="msg" style="opacity:.7">版 ${window.__appVer || '?'}</div><div class="msg" id="glM"></div></div>`;
  document.body.appendChild(box);
  function info() {
    const L = SC[kind] || [], k = K(kind); if (!L.length) return;
    document.getElementById('glW').textContent = '見るところ：' + k[4];
    const c = L[(idx + L.length) % L.length], m = Math.floor(c.t * ((D.match && D.match.clockScale) || 12) / 60);
    document.getElementById('glC').textContent = `${(idx % L.length + L.length) % L.length + 1}/${L.length}`;
    document.getElementById('glM').textContent = `${idx + 1} / ${L.length} 場面目：試合番号${c.seed}・${m}分ごろ${c.sp != null ? `（${c.bar ? 'バー' : 'ポスト'}・秒速${c.sp}m・音${Math.round((0.4 + 1.8 * Math.max(0, Math.min(1, (c.sp - 10) / 20))) * 100)}%）` : ''}`;
  }
  const setPaused = (v) => { paused = v; document.getElementById('glStop').textContent = v ? '再生' : '一時停止'; if (v) D.setSpeed(0.0001); else { D.setSpeed(sp); D.play(); } };
  const step = (d) => { setPaused(true); D.seek(Math.max(0.2, D.time() + d)); D.setSpeed(0.0001); D.play(); };
  document.getElementById('glT').onclick = () => box.classList.toggle('open');
  { const SP = [1, 0.5, 0.25, 0.1], lab = (v) => (v === 1 ? '1倍' : v === 0.5 ? '1/2倍' : v === 0.25 ? '1/4倍' : '1/10倍');
    document.getElementById('glS').onclick = () => { const nx = SP[(SP.indexOf(sp) + 1) % SP.length]; const bt = box.querySelector(`[data-s="${nx}"]`); if (bt) bt.click(); };
    const syncS = () => { document.getElementById('glS').textContent = lab(sp); }; box.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => setTimeout(syncS, 0))); }
  document.getElementById('glK').onchange = (e) => { kind = e.target.value; idx = 0; go(); };
  document.getElementById('glP').onclick = () => { idx--; go(); };
  document.getElementById('glN').onclick = () => { idx++; go(); };
  document.getElementById('glStop').onclick = () => setPaused(!paused);
  document.getElementById('glB').onclick = () => step(-0.05);
  document.getElementById('glF').onclick = () => step(0.05);
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sp = +b.dataset.s; box.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); if (paused) setPaused(false); else D.setSpeed(sp); });
  document.getElementById('glZ').onclick = () => { const z = document.querySelector('[data-zoom="near"]'); if (z) z.click(); };
  setTimeout(() => { if (kind) go(); setInterval(tick, 50); const z = document.querySelector('[data-zoom="near"]'); if (z) z.click(); }, 300);
})();
