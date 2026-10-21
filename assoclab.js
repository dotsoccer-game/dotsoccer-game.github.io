// サッカー協会の確認：育成モードを途中（8月ごろ）まで進めたデータで、サッカー協会の画面を開く
(() => {
  const box = document.createElement('div'); box.id = 'asl';
  box.innerHTML = `<b>サッカー協会の確認</b><span>（版 ${window.__appVer || '?'}）</span><button data-t="sched">試合日程</button><button data-t="stats">成績</button><button data-t="post">試合後の順位表</button><button data-t="mgr">監督成績</button>`;
  const css = document.createElement('style');
  css.textContent = `#asl{position:fixed;right:6px;bottom:6px;z-index:70;background:rgba(10,24,16,.9);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:8px;padding:6px 10px;font:12px/1.5 system-ui,sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 16px)}#asl b{color:#ffe05a}#asl button{font:12px system-ui;padding:4px 8px;box-shadow:none;border-radius:6px}`;
  document.head.appendChild(css);
  function prep() {
    const C = window.DotCareer, K = window.__career, save = K.save;
    if (save.week < 20) {
      let s = 7;
      const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      for (let i = 0; i < 40 && save.week < 22; i++) {
        const fx = C.nextFixture(save);
        if (fx && fx.week <= save.week) {
          const sc = [Math.floor(r() * 4), Math.floor(r() * 3)], ps = save.team.players, ev = [];
          for (let g = 0; g < sc[0]; g++) ev.push({ type: 'goal', team: 0, player: ps[8 + Math.floor(r() * 3)].name, assist: r() < 0.7 ? ps[5 + Math.floor(r() * 3)].name : null });
          C.playFixture(save, fx, sc, ps.slice(0, 11).map((_, k) => k)); C.recordGoals(save, fx, ev);
        }
        C.endWeek(save);
      }
    }
  }
  function start() {
    try { window.__career.open(); const cs = document.getElementById('clubScreen'); if (cs) cs.hidden = true; } catch (e) { }
    setTimeout(() => {
      prep();
      const K = window.__career;
      box.querySelectorAll('button').forEach((b) => b.onclick = () => {
        const t = b.dataset.t, el = document.getElementById('assocScreen'); if (el) el.hidden = true;
        if (t === 'post') K.openAssoc({ tab: 'stats', sub: { kind: 'table', id: K.save.league.id }, direct: true, onClose: () => {} });
        else K.openAssoc({ tab: t });
      });
      K.openAssoc({ tab: 'sched' });
      document.body.appendChild(box);
    }, 1400);
  }
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
