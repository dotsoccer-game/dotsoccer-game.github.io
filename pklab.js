// 版1030：PK戦の確認画面：90分で同点になった本物の試合を探して、試合終了の笛の少し前から、蹴る順番を決める画面 → PK戦の勝ち負けが決まるまでを流す
(() => {
  const A = window.__app, C = window.DotCareer, D = window.DotSoccer; if (!A || !C || !D) return;
  const css = document.createElement('style');
  css.textContent = `#clubScreen,.std-wrap{display:none!important}#pkl{position:fixed;left:6px;bottom:6px;z-index:60;background:rgba(10,24,16,.82);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;padding:5px 7px;font:12px/1.4 system-ui,sans-serif;max-width:min(560px,calc(100vw - 12px))}#pkl button{font:12px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:4px 8px;margin:1px}#pkl .msg{color:#bcd3c2;margin-top:3px}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'pkl';
  box.innerHTML = `<div><button id="pkN">次の試合 ▶</button><button id="pkR">もう一度（終了の笛から）</button><button id="pkS">PK戦の途中から</button></div><div class="msg" id="pkM">同点の試合をさがしています…</div><div class="msg" style="opacity:.7">版 ${window.__appVer || '?'}</div>`;
  document.body.appendChild(box);
  setInterval(() => { const sp = document.getElementById('soPick'); box.style.display = sp && !sp.hidden ? 'none' : ''; }, 200);   // 順番を決める画面の間は、操作パネルを隠す
  const msg = (t) => { document.getElementById('pkM').textContent = t; };
  const save = C.newCareer('X'), names = save.world.leagues.d2.map((t) => t.name);
  let seed = 600, cur = null;
  const teams = (sd) => [C.opponentTeam(save, { name: names[sd % names.length] }), C.opponentTeam(save, { name: names[(sd * 3 + 1) % names.length] })];
  function findDraw(from) { for (let sd = from; sd < from + 60; sd++) { const [a, b] = teams(sd); const r = D.simulateMatch(a, b, sd, { frames: false }); if (r.score[0] === r.score[1]) return sd; } return from; }
  function start(sd, mid) {
    const [a, b] = teams(sd); cur = sd;
    A.startWith(a, b, sd, 'ホーム', 'アウェイ', () => msg('試合が終わりました。「次の試合」「もう一度」で、ほかの場面も見られます'), { noIntro: true, shootout: true, soPick: true });
    setTimeout(() => { const m = A.match; if (!m || !m.shootout) { msg('この試合はPK戦になりませんでした（次の試合へ）'); return; }
      A.catchUp(mid ? m.regEnd + 12 : m.regEnd - 4, true);
      msg(`試合番号${sd}：${m.score[0]}−${m.score[1]}の同点 → PK戦（${m.shootout.score[0]}−${m.shootout.score[1]}・${m.shootout.kicks.length}本。蹴る順番を変えると結果も変わります）`); }, 400);
  }
  document.getElementById('pkN').onclick = () => { msg('同点の試合をさがしています…'); setTimeout(() => { seed = findDraw(cur + 1); start(seed); }, 30); };
  document.getElementById('pkR').onclick = () => start(cur);
  document.getElementById('pkS').onclick = () => start(cur, true);
  setTimeout(() => { const t = document.getElementById('ttTitle'); if (t) t.remove(); seed = findDraw(seed); start(seed); }, 600);
})();
