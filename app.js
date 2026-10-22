// ドットサッカー 画面
// engine/engine.js が作った試合の記録（ボールと22人の位置）をそのまま再生する。
(() => {
  'use strict';
  // 版693：ボタンを押したまま指を外へずらして離したら、押さなかったことにする（スマホのふつうのボタンと同じ）
  { let tc = null;
    addEventListener('pointerdown', (e) => { tc = { id: e.pointerId, x: e.clientX, y: e.clientY, mv: 0, up: 0 }; }, true);
    addEventListener('pointermove', (e) => { if (tc && e.pointerId === tc.id) tc.mv = Math.max(tc.mv, Math.hypot(e.clientX - tc.x, e.clientY - tc.y)); }, true);
    addEventListener('pointerup', (e) => { if (tc && e.pointerId === tc.id) { tc.ux = e.clientX; tc.uy = e.clientY; tc.up = Date.now(); } }, true);
    addEventListener('click', (e) => {
      if (!tc || !tc.up || Date.now() - tc.up > 700 || !e.isTrusted) return;
      const b = e.target && e.target.closest ? e.target.closest('button,a,[role="button"],.of-b,[data-a],[data-m]') : null; if (!b) return;
      const r = b.getBoundingClientRect(), pad = 14;
      const out = tc.ux < r.left - pad || tc.ux > r.right + pad || tc.uy < r.top - pad || tc.uy > r.bottom + pad;
      if (out || tc.mv > 60) { e.stopImmediatePropagation(); e.preventDefault(); }
      tc = null;
    }, true); }
  const D = window.DotSoccer;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let myTeam = D.beginningTeam();
  // 版の表示（古い版が残っていないか確認できるように）
  try { const sc = document.querySelector('script[src*="app.js"]'), ver = sc && (sc.src.split('v=')[1] || '').split('-').pop(); const h = document.querySelector('.hint'); if (h && ver) h.textContent += `　（版 ${ver}）`; window.__appVer = ver; } catch (e) {}
  let match = null;       // 試合の記録
  let simT = 0;           // 再生中の試合内時刻（秒）
  let speed = 1, playing = false, lastNow = 0, raf = 0;
  let selected = -1;      // 追跡中の選手（0〜21）
  let trail = [];
  let evIndex = 0, halfShown = false;
  let banner = null;      // 画面中央の一言
  let offsideT = -99, offsideX = -1, nextBanner = null; // 副審が旗を上げる
  const RATE = 1.25;      // 1倍のときの再生速度（試合内秒／実秒）

  // ---------- 画面切替 ----------
  function showStartupError(error) {
    const box = $('#startupError');
    if (!box) return;
    box.hidden = false;
    box.textContent = `試合を開始できませんでした。\n${error && error.message ? error.message : String(error)}`;
  }
  window.addEventListener('error', (e) => showStartupError(e.error || e.message));
  const screenIds = ['setup', 'match', 'result', 'career'];
  const overlayIds = ['panel', 'half'];
  function showScreen(name) {
    for (const id of screenIds) $('#' + id).hidden = id !== name;
    document.querySelector('header').hidden = name === 'match';
    if (name !== 'match') { showOverlay(null); try { SND().crowd(false); } catch (_) {} }   // 版532：試合の画面を出たら、観客の声も必ず止める
  }
  function showOverlay(name) { for (const id of overlayIds) $('#' + id).hidden = id !== name; }

  // 選手一覧：12の能力をS〜Eで（フィジカル系・技術系・守備/頭脳系で色分け）
  function roster() {
    const lv = ($('#level') && $('#level').value) || 'low';
    const team = lv === 's' ? D.atLevel(myTeam, 'S') : myTeam;
    const G = { phys: 'pg-phys', tech: 'pg-tech', mind: 'pg-mind' };
    const head = `<div class="param-head"><span></span>${D.PARAMS.map((q) => `<i class="${G[q.g]}" title="${q.desc}">${q.name}</i>`).join('')}</div>`;
    $('#roster').innerHTML = head + team.players.map((p0, i) => {
      const p = D.fillParams({ ...p0 }, 0);
      const cells = D.PARAMS.map((q) => { const g = D.grade(p[q.k]); return `<b class="gr gr-${g} ${G[q.g]}" title="${q.name} ${p[q.k]}">${g}</b>`; }).join('');
      return `<div class="player-card"><span class="num">${String(p.number).padStart(2, '0')}</span><div><strong>${p.name}</strong><small>${p.position}・${p.type}・${i < 11 ? '先発' : '控え'}</small></div><div class="grades">${cells}</div></div>`;
    }).join('');
  }

  // ---------- 試合開始 ----------
  function start() {
    { const dc = document.getElementById('digestCtl'); if (dc) dc.style.display = 'none'; }
    const box = $('#startupError');
    if (box) { box.hidden = true; box.textContent = ''; }
    const opp = $('#opponent').value;
    // シードが空なら毎回ちがう試合。番号を入れた時だけ同じ試合を再現する（確認用）
    const seed = +$('#seed').value || (1 + Math.floor(Math.random() * 999999));
    $('#seed').placeholder = `空欄＝毎回ちがう試合（前回 ${seed}）`;
    // 選手のレベル：オールSなら能力を S 帯（85〜99）へ上げ、スキルも一通り覚えさせる（カルチョビットAの強豪級）
    const lv = ($('#level') && $('#level').value) || 'low';
    const mine = lv === 's' ? D.atLevel(myTeam, 'S') : myTeam;
    const theirs = lv === 's' || lv === 'vs' ? D.atLevel(D.presetTeam(opp), 'S') : D.presetTeam(opp);
    startWith(mine, theirs, seed, myTeam.short, opp, null);
  }
  // 試合を始める（フリー試合・育成モード共通）。onDone があれば、試合後に呼ぶ
  let onMatchDone = null, mctx = null;
  const SND = () => window.DotSound || { play() {}, crowd() {}, bgm() {} };   // 版499：サウンド
  let hitAll = [], skAll = [], lastShotEv = null, goalSnd = false, introChant = false, chantOn = false, chantUntil = 0, chantNext = 0, lastShotSimT = 0, shownScore = '', dribOwner = -1, dribT = 0, kickAll = [], kickPtr = 0, koWhistleT = -1, oohT = -1, chipHeard = new Map();
  function startWith(mine, theirs, seed, homeShort, awayShort, done, opts) {
    closePlv();
    { const dc = document.getElementById('digestCtl'); if (dc) dc.style.display = 'none'; }
    onMatchDone = done || null;
    mctx = { mine, theirs, seed, opts: opts || {}, homeShort, awayShort };
    venue = mctx.opts.venue != null ? Math.max(0, Math.min(4, mctx.opts.venue)) : 4;
    applyKits(mctx.opts.kits);
    careerChanges = []; tacChange = null; tacState = null; closeLocker();
    match = D.simulateMatch(mine, theirs, seed, { oneHalf: !!mctx.opts.oneHalf });   // 版560：練習試合は前半だけ
    { const hb = document.getElementById('htTac'); if (hb) hb.hidden = !mctx.opts.onSub; const sb = document.querySelector('#half [data-panel="subs"]'); if (sb) sb.hidden = !!mctx.opts.onSub; }
    { const ab = document.querySelector('#match aside [data-panel="subs"]'); if (ab) ab.style.display = (mctx.opts.watch || mctx.opts.lockEdit) ? 'none' : ''; }   // 観戦：選手交代はない（版622：フレンドのルーム対戦も、2つの画面で同じ試合にするため変更なし）
    // 版695：プレミアムパス：試合の早送り（1倍→2倍→4倍）。フレンドのルーム対戦（2つの画面で同じ試合）では出さない
    { let fb = document.getElementById('premFF'); if (!fb) { fb = document.createElement('button'); fb.id = 'premFF'; fb.className = 'prem-ff'; fb.title = '早送り（プレミアムパス）'; const host = document.querySelector('#match .viewport') || document.querySelector('#match'); host.appendChild(fb);
        fb.onclick = (e) => { e.stopPropagation(); speed = speed >= 4 ? 1 : speed * 2; fb.innerHTML = `<b>▶▶</b><small>×${speed}</small>`; fb.classList.toggle('on', speed > 1); }; }
      fb.hidden = !(window.__premOn && !mctx.opts.lockEdit); fb.innerHTML = '<b>▶▶</b><small>×1</small>'; fb.classList.remove('on'); }
    $('#match').classList.toggle('watching', !!mctx.opts.watch); { const ws = document.getElementById('wStop'); if (ws) { ws.hidden = !mctx.opts.watch; ws.onclick = async () => {
        { const pn = document.getElementById('panel'); if (pn && !pn.hidden) { pn.hidden = true; return; } }   /* 版491：開いている画面を一つずつ閉じる */
        { const pv = document.getElementById('plv'); if (pv && !pv.hidden) { if (plvMode !== 'both') { plvMode = 'both'; plvDraw(); } else closePlv(); return; } }
        const was = playing; stop(); if (mctx.opts.confirmQuit && !(await mctx.opts.confirmQuit())) { if (was) play(); return; } closePlv(); ws.hidden = true; onMatchDone = null; SND().crowd(false); document.getElementById('half').hidden = true; const q = mctx.opts.onQuit; if (q) q(); };   /* 版481：「観戦をやめますか？」はい／いいえ */ } }   /* 版477：観戦を途中でやめる */
    match.homeShort = homeShort || match.homeShort; match.awayShort = awayShort || match.awayShort;
    prepTimeline();
    kickAll = kickTimes.flat().map((k) => k.t).sort((x, y) => x - y); skAll = (match.actions || []).filter((x) => x.a === 'uniq' || (x.a === 'skill' && SHOT_SKILL.has(x.k))).map((x) => x.t).sort((x, y) => x - y); /* 版720：スキルが出た時の「おぉー」（版721：固有スキルとシュートの技だけ。GKや守備の技では鳴らさない） */ lastShotEv = null; goalSnd = false; SND().goal(false); chantOn = false; chantUntil = 0; chantNext = performance.now() + 30000; lastShotSimT = 0; introChant = !(mctx && mctx.opts && mctx.opts.watch); if (introChant) setTimeout(() => { if (introChant && SND().chant(true, 0.8)) { chantOn = true; chantUntil = Infinity; } }, 300);   /* 版730：入場から太鼓 */ hitAll = [...(match.actions || []).filter((x) => x.a === 'head').map((x) => ({ t: x.t, n: 'header' })), ...match.events.filter((e) => e.type === 'save' || (e.type === 'gk' && e.act !== 'miss')).map((e) => ({ t: e.t, n: /parry|punch|fumble/.test(e.act || '') ? 'parry' : 'catch' }))].sort((x, y) => x.t - y.t); kickPtr = 0; koWhistleT = 0.05; oohT = -1; champTried = false; champEnd(); shownScore = ''; chipHeard = new Map(); SND().bgm(null); SND().crowd(mctx && mctx.opts && mctx.opts.noIntro ? true : 'far');   /* 版558：本家は入場前の画面では、観客の声が遠く小さい */
    warmUp();
    // 育成モードは入場・対戦カードの画面を先に見せているので、すぐキックオフへ
    show = mctx.opts.noIntro ? { phase: 'kickoff', hold: true, koT: 0, start: 0, goal: null, rt: 0, walk: true } : { phase: 'preCrowd', hold: true, koT: 0, start: 0, goal: null, rt: 0 };
    simT = 0; speed = 1; selected = -1; trail = []; evIndex = 0; halfShown = false; halfT = match.halfTime || 225; banner = null; cornerT = -99; zoom = 1; lastBall = null; ballTrail.length = 0; cam.init = false; offsideT = -99; offsideX = -1; nextBanner = null; camMaxY = 62;
    $('#homeName').textContent = match.homeShort;
    $('#awayName').textContent = match.awayShort;
    $$('.speeds button').forEach((b) => b.classList.toggle('active', b.dataset.speed === '1'));
    showScreen('match');
    resize();
    play();
  }
  // 記録から「誰がいつ蹴ったか」「カード」「ゴール」を拾っておく
  let kickTimes = [], cardsOf = [], cardList = [], cardPanel = null, goals = [], shotsList = [];
  function idxOf(team, number) {
    let k = match.roster[team].findIndex((r) => r.number === number);
    if (k < 0) { const e = match.events.find((x) => x.type === 'sub' && x.team === team && (x.outNumber === number || x.number === number)); if (e) k = e.slot; }   // 途中で交代した選手
    return k < 0 ? -1 : team * 11 + k;
  }
  // その時間にピッチにいた選手の情報（途中で交代したら、それより前は交代前の選手）
  function rinfo(team, k, t) {
    const list = subsAt[team * 11 + k];
    if (!list || !match.rosterStart) return match.roster[team][k];
    t = t ?? simT;
    let info = match.rosterStart[team][k];
    for (const e of list) if (e.t <= t) info = e.info; else break;
    return info;
  }
  let subsAt = [];
  // ハーフタイムの交代・作戦変更：同じシードで試合を計算し直す（前半はまったく同じになる）。後半はそこから続ける
  function applyHalf(changes, cb) {
    const m2 = D.simulateMatch(mctx.mine, mctx.theirs, mctx.seed, { changes, oneHalf: !!mctx.opts.oneHalf });
    m2.homeShort = match.homeShort; m2.awayShort = match.awayShort;
    match = m2; halfT = match.halfTime || halfT;
    prepTimeline();
    evIndex = 0; while (evIndex < match.events.length && match.events[evIndex].t <= simT) evIndex++;
    const subs = match.events.filter((e) => e.type === 'sub' && e.team === 0);
    if (cb) cb(subs);
  }
  function prepTimeline() {
    const fr = match.frames, KI = FIX + 69 + 13;
    kickTimes = Array.from({ length: 22 }, () => []);
    for (let i = 1; i < fr.length - 1; i++) {
      const k = fr[i][KI];
      if (k == null || k < 0) continue;
      const t = fr[i][0] - 0.1, nx = fr[Math.min(fr.length - 1, i + 1)];
      kickTimes[k].push({ t, dx: nx[1] - fr[i - 1][1], dy: nx[2] - fr[i - 1][2] });
    }
    subsAt = []; for (const e of match.events) if (e.type === 'sub') (subsAt[e.team * 11 + e.slot] = subsAt[e.team * 11 + e.slot] || []).push(e);
    cardsOf = Array.from({ length: 22 }, () => []); cardList = [];
    goals = []; shotsList = [];
    for (const e of match.events) {
      if (e.type === 'card') { const i = idxOf(e.team, e.number); if (i >= 0) { const c = { t: e.t, color: e.color, i, team: e.team, number: e.number, name: e.player, up: null }; cardsOf[i].push(c); cardList.push(c); } }
      if (e.type === 'shot') { const i = idxOf(e.team, e.number); if (i >= 0) shotsList.push({ t: e.t, i, chip: !!e.chip, knuckle: !!e.knuckle, header: !!e.header }); }
      if (e.type === 'goal') goals.push({ ...e, idx: e.player === 'オウンゴール' ? -1 : idxOf(e.team, e.number) });
    }
    cardPanel = null;
    actsOf = Array.from({ length: 22 }, () => []);
    try { const C2 = window.__career; if (C2 && C2.matchFace) { for (const t of [0, 1]) for (const inf of (match.rosterStart || match.roster || [])[t] || []) C2.matchFace(inf, '#2f6fd6'); for (const e of match.events || []) if (e.type === 'sub' && e.info) C2.matchFace(e.info, '#2f6fd6'); } } catch (e) { /* 顔写真の先読み */ }
    // パス系のスキルは表示しない（動きで見せる）
    const PASS_SK = new Set(['throughPass', 'loftedThrough', 'noLook', 'oneTouchPass', 'heelPass', 'longFeed', 'earlyCross', 'pinpointCross', 'switchPlay', 'wallPass', 'oneTwo']);
    kfOf = Array.from({ length: 22 }, () => []);   // 蹴った足（右・左）は絵の描き分けだけに使う
    for (const a of match.actions || []) { if (a.a === 'kf') { kfOf[a.i].push(a); continue; } if (!(a.a === 'skill' && PASS_SK.has(a.k))) actsOf[a.i].push(a); }
    bySlow = (match.actions || []).filter((a) => a.a === 'bycalm').map((a) => [a.t, a.t + a.d]);   // 白夜の視界：時間がゆっくり流れる区間
    // 接触の瞬間（足・頭・体がボールや相手に当たった所）に小さな火花を出す：誰が何に触ったかを目で追えるように
    contacts = [];
    for (const a of match.actions || []) {
      if (false) {
        const st = stateAt(a.t + 0.05);
        contacts.push({ t: a.t, x: st.ball.x, y: st.ball.y, z: st.ball.z, big: a.a === 'head' || a.blk ? 1 : 0 });
      } else if (a.a === 'fouler' || (a.a === 'fall' && a.o != null && !(match.actions.some((b) => b.a === 'fouler' && b.i === a.o && Math.abs(b.t - a.t) < 0.05)))) {
        const st = stateAt(a.t), p = st.players[a.i], o = st.players[a.o];
        if (p && o) contacts.push({ t: a.t, x: (p.x + o.x) / 2, y: (p.y + o.y) / 2, z: 0.7, big: 2 });
      }
    }
    contacts.sort((a, b) => a.t - b.t);
    fouls = match.events.filter((e) => e.type === 'foul').map((e) => e.t);
    // ゴールごとに、ボールがネットに入って揺らし、地面に落ちて止まるまでの時間と場所を調べておく
    for (const g of goals) {
      let t0 = -1, hit = null, prev = null, settle = g.t + 2.4, maxD = 0;
      for (let t = g.t - 0.6; t < g.t + 2.8; t += 0.05) {
        const b = stateAt(t).ball, inX = b.x < 0 || b.x > 105;
        if (inX && t0 < 0 && Math.abs(b.y - 34) < D.CONST.POST + 0.3) { t0 = t; const sp = prev ? Math.hypot(b.x - prev.x, b.y - prev.y, b.z - prev.z) / 0.05 : 15; hit = { gx: b.x < 0 ? 0 : 105, y: b.y, z: b.z, sp }; }
        if (t0 >= 0) {
          const dep = b.x < 0 ? -b.x : b.x - 105;
          if (dep > maxD) { maxD = dep; hit.y = b.y; hit.z = b.z; hit.tb = t; }
          const mv = prev ? Math.hypot(b.x - prev.x, b.y - prev.y, b.z - prev.z) / 0.05 : 9;
          if (t > t0 + 0.3 && b.z < 0.08 && mv < 1.2) { settle = t; break; }
        }
        prev = b;
      }
      if (hit) { g.net = { ...hit, t0, tb: hit.tb ?? t0, settle }; g.netEnd = Math.min(g.t + 2.6, settle + 0.45); }
    }
  }
  let actsOf = [], contacts = [], fouls = [], bySlow = [];
  const slowAt = (t) => { for (const w of bySlow) if (t >= w[0] && t < w[1]) return 0.3; return 1; };
  const viewHold = [];
  // 動きの印だけで、姿勢には使わないもの
  const MARK = { ovrun: 1, recrun: 1, icpt: 1, capcall: 1, capbuf: 1, pppass: 1, skill: 1, win: 1, beat: 1, dmode: 1, dshot: 1, uniq: 1, uend: 1, tact: 1, tactbuf: 1, lcread: 1, gkplay: 1, myb: 1, sweep: 1, sjline: 1, taiko: 1, mthit: 1, mtrush: 1, mtslow: 1, mtpush: 1, kgon: 1, kgpin: 1, kgsew: 1, kgsh: 1, kgoff: 1, sdzap: 1, hrpass: 1, hrbuf: 1, cdon: 1, cdoff: 1, bycalm: 1, bypass: 1, bybuf: 1, byrun: 1, ksrun: 1, aopull: 1, uzpull: 1, aorun: 1, uzrun: 1, upoff: 1, aopost: 1, aopostend: 1, aoflash: 1, aopass: 1, kmfire: 1, kmshade: 1, kmshot: 1, kmrun: 1, kmpass: 1, ttgate: 1, ttwolf: 1, ttsteal: 1, ttpass: 1, mdfire: 1, mdlure: 1, mdpull: 1, mdrun: 1, mdpass: 1, mdfree: 1, mdguard: 1, mdbuff: 1 };
  const SKILL_NAME = { offTrap: 'オフサイドトラップ', lineDrop: 'ラインを下げろ', gkPass: 'つなぐ', gkClear: 'クリア', dfClear: 'クリア', knuckle: '無回転シュート', curve: 'カーブキック', fk: 'FKマイスター', ckMaster: 'CKマイスター', longThrow: 'ロングスロー', pkMaster: 'PKの名手', wallPass: '壁パス', slide: 'スライディング', feint: 'ボディフェイント', scissors: 'シザース', doubleScissors: 'ダブルシザース', roulette: 'マルセイユルーレット', elastico: 'エラシコ', doubleTouch: 'ダブルタッチ', bodyFeint: 'ボディフェイント', nutmeg: '股抜き', speedDribble: '高速ドリブル', cutback: '切り返し', cutIn: 'カットイン', heelLift: 'ヒールリフト', kickFeint: 'キックフェイント', dribbleShot: 'ドリブルシュート', driveShot: 'ドライブシュート', volley: 'ボレー', lob: 'ループ', direct: 'ダイレクト', bicycle: 'バイシクル', divingHeader: 'ダイビングヘッド', toeKick: 'トゥーキック', nearPost: 'ニア上ぶち抜き', powerMid: '強烈ミドル', controlShot: 'コントロールショット', superLong: '超ロングシュート', throughPass: 'スルーパス', loftedThrough: '浮き球スルーパス', noLook: 'ノールックパス', oneTouchPass: 'ワンタッチパス', heelPass: 'ヒールパス', longFeed: 'ロングフィード', earlyCross: 'アーリークロス', pinpointCross: 'ピンポイントクロス', switchPlay: 'サイドチェンジ', intercept: 'インターセプト', manMark: 'マンマーク', cover: 'カバーリング', shoulder: 'ショルダーチャージ', aerial: '空中戦の鬼', shotBlock: 'シュートブロック', pressMonster: 'プレスの鬼', recovery: '帰陣ダッシュ', superReflex: '超反応', punching: 'パンチング', rushOut: '飛び出し', pkStopper: 'PKストッパー', oneOnOne: '1対1の鬼', lowThrow: '低弾道スロー', lowPunt: '低弾道パントキック', coaching: 'コーチング', behindRun: '裏への抜け出し', postPlay: 'ポストプレー', nearRun: 'ニアに飛び込む', farWait: 'ファーで待つ', overlap: 'オーバーラップ', looseBall: 'こぼれ球の嗅覚', oneTwo: 'ワンツーの名手', captaincy: 'キャプテンシー', bigStage: '大舞台に強い', lateGrit: '終盤の粘り', clutch: '勝負強さ', moodMaker: 'ムードメーカー', fighting: '闘志', calm: '冷静', ironMan: '鉄人' };
  // いま進行中の動き（ヘディング・スライディングなど）。u は 0〜1 の進み具合
  function actionAt(i) {
    const L2 = actsOf[i]; if (!L2) return null;
    let touchHit = null;
    for (let k = L2.length - 1; k >= 0; k--) {
      const a = L2[k];
      if (a.a === 'head') { const H0 = 0.32, t0 = a.t - H0, d0 = a.d + H0; if (simT >= t0 && simT - t0 <= d0) return { ...a, u: (simT - t0) / d0, hitU: H0 / d0 }; if (a.t > simT) continue; }   // 版456：ヘディングは、当たる少し前に跳び始める
      if (a.t > simT + 0.05) continue;
      if (simT - a.t > 1.6) break;
      if (MARK[a.a]) continue;
      if (simT - a.t <= a.d) {
        // ドリブルの小さなタッチより、進行中の技・動作を優先
        if (a.a === 'touch') { if (!touchHit) touchHit = { ...a, u: (simT - a.t) / a.d }; continue; }
        return { ...a, u: (simT - a.t) / a.d };
      }
    }
    return touchHit;
  }
  function skillAt(i) {
    const L2 = actsOf[i]; if (!L2) return null;
    // 同時に出した技（ドリブルシュート＋強烈ミドルなど）は「＋」でつなげて出す
    for (let k = L2.length - 1; k >= 0; k--) {
      const a = L2[k]; if (a.t > simT) continue; if (simT - a.t > 1.8) break;
      if (a.a === 'skill' || a.a === 'uniq') {
        // 固有スキルは【】で囲む（ほかの技と同時なら「【紅蓮の牙】＋強烈ミドル」）
        const nm = (x) => (x.a === 'uniq' ? `【${(D.UNIQ && D.UNIQ[x.k] && D.UNIQ[x.k].name) || x.k}${x.lv >= 2 ? '・覚醒' : ''}】` : SKILL_NAME[x.k] || x.k);   // 凸で強化した固有スキルは「・覚醒」
        const names = [nm(a)];
        for (let j = k - 1; j >= 0 && a.t - L2[j].t < (a.a === 'uniq' || L2[j].a === 'uniq' ? 0.8 : 0.05); j--) if ((L2[j].a === 'skill' || L2[j].a === 'uniq') && !names.includes(nm(L2[j]))) names.unshift(nm(L2[j]));
        names.sort((x, y) => (y[0] === '【') - (x[0] === '【'));
        return names.join('＋');
      }
    }
    return null;
  }
  // キックの姿勢：蹴る0.3秒前から振りかぶり、蹴った後0.3秒は振り抜き
  function kickPose(i) {
    const list = kickTimes[i];
    for (let k = list.length - 1; k >= 0; k--) {
      const d = simT - list[k].t;
      if (d > 0.5) break;
      // シュートは大きく振りかぶって、振り抜いた足が高く上がる（パスは小さく）
      if (list[k].shot === undefined) {
        const sh = shotsList.find((x) => x.i === i && Math.abs(x.t - list[k].t) < 0.25), t0 = list[k].t; list[k].shot = !!sh;
        // シュート技：そのシュートで出した技（溜める技は2.5秒前から）。ループ・無回転はシュートの記録から
        let sk = null, dsh = false;
        if (sh) { for (const a of actsOf[i] || []) if (a.a === 'dshot' && a.t <= t0 + 0.2 && a.t > t0 - 0.6) dsh = true; else if (a.a === 'skill' && SHOT_SKILL.has(a.k) && a.t <= t0 + 0.2 && a.t > t0 - (a.k === 'powerMid' || a.k === 'nearPost' || a.k === 'superLong' ? 2.5 : 0.3)) { if (a.k === 'dribbleShot') dsh = true; else sk = a.k; }
          if (sh.chip) sk = 'lob'; if (sh.knuckle) sk = 'knuckle'; }
        list[k].sk = sk; list[k].dsh = dsh;
      }
      const shot = list[k].shot;
      if (shot && list[k].sk === 'toeKick') { if (d >= -0.08 && d <= 0.18) return { pose: d < 0 ? 'bigWindup' : 'follow', dx: list[k].dx, dy: list[k].dy, shot: true, d, sk: 'toeKick', t0: list[k].t }; if (d > 0.18) continue; return null; }   // トゥーキック：走ったまま、ほとんど構えずにつま先で突く
      if (shot) { if (d >= -0.38) return { pose: d < 0 ? 'bigWindup' : 'follow', dx: list[k].dx, dy: list[k].dy, shot: true, d, sk: list[k].sk, dsh: list[k].dsh, t0: list[k].t }; }
      else if (d >= -0.3 && d <= 0.32) return { pose: d < 0 ? 'windup' : 'kick', dx: list[k].dx, dy: list[k].dy, d, ev: list[k] };
    }
    return null;
  }
  function safeStart() {
    try { start(); } catch (error) { stop(); showScreen('setup'); showStartupError(error); console.error(error); }
  }
  function play() { playing = true; $('#pause').textContent = '一時停止'; lastNow = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
  function stop() { playing = false; cancelAnimationFrame(raf); $('#pause').textContent = '再生'; }

  function ffHide() {
    if (!window.__premOn || !mctx || mctx.opts.lockEdit) return true;
    if (simT >= match.duration - 0.01 || (show && ['halfOut', 'endOut', 'digest', 'champ', 'endCrowd'].includes(show.phase))) return true;
    const lk = document.getElementById('locker'), hp = document.getElementById('half');
    return !!((lk && !lk.hidden) || (hp && !hp.hidden));
  }
  // 版769：試合を先の時間へ飛ばす（バックグラウンドから戻った時・ルーム対戦で相手の画面のほうが進んでいる時）
  // 途中のゴールやファールの演出は出さず、点数・時計・選手の位置だけ、その時間の試合に合わせる。ルーム対戦の時間あわせでは前半の終わりは越えない。バックグラウンドはハーフタイムも飛ばす
  function catchUp(target, skipHalf) {
    if (!match || !playing) return false;
    const hp = document.getElementById('half'), lk = document.getElementById('locker');
    if ((hp && !hp.hidden) || (lk && !lk.hidden)) return false;
    if (show && ['preCrowd', 'halfOut', 'endOut', 'digest', 'champ', 'endCrowd'].includes(show.phase)) return false;
    target = Math.min(target, match.duration);
    if (target <= simT + 0.5) return false;
    let k = evIndex;
    while (k < match.events.length && match.events[k].t <= target) {
      const e = match.events[k];
      if (e.type === 'half' && !halfShown) {
        if (!skipHalf) { target = Math.max(simT, e.t - 0.05); break; }
        halfShown = true; halfT = e.t; target = Math.max(target, halfT + match.frameDt * 2.5);   // 版770：バックグラウンドで進んでいた時は、ハーフタイムも飛ばして後半へ
      }
      k++;
    }
    if (target <= simT + 0.5) return false;
    evIndex = k; simT = target; while (kickPtr < kickAll.length && kickAll[kickPtr] <= simT) kickPtr++; cam.init = false;
    show = null; banner = null; nextBanner = null; cardPanel = null; oohT = -1; koWhistleT = -1; trail = []; ballTrail.length = 0; lastBall = null;
    if (goalSnd) { goalSnd = false; SND().goal(false); }
    { const led = document.getElementById('subLed'); if (led) led.classList.remove('show'); }
    if (simT >= match.duration) { simT = match.duration; show = { phase: 'endOut', hold: true, rt: 0 }; SND().play('whistle3'); }
    return true;
  }
  let hidAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hidAt = performance.now(); return; }
    if (!hidAt) return;
    const sec = (performance.now() - hidAt) / 1000; hidAt = 0;
    const ms = document.getElementById('match');
    if (!ms || ms.hidden || !match || sec < 1) return;
    // 版771：ハーフタイムのロッカーにいる時に裏へ回したら、後半を始めて、そのまま進める（交代・作戦の画面を開いている時と、チュートリアルは待つ）
    const lkEl0 = document.getElementById('locker'), htm = document.getElementById('htModal');
    if (lk && !lk.talk && !lk.leaving && lkEl0 && !lkEl0.hidden && halfShown && simT < match.duration - 1 && !(htm && !htm.hidden) && !(mctx && mctx.opts.tut)) {
      closeLocker(); startSecondHalf();
    }
    if (!playing) return;
    catchUp(simT + sec * RATE * speed, true);
    lastNow = performance.now();
  });
  // 版583：試合の画面で何かエラーが起きても、止まったままにならないように（エラーの内容を小さく出して、試合の結果へ進む）
  let loopErr = 0;
  function loop(now) {
    try { loop0(now); } catch (err) {
      console.error(err); loopErr++;
      try { let t = document.getElementById('errTip'); if (!t) { t = document.createElement('p'); t.id = 'errTip'; document.body.appendChild(t); } t.textContent = 'エラー：' + (err && err.message || err) + '（' + (show ? show.phase : '-') + '）'; t.hidden = false; setTimeout(() => { t.hidden = true; }, 8000); } catch (_) {}
      try { champEnd(); } catch (_) {}
      if (loopErr < 4 && show && (show.phase === 'champ' || show.phase === 'endOut')) { try { show = null; simT = match.duration; digestCtl(false); finish(); return; } catch (_) {} }
      if (playing) raf = requestAnimationFrame(loop);
    }
  }
  function loop0(now) {
    if (!playing || !match) return;
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    window.__showPh = show ? show.phase : '';
    { const fb = document.getElementById('premFF'); if (fb && fb.hidden !== ffHide()) fb.hidden = ffHide(); }   // 版769：試合が終わったら（ハーフタイムのロッカーでも）早送りは消す
    if (goalSnd && (!show || ['kickoff', 'hurry', 'endOut', 'halfOut', 'digest'].includes(show.phase))) { goalSnd = false; SND().goal(false);
    }
    if (chantOn && show && ['endOut', 'halfOut', 'digest'].includes(show.phase)) { chantOn = false; introChant = false; SND().chant(false); chantNext = performance.now() + 30000; }   // 前半・試合の終わりで止める
    if (introChant && !show) { introChant = false; if (chantOn) chantUntil = performance.now() + 12000; }   // 版730：入場の太鼓は、キックオフのあと12秒で落ち着く   // 版723：キックオフ（試合終了）で、ゴールの大歓声を落ち着かせる
    if (show && show.hold) advanceShow(dt);
    else {
      const simT0 = simT;
      simT += dt * RATE * speed * (speed < 4 ? slowAt(simT) : 1);   // 白夜の視界の間は、ゆっくり
      if (koWhistleT >= 0 && simT0 < koWhistleT && simT >= koWhistleT) { SND().play('whistle'); koWhistleT = -1; }
      if (oohT >= 0 && simT >= oohT) { if (speed < 16) SND().play('ooh'); oohT = -1; }   // 版558：おしいシュートの「おぉー」
      if (simT >= match.duration) {
        // 試合終了（ゴール演出の途中でも、ここで締める。止まったままにならないように）
        simT = match.duration;
        if (speed >= 16) { show = null; draw(); finish(); return; }
        if (!show || !show.hold) { show = { phase: 'endOut', hold: true, rt: 0 }; SND().play('whistle3'); setTimeout(() => SND().play('clap'), 700); }
      }
      fireEvents();
      if (show) advanceShow(dt);
    }
    sndTick();
    draw();
    if (show && show.phase === 'champ' && show.stage === 1) drawConfetti(show.t);
    if (mctx && mctx.opts.tut && mctx.opts.tut.tick && playing && !(show && show.hold)) mctx.opts.tut.tick(simT, tutApi());   // チュートリアル：決まった時間に試合を止めて説明
    if (playing) raf = requestAnimationFrame(loop);
  }

  // 版502：試合の音（キック・ドリブル・リプレイ中のゴールの歓声）。ふつうの試合中とリプレイ中だけ鳴らす
  let sndPrevT = 0;
  const sndLive = () => !show || ['replay', 'jreplay'].includes(show.phase);
  function sndTick() {
    const t0 = sndPrevT, t1 = simT; sndPrevT = t1;
    if (!(t1 > t0 && t1 - t0 < 0.6) || speed >= 4 || !sndLive() || $('#match').hidden) { dribOwner = -1; if (!goalSnd) SND().excite(0); return; }   // 版532：試合の画面が隠れている時は鳴らさない
    // キック：t0〜t1の間に蹴った回数
    let lo = 0, hi = kickAll.length; while (lo < hi) { const m = (lo + hi) >> 1; if (kickAll[m] <= t0) lo = m + 1; else hi = m; }
    if (lo < kickAll.length && kickAll[lo] <= t1) SND().play('kick');
    { let l3 = 0, h3 = skAll.length; while (l3 < h3) { const m = (l3 + h3) >> 1; if (skAll[m] <= t0) l3 = m + 1; else h3 = m; } if (l3 < skAll.length && skAll[l3] <= t1) setTimeout(() => SND().play('ooh'), 600); }   // 版723：少し遅らせる   // 版720：スキル → 惜しいシーンの声（4秒に1回まで）
    { let l2 = 0, h2 = hitAll.length; while (l2 < h2) { const m = (l2 + h2) >> 1; if (hitAll[m].t <= t0) l2 = m + 1; else h2 = m; } for (; l2 < hitAll.length && hitAll[l2].t <= t1; l2++) SND().play(hitAll[l2].n); }   // 版504：ヘディング・GKのキャッチ／はじく
    // ドリブル：ボールを持って走っている間のタッチ
    const sd = stateAt(t1);
    if (sd.owner >= 0) { const pl = sd.players[sd.owner]; const mv = pl && Math.hypot(pl.vx || 0, pl.vy || 0); if (dribOwner !== sd.owner) { dribOwner = sd.owner; dribT = t1; } else if (t1 - dribT > 0.42 && (mv == null || mv > 1.2)) { dribT = t1; SND().play('touch'); } } else dribOwner = -1;
    // 版729：楽器付きの応援：接戦（後半で1点差以内）か、こう着（25秒シュートがない）の時に、ときどき15〜25秒。終わったら45〜75秒あける
    { const nowR = performance.now();
      if (chantOn && nowR > chantUntil) { chantOn = false; SND().chant(false); chantNext = nowR + 40000 + Math.random() * 20000; }
      else if (!chantOn && !goalSnd && nowR > chantNext) {
        const sc = sd.score || [0, 0], close = Math.abs(sc[0] - sc[1]) <= 1 && t1 > match.duration * 0.5, still = t1 - lastShotSimT > 25;
        if ((close || still) && SND().chant && SND().chant(true)) { chantOn = true; chantUntil = nowR + 30000 + Math.random() * 15000; } else chantNext = nowR + 8000; } }   // 版730：30〜45秒続ける
    // 版724：チャンスの盛り上がり：ボールを持った選手が相手ゴールに近づくほど（30m以内）、観客の歓声をだんだん上げる
    if (!goalSnd) { let ex = 0; if (sd.owner >= 0) { const pl = sd.players[sd.owner], tm = sd.owner < 11 ? 0 : 1, gx = (tm === 0) === (sd.side > 0) ? 105 : 0; if (pl) { const d = Math.hypot(pl.x - gx, pl.y - 34); if (d < 30) ex = Math.min(1, (30 - d) / 16); } } SND().excite(ex); }
    // リプレイの中で、ボールがゴールに入る瞬間に歓声
    if (show && show.phase === 'replay' && show.goal && t0 < show.goal.t && t1 >= show.goal.t && !goalSnd) SND().play('cheer');   // 版723：ゴールの歓声が続いている時は重ねない
  }

  // ---------- ゴール後の演出（カルチョビットA風） ----------
  // スコア表示 → 観客席 → リプレイ → 暗転 → 引きの画面からキックオフへ寄る（得点者のパネル）
  let animT = 0;
  const WALK_T = { t1: 0.2, t3: 5.0, end: 11.2 };   // 入場：走り出し・ポジションへ散る・キックオフ
  let show = null, halfT = 225;
  // 試合終了：笛 → 最終スコア → 観客席 → ダイジェスト（ゴールシーン） → 結果
  // ================= 試合終了 → ダイジェスト → 試合結果（カルチョビットA） =================
  //  ダイジェスト：ゴール・決定機・タイムアップの場面を、緑の枠の中の画面で順に流す（くり返し）。右下の▶で試合結果へ
  function digestItems() {
    const out = [], ev = match.events, ts = (k) => (k ? match.awayShort : match.homeShort);
    const tName = (k) => (k ? (mctx && mctx.opts.awayName) || match.awayShort : (mctx && mctx.opts.homeName) || match.homeShort);
    const scoreAt = (t) => [0, 1].map((k) => goals.filter((g) => g.team === k && g.t <= t + 0.01).length);
    const minOf = (t) => { const m = Math.ceil((t * match.clockScale) / 60); return t < halfT ? Math.min(45, m) : Math.min(90, m); };
    const minTxt = (t) => { const m = Math.ceil((t * match.clockScale) / 60); return t < halfT ? (m > 45 ? `45'+${m - 45}` : `${m}'`) : (m > 90 ? `90'+${m - 90}` : `${m}'`); };
    const halfTxt = (t) => `${t < halfT ? '前半' : '後半'}${String(t < halfT ? minOf(t) : minOf(t) - 45).replace(/[0-9]/g, (d) => '０１２３４５６７８９'[d])}分`;
    for (const g of goals) {
      const sc = scoreAt(g.t), prev = sc.slice(); prev[g.team]--;
      const lead = prev[g.team] - prev[1 - g.team];
      const what = sc[0] + sc[1] === 1 ? '先制' : lead === 0 ? '勝ち越し' : lead === -1 ? '同点' : lead >= 1 ? '追加' : '反撃';
      const name = g.player === 'オウンゴール' ? 'オウンゴール' : g.player;
      let line = g.player === 'オウンゴール' ? `相手のオウンゴールで${what === '先制' ? '先制' : what === '同点' ? '同点' : '加点'}` :
        g.style === 'head' ? `${g.assist ? g.assist + 'のクロスに、' : ''}${name}が頭で合わせて${what === '先制' ? '先制' : what === '同点' ? '同点' : 'ゴール'}` :
        g.assist ? `${g.assist}からのパスを受けた、${name}の${what === '先制' ? '先制パンチ' : what === '同点' ? '同点弾' : what === '勝ち越し' ? '勝ち越し弾' : 'ゴール'}` :
        `${name}が${g.knuckle ? '無回転シュートで' : g.speed >= 100 ? '強烈なシュートで' : ''}${what === '先制' ? '先制' : what === '同点' ? '同点に追いつく' : 'ネットを揺らす'}`;
      out.push({ t0: Math.max(0.2, g.t - 6), t1: (g.netEnd || g.t + 1.4) + 0.5, t: g.t, head: `${name}（${ts(g.team)}）${minTxt(g.t)}`, sc, cap1: `${halfTxt(g.t)}　${tName(g.team)}`, cap2: line, goal: true });
    }
    // 決定機（GKが止めた・ポストに当たった）：多すぎないように、ゴールから離れたものを最大3つ
    const ch = [];
    for (const e of ev) {
      if (e.type !== 'shot' || !e.on) continue;
      if (goals.some((g) => g.t >= e.t && g.t - e.t < 3)) continue;
      const sv = ev.find((x) => (x.type === 'save' || x.type === 'post') && x.t >= e.t && x.t - e.t < 2);
      if (!sv) continue;
      if (ch.some((c) => Math.abs(c.t - e.t) < 20) || goals.some((g) => Math.abs(g.t - e.t) < 12)) continue;
      ch.push({ t: e.t, e, post: sv.type === 'post' });
    }
    ch.sort((a, b) => (b.e.d || 0) - (a.e.d || 0));
    for (const c of ch.slice(0, 3)) {
      const e = c.e, sc = scoreAt(e.t);
      out.push({ t0: Math.max(0.2, e.t - 5), t1: e.t + 2.2, t: e.t, head: `${minTxt(e.t)}`, sc, cap1: `${halfTxt(e.t)}　${tName(e.team)}`, cap2: c.post ? `${e.player}のシュートは、ポストに嫌われた` : `${e.player}がシュートを放つが、ゴールは阻まれた` });
    }
    // スーパープレイ：ドリブルで3人以上抜いた場面（そのままゴールなら、ゴールの場面をドリブルの始めから流す）
    for (const e of ev) {
      if (e.type !== 'dribbleRun') continue;
      const gi = out.find((x) => x.goal && x.t >= e.t1 - 0.5 && x.t - e.t1 < 8);
      const team = goals.find((g) => Math.abs(g.t - (gi ? gi.t : -99)) < 0.05);
      if (gi && team && team.team === e.team) {
        gi.t0 = Math.max(0.2, Math.min(gi.t0, e.t0 - 1.5));
        gi.cap2 = team.player === e.player ? `${e.player}が${e.n}人をごぼう抜き！ そのままゴール` : `${e.player}が${e.n}人を抜き去り、${team.player}が決めた`;
        continue;
      }
      if (out.some((x) => Math.abs(x.t - e.t1) < 8)) continue;
      out.push({ t0: Math.max(0.2, e.t0 - 1.5), t1: e.t1 + 2.5, t: e.t1, head: `${minTxt(e.t1)}`, sc: scoreAt(e.t1), cap1: `${halfTxt(e.t1)}　${tName(e.team)}`, cap2: `${e.player}が${e.n}人抜きのドリブル！`, sp: true });
    }
    out.sort((a, b) => a.t - b.t);
    // タイムアップ
    out.push({ t0: Math.max(0.2, match.duration - 4.5), t1: match.duration, t: match.duration, head: `90'+${addedMin(2)}`, sc: match.score.slice(), cap1: '', cap2: 'タイムアップ、ここで試合終了', end: true });
    return out;
  }
  const DG_TR = 0.4;   // 場面の切り替え（画面が小さくなって、次の場面が広がる）
  // ================= 版580：優勝の演出（本家の流れ）=================
  //  0 白く光る → 観客席：秘書「決まりました！！」と観客の声（吹き出し）・紙吹雪（タップで次へ）
  //  1 ピッチ：選手がセンターサークルに集まって、両手を上げて跳ねる
  //  2 電光掲示板：赤い画面に大会名・チーム名・「優勝」・トロフィー
  //  3 「WE ARE THE CHAMPIONS」選手みんなの顔
  //  4 観客席：チームの旗がゆれて、チーム名のコール → ダイジェストへ
  let champTried = false, champ = null;
  const CHAMP_T = [12, 7.5, 6.5, 5, 7.5];
  const CHAMP_SHOUT = ['この日を待ってた', 'やったやった', '涙で見えない', '監督、ありがとう', 'えっ？本当に？', '優勝だーー！', '良くやった！最高'];
  function champEl() {
    let el = document.getElementById('champOv');
    if (!el) {
      el = document.createElement('div'); el.id = 'champOv'; el.className = 'lk-wrap ch-wrap'; el.hidden = true; el.innerHTML = '<div class="lk-box"></div><button class="ch-skip">スキップ ▶▶</button>';
      document.getElementById('app').appendChild(el);
      const fit = () => { const bx = el.querySelector('.lk-box'), k = Math.min((el.clientWidth || innerWidth) / 1280, (el.clientHeight || innerHeight) / 720); bx.style.transform = `translate(-50%,-50%) scale(${k.toFixed(4)})`; };
      addEventListener('resize', fit); el._fit = fit;
      el.onclick = () => { if (show && show.phase === 'champ' && show.rt > 0.8) champNext(); };
      el.querySelector('.ch-skip').onclick = (e) => { e.stopPropagation(); if (show && show.phase === 'champ') { champEnd(); try { startDigest(); } catch (err) { console.error(err); show = null; simT = match.duration; finish(); } } };
    }
    return el;
  }
  function startChamp(ch) {
    champ = ch; closePlv(); show = { phase: 'champ', hold: true, rt: 0, t: 0, stage: -1 };
    SND().crowd(true); SND().play('cheer'); SND().bgm('champ');
    document.querySelectorAll('.lk-wrap').forEach((w) => { if (w.id !== 'champOv') w.hidden = true; });
    const el = champEl(); el.hidden = false; el._fit(); $('#match').classList.add('champing');
    champStage(0);
  }
  function champEnd() { { const m = document.getElementById('match'); if (m) m.classList.remove('champing'); } const el = document.getElementById('champOv'); if (el) { el.hidden = true; el.querySelector('.lk-box').innerHTML = ''; } }
  function champNext() { try { if (show.stage >= 4) { champEnd(); startDigest(); return; } champStage(show.stage + 1); } catch (err) { console.error(err); champEnd(); try { startDigest(); } catch (_) { show = null; simT = match.duration; finish(); } } }
  function champStage(k) {
    show.stage = k; show.rt = 0;
    const el = champEl(), box = el.querySelector('.lk-box'), c = champ, E = (s) => plvEsc(String(s));
    el.className = 'lk-wrap ch-wrap ch-s' + k;
    if (k === 0) {
      const head = c.kind === 'cup' ? `${E(c.title)}優勝です！` : `${c.n > 1 ? `${c.n}回目の` : ''}${E(c.title)}制覇です！`;
      box.innerHTML = `<div class="ch-flash"></div><div class="ch-shouts"></div>${c.sec ? `<img class="ch-sec" src="${c.sec}" alt="">` : ''}<div class="ch-band"><b>秘書</b><p>決まりました！！<br>${head}</p><i>▶</i></div>`;
      const sh = box.querySelector('.ch-shouts'); let n = 0;
      const pop = () => { if (!show || show.phase !== 'champ' || show.stage !== 0) return; const b = document.createElement('span'); b.className = 'ch-shout'; b.textContent = CHAMP_SHOUT[n++ % CHAMP_SHOUT.length]; b.style.left = (420 + Math.random() * 700) + 'px'; b.style.top = (40 + Math.random() * 330) + 'px'; sh.appendChild(b); setTimeout(() => b.remove(), 1500); setTimeout(pop, 950); };
      setTimeout(pop, 700);
    } else if (k === 1) {
      box.innerHTML = '<div class="ch-black"></div>'; cam.init = false;
      const st = stateAt(simT); show.p0 = st.players.map((p) => ({ x: p.x, y: p.y }));
    } else if (k === 2) {
      SND().play('reveal5');
      box.innerHTML = `<div class="ch-board"><div class="ch-sky"></div><div class="ch-frame"><i class="ch-lamp a"></i><i class="ch-lamp b"></i><div class="ch-screen"><div class="ch-wipe"></div>
        <div class="ch-txt"><small>${E(c.small)}</small><em style="font-size:${Math.min(64, Math.floor(760 / Math.max(1, [...String(c.title)].length)))}px">${E(c.title)}</em><span>${E(c.team)}</span></div><div class="ch-trophy">${c.trophy ? `<img src="${c.trophy}" alt="">` : CH_TROPHY}</div><b class="ch-win">優勝</b></div></div><div class="ch-rail"></div></div>`;
      setTimeout(() => SND().play('uniq'), 2600);
    } else if (k === 3) {
      SND().play('cheer');
      const f = (c.faces || []).slice(0, 18);
      box.innerHTML = `<div class="ch-team"><div class="ch-faces">${f.map((u, i) => `<img src="${u}" alt="" style="--i:${i}">`).join('')}</div><div class="ch-champs"><small>WE ARE THE</small><b>CHAMPIONS</b></div></div>`;
    } else if (k === 4) {
      const flags = Array.from({ length: 11 }, (_, i) => `<i class="ch-flag" style="left:${70 + (i % 6) * 200 + (i >= 6 ? 100 : 0)}px;top:${i >= 6 ? 250 : 70}px;--d:${(i * 0.37) % 1.2}s"><img src="${c.emb}" alt=""></i>`).join('');
      box.innerHTML = `<div class="ch-flags">${flags}</div><div class="ch-chants"></div>`;
      const ct = box.querySelector('.ch-chants'); let n = 0;
      const pop = () => { if (!show || show.phase !== 'champ' || show.stage !== 4) return; const b = document.createElement('span'); b.className = 'ch-shout'; b.textContent = c.short; b.style.left = (120 + ((n * 397) % 900)) + 'px'; b.style.top = (60 + ((n * 211) % 320)) + 'px'; n++; ct.appendChild(b); setTimeout(() => b.remove(), 1400); setTimeout(pop, 650); };
      setTimeout(pop, 300);
    }
  }
  function champStep(dt) {
    show.rt += dt; show.t += dt;
    if (show.rt > CHAMP_T[show.stage]) champNext();
  }
  // ピッチ：自分のチームの選手は、センターサークルの輪に向かって走り、着いたら跳ねる。相手はその場で立ち止まる
  function champField(st) {
    if (!show.p0) return;
    const ring = st.players.map((p, i) => i).filter((i) => i < 11 && !(st.players[i].off));
    ring.forEach((i, k) => {
      const p = st.players[i], o = show.p0[i], a = (k / ring.length) * Math.PI * 2 + 0.3, tx = 52.5 + Math.cos(a) * 6.5, ty = 34 + Math.sin(a) * 6.5;
      const dx = tx - o.x, dy = ty - o.y, L = Math.hypot(dx, dy) || 0.001, d = Math.min(L, Math.max(0, show.rt - 0.3) * 7.5);
      p.x = o.x + dx / L * d; p.y = o.y + dy / L * d; p.moving = d < L - 0.05; p.sp = p.moving ? 7.5 : 0; p.vx = p.moving ? dx / L * 7.5 : 0; p.vy = p.moving ? dy / L * 7.5 : 0; p.champ = true;
    });
    for (let i = 11; i < 22; i++) { const p = st.players[i]; if (p) { p.moving = false; p.sp = 0; p.vx = p.vy = 0; } }
    st.ball.x = 52.5; st.ball.y = 34; st.ball.z = 0;
    drawConfettiLater = true;
  }
  let drawConfettiLater = false;
  // 紙吹雪：色とりどりの紙が、ひらひら回りながら降ってくる
  const CONF = Array.from({ length: 170 }, (_, i) => ({ x: (i * 0.6180339) % 1, y: (i * 0.3819) % 1, v: 70 + (i * 37) % 80, w: 8 + (i % 5) * 2, c: ['#ff4a4a', '#ffd23a', '#3ad06a', '#3a8bff', '#ffffff', '#ff8ad0', '#b07aff'][i % 7], s: (i % 9) * 0.7 }));
  function drawConfetti(t) {
    for (const p of CONF) {
      const y = ((p.y * (CH + 60) + t * p.v) % (CH + 60)) - 30, x = p.x * CW + Math.sin(t * 1.6 + p.s) * 30, r = Math.sin(t * 4 + p.s);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 2 + p.s); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.w * 0.35 * Math.abs(r) - 1, p.w, p.w * 0.7 * Math.abs(r) + 2); ctx.restore();
    }
  }
  const CH_TROPHY = '<svg viewBox="0 0 120 170"><defs><linearGradient id="chtg" x1="0" x2="1"><stop offset="0" stop-color="#7d8590"/><stop offset=".45" stop-color="#fff"/><stop offset=".6" stop-color="#cfd5dc"/><stop offset="1" stop-color="#6d747e"/></linearGradient></defs><path d="M14 18h92c0 34-14 58-38 66v26h-16V84C28 76 14 52 14 18z" fill="url(#chtg)" stroke="#444" stroke-width="2"/><path d="M14 26C2 26 2 52 22 58M106 26c12 0 12 26-8 32" fill="none" stroke="#c9cfd6" stroke-width="7" stroke-linecap="round"/><path d="M44 110h32l8 30H36z" fill="url(#chtg)" stroke="#444" stroke-width="2"/><rect x="28" y="140" width="64" height="24" rx="3" fill="#2a2a2a" stroke="#777" stroke-width="2"/></svg>';
  function startDigest() {
    const list = digestItems();
    show = { phase: 'digest', hold: true, rt: 0, list, k: 0, tr: 0, paused: false };
    SND().crowd(false); SND().bgm('post');   // 版559：本家は試合が終わると観客の声が消え、ダイジェストからノリのいい曲になる
    simT = list[0].t0; cam.init = false; lastBall = null; ballTrail.length = 0;
    digestCtl(true);
  }
  function digestGo(k) {
    if (!show || show.phase !== 'digest') return;
    const n = show.list.length; show.k = ((k % n) + n) % n; show.tr = 0;
    simT = show.list[show.k].t0; cam.init = false; lastBall = null; ballTrail.length = 0;
  }
  function showErr(err, where) { console.error(err); try { let t = document.getElementById('errTip'); if (!t) { t = document.createElement('p'); t.id = 'errTip'; document.body.appendChild(t); } const st = (err && err.stack || '').split('\n').map((l) => (l.match(/([a-z-]+\.js)[^:]*:(\d+)/) || []).slice(1).join(':')).filter(Boolean).slice(0, 3).join(' < '); t.textContent = 'エラー：' + (err && err.message || err) + '（' + where + '）' + (st ? ' @' + st : '') + ' 版' + (document.querySelector('script[src*="app.js"]') || { src: '' }).src.replace(/.*v=/, ''); t.hidden = false; setTimeout(() => { t.hidden = true; }, 10000); } catch (_) {} }
  // 版584：ダイジェストのあと、試合結果へ。うまくいかない時も止まらずに次（ロッカールームなど）へ進む
  function digestEnd() {
    try { digestCtl(false); } catch (_) {}
    show = null; simT = match.duration;
    try { finish(); } catch (err) {
      showErr(err, 'digestEnd');
      try { const r = document.getElementById('mresult'); if (r) r.hidden = true; stop(); const fn = onMatchDone; onMatchDone = null; if (fn) fn(match.score.slice()); else finish(true); } catch (e2) { showErr(e2, 'digestEnd2'); }
    }
  }
  function digestCtl(on) {
    let el = document.getElementById('digestCtl');
    if (!el) {
      el = document.createElement('div'); el.id = 'digestCtl';
      el.innerHTML = `<div class="dg-bar"><button class="dg-prev dg-ic" title="前の場面・巻き戻し"><img src="icons/ui_rpprev.png" alt="前の場面"></button><button class="dg-back dg-ic" title="5秒もどす"><img src="icons/ui_back5.png" alt="5秒もどす"></button><button class="dg-pause dg-ic" title="一時停止"><img src="icons/ui_pause.png" alt="一時停止"></button><div class="dg-track"><i class="dg-dot"></i></div><button class="dg-skip dg-ic" title="次の場面"><img src="icons/ui_rpnext.png" alt="次の場面"></button></div><button class="dg-next ui-img" title="試合結果へ"><img src="icons/ui_next.png" alt="次へ"></button>`;
      ($('#pitch').parentElement || document.body).appendChild(el);
      el.querySelector('.dg-pause').onclick = (ev) => { ev.stopPropagation(); if (!show || show.phase !== 'digest') return; show.paused = !show.paused; el.querySelector('.dg-pause img').src = show.paused ? 'icons/ui_play.png' : 'icons/ui_pause.png'; };
      // 版464：巻き戻し。|◀◀＝場面の頭へ（頭なら前の場面へ）、↺5＝5秒もどす、バーをタップ・ドラッグ＝好きな所へ
      el.querySelector('.dg-prev').onclick = (ev) => { ev.stopPropagation(); if (!show || show.phase !== 'digest') return; const it = show.list[show.k]; if (simT - it.t0 > 1.5) { simT = it.t0; show.tr = DG_TR; cam.init = false; lastBall = null; ballTrail.length = 0; } else digestGo(show.k - 1); };
      el.querySelector('.dg-back').onclick = (ev) => { ev.stopPropagation(); if (!show || show.phase !== 'digest') return; const it = show.list[show.k]; if (simT - it.t0 < 1) { digestGo(show.k - 1); const j = show.list[show.k]; simT = Math.max(j.t0, j.t1 - 5); } else simT = Math.max(it.t0, simT - 5 * RATE / RATE); show.tr = DG_TR; cam.init = false; lastBall = null; ballTrail.length = 0; };
      { const tr = el.querySelector('.dg-track'); let drag = false;
        const seek = (ev) => { if (!show || show.phase !== 'digest') return; const r = tr.getBoundingClientRect(), f = Math.max(0, Math.min(0.999, (ev.clientX - r.left) / r.width)); let tot = 0; show.list.forEach((x) => { tot += x.t1 - x.t0; }); let want = f * tot;
          for (let i = 0; i < show.list.length; i++) { const d = show.list[i].t1 - show.list[i].t0; if (want <= d || i === show.list.length - 1) { if (show.k !== i) { show.k = i; } simT = show.list[i].t0 + Math.min(d, want); show.tr = DG_TR; cam.init = false; lastBall = null; ballTrail.length = 0; break; } want -= d; } };
        tr.onpointerdown = (ev) => { ev.stopPropagation(); drag = true; try { tr.setPointerCapture(ev.pointerId); } catch (_) {} seek(ev); };
        tr.onpointermove = (ev) => { if (drag) seek(ev); }; tr.onpointerup = () => { drag = false; }; tr.onclick = (ev) => ev.stopPropagation(); }
      el.querySelector('.dg-skip').onclick = (ev) => { ev.stopPropagation(); if (show && show.phase === 'digest') digestGo(show.k + 1); };
      el.querySelector('.dg-next').onclick = (ev) => { ev.stopPropagation(); digestEnd(); };
    }
    el.style.display = on ? 'block' : 'none';
    document.body.classList.toggle('in-digest', !!on);
    if (on) { el.querySelector('.dg-pause img').src = 'icons/ui_pause.png'; }
  }
  function digestAdvance(dt) {
    const it = show.list[show.k];
    show.tr = Math.min(DG_TR * 2, show.tr + dt);
    if (!show.paused && show.tr >= DG_TR) simT = Math.min(it.t1, simT + dt * RATE);
    if (simT >= it.t1 - 0.001 && !show.paused) { show.out = (show.out || 0) + dt; if (show.out > 0.6) { show.out = 0; digestGo(show.k + 1); } } else show.out = 0;
    // 全体のどこを見ているか（下のバーの丸）
    const el = document.getElementById('digestCtl');
    if (el) { let tot = 0, cur = 0; show.list.forEach((x, i) => { const d = x.t1 - x.t0; if (i < show.k) cur += d; tot += d; }); cur += Math.max(0, simT - it.t0); el.querySelector('.dg-dot').style.left = `${Math.min(100, (cur / tot) * 100).toFixed(1)}%`; }
  }
  // 緑の枠（ピッチの線）と、その中の画面・字幕
  function drawDigestFrame() {
    const it = show.list[show.k];
    const a = show.tr < DG_TR ? show.tr / DG_TR : 1, s = 0.18 + 0.82 * (1 - Math.pow(1 - a, 3));
    const fx0 = 26, fy0 = 46, fw = CW - 52, fh = CH - 46 - 82;
    const w = fw * s, h = fh * s, x = fx0 + (fw - w) / 2, y = fy0 + (fh - h) / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.rect(x, y, w, h); ctx.fillStyle = '#16722a'; ctx.fill('evenodd');
    ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.rect(x, y, w, h); ctx.clip('evenodd');
    ctx.strokeStyle = 'rgba(80,200,90,0.55)'; ctx.lineWidth = 6;
    const px = 60, py = 40, pw = CW - 120, ph = CH - 110;
    ctx.strokeRect(px, py, pw, ph); ctx.beginPath(); ctx.moveTo(CW / 2, py); ctx.lineTo(CW / 2, py + ph); ctx.stroke();
    ctx.beginPath(); ctx.arc(CW / 2, py + ph / 2, ph * 0.17, 0, 7); ctx.stroke();
    for (const sd of [0, 1]) { const bx = sd ? px + pw - pw * 0.13 : px; ctx.strokeRect(bx, py + ph * 0.24, pw * 0.13, ph * 0.52); const sx = sd ? px + pw - pw * 0.05 : px; ctx.strokeRect(sx, py + ph * 0.38, pw * 0.05, ph * 0.24); }
    for (let yy = 0; yy < CH; yy += 4) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(0, yy, CW, 2); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    // 上の見出し：だれが（どこが）何分に／その時の点数
    ctx.fillStyle = '#fff'; ctx.font = `800 17px ${JP}`; ctx.textAlign = 'left';
    ctx.fillText(it.head, 30, 30);
    ctx.fillText(`${match.homeShort} ${it.sc[0]}-${it.sc[1]} ${match.awayShort}`, 30 + Math.max(170, ctx.measureText(it.head).width + 40), 30);
    // 字幕（画面の下）
    if (a >= 1) {
      ctx.textAlign = 'center'; ctx.font = `800 19px ${JP}`; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = '#fff';
      const lines = [it.cap1, it.cap2].filter(Boolean), y0 = y + h - 50 - (lines.length - 1) * 24;   // 版734：下の操作ボタンに重ならないように、少し上へ
      lines.forEach((ln, i) => { ctx.strokeText(ln, CW / 2, y0 + i * 24); ctx.fillText(ln, CW / 2, y0 + i * 24); });
    }
  }
  // 試合結果（状況と同じ画面。題は「試合終了」、途中経過のかわりに「試合結果」）。戻るで次へ
  function showMatchResult(next) {
    let el = document.getElementById('mresult');
    if (!el) {
      el = document.createElement('div'); el.id = 'mresult'; el.className = 'lk-wrap lk-dim';
      el.innerHTML = '<div class="lk-box"><div class="lk-sub"></div></div>';
      (document.getElementById('app') || document.body).appendChild(el);
      const fit = () => { const A = document.getElementById('app'); const k = Math.min((el.clientWidth || (A && A.clientWidth) || innerWidth) / 1280, (el.clientHeight || (A && A.clientHeight) || innerHeight) / 720); el.querySelector('.lk-box').style.transform = `translate(-50%,-50%) scale(${k.toFixed(4)})`; };
      addEventListener('resize', fit); el._fit = fit;
    }
    el.hidden = false; el._fit();
    try { let went = false; renderStatus(el.querySelector('.lk-sub'), match.duration + 1, '試合終了', 90, () => { if (went) return; went = true; el.hidden = true;
      try { next(); } catch (err) { showErr(err, '試合結果のあと'); }
      // 版585：次の画面へ進めず、試合の画面のまま止まっていたら、育成モードのホームへ戻す（iPhoneで止まっていた）
      setTimeout(() => { const stuck = !$('#match').hidden && ![...document.querySelectorAll('.lk-wrap,.modal')].some((w) => !w.hidden && w.id !== 'panel'); if (!stuck) return; showErr('次の画面へ進めませんでした', '試合結果のあと'); stop(); try { if (window.__career && window.__career.open) window.__career.open(); else showScreen('setup'); } catch (e2) { showErr(e2, 'ホームへ'); } }, 1500); }, true); } catch (err) { showErr(err, '試合結果'); el.hidden = true; next(); return; }
    if (mctx && mctx.opts.tut && mctx.opts.tut.onResult) mctx.opts.tut.onResult(el, tutApi());   // チュートリアル：結果画面の説明
  }
  // チュートリアルから試合を操作する（止める・再開・結果まで飛ばす・自分のチームが攻める向き）
  function tutApi() {
    return { pause: () => stop(), resume: () => { if (!playing) play(); }, skip: () => { simT = match.duration; draw(); finish(); }, get t() { return simT; },
      dir: () => { const st = stateAt(simT), g0 = st.players[0], g1 = st.players[11]; if (!g0 || !g1) return 1; return proj(g1.x, g1.y).x > proj(g0.x, g0.y).x ? 1 : -1; } };   // 1＝右へ攻める
  }
  function koTimeAfter(t) {
    const fr = match.frames, o = FIX + 66;
    let i = Math.max(0, Math.floor(t / match.frameDt) - 1);
    while (i < fr.length - 1 && fr[i][0] < t) i++;
    while (i < fr.length - 1 && fr[i][o] === 6) i++;
    return fr[i][0];
  }
  function startGoalShow(e) {
    const g = goals.find((x) => Math.abs(x.t - e.t) < 0.05) || { ...e, idx: -1 };
    if (speed >= 16 || window.__noShow) return;   // 試合で確認（replay）：ゴールの演出・リプレイは出さない
    // ゴールの瞬間：ネットが揺れたまま1秒ほど止まり、そこから「GOAL」と点数が出て、喜びのパフォーマンスが始まる
    // ボールがゴールラインを割ってネットに入ったのが見えてから止める
    show = { phase: 'toNet', hold: false, goal: g, rt: 0, quick: speed >= 4 };
  }
  // 判定の場面：オフサイドは副審、ファウルは主審にカメラを寄せ、そのあと問題の瞬間をリプレイ
  // 版802：どちらの副審か：オフサイドは、反則があった側の陣地（＝FKを蹴るチームの自陣）を受け持つ副審。ハーフウェーライン上でも取り違えない
  function arSide(st) {
    if (st.code === 8 && st.rteam >= 0 && st.side) { const attackX = (st.rteam === 0) === (st.side > 0) ? 105 : 0; return attackX === 105 ? 1 : 0; }
    return st.rx > 52.5 ? 0 : 1;
  }
  function startJudge(e) {
    if (window.__noShow) return;
    const off = e.type === 'offside';
    let cx = 52.5, cy = 34;
    if (off) { cx = e.line ?? stateAt(e.t).ball.x; cy = 34; }
    else {
      let best = null;
      for (const c of contacts) if (c.big === 2 && Math.abs(c.t - e.t) < 0.4) best = c;
      const st = stateAt(e.t); cx = best ? best.x : st.ball.x; cy = best ? best.y : st.ball.y;
    }
    show = { phase: 'judge', off, e, rt: 0, cx, cy, from: off ? Math.max(0.2, (e.passT ?? e.t - 1) - 2.2) : Math.max(0.2, e.t - 2.4), key: off ? (e.passT ?? e.t - 1) : e.t };
  }
  function advanceShow(dt) {
    if (show.phase === 'champ') { champStep(dt); return; }
    if (show.phase === 'sub') { subShowStep(dt); return; }
    if (show.phase === 'judge') {
      show.rt += dt * Math.min(speed, 4);
      if (simT >= show.e.t + (show.off ? 2.0 : 1.6)) { show = { ...show, phase: 'jreplay', hold: true, rt: 0, saveT: simT, paused: 0 }; simT = show.from; cam.init = false; lastBall = null; ballTrail.length = 0; }
      return;
    }
    if (show.phase === 'jreplay') {
      show.rt += dt;
      // オフサイド：パスが出た瞬間で一度止めて、ラインを見せる
      if (show.off && simT >= show.key && show.paused < 1.1) { show.paused += dt * Math.min(speed, 2); return; }
      simT += dt * RATE * 0.75 * Math.min(speed, 2);
      if (simT >= show.key + (show.off ? 1.4 : 0.9)) { show.phase = 'jfade'; show.rt = 0; }
      return;
    }
    if (show.phase === 'jfade') {
      show.rt += dt;
      if (show.rt > 0.45) { simT = show.saveT; cam.init = false; lastBall = null; ballTrail.length = 0; show = { phase: 'jback', rt: 0, subsLater: show.subsLater }; }
      return;
    }
    if (show.phase === 'jback') { show.rt += dt; if (show.rt > 0.4) { const sl = show.subsLater; show = null; if (sl && sl.length && !window.__noShow) startSubShow(sl, null); } return; }
    const g = show.goal, sp = Math.min(speed, 4);
    show.rt += dt * sp;
    if (show.phase === 'toNet') {
      show.rt += dt;
      const b = stateAt(simT).ball;
      if (b.x < -0.6 || b.x > 105.6 || show.rt > 1.2) show = { ...show, phase: show.quick || g.hurry ? 'score' : 'gkSad', hold: false, rt: 0 };   // 負けている側の得点は、すぐ点数を出して先へ
      return;
    }
    if (show.phase === 'freeze') {
      if (show.rt >= (show.quick ? 0.6 * sp : 1.0)) show = { ...show, phase: 'score', hold: false, rt: 0 };
      return;
    }
    // 決められたGKが、間をおいて順に悔しがるのを見せてから（本家の動画）、GOALと点数を出す
    if (show.phase === 'gkSad') {
      if (simT >= g.t + GK_SAD_T) show = { ...show, phase: 'score', hold: false, rt: 0, sadDelay: GK_SAD_T - 0.3 };
      return;
    }
    if (show.phase === 'score' && simT >= g.t + (g.hurry ? 2.2 : 3.6) + (show.sadDelay || 0)) {
      if (show.quick) { jumpToKickoff(); return; }
      // 3点差より開いたら・負けている側の得点（喜ばずに急いで戻る）は、観客席は映さずにそのままリプレイへ
      if (Math.abs(g.score[0] - g.score[1]) > 3 || g.hurry) { show = { ...show, phase: 'replay', hold: true, rt: 0, saveT: simT }; simT = Math.max(0.2, g.t - 6.5); cam.init = false; lastBall = null; ballTrail.length = 0; return; }
      if (venue <= 0) { show = { ...show, phase: 'replay', hold: true, rt: 0, saveT: simT }; simT = Math.max(0.2, g.t - 6.5); cam.init = false; lastBall = null; ballTrail.length = 0; return; }   // 市民グラウンドは観客席の場面なし
      show = { ...show, phase: 'crowd', hold: true, rt: 0, saveT: simT };
    } else if (show.phase === 'crowd' && show.rt > 3.0) {
      show.phase = 'replay'; show.rt = 0; simT = Math.max(0.2, g.t - 6.5); cam.init = false; lastBall = null; ballTrail.length = 0;
    } else if (show.phase === 'replay') {
      simT += dt * RATE * 0.8 * Math.min(sp, 2);
      if (simT >= g.t + 1.3) { show.phase = 'fade'; show.rt = 0; }
    } else if (show.phase === 'fade' && show.rt > 0.6) {
      jumpToKickoff();
    } else if (show.phase === 'halfOut' && show.rt > 1.4) {
      // 前半終了：笛のあと暗転して、ハーフタイムの集計へ
      show = null; stop();
      $('#halfStats').innerHTML = statsHtml(halfT, '前半終了');
      closePlv(); openLocker();
      if (mctx && mctx.opts.tut && mctx.opts.tut.onHalf) mctx.opts.tut.onHalf(tutApi());   // チュートリアル：ハーフタイムの説明
    } else if (show.phase === 'endOut' && show.rt > END_T.digest) {
      if (!champTried) { champTried = true; let ch = null; try { ch = mctx && mctx.opts && mctx.opts.champCheck ? mctx.opts.champCheck(match.score.slice()) : null; } catch (_) {} if (ch) { startChamp(ch); return; } }
      startDigest();
    } else if (show.phase === 'endOut' && show.rt > END_T.fade0 && !show.cOff) {
      show.cOff = 1; SND().crowd(false);   // 暗転といっしょに観客の声も消える   // 笛 → 選手が止まる → 暗転 → ダイジェスト（観客席は映さない）
    } else if (show.phase === 'digest') {
      digestAdvance(dt);
    } else if (show.phase === 'preCrowd' && show.rt > 2.6) {
      show = { phase: 'preVs', hold: true, koT: 0, start: 0, goal: null, rt: 0 };
      cam.init = false;
    } else if (show.phase === 'preVs' && show.rt > 3.4) {
      show = { phase: 'kickoff', hold: true, koT: 0, start: 0, goal: null, rt: 0 }; SND().crowd(true);
    } else if (show.phase === 'hurry') {
      // 負けている側の得点：ボールを拾って蹴り返し、急いで戻るところを普通のカメラで。キックオフの少し前から、いつもの寄り
      if (simT >= show.koT - 2.6) { const sl = show.subsAtKo; show = { ...show, phase: 'kickoff', start: simT, rt: 0, noFade: true, subsAtKo: null }; if (sl && sl.length) startSubShow(sl, show); }
    } else if (show.phase === 'kickoff') {
      // 得点者のパネルが出ている間は、キックオフの直前で止めて待つ（パネルが完全に消えてから再開）
      if (show.goal && show.goal.idx >= 0 && !show.koWait && !show.koDone && show.rt < 3.9 && simT >= show.koT - 0.4) { show.koWait = true; show.hold = true; }
      if (show.koWait) { if (show.rt > 3.9) { show.koWait = false; show.koDone = true; show.hold = false; } }
      else if (show.hold && show.rt > (show.walk ? WALK_T.end : 2.4)) show.hold = false;          // 試合開始・後半開始の溜め（入場から始まるときは長め）
      if (!show.hold && simT > show.koT + 1.4 && show.rt > 3) show = null;
    }
  }
  // 試合終了：笛 → 主審が両手を上げる（アップ） → 引きの画面 → 暗転 → ダイジェスト
  const END_T = { arms: 0.25, close: 2.0, fade0: 2.9, fade1: 3.7, digest: 3.9 };
  const GK_SAD_T = 2.9;   // ゴールが決まってから、GKが悔しがり終わる（立ち上がってゴールを見つめる）までの間
  function jumpToKickoff() {
    const g = show.goal, koT = koTimeAfter(g.t + 0.5);
    if (koT >= match.duration - 0.3) { simT = match.duration; show = { phase: 'endOut', hold: true, rt: 0 }; SND().play('whistle3'); setTimeout(() => SND().play('clap'), 700); return; }
    koWhistleT = koT;
    // 負けている側の得点：リプレイのあとは続きから（ボールを拾って蹴り返し、急いで戻るところを見せる）
    simT = g.hurry ? (show.saveT || simT) : Math.max(show.saveT || simT, koT - 2.6);
    // 飛ばした間の出来事は出さない（前後半の切り替えだけは拾う）
    const skippedSubs = (show.subsLater || []).slice();
    while (evIndex < match.events.length && match.events[evIndex].t <= simT) {
      const e = match.events[evIndex];
      if (e.type === 'half' && !halfShown) break;
      if (e.type === 'sub') skippedSubs.push(e);   // ゴールのあとの交代は、キックオフ前に交代ボードで見せる
      evIndex++;
    }
    cam.init = false; lastBall = null; ballTrail.length = 0; while (kickPtr < kickAll.length && kickAll[kickPtr] <= simT) kickPtr++;
    const n = goals.filter((x) => x.idx === g.idx && x.t <= g.t).length;
    show = { phase: g.hurry && koT - 2.6 > simT ? 'hurry' : 'kickoff', hold: false, koT, start: simT, goal: g, nGoals: n, rt: 0 };
    if (skippedSubs.length) { if (show.phase === 'hurry') show.subsAtKo = skippedSubs; else startSubShow(skippedSubs, show); }   // 版780：急いで戻る間（ボールがまだゴールの中）は出さず、キックオフの前に
  }

  // ---------- 記録から現在の状態を作る ----------
  const FIX = 7; // フレーム先頭の値の数
  // いまの再開（同じコードが続いている）が始まった時刻
  function codeStart(i) {
    const fr = match.frames, o = FIX + 66, c = fr[i][o];
    let j = i;
    while (j > 0 && i - j < 160 && fr[j - 1][o] === c) j--;
    return fr[j][0];
  }
  function stateAt(t) {
    const fr = match.frames;
    const fd = match.frameDt;
    let i = Math.floor(t / fd) - 1;
    i = Math.max(0, Math.min(fr.length - 2, i));
    const a = fr[i], b = fr[i + 1];
    let k = (t - a[0]) / (b[0] - a[0] || 1);
    k = Math.max(0, Math.min(1, k));
    // キックオフでの瞬間移動は補間しない
    if (Math.abs(a[1] - b[1]) > 20) k = k < 0.5 ? 0 : 1;
    const lerp = (u, v) => u + (v - u) * k;
    const players = [];
    for (let p = 0; p < 22; p++) {
      const o = FIX + p * 3;
      const jump = Math.abs(a[o] - b[o]) > 6;
      const kk = jump ? (k < 0.5 ? 0 : 1) : k;
      const prev = fr[Math.max(0, i - 1)];
      const vx = b[o] - prev[o];
      const vy = b[o + 1] - prev[o + 1];
      const sp = jump ? 0 : Math.hypot(b[o] - a[o], b[o + 1] - a[o + 1]) / ((b[0] - a[0]) || 0.2);
      players.push({ x: a[o] + (b[o] - a[o]) * kk, y: a[o + 1] + (b[o + 1] - a[o + 1]) * kk, st: b[o + 2], moving: sp > 0.4, vx, vy, sp });
    }
    const cur = k < 0.5 ? a : b;
    const E = FIX + 69; // 審判・副審・カード・GK姿勢・退場・陣地
    const has = cur.length > E;
    const lk = (o) => (has ? a[o] + (b[o] - a[o]) * k : 0);
    return {
      t, ball: { x: lerp(a[1], b[1]), y: lerp(a[2], b[2]), z: lerp(a[3], b[3]) }, owner: cur[4], score: [b[5], b[6]], players, frame: i,
      code: cur[FIX + 66] || 0, held: cur[FIX + 67] ?? -1, spin: cur[FIX + 68] || 0,
      ref: has ? { x: lk(E), y: lk(E + 1), vx: b[E] - a[E] } : null, ar: has ? [lk(E + 2), lk(E + 3)] : null,
      refCard: has ? cur[E + 4] : 0, gk: has ? [cur[E + 5], cur[E + 6]] : [0, 0], gone: has ? cur[E + 7] : 0, side: has ? cur[E + 8] : 1,
      bs: has ? cur[E + 12] || 0 : 0, passTo: has && cur.length > E + 14 ? cur[E + 14] : -1, rteam: has ? cur[E + 9] : -1, rx: has ? cur[E + 10] : -1, restY: has ? cur[E + 11] : -1, codeT: codeStart(i + (k < 0.5 ? 0 : 1)),
    };
  }

  // ---------- 描画 ----------
  // テレビ中継のようなカメラ：手前のスタンドから斜めに見下ろし、
  // ボールがゴールに近づくとそちらへ首を振る（ゴールが斜めに見える）
  const c = $('#pitch');
  const ctx = c.getContext('2d');
  let CW = 1280; const CH = 720;
  let camPitch = 0.5, camPitchT = 0.5;   // 見下ろす角度（ラジアン）。寄りの段階とリプレイで変わる
  let replayYaw = null;                  // リプレイ中はゴールの方へ大きく振る
  const DIST = 72;             // 注目点までの距離（m）
  // 画面の寄り：カルチョビットAと同じく3段階（近い・ふつう・遠い）
  const VIEWS = { near: { w: 22, pitch: 0.46 }, normal: { w: 41, pitch: 0.47 }, far: { w: 62, pitch: 0.58 } };   // 版492：ふつうを少し寄せる
  let viewMode = 'normal';
  let VIEW_W = VIEWS.normal.w;           // 注目点で横に見える幅（m）
  let FOCAL = 1900, baseFocal = 1900;
  function resize() {
    const r = c.parentElement.getBoundingClientRect();
    const asp = r.width > 0 && r.height > 0 ? r.width / r.height : 16 / 9;
    CW = Math.round(Math.max(560, Math.min(1700, CH * asp)));
    c.width = CW; c.height = CH; ctx.imageSmoothingEnabled = false;
    baseFocal = (Math.max(CW, 1000) * DIST) / VIEW_W; FOCAL = baseFocal * zoom;
  }
  // 版462：リプレイは飛ばせる（画面をタップ、または右下の「スキップ」）
  function skipReplay() {
    if (!show) return false;
    if (show.phase === 'jreplay') { show.phase = 'jfade'; show.rt = 0; return true; }
    if (show.phase === 'replay') { show.phase = 'fade'; show.rt = 0; return true; }
    return false;
  }
  { const vp = document.querySelector('#match .viewport'); if (vp && !document.getElementById('rpSkip')) { const b = document.createElement('button'); b.id = 'rpSkip'; b.type = 'button'; b.innerHTML = 'スキップ <i>▶▶</i>'; b.style.display = 'none'; b.onclick = (e) => { e.stopPropagation(); skipReplay(); }; vp.appendChild(b); } }
  $('#pitch').addEventListener('click', () => {
    if (!show) return;
    if (show.phase === 'digest') return;   // ダイジェストは下のボタンで操作
    if (skipReplay()) return;
    if (show.hold) show.rt += 10;
  });
  window.addEventListener('resize', () => { if (match && !$('#match').hidden) { resize(); draw(); } });
  const cam = { x: 52.5, y: 34, yaw: 0, init: false };
  let B = null; // カメラの基底
  function camBasis() {
    const dx = Math.sin(cam.yaw), dy = -Math.cos(cam.yaw);           // 向いている方向（地面）
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    B = {
      cx: cam.x - dx * DIST * cp, cy: cam.y - dy * DIST * cp, cz: DIST * sp,
      fx: dx * cp, fy: dy * cp, fz: -sp,                              // 奥行き
      rx: Math.cos(cam.yaw), ry: Math.sin(cam.yaw),                   // 右
      ux: dx * sp, uy: dy * sp, uz: cp,                               // 上
    };
  }
  function updateCamera(bx, by, snap) {
    const tx = Math.max(4, Math.min(101, bx)), ty = Math.max(6, Math.min(camMaxY, by));
    const k = Math.max(-1, Math.min(1, (bx - 52.5) / 38));
    const tyaw = replayYaw != null ? replayYaw : Math.sign(k) * Math.pow(Math.abs(k), 1.4) * 0.46;
    if (snap || !cam.init) { cam.x = tx; cam.y = ty; cam.yaw = tyaw; cam.init = true; }
    else { cam.x += (tx - cam.x) * 0.08; cam.y += (ty - cam.y) * 0.08; cam.yaw += (tyaw - cam.yaw) * 0.03; }
    camBasis();
  }
  // ボールが必ず画面の内側（余白つき）に入るよう、はみ出しそうならカメラを寄せる
  // 高く上がったボールは高さを抑えて考える（上に少し切れても良い。影は画面に残る）
  // はみ出しそうな時も、一気に寄せずに数コマかけてなめらかに寄せる（浮き球でカメラがガクガクしないように）
  function keepBallInView(b) {
    const z = Math.min(b.z, 2.5);
    const sx = cam.x, sy = cam.y;
    let moved = false;
    for (let k = 0; k < 12; k++) {
      const p = P3(b.x, b.y, z);
      const mx = CW * 0.14, top = CH * 0.16, bot = CH * 0.86;
      if (p.f > 4 && p.x > mx && p.x < CW - mx && p.y > top && p.y < bot) break;
      cam.x += (b.x - cam.x) * 0.25; cam.y += (b.y - cam.y) * 0.25; camBasis(); moved = true;
    }
    if (!moved) return;
    // 本当に画面の端から出てしまう時だけは強めに追う
    const p = P3(b.x, b.y, z);
    const out = !(p.f > 4 && p.x > CW * 0.04 && p.x < CW * 0.96 && p.y > CH * 0.05 && p.y < CH * 0.95);
    const k2 = out ? 0.6 : 0.3;
    cam.x = sx + (cam.x - sx) * k2; cam.y = sy + (cam.y - sy) * k2; camBasis();
  }
  // 世界座標(x, y, 高さz) → 画面。f は奥行き（m）
  function P3(x, y, z) {
    const X = x - B.cx, Y = y - B.cy, Z = z - B.cz;
    const f = X * B.fx + Y * B.fy + Z * B.fz;
    const r = X * B.rx + Y * B.ry;
    const u = X * B.ux + Y * B.uy + Z * B.uz;
    const ff = Math.max(f, 3);
    return { x: CW / 2 + (FOCAL * r) / ff, y: CH * 0.52 - (FOCAL * u) / ff, s: FOCAL / ff / 31, f };
  }
  const proj = (x, y) => P3(x, y, 0);

  function poly(pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }
  function line3(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  function gline(x0, y0, x1, y1) {
    ctx.beginPath();
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
    let started = false;
    for (let k = 0; k <= n; k++) {
      const u = k / n, p = proj(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
      if (p.f < 4) { started = false; continue; }
      started ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); started = true;
    }
    ctx.stroke();
  }
  function grect(x0, y0, x1, y1) { gline(x0, y0, x1, y0); gline(x1, y0, x1, y1); gline(x1, y1, x0, y1); gline(x0, y1, x0, y0); }
  function garc(x, y, r, a0, a1) {
    ctx.beginPath();
    for (let k = 0; k <= 40; k++) { const a = a0 + ((a1 - a0) * k) / 40; const p = proj(x + Math.cos(a) * r, y + Math.sin(a) * r); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.stroke();
  }
  function quad(a, b, cc, d, color) { ctx.fillStyle = color; poly([a, b, cc, d]); ctx.fill(); }

  // 観客席の高さ（試合の計算と同じ：壁 x=-9・114、y=-5 の向こうは、10mかけて3.2m→11.2mに上がる）
  function standZ(x, y) { const d = Math.max(-9 - x, x - 114, -5 - y, 0); return d > 0 ? 3.2 + 8 * Math.min(1, d / 10) : 0; }
  // ---- 版463：会場の格（0＝地域2部の市民グラウンド … 4＝D1の大きなスタジアム）。育成モードの試合で opts.venue で決まる ----
  let venue = 4;
  const VENUES = [
    { H: 2.4, fence: true, rise: 0, deep: 0, crowd: 0.12, far: null, ends: false, bank: true, ads: false, lights: false, roof: false },
    { H: 1.3, fence: false, rise: 2.4, deep: 4.5, crowd: 0.35, far: [22, 83], ends: false, bank: true, ads: false, lights: false, roof: false },
    { H: 2.0, fence: false, rise: 5, deep: 7, crowd: 0.6, far: [-9, 114], ends: false, bank: false, ads: true, lights: false, roof: true },
    { H: 3.2, fence: false, rise: 8, deep: 10, crowd: 0.85, far: [-9, 114], ends: true, bank: false, ads: true, lights: true, roof: false },
    { H: 3.2, fence: false, rise: 11, deep: 13, crowd: 1, far: [-9, 114], ends: true, bank: false, ads: true, lights: true, roof: true, screen: true },
  ];
  const hsh2 = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // スタジアムの壁（奥と、ゴールの裏）・スタンド・観客。会場の格で変わる
  function walls() {
    const V = VENUES[venue] || VENUES[4], H = V.H;
    const top = '#5d5a55', face = '#b9b4ab', face2 = '#a39e95';
    const segs = [];
    const add = (x0, y0, x1, y1, kind) => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
      for (let k = 0; k < n; k++) {
        const a = [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n], b = [x0 + ((x1 - x0) * (k + 1)) / n, y0 + ((y1 - y0) * (k + 1)) / n];
        const mx = (a[0] + b[0]) / 2;
        const stand = kind === 'far' ? !!(V.far && mx >= V.far[0] && mx <= V.far[1]) : V.ends;
        segs.push({ a, b, k, kind, stand });
      }
    };
    add(-9, -5, 114, -5, 'far');    // 奥
    add(-9, 73, -9, -5, 'end');     // 左ゴール裏
    add(114, -5, 114, 73, 'end');   // 右ゴール裏
    const outV = (s, d) => [s[0] + (s[0] < 0 ? -d : s[0] > 105 ? d : 0), s[1] + (s[1] < 0 ? -d : 0)];
    // 照明の塔（D2・D1）：スタンドの後ろ、四すみ
    if (V.lights) for (const [lx, ly] of [[-16, -16], [121, -16], [-20, 70], [125, 70]]) {
      const b0 = P3(lx, ly, 0), b1 = P3(lx, ly, 30); if (b0.f < 4 && b1.f < 4) continue;
      ctx.strokeStyle = '#7d8288'; ctx.lineWidth = Math.max(2, 3 * b1.s * 6); ctx.beginPath(); ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
      const w = 70 * b1.s * 3.2, h2 = 40 * b1.s * 3.2; ctx.fillStyle = '#3a3e44'; ctx.fillRect(b1.x - w / 2, b1.y - h2, w, h2); ctx.fillStyle = '#fff8d8'; for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) ctx.fillRect(b1.x - w / 2 + w * (0.06 + c * 0.235), b1.y - h2 + h2 * (0.1 + r * 0.3), w * 0.18, h2 * 0.22);
    }
    for (const s of segs) {
      const a0 = P3(s.a[0], s.a[1], 0), b0 = P3(s.b[0], s.b[1], 0);
      if (a0.f < 4 && b0.f < 4) continue;
      const a1 = P3(s.a[0], s.a[1], H), b1 = P3(s.b[0], s.b[1], H);
      if (V.bank && !s.stand) {   // 土手（芝の斜面）
        const a2 = P3(...outV(s.a, 9), 3.2), b2 = P3(...outV(s.b, 9), 3.2);
        quad(a2, b2, b0, a0, s.k % 2 ? '#5d9a33' : '#589530');
      }
      if (V.fence) {   // 金網（柱と網目）
        ctx.strokeStyle = 'rgba(210,215,215,0.55)'; ctx.lineWidth = 1;
        for (let q = 0; q <= 8; q++) { const u = q / 8, x = s.a[0] + (s.b[0] - s.a[0]) * u, y = s.a[1] + (s.b[1] - s.a[1]) * u, p0 = P3(x, y, 0), p1 = P3(x, y, H); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); }
        ctx.strokeStyle = '#9aa0a3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
        continue;
      }
      quad(a1, b1, b0, a0, s.k % 2 ? face : face2);
      if (V.ads && s.kind === 'far') { const AD = ['#1f8a44', '#f4f2ea', '#d8202a', '#1d3f8f', '#f2c21c']; const c0 = P3(s.a[0], s.a[1] + 1.2, 0), c1 = P3(s.b[0], s.b[1] + 1.2, 0), c2 = P3(s.b[0], s.b[1] + 1.2, 0.9), c3 = P3(s.a[0], s.a[1] + 1.2, 0.9); quad(c3, c2, c1, c0, AD[s.k % AD.length]); }
      if (s.stand) {   // スタンド（段々）
        const a2 = P3(...outV(s.a, V.deep), H + V.rise), b2 = P3(...outV(s.b, V.deep), H + V.rise);
        quad(a2, b2, b1, a1, top);
        if (V.roof && s.kind === 'far') { const a3 = P3(...outV(s.a, V.deep + 1), H + V.rise + 4), b3 = P3(...outV(s.b, V.deep + 1), H + V.rise + 4); quad(a3, b3, b2, a2, '#2c2f34'); const a4 = P3(...outV(s.a, V.deep * 0.35), H + V.rise + 3.6), b4 = P3(...outV(s.b, V.deep * 0.35), H + V.rise + 3.6); quad(a4, b4, b3, a3, '#d9dce0'); }
      } else if (!V.bank) {   // スタンドのない所は、壁の上に植え込み
        const a2 = P3(...outV(s.a, 4), H + 1.2), b2 = P3(...outV(s.b, 4), H + 1.2); quad(a2, b2, b1, a1, '#4a7d34');
      }
    }
    // 大型ビジョン（D1）：右のゴール裏の上
    if (V.screen) { const q0 = P3(124, 18, H + V.rise + 2), q1 = P3(124, 50, H + V.rise + 2), q2 = P3(124, 50, H + V.rise + 11), q3 = P3(124, 18, H + V.rise + 11); if (q0.f > 4 || q1.f > 4) { quad(q3, q2, q1, q0, '#15181c'); const m = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); quad(m(q3, q0, 0.1), m(q2, q1, 0.1), m(q2, q1, 0.9), m(q3, q0, 0.9), '#1f5fb0'); } }
    // 観客：画面の外は描かない。色ごとにまとめて1回で塗る（毎コマ数千回の塗りを減らして軽く）
    const CROWD_COL = ['#d94a3a', '#2f6fd6', '#f2c230', '#ffffff', '#3d7a3d', '#e07a2f', '#f1c69a'];
    const paths = CROWD_COL.map(() => new Path2D()), hair = new Path2D();
    const rows = V.fence || V.bank ? 1 : Math.max(2, Math.round(V.deep / 1.0));   /* 版761：段は約1mごと（前は2.6mごとで、まばらに見えた） */
    for (const s of segs) {
      if (!s.stand && !(V.bank && s.kind === 'far')) continue;
      const e0 = P3(s.a[0], s.a[1], H + 4), e1 = P3(s.b[0], s.b[1], H + 4);
      if ((e0.f < 4 && e1.f < 4) || (e0.x < -40 && e1.x < -40) || (e0.x > CW + 40 && e1.x > CW + 40) || (e0.y > CH + 20 && e1.y > CH + 20) || (e0.y < -60 && e1.y < -60)) continue;
      const nq = 14;   /* 1区間（約8m）に14席＝約0.6mごと */
      for (let q = 0; q < nq; q++) {
        const u = (q + 0.5) / nq;
        for (let row = 0; row < rows; row++) {
          if (hsh2(s.k * 97 + q + (s.kind === 'end' ? (s.a[0] < 0 ? 5000 : 9000) : 0), row) > V.crowd) continue;   // 空いている席
          const out = s.stand ? 1.5 + row * (V.deep - 1.5) / Math.max(1, rows) : 2.2;
          const x = s.a[0] + (s.b[0] - s.a[0]) * u + (s.a[0] < 0 && s.b[0] < 0 ? -out : s.a[0] > 105 && s.b[0] > 105 ? out : 0);
          const y = s.a[1] + (s.b[1] - s.a[1]) * u + (s.a[1] < 0 && s.b[1] < 0 ? -out : 0);
          const z = s.stand ? H + 1.5 + row * (V.rise - 0.5) / Math.max(1, rows) : 1.2;
          const p = P3(x, y, z);
          if (p.f < 4 || p.y < -10 || p.y > CH || p.x < -10 || p.x > CW + 10) continue;
          /* 版761：観客を人の大きさで描く（前は0.2mくらいの点だった）。体（服の色）・顔・髪のドット */
          const m = 31 * p.s, bw = Math.max(2, 0.5 * m), bh = Math.max(2, 0.42 * m), hw = Math.max(1.5, 0.3 * m), hh = Math.max(1.5, 0.3 * m);
          const seed = (s.k * 31 + q * 7 + row * 13) % 6, bob = ((s.k + q + row) % 3) * 0.04 * m;
          paths[seed].rect(p.x - bw / 2, p.y - bh - bob, bw, bh);
          paths[6].rect(p.x - hw / 2, p.y - bh - hh - bob, hw, hh);
          hair.rect(p.x - hw / 2, p.y - bh - hh - bob, hw, hh * 0.38);
        }
      }
    }
    paths.forEach((pa, k) => { ctx.fillStyle = CROWD_COL[k]; ctx.fill(pa); }); ctx.fillStyle = '#3a2a1e'; ctx.fill(hair);
  }

  // 版607：はげ跡の形（会場ごとに一度だけ作る）
  const blobCache = {};
  function groundBlobs(v) {
    if (blobCache[v]) return blobCache[v];
    let s = 9173 + v * 31; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const out = [];
    const heavy = v === 0;
    // はげやすい所：真ん中、ゴール前、両サイドのライン際、ペナルティエリアの前
    const hot = heavy ? [[52.5, 34, 14, 1.4], [6, 34, 9, 1.5], [99, 34, 9, 1.5], [17, 34, 9, 1], [88, 34, 9, 1], [30, 34, 18, 0.9], [75, 34, 18, 0.9], [52.5, 6, 30, 0.6], [52.5, 62, 30, 0.6]]
      : [[52.5, 34, 6, 1], [5, 34, 6, 1.1], [100, 34, 6, 1.1]];
    const N = heavy ? 230 : 40;
    const blob = (cx, cy, rad, col) => { const n = 12, ph = r() * 6, ell = 0.6 + r() * 0.8, v2 = []; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, rr = rad * (0.45 + r() * 0.75); v2.push([Math.cos(a + ph) * rr * ell, Math.sin(a + ph) * rr / ell * 0.85]); } out.push({ x: cx, y: cy, v: v2, col }); };
    for (let k = 0; k < N; k++) {
      let x, y;
      if (r() < (heavy ? 0.25 : 0)) { x = -3 + r() * 111; y = -2 + r() * 72; }   // 全体にちらばる
      else { const h = hot[Math.floor(r() * hot.length)], a = r() * 6.283, d = Math.sqrt(r()) * h[2]; x = h[0] + Math.cos(a) * d * 1.2; y = h[1] + Math.sin(a) * d * (h[2] > 20 ? 0.25 : 1); }
      const big = heavy ? 0.7 + r() * 2.6 : 0.5 + r() * 1.3;
      blob(x, y, big, heavy ? (r() < 0.6 ? 'rgba(176,146,84,0.82)' : 'rgba(160,136,78,0.7)') : 'rgba(170,140,82,0.45)');
      if (heavy && r() < 0.5) blob(x + (r() - 0.5) * big * 2, y + (r() - 0.5) * big * 2, big * 0.5, 'rgba(196,170,104,0.75)');   // 乾いた明るい土
    }
    if (heavy) for (let k = 0; k < 160; k++) blob(-3 + r() * 111, -2 + r() * 72, 0.25 + r() * 0.45, 'rgba(170,144,86,0.7)');   // 小さなはげ
    blobCache[v] = out; return out;
  }
  function pitch() {
    ctx.fillStyle = venue <= 1 ? '#3f6d2c' : '#6b6862'; ctx.fillRect(0, 0, CW, CH);
    // 芝（ピッチの外側も芝）。会場の格で、芝の質が変わる
    const GR = [['#5aa22a', '#5aa22a'], ['#4c9f26', '#55a72c'], ['#43a020', '#4cab24'], ['#3f9b1b', '#4aaa22'], ['#3c9a18', '#4bae22']][venue] || ['#3f9b1b', '#4aaa22'];
    quad(proj(-9, -5), proj(114, -5), proj(114, 90), proj(-9, 90), GR[0]);
    const cs = 105 / 12;
    if (venue >= 1) for (let i = -1; i < 13; i++) for (let j = -1; j < 10; j++) {   // 版608：地域2部はしま模様なし
      if (venue <= 2 ? i % 2 === 0 : (i + j) % 2 === 0) continue;   // 地域1部・D3はしま模様、D2・D1は市松模様の刈り込み
      const x0 = i * cs, y0 = j * (68 / 8), x1 = x0 + cs, y1 = y0 + 68 / 8;
      const a = proj(x0, y0); if (a.f < 3 && proj(x1, y1).f < 3) continue;
      quad(a, proj(x1, y0), proj(x1, y1), proj(x0, y1), GR[1]);
    }
    if (venue <= 1) {   // 市民グラウンド：ゴール前と真ん中の芝がはげて土が見える
      const patch = (x, y, rx, ry, col) => {   // 版606：だ円の周りの点を1つずつ地面に写して描く（カメラが近い時に、画面いっぱいの茶色にならないように）
        const pts = []; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, q = proj(x + Math.cos(a) * rx, y + Math.sin(a) * ry); if (!(q.f >= 4) || !isFinite(q.x) || !isFinite(q.y)) return; pts.push(q); }
        const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y); if (Math.max(...xs) - Math.min(...xs) > CW * 0.9 || Math.max(...ys) - Math.min(...ys) > CH * 0.9) return;
        ctx.fillStyle = col; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.fill(); };
      // 版607：はげ跡（地域2部はガッツリ、地域1部は少し）。形は世界座標で一度だけ作り、毎回地面に写して描く
      const B = groundBlobs(venue);
      for (const bl of B) {
        const pts = []; let ok = true;
        for (const [dx, dy] of bl.v) { const q = proj(bl.x + dx, bl.y + dy); if (!(q.f >= 4) || !isFinite(q.x)) { ok = false; break; } pts.push(q); }
        if (!ok) continue;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
        if (x1 < 0 || x0 > CW || y1 < 0 || y0 > CH || x1 - x0 > CW * 0.9 || y1 - y0 > CH * 0.9) continue;
        ctx.fillStyle = bl.col; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.fill();
      }
    }
    walls();
    // ライン
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(2, 2.4 * proj(cam.x, cam.y).s);
    ctx.lineJoin = 'round';
    grect(0, 0, 105, 68);
    gline(52.5, 0, 52.5, 68);
    garc(52.5, 34, 9.15, 0, Math.PI * 2);
    for (const left of [true, false]) {
      const gx = left ? 0 : 105, d = left ? 1 : -1;
      grect(gx, 13.84, gx + d * 16.5, 54.16);
      grect(gx, 24.84, gx + d * 5.5, 43.16);
      garc(gx + d * 11, 34, 9.15, left ? -0.93 : Math.PI - 0.93, left ? 0.93 : Math.PI + 0.93);
      const ps = proj(gx + d * 11, 34);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ps.x, ps.y, 3 * ps.s + 1, 1.3 * ps.s + 0.6, 0, 0, 7); ctx.fill();
    }
    // コーナーアーク
    for (const [x, y] of [[0, 0], [105, 0], [0, 68], [105, 68]]) garc(x, y, 1, x ? (y ? Math.PI : Math.PI / 2) : (y ? -Math.PI / 2 : 0), x ? (y ? Math.PI * 1.5 : Math.PI) : (y ? 0 : Math.PI / 2));
  }

  // ゴールのネットと枠を「面」ごとに描く：奥の横ネット far・後ろのネット back・天井 roof・手前の横ネット near・柱とバー frame
  // ボールがゴールのそばにある時は、カメラからボールへの視線をさえぎる面だけをボールの手前に描く（柱やネットの向こうにボールが見えないように）
  let goalDefer = null;   // { gx, before: [ボールより先に描く手前の面], after: [ボールの後に描く奥の面] }
  const GOAL_DEP = 2.6;
  function goalOcclusion(bx, by, bz) {
    const GP = D.CONST.POST, h = D.CONST.BAR, hb = h * 0.92;
    const gx = bx < 52.5 ? 0 : 105, d = gx === 0 ? -1 : 1, behind = (bx - gx) * d;
    if (behind < -3 || behind > GOAL_DEP + 3 || Math.abs(by - 34) > GP + 4) return null;   // ゴールのそば（ラインの手前3mまで含む）は、視線で前後を決める（柱は奥と手前で深さが違うので、ゴール中央の深さでは決められない）
    const C = [B.cx, B.cy, B.cz], P = [bx, by, (bz || 0) + 0.11], V = [P[0] - C[0], P[1] - C[1], P[2] - C[2]];
    const at = (t) => [C[0] + V[0] * t, C[1] + V[1] * t, C[2] + V[2] * t];
    const tPlane = (k, val) => { const t = (val - C[k]) / (V[k] || 1e-9); return t > 0 && t < 0.999 ? t : null; };
    const roofZ = (x) => h + (hb - h) * Math.max(0, Math.min(1, (x - gx) * d / GOAL_DEP));
    const inDepth = (x) => { const b = (x - gx) * d; return b > 0 && b < GOAL_DEP; };
    const yNear = 34 + GP * Math.sign(C[1] - 34 || 1), yFar = 34 - GP * Math.sign(C[1] - 34 || 1);
    const hit = {};
    { const t = tPlane(1, yNear); if (t != null) { const q = at(t); hit.near = inDepth(q[0]) && q[2] < roofZ(q[0]); } }
    { const t = tPlane(1, yFar); if (t != null) { const q = at(t); hit.far = inDepth(q[0]) && q[2] < roofZ(q[0]); } }
    { const t = tPlane(0, gx + d * GOAL_DEP); if (t != null) { const q = at(t); hit.back = Math.abs(q[1] - 34) < GP && q[2] < hb; } }
    { // 天井：視線と傾いた天井面の交わり
      const f = (t) => { const q = at(t); return q[2] - roofZ(q[0]); }, f0 = f(0), f1 = f(0.999);
      if ((f0 > 0) !== (f1 > 0)) { const t = f0 / (f0 - f1) * 0.999, q = at(t); hit.roof = inDepth(q[0]) && Math.abs(q[1] - 34) < GP; } }
    { // 柱とバー：画面の上でボール（ドット絵の大きさ）と重なっていて、しかもボールのほうが柱・バーより奥にある時だけ、柱・バーを手前に描く
      const pb = P3(bx, by, (bz || 0) + 0.11), rb = Math.max(5.5, 9 * proj(bx, by).s), pw = Math.max(4, 5.6 * proj(gx, 34).s) / 2;
      const segD = (a, c) => { const vx = c.x - a.x, vy = c.y - a.y, l2 = vx * vx + vy * vy || 1, u = Math.max(0, Math.min(1, ((pb.x - a.x) * vx + (pb.y - a.y) * vy) / l2)); return { d: Math.hypot(a.x + vx * u - pb.x, a.y + vy * u - pb.y), u }; };
      const fBall = pb.f; let fr = false;
      for (const py of [34 - GP, 34 + GP]) { const a = P3(gx, py, 0), c = P3(gx, py, h), sd = segD(a, c); if (sd.d < rb + pw && fBall > P3(gx, py, h * sd.u).f + 0.05) fr = true; }
      { const a = P3(gx, 34 - GP, h), c = P3(gx, 34 + GP, h), sd = segD(a, c); if (sd.d < rb + pw && fBall > P3(gx, 34 - GP + 2 * GP * sd.u, h).f + 0.05) fr = true; }
      hit.frame = fr; }
    // ゴールの口を通って中に入った球は、柱・バーの向こうには描かない。手前の横ネットも、入った直後（奥へ0.6m未満）はボールの奥に描く
    //  （ドット絵のボールは実際より大きいので、厳密な視線の計算だと「柱の向こう」に見えてしまう）
    if (Math.abs(by - 34) < GP && (bz || 0) < h) { hit.frame = false; if (behind < 0.6) hit.near = false; }
    if (behind > 0 && behind < GOAL_DEP && Math.abs(by - 34) < GP && (bz || 0) < roofZ(bx) + 0.05) { hit.frame = false; if (hit.roof) hit.roofIn = true; }   // ゴールの中のボールは、天井のネットの下（見下ろすカメラからは、天井の網ごしに見える）
    const before = ['near', 'frame'].filter((k) => !hit[k]), after = ['far', 'back', 'roof'].filter((k) => hit[k]);
    return { gx, before, after };
  }
  function goalParts() {
    // ネットと後ろの枠は奥に、柱とバー（ゴールの口）はゴールラインの位置に
    return [0, 105].flatMap((gx) => {
      const g = goalDefer && goalDefer.gx === gx ? goalDefer : null;
      const back = ['far', 'back', 'roof'].filter((k) => !(g && g.after.includes(k))), front = ['near', 'frame'].filter((k) => !(g && g.before.includes(k)));
      return [{ f: proj(gx, 34).f + 1.5, draw: () => goalDraw(gx, back) }, { f: proj(gx, 34).f - 0.05, draw: () => goalDraw(gx, front) }];
    });
  }
  function goalDraw(gx, parts) {
    // カルチョビットA風：箱型のゴール。細かい四角い網目のネットと、太くて立体的なグレーの柱
    if (typeof parts === 'string') parts = parts === 'front' ? ['near', 'frame'] : ['far', 'back', 'roof'];
    const has = (k) => parts.includes(k);
    const GP = D.CONST.POST, d = gx === 0 ? -1 : 1, dep = GOAL_DEP, bx = gx + d * dep, y0 = 34 - GP, y1 = 34 + GP, h = D.CONST.BAR, hb = h * 0.92;
    const s0 = proj(gx, 34).s;
    const seg = (a, b) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
    const face = 'rgba(255,255,255,0.10)', cell = 0.32, nz = Math.round(hb / cell), nd = Math.round(dep / cell), ny = Math.round((y1 - y0) / cell);
    const netStroke = () => { ctx.strokeStyle = 'rgba(255,255,255,0.78)'; ctx.lineWidth = Math.max(0.6, 0.55 * s0); ctx.stroke(); };
    const rim = (fn) => { ctx.lineCap = 'round'; ctx.strokeStyle = '#8f8f9c'; ctx.lineWidth = Math.max(1.2, 1.3 * s0); ctx.beginPath(); fn(); ctx.stroke(); ctx.lineCap = 'butt'; };
    // 横のネット（y = sy の面）
    const sideNet = (sy) => {
      quad(P3(gx, sy, h), P3(bx, sy, hb), P3(bx, sy, 0), P3(gx, sy, 0), face);
      ctx.beginPath();
      for (let k = 1; k < nd; k++) { const u = k / nd, x = gx + (bx - gx) * u, zt = h + (hb - h) * u; seg(P3(x, sy, 0), P3(x, sy, zt)); }
      for (let k = 1; k < nz; k++) { const z = (hb * k) / nz, zf = (h * k) / nz; seg(P3(gx, sy, zf), P3(bx, sy, z)); }
      netStroke();
      rim(() => { seg(P3(gx, sy, h), P3(bx, sy, hb)); seg(P3(bx, sy, hb), P3(bx, sy, 0)); seg(P3(gx, sy, 0), P3(bx, sy, 0)); });
    };
    const camNear = B.cy > 34 ? y1 : y0, camFar = camNear === y1 ? y0 : y1;
    if (has('far')) sideNet(camFar);
    if (has('back') || has('roof')) {
      // ネットの揺れ：ボールが当たった所が外へふくらみ、波打ってから元に戻る
      let off = null;
      const g = goals.find((q) => q.net && q.net.gx === gx && simT >= q.net.t0 - 0.02 && simT < q.net.t0 + 3.2);
      if (g) {
        const n = g.net, b = stateAt(simT).ball, bd = gx === 0 ? -b.x : b.x - 105;
        const inside = bd > 0 && Math.abs(b.y - 34) < GP + 0.4 && simT < n.settle + 0.3;
        const cy = inside ? b.y : n.y, cz = inside ? Math.max(0.3, b.z) : Math.max(0.3, n.z);
        const push = inside ? Math.max(0, Math.min(0.85, bd - (dep - 0.8))) : 0;
        const t = simT - n.tb, A = t > 0 ? Math.min(0.75, n.sp / 38) * Math.exp(-2.3 * t) * Math.cos(15 * t) : 0;
        const sg = 0.75 + Math.max(0, t) * 0.9;
        if (push > 0.01 || Math.abs(A) > 0.01) off = (y, z) => (push + A) * Math.exp(-((y - cy) ** 2 + (z - cz) ** 2) / (2 * sg * sg));
      }
      const BP = (y, z) => P3(off ? bx + d * off(y, z) : bx, y, z);
      const polyl = (fn, n) => { let p = fn(0); ctx.moveTo(p.x, p.y); for (let i = 1; i <= n; i++) { p = fn(i / n); ctx.lineTo(p.x, p.y); } };
      if (has('back')) {
        quad(P3(bx, y0, hb), P3(bx, y1, hb), P3(bx, y1, 0), P3(bx, y0, 0), face);
        ctx.beginPath();
        for (let k = 1; k < ny; k++) { const y = y0 + ((y1 - y0) * k) / ny; if (off) polyl((u) => BP(y, hb * u), 10); else seg(P3(bx, y, 0), P3(bx, y, hb)); }
        for (let k = 1; k < nz; k++) { const z = (hb * k) / nz; if (off) polyl((u) => BP(y0 + (y1 - y0) * u, z), 16); else seg(P3(bx, y0, z), P3(bx, y1, z)); }
        netStroke();
        rim(() => { seg(P3(bx, y0, hb), P3(bx, y1, hb)); seg(P3(bx, y0, hb), P3(bx, y0, 0)); seg(P3(bx, y1, hb), P3(bx, y1, 0)); seg(P3(bx, y0, 0), P3(bx, y1, 0)); });
      }
      if (has('roof')) {
        quad(P3(gx, y0, h), P3(gx, y1, h), P3(bx, y1, hb), P3(bx, y0, hb), face);
        ctx.beginPath();
        for (let k = 1; k < ny; k++) { const y = y0 + ((y1 - y0) * k) / ny; seg(P3(gx, y, h), BP(y, hb)); }
        for (let k = 1; k < nd; k++) { const u = k / nd, x = gx + (bx - gx) * u, zt = h + (hb - h) * u; seg(P3(x, y0, zt), P3(x, y1, zt)); }
        netStroke();
        rim(() => { seg(P3(gx, y0, h), P3(bx, y0, hb)); seg(P3(gx, y1, h), P3(bx, y1, hb)); });
      }
    }
    if (has('near')) sideNet(camNear);   // 手前（カメラ側）の横のネット
    if (has('frame')) {
      // ゴールの柱とバー：太く、影の側を濃いグレー・光の側を明るいグレーで立体的に
      const pw = Math.max(4, 5.6 * s0);
      ctx.lineCap = 'round';
      const frame = () => { ctx.beginPath(); seg(P3(gx, y0, 0), P3(gx, y0, h)); seg(P3(gx, y1, 0), P3(gx, y1, h)); seg(P3(gx, y0, h), P3(gx, y1, h)); };
      ctx.strokeStyle = '#6e6e7a'; ctx.lineWidth = pw + 2; frame(); ctx.stroke();
      ctx.strokeStyle = '#c9c9d3'; ctx.lineWidth = pw; frame(); ctx.stroke();
      ctx.save(); ctx.translate(-pw * 0.18, -pw * 0.18); ctx.strokeStyle = '#f4f4f8'; ctx.lineWidth = pw * 0.4; frame(); ctx.stroke(); ctx.restore();
      ctx.lineCap = 'butt';
    }
  }

  // ちびキャラのドット絵（14×18ドット）。向きは 横（右向きで描いて左は反転）・正面・背中 の3種類
  //  頭9段・胴5段・脚4段。走りは4コマ（踏み出し→足が揃う→逆の踏み出し→揃う）、脚は体の下で前後に動かす
  const HEAD = [
    '....OOOOOO....',
    '...OHHHHHHO...',
    '..OHHHHHHHHO..',
    '.OHHHHHHHHHHO.',
    '.OHHHHSSSSSSO.',
    '.OHHSSSSESSEO.',
    '.OHSSSSSESSEO.',
    '..OSSSSSSSMSO.',
    '...OOSSSSOO...',
  ];
  const HEAD_SHORT = HEAD.slice(); HEAD_SHORT[4] = '.OHHSSSSSSSSO.';
  const HEAD_LONG = HEAD.slice(); HEAD_LONG[7] = '.OHSSSSSSSMSO.'; HEAD_LONG[8] = '.OHOOSSSSOO...';
  const HEAD_F = [
    '....OOOOOO....',
    '...OHHHHHHO...',
    '..OHHHHHHHHO..',
    '.OHHHHHHHHHHO.',
    '.OHHSSSSSSHHO.',
    '.OHSSESSESSHO.',
    '.OSSSESSESSSO.',
    '..OSSSMMSSSO..',
    '...OOSSSSOO...',
  ];
  const HEAD_F_SHORT = HEAD_F.slice(); HEAD_F_SHORT[4] = '.OHSSSSSSSSHO.';
  const HEAD_F_LONG = HEAD_F.slice(); HEAD_F_LONG[6] = '.OHSSESSESSHO.'; HEAD_F_LONG[7] = '.OHSSSMMSSSHO.';
  const HEAD_B = [
    '....OOOOOO....',
    '...OHHHHHHO...',
    '..OHHHHHHHHO..',
    '.OHHHHHHHHHHO.',
    '.OHHHHHHHHHHO.',
    '.OHHHHHHHHHHO.',
    '.OSHHHHHHHHSO.',
    '..OSHHHHHHSO..',
    '...OOSSSSOO...',
  ];
  const HEAD_B_LONG = HEAD_B.slice(); HEAD_B_LONG[7] = '..OHHHHHHHHO..'; HEAD_B_LONG[8] = '...OOHHHHOO...';
  const BODY = [            // 横
    '....OWWWWWO...',
    '...OWWLWWWDO..',
    '...OWWWWWWDO..',
    '....OPPPPPO...',
    '....OPPPPPO...',
  ];
  const BODY_F = [          // 正面
    '...OWWWWWWO...',
    '..OWWWLLWWWO..',
    '..OWWWWWWWWO..',
    '...OPPPPPPO...',
    '...OPPOOPPO...',
  ];
  const BODY_B = [          // 背中（背番号の帯）
    '...OWWWWWWO...',
    '..OWWDDDDWWO..',
    '..OWWWDDWWWO..',
    '...OPPPPPPO...',
    '...OPPOOPPO...',
  ];
  const LEGS = {
    // 横向き（1段目は膝＝肌、2〜3段目はソックス、4段目はスパイク）
    idle: ['.....OSSSO....', '.....OKKKO....', '.....OKKKO....', '.....OBBBBO...'],
    a: ['.....OSSSO....', '....OKO.OKO...', '...OKO..OKO...', '..OBBO..OBBO..'],
    b: ['.....OSSSSO...', '.....OKO.OKO..', '.....OKO.OBO..', '....OBBO......'],
    d: ['.....OSSSO....', '...OKOOKO.....', '..OBO.OKO.....', '......OBBO....'],
    walk: ['.....OSSSO....', '....OKO.OKO...', '....OKO.OKO...', '...OBBO.OBBO..'],
    windup: ['.....OSSSO....', '...OKKOOKO....', '.OBBO...OKO...', '........OBBO..'],
    kick: ['.....OSSSSSSO.', '.....OKO..OBBO', '.....OKO......', '....OBBO......'],
    // 正面・背中（脚はまっすぐ体の下）
    fidle: ['....OSO.OSO...', '....OKO.OKO...', '....OKO.OKO...', '...OBBO.OBBO..'],
    f0: ['....OSO.OSO...', '....OKO.OKO...', '...OBBO.OKO...', '........OBBO..'],
    f2: ['....OSO.OSO...', '....OKO.OKO...', '....OKO.OBBO..', '...OBBO.......'],
  };
  const SKIN = ['#f7c99c', '#e0a46e', '#a06a44'];
  const HAIR = ['#2a2420', '#7a4a22', '#e6b452', '#4a3426', '#c0492f'];
  const hairOf = (info) => (typeof info.hairColor === 'string' ? info.hairColor : HAIR[info.hairColor || 0]);   // 顔の絵がある選手は、その髪の色（#rrggbb）
  const TEAM = [
    { W: '#2f6fd6', L: '#6ea2f2', D: '#1d4796', P: '#ffffff', K: '#2f6fd6' },
    { W: '#e2453a', L: '#f78a80', D: '#a12a22', P: '#ffffff', K: '#e2453a' },
  ];
  // ユニフォーム（育成モード）：試合ごとに両チームの色と柄をセット。なければ青と赤
  const TEAM_DEF = TEAM.map((c) => ({ ...c }));
  TEAM[2] = { ...TEAM_DEF[0] };   // 版644：塗り替え用の無地の青（スタッフ・事務所の人・コーチは、チームのユニフォームに関係なくこれを元に塗る）
  const hexMul = (h, k) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');
  function kitCol(k) { return { W: k.shirt, L: hexMul(k.shirt, 1.3), D: hexMul(k.shirt, 0.65), P: k.shorts, K: k.socks, pat: k.pat || 'solid', S: k.sub || k.shirt }; }
  function applyKits(kits) {
    for (const t of [0, 1]) { TEAM[t] = kits && kits[t] ? kitCol(kits[t]) : { ...TEAM_DEF[t] }; TEAM_MAIN[t] = TEAM[t].W; TEAM_DARK[t] = TEAM[t].D; }
    for (const t of [0, 1]) { const g = kits && kits[t] && kits[t].gk; GKC[t] = g ? { ...kitCol({ ...g, pat: 'solid' }), pat: 'solid' } : { ...GKC_DEF[t] }; }   // 版651：GKのユニフォーム
  }
  // 設定画面の見本用：ユニフォームを着た選手の絵（正面・ななめ）
  function kitSprite(kit, info, view) {
    if (!DM.on || !window.DotMan) return null;
    const col = kitCol(kit), VA = { side: 0, f34: Math.PI / 4, front: Math.PI / 2, b34: -Math.PI / 4, back: -Math.PI / 2 };
    const o = { facing: VA[view] ?? Math.PI / 2, shirt: col.W, shorts: col.P, socks: col.K, hair: hairOf(info), skin: SKIN[info.skin || 0], pose: 'stand', frame: 0 };
    if (col.pat !== 'solid') { o.pat = col.pat; o.sub = col.S; }
    const F = DotMan.frame(o), cv = document.createElement('canvas'); cv.width = SPR_W; cv.height = SPR_H;
    cv.getContext('2d').drawImage(F.cv, F.px - 9, F.py - 24, SPR_W, SPR_H, 0, 0, SPR_W, SPR_H);
    return cv;
  }
  const GKC = [
    { W: '#f2c230', L: '#ffe27a', D: '#b08a12', P: '#2a2a2a', K: '#f2c230' },
    { W: '#2fb36a', L: '#7ddca4', D: '#1d7a48', P: '#2a2a2a', K: '#2fb36a' },
  ];
  const GKC_DEF = GKC.map((c) => ({ ...c }));
  // ---------- 選手のドット絵（カルチョビットA風：大きな丸い頭・短い手足・太い縁取り） ----------
  // 部品（頭・髪・胴・腕・脚）を組み立てて 20×26 ドットの絵を作り、縁取りを自動で付けてキャッシュする
  // 向きは5種（side 横 / f34 斜め前 / front 正面 / b34 斜め後ろ / back 背中）＋左右反転で8方向
  const SPR_W = 18, SPR_H = 24;
  const sprCache = new Map();
  { const set0 = sprCache.set.bind(sprCache); sprCache.set = (k, v) => { set0(k, v); if (sprCache.size > 1500) { let n = 400; for (const [key, c] of sprCache) { sprCache.delete(key); if (c && c.width) { c.width = 0; c.height = 0; } if (--n <= 0) break; } } return sprCache; }; }   // 絵のため込みすぎを防ぐ
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  // カルチョビットA風：横長で丸い頭（髪＋縦長の黒目2つだけの顔）、なで肩で裾が広がるシャツ、短い腕と脚
  // 頭は 10×8 の丸い頭、胴 8段、脚 4段（頭は全体の4割弱。カルチョビットAの頭身に合わせる）
  const HEADS = {
    front: ['..HHHHHH..', '.HHHhhHHH.', 'HHHHHHHHHH', 'HHSSSSSSHH', 'HSSSSSSSSH', 'SSESSSSESS', 'SSESSSSESS', '.ssssssss.'],
    f34: ['..HHHHHH..', '.HHHHhhHH.', 'HHHHHHHHHH', 'HHHSSSSSSH', 'HHSSSSSSSS', 'HHSSSESSES', '.HSSSESSES', '..sssssss.'],
    side: ['..HHHHHH..', '.HHHHHhhH.', 'HHHHHHHHHH', 'HHHHHHSSSH', 'HHHHHSSSSS', 'HHHHSsSSES', '.HHHSsSSES', '..HHsssss.'],
    b34: ['..HHHHHH..', '.HHHHHhhH.', 'HHHHHHHHHH', 'HHHHHHHHHH', 'HHHHHHHHHH', 'HHHHHHHHHS', '.HHHHHHHHS', '..HHHHHss.'],
    back: ['..HHHHHH..', '.HHHhhHHH.', 'HHHHHHHHHH', 'HHHHHHHHHH', 'HHHHHHHHHH', 'HHHHHHHHHH', '.HHHHHHHH.', '..HssssH..'],
  };
  const BODY_FRONT = ['...WWWWWW...', '..WWWWWWWW..', '.WWWWWWWWWW.', 'SWWWWWWWWWWS', '..WWWWWWWW..', '..WWWWWWWW..', '..PPPPPPPP..', '..PPP..PPP..'];
  const BODY_SIDE = ['....WWWW....', '...WWWWWW...', '...WWWWWW...', '...WWWWWW...', '...WWWWWW...', '...WWWWWW...', '...PPPPPP...', '...PPPPPP...'];
  function genSprite(o) {
    const W2 = SPR_W, H2 = SPR_H, OX = 3, OY = 2;          // 頭の左上が(3,2)。上に髪の毛先・縁取り・上下動の余白
    const g = Array.from({ length: H2 }, () => Array(W2).fill(null));
    const C = o.col, SK = o.skin, HR = o.hair;
    const pal = { H: HR, h: shade(HR, 0.35), S: SK, s: shade(SK, -0.12), E: '#231c1c', W: C.W, D: C.D, L: C.L, P: C.P, K: C.K, B: '#2b2b2b', b: '#4a4a4a' };
    const v = o.view, f = o.frame % 4, run = o.run, pose = o.pose;
    const put = (x, y, ch) => { x += OX; y += OY; if (x >= 0 && x < W2 && y >= 0 && y < H2 && ch && ch !== '.') g[y][x] = pal[ch] || ch; };
    // 技用の姿勢：lunge（大きく踏み込む）・sole（足裏でボールを引く/押さえる）・bigWindup（大きく振りかぶる）・follow（振り抜く）・crouch（腰を落とす）
    const SP = { lunge: 1, sole: 1, bigWindup: 1, follow: 1, crouch: 1 };
    const bob = SP[pose] ? (pose === 'lunge' || pose === 'crouch' ? 1 : 0) : run && (f === 1 || f === 3) ? -1 : 0;
    const lean = v === 'side' && run && o.fast && !SP[pose] ? 1 : pose === 'kick' || pose === 'sole' || pose === 'follow' ? -1 : pose === 'lunge' ? 1 : pose === 'bigWindup' ? -1 : 0;
    // ---- 脚（16段目ソックス・17段目スパイク）----
    const L = (x, y, ch) => put(x, y, ch);
    if (v === 'side') {
      if (pose === 'lunge') {        // 前後に大きく開いた脚（後ろ足で地面を蹴り、前足を踏み込む）
        L(3, 15, 'K'); L(2, 15, 'K'); L(1, 16, 'K'); L(0, 16, 'K'); L(-1, 17, 'B'); L(0, 17, 'B'); L(-2, 17, 'B');
        L(8, 15, 'K'); L(9, 15, 'K'); L(10, 16, 'K'); L(11, 16, 'K'); for (const x of [10, 11, 12, 13]) L(x, 17, 'B');
      } else if (pose === 'sole') {  // 軸足で立ち、反対の足の裏をボールに乗せる
        L(3, 16, 'K'); L(4, 16, 'K'); for (const x of [3, 4, 5]) L(x, 17, 'B');
        L(7, 15, 'K'); L(8, 15, 'K'); L(9, 15, 'K'); L(10, 15, 'B'); L(11, 15, 'B'); L(10, 16, 'B'); L(11, 16, 'b');
      } else if (pose === 'bigWindup') {   // 蹴り足を後ろ高くまで振り上げる
        L(6, 16, 'K'); L(7, 16, 'K'); for (const x of [6, 7, 8]) L(x, 17, 'B');
        L(3, 15, 'K'); L(2, 14, 'K'); L(1, 13, 'K'); L(0, 12, 'K'); L(-1, 11, 'K'); L(-2, 10, 'B'); L(-3, 10, 'B'); L(-2, 9, 'B'); L(-3, 9, 'b');
      } else if (pose === 'follow') {  // 振り抜いた足が前に高く上がる
        L(3, 16, 'K'); L(4, 16, 'K'); for (const x of [3, 4, 5]) L(x, 17, 'B');
        L(8, 14, 'K'); L(9, 13, 'K'); L(10, 12, 'K'); L(11, 11, 'K'); L(12, 10, 'K'); L(13, 9, 'B'); L(14, 9, 'B'); L(13, 8, 'B'); L(14, 8, 'b');
      } else if (pose === 'crouch') {  // 腰を落として、脚を左右に開く
        L(2, 16, 'K'); L(3, 16, 'K'); L(1, 17, 'B'); L(2, 17, 'B'); L(3, 17, 'B');
        L(8, 16, 'K'); L(9, 16, 'K'); L(8, 17, 'B'); L(9, 17, 'B'); L(10, 17, 'B');
      } else if (pose === 'windup') { L(5, 16, 'K'); L(6, 16, 'K'); for (const x of [5, 6, 7]) L(x, 17, 'B'); L(3, 15, 'K'); L(4, 15, 'K'); L(1, 14, 'B'); L(2, 14, 'B'); L(1, 15, 'B'); }
      else if (pose === 'kick') { L(4, 16, 'K'); L(5, 16, 'K'); for (const x of [4, 5, 6]) L(x, 17, 'B'); L(7, 15, 'K'); L(8, 15, 'K'); L(9, 14, 'K'); L(10, 14, 'K'); L(11, 13, 'B'); L(12, 13, 'B'); L(11, 14, 'B'); L(12, 14, 'b'); }
      else if (run && (f === 0 || f === 2)) { L(3, 16, 'K'); L(4, 16, 'K'); L(7, 16, 'K'); L(8, 16, 'K'); L(2, 17, 'B'); L(3, 17, 'B'); for (const x of [8, 9, 10]) L(x, 17, 'B'); }
      else if (run) { L(5, 16, 'K'); L(6, 16, 'K'); for (const x of [5, 6, 7]) L(x, 17, 'B'); if (f === 1) { L(3, 16, 'B'); L(4, 16, 'B'); } else { L(8, 16, 'B'); L(9, 16, 'B'); } }
      else { L(4, 16, 'K'); L(5, 16, 'K'); L(6, 16, 'K'); for (const x of [4, 5, 6, 7]) L(x, 17, 'B'); }
    } else {
      const sh = v === 'f34' ? 1 : v === 'b34' ? -1 : 0;
      const up0 = run && f === 0, up2 = run && f === 2;
      if (up0) { L(3 - sh, 16, 'B'); L(4 - sh, 16, 'B'); } else { L(3, 16, 'K'); L(4, 16, 'K'); L(2, 17, 'B'); L(3, 17, 'B'); L(4, 17, 'B'); }
      if (up2) { L(7 + sh, 16, 'B'); L(8 + sh, 16, 'B'); } else { L(7, 16, 'K'); L(8, 16, 'K'); L(7, 17, 'B'); L(8, 17, 'B'); L(9, 17, 'B'); }
    }
    // ---- 胴（8〜15段）----
    const body = (v === 'side' ? BODY_SIDE : BODY_FRONT).map((r) => r.split(''));
    if (v !== 'side') {
      if (v === 'front' || v === 'f34') { body[0][5] = 'L'; body[0][6] = 'L'; }
      else { body[2][5] = 'L'; body[2][6] = 'L'; body[3][5] = 'L'; body[3][6] = 'L'; }
      body[4][9] = 'D'; body[5][9] = 'D'; body[2][10] = 'D'; body[1][9] = 'D';
    } else { for (let y = 1; y <= 5; y++) body[y][8] = 'D'; }
    const clr = (x, y) => { if (body[y] && body[y][x] !== undefined) body[y][x] = '.'; };
    if (v !== 'side') {
      if (o.armsUp || o.armsOut || run) { clr(0, 3); clr(11, 3); }
      if (o.armsUp) {                 // バンザイ（V字）
        put(0, 8 + bob, 'W'); put(-1, 7 + bob, 'W'); put(-2, 6 + bob, 'S'); put(-2, 5 + bob, 'S');
        put(11, 8 + bob, 'W'); put(12, 7 + bob, 'W'); put(13, 6 + bob, 'S'); put(13, 5 + bob, 'S');
      } else if (o.armsOut) {         // ジャンプ：両腕を横に広げる
        put(0, 10 + bob, 'W'); put(-1, 10 + bob, 'S'); put(-2, 10 + bob, 'S');
        put(11, 10 + bob, 'W'); put(12, 10 + bob, 'S'); put(13, 10 + bob, 'S');
      } else if (run) {               // 走り：腕を前後に振る
        const a = f === 0 ? -1 : f === 2 ? 1 : 0;
        put(0, 11 + bob + a, 'S'); put(11, 11 + bob - a, 'S');
      }
    } else if (!o.armsUp) {
      if (pose === 'lunge' || pose === 'crouch') { put(9, 10 + bob, 'W'); put(10, 9 + bob, 'S'); put(2, 10 + bob, 'W'); put(1, 9 + bob, 'S'); put(0, 9 + bob, 'S'); }   // 両腕を広げてバランス
      else if (pose === 'sole') { put(8, 9, 'W'); put(9, 8, 'S'); put(3, 10, 'W'); put(2, 10, 'S'); put(1, 10, 'S'); }
      else if (pose === 'bigWindup') { put(8, 9, 'W'); put(9, 8, 'S'); put(10, 7, 'S'); put(3, 10, 'W'); put(2, 11, 'S'); }   // 前の腕を高く、体を大きく開く
      else if (pose === 'follow') { put(3, 9, 'W'); put(2, 8, 'S'); put(1, 7, 'S'); put(8, 10, 'W'); put(9, 11, 'S'); }      // 後ろの腕が上がる
      else if (pose === 'windup') { put(8, 10 + bob, 'W'); put(9, 9 + bob, 'S'); put(3, 10 + bob, 'W'); put(2, 11 + bob, 'S'); }
      else if (pose === 'kick') { put(3, 9, 'W'); put(2, 8, 'S'); put(8, 9, 'W'); put(9, 8, 'S'); }
      else if (o.armsOut) { put(8, 10 + bob, 'W'); put(9, 10 + bob, 'S'); put(3, 10 + bob, 'W'); put(2, 10 + bob, 'S'); }
      else if (run && (f === 0 || f === 2)) { const fw = f === 0 ? 1 : -1; put(fw > 0 ? 9 : 2, 10 + bob, 'W'); put(fw > 0 ? 10 : 1, 11 + bob, 'S'); body[2][6] = 'D'; }
      else { body[2][6] = 'D'; body[3][6] = 'D'; put(6, 12 + bob, 'S'); }
    } else { put(8, 8 + bob, 'W'); put(9, 7 + bob, 'W'); put(10, 6 + bob, 'S'); put(10, 5 + bob, 'S'); }
    body.forEach((r, y) => r.forEach((ch, x) => { if (ch !== '.') put(x + (y < 2 ? lean : 0), 8 + y + bob, ch); }));
    // ---- 頭（0〜7段）----
    const head = HEADS[v].map((r) => r.split(''));
    const st = o.style;
    if (st === 1 && (v === 'front' || v === 'f34')) head[3] = head[3].map((ch, x) => (ch === 'H' && x > 1 && x < 8 ? 'S' : ch));   // 短髪
    if (st === 3) { head[6][0] = 'H'; head[7][1] = 'H'; if (v === 'front' || v === 'back') { head[6][9] = 'H'; head[7][8] = 'H'; } }   // 長髪
    head.forEach((r, y) => r.forEach((ch, x) => put(x + 1 + lean, y + bob, ch)));
    if (st === 2) for (const x of [2, 4, 6]) { put(x + 1 + lean, -1 + bob, 'H'); put(x + 2 + lean, -1 + bob, 'H'); }   // ツンツン
    // ---- 脚を2段のばす：パンツの下に、ソックスの段を2段足す（頭身をカルチョビットAに合わせる）----
    {
      // パンツの一番下の段のすぐ下に2段差し込む（踏み込み・しゃがみでパンツが下がっていても崩れない）
      let ys = 15 + OY;
      for (let y = 8 + OY; y < 20 + OY && y < H2; y++) if (g[y].some((c) => c === pal.P)) ys = y;
      // 走りの上下動で胴が上がった時、パンツと脚の間に隙間（透けて見える）ができないよう脚でつなぐ
      for (let x = 0; x < W2; x++) {
        const underShorts = g[ys][x] === pal.P || (x > 0 && g[ys][x - 1] === pal.P) || (x < W2 - 1 && g[ys][x + 1] === pal.P);
        if (!underShorts) continue;
        let yl = -1;
        for (let y = ys + 1; y <= ys + 4 && y < H2; y++) if (g[y][x] === pal.K || g[y][x] === pal.B || g[y][x] === pal.b) { yl = y; break; }
        if (yl > ys + 1) for (let y = ys + 1; y < yl; y++) if (!g[y][x]) g[y][x] = pal.K;
      }
      const src = g[ys + 1] || [];
      const ext = src.map((c) => (c === pal.K || c === pal.B || c === pal.b ? pal.K : null));
      for (let y = H2 - 1; y >= ys + 3; y--) g[y] = g[y - 2].slice();
      g[ys + 1] = ext.slice(); g[ys + 2] = ext.slice();
    }
    // ---- 縁取り ----
    const OUT = '#3a302c';
    const out = g.map((row) => row.slice());
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      if (g[y][x]) continue;
      if ((y > 0 && g[y - 1][x]) || (y < H2 - 1 && g[y + 1][x]) || (x > 0 && g[y][x - 1]) || (x < W2 - 1 && g[y][x + 1])) out[y][x] = OUT;
    }
    const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
    const c2 = cv.getContext('2d');
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (out[y][x]) { c2.fillStyle = out[y][x]; c2.fillRect(x, y, 1, 1); }
    return cv;
  }
  // 8方向 → 絵の向きと左右反転
  function dirView(vx, vy) {
    const a = Math.atan2(vy, vx);             // 画面上の向き（右=0、下=+）
    const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return [['side', 1], ['f34', 1], ['front', 1], ['f34', -1], ['side', -1], ['b34', -1], ['back', 1], ['b34', 1]][k];
  }

  // ---------- 試作：GPTのちびキャラで選手を描く（?spr=old で今までのドット絵） ----------
  let kickNow = null, kfOf = [];   // いま描いている選手のキック（パス／シュートのコマ選びに使う）
  const GPT = { on: !/[?&]spr=old/.test(location.search) && !!window.GPT_SPR, ready: false, img: null, mask: null, cache: new Map() };
  if (GPT.on) {
    let n = 0; const done = () => { if (++n === 2) { const c = document.createElement('canvas'), W = GPT.img.width, H = GPT.img.height; c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(GPT.img, 0, 0); GPT.px = x.getImageData(0, 0, W, H).data; x.clearRect(0, 0, W, H); x.drawImage(GPT.mask, 0, 0); GPT.mk = x.getImageData(0, 0, W, H).data; GPT.W = W; GPT.ready = true; } };
    GPT.img = new Image(); GPT.img.onload = done; GPT.img.src = window.GPT_SPR.img;
    GPT.mask = new Image(); GPT.mask.onload = done; GPT.mask.src = window.GPT_SPR.mask;
  }
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  // 1コマを、チームの色・髪の色・肌の色に塗りかえたキャンバスにする
  function gptFrame(name, shirt, hair, skin, glove) {
    const k = name + '|' + shirt + '|' + hair + '|' + skin + '|' + (glove || '');
    let cv = GPT.cache.get(k); if (cv) return cv;
    const m = window.GPT_SPR.meta[name]; if (!m) return null;
    const [mx, my, w, h] = m; cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d'), d = x.createImageData(w, h), o = d.data, P = GPT.px, M = GPT.mk, W = GPT.W;
    const ts = hexToRgb(shirt), th = hexToRgb(hair), tk = hexToRgb(skin), BS = [52, 100, 220], BK = [255, 192, 128], tg = glove ? hexToRgb(glove) : null;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const i = ((my + yy) * W + mx + xx) * 4, j = (yy * w + xx) * 4;
      let r = P[i], g = P[i + 1], b = P[i + 2]; const a = P[i + 3];
      if (M[i + 2] > 128) { const l = (r * 0.3 + g * 0.59 + b * 0.11) / 96; r = ts[0] * l; g = ts[1] * l; b = ts[2] * l; }
      else if (M[i] > 128) { const l = (r * 0.3 + g * 0.59 + b * 0.11) / 70; r = th[0] * l; g = th[1] * l; b = th[2] * l; }
      else if (tg && M[i + 1] > 100 && M[i + 1] < 200) { const l = Math.min(1.15, (r * 0.3 + g * 0.59 + b * 0.11) / 190); r = tg[0] * l; g = tg[1] * l; b = tg[2] * l; }   // GKの手袋
      else if (M[i + 1] > 100) { r = r * tk[0] / BK[0]; g = g * tk[1] / BK[1]; b = b * tk[2] / BK[2]; }
      o[j] = Math.min(255, r); o[j + 1] = Math.min(255, g); o[j + 2] = Math.min(255, b); o[j + 3] = a;
    }
    x.putImageData(d, 0, 0);
    if (window.GPT_SPR.meta._native) cv.pixel = true;
    // ドット絵にする：縦32ドットくらいに縮めて、ふちをくっきり・色の段階を減らす（?spr=smooth でなめらかなまま）
    if (!window.GPT_SPR.meta._native && !/[?&]spr=smooth/.test(location.search)) {
      const D = (+((location.search.match(/[?&]dots=(\d+)/) || [])[1]) || 32) / 96, sw = Math.max(1, Math.round(w * D)), sh = Math.max(1, Math.round(h * D));
      const sm = document.createElement('canvas'); sm.width = sw; sm.height = sh; const y = sm.getContext('2d');
      y.imageSmoothingEnabled = true; y.imageSmoothingQuality = 'high'; y.drawImage(cv, 0, 0, sw, sh);
      const e = y.getImageData(0, 0, sw, sh), q = e.data;
      for (let i = 0; i < q.length; i += 4) {
        if (q[i + 3] < 110) { q[i + 3] = 0; continue; }
        const a = q[i + 3] / 255; q[i + 3] = 255;
        for (let c = 0; c < 3; c++) { let v = q[i + c] / a; v = Math.round(v / 24) * 24; q[i + c] = Math.max(0, Math.min(255, v)); }
      }
      // 外がわのふちを濃い紺で1ドット
      const o2 = new Uint8ClampedArray(q);
      for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
        const i = (yy * sw + xx) * 4; if (q[i + 3]) continue;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = xx + dx, Y = yy + dy; return X >= 0 && Y >= 0 && X < sw && Y < sh && q[(Y * sw + X) * 4 + 3]; });
        if (nb) { o2[i] = 22; o2[i + 1] = 26; o2[i + 2] = 48; o2[i + 3] = 255; }
      }
      e.data.set(o2); y.putImageData(e, 0, 0); sm.pixel = true; cv = sm;
    }
    GPT.cache.set(k, cv); return cv;
  }
  function gptSprite(x, y, s, info, team, facing, frame, moving, armsUp, noShadow, pose, run, view) {
    const px = Math.max(1.4, 2.6 * s);
    const col = info.col || (info.gk ? GKC[team] : TEAM[team]);
    view = view || 'side';
    const running = !!(moving && run > 1.2);
    let name, flip = facing < 0, bob = 0;
    const M = window.GPT_SPR.meta, FB = view === 'front' ? 'F' : view === 'back' ? 'B' : '';
    const act = (n) => (FB && M[FB + n] ? (flip = false, FB + n) : n);
    // パス／シュート（横向き）：構え→振りかぶり→接触→振り抜き。接触のコマ（0始まりの2）が、ボールを蹴った瞬間（d=0）に来るように並べる
    const KK = M._kick, kn = kickNow;
    if (KK && kn && kn.d !== undefined && (view === 'side' || !view) && (pose === 'windup' || pose === 'bigWindup' || pose === 'kick' || pose === 'follow')) {
      const shot = !!kn.shot, du = KK[shot ? 'shot' : 'pass'], pre = shot ? 0.38 : 0.3, post = shot ? 0.5 : 0.32;
      let f;
      if (kn.run) f = kn.d < -0.065 ? 0 : kn.d < 0 ? 1 : kn.d < 0.045 ? 2 : 3;   // 走りながらのパス（パス確認画面と同じ長さ）
      else if (kn.d < 0) { const u = (kn.d + pre) / pre * (du[0] + du[1]); f = u < du[0] ? 0 : 1; }
      else { const u = Math.min(1, kn.d / post) * (du[2] + du[3]); f = u < du[2] ? 2 : 3; }
      name = (shot ? 'shot' : 'pass') + f;
    }
    else if (pose === 'windup' || pose === 'bigWindup') name = act('windup');
    else if (pose === 'kick' || pose === 'follow' || pose === 'lunge') name = act('kick');
    else if (pose === 'sole' || pose === 'b' || pose === 'crouch') name = act('trap');
    else if (pose === 'jump') name = act('header');
    else if (armsUp && !moving) { name = 'cheer'; flip = false; }
    else if (moving) {
      const t = performance.now() / 1000, sp = running ? (run > 4.8 ? 15 : 11) : 7, f = Math.floor(t * sp + (info.number || 0) * 0.37) % 8;
      const R = { side: 'run', f34: 'runD', b34: 'runE', front: 'runF', back: 'runB' }[view] || 'run';
      name = M[R + f] ? R + f : 'run' + f;
      if (R === 'runF' || R === 'runB') flip = false;
    } else {
      // 左向きは右向きの絵を反転（左向きの絵はとなりのコマの線が混ざりやすいので使わない）
      name = view; flip = facing < 0 && (view === 'side' || view === 'f34' || view === 'b34');
    }
    const m = window.GPT_SPR.meta[name];
    const cv = gptFrame(name, col.W, hairOf(info), SKIN[info.skin || 0], info.gk ? '#f4f4f0' : null);
    if (!cv || !m) return null;
    const sc = 25 * px / (window.GPT_SPR.meta._T || 96) * (m[5] || 1), w = m[2] * sc, h = m[3] * sc, ax = m[4] * sc;
    if (!noShadow) { ctx.fillStyle = 'rgba(0,30,0,0.38)'; ctx.beginPath(); ctx.ellipse(x, y - px0 * 0.4, 6.4 * px0, 2.0 * px0, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.imageSmoothingEnabled = !cv.pixel;
    const yy = Math.round(y - h - bob * px);
    if (flip) { ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(cv, -ax, yy, w, h); ctx.restore(); }
    else ctx.drawImage(cv, x - ax, yy, w, h);
    ctx.imageSmoothingEnabled = false;
    return { top: y - 25 * px + 2 * px, px: px * 14 / SPR_W };
  }
  // ---------- カルチョビットA風の選手（sprites/dotman.js）：16方向・走り4形・パス／シュート4コマ ----------
  let dmFacing = null, dmRunF = 0, dmRunPh = null;   // いま描く選手の体の向き（角度）と走りのコマ（dmRunPh＝本家の走りの1周の位置）。選手ループでセットする
  const runPh = [];
  const DM = { on: !/[?&]spr=(old|gpt)/.test(location.search) && !!window.DotMan };
  const ART_RUN = !/[?&]run=old/.test(location.search) && !!window.RUN_ART;   // 本家を写した走りと待機の絵（?run=old で前の絵）
  function dmSprite(x, y, s, info, team, moving, noShadow, pose, run, view, facing, armsUp) {
    if (!DM.on) return null;
    const kn = kickNow, kicking = kn && kn.d !== undefined && (pose === 'windup' || pose === 'bigWindup' || pose === 'kick' || pose === 'follow');
    const col = info.col || (info.gk ? GKC[team] : TEAM[team]);
    const VA = { side: 0, f34: Math.PI / 4, front: Math.PI / 2, b34: -Math.PI / 4, back: -Math.PI / 2 };
    let fa = dmFacing;
    if (fa == null) { const a = VA[view || 'side'] ?? 0; fa = (facing || 1) < 0 ? Math.PI - a : a; }
    const o = { facing: fa, shirt: col.W, shorts: col.P, socks: col.K, hair: hairOf(info), skin: SKIN[info.skin || 0] };
    if (col.pat && col.pat !== 'solid' && !info.gk) { o.pat = col.pat; o.sub = col.S; }
    if (info.gk) o.glove = '#f4f4f0';
    if (kicking) {
      const shot = !!kn.shot, KK = (window.GPT_SPR && window.GPT_SPR.meta._kick) || { pass: [50, 65, 45, 90], shot: [65, 105, 55, 145] };
      const du = KK[shot ? 'shot' : 'pass'], pre = shot ? 0.38 : 0.3, post = shot ? 0.5 : 0.32;
      let f;
      if (kn.run) f = kn.d < -0.065 ? 0 : kn.d < 0 ? 1 : kn.d < 0.045 ? 2 : 3;   // 走りながらのパス（パス確認画面と同じ長さ）
      else if (kn.d < 0) { const u = (kn.d + pre) / pre * (du[0] + du[1]); f = u < du[0] ? 0 : 1; }
      else { const u = Math.min(1, kn.d / post) * (du[2] + du[3]); f = u < du[2] ? 2 : 3; }
      o.pose = shot ? 'shot' : 'pass'; o.frame = f;
      if (shot) {   // シュート技ごとの体勢（手で描いた絵・8方向）
        const sk = kn.sk, d = kn.d; o.art = true; if (kn.foot) o.foot = kn.foot; o.pose = 'shotA';
        if (sk === 'lob') { o.pose = 'lobS'; o.frame = d < -0.12 ? 0 : d < 0.08 ? 1 : 2; }           // すくい上げる
        else if (sk === 'toeKick') { o.pose = 'toeK'; o.frame = d < 0 ? 0 : 1; }                      // つま先で突く
        else if (sk === 'volley') { o.pose = 'volleyS'; o.frame = d < 0 ? 0 : 1; }                    // 横から叩く
        else if (sk === 'controlShot') o.pose = 'ctrlS';                                             // 体を倒しつつ、インサイドで巻いて、すくい上げるように振り抜く
        else if (sk === 'knuckle' && f === 3) o.frame = 2;                                           // 振り抜かずに止める
        else if (kn.dsh && f === 0) o.frame = 1;                                                     // 走りながらそのまま
      }   // シュートは手で描いたフォーム（踏み込み→振りかぶり→インパクト→振り抜き）。横・手前・奥の絵を向きで選ぶ
      else { o.pose = 'passA'; o.art = true; if (kn.foot) o.foot = kn.foot; }   // パスは手で描いたフォーム＝シュートの小さいバージョン（踏み込み→小さく振りかぶる→インパクト→小さく振り抜く）。8方向・右足／左足
    } else if (armsUp) o.pose = 'cheer';   // バンザイ・GKのパンチング／ダイブ・転倒（倒した絵として使う）
    else if (/^(shotA|passA|trapI|trapC|stumble|fall|getup|scisB|scis|bfStep|bfPush|bicycle|dhead|headS|volleyS|lobS|toeK|ctrlS)\d[RL]?$/.test(pose || '')) { const m = pose.match(/^([a-zA-Z]+?)(\d)([RL]?)$/); o.pose = m[1]; o.frame = +m[2]; o.art = true; if (m[3]) o.foot = m[3]; }   // 手で描いた絵。最後の R/L＝使う足   // 手で描いたシュートフォーム・シザース
    else if (pose === 'lie') { o.pose = 'lie'; o.art = true; }   // あお向けの大の字
    else if (pose === 'gkReach' || pose === 'gkCrouch' || pose === 'gkSit' || pose === 'slide' || pose === 'slideF' || pose === 'slideB' || pose === 'hurdle') { o.pose = pose; o.art = true; }   // 失点したGKの悔しがり
    else if (pose === 'jump' || pose === 'lunge' || pose === 'sole' || pose === 'crouch') o.pose = pose;
    else if (pose === 'windup' || pose === 'bigWindup' || pose === 'kick' || pose === 'follow') { const m = { windup: ['pass', 1], bigWindup: ['shot', 1], kick: ['pass', 2], follow: ['shot', 3] }[pose]; o.pose = m[0]; o.frame = m[1]; }
    else if (moving && ART_RUN) { o.pose = 'run'; o.art = true; o.frame = DotMan.artFrame(fa, dmFacing == null || dmRunPh == null ? performance.now() / 1000 * 2.15 + (info.number || 0) * 0.37 : dmRunPh); }
    else if (moving) { o.pose = 'run'; o.frame = dmFacing == null ? Math.floor(performance.now() / 1000 * 12 + (info.number || 0) * 2.3) % 8 : dmRunF; }
    else { o.pose = 'stand'; if (ART_RUN) o.art = true; }
    const F = DotMan.frame(o), px0 = Math.max(1.4, 2.6 * s);
    // 本家を写した絵は今までの絵より背が高い（足もとまで28〜30ドット、今までは24ドット）ので、試合での背の高さが今までと同じになるように縮めて描く
    const px = px0 * DotMan.fitScale(F, fa, o.pose);   // 写した絵は24ドットの背に、自動で組む絵も同じ向きの写した絵と同じ背の高さにそろえる
    if (!noShadow) { ctx.fillStyle = 'rgba(0,30,0,0.38)'; ctx.beginPath(); ctx.ellipse(x, y - px0 * 0.4, 6.4 * px0, 2.0 * px0, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(F.cv, Math.round(x - F.px * px), Math.round(y - F.py * px), F.cv.width * px, F.cv.height * px);
    return { top: y - 24 * px0 + 2 * px0, px: px0 * 14 / SPR_W, toe: { x: x + (F.toeK.x - F.px) * px, y: y + (F.toeK.y - F.py) * px } };
  }
  // frame：走りの4コマ。run：走る速さ。view：'side' | 'f34' | 'front' | 'b34' | 'back'
  function sprite(x, y, s, info, team, facing, frame, moving, armsUp, noShadow, pose, run, view) {
    { const d = dmSprite(x, y, s, info, team, moving, noShadow, pose, run, view, facing, armsUp); if (d) return d; }
    if (GPT.on && GPT.ready) { const r = gptSprite(x, y, s, info, team, facing, frame, moving, armsUp, noShadow, pose, run, view); if (r) return r; }
    const px = Math.max(1.4, 2.6 * s);
    const col = info.col || (info.gk ? GKC[team] : TEAM[team]);
    if (pose && pose !== 'jump') view = 'side';
    view = view || 'side';
    const running = !!(moving && run > 1.2);
    const fr = running ? frame % 4 : moving ? (frame % 2) * 2 : 0;
    const key = [view, fr, pose || '', armsUp ? 1 : 0, running ? (run > 4.8 ? 2 : 1) : moving ? 3 : 0, team, info.gk ? 1 : 0, info.col ? 'r' : '', info.hair, info.hairColor, info.skin].join('|');
    let cv = sprCache.get(key);
    if (!cv) {
      cv = genSprite({ view, frame: fr, pose: pose === 'jump' ? null : pose, armsUp, armsOut: pose === 'jump', run: running || moving, fast: running && run > 4.8, col, skin: SKIN[info.skin || 0], hair: hairOf(info), style: (info.hair || 0) % 4 });
      sprCache.set(key, cv);
    }
    if (!noShadow) {
      ctx.fillStyle = 'rgba(0,30,0,0.38)';
      ctx.beginPath(); ctx.ellipse(x, y - px * 0.4, 6.4 * px, 2.0 * px, 0, 0, Math.PI * 2); ctx.fill();
    }
    const w = SPR_W * px, h = SPR_H * px;
    const flip = facing < 0 && (view === 'side' || view === 'f34' || view === 'b34');
    ctx.imageSmoothingEnabled = false;
    const yy = Math.round(y - 22 * px);   // 足元（スパイクの下端）を地面に合わせる
    if (flip) { ctx.save(); ctx.translate(Math.round(x), 0); ctx.scale(-1, 1); ctx.drawImage(cv, Math.round(-w / 2), yy, w, h); ctx.restore(); }
    else ctx.drawImage(cv, Math.round(x - w / 2), yy, w, h);
    return { top: yy + 2 * px, px: px * 14 / SPR_W };
  }

  const POS_TAG = { GK: '#8e5bd6', DF: '#d83a3a', MF: '#f08a1c', FW: '#2f7fe0' };
  function nameTag(x, y, info, team, wide, card) {
    ctx.font = `700 ${wide ? 19 : 18}px "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif`;   // 版496：名前の札を大きく
    const num = String(info.number), nm = info.name + (wide ? '｜' + info.type : '');
    const wn = ctx.measureText(num).width + 12, wt = ctx.measureText(nm).width + 12;
    const x0 = x - (wn + wt) / 2, y0 = y - 27, TH = 25;
    ctx.fillStyle = POS_TAG[info.gk ? 'GK' : info.position] || (team ? '#d8392f' : '#2a62c9'); ctx.fillRect(x0, y0, wn, TH);   /* 版482：背番号の地の色はポジションの色（GK紫・DF赤・MF橙・FW青） */
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x0 + wn, y0, wt, TH);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, wn + wt - 1, TH - 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff'; ctx.fillText(num, x0 + 6, y0 + 19);
    ctx.fillStyle = '#1a1a1a'; ctx.fillText(nm, x0 + wn + 6, y0 + 19);
    if (card) {
      // 警告・退場を受けた選手は、名前の札の右にカード
      const cx = Math.round(x0 + wn + wt + 3), cy = y0 + 4;
      ctx.fillStyle = card === 'red' ? '#e8241c' : '#ffd400'; ctx.fillRect(cx, cy, 11, 16);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeRect(cx + 0.5, cy + 0.5, 10, 15);
    }
  }
  // カードが出た選手を画面下に出す（カルチョビットAのように：エンブレム・チーム名／ポジション・番号・名前・カード）
  function cardUpT(c) {
    if (c.up == null) { c.up = c.t + 1; for (let t = c.t; t < c.t + 8; t += 0.1) if (stateAt(t).refCard) { c.up = t; break; } }
    return c.up;
  }
  const embImgs = {};
  function drawCardBanner() {
    if (show) return;
    let c = null;
    for (const x of cardList) { if (x.t > simT || x.t < simT - 12) continue; const a = simT - cardUpT(x); if (a > 0.9 && a < 4.4) c = x; }
    if (!c) return;
    const a = simT - c.up - 0.9, al = Math.min(1, a / 0.3, (3.5 - a) / 0.35);
    const info = rinfo(c.team, c.i % 11), team = c.team;
    const tname = team ? match.away : match.home;
    const W = 330, H = 58, x = Math.round(CW * 0.33 - W / 2), y = CH - H - 20;
    ctx.save(); ctx.globalAlpha = Math.max(0, al);
    ctx.fillStyle = 'rgba(40,46,52,0.82)'; rrect(x, y, W, H, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    { const src = mctx && mctx.opts && (team ? mctx.opts.embA : mctx.opts.embH);   // 育成モードのエンブレムがあれば、その絵を
      let im = src && (embImgs[src] || (embImgs[src] = Object.assign(new Image(), { src })));
      if (im && im.complete && im.naturalWidth) ctx.drawImage(im, x + 11, y + H / 2 - 19, 38, 38); else emblem(x + 30, y + H / 2, 18, team); }
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = `700 14px ${JP}`; ctx.fillText(tname, x + 58, y + 22);
    const pos = info.position || '';
    ctx.fillStyle = { GK: '#e0a21a', DF: '#2f8f3a', MF: '#2a62c9', FW: '#d8392f' }[pos] || '#2a62c9';
    ctx.fillRect(x + 58, y + 30, 30, 19);
    ctx.fillStyle = '#fff'; ctx.font = `900 13px ${JP}`; ctx.textAlign = 'center'; ctx.fillText(pos, x + 73, y + 45);
    ctx.textAlign = 'left'; ctx.font = `italic 900 17px ${JP}`; ctx.fillText(String(c.number), x + 96, y + 46);
    ctx.font = `700 17px ${JP}`; ctx.fillText(c.name || info.name, x + 96 + ctx.measureText(String(c.number)).width + 12, y + 46);
    ctx.fillStyle = c.color === 'red' ? '#e8241c' : '#ffd400'; ctx.fillRect(x + W - 26, y + 18, 14, 21);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x + W - 25.5, y + 18.5, 13, 20);
    ctx.restore();
  }

  // ボール：本物の球として3Dで回す。
  //  ・地面を転がる → 進む向きに前転（トップスピン）
  //  ・浮き球（ロング/パス） → バックスピン（進む向きと逆回り）
  //  ・カーブ → 縦の軸まわりに横回転、無回転 → ほぼ回らず揺れる
  // 回転軸は「進む向き」から決まるので、横パスでも縦パスでも同じように見える
  let lastBall = null;
  const ballTrail = [];
  let ballM = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // ボールの向き（回転行列）
  const BALL_PTS = (() => {
    // 正二十面体の頂点 = サッカーボールの黒い五角形12枚の中心
    const t = (1 + Math.sqrt(5)) / 2, v = [];
    for (const a of [-1, 1]) for (const b of [-t, t]) v.push([0, a, b], [a, b, 0], [b, 0, a]);
    return v.map((q) => { const n = Math.hypot(...q); return q.map((u) => u / n); });
  })();
  function rotateBall(ax, ay, az, ang) {
    const n = Math.hypot(ax, ay, az);
    if (n < 1e-6 || !ang) return;
    ax /= n; ay /= n; az /= n;
    const c0 = Math.cos(ang), s0 = Math.sin(ang), t0 = 1 - c0;
    const Rm = [t0 * ax * ax + c0, t0 * ax * ay - s0 * az, t0 * ax * az + s0 * ay,
      t0 * ax * ay + s0 * az, t0 * ay * ay + c0, t0 * ay * az - s0 * ax,
      t0 * ax * az - s0 * ay, t0 * ay * az + s0 * ax, t0 * az * az + c0];
    const M = ballM, out = new Array(9);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) out[r * 3 + q] = Rm[r * 3] * M[q] + Rm[r * 3 + 1] * M[3 + q] + Rm[r * 3 + 2] * M[6 + q];
    // ずれを直す（正規直交化）
    const nrm = (o) => { const l = Math.hypot(out[o], out[o + 3], out[o + 6]); out[o] /= l; out[o + 3] /= l; out[o + 6] /= l; };
    nrm(0); nrm(1); nrm(2);
    ballM = out;
  }
  function ballDraw(b, spinCode, bs) {
    let speed = 0;
    if (lastBall) {
      const dx = b.x - lastBall.x, dy = b.y - lastBall.y, dz = b.z - lastBall.z;
      const d = Math.hypot(dx, dy, dz), dh = Math.hypot(dx, dy);
      const dt = Math.max(1e-3, simT - lastBall.t);
      speed = d / dt;
      if (dt < 0.5 && dh > 1e-4) {
        // 1コマで回る量（速すぎるとコマ落ちで逆回転に見えるので上限）
        const roll = Math.min(0.6, (dh / 0.11) * 0.22);
        const air = b.z > 0.35;
        if (spinCode === 1) rotateBall(dx, dy, 0.3, 0.015);                                   // 無回転
        else if (spinCode === 4) rotateBall(-dy, dx, 0, 0.55);                                 // ドライブシュート：強い縦回転（トップスピン）
        else if (spinCode === 2 || spinCode === 3) {                                         // カーブ：縦軸の横回転＋縦回転
          rotateBall(0, 0, spinCode === 2 ? 1 : -1, Math.min(0.55, roll * 1.1 + 0.12));
          if (bs) rotateBall(bs > 0 ? dy : -dy, bs > 0 ? -dx : dx, 0, Math.min(0.3, Math.abs(bs) * 0.3));
        } else if (air) {
          // 浮き球：記録された縦回転のとおり（＋バックスピン／−トップスピン）
          const a = Math.min(0.55, 0.06 + Math.abs(bs) * 0.5);
          if (bs >= 0) rotateBall(dy, -dx, 0, a); else rotateBall(-dy, dx, 0, a);
        } else rotateBall(-dy, dx, 0, roll);                                                   // 転がる：前転
      }
    }
    lastBall = { x: b.x, y: b.y, z: b.z, t: simT };
    const g = P3(b.x, b.y, standZ(b.x, b.y));   // 影：観客席の上なら段の上に落とす
    const r = Math.max(5.5, 9 * g.s);
    const p = P3(b.x, b.y, b.z + 0.11);
    // 残像（速いほど長い）
    ballTrail.push({ x: p.x, y: p.y - r * 0.6, sp: speed });
    if (ballTrail.length > 10) ballTrail.shift();
    // シュート技のエフェクト（強烈ミドル・ニア上ぶち抜き・コントロールショット・無回転・ドリブルシュート）
    const shs = ballOwned ? null : curShot(), sfx = shs && shs.sk && SHOT_FX[shs.sk] ? shs.sk : null, red = !!(shs && shs.guren), kaku = red && shs.guren >= 2;   // kaku：凸（覚醒）した紅蓮の牙
    if (sfx || red) {
      const age = simT - shs.t;
      if (!shs.path || simT < shs.pathT) { shs.path = []; }
      shs.pathT = simT; shs.path.push([b.x, b.y, b.z]); if (shs.path.length > 80) shs.path.shift();
      const P = shs.path.map((w) => { const v = P3(w[0], w[1], w[2] + 0.11); return [v.x, v.y - r * 0.6]; });
      ctx.save(); ctx.lineCap = 'round';
      if (red) {   // 紅蓮の牙：ボールが赤い風（炎のような帯）をまとう。ほかのシュート技の絵はその上に重ねる
        const n = Math.min(P.length, 14);
        for (let k = 1; k < n; k++) { const a = 1 - k / n, A = P[P.length - k], B2 = P[P.length - k - 1] || A, w0 = r * (0.7 + 1.9 * a);
          ctx.strokeStyle = kaku ? `rgba(150,${4 + 16 * a | 0},12,${0.75 * a})` : `rgba(200,${20 + 40 * a | 0},20,${0.55 * a})`; ctx.lineWidth = w0 * 1.5; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B2[0], B2[1]); ctx.stroke();
          ctx.strokeStyle = kaku ? `rgba(225,${20 + 60 * a | 0},16,${0.95 * a})` : `rgba(255,${60 + 120 * a | 0},40,${0.9 * a})`; ctx.lineWidth = w0 * 0.7; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B2[0], B2[1]); ctx.stroke(); }
        // 風の筋：ボールのうしろで揺れる赤い線
        const L0 = P[P.length - 1], L1 = P[Math.max(0, P.length - 6)], dx0 = L0[0] - L1[0], dy0 = L0[1] - L1[1], dl = Math.hypot(dx0, dy0) || 1, nx = -dy0 / dl, ny = dx0 / dl;
        ctx.strokeStyle = 'rgba(255,40,30,0.85)'; ctx.lineWidth = Math.max(1.5, r * 0.25);
        for (let k = -2; k <= 2; k++) { const off = k * r * 0.7 + Math.sin(simT * 40 + k) * r * 0.3, len = r * (3 + (2 - Math.abs(k)) * 1.6); ctx.beginPath(); ctx.moveTo(L0[0] + nx * off - dx0 / dl * r, L0[1] + ny * off - dy0 / dl * r); ctx.lineTo(L0[0] + nx * off - dx0 / dl * (r + len), L0[1] + ny * off - dy0 / dl * (r + len)); ctx.stroke(); }
        if (age < 0.25) { const u = age / 0.25, Q = P[0], R0 = r * (1.5 + u * 6); ctx.globalAlpha = 1 - u; ctx.strokeStyle = kaku ? '#ffc020' : '#ff3020'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(Q[0], Q[1], R0, R0 * 0.45, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
        if (kaku) {   // 覚醒：帯の大きさは同じのまま、芯に細い金色の筋が通り、火の粉が散る
          const m2 = Math.min(P.length, 9);
          for (let k = 1; k < m2; k++) { const a = 1 - k / m2, A = P[P.length - k], B2 = P[P.length - k - 1] || A; ctx.strokeStyle = `rgba(255,${225 + 30 * a | 0},${100 + 110 * a | 0},${0.9 * a})`; ctx.lineWidth = r * (0.2 + 0.35 * a); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B2[0], B2[1]); ctx.stroke(); }
          for (let k = 0; k < 8; k++) { const j = Math.max(0, P.length - 2 - (k * 3) % 12), Q = P[j], ph = simT * 30 + k * 2.1; ctx.fillStyle = k % 2 ? '#ffe45a' : '#ff5a20'; ctx.fillRect(Q[0] + Math.sin(ph) * r * 1.8, Q[1] + Math.cos(ph * 1.3) * r * 1.3 - k % 3 * r * 0.4, Math.max(2, r * 0.3), Math.max(2, r * 0.3)); }
        }
      }
      if (sfx === 'powerMid') {   // 太い弾道（オレンジから白へ）と、蹴った瞬間の衝撃の輪
        const n = Math.min(P.length, 9); for (let k = 1; k < n; k++) { const a = 1 - k / n, A = P[P.length - k], B2 = P[P.length - k - 1] || A; ctx.strokeStyle = `rgba(255,${150 + 100 * a | 0},${60 + 180 * a | 0},${0.85 * a})`; ctx.lineWidth = r * (0.5 + 1.2 * a); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B2[0], B2[1]); ctx.stroke(); }
        if (age < 0.25) { const u = age / 0.25, Q = P[0], R0 = r * (1.5 + u * 6); ctx.globalAlpha = 1 - u; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(Q[0], Q[1], R0, R0 * 0.45, 0, 0, 7); ctx.stroke(); ctx.strokeStyle = '#ffe9a0'; for (let k = 0; k < 10; k++) { const a2 = k / 10 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Q[0] + Math.cos(a2) * R0 * 1.1, Q[1] + Math.sin(a2) * R0 * 0.5); ctx.lineTo(Q[0] + Math.cos(a2) * R0 * 1.7, Q[1] + Math.sin(a2) * R0 * 0.8); ctx.stroke(); } }
      } else if (sfx === 'nearPost') {   // 蹴った所からボールまで、一直線の鋭い線
        const A = P[Math.max(0, P.length - 12)], B2 = P[P.length - 1]; ctx.globalAlpha = 0.5; ctx.strokeStyle = 'rgba(150,220,255,1)'; ctx.lineWidth = r * 1.1; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B2[0], B2[1]); ctx.stroke(); ctx.globalAlpha = 0.95; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, r * 0.35); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B2[0], B2[1]); ctx.stroke();
      } else if (sfx === 'dribbleShot') {   // 走りの勢いのまま：白い残像
        const n = Math.min(P.length, 9); for (let k = 1; k < n; k++) { const Q = P[P.length - 1 - k]; ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - k / n)})`; ctx.beginPath(); ctx.arc(Q[0], Q[1], r * 0.9, 0, 7); ctx.fill(); }
      }
      ctx.restore();
    }
    if (speed > 15 && !sfx && !red) {
      for (let k = 0; k < ballTrail.length - 1; k++) {
        const q = ballTrail[k], a = ((k + 1) / ballTrail.length) * Math.min(1, (speed - 15) / 12) * 0.55;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(q.x, q.y, r * (0.45 + 0.5 * k / ballTrail.length), 0, Math.PI * 2); ctx.fill();
      }
    }
    // 無回転：飛んでいる間、ボールそのものが小刻みにブレる
    const kn = spinCode === 1 && speed > 12 && b.z > 0.1, kjx = kn ? (Math.sin(simT * 47) * 0.6 + Math.sin(simT * 83) * 0.4) * r * 0.55 : 0, kjy = kn ? Math.sin(simT * 61) * r * 0.35 : 0;
    // 影
    ctx.fillStyle = 'rgba(0,40,0,0.38)';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, r * 1.05, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    // 球
    const cx = p.x + kjx, cy = p.y - r * 0.6 + kjy;
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#222';
    const M = ballM;
    for (const q of BALL_PTS) {
      const wx = M[0] * q[0] + M[1] * q[1] + M[2] * q[2];
      const wy = M[3] * q[0] + M[4] * q[1] + M[5] * q[2];
      const wz = M[6] * q[0] + M[7] * q[1] + M[8] * q[2];
      const toCam = -(wx * B.fx + wy * B.fy + wz * B.fz); // カメラ側を向いているほど大きい
      if (toCam < -0.15) continue;
      const sx = wx * B.rx + wy * B.ry, sy = -(wx * B.ux + wy * B.uy + wz * B.uz);
      const rr = r * 0.3, sq = Math.max(0.2, toCam);
      const ang = Math.atan2(sy, sx);
      ctx.beginPath(); ctx.ellipse(cx + sx * r * 0.92, cy + sy * r * 0.92, rr * sq, rr, ang + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
    }
    // 光沢
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.38, r * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // コーナーフラッグ
  function cornerFlags() {
    return [[0, 0], [105, 0], [0, 68], [105, 68]].map(([x, y]) => ({
      f: proj(x, y).f,
      draw: () => {
        const b0 = P3(x, y, 0), t0 = P3(x, y, 1.6);
        if (b0.f < 4) return;
        ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = Math.max(1.5, 1.6 * b0.s);
        line3(b0, t0);
        const wave = Math.sin(simT * 6 + x) * 0.12;
        const f1 = P3(x + (x ? -0.55 : 0.55), y + wave, 1.45), f2 = P3(x, y, 1.25);
        ctx.fillStyle = (x + y) % 2 ? '#ff7a1a' : '#ffe02a';
        poly([t0, f1, f2]); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
      },
    }));
  }

  // 審判（黒）と副審（黄色い旗）
  const REF_COL = { W: '#232323', L: '#4a4a4a', D: '#000000', P: '#111111', K: '#111111' };
  const REF_INFO = { col: REF_COL, hair: 1, hairColor: 0, skin: 1 };
  const AR_INFO = [{ col: REF_COL, hair: 0, hairColor: 3, skin: 0 }, { col: REF_COL, hair: 3, hairColor: 1, skin: 2 }];
  // sig: { mode: 'up' | 'diag' | 'level' | 'down', tx, ty }（世界座標で指す先）
  function drawOfficial(x, y, info, facing, moving, cardCode, sig, hasFlag) {
    const q = proj(x, y);
    if (q.f < 4 || q.x < -60 || q.x > CW + 60 || q.y < -40 || q.y > CH + 120) return;
    if (cardCode) sig = { mode: 'up', tx: x + facing, ty: y };
    const px0 = Math.max(1.4, 2.6 * q.s);
    // 副審の旗：手から棒、先に黄色（オフサイドの合図は赤と黄が点滅して揺れる）
    const flag = (hx, hy, ux, uy, d, wave, blink) => {
      const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const fx2 = hx + ux * 9 * d, fy2 = hy + uy * 9 * d;   // 旗は大きめに（遠くからでも見えるように）
      ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(2, d * 1.1); ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx2, fy2); ctx.stroke();
      ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = Math.max(1, d * 0.5); ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx2, fy2); ctx.stroke();
      const nx = -uy, ny = ux, sd = ny > 0 ? -1 : 1, w = wave ? Math.sin(simT * 14) * 0.6 * d : 0;
      ctx.fillStyle = blink && Math.floor(simT * 8) % 2 ? '#ff5a2a' : '#ffd400'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(fx2, fy2); ctx.lineTo(fx2 + nx * sd * 6.2 * d + w, fy2 + ny * sd * 6.2 * d);
      ctx.lineTo(fx2 - ux * 5.2 * d + nx * sd * 6.2 * d + w, fy2 - uy * 5.2 * d + ny * sd * 6.2 * d); ctx.lineTo(fx2 - ux * 5.2 * d, fy2 - uy * 5.2 * d); ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    if (sig && sig.mode === 'both') {
      // 試合終了：正面を向いて、両手を斜め上へ（Vの字）
      const d = px0 * 24 / 29;
      const colX = (c) => Math.round(q.x + (c - 11.5) * d), rowY = (r) => Math.round(q.y + (r - 30) * d);
      ctx.save(); ctx.beginPath(); ctx.rect(-10, -10, CW + 20, CH + 20);
      ctx.rect(colX(18), rowY(13), colX(25) - colX(18), rowY(22) - rowY(13)); ctx.rect(colX(-2), rowY(13), colX(5) - colX(-2), rowY(22) - rowY(13)); ctx.clip('evenodd');
      dmFacing = Math.PI / 2; sprite(q.x, q.y, q.s, info, 0, 1, 0, false, false); dmFacing = null; ctx.restore();
      for (const side of [1, -1]) {
        ctx.fillStyle = '#000'; ctx.fillRect(colX(side > 0 ? 18 : 4), rowY(13), Math.ceil(d), rowY(21) - rowY(13));
        const shx = colX(side > 0 ? 18 : 5), shy = rowY(13.6), ex = shx + side * 4.2 * d, ey = shy - 9.2 * d;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = '#000'; ctx.lineWidth = d * 3.2; ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = (info.col || REF_COL).W; ctx.lineWidth = d * 1.8; ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(ex, ey); ctx.stroke();
        const hs = Math.ceil(d * 2.2);
        ctx.fillStyle = '#000'; ctx.fillRect(Math.round(ex - hs / 2 - d * 0.5), Math.round(ey - hs / 2 - d * 0.5), hs + Math.ceil(d), hs + Math.ceil(d));
        ctx.fillStyle = SKIN[info.skin]; ctx.fillRect(Math.round(ex - hs / 2), Math.round(ey - hs / 2), hs, hs);
      }
      return;
    }
    if (sig) {
      // 合図：正面を向き、合図する側の腕は絵から消して、その腕を伸ばして描く（腕が3本にならないように）
      const side = Math.sign(proj(sig.tx, sig.ty).x - q.x) || facing || 1;
      const d = px0 * 24 / 29;   // 正面の絵のドット1つ分（足元が30段目）
      const colX = (c) => Math.round(q.x + (c - 11.5) * d), rowY = (r) => Math.round(q.y + (r - 30) * d);
      const cA = side > 0 ? 18 : -2, cB = side > 0 ? 25 : 5;
      ctx.save(); ctx.beginPath(); ctx.rect(-10, -10, CW + 20, CH + 20); ctx.rect(colX(cA), rowY(13), colX(cB) - colX(cA), rowY(22) - rowY(13)); ctx.clip('evenodd');
      dmFacing = Math.PI / 2; sprite(q.x, q.y, q.s, info, 0, 1, 0, false, false); dmFacing = null; ctx.restore();
      ctx.fillStyle = '#000'; ctx.fillRect(colX(side > 0 ? 18 : 4), rowY(13), Math.ceil(d), rowY(21) - rowY(13));   // 切った胴の横に縁取り
      const shx = colX(side > 0 ? 18 : 5), shy = rowY(13.6);
      const V = { up: [1.2, -10], diag: [6.5, -6.5], level: [9, -0.5], down: [5.5, 5.5] }[sig.mode] || [9, 0];
      const ex = shx + side * V[0] * d, ey = shy + V[1] * d;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#000'; ctx.lineWidth = d * 3.2; ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = (info.col || REF_COL).W; ctx.lineWidth = d * 1.8; ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(ex, ey); ctx.stroke();
      const hs = Math.ceil(d * 2.2);
      ctx.fillStyle = '#000'; ctx.fillRect(Math.round(ex - hs / 2 - d * 0.5), Math.round(ey - hs / 2 - d * 0.5), hs + Math.ceil(d), hs + Math.ceil(d));
      ctx.fillStyle = SKIN[info.skin]; ctx.fillRect(Math.round(ex - hs / 2), Math.round(ey - hs / 2), hs, hs);
      if (cardCode) {
        const cw = Math.ceil(3.4 * d), ch = Math.ceil(4.6 * d), cx0 = Math.round(ex - cw / 2), cy0 = Math.round(ey - hs / 2 - ch);
        ctx.fillStyle = cardCode === 2 ? '#e8241c' : '#ffd400'; ctx.fillRect(cx0, cy0, cw, ch);
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cw - 1, ch - 1);
      }
      if (hasFlag) flag(ex, ey, ex - shx, ey - shy, d, true, sig.mode === 'up');
      return;
    }
    // 合図なし：絵のまま（腕は描き足さない）。副審は、絵の手に旗を持たせる
    sprite(q.x, q.y, q.s, info, 0, facing, Math.floor(animT * 7) % 2, moving, false);
    if (hasFlag) { const d = px0 * 24 / 30, hx = q.x + facing * 0.9 * d, hy = q.y - 9.4 * d; flag(hx, hy, facing * 0.55, 1, d, false, false); }
  }

  // GKの姿勢：1/3 横っ跳び中、2/4 倒れている、5 キャッチして保持、6 パンチング
  const diveStart = [-99, -99], highStart = [-99, -99];   // 版834：ハイボールに跳んだ時刻
  // あお向けに大の字（失点した時だけ）：いつもの正面の絵のまま、両手を横に投げ出し、脚を開いて目を閉じる（sprites/dotman.js の 'lie'）
  function lieOnBack(q, info, team) {
    const px = Math.max(1.4, 2.5 * q.s);
    // 地面に寝ている影：体全体の下に広く（立っている時の足元の影ではなく）
    ctx.fillStyle = 'rgba(0,30,0,0.3)'; ctx.beginPath(); ctx.ellipse(q.x + px * 0.8, q.y - px * 11.5, px * 12.5, px * 13, 0, 0, 7); ctx.fill();
    dmFacing = Math.PI / 2; const r = sprite(q.x, q.y, q.s, info, team, 1, 0, false, false, true, 'lie', 0, 'front'); dmFacing = null;
    return r;
  }
  function drawKeeper(q, p, info, team, facing, frame, code, gi) {
    if (code === 1 || code === 3 || code === 2 || code === 4) {
      const dir = code <= 2 ? 1 : -1;               // 世界のyで跳んだ向き
      if (code === 1 || code === 3) { if (simT - diveStart[gi] > 1.6 || simT < diveStart[gi]) diveStart[gi] = simT; }
      const flying = code === 1 || code === 3;
      const u = flying ? Math.min(1, (simT - diveStart[gi]) / 0.6) : 1;
      // 画面上でどちらへ跳んだか（頭の向き）
      const sxv = proj(p.x, p.y + dir).x - q.x;
      const head = Math.abs(sxv) > 0.05 ? Math.sign(sxv) : (dir > 0 ? -1 : 1);
      const px = Math.max(1.4, 2.5 * q.s);
      const lift = flying ? Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.75 : 0.05;
      // 跳ぶ向き（画面上）に頭と両手を伸ばす。体はボール（ピッチ側）を向いたまま
      const dv = proj(p.x, p.y + dir), dsx = dv.x - q.x, dsy = dv.y - q.y;
      const th = Math.atan2(dsy, dsx) + Math.PI / 2;
      const thN = Math.atan2(Math.sin(th), Math.cos(th));
      const full = Math.max(-1.75, Math.min(1.75, thN));
      // 体は横向き（真横）に伸ばして飛ぶ。頭は跳んだ方へ、顔は上（空）を向かず下も向かず、横から見た姿
      const hd = Math.abs(dsx) > 0.5 ? Math.sign(dsx) : head;
      const ang = hd * (flying ? 0.6 + u * 0.95 : 1.5) + Math.max(-0.25, Math.min(0.25, dsy * 0.02));
      const fieldSide = -hd;
      const lifted = P3(p.x, p.y, lift);
      // 影は地面に横長
      ctx.fillStyle = 'rgba(0,30,0,0.32)';
      ctx.beginPath(); ctx.ellipse(q.x, q.y - px * 0.2, 9 * px, 2 * px, 0, 0, Math.PI * 2); ctx.fill();
      // 版458：手で描いた8方向の絵で跳ぶ（跳んだ向き＝画面の上の向きへ、体ごと伸びて飛び込む → 両手を伸ばしたまま倒れ込む）
      // 版460：横っ跳びは前の形（体を横に倒して、両手を跳んだ方へ）。うつ伏せの絵は、失点して倒れている時だけ
      const conc = !flying && match && match.events.some((e) => e.type === 'goal' && e.team !== team && simT - e.t >= -0.2 && simT - e.t < 6);
      if (DM.on && conc) { const H = 18 * px; dmFacing = Math.atan2(dsy / 0.45, dsx); const pz = 'fall2';
        const r2 = sprite(lifted.x, lifted.y, q.s, info, team, facing, 0, false, false, true, pz, 0, 'side'); dmFacing = null; return { top: lifted.y - H * 0.7, px: (r2 && r2.px) || px }; }
      ctx.save();
      const H = 18 * px;
      ctx.translate(lifted.x, lifted.y - (flying ? H * 0.5 - u * H * 0.18 : px * 6));
      ctx.rotate(ang);
      // 正面を向いたまま、両手を伸ばして横へ（顔はこちら＝ボールの方を見る）
      dmFacing = null; sprite(0, H / 2, q.s, info, team, 1, 0, false, true, true, null, 0, 'front');   // 正面向き（顔はカメラ側）のまま体を横に倒し、両手を跳んだ方へ伸ばす
      ctx.restore();
      return { top: lifted.y - H * 0.7, px };
    }
    if (code === 7) {
      // 版834：ハイボール：ボールに向かって踏み切り、いちばん高い所で両手をまっすぐ上へ伸ばす（キャッチ・パンチング）。影は高く跳ぶほど小さく
      const jp = (info.params && info.params.jump) || 65, jT = 0.56 + jp * 0.0045;   // 版864：ジャンプ力が高いほど、長く・高く跳ぶ（エンジンと同じ時間）
      if (simT - (highStart[gi] ?? -9) > jT + 0.3 || simT < (highStart[gi] ?? -9)) highStart[gi] = simT;
      const u = Math.min(1, (simT - highStart[gi]) / jT), h = Math.sin(Math.PI * u) * (0.55 + jp * 0.0085), lifted = P3(p.x, p.y, h), px = Math.max(1.4, 2.5 * q.s);
      ctx.fillStyle = 'rgba(0,30,0,0.3)'; ctx.beginPath(); ctx.ellipse(q.x, q.y - px * 0.2, (5.2 - h * 1.6) * px, (1.7 - h * 0.5) * px, 0, 0, Math.PI * 2); ctx.fill();
      return sprite(lifted.x, lifted.y, q.s, info, team, facing, 1, false, true, true);
    }
    if (code === 6) {
      // パンチング：飛び上がって両手を突き上げる
      const lifted = P3(p.x, p.y, 0.45);
      ctx.fillStyle = 'rgba(0,30,0,0.3)';
      const px = Math.max(1.4, 2.5 * q.s);
      ctx.beginPath(); ctx.ellipse(q.x, q.y - px * 0.2, 5.2 * px, 1.7 * px, 0, 0, Math.PI * 2); ctx.fill();
      return sprite(lifted.x, lifted.y, q.s, info, team, facing, 1, false, true, true);   // パンチング：両手を突き上げる（向きはいまの体の向き）
    }
    // 版862：セーブの型ごとの姿勢
    if (code === 8) {   // 指先でバーの上へ：高く跳んで、体を後ろへ反らしながら片手を伸ばす
      if (simT - (highStart[gi] ?? -9) > 0.9 || simT < (highStart[gi] ?? -9)) highStart[gi] = simT;
      const u = Math.min(1, (simT - highStart[gi]) / 0.6), h = Math.sin(Math.PI * u) * 1.1, lifted = P3(p.x, p.y, h), px = Math.max(1.4, 2.5 * q.s), H = 18 * px;
      ctx.fillStyle = 'rgba(0,30,0,0.3)'; ctx.beginPath(); ctx.ellipse(q.x, q.y - px * 0.2, (5.2 - h * 1.6) * px, (1.7 - h * 0.5) * px, 0, 0, Math.PI * 2); ctx.fill();
      const gx = proj(team === 0 ? 0 : 105, p.y).x - q.x, lean = (Math.sign(gx) || 1) * 0.35 * Math.min(1, u * 2);
      ctx.save(); ctx.translate(lifted.x, lifted.y); ctx.rotate(lean); const r8 = sprite(0, 0, q.s, info, team, facing, 1, false, true, true); ctx.restore();
      return { top: lifted.y - H * 0.7, px: (r8 && r8.px) || px };
    }
    if (code === 9 || code === 10) {   // 足を伸ばして止める（スライディングのように片足を投げ出す）
      dmFacing = Math.atan2(code === 9 ? 1 : -1, 0);   // 版864：踏み込んで、ボールの来た方へ片足を大きく伸ばす（スライディングではなく、立ったまま足を出す）
      const r9 = sprite(q.x, q.y, q.s, info, team, facing, 0, false, false, false, 'lunge', 0, 'side'); dmFacing = null; return r9;
    }
    if (code === 11) {   // 1対1：両手両足を大きく広げて、体ごと壁になる
      // 版864：至近距離の浮き球：小さく跳んで両手を大きく上げ、体を大きくして当てる
      if (simT - (highStart[gi] ?? -9) > 0.9 || simT < (highStart[gi] ?? -9)) highStart[gi] = simT;
      const u = Math.min(1, (simT - highStart[gi]) / 0.5), h = Math.sin(Math.PI * u) * 0.35, lifted = P3(p.x, p.y, h), px = Math.max(1.4, 2.5 * q.s);
      ctx.fillStyle = 'rgba(0,30,0,0.3)'; ctx.beginPath(); ctx.ellipse(q.x, q.y - px * 0.2, 5.6 * px, 1.8 * px, 0, 0, Math.PI * 2); ctx.fill();
      dmFacing = Math.atan2(0, team === 0 ? 1 : -1); const r11 = sprite(lifted.x, lifted.y, q.s, info, team, facing, 1, false, true, true, null, 0, 'front'); dmFacing = null; return r11;
    }
    if (code === 12) {   // 正面の低い球：腰を落として、すくい上げるように抱える
      dmFacing = Math.atan2(0, team === 0 ? 1 : -1);
      const r12 = sprite(q.x, q.y, q.s, info, team, facing, 0, false, false, false, 'gkCrouch', 0, 'front'); dmFacing = null; return r12;
    }
    const r = sprite(q.x, q.y, q.s, info, team, facing, frame, p.moving, false);
    if (code === 5) {
      // ボールを胸に抱える腕
      const px = r.px;
      ctx.fillStyle = (info.gk ? GKC[team] : TEAM[team]).D;
      ctx.fillRect(Math.round(q.x - 4 * px), Math.round(r.top + 10 * px), Math.ceil(8 * px), Math.ceil(1.6 * px));
    }
    return r;
  }

  // 選手の顔（ドット絵の頭と肩）
  const facePhotoImg = new Map();
  let faceList = [];
  const facePool = [];
  function syncFaces() {
    const host = c.parentElement; if (!host) return;
    const r = c.getBoundingClientRect(), hr = host.getBoundingClientRect(), k = r.width / CW, ky = r.height / CH, ox = r.left - hr.left, oy = r.top - hr.top;
    const sc = host.offsetWidth ? hr.width / host.offsetWidth : 1;   // 画面全体の拡大縮小（器）の分を戻す
    faceList.forEach((f, i) => {
      let d = facePool[i];
      if (!d) { d = document.createElement('div'); d.className = 'mface'; d.innerHTML = '<img alt="">'; host.appendChild(d); facePool[i] = d; }
      const im = d.firstChild; if (im.getAttribute('src') !== f.url) im.src = f.url;
      Object.assign(d.style, { display: 'block', left: (ox + f.cx * k) / sc + 'px', top: (oy + f.y * ky) / sc + 'px', width: f.cw * k / sc + 'px', height: f.ch * ky / sc + 'px', opacity: f.a });
      Object.assign(im.style, { left: (f.x - f.cx) * k / sc + 'px', width: f.w * k / sc + 'px', height: f.h * ky / sc + 'px' });
    });
    for (let i = faceList.length; i < facePool.length; i++) if (facePool[i].style.display !== 'none') facePool[i].style.display = 'none';
  }
  const thumbCache = new Map();
  function faceThumb(key, im, w, h) {
    const kk = key.length > 80 ? key.slice(-60) + key.length + 'x' + w : key + 'x' + w; if (thumbCache.has(kk)) return thumbCache.get(kk);
    const sc = Math.max(1, Math.min(2, window.devicePixelRatio || 1)) * Math.max(1, ($('#pitch').getBoundingClientRect().width || CW) / CW);   // 画面に出る大きさに合わせる
    const tw = Math.max(8, Math.round(w * sc)), tt = Math.max(8, Math.round(h * sc));
    let src = im, sw = im.naturalWidth, sh = im.naturalHeight;
    while (sw / 2 >= tw) { const c = document.createElement('canvas'); c.width = Math.round(sw / 2); c.height = Math.round(sh / 2); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height); src = c; sw = c.width; sh = c.height; }
    const c = document.createElement('canvas'); c.width = tw; c.height = tt; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, tw, tt);
    thumbCache.set(kk, c); if (thumbCache.size > 60) thumbCache.delete(thumbCache.keys().next().value);
    return c;
  }
  function drawFace(x, y, px, info, team) {
    // 顔写真（育成モードの顔）があればそれを出す。まだ読み込み中・ない時はドット絵
    try {
      const C2 = window.__career, url = C2 && C2.matchFace ? C2.matchFace(info, TEAM[team].W) : null;
      if (url) {
        let im = facePhotoImg.get(url); if (!im) { im = new Image(); im.src = url; facePhotoImg.set(url, im); if (facePhotoImg.size > 80) facePhotoImg.delete(facePhotoImg.keys().next().value); }
        if (im.complete && im.naturalWidth) { const bw = 84, bh = 84, k = Math.max(bw / im.naturalWidth, bh / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
          // 版465：顔写真は、キャンバスに描くと画面の拡大でぼやけるので、上に重ねた<img>で出す（くっきり）
          faceList.push({ url, x: x - 0.4 * px + (bw - w) / 2, y: y - 0.4 * px, w, h, cx: x - 0.4 * px, cw: bw, ch: bh, a: ctx.globalAlpha }); return; }
      }
    } catch (e) { /* 顔写真が使えない時はドット絵 */ }
    const col = info.gk ? GKC[team] : TEAM[team];
    const cv = DM.on ? spriteCanvas(info, team, 'front', 0, false, info.gk) : genSprite({ view: 'front', frame: 0, col, skin: SKIN[info.skin || 0], hair: hairOf(info), style: (info.hair || 0) % 4 });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, 0, 0, SPR_W, 14, x - px * 0.4, y - px * 0.4, SPR_W * px, 14 * px);
  }
  // 版464：はじめて固有スキルが出た時に一瞬止まらないよう、試合の前に「初めて使う重い描き方」を済ませておく
  //  （太字の漢字の文字・光のぼかし・グラデーション・その試合で使う選手の絵）
  function warmUp() {
    const run = (fn) => setTimeout(() => { try { fn(); } catch (e) {} }, 0);
    run(() => {
      ctx.save(); ctx.globalAlpha = 0.01;
      const names = Object.values(D.UNIQ || {}).map((u) => `【${u.name}】`).concat(Object.values(D.UNIQ || {}).map((u) => `【${u.name}・覚醒】`), Object.values(SKILL_NAME));
      for (const f of [`900 15px ${JP}`, `900 22px ${JP}`, `800 17px ${JP}`]) { ctx.font = f; for (const t of names) { ctx.measureText(t); ctx.fillText(t, -500, -500); } }
      ctx.shadowColor = 'rgba(255,51,172,1)'; for (const b of [3, 6, 14]) { ctx.shadowBlur = b; ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(6, 6); ctx.stroke(); ctx.fillRect(1, 1, 3, 3); }
      ctx.shadowBlur = 0; const g = ctx.createRadialGradient(4, 4, 1, 4, 4, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 8);
      ctx.restore();
    });
    // 固有スキルを持つ選手の絵：16の向き×走りの4コマを、少しずつ先に作っておく
    if (!DM.on || !window.DotMan) return;
    const jobs = [];
    for (const ti of [0, 1]) for (const info of (match.roster && match.roster[ti]) || []) {
      if (!info || !info.uniq) continue;
      const col = info.gk ? GKC[ti] : TEAM[ti];
      for (let d = 0; d < 16; d++) for (let f = 0; f < 4; f++) jobs.push(() => { const o = { facing: d * Math.PI / 8, shirt: col.W, shorts: col.P, socks: col.K, hair: hairOf(info), skin: SKIN[info.skin || 0], pose: 'run', art: ART_RUN, frame: f }; if (col.pat && col.pat !== 'solid' && !info.gk) { o.pat = col.pat; o.sub = col.S; } DotMan.frame(o); });
    }
    const step = () => { const t0 = performance.now(); while (jobs.length && performance.now() - t0 < 6) { try { jobs.shift()(); } catch (e) {} } if (jobs.length) setTimeout(step, 30); };
    setTimeout(step, 200);
  }
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  // カルチョビット風の選手パネル（得点者・カードの対象を知らせる）
  function playerPanel(idx, lines, alpha, extra, mid) {
    const team = idx < 11 ? 0 : 1, info = rinfo(team, idx % 11);
    const w = 470, h = 112, x = (CW - w) / 2, y = mid ? CH * 0.36 : CH * 0.56;
    const PS = 1.45, pcx = CW / 2, pcy = y + h / 2, f0 = faceList.length;   // 版496：選手の表示を大きく
    ctx.save(); ctx.translate(pcx, pcy); ctx.scale(PS, PS); ctx.translate(-pcx, -pcy);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(24,32,28,0.9)'; rrect(x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = '#d8c98a'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#e9edf0'; rrect(x + 10, y + 10, 92, 92, 8); ctx.fill();
    drawFace(x + 14, y + 16, 6, info, team);
    const F = '"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif';
    ctx.textAlign = 'left';
    ctx.font = `700 15px ${F}`; ctx.fillStyle = '#ffe680';
    ctx.fillText((team ? match.awayShort : match.homeShort), x + 118, y + 28);
    ctx.fillStyle = ({ GK: '#8e5bd6', DF: '#d83a3a', MF: '#f08a1c', FW: '#2f7fe0' })[info.position] || '#2a62c9'; /* 版663：ポジションの色（チームの色ではなく） */ rrect(x + 118, y + 38, 30, 24, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `900 16px ${F}`; ctx.textAlign = 'center'; ctx.fillText(info.position, x + 133, y + 56);
    ctx.textAlign = 'left'; ctx.font = `900 22px ${F}`; ctx.fillText(`${info.number}  ${info.name}`, x + 156, y + 59);
    ctx.font = `700 15px ${F}`; ctx.fillStyle = '#e8ece9';
    lines.forEach((l, k) => ctx.fillText(l, x + 118 + (extra && k === 0 ? 28 : 0), y + 84 + k * 18));
    if (extra) extra(x + 118, y + 70);
    ctx.globalAlpha = 1; ctx.restore();
    for (let k = f0; k < faceList.length; k++) { const f = faceList[k], tx = (v) => pcx + (v - pcx) * PS, ty = (v) => pcy + (v - pcy) * PS; f.x = tx(f.x); f.y = ty(f.y); f.cx = tx(f.cx); f.w *= PS; f.h *= PS; f.cw *= PS; f.ch *= PS; }
  }

  // ---------- 演出の描画 ----------
  const JP = '"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif';
  var TEAM_MAIN = ['#2f6fd6', '#e2453a'], TEAM_DARK = ['#1d4796', '#a12a22'];
  function emblem(x, y, r, team) {
    ctx.fillStyle = TEAM_DARK[team]; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, 7); ctx.fill();
    ctx.fillStyle = TEAM_MAIN[team]; ctx.beginPath(); ctx.arc(x, y, r * 0.38, 0, 7); ctx.fill();
  }
  function goalBanner(age) {
    // 「GOAL!!」が横から勢いよく入ってくる
    const u = Math.min(1, age / 0.25), x = CW / 2 + (1 - u) * (1 - u) * CW * 0.8;
    const y = CH * 0.2, fs = 92;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.06);
    ctx.font = `italic 900 ${fs}px "Arial Black",Impact,sans-serif`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.lineWidth = 18; ctx.strokeStyle = '#141414'; ctx.strokeText('GOAL!!', 0, fs * 0.35);
    ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.strokeText('GOAL!!', 0, fs * 0.35);
    const gr = ctx.createLinearGradient(0, -fs * 0.4, 0, fs * 0.4); gr.addColorStop(0, '#fff27a'); gr.addColorStop(1, '#ff9a12');
    ctx.fillStyle = gr; ctx.fillText('GOAL!!', 0, fs * 0.35);
    ctx.restore();
  }
  function bigScore(score, scorer, age, prev, flipAt) {
    const pop = Math.min(1, age * 4), a = Math.min(1, age * 5);
    ctx.globalAlpha = a;
    const cy = CH * 0.47, names = [match.homeShort, match.awayShort];
    // チーム名の札
    for (const k of [0, 1]) {
      const x = CW / 2 + (k ? 40 : -300), w = 260;
      ctx.fillStyle = 'rgba(20,28,24,0.85)'; rrect(x, cy - 150, w, 42, 6); ctx.fill();
      emblem(x + 24, cy - 129, 15, k);
      ctx.fillStyle = '#fff'; ctx.font = `900 22px ${JP}`; ctx.textAlign = 'left'; ctx.fillText(names[k], x + 48, cy - 121);
    }
    // 大きな数字
    const fs = Math.round(170 * (0.6 + 0.4 * pop));
    ctx.font = `900 ${fs}px "Arial Black",Impact,monospace`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    const draw = (t, x, col) => { ctx.lineWidth = 22; ctx.strokeStyle = '#141414'; ctx.strokeText(t, x, cy + fs * 0.36); ctx.lineWidth = 10; ctx.strokeStyle = '#fff'; ctx.strokeText(t, x, cy + fs * 0.36); ctx.fillStyle = col; ctx.fillText(t, x, cy + fs * 0.36); };
    const digit = (k, x) => {
      if (!prev || scorer !== k) { draw(String(score[k]), x, scorer === k && !prev ? '#ffa31a' : scorer === k ? '#ffa31a' : '#fff'); return; }
      // 決めた側の数字：はじめは前の点数、flipAt で縦にくるっと回って新しい点数に
      const ft = age - flipAt, dur = 0.24;
      if (ft < 0) { draw(String(prev[k]), x, '#fff'); return; }
      const sy = ft < dur ? Math.abs(Math.cos((ft / dur) * Math.PI)) : 1;
      const t = ft < dur / 2 ? String(prev[k]) : String(score[k]);
      ctx.save(); ctx.translate(0, cy); ctx.scale(1, Math.max(0.04, sy)); ctx.translate(0, -cy);
      draw(t, x, ft < dur / 2 ? '#fff' : '#ffa31a'); ctx.restore();
    };
    digit(0, CW / 2 - 170);
    draw('-', CW / 2, '#fff');
    digit(1, CW / 2 + 170);
    ctx.globalAlpha = 1;
  }
  // ---------- スキル演出 ----------
  let ballOwned = false;   // だれかがボールを持っている（シュートのエフェクトは止める）
  const SHOT_FX = { powerMid: 1, nearPost: 1 };   // ドリブルシュートは標準の打ち方になったので、エフェクトなし   // 無回転はエフェクトなし（ボールそのものがブレる）   // コントロールショットはエフェクトなし（弧は出さない）
  // いま飛んでいるシュート（2秒以内・ボールがまだ誰のものでもない）と、その技
  function curShot() {
    for (let k = shotsList.length - 1; k >= 0; k--) { const sh = shotsList[k]; if (sh.t > simT + 0.02) continue; if (simT - sh.t > 2.0) return null;
      if (sh.sk === undefined) { let sk = null, dsh = false; for (const a of actsOf[sh.i] || []) if (a.a === 'skill' && SHOT_SKILL.has(a.k) && a.t <= sh.t + 0.2 && a.t > sh.t - (a.k === 'powerMid' || a.k === 'nearPost' || a.k === 'superLong' ? 2.5 : 0.3)) { if (a.k !== 'dribbleShot') sk = a.k; }
        if (sh.chip) sk = 'lob'; if (sh.knuckle) sk = 'knuckle'; sh.sk = sk;
        { const ga = (actsOf[sh.i] || []).find((a) => a.a === 'uniq' && a.k === 'guren' && Math.abs(a.t - sh.t) < 0.35); sh.guren = ga ? ga.lv || 1 : 0; } }   // 紅蓮の牙：赤い風
      return sh; }
    return null;
  }
  const SHOT_SKILL = new Set(['volley', 'lob', 'direct', 'bicycle', 'divingHeader', 'toeKick', 'nearPost', 'powerMid', 'controlShot', 'superLong', 'knuckle', 'curve', 'dribbleShot', 'driveShot']);
  // いまカメラが寄るべき技（いちばん新しいもの）
  function skillCam() {
    let best = null;
    for (let i = 0; i < 22; i++) {
      const L2 = actsOf[i]; if (!L2) continue;
      for (let k = L2.length - 1; k >= 0; k--) {
        const a = L2[k]; if (a.t > simT) continue; if (simT - a.t > 2.2) break;
        if (a.a === 'dmove' && simT - a.t < a.d + 0.9) { if (!best || a.t > best.t) best = { t: a.t, i, shot: false, d: a.d }; break; }
        if (a.a === 'skill' && SHOT_SKILL.has(a.k) && simT - a.t < 1.5) { if (!best || a.t > best.t) best = { t: a.t, i, shot: true }; break; }
      }
    }
    return best;
  }
  // 技の最中、ボールが足元でどう動くか（見た目だけ。横＝L、前＝F。単位m）
  // マルセイユルーレットの体の向き（世界の角度）：前 → よける側と逆 → 背中（相手に背を向ける）→ よける側 → 前、で一回転。u≧0.75は回り終わり
  function rouletteAng(ac, u) {
    if (ac.fx == null || u >= 0.75) return null;
    const a0 = Math.atan2(ac.fy, ac.fx), aq = Math.atan2(-ac.dy, -ac.dx), W2 = (v) => Math.atan2(Math.sin(v), Math.cos(v));
    let d = W2(aq - a0);
    // よける側（相手の体と遠い側）と逆を先に向いて回る＝相手の体から遠い方へ回り込む（横から来た相手でも同じ）
    const sg = d >= 0 ? 1 : -1, ph = Math.min(1, u / 0.75), e = ph < 0.5 ? 2 * ph * ph : 1 - 2 * (1 - ph) * (1 - ph);
    return a0 + sg * Math.PI * 2 * e;
  }
  function skillBallOffset(ac) {
    const u = ac.u, c = (v) => Math.max(0, Math.min(1, v));
    switch (ac.k) {
      case 'doubleTouch': {   // 体の位置から：[横, 前]（abs＝選手の足元からの位置）。利き足の前 → 逆足の前 → さらに横・少し前
        if (u >= 0.5) return null;
        const lat = u < 0.12 ? -0.22 : u < 0.28 ? -0.22 + 0.55 * c((u - 0.12) / 0.12) : 0.33 + 0.3 * c((u - 0.28) / 0.13);
        const fw = u < 0.28 ? 0.32 : 0.32 + 0.25 * c((u - 0.28) / 0.13);
        return { abs: [lat, fw] };
      }
      case 'elastico': return u < 0.3 ? [-0.8 * Math.sin(c(u / 0.3) * Math.PI / 2), 0.25] : [-0.8 + 2.1 * c((u - 0.3) / 0.22), 0.25 + 0.5 * c((u - 0.4) / 0.4)];
      case 'roulette': {   // ボールは足裏の下：体の向きと一緒にぐるっと回る（体の前・約0.3m）
        const ra = rouletteAng(ac, u); if (ra == null) return null;
        const vx = Math.cos(ra), vy = Math.sin(ra);
        return [(vx * ac.dx + vy * ac.dy) * 0.3, (vx * ac.fx + vy * ac.fy) * 0.3 - 0.3];
      }
      case 'cutback': return u < 0.3 ? [0, 0.45] : [0.6 * c((u - 0.3) / 0.3), 0.45 - 1.3 * c((u - 0.3) / 0.3)];
      case 'scissors': { const t1 = ac.dbl ? 0.593 : 0.42, t2 = ac.dbl ? 0.667 : 0.5, fw = Math.abs(ac.fy || 0) > 0.92 ? 0.35 : Math.abs(ac.fy || 0) > 0.38 ? 0.5 : 0.6; return u < t1 ? { abs: [0, fw] } : u < t2 ? { abs: [(ac.dbl ? 0.3 : 0.75) * c((u - t1) / (t2 - t1)), fw - 0.2 * c((u - t1) / (t2 - t1))] } : null; }   // 手前・奥向きは奥行きが縮んで見えるので、ボールを足に近づける   // 足がボールの真上を通る位置（体の0.6m前）   // またぐ間ボールは動かない → 反対の足で横へ
      case 'bodyFeint': return u < 0.33 ? { abs: [-0.05, 0.35] } : u < 0.45 ? { abs: [-0.05 + 0.75 * c((u - 0.33) / 0.12), 0.35] } : null;   // 踏み出す間はボールは足元 → 反対の足で横へ転がす
      case 'kickFeint': return u < 0.36 ? { abs: [0, 0.45] } : u < 0.56 ? { abs: [1.24 * c((u - 0.36) / 0.2), 0.45] } : null;   // 振りかぶる間は足元 → インで横へずらす
      case 'hurdle': { const ph = c((u - 0.08) / 0.7); return u > 0.85 ? null : [0, 0.45 + 0.35 * ph, 0.85 * Math.sin(ph * Math.PI)]; }   // つま先で浮かせて、一緒に越える
      case 'heelLift': return u < 0.27 ? { abs: [0.05, 0.42 - 0.72 * c(u / 0.27)] } : u < 0.42 ? { abs: [0.05, -0.3, 0.12 + 0.25 * c((u - 0.27) / 0.15)] } : null;   // 版666：前の足の裏で後ろへ転がし → 後ろの足のかかとに乗せて少し持ち上げる   // つま先で浮かせて、一緒に越える
      case 'swerve': return u < 0.5 ? [0.35, 0.35] : null;
      case 'cutIn': return u >= 0.3 && u < 0.5 ? { abs: [0.2 + 0.35 * c((u - 0.3) / 0.12), 0] } : null;   // 踏ん張った足の前から、インで内へ持ち出す
      default: return null;
    }
  }
  // 足の振りの軌跡（白い弧）
  function swoosh(cx, cy, r, a0, a1, alpha, col) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = col || '#ffffff'; ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) { ctx.lineWidth = Math.max(1.5, r * 0.18) * (1 - k * 0.3); ctx.beginPath(); ctx.ellipse(cx, cy, r * (1 - k * 0.08), r * 0.45 * (1 - k * 0.08), 0, a0, a1, a1 < a0); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }
  // 技が出た瞬間：足元から黄色い輪と集中線
  function skillFlash(x, y, px, age) {
    const u = age / 0.4; if (u > 1) return;
    ctx.globalAlpha = 1 - u;
    ctx.strokeStyle = '#ffe23a'; ctx.lineWidth = Math.max(2, px * 1.1);
    ctx.beginPath(); ctx.ellipse(x, y - px * 2, px * (4 + u * 14), px * (1.6 + u * 5), 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, px * 0.6);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3, r0 = px * (7 + u * 8), r1 = r0 + px * (5 + (k % 3) * 2) * (1 - u);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y - px * 9 + Math.sin(a) * r0 * 0.7); ctx.lineTo(x + Math.cos(a) * r1, y - px * 9 + Math.sin(a) * r1 * 0.7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // 溜め：足元から立ち上るオーラと、吸い込まれる光の線
  function chargeAura(x, y, px, u) {
    const pulse = 0.75 + 0.25 * Math.sin(simT * 40);
    const g = ctx.createRadialGradient(x, y - px * 8, px, x, y - px * 8, px * (8 + u * 6));
    g.addColorStop(0, `rgba(255,240,120,${0.55 * pulse})`); g.addColorStop(0.6, `rgba(255,150,30,${0.35 * pulse})`); g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y - px * 8, px * (8 + u * 6), px * (11 + u * 6), 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,200,0.9)'; ctx.lineWidth = Math.max(1.5, px * 0.5);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + simT * 3, rr = px * (14 - ((simT * 25 + k * 3) % 10));
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * rr, y - px * 8 + Math.sin(a) * rr * 0.8); ctx.lineTo(x + Math.cos(a) * (rr - px * 2.5), y - px * 8 + Math.sin(a) * (rr - px * 2.5) * 0.8); ctx.stroke();
    }
  }
  // 画面下の大きな技名（カルチョビットA風）
  let skillBanner = null;
  function drawSkillBanner() {
    if (!skillBanner) return;
    const age = simT - skillBanner.t; if (age < 0 || age > 1.8) return;
    const inA = Math.min(1, age / 0.15), out = Math.min(1, (1.8 - age) / 0.25);
    const dg = show && show.phase === 'digest';   // ダイジェストは下に字幕と操作ボタンがあるので、枠の中の左上に出す
    const x = (dg ? 56 : 24) - (1 - inA) * 260, y = dg ? 124 : CH - 70, txt = skillBanner.name;
    ctx.save(); ctx.globalAlpha = out;
    ctx.font = `italic 900 40px ${JP}`; const w = ctx.measureText(txt).width;
    ctx.fillStyle = skillBanner.team ? 'rgba(200,40,30,0.85)' : 'rgba(30,80,190,0.85)';
    ctx.beginPath(); ctx.moveTo(x - 10, y - 38); ctx.lineTo(x + w + 50, y - 38); ctx.lineTo(x + w + 30, y + 12); ctx.lineTo(x - 30, y + 12); ctx.closePath(); ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = '#1a1a1a'; ctx.textAlign = 'left'; ctx.strokeText(txt, x + 10, y);
    const gr = ctx.createLinearGradient(0, y - 34, 0, y + 4); gr.addColorStop(0, '#fff27a'); gr.addColorStop(1, '#ff9a12');
    ctx.fillStyle = gr; ctx.fillText(txt, x + 10, y);
    ctx.font = `800 14px ${JP}`; ctx.fillStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeText(skillBanner.who, x + 12, y - 44); ctx.fillText(skillBanner.who, x + 12, y - 44);
    ctx.restore();
  }

  // 落ち込みの縦線（頭の上に、ゆらゆら）
  function gloom(x, y, px, seed) {
    ctx.strokeStyle = 'rgba(70,60,140,0.85)'; ctx.lineWidth = Math.max(1.5, px * 0.7);
    for (let k = -1; k <= 1; k++) {
      const h = (4 + ((k + 1) % 2) * 2) * px, wob = Math.sin(simT * 3 + seed + k) * px * 0.4;
      ctx.beginPath(); ctx.moveTo(x + k * 3 * px + wob, y - h); ctx.lineTo(x + k * 3 * px + wob, y); ctx.stroke();
    }
  }
  // 接触の火花：足・頭・体が当たった所に一瞬だけ。反則（人と人）は大きく、赤みがかった星
  function burst(cx, cy, R0, a, foul) {
    ctx.globalAlpha = a;
    ctx.fillStyle = foul ? '#ffd9a0' : '#fffbe0'; ctx.strokeStyle = foul ? '#e2361c' : '#e8a020'; ctx.lineWidth = foul ? 2.5 : 1.5;
    ctx.beginPath();
    const n = foul ? 14 : 10;
    for (let k = 0; k < n; k++) { const an = (k / n) * Math.PI * 2 + 0.2, rr = k % 2 ? R0 * 0.42 : R0; ctx.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * 0.8); }
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawContacts(st) {
    if (!contacts.length) return;
    let lo = 0, hi = contacts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (contacts[m].t < simT - 0.5) lo = m + 1; else hi = m; }
    for (let k = lo; k < contacts.length && contacts[k].t <= simT; k++) {
      const c = contacts[k], age = simT - c.t, life = c.big >= 2 ? 0.45 : 0.24;
      if (age > life) continue;
      const p = P3(c.x, c.y, c.z + 0.12);
      if (p.f < 4) continue;
      const u = age / life, s = Math.max(0.6, p.s || 1);
      const R0 = (c.big === 3 ? 14 + u * 24 : c.big === 2 ? 9 + u * 14 : c.big ? 6 + u * 9 : 4 + u * 7) * Math.max(1, (p.s || 1) * 2.4);
      burst(p.x, p.y, R0, Math.min(1, 1.7 * (1 - u)), c.big >= 2);
    }
    // 審判の笛：反則の直後、審判の口元から音の線（試合終了の笛は長めに、3回）
    const whistles = fouls.map((ft) => simT - ft);
    if (show && show.phase === 'endOut') for (const w0 of [0, 0.45, 0.9]) whistles.push(show.rt - w0);
    if (st && st.ref) for (const age of whistles) {
      if (age < 0 || age > (show && show.phase === 'endOut' ? 0.4 : 1.0)) continue;
      const q = proj(st.ref.x, st.ref.y), px = Math.max(1.4, 2.6 * q.s), hx = q.x + 4 * px, hy = q.y - 19 * px;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      const w = (Math.floor(age * 8) % 2) ? 1 : 0.75;
      for (const [a0, l] of [[-0.9, 9], [-0.35, 11], [0.2, 9]]) {
        ctx.beginPath(); ctx.moveTo(hx + Math.cos(a0) * 6 * px * 0.5, hy + Math.sin(a0) * 6 * px * 0.5); ctx.lineTo(hx + Math.cos(a0) * (6 + l * w) * px * 0.5, hy + Math.sin(a0) * (6 + l * w) * px * 0.5); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  }
  function drawShowOverlay(st) {
    if (show.phase === 'halfOut' || show.phase === 'endOut') {
      // 笛：選手が止まり、少し間をおいて暗転（試合終了は最終スコアを出す）
      // 前半終了・試合終了とも文字は出さない（本家：笛で選手が止まり、審判が手を上げて、そのまま暗転）
      const a = show.phase === 'halfOut' ? Math.max(0, (show.rt - 0.6) / 0.8) : Math.max(0, (show.rt - END_T.fade0) / (END_T.fade1 - END_T.fade0));
      if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, a)})`; ctx.fillRect(0, 0, CW, CH); }
      return;
    }
    if (show.phase === 'digest') { drawDigestFrame(); return; }
    if (false) {
      const g = show.list[show.k];
      const min = Math.ceil((g.t * match.clockScale) / 60), half = g.t < halfT ? '前半' : '後半', m2 = g.t < halfT ? min : min - 45;
      ctx.fillStyle = 'rgba(10,40,20,0.85)'; ctx.fillRect(0, 60, CW, 34);
      ctx.fillStyle = '#fff'; ctx.font = `800 17px ${JP}`; ctx.textAlign = 'left';
      ctx.fillText(`DIGEST　${g.player}（${g.team ? match.awayShort : match.homeShort}）  ${min}'    ${match.homeShort} ${g.score[0]}-${g.score[1]} ${match.awayShort}`, 16, 83);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(CW * 0.12, CH - 116, CW * 0.76, 66);
      ctx.fillStyle = '#fff'; ctx.font = `800 20px ${JP}`; ctx.textAlign = 'center';
      const how = g.style === 'head' ? 'ヘディングで' : g.knuckle ? '無回転シュートで' : g.speed >= 100 ? '強烈なシュートで' : '';
      ctx.fillText(`${half}${m2}分　${g.team ? match.awayShort : match.homeShort}　${g.player}、${how}${g.assist ? g.assist + 'のアシストから' : ''}ゴール！`, CW / 2, CH - 74);
      ctx.font = `700 13px ${JP}`; ctx.fillText(`ダイジェスト ${show.k + 1}/${show.list.length}　ループ再生中（タップで次のシーン）`, CW / 2, CH - 58);
      return;
    }
    const g = show.goal;
    if (show.phase === 'score' && g) {
      // 前の点数が出て、決めた側の数字がくるっと回って新しい点数（オレンジ）に変わる
      const prev = g.score.slice(); if (g.team === 0 || g.team === 1) prev[g.team] = Math.max(0, prev[g.team] - 1);
      goalBanner(show.rt);
      bigScore(g.score, g.team, show.rt, prev, 0.75);
    }
    if (show.phase === 'freeze' && g) {
      // 止まっている間：画面が一瞬白く光る
      const a = Math.max(0, 0.35 - show.rt * 0.8);
      if (a > 0) { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(0, 0, CW, CH); }
    }
    if (show.phase === 'jreplay' || show.phase === 'jfade') {
      if (show.off) {
        // オフサイドライン（パスが出た瞬間の、後ろから2人目の相手の位置）
        const a = Math.min(1, Math.max(0, (simT - (show.key - 0.6)) * 2));
        if (a > 0) {
          ctx.globalAlpha = 0.85 * a; ctx.strokeStyle = '#7fe8ff'; ctx.lineWidth = 3;
          gline(show.e.line, 0, show.e.line, 68); ctx.globalAlpha = 1;
        }
        if (show.paused > 0 && show.paused < 1.1) {
          const q = proj(show.e.ox, show.e.oy);
          ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(q.x, q.y - 4, 20, 8, 0, 0, 7); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, CW, 34); ctx.fillRect(0, CH - 34, CW, 34);
      ctx.font = `italic 900 34px "Arial Black",Impact,sans-serif`; ctx.textAlign = 'left';
      ctx.lineWidth = 6; ctx.strokeStyle = '#1a1a1a'; ctx.strokeText('REPLAY', 40, 146);
      ctx.fillStyle = '#f4f4f4'; ctx.fillText('REPLAY', 40, 146);
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(40, 156, 170, 3);
      if (Math.floor(show.rt * 2) % 2 === 0) { ctx.fillStyle = '#e8241c'; ctx.beginPath(); ctx.arc(226, 134, 7, 0, 7); ctx.fill(); }
      if (show.phase === 'jfade') { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, show.rt / 0.4)})`; ctx.fillRect(0, 0, CW, CH); }
    }
    if (show.phase === 'jreplay' && show.rt < 0.3) { ctx.fillStyle = `rgba(0,0,0,${1 - show.rt / 0.3})`; ctx.fillRect(0, 0, CW, CH); }
    if (show.phase === 'jback') { ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 1 - show.rt / 0.4)})`; ctx.fillRect(0, 0, CW, CH); }
    if (show.phase === 'replay' || show.phase === 'fade') {
      // REPLAY の文字と上下の帯
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, CW, 34); ctx.fillRect(0, CH - 34, CW, 34);
      ctx.font = `italic 900 34px "Arial Black",Impact,sans-serif`; ctx.textAlign = 'left';
      ctx.lineWidth = 6; ctx.strokeStyle = '#1a1a1a'; ctx.strokeText('REPLAY', 40, 146);
      ctx.fillStyle = '#f4f4f4'; ctx.fillText('REPLAY', 40, 146);
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(40, 156, 170, 3);
      if (Math.floor(show.rt * 2) % 2 === 0) { ctx.fillStyle = '#e8241c'; ctx.beginPath(); ctx.arc(226, 134, 7, 0, 7); ctx.fill(); }
    }
    if (show.phase === 'preVs') drawVs(show.rt);
    if (show.phase === 'fade') { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, show.rt / 0.5)})`; ctx.fillRect(0, 0, CW, CH); }
    if (show.phase === 'hurry' && show.rt < 0.5) { ctx.fillStyle = `rgba(0,0,0,${1 - show.rt / 0.5})`; ctx.fillRect(0, 0, CW, CH); }
    if (show.phase === 'kickoff') {
      const age = show.rt;
      if (age < 0.5 && !show.noFade) { ctx.fillStyle = `rgba(0,0,0,${1 - age / 0.5})`; ctx.fillRect(0, 0, CW, CH); }
      if (g && g.idx >= 0 && age > 0.3 && age < 3.6) {
        const a = Math.min(1, (age - 0.3) * 4, (3.6 - age) * 3);
        const min = Math.ceil((g.t * match.clockScale) / 60);
        playerPanel(g.idx, [`${min}分　この試合${show.nGoals}点目のゴール`, g.assist ? `アシスト　${g.assist}` : 'アシストなし'], a, null, true);
      }
    }
  }
  // 試合前のVS画面：ホームとアウェイ、予想（勝ち・引き分け・負けの割合）
  function teamRating(t) { const ps = t.players.slice(0, 11); return ps.reduce((a, p) => a + (p.kick + p.speed + p.stamina + p.technique + p.physical) / 5, 0) / ps.length; }
  function drawVs(rt) {
    const a = Math.min(1, rt * 4);
    const dr = 0;
    let pw = Math.max(0.1, Math.min(0.75, 0.37 + dr * 0.035)), pd = 0.28, pl = Math.max(0.05, 1 - pw - pd);
    const tot = pw + pd + pl; pw = Math.round(pw / tot * 100); pd = Math.round(pd / tot * 100); pl = 100 - pw - pd;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(10,14,12,0.55)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(20,24,22,0.9)'; ctx.fillRect(0, 18, CW, 44);
    ctx.fillStyle = '#fff'; ctx.font = `800 22px ${JP}`; ctx.textAlign = 'center'; ctx.fillText('親善試合', CW / 2, 48);
    const slide = (1 - Math.min(1, rt * 2.5)) * 300;
    const bar = (y, team, label, sub, col, dx) => {
      ctx.save(); ctx.translate(dx, 0);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(CW * 0.2 + 30, y); ctx.lineTo(CW * 0.72, y); ctx.lineTo(CW * 0.72 - 30, y + 74); ctx.lineTo(CW * 0.2, y + 74); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3; ctx.stroke();
      emblem(CW * 0.2 + 70, y + 37, 26, team);
      ctx.fillStyle = '#fff'; ctx.font = `900 34px ${JP}`; ctx.textAlign = 'left'; ctx.fillText(label, CW * 0.2 + 110, y + 48);
      ctx.fillStyle = '#1b1b1b'; rrect(CW * 0.5, y + 56, 150, 30, 15); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 17px ${JP}`; ctx.textAlign = 'center'; ctx.fillText(sub, CW * 0.5 + 75, y + 77);
      ctx.restore();
    };
    bar(CH * 0.2, 0, match.home, 'HOME', '#c8202a', -slide);
    ctx.fillStyle = '#fff'; ctx.font = `italic 900 60px "Arial Black",Impact,sans-serif`; ctx.textAlign = 'center';
    ctx.lineWidth = 8; ctx.strokeStyle = '#1a1a1a'; ctx.strokeText('VS', CW * 0.46, CH * 0.2 + 152); ctx.fillText('VS', CW * 0.46, CH * 0.2 + 152);
    bar(CH * 0.2 + 180, 1, match.away, 'AWAY', '#5d6066', slide);
    // 予想の箱
    const bx = CW * 0.78, by = CH * 0.18;
    ctx.fillStyle = '#ffe23a'; ctx.fillRect(bx, by, 130, 250); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3; ctx.strokeRect(bx, by, 130, 250);
    ctx.fillStyle = '#1a1a1a'; ctx.font = `900 18px ${JP}`; ctx.fillText('勝敗予想', bx + 65, by + 28);
    [['WIN', pw], ['DRAW', pd], ['WIN', pl]].forEach(([l, v], k) => {
      const y = by + 44 + k * 66;
      ctx.fillStyle = '#fff'; ctx.fillRect(bx + 10, y, 110, 56); ctx.strokeRect(bx + 10, y, 110, 56);
      ctx.fillStyle = '#1a1a1a'; ctx.font = `900 15px ${JP}`; ctx.fillText(l + (k === 0 ? '（ホーム）' : k === 2 ? '（アウェイ）' : ''), bx + 65, y + 19);
      ctx.font = `900 26px "Arial Black",monospace`; ctx.fillText(v + '%', bx + 65, y + 48);
    });
    ctx.fillStyle = 'rgba(20,24,22,0.9)'; ctx.fillRect(0, CH - 70, CW, 40);
    ctx.fillStyle = '#fff'; ctx.font = `800 20px ${JP}`; ctx.fillText('はじまりスタジアム', CW / 2, CH - 43);
    ctx.globalAlpha = 1;
  }
  // 観客席：決めたチームのサポーターが旗を振って沸く
  function drawCrowd(team, rt, chant, sad) {
    const t = rt;
    ctx.fillStyle = '#3b3f46'; ctx.fillRect(0, 0, CW, CH);
    const COLS = [TEAM_MAIN[team], '#ffffff', TEAM_DARK[team], '#f2d14a', TEAM_MAIN[team], '#e9e2d0'];
    const rows = 13, rowH = 34, top = 10;
    for (let r = 0; r < rows; r++) {
      const y = top + r * rowH, w = 26;
      ctx.fillStyle = r % 2 ? '#4a4f57' : '#53585f'; ctx.fillRect(0, y + rowH - 8, CW, 8);
      for (let c = 0; c * w < CW + w; c++) {
        const seed = (r * 37 + c * 11) % 17;
        if (hsh2(r + 3, c + 7) > [0.2, 0.4, 0.65, 0.9, 1][venue]) continue;   // 会場が小さいほど、空いている席が多い
        const jump = sad ? 0 : Math.max(0, Math.sin(t * 10 + seed)) * 6;
        const x = c * w + (r % 2) * 13 + 4, yy = y + 6 - jump;
        ctx.fillStyle = COLS[seed % COLS.length]; ctx.fillRect(x, yy + 10, 16, 14);
        ctx.fillStyle = SKIN[seed % 3]; ctx.fillRect(x + 3, yy, 10, 10);
        ctx.fillStyle = HAIR[seed % 5]; ctx.fillRect(x + 3, yy, 10, sad ? 7 : 3);   // 残念：うつむいて頭のてっぺんが見える
        if (sad) { if (seed % 4 === 0) { ctx.fillStyle = SKIN[seed % 3]; ctx.fillRect(x + 1, yy + 1, 3, 4); ctx.fillRect(x + 12, yy + 1, 3, 4); } continue; }   // 頭を抱える
        if (seed % 3 === 0) { ctx.fillStyle = SKIN[seed % 3]; ctx.fillRect(x - 2, yy - 6 + jump * 0.5, 3, 10); ctx.fillRect(x + 15, yy - 6 + jump * 0.5, 3, 10); }
      }
    }
    // 看板とピッチ
    const by = top + rows * rowH;
    const ads = ['DOT SOCCER', 'はじまりFC', 'GOAL!!', 'カルチョ', 'SHOOT', 'ドット商店'];
    for (let k = 0; k * 200 < CW; k++) {
      ctx.fillStyle = ['#c8202a', '#f2f2f2', '#1f5fbf', '#f2c230'][k % 4]; ctx.fillRect(k * 200, by, 200, 40);
      ctx.fillStyle = k % 4 === 1 || k % 4 === 3 ? '#1a1a1a' : '#fff'; ctx.font = `900 20px ${JP}`; ctx.textAlign = 'center'; ctx.fillText(ads[k % ads.length], k * 200 + 100, by + 28);
    }
    ctx.fillStyle = '#5fa92c'; ctx.fillRect(0, by + 40, CW, CH - by - 40);
    ctx.fillStyle = '#63ae2f'; for (let k = 0; k < CW; k += 120) ctx.fillRect(k, by + 40, 60, CH - by - 40);
    // 大きな旗（布が波打つ）
    for (let f = 0; f < (sad ? 3 : 7); f++) {
      // 残念な時：旗は振らずに下ろしたまま（だらんと垂れる）
      const bx = sad ? ((f * 0.33 + 0.1) * CW) : ((f * 0.155 + 0.05) * CW) + Math.sin(t * 2 + f) * 20, byy = sad ? 260 + (f % 2) * 40 : 120 + (f % 3) * 95;
      const ang = sad ? 1.15 + f * 0.05 : Math.sin(t * 3.2 + f * 1.3) * 0.5 - 0.2;
      const wave = sad ? 0.15 : 1;
      const px0 = bx, py0 = byy + 170, px1 = bx + Math.sin(ang) * 170, py1 = py0 - Math.cos(ang) * 170;
      ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px1, py1); ctx.stroke();
      const W2 = 150, H2 = 95;
      ctx.fillStyle = f % 2 ? TEAM_MAIN[team] : '#f2c230';
      ctx.beginPath();
      for (let k = 0; k <= 10; k++) { const u = k / 10; ctx.lineTo(px1 + u * W2 * Math.cos(ang), py1 + u * W2 * Math.sin(ang) + Math.sin(t * 8 + u * 5 + f) * 10 * u * wave); }
      for (let k = 10; k >= 0; k--) { const u = k / 10; ctx.lineTo(px1 + u * W2 * Math.cos(ang) - H2 * Math.sin(-ang) * 0, py1 + H2 + u * W2 * Math.sin(ang) + Math.sin(t * 8 + u * 5 + f) * 10 * u * wave); }
      ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      emblem(px1 + W2 * 0.5 * Math.cos(ang), py1 + H2 / 2 + W2 * 0.5 * Math.sin(ang) + Math.sin(t * 8 + 2.5 + f) * 5 * wave, 24, team);
    }
    if (chant) {
      // チーム名のコール（ギザギザの吹き出し）
      const bx = CW * 0.45, by = CH * 0.42, R0 = 150, R1 = 118;
      // 文字の長さに合わせて吹き出しを横に広げる（入りきらない時は文字を少し小さく）
      let fs = 36; ctx.font = `900 ${fs}px ${JP}`; let tw = ctx.measureText(chant).width;
      const maxW = CW * 0.78; if (tw > maxW - 60) { fs = Math.max(20, Math.floor(fs * (maxW - 60) / tw)); ctx.font = `900 ${fs}px ${JP}`; tw = ctx.measureText(chant).width; }
      const sx = Math.max(1.25, (tw / 2 + 46) / (R1 * 0.92));
      ctx.beginPath();
      for (let k = 0; k <= 28; k++) { const a = (k / 28) * Math.PI * 2, rr = k % 2 ? R1 : R0; ctx.lineTo(bx + Math.cos(a) * rr * sx, by + Math.sin(a) * rr * 0.42); }
      ctx.closePath(); ctx.fillStyle = sad ? '#b9bcc4' : '#ffe23a'; ctx.fill(); ctx.strokeStyle = sad ? '#444' : '#1a1a1a'; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = sad ? '#3a3d48' : '#1a1a1a'; ctx.font = `900 ${fs}px ${JP}`; ctx.textAlign = 'center'; ctx.fillText(chant, bx, by + fs * 0.36);
      if (t < 0.35) { ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.35})`; ctx.fillRect(0, 0, CW, CH); }
      return;
    }
    if (chant === false) return;   // 版580：優勝の演出では、吹き出しはHTMLで出す
    // 吹き出し
    const lines = team === 0 ? ['いいぞっ！', 'よっしゃー！', 'ナイスゴール！'] : ['やられた…', 'まだまだ！', 'ほっ…'];
    const msg = lines[Math.min(lines.length - 1, Math.floor(t / 1.0))];
    const bxx = CW * (0.35 + 0.25 * ((Math.floor(t) % 2))), byy2 = CH * 0.36;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(bxx, byy2, 120, 46, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bxx - 20, byy2 + 40); ctx.lineTo(bxx - 40, byy2 + 78); ctx.lineTo(bxx + 6, byy2 + 44); ctx.fill();
    ctx.fillStyle = '#ff8a1a'; ctx.font = `900 34px ${JP}`; ctx.textAlign = 'center'; ctx.fillText(msg, bxx, byy2 + 12);
    if (t < 0.35) { ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.35})`; ctx.fillRect(0, 0, CW, CH); }
  }

  // 全体が分かる小さな地図
  function minimap(st) {
    const w = 170, h = 110, x0 = CW - w - 12, y0 = CH - h - 12;
    ctx.fillStyle = 'rgba(16,40,20,0.72)'; ctx.fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, w, h);
    ctx.beginPath(); ctx.moveTo(x0 + w / 2, y0); ctx.lineTo(x0 + w / 2, y0 + h); ctx.stroke();
    ctx.strokeRect(x0, y0 + h * 0.2, w * 0.157, h * 0.6); ctx.strokeRect(x0 + w * 0.843, y0 + h * 0.2, w * 0.157, h * 0.6);
    const m = (x, y) => [x0 + (x / 105) * w, y0 + (y / 68) * h];
    // カメラの見えている範囲
    ctx.strokeStyle = 'rgba(255,255,120,0.5)';
    const [cx, cy] = m(cam.x, cam.y); ctx.strokeRect(cx - w * 0.22, cy - h * 0.3, w * 0.44, h * 0.5);
    st.players.forEach((p, i) => {
      if (st.gone & (2 ** i)) return;
      const [x, y] = m(p.x, p.y);
      ctx.fillStyle = i === selected ? '#fff35a' : i < 11 ? (i ? '#4f8df0' : '#f2c230') : (i === 11 ? '#2fb36a' : '#f05a4e');
      ctx.fillRect(x - 3, y - 3, 6, 6);
    });
    const [bx, by] = m(st.ball.x, st.ball.y);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, 3, 0, 7); ctx.fill();
  }

  // 審判・副審の合図：再開の種類ごとに決まった動き
  //  ゴールキック：ゴールエリアを指す／コーナー：コーナーを指す／スローイン：攻める向きへ斜め上
  //  オフサイド：副審がまず旗を真上、そのあと反則の位置を指す。主審は間接FKの合図で手を上げる
  function officialSignals(st) {
    const out = { ref: null, ar: [null, null] };
    const c = st.code;
    if (!c || c === 6 || st.rx < 0) return out;
    const age = simT - st.codeT;
    const rx = st.rx, k = arSide(st), ary = k === 0 ? -2.2 : 70.2, arx = st.ar[k];
    const attackX = (st.rteam === 0) === (st.side > 0) ? 105 : 0;
    const goalX = rx > 52.5 ? 105 : 0;
    if (c === 3) {
      out.ar[k] = { mode: 'level', tx: goalX + (goalX ? -5.5 : 5.5), ty: 34 };
      if (age > 0.6) out.ref = { mode: 'level', tx: goalX + (goalX ? -5.5 : 5.5), ty: 34 };
    } else if (c === 2) {
      const cy = st.ball.y < 34 ? 0 : 68;
      out.ar[k] = { mode: 'down', tx: goalX, ty: cy };
      if (age > 0.6) out.ref = { mode: 'diag', tx: goalX, ty: cy };
    } else if (c === 1) {
      out.ar[k] = { mode: 'diag', tx: arx + (attackX ? 10 : -10), ty: ary };
    } else if (c === 8) {
      out.ar[k] = age < 2.4 ? { mode: 'up', tx: arx, ty: ary } : { mode: st.restY < 23 ? 'diag' : st.restY > 45 ? 'down' : 'level', tx: arx, ty: st.restY };
      if (age > 1.2) out.ref = { mode: 'up', tx: st.ref.x + 1, ty: st.ref.y };
    } else if (c === 4) {
      if (age > 0.5) out.ref = { mode: 'level', tx: st.ref.x + (attackX ? 10 : -10), ty: st.ref.y };
    } else if (c === 7) {
      out.ref = { mode: 'down', tx: rx, ty: 34 };
    }
    return out;
  }

  let celebInfo = null, passMark = -1;
  let lastDrawT = -1, cornerT = -99, zoom = 1, camMaxY = 62;
  // 交代のお知らせ（カード・電光掲示板）：交代の演出が終わったのに残っていたら消す（巻き戻し・早送り・ゴールの演出と重なった時など）
  let subEls = null;
  function clearSubIfDone() {
    if (show && show.phase === 'sub') return;
    subEls = subEls || [document.getElementById('subCard'), document.getElementById('subLed')];
    for (const el of subEls) if (el && el.classList.contains('show')) el.classList.remove('show');
  }
  function draw() {
    syncFaces(); faceList = [];
    clearSubIfDone();
    if (!match) return;
    if (show && show.phase === 'crowd') {
      // 決めたチームのサポーターのコール（状況で変わる）
      const g = show.goal, me = g.score[g.team], op = g.score[1 - g.team];
      const c1 = me > op ? (me - op >= 2 ? '突き放せ〜！' : 'リードリード') : me === op ? '同点同点！' : 'まだまだ！';
      if (g.team === 1) drawCrowd(0, show.rt, show.rt < 1.6 ? 'あぁ〜…' : 'まだまだ…！', true);
      else drawCrowd(g.team, show.rt, show.rt < 1.6 ? c1 : 'いいぞっ');
      return;
    }
    if (show && show.phase === 'endCrowd') {
      const sc = match.score, d = sc[0] - sc[1];
      drawCrowd(0, show.rt, d >= 3 ? '大勝〜♪' : d > 0 ? '勝った勝った！' : d === 0 ? 'おしい〜' : 'つぎは勝つぞ…', d < 0);
      return;
    }
    if (show && show.phase === 'preCrowd') { drawCrowd(0, show.rt, match.home); return; }
    if (show && show.phase === 'champ' && show.stage !== 1) {   // 版580：優勝の演出（観客席・紙吹雪）
      if (show.stage === 0 || show.stage === 4) drawCrowd(0, show.rt + show.stage * 3 + 1, false); else { ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, CW, CH); }
      drawConfetti(show.t); return;
    }
    const st = stateAt(simT);
    if (show && show.phase === 'champ') champField(st);
    // 入場：手前のタッチラインから2列で走ってセンターサークルへ → 一度そろって並ぶ → それぞれのポジションへ走る
    // 動く速さは試合と同じくらい（ジョグ6.5・ダッシュ最大8.5）にして、足の動きと進む距離をそろえる
    animT = simT;
    if (show && show.walk && show.phase === 'kickoff' && show.koT === 0) {
      const r = show.rt; animT = r;
      const T1 = WALK_T.t1, T3 = WALK_T.t3;
      // 一定の速さで A→B（最初の0.3秒で加速、最後の0.6mで減速）
      const mv = (p, ax, ay, bx, by, s0, v) => {
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 0.001, ta = 0.3;
        const tau = r - s0, dur = L / v + ta / 2;
        let d, spd;
        if (tau <= 0) { d = 0; spd = 0; }
        else if (tau >= dur) { d = L; spd = 0; }
        else { d = tau < ta ? v * tau * tau / (2 * ta) : v * (tau - ta / 2); spd = v * Math.min(1, tau / ta); }
        d = Math.min(L, d); if (L - d < 0.6) spd *= (L - d) / 0.6;
        p.x = ax + dx / L * d; p.y = ay + dy / L * d;
        p.moving = spd > 0.4; p.sp = spd; p.vx = dx / L * spd; p.vy = dy / L * spd;
      };
      st.players.forEach((p, i) => {
        const tm = i < 11 ? 0 : 1, k = i % 11, side = tm ? 1 : -1;
        // 版801：列の並び：キャプテンが先頭、そのあとはいつもの順（GK・DF・MF・FW）
        const cap = match.captains ? match.captains[tm] : -1, q0 = cap >= 0 && cap < 11 ? (k === cap ? 0 : k < cap ? k + 1 : k) : k;
        const qx = 52.5 + side * 1.3, qy = 70 + q0 * 1.6;          // 入場前の列（画面の外）
        const lx = 52.5 + side * 1.3, ly = 45 + q0 * 1.3;          // センターサークルの手前にそろう位置
        const fx = p.x, fy = p.y;                                  // キックオフの位置
        if (r < T3) { mv(p, qx, qy, lx, ly, T1, 6.5); if (r > T1 + 4.4) { p.vx = 0; p.vy = -0.3; } }
        else { const L = Math.hypot(fx - lx, fy - ly); mv(p, lx, ly, fx, fy, T3 + k * 0.04, Math.max(5, Math.min(8.5, L / 4.2))); }
      });
      if (st.ref) {
        const fx = st.ref.x, fy = st.ref.y, o = { x: 0, y: 0 };
        if (r < T3) mv(o, 52.5, 68, 52.5, 42, T1, 6.2); else mv(o, 52.5, 42, fx, fy, T3, 5);
        st.ref.x = o.x; st.ref.y = o.y; st.ref.vx = Math.abs(o.vx) > 0.07 ? o.vx : o.sp > 0.4 ? 0.07 : 0;
        st.ref.walk = { vx: o.vx, vy: o.vy, moving: o.sp > 0.4 };   // 入場：進む向きに体を向ける（止まったら正面）
      }
      st.ball.z = 0;
    }
    celebInfo = null;
    for (const g of goals) if (g.t <= simT + 0.3) celebInfo = g;
    if (st.code === 2) cornerT = simT;
    if (cornerT > simT) cornerT = -99;
    let fx = st.ball.x, fy = st.ball.y;
    // ゴール直後は決めた選手を追う
    // ネットに突き刺さって揺れ、ボールが地面に落ちるまではゴールを映す。そのあと決めた選手を追う
    const netHold = st.code === 6 && celebInfo && celebInfo.net && simT < (celebInfo.netEnd || 0) && !(show && show.phase === 'gkSad' && simT > celebInfo.t + 0.9);
    const celeb = !netHold && !(show && show.phase === 'gkSad') && st.code === 6 && celebInfo && celebInfo.idx >= 0 && simT - celebInfo.t < 4.8 + (show && show.sadDelay ? show.sadDelay : 0);
    if (netHold) { const gx = celebInfo.net.gx; fx = gx + (gx ? -4 : 4); fy = st.ball.y * 0.6 + 34 * 0.4; }
    // GKが悔しがっている間は、GKとゴールを映す
    const sadCam = show && show.phase === 'gkSad' && celebInfo;
    if (sadCam) { const gk = st.players[celebInfo.team === 0 ? 11 : 0], gx = gk.x < 52.5 ? 0 : 105; fx = gk.x * 0.7 + (gx ? gx - 3 : 3) * 0.3; fy = gk.y * 0.75 + 34 * 0.25; }
    if (celeb) { const sc = st.players[celebInfo.idx]; fx = sc.x; fy = sc.y; }
    if (show && show.phase === 'champ') { fx = 52.5; fy = 34; }
    const koShow = show && (show.phase === 'kickoff' || show.phase === 'preVs');
    const cornerMode = simT >= cornerT && simT - cornerT < 3.5;
    if (cornerMode) {
      const gx = st.ball.x > 52.5 ? 105 : 0;
      const gp = { x: gx + (gx ? -9 : 9), y: 34 };
      const w = st.code === 2 ? 0.62 : 0.8;
      fx = st.ball.x + (gp.x - st.ball.x) * w; fy = st.ball.y + (gp.y - st.ball.y) * w;
    }
    // カードを出す主審・旗を上げた副審のほうへカメラを寄せて、判定の場面を見せる
    camMaxY += (62 - camMaxY) * 0.03;
    const cardCam = st.ref && st.refCard && !show;
    if (st.ref && st.refCard) { fx += (st.ref.x - fx) * (cardCam ? 1 : 0.6); fy += (st.ref.y - 0.8 - fy) * (cardCam ? 1 : 0.6); }
    else if (st.code === 8 && simT - st.codeT < 2.8 && st.ar) {
      const k = arSide(st);
      fx += (st.ar[k] - fx) * 0.55; fy += ((k ? 74 : -2.2) - fy) * 0.6;
      if (k) camMaxY = 75;
    }
    // 判定：オフサイドは旗を上げた副審、ファウルは笛を吹いた主審をアップで。リプレイは問題の場所を
    let judgeZ = cardCam ? 1.9 : 0;   // カードの場面は主審と選手をアップで
    if (show && show.phase === 'endOut' && st.ref) {
      // 試合終了の笛：両手を上げた主審をアップ → 少しして引きの画面へ
      fx = st.ref.x; fy = st.ref.y - 0.8; judgeZ = show.rt < END_T.close ? 2.3 : 1.0;
    } else if (show && show.phase === 'judge') {
      if (show.off && st.ar) { const k = st.code === 8 && st.rteam >= 0 ? arSide(st) : ((show.e && show.e.ox != null ? show.e.ox : show.cx) > 52.5 ? 0 : 1); fx = st.ar[k]; fy = k ? 70.2 : -2.2; camMaxY = 75; }
      else if (st.ref) { fx = st.ref.x; fy = st.ref.y; }
      judgeZ = 1.45;
    } else if (show && (show.phase === 'jreplay' || show.phase === 'jfade')) {
      if (show.off) { fx = show.cx; fy = 34; judgeZ = 0.95; }
      else { fx = show.cx; fy = show.cy; judgeZ = 1.35; }
    }
    // 高く上がったボールは少し引いて映す（ふわっとした弾道が画面に収まるように）
    const hz = Math.max(0, Math.min(0.3, (st.ball.z - 2.5) * 0.035));
    // セットプレーの最初はキッカーの寄り（コーナー・PK）、そのあとゴール前の引き
    const pkCam = st.code === 7 && simT - st.codeT > 1.2 && !(show && show.phase === 'replay');
    const closeUp = pkCam || (st.code === 2 && simT - st.codeT > 0.8 && simT - st.codeT < 3.0 && !(show && show.phase === 'replay'));
    if (closeUp) { fx = st.ball.x; fy = st.ball.y; }
    if (pkCam) { const gx = st.ball.x > 52.5 ? 105 : 0; fx = st.ball.x + (gx - st.ball.x) * 0.45; fy = 34; }
    let duelZ = 1;
    // 技が出たら、カルチョビットAのようにカメラがぐっと寄る（ドリブル技は選手に、シュート技は飛んでいくボールに）
    // 見える幅を約16mまで寄せ、技が終わってから少しして、ゆっくり引きの画面へ戻る
    {
      const sc = null;   // 技の時のアップはやめた（エフェクトで見せる）。skillCam() で元に戻せる
      if (sc && !judgeZ && !koShow && !celeb) {
        if (sc.shot) { fx = st.ball.x; fy = st.ball.y; duelZ = Math.max(1.2, VIEW_W / 22); }
        else if (st.owner === sc.i || simT - sc.t < sc.d) { const o = st.players[sc.i]; fx = o.x * 0.7 + st.ball.x * 0.3; fy = o.y * 0.7 + st.ball.y * 0.3; duelZ = Math.max(1.3, VIEW_W / 16); }
        // 技のあとにパス・シュートでボールが離れたら、寄りをやめてボールを追う
      }
    }
    const zT = judgeZ ? judgeZ : sadCam ? 1.7 : netHold ? 1.55 : pkCam ? 1.4 : closeUp ? 1.65 : duelZ > 1 ? duelZ : cornerMode ? 0.8 : show && (show.phase === 'replay' || show.phase === 'digest') ? 1.2 : 1;
    zoom += ((hz > 0 ? Math.min(zT, 1 - hz) : zT) - zoom) * (closeUp || cardCam ? 0.09 : duelZ > 1 ? 0.08 : zoom > 1.02 ? 0.03 : 0.06);
    if (koShow) {
      // キックオフ前：引きの絵からセンターサークルへぐっと寄る
      const u = show.phase === 'preVs' ? 0 : Math.max(0, Math.min(1, show.rt / (show.walk ? 7.5 : 2.6))), e = u * u * (3 - 2 * u);
      zoom = 0.5 + 0.78 * e; fx = 52.5; fy = 34;
    }
    FOCAL = baseFocal * zoom;
    // 目標の位置からでもボールが見えるように、目標そのものをボール側へ寄せておく（カメラの揺れ防止）
    if (!celeb && !koShow && !judgeZ) {
      const save = { x: cam.x, y: cam.y, yaw: cam.yaw };
      const k = Math.max(-1, Math.min(1, (fx - 52.5) / 38));
      cam.x = fx; cam.y = Math.max(6, Math.min(camMaxY, fy)); cam.yaw = Math.sign(k) * Math.pow(Math.abs(k), 1.4) * 0.46; camBasis();
      for (let it = 0; it < 10; it++) {
        const p = P3(st.ball.x, st.ball.y, Math.min(st.ball.z, 2.5));
        if (p.f > 4 && p.x > CW * 0.2 && p.x < CW * 0.8 && p.y > CH * 0.26 && p.y < CH * 0.8) break;
        fx += (st.ball.x - fx) * 0.3; fy += (st.ball.y - fy) * 0.3;
        cam.x = fx; cam.y = Math.max(6, Math.min(camMaxY, fy)); camBasis();
      }
      Object.assign(cam, save); camBasis();
    }
    // リプレイ：低い角度から、ゴールの方を斜めに見る（カルチョビットAのリプレイの画角）
    const rg = show && show.goal;
    const isReplay = show && (show.phase === 'replay' || show.phase === 'fade') && rg;   // ダイジェストは試合と同じカメラ
    const gxR = isReplay ? (stateAt(rg.t).ball.x > 52.5 ? 105 : 0) : 0;
    const jr = show && (show.phase === 'jreplay' || show.phase === 'jfade');
    replayYaw = isReplay ? (gxR ? 0.85 : -0.85) : jr && !show.off ? (show.cx > 52.5 ? 0.5 : -0.5) : null;
    const pT = isReplay ? 0.3 : jr ? (show.off ? 0.36 : 0.3) : VIEWS[viewMode].pitch;
    camPitch = !cam.init ? pT : camPitch + (pT - camPitch) * 0.08;
    updateCamera(fx, fy, Math.abs(simT - lastDrawT) > 2 || !cam.init);
    if (koShow) { cam.x = fx; cam.y = fy; cam.yaw = 0; camBasis(); }
    if (!celeb && !koShow && st.code !== 6 && !judgeZ) keepBallInView(st.ball);
    lastDrawT = simT;
    pitch();
    // 追跡中の軌跡
    if (selected >= 0) {
      const p = st.players[selected];
      if (!trail.length || Math.hypot(trail[trail.length - 1].x - p.x, trail[trail.length - 1].y - p.y) > 0.4) trail.push({ x: p.x, y: p.y });
      if (trail.length > 200) trail.shift();
      ctx.strokeStyle = 'rgba(255,240,60,0.9)'; ctx.lineWidth = 4;
      ctx.beginPath(); trail.forEach((q, i) => { const r = proj(q.x, q.y); i ? ctx.lineTo(r.x, r.y) : ctx.moveTo(r.x, r.y); }); ctx.stroke();
    }
    // 奥から順に：選手・ボール・ゴールの柱
    // 選手とゴール：ゴールの中の選手は「奥のネットより手前・柱と手前のネットより奥」、ゴールの横の外にいる選手は、奥側ならネットの奥・手前側ならネットの手前に描く
    const items = st.players.map((p, i) => {
      let f = proj(p.x, p.y).f;
      const gxN = p.x < 52.5 ? 0 : 105, behind = (p.x - gxN) * (gxN ? 1 : -1);
      if (behind > 0 && behind < GOAL_DEP + 2) {
        const gF = proj(gxN, 34).f, GP = D.CONST.POST;
        if (Math.abs(p.y - 34) < GP && behind < GOAL_DEP) f = Math.max(gF - 0.03, Math.min(gF + 1.45, f));
        else if (Math.abs(p.y - 34) < GP + 2) f = f > gF ? Math.max(f, gF + 1.6) : Math.min(f, gF - 0.1);
      }
      return { f, i };
    });
    { // ゴールのそばのボール：視線をさえぎる面（柱・バー・ネット）だけをボールの手前に描き、それ以外はボールの奥に描く
      goalDefer = goalOcclusion(st.ball.x, st.ball.y, st.ball.z);
      if (window.__gdbgOn) window.__gdbg = { b: [st.ball.x, st.ball.y, st.ball.z], gd: goalDefer && { before: goalDefer.before, after: goalDefer.after }, cam: [B.cx, B.cy, B.cz] };
      const gF = goalDefer ? proj(goalDefer.gx, 34).f : 0;
      const bf0 = proj(st.ball.x, st.ball.y).f - 0.05;
      items.push({ f: goalDefer ? Math.max(gF - 0.04, Math.min(gF + 1.45, bf0)) : bf0, ball: true }); }   // ゴールの奥の網と手前の柱の間に置き、前後は視線で決めた面ごとに描く
    for (const g of goalParts()) items.push({ f: g.f, goal: g.draw });
    for (const g of cornerFlags()) items.push({ f: g.f, goal: g.draw });
    if (st.ref) {
      const rvx = st.ref.vx;
      const ballSide = proj(st.ball.x, st.ball.y).x;
      const sig = officialSignals(st);
      if (show && show.phase === 'endOut' && show.rt > END_T.arms) sig.ref = { mode: 'both', tx: st.ref.x, ty: st.ref.y };
      items.push({ f: proj(st.ref.x, st.ref.y).f, goal: () => {
        const q = proj(st.ref.x, st.ref.y);
        const fc = Math.abs(rvx) > 0.05 ? Math.sign(proj(st.ref.x + rvx, st.ref.y).x - q.x) || 1 : (ballSide > q.x ? 1 : -1);
        if (st.ref.walk) {
          // 入場中の主審：歩く向き（奥へ・斜め）に体を向け、止まったらカメラの方を向く
          const w = st.ref.walk, q2 = proj(st.ref.x + w.vx, st.ref.y + w.vy);
          dmFacing = w.moving ? Math.atan2((q2.y - q.y) / 0.45, q2.x - q.x) : Math.PI / 2;
          sprite(q.x, q.y, q.s, REF_INFO, 0, 1, 0, w.moving, false, false);
          dmFacing = null;
        } else if (st.refCard) {
          // カード：反則した選手と向き合い（カメラには背中）、右手でカードを高く掲げる
          // 下ろしている右腕（後ろ向きの絵の17列目より右・11〜19段目）は描かずに、上げた腕に描きかえる（手が3本にならないように）
          const d = Math.max(1.4, 2.6 * q.s) * 24 / 27;
          const colX = (c) => Math.round(q.x + (c - 11.5) * d), rowY = (r) => Math.round(q.y + (r - 28) * d);
          const box = (c0, r0, c1, r1, col) => { ctx.fillStyle = col; ctx.fillRect(colX(c0), rowY(r0), colX(c1) - colX(c0), rowY(r1) - rowY(r0)); };
          ctx.save(); ctx.beginPath(); ctx.rect(-10, -10, CW + 20, CH + 20); ctx.rect(colX(17), rowY(11), colX(23) - colX(17), rowY(20) - rowY(11)); ctx.clip('evenodd');
          dmFacing = -Math.PI / 2;
          sprite(q.x, q.y, q.s, REF_INFO, 0, 1, 0, false, false, false);
          dmFacing = null; ctx.restore();
          box(17, 11, 18, 20, '#000');                                   // 切った胴の横に縁取り
          // 腕は肩から頭のてっぺんの少し上まで（長すぎると棒に見える）
          box(16, 0, 20, 13, '#000');                                    // 上げた腕（縁）
          box(17, 0, 19, 12, REF_COL.W); box(18, 1, 19, 12, REF_COL.L);    // 袖・腕
          box(16, -3, 20, 1, '#000'); box(17, -2, 19, 0, SKIN[REF_INFO.skin]);       // 手
          const cardCol = st.refCard === 2 ? '#e8241c' : '#ffd400';
          box(15, -10, 21, -2, '#000'); box(16, -9, 20, -3, cardCol);                // カード
        } else drawOfficial(st.ref.x, st.ref.y, REF_INFO, fc, Math.abs(rvx) > 0.06, st.refCard, sig.ref, false);
      } });
      [[st.ar[0], -2.2], [st.ar[1], 70.2]].forEach(([x, y], k) => {
        items.push({ f: proj(x, y).f, goal: () => {
          const q = proj(x, y);
          drawOfficial(x, y, AR_INFO[k], ballSide > q.x ? 1 : -1, false, 0, sig.ar[k], true);
        } });
      });
    }
    items.sort((a, b) => b.f - a.f);
    const frameAnim = Math.floor(simT * 7) % 2;
    // 名前を出す選手：ボール保持者と、その一番近い相手
    const tagged = new Set();
    if (st.owner >= 0) tagged.add(st.owner);
    // パスが出ている間は、受け手の名前を出して足元に印（誰へのパスか分かるように）
    if (st.passTo >= 0 && st.passTo < 22) { tagged.add(st.passTo); passMark = st.passTo; } else passMark = -1;
    // シュートを打った選手は少しの間、名前を出しておく（誰のシュートか分かるように）
    for (let k = shotsList.length - 1; k >= 0; k--) { const sh = shotsList[k]; if (sh.t > simT) continue; if (simT - sh.t > 2.2) break; tagged.add(sh.i); }
    // 名前は「ボールを持つ人」と「寄せている相手1人」だけ（出しすぎるとごちゃごちゃするので）
    if (st.owner >= 0 && st.owner < 22) {
      const o = st.players[st.owner];
      const rival = st.players.map((p, i) => ({ i, d: Math.hypot(p.x - o.x, p.y - o.y) })).filter((x) => (x.i < 11) !== (st.owner < 11) && x.d < 3.5).sort((a, b) => a.d - b.d)[0];
      if (rival) tagged.add(rival.i);
    }
    let hiBall = null; let sjLine = null; const defFx = [], tactFx = [], tags = [], skillChips = [], flashes = [], chargeFx = [], dusts = [], speedFx = [], scisFx = [], dtFx = [], moonFx = [];
    for (const it of items) {
      if (it.ball) {
        let bb = st.ball;
        if (st.owner >= 0 && st.owner < 22) {
          const a = actionAt(st.owner);
          if (a && a.a === 'dmove' && a.fx != null) {
            const o = skillBallOffset(a);
            if (o && o.abs) { const pp = st.players[st.owner]; bb = { ...st.ball, x: pp.x + a.dx * o.abs[0] + a.fx * o.abs[1], y: pp.y + a.dy * o.abs[0] + a.fy * o.abs[1], z: o.abs[2] || 0 }; }
            else if (o) bb = { ...st.ball, x: st.ball.x + a.dx * o[0] + a.fx * o[1], y: st.ball.y + a.dy * o[0] + a.fy * o[1], z: (st.ball.z || 0) + (o[2] || 0) };
          }
        }
        if (!(goalDefer && (goalDefer.before.length || goalDefer.after.length)) && (bb.z || 0) > 1.6) { hiBall = [bb, st.spin, st.bs, st.owner >= 0]; continue; }   // 版670：高い浮き球（ヒールリフトなど）は、名前・スキルの吹き出しに隠れないよう、いちばん最後に描く
        if (goalDefer && goalDefer.before.length) goalDraw(goalDefer.gx, goalDefer.before);   // ボールの奥にある柱・手前のネット
        ballOwned = st.owner >= 0; ballDraw(bb, st.spin, st.bs);
        if (goalDefer && goalDefer.after.length) goalDraw(goalDefer.gx, goalDefer.after);   // ボールの手前にある奥のネット（ゴールの裏・天井の上など）
        continue;
      }
      if (it.goal) { it.goal(); continue; }
      const i = it.i, p = st.players[i];
      if (st.gone & (2 ** i)) continue; // 退場してピッチを出た選手
      const q = proj(p.x, p.y);
      if (q.f < 4 || q.x < -60 || q.x > CW + 60 || q.y < -40 || q.y > CH + 120) continue;
      const team = i < 11 ? 0 : 1;
      const info = rinfo(team, i % 11);
      const sx = proj(p.x + p.vx * 4, p.y).x - q.x;
      // 攻める向き：後半はコートが入れ替わる
      const attackX = (team === 0) === (st.side > 0) ? 105 : 0;
      let facing = Math.abs(sx) > 0.5 ? Math.sign(sx) : (proj(attackX, 34).x > q.x ? 1 : -1);
      // 体の向き：走っている向き（止まっていればボールの方）で、横・正面・背中を使い分ける
      let view = 'side';
      {
        let vx2 = 0, vy2 = 0;
        if (p.sp > 0.6) { const m = proj(p.x + p.vx, p.y + p.vy); vx2 = m.x - q.x; vy2 = m.y - q.y; }
        else { const m = proj(st.ball.x, st.ball.y); vx2 = m.x - q.x; vy2 = (m.y - q.y) * 0.8; }
        // 向きは少しずつ回す（なめらかに）＋8方向の境目で行ったり来たりしないように「遊び」を持たせる
        const h = (viewHold[i] ||= { sx: 0, sy: 0, k: -1, t: animT });
        const dts = animT - h.t; h.t = animT;
        const len = Math.hypot(vx2, vy2 * 1.6);
        if (len > 0.4) {
          const nx = vx2 / len, ny = (vy2 * 1.6) / len;
          if (h.k < 0 || dts < 0 || dts > 0.5) { h.sx = nx; h.sy = ny; }
          else { const kk = Math.min(1, dts / (p.sp > 2.5 ? 0.12 : 0.3)); h.sx += (nx - h.sx) * kk; h.sy += (ny - h.sy) * kk; }
        }
        if (Math.hypot(h.sx, h.sy) > 0.05) {
          const c = Math.atan2(h.sy, h.sx) / (Math.PI / 4);
          if (h.k < 0) h.k = ((Math.round(c) % 8) + 8) % 8;
          else { let diff = c - h.k; diff = ((diff % 8) + 12) % 8 - 4; if (Math.abs(diff) > 0.68) h.k = ((Math.round(c) % 8) + 8) % 8; }
          const dv = [['side', 1], ['f34', 1], ['front', 1], ['f34', -1], ['side', -1], ['b34', -1], ['back', 1], ['b34', 1]][h.k];
          view = dv[0]; facing = dv[1];
        }
      }
      const gkCode = i === 0 ? st.gk[0] : i === 11 ? st.gk[1] : 0;
      let kp = gkCode ? null : kickPose(i);
      // 走りながらのパス（パス確認画面と同じ）：体の向き（16方向で±1以内）へ走っている最中のパスは、止まらずにそのまま蹴る
      //   振りかぶりは短く（ボールを蹴り足へ0.07秒 → 軸足0.05秒 → 振りかぶり0.065秒 → 接触）、それまでは走りの絵のまま。蹴った後も0.25秒で走りへ戻る
      if (kp && !kp.shot && kp.ev) {
        const ev = kp.ev, hv = viewHold[i];
        if (ev.run === undefined) {
          const m = proj(p.x + kp.dx, p.y + kp.dy), ka = Math.atan2((m.y - q.y) / 0.45, m.x - q.x);
          const kd = ((Math.round(ka / (Math.PI / 8)) % 16) + 16) % 16, bd = hv && hv.d16 != null ? hv.d16 : null;
          const df = bd == null ? 99 : Math.min((kd - bd + 16) % 16, (bd - kd + 16) % 16);
          ev.run = p.sp > 3 && df <= 1;
          ev.bd = bd; ev.df = df > 8 ? 0 : df; ev.sg = bd != null && (kd - bd + 16) % 16 <= 8 ? 1 : -1;
        }
        if (ev.run) { if (kp.d < -0.185 || kp.d > 0.255) kp = null; else kp.run = true; }
        else if (ev.bd != null && ev.df > 1) {
          // それ以外の向きへのパス：体を16方向で1段ずつ（0.035秒ごと）蹴る方向へ回してから蹴る（パス確認画面と同じ）
          const steps = Math.floor((kp.d + 0.3) / 0.035);
          if (steps < ev.df) kp.turnD16 = ((ev.bd + ev.sg * steps) % 16 + 16) % 16;
        }
      }
      if (kp) { const tk = simT - kp.d; let f = null; for (const a of kfOf[i] || []) if (Math.abs(a.t - tk) < 0.2) { f = a.f; break; } kp.foot = f || (rinfo(i < 11 ? 0 : 1, i % 11) || {}).foot || 'R'; }   // 蹴った足（右足のフォームはそのまま。左足は手前・奥が反転、横・斜めは奥の脚で蹴る同じフォーム）
      kickNow = kp;
      // カルチョビットA風の絵：体の向きを16方向で（境目で行ったり来たりしないよう遊びを持たせる）。キック中は蹴る方向に固定
      {
        const h = viewHold[i];
        let ang = null;
        if (kp) { const m = proj(p.x + kp.dx, p.y + kp.dy); ang = Math.atan2((m.y - q.y) / 0.45, m.x - q.x); }
        else if (h && Math.hypot(h.sx, h.sy) > 0.05) ang = Math.atan2((h.sy / 1.6) / 0.45, h.sx);
        // GK：体勢を崩していない時は、いつもボールにおへそを向ける（横に動く時もボールを見たままサイドステップ）
        if (info.gk && !kp && p.sp < 5.2 && !(gkCode >= 1 && gkCode <= 4)) { const bq = proj(st.ball.x, st.ball.y); if (Math.hypot(bq.x - q.x, bq.y - q.y) > 2) ang = Math.atan2((bq.y - q.y) / 0.45, bq.x - q.x); }
        // 蒼の王座：縦パスを受けに落ちてくる・キープしている間は、おへそと体を自分のゴールの方へ向ける（相手ゴールに背を向けて受ける）
        { const LP = actsOf[i]; if (LP) for (let k = LP.length - 1; k >= 0; k--) { const a = LP[k]; if (a.t > simT) continue; if (simT - a.t > 5) break; if (a.a === 'aopostend') break; if (a.a === 'aopost') { if (simT - a.t < a.d && (st.owner === i || st.passTo === i)) { const oq = proj(105 - attackX, 34); ang = Math.atan2((oq.y - q.y) / 0.45, oq.x - q.x); } break; } } }
        if (ang == null) dmFacing = (h && h.d16 != null) ? h.d16 * Math.PI / 8 : Math.PI / 2;
        else {
          // 向きがコマごとにパタパタ変わらないように：小さなずれでは変えない／一度向いたら少しの間は保つ（大きく向きを変えたときだけすぐ変える）
          const c = ang / (Math.PI / 8);
          if (kp || !h || h.d16 == null) { if (h) { h.d16 = ((Math.round(c) % 16) + 16) % 16; h.dT = animT; } }
          else {
            let diff = c - h.d16; diff = ((diff % 16) + 24) % 16 - 8;
            const held = animT - (h.dT || 0);
            if (Math.abs(diff) > 2.2 || (Math.abs(diff) > 1.1 && held > 0.18) || (Math.abs(diff) > 0.75 && held > 0.45)) { h.d16 = ((Math.round(c) % 16) + 16) % 16; h.dT = animT; }
          }
          dmFacing = (h ? h.d16 : ((Math.round(c) % 16) + 16) % 16) * Math.PI / 8;
        }
        if (kp && kp.turnD16 != null) { dmFacing = kp.turnD16 * Math.PI / 8; if (h) h.d16 = kp.turnD16; }
        dmRunF = Math.floor(animT * Math.min(18, 8 + p.sp * 1.2) + i * 2.3) % 8;
        // 本家を写した走り：1周（2歩）の位置を、実際に進んだ速さで進める（1歩＝0.6＋0.14×速さ m。秒速6.5mで1秒に約4.3歩＝本家のテンポ）
        {
          const rp = (runPh[i] ||= { ph: i * 0.37, t: animT }), dtp = animT - rp.t; rp.t = animT;
          if (dtp > 0 && dtp < 0.5 && p.sp > 0.4) rp.ph += dtp * p.sp / (0.6 + 0.14 * Math.max(3, p.sp)) / 2;
          dmRunPh = rp.ph;
        }
      }
      if (kp) { const kx = proj(p.x + kp.dx, p.y + kp.dy).x - q.x; if (Math.abs(kx) > 0.5) facing = Math.sign(kx); }
      // ゴール後：決めた選手と駆け寄った味方は両手を上げて跳ねる
      let cheer = false, hop = 0;
      if (st.code === 6 && simT - st.codeT < 4.8 && celebInfo && !celebInfo.hurry) {   // 負けている側の得点は喜ばない
        const sc = celebInfo.idx >= 0 ? st.players[celebInfo.idx] : null;
        if (team === celebInfo.team && sc && Math.hypot(p.x - sc.x, p.y - sc.y) < 4.5 && !info.gk) {
          cheer = true; hop = Math.abs(Math.sin(simT * 9 + i)) * 5 * q.s;
        }
      }
      if (show && show.phase === 'champ' && show.stage === 1 && p.champ) { cheer = !p.moving; hop = cheer ? Math.abs(Math.sin(show.t * 7 + i * 1.7)) * 7 * q.s : 0; }   // 版580：優勝：センターサークルに集まって、両手を上げて跳ねる
      // 走りのコマ：速いほど足の回転が速い
      const cad = 1.6 + p.sp * 0.62;
      const f4 = Math.floor((animT * cad + i * 0.37) * 2) % 4;
      const ac0 = gkCode ? null : actionAt(i);
      // ドリブルのタッチは軽く足を出すだけ（体の向きはそのまま）
      const ac = ac0 && ac0.a === 'touch' ? null : ac0;
      const touchPose = ac0 && ac0.a === 'touch' && !kp && view === 'side' ? 'b' : null;
      let r;
      // 失点した側：悔しがる（GKは倒れ込んだまま、ほかは膝に手をついてうなだれる・背を向ける）
      let sad = 0;
      if (st.code === 6 && celebInfo && simT - celebInfo.t < 4.3 && team !== celebInfo.team && p.sp < 2.5) {
        const ownGoalX = (team === 0) === (st.side > 0) ? 0 : 105;
        sad = info.gk ? 0 : Math.abs(p.x - ownGoalX) < 30 ? 2 : 1;   // GKは下の「順に悔しがる」で描く（跳んで倒れている間はそのまま）
      }
      // 失点したGK：決められた瞬間はまだ見送り、間をおいて順に崩れていく（本家の動画）
      //  ボールを見送る → ゴールの方へ手を伸ばす → 膝が崩れる → 尻もち → 立ち上がってゴールを見つめる
      if (info.gk && celebInfo && team !== celebInfo.team && !(gkCode >= 1 && gkCode <= 4)) {
        const age = simT - celebInfo.t;
        if (age >= 0.2 && age < 6.6) {
          const dived = (stateAt(celebInfo.t).gk || [0, 0])[team] || 0, skip = dived >= 1 && dived <= 4;   // 跳んで倒れていたら、起き上がってすぐ尻もちから
          const stage = skip ? (age < 2.4 ? 'gkSit' : 'stand') : age < 0.3 ? 'watch' : age < 0.75 ? 'gkReach' : age < 0.95 ? 'gkCrouch' : age < 2.4 ? 'gkSit' : 'stand';
          const ownGoalX = celebInfo.net ? celebInfo.net.gx : (p.x < 52.5 ? 0 : 105), gq = proj(ownGoalX, 34);   // 決められたゴールの方
          dmFacing = Math.atan2(-Math.abs((gq.y - q.y) / 0.45) - 8, gq.x - q.x);   // ゴールの方を向く（カメラには背中を向けたまま。本家と同じ見え方）
          if (stage === 'watch' || stage === 'stand') r = sprite(q.x, q.y, q.s, info, team, facing, 0, false, false);
          else r = sprite(q.x, q.y, q.s, info, team, facing, 0, false, false, false, stage, 0, 'back');
          sad = -1;
        }
      }
      if (sad === -1) {}
      else if (sad === 3) {
        const px = Math.max(1.4, 2.5 * q.s), head = proj(p.x, p.y).x < proj(52.5, 34).x ? -1 : 1;
        // 失点したGK：大の字にあお向けになって、天を仰ぐ
        r = lieOnBack(q, info, team);
        gloom(q.x, r.top - 4 * px, px, i);   // 落ち込みの縦線（がっくり）
      } else if (sad) {
        const px = Math.max(1.4, 2.6 * q.s);
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(sad === 2 ? facing * 0.38 : 0);
        if (sad !== 2) dmFacing = null; r = sprite(0, sad === 2 ? 2 * px : 0, q.s, info, team, facing, 0, false, false, false, sad === 2 ? 'crouch' : null, 0, sad === 2 ? view : 'back');
        ctx.restore(); r = { top: q.y - 17 * px, px: r.px };
        gloom(q.x, r.top - 2 * px, px, i);
      }
      else if (info.gk && gkCode) r = drawKeeper(q, p, info, team, facing, f4, gkCode, team);
      else if (info.gk && !kp && p.sp < 2.6 && st.owner >= 0 && (st.owner < 11 ? 0 : 1) !== team && (() => { const o = st.players[st.owner], gx = team === 0 ? 0 : 105; return o && Math.hypot(o.x - gx, o.y - 34) < 32; })()) {
        // 版864：相手がシュートを打てる所でボールを持っている：腰を落とし、両手を広げて構える（棒立ちにしない）
        const bq = proj(st.ball.x, st.ball.y); dmFacing = Math.atan2(st.ball.y - p.y, st.ball.x - p.x);
        r = sprite(q.x, q.y, q.s, info, team, facing, 0, false, false, false, 'crouch', 0, 'side'); dmFacing = null; void bq;
      }
      else if (ac && ac.a === 'lose' && ac.u < 0.9) {
        // 球際で負けた・抜かれた：押された向きへよろける（手で描いた絵・8方向）。①体が流れて片足で踏ん張る → ②両腕を広げてバランスを取る
        const o = st.players[ac.o] || p; let ux = ac.dx, uy = ac.dy;
        if (ux == null) { ux = p.x - o.x; uy = p.y - o.y; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l; if (!(Math.hypot(ux, uy) > 0)) { ux = facing; uy = 0; } }
        const px = Math.max(1.4, 2.6 * q.s), k = Math.sin(Math.PI * Math.min(1, ac.u * 1.15)), m = proj(p.x + ux, p.y + uy), ml = Math.hypot(m.x - q.x, m.y - q.y) || 1;
        ctx.fillStyle = 'rgba(0,30,0,0.3)'; ctx.beginPath(); ctx.ellipse(q.x, q.y - px * 0.4, 6.4 * px, 2 * px, 0, 0, 7); ctx.fill();
        dmFacing = Math.atan2(uy, ux);
        const kb = ac.big ? 2.4 : 1; r = sprite(q.x + (m.x - q.x) / ml * k * 2.5 * px * kb, q.y + (m.y - q.y) / ml * k * 1.2 * px * kb, q.s, info, team, facing, 0, false, false, true, 'stumble' + (ac.u < 0.4 ? 0 : 1), 0, view);   // 祭り太鼓の壁で弾かれた時は、大きく流される
        dmFacing = null; r = { top: q.y - 18 * px, px: r.px };
      }
      else if (ac && (ac.a === 'divehead' || ac.a === 'bicycle')) {
        // ダイビングヘッド：低く構える → 頭から飛び込む（体が地面と平行）→ 腹ばいで着地
        // バイシクル：ゴールに背を向けて後ろへ倒れながら跳ぶ → 頭の上で蹴る → 背中から着地（手で描いた絵・8方向）
        const px = Math.max(1.4, 2.5 * q.s), u = ac.u, bi = ac.a === 'bicycle';
        const h = bi ? Math.sin(Math.PI * Math.min(1, u * 1.6)) * 0.55 : (u > 0.12 && u < 0.6 ? Math.sin(Math.PI * (u - 0.12) / 0.48) * 0.35 : 0);
        const g = P3(p.x, p.y, h);
        ctx.fillStyle = 'rgba(0,30,0,0.3)'; ctx.beginPath(); ctx.ellipse(q.x, q.y, 8 * px, 2.2 * px, 0, 0, 7); ctx.fill();
        if (bi) dmFacing = Math.atan2(p.y - 34, p.x - attackX);   // ゴールに背を向ける
        else dmFacing = ac.dx != null ? Math.atan2(ac.dy, ac.dx) : Math.atan2(34 - p.y, attackX - p.x);
        const fr = bi ? (u < 0.3 ? 0 : u < 0.6 ? 1 : 2) : (u < 0.12 ? 0 : u < 0.6 ? 1 : 2);
        sprite(g.x, g.y, q.s, info, team, facing, 0, false, false, true, (bi ? 'bicycle' : 'dhead') + fr, 0, view);
        dmFacing = null;
        if (!bi && u > 0.55 && u < 0.8) { ctx.fillStyle = 'rgba(210,235,170,0.7)'; for (let k = 0; k < 5; k++) ctx.fillRect(Math.round(q.x + (k - 2) * 3 * px), Math.round(q.y - (k % 2) * 2 * px - (u - 0.55) * 30 * px), px * 1.2, px * 1.2); }   // 着地で芝が舞う
        r = { top: g.y - 16 * px, px };
      }
      else if (ac && ac.a === 'slide' && ac.u < 0.82) {
        // スライディング（本家の動画を写した絵）：滑る向きへ脚を伸ばし、上体を後ろに倒して手を地面につく。滑り出しは芝が舞う
        const px = Math.max(1.4, 2.5 * q.s), kx = proj(p.x + ac.dx, p.y + ac.dy).x - q.x, dir = Math.abs(kx) > 0.3 ? Math.sign(kx) : facing;
        ctx.fillStyle = 'rgba(0,30,0,0.32)'; ctx.beginPath(); ctx.ellipse(q.x + dir * 4 * px, q.y - px * 0.4, 11 * px, 2.2 * px, 0, 0, 7); ctx.fill();
        if (ac.u < 0.45) {
          ctx.fillStyle = 'rgba(210,235,170,0.75)';
          for (let k = 0; k < 6; k++) { const ex = q.x + dir * (14 + k * 2.5) * px - dir * ac.u * 10 * px, ey = q.y - (k % 3) * px * 1.6 - ac.u * 8 * px; ctx.fillRect(Math.round(ex), Math.round(ey), Math.ceil(px * 1.2), Math.ceil(px * 1.2)); }
        }
        // 手前へ滑る時は正面、奥へ滑る時は背中の絵（横向きは左右の向きで）
        const ky = (proj(p.x + ac.dx, p.y + ac.dy).y - q.y) / 0.45, fb = Math.abs(ky) > Math.abs(kx) * 1.7 ? (ky > 0 ? 'slideF' : 'slideB') : null;
        dmFacing = fb === 'slideF' ? Math.PI / 2 : fb === 'slideB' ? -Math.PI / 2 : dir > 0 ? 0 : Math.PI;
        sprite(q.x, q.y, q.s, info, team, dir, 0, false, false, true, fb || 'slide', 0, 'side');
        dmFacing = null;
        r = { top: q.y - 15 * px, px };
      }
      else if (ac && ac.a === 'fall') {
        // 倒される（手で描いた絵・8方向）：押された向きへ ①バランスを崩す → ②倒れ込む → ③うつ伏せ → 起き上がる（①手で押して上体を起こす → ②片ひざを立てる）
        const px = Math.max(1.4, 2.5 * q.s), u = ac.u;
        let ux = ac.dx, uy = ac.dy; if (ux == null) { ux = facing; uy = 0; }
        const fr = u < 0.1 ? ['fall', 0] : u < 0.2 ? ['fall', 1] : u < 0.66 ? ['fall', 2] : u < 0.82 ? ['getup', 0] : ['getup', 1];
        const lying = fr[0] === 'fall' && fr[1] === 2;
        ctx.fillStyle = 'rgba(0,30,0,0.32)'; ctx.beginPath(); ctx.ellipse(q.x, q.y - px * 0.2, (lying ? 9 : 6.5) * px, 2 * px, 0, 0, 7); ctx.fill();
        if (u < 0.2 && u > 0.12) { ctx.fillStyle = 'rgba(210,235,170,0.7)'; const m = proj(p.x + ux * 1.2, p.y + uy * 1.2); for (let k = 0; k < 5; k++) ctx.fillRect(Math.round(m.x + (k - 2) * 2.5 * px), Math.round(m.y - (k % 2) * 2 * px - (u - 0.12) * 40 * px), px * 1.3, px * 1.3); }   // 倒れた所で芝が舞う
        dmFacing = Math.atan2(uy, ux);
        sprite(q.x, q.y, q.s, info, team, facing, 0, false, false, true, fr[0] + fr[1], 0, view);
        dmFacing = null;
        r = { top: q.y - (lying ? 8 : 14) * px, px };
      } else {
        let lift = 0, tilt = 0, dxs = 0, arms = st.held === i || cheer;
        let jumpPose = false;
        if (ac && (ac.a === 'head' || ac.a === 'jump')) { lift = Math.sin(Math.PI * Math.min(1, ac.u * (ac.a === 'head' ? 1 : 1.1))) * (ac.a === 'head' ? 0.75 : 0.55); jumpPose = true; }
        let headPose = null;
        if (ac && ac.a === 'head') {   // 版456：ヘディング（手で描いた絵・8方向）。いつもボールの方を向く（来るボールに向かって跳び、当てたら飛んでいく方を向いたまま）
          const bq = proj(st.ball.x, st.ball.y), bd = Math.hypot(st.ball.x - p.x, st.ball.y - p.y), h = viewHold[i];
          if (bd > 0.6) { const c = Math.atan2((bq.y - q.y) / 0.45, bq.x - q.x) / (Math.PI / 8); const d16 = ((Math.round(c) % 16) + 16) % 16; if (h) { h.d16 = d16; h.dT = animT; } dmFacing = d16 * Math.PI / 8; }
          const hu = ac.hitU ?? 0.35; headPose = 'headS' + (ac.u >= hu - 0.06 && ac.u < hu + 0.3 ? 1 : 0); }
        if (ac && ac.a === 'duel' && ac.o != null) {
          // 体をぶつけ合う：相手の方へ傾く
          const o = st.players[ac.o]; const ox = proj(o.x, o.y).x - q.x;
          tilt = Math.sign(ox || 1) * 0.16 * Math.sin(Math.PI * ac.u); dxs = Math.sign(ox || 1) * Math.sin(ac.u * 30) * 1.2 * q.s;
        }
        let pokePose = null;
        if (ac && ac.a === 'poke' && ac.trap && ac.dx != null && !kp) {
          // トラップ（手で描いた絵・8方向）：ボールの方を向き、①受ける足を前へ出して足の内側で触れる → ②足を引いて勢いを吸収。4回に1回くらいは足裏で止める
          dmFacing = Math.atan2(ac.dy, ac.dx);
          const tf = (rinfo(i < 11 ? 0 : 1, i % 11) || {}).foot === 'L' ? 'L' : 'R', soleT = Math.floor((ac.dx + 1) * 53 + (ac.dy + 1) * 31) % 4 === 0;
          pokePose = soleT ? (ac.u < 0.75 ? 'sole' : null) : ac.u < 0.85 ? 'trapI' + (ac.u < 0.4 ? 0 : 1) + tf : null;
        }
        if (ac && ac.a === 'chest') pokePose = ac.u < 0.9 ? 'trapC' + (ac.u < 0.5 ? 0 : 1) : null;   // 胸トラップ：①胸を張って両腕を広げる → ②胸を引いてひざを曲げ、足元へ落とす
        if (ac && (ac.a === 'poke' || ac.a === 'fouler') && ac.dx != null && !kp && !ac.trap) {
          // 足を出した：ボール（反則なら相手）の方へ横向きで足を伸ばす
          const kx = proj(p.x + ac.dx, p.y + ac.dy).x - q.x;
          if (Math.abs(kx) > 0.15) facing = Math.sign(kx);
          view = 'side'; pokePose = ac.u < 0.7 ? 'kick' : null;
          if (ac.a === 'fouler') { tilt = facing * 0.22 * Math.sin(Math.PI * Math.min(1, ac.u * 1.6)); dxs = facing * Math.sin(Math.PI * Math.min(1, ac.u * 1.6)) * 5 * q.s; }
        }
        // 溜めシュート：大きく振りかぶったまま、体の周りにオーラが集まる
        if (ac && ac.a === 'charge' && !kp) {
          const gx = proj(attackX, 34).x - q.x; facing = Math.sign(gx) || facing; view = 'side';
          dmFacing = Math.atan2(34 - p.y, attackX - p.x); pokePose = 'shotA1';   // 大きく振りかぶったまま力をためる（シュートと同じ絵） tilt = -facing * 0.16 * Math.min(1, ac.u * 3); dxs = Math.sin(simT * 60) * 0.8 * q.s * ac.u;
          chargeFx.push([q.x, q.y, 2.6 * q.s, ac.u]);
        }
        // ヒールパス：前を向いたまま、かかとで後ろへ
        if (ac && ac.a === 'heel') { const fw = (Math.sign(proj(p.x + ac.dx, p.y + ac.dy).x - q.x) || facing); facing = fw; view = 'side'; pokePose = ac.u < 0.6 ? 'bigWindup' : null; kp = null; }
        // ノールックパス：顔（体）は別の方向を向いたまま、足だけでパスを出す
        if (ac && ac.a === 'nolook') { const fk = Math.sign(proj(p.x + ac.lx, p.y + ac.ly).x - q.x) || -facing; facing = fk; view = 'side'; pokePose = ac.u < 0.5 ? 'sole' : null; kp = null; }
        if (ac && ac.a === 'volleyK') { view = 'side'; pokePose = ac.u < 0.7 ? 'kick' : null; lift = 0.12; }
        if (ac && ac.a === 'feint') { dxs = Math.sin(Math.PI * ac.u) * ac.side * 9 * q.s; tilt = -ac.side * 0.2 * Math.sin(Math.PI * ac.u); }
        // ドリブル技の動き（技ごとに違う体の使い方）
        let dust = false, ghost = null; const r0px = 0;   // ghost＝残像を置く向き（画面の上の単位ベクトル。動いてきた側へずらして描く）
        if (false && kp && kp.shot && kp.dsh && kp.d < 0.1) { const m2 = proj(p.x + kp.dx, p.y + kp.dy), ml = Math.hypot(m2.x - q.x, m2.y - q.y) || 1; ghost = [(m2.x - q.x) / ml, (m2.y - q.y) / ml]; speedFx.push([q.x, q.y, 2.6 * q.s, ghost[0], ghost[1]]); }   // ドリブルシュート：走りの勢いのまま（風の線と残像）
        if (ac && ac.a === 'dmove' && !kp) {
          const u = ac.u, sx = Math.sign(proj(p.x + ac.dx, p.y + ac.dy).x - q.x) || facing;
          const sw = (a) => Math.sin(Math.PI * Math.min(1, a));
          const ffw = ac.fx != null ? (Math.sign(proj(p.x + ac.fx, p.y + ac.fy).x - q.x) || facing) : facing;
          const seg = (a0, a1) => Math.max(0, Math.min(1, (u - a0) / (a1 - a0)));
          const W = 3.2 * q.s;   // 横ずれの単位（画面px）
          view = 'side';
          switch (ac.k) {
            case 'doubleTouch': { // 実写を写す：前を向いたまま腰を落とし、インで逆足へ・逆足でさらに横へ（体ごと横へずれる）→ 斜め前へ加速
              const fA = Math.atan2(ac.fy, ac.fx);
              if (u < 0.6) dtFx.push([p.x, p.y, ac.dx, ac.dy, ac.fx, ac.fy, u, q.s]);   // 横へずれるボールの残像
              if (u > 0.12 && u < 0.75) { const md = u < 0.45 ? [ac.dx, ac.dy] : [ac.fx * 0.75 + ac.dx * 0.5, ac.fy * 0.75 + ac.dy * 0.5], m2 = proj(p.x + md[0], p.y + md[1]), ml = Math.hypot(m2.x - q.x, m2.y - q.y) || 1; ghost = [(m2.x - q.x) / ml, (m2.y - q.y) / ml]; speedFx.push([q.x, q.y, 2.6 * q.s, ghost[0], ghost[1]]); }   // 体ごと横へずれる：高速ドリブルと同じ風の線と、体の残像
              if (u < 0.12) { dmFacing = fA; pokePose = 'crouch'; }
              else if (u < 0.28) { dmFacing = fA; pokePose = 'sole'; tilt = sx * 0.12; }
              else if (u < 0.45) { dmFacing = fA; pokePose = 'crouch'; tilt = sx * 0.2; dust = true; }
              else { dmFacing = Math.atan2(ac.fy * 0.75 + ac.dy * 0.5, ac.fx * 0.75 + ac.dx * 0.5); pokePose = u < 0.7 ? 'lunge' : null; tilt = sx * 0.14 * (1 - seg(0.45, 1)); dust = u < 0.6; }
              break;
            }
            case 'elastico':      // アウトで外へ押し出す → 一瞬で内へ引き戻して抜ける
              if (u < 0.3) { facing = -sx; pokePose = 'sole'; dxs = -sx * seg(0, 0.3) * 2.5 * W; tilt = -sx * 0.22; }
              else if (u < 0.55) { facing = sx; pokePose = 'lunge'; dxs = sx * (-2.5 + seg(0.3, 0.55) * 7) * W; tilt = sx * 0.25; dust = true; }
              else { facing = sx; pokePose = u < 0.75 ? 'lunge' : null; dxs = sx * 4.5 * (1 - seg(0.55, 1)) * W; tilt = sx * 0.1; }
              break;
            case 'scissors':      // 見せる側へ体を流しながら、見せる側の足でボールの外側をぐるっとまたぐ → 反対の足で転がし、反発でグン！と逆へ
            case 'bodyFeint': {   // 見せる側へ足を真横へ踏み出して（スタンプ）体重を乗せる → 反対の足のアウトでボールを逆へ運び、踏み出した足の反発でグン！と逆へ
              let bfFoot = 'R';
              const sc = ac.k === 'scissors', t1 = sc ? (ac.dbl ? 0.593 : 0.42) : 0.33, t2 = sc ? (ac.dbl ? 0.667 : 0.5) : 0.45;   // ダブルシザース（1.35秒）：0.4秒ずつ2回またぐ → 0.9秒まで転がす → グン！
              const fk = ac.ax != null ? Math.sign(proj(p.x + ac.ax, p.y + ac.ay).x - q.x) || -sx : -sx;   // 見せる側（画面の左右）
              if (u < t1) {
                if (sc) { dmFacing = Math.atan2(ac.fy ?? ac.ay, ac.fx ?? ac.ax); const el = ac.dbl ? u * 1.35 : u * 0.95, st = ac.dbl && el >= 0.4 ? 1 : 0, e = (el - st * 0.4) / 0.4, f1 = ((ac.ax ?? 0) * -(ac.fy ?? 0) + (ac.ay ?? 0) * (ac.fx ?? 1)) > 0 ? 'R' : 'L', sfo = st ? (f1 === 'R' ? 'L' : 'R') : f1; pokePose = 'scis' + (e < 0.24 ? 0 : e < 0.64 ? 1 : 2) + sfo; tilt = 0; if (e >= 0.14 && e < 0.8) { const sn = Math.sin(dmFacing), lr = sn > 0.92 ? (sfo === 'R' ? -1 : 1) : sn < -0.92 ? (sfo === 'R' ? 1 : -1) : (Math.cos(dmFacing) >= 0 ? 1 : -1), fw = Math.abs(ac.fy || 0) > 0.92 ? 0.35 : Math.abs(ac.fy || 0) > 0.38 ? 0.5 : 0.6, bp = proj(p.x + (ac.fx ?? 0) * fw, p.y + (ac.fy ?? 0) * fw); scisFx.push([bp.x, bp.y, q.s, lr, Math.min(1, (e - 0.14) / 0.57)]); } }   // 手で描いた「またぐ」絵。見せる側の足でまたぐ（右へ抜くなら左足）、ダブルの2回目は反対の足：膝を上げる→ボールの真上を足が通る→外へ着地（足の通り道を白い弧で）
                else {   // ボディフェイント：前を向いたまま、見せる側の足を真横へ大きく踏み出し（スタンプ）、腰を落として体をそちらへ傾ける（ボールには触らない）
                  dmFacing = Math.atan2(ac.fy ?? 0, ac.fx ?? 1); bfFoot = ((ac.ax ?? 0) * -(ac.fy ?? 0) + (ac.ay ?? 0) * (ac.fx ?? 1)) > 0 ? 'R' : 'L';
                  const m3 = proj(p.x - (ac.dx ?? 0), p.y - (ac.dy ?? 0)), ml3 = Math.hypot(m3.x - q.x, (m3.y - q.y) / 0.55) || 1;
                  pokePose = 'bfStep0' + bfFoot; tilt = 0.26 * (m3.x - q.x) / ml3 * Math.min(1, u / (t1 * 0.5)); dust = u > t1 * 0.4 && u < t1 * 0.8; }
              } else if (u < t2) {
                if (sc) { pokePose = 'sole'; tilt = -fk * 0.12; dust = true; }
                else {   // 踏み出した足で地面を蹴り返し、反対の足のアウトでボールを逆へ運ぶ（体も逆へ傾く）
                  dmFacing = Math.atan2(ac.fy ?? 0, ac.fx ?? 1); bfFoot = ((ac.ax ?? 0) * -(ac.fy ?? 0) + (ac.ay ?? 0) * (ac.fx ?? 1)) > 0 ? 'R' : 'L';
                  const m3 = proj(p.x + (ac.dx ?? 0), p.y + (ac.dy ?? 0)), ml3 = Math.hypot(m3.x - q.x, (m3.y - q.y) / 0.55) || 1;
                  pokePose = 'bfPush0' + bfFoot; tilt = 0.2 * (m3.x - q.x) / ml3; dust = true; }
              }
              else { if (ac.bx != null) dmFacing = Math.atan2(ac.by, ac.bx); pokePose = null; tilt = -fk * (ac.dbl ? 0.12 : 0.3) * (1 - seg(t2, 1) * 0.75); dust = u < t2 + 0.2; const m2 = proj(p.x + (ac.bx ?? ac.dx), p.y + (ac.by ?? ac.dy)), ml = Math.hypot(m2.x - q.x, m2.y - q.y) || 1; if (u < t2 + 0.3) speedFx.push([q.x, q.y, 2.6 * q.s, (m2.x - q.x) / ml, (m2.y - q.y) / ml]); }
              break;
            }
            case 'roulette': {    // 足裏でボールを引きながら、背中を相手に向けてくるっと一回転（本家と実写の動画を写す：前→よける側と逆→背中→よける側→前）
              const ra = rouletteAng(ac, u);
              if (ra != null) { dmFacing = ra; pokePose = null; }
              else { dmFacing = Math.atan2(ac.fy + ac.dy * 0.3, ac.fx + ac.dx * 0.3); pokePose = u < 0.9 ? 'lunge' : null; tilt = (Math.cos(dmFacing) >= 0 ? 1 : -1) * 0.15; dust = u < 0.85; }
              break;
            }
            case 'cutIn': {       // 縦へ行くと見せて一歩外へ → 外足で踏ん張って、斜め内へ切れ込む
              // ①縦へ運ぶ（外へ見せる）→ ②外の足で踏ん張り、体を内へ倒す → ③インで持ち出し、前傾してグン！と斜め内へ
              const inS = Math.sign(proj(p.x + ac.dx, p.y + ac.dy).x - q.x) || -ffw;
              // 緩（ゆっくり外へ運んで誘う・上体は起こしたまま）→ 止（外の足で踏ん張る）→ 急（ぐっと前傾してグン！）
              if (u < 0.3) { if (ac.ox != null) dmFacing = Math.atan2(ac.oy, ac.ox); pokePose = null; tilt = 0; }
              else if (u < 0.42) { if (ac.ox != null) dmFacing = Math.atan2(ac.oy, ac.ox); pokePose = 'crouch'; tilt = inS * 0.16; dust = true; }
              else { dmFacing = Math.atan2(ac.dy, ac.dx); pokePose = null; tilt = inS * 0.34 * (u < 0.5 ? seg(0.42, 0.5) : 1 - seg(0.5, 1) * 0.7); dust = u < 0.7; const m2 = proj(p.x + ac.dx, p.y + ac.dy), ml = Math.hypot(m2.x - q.x, m2.y - q.y) || 1; speedFx.push([q.x, q.y, 2.6 * q.s, (m2.x - q.x) / ml, (m2.y - q.y) / ml]); }   // グン！の瞬間も風の線
              break;
            }
            case 'kickFeint':     // シュートを打つと見せて思いきり振りかぶる → 打たずに、インでボールを横へずらす → 空いたコースへ構え直す
              dmFacing = Math.atan2(ac.fy, ac.fx);
              if (u < 0.36) { pokePose = (u < 0.12 ? 'shotA0' : 'shotA1') + (ac.ff || ''); tilt = 0; }   // 振りかぶって見せるのは、ずらす側と反対の足   // 本物のシュートと同じフォーム（踏み込み→大きく振りかぶる）
              else if (u < 0.56) { pokePose = 'bfPush0' + (ac.ff || 'L'); tilt = 0; dust = u < 0.45; }   // 振りかぶった足を外へ踏み下ろし、反対の足（打つ足）のアウトでボールを横へ運ぶ（脚を交差させない）
              else { pokePose = u < 0.8 ? 'crouch' : null; tilt = sx * 0.06; }
              break;
            case 'nutmeg': {      // 腰を落として、相手の股へ足先で通す → 脇をすり抜ける
              // 相手に向かって腰を落とし → つま先でちょんと股の間へ → 相手の脇を回り込んで裏へ（体の移動はゲーム側で本当に動かす）
              const tA = Math.atan2(ac.dy, ac.dx), mf = Math.sign(proj(p.x + p.vx, p.y + p.vy).x - q.x) || facing;
              if (u < 0.15) { dmFacing = tA; pokePose = 'crouch'; }
              else if (u < 0.3) { dmFacing = tA; pokePose = 'sole'; }
              else { pokePose = null; tilt = mf * 0.2 * (1 - seg(0.3, 1)); dust = u < 0.5; }
              break;
            }
            case 'hurdle': {      // スライディングを飛び越える：つま先でボールを浮かせ、膝をたたんで跳ぶ（本家の動画を写す）
              facing = ffw;
              if (u < 0.14) { pokePose = 'crouch'; tilt = ffw * 0.1; }
              else if (u < 0.74) { const ph = seg(0.14, 0.74); lift = 0.95 * Math.sin(ph * Math.PI); pokePose = 'hurdle'; jumpPose = false; tilt = ffw * 0.12 * (1 - ph); }
              else { pokePose = u < 0.86 ? 'crouch' : null; dust = u < 0.82; }
              break;
            }
            case 'swerve': {      // ドリブルしたまま、滑ってくる足の外へ体ごとよける
              if (u < 0.55) { facing = sx; pokePose = Math.floor(u * 10) % 2 ? 'lunge' : null; tilt = sx * 0.22 * Math.sin(seg(0, 0.55) * Math.PI); dust = u > 0.1 && u < 0.3; }
              else { facing = ffw; tilt = ffw * 0.1 * (1 - seg(0.55, 1)); }
              break;
            }
            case 'heelLift':      // 版666：①止まって足の裏でボールを後ろへ転がす → ②後ろの足のかかとに乗せ、背中越しに跳ね上げる → ③相手の横を回り込んで走る
              facing = ffw;
              if (u < 0.27) { pokePose = 'sole'; tilt = -ffw * 0.06; }
              else if (u < 0.36) { pokePose = 'crouch'; tilt = ffw * 0.08; }
              else if (u < 0.5) { pokePose = 'bigWindup'; lift = 0.4 * Math.sin(seg(0.36, 0.5) * Math.PI); jumpPose = false; tilt = ffw * 0.14; }
              else { pokePose = u < 0.58 ? 'lunge' : null; dust = u < 0.62; }
              break;
          }
          if (dust) dusts.push([q.x - facing * 3.5 * (r0px || 2.6 * q.s), q.y, 2.6 * q.s, u]);
        }
        // シュートブロックに来た相手：コースに立ちはだかって止まり、腰を落として構えたまま固まる（キックフェイントにかかった）
        if (ac && ac.a === 'block') { dmFacing = Math.atan2(ac.dy, ac.dx); pokePose = 'crouch'; tilt = 0; }
        // 股抜きを読んだDF：足を閉じて止め、相手に背中を向けて体を入れる（ボールを隠す）
        // 版666：ヒールリフトをされた相手：振り返って、頭の上を越えていくボールを見上げる（読んだ時は、ボールの方を向いて腰を落とし、跳ぶ構え）
        if (ac && ac.a === 'hlLook') { dmFacing = Math.atan2(ac.dy, ac.dx); facing = Math.sign(proj(p.x + ac.dx, p.y + ac.dy).x - q.x) || facing; pokePose = ac.read ? 'crouch' : (ac.u < 0.5 ? null : 'crouch'); tilt = ac.read ? 0 : -facing * 0.1 * Math.sin(Math.PI * Math.min(1, ac.u * 1.4)); }
        if (ac && ac.a === 'bodyIn') {
          // 相手に背中を向けてボールを隠し、肩・背中を相手にぶつける（最初の一瞬は相手の方へ体をぶつけ、そのあと腰を落としてキープ）
          dmFacing = Math.atan2(ac.dy, ac.dx); const bf = Math.sign(proj(p.x - ac.dx, p.y - ac.dy).x - q.x) || 1;
          if (ac.u < 0.25) { tilt = bf * 0.26 * Math.sin(Math.PI * ac.u / 0.25); dxs = bf * Math.sin(Math.PI * ac.u / 0.25) * 3 * q.s; if (ac.bump && ac.u < 0.18) dusts.push([q.x + bf * 2.6 * q.s * 2, q.y - 2.6 * q.s * 6, 2.6 * q.s, ac.u / 0.18]); }
          else { pokePose = ac.u < 0.6 ? 'crouch' : null; tilt = bf * 0.08; }
        }
        // 祭り太鼓の壁：発動した瞬間に前傾して一気に踏み込み（mtrush）、肩から体ごとぶつかる（mthit）。タックルしたと一目で分かるように
        { const L6 = actsOf[i]; if (L6) for (let k = L6.length - 1; k >= 0; k--) { const a6 = L6[k]; if (a6.t > simT) continue; if (simT - a6.t > 1.1) break;
            if (a6.a === 'kgpin' && simT - a6.t < a6.d) { tilt = Math.sin(simT * 30) * 0.12; dxs = Math.sin(simT * 30) * 1.2 * q.s; pokePose = 'crouch'; break; }   // 影縫い（凸）：足を縫い止められ、もがく
            if ((a6.a === 'mthit' || a6.a === 'mtrush' || a6.a === 'mtpush') && simT - a6.t < a6.d) {
              const u6 = (simT - a6.t) / a6.d, m6 = proj(p.x + a6.dx, p.y + a6.dy), l6 = Math.hypot(m6.x - q.x, m6.y - q.y) || 1, sx6 = Math.sign(m6.x - q.x) || 1, ps6 = 2.6 * q.s;
              dmFacing = Math.atan2(a6.dy, a6.dx);
              if (a6.a === 'mtpush') { dmFacing = Math.atan2(-a6.dy, -a6.dx); tilt = sx6 * 0.22 + Math.sin(simT * 45) * 0.06; dxs = sx6 * (1 + Math.sin(simT * 45)) * 1.2 * q.s; pokePose = 'crouch'; }   // 体をぶつけられた相手：押し込まれて、のけぞりながら踏ん張る
              else if (a6.a === 'mtrush') { tilt = sx6 * 0.32; speedFx.push([q.x, q.y, ps6, (m6.x - q.x) / l6, (m6.y - q.y) / l6]); if (u6 < 0.5) dusts.push([q.x - sx6 * 3 * ps6, q.y, ps6, u6 / 0.5]); }
              else {
                if (u6 < 0.2) { const e6 = Math.sin(Math.PI * u6 / 0.4); dxs = sx6 * e6 * 4 * q.s; tilt = sx6 * 0.4; pokePose = 'lunge'; } else if (u6 < 0.55) { dxs = sx6 * (3 + Math.sin(simT * 45) * 1) * q.s; tilt = sx6 * 0.32; pokePose = 'crouch'; } else { tilt = sx6 * 0.15 * (1 - u6); }   // 肩から当たって、そのまま押し込む
                if (u6 < 0.35) defFx.push(['mtstar', q.x + (m6.x - q.x) / l6 * ps6 * 3, q.y - ps6 * 4 + (m6.y - q.y) / l6 * ps6 * 1.5, ps6, u6 / 0.35, a6.lv || 1]);
                if (u6 < 0.3) dusts.push([q.x + sx6 * 2 * ps6, q.y, ps6, u6 / 0.3]);
              }
              break;
            } } }
        // 股抜きを読んで足を閉じる：相手の方を向いて腰を落とし、両足でボールを挟んで止める
        if (ac && ac.a === 'legsClose') { dmFacing = Math.atan2(ac.dy, ac.dx); pokePose = 'crouch'; }
        // 股を抜かれる相手：足を開いて止めにきた姿勢のまま固まる
        if (ac && ac.a === 'spread') { dmFacing = Math.atan2(ac.dy, ac.dx); pokePose = 'crouch'; }
        // 高速ドリブル：前傾したまま全力で走り、大きく蹴り出したボールを追う
        if (ac && ac.a === 'sdrun') { const m2 = proj(p.x + p.vx, p.y + p.vy), ml = Math.hypot(m2.x - q.x, m2.y - q.y) || 1, lat = (m2.x - q.x) / (Math.hypot(m2.x - q.x, (m2.y - q.y) / 0.55) || 1); tilt = 0.2 * lat; /* 前傾：手前・奥へ走る時は体を横に倒さない */ speedFx.push([q.x, q.y, 2.6 * q.s, (m2.x - q.x) / ml, (m2.y - q.y) / ml]); }
        // 緩急（突破のドリブル）：普通のドリブルから、ぐっと前傾して地面を蹴り、一気にグン！と加速する
        if (ac && ac.a === 'pace' && ac.k === 'burst') {
          const mp = proj(p.x + p.vx, p.y + p.vy), mf = Math.sign(mp.x - q.x) || facing, lat = (mp.x - q.x) / (Math.hypot(mp.x - q.x, (mp.y - q.y) / 0.55) || 1);
          tilt = 0.32 * lat * (ac.u < 0.15 ? ac.u / 0.15 : 1 - (ac.u - 0.15) * 0.8);   // 手前・奥へ走る時は体を横に倒さない
          if (ac.u < 0.45) dusts.push([q.x - mf * 3.5 * 2.6 * q.s, q.y, 2.6 * q.s, ac.u / 0.45]);
        }
        // 技の最中は残像を出して、動きの速さ・迫力を見せる
        const skillMove = ac && ac.a === 'dmove' && ac.u < 0.9;
        if (false) {
          for (let gk = 3; gk >= 1; gk--) {
            const sp2 = stateAt(Math.max(0, simT - 0.06 * gk)).players[i], gq = proj(sp2.x, sp2.y);
            ctx.globalAlpha = 0.34 - gk * 0.08;
            sprite(gq.x + dxs * (1 - gk * 0.3), gq.y, q.s, info, team, facing, f4, false, false, true, pokePose, 0, view);
          }
          ctx.globalAlpha = 1;
        }
        const g = lift ? P3(p.x, p.y, lift) : q;
        if (lift) { ctx.fillStyle = 'rgba(0,30,0,0.3)'; ctx.beginPath(); ctx.ellipse(q.x, q.y, 4.5 * 2.5 * q.s, 1.5 * 2.5 * q.s, 0, 0, 7); ctx.fill(); }
        if (ghost) { const gp = (kp && kp.pose) || pokePose; for (let k = 3; k >= 1; k--) { ctx.save(); ctx.globalAlpha = 0.16 * (4 - k); ctx.translate(g.x + dxs - ghost[0] * k * 4.5 * q.s, g.y - hop - ghost[1] * k * 4.5 * q.s); if (tilt) ctx.rotate(tilt); sprite(0, 0, q.s, info, team, facing, f4, false, arms, true, gp, p.sp, view); ctx.restore(); } ctx.globalAlpha = 1; }   // 残像（動いてきた側に薄く3つ）
        if (tilt) { ctx.save(); ctx.translate(g.x + dxs, g.y - hop); ctx.rotate(tilt); r = sprite(0, 0, q.s, info, team, facing, f4, p.moving && !cheer && !pokePose, arms, !!lift, (kp && kp.pose) || pokePose || headPose, p.sp, view); ctx.restore(); r = { top: g.y - 45 * q.s, px: r.px }; }
        else { if (cheer) dmFacing = Math.PI / 2;   // ゴール後のバンザイはカメラの方を向く
        r = sprite(g.x + dxs, g.y - hop, q.s, info, team, facing, f4, p.moving && !cheer && !lift && !pokePose, arms, !!lift || hop > 0, (kp && kp.pose) || pokePose || headPose || touchPose || (jumpPose ? 'jump' : null), p.sp, cheer ? 'front' : view); }
        // 足の振りの軌跡（現実にない線は出さない）
        if (false) {
          const px = r.px || 2.6 * q.s, fy = q.y - px * 1.5, u = ac.u;
          if (ac.k === 'scissors') { const ph = (u * 4) % 1, dir = Math.floor(u * 4) % 2 ? 1 : -1; if (u < 0.8) swoosh(q.x + dir * px * 2, fy, px * 5, dir > 0 ? Math.PI : 0, dir > 0 ? Math.PI + Math.PI * ph : -Math.PI * ph, 0.85); }
          else if (ac.k === 'roulette') swoosh(q.x, q.y - px * 6, px * 9, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2, 0.8, '#ffe23a');
          else if (ac.k === 'elastico' || ac.k === 'doubleTouch') { const sx2 = Math.sign(proj(p.x + ac.dx, p.y + ac.dy).x - q.x) || 1; swoosh(q.x + sx2 * px * 2, fy, px * 6, sx2 > 0 ? Math.PI * 0.9 : 0.1, sx2 > 0 ? Math.PI * 0.9 - Math.PI * Math.min(1, u * 1.6) : 0.1 + Math.PI * Math.min(1, u * 1.6), 0.8); }
          else if (ac.k === 'cutback' || ac.k === 'nutmeg' || ac.k === 'heelLift' || ac.k === 'kickFeint') swoosh(q.x + facing * px * 3, fy, px * 5, facing > 0 ? Math.PI : 0, facing > 0 ? Math.PI * 2 * Math.min(1, u * 1.5) * 0.5 + Math.PI : -Math.PI * Math.min(1, u * 1.5), 0.75);
        }
        if (ac && ac.a === 'head' && ac.u > (ac.hitU ?? 0.35) && ac.u < (ac.hitU ?? 0.35) + 0.25) {
          // ヘディングの瞬間
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x + facing * 3 * r.px, r.top + 2 * r.px, 5 * r.px * (ac.u - 0.3) * 3, 0, 7); ctx.stroke();
        }
      }
      const sk = skillAt(i);
      // 技が出た瞬間の輪と集中線、画面下の大きな技名
      { const L2 = actsOf[i]; for (let k = L2.length - 1; k >= 0; k--) { const a = L2[k]; if (a.t > simT) continue; if (simT - a.t > 0.5) break;
          if (a.a === 'skill') { flashes.push([q.x, q.y, r.px || q.s * 2.6, simT - a.t]); if (!skillBanner || skillBanner.t < a.t - 0.01 || (skillBanner.t === a.t && skillBanner.i === i && !skillBanner.name.includes(SKILL_NAME[a.k]))) { const nm = SKILL_NAME[a.k] || a.k; skillBanner = skillBanner && skillBanner.i === i && Math.abs(skillBanner.t - a.t) < 0.05 && !skillBanner.name.includes(nm) ? { ...skillBanner, name: skillBanner.name + '＋' + nm } : { t: a.t, i, team, name: nm, who: `${info.number} ${info.name}` }; } break; } } }
      // 技名は頭の上の小さな吹き出しで（大きな技名はリプレイ・ダイジェストでだけ）
      if (sk) {   // 紫電の遊戯が出ている間の技の吹き出しは、紫電の遊戯と同じ色にする
        let ov = null; const L9 = actsOf[i]; if (L9) for (let k = L9.length - 1; k >= 0; k--) { const a = L9[k]; if (a.t > simT) continue; if (simT - a.t > 9) break; if (a.a === 'uend' && a.k === 'shiden') break; if (a.a === 'uniq' && a.k === 'shiden') { ov = D.UNIQ && D.UNIQ.shiden && D.UNIQ.shiden.chip; break; } }
        skillChips.push([q.x, r.top - 44, sk, ov]); { const kk = i + '|' + sk + '|' + (show ? show.phase : ''), last = chipHeard.get(kk); if (sndLive() && speed < 4 && (last == null || Math.abs(simT - last) > 2)) /* 版503：スキル発動の音はなし */ chipHeard.set(kk, simT); } }
      // 月影の抜け出し：出ている間、走る選手のうしろに月の光の色の風と残像
      { const L3 = actsOf[i]; for (let k = L3.length - 1; k >= 0; k--) { const a = L3[k]; if (a.t > simT) continue; if (simT - a.t > 6) break;
          if (a.a === 'uend' && a.k === 'tsukikage') break;
          if (a.a === 'uniq' && a.k === 'tsukikage' && simT - a.t < 4 * (a.lv >= 2 ? 1.25 : 1)) { const sp = p.sp || 0; if (sp > 1.5 || simT - a.t < 0.6) { const m2 = proj(p.x + p.vx, p.y + p.vy), ml = Math.hypot(m2.x - q.x, m2.y - q.y) || 1; moonFx.push([q.x, q.y, r.px || q.s * 2.6, (m2.x - q.x) / ml, (m2.y - q.y) / ml, a.lv || 1, r.top]); } break; } } }
      // 守備の固有スキル：捨て身の守護神（深紅の残像・ボールに触れた瞬間の衝撃の輪）／雅の後始末（ライムの光の帯・FWの前に立ちはだかる光の柱）／桜島の号令（ミントの波紋）
      { const L5 = actsOf[i], sp5 = p.sp || 0, ml5 = Math.hypot(p.vx || 0, p.vy || 0) || 1, m5 = proj(p.x + (p.vx || 0) / ml5, p.y + (p.vy || 0) / ml5), dl5 = Math.hypot(m5.x - q.x, m5.y - q.y) || 1, px5 = r.px || q.s * 2.6;
        let gS = false, gT = false, gW = false, gM = false, gB = false, gK = false, eM = false, lvM = 1, eG = false, gG = false, gP = false, gN = false;
        for (let k = L5.length - 1; k >= 0; k--) { const a = L5[k]; if (a.t > simT) continue; if (simT - a.t > 6) break;
          if (a.a === 'uend' && a.k === 'miyabi') eM = true;
          if (a.a === 'uend' && a.k === 'kagenui') eG = true;
          if (!gP && a.a === 'kgpin' && simT - a.t < a.d) { gP = true; defFx.push(['kgpin', q.x, q.y, px5, (simT - a.t) / a.d]); }   // 影縫い（凸）：縫い止められた相手の足もとに、光の針が刺さる
          if (!gN && a.a === 'kgsew' && simT - a.t < a.d) { gN = true; const fr = st.players[a.o]; if (fr) { const fq = proj(fr.x, fr.y); defFx.push(['kgsew', q.x, q.y, fq.x, fq.y, px5, (simT - a.t) / a.d]); } }
          if (!gS && a.a === 'uniq' && a.k === 'sutemi' && simT - a.t < 3 * (a.lv >= 2 ? 1.25 : 1)) { gS = true; if (sp5 > 2) defFx.push(['trail', q.x, q.y, px5, (m5.x - q.x) / dl5, (m5.y - q.y) / dl5, r.top, 255, 77, 109, a.lv || 1]); }
          if (!gM && !eM && a.a === 'uniq' && a.k === 'miyabi' && simT - a.t < 3 * (a.lv >= 2 ? 1.25 : 1)) { gM = true; lvM = a.lv || 1; defFx.push(sp5 > 1.5 ? ['ribbon', q.x, q.y, px5, (m5.x - q.x) / dl5, (m5.y - q.y) / dl5, r.top, lvM] : ['maura', q.x, q.y, px5, r.top, lvM]); }   // 走っている間は光の帯、待ち構えている間は足もとの光
          if (!gB && !eM && a.a === 'myb' && simT - a.t < a.d && a.r >= 0) { gB = true; const fr = st.players[a.r]; if (fr && Math.hypot(fr.x - p.x, fr.y - p.y) < 3.4) defFx.push(['pillar', q.x, q.y, px5, r.top, simT, lvM]); }
          if (a.a === 'mtslow' && simT - a.t < a.d && !gT) defFx.push(['mtslow', q.x, q.y, px5, r.top, (simT - a.t) / a.d]);   // 祭り太鼓の壁（凸）：ぶつけられた相手は、足が重くなる（足もとの青い輪と沈む光）
          if (!gT && a.a === 'taiko' && simT - a.t < 0.75) { gT = true; defFx.push(['drum', q.x, q.y, px5, (simT - a.t) / 0.75, a.lv || 1]); }   // 祭り太鼓の壁：ドン！
          if (!gW && a.a === 'uniq' && a.k === 'ikari' && simT - a.t < 2.0) { gW = true; defFx.push(['anchor', q.x, q.y, px5, r.top, (simT - a.t) / 2.0, a.lv || 1]); }   // 白亜の城壁：白いオーラ
          if (!gK && a.a === 'uniq' && a.k === 'sakurajima' && simT - a.t < 1.0) { gK = true; defFx.push(['wave', q.x, q.y, px5, (simT - a.t) / 1.0]); }
          if (a.a === 'sjline' && simT - a.t < a.d && (!sjLine || sjLine.t < a.t)) sjLine = { t: a.t, u: (simT - a.t) / a.d, team: a.dt, lv: a.lv || 1 };
        } }
      // 影縫い：続いている間（最長75秒）ずっと、ひがしと狙った相手の影を糸でつなぐ（離れていても、25m以内なら糸が伸びる）
      { const L7 = actsOf[i]; if (L7) for (let k = L7.length - 1; k >= 0; k--) { const a = L7[k]; if (a.t > simT) continue; if (simT - a.t > 130) break;
          if (a.a === 'kgoff' || (a.a === 'uend' && a.k === 'kagenui')) break;   // 張りつきをやめた（味方ボール・ゴール後・止まっている時）→ 糸は出さない
          if (a.a === 'kgsh' && a.r >= 0) { const fr = st.players[a.r]; if (fr && Math.hypot(fr.x - p.x, fr.y - p.y) < 25) { const fq = proj(fr.x, fr.y); defFx.push(['kgthread', q.x, q.y, fq.x, fq.y, r.px || q.s * 2.6, simT - a.t, a.lv || 1]); } break; } } }
      // 紫電の遊戯：発動中は足もとのボールに紅い電気がパチパチ走り、抜いた瞬間に稲妻がはじける
      { const L8 = actsOf[i]; let gSp = false, gZp = false; if (L8) for (let k = L8.length - 1; k >= 0; k--) { const a = L8[k]; if (a.t > simT) continue; if (simT - a.t > 8) break;
          if (a.a === 'uend' && a.k === 'shiden') gSp = true;
          if (!gZp && a.a === 'sdzap' && simT - a.t < a.d) { gZp = true; defFx.push(['sdzap', q.x, q.y, r.px || q.s * 2.6, (simT - a.t) / a.d, a.lv || 1]); }
          if (!gSp && a.a === 'uniq' && a.k === 'shiden' && simT - a.t < 6 * (a.lv >= 2 ? 1.25 : 1)) { gSp = true; if (st.owner === i) { defFx.push(['sdspark', q.x, q.y, r.px || q.s * 2.6, a.lv || 1]); if ((a.lv || 1) >= 2) defFx.push(['sdaura', q.x, q.y, r.px || q.s * 2.6, r.top]); } } } }
      // 港の指揮者：指揮棒の合図（おおかわ）・走り出すコースの光の線・受けた味方の「指揮の余韻」
      { const L4 = actsOf[i]; let gotRun = false, gotBuf = false, gotBat = false;
        for (let k = L4.length - 1; k >= 0; k--) { const a = L4[k]; if (a.t > simT) continue; if (simT - a.t > 5) break;
          if (!gotBat && a.a === 'uniq' && a.k === 'minato' && simT - a.t < 1.4) { gotBat = true; tactFx.push(['baton', q.x, r.top, r.px || q.s * 2.6, simT - a.t, a.lv || 1]); }
          if (!gotRun && a.a === 'tact' && simT - a.t < a.d) { gotRun = true; const m3 = proj(a.tx, a.ty); tactFx.push(['run', q.x, q.y, m3.x, m3.y, (simT - a.t) / a.d, r.px || q.s * 2.6]); }
          if (!gotBuf && a.a === 'tactbuf' && simT - a.t < a.d) { gotBuf = true; tactFx.push(['aura', q.x, q.y, r.px || q.s * 2.6, a.lv || 1, simT - a.t, a.d]); } } }
      // 港の指揮者（おおかわ）：指揮が続いている間、味方全員の足もとで紫の輪が同じリズムで脈打ち、ときどき音符が浮かぶ
      { const LC = actsOf[i]; if (LC) for (let k = LC.length - 1; k >= 0; k--) { const a = LC[k]; if (a.t > simT) continue; if (simT - a.t > 16) break;
          if (a.a === 'cdoff') break;
          if (a.a === 'cdon') { if (simT - a.t < a.d) tactFx.push(['cdaura', q.x, q.y, r.top, r.px || q.s * 2.6, a.lv || 1, simT - a.t, a.d, i * 0.37]); break; } } }
      // 金鯱の心臓（かい）：全力の走りに金色の残像（攻めは前へ、守りはボールへ）
      { const LK = actsOf[i]; if (LK) for (let k = LK.length - 1; k >= 0; k--) { const a = LK[k]; if (a.t > simT) continue; if (simT - a.t > 9) break;
          if (a.a === 'ksrun') { if (simT - a.t < a.d) { const sp = p.sp || 0, vl = Math.hypot(p.vx || 0, p.vy || 0) || 1; if (sp > 2.5) { const bq = proj(p.x - (p.vx || 0) / vl * sp * 0.12, p.y - (p.vy || 0) / vl * sp * 0.12); tactFx.push(['ksrun', q.x, q.y, bq.x - q.x, bq.y - q.y, r.top, r.px || q.s * 2.6, a.lv || 1, a.m === 'def']); } } break; } } }
      // 白夜の視界（ことう）：白い光が広がって時間がゆっくりに。ロングフィードは白い光の尾を引いて大きな弧。受けた味方の足もとに白い輪
      { const LB = actsOf[i]; let gC = false, gP = false, gB = false; if (LB) for (let k = LB.length - 1; k >= 0; k--) { const a = LB[k]; if (a.t > simT) continue; if (simT - a.t > 5) break;
          if (!gC && a.a === 'bycalm' && simT - a.t < a.d + 0.4) { gC = true; tactFx.push(['bycalm', q.x, q.y, r.top, r.px || q.s * 2.6, (simT - a.t) / (a.d + 0.4), a.lv || 1]); }
          if (!gP && a.a === 'bypass' && simT - a.t < a.d) { gP = true; const pts = [], t1 = Math.min(simT, a.t + a.d); let ended = false, tEnd = 0;
            for (let k2 = 0; k2 <= 22; k2++) { const tt = a.t + (t1 - a.t) * k2 / 22, s2 = k2 === 22 ? st : stateAt(tt); if (k2 > 2 && ((s2.owner >= 0 && s2.owner !== i) || s2.code)) { ended = true; tEnd = tt; break; } const bq = P3(s2.ball.x, s2.ball.y, (s2.ball.z || 0) + 0.11); pts.push([bq.x, bq.y]); }
            if (!ended || simT - tEnd < 0.4) tactFx.push(['bytrail', pts, simT - a.t, a.d, r.px || q.s * 2.6, a.lv || 1, ended ? simT - tEnd : -1]); }   /* 受け手が収めたら、光の尾はすぐ消す（残さない） */
          if (a.a === 'byrun' && simT - a.t < a.d && st.owner !== i) tactFx.push(['byrun', q.x, q.y, r.px || q.s * 2.6, (simT - a.t) / a.d, a.lv || 1]);   // 裏へ走り出した味方：白い風
          if (!gB && a.a === 'bybuf' && simT - a.t < a.d && (st.owner === i || simT - a.t < 0.6)) { gB = true; tactFx.push(['bybuf', q.x, q.y, r.px || q.s * 2.6, a.lv || 1, simT - a.t, a.d]); } } }
      // 蒼の王座（青）・渦潮の囮（橙）：釣られた／引っぱられたDFから本人へ光の線。走り込む・入ってくる味方の足もとに色の風
      { const LU = actsOf[i]; let gU = false, gR = false; if (LU) for (let k = LU.length - 1; k >= 0; k--) { const a = LU[k]; if (a.t > simT) continue; if (simT - a.t > 10) break;
          if (a.a === 'upoff') gU = true;
          if (!gU && (a.a === 'aopull' || a.a === 'uzpull' || a.a === 'mdpull') && simT - a.t < a.d && st.players[a.to]) { gU = true; const tp = st.players[a.to], m = proj(tp.x, tp.y); tactFx.push(['upull', q.x, q.y, m.x, m.y, a.a === 'aopull' ? '42,140,255' : a.a === 'mdpull' ? '40,220,120' : '255,115,0', r.px || q.s * 2.6, (simT - a.t) / a.d]); }
          if (!gR && (a.a === 'aorun' || a.a === 'uzrun') && simT - a.t < a.d && st.owner !== i) { gR = true; tactFx.push(['urun', q.x, q.y, a.a === 'aorun' ? '42,140,255' : '255,115,0', r.px || q.s * 2.6, (simT - a.t) / a.d]); } } }
      // 蒼の王座（くもい）：縦パスが出た瞬間に青い光が弾け、キープ中は足もとに青い王座の輪。裏へのスルーパスは青い光の尾
      { const LA = actsOf[i]; let gF = false, gA = false, gT = false; if (LA) for (let k = LA.length - 1; k >= 0; k--) { const a = LA[k]; if (a.t > simT) continue; if (simT - a.t > 6) break;
          if (!gF && a.a === 'aoflash' && simT - a.t < a.d) { gF = true; tactFx.push(['aoflash', q.x, q.y, r.top, r.px || q.s * 2.6, (simT - a.t) / a.d, a.lv || 1]); }
          if (!gA && a.a === 'aopostend') gA = true;
          if (!gA && a.a === 'aopost') { gA = true; if (simT - a.t < a.d) tactFx.push(['aothrone', q.x, q.y, r.top, r.px || q.s * 2.6, a.lv || 1, simT - a.t]); }
          if (!gT && a.a === 'aopass' && simT - a.t < a.d) { gT = true; const pts = [], t1 = Math.min(simT, a.t + a.d); let ended = false, tEnd = 0;
            for (let k2 = 0; k2 <= 18; k2++) { const tt = a.t + (t1 - a.t) * k2 / 18, s2 = k2 === 18 ? st : stateAt(tt), rp = a.r != null ? s2.players[a.r] : null; if (k2 > 2 && ((s2.owner >= 0 && s2.owner !== i) || s2.code || (rp && Math.hypot(rp.x - s2.ball.x, rp.y - s2.ball.y) < 1.6))) { ended = true; tEnd = tt; break; } const bq = P3(s2.ball.x, s2.ball.y, (s2.ball.z || 0) + 0.11); pts.push([bq.x, bq.y]); }
            if (!ended || simT - tEnd < 0.25) tactFx.push(['aotrail', pts, simT - a.t, a.d, r.px || q.s * 2.6, a.lv || 1, ended ? simT - tEnd : -1]); } } }
      // 影からの一撃（かめい・銀）：気配が消えて銀色の残像を引き、遅れて飛び込む。打つ瞬間に銀の閃光
      // 鉄狼の関所（さかぐち・鋼色）：鋼色の門が閉じ、狼のように寄せる。奪った瞬間に鋼色の輪、前への縦パスは鋼色の尾
      { const LK = actsOf[i]; let gK1 = false, gK2 = false, gK3 = false, gT1 = false, gT2 = false, gT3 = false, gT4 = false; if (LK) for (let k = LK.length - 1; k >= 0; k--) { const a = LK[k]; if (a.t > simT) continue; if (simT - a.t > 8) break;
          if (!gK1 && a.a === 'kmfire' && simT - a.t < a.d) { gK1 = true; tactFx.push(['kmfire', q.x, q.y, r.px || q.s * 2.6, (simT - a.t) / a.d, a.lv || 1]); }
          if (!gK2 && a.a === 'kmshade' && simT - a.t < a.d) { gK2 = true; const gh = []; for (let g = 1; g <= 4; g++) { const s2 = stateAt(Math.max(a.t - 0.3, simT - g * 0.13)), pp = s2.players[i]; if (pp) { const m = proj(pp.x, pp.y); gh.push([m.x, m.y]); } } tactFx.push(['kmshade', q.x, q.y, gh, r.px || q.s * 2.6, simT - a.t, a.d]); }
          if (a.a === 'kmrun' && simT - a.t < a.d && st.owner !== i) tactFx.push(['urun', q.x, q.y, '200,206,216', r.px || q.s * 2.6, (simT - a.t) / a.d]);   // 影の一刺しで動き出したFW：銀の風
          if (a.a === 'kmpass' && simT - a.t < a.d) { const pts = [], t1 = Math.min(simT, a.t + a.d); let ended = false, tEnd = 0;
            for (let k2 = 0; k2 <= 16; k2++) { const tt = a.t + (t1 - a.t) * k2 / 16, s2 = k2 === 16 ? st : stateAt(tt), rp = a.r != null ? s2.players[a.r] : null; if (k2 > 2 && ((s2.owner >= 0 && s2.owner !== i) || s2.code || (rp && Math.hypot(rp.x - s2.ball.x, rp.y - s2.ball.y) < 1.6))) { ended = true; tEnd = tt; break; } const bq = P3(s2.ball.x, s2.ball.y, (s2.ball.z || 0) + 0.11); pts.push([bq.x, bq.y]); }
            if (!ended || simT - tEnd < 0.25) tactFx.push(['ctrail', pts, simT - a.t, a.d, r.px || q.s * 2.6, '215,222,232', ended ? simT - tEnd : -1]); }   // 影の一刺しの1本：銀の光の尾
          if (!gK3 && a.a === 'kmshot' && simT - a.t < a.d) { gK3 = true; tactFx.push(['kmshot', q.x, q.y, r.px || q.s * 2.6, (simT - a.t) / a.d]); }
          if (!gT1 && a.a === 'ttgate' && simT - a.t < a.d) { gT1 = true; tactFx.push(['ttgate', q.x, q.y, r.px || q.s * 2.6, (simT - a.t) / a.d, a.lv || 1]); }
          if (!gT2 && a.a === 'ttwolf' && simT - a.t < a.d && st.owner !== i) { gT2 = true; tactFx.push(['urun', q.x, q.y, '108,127,156', r.px || q.s * 2.6, (simT - a.t) / a.d]); }
          if (!gT3 && a.a === 'ttsteal' && simT - a.t < a.d) { gT3 = true; tactFx.push(['ttsteal', q.x, q.y, r.px || q.s * 2.6, (simT - a.t) / a.d, a.lv || 1]); }
          if (!gT4 && a.a === 'ttpass' && simT - a.t < a.d) { gT4 = true; const pts = [], t1 = Math.min(simT, a.t + a.d); let ended = false, tEnd = 0;
            for (let k2 = 0; k2 <= 16; k2++) { const tt = a.t + (t1 - a.t) * k2 / 16, s2 = k2 === 16 ? st : stateAt(tt), rp = a.r != null ? s2.players[a.r] : null; if (k2 > 2 && ((s2.owner >= 0 && s2.owner !== i) || s2.code || (rp && Math.hypot(rp.x - s2.ball.x, rp.y - s2.ball.y) < 1.6))) { ended = true; tEnd = tt; break; } const bq = P3(s2.ball.x, s2.ball.y, (s2.ball.z || 0) + 0.11); pts.push([bq.x, bq.y]); }
            if (!ended || simT - tEnd < 0.25) tactFx.push(['ctrail', pts, simT - a.t, a.d, r.px || q.s * 2.6, '150,170,205', ended ? simT - tEnd : -1]); } } }
      // 版838：スキルの効果を目に見える形に（オーバーラップ・帰陣ダッシュ・インターセプト・キャプテンシー・ピンポイントクロス）
      { const LS = actsOf[i]; const seen = {}; if (LS) for (let k = LS.length - 1; k >= 0; k--) { const a = LS[k]; if (a.t > simT) continue; if (simT - a.t > 50) break; if (seen[a.a] || simT - a.t >= a.d) continue;
          const px0 = r.px || q.s * 2.6, el = simT - a.t;
          if (a.a === 'ovrun' && st.owner !== i) { seen.ovrun = 1; tactFx.push(['urun', q.x, q.y, '80,205,255', px0, el / a.d]); }
          else if (a.a === 'recrun') { seen.recrun = 1; tactFx.push(['urun', q.x, q.y, '255,160,60', px0, el / a.d]); }
          else if (a.a === 'icpt') { seen.icpt = 1; tactFx.push(['ring2', q.x, q.y, px0, el / a.d, '90,170,255', 1]); }
          else if (a.a === 'capcall') { seen.capcall = 1; tactFx.push(['ring2', q.x, q.y, px0, el / a.d, '255,205,60', 1.6]); }
          else if (a.a === 'capbuf') { seen.capbuf = 1; tactFx.push(['gbuf', q.x, q.y, px0, el, a.d, a.c]); }
          else if (a.a === 'pppass' && el < a.d) { seen.pppass = 1; const pts = [], t1 = Math.min(simT, a.t + a.d); let ended = false, tEnd = 0;
            for (let k2 = 0; k2 <= 16; k2++) { const tt = a.t + (t1 - a.t) * k2 / 16, s2 = k2 === 16 ? st : stateAt(tt), rp = a.r != null ? s2.players[a.r] : null; if (k2 > 2 && ((s2.owner >= 0 && s2.owner !== i) || s2.code || (rp && Math.hypot(rp.x - s2.ball.x, rp.y - s2.ball.y) < 1.6))) { ended = true; tEnd = tt; break; } const bq = P3(s2.ball.x, s2.ball.y, (s2.ball.z || 0) + 0.11); pts.push([bq.x, bq.y]); }
            if (!ended || simT - tEnd < 0.25) { tactFx.push(['ctrail', pts, el, a.d, px0, '255,214,70', ended ? simT - tEnd : -1]); if (!ended && a.lx != null) { const g = proj(a.lx, a.ly); tactFx.push(['pptgt', g.x, g.y, px0, el, a.d]); } } }
        } }
      // 翠の起点（むらおか・翠）：発動で翠の輪が弾け、晒している間は足もとへ吸い寄せる翠の輪。食いついた相手へ翠の点線、走り出す仲間に翠の風、裏返す1本は翠の光の尾
      { const LM = actsOf[i]; let gM1 = false, gM2 = false, gM3 = false, gM4 = false, gM5 = false; if (LM) for (let k = LM.length - 1; k >= 0; k--) { const a = LM[k]; if (a.t > simT) continue; if (simT - a.t > 8) break;
          if (!gM1 && a.a === 'mdfire' && simT - a.t < a.d) { gM1 = true; tactFx.push(['mdfire', q.x, q.y, r.px || q.s * 2.6, (simT - a.t) / a.d, a.lv || 1]); }
          if (!gM2 && a.a === 'mdlure' && simT - a.t < a.d && st.owner === i) { gM2 = true; tactFx.push(['mdlure', q.x, q.y, r.px || q.s * 2.6, simT - a.t, a.d, a.lv || 1]); }
          if (a.a === 'mdrun' && simT - a.t < a.d && st.owner !== i) tactFx.push(['urun', q.x, q.y, '51,235,130', r.px || q.s * 2.6, (simT - a.t) / a.d]);
          if (!gM4 && a.a === 'mdfree' && simT - a.t < a.d) { gM4 = true; tactFx.push(['mdfree', q.x, q.y, r.px || q.s * 2.6, simT - a.t, a.d, a.lv || 1]); }
          if (a.a === 'mdbuff' && simT - a.t < a.d) tactFx.push(['mdbuff', q.x, q.y, r.px || q.s * 2.6, simT - a.t, a.d, a.k || 1, a.max]);
          if (!gM5 && a.a === 'mdguard' && simT - a.t < a.d) { gM5 = true; tactFx.push(['mdguard', q.x, q.y, r.px || q.s * 2.6, simT - a.t, a.d]); }
          if (!gM3 && a.a === 'mdpass' && simT - a.t < a.d) { gM3 = true; const pts = [], t1 = Math.min(simT, a.t + a.d); let ended = false, tEnd = 0;
            for (let k2 = 0; k2 <= 18; k2++) { const tt = a.t + (t1 - a.t) * k2 / 18, s2 = k2 === 18 ? st : stateAt(tt), rp = a.r != null ? s2.players[a.r] : null; if (k2 > 2 && ((s2.owner >= 0 && s2.owner !== i) || s2.code || (rp && Math.hypot(rp.x - s2.ball.x, rp.y - s2.ball.y) < 1.6))) { ended = true; tEnd = tt; break; } const bq = P3(s2.ball.x, s2.ball.y, (s2.ball.z || 0) + 0.11); pts.push([bq.x, bq.y]); }
            if (!ended || simT - tEnd < 0.25) tactFx.push(['ctrail', pts, simT - a.t, a.d, r.px || q.s * 2.6, '51,255,141', ended ? simT - tEnd : -1]); } } }
      // 針の穴通し（きのした）：DFのすき間を、ボールが金の糸を引いて抜けていく。受けた味方の足もとに淡い金の輪
      { const L9 = actsOf[i]; let gH = false, gHb = false; if (L9) for (let k = L9.length - 1; k >= 0; k--) { const a = L9[k]; if (a.t > simT) continue; if (simT - a.t > 4) break;
          if (!gH && a.a === 'hrpass' && simT - a.t < a.d) { gH = true;   // ボールが実際に通った道すじ（浮き球の弧・曲がりもそのまま）を糸にする
            const pts = [], t1 = Math.min(simT, a.t + a.d); for (let k = 0; k <= 18; k++) { const tt = a.t + (t1 - a.t) * k / 18, s2 = k === 18 ? st : stateAt(tt); if (k > 2 && s2.owner >= 0 && s2.owner !== i) { if (pts.length) { const bq = P3(s2.ball.x, s2.ball.y, (s2.ball.z || 0) + 0.11); pts.push([bq.x, bq.y]); } break; } const bq = P3(s2.ball.x, s2.ball.y, (s2.ball.z || 0) + 0.11); pts.push([bq.x, bq.y]); }
            tactFx.push(['hrthread', pts, simT - a.t, a.d, r.px || q.s * 2.6, a.lv || 1]); }
          if (!gHb && a.a === 'hrbuf' && simT - a.t < a.d && (st.owner === i || simT - a.t < 0.6)) { gHb = true; tactFx.push(['hraura', q.x, q.y, r.px || q.s * 2.6, a.lv || 1, simT - a.t, a.d]); } } }
      if (i === selected) {
        ctx.strokeStyle = '#fff35a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(q.x, q.y, 6.5 * r.px, 2.2 * r.px, 0, 0, Math.PI * 2); ctx.stroke();
      }
      if (tagged.has(i) || i === selected) { const cs = cardsOf[i] ? cardsOf[i].filter((c) => (c.up ?? c.t + 1) <= simT && c.number === info.number) : []; tags.push([q.x, r.top - 4, info, team, i === selected, cs.some((c) => c.color === 'red') ? 'red' : cs.length ? 'yellow' : null]); }
    }
    dmFacing = null; dmRunPh = null;   // 選手ループの外（入場・ベンチなど）は、view と facing から向きを決める
    tags.forEach((t) => nameTag(...t));
    drawContacts(st);
    // 高速ドリブル：体の後ろに流れる風の線（スピード感）
    // 桜島の号令：DFライン（2番目に後ろの守備者の位置）に、ミント色の光の壁が横一線に現れて、DFと一緒にせり上がる
    if (sjLine) { const tm5 = sjLine.team, base5 = tm5 * 11, gkx5 = st.players[base5].x, toR5 = gkx5 > 52.5, xs5 = [];
      for (let k5 = 0; k5 < 11; k5++) { const pp = st.players[base5 + k5]; if (pp) xs5.push(pp.x); }
      xs5.sort((a, b) => (toR5 ? b - a : a - b)); const lx5 = xs5[1], al5 = Math.min(1, (1 - sjLine.u) * 2.2) * Math.min(1, sjLine.u * 6 + 0.2);
      const a5 = proj(lx5, 0), b5 = proj(lx5, 68);
      ctx.save(); ctx.lineCap = 'round'; const L5v = sjLine.lv >= 2;
      ctx.strokeStyle = `rgba(124,255,196,${0.28 * al5})`; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(a5.x, a5.y); ctx.lineTo(b5.x, b5.y); ctx.stroke();
      ctx.strokeStyle = `rgba(124,255,196,${0.55 * al5})`; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(a5.x, a5.y); ctx.lineTo(b5.x, b5.y); ctx.stroke();
      ctx.strokeStyle = `rgba(232,255,246,${0.95 * al5})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a5.x, a5.y); ctx.lineTo(b5.x, b5.y); ctx.stroke();
      // 光の壁の上へ立ちのぼる粒
      for (let k5 = 0, n5 = L5v ? 22 : 14; k5 < n5; k5++) { const u5 = (k5 + 0.5) / n5, ph5 = (simT * 1.7 + k5 * 0.37) % 1, xx = a5.x + (b5.x - a5.x) * u5, yy = a5.y + (b5.y - a5.y) * u5 - ph5 * (L5v ? 44 : 34); ctx.fillStyle = `rgba(200,255,232,${(1 - ph5) * 0.9 * al5})`; ctx.fillRect(xx - 2, yy - 2, 4, 4); }
      // 押し上げるDFの足もとに、ミントのスピード線
      for (let k5 = 1; k5 < 11; k5++) { const pp = st.players[base5 + k5]; if (!pp || (pp.sp || 0) < 2.5) continue; const qq = proj(pp.x, pp.y), dir5 = toR5 ? 1 : -1;
        for (let j5 = 0; j5 < 3; j5++) { const o5 = proj(pp.x + dir5 * (0.8 + j5 * 0.7), pp.y + (j5 - 1) * 0.35); ctx.strokeStyle = `rgba(124,255,196,${0.75 * al5 * (1 - j5 * 0.25)})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(o5.x, o5.y - 4); ctx.lineTo(o5.x + (o5.x - qq.x) * 0.6, o5.y - 4 + (o5.y - qq.y) * 0.6); ctx.stroke(); } }
      ctx.restore(); }
    defFx.forEach((f) => {
      if (f[0] === 'trail') {   // 捨て身の守護神：深紅の残像と風
        const [, x, y, px0, dx, dy, top, cr, cg, cb, lv] = f, px = Math.max(2.4, px0), hgt = y - top;
        if (lv >= 2) { const gr = ctx.createRadialGradient(x, y - hgt * 0.5, 0, x, y - hgt * 0.5, px * 7); gr.addColorStop(0, `rgba(${cr},${cg},${cb},0.4)`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y - hgt * 0.5, px * 7, 0, 7); ctx.fill(); }   // 凸：体を包む深紅の光（残像は5つ）
        for (let n = lv >= 2 ? 5 : 3, g = n; g >= 1; g--) { ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.3 * (n + 1 - g) / n})`; ctx.beginPath(); ctx.ellipse(x - dx * px * g * 4.5, y - hgt * 0.45 - dy * px * g * 2.2, px * 4.4, hgt * 0.5, 0, 0, 7); ctx.fill(); }
        for (let k = 0; k < 7; k++) { const off = (simT * 12 + k * 0.27) % 1, len = px * (13 + (k % 3) * 5), h = -hgt * (0.12 + 0.13 * k) % hgt, sx = x - dx * px * (3 + off * 12), sy = y + h - dy * px * (3 + off * 12) * 0.5;
          ctx.strokeStyle = k % 2 ? `rgba(255,200,210,${0.95 * (1 - off)})` : `rgba(${cr},${cg},${cb},${0.95 * (1 - off)})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - dx * len, sy - dy * len * 0.5); ctx.stroke(); }
      } else if (f[0] === 'burst') {   // ボールに触れた瞬間：深紅の衝撃の輪
        const [, x, y, px0, u] = f, px = Math.max(2.4, px0);
        for (let k = 0; k < 2; k++) { const uu = Math.min(1, u * 1.3 + k * 0.15); ctx.strokeStyle = `rgba(255,${77 + k * 100},${109 + k * 80},${(1 - uu) * 0.95})`; ctx.lineWidth = Math.max(3, px * (1.4 - k * 0.5)); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + uu * 12), px * (2 + uu * 7), 0, 0, 7); ctx.stroke(); }
        for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283, rr = px * (3 + u * 14); ctx.fillStyle = `rgba(255,120,140,${1 - u})`; ctx.fillRect(x + Math.cos(a) * rr - 2, y + Math.sin(a) * rr * 0.6 - 2, 4, 4); }
      } else if (f[0] === 'ribbon') {   // 雅の後始末：走っている間、まっすぐ流れるライムの光（うねらせない）。凸は体を包むやわらかな光が濃くなる
        const [, x, y, px0, dx, dy, top, lv] = f, px = Math.max(2.4, px0), hgt = y - top, L2v = lv >= 2;
        ctx.save(); ctx.lineCap = 'round';
        { const cy = y - hgt * 0.5, rr = px * (L2v ? 7 : 5), gr = ctx.createRadialGradient(x, cy, 0, x, cy, rr); gr.addColorStop(0, `rgba(200,240,64,${L2v ? 0.42 : 0.22})`); gr.addColorStop(1, 'rgba(200,240,64,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, cy, rr, 0, 7); ctx.fill(); }
        const n = L2v ? 4 : 3;   // 背中のうしろに、まっすぐ流れる光の筋（はっきり見える太さ。うねらせない）
        for (let k = 0; k < n; k++) { const off = (simT * 2.5 + k / n) % 1, hy = y - hgt * (0.2 + 0.6 * k / (n - 1)), st = px * (4 + off * 2.5), len = px * (L2v ? 17 : 13) * (1 - off * 0.35);
          const x0 = x - dx * st, y0 = hy - dy * st * 0.5, x1 = x - dx * (st + len), y1 = hy - dy * (st + len) * 0.5, al = 1 - off * 0.55;
          const g2 = ctx.createLinearGradient(x0, y0, x1, y1); g2.addColorStop(0, `rgba(200,240,64,${0.95 * al})`); g2.addColorStop(1, 'rgba(200,240,64,0)');
          ctx.strokeStyle = g2; ctx.lineWidth = Math.max(L2v ? 4 : 3, px * (L2v ? 1.1 : 0.85)); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          const g3 = ctx.createLinearGradient(x0, y0, x1, y1); g3.addColorStop(0, `rgba(250,255,225,${0.95 * al})`); g3.addColorStop(0.7, 'rgba(250,255,225,0)');
          ctx.strokeStyle = g3; ctx.lineWidth = Math.max(1.2, px * 0.3); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'maura') {   // 雅の後始末：回り込んだ先で構えている間、足もとにやわらかなライムの輪（凸は少し明るく）
        const [, x, y, px0, top, lv] = f, px = Math.max(2.4, px0), L2v = lv >= 2, fl = 0.75 + 0.25 * Math.sin(simT * 5);
        ctx.strokeStyle = `rgba(200,240,64,${(L2v ? 0.8 : 0.55) * fl})`; ctx.lineWidth = Math.max(1.5, px * (L2v ? 0.5 : 0.35)); ctx.beginPath(); ctx.ellipse(x, y, px * 4, px * 1.5, 0, 0, 7); ctx.stroke();
      } else if (f[0] === 'pillar') {   // 「なぜお前が俺の前に…!!」：FWの前に立ちはだかった瞬間、ライムの光の柱
        const [, x, y, px0, top, t0, lv] = f, px = Math.max(2.4, px0), L2v = lv >= 2, h = (y - top) * (L2v ? 2.8 : 2.2), fl = 0.75 + 0.25 * Math.sin(t0 * 18), wd = L2v ? 4.2 : 3.2;
        const gr = ctx.createLinearGradient(0, y - h, 0, y); gr.addColorStop(0, 'rgba(200,240,64,0)'); gr.addColorStop(0.5, `rgba(200,240,64,${(L2v ? 0.75 : 0.45) * fl})`); gr.addColorStop(1, `rgba(246,255,216,${(L2v ? 0.95 : 0.7) * fl})`);
        ctx.fillStyle = gr; ctx.fillRect(x - px * wd, y - h, px * wd * 2, h);
        if (L2v) { ctx.strokeStyle = `rgba(36,54,10,${0.8 * fl})`; ctx.lineWidth = Math.max(2, px * 0.5); ctx.beginPath(); ctx.ellipse(x, y, px * 6.4, px * 2.3, 0, 0, 7); ctx.stroke(); }
        ctx.strokeStyle = `rgba(246,255,216,${0.9 * fl})`; ctx.lineWidth = Math.max(2, px * 0.6); ctx.beginPath(); ctx.ellipse(x, y, px * 5, px * 1.8, 0, 0, 7); ctx.stroke();
      } else if (f[0] === 'drum') {   // 祭り太鼓の壁：体をぶつけた瞬間、太鼓を打ったような青い衝撃の輪が「ドン」と広がる＋放射状の衝撃線（凸は輪が3重でさらに大きい）
        const [, x, y, px0, u, lv] = f, px = Math.max(2.4, px0) * 1.4, L2v = lv >= 2, cy = y - px * 2.2;
        ctx.save(); ctx.lineCap = 'round';
        if (u < 0.4) { const g = ctx.createRadialGradient(x, cy, 0, x, cy, px * 9); g.addColorStop(0, `rgba(255,255,255,${0.95 * (1 - u / 0.4)})`); g.addColorStop(0.5, `rgba(120,140,255,${0.6 * (1 - u / 0.4)})`); g.addColorStop(1, 'rgba(82,103,224,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, cy, px * 9, 0, 7); ctx.fill(); }   // ぶつかった瞬間の閃光
        for (let k = 0; k < 10; k++) { const an = k / 10 * 6.283 + 0.3, r0 = px * (3 + u * 10), r1 = r0 + px * (5 - u * 3); ctx.strokeStyle = `rgba(${k % 2 ? '229,232,250' : '120,140,255'},${(1 - u) * 0.95})`; ctx.lineWidth = Math.max(2.5, px * 0.8); ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r0, cy + Math.sin(an) * r0 * 0.62); ctx.lineTo(x + Math.cos(an) * r1, cy + Math.sin(an) * r1 * 0.62); ctx.stroke(); }   // 放射状の衝撃線
        if (L2v) {   // 凸：青い稲妻が走り、足もとの地面に亀裂。少し遅れて2発目の「ドドン」
          for (let k = 0; k < 7; k++) { const an = k / 7 * 6.283 + 0.6, al = Math.max(0, 1 - u * 1.4); if (al <= 0) break; ctx.strokeStyle = `rgba(${k % 2 ? '255,255,255' : '160,190,255'},${al})`; ctx.lineWidth = Math.max(3, px * 0.9); ctx.shadowColor = 'rgba(120,150,255,0.9)'; ctx.shadowBlur = px * 2; ctx.beginPath(); let rx = px * 2.5, xx = x + Math.cos(an) * rx, yy = cy + Math.sin(an) * rx * 0.62; ctx.moveTo(xx, yy);
            for (let j = 1; j <= 4; j++) { const rr = px * (2.5 + j * (3 + u * 4)), jit = (((k * 7 + j * 13) % 5) - 2) * 0.12; xx = x + Math.cos(an + jit) * rr; yy = cy + Math.sin(an + jit) * rr * 0.62; ctx.lineTo(xx, yy); } ctx.stroke(); }
          { const al = Math.max(0, 1 - u); ctx.strokeStyle = `rgba(40,60,160,${0.85 * al})`; ctx.lineWidth = Math.max(2, px * 0.5); const gy = y; for (let k = 0; k < 6; k++) { const an = k / 6 * 6.283 + 0.2, r1 = px * (3 + Math.min(1, u * 3) * 7); ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + Math.cos(an) * r1 * 0.5, gy + Math.sin(an) * r1 * 0.12 + (k % 2 ? 2 : -2)); ctx.lineTo(x + Math.cos(an) * r1, gy + Math.sin(an) * r1 * 0.3); ctx.stroke(); } }
          ctx.shadowBlur = 0;
          if (u > 0.3) { const u2 = (u - 0.3) / 0.7, r2 = px * (4 + u2 * 22); ctx.strokeStyle = `rgba(150,175,255,${(1 - u2) * 0.9})`; ctx.lineWidth = Math.max(3, px * 1.2); ctx.beginPath(); ctx.ellipse(x, cy, r2, r2 * 0.62, 0, 0, 7); ctx.stroke(); }
        }
        for (let k = 0; k < (L2v ? 3 : 2); k++) { const uu = Math.min(1, u * 1.1 + k * 0.15), r1 = px * (3 + uu * (L2v ? 19 : 15)); ctx.strokeStyle = k % 2 ? `rgba(229,232,250,${(1 - uu)})` : `rgba(82,103,224,${(1 - uu)})`; ctx.lineWidth = Math.max(4, px * (1.8 - k * 0.4)); ctx.beginPath(); ctx.ellipse(x, cy, r1, r1 * 0.62, 0, 0, 7); ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'kgthread') {   // 影縫い：2人の足もとに濃いピンクの影。影どうしを、縫い目のついたピンクの糸がつなぐ（凸は糸が2本）
        const [, x, y, tx2, ty2, px0, el, lv] = f, px = Math.max(2.4, px0), al = Math.min(1, el * 3), L2v = lv >= 2;
        ctx.save();
        for (const [sx, sy] of [[x, y], [tx2, ty2]]) { const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, px * 4.5); g.addColorStop(0, `rgba(120,0,70,${0.45 * al})`); g.addColorStop(0.7, `rgba(232,0,138,${0.28 * al})`); g.addColorStop(1, 'rgba(232,0,138,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy, px * 4.5, px * 1.7, 0, 0, 7); ctx.fill(); }
        const dx = tx2 - x, dy = ty2 - y, dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
        for (let w = 0; w < (L2v ? 2 : 1); w++) {
          const off = L2v ? (w ? 1 : -1) * px * 0.5 : 0, wav = Math.sin(simT * 6 + w) * px * 0.35;
          ctx.strokeStyle = `rgba(255,51,172,${0.95 * al})`; ctx.lineWidth = Math.max(1.6, px * 0.45); ctx.shadowColor = 'rgba(255,51,172,0.9)'; ctx.shadowBlur = px * 1.5;
          ctx.beginPath(); ctx.moveTo(x + nx * off, y + ny * off); ctx.quadraticCurveTo((x + tx2) / 2 + nx * (off + wav), (y + ty2) / 2 + ny * (off + wav) + px * 0.6, tx2 + nx * off, ty2 + ny * off); ctx.stroke();
          ctx.shadowBlur = 0; ctx.strokeStyle = `rgba(255,224,243,${0.9 * al})`; ctx.lineWidth = Math.max(1.2, px * 0.3);
          const n = Math.max(2, Math.floor(dl / (px * 3))); for (let k = 1; k < n; k++) { const u = k / n, cx = x + dx * u + nx * off, cy = y + dy * u + ny * off + Math.sin(Math.PI * u) * px * 0.3, ss = px * 0.55; ctx.beginPath(); ctx.moveTo(cx - ss, cy - ss * 0.6); ctx.lineTo(cx + ss, cy + ss * 0.6); ctx.moveTo(cx + ss, cy - ss * 0.6); ctx.lineTo(cx - ss, cy + ss * 0.6); ctx.stroke(); }   // 縫い目（×）
        }
        ctx.restore();
      } else if (f[0] === 'kgpin') {   // 影縫い（凸）：相手の足もとに光の針が4本刺さり、影が地面に縫いつけられる
        const [, x, y, px0, u] = f, px = Math.max(2.4, px0) * 1.2, al = u < 0.8 ? 1 : (1 - u) / 0.2, drop = Math.min(1, u / 0.15);
        ctx.save();
        { const g = ctx.createRadialGradient(x, y, 0, x, y, px * 5); g.addColorStop(0, `rgba(90,0,55,${0.75 * al})`); g.addColorStop(1, 'rgba(232,0,138,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, px * 5, px * 1.9, 0, 0, 7); ctx.fill(); }
        if (u < 0.25) { const fl = 1 - u / 0.25; ctx.strokeStyle = `rgba(255,224,243,${fl})`; ctx.lineWidth = Math.max(3, px); ctx.beginPath(); ctx.ellipse(x, y, px * (2 + (1 - fl) * 7), px * (0.8 + (1 - fl) * 2.6), 0, 0, 7); ctx.stroke(); }
        for (let k = 0; k < 4; k++) { const an = k / 4 * 6.283 + 0.785, sx = x + Math.cos(an) * px * 3.4, sy = y + Math.sin(an) * px * 1.3, len = px * 8, fall = px * 14 * (1 - drop), bot = sy - fall;
          ctx.strokeStyle = `rgba(255,51,172,${al})`; ctx.lineWidth = Math.max(3, px * 0.9); ctx.shadowColor = 'rgba(255,51,172,1)'; ctx.shadowBlur = px * 3; ctx.beginPath(); ctx.moveTo(sx + px * 0.8, bot - len); ctx.lineTo(sx, bot); ctx.stroke();
          ctx.shadowBlur = 0; ctx.strokeStyle = `rgba(255,224,243,${al})`; ctx.lineWidth = Math.max(1.5, px * 0.35); ctx.beginPath(); ctx.moveTo(sx + px * 0.8, bot - len); ctx.lineTo(sx, bot); ctx.stroke();
          ctx.fillStyle = `rgba(255,224,243,${al})`; ctx.beginPath(); ctx.arc(sx + px * 0.8, bot - len, Math.max(2, px * 0.6), 0, 7); ctx.fill();
          if (drop >= 1) { ctx.strokeStyle = `rgba(255,51,172,${0.8 * al})`; ctx.lineWidth = Math.max(1.5, px * 0.4); ctx.beginPath(); ctx.ellipse(sx, sy, px * 1.2, px * 0.45, 0, 0, 7); ctx.stroke(); } }   // 刺さった所に小さな輪
        ctx.restore();
      } else if (f[0] === 'kgsew') {   // 影縫い（凸）：縫い止める瞬間、ひがしから相手へ光る糸がピンと張る
        const [, x, y, tx2, ty2, px0, u] = f, px = Math.max(2.4, px0), al = 1 - u;
        ctx.save(); ctx.strokeStyle = `rgba(255,224,243,${al})`; ctx.lineWidth = Math.max(2.5, px * 0.8); ctx.shadowColor = 'rgba(255,51,172,1)'; ctx.shadowBlur = px * 3; ctx.beginPath(); ctx.moveTo(x, y - px * 2); ctx.lineTo(tx2, ty2); ctx.stroke(); ctx.restore();
      } else if (f[0] === 'sdspark') {   // 紫電の遊戯：足もとで紅い電気がパチパチ（ボールを持って仕掛けている間）
        const [, x, y, px0, lv] = f, px = Math.max(2.4, px0);
        ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(255,112,112,1)'; ctx.shadowBlur = px * 2;
        for (let k = 0; k < (lv >= 2 ? 4 : 3); k++) { const seed = Math.floor(simT * 14) + k * 7, an = (seed * 2.399) % 6.283, r0 = px * 1.2, r1 = px * (3 + (seed % 3)); ctx.strokeStyle = k % 2 ? 'rgba(255,224,224,0.95)' : 'rgba(255,112,112,0.95)'; ctx.lineWidth = Math.max(1.5, px * 0.45);
          ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0 * 0.5 - px); for (let j = 1; j <= 3; j++) { const rr = r0 + (r1 - r0) * j / 3, jt = ((seed + j) % 3 - 1) * 0.35; ctx.lineTo(x + Math.cos(an + jt) * rr, y + Math.sin(an + jt) * rr * 0.5 - px); } ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'sdaura') {   // 紫電の遊戯（凸）：体じゅうを紅い電気がはい回り、まわりがぼうっと光る
        const [, x, y, px0, top] = f, px = Math.max(2.4, px0), hgt = y - top, cy = y - hgt * 0.5;
        ctx.save(); const gr = ctx.createRadialGradient(x, cy, 0, x, cy, px * 8); gr.addColorStop(0, 'rgba(255,150,150,0.45)'); gr.addColorStop(1, 'rgba(255,112,112,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, cy, px * 6, px * 8.5, 0, 0, 7); ctx.fill();
        ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(255,112,112,1)'; ctx.shadowBlur = px * 2.5;
        for (let k = 0; k < 3; k++) { const seed = Math.floor(simT * 18) + k * 11, side = k % 2 ? 1 : -1; ctx.strokeStyle = k === 1 ? 'rgba(255,240,240,0.95)' : 'rgba(255,112,112,0.95)'; ctx.lineWidth = Math.max(1.5, px * 0.45); ctx.beginPath();
          for (let j = 0; j <= 5; j++) { const yy = y - hgt * 1.05 * j / 5, xx = x + side * px * (2.2 + ((seed + j * 7) % 5) * 0.45) * (j % 2 ? 1 : 0.6); j ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'sdzap') {   // 紫電の遊戯：抜いた瞬間、紅い稲妻がはじける（凸は大きく、二重）
        const [, x, y, px0, u, lv] = f, px = Math.max(2.4, px0) * (lv >= 2 ? 1.4 : 1.15), al = 1 - u, cy = y - px * 3;
        ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(255,112,112,1)'; ctx.shadowBlur = px * 3;
        if (u < 0.3) { const g = ctx.createRadialGradient(x, cy, 0, x, cy, px * 7); g.addColorStop(0, `rgba(255,240,240,${0.9 * (1 - u / 0.3)})`); g.addColorStop(1, 'rgba(255,112,112,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, cy, px * 7, 0, 7); ctx.fill(); }
        if (lv >= 2 && u < 0.45) {   // 凸：抜いた瞬間、空から紅い稲妻が落ちて、足もとに衝撃の輪
          const a2 = 1 - u / 0.45; ctx.strokeStyle = `rgba(255,240,240,${a2})`; ctx.lineWidth = Math.max(3, px * 0.9); ctx.beginPath(); let yy = cy - px * 26, xx = x + px * 2; ctx.moveTo(xx, yy);
          for (let j = 1; j <= 6; j++) { yy += px * 26 / 6 + px * 0.5; xx = x + (j % 2 ? -1 : 1) * px * (1.5 + (j % 3) * 0.6); ctx.lineTo(xx, Math.min(yy, y)); } ctx.stroke();
          ctx.strokeStyle = `rgba(255,112,112,${a2})`; ctx.lineWidth = Math.max(3, px * 1.1); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + (1 - a2) * 10), px * (1.2 + (1 - a2) * 3.6), 0, 0, 7); ctx.stroke();
        }
        for (let k = 0; k < (lv >= 2 ? 9 : 6); k++) { const an = k / (lv >= 2 ? 9 : 6) * 6.283 + 0.4; ctx.strokeStyle = k % 2 ? `rgba(255,224,224,${al})` : `rgba(255,112,112,${al})`; ctx.lineWidth = Math.max(2, px * 0.6); ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * px * 1.5, cy + Math.sin(an) * px);
          for (let j = 1; j <= 4; j++) { const rr = px * (1.5 + j * (2 + u * 3)), jt = (((k * 5 + j * 3) % 5) - 2) * 0.13; ctx.lineTo(x + Math.cos(an + jt) * rr, cy + Math.sin(an + jt) * rr * 0.62); } ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'mtstar') {   // 祭り太鼓の壁：体がぶつかった所に、白と青の衝撃の星（凸は大きく、青い火花が飛ぶ）
        const [, x, y, px0, u, lv] = f, px = Math.max(2.4, px0) * 1.4, L2v = lv >= 2, R = px * (L2v ? 7 : 5.5) * (0.7 + u * 0.7), al = 1 - u * u;
        ctx.save(); ctx.fillStyle = `rgba(82,103,224,${0.9 * al})`; ctx.beginPath(); for (let k = 0; k < 16; k++) { const an = k / 16 * 6.283, rr = k % 2 ? R * 0.45 : R * 1.25; ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${al})`; ctx.beginPath(); for (let k = 0; k < 16; k++) { const an = k / 16 * 6.283 + 0.2, rr = k % 2 ? R * 0.25 : R * 0.75; ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } ctx.closePath(); ctx.fill();
        if (L2v) for (let k = 0; k < 8; k++) { const an = k / 8 * 6.283 + 0.4, rr = R * (1.2 + u * 1.6); ctx.fillStyle = `rgba(${k % 2 ? '255,255,255' : '150,175,255'},${al})`; ctx.fillRect(x + Math.cos(an) * rr - 2, y + Math.sin(an) * rr - 2, 4, 4); }
        ctx.restore();
      } else if (f[0] === 'mtslow') {   // 祭り太鼓の壁（凸）：足が重くなった相手。足もとで脈打つ青い輪と、沈んでいく青い光
        const [, x, y, px0, top, u] = f, px = Math.max(2.4, px0) * 1.3, al = Math.min(1, (1 - u) * 3), hgt = y - top;
        ctx.save(); const pu = (simT * 2.2) % 1; ctx.strokeStyle = `rgba(82,103,224,${0.9 * al})`; ctx.lineWidth = Math.max(2.5, px * 0.8); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + (1 - pu) * 3), px * (1.1 + (1 - pu) * 1.1), 0, 0, 7); ctx.stroke();
        for (let k = 0; k < 6; k++) { const ph = (simT * 1.4 + k * 0.37) % 1, ox = Math.sin(k * 2.1) * px * 2.6; ctx.fillStyle = `rgba(150,175,255,${(1 - ph) * 0.85 * al})`; ctx.fillRect(x + ox - 1.5, top + ph * hgt - 1.5, 3, 3); }
        ctx.restore();
      } else if (f[0] === 'anchor') {   // 白亜の城壁：体を包む白いオーラ（立ちのぼる光の粒）と、足もとの白い輪。凸はオーラが大きく明るい
        const [, x, y, px0, top, u, lv] = f, px = Math.max(2.4, px0), L2v = lv >= 2, al = Math.min(1, (1 - u) * 2.5) * Math.min(1, u * 8 + 0.3), hgt = y - top, cy = y - hgt * 0.5;
        ctx.save();
        { const R0 = px * (L2v ? 11 : 9), gr = ctx.createRadialGradient(x, cy, 0, x, cy, R0); gr.addColorStop(0, `rgba(255,255,255,${0.9 * al})`); gr.addColorStop(0.5, `rgba(240,246,255,${0.55 * al})`); gr.addColorStop(1, 'rgba(235,242,255,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, cy, R0 * 0.8, R0 * 1.15, 0, 0, 7); ctx.fill(); }
        for (let k = 0; k < (L2v ? 14 : 9); k++) { const ph = (simT * 1.6 + k * 0.29) % 1, ox = Math.sin(k * 2.3) * px * 3.2, yy = y - ph * hgt * 1.6; ctx.fillStyle = `rgba(255,255,255,${(1 - ph) * 0.9 * al})`; ctx.fillRect(x + ox - 1.5, yy - 1.5, 3, 3); }   // 立ちのぼる白い光の粒
        for (let k = 0; k < (L2v ? 2 : 1); k++) { const uu = Math.min(1, u * 1.3 + k * 0.2); ctx.strokeStyle = `rgba(255,255,255,${(1 - uu) * 0.9})`; ctx.lineWidth = Math.max(2.5, px * 0.8); ctx.beginPath(); ctx.ellipse(x, y, px * (3.5 + uu * 8), px * (1.3 + uu * 3), 0, 0, 7); ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'wave') {   // 桜島の号令：号令をかけた瞬間、ミントの波紋
        const [, x, y, px0, u] = f, px = Math.max(2.4, px0);
        for (let k = 0; k < 3; k++) { const uu = (u + k * 0.22) % 1; ctx.strokeStyle = `rgba(124,255,196,${(1 - uu) * 0.9})`; ctx.lineWidth = Math.max(2.5, px * 0.9); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + uu * 16), px * (1.2 + uu * 6), 0, 0, 7); ctx.stroke(); }
      }
    });
    tactFx.forEach((f) => {
      if (f[0] === 'run') {   // 走り出すコース：金色の光の点線と、行き先の矢じり（はっきり見える太さ）
        const [, x, y, tx, ty, u, px0] = f, px = Math.max(2.6, px0), al = Math.min(1, (1 - u) * 1.8);
        ctx.save(); ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(255,200,60,${0.45 * al})`; ctx.lineWidth = px * 3.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.setLineDash([px * 3, px * 2]); ctx.lineDashOffset = -simT * px * 18;
        ctx.strokeStyle = `rgba(255,250,215,${al})`; ctx.lineWidth = px * 1.3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.setLineDash([]); const ang = Math.atan2(ty - y, tx - x), hl = px * 5;
        ctx.fillStyle = `rgba(255,214,70,${al})`; ctx.strokeStyle = `rgba(90,60,10,${al})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(tx + Math.cos(ang) * px, ty + Math.sin(ang) * px); ctx.lineTo(tx - Math.cos(ang - 0.55) * hl, ty - Math.sin(ang - 0.55) * hl); ctx.lineTo(tx - Math.cos(ang + 0.55) * hl, ty - Math.sin(ang + 0.55) * hl); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      } else if (f[0] === 'hrthread') {   // 針の穴通し：ボールが通った道すじに金の糸。まわりに縫い目のように絡む細い糸、糸の先（ボール）で針がきらり
        const [, pts, el, d, px0, lv] = f, px = Math.max(2.4, px0), al = Math.max(0, Math.min(1, (d - el) / 0.45, el / 0.05));
        if (pts.length >= 2) {
          const path = (w, c, off) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); let acc = 0;
            for (let k = 0; k < pts.length; k++) { let [x, y] = pts[k];
              if (off) { const a2 = pts[Math.max(0, k - 1)], b2 = pts[Math.min(pts.length - 1, k + 1)], nx = -(b2[1] - a2[1]), ny = b2[0] - a2[0], nl = Math.hypot(nx, ny) || 1; if (k) acc += Math.hypot(x - pts[k - 1][0], y - pts[k - 1][1]); const o = Math.sin(acc / (px * 2.2) + off.ph) * px * off.amp * Math.min(1, k / 3); x += nx / nl * o; y += ny / nl * o; }
              if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); };
          ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = al;
          if (lv >= 2) { path(px * 7, 'rgba(255,236,150,0.22)'); path(px * 4.2, 'rgba(255,246,200,0.35)'); }   // 凸：糸のまわりがまぶしく光る
          path(px * 2.6, 'rgba(74,56,6,0.55)'); path(px * 1.4, lv >= 2 ? 'rgba(255,240,160,1)' : 'rgba(255,226,110,0.95)'); path(px * 0.5, '#fffdf0');
          path(px * 0.55, 'rgba(255,248,200,0.95)', { amp: 1.5, ph: -simT * 9 });   // 縫い目のように絡みつく細い糸
          if (lv >= 2) path(px * 0.5, 'rgba(255,236,160,0.9)', { amp: 1.5, ph: -simT * 9 + Math.PI });
          if (lv >= 2) { ctx.fillStyle = '#ffffff'; for (let k = 0; k < 14; k++) { const u = (k / 14 + el * 2.4) % 1, i0 = Math.min(pts.length - 1, Math.floor(u * (pts.length - 1))), [sx, sy] = pts[i0], o = Math.sin(k * 7.3 + el * 10) * px * 2.5, sz = px * (0.6 + (k % 3) * 0.35);   // 凸：糸に沿って光の粒が舞う
              ctx.globalAlpha = al * (0.5 + 0.5 * Math.sin(el * 18 + k)); ctx.fillRect(sx + o - sz / 2, sy - Math.abs(o) * 0.5 - sz / 2, sz, sz); } ctx.globalAlpha = al; }
          const [hx, hy] = pts[pts.length - 1], g = px * (2.6 + Math.sin(el * 22) * 0.8) * (lv >= 2 ? 1.8 : 1);   // 針の先のきらめき（4方向の星）
          ctx.fillStyle = '#fffbe0'; ctx.beginPath(); ctx.moveTo(hx, hy - g * 1.6); ctx.lineTo(hx + g * 0.3, hy - g * 0.3); ctx.lineTo(hx + g * 1.6, hy); ctx.lineTo(hx + g * 0.3, hy + g * 0.3); ctx.lineTo(hx, hy + g * 1.6); ctx.lineTo(hx - g * 0.3, hy + g * 0.3); ctx.lineTo(hx - g * 1.6, hy); ctx.lineTo(hx - g * 0.3, hy - g * 0.3); ctx.closePath(); ctx.fill();
          if (el < 0.4) { const u = el / 0.4, [x0, y0] = pts[0]; ctx.strokeStyle = `rgba(255,236,150,${1 - u})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.beginPath(); ctx.ellipse(x0, y0, px * (2 + u * 6), px * (0.8 + u * 2.4), 0, 0, 7); ctx.stroke(); }   // 出した瞬間の輪
          ctx.restore(); }
      } else if (f[0] === 'bycalm') {   // 白夜：足もとから白い光の輪が大きく広がり、まわりに白い光の粒（凸は二重・大きい）
        const [, x, y, top, px0, u, lv] = f, px = Math.max(2.6, px0), a0 = Math.sin(Math.min(1, u) * Math.PI);
        for (let k = 0; k < (lv >= 2 ? 2 : 1); k++) { const uu = Math.min(1, u * 1.2 - k * 0.2); if (uu <= 0) continue; ctx.strokeStyle = `rgba(240,236,255,${(1 - uu) * 0.95})`; ctx.lineWidth = Math.max(3, px * 1.2);
          ctx.beginPath(); ctx.ellipse(x, y, px * (4 + uu * (lv >= 2 ? 38 : 28)), px * (1.6 + uu * (lv >= 2 ? 14 : 10)), 0, 0, 7); ctx.stroke(); }
        ctx.fillStyle = `rgba(230,226,255,${0.32 * a0})`; ctx.beginPath(); ctx.ellipse(x, y, px * 14, px * 5, 0, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,255,255,${0.5 * a0})`; ctx.fillRect(x - px * 0.6, top - px * 14, px * 1.2, px * 14);   // 白い光の柱
        ctx.fillStyle = `rgba(255,255,255,${0.9 * a0})`; for (let k = 0; k < (lv >= 2 ? 12 : 7); k++) { const an = k * 2.4 + u * 3, rr = px * (4 + (k % 3) * 2 + u * 6); ctx.fillRect(x + Math.cos(an) * rr - px * 0.4, y - px * 6 + Math.sin(an) * rr * 0.5 - px * 0.4, px * 0.8, px * 0.8); }
      } else if (f[0] === 'bytrail') {   // 白夜のロングフィード：ボールが白い光の尾を引いて大きな弧を描く（凸は太く、光の粒が舞う）
        const [, pts, el, d, px0, lv, ended] = f, px = Math.max(2.4, px0), al = Math.max(0, Math.min(1, (d - el) / 0.6, el / 0.05)) * (ended >= 0 ? Math.max(0, 1 - ended / 0.4) : 1);
        if (pts.length >= 2) { const n = pts.length, from = Math.max(0, n - 14);
          ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          for (let k = from + 1; k < n; k++) { const w = (k - from) / (n - from); ctx.strokeStyle = `rgba(236,232,255,${al * w * 0.9})`; ctx.lineWidth = px * (lv >= 2 ? 3.6 : 2.6) * w + 1.5; ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke(); }
          for (let k = from + 1; k < n; k++) { const w = (k - from) / (n - from); ctx.strokeStyle = `rgba(150,120,240,${al * w * 0.5})`; ctx.lineWidth = Math.max(1, px * 0.5 * w); ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1] + px * 0.6); ctx.lineTo(pts[k][0], pts[k][1] + px * 0.6); ctx.stroke(); }
          if (lv >= 2) { ctx.fillStyle = '#ffffff'; for (let k = 0; k < 8; k++) { const i0 = Math.max(from, n - 1 - Math.floor((k / 8) * (n - from))), [sx, sy] = pts[i0], o = Math.sin(k * 5.1 + el * 9) * px * 2; ctx.globalAlpha = al * 0.8; ctx.fillRect(sx + o - px * 0.4, sy + o * 0.4 - px * 0.4, px * 0.8, px * 0.8); } ctx.globalAlpha = 1; }
          ctx.restore(); }
      } else if (f[0] === 'ksrun') {   // 金鯱の心臓：金色の残像（走ってきた方へ3つ、だんだん薄く）と足もとの金の火花（凸は残像が多い）
        const [, x, y, dx, dy, top, px0, lv, def] = f, px = Math.max(2.4, px0), h = y - top;
        const dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
        for (let k = (lv >= 2 ? 4 : 3); k >= 1; k--) { const ox = x + dx * k * 1.6, oy = y + dy * k * 1.6, a = 0.55 / k; ctx.strokeStyle = def ? `rgba(255,140,20,${a})` : `rgba(255,200,40,${a})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.beginPath(); ctx.ellipse(ox, oy - h * 0.5, px * 2.4, h * 0.55, 0, 0, 7); ctx.stroke(); }   // 金色の残像（輪郭）
        ctx.lineCap = 'round'; for (let k = 0; k < (lv >= 2 ? 4 : 3); k++) { const oy = y - h * (0.2 + k * 0.22), L2 = px * (8 + k * 2) * (lv >= 2 ? 1.3 : 1); ctx.strokeStyle = `rgba(255,236,150,${0.85 - k * 0.15})`; ctx.lineWidth = Math.max(1.5, px * 0.55); ctx.beginPath(); ctx.moveTo(x + ux * px * 2, oy + uy * px * 2); ctx.lineTo(x + ux * L2, oy + uy * L2); ctx.stroke(); }   // 走った後ろに金色の線
        ctx.fillStyle = 'rgba(255,230,120,0.9)'; for (let k = 0; k < 3; k++) { const ph = (simT * 6 + k * 0.33) % 1; ctx.fillRect(x + dx * ph * 2 - px * 0.4 + Math.sin(k * 3 + simT * 9) * px, y + dy * ph * 2 - px * 0.4, px * 0.8, px * 0.8); }
      } else if (f[0] === 'aoflash') {   // 蒼の王座の発動：足もとから太い青い光の輪が2重に弾け、青い光の柱と粒が舞い上がる
        const [, x, y, top, px0, u, lv] = f, px = Math.max(2.8, px0), a0 = Math.sin(Math.min(1, u) * Math.PI);
        ctx.save(); ctx.lineCap = 'round';
        for (let k = 0; k < (lv >= 2 ? 3 : 2); k++) { const uu = Math.min(1, u * 1.5 - k * 0.22); if (uu <= 0) continue; ctx.strokeStyle = `rgba(40,140,255,${(1 - uu) * 1})`; ctx.lineWidth = Math.max(4, px * 1.8) * (1 - uu * 0.5); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + uu * 22), px * (1.2 + uu * 8), 0, 0, 7); ctx.stroke();
          ctx.strokeStyle = `rgba(210,235,255,${(1 - uu) * 0.9})`; ctx.lineWidth = Math.max(1.5, px * 0.6); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + uu * 22), px * (1.2 + uu * 8), 0, 0, 7); ctx.stroke(); }
        const g = ctx.createLinearGradient(0, y, 0, y - px * 30); g.addColorStop(0, `rgba(60,150,255,${0.75 * a0})`); g.addColorStop(1, 'rgba(60,150,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - px * 2.2, y - px * 30, px * 4.4, px * 30);
        ctx.fillStyle = `rgba(220,240,255,${a0})`; for (let k = 0; k < (lv >= 2 ? 16 : 11); k++) { const an = k * 2.3 + u * 5, rr = px * (3 + (k % 4) * 1.6 + u * 6), hh = px * (2 + ((k * 7) % 5) * 3 + u * 14); ctx.fillRect(x + Math.cos(an) * rr - px * 0.5, y - hh - px * 0.5, px, px); }
        ctx.restore();
      } else if (f[0] === 'aothrone') {   // 蒼の王座：縦パスを受けに落ちてくる・キープ中は、足もとに太い青い輪（脈打つ）と、まわりを回る青い光の粒
        const [, x, y, top, px0, lv, el] = f, px = Math.max(2.8, px0), pu = 0.6 + 0.4 * Math.sin(el * 8);
        ctx.save(); ctx.fillStyle = `rgba(40,130,255,${0.22 * pu})`; ctx.beginPath(); ctx.ellipse(x, y, px * 7, px * 2.6, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(40,140,255,${0.95 * pu})`; ctx.lineWidth = Math.max(3, px * 1.2); ctx.beginPath(); ctx.ellipse(x, y, px * 7, px * 2.6, 0, 0, 7); ctx.stroke();
        if (lv >= 2) { ctx.strokeStyle = `rgba(170,215,255,${0.8 * pu})`; ctx.lineWidth = Math.max(2, px * 0.7); ctx.beginPath(); ctx.ellipse(x, y, px * 9.5, px * 3.5, 0, 0, 7); ctx.stroke(); }
        ctx.fillStyle = 'rgba(200,232,255,0.95)'; for (let k = 0; k < 6; k++) { const an = el * 3 + k * Math.PI / 3; ctx.fillRect(x + Math.cos(an) * px * 7 - px * 0.5, y + Math.sin(an) * px * 2.6 - px * 0.5 - px * 1.2 * Math.abs(Math.sin(el * 4 + k)), px, px); }
        ctx.restore();
      } else if (f[0] === 'aotrail') {   // 蒼の王座のスルーパス：ボールが青い光の尾を引いて、DFラインの裏へ
        const [, pts, el, d, px0, lv, ended] = f, px = Math.max(2.4, px0), al = Math.max(0, Math.min(1, (d - el) / 0.6, el / 0.05)) * (ended >= 0 ? Math.max(0, 1 - ended / 0.4) : 1);
        if (pts.length >= 2) { const n = pts.length, from = Math.max(0, n - 14); ctx.save(); ctx.lineCap = 'round';
          for (let k = from + 1; k < n; k++) { const w = (k - from) / (n - from); ctx.strokeStyle = `rgba(110,185,255,${al * w * 0.95})`; ctx.lineWidth = px * (lv >= 2 ? 3.4 : 2.6) * w + 1.5; ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke(); }
          for (let k = from + 1; k < n; k++) { const w = (k - from) / (n - from); ctx.strokeStyle = `rgba(30,90,220,${al * w * 0.6})`; ctx.lineWidth = Math.max(1, px * 0.6 * w); ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1] + px * 0.6); ctx.lineTo(pts[k][0], pts[k][1] + px * 0.6); ctx.stroke(); }
          ctx.restore(); }
      } else if (f[0] === 'upull') {   // 釣られた・引っぱられたDF：足もとに色の輪と、本人へ向かう点線（ついて行っているのが分かる）
        const [, x, y, x2, y2, rgb, px0, u] = f, px = Math.max(2.4, px0), al = Math.min(1, u * 8, (1 - u) * 4);
        ctx.save(); ctx.strokeStyle = `rgba(${rgb},${0.9 * al})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.setLineDash([px * 1.6, px * 1.2]); ctx.lineDashOffset = -simT * px * 8;
        ctx.beginPath(); ctx.moveTo(x, y - px * 0.5); ctx.lineTo(x2, y2 - px * 0.5); ctx.stroke(); ctx.setLineDash([]);
        ctx.lineWidth = Math.max(2, px * 0.7); ctx.beginPath(); ctx.ellipse(x, y, px * 3.2, px * 1.1, 0, 0, 7); ctx.stroke(); ctx.restore();
      } else if (f[0] === 'mdfire') {   // 翠の起点の発動：足もとから翠の輪が弾け、若葉のような粒が舞い上がる
        const [, x, y, px1, u, lv] = f, px = Math.max(2.6, px1) * 1.6, a0 = 1 - u;
        ctx.save(); ctx.strokeStyle = `rgba(0,168,74,${0.95 * a0})`; ctx.lineWidth = Math.max(3, px * 1.2); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + u * 11), px * (1.1 + u * 3.8), 0, 0, 7); ctx.stroke();
        ctx.strokeStyle = `rgba(160,255,200,${0.8 * a0})`; ctx.lineWidth = Math.max(1.5, px * 0.5); ctx.beginPath(); ctx.ellipse(x, y, px * (2 + u * 7), px * (0.8 + u * 2.4), 0, 0, 7); ctx.stroke();
        for (let k = 0; k < (lv >= 2 ? 12 : 8); k++) { const an = k * 2.1 + u * 2, rr = px * (1.5 + u * 7 + (k % 3)), hh = px * (1 + ((k * 7) % 5) * 1.6 + u * 9); ctx.fillStyle = k % 2 ? `rgba(51,255,141,${a0})` : `rgba(224,255,238,${a0})`; ctx.fillRect(x + Math.cos(an) * rr - px * 0.45, y - hh, px * 0.9, px * 0.9); }
        ctx.restore();
      } else if (f[0] === 'mdfree') {   // 翠の起点でフリーで受けた味方：足もとに翠の二重の輪（前を向いて落ち着いてプレーできる）
        const [, x, y, px0, el, d, lv] = f, px = Math.max(2.6, px0), fade = Math.min(1, el / 0.15, (d - el) / 0.4), ph = (simT * 1.5) % 1;
        ctx.save(); ctx.strokeStyle = `rgba(51,255,141,${0.9 * fade})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.beginPath(); ctx.ellipse(x, y, px * 3.4, px * 1.2, 0, 0, 7); ctx.stroke();
        ctx.strokeStyle = `rgba(0,168,74,${0.8 * fade * (1 - ph)})`; ctx.lineWidth = Math.max(1.5, px * 0.6); ctx.beginPath(); ctx.ellipse(x, y, px * (3.4 + ph * 4), px * (1.2 + ph * 1.4), 0, 0, 7); ctx.stroke(); ctx.restore();
      } else if (f[0] === 'mdbuff') {   // 版467 翠の起点の積み重ね：味方の足もとに緑の光が広がり、積み重ねの数だけ緑の粒が立ちのぼる（MAXは金色まじり）
        const [, x, y, px0, el, d, k, mx] = f, px = Math.max(2.4, px0), u = el / d, fade = Math.min(1, el / 0.15, (d - el) / 0.5);
        ctx.save();
        const g = ctx.createRadialGradient(x, y, 0, x, y, px * 5); g.addColorStop(0, `rgba(80,255,150,${0.55 * fade})`); g.addColorStop(1, 'rgba(80,255,150,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, px * (3 + u * 3), px * (1.1 + u * 1.1), 0, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(51,235,130,${0.95 * fade})`; ctx.lineWidth = Math.max(1.6, px * 0.55); ctx.beginPath(); ctx.ellipse(x, y, px * (2.4 + u * 4), px * (0.85 + u * 1.4), 0, 0, 7); ctx.stroke();
        for (let j = 0; j < k * 2; j++) { const a2 = j / (k * 2) * 6.283 + el * 2, rr = px * 2.6, yy = y - px * (1 + ((el * 1.3 + j * 0.37) % 1) * 9);
          ctx.fillStyle = mx && j % 2 ? `rgba(255,226,58,${fade})` : `rgba(140,255,190,${fade})`; ctx.fillRect(x + Math.cos(a2) * rr - px * 0.35, yy, px * 0.7, px * 0.7); }
        ctx.restore();
      } else if (f[0] === 'mdguard') {   // 翠の起点で組み立てている間、守備の形を保つDF：足もとに淡い翠の弧（盾）
        const [, x, y, px0, el, d] = f, px = Math.max(2.4, px0), fade = Math.min(1, el / 0.3, (d - el) / 0.3) * 0.55;
        ctx.save(); ctx.strokeStyle = `rgba(51,235,130,${fade})`; ctx.lineWidth = Math.max(1.5, px * 0.6); ctx.beginPath(); ctx.ellipse(x, y, px * 3, px * 1.05, 0, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); ctx.restore();
      } else if (f[0] === 'mdlure') {   // 翠の起点：晒している間、外から足もとへ吸い寄せられていく翠の輪（相手を誘い込む）
        const [, x, y, px0, el, d, lv] = f, px = Math.max(2.6, px0), fade = Math.min(1, el / 0.2, (d - el) / 0.3);
        ctx.save(); for (let k = 0; k < (lv >= 2 ? 3 : 2); k++) { const ph = 1 - ((el * 0.9 + k / (lv >= 2 ? 3 : 2)) % 1), al = fade * (1 - ph) * 0.9; ctx.strokeStyle = `rgba(51,235,130,${al})`; ctx.lineWidth = Math.max(2, px * 0.7); ctx.beginPath(); ctx.ellipse(x, y, px * (3.2 + ph * 9), px * (1.1 + ph * 3.1), 0, 0, 7); ctx.stroke(); }
        ctx.strokeStyle = `rgba(0,168,74,${0.85 * fade})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.beginPath(); ctx.ellipse(x, y, px * 3, px * 1.05, 0, 0, 7); ctx.stroke(); ctx.restore();
      } else if (f[0] === 'kmfire') {   // 影からの一撃の発動：足もとから黒い影がふわっと広がり、銀の粒が散る
        const [, x, y, px1, u, lv] = f, px = Math.max(2.6, px1) * 1.6, a0 = Math.sin(Math.min(1, u) * Math.PI);
        ctx.save(); ctx.fillStyle = `rgba(20,24,32,${0.45 * a0})`; ctx.beginPath(); ctx.ellipse(x, y, px * (3 + u * 9), px * (1.1 + u * 3.2), 0, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(200,206,216,${0.9 * (1 - u)})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + u * 12), px * (1.1 + u * 4.2), 0, 0, 7); ctx.stroke();
        ctx.fillStyle = `rgba(225,230,238,${a0})`; for (let k = 0; k < (lv >= 2 ? 14 : 10); k++) { const an = k * 2.4 + u * 3, rr = px * (2 + u * 9 + (k % 3)), hh = px * (1 + ((k * 5) % 4) * 2 + u * 8); ctx.fillRect(x + Math.cos(an) * rr - px * 0.45, y - hh, px * 0.9, px * 0.9); }
        ctx.restore();
      } else if (f[0] === 'kmshade') {   // 影からの一撃：飛び込む間、銀色の残像（気配が消えている）
        const [, x, y, gh, px0, el, d] = f, px = Math.max(2.6, px0), al = Math.min(1, el / 0.2, (d - el) / 0.4);
        ctx.save(); for (let g = gh.length - 1; g >= 0; g--) { const [gx, gy] = gh[g], aa = al * (0.62 - g * 0.12); if (aa <= 0) continue; const S2 = px * 2.1; ctx.fillStyle = `rgba(30,34,44,${aa * 0.85})`; ctx.beginPath(); ctx.ellipse(gx, gy - S2 * 4.6, S2 * 2.4, S2 * 4.8, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(gx, gy - S2 * 10.4, S2 * 2.3, 0, 7); ctx.fill(); ctx.strokeStyle = `rgba(205,212,222,${aa})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.beginPath(); ctx.ellipse(gx, gy - S2 * 4.6, S2 * 2.4, S2 * 4.8, 0, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(gx, gy - S2 * 10.4, S2 * 2.3, 0, 7); ctx.stroke(); }
        ctx.fillStyle = `rgba(20,24,32,${0.5 * al})`; ctx.beginPath(); ctx.ellipse(x, y, px * 4, px * 1.4, 0, 0, 7); ctx.fill(); ctx.strokeStyle = `rgba(200,206,216,${0.8 * al})`; ctx.lineWidth = Math.max(1.5, px * 0.6); ctx.beginPath(); ctx.ellipse(x, y, px * 4, px * 1.4, 0, 0, 7); ctx.stroke(); ctx.restore();
      } else if (f[0] === 'kmshot') {   // 影からの一撃のシュート：銀の閃光
        const [, x, y, px1, u] = f, px = Math.max(2.6, px1) * 1.8, a0 = 1 - u;
        ctx.save(); ctx.strokeStyle = `rgba(230,236,245,${a0})`; ctx.lineWidth = Math.max(2, px * 0.9); for (let k = 0; k < 8; k++) { const an = k * Math.PI / 4 + 0.3, r1 = px * (1.5 + u * 3), r2 = px * (4 + u * 9); ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r1, y - px * 3 + Math.sin(an) * r1 * 0.6); ctx.lineTo(x + Math.cos(an) * r2, y - px * 3 + Math.sin(an) * r2 * 0.6); ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'ttgate') {   // 鉄狼の関所の発動：左右から鋼色の門柱が立ち、上の横木が「ガシャン」と閉じる
        const [, x, y, px1, u, lv] = f, px = Math.max(2.6, px1) * 2, w = px * (lv >= 2 ? 10 : 8.5), hgt = px * 10, k0 = Math.min(1, u / 0.25), al = u < 0.7 ? 1 : (1 - u) / 0.3;
        ctx.save(); const off = w * (1.6 - 0.6 * k0);
        for (const sd of [-1, 1]) { const gx = x + sd * off; ctx.fillStyle = `rgba(108,127,156,${0.9 * al})`; ctx.fillRect(gx - px * 0.9, y - hgt, px * 1.8, hgt); ctx.fillStyle = `rgba(210,222,240,${0.8 * al})`; ctx.fillRect(gx - px * 0.9, y - hgt, px * 0.6, hgt); }
        if (k0 >= 1) { ctx.fillStyle = `rgba(108,127,156,${0.9 * al})`; ctx.fillRect(x - off - px, y - hgt - px * 1.6, off * 2 + px * 2, px * 1.6); ctx.strokeStyle = `rgba(230,238,250,${al})`; ctx.lineWidth = Math.max(1.5, px * 0.5); ctx.strokeRect(x - off - px, y - hgt - px * 1.6, off * 2 + px * 2, px * 1.6); }
        ctx.strokeStyle = `rgba(108,127,156,${0.8 * al})`; ctx.lineWidth = Math.max(2, px * 0.8); ctx.beginPath(); ctx.ellipse(x, y, off, px * 2.4, 0, 0, 7); ctx.stroke(); ctx.restore();
      } else if (f[0] === 'ttsteal') {   // 鉄狼の関所：奪った瞬間、鋼色の輪が弾け、牙のような光が走る
        const [, x, y, px1, u, lv] = f, px = Math.max(2.6, px1) * 1.8, a0 = 1 - u;
        ctx.save(); ctx.strokeStyle = `rgba(108,127,156,${a0})`; ctx.lineWidth = Math.max(3, px * 1.3); ctx.beginPath(); ctx.ellipse(x, y, px * (3 + u * 10), px * (1.1 + u * 3.6), 0, 0, 7); ctx.stroke();
        ctx.strokeStyle = `rgba(225,235,250,${a0})`; ctx.lineWidth = Math.max(2, px * 0.8); for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + sd * px * 4, y - px * 9); ctx.lineTo(x + sd * px * 1.2, y - px * (4 - u * 2)); ctx.lineTo(x + sd * px * 3, y - px * 2); ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'ctrail') {   // 色つきの光の尾（鉄狼の関所の縦パスなど）
        const [, pts, el, d, px0, rgb, ended] = f, px = Math.max(2.4, px0), al = Math.max(0, Math.min(1, (d - el) / 0.6, el / 0.05)) * (ended >= 0 ? Math.max(0, 1 - ended / 0.4) : 1);
        if (pts.length >= 2) { const n = pts.length, from = Math.max(0, n - 12); ctx.save(); ctx.lineCap = 'round'; for (let k = from + 1; k < n; k++) { const w = (k - from) / (n - from); ctx.strokeStyle = `rgba(${rgb},${al * w * 0.95})`; ctx.lineWidth = px * 2.4 * w + 1.5; ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke(); } ctx.restore(); }
      } else if (f[0] === 'ring2') {   // 版838：技の瞬間に広がる色の輪（インターセプト：青、キャプテンシー：金）
        const [, x, y, px0, u, rgb, big] = f, px = Math.max(2.4, px0), rr = px * (3 + u * 9) * big;
        ctx.strokeStyle = `rgba(${rgb},${Math.max(0, 1 - u) * 0.95})`; ctx.lineWidth = Math.max(2, px * 0.9);
        ctx.beginPath(); ctx.ellipse(x, y - px * 0.5, rr, rr * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
        if (u < 0.5) { ctx.fillStyle = `rgba(${rgb},${(0.5 - u) * 0.5})`; ctx.beginPath(); ctx.ellipse(x, y - px * 0.5, rr * 0.7, rr * 0.3, 0, 0, Math.PI * 2); ctx.fill(); }
      } else if (f[0] === 'gbuf') {   // 版838：キャプテンシーの間、足もとにうっすら金の輪（キャプテンは濃く）
        const [, x, y, px0, el, d, cap] = f, px = Math.max(2.4, px0), fade = Math.min(1, el / 0.4, (d - el) / 2), ph = (simT * 1.2) % 1;
        ctx.strokeStyle = `rgba(255,208,70,${(cap ? 0.75 : 0.45) * fade * (0.6 + 0.4 * Math.sin(ph * Math.PI * 2))})`; ctx.lineWidth = Math.max(1.6, px * (cap ? 0.8 : 0.55));
        ctx.beginPath(); ctx.ellipse(x, y - px * 0.4, px * 4.2, px * 1.6, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (f[0] === 'pptgt') {   // 版838：ピンポイントクロスの落ちる所：金の的（だんだん小さく絞る）
        const [, x, y, px0, el, d] = f, px = Math.max(2.4, px0), u = Math.min(1, el / Math.max(0.6, d * 0.6)), rr = px * (7 - u * 3.5), al = Math.min(1, el / 0.15);
        ctx.save(); ctx.strokeStyle = `rgba(255,214,70,${0.9 * al})`; ctx.lineWidth = Math.max(1.8, px * 0.6);
        ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(x, y, rr * 0.45, rr * 0.19, 0, 0, Math.PI * 2); ctx.stroke();
        for (const s0 of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + s0 * rr * 1.25, y); ctx.lineTo(x + s0 * rr * 0.7, y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y + s0 * rr * 0.52); ctx.lineTo(x, y + s0 * rr * 0.3); ctx.stroke(); }
        ctx.restore();
      } else if (f[0] === 'urun') {   // 走り込む・入ってくる味方：足もとに色の風の線
        const [, x, y, rgb, px0, u] = f, px = Math.max(2.4, px0), al = Math.sin(Math.min(1, u) * Math.PI) * 0.6 + 0.3;
        ctx.strokeStyle = `rgba(${rgb},${0.85 * al})`; ctx.lineWidth = Math.max(1.5, px * 0.5);
        for (let k = 0; k < 4; k++) { const yy = y - px * (1 + k * 1.5), ph = (simT * 4 + k * 0.3) % 1; ctx.beginPath(); ctx.moveTo(x - px * (4 + ph * 5), yy); ctx.lineTo(x + px * (3 - ph * 2), yy); ctx.stroke(); }
      } else if (f[0] === 'byrun') {   // 白夜の視界の合図で裏へ走る味方：足もとに白い風の線（凸は多い）
        const [, x, y, px0, u, lv] = f, px = Math.max(2.4, px0), al = Math.sin(Math.min(1, u) * Math.PI);
        ctx.strokeStyle = `rgba(240,236,255,${0.8 * al})`; ctx.lineWidth = Math.max(1.5, px * 0.5);
        for (let k = 0; k < (lv >= 2 ? 5 : 3); k++) { const yy = y - px * (1 + k * 1.6), ph = (simT * 4 + k * 0.3) % 1; ctx.beginPath(); ctx.moveTo(x - px * (3 + ph * 4), yy); ctx.lineTo(x + px * (3 - ph * 2), yy); ctx.stroke(); }
      } else if (f[0] === 'bybuf') {   // 白夜のロングフィードを受けた味方：足もとに白い輪（凸は二重）
        const [, x, y, px0, lv, el, d] = f, px = Math.max(2.6, px0), fade = Math.min(1, (d - el) / 0.5), ph = (simT * 1.6) % 1;
        for (let k = 0; k < (lv >= 2 ? 2 : 1); k++) { const u = (ph + k * 0.5) % 1; ctx.strokeStyle = `rgba(236,232,255,${(1 - u) * 0.9 * fade})`; ctx.lineWidth = Math.max(2.5, px * 0.9);
          ctx.beginPath(); ctx.ellipse(x, y, px * (3.5 + u * 5), px * (1.3 + u * 1.9), 0, 0, 7); ctx.stroke(); }
      } else if (f[0] === 'hraura') {   // 針の穴通しの1本を受けた味方：足もとに淡い金の輪と、立ちのぼる光の粒（凸は二重）
        const [, x, y, px0, lv, el, d] = f, px = Math.max(2.6, px0), fade = Math.min(1, (d - el) / 0.5), ph = (simT * 1.8) % 1;
        for (let k = 0; k < (lv >= 2 ? 2 : 1); k++) { const u = (ph + k * 0.5) % 1; ctx.strokeStyle = `rgba(255,246,190,${(1 - u) * 0.9 * fade})`; ctx.lineWidth = Math.max(2.5, px * 0.9);
          ctx.beginPath(); ctx.ellipse(x, y, px * (3.5 + u * 5), px * (1.3 + u * 1.9), 0, 0, 7); ctx.stroke(); }
        ctx.fillStyle = `rgba(255,250,220,${0.9 * fade})`; for (let k = 0; k < (lv >= 2 ? 9 : 4); k++) { const u = (simT * 1.2 + k / (lv >= 2 ? 9 : 4)) % 1, sz = px * (lv >= 2 ? 1.2 : 0.8); ctx.fillRect(x + Math.sin(k * 2.1 + simT * 3) * px * (lv >= 2 ? 4.5 : 3) - sz / 2, y - u * px * (lv >= 2 ? 18 : 12), sz, sz); }
        if (lv >= 2) { ctx.fillStyle = `rgba(255,240,170,${0.32 * fade})`; ctx.beginPath(); ctx.ellipse(x, y, px * 8, px * 3, 0, 0, 7); ctx.fill(); }   // 凸：足もとが金色に光る
      } else if (f[0] === 'cdaura') {   // 港の指揮者：拍に合わせて全員の足もとの輪が同時に広がる（凸は二重）。ときどき頭の上に音符
        const [, x, y, top, px0, lv, el, d, ph0] = f, px = Math.max(2.4, px0), fade = Math.min(1, (d - el) / 0.6, el / 0.3), beat = (simT * 1.8) % 1;
        if (lv >= 2) { ctx.fillStyle = `rgba(200,120,255,${0.3 * fade})`; ctx.beginPath(); ctx.ellipse(x, y, px * 8, px * 3, 0, 0, 7); ctx.fill(); }   // 凸：足もとが紫に光り、金の輪が加わる
        for (let k = 0; k < (lv >= 2 ? 2 : 1); k++) { const u = (beat + k * 0.5) % 1; ctx.strokeStyle = lv >= 2 && k === 1 ? `rgba(255,214,110,${(1 - u) * 0.9 * fade})` : `rgba(190,90,255,${(1 - u) * 0.85 * fade})`; ctx.lineWidth = Math.max(3, px * 1.1);
          ctx.beginPath(); ctx.ellipse(x, y, px * (4 + u * 5.5), px * (1.5 + u * 2.1), 0, 0, 7); ctx.stroke(); }
        for (let nn = 0; nn < (lv >= 2 ? 2 : 1); nn++) { const nu = (simT * 0.7 + ph0 + nn * 0.5) % 1; if (nu < 0.45) { const a2 = Math.sin(nu / 0.45 * Math.PI) * fade, nx = x + px * 4 + Math.sin(nu * 9) * px * 1.5, ny = top - px * 3 - nu * px * 16, ps = px * 1.8;   // 音符（♪）：丸い玉と棒と旗
          ctx.fillStyle = lv >= 2 && nn ? `rgba(255,214,110,${a2})` : `rgba(214,140,255,${a2})`; ctx.strokeStyle = `rgba(60,10,90,${a2 * 0.8})`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(nx, ny, ps * 1.1, ps * 0.8, -0.4, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillRect(nx + ps * 0.8, ny - ps * 3.6, ps * 0.45, ps * 3.6); ctx.fillRect(nx + ps * 0.8, ny - ps * 3.6, ps * 1.6, ps * 0.6); } }
      } else if (f[0] === 'aura') {   // 指揮の余韻：足もとに金色の輪（凸は二重で明るい）
        const [, x, y, px0, lv, el, d] = f, px = Math.max(2.6, px0), fade = Math.min(1, (d - el) / 0.5), ph = (simT * 1.6) % 1;
        for (let k = 0; k < (lv >= 2 ? 2 : 1); k++) { const u = (ph + k * 0.5) % 1; ctx.strokeStyle = `rgba(255,${lv >= 2 ? 236 : 214},${lv >= 2 ? 140 : 80},${(1 - u) * 0.95 * fade})`; ctx.lineWidth = Math.max(3, px * 1.1);
          ctx.beginPath(); ctx.ellipse(x, y, px * (4 + u * 6), px * (1.5 + u * 2.2), 0, 0, 7); ctx.stroke(); }
      } else if (f[0] === 'baton') {   // 指揮棒：頭の上で大きく振る金色の棒と、きらきら
        const [, x, top, px0, el, lv] = f, px = Math.max(2.6, px0), sw = Math.sin(el * 10) * 1.0, cx = x + px * 5, cy = top + px * 8, len = px * 12, al = Math.min(1, (1.4 - el) / 0.4);
        ctx.save(); ctx.globalAlpha = al; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,220,110,0.45)'; ctx.lineWidth = px * 3; ctx.beginPath(); ctx.arc(cx, cy, len, -Math.PI / 2 - 1.0, -Math.PI / 2 + 1.0); ctx.stroke();
        const ex = cx + Math.sin(sw) * len, ey = cy - Math.cos(sw) * len;
        ctx.strokeStyle = '#4a300c'; ctx.lineWidth = px * 1.6; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = '#fff4c8'; ctx.lineWidth = px * 0.9; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = '#ffd34a'; for (let k = 0; k < (lv >= 2 ? 7 : 5); k++) { const a2 = el * 9 + k * 1.3; ctx.fillRect(ex + Math.cos(a2) * px * 3 - px * 0.5, ey + Math.sin(a2) * px * 3 - px * 0.5, px, px); }
        ctx.restore();
      }
    });
    moonFx.forEach(([x, y, px, dx, dy, lv, top]) => {   // 月影の抜け出し：青白い光の風の線と、体のうしろに淡い残像（覚醒は少し長く明るい）
      const hgt = y - top, kk = lv >= 2;
      for (let g = 3; g >= 1; g--) { ctx.fillStyle = `rgba(175,200,255,${(kk ? 0.42 : 0.32) * (4 - g) / 3})`; ctx.beginPath(); ctx.ellipse(x - dx * px * g * 4.5, y - hgt * 0.45 - dy * px * g * 2.2, px * 4.6, hgt * 0.5, 0, 0, 7); ctx.fill(); }
      for (let k = 0; k < (kk ? 8 : 6); k++) {
        const off = ((simT * 11 + k * 0.29) % 1), len = px * (14 + (k % 3) * 5) * (kk ? 1.2 : 1), h = -hgt * (0.15 + 0.14 * k) % hgt;
        const sx = x - dx * px * (3 + off * 12), sy = y + h - dy * px * (3 + off * 12) * 0.5;
        ctx.strokeStyle = k % 2 ? `rgba(235,242,255,${0.95 * (1 - off)})` : `rgba(130,160,255,${0.9 * (1 - off)})`; ctx.lineWidth = Math.max(2, px * 0.8);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - dx * len, sy - dy * len * 0.5); ctx.stroke();
      }
      if (kk) for (let k = 0; k < 3; k++) { const ph = simT * 24 + k * 2.3; ctx.fillStyle = '#eef3ff'; ctx.fillRect(x - dx * px * (4 + k * 3) + Math.sin(ph) * px * 2, y - hgt * (0.3 + 0.2 * k) + Math.cos(ph) * px, Math.max(2, px * 0.5), Math.max(2, px * 0.5)); }   // 覚醒：月の光の粒
    });
    speedFx.forEach(([x, y, px, dx, dy]) => {
      const vy = Math.abs(dy) > 0.6 ? Math.abs(dy) : 0;   // 手前・奥へ走る時は、体の左右に風の線を流す（体に隠れないように）
      for (let k = 0; k < 5; k++) {
        const off = ((simT * 9 + k * 0.37) % 1), len = px * (7 + (k % 3) * 3), h = -px * (3 + k * 2.2) * (1 - vy * 0.6), sd = vy * (k % 2 ? 1 : -1) * px * (5 + k * 1.2);
        const sx = x - dx * px * (4 + off * 10) + sd, sy = y + h - dy * px * (4 + off * 10) * 0.5;
        ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - off)})`; ctx.lineWidth = Math.max(1.5, px * 0.6);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - dx * len, sy - dy * len * 0.5); ctx.stroke();
      }
    });
    // シザース：足がボールの上を回って通る道を白い弧で（ボールの手前→真上→向こう側）
    scisFx.forEach(([x, y, sc, lr, ph]) => {   // 弧の中心＝ボール。lr＝足が画面の左→右へ通るなら1、右→左なら−1（横・手前・奥どの向きでも）
      const d = 2.6 * sc * 24 / 30, cx = x, cy = y - 2 * d, R = 6 * d, span = Math.PI * 0.96 * Math.min(1, ph * 1.2);
      ctx.save(); ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) { ctx.strokeStyle = `rgba(255,255,255,${0.85 - k * 0.25})`; ctx.lineWidth = Math.max(1.5, d * (1.1 - k * 0.3)); ctx.beginPath();
        if (lr > 0) ctx.arc(cx, cy, R + k * d * 0.9, Math.PI * 1.02, Math.PI * 1.02 + span); else ctx.arc(cx, cy, R + k * d * 0.9, -Math.PI * 0.02, -Math.PI * 0.02 - span, true);
        ctx.stroke(); }
      ctx.restore();
    });
    // ダブルタッチ：ボールが横へ滑った跡に、ボールの残像と白い線
    dtFx.forEach(([x, y, lx, ly, fx2, fy2, u, sc]) => {
      const px = 2.6 * sc * 24 / 30, at = (lat, fw) => { const g = proj(x + lx * lat + fx2 * fw, y + ly * lat + fy2 * fw); return [g.x, g.y - px * 1.6]; };
      const c1 = (v) => Math.max(0, Math.min(1, v)), lat = (uu) => uu < 0.12 ? -0.22 : uu < 0.28 ? -0.22 + 0.55 * c1((uu - 0.12) / 0.12) : 0.33 + 0.3 * c1((uu - 0.28) / 0.13), fw = (uu) => uu < 0.28 ? 0.32 : 0.32 + 0.25 * c1((uu - 0.28) / 0.13);
      ctx.save();
      // 残像：少し前の時刻のボールの位置に、薄い白丸を3つ
      if (u > 0.13 && u < 0.55) for (let k = 3; k >= 1; k--) { const uu = Math.max(0.12, u - k * 0.045); if (uu >= 0.5) continue; const [bx, by] = at(lat(uu), fw(uu)); ctx.globalAlpha = 0.65 * (1 - k / 4) * (1 - c1((u - 0.42) / 0.13)); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, px * 1.8, 0, 7); ctx.fill(); }
      // 横へ滑る線（2回目のタッチの後）
      if (u > 0.2 && u < 0.5) { const [ax, ay] = at(-0.22, 0.32), [bx, by] = at(lat(u), fw(u)); ctx.globalAlpha = 0.75 * (1 - c1((u - 0.36) / 0.14)); ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
        for (let k = -1; k <= 1; k++) { ctx.lineWidth = Math.max(1.2, px * (k ? 0.5 : 0.8)); ctx.beginPath(); ctx.moveTo(ax, ay + k * px * 1.4); ctx.lineTo(bx - (bx - ax) * 0.18, by + k * px * 1.4); ctx.stroke(); } }
      ctx.restore();
    });
    // 踏み込んだ足元の土ぼこり・芝
    dusts.forEach(([x, y, px, u]) => {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI + Math.PI, rr = px * (2 + ((simT * 30 + k * 7) % 6));
        ctx.fillStyle = k % 2 ? 'rgba(235,245,215,0.85)' : 'rgba(170,210,120,0.85)';
        ctx.fillRect(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.5 - px, px * 1.2, px * 1.2);
      }
    });
    if (show && (show.phase === 'replay' || show.phase === 'digest')) drawSkillBanner();
    { const rb = document.getElementById('rpSkip'); if (rb) { const on = !!(show && (show.phase === 'replay' || show.phase === 'jreplay')); if ((rb.style.display !== 'none') !== on) rb.style.display = on ? '' : 'none'; } }
    drawCardBanner();
    skillChips.forEach(([x, y, k, ov]) => {
      // スキル発動の表示（選手の頭上に小さく）
      ctx.font = `900 24px ${JP}`; const w = ctx.measureText(k).width + 26;   // 版497：スキルの吹き出しを大きく
      // 固有スキル：スキルごとの色（engine の UNIQ の chip：地・ふち・文字）。覚醒（凸）は、ふちが太く光る
      const uq = k.includes('【'), kk = k.includes('・覚醒'), U2 = uq && D.UNIQ ? Object.values(D.UNIQ).find((u) => k.includes('【' + u.name)) : null, cc = U2 && U2.chip ? U2.chip : ['#c8141e', '#ffd23a', '#ffe45a'];
      if (kk) { ctx.save(); ctx.shadowColor = cc[1]; ctx.shadowBlur = 14; }
      const oc = !uq && ov ? ov : null;
      ctx.fillStyle = uq ? cc[0] : oc ? oc[0] : '#ffd400'; rrect(x - w / 2, y - 28, w, 35, 17); ctx.fill(); ctx.strokeStyle = uq ? cc[1] : oc ? oc[1] : '#3a2a00'; ctx.lineWidth = kk ? 3.5 : 2; ctx.stroke();
      if (kk) ctx.restore();
      ctx.fillStyle = uq ? cc[2] : oc ? oc[2] : '#3a2a00'; ctx.textAlign = 'center'; ctx.fillText(k, x, y - 2);
    });
    if (hiBall) { ballOwned = hiBall[3]; ballDraw(hiBall[0], hiBall[1], hiBall[2]); }
    { // 版864：GKがボールに触った瞬間（はじく・パンチング・指先・足・体）：ボールの所に白い衝撃の光を出す（手に当たったと見て分かるように）
      const HIT = { parry: 1, diveparry: 1, punch: 1, tipover: 1, footsave: 1, block: 1, tip: 1 };
      const he = match && match.events && match.events.find((e) => (e.type === 'save' || e.type === 'gk') && HIT[e.act] && simT - e.t >= -0.02 && simT - e.t < 0.3);
      if (he) { const u = Math.max(0, simT - he.t) / 0.3, bq = P3(st.ball.x, st.ball.y, st.ball.z || 0), s0 = proj(st.ball.x, st.ball.y).s, R0 = (6 + u * 16) * Math.max(0.8, s0);
        ctx.save(); ctx.globalAlpha = 1 - u; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, 2.4 * s0); ctx.beginPath();
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.2, r1 = R0 * 0.45, r2 = R0; ctx.moveTo(bq.x + Math.cos(a) * r1, bq.y + Math.sin(a) * r1 * 0.8); ctx.lineTo(bq.x + Math.cos(a) * r2, bq.y + Math.sin(a) * r2 * 0.8); }
        ctx.stroke(); ctx.globalAlpha = (1 - u) * 0.5; ctx.fillStyle = '#fff8c0'; ctx.beginPath(); ctx.arc(bq.x, bq.y, R0 * 0.38, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    }
    if (radarOn) minimap(st);
    if (cardPanel && simT >= cardPanel.t && simT - cardPanel.t < 3.8) {
      const a = Math.min(1, (simT - cardPanel.t) * 4, (3.8 - (simT - cardPanel.t)) * 3);
      const c = cardPanel;
      const label = c.color === 'red' ? (c.second ? 'イエロー2枚目で退場' : 'レッドカード　退場') : 'イエローカード（警告）';
      playerPanel(c.idx, [label], a, (x, y) => {
        ctx.fillStyle = c.color === 'red' ? '#e8241c' : '#ffd400'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
        ctx.save(); ctx.translate(x + 10, y + 10); ctx.rotate(-0.12); ctx.fillRect(-8, -10, 16, 22); ctx.strokeRect(-8, -10, 16, 22); ctx.restore();
      });
    }
    // 画面中央の一言
    if (show) drawShowOverlay(st);
    // 上に出る文字はなし（試合の画面だけで伝える）
    if (show && (show.phase === 'replay' || show.phase === 'fade' || show.phase === 'digest' || show.phase === 'endCrowd')) return; // リプレイ中は時計と点数を止めておく
    // 時計：カルチョビットAと同じく10秒刻み。前後半の終わりにはアディショナルタイム（+1）
    // 前半終了の笛のあと（暗転するまで）は、前半の最後の時間のまま
    const holdHalf = show && show.phase === 'halfOut';
    $('#clock').textContent = clockText(st.t, holdHalf);
    // ゴール直後は、大きな点数が切り替わるまで上の点数も前のまま
    let sc = st.score;
    if (show && show.goal && (show.phase === 'toNet' || show.phase === 'freeze' || show.phase === 'gkSad' || (show.phase === 'score' && show.rt < 0.85))) { sc = show.goal.score.slice(); sc[show.goal.team] = Math.max(0, sc[show.goal.team] - 1); }
    { const key = sc[0] + '-' + sc[1]; shownScore = key; }   // 版558：本家は点数が出る時に音を鳴らさない（観客の歓声だけ）
    $('#hs').textContent = sc[0];
    $('#as').textContent = sc[1];
  }

  // 時計：前後半それぞれ「45分＋アディショナルタイム」が試合の本来の長さ（nominalHalf）にあたる。
  //  笛はそれを少し越えたところ、攻撃の最中ならそのプレーが終わったところで鳴る（エンジンが決める）ので、時計は同じ速さで進め続ける
  function clockParts(t, holdHalf) {
    const hT = halfT, inSecond = t >= hT && !holdHalf, el = inSecond ? t - hT : Math.min(t, hT);
    const NH = match.nominalHalf || (inSecond ? match.duration - hT : hT), addN = addedMin(inSecond ? 2 : 1);
    const raw = (el / NH) * (45 + addN) * 60, base = inSecond ? 45 * 60 : 0;
    return { sec: Math.floor((base + raw) / 10) * 10, addN, added: raw >= 45 * 60, inSecond };
  }
  function clockText(t, holdHalf) {
    const c = clockParts(t, holdHalf);
    return `${String(Math.floor(c.sec / 60)).padStart(2, '0')}:${String(c.sec % 60).padStart(2, '0')}${c.added ? ` +${c.addN}` : ''}`;
  }

  // ---------- 出来事 ----------
  const TEXT = {
    shot: (e) => ({ text: e.knuckle ? '無回転シュート！' : e.power >= 105 ? '強烈なシュート！' : 'シュート！', color: e.knuckle ? '#ffe680' : '#fff' }),
    save: (e) => ({ text: e.fumble ? 'こぼした！' : e.act === 'punch' ? 'パンチング！' : e.act === 'diveparry' || e.act === 'tipover' || e.act === 'footsave' ? 'ファインセーブ！' : e.act === 'block' ? 'ブロック！' : 'セーブ！', color: '#9fe3ff' }),
    gk: (e) => ({ text: e.act === 'fumble' ? 'ファンブル！' : e.act === 'miss' ? 'GKが目測を誤った！' : e.act === 'divecatch' ? 'ダイビングキャッチ！' : e.act === 'claim' ? 'ハイボールをキャッチ' : 'がっちりキャッチ！', color: e.act === 'miss' ? '#ffb347' : '#9fe3ff' }),
    penalty: (e) => ({ text: 'PK！', color: '#ffe680', sub: `キッカー：${e.player}`, life: 2.6, prio: 2 }),
    freekick: (e) => ({ text: e.wall ? 'フリーキック（壁）' : 'フリーキック', color: '#fff' }),
    card: (e) => ({ text: e.color === 'red' ? (e.second ? '2枚目のイエロー → 退場！' : 'レッドカード！ 退場') : 'イエローカード', color: e.color === 'red' ? '#ff8a80' : '#ffe680', card: e.color === 'red' ? 2 : 1, sub: `${e.number} ${e.player}`, life: 2.8, prio: 3 }),
    half: () => ({ text: '後半はコートが入れ替わります', color: '#fff', life: 2.4, prio: 1 }),
    block: (e) => ({ text: 'ブロック！', color: '#fff' }),
    offside: () => ({ text: 'オフサイド', color: '#ffe680' }),
    corner: () => ({ text: 'コーナーキック', color: '#fff' }),
    foul: () => ({ text: 'ファウル', color: '#ffb0a8' }),
    throw: () => ({ text: 'スローイン', color: '#fff' }),
    goalkick: () => ({ text: 'ゴールキック', color: '#fff' }),
  };
  const POLICY_TEXT = { LINE_DOWN: 'ラインを下げる', PUSH_UP: '全体を押し上げる', HIGH_PRESS: '前からプレス', THROUGH_BALLS: '裏へのパスを増やす', LESS_PRESS: 'プレスを弱める', URGENT: '縦へ急げ！前からプレス', SIT_DEFEND: '守りを固める', SIT_ATTACK: '攻めに出る', SIT_ALLOUT: '総攻撃！' };
  function fireEvents() {
    while (evIndex < match.events.length && match.events[evIndex].t <= simT) {
      const e = match.events[evIndex++];
      if (TEXT[e.type] && !(e.type === 'gk' && (e.act === 'miss' || e.act === 'tip'))) {   /* 版759：指先で触ったのは吹き出しを出さず、音と動きで見せる */   // GKの目測ミスは文字を出さない（プレーで見せる）
        const nb = { t: e.t, ...TEXT[e.type](e) };
        // カードやPKの表示中は、小さな出来事で上書きしない
        const active = banner && simT - banner.t < (banner.life || 1.6);
        if (!active || (nb.prio || 0) >= (banner.prio || 0)) banner = nb;
        else if (nb.prio) nextBanner = nb; // 大事な知らせは後で出す
      }
      if (e.type === 'goal') { oohT = -1; startGoalShow(e); SND().goal(true); goalSnd = true; setTimeout(() => { if (SND().chant(true)) { chantOn = true; chantUntil = performance.now() + 40000; } }, 1000); }   // 版730：ゴールの1秒後から、太鼓つきの応援を40秒   // 版723：ゴールの大歓声は、次のキックオフまで続ける
      if ((e.type === 'foul' || e.type === 'offside') && speed < 16 && !match.events.some((x) => x.type === 'penalty' && Math.abs(x.t - e.t) < 0.05)) SND().play('foul');
      if (e.type === 'penalty' && speed < 16) SND().play('pkcall');   // 版837：PKの判定は長い笛   // 版558：本家のファールは「ピッピッ」
      // 版721：「おぉー」は本当に惜しい時だけ（ポスト・バー、1対1や近くからのシュートが外れた・止められた時）。ふつうのキャッチでは鳴らさない
      if (e.type === 'shot') { lastShotEv = e; lastShotSimT = e.t; }
      if (e.type === 'shot' && speed < 16) { SND().play('shot'); if (!e.on && (e.one || e.d < 11)) oohT = e.t + 0.45; }
      if (e.type === 'post' && speed < 16) oohT = e.t + 0.25;
      if (e.type === 'save' && speed < 16 && lastShotEv && e.t - lastShotEv.t < 2 && (lastShotEv.one || lastShotEv.d < 11)) oohT = e.t + 0.25;
      if (e.type === 'card' && speed < 16) SND().play('card');
      if (e.type === 'gk' && e.act === 'tip' && speed < 16) SND().play('parry');   /* 指先に当たった「パンッ」 */
      if (e.type === 'half') { SND().play('whistle2'); koWhistleT = e.t + 0.6; }
      if (e.type === 'pkgo' && speed < 16) SND().play('pkgo');
      if (e.type === 'fkgo' && speed < 16) SND().play('whistle');   // 版846：FKの笛   /* 版742：PKは全員がエリアの外に出てから、笛を吹いて蹴る */
      if ((e.type === 'offside' || e.type === 'foul') && !show && speed < 4) startJudge(e);
      if (e.type === 'card') { const i = idxOf(e.team, e.number); if (i >= 0) cardPanel = { t: e.t + 1.3, idx: i, color: e.color, second: e.second }; }
      // ゴールの演出（喜び・観客・リプレイ）の最中に起きた交代は、演出が全部終わってキックオフの前に見せる
      if (e.type === 'sub' && show && show.phase === 'hurry') { (show.subsAtKo = show.subsAtKo || []).push(e); continue; }   // 版780：ゴールのあと急いで戻る間の交代も、キックオフの前に
      if (e.type === 'sub' && show && show.goal && !['kickoff', 'hurry', 'sub'].includes(show.phase))   /* 版791：GKが悔しがっている間（gkSad）なども含め、ゴールの演出中はすべて後回し */ { (show.subsLater = show.subsLater || []).push(e); continue; }
      if (e.type === 'sub' && show && ['judge', 'jreplay', 'jfade', 'jback'].includes(show.phase)) { (show.subsLater = show.subsLater || []).push(e); continue; }   // オフサイド・ファールの判定とリプレイが終わってから、交代を見せる
      if (e.type === 'sub' && !(show && show.phase === 'sub') && !window.__noShow) { const list = [e]; while (evIndex < match.events.length && match.events[evIndex].type === 'sub' && match.events[evIndex].t - e.t < 1.5) list.push(match.events[evIndex++]); startSubShow(list, show || null); }   // 続けて起きた交代だけをまとめる（ゴールなど、ほかの出来事は飛ばさない）
      if (e.type === 'policy') flash($('#policy'), `${e.team ? match.awayShort : match.homeShort}の方針：${POLICY_TEXT[e.action] || e.action}`, 2200);
      if (globalThis.__showIssue && e.type === 'issue' && e.team === 0 && !(mctx && mctx.opts && mctx.opts.watch)) {   // 版809：試合中の「課題」カードの表示はなくした（カードは試合のあとに、全種類からランダムでもらう）
        const q = $('#coach');
        q.querySelector('p').textContent = e.text;
        { const id = ISSUE_CARD[e.key], ic = $('#coachIcon'), cd = q.querySelector('.issue-card');
          if (id) { cd.classList.add('art'); cd.style.borderColor = CAT_COL[cardCat(id)] || ISSUE_CC[e.key] || '#fff'; ic.innerHTML = `<img src="cards/${id}.jpg" alt="${e.card}">`; $('#coachCard').textContent = ''; }
          else { cd.classList.remove('art'); cd.style.borderColor = ''; ic.textContent = '★'; $('#coachCard').textContent = e.card; } }
        q.classList.add('show');
        clearTimeout(q._t); q._t = setTimeout(() => q.classList.remove('show'), 3200);
        if (mctx && mctx.opts.tut && mctx.opts.tut.onIssue) mctx.opts.tut.onIssue(e, tutApi());   // チュートリアル：課題カードの説明
      }
      if (e.type === 'half' && !halfShown && !window.__noShow) { halfShown = true; halfT = e.t; show = { phase: 'halfOut', hold: true, rt: 0 }; }
    }
  }
  // 選手交代の演出（カルチョビットA）：プレーが止まった所で、左上に交代ボード（電光掲示板）→ 1人ずつ顔のカード → 再開
  // 試合中のコーチの指摘 → 対応する特訓カードの絵
  // カードは特訓画面と同じ絵・同じ枠（カード名も絵に描かれているので、文字は足さない）
  const CAT_COL = { tact: '#2aa83a', tech: '#e8501e', phys: '#2a62d8', sup: '#e8b416' };
  function cardCat(id) { const C = window.DotCareer, cd = C && C.CARDS && C.CARDS[id]; return cd ? cd.cat : null; }
  function cardTag(id, name) { const cat = cardCat(id); return `<span class="acard ${cat ? 'cat-' + cat : 'cat-tact'}" title="${plvEsc(name || '')}"><img src="cards/${id}.jpg" alt="${plvEsc(name || '')}" draggable="false"></span>`; }
  const ISSUE_CARD = { video: 'video', setplay: 'setplay', running: 'running', man_marking: 'manMark', press: 'press', pass: 'pass', dash: 'dash', shoot: 'shoot', line_control: 'line' };
  // 育成画面のカードと同じ縁の色（戦術＝緑・技術＝オレンジ・フィジカル＝青・サポート＝黄）
  const ISSUE_CC = { video: '#2aa83a', setplay: '#2aa83a', running: '#2a62d8', man_marking: '#2aa83a', press: '#2aa83a', pass: '#e8501e', dash: '#2a62d8', shoot: '#e8501e', line_control: '#2aa83a' };
  function startSubShow(list, after) {
    if (!list.length) return;
    show = { phase: 'sub', hold: true, rt: 0, list, k: -1, after: after || null };
    const led = document.getElementById('subLed');
    if (led) {
      const n2 = (n) => `<span class="ld"><i>88</i><b>${String(n).padStart(2, ' ')}</b></span>`;
      led.innerHTML = list.map((e) => `<div class="led-p ${e.team ? 'aw' : 'hm'}"><div class="led-r out"><em>OUT</em>${n2(e.outNumber)}</div><div class="led-r in"><em>IN</em>${n2(e.number)}</div></div>`).join('');
      led.classList.add('show');
    }
  }
  function subCardShow(e) {
    const el = document.getElementById('subCard');
    if (!el) return;
    const min = Math.min(90, Math.max(1, Math.ceil((e.t * match.clockScale) / 60)));
    const POS = { GK: 'p-gk', DF: 'p-df', MF: 'p-mf', FW: 'p-fw' };
    el.innerHTML = `<div class="sc-face"></div><div class="sc-body"><div class="sc-top"><b>${e.team ? match.awayShort : match.homeShort}</b><span>${min}'</span></div><p class="sc-in"><i>▲</i><em class="${POS[e.pos] || ''}">${e.pos || ''}</em><b>${e.number}</b>${e.in}</p><p class="sc-out"><i>▼</i><em class="${POS[e.outPos] || ''}">${e.outPos || ''}</em><b>${e.outNumber}</b>${e.out}</p></div>`;
    let url = null; try { const C2 = window.__career; url = C2 && C2.matchFace ? C2.matchFace(e.info, TEAM[e.team].W) : null; } catch (er) { url = null; }
    if (url) { const im = document.createElement('img'); im.src = url; im.alt = ''; im.className = 'sc-photo'; el.querySelector('.sc-face').appendChild(im); }   // 顔写真（育成モードの顔）
    else {
    const cv = spriteCanvas(e.info, e.team, 'front', 0, false, e.info.gk);
    const f = document.createElement('canvas'); f.width = SPR_W; f.height = 15; f.getContext('2d').drawImage(cv, 0, 0);
    el.querySelector('.sc-face').appendChild(f); }
    el.classList.add('show');
  }
  function subShowStep(dt) {
    show.rt += dt;
    const CARD = 2.4, LEAD = 1.0;
    const k = show.rt < LEAD ? -1 : Math.floor((show.rt - LEAD) / CARD);
    if (k !== show.k) {
      show.k = k;
      const el = document.getElementById('subCard');
      if (k >= 0 && k < show.list.length) { if (el) el.classList.remove('show'); setTimeout(() => { if (show && show.phase === 'sub' && show.k === k) subCardShow(show.list[k]); }, k ? 250 : 0); }
      if (k >= show.list.length) {
        if (el) el.classList.remove('show');
        const led = document.getElementById('subLed'); if (led) led.classList.remove('show');
        show.outT = show.rt;
      }
    }
    // 交代の表示が完全に消えてから（フェードが終わってから）、プレーを再開する
    if (show.outT != null && show.rt - show.outT > 0.6) { show = show.after; if (show) show.rt = 0; }
  }
  function flash(el, text, ms) { el.textContent = text; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms); }
  function goalShow(e) {
    const g = $('#goal');
    g.querySelector('strong').textContent = `${e.score[0]} − ${e.score[1]}`;
    g.classList.add('show');
    const min = Math.ceil((e.t * match.clockScale) / 60);
    $('#scorer').textContent = `⚽ ${e.number} ${e.player}（${e.team ? match.awayShort : match.homeShort}）　${min}分${e.assist ? '　アシスト ' + e.assist : ''}`;
    $('#scorer').classList.add('show');
    clearTimeout(g._t);
    g._t = setTimeout(() => { g.classList.remove('show'); $('#scorer').classList.remove('show'); }, 2200 / Math.max(1, speed / 2));
  }

  // ---------- 途中経過の集計（イベントと記録から） ----------
  // アディショナルタイム（分）：その半分のゴール・交代・カード・ケガの多さで 1〜4 分
  const addCache = {};
  function addedMin(h) {
    const key = h + ':' + match.duration + ':' + match.events.length;
    if (addCache[key] != null) return addCache[key];
    let n = 0;
    for (const e of match.events) { const inH = h === 1 ? e.t < halfT : e.t >= halfT; if (!inH) continue; if (e.type === 'goal') n += 0.5; if (e.type === 'sub') n += 0.35; if (e.type === 'card') n += 0.4; if (e.type === 'injury') n += 0.8; }
    return (addCache[key] = Math.max(1, Math.min(4, Math.round(1 + n))));
  }
  function statsUntil(t) {
    const S2 = [0, 1].map(() => ({ shots: 0, on: 0, corners: 0, pk: 0, off: 0, fouls: 0, y: 0, r: 0, goals: [] }));
    for (const e of match.events) {
      if (e.t > t) break;
      const k = e.team;
      if (e.type === 'shot') { S2[k].shots++; if (e.on) S2[k].on++; }
      if (e.type === 'corner') S2[k].corners++;
      if (e.type === 'penalty') S2[k].pk++;
      if (e.type === 'offside') S2[k].off++;
      if (e.type === 'foul') S2[k].fouls++;
      if (e.type === 'card') S2[k][e.color === 'red' ? 'r' : 'y']++;
      if (e.type === 'goal') S2[k].goals.push(e);
    }
    let a = 0, b = 0;
    for (const f of match.frames) { if (f[0] > t) break; const o = f[4]; if (o >= 0 && o < 22) { if (o < 11) a++; else b++; } }
    const pa = Math.round((100 * a) / Math.max(1, a + b));
    return { S2, pos: [pa, 100 - pa] };
  }
  function statsHtml(t, title) {
    const { S2, pos } = statsUntil(t);
    const sc = [S2[0].goals.length, S2[1].goals.length];
    const rows = [
      ['シュート（枠内）', `${S2[0].shots}（${S2[0].on}）`, `${S2[1].shots}（${S2[1].on}）`],
      ['コーナーキック', S2[0].corners, S2[1].corners],
      ['ペナルティキック', S2[0].pk, S2[1].pk],
      ['オフサイド', S2[0].off, S2[1].off],
      ['ファウル', S2[0].fouls, S2[1].fouls],
      ['カード', `<i class="yc"></i>${S2[0].y}／<i class="rc"></i>${S2[0].r}`, `<i class="yc"></i>${S2[1].y}／<i class="rc"></i>${S2[1].r}`],
      ['ボール支配率', `${pos[0]}%`, `${pos[1]}%`],
    ];
    const gl = (k) => S2[k].goals.map((g) => `${g.number} ${g.player} ${Math.ceil((g.t * match.clockScale) / 60)}'`).join('<br>') || '—';
    return `<div class="hs-head"><span>${match.homeShort}</span><span>${sc[0]} − ${sc[1]}<small style="display:block;font-size:11px;font-weight:700">${title}</small></span><span>${match.awayShort}</span></div>` +
      rows.map((r) => `<div class="hs-row"><span>${r[1]}</span><b>${r[0]}</b><span>${r[2]}</span></div>`).join('') +
      `<div class="hs-row"><span>${gl(0)}</span><b>得点</b><span>${gl(1)}</span></div>`;
  }

  // ---------- 試合終了 ----------
  function finish(direct) {
    { const ws = document.getElementById('wStop'); if (ws) ws.hidden = true; }
    SND().crowd(false);
    { const st = SND().state, playingPost = st && st.bgm === 'post';
      if (!direct && match && !(mctx && mctx.opts && mctx.opts.watch) && !playingPost) { const d = match.score[0] - match.score[1]; SND().play(d > 0 ? 'win' : d < 0 ? 'lose' : 'draw'); }
      if (!direct && !playingPost) setTimeout(() => { const s2 = SND().state; if (s2 && s2.want == null) SND().bgm('post'); }, 1800); }   // 版559：試合のあとの曲
    closePlv();
    stop();
    // 試合結果（状況と同じ画面）→ 戻るで、育成モードは次へ（ロッカールームの会話など）、フリー試合は今までの結果画面
    if (!direct) { showMatchResult(() => { if (onMatchDone) { const fn = onMatchDone; onMatchDone = null; fn(match.score.slice()); } else finish(true); }); return; }
    const s = match.stats;
    showScreen('result');
    $('#finalScore').textContent = `${match.score[0]} − ${match.score[1]}`;
    $('#finalOpponent').textContent = match.awayShort;
    const rows = [
      ['シュート（枠内）', `${s[0].shots}（${s[0].shots_on_target}）`, `${s[1].shots}（${s[1].shots_on_target}）`],
      ['パス成功', `${s[0].passes_completed}/${s[0].passes}`, `${s[1].passes_completed}/${s[1].passes}`],
      ['コーナーキック', s[0].corners, s[1].corners],
      ['オフサイド', s[0].offsides, s[1].offsides],
      ['ファウル', s[0].fouls, s[1].fouls],
      ['ボール支配率', `${s[0].possession_pct}%`, `${s[1].possession_pct}%`],
    ];
    $('#statTable').innerHTML = rows.map((r) => `<div class="stat-row"><span>${r[1]}</span><b>${r[0]}</b><span>${r[2]}</span></div>`).join('');
    const goals = match.events.filter((e) => e.type === 'goal');
    $('#goalsList').innerHTML = goals.map((e) => `<span class="goal-row">${Math.ceil((e.t * match.clockScale) / 60)}分 ${e.player}（${e.team ? match.awayShort : match.homeShort}）</span>`).join('') || '得点なし';
    const issues = match.events.filter((e) => e.type === 'issue' && e.team === 0);
    $('#cards').innerHTML = issues.map((e) => `<span class="card-reward"><i class="card-icon">★</i>${e.card}<small>　${e.text}</small></span>`).join('') || '課題は見つかりませんでした';
    // 育成モードの試合：結果を渡して育成画面へ戻るボタン
    const back = $('#backCareer');
    if (back) back.hidden = !onMatchDone;
    $('#again').hidden = !!onMatchDone;
  }

  // ---------- パネル ----------
  function panel(kind) {
    const st = stateAt(simT);
    let html = '<h2>選手の状況</h2><div class="squad-grid">';
    for (let i = 0; i < 22; i++) {
      const team = i < 11 ? 0 : 1, info = rinfo(team, i % 11);
      html += `<div class="squad-row"><b>${info.position}</b><span>${info.number} ${info.name}<small> ${info.type}</small></span><div class="stamina"><i style="width:${st.players[i].st}%"></i></div></div>`;
    }
    html += '</div>';
    if (kind === 'subs') html = '<h2>選手交代</h2><p>交代は次の段階で使えるようになります。今は疲れ具合を確認できます。</p>' + html;
    else if (kind === 'status') html += '<h2>追跡中の選手の動いた跡</h2><p>ピッチ上の選手をタップすると追跡できます。</p><canvas class="mini" id="mini" width="600" height="190"></canvas>';
    $('#panelContent').innerHTML = html;
    showOverlay('panel');
    if (kind === 'status') setTimeout(mini, 0);
  }

  // ---------- 「選手」ボタン：カルチョビットAのように、試合を止めずに両チームの一覧を重ねる ----------
  // 真ん中下の3つのボタン：左＝自分のチームの能力、中＝両チームの一覧、右＝相手チームの能力
  const PLV_TYPE = { 'バランス': 'ty-bal', 'アタッカー': 'ty-att', 'ストライカー': 'ty-str', 'ストッパー': 'ty-stp', 'スイーパー': 'ty-swp', 'マンマーカー': 'ty-man', 'ダイナモ': 'ty-dyn', 'レジスタ': 'ty-reg', 'ゲームメイカー': 'ty-gm', 'ラインコントローラー': 'ty-lc', 'パサー': 'ty-pa', '偽9番': 'ty-f9', 'デコイラン': 'ty-dec', 'ファンタジスタ': 'ty-fan', 'シャドー': 'ty-sha', 'アンカー': 'ty-anc', 'ビルドアップ型': 'ty-bu', 'スイーパーキーパー': 'ty-skp', 'ゴールキーパー': 'ty-gk' };
  const PLV_POS = { GK: 'pv-gk', DF: 'pv-df', MF: 'pv-mf', FW: 'pv-fw' };
  let plvMode = 'both', plvTimer = 0, radarOn = false;   // レーダー（右下の小さな全体図）は、真ん中のボタンで出し入れ
  const plvEsc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const plvBat = (st) => { const n = Math.max(0, Math.min(4, Math.ceil(st / 25))); return `<i class="pbat ${st < 35 ? 'low' : st < 60 ? 'mid' : ''}">${'<b></b>'.repeat(n)}${'<b class="e"></b>'.repeat(4 - n)}</i>`; };
  // 国内屈指の印（赤い角の顔・送ってもらった画像）：試合中の選手データで、名前の横に付けて一目で分かるように
  const TOP_MARK = '<img class="pv-top" src="icons/top_mark.png" alt="国内屈指" title="国内屈指">';
  function plvPanel(team, detail) {
    const st = stateAt(simT), name = team ? match.awayShort : match.homeShort;
    const emb = team ? mctx && mctx.opts.embA : mctx && mctx.opts.embH;
    const order = [...Array(11).keys()].sort((a, b) => ['GK', 'DF', 'MF', 'FW'].indexOf(rinfo(team, a).position) - ['GK', 'DF', 'MF', 'FW'].indexOf(rinfo(team, b).position) || a - b);
    const icons = detail ? `<span class="pv-ico"><em class="pv-oh">総合</em>${D.PARAMS.map((q) => `<img src="icons/${q.k}.png" alt="" title="${q.name}">`).join('')}</span>` : '';
    const rows = order.map((k) => {
      const i = team * 11 + k, info = rinfo(team, k), p = st.players[i];
      const pv0 = info.params || info, ovr = Math.round(D.PARAMS.reduce((a, q) => a + (+pv0[q.k] || 0), 0) / D.PARAMS.length), ovG = D.grade(ovr);   // 版856：総合力（12能力の平均）
      const gr = detail ? `<span class="pv-ov g-${ovG}" title="総合力 ${ovr}">${ovr}</span><span class="pv-gr">${D.PARAMS.map((q) => { const pv = info.params || info, g = mctx && mctx.opts.grade ? mctx.opts.grade(info, q.k, team) : D.grade(pv[q.k]); return `<b class="g-${g}">${g}</b>`; }).join('')}</span><span class="pv-ty"><em class="tbadge ${PLV_TYPE[info.type] || 'ty-bal'}${String(info.type || '').length >= 8 ? ' tlong' : ''}">${plvEsc(info.type)}</em></span>` : '';
      const cs = (cardsOf[i] || []).filter((c) => c.t <= simT && c.number === info.number), red = cs.some((c) => c.color === 'red'), yel = cs.filter((c) => c.color !== 'red').length;
      const cm = red ? '<i class="pv-card red" title="退場"></i>' : yel ? '<i class="pv-card yel" title="警告"></i>' : '';   // 退場（レッド）・警告（イエロー）
      return `<div class="pv-row${selected === i ? ' on' : ''}${red ? ' sent' : ''}" data-i="${i}"><i class="pv-pos ${PLV_POS[info.position] || ''}">${info.position}</i>${info.uniq ? TOP_MARK : '<i class="pv-topsp"></i>'}<b class="pv-no">${info.number}</b><span class="pv-nm">${plvEsc(info.name)}${cm}</span>${plvBat(p ? p.st : 100)}${gr}</div>`;
    }).join('');
    return `<div class="pv-head">${emb ? `<img class="pv-emb" src="${emb}" alt="">` : `<i class="pv-crest t${team}"></i>`}<b>${plvEsc(name)}</b>${icons}</div>${rows}`;
  }
  function plvDraw() {
    const el = document.getElementById('plv'); if (!el || el.hidden) return;
    el.className = 'plv m-' + plvMode;
    // 版792：片方のチームでエラーが出ても、もう片方と一覧そのものは必ず出す（能力ランクが出せないときは素の値から）
    const safe = (tm, det) => { try { return plvPanel(tm, det); } catch (er) { console.warn(er); try { const g = mctx && mctx.opts.grade; if (mctx) mctx.opts.grade = null; const h = plvPanel(tm, det); if (mctx) mctx.opts.grade = g; return h; } catch (e2) { return ''; } } };
    el.querySelector('.pv-l').innerHTML = safe(0, plvMode === 'home');
    el.querySelector('.pv-r').innerHTML = safe(1, plvMode === 'away');
    el.querySelectorAll('.pv-mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === 'both' ? radarOn : b.dataset.m === plvMode));
    el.querySelectorAll('.pv-row').forEach((r) => r.onclick = (e) => { e.stopPropagation(); const i = +r.dataset.i; selected = selected === i ? -1 : i; trail = []; plvDraw(); if (!playing) draw(); });
  }
  function plvFit() {
    const el = document.getElementById('plv'), vp = $('#match .viewport'); if (!el || !vp) return;
    const k = Math.min(vp.clientHeight / 600, vp.clientWidth / 1000);
    el.style.setProperty('--k', Math.max(0.5, Math.min(1.25, k)).toFixed(3));
  }
  const PLV_ICON = (m) => `<svg viewBox="0 0 60 40"><rect x="2" y="2" width="56" height="36" rx="3" fill="#3b9a35" stroke="#fff" stroke-width="2.5"/>${m === 'home' ? '<rect x="6" y="6" width="22" height="28" fill="#1f5f1c" stroke="#fff" stroke-width="2"/>' : m === 'away' ? '<rect x="32" y="6" width="22" height="28" fill="#1f5f1c" stroke="#fff" stroke-width="2"/>' : '<line x1="30" y1="2" x2="30" y2="38" stroke="#fff" stroke-width="2"/><circle cx="30" cy="20" r="6" fill="none" stroke="#fff" stroke-width="2"/><rect x="2" y="11" width="8" height="18" fill="none" stroke="#fff" stroke-width="2"/><rect x="50" y="11" width="8" height="18" fill="none" stroke="#fff" stroke-width="2"/>'}</svg>`;
  function openPlv() {
    let el = document.getElementById('plv');
    if (!el) {
      el = document.createElement('div'); el.id = 'plv';
      el.innerHTML = `<div class="pv-l pv-panel"></div><div class="pv-r pv-panel"></div><div class="pv-mode">${['home', 'both', 'away'].map((m) => `<button data-m="${m}" title="${m === 'home' ? '自分のチームの能力' : m === 'away' ? '相手チームの能力' : 'レーダーを出す／しまう'}">${PLV_ICON(m)}</button>`).join('')}</div><button class="pv-back" title="もどる"><svg viewBox="0 0 40 40"><path d="M15 31h10a9.5 9.5 0 0 0 0-19H14" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/><path d="M3 12l12-9v18z" fill="#fff"/></svg></button>`;
      $('#match .viewport').appendChild(el);
      el.querySelectorAll('.pv-mode button').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const m = b.dataset.m; if (m === 'both') { radarOn = !radarOn; plvMode = 'both'; if (!playing) draw(); } else plvMode = plvMode === m ? 'both' : m; plvDraw(); });
      el.querySelector('.pv-back').onclick = (e) => { e.stopPropagation(); closePlv(); };
      addEventListener('resize', plvFit);
    }
    plvMode = 'both'; el.hidden = false; $('#match').classList.add('plv-on');
    plvFit(); plvDraw();
    clearInterval(plvTimer); plvTimer = setInterval(() => { if (el.hidden || $('#match').hidden) { clearInterval(plvTimer); return; } plvDraw(); }, 500);
  }
  function closePlv() { const el = document.getElementById('plv'); if (el) el.hidden = true; clearInterval(plvTimer); $('#match').classList.remove('plv-on'); }
  function mini() {
    const m = $('#mini'), x = m.getContext('2d');
    x.fillStyle = '#347a49'; x.fillRect(0, 0, 600, 190);
    x.strokeStyle = '#fff'; x.strokeRect(8, 8, 584, 174);
    x.beginPath(); x.moveTo(300, 8); x.lineTo(300, 182); x.stroke();
    x.fillStyle = '#fff65b';
    trail.forEach((p) => { x.beginPath(); x.arc(8 + (p.x / 105) * 584, 8 + (p.y / 68) * 174, 3, 0, 7); x.fill(); });
  }

  // ---------- 操作 ----------
  roster();
  $('#level') && $('#level').addEventListener('change', roster);
  if (!document.getElementById('career')) showScreen('setup');   // 版534：起動時に最初のメニュー画面を一瞬出さない（育成モードがすぐ開く）
  $('#start').onclick = safeStart;
  $('#newGame').onclick = () => { stop(); showScreen('setup'); };
  $('#pause').onclick = () => (playing ? stop() : play());
  // 版492：ピンチ（2本指で広げる・つまむ）で、近い・ふつう・遠いを切りかえ（パソコンは Ctrl＋ホイール）
  function setView(m) {
    if (!VIEWS[m] || m === viewMode) return; viewMode = m; VIEW_W = VIEWS[m].w; camPitchT = VIEWS[m].pitch;
    $$('[data-zoom]').forEach((x) => x.classList.toggle('active', x.dataset.zoom === m));
    resize(); if (!playing) draw();
    let t = document.getElementById('zoomTip'); if (!t) { t = document.createElement('div'); t.id = 'zoomTip'; $('#match .viewport').appendChild(t); }
    t.textContent = { near: '近い', normal: 'ふつう', far: '遠い' }[m]; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
  }
  { const ORDER = ['near', 'normal', 'far'], step = (d) => setView(ORDER[Math.max(0, Math.min(2, ORDER.indexOf(viewMode) + d))]);
    const vp = $('#match .viewport'); let d0 = 0, done = false;
    const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    vp.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = dist(e); done = false; } }, { passive: true });
    vp.addEventListener('touchmove', (e) => { if (e.touches.length !== 2 || !d0 || done) return; e.preventDefault(); const r = dist(e) / d0; if (r > 1.3) { step(-1); done = true; } else if (r < 0.77) { step(1); done = true; } }, { passive: false });
    vp.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
    vp.addEventListener('gesturestart', (e) => e.preventDefault());
    let wl = 0; vp.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); const now = performance.now(); if (now - wl < 350) return; wl = now; step(e.deltaY < 0 ? -1 : 1); }, { passive: false });
  }
  $$('[data-zoom]').forEach((b) => (b.onclick = () => {
    viewMode = b.dataset.zoom; VIEW_W = VIEWS[viewMode].w; camPitchT = VIEWS[viewMode].pitch;
    $$('[data-zoom]').forEach((x) => x.classList.toggle('active', x === b));
    resize(); if (!playing) draw();
  }));
  $$('[data-speed]').forEach((b) => (b.onclick = () => { speed = +b.dataset.speed; $$('[data-speed]').forEach((x) => x.classList.toggle('active', x === b)); if (!playing && $('#half').hidden) play(); }));
  $('#skip').onclick = () => { simT = match.duration; draw(); finish(); };
  $('#again').onclick = safeStart;
  { const again = $('#again'), b = document.createElement('button'); b.id = 'backCareer'; b.textContent = '育成に戻る'; b.className = 'primary'; b.hidden = true; b.style.marginTop = '8px';
    again.parentElement.appendChild(b);
    b.onclick = () => { const fn = onMatchDone; onMatchDone = null; b.hidden = true; $('#again').hidden = false; if (fn) fn(match.score.slice()); }; }
  { const again = $('#again'), b = document.createElement('button'); b.id = 'replayDigest'; b.textContent = 'ハイライトをもう一度'; b.className = 'primary'; b.style.marginTop = '8px'; b.style.marginRight = '8px';
    again.parentElement.insertBefore(b, again);
    b.onclick = () => { if (!goals.length) return; showScreen('match'); startDigest(); play(); }; }
  $$('[data-panel]').forEach((b) => b.addEventListener('click', () => {
    // 育成モード：試合中の「選手交代」はいつでも交代・作戦変更の画面を開く
    if (b.dataset.panel === 'subs' && mctx && mctx.opts.onSub && $('#half').hidden) { closePlv(); openSub(false); return; }
    // 試合中の「選手」：止めずに一覧を重ねる（ハーフタイムの画面からは今までどおり）
    if (b.dataset.panel === 'players' && $('#half').hidden) { openPlv(); return; }
    if (b.dataset.panel === 'status') { openMatchStatus(); return; }   // 状況：ハーフタイムと同じ画面
    stop(); panel(b.dataset.panel);
  }));
  // 交代・作戦の画面を開く（atHalf：ハーフタイム）。決めた内容で試合を計算し直して、今の場面から続ける
  function openSub(atHalf) {
    if (!mctx || !mctx.opts.onSub) return;
    if (!atHalf) {
      if (show && show.phase !== 'kickoff') { flash($('#policy'), 'ゴールの演出のあとで交代できます', 2000); return; }
      if (simT >= match.duration - 2) return;
    }
    const wasPlaying = playing; stop();
    const t = atHalf ? halfT : simT, st = stateAt(t);
    mctx.opts.onSub({
      atHalf, t,
      minute: Math.min(90, Math.ceil((t * match.clockScale) / 60)),
      stamina: st.players.slice(0, 11).map((p) => p.st),
      score: [0, 1].map((ti) => goals.filter((g) => g.t < t && g.team === ti).length),
      cancel: () => { if (!atHalf && wasPlaying) play(); },
      apply: (changes, cb) => { careerChanges = changes.slice(); applyHalf([...changes, ...(tacChange ? [tacChange] : [])], (subs) => {
        if (atHalf) {
          $('#halfStats').innerHTML = statsHtml(halfT, '前半終了');
        } else {
          lastBall = null; ballTrail.length = 0; trail = [];
          play();
        }
        if (cb) cb(subs);
      }); },
    });
  }
  $('.close').onclick = () => { showOverlay(null); if (!lk) play(); };   // ロッカールームから開いた時は試合を進めない
  $('#htTac') && ($('#htTac').onclick = () => openSub(true));
  $('#second').onclick = () => startSecondHalf();
  function startSecondHalf() {
    showOverlay(null);
    const hs = match.events.filter((e) => e.type === 'sub' && Math.abs(e.t - halfT) < 1);
    // 後半は配置についた状態から始める（ワープして見えないように、配置後の記録まで進めておく）
    simT = halfT + match.frameDt * 2.5;
    while (evIndex < match.events.length && match.events[evIndex].t <= simT) evIndex++;
    lastBall = null; ballTrail.length = 0;
    show = { phase: 'kickoff', hold: true, koT: simT, start: simT, goal: null, rt: 0 }; cam.init = false;
    if (hs.length) startSubShow(hs, show);   // ハーフタイムの交代：後半のキックオフ前に交代ボード
    play();
  }
  c.onclick = (e) => {
    if (!match || !B) return;   // 入場シーンなどカメラが決まる前のタップは無視
    const r = c.getBoundingClientRect();
    // object-fit: contain の余白を考える
    const scale = r.width / CW;
    const ox = (r.width - CW * scale) / 2, oy = (r.height - CH * scale) / 2;
    const mx = (e.clientX - r.left) / scale, my = (e.clientY - r.top) / (r.height / CH);
    const st = stateAt(simT);
    let best = -1, bd = 1e9;
    st.players.forEach((p, i) => { const q = proj(p.x, p.y); const d = Math.hypot(q.x - mx, q.y - 22 * q.s - my); if (d < bd) { bd = d; best = i; } });
    if (bd < 50) { selected = best === selected ? -1 : best; trail = []; draw(); }
  };
  // 動作確認用
  // 版460：クラブハウスの練習の絵（試合と同じ「写した走り」の絵を、向きの角度と走りの位置で）
  function artSprite(info, team, fa, phase, moving, gk) {
    if (!DM.on) return null;
    const col = gk ? GKC[team] : TEAM[team];
    const o = { facing: fa, shirt: col.W, shorts: col.P, socks: col.K, hair: hairOf(info), skin: SKIN[info.skin || 0], pose: moving ? 'run' : 'stand' };
    if (col.pat && col.pat !== 'solid' && !gk) { o.pat = col.pat; o.sub = col.S; }
    if (gk) o.glove = '#f4f4f0';
    if (ART_RUN) { o.art = true; if (moving) o.frame = DotMan.artFrame(fa, phase); } else if (moving) o.frame = Math.floor(((phase % 1) + 1) % 1 * 8);
    const F = DotMan.frame(o);
    return { F, k: DotMan.fitScale(F, fa, o.pose) };
  }
  // 育成画面などで使うドット絵（試合と同じ選手の絵）
  function spriteCanvas(info, team, view, frame, run, gk) {
    const col = gk ? GKC[team] : TEAM[team];
    const key = ['ui', view, frame, run ? 1 : 0, team, gk ? 1 : 0, info.hair, info.hairColor, info.skin, col.W, col.P, col.K, col.pat || '', col.S || ''].join('|');
    let cv = sprCache.get(key);
    if (!cv && DM.on) {
      // 試合と同じカルチョビットA風の絵（18×24ドットに切り出す）
      const VA = { side: 0, f34: Math.PI / 4, front: Math.PI / 2, b34: -Math.PI / 4, back: -Math.PI / 2 };
      const o = { facing: VA[view] ?? Math.PI / 2, shirt: col.W, shorts: col.P, socks: col.K, hair: hairOf(info), skin: SKIN[info.skin || 0], pose: run ? 'run' : 'stand', frame: run ? [1, 3, 5, 7][frame % 4] : 0 };
      if (col.pat && col.pat !== 'solid' && !gk) { o.pat = col.pat; o.sub = col.S; }
      if (gk) o.glove = '#f4f4f0';
      const F = DotMan.frame(o);
      cv = document.createElement('canvas'); cv.width = SPR_W; cv.height = SPR_H;
      cv.getContext('2d').drawImage(F.cv, F.px - 9, F.py - 24, SPR_W, SPR_H, 0, 0, SPR_W, SPR_H);
      sprCache.set(key, cv);
    }
    if (!cv) { cv = genSprite({ view, frame: frame % 4, pose: null, armsUp: false, run: !!run, fast: false, col, skin: SKIN[info.skin || 0], hair: hairOf(info), style: (info.hair || 0) % 4 }); sprCache.set(key, cv); }
    return cv;
  }
  // ================= ハーフタイム（カルチョビットA）：笛 → 暗転 → ロッカールーム（選手交代・戦術・状況・後半開始） =================
  //  ロッカーの画面では時間（20秒）が減っていき、0になるか「後半開始」で後半へ。選手交代・戦術・状況を見ている間は止まる
  const LK_SEC = 20;
  const LK_TAC_SVG = '<svg viewBox="0 0 60 56" class="rb-svg"><rect x="2" y="4" width="56" height="48" rx="2" fill="#fff" stroke="#bbb"/><rect x="34" y="8" width="20" height="40" fill="#cfeedd" stroke="#8c8" stroke-width=".8"/><line x1="44" y1="8" x2="44" y2="48" stroke="#8c8" stroke-width=".8"/><rect x="6" y="18" width="7" height="18" fill="none" stroke="#888"/><circle cx="20" cy="14" r="2" fill="#e33"/><circle cx="22" cy="26" r="2" fill="#e33"/><circle cx="20" cy="38" r="2" fill="#e33"/><circle cx="28" cy="20" r="2" fill="#e33"/><circle cx="28" cy="32" r="2" fill="#e33"/><circle cx="38" cy="16" r="2" fill="#23c"/><circle cx="40" cy="28" r="2" fill="#23c"/><circle cx="38" cy="40" r="2" fill="#23c"/><circle cx="31" cy="44" r="2" fill="#f2c21c"/><path d="M14 46 q6-6 12-2" stroke="#e33" fill="none" stroke-width="1.2"/></svg>';   // 試合前の「戦術」ボタンと同じ絵
  let lk = null;             // ロッカールームの状態
  let careerChanges = [];    // 育成モードの交代（選手交代のボード）で決めた変更
  let tacChange = null;      // 戦術のホワイトボードで決めた変更
  function lkEl() {
    let el = document.getElementById('locker');
    if (el) return el;
    el = document.createElement('div'); el.id = 'locker'; el.className = 'lk-wrap'; el.hidden = true;
    el.innerHTML = `<div class="lk-box"><canvas class="lk-room" width="640" height="360"></canvas>
      <div class="lk-btns">
        <button class="lk-rb" data-a="subs"><img src="icons/btn_change.png" alt=""><b>選手交代</b></button>
        <button class="lk-rb lk-green" data-a="tac"><span class="lk-tac">${LK_TAC_SVG}</span><b>戦術</b></button>
        <button class="lk-rb" data-a="stat"><img src="icons/btn_status.png" alt=""><b>状況</b></button>
      </div>
      <button class="lk-rb lk-go lk-goimg" data-a="go" title="後半開始"><img src="icons/btn_second.png" alt="後半開始"></button>
      <div class="lk-count"><span>20</span></div>
      <div class="lk-sub" hidden></div>
      <div class="lk-black"></div></div>`;
    (document.getElementById('app') || document.body).appendChild(el);   // 交代のボード（#app の中）が上に重なるように
    const fit = () => { const box = el.querySelector('.lk-box'); const A = document.getElementById('app'), W = el.clientWidth || (A && A.clientWidth) || innerWidth, H = el.clientHeight || (A && A.clientHeight) || innerHeight; const k = H / 720, bw = Math.max(1280, Math.round(W / k)); box.style.width = bw + 'px'; box.style.transform = `translate(-50%,-50%) scale(${k.toFixed(4)})`; };   /* 版556：横長の画面では部屋を横に広げて、黒い余白を出さない（ボタンは左右の端に付く） */
    addEventListener('resize', fit); el._fit = fit;
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
      if (!lk || lk.leaving) return;
      const a = b.dataset.a;
      if (mctx && mctx.opts.lockEdit && (a === 'subs' || a === 'tac')) return;   // 版622：ルーム対戦は変更なし
      if (a === 'go') return lkStartSecond();
      if (a === 'stat') return lkStatus();
      if (a === 'tac') return lkBoard();
      if (a === 'subs') {
        if (mctx && mctx.opts.onSub) openSub(true);
        else { panel('subs'); }
      }
    });
    return el;
  }
  function openLocker() {
    const el = lkEl();
    { const fb = document.getElementById('premFF'); if (fb) fb.hidden = true; }   // 版769：ロッカーでは早送りを出さない（後半ボタンと重なる）
    el.querySelectorAll('[data-a="subs"],[data-a="tac"]').forEach((b) => { b.style.visibility = (mctx && mctx.opts.lockEdit) ? 'hidden' : ''; });
    lk = { t0: performance.now(), left: LK_SEC, last: performance.now(), leaving: false, raf: 0, sit: lkSeats() };
    SND().crowd('duck');   // 版734：ハーフタイムの曲は流さない（観客の声を小さくするだけ）
    el.hidden = false; el._fit(); el.querySelector('.lk-sub').hidden = true;   // 版556：見えてから大きさを合わせる（黒い余白が出ていた）
    { const w = !!(mctx && mctx.opts && mctx.opts.watch); el.querySelector('.lk-btns').style.visibility = w ? 'hidden' : ''; }   // 観戦：交代・戦術はない
    const bl = el.querySelector('.lk-black'); bl.style.transition = 'none'; bl.style.opacity = '1';
    requestAnimationFrame(() => { bl.style.transition = 'opacity .7s'; bl.style.opacity = '0'; });
    const tick = (now) => {
      if (!lk) return;
      const dt = Math.min(0.1, (now - lk.last) / 1000); lk.last = now;
      // 選手交代・戦術・状況を見ている間は、時間を止める
      const busy = !el.querySelector('.lk-sub').hidden || !$('#panel').hidden || (document.getElementById('htModal') && !document.getElementById('htModal').hidden) || !!window.__tutHold;
      if (!busy && !lk.leaving) lk.left = Math.max(0, lk.left - dt);
      const n = Math.ceil(lk.left); const ce = el.querySelector('.lk-count span');
      if (ce.textContent !== String(n)) { ce.textContent = String(n); ce.parentElement.classList.remove('pulse'); void ce.parentElement.offsetWidth; ce.parentElement.classList.add('pulse'); }
      drawLockerRoom(el.querySelector('.lk-room').getContext('2d'), (now - lk.t0) / 1000);
      if (lk.left <= 0 && !lk.leaving && !busy) { lkStartSecond(); }
      lk.raf = requestAnimationFrame(tick);
    };
    lk.raf = requestAnimationFrame(tick);
  }
  function closeLocker() {
    const el = document.getElementById('locker');
    if (lk) cancelAnimationFrame(lk.raf);
    lk = null; if (el) el.hidden = true;
    SND().bgm(null); if (!$('#match').hidden) SND().crowd(true);
  }
  // 後半開始：暗転してからキックオフへ
  function lkStartSecond() {
    if (!lk || lk.leaving) return;
    lk.leaving = true;
    const el = document.getElementById('locker'), bl = el.querySelector('.lk-black');
    el.querySelector('.lk-sub').hidden = true;
    bl.style.transition = 'opacity .5s'; bl.style.opacity = '1';
    setTimeout(() => { closeLocker(); startSecondHalf(); }, 560);
  }

  // ---------- ロッカールームの絵（斜め上から見た部屋：ロッカー・ベンチ・ホワイトボード・マッサージ台） ----------
  const LK_O = { x: 410, y: 10, k: 17 };
  // 脚つきの長いす（u0, v0, u1, v1）とマッサージ台
  const LK_BENCH = [[4.0, 5.0, 7.0, 5.6], [7.0, 3.0, 10.0, 3.6], [5.2, 8.2, 8.2, 8.8], [9.0, 6.0, 12.0, 6.6], [10.6, 8.8, 13.6, 9.4], [8.2, 10.6, 11.2, 11.2]];
  const LK_TABLE = [[3.6, 12.6, 6.2, 13.5], [8.4, 14.2, 11.0, 15.1], [13.0, 12.2, 15.6, 13.1], [17.0, 9.0, 19.6, 9.9], [13.6, 16.0, 16.2, 16.9]];
  const iso = (u, v, z = 0) => [LK_O.x + (u - v) * LK_O.k, LK_O.y + (u + v) * LK_O.k / 2 - z];
  function lkSeats() {
    // ベンチに座る選手・マッサージ台に寝る選手・立っている選手（スタメン11人＋控え）
    const out = [], ord = [...Array(11).keys()];
    // ベンチの上に等間隔で座る（b：何番目のベンチ）
    // [場所, u, 向き]：場所が数字＝その長いす、'w'＝ロッカー前のベンチ、'L'＝マッサージ台（番号）
    const seats = [['w', 3.2, 'f34'], ['w', 4.4, 'f34'], ['w', 8.6, 'f34'], [0, 5.0, 'front'], [0, 6.2, 'back'], [1, 8.4, 'front'], [2, 6.6, 'back'], [3, 10.4, 'front'], [4, 12.0, 'front'], ['L', 0], ['L', 2]];
    ord.forEach((k, j) => {
      const q = seats[j] || ['L', 3];
      if (q[0] === 'w') out.push({ k, u: 0.8, v: q[1], pose: 'wall', view: q[2], ph: j * 0.7 });
      else if (q[0] === 'L') { const T = LK_TABLE[q[1]]; out.push({ k, u: T[0] + 0.3, v: (T[1] + T[3]) / 2, tb: q[1], pose: 'lie', ph: 0 }); }
      else { const B = LK_BENCH[q[0]]; out.push({ k, u: q[1], v: (B[1] + B[3]) / 2, b: q[0], pose: 'sit', view: q[2], ph: j * 0.7 }); }
    });
    return out;
  }
  function lkPoly(c, pts, fill, stroke) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); } }
  // 床の上の箱（u,v の範囲・高さ h）
  function lkBox(c, u0, v0, u1, v1, h, top, left, right, z0 = 0) {
    const A = iso(u0, v1, z0 + h), B = iso(u1, v1, z0 + h), Cc = iso(u1, v0, z0 + h), Dd = iso(u0, v0, z0 + h);
    const a = iso(u0, v1, z0), b = iso(u1, v1, z0), cc = iso(u1, v0, z0);
    lkPoly(c, [A, B, b, a], left, 'rgba(0,0,0,.35)');      // 手前左の面
    lkPoly(c, [B, Cc, cc, b], right, 'rgba(0,0,0,.35)');   // 手前右の面
    lkPoly(c, [A, B, Cc, Dd], top, 'rgba(0,0,0,.25)');     // 上の面
  }
  function lkSprite(c, info, gk, x, y, sc, view, cut) {
    const spr = spriteCanvas(info, 0, view || 'f34', 0, false, gk);
    if (!spr) return;
    const w = SPR_W, h = SPR_H, ch = cut ? h - cut : h;
    c.drawImage(spr, 0, 0, w, ch, Math.round(x - (w * sc) / 2), Math.round(y - ch * sc), Math.round(w * sc), Math.round(ch * sc));
  }
  function drawLockerRoom(c, t) {
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#b9bdb5'; c.fillRect(0, 0, 640, 360);
    const U = 40, V = 40, WH = 80;
    // 床（緑のカーペット）
    lkPoly(c, [iso(0, 0), iso(U, 0), iso(U, V), iso(0, V)], '#5d9a68');
    c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1;
    for (let u = 0; u <= U; u += 2) { const [x0, y0] = iso(u, 0), [x1, y1] = iso(u, V); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    for (let v = 0; v <= V; v += 2) { const [x0, y0] = iso(0, v), [x1, y1] = iso(U, v); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    // 奥の壁（左：ロッカーの壁／右：ホワイトボードの壁）
    lkPoly(c, [iso(0, V, WH), iso(0, 0, WH), iso(0, 0), iso(0, V)], '#cfd3cc');
    lkPoly(c, [iso(0, 0, WH), iso(U, 0, WH), iso(U, 0), iso(0, 0)], '#e3e5df');
    lkPoly(c, [iso(0, 0, 6), iso(U, 0, 6), iso(U, 0), iso(0, 0)], '#9aa198');
    // ロッカー（左の壁にずらっと。ユニフォームが掛かっている）
    const col = TEAM[0];
    for (let v = 0.3; v < V - 0.5; v += 1.05) {
      const a = iso(0.05, v, 54), b = iso(0.05, v + 0.95, 54), b2 = iso(0.05, v + 0.95, 8), a2 = iso(0.05, v, 8);
      lkPoly(c, [a, b, b2, a2], '#f3f1ea', '#8c8a80');
      // 上の棚（木）
      lkPoly(c, [iso(0, v, 58), iso(0, v + 1.05, 58), iso(1.1, v + 1.05, 58), iso(1.1, v, 58)], '#b98545', '#7a5222');
      lkPoly(c, [iso(1.1, v, 58), iso(1.1, v + 1.05, 58), iso(1.1, v + 1.05, 54), iso(1.1, v, 54)], '#8e6230');
      // ユニフォーム
      const m = iso(0.1, v + 0.48, 40);
      c.fillStyle = col.W; c.fillRect(m[0] - 4, m[1] - 2, 8, 9); c.fillStyle = col.D; c.fillRect(m[0] - 4, m[1] - 2, 8, 2);
      c.fillStyle = '#fff'; c.fillRect(m[0] - 1, m[1] + 2, 2, 3);
      // 下のベンチ（木）
      lkBox(c, 0.1, v, 1.2, v + 1.05, 12, '#c48d4b', '#9b6a32', '#8a5c2a');
    }
    // ホワイトボード（右奥、脚つき）
    { const u0 = 7.2, v0 = 1.2;
      c.strokeStyle = '#6d6f6a'; c.lineWidth = 2;
      for (const [du, dv] of [[0, 0], [3.2, 0]]) { const [x0, y0] = iso(u0 + du, v0 + dv), [x1, y1] = iso(u0 + du, v0 + dv, 34); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
      const A = iso(u0 - 0.2, v0, 84), B = iso(u0 + 3.4, v0, 84), Cc = iso(u0 + 3.4, v0, 34), Dd = iso(u0 - 0.2, v0, 34);
      lkPoly(c, [A, B, Cc, Dd], '#fbfbf8', '#55575a');
      // 板の上のピッチ
      const P = (fu, fz) => iso(u0 + 0.2 + fu * 2.8, v0, 40 + fz * 38);
      c.strokeStyle = '#3a8fd8'; c.lineWidth = 1; lkPoly(c, [P(0, 0), P(1, 0), P(1, 1), P(0, 1)], null, '#3a8fd8');
      c.beginPath(); c.moveTo(...P(0.5, 0)); c.lineTo(...P(0.5, 1)); c.stroke();
      c.fillStyle = '#e8241c'; for (const [fu, fz] of [[0.25, 0.3], [0.3, 0.7], [0.68, 0.5]]) { const [x, y] = P(fu, fz); c.fillRect(x - 1, y - 1, 3, 3); }
      c.fillStyle = '#2a62d8'; for (const [fu, fz] of [[0.42, 0.45], [0.8, 0.25], [0.78, 0.75]]) { const [x, y] = P(fu, fz); c.fillRect(x - 1, y - 1, 3, 3); }
    }
    // 描く順番（奥から手前へ）
    const items = [];
    // ベンチ（青）
    const legs = (u0, v0, u1, v1, h, col) => { c.strokeStyle = col; c.lineWidth = 2; for (const [u, v] of [[u0 + 0.15, v1 - 0.1], [u1 - 0.15, v1 - 0.1], [u1 - 0.15, v0 + 0.1]]) { const [x0, y0] = iso(u, v), [x1, y1] = iso(u, v, h); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); } };
    for (const [u0, v0, u1, v1] of LK_BENCH) items.push({ d: u1 + v1, f: () => { legs(u0, v0, u1, v1, 6, '#5a5f66'); lkBox(c, u0, v0, u1, v1, 2, '#4a78d8', '#2f57a8', '#284b94', 6); } });
    // マッサージ台（黒）とトレーナー
    for (const [u0, v0, u1, v1] of LK_TABLE) items.push({ d: u1 + v1, f: () => { legs(u0, v0, u1, v1, 9, '#b9bdc2'); lkBox(c, u0, v0, u1, v1, 3, '#3b3d40', '#26282b', '#1e2022', 9); lkBox(c, u0 + 0.15, v0 + 0.2, u0 + 0.8, v1 - 0.2, 1.5, '#8c4a2e', '#6b351f', '#5a2c19', 12); } });
    // スタッフ（白い服）
    const staff = [[6.6, 12.3], [16.1, 12.0], [11.4, 14.0]];
    if (!(lk && lk.empty)) for (const [u, v] of staff) items.push({ d: u + v + 0.2, f: () => { const [x, y] = iso(u, v); lkStaff(c, x, y + 1, t + u); } });
    // 選手
    const sit = lk && lk.empty ? [] : lk ? lk.sit : lkSeats();
    for (const s of sit) {
      const info = rinfo(0, s.k, halfT), gk = info.position === 'GK';
      const bob = () => (Math.sin(t * 2.2 + s.ph) > 0.92 ? 1 : 0);
      if (s.pose === 'sit') items.push({ d: LK_BENCH[s.b][2] + LK_BENCH[s.b][3] + 0.01 + s.u * 0.001, f: () => { const [x, y] = iso(s.u, s.v, 8); lkSprite(c, info, gk, x, y + 4 - bob(), 1.1, s.view || 'front', 6); } });
      else if (s.pose === 'wall') items.push({ d: 1.3 + s.v + 0.01, f: () => { const [x, y] = iso(s.u, s.v, 12); lkSprite(c, info, gk, x, y + 4 - bob(), 1.1, s.view || 'f34', 6); } });
      else items.push({ d: LK_TABLE[s.tb][2] + LK_TABLE[s.tb][3] + 0.02, f: () => {
        const [x, y] = iso(s.u + 1.1, s.v, 15), spr = spriteCanvas(info, 0, 'front', 0, false, gk); if (!spr) return;
        c.save(); c.translate(x, y); c.rotate(-Math.PI / 2 + 0.46); c.drawImage(spr, -SPR_W * 0.55, -SPR_H * 0.55, SPR_W * 1.1, SPR_H * 1.1); c.restore(); } });
    }
    items.sort((a, b) => a.d - b.d).forEach((it) => it.f());
    // 薄い影で奥行き
    const g = c.createLinearGradient(0, 0, 0, 360); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.12)'); c.fillStyle = g; c.fillRect(0, 0, 640, 360);
  }
  function lkStaff(c, x, y, t) {
    if (!DM.on) return;
    const k = 'lkstaff';
    let cv = sprCache.get(k);
    if (!cv) {
      const F = DotMan.frame({ facing: Math.PI / 2 + 0.6, shirt: '#f4f4f0', shorts: '#e8e8e2', socks: '#f4f4f0', hair: HAIR[1], skin: SKIN[1], pose: 'stand', frame: 0 });
      cv = document.createElement('canvas'); cv.width = SPR_W; cv.height = SPR_H;
      cv.getContext('2d').drawImage(F.cv, F.px - 9, F.py - 24, SPR_W, SPR_H, 0, 0, SPR_W, SPR_H); sprCache.set(k, cv);
    }
    c.drawImage(cv, Math.round(x - SPR_W * 0.55), Math.round(y - SPR_H * 1.1), Math.round(SPR_W * 1.1), Math.round(SPR_H * 1.1));
  }

  // ---------- 状況：前半のスタッツ・得点・欠場選手・途中経過・見つかった課題 ----------
  function lkStatus() { renderStatus(document.querySelector('#locker .lk-sub'), halfT, '前半終了', 45); }
  // 試合中の「状況」ボタン：ハーフタイムと同じ画面（その時点まで）。閉じたら試合の続きから
  function openMatchStatus() {
    const wasPlaying = playing; stop(); closePlv();
    let el = document.getElementById('mstat');
    if (!el) {
      el = document.createElement('div'); el.id = 'mstat'; el.className = 'lk-wrap lk-clear';
      el.innerHTML = '<div class="lk-box"><div class="lk-sub"></div></div>';
      (document.getElementById('app') || document.body).appendChild(el);
      const fit = () => { const k = Math.min((el.clientWidth || innerWidth) / 1280, (el.clientHeight || innerHeight) / 720); el.querySelector('.lk-box').style.transform = `translate(-50%,-50%) scale(${k.toFixed(4)})`; };
      addEventListener('resize', fit); el._fit = fit;
    }
    el.hidden = false; el._fit();   // 版534：隠れたまま大きさを測ると0になり、画面が小さく縮んでいた
    const t = simT, second = t >= halfT, m = Math.max(1, Math.min(90, Math.ceil((t * match.clockScale) / 60)));
    const ws = document.getElementById('wStop'), wsWas = ws && !ws.hidden; if (ws) ws.hidden = true;   // 版535：状況の画面には自分のもどるボタンがあるので、観戦をやめるボタンは隠す
    renderStatus(el.querySelector('.lk-sub'), t, `${second ? '後半' : '前半'}　${m}分`, m, () => { el.hidden = true; if (ws && wsWas) ws.hidden = false; if (wasPlaying) play(); });
  }
  function renderStatus(sub, T0, title, minute, onBack, final) {
    const { S2, pos } = statsUntil(T0);
    const sc = [S2[0].goals.length, S2[1].goals.length];
    const o = mctx ? mctx.opts : {};
    const head = `${o.comp || '親善試合'}${o.label ? '　' + o.label : ''}`;
    const emb = (u) => (u ? `<img src="${u}" alt="">` : '<i class="lk-emb0"></i>');
    const rows = [
      [`${S2[0].shots}（${S2[0].on}）`, 'シュート（枠内）', `${S2[1].shots}（${S2[1].on}）`],
      [S2[0].corners, 'コーナーキック', S2[1].corners],
      [S2[0].pk, 'ペナルティキック', S2[1].pk],
      [S2[0].off, 'オフサイド', S2[1].off],
      [S2[0].fouls, 'ファウル', S2[1].fouls],
      [`<i class="yc"></i>${S2[0].y}／<i class="rc"></i>${S2[0].r}`, 'カード', `<i class="yc"></i>${S2[1].y}／<i class="rc"></i>${S2[1].r}`],
      [`${pos[0]}%`, 'ボール支配率', `${pos[1]}%`],
    ];
    const POSC = { GK: 'pv-gk', DF: 'pv-df', MF: 'pv-mf', FW: 'pv-fw' };
    // 得点：真ん中に時間、左のチームのゴールは左に、右のチームのゴールは右に名前
    const who = (g) => { const i = idxOf(g.team, g.number), info = i >= 0 ? rinfo(g.team, i % 11, g.t) : { position: '' }; return `<i class="pv-pos ${POSC[info.position] || ''}">${info.position || ''}</i><b>${g.number}</b><span>${plvEsc(g.player)}</span>`; };
    const goalsList = [...S2[0].goals, ...S2[1].goals].sort((a, b) => a.t - b.t).map((g) => {
      const m = Math.ceil((g.t * match.clockScale) / 60), mm = g.t < halfT ? Math.min(m, 45) : Math.min(m, 90);
      return `<div class="lk-gl2"><div class="lk-gside l">${g.team === 0 ? who(g) : ''}</div><em>${mm}'</em><div class="lk-gside r">${g.team === 1 ? who(g) : ''}</div></div>`;
    }).join('') || '<p class="lk-none">得点はありません</p>';
    const ab = (o.absent || []).map((a) => `<div class="lk-gl home"><i class="pv-pos ${POSC[a.pos] || ''}">${a.pos}</i><b>${a.number}</b><span>${plvEsc(a.name)}</span><em>${a.why || `ケガ（あと${a.weeks}週）`}</em></div>`).join('') || '<p class="lk-none">欠場している選手はいません</p>';
    let prog = '<p class="lk-none">同じ時間帯の試合はありません</p>';
    try {
      const h = o.halfOthers ? o.halfOthers(sc, minute) : null;
      if (h) {
        prog = `<div class="lk-lg"><b>${plvEsc(h.league)}</b>　第${h.round}節</div><div class="lk-games">${h.games.map((g) => `<div class="lk-game"><span>${plvEsc(g.home)}</span><b>${g.s[0]} − ${g.s[1]}</b><span>${plvEsc(g.away)}</span><small>${final ? '試合終了' : minute >= 45 && T0 <= halfT + 0.01 ? '前半終了' : minute + '分'}</small></div>`).join('')}</div>
          <table class="lk-tbl"><tr><th>暫定順位</th><th></th><th>勝点</th><th>得点</th><th>失点</th><th>得失</th></tr>${h.table.map((t, k) => `<tr class="${t.me ? 'me' : ''}"><td>${k + 1}</td><td>${plvEsc(t.name)}</td><td>${t.Pts}</td><td>${t.GF}</td><td>${t.GA}</td><td>${t.GF - t.GA}</td></tr>`).join('')}</table>`;
      }
    } catch (e) { /* 途中経過が出せなくても他は見せる */ }
    const iss = match.events.filter((e) => e.type === 'issue' && e.team === 0 && e.t <= T0);
    const cards = iss.map((e) => { const id = ISSUE_CARD[e.key]; return id ? cardTag(id, e.card) : ''; }).join('') || '<p class="lk-none">まだ課題は見つかっていません</p>';
    const sec = (k, title, body, open) => `<div class="lk-sec${open ? ' open' : ''}" data-k="${k}"><button class="lk-sech">${title}<i></i></button><div class="lk-secb">${body}</div></div>`;
    sub.innerHTML = `<div class="lk-stat"><div class="lk-sthead"><small>${plvEsc(head)}</small><div class="lk-score"><span>${plvEsc(match.homeShort)}</span>${emb(o.embH)}<b>${sc[0]}−${sc[1]}</b>${emb(o.embA)}<span>${plvEsc(match.awayShort)}</span></div><em>${title}</em></div>
      <div class="lk-rows">${rows.map((r) => `<div class="lk-row"><span>${r[0]}</span><b>${r[1]}</b><span>${r[2]}</span></div>`).join('')}</div>
      ${sec('g', '得点', goalsList, false)}${sec('a', '主な欠場選手', ab, false)}${o.halfOthers === null ? '' : sec('p', final ? '試合結果' : '途中経過', prog, false)}
      </div><button class="lk-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button>`;
    sub.hidden = false;
    sub.querySelectorAll('.lk-sech').forEach((b) => b.onclick = () => b.parentElement.classList.toggle('open'));
    sub.querySelector('.lk-back').onclick = () => { sub.hidden = true; if (onBack) onBack(); };
  }

  // ---------- 戦術：ホワイトボード（相手の並び・ゾーンの高さと幅・マーク・攻守の意識） ----------
  let tacState = null;
  function lkBoard() {
    const sub = document.querySelector('#locker .lk-sub');
    const mine = (mctx && mctx.mine) || {};
    if (!tacState) tacState = { att: mine.attitude || 'balanced', line: mine.line_height || 3, compact: mine.compact || 2, marks: [] };
    const st = { ...tacState, marks: tacState.marks.slice() };
    // 相手の前半の平均の位置（自分たちは左へ攻める。相手のゴールが左）
    const fr = match.frames, n = Math.min(fr.length, Math.floor(halfT / (match.frameDt || 0.1)));
    const avg = Array.from({ length: 11 }, () => [0, 0, 0]);
    for (let i = 0; i < n; i += 3) { const f = fr[i]; if (f[FIX + 66] !== 0) continue; const s0 = f[84] ?? 1; for (let k = 0; k < 11; k++) { const x = f[FIX + (11 + k) * 3], y = f[FIX + (11 + k) * 3 + 1]; const fxo = s0 > 0 ? 105 - x : x; avg[k][0] += fxo; avg[k][1] += s0 > 0 ? 68 - y : y; avg[k][2]++; } }
    let oSlots = null; try { if (mctx && mctx.theirs) oSlots = D.buildSlots(mctx.theirs); } catch (_) {}
    const PL = { x: 238, y: 118, w: 560, h: 362 };
    const bx = (m) => PL.x + (m / 105) * PL.w, by = (m) => PL.y + (m / 68) * PL.h;
    const ZC = { DF: 'd-df', MF: 'd-mf', FW: 'd-fw', GK: 'd-gk' };
    const zoneOf = () => { const c = 26 + (st.line - 1) * 8, w = [0, 34, 26, 18][st.compact] || 26; return { c, w }; };   // 自分のゴール（右）からの距離
    const att = [['attacking', '攻撃的'], ['balanced', 'バランス'], ['defensive', '守備的']];
    const oppName = match.awayShort, o = mctx ? mctx.opts : {};
    let pick = -1;
    const card = () => {
      if (pick < 0) return '';
      const info = rinfo(1, pick, halfT), pv = info.params || info, on = st.marks.includes(pick);
      const sp = stateAt(halfT).players[11 + pick];
      const gr = D.PARAMS.map((q) => { const g = o.grade ? o.grade(info, q.k, 1) : D.grade(pv[q.k]); return `<b class="g-${g}">${g}</b>`; }).join('');
      return `<div class="lk-pcard"><div class="lk-pch"><i class="pv-pos pv-${info.position.toLowerCase()}">${info.position}</i><b>${info.number}</b><span>${plvEsc(info.name)}</span>${plvBat(sp ? sp.st : 100)}</div>
        <div class="lk-pci">${D.PARAMS.map((q) => `<img src="icons/${q.k}.png" alt="">`).join('')}<em>タイプ</em></div><div class="lk-pcg">${gr}<em class="tbadge ${PLV_TYPE[info.type] || 'ty-bal'}${String(info.type || '').length >= 8 ? ' tlong' : ''}">${plvEsc(info.type)}</em></div>
        <button class="lk-mark${on ? ' off' : ''}">${on ? 'マークをはずす' : 'この選手をマーク'}</button></div>`;
    };
    const draw = () => {
      const z = zoneOf(), xr = bx(105 - (z.c - z.w / 2)), xl = bx(105 - (z.c + z.w / 2)), xc = bx(105 - z.c);
      const dots = avg.map((a, k) => {
        if (!a[2]) return '';
        const info = rinfo(1, k, halfT); if (info.position === 'GK') return '';
        const sl = oSlots && oSlots[k], px = sl ? 14 + sl.rel * 1.2 : a[0] / a[2], py = sl ? 68 - sl.y : a[1] / a[2];   // 版769：相手はフォーメーションの並び（協会のスタメン画面と同じ）で見せる
        return `<i class="lk-dot ${ZC[info.position] || 'd-mf'}${st.marks.includes(k) ? ' marked' : ''}${pick === k ? ' pick' : ''}" data-k="${k}" style="left:${bx(px).toFixed(0)}px;top:${by(py).toFixed(0)}px"></i>`;
      }).join('');
      sub.innerHTML = `<div class="lk-wb">
        <div class="lk-wbt">←攻撃方向</div>
        ${st.marks.length ? '<div class="lk-wbmark">マークしっかり</div>' : '<div class="lk-wbmark zone">ゾーンで守る</div>'}
        <div class="lk-pitch" style="left:${PL.x}px;top:${PL.y}px;width:${PL.w}px;height:${PL.h}px"><i class="lk-half"></i><i class="lk-circ"></i><i class="lk-boxl"></i><i class="lk-boxr"></i><i class="lk-sbl"></i><i class="lk-sbr"></i></div>
        <div class="lk-zone" style="left:${xl.toFixed(0)}px;width:${(xr - xl).toFixed(0)}px;top:${PL.y}px;height:${PL.h}px"></div>
        <div class="lk-zl lk-zw" data-z="l" style="left:${xl.toFixed(0)}px;top:${PL.y}px;height:${PL.h}px"><span>ゾーンの幅</span></div>
        <div class="lk-zl lk-zh" data-z="c" style="left:${xc.toFixed(0)}px;top:${PL.y}px;height:${PL.h}px"><span>ゾーンの高さ</span></div>
        <div class="lk-zl lk-zw" data-z="r" style="left:${xr.toFixed(0)}px;top:${PL.y}px;height:${PL.h}px"><span>ゾーンの幅</span></div>
        ${dots}
        <div class="lk-zok">ゾーン確認！</div>
        <div class="lk-opp">${o.embA ? `<img src="${o.embA}" alt="">` : ''}<span>${plvEsc(oppName)}戦</span></div>
        <div class="lk-att"><p>攻守の意識</p>${att.map(([v, nm]) => `<button data-v="${v}" class="${st.att === v ? 'on' : ''}">${nm}${st.att === v ? '<i>⚽</i>' : ''}</button>`).join('')}</div>
        ${card()}
        <button class="lk-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button></div>`;
      sub.querySelectorAll('.lk-dot').forEach((d) => d.onpointerdown = (e) => { e.stopPropagation(); const k = +d.dataset.k; pick = pick === k ? -1 : k; draw(); });
      const mk = sub.querySelector('.lk-mark');
      if (mk) mk.onclick = () => { const i = st.marks.indexOf(pick); if (i >= 0) st.marks.splice(i, 1); else { if (st.marks.length >= 2) st.marks.shift(); st.marks.push(pick); } draw(); };
      sub.querySelectorAll('.lk-att button').forEach((b) => b.onclick = () => { st.att = b.dataset.v; draw(); });
      sub.querySelector('.lk-wb').onpointerdown = (e) => { if (!e.target.closest('.lk-pcard,.lk-zl,.lk-att,.lk-back') && pick >= 0) { pick = -1; draw(); } };
      // ゾーンの線をドラッグ：真ん中の赤い線＝高さ、両わきの緑の線＝幅
      sub.querySelectorAll('.lk-zl').forEach((ln) => ln.onpointerdown = (e) => {
        e.preventDefault(); e.stopPropagation();
        const box = sub.querySelector('.lk-wb').getBoundingClientRect(), k = box.width / 1280, which = ln.dataset.z;
        const move = (ev) => {
          const x = (ev.clientX - box.left) / k, m = 105 - ((x - PL.x) / PL.w) * 105;   // 自分のゴールからの距離
          if (which === 'c') { const L = Math.max(1, Math.min(5, Math.round((m - 26) / 8) + 1)); if (L !== st.line) { st.line = L; draw(); } }
          else { const half = Math.abs(m - zoneOf().c), w = half * 2, cp = w > 30 ? 1 : w > 22 ? 2 : 3; if (cp !== st.compact) { st.compact = cp; draw(); } }
        };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
      sub.querySelector('.lk-back').onclick = () => {
        const ch = st.att !== tacState.att || st.line !== tacState.line || st.compact !== tacState.compact || st.marks.join() !== tacState.marks.join();
        sub.hidden = true;
        if (!ch) return;
        tacState = { ...st, marks: st.marks.slice() };
        tacChange = { team: 0, at: null, tac: { attitude: st.att, line_height: st.line, compact: st.compact, markOn: st.marks.slice() } };
        applyHalf([...careerChanges, tacChange]);
      };
    };
    sub.hidden = false; draw();
  }
  // ---------- 試合のあとのロッカールーム：だれもいない部屋で、コーチや選手が話す（本家） ----------
  //  lines：[{ name, face（画像のURL）, text, cards：[{ id, name }] }]。タップで次へ。最後まで行ったら暗転して done
  function lockerTalk(lines, done) {
    const el = lkEl(); el.hidden = false; el._fit(); el.classList.add('lk-talk');
    el.querySelector('.lk-sub').hidden = true;
    let dlg = el.querySelector('.lk-dlg');
    if (!dlg) { dlg = document.createElement('div'); dlg.className = 'lk-dlg'; dlg.innerHTML = '<img class="lk-face" alt="" style="visibility:hidden"><div class="lk-band"><b class="lk-name"></b><p class="lk-text"></p><div class="lk-cards2"></div><i class="lk-more">▶</i></div>'; el.querySelector('.lk-box').appendChild(dlg); }
    if (lk) cancelAnimationFrame(lk.raf);
    lk = { t0: performance.now(), left: 99, last: performance.now(), leaving: false, raf: 0, sit: [], empty: true, talk: true };
    const bl = el.querySelector('.lk-black'); bl.style.transition = 'none'; bl.style.opacity = '1';
    requestAnimationFrame(() => { bl.style.transition = 'opacity .6s'; bl.style.opacity = '0'; });
    let k = -1, shown = 0, full = '', typing = 0;
    const tick = (now) => { if (!lk || !lk.talk) return; drawLockerRoom(el.querySelector('.lk-room').getContext('2d'), (now - lk.t0) / 1000);
      if (shown < full.length) { typing += 1; if (typing % 2 === 0) { shown++; dlg.querySelector('.lk-text').textContent = full.slice(0, shown); } dlg.querySelector('.lk-more').style.visibility = 'hidden'; } else dlg.querySelector('.lk-more').style.visibility = 'visible';
      lk.raf = requestAnimationFrame(tick); };
    lk.raf = requestAnimationFrame(tick);
    const nextLine = () => {
      if (shown < full.length) { shown = full.length; dlg.querySelector('.lk-text').textContent = full; return; }   // 文字が出ている途中なら、まず全部出す
      k++;
      if (k >= lines.length) {
        dlg.onclick = null; bl.style.transition = 'opacity .5s'; bl.style.opacity = '1';
        setTimeout(() => { if (lk) cancelAnimationFrame(lk.raf); lk = null; el.hidden = true; el.classList.remove('lk-talk'); dlg.hidden = true; if (done) done(); }, 520);
        return;
      }
      const L = lines[k]; dlg.hidden = false;
      const img = dlg.querySelector('.lk-face'); img.classList.toggle('art', !!L.art); if (L.face) { img.style.display = ''; if (img.getAttribute('src') !== L.face) { img.style.visibility = 'hidden'; img.onload = () => { img.style.visibility = ''; }; img.onerror = () => { img.style.visibility = 'hidden'; }; img.src = L.face; } else img.style.visibility = ''; } else img.style.display = 'none';   /* 版559：絵が読めるまで隠す（iPhoneで一瞬、四角い枠が見えていた） */
      dlg.querySelector('.lk-name').textContent = L.name || '';
      full = L.text || ''; shown = 0; dlg.querySelector('.lk-text').textContent = '';
      dlg.querySelector('.lk-cards2').innerHTML = (L.cards || []).map((c) => cardTag(c.id, c.name)).join('');
    };
    dlg.onclick = nextLine; el.querySelector('.lk-room').onclick = nextLine;
    setTimeout(nextLine, 650);
  }
  // 版581：（テスト用）優勝の演出を見る：試合の最後まで飛ばして、すぐ優勝の演出へ
  function champDemo(ch) { if (!match) return false; closeLocker(); closePlv(); simT = match.duration; champTried = true; startChamp(ch); play(); return true; }
  window.addEventListener('unhandledrejection', (e) => showErr(e.reason, 'promise'));   // 版585：見えないエラーも左下に出す
  window.__app = { champDemo, applyKits, artSprite, kitSprite, kitCol, lockerTalk, startWith, showScreen, stop, spriteCanvas, SPR: { W: SPR_W, H: SPR_H }, get match() { return match; }, catchUp, get simT() { return simT; }, get playing() { return playing; }, RATE };
  window.__demo = { simT: () => simT, showPh: () => (show ? show.phase + (show.phase === "sub" ? "#" + show.rt.toFixed(2) + "k" + show.k + "n" + show.list.length : "") : null), playingNow: () => playing, poses: (list) => {
    ctx.fillStyle = '#45a31d'; ctx.fillRect(0, 0, CW, CH);
    list.forEach((pz, k) => { sprite(90 + k * 165, 270, 4.2, match.roster[0][9], 0, 1, 0, false, false, false, pz === 'side' ? null : pz, 0, 'side'); ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText(pz, 60 + k * 165, 300); });
  }, sheet: () => {
    ctx.fillStyle = '#45a31d'; ctx.fillRect(0, 0, CW, CH);
    const views = ['side', 'f34', 'front', 'b34', 'back'];
    views.forEach((v, r) => {
      for (let f = 0; f < 4; f++) sprite(80 + f * 100, 130 + r * 125, 1.8, match.roster[0][5 + r], 0, 1, f, true, false, false, null, 6, v);
      sprite(500, 130 + r * 125, 1.8, match.roster[1][3 + r], 1, 1, 0, false, false, false, null, 0, v);
      sprite(600, 130 + r * 125, 1.8, match.roster[0][1 + r], 0, 1, 0, false, false, false, null, 0, v);
    });
    const R = [[720, 130, 0, 9, 'windup', 'side', false], [830, 130, 0, 9, 'kick', 'side', false], [720, 255, 1, 9, 'jump', 'front', false], [830, 255, 1, 9, null, 'front', true], [720, 380, 0, 0, null, 'front', false], [830, 380, 1, 2, 'jump', 'side', false]];
    for (const [x, y, t, i, pose, v, up] of R) sprite(x, y, 1.8, match.roster[t][i], t, 1, 0, false, up, false, pose, 0, v);
    sprite(940, 130, 1.8, { col: { W: '#232323', L: '#4a4a4a', D: '#000', P: '#111', K: '#111' }, hair: 1, hairColor: 0, skin: 1 }, 0, 1, 0, false, false, false, null, 0, 'front');
}, selPos: () => { const st = stateAt(simT); const p = st.players[selected]; const q = proj(p.x, p.y); return [Math.round(q.x), Math.round(q.y)]; }, play: () => play(), camCheck: (step = 1 / 48, until) => { show = null; let out = 0, n = 0, flips = 0, maxJump = 0; const save = simT; let prev = null, prevD = null; for (let t = 0; t < (until || match.duration); t += step) { simT = t; draw(); const st = stateAt(t); const p = P3(st.ball.x, st.ball.y, st.ball.z); n++; if (st.code !== 6 && (p.x < 0 || p.x > CW || p.y < 0 || p.y > CH)) { out++; if (!window.__outs) window.__outs = []; if (window.__outs.length < 40) window.__outs.push([+t.toFixed(2), st.code]); } if (prev) { const d = [cam.x - prev[0], cam.y - prev[1]]; const m = Math.hypot(d[0], d[1]); if (m > maxJump && Math.abs(t - 225) > 1) maxJump = m; if (prevD && m > 0.15 && Math.hypot(prevD[0], prevD[1]) > 0.15 && d[0] * prevD[0] + d[1] * prevD[1] < 0) flips++; prevD = d; } prev = [cam.x, cam.y]; } simT = save; return { out, n, flips, maxJump: +maxJump.toFixed(2) }; }, select: (i) => { selected = i; trail = []; }, start: safeStart, seek: (t) => { show = null; simT = t; evIndex = match.events.findIndex((e) => e.t > t); if (evIndex < 0) evIndex = match.events.length; draw(); }, camPos: (t) => { simT = t; draw(); return [cam.x, cam.y]; }, seekPlay: (t) => { simT = t; fireEvents(); draw(); }, setSpeed: (v) => { speed = v; }, time: () => simT, showPhase: () => show && show.phase, camNow: () => [cam.x, cam.y, typeof zoom === 'number' ? zoom : 0, simT], get playing() { return playing; }, proj: (x, y) => { const q = proj(x, y); return [Math.round(q.x), Math.round(q.y)]; }, arAt: (t) => stateAt(t).ar, gkAt: (t) => stateAt(t).gk, stop, get match() { return match; } };
})();
