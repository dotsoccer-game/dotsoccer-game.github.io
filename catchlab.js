// 版1041：キャッチの絵の確認画面：正面に来たボールを、GKが両腕を前に伸ばして両手でキャッチする絵（GKの姿勢15）を、くり返し・ゆっくり・止めて・いろいろな角度から見る
//  （PK戦で全部「正面でキャッチ」になるように決めた試合を使う。両チームのGKが交互にキャッチする）
(() => {
  const A = window.__app, C = window.DotCareer; if (!A || !C) return;
  const css = document.createElement('style');
  css.textContent = `#clubScreen,.std-wrap{display:none!important}#ckl{position:fixed;left:50%;transform:translateX(-50%);top:4px;z-index:60;background:rgba(10,24,16,.85);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;padding:5px 8px;font:12px/1.4 system-ui,sans-serif;max-width:min(640px,calc(100vw - 12px));text-align:center}#ckl button{font:12px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:4px 8px;margin:1px}#ckl button.on{background:#2f9a4a;border-color:#7fd492}#ckl .msg{color:#bcd3c2;margin-top:3px}#ckl.min>div:not(.tg){display:none}#match aside{display:none!important}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'ckl';
  box.innerHTML = `<div class="tg"><button id="ckT">たたむ ▲</button></div>
    <div><button id="ckP">◀ 前のキャッチ</button><button id="ckR">↺ もう一度</button><button id="ckN">次のキャッチ ▶</button></div>
    <div>速さ：<button data-s="1" class="on">ふつう</button><button data-s="0.25">ゆっくり（4分の1）</button><button data-s="0.1">とてもゆっくり</button>　<button id="ckF">キャッチの瞬間で止める</button></div>
    <div>カメラ：<button data-c="game" class="on">試合の目線</button><button data-c="behind">ゴールの裏から</button><button data-c="side">横から</button><button data-c="front">正面からアップ</button></div>
    <div class="msg" id="ckM">準備しています…</div><div class="msg" style="opacity:.7">版 ${window.__appVer || '?'}</div>`;
  document.body.appendChild(box);
  const msg = (t) => { document.getElementById('ckM').textContent = t; };
  document.getElementById('ckT').onclick = () => { box.classList.toggle('min'); document.getElementById('ckT').textContent = box.classList.contains('min') ? 'キャッチの確認 ▼' : 'たたむ ▲'; };
  const save = C.newCareer('X'), names = save.world.leagues.d2.map((t) => t.name), sd = 618;
  const teams = () => [C.opponentTeam(save, { name: names[sd % names.length] }), C.opponentTeam(save, { name: names[(sd * 3 + 1) % names.length] })];
  // カメラ：試合の目線はふだんどおり。ほかは PK戦用の固定カメラ（向き・見る所・近さ・見下ろす角度）
  const CAMS = { game: null, behind: { __soYaw: -Math.PI / 2, __soFx: 15, __soZ: 0.56, __soP: 0.75 }, side: { __soYaw: 0, __soFx: 1.5, __soZ: 2.6, __soP: 0.4 }, front: { __soYaw: Math.PI / 2, __soFx: 2.5, __soZ: 3.2, __soP: 0.3 } };
  const setCam = (k) => { const c = CAMS[k]; window.__soBehind = !!c; for (const key of ['__soYaw', '__soFx', '__soZ', '__soP']) { if (c) window[key] = c[key]; else delete window[key]; } };
  let kicks = [], ci = 0, rate = 1, freeze = false, raf = 0;
  const sel = (attr, v) => box.querySelectorAll(`[${attr}]`).forEach((b) => b.classList.toggle('on', b.getAttribute(attr) === String(v)));
  function show(i) {
    cancelAnimationFrame(raf); const m = A.match; if (!m || !kicks.length) return;
    ci = (i + kicks.length) % kicks.length; const k = kicks[ci], t0 = k.t0 - 1.4, tEnd = freeze ? k.t + 0.3 : k.t + 2.2;
    const gk = m.shootout && m.shootout.rec && m.shootout.rec[1 - k.team] && m.shootout.rec[1 - k.team].find((r) => r.gk);
    msg(`${ci + 1}本目（全${kicks.length}本）：${k.team ? 'ホーム' : 'アウェイ'}のGK${gk ? `（${gk.number} ${gk.name}）` : ''}が正面でキャッチ`);
    A.labPeek(t0, true);   // カメラはその場所へすぐ合わせる
    if (rate === 1 && !freeze) { A.labPlay(); return; }
    let t = t0, last = performance.now();
    const step = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt * rate; if (t >= tEnd) { A.labPeek(tEnd); if (!freeze && rate !== 1) msg(document.getElementById('ckM').textContent); return; } A.labPeek(t); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  document.getElementById('ckN').onclick = () => show(ci + 1);
  document.getElementById('ckP').onclick = () => show(ci - 1);
  document.getElementById('ckR').onclick = () => show(ci);
  document.getElementById('ckF').onclick = (e) => { freeze = !freeze; e.target.classList.toggle('on', freeze); show(ci); };
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { rate = +b.dataset.s; sel('data-s', b.dataset.s); show(ci); });
  box.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { setCam(b.dataset.c); sel('data-c', b.dataset.c); show(ci); });
  setTimeout(() => {
    const t = document.getElementById('ttTitle'); if (t) t.remove();
    const [a, b] = teams();
    A.startWith(a, b, sd, 'ホーム', 'アウェイ', () => {}, { noIntro: true, shootout: true, soForce: [...Array(10).fill('catch'), 'goal', 'catch'] });
    setTimeout(() => { const m = A.match; if (!m || !m.shootout) { msg('PK戦になる試合を作れませんでした'); return; }
      const k0 = m.events.filter((e) => e.type === 'sokick0'); kicks = m.events.filter((e) => e.type === 'sokick').map((e, i) => ({ t: e.t, t0: (k0[i] || e).t, team: e.team }));
      show(0); }, 400);
  }, 600);
})();
