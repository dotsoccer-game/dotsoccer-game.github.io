// 試合で確認：本物の試合（オールS同士）を回して、選んだ技・動きが出た場面だけをくり返し再生する
(() => {
  const D = window.__demo; if (!D) return;
  window.__noShow = true;   // ゴールの演出・判定のリプレイ・ハーフタイムは出さない
  const KINDS = [
    ['controlShot', 'コントロールショット', 'shot'], ['powerMid', '強烈ミドル', 'shot'], ['nearPost', 'ニア上ぶち抜き', 'shot'], ['knuckle', '無回転シュート', 'ev'],
    ['driveShot', 'ドライブシュート', 'shot'], ['dshot', 'ドリブルシュート（標準）', 'raw'], ['volley', 'ボレー', 'shot'], ['bicycle', 'バイシクル', 'act'], ['divingHeader', 'ダイビングヘッド', 'act'],
    ['lob', 'ループ', 'ev'], ['toeKick', 'トゥーキック', 'shot'],
    ['scissors', 'シザース', 'dmove'], ['doubleTouch', 'ダブルタッチ', 'dmove'], ['bodyFeint', 'ボディフェイント', 'dmove'], ['kickFeint', 'キックフェイント', 'dmove'], ['nutmeg', '股抜き', 'dmove'], ['cutIn', 'カットイン', 'dmove'],
    ['lose', 'よろける', 'raw'], ['fall', '倒れる・起き上がる', 'raw'], ['trap', 'トラップ', 'raw'], ['chest', '胸トラップ', 'raw'], ['slide', 'スライディング', 'raw'],
  ];
  const SEEDS = [11, 23, 37, 41, 59, 63, 77, 89, 97, 101, 113, 127];
  const found = {}; for (const [k] of KINDS) found[k] = [];
  const scanned = new Set();
  let kind = 'controlShot', idx = 0, sp = 0.5, cur = null, loaded = null, timer = 0;
  const idxOf = (M, team, number) => { const r = M.roster[team]; const k = r ? r.findIndex((p) => p.number === number) : -1; return k < 0 ? -1 : team * 11 + k; };
  function loadSeed(seed) {
    if (loaded === seed) return D.match;
    document.querySelector('#level').value = 's'; document.getElementById('seed').value = String(seed);
    D.start(); D.stop(); loaded = seed; return D.match;
  }
  function scan(seed) {
    if (scanned.has(seed)) return; scanned.add(seed);
    const M = loadSeed(seed), A = M.actions;
    const kfAfter = (i, t, win) => { const a = A.find((x) => x.a === 'kf' && x.i === i && x.t >= t - 0.05 && x.t <= t + win); return a ? a.t : null; };
    for (const [k, , how] of KINDS) {
      if (how === 'shot' || how === 'act') {
        for (const a of A) if (a.a === 'skill' && a.k === k) {
          let t = a.t;
          if (how === 'shot') { const kt = kfAfter(a.i, a.t, k === 'powerMid' || k === 'nearPost' ? 2.6 : 0.4); if (kt == null || !M.events.some((e) => e.type === 'shot' && Math.abs(e.t - kt) < 0.25)) continue; t = kt; }   // 本当にシュートを打った場面だけ
          found[k].push({ seed, t, i: a.i });
        }
      } else if (how === 'ev') {
        for (const e of M.events) if (e.type === 'shot' && (k === 'lob' ? e.chip : e.knuckle)) { const i = idxOf(M, e.team, e.number); if (i >= 0) found[k].push({ seed, t: e.t, i }); }
      } else if (how === 'dmove') {
        for (const a of A) if (a.a === 'dmove' && a.k === k && !a.fail) found[k].push({ seed, t: a.t, i: a.i });
      } else {
        for (const a of A) if ((k === 'trap' ? a.a === 'poke' && a.trap : a.a === k)) { const L = found[k]; if (!L.length || L[L.length - 1].seed !== seed || a.t - L[L.length - 1].t > 6) L.push({ seed, t: a.t, i: a.i }); }
      }
    }
  }
  function ensure(k) { for (const s of SEEDS) { if (found[k].length >= 6) break; scan(s); } }
  function go() {
    const L = found[kind]; info(); if (!L.length) return;
    idx = (idx + L.length) % L.length; cur = L[idx];
    loadSeed(cur.seed); D.select(cur.i); D.seek(Math.max(0.2, cur.t - 2.2)); D.setSpeed(sp); D.play(); info();
    const c0 = cur; setTimeout(() => { if (cur === c0) { D.seek(Math.max(0.2, cur.t - 2.2)); D.setSpeed(sp); } }, 200);   // 試合の読み込み直後に時刻が戻ることがあるので、もう一度合わせる
  }
  function tick() { if (cur && (D.time() > cur.t + 2.6 || D.time() < cur.t - 3.5)) { D.seek(Math.max(0.2, cur.t - 2.2)); D.setSpeed(sp); if (!D.playing) D.play(); } }
  // ---- 操作パネル ----
  const css = document.createElement('style');
  css.textContent = `#rp{position:fixed;left:8px;top:58px;z-index:50;background:rgba(10,24,16,.92);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;padding:8px 10px;font:13px/1.4 system-ui,sans-serif;max-width:min(560px,calc(100vw - 16px));box-sizing:border-box}
  #rp b{color:#ffe05a}#rp select,#rp button{font:13px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:5px 8px;margin:2px}
  #rp button.on{background:#3d7a4f;border-color:#9fe0b0}#rp .row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px}#rp .msg{color:#bcd3c2;margin-top:4px}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'rp';
  box.innerHTML = `<div class="row"><b>試合で確認</b><select id="rpK">${KINDS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
    <button id="rpP">◀ 前の場面</button><button id="rpN">次の場面 ▶</button></div>
    <div class="row">速さ <button data-s="1">1倍</button><button data-s="0.5" class="on">1/2</button><button data-s="0.25">1/4</button><button id="rpZ">近くで見る</button></div>
    <div class="msg" style="opacity:.7">版 ${window.__appVer || '?'}</div>
    <div class="msg" id="rpM">試合を回して場面を探しています…</div>`;
  document.body.appendChild(box);
  const msg = (t) => { document.getElementById('rpM').textContent = t; };
  function info() { const L = found[kind]; if (!L.length) { msg('この試合では、まだ見つかっていません（12試合ぶん探しました）'); return; } const c = L[(idx + L.length) % L.length], m = Math.floor(c.t * (D.match.clockScale || 12) / 60);
    msg(`${idx + 1} / ${L.length} 場面目：試合${SEEDS.indexOf(c.seed) + 1}・${m}分ごろ・黄色い輪の選手（同じ場面を前後2秒、くり返し再生）`); }
  document.getElementById('rpK').onchange = (e) => { kind = e.target.value; idx = 0; msg('試合を回して場面を探しています…'); setTimeout(() => { ensure(kind); go(); }, 30); };
  document.getElementById('rpP').onclick = () => { idx--; go(); };
  document.getElementById('rpN').onclick = () => { idx++; go(); };
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sp = +b.dataset.s; box.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); D.setSpeed(sp); });
  document.getElementById('rpZ').onclick = () => { const z = document.querySelector('[data-zoom="near"]'); if (z) z.click(); };
  setTimeout(() => { ensure(kind); go(); timer = setInterval(tick, 50); }, 300);
})();
