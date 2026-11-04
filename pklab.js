// 版1030：PK戦の確認画面：90分で同点になった本物の試合を探して、試合終了の笛の少し前から、蹴る順番を決める画面 → PK戦の勝ち負けが決まるまでを流す
(() => {
  const A = window.__app, C = window.DotCareer, D = window.DotSoccer; if (!A || !C || !D) return;
  const css = document.createElement('style');
  css.textContent = `#clubScreen,.std-wrap{display:none!important}#pkl{position:fixed;left:50%;transform:translateX(-50%);top:4px;z-index:60;background:rgba(10,24,16,.82);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;padding:5px 7px;font:12px/1.4 system-ui,sans-serif;max-width:min(560px,calc(100vw - 12px))}#pkl button{font:12px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:4px 8px;margin:1px}#pkl .msg{color:#bcd3c2;margin-top:3px}#pkl.min>div:not(.tg){display:none}#pkl .tg{text-align:center}#pkl{text-align:center}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'pkl';
  box.innerHTML = `<div class="tg"><button id="pkT">確認画面のボタン ▼</button></div><div><button id="pkN">次の試合 ▶</button><button id="pkR">もう一度（終了の笛から）</button><button id="pkS">PK戦の途中から</button></div><div>場面を指定して見る：<button data-f="missWide">外した（枠の横）</button><button data-f="missHigh">外した（バーの上）</button><button data-f="save">GKが横っ飛びで止めた</button><button data-f="catch">GKが正面でキャッチ</button><button data-f="goalRead">読まれたが決めた</button><button data-f="gk">GKが蹴って決めた</button><button data-f="post">ポストに当たって外れる</button><button data-f="bar">バーに当たって外れる</button><button data-f="postIn">ポストに当たって入る</button><button data-f="barIn">バーに当たって入る</button></div><div class="msg" id="pkM">準備しています…</div><div class="msg" style="opacity:.7">版 ${window.__appVer || '?'}</div>`;
  document.body.appendChild(box);
  // 版1032：iPhoneでは、ボタンがPK戦のボードとゴールに重なっていた → 上の真ん中に、たたんで置く（タップで開く）
  const tg = () => { box.classList.toggle('min'); document.getElementById('pkT').textContent = box.classList.contains('min') ? '確認画面のボタン ▼' : 'たたむ ▲'; };
  document.getElementById('pkT').onclick = tg; box.classList.add('min');
  setInterval(() => { const sp = document.getElementById('soPick'); box.style.display = sp && !sp.hidden ? 'none' : ''; }, 200);   // 順番を決める画面の間は、操作パネルを隠す
  const msg = (t) => { document.getElementById('pkM').textContent = t; };
  const save = C.newCareer('X'), names = save.world.leagues.d2.map((t) => t.name);
  // 版1032：同点の試合を、その場で何十試合も計算して探すと、iPhoneでは長い間固まって「反応しない」ように見えた。前もって調べた同点の試合番号を使う
  const SEEDS = [618, 620, 621, 623, 627, 629, 644, 648, 651, 654, 658, 660, 663, 665, 668, 669];
  let si = 0, cur = SEEDS[0];
  const teams = (sd) => [C.opponentTeam(save, { name: names[sd % names.length] }), C.opponentTeam(save, { name: names[(sd * 3 + 1) % names.length] })];
  function start(sd, mid) {
    cur = sd; msg('試合を準備しています…（数秒かかります）');
    setTimeout(() => {
      const [a, b] = teams(sd);
      A.startWith(a, b, sd, 'ホーム', 'アウェイ', () => msg('試合が終わりました。「次の試合」「もう一度」で、ほかの場面も見られます'), { noIntro: true, shootout: true, soPick: true });
      setTimeout(() => { const m = A.match; if (!m || !m.shootout) { msg('この試合はPK戦になりませんでした（次の試合へ）'); return; }
        A.catchUp(mid ? m.regEnd + 12 : m.regEnd - 4, true);
        msg(`試合${si + 1}／${SEEDS.length}：${m.score[0]}−${m.score[1]}の同点 → まもなく試合終了の笛 → 蹴る順番を決める画面`); }, 400);
    }, 60);
  }
  // 版1038：場面を指定して見る（その結果になるように決めて、PK戦の1本目の少し前から流す）
  const NAMES = { missWide: '外した（枠の横）', missHigh: '外した（バーの上）', save: 'GKが横っ飛びで止めた', catch: 'GKが正面でキャッチ', goalRead: '読まれたが決めた', gk: 'GKが蹴って決めた', post: 'ポストに当たって外れる', bar: 'バーに当たって外れる', postIn: 'ポストに当たって入る', barIn: 'バーに当たって入る' };
  box.querySelectorAll('[data-f]').forEach((bt) => bt.onclick = () => { tg(); const f = bt.dataset.f, sd = cur; msg('準備しています…（数秒かかります）');
    setTimeout(() => { const [a, b] = teams(sd);
      const o = f === 'gk' ? { soGkFirst: true, soForce: ['goal', 'goal', 'goal', 'goal'] } : { soForce: Array(12).fill(f) };
      A.startWith(a, b, sd, 'ホーム', 'アウェイ', () => msg('試合が終わりました。'), { noIntro: true, shootout: true, ...o });
      setTimeout(() => { const m = A.match; if (!m || !m.shootout) { msg('この試合はPK戦になりませんでした'); return; }
        const w = m.events.find((e) => e.type === 'sowhistle'); A.catchUp((w ? w.t : m.regEnd + 12) - 5, true);
        msg(`場面：${NAMES[f]}（この場面の結果になるように決めています。くり返し見るときは、もう一度ボタンを押してください）`); }, 400); }, 60); });
  document.getElementById('pkN').onclick = () => { tg(); si = (si + 1) % SEEDS.length; start(SEEDS[si]); };
  document.getElementById('pkR').onclick = () => { tg(); start(cur); };
  document.getElementById('pkS').onclick = () => { tg(); start(cur, true); };
  setTimeout(() => { const t = document.getElementById('ttTitle'); if (t) t.remove(); start(cur); }, 600);
})();
