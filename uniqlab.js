// 固有スキルの確認：国内屈指18人の固有スキルを、本物の試合で見る（発動した場面へジャンプ。シュート技と重なった場面も探せる）
// ＋ 固有スキル・サポートパッシブの効き目を、試合を何回も回して数字で比べる
(() => {
  const D = window.DotSoccer, C = window.DotCareer, A = window.__app, M = window.__demo;
  if (!D || !C || !A || !M || !D.UNIQ) return;
  const U = D.UNIQ, PAS = D.PASSIVE;
  // 最初の持ち主（国内屈指）のチーム
  const OWN = {};
  for (const id in C.ROSTERS) for (const q of C.ROSTERS[id].players) if (q.top && D.UNIQ_BY_TOP[q.top]) OWN[D.UNIQ_BY_TOP[q.top]] = { id, q };
  const TOPS = new Set(Object.values(OWN).map((o) => o.id));
  const OPPS = ['okayama', 'kanazawa', 'niigata', 'kumamoto', 'matsuyama', 'kofu'].filter((id) => C.ROSTERS[id] && !TOPS.has(id));
  const tname = (id) => (C.TEAM_BY_ID[id] || {}).name || id;
  let key = 'guren', lv2 = false, opp = OPPS[0], cur = null, pasType = 'ストライカー', combo = '';
  // 紅蓮の牙などと一緒に出るシュート技（選ぶと、その選手のスキルをその技だけにして、重なった場面を探す）
  const COMBO = [['', 'なし（ふつうに見る）'], ['controlShot', 'コントロールショット'], ['powerMid', '強烈ミドル'], ['nearPost', 'ニア上ぶち抜き'], ['knuckle', '無回転シュート'], ['driveShot', 'ドライブシュート'], ['toeKick', 'トゥーキック'], ['lob', 'ループ'], ['superLong', '超ロングシュート'], ['volley', 'ボレー'], ['bicycle', 'バイシクル'], ['divingHeader', 'ダイビングヘッド'], ['header', 'ヘディングシュート'], ['dribbleShot', 'ドリブルシュート（だれでも）']];
  const SHOOTERS = new Set(['guren', 'kage', 'shiden']);

  // チームを作る：uniqOn＝固有スキルを持たせるか、pas＝サポートパッシブを付ける選手（タイプ）
  let matesU = false, oppU = false;   // 味方（同じチームのほかの国内屈指）・相手の固有スキルも出すか
  function team(id, k, on, lv, pasOn, side) {
    const t = C.cpuTeam(id);
    for (const p of t.players) {
      const keep = side === 'own' ? matesU && p.uniq !== k : side === 'opp' ? oppU : false;   // 調べているスキル以外の固有スキル
      if (p.uniq && !keep && (!on || p.uniq !== k)) delete p.uniq;
      if (p.uniq) p.uniqLv = lv ? 2 : 1;
      if (p.uniq && combo && SHOOTERS.has(p.uniq)) p.skills = combo === 'header' ? ['aerial'] : combo === 'dribbleShot' ? [] : [combo];   // 重ねる技だけを持たせる
      if (pasOn && p.type === pasOn.type && !pasOn.done && t.players.indexOf(p) < 11) { p.passive = pasOn.lv; pasOn.done = true; }
    }
    return t;
  }
  const sim = (a, b, seed) => D.simulateMatch(a, b, seed, { frames: false });
  const simA = (a, b, seed) => D.simulateMatch(a, b, seed, { frames: false, acts: true });   // 動作の記録つき（選手の対決で、2人の競り合いを数える）

  // ---- 画面 ----
  const css = document.createElement('style');
  css.textContent = `#ul{position:fixed;left:8px;top:8px;z-index:60;background:rgba(10,18,30,.94);color:#eef3ff;border:1px solid #4a6aa0;border-radius:12px;padding:10px 12px;font:13px/1.5 system-ui,sans-serif;width:min(560px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;box-sizing:border-box}
  #ul h3{margin:0 0 4px;font-size:15px;color:#ffe05a}#ul b{color:#ffe05a}#ul .row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:4px 0}
  #ul select,#ul button{all:unset;box-sizing:border-box;display:inline-block;cursor:pointer;font:13px/1.3 system-ui,sans-serif;background:#1f3150;color:#eef3ff;border:1px solid #5b7fbf;border-radius:7px;padding:6px 9px;width:auto;height:auto;min-width:0;min-height:0;position:static;text-align:center;box-shadow:none}
  #ul select{max-width:100%;text-align:left;padding-right:22px;background:#1f3150 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23cfe0ff'/%3E%3C/svg%3E") no-repeat right 8px center}
  #ul button.on{background:#3d6fc0;border-color:#a9c8ff}#ul button.go{background:#c0392b;border-color:#ff9a8a;font-weight:700}
  #ul .desc{background:rgba(255,255,255,.06);border-radius:8px;padding:6px 8px;margin:4px 0}#ul .desc small{color:#b8c6e6}
  #ul .msg{color:#c6d4f0;margin-top:4px;white-space:pre-wrap}#ul table{border-collapse:collapse;width:100%;margin-top:4px}#ul td,#ul th{border-bottom:1px solid rgba(255,255,255,.12);padding:3px 4px;text-align:right}#ul td:first-child,#ul th:first-child{text-align:left}
  #ul .up{color:#7dff9a;font-weight:700}#ul .dn{color:#ff8f8f;font-weight:700}#ul .tabs button{flex:1}#ul button.mini{position:absolute;right:8px;top:8px;padding:2px 8px;font-size:12px}
  #ul.min{width:auto;max-height:none}#ul.min .body{display:none}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'ul';
  box.innerHTML = `<button class="mini" id="ulMin">たたむ</button><h3>固有スキル・サポートパッシブの確認</h3>
  <div class="body">
   <div class="row tabs"><button data-tab="u" class="on">固有スキル（国内屈指18人）</button><button data-tab="p">サポートパッシブ（19タイプ）</button><button data-tab="c">対策役との相性</button><button data-tab="v">選手の対決</button><button data-tab="d">ドリブル技</button></div>
   <div id="tabU">
    <div class="row"><select id="ulK">${Object.entries(U).map(([k, u]) => `<option value="${k}">${u.name}（${u.who}・${u.type}）</option>`).join('')}</select></div>
    <div class="desc" id="ulD"></div>
    <div class="row">相手 <select id="ulO">${OPPS.map((id) => `<option value="${id}">${tname(id)}</option>`).join('')}</select>
      <button id="ulL" title="凸で強化した時（出やすさ・効果・続く時間が上がる）">凸で強化：なし</button></div>
    <div class="row"><button id="ulTm" title="同じチームのほかの国内屈指の固有スキルも出す">味方の固有スキル：なし</button><button id="ulTo" title="相手チームの国内屈指の固有スキルも出す">相手の固有スキル：なし</button></div>
    <div class="row" id="ulSR">重ねるシュート技 <select id="ulS">${COMBO.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
    <div class="row"><button class="go" id="ulW">試合で見る</button><button id="ulN">数字で比べる（10試合ずつ）</button></div>
    <div class="row" id="ulJ"></div>
   </div>
   <div id="tabC" hidden>
    <div class="desc"><b>攻め</b>と<b>守り（相手の対策役）</b>を選んで、試合で見ます。抜け出し・指揮者が出た場面へジャンプでき、ボタンに「何が起きたか」が出ます。</div>
    <div class="row">攻め <select id="ucA"><option value="tsukikage">月影の抜け出し（にしの・仙台）</option><option value="minato">港の指揮者（おおかわ・神戸）</option><option value="both">ふたり（にしの＋おおかわ・神戸）</option></select></div>
    <div class="row">守り <span id="ucD"></span></div>
    <div class="row"><button id="ucU" title="スイーパーキーパー＝捨て身の守護神、ラインコントローラー＝桜島の号令、優秀なDF＝雅の後始末を持たせる">対策役の固有スキル：なし</button></div>
    <div class="desc" id="ucDesc"></div>
    <div class="row"><button class="go" id="ucW">試合で見る</button></div>
    <div class="row" id="ucJ"></div>
   </div>
   <div id="tabD" hidden>
    <div class="desc">ドリブル技を<b>1つ選んで</b>、試合で見ます。その試合では、ドリブル技を使う場面で<b>いつもその技</b>を使います（ふだんの試合では、持っている選手が向いている場面でだけ使います）。ヒールリフトは、この確認でも<b>サイドの前の方で、目の前の相手の後ろにスペースがある時</b>だけ使います。固有スキルはなし。</div>
    <div class="row">技 <select id="udK"></select></div>
    <div class="row">相手 <select id="udO">${OPPS.map((id) => `<option value="${id}">${tname(id)}</option>`).join('')}</select>
      速さ <button id="udS1" class="on" data-sp="1">ふつう</button><button data-sp="0.5">1/2</button><button data-sp="0.25">1/4</button></div>
    <div class="row"><button class="go" id="udW">試合で見る</button></div>
    <div class="row" id="udJ"></div>
   </div>
   <div id="tabV" hidden>
    <div class="desc">攻めと守りで、<b>チーム</b>と<b>注目する選手</b>を選んで対決させます（控えの選手はスタメンに入れます）。固有スキルは注目する2人だけが持ちます。</div>
    <div class="row">攻め <select id="uvAT"></select> <select id="uvAP"></select></div>
    <div class="row">守り <select id="uvDT"></select> <select id="uvDP"></select></div>
    <div class="row"><button id="uvU" class="on">固有スキル：あり</button><button id="uvAL">攻めの凸：なし</button><button id="uvDL">守りの凸：なし</button></div>
    <div class="row"><button class="go" id="uvW">試合で見る</button><button id="uvN">数字で比べる（20試合）</button></div>
    <div class="row" id="uvJ"></div>
   </div>
   <div id="tabP" hidden>
    <div class="row"><select id="ulP">${Object.entries(PAS).map(([t, v]) => `<option value="${t}">${v.name}（${t}）</option>`).join('')}</select></div>
    <div class="desc" id="ulPD"></div>
    <div class="row"><button class="go" id="ulPN">数字で比べる（12試合ずつ）</button><button id="ulPL" title="押すたびに 付与のみ → 強化 → 強化＋範囲拡大（☆4の3凸）">付与のみ</button></div>
    <div class="msg" style="opacity:.8">サポートパッシブは凸で付く効果です（凸の仕組みはまだないので、ここでだけ付けて試します）。そのタイプの選手がいるチームで、付けた時と付けない時を比べます。</div>
   </div>
   <div class="msg" id="ulM"></div>
   <div class="msg" style="opacity:.6">版 ${window.__appVer || '?'}</div>
  </div>`;
  document.body.appendChild(box);
  const $ = (s) => box.querySelector(s), msg = (t) => { $('#ulM').innerHTML = t; };
  $('#ulMin').onclick = () => { box.classList.toggle('min'); $('#ulMin').textContent = box.classList.contains('min') ? 'ひらく' : 'たたむ'; };
  box.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { box.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); $('#tabU').hidden = b.dataset.tab !== 'u'; $('#tabP').hidden = b.dataset.tab !== 'p'; $('#tabC').hidden = b.dataset.tab !== 'c'; $('#tabV').hidden = b.dataset.tab !== 'v'; $('#tabD').hidden = b.dataset.tab !== 'd'; msg(''); });
  function descU() { const u = U[key], o = OWN[key]; $('#ulD').innerHTML = `<b>${u.name}</b>　${u.who}（${tname(o.id)}・${u.type}・${o.q.no}番）<br><small>発動：</small>${u.when}<br><small>効果：</small>${u.what}`; }
  function descP() { const v = PAS[pasType]; $('#ulPD').innerHTML = `<b>${v.name}</b>（${pasType}）<br><small>効果：</small>${v.what}${v.rad ? `（${v.rad}m以内の味方）` : ''}`; }
  $('#ulK').onchange = (e) => { key = e.target.value; descU(); $('#ulJ').innerHTML = ''; msg(''); $('#ulSR').hidden = !SHOOTERS.has(key); };
  $('#ulS').onchange = (e) => { combo = e.target.value; };
  $('#ulO').onchange = (e) => { opp = e.target.value; };
  $('#ulTm').onclick = () => { matesU = !matesU; $('#ulTm').textContent = '味方の固有スキル：' + (matesU ? 'あり' : 'なし'); $('#ulTm').classList.toggle('on', matesU); };
  $('#ulTo').onclick = () => { oppU = !oppU; $('#ulTo').textContent = '相手の固有スキル：' + (oppU ? 'あり' : 'なし'); $('#ulTo').classList.toggle('on', oppU); };
  $('#ulL').onclick = () => { lv2 = !lv2; $('#ulL').textContent = '凸で強化：' + (lv2 ? 'あり' : 'なし'); $('#ulL').classList.toggle('on', lv2); };
  let pLv = 1;
  $('#ulPL').onclick = () => { pLv = pLv % 3 + 1; $('#ulPL').textContent = ['付与のみ', '強化', '強化＋範囲拡大'][pLv - 1]; $('#ulPL').classList.toggle('on', pLv > 1); };
  $('#ulP').onchange = (e) => { pasType = e.target.value; descP(); msg(''); };
  descU(); descP();
  // 育成モードの画面（はじめてのクラブ作りなど）が自動で開くので閉じておく
  const hideCareer = () => document.querySelectorAll('.lk-wrap').forEach((el) => { el.hidden = true; });
  setTimeout(hideCareer, 600); setTimeout(hideCareer, 1800);

  // ---- 試合で見る：発動が多い試合を探して、その試合を流す。発動した場面へジャンプできる ----
  function watch() {
    msg('発動する試合を探しています…');
    setTimeout(() => {
      const o = OWN[key]; let best = null;
      const cmb = combo && SHOOTERS.has(key) ? combo : '';
      // 重なった場面：固有スキルが出た瞬間に、その選手がその技でシュートしている
      const hits = (m) => {
        const us = m.uniqLog.filter((u) => u.k === key);
        if (!cmb) return us;
        return us.filter((u) => {
          if (cmb === 'header') return m.events.some((e) => e.type === 'shot' && e.header && Math.abs(e.t - u.t) < 0.15);
          if (cmb === 'dribbleShot') return (m.actions || []).some((a) => a.i === u.i && a.a === 'dshot' && Math.abs(a.t - u.t) < 0.35);
          const win = cmb === 'powerMid' || cmb === 'nearPost' ? 2.6 : 0.35;
          return (m.actions || []).some((a) => a.i === u.i && a.a === 'skill' && a.k === cmb && a.t <= u.t + 0.1 && u.t - a.t < win);
        });
      };
      for (let s = 1; s <= (cmb ? 24 : 10); s++) {
        const m = cmb ? D.simulateMatch(team(o.id, key, true, lv2, null, 'own'), team(opp, key, false, false, null, 'opp'), 500 + s * 17) : sim(team(o.id, key, true, lv2, null, 'own'), team(opp, key, false, false, null, 'opp'), 500 + s * 17);
        const n = hits(m).length;
        if (!best || n > best.n) best = { s: 500 + s * 17, n, ts: hits(m).map((u) => u.t) };
        if (n >= (cmb ? 2 : 3)) break;
      }
      if (!best.n) { msg(cmb ? 'この組み合わせは24試合回しても出ませんでした（ボレー・バイシクルなどはクロスが必要で、出にくいです）。相手を変えてみてください。' : '10試合回しても、この相手では1回も出ませんでした。相手を変えてみてください。'); return; }
      const a = team(o.id, key, true, lv2, null, 'own'), b = team(opp, key, false, false, null, 'opp');
      document.querySelectorAll('.lk-wrap').forEach((el) => { el.hidden = true; });   // 育成モードの画面（はじめてのクラブ作りなど）は閉じる
      A.startWith(a, b, best.s, a.short || tname(o.id), b.short || tname(opp), () => {}, { noIntro: true, kits: [a.kit, b.kit] });
      setTimeout(() => {
        const mt = A.match, list = (mt.events || []).filter((e) => e.type === 'uniq' && e.k === key && (!cmb || best.ts.some((t) => Math.abs(t - e.t) < 0.05)));
        const i0 = (mt.roster[0] || []).findIndex((r) => r.uniq === key);
        // 選手は選ばない（選ぶと黄色い線が出て邪魔になるため）
        $('#ulJ').innerHTML = list.map((e, j) => `<button data-t="${e.t}">${j + 1}回目 ${Math.floor(e.clock / 60)}分</button>`).join('') || '';
        $('#ulJ').querySelectorAll('[data-t]').forEach((bt) => bt.onclick = () => { M.seek(Math.max(0.2, +bt.dataset.t - 3)); M.setSpeed(1); if (!M.playing) M.play(); });
        msg(`この試合で${list.length}回${cmb ? `（${COMBO.find((c) => c[0] === cmb)[1]}と同時）` : ''}出ます。${U[key].who}（${U[key].type}）の頭の上に、スキル名の吹き出しが出ます。ボタンを押すと、その3秒前から見られます。`);
        box.classList.add('min'); $('#ulMin').textContent = 'ひらく';
      }, 300);
    }, 30);
  }
  $('#ulW').onclick = watch;

  // ---- 数字で比べる ----
  const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  function statsOf(m, ti, name) {
    const st = m.stats[ti], ot = m.stats[1 - ti], ev = m.events;
    const my = (t) => ev.filter((e) => e.type === t && e.team === ti && (!name || e.player === name)).length;
    return { gf: m.score[ti], ga: m.score[1 - ti], pass: st.pass_pct, shots: st.shots, on: st.shots_on_target, oppShots: ot.shots, oppOn: ot.shots_on_target, off: st.offsides, oppOff: ot.offsides, tw: st.tackles_won, poss: st.possession_pct, dr: st.dribbles_past,
      pShots: my('shot'), pGoals: ev.filter((e) => e.type === 'goal' && e.team === ti && (!name || e.player === name || e.scorer === name)).length, fires: (m.uniqLog || []).filter((u) => u.team === ti).length };
  }
  const ROWS = [['fires', '固有スキル発動'], ['gf', '得点'], ['ga', '失点'], ['shots', 'シュート'], ['on', '枠内シュート'], ['pass', 'パス成功率%'], ['dr', 'ドリブルで抜いた'], ['tw', 'タックル成功'], ['oppShots', '相手のシュート'], ['oppOff', '相手のオフサイド'], ['off', '自分のオフサイド'], ['poss', 'ボール保持%']];
  function table(on, off, rows) {
    return `<table><tr><th></th><th>あり</th><th>なし</th><th>差</th></tr>${rows.map(([k, n]) => { const a = avg(on.map((x) => x[k])), b = avg(off.map((x) => x[k])), d = a - b, good = ['ga', 'oppShots', 'off', 'aGoal', 'aShot', 'aOn', 'tGoal', 'aU'].includes(k) ? d < 0 : d > 0;
      return `<tr><td>${n}</td><td>${a.toFixed(1)}</td><td>${b.toFixed(1)}</td><td class="${Math.abs(d) < 0.05 ? '' : good ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${d.toFixed(1)}</td></tr>`; }).join('')}</table>`;
  }
  function runAB(n, build, label, rows) {
    const on = [], off = []; let s = 0;
    msg(`${label}：試合を回しています… 0 / ${n * 2}`);
    const step = () => {
      const t0 = performance.now();
      while (s < n * 2 && performance.now() - t0 < 120) {
        const side = s < n ? 'on' : 'off', seed = 900 + (s % n) * 31;
        const [a, b] = build(side === 'on');
        const m = sim(a, b, seed);
        (side === 'on' ? on : off).push(statsOf(m, 0));
        s++;
      }
      if (s < n * 2) { msg(`${label}：試合を回しています… ${s} / ${n * 2}`); setTimeout(step, 0); return; }
      msg(`<b>${label}</b>（同じ${n}試合を「あり」と「なし」で比べた平均）${table(on, off, rows)}<br>試合ごとのブレがあるので、差が小さいものは誤差のこともあります。`);
    };
    setTimeout(step, 30);
  }
  $('#ulN').onclick = () => { const o = OWN[key]; runAB(10, (on) => [team(o.id, key, on, lv2, null, 'own'), team(opp, key, false, false, null, 'opp')], `${U[key].name}（${U[key].who}）`, ROWS); };
  $('#ulPN').onclick = () => {
    // そのタイプの選手がスタメンにいるチーム（国内屈指のいないチームから探す）
    const ids = Object.keys(C.ROSTERS).filter((id) => !TOPS.has(id) && id !== opp && C.cpuTeam(id).players.slice(0, 11).some((p) => p.type === pasType));
    if (!ids.length) { msg('このタイプの選手がスタメンにいるチームが見つかりませんでした。'); return; }
    const id = ids.sort((a, b) => (C.ROSTERS[b].lvl || 0) - (C.ROSTERS[a].lvl || 0))[0];
    const who = C.cpuTeam(id).players.slice(0, 11).find((p) => p.type === pasType);
    runAB(12, (on) => [team(id, null, false, false, on ? { type: pasType, lv: pLv } : null), team(opp === id ? OPPS[1] : opp, null, false)], `${PAS[pasType].name}（${tname(id)}の${who.number}番 ${who.name}に付けた）`, ROWS.slice(1));
  };

  // ---- 対策役との相性：攻め（月影・指揮者）と、守りの対策役のセットを試合で見る ----
  const DSETS = [['none', 'なし'], ['sk', 'スイーパーキーパー'], ['lc', 'ラインコントローラー'], ['df', '優秀なDF'], ['all', '3タイプ全部']];
  const DDESC = {
    none: '対策役なし（GKはふつうのゴールキーパー、DFはビルドアップ型）。抜け出し・指揮者がいちばん通りやすい相手です。',
    sk: '<b>スイーパーキーパー</b>：裏への走り出しを読むと、DFラインの裏へ先に出て、抜け出した相手へ詰めて足もとへ飛び込みます（吹き出し「飛び出し」）。かわされると無人のゴール。',
    lc: '<b>ラインコントローラー</b>：走り出しを読むと、ラインの近くからなら一斉に押し上げてオフサイド（吹き出し「オフサイドトラップ」）、深い所からならラインを下げて裏を消します（吹き出し「ラインを下げろ」）。',
    df: '<b>優秀なDF</b>（スイーパー＋ストッパー）：走り出した相手にゴール側からついていき（マークの受け渡し）、スイーパーは裏の後ろへ先回りします。コースに入ったパスを読んで触りやすい。',
    all: '<b>3タイプ全部</b>：スイーパーキーパー＋ラインコントローラー＋スイーパー＋ストッパー。',
  };
  let cA = 'tsukikage', cD = 'none', cU = false;
  $('#ucD').innerHTML = DSETS.map(([k, n]) => `<button data-d="${k}"${k === cD ? ' class="on"' : ''}>${n}</button>`).join('');
  const descC = () => { $('#ucDesc').innerHTML = DDESC[cD] + (cU && cD !== 'none' ? '<br><small>固有スキルあり：</small>' + [cD === 'sk' || cD === 'all' ? '捨て身の守護神' : '', cD === 'lc' || cD === 'all' ? '桜島の号令' : '', cD === 'df' || cD === 'all' ? '雅の後始末' : ''].filter(Boolean).join('・') : ''); };
  $('#ucD').querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { cD = b.dataset.d; $('#ucD').querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', x === b)); descC(); $('#ucJ').innerHTML = ''; });
  $('#ucA').onchange = (e) => { cA = e.target.value; $('#ucJ').innerHTML = ''; };
  $('#ucU').onclick = () => { cU = !cU; $('#ucU').textContent = '対策役の固有スキル：' + (cU ? 'あり' : 'なし'); $('#ucU').classList.toggle('on', cU); descC(); };
  descC();
  function atkTeam() {
    if (cA === 'tsukikage') { const t = C.cpuTeam('sendai'); for (const p of t.players) if (p.uniq && p.uniq !== 'tsukikage') delete p.uniq; return t; }
    const t = C.cpuTeam('kobe');
    if (cA === 'both') { const ni = C.cpuTeam('sendai').players.find((p) => p.name === 'にしの'), fw = t.players[10]; for (const k of Object.keys(ni)) if (!['position', 'role', 'number'].includes(k)) fw[k] = ni[k]; }
    for (const p of t.players) if (p.uniq && p.uniq !== 'minato' && p.uniq !== 'tsukikage') delete p.uniq;
    return t;
  }
  function defTeam() {
    const t = C.cpuTeam('okayama'), ps = t.players, sk = cD === 'sk' || cD === 'all', lc = cD === 'lc' || cD === 'all', df = cD === 'df' || cD === 'all';
    for (const p of ps) delete p.uniq;
    ps[0].type = sk ? 'スイーパーキーパー' : 'ゴールキーパー';
    ps[1].type = df ? 'スイーパー' : 'ビルドアップ型'; ps[2].type = lc ? 'ラインコントローラー' : 'ビルドアップ型'; ps[3].type = df ? 'ストッパー' : 'ビルドアップ型'; ps[4].type = 'ビルドアップ型';
    if (cU) { if (sk) { ps[0].uniq = 'sutemi'; ps[0].uniqLv = 1; } if (lc) { ps[2].uniq = 'sakurajima'; ps[2].uniqLv = 1; } if (df) { ps[1].uniq = 'miyabi'; ps[1].uniqLv = 1; } }
    return t;
  }
  // 発動した場面で何が起きたか
  function outcome(m, u) {
    const t0 = u.t, t1 = u.t + 8, A = m.actions || [], dTeam = 1 - u.team;
    const reads = [];
    const ra = A.filter((a) => a.t >= t0 - 0.1 && a.t <= t0 + 6 && ((a.i >= 11) === (dTeam === 1)) && (a.a === 'skill' || a.a === 'lcread' || a.a === 'gkplay'));
    if (ra.some((a) => a.k === 'offTrap')) reads.push('押し上げ');
    if (ra.some((a) => a.k === 'lineDrop')) reads.push('ライン下げ');
    if (ra.some((a) => a.k === 'rushOut')) reads.push('GK飛び出し');
    if (ra.some((a) => a.k === 'gkClear')) reads.push('GKクリア');
    if (ra.some((a) => a.k === 'gkPass')) reads.push('GKがつなぐ');
    if (A.some((a) => a.t >= t0 - 0.1 && a.t <= t0 + 6 && a.a === 'uniq' && a.k === 'sakurajima')) reads.push('桜島の号令');
    if (A.some((a) => a.t >= t0 - 0.1 && a.t <= t0 + 6 && a.a === 'uniq' && a.k === 'miyabi')) reads.push('雅の後始末');
    if (A.some((a) => a.t >= t0 - 0.1 && a.t <= t0 + 6 && a.a === 'uniq' && a.k === 'sutemi')) reads.push('捨て身の守護神');
    const ev = m.events.filter((e) => e.t >= t0 && e.t <= t1);
    let res = '相手ボール';
    for (const e of ev) {
      if (e.type === 'goal') { res = e.team === u.team ? 'ゴール' : '失点'; break; }
      if (e.type === 'offside') { res = 'オフサイド'; break; }
      const after = (x) => ev.find((g) => g.type === 'goal' && g.team === u.team && g.t >= x.t && g.t < x.t + 3);
      if (e.type === 'save' && e.team === dTeam) { res = after(e) ? 'GKがはじいて→ゴール' : e.act === 'smother' ? 'GKが飛び込んで止めた' : 'GKがセーブ'; break; }
      if (e.type === 'tackle' && e.team === dTeam) { res = 'DFが奪った'; break; }
      if (e.type === 'block' && e.team === dTeam) { res = after(e) ? 'DFに当たって→ゴール' : 'DFがブロック'; break; }
      if (e.type === 'shot' && e.team === u.team && !ev.some((x) => x.t > e.t && x.t < e.t + 3 && (x.type === 'goal' || x.type === 'save' || x.type === 'block'))) { res = 'シュート外れ'; break; }
    }
    return { reads, res };
  }
  $('#ucW').onclick = () => {
    msg('対策役との試合を探しています…');
    setTimeout(() => {
      const keys = cA === 'both' ? ['tsukikage', 'minato'] : [cA];
      let best = null;
      for (let s = 1; s <= 8; s++) { const sd = 700 + s * 13, m = sim(atkTeam(), defTeam(), sd), n = m.uniqLog.filter((u) => keys.includes(u.k) && u.team === 0).length; if (!best || n > best.n) best = { s: sd, n }; if (n >= 4) break; }
      if (!best.n) { msg('8試合回しても出ませんでした。'); return; }
      const a = atkTeam(), b = defTeam();
      hideCareer();
      A.startWith(a, b, best.s, a.short || '攻め', b.short || '岡山', () => {}, { noIntro: true, kits: [a.kit, b.kit] });
      setTimeout(() => {
        const mt = A.match, us = (mt.uniqLog || []).filter((u) => keys.includes(u.k) && u.team === 0);
        const NAME = { tsukikage: '月影', minato: '指揮者' }, CNT = {};
        $('#ucJ').innerHTML = us.map((u, j) => { const o = outcome(mt, u); CNT[o.res] = (CNT[o.res] || 0) + 1; const clock = Math.floor(u.t * (mt.clockScale || 12) / 60);
          return `<button data-t="${u.t}" title="${o.reads.join('・')}">${j + 1}. ${clock}分 ${NAME[u.k]}<br><small>${o.reads.length ? o.reads.join('・') + '→' : ''}${o.res}</small></button>`; }).join('');
        $('#ucJ').querySelectorAll('[data-t]').forEach((bt) => bt.onclick = () => { M.seek(Math.max(0.2, +bt.dataset.t - 2)); M.setSpeed(1); if (!M.playing) M.play(); });
        msg(`この試合で${us.length}回出ます（${Object.entries(CNT).map(([k, v]) => `${k} ${v}`).join('・')}）。ボタンを押すと、その2秒前から見られます。`);
        box.classList.add('min'); $('#ulMin').textContent = 'ひらく';
      }, 300);
    }, 30);
  };

  // ---- 選手の対決：好きなチームの好きな選手どうしを、何試合も戦わせて見る ----
  const TIDS = Object.keys(C.ROSTERS).sort((a, b) => (C.ROSTERS[b].lvl || 0) - (C.ROSTERS[a].lvl || 0));
  const teamOpt = (sel) => TIDS.map((id) => `<option value="${id}"${id === sel ? ' selected' : ''}>${tname(id)}（Lv${C.ROSTERS[id].lvl}）</option>`).join('');
  const isTop = (q) => !!(q.uniq || q.top);
  const plOpt = (id, selName) => C.cpuTeam(id).players.map((p, i) => `<option value="${esc0(p.name)}"${p.name === selName ? ' selected' : ''}>${p.number}番 ${p.position} ${esc0(p.name)}（${p.type}）${p.uniq ? '★国内屈指・' + U[p.uniq].name : ''}${i >= 11 ? '・控え' : ''}</option>`).join('');
  function esc0(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const V = { at: 'tokyo', ap: 'かとう', dt: 'yokohama', dp: 'れんの', u: true, al: false, dl: false };
  const fillV = () => { $('#uvAT').innerHTML = teamOpt(V.at); $('#uvDT').innerHTML = teamOpt(V.dt); $('#uvAP').innerHTML = plOpt(V.at, V.ap); $('#uvDP').innerHTML = plOpt(V.dt, V.dp); };
  fillV();
  $('#uvAT').onchange = (e) => { V.at = e.target.value; V.ap = C.cpuTeam(V.at).players.find(isTop)?.name || C.cpuTeam(V.at).players[10].name; fillV(); };
  $('#uvDT').onchange = (e) => { V.dt = e.target.value; V.dp = (C.cpuTeam(V.dt).players.find(isTop) || C.cpuTeam(V.dt).players[0]).name; fillV(); };
  $('#uvAP').onchange = (e) => { V.ap = e.target.value; }; $('#uvDP').onchange = (e) => { V.dp = e.target.value; };
  $('#uvU').onclick = () => { V.u = !V.u; $('#uvU').textContent = '固有スキル：' + (V.u ? 'あり' : 'なし'); $('#uvU').classList.toggle('on', V.u); };
  $('#uvAL').onclick = () => { V.al = !V.al; $('#uvAL').textContent = '攻めの凸：' + (V.al ? 'あり' : 'なし'); $('#uvAL').classList.toggle('on', V.al); };
  $('#uvDL').onclick = () => { V.dl = !V.dl; $('#uvDL').textContent = '守りの凸：' + (V.dl ? 'あり' : 'なし'); $('#uvDL').classList.toggle('on', V.dl); };
  // 注目する選手だけが固有スキルを持つ。控えなら、同じポジションのスタメンと入れ替える
  function vTeam(id, name, uOn, lv, markOn) {
    const t = C.cpuTeam(id), ps = t.players, i = ps.findIndex((p) => p.name === name);
    if (markOn && i >= 0) ps[i].vsMark = markOn;
    else if (i >= 0) ps[i].vsFocus = true;   // 攻めの選手：味方がボールを集める   // 守りの選手は、攻めの選手にぴったり付いて対決する
    if (i >= 11) { const j = ps.slice(0, 11).findIndex((p) => p.position === ps[i].position); const k = j >= 0 ? j : 10; const a = ps[k]; ps[k] = ps[i]; ps[i] = a; }
    for (const p of ps) { if (p.name !== name || !uOn) delete p.uniq; if (p.uniq) p.uniqLv = lv ? 2 : 1; }
    return t;
  }
  // 2人が直接ぶつかった場面（競り合い・シュート）を拾う
  function vMeet(m) {
    const ev = m.events || [], acts = m.actions || [], R = m.roster || [[], []];
    const iA = (R[0] || []).findIndex((x) => x.name === V.ap), id0 = (R[1] || []).findIndex((x) => x.name === V.dp), iD = id0 >= 0 ? (R[0] || []).length + id0 : -1;
    const out = [];
    let last = -9;
    for (const a of acts) {
      if (a.a !== 'duel' || a.t - last < 1.2) continue;
      if (!((a.i === iD && a.o === iA) || (a.i === iA && a.o === iD))) continue;
      last = a.t;
      const nx = acts.filter((x) => x.t >= a.t - 0.01 && x.t < a.t + 1.6);
      const won = nx.some((x) => x.a === 'win' && x.i === iD) || ev.some((e) => e.type === 'tackle' && e.player === V.dp && e.t >= a.t - 0.01 && e.t < a.t + 1.6);
      const beat = nx.some((x) => (x.a === 'beat' && x.i === iA) || (x.a === 'skill' && x.i === iA) || (x.a === 'lose' && x.i === iD && !won));
      out.push({ t: a.t, clock: a.t * (m.clockScale || 1), kind: 'duel', res: won ? esc0(V.dp) + 'が奪った' : beat ? esc0(V.ap) + 'がかわした' : '競り合い' });
    }
    for (const e of ev) if (e.type === 'shot' && e.player === V.ap) {
      const nx = ev.find((x) => x.t > e.t - 0.01 && x.t < e.t + 4 && ['goal', 'save', 'block', 'post'].includes(x.type));
      if (nx && nx.player === V.dp) out.push({ t: e.t, clock: e.clock, kind: 'shot', res: esc0(V.dp) + (nx.type === 'save' ? 'がセーブ' : 'がブロック') });
      else if (nx && nx.type === 'goal' && hasNear(m, e.t, iD, iA)) out.push({ t: e.t, clock: e.clock, kind: 'shot', res: 'シュート→ゴール' });
    }
    return out.sort((x, y) => x.t - y.t);
  }
  function hasNear(m, t, iD, iA) { return (m.actions || []).some((x) => Math.abs(x.t - t) < 3 && x.a === 'duel' && ((x.i === iD && x.o === iA) || (x.i === iA && x.o === iD))); }
  function vStats(m) {
    const ev = m.events, A = V.ap, Dn = V.dp, mt = vMeet(m), du = mt.filter((x) => x.kind === 'duel');
    return { aGoal: ev.filter((e) => e.type === 'goal' && e.player === A).length, aShot: ev.filter((e) => e.type === 'shot' && e.player === A).length, aOn: ev.filter((e) => e.type === 'shot' && e.player === A && e.on).length,
      tGoal: m.score[0], dSave: ev.filter((e) => e.type === 'save' && e.player === Dn).length, dWin: ev.filter((e) => (e.type === 'tackle' || e.type === 'block') && e.player === Dn).length,
      aU: (m.uniqLog || []).filter((u) => u.team === 0).length, dU: (m.uniqLog || []).filter((u) => u.team === 1).length,
      vN: du.length, vW: du.filter((x) => x.res.endsWith('奪った')).length, vB: du.filter((x) => x.res.endsWith('かわした')).length };
  }
  const VROWS = [['aGoal', '注目の攻め：得点'], ['aShot', '注目の攻め：シュート'], ['aOn', '注目の攻め：枠内'], ['tGoal', '攻めチームの得点'], ['dSave', '注目の守り：セーブ'], ['dWin', '注目の守り：奪った・ブロック'], ['aU', '攻めの固有スキル発動'], ['dU', '守りの固有スキル発動'], ['vN', '2人の競り合い'], ['vW', '　→ 守りが奪った'], ['vB', '　→ 攻めがかわした']];
  $('#uvN').onclick = () => {
    const n = 20, on = [], off = []; let s2 = 0;
    const step = () => { const t0 = performance.now();
      while (s2 < n * 2 && performance.now() - t0 < 120) { const withD = s2 < n, seed = 1300 + (s2 % n) * 29;
        const m = simA(vTeam(V.at, V.ap, V.u, V.al), vTeam(V.dt, V.dp, V.u && withD, V.dl, V.ap), seed); (withD ? on : off).push(vStats(m)); s2++; }
      if (s2 < n * 2) { msg(`試合を回しています… ${s2} / ${n * 2}`); setTimeout(step, 0); return; }
      msg(`<b>${esc0(V.ap)}（${tname(V.at)}）× ${esc0(V.dp)}（${tname(V.dt)}）</b>　同じ${n}試合の1試合あたり<br>「あり」＝守りの${esc0(V.dp)}の固有スキルあり／「なし」＝なし（攻めの固有スキルは${V.u ? 'どちらもあり' : 'なし'}）${table(on, off, VROWS)}`); };
    msg('試合を回しています…'); setTimeout(step, 30);
  };
  $('#uvW').onclick = () => {
    msg(`${esc0(V.ap)}と${esc0(V.dp)}がよくぶつかる試合を探しています…`);
    setTimeout(() => {
      let best = null;
      for (let k = 1; k <= 8; k++) { const sd = 1500 + k * 17, m = simA(vTeam(V.at, V.ap, V.u, V.al), vTeam(V.dt, V.dp, V.u, V.dl, V.ap), sd), n = vMeet(m).length; if (!best || n > best.n) best = { s: sd, n }; if (n >= 8) break; }
      const a = vTeam(V.at, V.ap, V.u, V.al), b = vTeam(V.dt, V.dp, V.u, V.dl, V.ap);
      hideCareer();
      A.startWith(a, b, best.s, a.short || tname(V.at), b.short || tname(V.dt), () => {}, { noIntro: true, kits: [a.kit, b.kit] });
      setTimeout(() => {
        const list = vMeet(A.match);
        $('#uvJ').innerHTML = list.map((e, j) => `<button data-t="${e.t}">${j + 1}. ${Math.floor(e.clock / 60)}分 ${e.kind === 'shot' ? 'シュート' : '競り合い'}<br><small>${e.res}</small></button>`).join('') || '';
        $('#uvJ').querySelectorAll('[data-t]').forEach((bt) => bt.onclick = () => { M.seek(Math.max(0.2, +bt.dataset.t - 3)); M.setSpeed(1); if (!M.playing) M.play(); });
        msg(`この試合で${esc0(V.ap)}と${esc0(V.dp)}が直接ぶつかった場面は${list.length}回です（${esc0(V.dp)}は${esc0(V.ap)}にぴったり付いて守ります）。ボタンを押すと、その3秒前から見られます。`);
        box.classList.add('min'); $('#ulMin').textContent = 'ひらく';
      }, 300);
    }, 30);
  };

  // ---- 版667：ドリブル技を試合で見る（ヒールリフトなど）。技を1つに決めて試合を回し、出た場面へジャンプ。スローでも見られる ----
  const DRIBS = ['heelLift', 'nutmeg', 'scissors', 'elastico', 'doubleTouch', 'bodyFeint', 'roulette', 'kickFeint', 'cutIn'].filter((k) => D.SKILLS[k]);
  $('#udK').innerHTML = DRIBS.map((k) => `<option value="${k}">${D.SKILLS[k].name}</option>`).join('');
  let dSp = 1;
  box.querySelectorAll('[data-sp]').forEach((b) => b.onclick = () => { dSp = +b.dataset.sp; box.querySelectorAll('[data-sp]').forEach((x) => x.classList.toggle('on', x === b)); M.setSpeed(dSp); });
  const plain = (id) => { const t = C.cpuTeam(id); for (const p of t.players) delete p.uniq; return t; };
  $('#udW').onclick = () => {
    const sk = $('#udK').value, oid = $('#udO').value, aid = OPPS.find((x) => x !== oid) || OPPS[0], nm = D.SKILLS[sk].name;
    msg(nm + 'が出る試合を探しています…' + (sk === 'heelLift' ? '（ヒールリフトは使える場面が少ないので、30秒ほどかかります）' : ''));
    setTimeout(() => {
      let seed = 0, bestN = -1; const s0 = 700 + Math.floor(Math.random() * 9000);
      globalThis.__forceSkill = sk;
      try { for (let k = 0; k < (sk === 'heelLift' ? 12 : 6) && bestN < (sk === 'heelLift' ? 3 : 5); k++) { const m = D.simulateMatch(plain(aid), plain(oid), s0 + k * 31, { frames: false, acts: true }); const n = (m.actions || []).filter((x) => x.a === 'skill' && x.k === sk).length; if (n > bestN) { bestN = n; seed = s0 + k * 31; } } } finally { globalThis.__forceSkill = null; }   // 技がたくさん出る試合を選ぶ
      const a = plain(aid), b = plain(oid);
      document.querySelectorAll('.lk-wrap').forEach((el) => { el.hidden = true; });
      globalThis.__forceSkill = sk;
      try { A.startWith(a, b, seed, a.short || tname(aid), b.short || tname(oid), () => {}, { noIntro: true, kits: [a.kit, b.kit] }); } finally { globalThis.__forceSkill = null; }
      setTimeout(() => {
        const mt = A.match, acts = mt.actions || [];
        const list = acts.filter((x) => x.a === 'skill' && x.k === sk && x.t > 1);
        const res = (x) => { if (sk !== 'heelLift') return ''; const l = acts.find((y) => y.a === 'hlLook' && y.t > x.t && y.t - x.t < 0.8); return !l ? '（とられた）' : l.read ? '（読まれた）' : '（成功）'; };
        const clock = (t) => Math.floor(t * (mt.clockScale || 1) / 60);
        $('#udJ').innerHTML = list.slice(0, 30).map((x, j) => `<button data-t="${x.t}">${j + 1}回目 ${clock(x.t)}分${res(x)}</button>`).join('');
        $('#udJ').querySelectorAll('[data-t]').forEach((bt) => bt.onclick = () => { M.seek(Math.max(0.2, +bt.dataset.t - 2)); M.setSpeed(dSp); if (!M.playing) M.play(); });
        msg(list.length ? `この試合で${nm}が${list.length}回出ます。ボタンを押すと、その2秒前から見られます。スローにすると、足の動きとボールの高さが見やすいです。` : `${nm}が出ませんでした。もう一度「試合で見る」を押してください。`);
        if (list.length) { M.seek(Math.max(0.2, list[0].t - 2)); M.setSpeed(dSp); box.classList.add('min'); $('#ulMin').textContent = 'ひらく'; }
      }, 300);
    }, 30);
  };
})();