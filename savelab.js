// 版863：GKのセーブ確認：本物の試合（オールS同士）の中から、セーブの場面だけを種類ごとにくり返し再生する
(() => {
  const D = window.__demo; if (!D) return;
  window.__noShow = true;
  const SC = window.__SAVE_SCENES || {};
  const KINDS = [
    ['new_block', '【試作】近いシュートを体で止める', -3.2, 2.0, '試作（本番にはまだ入っていません）：PKラインより内側からのシュートに、GKが横に飛ばず、前に構えて体を大きく広げて当てて止める'],
    ['new_footsave', '【試作】近いシュートを足で止める', -3.2, 2.0, '試作（本番にはまだ入っていません）：PKラインより内側からの低いシュートに、GKが横に飛ばず、片足を伸ばして止める'],
    ['tipover', '指先でバーの上へ・柱の外へ', -1.4, 2.6, 'ゴールに近い高い球を、跳び上がって指先で外へ。バーの上（ゴールの裏へ落ちて転がる）と、柱の外（横）の2通り。どちらもコーナーキック'],
    ['ready', 'シュート前の構え', -2.6, -0.1, '相手がシュートを打てる所でボールを持っている間、GKは腰を落として、ボールに向いて構える（シュートの直前まで）'],
    ['footsave', '足を伸ばして止める', -1.4, 1.6, '至近距離のグラウンダーに、ボールに正対したまま片足を伸ばして止める'],

    ['diveparry', '横っ跳びではじく', -1.4, 1.8, 'キャッチの届かない所にも、指先・手のひらなら届く。相手のいない外へ逃がす'],
    ['divecatch', '横っ跳びでキャッチ', -1.4, 1.6, '届く所に飛んで、しっかり抱える'],
    ['parry', '横へはじく', -1.4, 1.8, '強い球・近い球は、キャッチせずに横へはじく'],
    ['punch', 'パンチング', -1.4, 1.8, '高い球・混み合った所は、こぶしで遠くへはじく（キャッチより少し高い所まで届く）'],
    ['claim', 'ハイボールをキャッチ', -1.6, 1.4, 'クロス・放り込みに出て、いちばん高い所でキャッチ'],
    ['catch', '正面でキャッチ', -1.4, 1.4, '体の正面に来た球を、そのままキャッチ'],
    ['fumble', 'こぼす', -1.4, 1.8, '無回転などで、止めきれずにこぼす'],
    ['smother', '足もとへ飛び込む', -1.6, 1.6, '抜け出した相手の足もとへ飛び込んで押さえる'],
    ['sweep', '飛び出してクリア', -1.8, 1.6, '裏へのボールに、ペナルティエリアの外まで出て足でクリア'],
    ['tip', '指先で触ったが入った', -1.4, 1.8, '手は届いたが、止めきれずにゴールへ'],
    ['save', 'そのほかのセーブ', -1.4, 1.6, 'シュートをGKが止めた場面'],
  ].filter(([k]) => (SC[k] || []).length);
  let kind = KINDS[0] ? KINDS[0][0] : null, idx = 0, sp = 0.5, cur = null, loaded = null, paused = false;
  const K = (k) => KINDS.find((x) => x[0] === k);
  function loadSeed(seed, lab) {
    const key = seed + (lab ? 'L' : ''); if (loaded === key) return;
    globalThis.__Kgkft = lab ? 1 : undefined;   // 版946：確認画面だけの新しい止め方（近い距離のシュートを、飛ばずに足・体で止める）
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
  css.textContent = `#clubScreen,.std-wrap{display:none!important}#gl{position:fixed;left:8px;top:58px;z-index:50;background:rgba(10,24,16,.92);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;padding:8px 10px;font:13px/1.45 system-ui,sans-serif;max-width:min(560px,calc(100vw - 16px));box-sizing:border-box}
  #gl b{color:#ffe05a}#gl select,#gl button{font:13px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:5px 8px;margin:2px}
  #gl button.on{background:#3d7a4f;border-color:#9fe0b0}#gl .row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px}#gl .msg{color:#bcd3c2;margin-top:4px}#gl .what{color:#fff;margin-top:2px}#gl.mini>:not(:first-child){display:none}#gl.mini #glP,#gl.mini #glN{display:none}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'gl';
  box.innerHTML = `<div class="row"><b id="glT" style="cursor:pointer">GKのセーブの確認 ▾</b><select id="glK">${KINDS.map(([k, n]) => `<option value="${k}">${n}（${SC[k].length}）</option>`).join('')}</select>
    <button id="glP">◀ 前の場面</button><button id="glN">次の場面 ▶</button></div>
    <div class="row">速さ <button data-s="1">1倍</button><button data-s="0.5" class="on">1/2</button><button data-s="0.25">1/4</button><button data-s="0.1">1/10</button>
    <button id="glStop">一時停止</button><button id="glB">◀ コマ戻し</button><button id="glF">コマ送り ▶</button><button id="glZ">近くで見る</button></div>
    <div class="what" id="glW"></div><div class="msg" style="opacity:.7">版 ${window.__appVer || '?'}</div><div class="msg" id="glM"></div>`;
  document.body.appendChild(box);
  function info() {
    const L = SC[kind] || [], k = K(kind); if (!L.length) return;
    document.getElementById('glW').textContent = '見るところ：' + k[4];
    const c = L[(idx + L.length) % L.length], m = Math.floor(c.t * ((D.match && D.match.clockScale) || 12) / 60);
    document.getElementById('glM').textContent = `${idx + 1} / ${L.length} 場面目：試合番号${c.seed}・${m}分ごろ`;
  }
  const setPaused = (v) => { paused = v; document.getElementById('glStop').textContent = v ? '再生' : '一時停止'; if (v) D.setSpeed(0.0001); else { D.setSpeed(sp); D.play(); } };
  const step = (d) => { setPaused(true); D.seek(Math.max(0.2, D.time() + d)); D.setSpeed(0.0001); D.play(); };
  document.getElementById('glT').onclick = () => { box.classList.toggle('mini'); document.getElementById('glT').textContent = 'GKのセーブの確認 ' + (box.classList.contains('mini') ? '▸' : '▾'); };
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
