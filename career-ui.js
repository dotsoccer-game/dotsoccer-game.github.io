// 育成モードの画面（ホームの街 → クラブハウス → 選手データ／特訓 → スタジアムで試合）
(() => {
  'use strict';
  const D = window.DotSoccer, C = window.DotCareer, A = () => window.__app;
  const $ = (s) => document.querySelector(s);
  const KEY = 'dotsoccer.career.v1';
  const COIN = '<img class="coin-ico" src="icons/coin.png" alt="コイン" draggable="false">';
  const DCOIN = '<img class="coin-ico" src="icons/dcoin.png" alt="Dコイン" draggable="false">';   /* 版750：Dコイン（特訓カードを買えるコイン）の絵 */
  const POST_SVG = '<svg viewBox="0 0 48 48"><rect x="14" y="40" width="20" height="6" rx="1" fill="#7a1a1a"/><path d="M9 14a15 10 0 0 1 30 0v26H9z" fill="#e2322e" stroke="#fff" stroke-width="2.5"/><rect x="14" y="18" width="20" height="4" rx="2" fill="#3a0c0c"/><path d="M18 28h12M24 28v8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M17 32h14" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let save = null, view = 'home', raf = 0, selIdx = 9, cardTab = 'normal';

  // ---------- セーブ ----------
  function load() { try { const s = localStorage.getItem(KEY); if (s) { const o = JSON.parse(s); if (o && o.version === 1) return o; } } catch (e) { /* 保存できない環境 */ } return null; }
  function store() { try { if (save) save.savedAt = Date.now(); localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* 無視 */ } }
  function ensure() {
    if (!save) save = load();
    if (!save) { save = C.newCareer(); store(); }
    save.plan = save.plan || { team: 'base', cards: {} };
    save.plan.cards = save.plan.cards || {};
    save.cards = save.cards || { shoot: 3, dribble: 2, pass: 2, tech: 2, dash: 2, run: 2, muscle: 2, defend: 2, tactic: 2, massage: 1 };
    save.spFound = save.spFound || [];
    C.migrate(save);
    if (save.lineupKeep) lineupRestore([]);   // 版804：試合の途中でアプリを閉じた時も、スタメンはクラブハウスの形に戻す
    save.phase = 'train';
    warm();
  }
  // 画像の先読み：カード・能力マーク・スタッフ・顔を、使う前に読み込んで作っておく（出てくるのが遅れないように）
  let warmed = false; const warmKeep = [];
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   /* 版469：iPhoneは画像のメモリが少ないので、ほかのチームの顔をまとめて先読みしない（足りなくなると絵が「？」になる） */
  function warm() {
    if (warmed) return; warmed = true;
    faceLoad();
    const pre = (u) => { const im = new Image(); im.decoding = 'async'; im.src = u; warmKeep.push(im); };
    const CARD_IDS = Object.keys(C.CARDS || {});
    CARD_IDS.forEach((c) => pre(`cards/${c}.jpg`));
    ['btn_players', 'btn_status', 'btn_change', 'off_kit', 'off_emblem', 'off_name', 'off_retire', 'off_setting', 'off_biz', 'off_team', 'ui_back', 'ui_change', 'ui_next', 'pc_number', 'pc_pos', 'pc_name', 'coin', 'dash', 'defense', 'dribble', 'jump', 'kick', 'mental', 'pass', 'physical', 'speed', 'stamina', 'technique', 'top_mark', 'vision'].forEach((k) => pre(`icons/${k}.png`));
    ['d1', 'd2', 'd3', 'reg1', 'reg2', 'regE1', 'regE2', 'regW1', 'regW2'].forEach((k) => pre(`icons/lg/${k}.png?v=768`));
    ['coach', 'secretary'].forEach((k) => pre(`staff/${k}.png`));
    ['reg2', 'reg1', 'd3', 'd2', 'd1', 'cup'].forEach((k) => pre(`img/trophy/${k}.png`));
    // 自分のチームの顔は、顔の元絵が読めたら少しずつ作っておく
    const t0 = Date.now();
    const mk = () => {
      if (!(faceTotal && faceLoaded >= faceTotal)) { if (Date.now() - t0 < 20000) setTimeout(mk, 120); return; }
      const ps = (save && save.team && save.team.players) || []; let i = 0;
      const step = () => { const end = Math.min(ps.length, i + 3); for (; i < end; i++) { try { facePic(ps[i], ''); facePic(ps[i], '', true); } catch (_) {} } if (i < ps.length) setTimeout(step, 16); };
      step();
      // スター選手の元絵（ほかのチーム）も読み込んでおく
      if (!IOS) setTimeout(() => Object.keys(window.STAR_FACES || {}).forEach((k) => { if (!starImgs[k]) { const L = starImgs[k] = { img: new Image(), n: 0 }; L.img.onload = L.img.onerror = () => { L.n = 1; starFill(); }; L.img.src = `faces/star/${k}.png`; } }), 1500);
    };
    setTimeout(mk, 300);
  }
  // 週 → 月・週（3月から始まり、4週で1か月）
  const cal = (w) => ({ m: ((2 + Math.floor((w - 1) / 4)) % 12) + 1, w: ((w - 1) % 4) + 1 });

  // ---------- 画面の切り替え ----------
  function go(v) {
    if (v === 'assoc') { go('home'); openAssoc({ tab: 'sched' }); return; }   // サッカー協会は全画面
    if (v === 'lineup' && view !== 'lineup') sqFromHome = view === 'home';   // クラブ事務所から来た時だけ、クラブ設定のボタンを出す
    view = v; try { window.DotSound && (liveBack && v !== 'home' ? (DotSound.bgm(null), DotSound.crowd('pre')) : (DotSound.crowd(false), DotSound.bgm(v === 'home' ? 'home' : 'club'))); } catch (_) {}   /* 版728：試合前（LIVE）から開いたスタメン・戦術も、歓声のまま */   /* 版559：試合前（LIVE）から開いたスタメン・戦術は、試合前の曲のまま */   /* 版532：ホームに来たら試合の音を止める */   // 版499：BGM
    try { const cl = C.ensureClub(save); A().applyKits([{ ...cl.kit, gk: { ...cl.gk } }, { ...cl.kit2 }]); } catch (_) {}   // 版536：観戦（D1）などで変わったユニフォームを、自分のクラブのものに戻す
    $('#cv-home').hidden = v !== 'home';
    $('#cv-club').hidden = v === 'home';
    $('#cvBack').hidden = v === 'home';
    $('#clubLayer').innerHTML = '';
    $('#clubLayer').className = 'club-layer' + (v === 'club' ? '' : ' on');
    document.querySelector('#cv-club .rbtns').hidden = v !== 'club';
    if (v === 'club') pickDrill();
    if (v === 'club') { const l = document.getElementById('rbLineup'), tt = document.getElementById('rbTac'); if (l) l.innerHTML = rbLineupSVG(); if (tt) tt.innerHTML = RB_TAC_SVG; rbLast = -1; }
    if (v === 'home') { renderHome(); try { drawHome(performance.now()); } catch (_) {} }
    if (v === 'home') { premSync(); setTimeout(premDaily, 600); setTimeout(payCollect, 900); }   // 版695：プレミアムパスの毎日のプレゼント   // 版624：すぐ今のホームを描く（前に描いた古い絵が一瞬見えないように）
    if (v === 'data') renderData();
    if (v === 'train') renderTrain();
    if (v === 'lineup') renderLineup();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    if (window.__tut) window.__tut.onView(v);   // チュートリアル：画面が変わったら次の説明へ
  }
  let liveBack = null, liveSnap = null;   // 試合前の画面（LIVE）からスタメン・戦術を開いたとき、もどる先と、後ろに見せる会場の絵
  $('#cvBack').onclick = () => { if (liveBack) { const f = liveBack; liveBack = null; f(); return; } go(view === 'club' || view === 'assoc' ? 'home' : 'club'); };
  document.querySelectorAll('#cv-club .rbtns button').forEach((b) => b.onclick = () => { const g = b.dataset.go; if (g === 'tactic') { sqTab = 'tac'; go('lineup'); } else { if (g === 'lineup') sqTab = 'pos'; go(g); } });

  // 日付のドット数字（カルチョビットAのような、白くて太い四角い数字に黒いふち）
  const DOT_FONT = { 0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'], 6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '010', '010'], 8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'] };
  function dotNum(n) {
    const ds = String(n).split(''), cw = 3, gap = 1, W = ds.length * cw + (ds.length - 1) * gap;
    let black = '', white = '';
    ds.forEach((d, i) => DOT_FONT[d].forEach((row, y) => [...row].forEach((v, x) => { if (v === '1') { const X = i * (cw + gap) + x; black += `<rect x="${X - 0.38}" y="${y - 0.38}" width="1.76" height="1.76"/>`; white += `<rect x="${X}" y="${y}" width="1.02" height="1.02"/>`; } })));
    return `<svg class="dotnum" viewBox="-0.6 -0.6 ${W + 1.2} 6.2" style="width:${(W + 1.2) * 8}px"><g fill="#111">${black}</g><g fill="#fff">${white}</g></svg>`;
  }
  // ================= ホーム：街の見下ろし図（カルチョビットAの街に寄せる） =================
  const hc = $('#homeCv'), hx = hc.getContext('2d');
  const TW = 56, TH = 28, TZ = 26, OX = 640, OY = -140;
  const iso = (gx, gy, z = 0) => [OX + (gx - gy) * TW / 2, OY + (gx + gy) * TH / 2 - z * TZ];
  function poly(ctx, pts, fill, stroke, lw) { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); ctx.lineWidth = 1; } }
  const quad = (gx, gy, w, d, z = 0) => [iso(gx, gy, z), iso(gx + w, gy, z), iso(gx + w, gy + d, z), iso(gx, gy + d, z)];
  function box(ctx, gx, gy, w, d, h, top, left, right, z0 = 0, edge) {
    const A0 = iso(gx, gy, z0), B0 = iso(gx + w, gy, z0), C0 = iso(gx + w, gy + d, z0), D0 = iso(gx, gy + d, z0);
    const A1 = iso(gx, gy, z0 + h), B1 = iso(gx + w, gy, z0 + h), C1 = iso(gx + w, gy + d, z0 + h), D1 = iso(gx, gy + d, z0 + h);
    poly(ctx, [D0, C0, C1, D1], left, edge); poly(ctx, [C0, B0, B1, C1], right, edge); poly(ctx, [A1, B1, C1, D1], top, edge);
    return { A1, B1, C1, D1, C0, D0, B0 };
  }
  // 窓の帯（左の面＝手前左、右の面＝手前右）
  function bands(ctx, gx, gy, w, d, h, col, step = 0.42, hgt = 0.16, z0 = 0) {
    for (let z = z0 + 0.25; z < z0 + h - 0.15; z += step) {
      poly(ctx, [iso(gx + 0.08, gy + d, z), iso(gx + w - 0.08, gy + d, z), iso(gx + w - 0.08, gy + d, z + hgt), iso(gx + 0.08, gy + d, z + hgt)], col);
      poly(ctx, [iso(gx + w, gy + d - 0.08, z), iso(gx + w, gy + 0.08, z), iso(gx + w, gy + 0.08, z + hgt), iso(gx + w, gy + d - 0.08, z + hgt)], col);
    }
  }
  // 木：丸い樹冠（カルチョビットAの、ころんとした木）
  // 版478：季節（3〜5月＝春、6〜8月＝夏、9〜11月＝秋、12〜2月＝冬）で街の色が変わる
  const SEASON_PAL = {
    spring: { ground: '#4cc63a', road: '#72e05e', lot: '#42b832', lot2: '#3fb42e', park: '#62d052', park2: '#58cc48', bld: ['#a4f0b2', '#62d27e', '#50c46c'], trees: [['#f7a8c8', '#ffd0e2'], ['#f39abd', '#ffc6dc'], ['#1f8f30', '#34ab44']], field: '#8ee278' },
    summer: { ground: '#2fb526', road: '#5ad646', lot: '#2aa820', lot2: '#27a41e', park: '#4cc63c', park2: '#42c232', bld: ['#93eda4', '#55cf73', '#44bf62'], trees: [['#0f7a22', '#1f9a32'], ['#13822a', '#24a238']], field: '#7cdc62' },
    autumn: { ground: '#9fbf3a', road: '#c8d872', lot: '#93b434', lot2: '#8eae30', park: '#b0c85a', park2: '#a8c250', bld: ['#f0e2b0', '#d2b070', '#c09a5a'], trees: [['#e2541e', '#f47a3a'], ['#f0a020', '#ffc04a'], ['#c8321e', '#e45a3a'], ['#d8b020', '#f0d04a']], field: '#a8d070' },
    winter: { ground: '#e6eef2', road: '#c4d0d8', lot: '#dce6ec', lot2: '#d6e2e8', park: '#cfdae2', park2: '#c8d4dc', bld: ['#ffffff', '#aebdcc', '#c2cfdc'], trees: [['#e8f0f2', '#ffffff'], ['#dbe6ea', '#f6fafb']], field: '#dfe9ee', snow: true },
  };
  const seasonOfMonth = (m) => (m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter');
  const SEASON_JP = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
  let seasonNow = 'spring';
  const SP = () => SEASON_PAL[seasonNow] || SEASON_PAL.spring;
  function tree(ctx, gx, gy, s = 1) {
    const [x, y] = iso(gx, gy), P = SP(), tc = P.trees[Math.abs(Math.round(gx * 7 + gy * 13)) % P.trees.length];
    ctx.fillStyle = P.snow ? 'rgba(80,100,120,0.18)' : 'rgba(0,60,0,0.25)'; ctx.beginPath(); ctx.ellipse(x + 3, y, 11 * s, 5 * s, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#6b4a24'; ctx.fillRect(x - 2, y - 10 * s, 4, 10 * s);
    if (P.snow) { ctx.strokeStyle = '#6b4a24'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 9 * s); ctx.lineTo(x - 8 * s, y - 30 * s); ctx.moveTo(x, y - 14 * s); ctx.lineTo(x + 9 * s, y - 34 * s); ctx.moveTo(x, y - 9 * s); ctx.lineTo(x + 1 * s, y - 40 * s); ctx.stroke(); ctx.lineWidth = 1; }
    ctx.fillStyle = tc[0]; ctx.beginPath(); ctx.ellipse(x, y - 25 * s, 11 * s, 19 * s, 0, 0, 7); if (P.snow) { ctx.globalAlpha = 0.85; ctx.ellipse(x, y - 25 * s, 11 * s, 19 * s, 0, 0, 7); } ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = tc[1]; ctx.beginPath(); ctx.ellipse(x - 3.5 * s, y - 28 * s, 6 * s, 13 * s, 0, 0, 7); ctx.fill();
  }
  // 車（白い小さな車）
  function car(ctx, gx, gy, rot) {
    const w = rot ? 0.3 : 0.55, d = rot ? 0.55 : 0.3;
    box(ctx, gx, gy, w, d, 0.18, '#ffffff', '#d4d8dc', '#e6e9ec');
    box(ctx, gx + w * 0.2, gy + d * 0.2, w * 0.6, d * 0.6, 0.12, '#cfe0f0', '#8aa2b8', '#a8bccd', 0.18);
  }
  function label(ctx, x, y, a, b) {
    ctx.font = '900 17px "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif';
    ctx.textAlign = 'center';
    const w = Math.max(ctx.measureText(a).width, b ? ctx.measureText(b).width * 0.92 : 0) + 16, h = b ? 46 : 28;
    ctx.fillStyle = '#121212'; roundRect(ctx, x - w / 2, y - h, w, h, 5); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; roundRect(ctx, x - w / 2 + 3, y - h + 3, w - 6, h - 6, 3); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#fff'; ctx.fillText(a, x, y - h + 21);
    if (b) { ctx.font = '800 15px "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif'; ctx.fillText(b, x, y - 9); }
    return { x: x - w / 2, y: y - h, w, h };
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  let hot = [];   // クリックできる建物
  function seeded(n) { let s = n; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  // 動かない街並みは一度だけ描いて取っておく（毎フレーム描くのは旗だけ）
  let townCv = null, townHot = [];
  // 建物の絵が占める範囲（クリックできる場所）：底面と高さの8つの角を囲む四角
  function areaOf(gx, gy, w, d, h) {
    const pts = []; for (const [a, b] of [[0, 0], [w, 0], [w, d], [0, d]]) for (const z of [0, h]) pts.push(iso(gx + a, gy + b, z));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const ST = { gx: 14.6, gy: 25.0, w: 9.2, d: 6.4 };   // スタジアムの位置
  function buildTown(view) {
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
    const c = cv.getContext('2d');
    if (view) c.setTransform(view.s, 0, 0, view.s, -view.x * view.s, -view.y * view.s);   // 一部分を大きく描く（秘書の場面の背景）
    // 地面と道（道は少し明るい緑の帯）
    const PS = SP(); c.fillStyle = PS.ground; c.fillRect(0, 0, 1280, 720);
    const G0 = -8, G1 = 44;
    const roadX = (gx, w) => { poly(c, [iso(gx, G0), iso(gx + w, G0), iso(gx + w, G1), iso(gx, G1)], PS.road); poly(c, [iso(gx + 0.08, G0), iso(gx + w - 0.08, G0), iso(gx + w - 0.08, G1), iso(gx + 0.08, G1)], null, 'rgba(255,255,255,0.12)'); };
    const roadY = (gy, w) => { poly(c, [iso(G0, gy), iso(G1, gy), iso(G1, gy + w), iso(G0, gy + w)], PS.road); poly(c, [iso(G0, gy + 0.08), iso(G1, gy + 0.08), iso(G1, gy + w - 0.08), iso(G0, gy + w - 0.08)], null, 'rgba(255,255,255,0.12)'); };
    // 区画（少し濃い緑の敷地）
    const lot = (gx, gy, w, d, col) => poly(c, quad(gx, gy, w, d), col || PS.lot);
    lot(13, 6.5, 7.5, 6.8); lot(23.8, 9.2, 6.4, 5.2); lot(27.6, 18.6, 5, 4.4); lot(9.2, 24.6, 15.8, 8, PS.lot2);
    roadX(12.0, 1.0); roadX(22.6, 1.0); roadX(33.2, 1.0); roadY(4.8, 1.0); roadY(15.6, 1.1); roadY(23.4, 1.0);
    // 駐車場（スタジアムの左）
    poly(c, quad(9.6, 25.0, 4.6, 6.8), PS.park);
    for (let k = 0; k < 6; k++) poly(c, [iso(9.9, 25.7 + k * 1.05), iso(13.9, 25.7 + k * 1.05)], null, 'rgba(255,255,255,0.6)', 1.5);
    poly(c, quad(26.8, 22.2, 4.4, 1.0), PS.park2);
    const objs = [], labels = [];
    const add = (k, f) => objs.push({ k, f });
    // 街のビル（淡い緑の小さなビルが集まった街区）
    const r = seeded(11);
    const clusters = [[5.5, 3.5, 5, 3], [8, 8.5, 3.5, 5], [14, -1.5, 6, 5], [24, -0.5, 7, 4], [29.5, 6, 3.5, 4], [35, 9, 4, 6], [35.5, 18, 4, 5], [28, 26, 5, 3], [4, 17, 6, 5], [17.2, 17.4, 4.5, 4.5], [3, 25, 4, 4], [24.5, 33.5, 6, 4]];
    for (const [bx, by, cw, cd] of clusters) {
      for (let i = 0; i < cw; i += 1.25) for (let j = 0; j < cd; j += 1.25) {
        if (r() < 0.18) continue;
        const w = 0.8 + r() * 0.4, d = 0.8 + r() * 0.4, h = 0.5 + r() * 1.3, gx = bx + i + r() * 0.15, gy = by + j + r() * 0.15;
        const onRoad = [12, 22.6, 33.2].some((x) => gx < x + 1.05 && gx + w > x - 0.05) || [4.8, 15.6, 23.4].some((y) => gy < y + 1.1 && gy + d > y - 0.05);
        if (onRoad) continue;
        add(gx + w + gy + d, () => { box(c, gx, gy, w, d, h, PS.bld[0], PS.bld[1], PS.bld[2]); bands(c, gx, gy, w, d, h, 'rgba(255,255,255,0.22)', 0.34, 0.1); });
      }
    }
    // 木（道ぞいと街区のまわり）
    const trees = [[11.6, 2], [11.6, 6.5], [11.6, 11], [11.6, 14.5], [12.2, 18.5], [13.5, 22.6], [9, 22.8], [7, 13.5], [21.8, 6], [22.2, 9.5], [21.6, 13.5], [24.5, 15], [27.5, 15], [30.5, 14.8], [33, 16.4], [24, 17.5], [24.2, 20.5], [24, 24.5], [26.2, 24.6], [31.5, 23.8], [33, 22], [28, 8.3], [31.6, 9.5], [32.8, 13], [19.5, 4.2], [16, 4.2], [9.4, 18.8], [20.2, 15.2], [17.5, 15.2], [14.6, 14.9], [6.5, 21.6], [8.7, 25.4], [15.2, 31.8], [21.5, 31.6], [26, 29.5], [34.5, 26], [29.5, 28.5], [13, 33]];
    for (const [tx, ty] of trees) add(tx + ty + 0.4, () => tree(c, tx, ty, 0.85 + ((tx * 7 + ty * 3) % 5) * 0.06));
    // ---------- スタジアム（左下）：四方のスタンド、青い屋根、大きなスコアボード ----------
    const { gx: sx, gy: sy, w: sw, d: sd } = ST, sh = 1.4, t0 = 1.15;
    add(sx + sy + sw + sd - 2, () => {
      const G = ['#d2d2d2', '#9c9c9c', '#b8b8b8'];
      // ピッチ
      poly(c, quad(sx, sy, sw, sd, 0.02), '#6c6c6c');
      poly(c, quad(sx + t0, sy + t0, sw - 2 * t0, sd - 2 * t0, 0.05), '#62d24e');
      for (let k = 0; k < 6; k++) if (k % 2) poly(c, quad(sx + t0 + k * (sw - 2 * t0) / 6, sy + t0, (sw - 2 * t0) / 6, sd - 2 * t0, 0.05), '#6fdb5a');
      const px = sx + t0 + 0.2, py = sy + t0 + 0.2, pw = sw - 2 * t0 - 0.4, pd = sd - 2 * t0 - 0.4, W = 'rgba(255,255,255,0.9)';
      poly(c, quad(px, py, pw, pd, 0.06), null, W, 1.6);
      c.strokeStyle = W; c.lineWidth = 1.6; c.beginPath(); c.moveTo(...iso(px + pw / 2, py, 0.06)); c.lineTo(...iso(px + pw / 2, py + pd, 0.06)); c.stroke();
      c.beginPath(); for (let a = 0; a <= 32; a++) { const [x, y] = iso(px + pw / 2 + Math.cos(a / 32 * 6.283) * 0.55, py + pd / 2 + Math.sin(a / 32 * 6.283) * 0.55, 0.06); a ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
      poly(c, quad(px, py + pd / 2 - 0.9, 0.75, 1.8, 0.06), null, W, 1.6); poly(c, quad(px + pw - 0.75, py + pd / 2 - 0.9, 0.75, 1.8, 0.06), null, W, 1.6);
      c.lineWidth = 1;
      // 奥のスタンド（長い側）と左右のスタンド
      const stand = (gx, gy, w, d) => { box(c, gx, gy, w, d, sh, G[0], G[1], G[2]); };
      stand(sx, sy, sw, t0);                      // 奥
      stand(sx, sy, t0, sd);                      // 左（スコアボード側）
      // 出入り口（スタンドの上の黒い四角）
      const hole = (gx, gy, w, d) => poly(c, quad(gx, gy, w, d, sh + 0.001), '#2a2a2a');
      for (let k = 0; k < 5; k++) hole(sx + 1.5 + k * 1.5, sy + 0.4, 0.5, 0.32);
      for (let k = 0; k < 2; k++) hole(sx + 0.4, sy + 1.9 + k * 2.0, 0.32, 0.5);
      // 大きなスコアボード（左奥）
      box(c, sx + 0.15, sy + 1.3, 0.4, 3.2, 2.5, '#3a3a3a', '#1a1a1a', '#2c2c2c', sh);
      poly(c, [iso(sx + 0.55, sy + 1.45, sh + 0.35), iso(sx + 0.55, sy + 4.35, sh + 0.35), iso(sx + 0.55, sy + 4.35, sh + 2.3), iso(sx + 0.55, sy + 1.45, sh + 2.3)], '#202a22');
      stand(sx + sw - t0, sy, t0, sd);            // 右
      for (let k = 0; k < 2; k++) hole(sx + sw - t0 + 0.45, sy + 1.9 + k * 2.0, 0.32, 0.5);
      // 手前のスタンド（青い屋根つき）
      stand(sx, sy + sd - t0, sw, t0);
      for (let k = 0; k < 5; k++) hole(sx + 1.5 + k * 1.5, sy + sd - t0 + 0.42, 0.5, 0.32);
      // 屋根：手前（外）が低く、ピッチ側が高い。柱で支える
      const rz0 = sh + 0.8, rz1 = sh + 1.25, ry0 = sy + sd + 0.25, ry1 = sy + sd - t0 + 0.45;
      for (let k = 0; k <= 6; k++) { const gx = sx + 0.4 + k * (sw - 0.8) / 6; c.fillStyle = '#7d7d7d'; const [x0, y0] = iso(gx, ry0, 0), [, y1] = iso(gx, ry0, rz0); c.fillRect(x0 - 2, y1, 4, y0 - y1); }
      poly(c, [iso(sx - 0.1, ry1, rz1), iso(sx + sw + 0.1, ry1, rz1), iso(sx + sw + 0.1, ry0, rz0), iso(sx - 0.1, ry0, rz0)], '#4f97d2', 'rgba(20,60,110,0.6)');
      for (let k = 1; k < 10; k++) { const gx = sx - 0.1 + k * (sw + 0.2) / 10; c.strokeStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.moveTo(...iso(gx, ry1, rz1)); c.lineTo(...iso(gx, ry0, rz0)); c.stroke(); }
      poly(c, [iso(sx + sw + 0.1, ry1, rz1), iso(sx + sw + 0.1, ry0, rz0), iso(sx + sw + 0.1, ry0, rz0 - 0.12), iso(sx + sw + 0.1, ry1, rz1 - 0.12)], '#2f6ea6');
      poly(c, [iso(sx - 0.1, ry0, rz0), iso(sx + sw + 0.1, ry0, rz0), iso(sx + sw + 0.1, ry0, rz0 - 0.12), iso(sx - 0.1, ry0, rz0 - 0.12)], '#3a80bd');
      const [lx, ly] = iso(sx + 1.2, sy + sd + 1.6);
      labels.push(() => townHot.push({ go: 'stadium', r: label(c, lx - 20, ly + 18, 'スタジアム', '試合会場') }));
      townHot.push({ go: 'stadium', area: true, r: areaOf(sx, sy, sw, sd + 0.3, 3.9) });
    });
    // 駐車場の車
    const pr = seeded(5);
    for (let k = 0; k < 6; k++) for (let j = 0; j < 6; j++) if (pr() < 0.62) { const gx = 10.1 + j * 0.62, gy = 25.8 + k * 1.05; add(gx + gy, () => car(c, gx, gy, false)); }
    // ---------- クラブハウス（上）：練習グラウンド・照明・赤い屋根の建物 ----------
    add(13.6 + 7.6, () => {
      poly(c, quad(13.6, 7.4, 5.2, 3.6, 0.02), PS.field);
      poly(c, quad(13.9, 7.7, 4.6, 3.0, 0.03), null, 'rgba(255,255,255,0.9)', 1.6);
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(...iso(16.2, 7.7, 0.03)); c.lineTo(...iso(16.2, 10.7, 0.03)); c.stroke(); c.lineWidth = 1;
      for (let k = 0; k < 7; k++) { const [x, y] = iso(14.6 + k * 0.55, 8.6 + (k % 2) * 0.9, 0.03); c.fillStyle = '#e23b2b'; c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 4, y); c.lineTo(x - 4, y); c.closePath(); c.fill(); }
    });
    const pole = (gx, gy) => add(gx + gy + 0.01, () => { const [x, y] = iso(gx, gy), [, yt] = iso(gx, gy, 3.1); c.fillStyle = '#c8c8c8'; c.fillRect(x - 1.5, yt, 3, y - yt); c.fillStyle = '#f2f2f2'; c.fillRect(x - 8, yt - 9, 16, 10); c.fillStyle = '#9aa'; for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) c.fillRect(x - 7 + a * 5, yt - 8 + b * 5, 4, 3); });
    pole(13.5, 7.3); pole(18.9, 7.3); pole(13.5, 11.1); pole(18.9, 11.1);
    add(17.4 + 10.6 + 3, () => {
      box(c, 17.2, 10.4, 2.2, 1.4, 0.75, '#f4f4f4', '#d9d9d9', '#ffffff');
      bands(c, 17.2, 10.4, 2.2, 1.4, 0.75, 'rgba(90,120,170,0.55)', 0.4, 0.14);
      // 切妻の赤い屋根
      const a = iso(17.1, 10.3, 0.75), b = iso(19.5, 10.3, 0.75), cc2 = iso(19.5, 11.9, 0.75), d = iso(17.1, 11.9, 0.75), m1 = iso(17.1, 11.1, 1.25), m2 = iso(19.5, 11.1, 1.25);
      poly(c, [a, b, m2, m1], '#c8392d'); poly(c, [m1, m2, cc2, d], '#e8503f'); poly(c, [b, cc2, m2], '#f0f0f0');
      labels.push(() => { const [x, y] = iso(15.8, 6.6, 2.2); townHot.push({ go: 'club', r: label(c, x + 30, y, 'クラブハウス', '選手データ・特訓') }); });
      townHot.push({ go: 'club', area: true, r: areaOf(13.4, 7.2, 6.1, 5.0, 1.4) });
    });
    for (let k = 0; k < 5; k++) { const gx = 17.4 + k * 0.45; add(gx + 12.4, () => car(c, gx, 12.3, true)); }
    // ---------- サッカー協会（右）：ガラスのタワー（屋上にボール）＋白い低層棟＋丸い玄関 ----------
    add(25 + 10.4 + 2.6, () => {
      const tx0 = 25.0, ty0 = 10.4, tw = 1.3, td = 1.3, th = 4.3;
      box(c, tx0, ty0, tw, td, th, '#eef3f8', '#4f77b8', '#7fa2d6');
      // ガラスの横じま（窓）と、白い縦の柱
      bands(c, tx0, ty0, tw, td, th, 'rgba(25,50,100,0.55)', 0.3, 0.13);
      for (let u = 0; u <= 3; u++) {
        const g = tx0 + u * tw / 3; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(...iso(g, ty0 + td, 0)); c.lineTo(...iso(g, ty0 + td, th)); c.stroke();
        const h2 = ty0 + u * td / 3; c.beginPath(); c.moveTo(...iso(tx0 + tw, h2, 0)); c.lineTo(...iso(tx0 + tw, h2, th)); c.stroke(); c.lineWidth = 1;
      }
      // 屋上の台とサッカーボール
      box(c, tx0 + 0.45, ty0 + 0.45, 0.4, 0.4, 0.25, '#ffffff', '#cfd6de', '#e3e8ee', th);
      const [bx, by] = iso(tx0 + 0.65, ty0 + 0.65, th + 0.25);
      c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by - 13, 14, 0, 7); c.fill(); c.strokeStyle = '#333'; c.lineWidth = 2; c.stroke(); c.lineWidth = 1;
      c.fillStyle = '#222'; c.beginPath(); for (let a = 0; a < 5; a++) { const an = -Math.PI / 2 + a * 1.2566; c.lineTo(bx + Math.cos(an) * 5, by - 13 + Math.sin(an) * 5); } c.closePath(); c.fill();
      for (let a = 0; a < 5; a++) { const an = -Math.PI / 2 + a * 1.2566; c.beginPath(); c.arc(bx + Math.cos(an) * 11.5, by - 13 + Math.sin(an) * 11.5, 2.5, 0, 7); c.fill(); }
      // 丸い玄関（タワーの手前左の足もと）
      const [ex, ey] = iso(25.45, 12.05, 0), [, eyt] = iso(25.45, 12.05, 0.75), rx = 18, ry = 9;
      c.fillStyle = '#3a78c2'; c.beginPath(); c.ellipse(ex, ey, rx, ry, 0, 0, Math.PI); c.lineTo(ex - rx, eyt); c.ellipse(ex, eyt, rx, ry, 0, Math.PI, 0, true); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(ex - rx, eyt + 6, rx * 2, 4); c.fillRect(ex - rx, eyt + 14, rx * 2, 3);
      c.fillStyle = '#a9cff2'; c.beginPath(); c.ellipse(ex, eyt, rx, ry, 0, 0, 7); c.fill();
      c.strokeStyle = '#2b5f9e'; c.beginPath(); c.ellipse(ex, eyt, rx, ry, 0, 0, 7); c.stroke();
      // 白い低層棟（タワーの右手前）：あとから描いて手前に
      box(c, 26.3, 10.9, 2.5, 1.7, 1.45, '#f4f7fa', '#d3dbe4', '#e6ecf2');
      bands(c, 26.3, 10.9, 2.5, 1.7, 1.45, 'rgba(50,100,175,0.85)', 0.34, 0.16);
      labels.push(() => { const [x, y] = iso(24.2, 13.4, 1.4); townHot.push({ go: 'assoc', r: label(c, x - 80, y + 46, 'サッカー協会', '日程・順位') }); });
      townHot.push({ go: 'assoc', area: true, r: areaOf(24.8, 10.3, 4.2, 2.5, 5.2) });
    });
    for (let k = 0; k < 5; k++) { const gx = 27 + k * 0.7; add(gx + 13.4, () => car(c, gx, 13.3, false)); }
    // ---------- クラブ事務所（右下）：茶色いビル ----------
    add(28.4 + 19.5 + 4, () => {
      box(c, 28.4, 19.4, 2.4, 1.7, 1.75, '#dedede', '#b06a3a', '#c98250');
      bands(c, 28.4, 19.4, 2.4, 1.7, 1.75, 'rgba(50,80,140,0.75)', 0.42, 0.16);
      box(c, 29.1, 19.9, 0.6, 0.5, 0.18, '#f0f0f0', '#c8c8c8', '#dcdcdc', 1.75);
      box(c, 30.0, 20.2, 0.5, 0.5, 0.14, '#f0f0f0', '#c8c8c8', '#dcdcdc', 1.75);
      labels.push(() => { const [x, y] = iso(31.6, 21.6, 0); townHot.push({ go: 'lineup', r: label(c, x + 70, y + 6, 'クラブ事務所', 'チーム編成') }); });
      townHot.push({ go: 'lineup', area: true, r: areaOf(28.3, 19.3, 2.6, 1.9, 2.0) });
    });
    for (let k = 0; k < 5; k++) { const gx = 27 + k * 0.75; add(gx + 22.5, () => car(c, gx, 22.4, false)); }
    // ---------- ショップ（カード・コイン）：赤白のひさしの小さなお店 ----------
    add(25.6 + 24.6 + 3, () => {
      box(c, 25.6, 24.8, 1.6, 1.3, 0.85, '#fff4cc', '#e9c46a', '#f3d27a');
      for (let k = 0; k < 6; k++) poly(c, [iso(25.6 + k * 0.267, 26.1, 0.85), iso(25.6 + (k + 1) * 0.267, 26.1, 0.85), iso(25.6 + (k + 1) * 0.267, 26.45, 0.55), iso(25.6 + k * 0.267, 26.45, 0.55)], k % 2 ? '#fff' : '#e8463a');
      box(c, 25.5, 24.7, 1.8, 1.5, 0.12, '#e8463a', '#c0362c', '#d23e33', 0.85);
      labels.push(() => { const [x, y] = iso(26.4, 25.2, 1.2); townHot.push({ go: 'shop', r: label(c, x + 20, y - 18, 'ショップ', 'カード・コイン') }); });
      townHot.push({ go: 'shop', area: true, r: areaOf(25.4, 24.6, 2.0, 1.9, 1.1) });
    });
    const keepHot = townHot;
    townHot = [];
    objs.sort((a, b) => a.k - b.k).forEach((o) => o.f());
    if (view) { townHot = keepHot; return cv; }
    labels.forEach((f) => f());   // 名前の札は最後に、いちばん手前へ
    townCv = cv;
  }
  // ---------- エンブレム（盾・丸・紋章の形に、チームの色・模様・頭文字・マーク） ----------
  function emblemPath(ctx, x, y, s, shape) {
    ctx.beginPath();
    if (shape === 1) { ctx.arc(x, y, s * 0.5, 0, 7); return; }
    if (shape === 3) { ctx.moveTo(x, y - s * 0.52); ctx.lineTo(x + s * 0.46, y); ctx.lineTo(x, y + s * 0.52); ctx.lineTo(x - s * 0.46, y); ctx.closePath(); return; }   // ひし形
    if (shape === 4) { for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; ctx.lineTo(x + Math.cos(a) * s * 0.52, y + Math.sin(a) * s * 0.52); } ctx.closePath(); return; }   // 六角形
    if (shape === 5) { ctx.moveTo(x - s * 0.42, y - s * 0.48); ctx.lineTo(x + s * 0.42, y - s * 0.48); ctx.lineTo(x + s * 0.42, y + s * 0.2); ctx.lineTo(x, y + s * 0.52); ctx.lineTo(x - s * 0.42, y + s * 0.2); ctx.closePath(); return; }   // 旗（ペナント）形
    if (shape === 2) { ctx.moveTo(x - s * 0.46, y - s * 0.42); ctx.lineTo(x - s * 0.16, y - s * 0.5); ctx.lineTo(x, y - s * 0.4); ctx.lineTo(x + s * 0.16, y - s * 0.5); ctx.lineTo(x + s * 0.46, y - s * 0.42); ctx.lineTo(x + s * 0.44, y + s * 0.08); ctx.quadraticCurveTo(x + s * 0.36, y + s * 0.38, x, y + s * 0.52); ctx.quadraticCurveTo(x - s * 0.36, y + s * 0.38, x - s * 0.44, y + s * 0.08); ctx.closePath(); return; }
    ctx.moveTo(x - s * 0.44, y - s * 0.48); ctx.lineTo(x + s * 0.44, y - s * 0.48); ctx.lineTo(x + s * 0.44, y + s * 0.05); ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.36, x, y + s * 0.52); ctx.quadraticCurveTo(x - s * 0.4, y + s * 0.36, x - s * 0.44, y + s * 0.05); ctx.closePath();
  }
  function drawIcon(ctx, x, y, r, icon, col) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = r * 0.18;
    if (icon === 'ball') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = r * 0.12; ctx.stroke(); ctx.fillStyle = '#222'; ctx.beginPath(); for (let a = 0; a < 5; a++) { const an = -Math.PI / 2 + a * 1.2566; ctx.lineTo(Math.cos(an) * r * 0.38, Math.sin(an) * r * 0.38); } ctx.fill(); for (let a = 0; a < 5; a++) { const an = -Math.PI / 2 + a * 1.2566; ctx.beginPath(); ctx.arc(Math.cos(an) * r * 0.86, Math.sin(an) * r * 0.86, r * 0.2, 0, 7); ctx.fill(); } }
    else if (icon === 'star') { ctx.beginPath(); for (let a = 0; a < 10; a++) { const an = -Math.PI / 2 + a * Math.PI / 5, rr = a % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } ctx.closePath(); ctx.fill(); }
    else if (icon === 'wave') { for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.moveTo(-r, k * r * 0.6 - r * 0.2); for (let u = 0; u <= 8; u++) ctx.lineTo(-r + u * r / 4, k * r * 0.6 - r * 0.2 + Math.sin(u * 1.6) * r * 0.25); ctx.stroke(); } }
    else if (icon === 'crown') { ctx.beginPath(); ctx.moveTo(-r, r * 0.5); ctx.lineTo(-r, -r * 0.3); ctx.lineTo(-r * 0.5, r * 0.1); ctx.lineTo(0, -r * 0.6); ctx.lineTo(r * 0.5, r * 0.1); ctx.lineTo(r, -r * 0.3); ctx.lineTo(r, r * 0.5); ctx.closePath(); ctx.fill(); }
    else if (icon === 'bolt') { ctx.beginPath(); ctx.moveTo(r * 0.2, -r); ctx.lineTo(-r * 0.55, r * 0.15); ctx.lineTo(-r * 0.05, r * 0.15); ctx.lineTo(-r * 0.25, r); ctx.lineTo(r * 0.55, -r * 0.2); ctx.lineTo(r * 0.05, -r * 0.2); ctx.closePath(); ctx.fill(); }
    else if (icon === 'sun') { ctx.beginPath(); ctx.arc(0, 0, r * 0.48, 0, 7); ctx.fill(); for (let a = 0; a < 8; a++) { const an = a * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(an) * r * 0.62, Math.sin(an) * r * 0.62); ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); ctx.stroke(); } }
    else if (icon === 'mountain') { ctx.beginPath(); ctx.moveTo(-r, r * 0.6); ctx.lineTo(-r * 0.25, -r * 0.7); ctx.lineTo(r * 0.15, 0); ctx.lineTo(r * 0.45, -r * 0.35); ctx.lineTo(r, r * 0.6); ctx.closePath(); ctx.fill(); }
    else if (icon === 'flame') { ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.9, -r * 0.1, r * 0.55, r * 0.55); ctx.quadraticCurveTo(r * 0.3, r, 0, r); ctx.quadraticCurveTo(-r * 0.3, r, -r * 0.55, r * 0.55); ctx.quadraticCurveTo(-r * 0.75, 0, -r * 0.2, -r * 0.35); ctx.quadraticCurveTo(-r * 0.1, -r * 0.7, 0, -r); ctx.fill(); }
    else if (icon === 'leaf') { ctx.beginPath(); ctx.moveTo(-r * 0.8, r * 0.8); ctx.quadraticCurveTo(-r * 0.9, -r * 0.6, r * 0.85, -r * 0.85); ctx.quadraticCurveTo(r * 0.6, r * 0.9, -r * 0.8, r * 0.8); ctx.fill(); }
    else if (icon === 'castle') { ctx.beginPath(); ctx.moveTo(-r * 0.8, r * 0.7); ctx.lineTo(-r * 0.8, -r * 0.5); ctx.lineTo(-r * 0.5, -r * 0.5); ctx.lineTo(-r * 0.5, -r * 0.25); ctx.lineTo(-r * 0.15, -r * 0.25); ctx.lineTo(-r * 0.15, -r * 0.8); ctx.lineTo(r * 0.15, -r * 0.8); ctx.lineTo(r * 0.15, -r * 0.25); ctx.lineTo(r * 0.5, -r * 0.25); ctx.lineTo(r * 0.5, -r * 0.5); ctx.lineTo(r * 0.8, -r * 0.5); ctx.lineTo(r * 0.8, r * 0.7); ctx.closePath(); ctx.fill(); }
    else if (icon === 'heart') { ctx.beginPath(); ctx.moveTo(0, r * 0.85); ctx.bezierCurveTo(-r * 1.2, 0, -r * 0.6, -r * 1.0, 0, -r * 0.35); ctx.bezierCurveTo(r * 0.6, -r * 1.0, r * 1.2, 0, 0, r * 0.85); ctx.fill(); }
    else if (icon === 'none') { /* マークなし */ }
    else { ctx.beginPath(); ctx.moveTo(-r, r * 0.3); ctx.quadraticCurveTo(-r * 0.2, -r * 1.1, r, -r * 0.6); ctx.quadraticCurveTo(r * 0.1, -r * 0.2, r * 0.5, r * 0.1); ctx.quadraticCurveTo(-r * 0.1, r * 0.05, -r, r * 0.3); ctx.fill(); }
    ctx.restore();
  }
  function drawEmblem(ctx, x, y, s, lk) {
    ctx.save();
    emblemPath(ctx, x, y, s, lk.shape); ctx.fillStyle = lk.c1; ctx.fill();
    ctx.clip();
    ctx.fillStyle = lk.c2;
    if (lk.pat === 0) for (let k = -2; k <= 2; k += 2) ctx.fillRect(x + k * s * 0.11 - s * 0.055, y - s * 0.6, s * 0.11, s * 1.2);   // 縦じま
    else if (lk.pat === 1) ctx.fillRect(x, y - s * 0.6, s * 0.6, s * 1.2);                                                             // 左右で2色
    else if (lk.pat === 2) { ctx.beginPath(); ctx.moveTo(x - s * 0.6, y + s * 0.3); ctx.lineTo(x + s * 0.6, y - s * 0.5); ctx.lineTo(x + s * 0.6, y - s * 0.2); ctx.lineTo(x - s * 0.6, y + s * 0.6); ctx.fill(); }   // ななめの帯
    else if (lk.pat === 4) { /* 無地 */ }
    else if (lk.pat === 5) { ctx.fillRect(x - s * 0.09, y - s * 0.6, s * 0.18, s * 1.2); ctx.fillRect(x - s * 0.6, y - s * 0.02, s * 1.2, s * 0.18); }   // 十字
    else ctx.fillRect(x - s * 0.6, y + s * 0.02, s * 1.2, s * 0.16);                                                                    // 横の帯
    // 上の帯と頭文字
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - s * 0.6, y - s * 0.6, s * 1.2, s * 0.3);
    ctx.restore();
    const c3 = lk.c3 || '#fff';
    ctx.fillStyle = c3; ctx.font = `900 ${Math.round(s * (String(lk.ch || '').length > 1 ? 0.15 : 0.2))}px "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lk.ch || '', x, y - s * 0.33 + (lk.shape === 1 || lk.shape === 3 || lk.shape === 4 ? s * 0.07 : 0)); ctx.textBaseline = 'alphabetic';
    drawIcon(ctx, x, y + s * 0.12, s * 0.2, lk.icon, c3);
    emblemPath(ctx, x, y, s, lk.shape); ctx.lineWidth = Math.max(2, s * 0.05); ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = Math.max(1, s * 0.02); ctx.strokeStyle = '#1a1a1a'; ctx.stroke(); ctx.lineWidth = 1;
  }
  // 試合当日の大きな旗（カルチョビットAのように、透けた布に両チームのエンブレム）
  const bannerCache = new Map();
  function bannerTex(lk, key) {
    if (bannerCache.has(key)) return bannerCache.get(key);
    const cv = document.createElement('canvas'); cv.width = 150; cv.height = 140; const c = cv.getContext('2d');
    c.fillStyle = 'rgba(255,255,255,0.62)'; c.fillRect(0, 0, 150, 140);
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, 0, 150, 8);
    const im = lk && !lk.me && lk.id ? embImg(lk.id) : null;
    if (im && !im.complete) { drawEmblem(c, 75, 72, 108, lk); return cv; }   // 画像の読み込み中は仮の絵（キャッシュしない）
    if (im && im.naturalWidth) c.drawImage(im, 75 - 56, 72 - 56, 112, 112); else drawEmblem(c, 75, 72, 108, lk);
    bannerCache.set(key, cv); return cv;
  }
  function bigBanner(ctx, tex, x, y, t, ph) {
    // 縦に細く切って、少しずつずらして「なびく」
    const W = tex.width, H = tex.height;
    for (let i = 0; i < W; i += 3) { const dy = Math.sin(t * 2.4 + ph + i / 22) * 5 + Math.sin(t * 1.3 + ph * 2 + i / 50) * 3; ctx.drawImage(tex, i, 0, 3, H, x + i, y + dy, 3, H); }   // 風にあおられて、布全体がゆれる
  }
  // 試合の週：スタジアムに旗が立つ（風になびく）
  function flag(ctx, x, y, t, col, ph, big) {
    const L = big ? 30 : 18, H = big ? 18 : 11, hp = big ? 46 : 28;
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(x - 1, y - hp, 2, hp);
    ctx.beginPath(); ctx.moveTo(x + 1, y - hp);
    for (let k = 0; k <= 6; k++) { const u = k / 6; ctx.lineTo(x + 1 + u * L, y - hp + Math.sin(t * 5 + ph + u * 4) * 2.5 * u); }
    for (let k = 6; k >= 0; k--) { const u = k / 6; ctx.lineTo(x + 1 + u * L, y - hp + H + Math.sin(t * 5 + ph + u * 4) * 2.5 * u); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  }
  function isMatchWeek() { if (!save) return false; const fx = C.nextFixture(save); return !!(fx && fx.week <= save.week && !C.campState(save)); }
  // 季節の舞うもの：春＝桜の花びら、夏＝日ざし、秋＝落ち葉、冬＝雪
  function seasonFx(c, t) {
    const sn = seasonNow;
    if (sn === 'summer') { const g = c.createRadialGradient(1180, -40, 20, 1180, -40, 520); g.addColorStop(0, 'rgba(255,250,200,0.55)'); g.addColorStop(1, 'rgba(255,240,160,0)'); c.fillStyle = g; c.fillRect(600, 0, 680, 560); c.fillStyle = 'rgba(255,200,80,0.05)'; c.fillRect(0, 0, 1280, 720); return; }
    if (sn === 'winter') c.fillStyle = 'rgba(220,235,255,0.08)', c.fillRect(0, 0, 1280, 720);
    const N = sn === 'winter' ? 90 : 34;
    for (let k = 0; k < N; k++) {
      const sp = sn === 'winter' ? 28 + (k % 7) * 5 : 36 + (k % 5) * 8, x0 = (k * 137.5) % 1340 - 30, y = ((t * sp + k * 97) % 780) - 30, x = x0 + Math.sin(t * 1.3 + k) * 26 - y * 0.25;
      const xx = ((x % 1340) + 1340) % 1340 - 30;
      if (sn === 'winter') { c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.arc(xx, y, 1.6 + (k % 3), 0, 7); c.fill(); continue; }
      c.save(); c.translate(xx, y); c.rotate(t * 2 + k); c.scale(1, Math.abs(Math.sin(t * 3 + k)) * 0.7 + 0.3);
      c.fillStyle = sn === 'spring' ? (k % 2 ? '#ffc8dc' : '#ffb0cc') : ['#e8641e', '#f0a020', '#c8321e', '#d8b020'][k % 4];
      c.beginPath(); c.ellipse(0, 0, sn === 'spring' ? 4 : 5.5, sn === 'spring' ? 2.6 : 3.4, 0, 0, 7); c.fill(); c.restore();
    }
  }
  let townSeason = null;
  // ================= 版589：新しいホーム（監督の絵）：街の背景＋リーグで育つスタジアム＋建物の名前の札 =================
  const H2 = { bg: null, st: [], ok: false };
  { const L = (src) => { const im = new Image(); im.decoding = 'async'; im.src = src; return im; };
    H2.bgs = {}; H2.L = L;
    H2.bgOf = (s, k) => H2.bgs[`${s}_${k}`] || (H2.bgs[`${s}_${k}`] = L(`img/home/${s}_${k}.jpg`));   // 版599：季節×スタジアム段階ごとの1枚絵（使う絵だけ読む）
    H2.cur = () => { let sn = 'spring'; try { if (save) sn = seasonOfMonth(cal(save.week || 1).m); } catch (_) {} return H2.bgOf(sn, h2Tier()); };
    H2.bg = null; H2.last = null; }
  const H2_ST = [{ w: 560, cx: 0.51, cy: 0.5 }, { w: 575, cx: 0.5, cy: 0.5 }, { w: 590, cx: 0.5, cy: 0.52 }, { w: 610, cx: 0.5, cy: 0.52 }, { w: 620, cx: 0.5, cy: 0.52 }];
  const H2_LBL = [
    { go: 'club', ico: '🏃', t: 'クラブハウス', s: '選手データ・特訓', x: 605, y: 118, area: [540, 168, 440, 135] },
    { go: 'online', ico: '✈️', t: '空港', s: 'オンライン対戦', x: 1072, y: 106, area: [962, 78, 225, 150] },
    { go: 'assoc', ico: '📅', t: 'サッカー協会', s: '日程・順位', x: 1062, y: 240, area: [1000, 282, 212, 160] },
    { go: 'shop', ico: '🛒', t: 'ショップ', s: 'カード・コイン', x: 718, y: 450, area: [700, 486, 218, 146] },
    { go: 'lineup', ico: '👥', t: 'クラブ事務所', s: 'チーム編成', x: 1046, y: 446, area: [980, 468, 190, 168] },
    { go: 'stadium', ico: '⚽', t: 'スタジアム', s: '試合会場', x: 240, y: 408, area: [140, 280, 620, 300] },
    { go: 'post', ico: '📮', t: 'ポスト', s: 'お知らせ・フレンド', x: 730, y: 262, area: [668, 250, 70, 80] },   // 版620
  ];
  const H2_ICO = {}; ['stadium', 'club', 'online', 'assoc', 'shop', 'lineup', 'post'].forEach((k) => { const im = new Image(); im.src = `icons/home_${k}.png`; H2_ICO[k] = im; });
  const H2_POST = new Image(); H2_POST.src = 'icons/post.png';
  const h2Ok = (im) => im && im.complete && im.naturalWidth > 0;
  const h2Ready = () => h2Ok(H2.last) || h2Ok(H2.cur());
  // 版653：次に使いそうな絵（次の季節・ひとつ上と下のスタジアム）を先に読んでおく
  function h2Preload() { if (h2Preload.k === (save && save.week) + '|' + h2Tier()) return; h2Preload.k = (save && save.week) + '|' + h2Tier();
    try { const SN = ['spring', 'summer', 'autumn', 'winter'], sn = seasonOfMonth(cal(save.week || 1).m), nx = SN[(SN.indexOf(sn) + 1) % 4], k = h2Tier();
      setTimeout(() => { H2.bgOf(nx, k); if (k < 4) H2.bgOf(sn, k + 1); if (k > 0) H2.bgOf(sn, k - 1); }, 1500); } catch (_) {} }
  function h2Tier() { try { const t = C.homeTier(save); return Math.max(0, Math.min(4, t ?? ((C.LG[save.league.id] || {}).tier ?? 0))); } catch (_) { return 0; } }   /* 版755：改装が終わったら、ホームの絵も新しいスタジアムに（工事中は今のまま） */
  const h2Renov = () => { try { return save && C.homeTier(save) == null; } catch (_) { return false; } };
  function h2Label(c, L) {
    c.save(); c.font = '900 21px "M PLUS 1p","Hiragino Kaku Gothic ProN",sans-serif'; const tw = c.measureText(L.t).width; c.font = '800 13px "M PLUS 1p","Hiragino Kaku Gothic ProN",sans-serif'; const sw = c.measureText(L.s).width;
    const w = 60 + Math.max(tw, sw) + 16, h = 50, x = L.x, y = L.y;
    c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.roundRect(x + 2, y + 4, w, h, 10); c.fill();
    c.fillStyle = 'rgba(12,30,72,.94)'; c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2; c.beginPath(); c.roundRect(x, y, w, h, 10); c.fill(); c.stroke();
    { const im = H2_ICO[L.go]; c.textBaseline = 'middle'; if (im && im.complete && im.naturalWidth) c.drawImage(im, x - 8, y - 6, 62, 62); else { c.font = '26px sans-serif'; c.textAlign = 'center'; c.fillText(L.ico, x + 26, y + h / 2 + 1); } }   // 版609：建物のアイコン（絵）
    c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = '900 21px "M PLUS 1p","Hiragino Kaku Gothic ProN",sans-serif'; c.fillText(L.t, x + 58, y + 17);
    c.font = '800 13px "M PLUS 1p","Hiragino Kaku Gothic ProN",sans-serif'; c.fillStyle = '#d7e6ff'; c.fillText(L.s, x + 58, y + 37);
    c.restore(); return { x, y, w, h };
  }
  function drawHome2(t) {
    const c = hx; c.clearRect(0, 0, 1280, 720);
    { const b = H2.cur(); H2.last = b; c.drawImage(b, 0, 0, 1280, 720); }   // 版653：前の絵は描かない（今の季節・スタジアムの絵だけ）
    { const sn = save ? seasonOfMonth(cal(save.week || 1).m) : 'spring'; if (seasonNow !== sn) seasonNow = sn; try { seasonFx(c, (t || 0) / 1000); } catch (_) {} }   // 版593：桜の花びら・落ち葉・雪
    const hs = [];
    // 版619：クラブハウスの前のポスト（未読があると数字を出して、ぴょこぴょこ）
    if (H2_POST.complete && H2_POST.naturalWidth) {
      const n = (() => { try { return postUnread(); } catch (_) { return 0; } })(), tt = (t || 0) / 1000, hop = n ? Math.max(0, Math.sin(tt * 5)) * 5 : 0;
      const ph = 62, pw = ph * H2_POST.naturalWidth / H2_POST.naturalHeight, px = 700 - pw / 2, py = 322 - ph - hop;
      c.save(); c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(700, 322, 18, 6, 0, 0, 7); c.fill(); c.drawImage(H2_POST, px, py, pw, ph); c.restore();
      if (n) { const bx = px + pw - 4, by = py + 6; c.save(); c.fillStyle = '#e8323a'; c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(bx, by, 14, 0, 7); c.fill(); c.stroke();
        c.fillStyle = '#fff'; c.font = '900 17px "M PLUS 1p",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(n > 9 ? '9+' : String(n), bx, by + 1); c.restore(); }
      hs.push({ go: 'post', r: { x: px - 14, y: py - 14, w: pw + 28, h: ph + 26 } });
    }
    for (const L of H2_LBL) { hs.push({ go: L.go, area: true, r: { x: L.area[0], y: L.area[1], w: L.area[2], h: L.area[3] } }); }
    if (h2Renov()) {   /* 版755：改装工事中は、スタジアムに工事の看板とコーンを出す */
      const r = save.renov, k = cal(r.open), x = 470, y = 372;
      c.save();
      for (const [cx2, cy2] of [[x - 120, y + 34], [x + 128, y + 30], [x - 60, y + 62], [x + 70, y + 60]]) { c.fillStyle = '#ff7a1a'; c.beginPath(); c.moveTo(cx2, cy2 - 26); c.lineTo(cx2 + 11, cy2); c.lineTo(cx2 - 11, cy2); c.closePath(); c.fill(); c.fillStyle = '#fff'; c.fillRect(cx2 - 6, cy2 - 15, 12, 4); c.fillStyle = '#333'; c.fillRect(cx2 - 14, cy2, 28, 4); }
      c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(x - 108, y - 26, 222, 70);
      c.fillStyle = '#ffd21a'; c.fillRect(x - 112, y - 32, 222, 70); c.save(); c.beginPath(); c.rect(x - 112, y - 32, 222, 14); c.rect(x - 112, y + 24, 222, 14); c.clip(); c.fillStyle = '#111'; for (let i = -6; i < 20; i++) { c.beginPath(); c.moveTo(x - 112 + i * 20, y - 32); c.lineTo(x - 102 + i * 20, y - 32); c.lineTo(x - 112 + i * 20 + 30, y + 38); c.lineTo(x - 122 + i * 20 + 30, y + 38); c.fill(); } c.restore();
      c.strokeStyle = '#111'; c.lineWidth = 3; c.strokeRect(x - 112, y - 32, 222, 70);
      c.fillStyle = '#111'; c.font = '900 22px "M PLUS 1p",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('改装工事中', x - 1, y + 3);
      c.restore();
    }
    for (const L of H2_LBL) hs.push({ go: L.go, r: h2Label(c, L.go === 'stadium' && h2Renov() ? { ...L, s: `改装工事中（${cal(save.renov.open).m}月${cal(save.renov.open).w}週まで）`.replace('まで', 'から新スタジアム') } : L) });
    hot = hs;
  }
  function drawHome(t) {
    // 版653：今の絵が読み終わるまでは何も見せない（前のホームの絵・昔の街の絵が一瞬映らないように）
    { const home = document.getElementById('cv-home'), ok = h2Ok(H2.cur()); home.classList.toggle('h2wait', !ok); if (!ok) { hx.clearRect(0, 0, 1280, 720); hot = []; const im = H2.cur(); if (!im._w) { im._w = 1; im.addEventListener('load', () => { if (view === 'home') { try { drawHome(performance.now()); } catch (_) {} } }); } return; } h2Preload(); }
    if (h2Ready()) { if (!document.getElementById('cv-home').classList.contains('home2')) { document.getElementById('cv-home').classList.add('home2'); try { renderHome(); } catch (_) {} } drawHome2(t); return; }
    { const sn = save ? seasonOfMonth(cal(save.week || 1).m) : 'spring'; if (sn !== seasonNow) { seasonNow = sn; townCv = null; } }
    if (!townCv || townSeason !== seasonNow) { buildTown(); townSeason = seasonNow; }
    const c = hx; t = (t || 0) / 1000;
    c.drawImage(townCv, 0, 0);
    hot = townHot;
    seasonFx(c, t);   /* 版478 */
    if (isMatchWeek()) {
      const { gx: sx, gy: sy, w: sw, d: sd } = ST, z = 1.05;
      // 両チームのエンブレムの大きな旗（ホームが左）
      const fx2 = C.nextFixture(save);
      if (fx2 && fx2.opp) {
        const meL = C.teamLook(save, save.team.name), opL = C.teamLook(save, fx2.opp.name);
        const L = fx2.home ? [meL, opL] : [opL, meL], meK = 'me:' + JSON.stringify(meL), keys = fx2.home ? [meK, fx2.opp.name] : [fx2.opp.name, meK];
        const [ax, ay] = iso(sx + 0.8, sy + 2.6, 1.4);
        bigBanner(c, bannerTex(L[0], keys[0]), ax - 30, ay - 112, t, 0);
        bigBanner(c, bannerTex(L[1], keys[1]), ax + 136, ay - 112, t, 1.7);
      }
      return;
      const cols = ['#e23b2b', '#ffffff', '#2f6fe0', '#ffd23a'];
      // スタンドの上にずらりと旗
      for (let k = 0; k < 7; k++) { const [x, y] = iso(sx + 0.6 + k * 1.15, sy + 0.5, z); flag(c, x, y, t, cols[k % 4], k * 0.9); }
      for (let k = 0; k < 4; k++) { const [x, y] = iso(sx + sw - 0.5, sy + 0.8 + k * 1.3, z); flag(c, x, y, t, cols[(k + 1) % 4], k * 1.3 + 2); }
      // 四すみの大きな旗
      for (const [gx, gy] of [[sx, sy], [sx + sw, sy], [sx + sw, sy + sd]]) { const [x, y] = iso(gx, gy, z); flag(c, x, y, t, '#e23b2b', gx + gy, true); }
    }
  }
  // タップした所の建物：名前の札 → 建物の絵（手前にあるものから）
  function hitAt(e) {
    const rc = hc.getBoundingClientRect(), sc = Math.max(rc.width / 1280, rc.height / 720), x = (e.clientX - rc.left - (rc.width - 1280 * sc) / 2) / sc, y = (e.clientY - rc.top - (rc.height - 720 * sc) / 2) / sc;  // object-fit: cover の切り取りを考える
    for (const h of hot) if (!h.area && x >= h.r.x - 6 && x <= h.r.x + h.r.w + 6 && y >= h.r.y - 6 && y <= h.r.y + h.r.h + 6) return h;
    const areas = hot.filter((h) => h.area).sort((a, b) => (b.r.y + b.r.h) - (a.r.y + a.r.h));
    for (const h of areas) if (x >= h.r.x && x <= h.r.x + h.r.w && y >= h.r.y && y <= h.r.y + h.r.h) return h;
    return null;
  }
  hc.addEventListener('click', (e) => { const h = hitAt(e); if (!h) return; if (h.go === 'online') { airport(); return; } if (h.go === 'post') { openPost(() => renderHome()); return; } if (h.go === 'stadium') stadium(); else if (h.go === 'shop') shop(); else if (h.go === 'lineup') openOffice(); else go(h.go); });
  hc.addEventListener('mousemove', (e) => { hc.style.cursor = hitAt(e) ? 'pointer' : 'default'; });
  const TIPS = ['選手は試合に出るほど「判断」が伸びます。', 'スペシャル（スキル）の特訓は、関係する能力が高いほど成功しやすい。', '同じスキルを持つ先輩がいると、スキルを覚えやすくなります。', '疲れたまま特訓すると伸びが落ち、ケガをすることも。休養も大事。', 'スキル枠は、能力が上がると増えていきます。', '特訓で動きのくせ（裏パラ）が変わり、選手タイプが変わることがあります。'];
  function renderHome() {
    ensure();
    const k = cal(save.week);
    $('#hmMonth').innerHTML = dotNum(k.m); $('#hmWeek').innerHTML = dotNum(k.w);
    if (document.getElementById('cv-home').classList.contains('home2')) { renderHome2(k); return; }
    const fx = C.nextFixture(save), st = C.standings(save), rank = (t) => st.findIndex((s) => s.name === t.name) + 1;
    const cs = C.campState(save);
    if (cs) { $('#hmNextMatch').innerHTML = `<div class="nm-card"><p class="hd">${k.m}月${k.w}週　<b class="lg camp">⛺ ${esc(cs.name)}</b>　${cs.week}/${cs.weeks}週目</p><p class="vs">${cs.name === '夏合宿' ? 'リーグ中断期間' : 'オフシーズン'}<br><small>${cs.name === '夏合宿' ? '後半戦まで' : '新シーズン開幕まで'} あと${cs.weeks - cs.week + 1}週</small></p></div><p class="cnt">特訓は<b>週${cs.trains}回</b>・効果<b>${cs.mult}倍</b>　終わったら ▶ で次の週へ</p><p class="coin">${COIN}${(save.coins || 0).toLocaleString()} コイン</p>`; $('#hmTicker').textContent = TIPS.join('　　　'); return; }
    const coin = `<p class="coin">${COIN}${(save.coins || 0).toLocaleString()} コイン</p>`;
    if (fx) {
      const fk = cal(fx.week);
      const when = fx.weeksLeft <= 0 ? '' : `<p class="cnt wait">次の試合まであと <b class="wk">${fx.weeksLeft}</b> 週</p>`;
      const oppTxt = fx.kind === 'league' ? `${esc(fx.opp.name)}（${rank(fx.opp)}位）` : `${esc(fx.opp.name)}<small class="opplg">（${esc((C.LG[fx.opp.lg] || {}).name || '')}）</small>`;
      const meTxt = fx.kind === 'league' ? `${esc(save.team.name)}（${rank(save.league.teams.find((t) => t.me))}位）` : esc(save.team.name);
      $('#hmNextMatch').innerHTML = `<div class="nm-card"><p class="hd">${fk.m}月${fk.w}週　<b class="lg${fx.kind !== 'league' ? ' cuplg' : ''}">${esc(fx.comp)}</b>　${esc(fx.label)}</p><p class="vs">${fx.home ? `<em>${meTxt}</em>` : oppTxt}<br><span class="vsm">VS</span><br>${fx.home ? oppTxt : `<em>${meTxt}</em>`}</p></div>${when}${coin}`;
    } else {
      const left = C.SEASON_WEEKS - save.week + 1, pos = rank(save.league.teams.find((t) => t.me));
      if (cs) { $('#hmNextMatch').innerHTML = `<div class="nm-card"><p class="hd">${k.m}月${k.w}週　<b class="lg camp">⛺ ${esc(cs.name)}</b>　${cs.week}/${cs.weeks}週目</p><p class="vs">オフシーズン<br><small>新シーズン開幕まで あと${left}週</small></p></div><p class="cnt">特訓は<b>週${cs.trains}回</b>・効果<b>${cs.mult}倍</b></p>${coin}`; $('#hmTicker').textContent = TIPS.join('　　　'); return; }
      $('#hmNextMatch').innerHTML = `<div class="nm-card"><p class="hd">${k.m}月${k.w}週　<b class="lg">${esc(save.league.name)}</b></p><p class="vs">リーグ戦終了　<em>${pos}位</em><br><small>オフシーズン</small></p></div><p class="cnt wait">新シーズン開幕まであと <b class="wk">${left}</b> 週</p>${coin}`;
    }
    $('#hmTicker').textContent = TIPS.join('　　　');
  }

  // 版589：新しいホームの上の帯と「次の試合」
  function renderHome2(k) {
    const home = document.getElementById('cv-home');
    let bar = home.querySelector('.h2-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'h2-bar';
      bar.innerHTML = '<img class="h2-emb" alt=""><b class="h2-team"></b><i class="h2-sep"></i><span class="h2-date"><b class="m"></b><small>月</small><b class="w"></b><small>週</small></span><span class="h2-next-slot"></span><span class="h2-coin" data-go="coin">' + COIN + '<b></b><img class="h2-plus" src="icons/ui_plus.png" alt="コインを買う"></span><span class="h2-kk" title="覚醒のカケラ"><img class="kk-ico" src="icons/kakera.png" alt="カケラ"><b></b></span>';
      home.appendChild(bar);
      bar.querySelector('.h2-next-slot').appendChild($('#hmNext'));
      bar.querySelector('.h2-coin').onclick = () => coinShop(() => renderHome());
    }
    $('#hmNext').innerHTML = '<i class="h2-arr">➜</i><b>週を進める</b>';
    bar.querySelector('.h2-emb').src = emblemURL(save.team.name, 64);
    bar.querySelector('.h2-team').textContent = save.team.name;
    bar.querySelector('.m').textContent = k.m; bar.querySelector('.w').textContent = k.w;
    bar.querySelector('.h2-coin b').textContent = (save.coins || 0).toLocaleString();
    { const kb = bar.querySelector('.h2-kk b'); if (kb) kb.textContent = (save.kakera || 0).toLocaleString(); }
    postBadge(); syncPost();   // 版618：ポストの未読（1分に1回まで）
    const fx = C.nextFixture(save), st = C.standings(save), rank = (t) => st.findIndex((s) => s.name === t.name) + 1, cs = C.campState(save);
    let body;
    if (fx) {
      // 版642：エンブレムを左右に並べた対戦カード（左が自分。下にHOME／AWAY。いつの試合かを大きく）
      const fk = cal(fx.week), lgName = (t) => esc((C.LG[t.lg] || {}).name || '');
      const meSub = fx.kind === 'league' ? `${rank(save.league.teams.find((t) => t.me))}位` : '';
      const opSub = fx.kind === 'league' ? `${rank(fx.opp)}位` : lgName(fx.opp);
      const wl = fx.weeksLeft;
      const when = wl <= 0 ? '<b class="nm2-big">今週は試合の日！</b><small>ここを押してスタジアムへ</small>' : `<span>試合まで あと</span><b class="nm2-num">${wl}</b><span>週</span><small>${fk.m}月${fk.w}週</small>`;   // 版643：今週か、まだ先かをはっきり
      body = `<div class="nm2-hd${wl <= 0 ? ' today' : ''}"><b>${wl <= 0 ? '今週の試合' : '次の試合'}</b>${fx.kind === 'league' ? `<span class="nm2-lgi" title="${esc(fx.comp)}">${lgBadge(save.league.id)}</span>` : `<i class="h2-lg cup">${esc(fx.comp)}</i>`}${fx.label ? `<small>${esc(fx.label)}</small>` : ''}</div>
        <div class="nm2-vs"><div class="nm2-t me"><img src="${emblemURL(save.team.name, 96)}" alt=""><b>${esc(save.team.name)}</b>${meSub ? `<small>${meSub}</small>` : ''}<i class="nm2-ha ${fx.home ? 'h' : 'a'}">${fx.home ? 'HOME' : 'AWAY'}</i></div>
          <span class="nm2-x">VS</span>
          <div class="nm2-t"><img src="${emblemURL(fx.opp.name, 96)}" alt=""><b>${esc(fx.opp.name)}</b>${opSub ? `<small>${opSub}</small>` : ''}</div></div>
        <p class="nm2-when${wl <= 0 ? ' today' : ''}">${when}</p>`;
    } else if (cs) body = `<p class="h2-h">${esc(cs.name)}</p><p class="h2-sub">${cs.week}/${cs.weeks}週目</p><p class="h2-vs">特訓は週${cs.trains}回・効果${cs.mult}倍</p>`;
    else { const left = C.SEASON_WEEKS - save.week + 1; body = `<p class="h2-h">オフシーズン</p><p class="h2-sub">${esc(save.league.name)}</p><p class="h2-left">新シーズンまであと${left}週</p>`; }
    let card = home.querySelector('.h2-card'); if (!card) { card = document.createElement('div'); card.className = 'h2-card'; home.appendChild(card); card.onclick = () => go('assoc'); }
    card.innerHTML = body;
    // 版716：見出しが入りきらない時は、「…」で切らずに、文字を少しずつ小さくして全部入れる
    { const fit = () => { const h = card.querySelector('.nm2-hd'); if (!h || !h.clientWidth) return; const lg = h.querySelector('.h2-lg'), sm = h.querySelector('small'), b = h.querySelector('b');
        [lg, sm, b].forEach((e) => e && (e.style.fontSize = ''));
        for (let f = 11; f >= 7 && h.scrollWidth > h.clientWidth + 1; f -= 0.5) { if (lg) lg.style.fontSize = f + 'px'; if (sm) sm.style.fontSize = f + 'px'; if (b && f < 10) b.style.fontSize = (f + 3) + 'px'; } };
      fit(); requestAnimationFrame(fit); setTimeout(fit, 300); }
    { const go2 = card.querySelector('.nm2-when'); if (go2) go2.onclick = (e) => { e.stopPropagation(); advance(); }; }   // 版657：赤いボタンは「週を進める」と同じく、コーチが「スタジアムに移動しますか？」と聞く（ほかの所は今まで通り試合日程）
  }
  // ================= クラブハウス：練習グラウンド（カルチョビットAのように、ななめのグラウンドで色んな練習） =================
  const cc = $('#clubCv'), cx = cc.getContext('2d');
  const runners = [];
  // グラウンドの座標（u：サイドラインに沿って右上へ、v：サイドラインから手前へ）→ 画面
  const GO = [0, 590], GU = [15.5, -7.6], GV = [9.2, 6.2];
  const gp = (u, v) => [GO[0] + u * GU[0] + v * GV[0], GO[1] + u * GU[1] + v * GV[1]];
  let fieldCv = null;
  function buildField() {
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const c = cv.getContext('2d');
    c.fillStyle = '#3fcf34'; c.fillRect(0, 0, 1280, 720);
    // 芝のざらざら
    const r = seeded(3); for (let k = 0; k < 2600; k++) { c.fillStyle = r() < 0.5 ? 'rgba(0,80,0,0.07)' : 'rgba(255,255,255,0.05)'; c.fillRect(r() * 1280, r() * 720, 2, 2); }
    // 奥：木々・道・フェンス（左上の三角）
    const fy = (x) => 512 - 0.49 * x;   // フェンスの根もと（サイドラインの少し奥）
    c.fillStyle = '#2f8a2a'; c.beginPath(); c.moveTo(0, 0); c.lineTo(1280, 0); c.lineTo(1280, fy(1280) - 4); c.lineTo(0, fy(0) - 4); c.closePath(); c.fill();
    // 奥の森（道の向こう）
    for (let row = 0; row < 4; row++) for (let k = -3; k < 26; k++) { const x = k * 70 + (row % 2) * 35, y = fy(x) - 190 - row * 46; c.fillStyle = '#1b5e1d'; c.beginPath(); c.arc(x, y, 34, 0, 7); c.fill(); c.fillStyle = '#2a7d28'; c.beginPath(); c.arc(x - 10, y - 10, 22, 0, 7); c.fill(); c.fillStyle = '#3f9a36'; c.beginPath(); c.arc(x - 14, y - 15, 9, 0, 7); c.fill(); }
    // 道（灰色）と縁石
    c.fillStyle = '#9a9c9a'; c.beginPath(); c.moveTo(0, fy(0) - 150); c.lineTo(1280, fy(1280) - 150); c.lineTo(1280, fy(1280) - 105); c.lineTo(0, fy(0) - 105); c.closePath(); c.fill();
    c.strokeStyle = '#f2f2f2'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, fy(0) - 104); c.lineTo(1280, fy(1280) - 104); c.stroke(); c.lineWidth = 1;
    // 生け垣と木（道の手前）
    c.fillStyle = '#257a24'; c.beginPath(); c.moveTo(0, fy(0) - 96); c.lineTo(1280, fy(1280) - 96); c.lineTo(1280, fy(1280) - 8); c.lineTo(0, fy(0) - 8); c.closePath(); c.fill();
    for (let k = -2; k < 30; k++) { const x = k * 62 + (k % 2) * 18, y = fy(x) - 70 - (k % 3) * 8; c.fillStyle = '#5a3a1e'; c.fillRect(x - 3, y + 6, 6, 24); c.fillStyle = '#1d6e1e'; c.beginPath(); c.arc(x, y, 30, 0, 7); c.fill(); c.fillStyle = '#2f9a2c'; c.beginPath(); c.arc(x - 9, y - 9, 18, 0, 7); c.fill(); c.fillStyle = '#4ab83e'; c.beginPath(); c.arc(x - 13, y - 14, 8, 0, 7); c.fill(); }
    for (let k = 0; k < 44; k++) { const x = k * 30, y = fy(x) - 14; c.fillStyle = k % 2 ? '#226e22' : '#2a7e28'; c.beginPath(); c.arc(x, y, 13, 0, 7); c.fill(); }
    // フェンス（網と柱）
    c.strokeStyle = 'rgba(30,70,30,0.55)';
    for (let x = -20; x < 1300; x += 9) { c.beginPath(); c.moveTo(x, fy(x)); c.lineTo(x + 40, fy(x + 40) - 90); c.stroke(); c.beginPath(); c.moveTo(x + 40, fy(x + 40)); c.lineTo(x, fy(x) - 90); c.stroke(); }
    c.strokeStyle = '#6d6f6d'; c.lineWidth = 2; for (const h of [0, 45, 90]) { c.beginPath(); c.moveTo(0, fy(0) - h); c.lineTo(1280, fy(1280) - h); c.stroke(); } c.lineWidth = 1;
    for (let x = 30; x < 1300; x += 150) { const y = fy(x); c.fillStyle = '#8d908d'; c.fillRect(x - 4, y - 150, 8, 150); c.fillStyle = '#c4c6c4'; c.fillRect(x - 4, y - 150, 3, 150); c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.ellipse(x + 6, y, 10, 3, 0, 0, 7); c.fill(); }
    // サイドライン
    c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.beginPath(); c.moveTo(...gp(-6, 0)); c.lineTo(...gp(90, 0)); c.stroke(); c.lineWidth = 1;
    fieldCv = cv;
  }
  // コーチ：3人とも見た目が違う（監督は黒いスーツにサングラス、コーチはグレーのジャケット、もう1人は白いジャンパー）
  const COACH_LOOK = [
    [{ hair: 0, hairColor: 0, skin: 1 }, '#26282c', '#3d4046', '#151618', '#26282c', true],
    [{ hair: 2, hairColor: 3, skin: 0 }, '#6a6e74', '#8a8f96', '#4a4e54', '#2a2c30', false],
    [{ hair: 1, hairColor: 1, skin: 0 }, '#3c3f45', '#565a61', '#2a2c31', '#1e2024', false],   // 版646：白いジャンパー → 濃いグレーの練習着
  ];
  const coachCache = new Map();
  function coachImg(k, view, frame, run) {
    const key = [k, view, frame, run ? 1 : 0].join('|');
    if (coachCache.has(key)) return coachCache.get(key);
    const [info, shirt, light, dark, pants, shades] = COACH_LOOK[k];
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const src = A().spriteCanvas(info, 2, view, frame, run, false);
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
    const MAP = [['#2f6fd6', shirt], ['#6ea2f2', light], ['#1d4796', dark], ['#ffffff', pants]].map(([a2, b2]) => [hex(a2), hex(b2)]);
    for (let i = 0; i < px.length; i += 4) for (const [f, t] of MAP) if (px[i] === f[0] && px[i + 1] === f[1] && px[i + 2] === f[2]) { px[i] = t[0]; px[i + 1] = t[1]; px[i + 2] = t[2]; }
    x.putImageData(d, 0, 0);
    if (shades && view !== 'back' && view !== 'b34') { x.fillStyle = '#111'; for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) { const q = (yy * c.width + xx) * 4; if (px[q] === 0x23 && px[q + 1] === 0x1c && px[q + 2] === 0x1c) x.fillRect(xx - 1, yy, 3, 1); } }
    coachCache.set(key, c); return c;
  }
  // コーチの動き：メモを取る・笛を吹く・バインダーを見る・腕を組む・歩きながら見る
  const coachSt = [0, 1, 2].map((k) => ({ u: 9 + k * 2.6, v: -1.6 + k * 0.4, hu: 9 + k * 2.6, hv: -1.6 + k * 0.4, act: 'look', until: 0, face: 1, tu: null }));
  const COACH_ACTS = [['note', 'whistle', 'look', 'binder'], ['binder', 'note', 'look', 'walk'], ['whistle', 'look', 'note', 'walk']];
  function drawCoach(c, k, t, S) {
    const st = coachSt[k];
    if (t > st.until) {
      const list = COACH_ACTS[k]; st.act = list[Math.floor(Math.random() * list.length)]; st.until = t + 2500 + Math.random() * 3000;
      st.tu = st.act === 'walk' ? { u: st.hu + (Math.random() * 6 - 3), v: st.hv + Math.random() * 1.2 } : { u: st.hu, v: st.hv };
      st.face = Math.random() < 0.5 ? 1 : -1;
    }
    const du = st.tu.u - st.u, dv = st.tu.v - st.v, d = Math.hypot(du, dv), moving = d > 0.05;
    if (moving) { st.u += du / d * Math.min(0.05, d); st.v += dv / d * Math.min(0.05, d); }
    const [x, y] = gp(st.u, st.v), sc = 2.1;
    const flip = moving ? du * GU[0] + dv * GV[0] < 0 : st.face < 0;
    const view = moving ? 'f34' : st.act === 'whistle' || st.act === 'note' ? 'front' : 'f34';
    const img = coachImg(k, view, moving ? Math.floor(t / 140) % 4 : 0, moving);
    c.fillStyle = 'rgba(0,50,0,0.32)'; c.beginPath(); c.ellipse(x, y, 8 * sc, 2.6 * sc, 0, 0, 7); c.fill();
    c.save(); c.imageSmoothingEnabled = false; c.translate(x, 0); if (flip && view !== 'front') c.scale(-1, 1);
    c.drawImage(img, -S.W * sc / 2, y - (S.H - 2) * sc, S.W * sc, S.H * sc); c.restore();
    // 小道具（体のまえ）
    const hx = x + (flip ? -6 : 6), hy = y - 17;
    if (st.act === 'note' && !moving) {
      // ノートを持って、ペンを動かす
      c.fillStyle = '#f4f0e0'; c.fillRect(x - 9, hy - 5, 18, 12); c.strokeStyle = '#555'; c.lineWidth = 1; c.strokeRect(x - 9, hy - 5, 18, 12);
      c.fillStyle = '#9ab'; for (let l = 0; l < 3; l++) c.fillRect(x - 7, hy - 2 + l * 3, 14, 1);
      const px2 = x - 6 + ((t / 90) % 12), py2 = hy - 2 + Math.floor((t / 1080) % 3) * 3;
      c.strokeStyle = '#2a4ab0'; c.lineWidth = 2; c.beginPath(); c.moveTo(px2, py2); c.lineTo(px2 + 4, py2 - 6); c.stroke(); c.lineWidth = 1;
    } else if (st.act === 'binder' && !moving) {
      // バインダー（クリップボード）をのぞきこむ
      c.fillStyle = '#7a4e26'; c.fillRect(hx - 8, hy - 7, 16, 15); c.fillStyle = '#fff'; c.fillRect(hx - 6, hy - 5, 12, 11); c.fillStyle = '#bbb'; c.fillRect(hx - 3, hy - 9, 6, 3);
      c.fillStyle = '#e33'; c.fillRect(hx - 4, hy - 2, 2, 2); c.fillStyle = '#23c'; c.fillRect(hx + 1, hy + 1, 2, 2);
    } else if (st.act === 'whistle' && !moving) {
      // 笛を吹く（ときどき「ピッ！」）
      c.fillStyle = '#d8dde2'; c.fillRect(x - 3, y - 27, 7, 4); c.fillStyle = '#8a9096'; c.fillRect(x + 3, y - 27, 2, 3);
      if (Math.floor(t / 600) % 3 === 0) { c.font = '900 13px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#123'; c.fillStyle = '#fff'; c.strokeText('ピッ！', x + 10, y - 44); c.fillText('ピッ！', x + 10, y - 44); c.strokeStyle = '#fff'; c.lineWidth = 2; for (const a of [-0.5, 0, 0.5]) { c.beginPath(); c.moveTo(x + 8 + Math.cos(a) * 4, y - 27 + Math.sin(a) * 4); c.lineTo(x + 8 + Math.cos(a) * 9, y - 27 + Math.sin(a) * 9); c.stroke(); } c.lineWidth = 1; }
    }
    return y;
  }
  // 試合と同じボール（白に黒い五角形、転がると回る）
  const BALL_P = [[0, 1, 0], [0, -1, 0], [0.894, 0.447, 0], [0.276, 0.447, 0.851], [-0.724, 0.447, 0.526], [-0.724, 0.447, -0.526], [0.276, 0.447, -0.851], [0.724, -0.447, 0.526], [-0.276, -0.447, 0.851], [-0.894, -0.447, 0], [-0.276, -0.447, -0.851], [0.724, -0.447, -0.526]];
  function drawBall(c, x, y, r, rot, h) {
    h = h || 0;
    c.fillStyle = 'rgba(0,40,0,0.38)'; c.beginPath(); c.ellipse(x, y, r * 1.05, r * 0.42, 0, 0, 7); c.fill();
    const cy2 = y - r * 0.8 - h;
    c.fillStyle = '#fff'; c.strokeStyle = '#222'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, cy2, r, 0, 7); c.fill(); c.stroke();
    c.save(); c.beginPath(); c.arc(x, cy2, r - 0.5, 0, 7); c.clip(); c.fillStyle = '#222';
    const ca = Math.cos(rot), sa = Math.sin(rot);
    for (const [px3, py3, pz3] of BALL_P) {
      const yy = py3 * ca - pz3 * sa, zz = py3 * sa + pz3 * ca;   // 横の軸で回す（前に転がる）
      if (zz < -0.1) continue;
      const sq = Math.max(0.25, zz), ang = Math.atan2(yy, px3);
      c.beginPath(); c.ellipse(x + px3 * r * 0.85, cy2 - yy * r * 0.85, r * 0.3 * sq, r * 0.3, ang + Math.PI / 2, 0, 7); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(x - r * 0.35, cy2 - r * 0.38, r * 0.28, 0, 7); c.fill();
    c.restore(); c.lineWidth = 1;
  }
  const BALL_R = 10;
  // 練習の道具（そのメニューのときだけ置く）
  function cone(c, u, v) { const [x, y] = gp(u, v); c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.ellipse(x + 2, y, 6, 2.5, 0, 0, 7); c.fill(); c.fillStyle = '#e8402e'; c.beginPath(); c.moveTo(x, y - 13); c.lineTo(x + 6, y); c.lineTo(x - 6, y); c.closePath(); c.fill(); c.fillStyle = '#ff8a7a'; c.fillRect(x - 1, y - 11, 2, 9); }
  function miniGoal(c, u, v, dir) {
    // 小さなゴール（幅は v 方向に6、奥行きは u 方向）：ポスト2本＋クロスバー＋ネット
    const H = 30, dep = 1.6 * dir;
    const f0 = gp(u, v - 3), f1 = gp(u, v + 3), b0 = gp(u + dep, v - 3), b1 = gp(u + dep, v + 3);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.beginPath(); c.moveTo(f0[0], f0[1] - H); c.lineTo(f1[0], f1[1] - H); c.lineTo(b1[0], b1[1] - H * 0.55); c.lineTo(b0[0], b0[1] - H * 0.55); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(b0[0], b0[1]); c.lineTo(b1[0], b1[1]); c.lineTo(b1[0], b1[1] - H * 0.55); c.lineTo(b0[0], b0[1] - H * 0.55); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1;
    for (let k = 0; k <= 8; k++) { const a = k / 8, fx2 = f0[0] + (f1[0] - f0[0]) * a, fy2 = f0[1] + (f1[1] - f0[1]) * a, bx2 = b0[0] + (b1[0] - b0[0]) * a, by2 = b0[1] + (b1[1] - b0[1]) * a; c.beginPath(); c.moveTo(fx2, fy2 - H); c.lineTo(bx2, by2 - H * 0.55); c.lineTo(bx2, by2); c.stroke(); }
    for (let k = 1; k < 4; k++) { const hh = H * 0.55 * k / 4; c.beginPath(); c.moveTo(b0[0], b0[1] - hh); c.lineTo(b1[0], b1[1] - hh); c.stroke(); }
    c.strokeStyle = '#fff'; c.lineWidth = 3.5; c.beginPath(); c.moveTo(f0[0], f0[1]); c.lineTo(f0[0], f0[1] - H); c.lineTo(f1[0], f1[1] - H); c.lineTo(f1[0], f1[1]); c.stroke(); c.lineWidth = 1;
  }
  function drawProps(c, kind) {
    if (kind === 'ladder') for (const v of [11, 19]) {
      const u0 = 24, u1 = 58, w = 1.6;
      c.strokeStyle = '#ffffff'; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(...gp(u0, v)); c.lineTo(...gp(u1, v)); c.stroke();
      c.beginPath(); c.moveTo(...gp(u0, v + w)); c.lineTo(...gp(u1, v + w)); c.stroke();
      c.lineWidth = 1.6; for (let u = u0; u <= u1 + 0.01; u += 1.7) { c.beginPath(); c.moveTo(...gp(u, v)); c.lineTo(...gp(u, v + w)); c.stroke(); }
      c.lineWidth = 1;
      for (let k = 0; k < 7; k++) cone(c, 15 + k * 1.4, 4);
    }
    if (kind === 'duel') for (const [u0, v0] of DUEL_SPOTS) { cone(c, u0 + 9, v0 - 1.6); cone(c, u0 + 9, v0 + 1.6); cone(c, u0 - 0.5, v0 - 1); cone(c, u0 - 0.5, v0 + 1); }
    if (kind === 'game') { miniGoal(c, 21, 15, -1); miniGoal(c, 57, 15, 1); for (const [u, v] of [[22, 6], [56, 6], [22, 24], [56, 24]]) cone(c, u, v); }
    if (kind === 'pass') for (let pr = 0; pr < 8; pr++) { const cu = 20 + (pr % 4) * 11, cv = 9 + Math.floor(pr / 4) * 12; cone(c, cu - 0.8, cv - 1.2); cone(c, cu - 0.8, cv + 7.2); }
  }
  // 練習メニュー：クラブハウスを開くたびに1つ選ばれる（開いている間は同じ）
  const DRILLS = ['ladder', 'jog', 'pass', 'game', 'duel'];
  const DUEL_SPOTS = [[20, 7], [38, 7], [20, 19], [38, 19]];
  let clubDrill = 'ladder', drillT0 = 0, drillSnap = true;
  function pickDrill() { const opts = DRILLS.filter((d) => d !== clubDrill); clubDrill = opts[Math.floor(Math.random() * opts.length)]; drillT0 = -1; drillSnap = true; clubBall.rot = 0; }
  const clubBall = { u: 39, v: 15, tu: 39, tv: 15, rot: 0 };
  function drillTarget(kind, k, n, t) {
    if (kind === 'ladder') {
      // 2列に並んで、ラダーを駆け抜け、外側を戻る
      const lane = k % 2, v = lane ? 19.8 : 11.8, per = 6.5, ph = ((t / 1000 + (k >> 1) * per / Math.ceil(n / 2)) % per) / per;
      if (ph < 0.45) return { u: 23 + (ph / 0.45) * 36, v, fast: true };
      if (ph < 0.55) return { u: 59, v: v + ((ph - 0.45) / 0.1) * 3.5 };
      return { u: 59 - ((ph - 0.55) / 0.45) * 38, v: v + 3.5 };
    }
    if (kind === 'jog') {
      // 4列のかたまりでゆっくり走る（右上へ流れて、また左下から）
      const cu = 14 + ((t / 1000) * 3.0) % 42, row = Math.floor(k / 4), col = k % 4;
      return { u: cu - row * 3.4 + (col % 2) * 0.9, v: 8 + col * 3.4 + Math.sin(t / 700 + k) * 0.15, fast: false };
    }
    if (kind === 'pass') { const pr = k >> 1, side = k & 1; return { u: 20 + (pr % 4) * 11, v: 9 + Math.floor(pr / 4) * 12 + (side ? 6 : 0) }; }
    if (kind === 'duel') {
      // 4人1組：ボールを持った1人が、前の1人をドリブルでかわしてコーンの門を通る。終わったら順番を交代
      const g = Math.min(3, Math.floor(k / 4)), m = k - g * 4, [u0, v0] = DUEL_SPOTS[g], per = 4.2, tt = t / 1000 + g * 1.1, rnd = Math.floor(tt / per), ph = (tt % per) / per;
      const size = Math.min(4, n - g * 4) + (g === 3 ? Math.max(0, n - 16) : 0), role = ((m - rnd) % size + size) % size;
      const fe = Math.sin(ph * Math.PI * 3 + g) * 1.6 * Math.sin(ph * Math.PI);   // 左右のフェイント
      if (role === 0) return { u: u0 + ph * 11, v: v0 + fe, fast: ph > 0.35, ball: true };
      if (role === 1) return { u: u0 + 5.8 - Math.max(0, ph - 0.6) * 2, v: v0 + fe * 0.8 * (ph < 0.55 ? 1 : 0.4), def: true };
      return { u: u0 - 2 - (role - 2) * 1.5, v: v0 + 0.3 };
    }
    // ミニゲーム：紅白の2チームで、ミニゴールに向かって実際にパス・ドリブル・シュート（mgStep で動かす）
    return MG.tg[k] || { u: 39, v: 15 };
  }
  // ---- ミニゲーム（版460）：2チーム（ビブス）・GK・パスとドリブルとシュート。ゴールが決まったら真ん中から再開 ----
  const MG = { n: -1, team: [], gk: [], spot: [], owner: -1, hold: 0, hT: 1, ball: { u: 39, v: 15, tu: 39, tv: 15, sp: 0, rot: 0 }, fly: null, pause: 0, kickTeam: 0, press: {}, tg: [] };
  const MG_U0 = 22.5, MG_U1 = 55.5, MG_GV = 15;
  function mgInit(ps) {
    const n = ps.length; MG.n = n; MG.team = []; MG.gk = [-1, -1]; MG.spot = [];
    const gks = ps.map((p, k) => (p.position === 'GK' ? k : -1)).filter((k) => k >= 0);
    gks.slice(0, 2).forEach((k, t) => { MG.gk[t] = k; });
    let tt = 0; for (let k = 0; k < n; k++) { if (MG.gk[0] === k) MG.team[k] = 0; else if (MG.gk[1] === k) MG.team[k] = 1; else { MG.team[k] = tt; tt ^= 1; } }
    for (const t of [0, 1]) {
      const field = []; for (let k = 0; k < n; k++) if (MG.team[k] === t && MG.gk[t] !== k) field.push(k);
      const m = field.length, cols = Math.max(2, Math.ceil(m / 3));
      field.forEach((k, i) => { const col = i % cols, row = Math.floor(i / cols), rows = Math.ceil(m / cols);
        const depth = (col + 0.5) / cols;   // 0＝自陣のゴール寄り、1＝相手ゴール寄り
        const u = t === 0 ? 25 + depth * 13 : 53 - depth * 13, v = 7 + ((row + 0.5) / rows) * 16 + (col % 2 ? 1.2 : -1.2);
        MG.spot[k] = { u, v }; });
      if (MG.gk[t] >= 0) MG.spot[MG.gk[t]] = { u: t === 0 ? MG_U0 + 0.6 : MG_U1 - 0.6, v: MG_GV };
    }
    MG.owner = -1; MG.fly = null; MG.pause = 1.2; MG.kickTeam = 0; MG.ball.u = 39; MG.ball.v = 15;
  }
  function mgStep(dt, ps) {
    if (MG.n !== ps.length) mgInit(ps);
    const B = MG.ball, R = runners, n = ps.length, rnd = Math.random;
    const goalU = (t) => (t === 0 ? MG_U1 : MG_U0);   // そのチームが攻めるゴール
    const near = (u, v, t, not) => { let bk = -1, bd = 1e9; for (let k = 0; k < n; k++) { if (k === not || (t != null && MG.team[k] !== t)) continue; const d = Math.hypot(R[k].u - u, R[k].v - v); if (d < bd) { bd = d; bk = k; } } return [bk, bd]; };
    if (MG.pause > 0) {
      MG.pause -= dt; MG.owner = -1; MG.fly = null; B.u += (39 - B.u) * 0.08; B.v += (15 - B.v) * 0.08;
      for (let k = 0; k < n; k++) MG.tg[k] = { u: MG.spot[k].u + (MG.team[k] === MG.kickTeam && MG.gk[MG.team[k]] !== k ? 2 : 0), v: MG.spot[k].v };
      if (MG.pause <= 0) { let bk = -1, bd = 1e9; for (let k = 0; k < n; k++) if (MG.team[k] === MG.kickTeam && MG.gk[MG.kickTeam] !== k) { const d = Math.hypot(MG.spot[k].u - 39, MG.spot[k].v - 15); if (d < bd) { bd = d; bk = k; } } MG.owner = bk; MG.hold = 0; MG.hT = 0.8 + rnd(); }
      return;
    }
    // ボールの動き
    if (MG.fly) {
      const f = MG.fly, du = f.u - B.u, dv = f.v - B.v, d = Math.hypot(du, dv), st = Math.min(d, f.sp * dt);
      if (d > 0.01) { B.u += du / d * st; B.v += dv / d * st; B.rot += st * 1.5; }
      // 途中で相手が触る（カット）
      const [ok, od] = near(B.u, B.v, 1 - f.team);
      if (od < 0.7 && f.kind === 'pass' && rnd() < 0.08) { MG.fly = null; MG.owner = ok; MG.hold = 0; MG.hT = 0.6 + rnd(); }
      else if (f.kind === 'pass' && Math.hypot(R[f.to].u - B.u, R[f.to].v - B.v) < 0.9) { MG.fly = null; MG.owner = f.to; MG.hold = 0; MG.hT = 0.7 + rnd() * 1.2; }
      else if (d < 0.2) {
        if (f.kind === 'shot') { const gk = MG.gk[1 - f.team];
          if (gk >= 0 && Math.abs(R[gk].v - B.v) < 1.6 && rnd() < 0.55) { MG.fly = null; MG.owner = gk; MG.hold = 0; MG.hT = 1.1; }
          else { MG.fly = null; MG.kickTeam = 1 - f.team; MG.pause = 2.2; }   // ゴール！ 決められた方のボールで再開
        } else { MG.fly = null; const [k2] = near(B.u, B.v, null); MG.owner = k2; MG.hold = 0; MG.hT = 0.6 + rnd(); }
      }
    } else if (MG.owner >= 0) {
      const o = MG.owner, t = MG.team[o], dir = t === 0 ? 1 : -1, r = R[o];
      B.u = r.u + dir * 0.7; B.v = r.v + 0.2; B.rot += Math.hypot(r.vu, r.vv) * 1.5;
      MG.hold += dt;
      // 相手に寄せられ続けると取られる
      const [ok, od] = near(r.u, r.v, 1 - t);
      MG.press[o] = od < 0.85 ? (MG.press[o] || 0) + dt : 0;
      if (MG.press[o] > 0.55 && rnd() < 0.05) { MG.owner = ok; MG.hold = 0; MG.hT = 0.5 + rnd(); MG.press[o] = 0; }
      else if (MG.hold > MG.hT) {
        const gu = goalU(t), dG = Math.abs(gu - r.u);
        if (MG.gk[t] !== o && dG < 10 && rnd() < 0.55) { MG.fly = { kind: 'shot', team: t, u: gu + dir * 0.6, v: MG_GV + (rnd() - 0.5) * 3.4, sp: 22 }; MG.owner = -1; }
        else {
          // パス：前にいて、相手が近くにいない味方を選ぶ
          let best = -1, bs = -1e9;
          for (let k = 0; k < n; k++) { if (k === o || MG.team[k] !== t || MG.gk[t] === k) continue; const q = R[k], fwd = (q.u - r.u) * dir, dd = Math.hypot(q.u - r.u, q.v - r.v); if (dd < 2.5 || dd > 16) continue; const [, md] = near(q.u, q.v, 1 - t); const sc = fwd * 0.35 + Math.min(md, 4) - dd * 0.08 + rnd() * 1.5; if (sc > bs) { bs = sc; best = k; } }
          if (best >= 0) { const q = R[best]; MG.fly = { kind: 'pass', team: t, to: best, u: q.u + q.vu * 12, v: q.v + q.vv * 12, sp: 13 }; MG.owner = -1; }
          else { MG.hold = 0; MG.hT = 0.5 + rnd(); }
        }
      }
    }
    B.u = Math.max(MG_U0 - 0.4, Math.min(MG_U1 + 0.4, B.u)); B.v = Math.max(5.5, Math.min(24.5, B.v));
    // それぞれの動き先
    const ownT = MG.owner >= 0 ? MG.team[MG.owner] : MG.fly ? MG.fly.team : -1;
    const presser = [-1, -1]; for (const t of [0, 1]) if (ownT === 1 - t) { let bk = -1, bd = 1e9; for (let k = 0; k < n; k++) if (MG.team[k] === t && MG.gk[t] !== k) { const d = Math.hypot(R[k].u - B.u, R[k].v - B.v); if (d < bd) { bd = d; bk = k; } } presser[t] = bk; }
    for (let k = 0; k < n; k++) {
      const t = MG.team[k], dir = t === 0 ? 1 : -1, sp = MG.spot[k];
      if (MG.gk[t] === k) { MG.tg[k] = { u: sp.u, v: Math.max(12.6, Math.min(17.4, MG_GV + (B.v - MG_GV) * 0.45)) }; continue; }
      if (k === MG.owner) { MG.tg[k] = { u: r2(R[k].u + dir * 2.2), v: R[k].v + (MG_GV - R[k].v) * 0.15, fast: false, ball: true }; continue; }
      if (MG.fly && MG.fly.kind === 'pass' && MG.fly.to === k) { MG.tg[k] = { u: MG.fly.u, v: MG.fly.v, fast: true }; continue; }
      if (presser[t] === k) { MG.tg[k] = { u: B.u - dir * 0.4, v: B.v, fast: true }; continue; }
      // 陣形のまま、ボールの方へ少し寄る（攻めている時は前へ）
      const push = ownT === t ? 4 * dir : ownT === 1 - t ? -2.5 * dir : 0;
      MG.tg[k] = { u: sp.u + (B.u - 39) * 0.45 + push, v: sp.v + (B.v - 15) * 0.18 };
    }
    function r2(x) { return Math.max(MG_U0 + 0.5, Math.min(MG_U1 - 0.5, x)); }
  }
  let clubLastT = 0;
  function drawClub(tAbs) {
    const c = cx;
    if (!fieldCv) buildField();
    c.drawImage(fieldCv, 0, 0);
    if (view !== 'club') return;
    if (drillT0 < 0) drillT0 = tAbs;
    const t = tAbs - drillT0, dt = Math.min(0.05, Math.max(0, (tAbs - clubLastT) / 1000)); clubLastT = tAbs;
    const ps = save.team.players.filter((p) => !(p.injury > 0));
    const n = ps.length, kind = clubDrill;
    if (runners.length !== n) { runners.length = 0; ps.forEach((p, k) => runners.push({ u: 10 + (k % 4) * 3, v: 6 + Math.floor(k / 4) * 3, vu: 0, vv: 0, sp: 0.85 + (p.speed - 40) * 0.006, rot: 0, fa: Math.PI / 4, ph: k * 0.37, mv: 0 })); drillSnap = true; MG.n = -1; }
    drawProps(c, kind);
    if (kind === 'game') mgStep(dt, ps);
    const S = A().SPR, objs = [];
    const tgs = runners.map((r, k) => drillTarget(kind, k, n, t));
    // 重ならないように、近すぎる人どうしは少し離す（ドリブル中・GKは動かさない）
    if (kind !== 'pass' && kind !== 'ladder') for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) { const A2 = tgs[a], B2 = tgs[b], du = B2.u - A2.u, dv = B2.v - A2.v, d = Math.hypot(du, dv); if (d < 1.3) { const m = (1.3 - d) / 2, nu = d > 0.01 ? du / d : 1, nv = d > 0.01 ? dv / d : 0; if (!A2.ball) tgs[a] = { ...A2, u: A2.u - nu * m, v: A2.v - nv * m }; if (!B2.ball) tgs[b] = { ...B2, u: B2.u + nu * m, v: B2.v + nv * m }; } }
    const bpos = kind === 'game' ? MG.ball : null;
    runners.forEach((r, k) => {
      const tg = tgs[k];
      if (drillSnap) { r.u = tg.u; r.v = tg.v; }
      const du = tg.u - r.u, dv = tg.v - r.v, d = Math.hypot(du, dv);
      const vmax = (tg.fast ? 0.3 : tg.ball ? 0.13 : 0.16) * r.sp, fs = Math.max(0.2, Math.min(3, dt * 60));   // 1コマ（60分の1秒）あたりの速さ。コマ落ちしても同じ速さで動く
      if (d > 0.03) { const m = Math.min(vmax, d * 0.5 + 0.01); r.vu += (du / d * m - r.vu) * 0.35; r.vv += (dv / d * m - r.vv) * 0.35; } else { r.vu *= 0.6; r.vv *= 0.6; }
      r.u += r.vu * fs; r.v += r.vv * fs;
      const spd = Math.hypot(r.vu, r.vv);
      // 走っている・止まっているは、少し余裕をもって切りかえる（ガタガタしないように）
      r.mv = spd > 0.05 ? Math.min(1, r.mv + 0.25) : spd < 0.025 ? Math.max(0, r.mv - 0.2) : r.mv;
      const moving = r.mv > 0.5;
      r.ph += spd * fs / 1.9;   // 走った距離ぶんだけ足を動かす（すべらない）
      const [x, y] = gp(r.u, r.v), sx2 = r.vu * GU[0] + r.vv * GV[0], sy2 = r.vu * GU[1] + r.vv * GV[1];
      // 向き：走っている時は進む方、止まっている時はボール（パスの相手・ゴール）の方。少しずつ回る
      let want = null;
      if (moving && spd > 0.03) want = Math.atan2(sy2 * 1.7, sx2);
      else if (bpos) { const [bx, by] = gp(bpos.u, bpos.v); want = Math.atan2((by - y) * 1.7, bx - x); }
      else if (kind === 'pass') want = k & 1 ? -Math.PI * 0.75 : Math.PI / 4;
      else if (tg.def) want = Math.PI * 0.75;
      else if (!moving) want = Math.PI / 4;
      if (want != null) { let dA = Math.atan2(Math.sin(want - r.fa), Math.cos(want - r.fa)); r.fa += dA * 0.25; }
      const isGK = ps[k].position === 'GK';
      const team = kind === 'game' ? MG.team[k] || 0 : 0;
      objs.push({ y, f: () => {
        const p = ps[k], sc = 2.1, ar = A().artSprite ? A().artSprite(p, team, r.fa, r.ph, moving, isGK) : null;
        c.fillStyle = 'rgba(0,50,0,0.32)'; c.beginPath(); c.ellipse(x, y, 8 * sc, 2.6 * sc, 0, 0, 7); c.fill();
        c.save(); c.imageSmoothingEnabled = false;
        if (ar) { const F = ar.F, px = sc * ar.k; c.drawImage(F.cv, Math.round(x - F.px * px), Math.round(y - F.py * px), F.cv.width * px, F.cv.height * px); }
        else { const img = A().spriteCanvas(p, team, 'f34', 0, false, isGK); c.drawImage(img, x - S.W * sc / 2, y - (S.H - 2) * sc, S.W * sc, S.H * sc); }
        c.restore();
      } });
      // ドリブルするボール（足もとの少し前）
      if (tg.ball && kind !== 'game') { r.rot += d * 1.4; const [bx, by] = gp(r.u + 0.9, r.v + (r.vv * 2)); objs.push({ y: by + 0.1, f: () => drawBall(c, bx, by, BALL_R, r.rot) }); }
    });
    drillSnap = false;
    // 対面パスのボール：ペアの間を行き来する
    if (kind === 'pass') for (let pr = 0; pr * 2 + 1 < n; pr++) { const a = runners[pr * 2], b = runners[pr * 2 + 1], ph = ((t / 1000 + pr * 0.37) % 1.6) / 1.6, u = ph < 0.5 ? ph * 2 : 2 - ph * 2; const bu = a.u + 0.6 + (b.u - a.u) * u, bv = a.v + 0.6 + (b.v - a.v - 1.2) * u, [x, y] = gp(bu, bv); objs.push({ y: y + 0.1, f: () => drawBall(c, x, y, BALL_R, t / 90) }); }
    if (kind === 'game') { const [x, y] = gp(MG.ball.u, MG.ball.v); objs.push({ y: y + 0.1, f: () => drawBall(c, x, y, BALL_R, MG.ball.rot) }); }
    // コーチ3人（サイドラインのそばで、メモ・笛・バインダー）
    for (let k = 0; k < 3; k++) { const [, y] = gp(coachSt[k].u, coachSt[k].v); objs.push({ y, f: () => drawCoach(c, k, tAbs, S) }); }
    objs.sort((a, b) => a.y - b.y).forEach((o) => o.f());
    drawClubButtons(tAbs);
  }
  // 右のボタンのドット絵（選手データ：選手と能力のランクが順に入れかわる／特訓：走る選手）
  let rbLast = -1;
  function drawClubButtons(t) {
    const S = A().SPR, ps = save.team.players;
    const dc = document.getElementById('rbData'), tc = document.getElementById('rbTrain');
    const slot = Math.floor(t / 1400);
    if (dc && slot !== rbLast) {
      rbLast = slot;
      const p = ps[slot % ps.length], q = D.PARAMS[(slot * 5) % D.PARAMS.length];
      C.ensurePts(p); const g = C.rankInfo(p.pts[q.k]).g;
      const x = dc.getContext('2d'); x.clearRect(0, 0, dc.width, dc.height); x.imageSmoothingEnabled = false;
      x.drawImage(A().spriteCanvas(p, 0, 'front', 0, false, p.position === 'GK'), 2, 4, S.W * 1.6, S.H * 1.6);
      const im = icoImg(q.k); if (im.complete) x.drawImage(im, 34, 2, 22, 20);
      x.font = 'italic 900 20px "Arial Black",sans-serif'; x.lineWidth = 3; x.strokeStyle = '#111'; x.fillStyle = { S: '#ffa21f', A: '#ff3a2a', B: '#2fb0f0', C: '#ffe02a', D: '#f2f2f2', E: '#9aa0a0' }[g];
      x.strokeText(g, 37, 41); x.fillText(g, 37, 41);
    }
    if (tc) {
      const x = tc.getContext('2d'); x.clearRect(0, 0, tc.width, tc.height); x.imageSmoothingEnabled = false;
      const p = ps[9] || ps[0];
      x.drawImage(A().spriteCanvas(p, 0, 'side', Math.floor(t / 120) % 4, true, false), 10, 0, S.W * 2, S.H * 2);
    }
  }
  const icoCache = {};
  function icoImg(k) { if (!icoCache[k]) { const im = new Image(); im.src = `icons/${k}.png`; icoCache[k] = im; } return icoCache[k]; }
  // スタメンのミニ図（今のフォーメーションの点）
  function rbLineupSVG() {
    const tac = C.ensureTactics(save), cells = tac.cells || [];
    const dots = cells.slice(1, 11).map((c2) => c2 ? `<circle cx="${6 + c2.c * 3.4}" cy="${44 - c2.r * 3.6}" r="2.3" fill="#fff"/>` : '').join('');
    return `<svg viewBox="0 0 60 56" class="rb-svg"><rect x="2" y="2" width="56" height="52" fill="#3aa83a"/><rect x="2" y="2" width="56" height="12" fill="#2a7a8a"/>${[16, 26, 36].map((y) => `<rect x="2" y="${y}" width="56" height="5" fill="#46b846"/>`).join('')}<rect x="2" y="2" width="56" height="52" fill="none" stroke="#fff" stroke-width="1.5"/><rect x="18" y="44" width="24" height="10" fill="none" stroke="#fff" stroke-width="1.2"/><circle cx="30" cy="51" r="2.3" fill="#ffe66a"/>${dots}</svg>`;
  }
  const RB_TAC_SVG = '<svg viewBox="0 0 60 56" class="rb-svg"><rect x="2" y="4" width="56" height="48" rx="2" fill="#fff" stroke="#bbb"/><rect x="34" y="8" width="20" height="40" fill="#cfeedd" stroke="#8c8" stroke-width=".8"/><line x1="44" y1="8" x2="44" y2="48" stroke="#8c8" stroke-width=".8"/><rect x="6" y="18" width="7" height="18" fill="none" stroke="#888"/><circle cx="20" cy="14" r="2" fill="#e33"/><circle cx="22" cy="26" r="2" fill="#e33"/><circle cx="20" cy="38" r="2" fill="#e33"/><circle cx="28" cy="20" r="2" fill="#e33"/><circle cx="28" cy="32" r="2" fill="#e33"/><circle cx="38" cy="16" r="2" fill="#23c"/><circle cx="40" cy="28" r="2" fill="#23c"/><circle cx="38" cy="40" r="2" fill="#23c"/><circle cx="31" cy="44" r="2" fill="#f2c21c"/><path d="M14 46 q6-6 12-2" stroke="#e33" fill="none" stroke-width="1.2"/></svg>';
  function tick(t) {
    if (!document.getElementById('career') || $('#career').hidden) return;
    if (view === 'home') drawHome(t); else if (liveBack && liveSnap) { cx.drawImage(liveSnap, 0, 0); } else drawClub(t);   // 版559：試合前から開いた時は、後ろも試合会場のまま
    raf = requestAnimationFrame(tick);
  }

  // タイプのバッジ：タイプごとに色分け（カルチョビットAのようにカラフルに）
  const TYPE_CLS = { 'バランス': 'ty-bal', 'アタッカー': 'ty-att', 'ストライカー': 'ty-str', 'ストッパー': 'ty-stp', 'スイーパー': 'ty-swp', 'マンマーカー': 'ty-man', 'ダイナモ': 'ty-dyn', 'レジスタ': 'ty-reg', 'ゲームメイカー': 'ty-gm', 'ラインコントローラー': 'ty-lc', 'パサー': 'ty-pa', '偽9番': 'ty-f9', 'デコイラン': 'ty-dec', 'ファンタジスタ': 'ty-fan', 'シャドー': 'ty-sha', 'アンカー': 'ty-anc', 'ビルドアップ型': 'ty-bu', 'スイーパーキーパー': 'ty-skp', 'ゴールキーパー': 'ty-gk' };
  // 能力のアイコン（文字だけだと分かりにくいので、絵で見分けられるように）
  const ico = (k, cls) => `<img class="pico ${cls || ''}" src="icons/${k}.png" alt="" draggable="false">`;
  // ☆（レア度）の表示：★の数＋凸の印。cap＝育てられる上限のランク
  const starHTML = (n, totsu, cls) => { const t = Math.min(totsu || 0, 3); let h = ''; for (let k = 0; k < n; k++) h += `<i class="tz tz${t}">★</i>`;   /* 版476：無凸＝白、1凸＝銀、2凸＝金、完凸＝虹 */   /* 版467：凸の数で星全部の色が変わる（無凸＝黄、1凸＝青、2凸＝紫、完凸＝虹） */ return `<span class="stars s${n}${t ? ' t' + t : ''} ${cls || ''}" title="☆${n}${t >= 3 ? '・凸MAX' : t ? '・' + t + '凸' : ''}">${h}</span>`; };   // 版456：凸した分だけ、星に色がつく（1凸＝青、2凸＝紫、3凸＝虹）
  const capBadge = (g) => `<span class="capb">上限<b class="rk rk-${g}">${g}</b></span>`;
  const typeBadge = (t, cls) => `<span class="tbadge ${TYPE_CLS[t] || 'ty-bal'} ${cls || ''}" style="--tl:${String(t || '').length || 1}">${esc(t)}</span>`;   // 版700：--tl＝文字数（長いタイプ名は文字を小さく）
  // 版514：調子（ポテンシャルの代わり）：本家と同じ5段階の矢印（↑絶好調・↗好調・→普通・↘不調・↓絶不調）
  const COND_UI = { 2: ['絶好調', -90, '#ff3d2e'], 1: ['好調', -45, '#ff9a1a'], 0: ['普通', 0, '#e8c21a'], '-1': ['不調', 45, '#3a9cff'], '-2': ['絶不調', 90, '#7a5cff'] };
  function condArrow(p, size) { const [, deg, col] = COND_UI[C.condOf(p)]; const z = size || 22;
    return `<svg class="cnd-a" viewBox="0 0 24 24" width="${z}" height="${z}" style="transform:rotate(${deg}deg)"><path d="M3 9h10V3l9 9-9 9v-6H3z" fill="${col}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`; }
  function condGauge(p, cls) { const [nm] = COND_UI[C.condOf(p)]; return `<span class="cnd ${cls || ''}" title="調子">${condArrow(p, cls === 'sm' ? 20 : 26)}<b>${nm}</b></span>`; }
  // ================= 選手データ =================
  const POSC = { GK: 'pos-gk', DF: 'pos-df', MF: 'pos-mf', FW: 'pos-fw' };
  const condDot = (p) => (p.injury > 0 ? 'cd-inj' : p.fatigue > 70 ? 'cd-red' : p.fatigue > 45 ? 'cd-yel' : 'cd-blue');
  // エンブレムを画像に（一覧表・選手カードで使う）
  const embURL = new Map();
  const ART = window.DOT_ART || { emblems: [], leagues: [] };
  const artImgs = {};
  // 版544：エンブレム・リーグのマーク・お店やスカウトの絵を、起動した時に先に読みこんでおく（チームの画面を開いた時に遅れて出ないように）
  const preImgs = [];
  function preloadArt() {
    const urls = ART.emblems.map((id) => `emblems/${id}.png`).concat(ART.leagues.map((k) => `icons/lg/${k}.png?v=768`), ['img/gacha/stage.jpg', 'img/gacha/ring.png', 'img/gacha/ball_white.png', 'img/gacha/ball_silver.png', 'img/gacha/ball_gold.png', 'img/gacha/ball_black.png', 'img/gacha_bg.jpg', 'img/shop_rec.jpg', 'img/shop_cards.jpg', 'img/shop_prem.jpg', 'icons/btn_ok.png', 'icons/btn_no.png', 'icons/btn_blue.png', 'icons/btn_white.png']);
    // 版701：アイコン・特訓カード・お店などの絵も全部、起動した時に先に読みこむ（あとから遅れて出ないように）。アイコンとカードを先に
    { const seen = new Set(urls); const pre = (window.DOT_PRELOAD || []).filter((u) => !seen.has(u)); urls.unshift(...pre); }
    let i = 0; const next = () => { const batch = urls.slice(i, i + 12); i += 12; if (!batch.length) return; Promise.all(batch.map((u) => new Promise((ok) => { const im = new Image(); im.decoding = 'async'; im.onload = im.onerror = () => { try { im.decode && im.decode().catch(() => {}); } catch (_) {} ok(); }; im.src = u; preImgs.push(im); }))).then(() => setTimeout(next, 0)); };
    next();
    // 選手の顔の絵（スター・モブ）も、少しあとから少しずつ読みこむ
    setTimeout(() => { const keys = Object.keys(window.STAR_FACES || {}); let j = 0; const step = () => { for (let k = 0; k < 6 && j < keys.length; k++, j++) { try { starFace(keys[j], '#ffffff', false); } catch (_) {} } if (j < keys.length) setTimeout(step, 120); }; step(); }, 2500);
  }
  setTimeout(preloadArt, 0);
  function embImg(id) { if (!ART.emblems.includes(id)) return null; if (!artImgs[id]) { const im = new Image(); im.src = `emblems/${id}.png`; artImgs[id] = im; } return artImgs[id]; }
  function emblemURL(name, size = 64) {
    const lk = C.teamLook(save, name), id = lk.me ? 'hajimari' : lk.id;
    if (id && ART.emblems.includes(id)) return `emblems/${id}.png`;   // GPTで作ったエンブレム
    const key = name + ':' + size + (lk.me ? ':' + JSON.stringify(lk) : '');
    if (!embURL.has(key)) { const cv = document.createElement('canvas'); cv.width = size; cv.height = size; drawEmblem(cv.getContext('2d'), size / 2, size / 2, size * 0.92, lk); embURL.set(key, cv.toDataURL()); }
    return embURL.get(key);
  }
  // 通常スキルの説明（選手カードの習得スキルで、タップすると出る）
  const SKILL_DESC = {"knuckle": "回転のないシュート。ボールが揺れながら飛ぶので、GKが取りにくい", "curve": "曲がるボールを蹴る。シュートはGKの届かない隅へ、パス・クロスは相手をよけて通る", "fk": "直接FKがうまい。持っているシュート技（無回転・ドライブ・コントロール）をFKでも使える", "ckMaster": "CKの精度が高い。ゴール前の味方へ正確に合わせる", "longThrow": "スローインでゴール前まで投げ込める", "pkMaster": "PKを決めやすい", "wallPass": "近くの味方に当てて、自分はすぐ前へ走る（壁パス）", "slide": "少し離れた所から滑り込んでボールを奪う。後ろからだと反則になりやすい", "feint": "体の動きで逆を取って抜く", "dribbleShot": "縦回転のシュート。バーを越えると見せて急に落ちる", "scissors": "ボールをまたいで相手を揺さぶって抜く", "roulette": "回転して相手をかわす。正面から来た相手に強い", "elastico": "足の外側と内側で素早く切り返して抜く", "doubleTouch": "左右の足で素早くボールを動かして抜く", "bodyFeint": "体の動きで逆を取って抜く", "nutmeg": "相手の股の間にボールを通して抜く", "speedDribble": "スピードに乗ったドリブルで一気に運ぶ", "cutIn": "サイドから中へ切れ込んで、シュートを打ちやすい角度を作る", "heelLift": "かかとでボールを浮かせて、相手の頭上を越して抜く", "kickFeint": "シュートやパスを打つふりをして、相手が止まった瞬間にかわす", "volley": "浮いたボールをそのまま蹴ってシュートする", "lob": "前に出たGKの頭上をふわっと越すシュート", "direct": "パスをトラップせずに、そのままシュートする", "bicycle": "高いボールを後ろ向きのまま、オーバーヘッドで蹴る", "divingHeader": "低いクロスに飛び込んで頭で合わせる", "toeKick": "つま先で素早く打つ。囲まれて踏み込めない所でも打てる", "nearPost": "GKのニア上を強いシュートでぶち抜く", "driveShot": "縦回転のシュート。バーを越えると見せて急に落ちる", "powerMid": "ミドルレンジから思い切った強烈なシュートを打つ", "controlShot": "強さより正確さ。GKの届かない隅へ置きに行く。PAの角付近が得意", "superLong": "センターライン付近からでも、GKが前に出ていれば狙う", "throughPass": "DFラインの裏へ走る味方の足もとへパスを通す", "loftedThrough": "DFの頭上を越えて裏へ落ちるスルーパス", "noLook": "見ている方向と別の方へパスを出す。相手に読まれにくい", "oneTouchPass": "ボールを止めずに、そのまま味方へはたく", "heelPass": "かかとで後ろの味方へパスを出す。相手の意表をつく", "longFeed": "遠くの味方へ正確なロングパスを送る", "earlyCross": "深くえぐる前に、早めのタイミングでゴール前へクロスを入れる", "pinpointCross": "ゴール前の味方の頭や足もとへ、正確にクロスを合わせる", "switchPlay": "逆サイドの空いた味方へ大きく展開する", "intercept": "パスコースを読んで、パスを途中で奪う", "manMark": "決められた相手にぴったり付いて離れない", "cover": "味方が抜かれた時に備えて、2人目として後ろをカバーする", "shoulder": "並走している相手に肩から当たって、体を入れてボールを奪う", "aerial": "空中での競り合いに強い", "shotBlock": "シュートコースに体を投げ出して止める", "pressMonster": "ボールを持った相手へ、しつこく寄せ続ける", "recovery": "ボールより前に残っていたら、全力で守備に戻る", "superReflex": "打たれてから反応するまでが速い", "punching": "取れないボールは、こぶしで遠くへはじき出す", "rushOut": "裏へのボールを、前に出て先に処理する", "pkStopper": "PKを止めやすい", "oneOnOne": "1対1で、体を投げ出してシュートに当てる", "lowThrow": "低く速いスローで、すばやく味方へつなぐ", "lowPunt": "低い弾道のキックで、前線へ速く届ける", "coaching": "声でDFを動かし、シュートコースを切らせる", "behindRun": "最終ラインぎりぎりで待ち、裏へ抜け出す一歩目が速い", "postPlay": "相手を背負ってキープし、上がってきた味方へ落とす", "nearRun": "クロスに、ニアへ飛び込んで合わせる", "farWait": "クロスに、ファーで待って合わせる", "overlap": "サイドの後ろから、積極的に前線へ上がっていく", "looseBall": "シュートのこぼれ球に、いち早く詰める", "oneTwo": "ワンツーがうまい。壁パスの効果があり、走り込みも速い", "captaincy": "まわりの味方を落ち着かせ、チームのプレーを安定させる", "bigStage": "接戦の後半に力を発揮する", "lateGrit": "疲れてもプレーの質が落ちにくい", "clutch": "追いかける終盤やPKなど、大事な場面で決める", "moodMaker": "失点してもチームを盛り上げる", "fighting": "負けている時ほど、競り合いに強くなる", "calm": "ゴール前やPKでも慌てない", "ironMan": "スタミナが減りにくく、試合の最後まで走れる"};
  // 利き足のマーク（本家のように、利き足のほうが光る）
  const footSVG = (foot) => { const sole = (x, on, mir) => `<g transform="translate(${x},0)${mir ? ' scale(-1,1) translate(-14,0)' : ''}"><path d="M7 1c3 0 5 3 5 7 0 3-1 5-1 8 0 3 1 5-1 7-2 1-5 1-6-1-1-2 0-4 0-6 0-3-2-5-2-8C2 4 4 1 7 1z" fill="${on ? '#c8f03a' : '#222'}" stroke="#111" stroke-width="1"/>${on ? `<text x="7" y="12" font-size="8" font-weight="900" text-anchor="middle" fill="#2a4a00">${mir ? 'R' : 'L'}</text>` : ''}</g>`; return `<svg class="footsvg" viewBox="0 0 32 25">${sole(1, foot === 'L', false)}${sole(17, foot === 'R', true)}</svg>`; };
  const lgKey = (id) => id;   // 地域リーグは東西で別のマーク
  const lgBadge = (id) => { const k = lgKey(id); if (ART.leagues.includes(k)) return `<img class="lgi" src="icons/lg/${k}.png?v=768" alt="">`; const b = LG_BADGE[id] || ['?', 'b-r2']; return `<i class="lgb ${b[1]}">${b[0]}</i>`; };
  // ================= 選手データ（カルチョビットAの一覧表のように、詰めて見やすく） =================
  function renderData() {
    const head = D.PARAMS.map((q) => `<th title="${q.name}" class="th-ico">${ico(q.k)}</th>`).join('');
    const rows = save.team.players.map((p, i) => { C.ensurePts(p); return `<tr data-i="${i}" class="${i >= 11 ? 'sub' : ''}"><td><span class="pos ${POSC[p.position]}">${p.position}</span></td><td class="no">${p.number}</td><td class="s-nm">${esc(p.name)}${starHTML(C.ensureStar(p), p.totsu, 'sm')}</td><td><i class="cdot ${condDot(p)}"></i></td>${D.PARAMS.map((q) => { const ri = C.rankInfo(p.pts[q.k]); return `<td class="gd" title="${q.name} ${Math.floor(p.pts[q.k])}（次のランクまであと${Math.max(0, Math.ceil(ri.next - p.pts[q.k]))}）"><b class="rk rk-${ri.g}">${ri.g}</b></td>`; }).join('')}<td>${typeBadge(p.type)}</td><td>${condGauge(p, 'sm')}</td></tr>`; }).join('');
    $('#clubLayer').innerHTML = `<div class="dpanel dp2"><h2><img class="emb" src="${emblemURL(save.team.name, 48)}" alt="">${esc(save.team.name)}　［${lgBadge(save.league.id)}］</h2><div class="dscroll"><table class="dtbl dtbl2"><thead><tr><th>Pos.</th><th>No.</th><th colspan="2">所属選手</th>${head}<th>タイプ</th><th>調子</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    $('#clubLayer').querySelectorAll('tr[data-i]').forEach((tr) => tr.onclick = () => playerDetail(+tr.dataset.i, { club: true }));
  }
  // ================= 選手カード（カルチョビットAの選手カードに寄せる）：タップでページ切り替え・◀▶で前後の選手 =================
  // 選手データからは大きな窓で、特訓画面では左上にそのまま埋め込んで使う（ups：特訓で伸びる予定の分）
  let pcPage = 0;
  function playerCardHTML(i, ups, embed) {
    const ps = save.team.players, p = ps[i];
    C.ensurePts(p);
    const grades = D.PARAMS.map((q) => {
      const v = p.pts[q.k], a = C.rankInfo(v), add = Math.round((ups && ups[q.k]) || 0), b = C.rankInfo(Math.min(C.PMAX - 1, Math.max(v, Math.min(C.capPts(p), v + Math.max(0, add)))));
      const tag = add > 0 ? `<em class="${b.g !== a.g ? 'rkup' : ''}">${b.g !== a.g ? `→${b.g}` : `+${add}`}</em>` : add < 0 ? `<em class="dn">${add}</em>` : (ups ? '<em></em>' : '');
      return `<div><b class="rk rk-${a.g}">${a.g}</b>${tag}</div>`;
    }).join('');
    const icons = D.PARAMS.map((q) => ico(q.k)).join('');
    const pages = ['状態・記録', '詳しい能力値', '習得スキル'];
    let body = '';
    if (pcPage === 0) {
      const recs = Object.entries(p.rec || {}).sort((a, b) => +b[0] - +a[0]).slice(0, 5);
      const fat = Math.round(p.fatigue || 0);
      const hist = [0, 1, 2, 3].map((k) => { const c = (p.trainHist || [])[k]; return c && C.CARDS[c] ? `<img class="hc" src="cards/${c}.jpg" title="${esc(C.CARDS[c].name)}" alt="">` : '<i class="hc empty"></i>'; }).join('<s>›</s>');
      body = `<div class="pc-st"><span class="pc-chip">疲労度<i class="cdot ${condDot(p)}"></i><small>${fat}%</small></span><span class="pc-chip">利き足${footSVG(p.foot)}<small>${p.foot === 'L' ? '左' : '右'}</small></span><span class="pc-chip">${p.injury > 0 ? `<b class="inj">ケガ　あと${p.injury}週</b>` : '<b class="ok">ケガなし</b>'}</span><span class="pc-chip hist">特訓履歴 ${hist}</span></div>
        <div class="pc-car"><span>キャリア</span><b>${save.season}年目</b><span>出場</span><b>${p.games || 0}</b><span>得点</span><b>${recs.reduce((a, [, r]) => a + r.G, 0)}</b><span>アシスト</span><b>${recs.reduce((a, [, r]) => a + r.A, 0)}</b></div>
        <table class="pc-rec"><tr><th>シーズン</th><th>所属クラブ</th><th>P</th><th>G</th><th>A</th><th><i class="ycd"></i></th><th><i class="rcd"></i></th></tr>${recs.length ? recs.map(([sn, r]) => `<tr><td>${sn}年目</td><td>${esc(r.club)}</td><td>${r.P}</td><td>${r.G}</td><td>${r.A}</td><td>${r.Y}</td><td>${r.R}</td></tr>`).join('') : '<tr><td colspan="7" class="none">まだ公式戦の記録はありません</td></tr>'}</table>`;
    } else if (pcPage === 1) {
      body = `<div class="pc-bars">${D.PARAMS.map((q) => { const v = p.pts[q.k], ri = C.rankInfo(v); return `<div class="pc-bar" title="${q.name}"><i class="bar"><i style="height:${Math.round(ri.pct * 100)}%"></i></i><b>${Math.floor(v)}</b><small>あと${Math.max(0, Math.ceil(ri.next - v))}</small></div>`; }).join('')}</div>`;
    } else {
      const n = C.slots(p), sk = p.skills || [], si = C.slotInfo(p);
      const cells = Array.from({ length: Math.max(n, sk.length) }, (_, k) => sk[k] ? `<button class="has pc-skb" data-sk="${sk[k]}">${esc(D.SKILLS[sk[k]].name)}<i>説明</i></button>` : '<span>？</span>');
      // 版852：固有スキルのいまの強さ（総合力×所属リーグ）。上のリーグ・総合力80で満点
      const uqPow = (q) => { if (!D.uniqStrength) return ''; const lg = (save.world && save.world.me) || null, r = D.uniqStrength(q, lg), pc = Math.round(r.power * 100), d1 = Math.round(r.powerD1 * 100), lgN = { regE2: '地域2部', regW2: '地域2部', regE1: '地域1部', regW1: '地域1部', d3: 'D3', d2: 'D2', d1: 'D1' }[lg] || '';
        const tip = pc >= 100 ? '本来の力を出し切れる' : r.ef < 1 && r.lf < 1 ? `総合力${Math.floor(r.ovr)}・${lgN}のため。総合力80・D1で100%` : r.ef < 1 ? `総合力${Math.floor(r.ovr)}のため。総合力80で100%` : `${lgN}のため。D1で100%`;
        return `<span class="pc-uqp"><span>いまの強さ</span><i class="bar"><i style="width:${Math.min(100, pc)}%"></i></i><b>${pc}%</b>${lg !== 'd1' && d1 > pc ? `<em>D1なら ${d1}%</em>` : ''}<small>${esc(tip)}</small></span>`; };
      const u = p.uniq && D.UNIQ[p.uniq], uq = u ? `<details class="pc-uq"><summary><span class="pc-uqh">固有スキル${p.uniqLv >= 2 ? '・覚醒' : ''}</span><b>${esc(u.name)}</b><i class="pc-uqi">説明</i>${uqPow(p)}</summary><div class="pc-uqd"><p><span>発動</span>${esc(u.sw || u.when)}</p><p><span>効果</span>${esc(u.se || u.what)}</p>${u.st ? `<p><span>凸</span>${esc(u.st)}</p>` : ''}</div></details>` : '';
      body = `${uq}<div class="pc-sk"><div class="pc-skh">習得スキル　${sk.length}/${n}</div><div class="pc-skg">${cells.join('')}</div><div class="pc-skd" hidden></div></div><p class="pc-note">${si.nextAvg ? `能力の平均が ${si.nextAvg} になると、スキル枠がもう1つ増えます（今 ${Math.floor(si.avg)}）` : 'スキル枠はMAXです'}</p>`;
    }
    return `<div class="pc-card${embed ? ' pc-embed' : ''}"><img class="pc-emb" src="${emblemURL(save.team.name, 80)}" alt="">
      <div class="pc-head"><i class="pos ${POSC[p.position]}">${p.position}</i><b>${esc(p.name)}</b><span>${esc(save.team.name)}</span></div>
      <div class="pc-main">
        <div class="pc-left">
          <div class="pc-photo">${facePic(p, '', i >= 11)}<div class="pc-rare">${starHTML(C.ensureStar(p), p.totsu)}${capBadge(C.capGrade(p))}</div></div>
          <b class="pc-num">${p.number}</b>
          <div class="pc-meta"><span>タイプ</span>${typeBadge(p.type)}</div>
          <div class="pc-meta"><span>調子</span>${condGauge(p)}</div>
        </div>
        <div class="pc-right">
          <div class="pc-icons">${icons}</div>
          <div class="pc-grades${ups ? ' wd' : ''}">${grades}</div>
          <div class="pc-page">${body}</div>
          <div class="pc-dots"><button class="pc-nav prev ui-img" title="前の選手"><img src="icons/ui_next.png" alt="前へ" style="transform:scaleX(-1)"></button>${pages.map((nm, k) => `<button data-pg="${k}" class="${k === pcPage ? 'on' : ''}">${nm}</button>`).join('')}<button class="pc-nav next ui-img" title="次の選手"><img src="icons/ui_next.png" alt="次へ"></button></div>
        </div>
      </div>
      ${embed ? '' : '<button class="sb-round pc-close" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button>'}
    </div>`;
  }
  // カードの中のボタン（ページ切り替え・前後の選手）をつなぐ。go(i) で別の選手へ
  function bindCard(root, i, go, redraw) {
    const n = save.team.players.length;
    bindSkillDesc(root);   // ページの中をタップしてもページは切り替えない（利き足・スキルの説明などを押せるように）
    root.querySelectorAll('[data-pg]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); pcPage = +b.dataset.pg; redraw(); });
    root.querySelector('.pc-nav.prev').onclick = (e) => { e.stopPropagation(); go((i + n - 1) % n); };
    root.querySelector('.pc-nav.next').onclick = (e) => { e.stopPropagation(); go((i + 1) % n); };
  }
  // 習得スキルの「説明」：押したスキルの説明を下に出す（もう一度押すと閉じる）
  function bindSkillDesc(root) {
    const box = root.querySelector('.pc-skd'); if (!box) return;
    root.querySelectorAll('.pc-skb').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const k = b.dataset.sk, on = b.classList.contains('on');
      root.querySelectorAll('.pc-skb.on').forEach((x) => x.classList.remove('on'));
      if (on) { box.hidden = true; return; }
      b.classList.add('on'); box.innerHTML = `<b>${esc((D.SKILLS[k] || {}).name || k)}</b>${esc(SKILL_DESC[k] || '試合の中で、この技を使えるようになる')}`; box.hidden = false; });
    root.querySelectorAll('.pc-uq').forEach((d) => d.addEventListener('click', (e) => e.stopPropagation()));
  }
  function playerDetail(i, o = {}) {
    let el = document.getElementById('pcModal');
    if (!el) { el = document.createElement('div'); el.id = 'pcModal'; el.className = 'modal pc-wrap'; $('#career').appendChild(el); }
    el.innerHTML = playerCardHTML(i, null, false);
    { const ov = [...document.querySelectorAll('.lk-wrap')].some((w) => !w.hidden && w.id !== 'pcModal'); const host = ov ? document.getElementById('app') : $('#career'); if (el.parentElement !== host) host.appendChild(el); el.style.zIndex = ov ? 60 : ''; }   /* 版477：クラブ事務所（z 45）より前に */
    el.hidden = false;
    bindCard(el, i, (k) => playerDetail(k, o), () => playerDetail(i, o));
    el.classList.toggle('pc-office', !!o.office); el.classList.toggle('pc-club', !!o.club);
    if (o.office) officeSide(el, i, o);
    if (o.club) awakeSide(el, i, o);   // 版643：クラブハウスの選手データから開いた時は、右に「覚醒」   /* 版480：クラブ事務所のチーム編成から開いた時は、右に「背番号・登録ポジション・登録名」 */
    if (o.noNav) el.querySelectorAll('.pc-nav').forEach((b) => b.remove());   /* 版470：ランキングから開いた時は、前後の選手への矢印なし */
    el.querySelector('.pc-close').onclick = () => { el.hidden = true; };
    el.onclick = (e) => { if (e.target === el) el.hidden = true; };
  }

  // 版480：選手カードの右の3つ（カルチョビットAのクラブ事務所 → チーム編成 → 選手と同じ）
  // 版512：チームの選手を放出（ほかのクラブへ移籍・覚醒のカケラになる）。スタメンが抜けたら控えから埋める
  async function releasePlayer(i, after) {
    const ps = save.team.players, p = ps[i]; if (!p) return;
    const MIN = 16;
    if (ps.length <= MIN) { coachAsk(`チームの選手が${MIN}人より少なくなるので、放出できません。`, [{ label: 'OK', value: true }]); return; }
    if (p.position === 'GK' && ps.filter((q) => q.position === 'GK').length <= 1) { coachAsk('GKがいなくなるので、放出できません。', [{ label: 'OK', value: true }]); return; }
    const kk = (C.KAKERA_OF[C.ensureStar(p)] || 1) * (1 + (p.totsu || 0));
    if (!(await coachAsk(`${esc(p.name)}を放出しますか？<br><small>ほかのクラブへ移籍します（戻ってきません）。<br>覚醒のカケラ <b>${kk}</b> をもらえます。</small>`))) return;
    if (i < 11) {   // スタメン：同じポジションの控え（いなければ先頭の控え）と入れかえてから抜く
      let j = -1; for (let k = 11; k < ps.length; k++) if (ps[k].position === (i === 0 ? 'GK' : p.position)) { j = k; break; }
      if (j < 0 && i === 0) for (let k = 11; k < ps.length; k++) if (ps[k].position === 'GK') { j = k; break; }
      if (j < 0) j = 11;
      ps[i] = ps[j]; ps[j] = p; { const pc = save.plan && save.plan.cards; if (pc) { const a = pc[i], b = pc[j]; if (b) pc[i] = b; else delete pc[i]; if (a) pc[j] = a; else delete pc[j]; } } i = j;
    }
    ps.splice(i, 1);
    { const pc = save.plan && save.plan.cards; if (pc) { const nc = {}; for (const k in pc) { const n = +k; if (n < i) nc[n] = pc[k]; else if (n > i) nc[n - 1] = pc[k]; } save.plan.cards = nc; } }
    { const tac = C.ensureTactics(save); for (const k in (tac.roles || {})) if (tac.roles[k] === p.name) tac.roles[k] = null; }
    save.kakera = (save.kakera || 0) + kk; store();
    if (window.DotSound) try { DotSound.play('tap'); } catch (_) {}
    if (after) after();
  }
  // 版643：覚醒（クラブハウスの選手データから）。覚醒のカケラ100個で1凸
  function awakeSide(el, i, o) {
    const p = save.team.players[i];
    const side = document.createElement('div'); side.className = 'pc-side pc-awk';
    side.innerHTML = '<button data-ed="trn" title="特訓"><img src="icons/cb_train.png" alt="特訓"></button><button data-ed="awk" title="覚醒"><img src="icons/pc_awake.png" alt="覚醒"></button>';
    el.appendChild(side);
    side.querySelector('[data-ed="trn"]').onclick = (e) => { e.stopPropagation(); el.hidden = true; selIdx = i; go('train'); };   // 版647：この選手の特訓へ
    { const card = el.querySelector('.pc-card'); if (card) { card.style.transform = ''; const W = el.clientWidth, H = el.clientHeight, cw = card.offsetWidth, ch = card.offsetHeight, avail = W - 96 - 12 - 24 - 16; const k = Math.min(1, avail / cw, (H - 16) / ch); card.style.position = 'absolute'; card.style.left = Math.max(12, (avail - cw * k) / 2 + 12) + 'px'; card.style.top = ((H - ch * k) / 2) + 'px'; card.style.transform = `scale(${k.toFixed(3)})`; card.style.transformOrigin = '0 0'; } }
    const done = () => { store(); playerDetail(i, o); if (o.onChange) o.onChange(); };
    const dlg = (title, body, bind) => {
      const d = document.createElement('div'); d.className = 'pc-edit'; d.innerHTML = `<div class="pe-in"><h3>${title}</h3>${body}<div class="pe-btns"><button class="pe-no ib ib-no ib-img">やめる</button></div></div>`;
      el.appendChild(d); d.onclick = (e) => { e.stopPropagation(); if (e.target === d) d.remove(); }; { const okb = d.querySelector('.pe-ok'), nob = d.querySelector('.pe-no'); if (okb && nob) okb.parentElement.appendChild(nob); } d.querySelector('.pe-no').onclick = () => d.remove(); bind(d);
    };
    // 版831：覚醒の画面を新しいデザインに（いただいた案）。左に選手のカード、右に「覚醒段階」「覚醒で強くなるもの」「消費・所持」、下に「やめる」「覚醒する」
    side.querySelector('[data-ed="awk"]').onclick = (e) => { e.stopPropagation();
      const st = C.ensureStar(p), tz = p.totsu || 0, cost = C.awakeCost(p), have = save.kakera || 0, g0 = C.capGrade(p), max = tz >= 3, can = !max && have >= cost;
      const g1 = !max ? (() => { p.totsu = tz + 1; const g = C.capGrade(p); p.totsu = tz; return g; })() : g0;
      const KK = (c) => `<img class="${c}" src="icons/kakera.png" alt="カケラ" draggable="false">`;
      const gems = [0, 1, 2].map((k) => `<i class="aw2-gem${k < tz ? ' on' : k === tz && !max ? ' nx' : ''}"></i>`).join('');
      const u = p.uniq && D.UNIQ[p.uniq];
      const tiles = [`<div class="aw2-tile"><svg viewBox="0 0 48 32" aria-hidden="true"><circle cx="24" cy="9" r="6.5"/><circle cx="10" cy="12" r="5"/><circle cx="38" cy="12" r="5"/><path d="M12 31c0-8 5-13 12-13s12 5 12 13z"/><path d="M0 31c0-6 4-10 10-10 2.5 0 4.5.6 6 1.8C13 25 11.6 28 11.4 31zM48 31c0-6-4-10-10-10-2.5 0-4.5.6-6 1.8 3 2.2 4.4 5.2 4.6 8.2z"/></svg><b>サポート効果が強化</b></div>`];
      if (u) tiles.push(`<div class="aw2-tile"><svg viewBox="0 0 32 40" aria-hidden="true"><path d="M17 1c2 7 11 11 11 22a12 12 0 0 1-24 0c0-6 3-9 5-12 0 4 2 6 4 7-1-7 1-12 4-17z"/><path class="in" d="M15 22c3 2 6 5 6 9a5.5 5.5 0 0 1-11 0c0-3 2-5 3-6 0 2 1 3 2 3-1-2-1-4 0-6z"/></svg><b>固有スキルが強化</b></div>`);
      if (g1 !== g0) tiles.push(`<div class="aw2-tile cap"><b>育てられる上限</b><span class="aw2-cap"><b class="rk rk-${g0}">${g0}</b><em>▶</em><b class="rk rk-${g1}">${g1}</b></span></div>`);
      const note = max ? 'この選手は完凸（3凸）です' : g1 !== g0 ? '' : `能力上限は${g0}のまま`;
      const d = document.createElement('div'); d.className = 'aw2';
      d.innerHTML = `<div class="aw2-box">
        <div class="aw2-hd">${KK('aw2-hk')}<b>選手覚醒</b></div>
        <div class="aw2-body">
          <div class="aw2-card"><img class="aw2-emb" src="${emblemURL(save.team.name, 80)}" alt=""><div class="aw2-nm"><i class="pos ${POSC[p.position]}">${p.position}</i><b>${esc(p.name)}</b></div>
            <div class="aw2-ph">${facePic(p, '', false)}</div><div class="aw2-rare">${starHTML(st, tz)}${capBadge(g0)}</div></div>
          <div class="aw2-r">
            <div class="aw2-sec"><div class="aw2-sh">覚醒段階</div><div class="aw2-stage"><s>//</s><b class="aw2-tz">${tz}<small>凸</small></b><span class="aw2-gems">${gems}</span>${max ? '<b class="aw2-max">完凸</b>' : `<em class="aw2-ar">▶</em><b class="aw2-tz nx">${tz + 1}<small>凸</small></b>`}<s>//</s></div></div>
            <div class="aw2-sec"><div class="aw2-sh dk">覚醒で強くなるもの</div><div class="aw2-tiles${tiles.length > 2 ? ' t3' : ''}">${tiles.join('')}</div>${note ? `<p class="aw2-note"><span>${note}</span></p>` : ''}</div>
            ${max ? '' : `<div class="aw2-cost"><span class="aw2-tag">消費</span>${KK('aw2-ck')}<b class="aw2-c${have < cost ? ' ng' : ''}">${cost}</b><i class="aw2-sep"></i><span class="aw2-have">所持</span><b class="aw2-h">${have.toLocaleString()}</b>${can ? `<em>→</em><b class="aw2-h">${(have - cost).toLocaleString()}</b>` : '<b class="aw2-ng">カケラが足りません</b>'}</div>`}
            ${!max && have < cost ? '<p class="aw2-hint">カケラは、選手の放出やスカウトでかぶった時にもらえます。</p>' : ''}
          </div>
        </div>
        <div class="aw2-btns"><button class="aw2-no">やめる</button>${max ? '' : `<button class="aw2-ok"${can ? '' : ' disabled'}>${KK('aw2-bk')}<span class="aw2-bc">${cost}</span><i></i><b>覚醒する</b></button>`}</div>
      </div>`;
      el.appendChild(d); try { faceFill(); } catch (_) {}
      { const bx = d.querySelector('.aw2-box'), k = Math.min(1, (d.clientWidth - 16) / bx.offsetWidth, (d.clientHeight - 16) / bx.offsetHeight); bx.style.transform = `scale(${k.toFixed(3)})`; bx.style.setProperty('--k', k); }   // 画面に収まる大きさに
      d.onclick = (ev) => { ev.stopPropagation(); if (ev.target === d) d.remove(); };
      d.querySelector('.aw2-no').onclick = () => d.remove();
      const ok = d.querySelector('.aw2-ok'); if (ok && can) ok.onclick = () => { if (C.awaken(save, p)) { try { window.DotSound && DotSound.play('skill'); } catch (_) {} done(); coachAsk(`${esc(p.name)}が覚醒しました！<br>凸 ${p.totsu}／3　育てられる上限：<b>${C.capGrade(p)}</b>`, [{ label: 'OK', value: true }]); } };
    };
  }
  function officeSide(el, i, o) {
    const p = save.team.players[i];
    const side = document.createElement('div'); side.className = 'pc-side';
    side.innerHTML = [['num', 'pc_number', '背番号'], ['pos', 'pc_pos', '登録ポジション'], ['name', 'pc_name', '登録名'], ['rel', 'pc_release', '放出']].map(([a, f, l]) => `<button data-ed="${a}" title="${l}"><img src="icons/${f}.png" alt="${l}"></button>`).join('');
    el.appendChild(side);
    // 版506：カードは画面に収まる大きさに縮めて、右のボタンと重ならない所へ（スマホで見切れないように）
    { const card = el.querySelector('.pc-card'); if (card) { card.style.transform = ''; const W = el.clientWidth, H = el.clientHeight, cw = card.offsetWidth, ch = card.offsetHeight, avail = W - 96 - 12 - 24 - 16; const k = Math.min(1, avail / cw, (H - 16) / ch); card.style.position = 'absolute'; card.style.left = Math.max(12, (avail - cw * k) / 2 + 12) + 'px'; card.style.top = ((H - ch * k) / 2) + 'px'; card.style.transform = `scale(${k.toFixed(3)})`; card.style.transformOrigin = '0 0'; } }
    const done = () => { store(); playerDetail(i, o); if (o.onChange) o.onChange(); };
    const dlg = (title, body, bind) => {
      const d = document.createElement('div'); d.className = 'pc-edit'; d.innerHTML = `<div class="pe-in"><h3>${title}</h3>${body}<div class="pe-btns"><button class="pe-no ib ib-no ib-img">やめる</button></div></div>`;
      el.appendChild(d); d.onclick = (e) => { e.stopPropagation(); if (e.target === d) d.remove(); }; { const okb = d.querySelector('.pe-ok'), nob = d.querySelector('.pe-no'); if (okb && nob) { okb.parentElement.appendChild(nob); } }   /* 版528：決定とやめるを横に並べる */ d.querySelector('.pe-no').onclick = () => d.remove(); bind(d);
    };
    side.querySelectorAll('[data-ed]').forEach((b) => b.onclick = async (e) => { e.stopPropagation(); const a = b.dataset.ed;
      if (a === 'rel') { releasePlayer(i, () => { el.hidden = true; if (o.onChange) o.onChange(); }); return; }   // 版512：放出

      if (a === 'num') {
        const used = new Map(save.team.players.map((q) => [q.number, q]));
        let h = '<div class="pe-nums">'; for (let n = 1; n <= 99; n++) { const q = used.get(n); h += `<button data-n="${n}" class="${q === p ? 'me' : q ? 'used' : ''}" title="${q ? esc(q.name) : ''}">${n}${q && q !== p ? `<small>${esc(q.name)}</small>` : ''}</button>`; } h += '</div><p class="pe-note">ほかの選手の番号を選ぶと、その選手と番号を入れかえます。</p>';
        dlg(`${esc(p.name)}の背番号`, h, (d) => d.querySelectorAll('[data-n]').forEach((x) => x.onclick = () => { const n = +x.dataset.n, q = used.get(n); if (q === p) { d.remove(); return; } if (q) q.number = p.number; p.number = n; done(); }));
      } else if (a === 'pos') {
        const POS = [['GK', 'ゴールキーパー'], ['DF', 'ディフェンダー'], ['MF', 'ミッドフィルダー'], ['FW', 'フォワード']];
        dlg(`${esc(p.name)}の登録ポジション`, `<div class="pe-pos">${POS.map(([k, l]) => `<button data-p="${k}" class="${p.position === k ? 'me' : ''}"><i class="pos ${POSC[k]}">${k}</i><span>${l}</span></button>`).join('')}</div><p class="pe-note">試合で出るポジションは、スタメン画面のマスで決まります。</p>`, (d) => d.querySelectorAll('[data-p]').forEach((x) => x.onclick = () => { p.position = x.dataset.p; done(); }));
      } else {
        dlg(`${esc(p.name)}の登録名`, `<input class="pe-name" maxlength="6" value="${esc(p.name)}"><p class="pe-note">6文字まで。チームのほかの選手と同じ名前は使えません。</p><p class="pe-err" hidden></p><div class="pe-btns"><button class="pe-ok primary ib ib-ok ib-img">決定</button></div>`, (d) => {
          const inp = d.querySelector('.pe-name'); setTimeout(() => inp.focus(), 50);
          d.querySelector('.pe-ok').onclick = () => { const v = inp.value.trim(), er = d.querySelector('.pe-err');
            if (!v) { er.textContent = '名前を入れてください。'; er.hidden = false; return; }
            if (save.team.players.some((q) => q !== p && q.name === v)) { er.textContent = '同じ名前の選手がいます。'; er.hidden = false; return; }
            const old = p.name; p.name = v; try { const tac = C.ensureTactics(save); for (const k in (tac.roles || {})) if (tac.roles[k] === old) tac.roles[k] = v; } catch (_) {} done(); };   // 役割（キッカーなど）の名前も合わせる
        });
      }
    });
  }

  // ================= 特訓 =================
  const hexRgbU = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const sprURL = new Map();
  // 版646：ユニフォームを変えたら、選手の小さい絵も作り直す（絵の覚えておく名前に、今のユニフォームを入れる）
  const kitSig = () => { try { const cl = C.ensureClub(save), k = cl.kit || {}, g = cl.gk || {}; return [k.pat, k.shirt, k.sub, k.shorts, k.socks, g.shirt, g.shorts, g.socks].join(','); } catch (_) { return ''; } };
  const sprKey = (p) => p.name + (p.position === 'GK' ? 'g' : '') + p.hair + p.hairColor + p.skin + '|' + kitSig();
  function portrait(p, big) {
    const key = sprKey(p);
    if (!sprURL.has(key)) sprURL.set(key, A().spriteCanvas(p, 0, 'front', 0, false, p.position === 'GK').toDataURL());
    return `<img class="pt${big ? ' big' : ''}" src="${sprURL.get(key)}" alt="">`;
  }

  // ================= 顔（会話・選手カード用）：1枚絵の顔を、選手ごとに髪・肌・ユニフォームの色を塗り替えて使う =================
  // 顔の絵は faces/faces.js（window.FACE_SET）。どの絵を使うかは選手ごとに p.face に記録（同じ番号なら必ず同じ顔）
  const FACE_SKIN = ['#f3c49a', '#dca06c', '#9e6844'], FACE_HAIR = ['#2a2420', '#5e3e26', '#d4ad58', '#3e2c22', '#a4452e'];
  const faceImg = []; let faceLoaded = 0, faceTotal = 0;
  const faceCache = new Map(), facePending = new Map();
  function faceLoad() {
    if (faceTotal) return;
    const set = window.FACE_SET || [];
    set.forEach((f, i) => {
      faceImg[i] = {};
      for (const k of ['img', 'mask']) { faceTotal++; const im = new Image(); im.onload = im.onerror = () => { faceLoaded++; if (faceLoaded === faceTotal) faceFill(); }; im.src = f[k]; faceImg[i][k] = im; }
    });
  }
  // 画像が読み込めたら、待っていた顔をまとめて差し替える
  function faceFill() { document.querySelectorAll('img[data-face]').forEach((im) => { const fp = facePending.get(im.dataset.face); const u = fp && faceURL(fp.p, fp.bib); if (u) { im.src = u; im.removeAttribute('data-face'); } }); }
  // 瞳の色（茶のまま・黒・青灰・緑・琥珀）
  const FACE_IRIS = [null, '#2a1a12', '#4f6f8f', '#4f7a4a', '#9a6a2a'];   // そのまま（茶）・黒・青灰・緑・琥珀
  // 顔は1枚絵のまま使う（貼り替え・変形はしない）。同じチームの中では全員ちがう顔になるように選ぶ
  function faceGenes(p) {
    const set = window.FACE_SET || [], n = set.length || 1;
    const team = save && save.team && save.team.players.includes(p) ? save.team.players : null;
    const used = new Set(team ? team.filter((q) => q !== p && q.face && q.face.v === 6).map((q) => q.face.id) : []);
    if (p.face && p.face.v === 6 && p.face.id < n && p.face.hs === p.face.id && !used.has(p.face.id)) return p.face;
    let h = 2166136261; for (const ch of (p.name || '') + '|' + (p.number || 0) + '|' + (p.hair || 0)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const r = () => { h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return h / 4294967296; };
    let id = Math.floor(r() * n);
    for (let k = 0; k < n && used.has(id); k++) id = (id + 1) % n;
    // 髪型：半分くらいの選手は、ほかの顔の髪型にかえる
    // （前髪が眉まで下りている顔は、髪を外すと前髪の跡が残るので入れかえない）
    const hs = id;   // 髪型の入れ替えはしない（顔は1枚絵のまま、色だけ変える）
    p.face = { v: 6, id, hs, iris: r() < 0.6 ? 0 : 1 + Math.floor(r() * (FACE_IRIS.length - 1)) };
    return p.face;
  }
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const faceData = [];
  function faceDataOf(i) {
    if (faceData[i]) return faceData[i];
    const im = faceImg[i].img, mk = faceImg[i].mask, c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d');
    x.drawImage(im, 0, 0); const img = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height); x.drawImage(mk, 0, 0); const msk = x.getImageData(0, 0, c.width, c.height).data;
    return (faceData[i] = { img, msk, W: c.width, H: c.height });
  }
  // 顔の絵（dataURL）。まだ読み込めていなければ null
  // bib：控え選手はユニフォームの上にビブス（肩から下の胴の部分だけ、蛍光色のメッシュ）
  function faceURL(p, bib) {
    if (p.faceKey && window.STAR_FACES && p.faceKey in window.STAR_FACES) return starFace(p.faceKey, (C.ensureClub(save).kit || {}).shirt || '#2f6fd6', p.position === 'GK', STAR_FIT);   // 版505：スカウトで来た選手は、元の顔
    faceLoad();
    if (!faceTotal || faceLoaded < faceTotal) return null;
    const g = faceGenes(p), set = window.FACE_SET, F = set[g.id], skin = FACE_SKIN[p.skin || 0] || FACE_SKIN[0], hair = FACE_HAIR[p.hairColor || 0] || FACE_HAIR[0], gk = p.position === 'GK';
    const key = [g.id, g.hs, g.iris, skin, hair, gk ? ((C.ensureClub(save).gk) || {}).shirt : 0, bib ? 1 : 0].join('|');
    if (faceCache.has(key)) return faceCache.get(key);
    const B = faceDataOf(g.id), W = B.W, H = B.H;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    const d = x.createImageData(W, H), px = d.data; px.set(B.img); const md = new Uint8ClampedArray(B.msk);
    // 瞳の色
    const iris = FACE_IRIS[g.iris];
    if (iris) {
      const ti = hexRgb(iris), rx = F.d * 0.24, ry = F.d * 0.2;
      for (const ex2 of [F.ex - F.d / 2, F.ex + F.d / 2]) for (let y = Math.floor(F.ey - ry); y <= F.ey + ry; y++) for (let x2 = Math.floor(ex2 - rx); x2 <= ex2 + rx; x2++) {
        const i = (y * W + x2) * 4, r = px[i], gg = px[i + 1], b = px[i + 2], l = r * 0.3 + gg * 0.59 + b * 0.11, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        if (md[i + 1] > 128 || md[i] > 128) continue;
        if (r >= gg && gg >= b - 6 && (mx - mn) > 22 && l > 30 && l < 170) { const k = l / 95; px[i] = Math.min(255, ti[0] * k * 1.25); px[i + 1] = Math.min(255, ti[1] * k * 1.25); px[i + 2] = Math.min(255, ti[2] * k * 1.25); }
      }
    }
    const ts = hexRgb(skin), th = hexRgb(hair), bs = F.skin;
    const thL = th[0] * 0.3 + th[1] * 0.59 + th[2] * 0.11, hairK = (thL > 90 ? 1.08 : 1) / set[g.hs].hairL;   // 明るい髪は少し持ち上げる
    const tg = hexRgbU(((C.ensureClub(save).gk) || {}).shirt || '#f2c230');   // 版651：GKのユニフォームの色
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      if (md[i] > 200) { const l = (r * 0.3 + gg * 0.59 + b * 0.11) * hairK; px[i] = Math.min(255, th[0] * l + (l > 1 ? (l - 1) * 30 : 0)); px[i + 1] = Math.min(255, th[1] * l + (l > 1 ? (l - 1) * 26 : 0)); px[i + 2] = Math.min(255, th[2] * l + (l > 1 ? (l - 1) * 22 : 0)); }
      else if (md[i + 1] > 128) { px[i] = Math.min(255, r * ts[0] / bs[0]); px[i + 1] = Math.min(255, gg * ts[1] / bs[1]); px[i + 2] = Math.min(255, b * ts[2] / bs[2]); }
      else if (gk && md[i + 2] > 250) { const l = (r * 0.3 + gg * 0.59 + b * 0.11) / F.shirtL; px[i] = Math.min(255, tg[0] * l); px[i + 1] = Math.min(255, tg[1] * l); px[i + 2] = Math.min(255, tg[2] * l); }
    }
    if (bib) {
      // 胴の真ん中（両肩の内側）だけを塗る。えりぐりは元のユニフォームのまま残す
      let top = H; for (let y = 0; y < H && top === H; y++) for (let x2 = 0; x2 < W; x2++) if (md[(y * W + x2) * 4 + 2] > 250) { top = y; break; }
      const half = F.d * 1.55, neck = top + F.d * 0.35;
      const o = B.img;   // 元の絵（塗り替える前）の明るさでしわ・影を残す
      const inBib = (x2, y) => { if (x2 < 0 || x2 >= W || y < top || y >= H) return false; const i = (y * W + x2) * 4; if (md[i + 2] <= 250) return false;
        const dx = Math.abs(x2 - F.ex), sh = half - Math.max(0, (top + F.d * 0.9 - y)) * 0.9;   // 肩はなで肩に細く
        return dx <= sh && !(y < neck + F.d * 0.25 && dx < F.d * 0.42); };   // えりぐりは残す
      for (let y = top; y < H; y++) for (let x2 = 0; x2 < W; x2++) {
        const i = (y * W + x2) * 4; if (!px[i + 3] || !inBib(x2, y)) continue;
        const edge = !inBib(x2 - 3, y) || !inBib(x2 + 3, y) || !inBib(x2, y - 3);
        const l = (o[i] * 0.3 + o[i + 1] * 0.59 + o[i + 2] * 0.11) / F.shirtL, mesh = ((x2 >> 1) + (y >> 1)) % 2 ? 0.93 : 1, k = l * mesh * (edge ? 0.62 : 1);
        px[i] = Math.min(255, 196 * k); px[i + 1] = Math.min(255, 236 * k); px[i + 2] = Math.min(255, 52 * k);
      }
    }
    x.putImageData(d, 0, 0);
    const url = c.toDataURL(); faceCache.set(key, url); return url;
  }
  // 顔の<img>（読み込み前はドット絵を出しておき、読み込めたら差し替え）
  let faceRetryT = 0, faceRetryN = 0;
  function faceRetry() { if (faceRetryT) return; faceRetryN = 0; const tick = () => { faceRetryT = 0; try { faceFill(); } catch (_) {} if (document.querySelector('img[data-face]') && ++faceRetryN < 20) faceRetryT = setTimeout(tick, 400); }; faceRetryT = setTimeout(tick, 300); }
  function facePic(p, cls, bib) {
    const url = faceURL(p, bib);
    if (url) return `<img class="fc ${cls || ''}" src="${url}" alt="" draggable="false">`;
    const id = 'f' + (p.name || '') + (p.number || '') + (bib ? 'b' : ''); facePending.set(id, { p, bib });
    faceRetry();   // 版513：読み込みが終わったのに入れ替わらない顔が残らないよう、少し待って入れ直す
    return `<img class="fc ${cls || ''}" data-face="${esc(id)}" src="${sprURL.get(sprKey(p)) || BLANK}" alt="" draggable="false">`;
  }
  // コーチのドット絵：選手の絵の服を黒いジャージに塗り替える
  let coachURL = null;
  function coachFace() {
    if (!coachURL) {
      const src = A().spriteCanvas({ name: 'coach', hair: 1, hairColor: 0, skin: 2 }, 2, 'front', 0, false, false);
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const x = c.getContext('2d'); x.drawImage(src, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const MAP = [['#2f6fd6', '#2a2d31'], ['#6ea2f2', '#4b5056'], ['#1d4796', '#16181b']].map(([a2, b2]) => [hex(a2), hex(b2)]);
      for (let i = 0; i < px.length; i += 4) for (const [f, t] of MAP) if (px[i] === f[0] && px[i + 1] === f[1] && px[i + 2] === f[2]) { px[i] = t[0]; px[i + 1] = t[1]; px[i + 2] = t[2]; }
      x.putImageData(d, 0, 0); coachURL = c.toDataURL();
    }
    if (staffImg.coach) return `<img class="pt big art" src="${staffImg.coach}" alt="コーチ">`;   // コーチの顔イラストがあればそれ
    return `<img class="pt big" src="${coachURL}" alt="コーチ">`;
  }
  const GROUP_NAME = { dribble: 'ドリブル', shot: 'シュート', pass: 'パス', set: 'セットプレー', def: '守備', gk: 'GK', offball: 'オフザボール', mental: 'メンタル', undefined: 'キック' };
  function menuLabel(id, p) {
    if (!id) return p.position === 'GK' ? 'セービング' : 'ミニゲーム';
    const [k, key] = id.split(':');
    if (k === 'n') return C.MENUS[key].name; if (k === 's') return C.SPECIAL[key].name; return D.SKILLS[key].name + '特訓';
  }
  // カードの残り枚数（ほかの選手にセット済みの分を引く）
  function cardLeft(c) { let used = 0; for (const k in save.plan.cards) used += save.plan.cards[k].filter((x) => x === c).length; return (save.cards[c] || 0) - used; }
  const CATC = { tact: 'cat-tact', tech: 'cat-tech', phys: 'cat-phys', sup: 'cat-sup' };
  function cardTile(c, extra, cls) { const cd = C.CARDS[c]; return `<button class="tcard2 ${CATC[cd.cat]} ${cls || ''}" data-c="${c}"><b>${esc(cd.name)}</b><span>${Object.entries(cd.up).map(([k, v]) => `<i class="cu">${ico(k, 'sm')}+${v}</i>`).join('') || (cd.rand ? '疲労回復・ランダム' : cd.all ? '全能力+1' : cd.fat < 0 ? '疲労回復' : '')}${cd.fat < 0 && Object.keys(cd.up).length ? ' 回復' : ''}</span><em class="fat">疲労${cd.fat > 0 ? '+' : ''}${cd.fat}</em>${extra || ''}</button>`; }
  function gauge(v, add) {
    const a = C.rankInfo(v), b = C.rankInfo(Math.min(C.PMAX - 1, v + (add || 0)));
    const up = b.g !== a.g;
    return `<span class="gw"><span class="rk gr-${a.g}">${a.g}</span><span class="gbar"><i style="width:${a.pct * 100}%"></i>${add > 0 ? `<em style="left:${a.pct * 100}%;width:${up ? (1 - a.pct) * 100 : (b.pct - a.pct) * 100}%"></em>` : ''}</span>${up ? `<span class="rkup">→ <b class="rk gr-${b.g}">${b.g}</b></span>` : ''}</span>`;
  }
  // 能力の一覧：上に名前、大きなランク、下に次のランクまでのゲージ（セット中のカードで伸びる分は黄色）
  const G = { phys: 'pg-phys', tech: 'pg-tech', mind: 'pg-mind' };
  const PSHORT = { speed: 'スピード', dash: '瞬発力', stamina: 'スタミナ', physical: 'フィジカル', jump: 'ジャンプ', kick: 'キック', technique: 'テクニック', dribble: 'ドリブル', pass: 'パス', defense: '守備', vision: '判断', mental: 'メンタル' };
  function paramGrid(p, ups) {
    C.ensurePts(p);
    return `<div class="pgrid">${D.PARAMS.map((q) => { const v = p.pts[q.k], a = C.rankInfo(v), add = (ups && ups[q.k]) || 0, b = C.rankInfo(Math.min(C.PMAX - 1, Math.max(v, Math.min(C.capPts(p), v + Math.max(0, add)))));
      return `<div class="pg ${G[q.g]}${add > 0 ? ' up' : ''}" title="${q.name} ${Math.floor(v)}（次のランクまであと${Math.max(0, Math.ceil(a.next - v))}）"><i>${ico(q.k, 'sm')}${PSHORT[q.k] || q.name}</i><b class="big gr-${a.g}">${a.g}</b>${b.g !== a.g ? `<em class="pg-up gr-${b.g}">→${b.g}</em>` : ''}<span class="mg2"><s style="width:${a.pct * 100}%"></s>${add > 0 ? `<u style="left:${a.pct * 100}%;width:${(b.g !== a.g ? 1 - a.pct : b.pct - a.pct) * 100}%"></u>` : ''}</span></div>`; }).join('')}</div>`;
  }
  // 特訓カード（絵柄つき）：手札・セット枠・ショップで共通
  function upsHTML(cd) {
    return Object.entries(cd.up).map(([k, v]) => `<i class="cu">${ico(k, 'sm')}+${v}</i>`).join('') || `<i class="cu tx">${cd.rand ? '疲労回復・ランダム' : cd.all ? '全能力+1' : cd.fat < 0 ? '疲労回復' : ''}</i>`;
  }
  function artCard(c, opt) {
    opt = opt || {}; const cd = C.CARDS[c];
    const tip = `${cd.name}：${Object.entries(cd.up).map(([k, v]) => `${C.PNAME[k]}+${v}`).join(' ')}${cd.fat ? `　疲労${cd.fat > 0 ? '+' : ''}${cd.fat}` : ''}`;
    return `<button class="acard ${CATC[cd.cat]} ${opt.cls || ''}" data-c="${c}" title="${esc(tip)}"><img src="cards/${c}.jpg" alt="${esc(cd.name)}" draggable="false">${opt.ups ? `<span class="ac-up">${upsHTML(cd)}<em>疲労${cd.fat > 0 ? '+' : ''}${cd.fat}</em></span>` : ''}${opt.cnt != null ? `<i class="ac-cnt">×${opt.cnt}</i>` : ''}${opt.extra || ''}</button>`;
  }
  // 特訓画面：いつも同じ大きさの「ボード」に組んで、画面に合わせて拡大縮小（スクロールなしで全部のカードが見える）
  const TRB_W = 1120, TRB_H = 640;   // 版632：手札の見出しのぶん少し高く
  function fitBoard() {
    const b = document.querySelector('#clubLayer .trb'); if (!b) return;
    const L = $('#clubLayer'), w = L.clientWidth, h = L.clientHeight;
    // 版641：横長の画面（スマホ）では、ボードを横に広げて余った幅を手札に使う（カードを2段にして大きく）
    const BW = Math.round(Math.max(TRB_W, Math.min(1400, h > 0 ? TRB_H * w / h : TRB_W))), s = Math.min(w / BW, h / TRB_H);
    b.style.width = BW + 'px'; b.classList.toggle('wide', false); { const cw = Math.floor(((BW - 18) / 18 * 4 - 16 - 12) / 4); b.style.setProperty('--cw', cw + 'px'); b.style.setProperty('--ch', Math.min(96, Math.round(cw * 1.19)) + 'px'); }
    b.style.transform = `scale(${s})`; b.style.left = Math.max(0, (w - BW * s) / 2) + 'px'; b.style.top = Math.max(0, (h - TRB_H * s) / 2) + 'px';
  }
  addEventListener('stagefit', fitBoard); addEventListener('resize', fitBoard);
  // 版632：特訓画面の見出しアイコン（線画のSVG）
  const HG_JP = { tact: '戦術', tech: '技術', phys: 'フィジカル', sup: 'サポート' };
  const HG_ICO = {
    tact: '<svg viewBox="0 0 32 32" class="hg-i"><circle cx="16" cy="16" r="13" fill="#fff" stroke="#123" stroke-width="2.5"/><polygon points="16,10 21.5,14 19.5,20.5 12.5,20.5 10.5,14" fill="#123"/><path d="M16 3v7M28 12l-6.5 2M24 26l-4.5-5.5M8 26l4.5-5.5M4 12l6.5 2" stroke="#123" stroke-width="2"/></svg>',
    tech: '<svg viewBox="0 0 32 32" class="hg-i"><path d="M13 4h6l6 22H7z" fill="#ff8a1e" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><path d="M11 13h10M9.5 19h13" stroke="#fff" stroke-width="3"/><rect x="3" y="25" width="26" height="4" rx="1.5" fill="#fff"/></svg>',
    phys: '<svg viewBox="0 0 32 32" class="hg-i"><rect x="3" y="10" width="4" height="12" rx="1.5" fill="#fff"/><rect x="8" y="7" width="5" height="18" rx="1.5" fill="#fff"/><rect x="25" y="10" width="4" height="12" rx="1.5" fill="#fff"/><rect x="19" y="7" width="5" height="18" rx="1.5" fill="#fff"/><rect x="13" y="14" width="6" height="4" fill="#fff"/></svg>',
    sup: '<svg viewBox="0 0 32 32" class="hg-i"><circle cx="16" cy="10" r="5" fill="#fff"/><path d="M7 28c0-6 4-10 9-10s9 4 9 10z" fill="#fff"/><circle cx="7" cy="12" r="3.6" fill="#fff" opacity=".85"/><path d="M1 26c0-4.5 2.6-7.5 6-7.5 1.2 0 2.3.3 3.2.9-1.8 1.8-2.9 4.3-3.1 6.6z" fill="#fff" opacity=".85"/><circle cx="25" cy="12" r="3.6" fill="#fff" opacity=".85"/><path d="M31 26c0-4.5-2.6-7.5-6-7.5-1.2 0-2.3.3-3.2.9 1.8 1.8 2.9 4.3 3.1 6.6z" fill="#fff" opacity=".85"/></svg>',
    sp: '<svg viewBox="0 0 32 32" class="ts-i"><path d="M16 2l12 5v8c0 8-5.5 13-12 15C9.5 28 4 23 4 15V7z" fill="#1d3f8f" stroke="#fff" stroke-width="2.2"/><circle cx="16" cy="15" r="7" fill="#fff"/><polygon points="16,11.5 19,13.6 18,17.2 14,17.2 13,13.6" fill="#1d3f8f"/></svg>'
  };
  let trbScroll = null;
  function renderTrain() {
    { const old = document.querySelector('#clubLayer .trb-line'); if (old) trbScroll = old.scrollLeft; }   // 版538：選手を選んでも、横の位置をそのままに
    setTimeout(() => { const ln = document.querySelector('#clubLayer .trb-line'); if (!ln) return; if (trbScroll != null) ln.scrollLeft = trbScroll; const se = ln.querySelector('.tl2.sel'); if (se && (se.offsetLeft < ln.scrollLeft || se.offsetLeft + se.offsetWidth > ln.scrollLeft + ln.clientWidth)) ln.scrollLeft = se.offsetLeft - ln.clientWidth / 2 + se.offsetWidth / 2; }, 0);
    const ps = save.team.players, p = ps[selIdx];
    save.plan.cards = save.plan.cards || {};
    const done = C.trainedThisWeek(save, p);
    const mine = done ? [] : (save.plan.cards[selIdx] || []);
    const pv = C.previewCards(p, mine, C.trainMult(save));
    const camp = C.campState(save), nDone = C.trainsDone(save, p), lim = C.trainLimit(save);
    const found = new Set(save.spFound || []);
    // 選手の列（顔と背番号）
    const line = ps.map((q, i) => `<button class="tl2${i === selIdx ? ' sel' : ''}${q.injury > 0 ? ' inj' : ''}${i >= 11 ? ' sub' : ''}${i >= 11 + C.BENCH_N ? ' out' : ''}${i === 11 || i === 11 + C.BENCH_N ? ' gap' : ''}" data-i="${i}">${facePic(q, 'tl2f', i >= 11)}<b><i class="pos ${POSC[q.position]}">${q.position}</i>${q.number}</b><small class="tl2n">${esc(q.name)}</small>${C.trainedThisWeek(save, q) ? '<em class="dn">済</em>' : C.trainsDone(save, q) ? `<em class="hf">あと${lim - C.trainsDone(save, q)}</em>` : (save.plan.cards[i] || []).length ? `<em class="pl">${(save.plan.cards[i] || []).length}枚</em>` : ''}</button>`).join('');
    // セット枠
    const slots = [0, 1, 2].map((k) => mine[k] ? artCard(mine[k], { cls: 'slot', extra: '<i class="x"><img class="xbtn-img" src="icons/ui_close.png" alt="×" draggable="false"></i>' }) : '<div class="tslot2">カードを<br>選択</div>').join('<i class="ts-plus">＋</i>');   // 版632：あいだに「＋」
    const sp = pv.sp ? (found.has(pv.sp.id) ? `<div class="spban">スペシャルメニュー「${esc(pv.sp.name)}」${pv.sp.skill ? `<small>${(p.skills || []).includes(pv.sp.skill) ? `${esc(D.SKILLS[pv.sp.skill].name)}は習得ずみ（能力だけ上がる）` : `${esc(D.SKILLS[pv.sp.skill].name)}を覚えるチャンス（${Math.round(C.skillRate(p, pv.sp.skill) * 100)}%）`}</small>` : pv.sp.type ? `<small>${p.uniq ? '固有スキルを持つ選手（国内屈指級）はタイプが変わらない（能力だけ上がる）' : (C.TYPES_BY_POS && C.TYPES_BY_POS[p.position] && pv.sp.type !== 'バランス' && !C.TYPES_BY_POS[p.position].includes(pv.sp.type)) ? `${esc(p.position)}は${esc(pv.sp.type)}になれない（能力だけ上がる）。${esc(p.position)}のタイプ：${C.TYPES_BY_POS[p.position].map(esc).join('・')}` : `タイプが${esc(pv.sp.type)}に近づく`}</small>` : ''}</div>` : '<div class="spban new">！？ スペシャルメニューの予感…</div>') : '';
    const msg = p.injury > 0 ? 'ケガで今週は休みです' : done ? `今週の特訓（${lim}回）は終わりました` : camp && nDone ? `合宿中なので、もう1回特訓できます（${nDone}/${lim}回目終了）` : mine.length ? '' : 'カードを最大3枚組み合わせよう';
    // 手札（全種類を並べる。持っていないカードは暗く）
    const cats = ['tact', 'tech', 'phys', 'sup'];
    const hand = cats.map((cat) => `<div class="hg ${CATC[cat]}"><span class="hg-l">${HG_ICO[cat]}<b>${HG_JP[cat]}</b></span><div class="hg-c">${Object.keys(C.CARDS).filter((c) => C.CARDS[c].cat === cat).map((c) => { const n = cardLeft(c); return artCard(c, { cnt: n, cls: n <= 0 || p.injury > 0 || done ? 'none' : '' }); }).join('')}</div></div>`).join('');
    $('#clubLayer').innerHTML = `<div class="trb" style="width:${TRB_W}px;height:${TRB_H}px">
      <div class="trb-card">${playerCardHTML(selIdx, pv.ups, true)}</div>
      <div class="trb-set">
        <div class="ts-h"><span class="ts-ttl">${HG_ICO.sp}SPメニューをつくる</span></div>
        <div class="ts-in${camp ? ' cp' : ''}">${camp ? `<span class="tauto camp">⛺ ${esc(camp.name)}（${camp.week}/${camp.weeks}週目）特訓は週${camp.trains}回・効果${camp.mult}倍</span>` : ''}
        <div class="tslots2">${slots}</div>${sp}${msg ? `<p class="ts-msg"><span>${msg}</span></p>` : ''}
        <div class="ts-btns"><button id="spList" class="splist2">SPメニュー一覧</button>${mine.length && !done && !(p.injury > 0) ? '<button id="doTrain" class="dotrain">特訓する！</button>' : ''}</div></div>
      </div>
      <div class="trb-lw"><button class="trb-arw l" data-arw="-1" aria-label="左へ"></button><div class="trb-line">${line}</div><button class="trb-arw r" data-arw="1" aria-label="右へ"></button></div>
      <div class="trb-hand">${hand}</div>
    </div>`;
    fitBoard();
    const L = $('#clubLayer');
    bindCard(L.querySelector('.trb-card'), selIdx, (j) => { selIdx = j; renderTrain(); }, renderTrain);
    L.querySelectorAll('.tl2').forEach((el) => el.onclick = () => { selIdx = +el.dataset.i; renderTrain(); });
    L.querySelectorAll('.tslots2 .acard').forEach((el, k) => el.onclick = () => { mine.splice(k, 1); save.plan.cards[selIdx] = mine; store(); renderTrain(); });
    L.querySelectorAll('.trb-hand .acard').forEach((el) => el.onclick = () => {
      const c = el.dataset.c; if (p.injury > 0 || done || mine.length >= 3 || cardLeft(c) <= 0) return;
      mine.push(c); save.plan.cards[selIdx] = mine; store(); renderTrain();
    });
    $('#spList').onclick = () => spList();
    L.querySelectorAll('.trb-arw').forEach((b) => b.onclick = () => { const ln = L.querySelector('.trb-line'); ln.scrollBy({ left: +b.dataset.arw * ln.clientWidth * 0.8, behavior: 'smooth' }); });   // 版632：◀▶で選手の列を送る
    const bt = $('#doTrain'); if (bt) bt.onclick = () => doTrain(selIdx);
  }
  // SPリスト（版467・作り直し）：スペシャルメニューの図鑑。見つけたメニューはカードの絵・効果・覚えるスキルまで見られ、選手を選んでそのまま特訓できる
  let spSel = -1, spFilter = 'all';
  function spList(pi) {
    const ps = save.team.players;
    if (pi == null) pi = selIdx;
    const found = new Set(save.spFound || []);
    const el = fullScreen('spScreen', 'std-wrap sp-wrap'), box = el.querySelector('.lk-box');
    // 版692：選び直しても、一覧のスクロール位置をそのままにする（前は上に戻っていた）
    const keep = el.hidden ? null : { g: (box.querySelector('.sp2-grid') || {}).scrollTop, w: (box.querySelector('.sp2-ws') || {}).scrollLeft, d: (box.querySelector('.sp2-d') || {}).scrollTop };
    const J = { kick: 'キック', technique: 'テクニック', dribble: 'ドリブル', pass: 'パス', speed: 'スピード', dash: '瞬発力', stamina: 'スタミナ', physical: 'フィジカル', jump: 'ジャンプ', defense: '守備', vision: '判断', mental: 'メンタル' };
    const kindOf = (m) => (m.skill ? 'skill' : m.type ? 'type' : 'up');
    const HN = premHint();   // 版695：プレミアムパスのヒント
    const all = C.SP.map((m, idx) => ({ m, idx })).filter((o) => spFilter === 'all' || kindOf(o.m) === spFilter);
    if (HN) all.sort((x, y) => (y.m.id === HN.id) - (x.m.id === HN.id));   // 版695：ヒントのメニューをいちばん前に
    if (spSel < 0 || !C.SP[spSel]) { const f = all.find((o) => found.has(o.m.id)); spSel = f ? f.idx : (all[0] || { idx: 0 }).idx; }
    const cardImg = (c, known, cls) => known ? `<span class="spc ${CATC[C.CARDS[c].cat]} ${cls || ''}${(save.cards[c] || 0) < 1 ? ' lack' : ''}"><img src="cards/${c}.jpg" alt="" draggable="false"><em>×${save.cards[c] || 0}</em></span>` : `<span class="spc unk ${CATC[C.CARDS[c].cat]} ${cls || ''}"><i>？</i></span>`;
    const tiles = all.map(({ m, idx }) => { const k = found.has(m.id), kd = kindOf(m);
      return `<button class="spt${k ? ' k' : ''}${idx === spSel ? ' sel' : ''} kd-${kd}${!k && HN && HN.id === m.id ? ' sphint' : ''}" data-sp="${idx}"><div class="spt-c">${m.cards.map((c) => cardImg(c, k || (HN && HN.id === m.id && HN.c === c), !k && HN && HN.id === m.id && HN.c === c ? 'hintc' : '')).join('')}</div><b>${k ? esc(m.name) : '？？？'}</b><small>${k ? (m.skill ? 'スキル：' + esc(D.SKILLS[m.skill].name) : m.type ? 'タイプ：' + esc(m.type) : '能力アップ') : (kd === 'skill' ? 'スキルを覚えるメニュー' : kd === 'type' ? 'タイプが変わるメニュー' : '能力が伸びるメニュー')}</small>${m.gk ? '<i class="spt-gk">GK</i>' : ''}</button>`; }).join('');
    const m = C.SP[spSel], known = found.has(m.id), p = ps[pi];
    const canP = !(p.injury > 0) && !C.trainedThisWeek(save, p), lack = m.cards.filter((c) => (save.cards[c] || 0) < 1), gkNg = m.gk && p.position !== 'GK';
    const ok = known && canP && !lack.length && !gkNg;
    const why = !known ? 'まだ見つけていないメニューです' : !canP ? (p.injury > 0 ? `${esc(p.name)}はケガ中です` : `${esc(p.name)}は今週もう特訓しました`) : gkNg ? 'GK専用のメニューです' : lack.length ? `${lack.map((c) => esc(C.CARDS[c].name)).join('・')}のカードが足りません` : '';
    const ups = known ? [...(m.all ? [`<span class="spu all">全能力<b>+${m.all}</b></span>`] : []), ...D.PARAM_KEYS.filter((k) => (m.up || {})[k]).map((k) => `<span class="spu">${ico(k)}${J[k]}<b>${m.up[k] > 0 ? '+' : ''}${m.up[k]}</b></span>`)].join('') : '<p class="sp-q">特訓で、このカードの組み合わせを試すと見つかります。<br>（色はカードの種類のヒント）</p>';
    const rate = known && m.skill ? Math.round(C.skillRate(p, m.skill) * 100) : null;
    const who = ps.map((q, i) => `<button class="spw${i === pi ? ' on' : ''}${q.injury > 0 || C.trainedThisWeek(save, q) ? ' done' : ''}" data-pi="${i}">${portrait(q)}<b>${esc(q.name)}</b><i class="pos ${POSC[q.position]}">${q.position}</i>${q.injury > 0 ? '<em>ケガ</em>' : C.trainedThisWeek(save, q) ? '<em>済</em>' : ''}</button>`).join('');
    const nF = C.SP.filter((x) => found.has(x.id)).length;
    box.innerHTML = `<div class="sp2"><div class="sp2-h"><b>スペシャルメニュー</b><div class="sp2-bar"><i style="width:${(nF / C.SP.length * 100).toFixed(1)}%"></i></div><span>発見 ${nF} / ${C.SP.length}</span><button class="std-back sp2-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button></div>
      <div class="sp2-tabs">${[['all', 'すべて'], ['skill', 'スキル'], ['type', 'タイプ'], ['up', '能力']].map(([k, l]) => `<button data-f="${k}" class="${spFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="sp2-grid">${tiles}</div>
      <div class="sp2-d"><div class="sp2-dc">${m.cards.map((c) => cardImg(c, known || (HN && HN.id === m.id && HN.c === c), 'big')).join('<i class="sp2-plus">＋</i>')}</div>${!known && HN && HN.id === m.id ? '<p class="sp2-hint">プレミアムパスのヒント：このメニューのカードが1枚わかりました</p>' : ''}
        <h3>${known ? esc(m.name) : '？？？'}</h3>
        ${known && m.skill ? `<div class="sp2-sk"><span>覚えるスキル</span><b>${esc(D.SKILLS[m.skill].name)}</b><div class="sp2-rate"><i style="width:${rate}%"></i><em>${esc(p.name)}の成功率 ${rate}%</em></div></div>` : ''}
        ${known && m.type ? `<div class="sp2-sk ty"><span>近づくタイプ</span><b>${esc(m.type)}</b></div>` : ''}
        <div class="sp2-ups">${ups}</div>
        <div class="sp2-who"><span>特訓する選手</span><div class="sp2-ws">${who}</div></div>
        <button class="sp2-go dotrain"${ok ? '' : ' disabled'}>${ok ? `${esc(p.name)}で特訓する！` : why}</button></div></div>`;
    el.hidden = false; el._fit();
    box.querySelector('.sp2-back').onclick = () => { el.hidden = true; renderTrain(); };
    box.querySelectorAll('[data-sp]').forEach((b) => b.onclick = () => { spSel = +b.dataset.sp; spList(pi); });
    box.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { spFilter = b.dataset.f; spSel = -1; { const g = box.querySelector('.sp2-grid'); if (g) g.scrollTop = 0; } spList(pi); });
    box.querySelectorAll('[data-pi]').forEach((b) => b.onclick = () => spList(+b.dataset.pi));
    if (keep && keep.g != null) { const g = box.querySelector('.sp2-grid'), w = box.querySelector('.sp2-ws'), d = box.querySelector('.sp2-d'); if (g) g.scrollTop = keep.g; if (w && keep.w != null) w.scrollLeft = keep.w; if (d && keep.d != null) d.scrollTop = keep.d; }
    else { const gr = box.querySelector('.sp2-grid'), g = box.querySelector('.sp2-grid .sel'); if (gr && g) gr.scrollTop = Math.max(0, g.offsetTop - gr.offsetTop - 8); const ws = box.querySelector('.sp2-ws'), w = box.querySelector('.spw.on'); if (ws && w) ws.scrollLeft = Math.max(0, w.offsetLeft - ws.offsetLeft - ws.clientWidth / 2 + w.offsetWidth / 2); }
    const go = box.querySelector('.sp2-go:not([disabled])');
    if (go) go.onclick = () => { el.hidden = true; selIdx = pi; save.plan.cards = save.plan.cards || {}; save.plan.cards[pi] = m.cards.slice(); store(); doTrain(pi); };
  }

  // ================= スタメン・戦術（スカッド） =================
  let pick = -1, sqTab = 'pos';
  function swapPlayers(i, j) {
    const ps = save.team.players, a = ps[i], b = ps[j];
    if ((i === 0 || j === 0) && (a.position === 'GK') !== (b.position === 'GK')) return false;   // GKの位置はGKだけ
    ps[i] = b; ps[j] = a;
    const pc = save.plan.cards || (save.plan.cards = {}); const ea = pc[i], eb = pc[j]; if (eb) pc[i] = eb; else delete pc[i]; if (ea) pc[j] = ea; else delete pc[j];
    return true;
  }
  const ROLE_NAME = { captain: 'キャプテン', pk: 'PKキッカー', fk: 'FKキッカー', ck: 'CKキッカー' }, ROLE_TAG = { captain: 'C', pk: 'PK', fk: 'FK', ck: 'CK' };
  // ================= スタメン（カルチョビットAのボード）：マス目のピッチに顔を並べ、ドラッグで動かす・入れ替える =================
  let sqShow = 'cond', sqDrag = null, sqPop = -1, sqNote = false, sqFromHome = false, sqRes = -1, sqResOpen = false, sqMulti = null;   // sqMulti：まとめて放出で選んだ選手（版692）
  const resPow = (q) => { try { C.ensurePts(q); return Math.round(D.PARAMS.reduce((a, x) => a + (q.pts[x.k] || 0), 0) / D.PARAMS.length); } catch (_) { return 0; } };   // 版692：総合（能力の平均）
  // 版694：総合評価（E〜S）。平均の値に合わせた目安：地域2部＝E、地域1部＝D、D3＝C、D2＝B、D1＝A、D1の上位＝S
  const OVR = [['E', 0], ['D', 60], ['C', 150], ['B', 300], ['A', 480], ['S', 720]];
  const ovrG = (q) => { const v = resPow(q); let g = 'E'; for (const [k, t] of OVR) if (v >= t) g = k; return g; };
  const ovrTag = (q, cls) => { const g = ovrG(q); return `<i class="ovr g-${g}${cls ? ' ' + cls : ''}" title="総合評価">${g}</i>`; };
  // 顔の白い背景を抜く（ふちから続く白だけ透明に）。小さく描いてもにじまないよう、ほどよい大きさで作っておく
  const cutCache = new Map();
  function cutFace(img) {
    const src = img.currentSrc || img.src; if (!src || src.length < 64 || img.dataset.cut === src) return;
    if (cutCache.has(src)) { const u = cutCache.get(src); img.dataset.cut = u; img.src = u; return; }
    if (!img.complete || !img.naturalWidth) return;
    try {
      const S = 160, W0 = img.naturalWidth, H0 = img.naturalHeight, k = Math.min(1, S / Math.max(W0, H0)), W = Math.round(W0 * k), H = Math.round(H0 * k);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H), px = d.data, seen = new Uint8Array(W * H), st = [];
      const white = (i) => px[i * 4 + 3] < 20 || (px[i * 4] > 225 && px[i * 4 + 1] > 225 && px[i * 4 + 2] > 225);
      for (let xx = 0; xx < W; xx++) st.push(xx, (H - 1) * W + xx); for (let yy = 0; yy < H; yy++) st.push(yy * W, yy * W + W - 1);
      while (st.length) { const i = st.pop(); if (seen[i] || !white(i)) continue; seen[i] = 1; px[i * 4 + 3] = 0; const xx = i % W, yy = (i - xx) / W; if (xx > 0) st.push(i - 1); if (xx < W - 1) st.push(i + 1); if (yy > 0) st.push(i - W); if (yy < H - 1) st.push(i + W); }
      x.putImageData(d, 0, 0); const u = c.toDataURL(); cutCache.set(src, u); img.dataset.cut = u; img.src = u;
    } catch (e) { /* 読めない時はそのまま */ }
  }

  // 版512：選手どうしが重ならないように（となりのマス＝縦横ななめ1マス以内には置かない）
  function unpile(cells) {
    const near = (a, b) => a && b && Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1;
    let moved = false;
    for (let i = 2; i < 11; i++) {
      if (!cells[i]) continue;
      if (![...Array(i).keys()].some((j) => j > 0 && near(cells[i], cells[j]))) continue;
      let best = null, bd = 1e9;
      for (let r = 0; r < C.GRID_R; r++) for (let c = 0; c < C.GRID_C; c++) {
        if (C.zoneOf(r) !== C.zoneOf(cells[i].r)) continue;
        const cand = { r, c }; if ([...Array(11).keys()].some((j) => j > 0 && j !== i && near(cand, cells[j]))) continue;
        const dd = Math.abs(r - cells[i].r) * 3 + Math.abs(c - cells[i].c); if (dd < bd) { bd = dd; best = cand; }
      }
      if (best) { cells[i] = best; moved = true; }
    }
    return moved;
  }
  // 版512：スマホ（画面の高さが低い）では、スタメン画面（1280×720で作ってある）を丸ごと縮めて収める
  function fitSq2() {   // 版513：選手カード（ポップ）が板からはみ出さないように寄せる
    const L = $('#clubLayer'), bd = L && L.querySelector('.s2board'), pp = bd && bd.querySelector('.s2pop'); if (!pp) return;
    const W = bd.clientWidth, H = bd.clientHeight, x = parseFloat(pp.style.left) || 0, y = parseFloat(pp.style.top) || 0;
    pp.style.left = Math.max(6, Math.min(W - pp.offsetWidth - 6, x)) + 'px'; pp.style.top = Math.max(6, Math.min(H - pp.offsetHeight - 6, y)) + 'px';
  }
  addEventListener('stagefit', () => { const L = $('#clubLayer'); if (L && L.querySelector('.sq2') && !$('#cv-club').hidden && !sqDrag && !document.querySelector('.s2drag')) renderLineup2(); });   // 版531：ドラッグ中は組み直さない
  // 版516：名前の札の中身を、表示の切りかえ（名前・調子／タイプ／星）で変える。長いタイプ名は横に縮めて1行に
  const SQ_SHOW = ['cond', 'type', 'star'], SQ_SHOW_NAME = { cond: '名前・調子', type: 'タイプ', star: 'レア度（星）' };
  function sqTag(q) {
    if (sqShow === 'type') { const t = q.type || 'バランス', k = Math.min(1, 6 / Math.max(1, t.length)); return `<b class="s2n s2n-ty tbadge ${TYPE_CLS[t] || 'ty-bal'}" style="--sx:${k.toFixed(2)}">${esc(t)}</b>`; }
    if (sqShow === 'star') return `<b class="s2n s2n-st">${starHTML(C.ensureStar(q), q.totsu)}</b>`;
    return `<b class="s2n ${POSC[q.position]}">${esc(q.name)}</b>`;
  }
  function renderLineup2() {
    const keepRes = (document.querySelector('#clubLayer .s2st-l') || {}).scrollTop || 0;   // 版561：リザーブを選んでも、一覧の位置をそのままに
    const ps = save.team.players, tac = C.ensureTactics(save), cells = tac.cells, roles = C.slotRoles(cells);
    const R = C.GRID_R, COLS = C.GRID_C;
    // 版513：スマホ（高さの低い画面）は、縮めずに画面の大きさに合わせて組み直す（顔と文字を大きく）
    const PHN = document.documentElement.classList.contains('short');
    let PX0 = 20, PY0 = 64, CW = 46, CH = 46, BX1 = 776, BX2 = 882, BY0 = 116, BDY = 77, boardCss = '', benchCss = ['', ''];
    if (PHN) {
      const Lw = $('#clubLayer').clientWidth || 1040, Lh = $('#clubLayer').clientHeight || 520;
      // 版530：左は104（フォーメーション・リザーブ）、右は104（もどる・切りかえ・戦術）を必ず空けて、その間に板を収める
      const GL = 104, GR = 104, BW = Lw < 1060 ? 84 : 96, bh = Lh - 12;
      CH = Math.floor((bh - 54) / (R + 2)); CW = Math.max(28, Math.min(50, CH + 6, Math.floor((Lw - GL - GR - BW * 2 - 40) / COLS)));
      PX0 = 12; PY0 = 44;
      const bw = PX0 + CW * COLS + 12 + BW * 2 + 6 + 10, bl = Math.max(GL, Math.round(GL + (Lw - GL - GR - bw) / 2));
      boardCss = ` style="left:${bl}px;top:6px;width:${bw}px;height:${bh}px"`;
      const bx = PX0 + CW * COLS + 12, btop = 2, bH = bh - btop - 6;   // 版630：ベンチを上まで使う（名札は顔の上）
      benchCss = [` style="left:${bx}px;top:${btop}px;width:${BW}px;height:${bH}px"`, ` style="left:${bx + BW + 6}px;top:${btop}px;width:${BW}px;height:${bH}px"`];
      BX1 = bx + BW / 2; BX2 = bx + BW + 6 + BW / 2; BY0 = btop + 76; BDY = Math.floor((bH - 76 - 40) / (C.BENCH_N - 1));
    }
    const PW = CW * COLS, PH = CH * (R + 2);
    const cx = (c) => PX0 + c * CW + CW / 2, cy = (r) => PY0 + (R - 1 - r) * CH + CH / 2;
    if (unpile(cells)) store();   // 版512：となりのマスに重なった選手は、すき間のあるマスへ
    const occ = {}; for (let i = 1; i < 11; i++) if (cells[i]) occ[cells[i].r + ':' + cells[i].c] = i;
    let grid = '';
    for (let r = 0; r < R; r++) for (let c = 0; c < COLS; c++) grid += `<i class="s2c z-${C.zoneOf(r)}" data-r="${r}" data-c="${c}" style="left:${PX0 + c * CW}px;top:${PY0 + (R - 1 - r) * CH}px;width:${CW}px;height:${CH}px"></i>`;
    const zl = [['FW', 8], ['MF', 4.5], ['DF', 1]].map(([z, r]) => `<b class="s2zl" style="left:${PX0 + 8}px;top:${cy(r) - 18}px">${z}</b><b class="s2zl" style="left:${PX0 + PW - 70}px;top:${cy(r) - 18}px">${z}</b>`).join('');
    const tagsOf = (q) => Object.keys(ROLE_TAG).filter((k) => k !== 'captain' && tac.roles[k] === q.name).map((k) => `<i class="s2rt rt-${k}">${ROLE_TAG[k]}</i>`).join('') + (tac.roles.captain === q.name ? '<i class="s2rt rt-captain">C</i>' : '');
    const PK = D.PARAMS.map((q) => q.k);
    const badge = (q) => {
      if (q.injury > 0) return '<i class="s2b inj">＋</i>';
      if (q.suspend > 0) return '<i class="s2b sus"></i>';
      if (sqShow !== 'cond') return `<i class="s2b cdot ${condDot(q)}"></i>`;
      return `<i class="s2b cdot ${condDot(q)}"></i><span class="s2ca">${condArrow(q, 22)}</span>`;
    };
    const chip = (q, i, x, y, cls) => `<div class="s2p ${cls || ''}${i === pick ? ' sel' : ''}${q.injury > 0 ? ' inj' : ''}" data-i="${i}" style="left:${x}px;top:${y}px">${sqTag(q)}<span class="s2tags">${tagsOf(q)}</span>${facePic(q, 's2f', i >= 11)}${badge(q)}${ovrTag(q, 's2ov')}${i > 0 && i < 11 && q.position !== roles[i] && q.position !== 'GK' ? '<em class="s2mis" title="本来のポジションとちがう">!</em>' : ''}</div>`;
    let dots = chip(ps[0], 0, PX0 + PW / 2, PY0 + R * CH + CH * 1.05, 'gk');
    for (let i = 1; i < 11; i++) { const c = cells[i]; if (c) dots += chip(ps[i], i, cx(c.c), cy(c.r)); }
    // 控え：1列目（ベンチ入り）・2列目（灰色）
    const bench = ps.slice(11);
    const col = (arr, k0, x, grey) => arr.map((q, k) => chip(q, k0 + k, x, BY0 + k * BDY, 'bn' + (grey ? ' grey' : ''))).join('');
    const b1 = bench.slice(0, C.BENCH_N), b2 = bench.slice(C.BENCH_N);
    
    const label = C.formationLabel(cells);
    const forms = sqNote ? `<div class="s2note">${C.FORMATIONS.map((f) => `<button class="s2f${f === tac.formation ? ' on' : ''}" data-f="${f}"><b>${f}</b>${formMini(f)}</button>`).join('')}</div>` : '';
    const sel = sqPop >= 0 ? ps[sqPop] : null;
    let pop = '';
    if (sel) { C.ensurePts(sel); const rk = PK.map((k) => C.rankInfo(sel.pts[k]).g);
      pop = `<div class="s2pop" style="${sqPop < 11 && sqPop > 0 && cells[sqPop] ? `left:${Math.min(560, Math.max(30, cx(cells[sqPop].c) - 170))}px;top:${Math.max(70, cy(cells[sqPop].r) - 150)}px` : sqPop === 0 ? `left:${PX0 + PW / 2 - 170}px;top:${PY0 + R * CH - 120}px` : (PHN ? `left:${BX1 - 400}px;top:${BY0 - 60 + ((sqPop - 11) % C.BENCH_N) * BDY}px` : `left:560px;top:${Math.min(470, 60 + (sqPop - 11) * 75)}px`)}"><div class="s2ph"><i class="pos ${POSC[sel.position]}">${sel.position}</i><b>${sel.number}</b><span>${esc(sel.name)}</span>${starHTML(C.ensureStar(sel), sel.totsu)}<button class="s2px xbtn"><img class="xbtn-img" src="icons/ui_close.png" alt="×" draggable="false"></button></div>
        <div class="s2pr">${PK.map((k, j) => `<span title="${esc(D.PARAMS[j].name)}">${ico(k)}<i class="rk2 g-${rk[j]}">${rk[j]}</i></span>`).join('')}</div>
        <div class="s2pt"><span class="tbadge ${TYPE_CLS[sel.type] || 'ty-bal'}">${esc(sel.type || '')}</span><i class="cdot ${condDot(sel)}"></i><small>疲労 ${Math.round(sel.fatigue || 0)}%</small><span class="s2ft">利き足${footSVG(sel.foot)}<b>${sel.foot === 'L' ? '左' : '右'}</b></span></div>
        <div class="s2rl">${Object.keys(ROLE_NAME).map((k) => `<button data-role="${k}" class="${tac.roles[k] === sel.name ? 'on' : ''}"><i class="s2rt rt-${k}">${ROLE_TAG[k]}</i>${ROLE_NAME[k]}</button>`).join('')}</div>
        <button class="s2pd" data-pd="${sqPop}">選手データを見る</button></div>`; }
    // 版517：リザーブの選手を選んだら、その選手の能力も見せる（下に重ねても、その下の選手はタップできる）
    if (!sel && sqResOpen && sqRes >= 0 && save.reserve[sqRes]) { const q = save.reserve[sqRes]; C.ensurePts(q); const rk = PK.map((k) => C.rankInfo(q.pts[k]).g);
      pop = `<div class="s2pop s2rpop" style="left:${PX0 + 4}px;top:9999px"><div class="s2ph"><i class="pos ${POSC[q.position]}">${q.position}</i><span>${esc(q.name)}</span>${starHTML(C.ensureStar(q), q.totsu)}<small class="s2rp-tag">リザーブ</small></div>
        <div class="s2pr">${PK.map((k, j) => `<span title="${esc(D.PARAMS[j].name)}">${ico(k)}<i class="rk2 g-${rk[j]}">${rk[j]}</i></span>`).join('')}</div>
        <div class="s2pt"><span class="tbadge ${TYPE_CLS[q.type] || 'ty-bal'}">${esc(q.type || '')}</span>${condGauge(q, 'sm')}<small>疲労 ${Math.round(q.fatigue || 0)}%</small><span class="s2ft">利き足${footSVG(q.foot)}<b>${q.foot === 'L' ? '左' : '右'}</b></span></div></div>`; }
    if (sqResOpen && (save.reserve || []).length > 1) save.reserve.sort((a, b) => resPow(b) - resPow(a));   // 版692：能力の高い順
    $('#clubLayer').innerHTML = `<div class="sq2${PHN ? ' ph' : ''}${sqResOpen && (save.reserve || []).length ? ' resopen' : ''}"><div class="s2board"${boardCss}>
        <div class="s2head"><img src="${emblemURL(save.team.name, 40)}" alt=""><b>${esc(save.team.name)}</b><em>［${esc(label)}］</em></div>
        <div class="s2pitch" style="left:${PX0}px;top:${PY0}px;width:${PW}px;height:${PH}px"><i class="s2gk" style="top:${R * CH}px;height:${CH * 2}px"></i><i class="s2box" style="left:${PW * 0.22}px;width:${PW * 0.56}px;top:${R * CH - CH * 0.15}px;height:${CH * 2.15}px"></i><i class="s2box2" style="left:${PW * 0.34}px;width:${PW * 0.32}px;top:${R * CH + CH * 0.85}px;height:${CH * 1.15}px"></i></div>
        ${grid}${zl}
        <div class="s2bench"${benchCss[0]}><b class="s2bh">ベンチ入り</b></div><div class="s2bench g"${benchCss[1]}><b class="s2bh">ベンチ外</b></div>
        ${Array.from({ length: C.BENCH_N }, (_, k) => `<i class="s2e" style="left:${BX1}px;top:${BY0 + k * BDY}px"></i><i class="s2e" style="left:${BX2}px;top:${BY0 + k * BDY}px"></i>`).join('')}${dots}${col(b1, 11, BX1, false)}${col(b2, 11 + C.BENCH_N, BX2, true)}
        ${pop}</div>
      <button class="s2btn s2nb" data-a="note"><span>${formMini(tac.formation === 'custom' ? '4-4-2' : tac.formation)}</span><b>フォーメーション</b></button>
      <button class="s2btn s2db" data-a="show" title="表示の切りかえ（名前・調子／タイプ／星）"><span><img class="s2chg" src="icons/ui_change.png" alt="切りかえ"></span></button>
      <button class="s2btn s2tb" data-a="tac"><span>${RB_TAC_SVG}</span><b>戦術</b></button>
      ${(save.reserve || []).length ? `<button class="s2btn s2rb" data-a="res"><span>${(save.reserve || []).length}</span><b>リザーブ</b></button>` : ''}
      ${sqResOpen && (save.reserve || []).length ? `<div class="s2strip"><div class="s2st-h"><b>リザーブ</b><button class="s2res-x xbtn" title="とじる"><img class="xbtn-img" src="icons/ui_close.png" alt="×" draggable="false"></button></div><div class="s2st-l">${save.reserve.map((q, k) => `<div class="s2sc${k === sqRes ? ' on' : ''}${sqMulti && sqMulti.has(q) ? ' chk' : ''}" data-r="${k}">${facePic(q, 's2sf')}${ovrTag(q, 's2pw')}${sqMulti ? `<i class="s2ck">${sqMulti.has(q) ? '✓' : ''}</i>` : ''}${sqTag(q)}</div>`).join('')}</div>${sqMulti ? `<div class="s2mu"><button class="s2mu-go"${sqMulti.size ? '' : ' disabled'}>${sqMulti.size}人を放出</button><button class="s2mu-x">やめる</button></div>` : (sqRes < 0 ? '<div class="s2mu"><button class="s2mu-on">まとめて放出</button></div>' : '') + (sqRes >= 0 ? `<button class="s2rel s2rel2" data-rel="${sqRes}" title="放出"><img src="icons/pc_release.png" alt="放出"></button>` : '<p class="s2st-hint">タップ→チームの選手をタップ／横に引っぱって置く</p>')}</div>` : ''}
      ${forms}
      <p class="s2hint">選手をドラッグして、マスに置く・ほかの選手（控えとも）と入れ替える。タップでくわしく。</p></div>`;
    const L = $('#clubLayer'), board = L.querySelector('.s2board'); fitSq2();
    { const rl = L.querySelector('.s2st-l'); if (rl && keepRes) rl.scrollTop = keepRes; }
    board.querySelectorAll('img.fc').forEach((im) => { const f = () => cutFace(im); im.addEventListener('load', f); if (im.complete) f(); });
    const done = () => { store(); renderLineup2(); };
    L.querySelectorAll('.s2btn').forEach((b) => b.onclick = () => { const a = b.dataset.a;
      if (a === 'note') { sqNote = !sqNote; renderLineup2(); }
      else if (a === 'show') { sqShow = SQ_SHOW[(SQ_SHOW.indexOf(sqShow) + 1) % SQ_SHOW.length]; renderLineup2(); const bd = $('#clubLayer .s2board'); if (bd) { const t = document.createElement('div'); t.className = 's2toast'; t.textContent = '表示：' + SQ_SHOW_NAME[sqShow]; bd.appendChild(t); setTimeout(() => t.remove(), 1300); } }
      else if (a === 'tac') { sqTab = 'tac'; renderLineup(); }
      else if (a === 'res') { sqResOpen = !sqResOpen; sqRes = -1; sqMulti = null; renderLineup2(); }
      else if (a === 'club') openClub({ onDone: () => renderLineup() }); });
    { const rb = L.querySelector('.s2res-back'); if (rb) rb.onclick = () => { sqRes = -1; renderLineup2(); }; }
    { const rx = L.querySelector('.s2res-x'); if (rx) rx.onclick = () => { sqResOpen = false; sqRes = -1; sqMulti = null; renderLineup2(); }; }
    // 版517：リザーブとチームの入れかえ（タップでもドラッグでも）
    function swapRes(k, i) {
      const ps = save.team.players, r = save.reserve[k]; if (!r || !ps[i]) return;
      if (i === 0 && r.position !== 'GK') { coachAsk('GKの所には、GKの選手しか入れられません。', [{ label: 'OK', value: true }]); return; }
      const out = ps[i]; ps[i] = r; save.reserve[k] = out; { const pc = save.plan && save.plan.cards; if (pc) delete pc[i]; }
      { const tac = C.ensureTactics(save); for (const key in (tac.roles || {})) if (tac.roles[key] === out.name) tac.roles[key] = null; }
      sqRes = -1; pick = -1; sqPop = -1; done();
    }
    // リザーブの帯から、横に引っぱるとドラッグ（縦はスクロール）
    L.querySelectorAll('.s2sc').forEach((c) => {
      let dg = null;
      // 版693：iPhoneでは縦のスクロールにとられてドラッグできないことがあったので、①横に引く ②少し長押し（0.3秒）のどちらでもドラッグを始める
      const lift = (x, y) => { if (!dg || dg.on) return; dg.on = true; try { c.setPointerCapture(dg.id); } catch (_) {} const sq = L.querySelector('.sq2'); dg.sq = sq; dg.ghost = document.createElement('div'); dg.ghost.className = 's2drag'; const im = c.querySelector('img'); if (im) dg.ghost.appendChild(im.cloneNode(true)); sq.appendChild(dg.ghost); c.classList.add('lift'); const r = sq.getBoundingClientRect(), k = r.width / sq.offsetWidth; dg.ghost.style.left = (x - r.left) / k + 'px'; dg.ghost.style.top = (y - r.top) / k + 'px'; };
      c.addEventListener('touchmove', (e) => { if (dg && (dg.on || dg.hold)) e.preventDefault(); }, { passive: false });
      c.addEventListener('pointerdown', (e) => { if (sqMulti || e.target.closest('.s2rel')) return; dg = { x0: e.clientX, y0: e.clientY, on: false, ghost: null, id: e.pointerId };
        const me = dg; me.hold = false; me.tm = setTimeout(() => { if (dg === me && !me.on) { me.hold = true; lift(me.lx != null ? me.lx : me.x0, me.ly != null ? me.ly : me.y0); } }, 300);
        const fin = (ev) => { if (ev.pointerId !== e.pointerId) return; removeEventListener('pointerup', fin, true); removeEventListener('pointercancel', fin, true); if (dg && dg.on) end(ev.type === 'pointercancel' && dg.lx != null ? { clientX: dg.lx, clientY: dg.ly } : ev, false); };   // 版531：指を離した合図を画面全体でも受け取る
        addEventListener('pointerup', fin, true); addEventListener('pointercancel', fin, true); });
      c.addEventListener('pointermove', (e) => {
        if (!dg) return; dg.lx = e.clientX; dg.ly = e.clientY; const dx = e.clientX - dg.x0, dy = e.clientY - dg.y0;
        if (!dg.on) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 0.8) { clearTimeout(dg.tm); lift(e.clientX, e.clientY); } else if (Math.abs(dy) > 10) { clearTimeout(dg.tm); dg = null; return; } }
        if (dg && dg.on) { e.preventDefault(); const r = dg.sq.getBoundingClientRect(), k = r.width / dg.sq.offsetWidth; dg.ghost.style.left = (e.clientX - r.left) / k + 'px'; dg.ghost.style.top = (e.clientY - r.top) / k + 'px';
          L.querySelectorAll('.hov').forEach((h) => h.classList.remove('hov')); const t = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest && x.closest('.s2p:not(.ghost)')).find(Boolean); if (t) t.classList.add('hov'); }
      });
      const end = (e, cancel) => { const d = dg; dg = null; if (d) clearTimeout(d.tm); if (!d || !d.on) return; d.ghost.remove(); c.classList.remove('lift'); c.dataset.drag = '1'; setTimeout(() => { delete c.dataset.drag; }, 50);
        if (cancel) { renderLineup2(); return; }
        const t = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest && x.closest('.s2p:not(.ghost)')).find(Boolean);
        if (t) swapRes(+c.dataset.r, +t.dataset.i); else renderLineup2(); };
      c.addEventListener('pointerup', (e) => end(e, false)); c.addEventListener('pointercancel', (e) => end(e, true));
    });
    L.querySelectorAll('.s2sc').forEach((c) => c.onclick = (e) => { if (c.dataset.drag) return; if (e.target.closest('.s2rel')) return; const k = +c.dataset.r;
      if (sqMulti) { const q = save.reserve[k]; if (sqMulti.has(q)) sqMulti.delete(q); else sqMulti.add(q); renderLineup2(); return; }
      sqRes = sqRes === k ? -1 : k; pick = -1; sqPop = -1; renderLineup2(); });
    // 版692：まとめて放出（選んだ選手をいっぺんに。覚醒のカケラをまとめてもらう）
    { const on = L.querySelector('.s2mu-on'); if (on) on.onclick = () => { sqMulti = new Set(); sqRes = -1; renderLineup2(); }; }
    { const x = L.querySelector('.s2mu-x'); if (x) x.onclick = () => { sqMulti = null; renderLineup2(); }; }
    { const go = L.querySelector('.s2mu-go'); if (go) go.onclick = async () => { const list = save.reserve.filter((q) => sqMulti.has(q)); if (!list.length) return;
      const kk = list.reduce((a, q) => a + (C.KAKERA_OF[C.ensureStar(q)] || 1) * (1 + (q.totsu || 0)), 0);
      if (!(await coachAsk(`${list.length}人を放出しますか？<br><small>${list.map((q) => esc(q.name)).join('・')}<br>ほかのクラブへ移籍します（戻ってきません）。<br>覚醒のカケラ <b>${kk}</b> をもらえます。</small>`))) return;
      save.reserve = save.reserve.filter((q) => !sqMulti.has(q)); save.kakera = (save.kakera || 0) + kk; sqMulti = null; sqRes = -1; if (!save.reserve.length) sqResOpen = false; done(); }; }
    L.querySelectorAll('.s2rel').forEach((b) => b.onclick = async (e) => { e.stopPropagation(); const k = +b.dataset.rel, q = save.reserve[k]; const kk = (C.KAKERA_OF[C.ensureStar(q)] || 1) * (1 + (q.totsu || 0));
      if (!(await coachAsk(`${esc(q.name)}を放出しますか？<br><small>ほかのクラブへ移籍します（戻ってきません）。<br>覚醒のカケラ <b>${kk}</b> をもらえます。</small>`))) return;
      save.reserve.splice(k, 1); save.kakera = (save.kakera || 0) + kk; sqRes = -1; if (!save.reserve.length) sqResOpen = false; done(); });   // 版508：放出（覚醒のカケラになる）
    L.querySelectorAll('.s2f').forEach((b) => b.onclick = () => { tac.formation = b.dataset.f; tac.cells = C.cellsFor(b.dataset.f); sqNote = false; pick = -1; done(); });
    { const x = L.querySelector('.s2px'); if (x) x.onclick = (e) => { e.stopPropagation(); sqPop = -1; pick = -1; renderLineup2(); }; }   // 版806：×で閉じたら選択も解除（次のタップで入れ替わらない）
    { const pd = L.querySelector('.s2pd'); if (pd) pd.onclick = () => { const i = +pd.dataset.pd; sqPop = -1; pick = -1; playerDetail(i); }; }
    L.querySelectorAll('.s2rl [data-role]').forEach((bt) => bt.onclick = () => { const k = bt.dataset.role; tac.roles[k] = tac.roles[k] === sel.name ? null : sel.name; done(); });
    // ドラッグ（指でもマウスでも）：少し動かしたらドラッグ、動かさずに離したらタップ
    const scaleOf = () => { const r = board.getBoundingClientRect(); return { r, k: r.width / board.offsetWidth }; };
    L.querySelectorAll('.s2p').forEach((el) => {
      el.onpointerdown = (e) => {
        e.preventDefault(); const i = +el.dataset.i, { r, k } = scaleOf();
        sqDrag = { i, el, x0: e.clientX, y0: e.clientY, on: false, ghost: null, r, k, id: e.pointerId };
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        // 版531：iPhoneで指を離した合図が選手に届かず、持ち上げたまま止まることがあった → 画面全体でも離した・キャンセルを受け取る
        const mv = (ev) => { if (sqDrag && sqDrag.el === el && ev.pointerId === sqDrag.id && ev.target !== el) el.onpointermove(ev); };
        const fin = (ev) => { if (ev.pointerId !== e.pointerId) return; removeEventListener('pointermove', mv, true); removeEventListener('pointerup', fin, true); removeEventListener('pointercancel', fin, true);
          if (sqDrag && sqDrag.el === el) { if (ev.type === 'pointercancel') { const d = sqDrag; if (d.on && d.lx != null) el.onpointerup({ clientX: d.lx, clientY: d.ly, pointerId: d.id }); else el.onpointercancel(ev); } else el.onpointerup(ev); } };
        addEventListener('pointermove', mv, true); addEventListener('pointerup', fin, true); addEventListener('pointercancel', fin, true);
      };
      el.onpointermove = (e) => {
        const d = sqDrag; if (!d || d.el !== el) return; d.lx = e.clientX; d.ly = e.clientY;
        if (!d.on && sqRes < 0 && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 12) { d.on = true; d.ghost = el.cloneNode(true); d.ghost.classList.add('ghost'); board.appendChild(d.ghost); el.classList.add('lift'); }
        if (d.on) { d.ghost.style.left = (e.clientX - d.r.left) / d.k + 'px'; d.ghost.style.top = (e.clientY - d.r.top) / d.k + 18 + 'px';
          board.querySelectorAll('.hov').forEach((h) => h.classList.remove('hov')); const tgt = dropAt(e.clientX, e.clientY); if (tgt) tgt.classList.add('hov'); }
      };
      el.onpointerup = (e) => {
        const d = sqDrag; sqDrag = null; if (!d || d.el !== el) return;
        if (!d.on) {   // タップ：くわしく（2回目のタップ・別の選手のタップで入れ替えもできる）
          const i = d.i;
          if (sqRes >= 0) { swapRes(sqRes, i); return; }   // 版508：リザーブの選手とチームの選手を入れかえ（版516：帯は開いたまま）
          if (pick >= 0 && pick !== i) { swapPlayers(pick, i); pick = -1; sqPop = -1; done(); return; }
          if (sqPop === i || pick === i) { sqPop = -1; pick = -1; } else { sqPop = i; pick = i; }   // 版806：同じ選手をもう一度タップしたら、選択を解除
          renderLineup2(); return;
        }
        if (d.ghost) d.ghost.remove();
        const tgt = dropAt(e.clientX, e.clientY);
        pick = -1; sqPop = -1;
        if (tgt && tgt.classList.contains('s2sc')) { swapRes(+tgt.dataset.r, d.i); return; }   // 版517：チームの選手をリザーブの帯へ
        if (tgt && tgt.classList.contains('s2p')) { const j = +tgt.dataset.i; if (j !== d.i) swapPlayers(d.i, j); }
        else if (tgt && tgt.classList.contains('s2c') && d.i > 0 && d.i < 11) {
          const rr = +tgt.dataset.r, cc = +tgt.dataset.c; let who = occ[rr + ':' + cc];
          if (!who) for (let k = 1; k < 11; k++) if (k !== d.i && cells[k] && Math.abs(cells[k].r - rr) <= 1 && Math.abs(cells[k].c - cc) <= 1) { who = k; break; }   // 版512：となりに置くと重なるので、その選手と入れかえ
          if (who && who !== d.i) { const t2 = cells[who]; cells[who] = cells[d.i]; cells[d.i] = t2; } else cells[d.i] = { r: rr, c: cc };
          tac.formation = 'custom';
        }
        done();
      };
      el.onpointercancel = () => { const d = sqDrag; if (d && d.el === el && d.on && d.lx != null) { el.onpointerup({ clientX: d.lx, clientY: d.ly, pointerId: d.id }); return; } sqDrag = null; if (d && d.ghost) d.ghost.remove(); renderLineup2(); };
    });
    function dropAt(x, y) {
      const els = document.elementsFromPoint(x, y);
      for (const e2 of els) { if (e2.classList && e2.classList.contains('ghost')) continue; const p2 = e2.closest && e2.closest('.s2p:not(.ghost)'); if (p2 && p2 !== (sqDrag && sqDrag.el)) return p2; const sc = e2.closest && e2.closest('.s2sc'); if (sc) return sc; if (e2.classList && e2.classList.contains('s2c')) return e2; }
      return null;
    }
  }
  // フォーメーションの小さな図（ノートの中・ボタン）
  function formMini(f, club) {
    if (club) return `<svg viewBox="0 0 40 40" class="s2mini"><path d="M20 4l14 5v10c0 9-6 15-14 18C12 34 6 28 6 19V9z" fill="#2f8a4e" stroke="#fff" stroke-width="2.5"/><circle cx="20" cy="20" r="6" fill="#fff"/></svg>`;
    const cs = C.cellsFor(f || '4-4-2'), dots = cs.slice(1, 11).map((c2) => c2 ? `<circle cx="${3 + c2.c * 2.4}" cy="${33 - c2.r * 3}" r="2" fill="#fff"/>` : '').join('');
    return `<svg viewBox="0 0 40 40" class="s2mini"><rect x="1" y="1" width="38" height="38" rx="3" fill="#2f8a4e"/><rect x="1" y="1" width="38" height="9" fill="#2f6fd6" opacity=".6"/><rect x="1" y="10" width="38" height="12" fill="#e0b020" opacity=".55"/><rect x="1" y="22" width="38" height="9" fill="#d83a3a" opacity=".55"/>${dots}<circle cx="20" cy="36" r="2" fill="#ffe23a"/></svg>`;
  }
  function renderLineup() {
    if (sqTab === 'pos') { renderLineup2(); return; }
    const ps = save.team.players, tac = C.ensureTactics(save), cells = tac.cells;
    const TOP = 20, CW = 28, CH = 35, COLS = C.GRID_C, ROWS = C.GRID_R + 2, PW = CW * COLS, PH = CH * ROWS + TOP;
    const cx = (c) => c * CW + CW / 2, cy = (r) => TOP + (C.GRID_R - 1 - r) * CH + CH / 2;   // 行0が下（自陣）。上は選手の頭が切れないよう少しあける
    const roles = C.slotRoles(cells);
    const tagsOf = (q) => Object.keys(ROLE_TAG).filter((k) => tac.roles[k] === q.name).map((k) => `<i class="rt rt-${k}">${ROLE_TAG[k]}</i>`).join('');
    const occ = {}; for (let i = 1; i < 11; i++) if (cells[i]) occ[cells[i].r + ':' + cells[i].c] = i;
    // マス目（ゾーンの色）
    let grid = '';
    for (let r = 0; r < C.GRID_R; r++) for (let c = 0; c < COLS; c++) grid += `<i class="gc z-${C.zoneOf(r)}${occ[r + ':' + c] ? '' : ' free'}" data-r="${r}" data-c="${c}" style="left:${c * CW}px;top:${cy(r) - CH / 2}px;width:${CW}px;height:${CH}px"></i>`;
    const zl = [['FW', 8], ['MF', 4.5], ['DF', 1]].map(([z, r]) => `<b class="zl" style="top:${cy(r) - 10}px">${z}</b><b class="zl r" style="top:${cy(r) - 10}px">${z}</b>`).join('');
    const pl = (q, i, x, y) => `<div class="sq-slot${i === pick ? ' sel' : ''}${q.injury > 0 ? ' inj' : ''}" data-i="${i}" style="left:${x}px;top:${y}px">${portrait(q)}<b><i class="pos ${POSC[roles[i]]}">${roles[i]}</i>${esc(q.name)}</b><span class="rts">${tagsOf(q)}</span>${q.position !== roles[i] ? `<em class="sq-mis">本来${q.position}</em>` : ''}</div>`;
    let dots = pl(ps[0], 0, PW / 2, TOP + C.GRID_R * CH + CH);
    for (let i = 1; i < 11; i++) { const c = cells[i]; dots += pl(ps[i], i, cx(c.c), cy(c.r)); }
    const pitch = `<div class="sq-pitch grid" style="width:${PW}px;height:${PH}px">${grid}<i class="gk-area"></i><i class="gk-box"></i>${zl}${dots}</div>`;
    const bench = ps.slice(11).map((q, k) => { const i = k + 11; return `<div class="sq-bench${i === pick ? ' sel' : ''}${q.injury > 0 ? ' inj' : ''}" data-i="${i}">${portrait(q)}<span><b><i class="pos ${POSC[q.position]}">${q.position}</i>${q.number} ${esc(q.name)}${tagsOf(q)}</b><small>${esc(q.type)}　<i class="cdot ${condDot(q)}"></i>${q.injury > 0 ? ` ケガ あと${q.injury}週` : ''}</small></span></div>`; }).join('');
    const sel = pick >= 0 ? ps[pick] : null;
    const roleBox = sel ? `<div class="sq-adj"><span>${esc(sel.name)}を</span>${Object.keys(ROLE_NAME).map((k) => `<button data-role="${k}" class="${tac.roles[k] === sel.name ? 'on' : ''}">${ROLE_NAME[k]}${tac.roles[k] === sel.name ? '✓' : ''}</button>`).join('')}<small>${pick > 0 && pick < 11 ? 'ピッチの空いているマスをタップすると移動します' : pick === 0 ? 'GKはゴール前から動かせません' : 'ピッチの選手をタップすると入れ替わります'}</small></div>`
      : '<p class="hintp">選手をタップして、空いているマスをタップすると移動。選手どうしをタップすると入れ替わります（控えとも）。マスの色（FW・MF・DF）で役割が決まるので、0-10のような形も自由に組めます。</p>';
    const label = C.formationLabel(cells);
    const posTab = `<h4>代表的なフォーメーション <small>（ここから自由に動かしてOK）</small></h4><div class="sq-forms">${C.FORMATIONS.map((f) => `<button class="sq-f${f === tac.formation ? ' on' : ''}" data-f="${f}">${f}</button>`).join('')}</div>${roleBox}
      <h4>役割</h4><p class="sq-roles">${Object.keys(ROLE_NAME).map((k) => `<span><i class="rt rt-${k}">${ROLE_TAG[k]}</i>${ROLE_NAME[k]}：${tac.roles[k] ? esc(tac.roles[k]) : '<em>おまかせ</em>'}</span>`).join('')}</p>
      <h4>控え</h4><div class="sq-benches">${bench}</div>`;
    const styleNow = C.STYLES.find((x) => x.id === tac.style);
    const tacTab = `<h4>戦い方　<small>${styleNow ? '' : '（カスタム）'}</small></h4><div class="sq-styles">${C.STYLES.map((st) => `<button class="sq-st${st.id === tac.style ? ' on' : ''}" data-st="${st.id}"><b>${esc(st.name)}</b><small>${esc(st.desc)}</small></button>`).join('')}</div>
      <p class="hintp">戦い方を選ぶと、下の項目がそろいます（選手の配置は変わりません）。そこから好きに変えてもOK。</p>
      <div class="sq-items">${C.TACTIC_ITEMS.map((it) => `<div class="sq-it"><span class="sq-in">${esc(it.name)}</span><span class="sq-seg">${it.opts.map(([v, nm]) => `<button data-k="${it.key}" data-v="${v}" class="${String(tac[it.key]) === String(v) ? 'on' : ''}">${esc(nm)}</button>`).join('')}</span><small>${esc(it.desc)}</small></div>`).join('')}</div>`;
    $('#clubLayer').innerHTML = `<div class="dpanel sq"><h2>スタメン・戦術　<small>${esc(label)}・${esc(styleNow ? styleNow.name : 'カスタム')}</small></h2><div class="sq-grid">${pitch}<div class="sq-side"><div class="sq-tabs"><button data-t="pos" class="${sqTab === 'pos' ? 'on' : ''}">配置・役割</button><button data-t="tac" class="${sqTab === 'tac' ? 'on' : ''}">チーム戦術</button><button data-t="sit" class="${sqTab === 'sit' ? 'on' : ''}">試合中の作戦</button></div>${sqTab === 'pos' ? posTab : sqTab === 'tac' ? tacTab : situHtml(tac.situ)}</div></div></div>`;
    const L = $('#clubLayer');
    L.querySelectorAll('.sq-tabs button').forEach((bt) => bt.onclick = () => { sqTab = bt.dataset.t; renderLineup(); });
    { const cb = L.querySelector('.sq-club'); if (cb) cb.onclick = () => openClub({ onDone: () => renderLineup() }); }
    L.querySelectorAll('.sq-slot, .sq-bench').forEach((el) => el.onclick = (e) => {
      e.stopPropagation();
      const i = +el.dataset.i;
      if (pick < 0) { pick = i; renderLineup(); return; }
      if (pick !== i) { swapPlayers(pick, i); store(); pick = -1; } else pick = -1;
      renderLineup();
    });
    L.querySelectorAll('.gc.free').forEach((el) => el.onclick = () => {
      if (!(pick > 0 && pick < 11)) return;
      cells[pick] = { r: +el.dataset.r, c: +el.dataset.c }; tac.formation = 'custom'; pick = -1; store(); renderLineup();
    });
    L.querySelectorAll('.sq-f').forEach((bt) => bt.onclick = () => { tac.formation = bt.dataset.f; tac.cells = C.cellsFor(bt.dataset.f); store(); pick = -1; renderLineup(); });
    L.querySelectorAll('[data-role]').forEach((bt) => bt.onclick = () => { const k = bt.dataset.role; tac.roles[k] = tac.roles[k] === sel.name ? null : sel.name; store(); renderLineup(); });
    L.querySelectorAll('.sq-st').forEach((bt) => bt.onclick = () => { const st = C.STYLES.find((x) => x.id === bt.dataset.st); Object.assign(tac, st.t, { style: st.id }); store(); renderLineup(); });
    L.querySelectorAll('.sq-seg button[data-k]').forEach((bt) => bt.onclick = () => { const k = bt.dataset.k, v = bt.dataset.v; tac[k] = isNaN(+v) ? v : +v; tac.style = 'custom'; store(); renderLineup(); });
    bindSitu(L, tac.situ, () => { store(); renderLineup(); });
  }
  // 状況別の作戦（スタメン画面とハーフタイムで共通）
  function situHtml(situ) {
    const desc = C.SITU_ACTS.map(([, nm, d]) => `<span><b>${esc(nm)}</b>：${esc(d)}</span>`).join('');
    return `<h4>状況別の作戦 <small>（試合中、自動で切りかわります）</small></h4>
      <div class="sq-items">
        <div class="sq-it"><span class="sq-in">いつから</span><span class="sq-seg">${C.SITU_FROM.map(([v, nm]) => `<button data-sf="${v}" class="${situ.from === v ? 'on' : ''}">${esc(nm)}</button>`).join('')}</span></div>
        ${C.SITU_ROWS.map(([key, nm]) => `<div class="sq-it"><span class="sq-in">${esc(nm)}</span><span class="sq-seg">${C.SITU_ACTS.map(([v, an]) => `<button data-sk="${key}" data-sv="${v}" class="${situ[key] === v ? 'on' : ''} sv-${v}">${esc(an)}</button>`).join('')}</span></div>`).join('')}
      </div>
      <p class="sit-desc">${desc}</p>
      <p class="hintp">決めた時間になると、点差を見て作戦が切りかわります。それまではいつもの戦い方です。</p>`;
  }
  function bindSitu(root, situ, after) {
    root.querySelectorAll('[data-sf]').forEach((bt) => bt.onclick = () => { situ.from = +bt.dataset.sf; after(); });
    root.querySelectorAll('[data-sk]').forEach((bt) => bt.onclick = () => { situ[bt.dataset.sk] = bt.dataset.sv; after(); });
  }
  // ================= 選手交代（試合中いつでも／ハーフタイム）：カルチョビットAのように、ボードで選んで「はい」 =================
  // ms：この試合の記録（ピッチの選手・使った控え・配置・作戦）。交代は1試合3人まで
  const battery = (st) => { const n = Math.max(0, Math.min(5, Math.ceil(st / 20))); return `<i class="bat ${st < 35 ? 'low' : st < 60 ? 'mid' : ''}">${'<b></b>'.repeat(n)}${'<b class="e"></b>'.repeat(5 - n)}</i>`; };
  function subSheet(mt, info, ms) {
    const ps = mt.team.players, base = C.ensureTactics(save);
    if (!ms.on) { ms.on = [...Array(11).keys()]; ms.used = []; ms.out = []; ms.changes = []; ms.cells = (mt.team.cells || C.cellsFor(mt.team.formation)).map((c) => c && { ...c }); ms.att = base.attitude || 'balanced'; ms.cur = {}; }
    // 今回の変更（「戻る」で試合に伝える）
    const plan = { subs: [], cells: ms.cells.map((c) => c && { ...c }), att: ms.att };
    let page = 'board';
    let el = document.getElementById('htModal');
    if (!el) { el = document.createElement('div'); el.id = 'htModal'; document.getElementById('app').appendChild(el); }
    el.className = 'modal sb-wrap sb2-wrap';
    const left = () => 3 - ms.used.length - plan.subs.length;
    const onPitch = () => { const a = ms.on.slice(); for (const x of plan.subs) a[x.slot] = x.bench; return a; };
    const stamOf = (k) => { const x = plan.subs.find((y) => y.slot === k); return x ? Math.round(100 - (ps[x.bench].fatigue || 0) * 0.5) : Math.round(info.stamina[k]); };
    // ボードの寸法（1080×600の箱で組んで、画面に合わせて拡大縮小）
    const COLS = C.GRID_C, ROWS = C.GRID_R, CW = 40, CH = 33, PW = CW * COLS, PH = CH * (ROWS + 2.3);
    const cx = (c) => c * CW + CW / 2, cy = (r) => (ROWS - 1 - r) * CH + CH / 2;
    const ZC = { FW: 'pv-fw', MF: 'pv-mf', DF: 'pv-df', GK: 'pv-gk' };
    const fitBox = () => { const box = el.querySelector('.sb2-box'); if (!box) return; const ap = document.getElementById('app'); const k = Math.min(ap.clientWidth / 1080, ap.clientHeight / 600); box.style.transform = `translate(-50%,-50%) scale(${k.toFixed(4)})`; };
    if (!el.__fit) {
      el.__fit = true; addEventListener('resize', () => { if (!el.hidden) fitBox(); });
      // カードが出ているときは、カードの外をタップすると閉じるだけ（下の選手は動かさない）
      el.addEventListener('pointerdown', (e) => { const ov = el.querySelector('.sb2-cov'); if (ov && !e.target.closest('.pc-card')) { ov.remove(); e.preventDefault(); e.stopPropagation(); } }, true);
    }
    const idxOf = (q) => { let i = save.team.players.indexOf(q); if (i < 0) i = save.team.players.findIndex((x) => x.name === q.name); return i; };
    // 選手カード（タップで表示・もう一度タップか外側で閉じる）
    const showCard = (q) => {
      const i = idxOf(q); if (i < 0) return;
      const box = el.querySelector('.sb2-box');
      let ov = box.querySelector('.sb2-cov');
      if (!ov) { ov = document.createElement('div'); ov.className = 'sb2-cov'; box.appendChild(ov); }
      const render = (j) => {
        ov.innerHTML = playerCardHTML(j, null, false);
        bindCard(ov, j, render, () => render(j));
        ov.querySelector('.pc-close').onclick = (e) => { e.stopPropagation(); ov.remove(); };
      };
      render(i);
    };
    const draw = () => {
      if (page === 'white') return drawWhite();
      const on = onPitch(), cells = plan.cells;
      const occ = {}; for (let i = 1; i < 11; i++) if (cells[i]) occ[cells[i].r + ':' + cells[i].c] = i;
      let grid = '';
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) grid += `<i class="sb2-gc z-${C.zoneOf(r)}${occ[r + ':' + c] ? '' : ' free'}" data-r="${r}" data-c="${c}" style="left:${c * CW}px;top:${cy(r) - CH / 2}px;width:${CW}px;height:${CH}px"></i>`;
      const zl = [['FW', 8], ['MF', 4.5], ['DF', 1]].map(([z, r]) => `<b class="sb2-zl l" style="top:${cy(r) - 22}px">${z}</b><b class="sb2-zl r" style="top:${cy(r) - 22}px">${z}</b>`).join('');
      const pl = (k, x, y, zone) => { const q = ps[on[k]], isNew = plan.subs.some((t) => t.slot === k); return `<div class="sb2-p${isNew ? ' new' : ''}" data-k="${k}" style="left:${x}px;top:${y}px"><b class="sb2-tag ${ZC[zone]}">${esc(q.name)}</b><span class="sb2-face">${facePic(q, 'sb2-fci', false)}</span>${battery(stamOf(k))}</div>`; };
      let dots = pl(0, PW / 2, ROWS * CH + CH * 1.2, 'GK');
      for (let k = 1; k < 11; k++) dots += pl(k, cx(cells[k].c), cy(cells[k].r), C.zoneOf(cells[k].r));
      const onSet = new Set(on);
      const bench = ps.slice(11, 18).map((q, i) => { const j = i + 11, gone = ms.out.includes(q.name) || q.injury > 0, playing = onSet.has(j); return `<div class="sb2-b${gone || playing ? ' off' : ''}" data-j="${j}"><b class="sb2-tag ${ZC[q.position]}">${esc(q.name)}</b><span class="sb2-face">${facePic(q, 'sb2-fci', false)}</span>${playing ? '<em>出場中</em>' : gone ? `<em>${q.injury > 0 ? 'ケガ' : '交代済'}</em>` : ''}</div>`; }).join('');
      el.innerHTML = `<div class="sb2-box">
          <div class="sb2-board">
            <div class="sb2-head"><img src="${emblemURL(save.team.name, 48)}" alt=""><b>${esc(save.team.name)}</b><em>［${esc(C.formationLabel(cells))}］</em></div>
            <div class="sb2-pitch" style="width:${PW}px;height:${PH}px">${grid}<i class="sb2-pa"></i><i class="sb2-ga"></i>${zl}${dots}
              <div class="sb2-left">交代枠残り<b>${Math.max(0, left())}</b></div></div>
            <div class="sb2-bench">${bench}</div>
            <div class="sb2-slots">${'<i></i>'.repeat(7)}</div>
            <p class="sb2-tip">${left() > 0 ? '控えの選手を、代えたい選手へドラッグ' : '交代枠はもうありません'}　／　タップで選手カード</p>
          </div>
          <button class="sb2-round sb2-back sb2-img" title="もどる"><img src="icons/ui_back.png" alt="もどる"></button>
          <button class="sb2-round sb2-rot sb2-img" title="作戦ボード"><img src="icons/ui_change.png" alt="作戦ボード"></button>
        </div>`;
      el.hidden = false;
      fitBox();
      el.querySelector('.sb2-back').onclick = () => { if (info.atHalf) finish(); else { page = 'white'; draw(); } };   // ハーフタイムは戦術がロッカールームの別ボタンなので、そのまま戻る
      el.querySelector('.sb2-rot').onclick = () => { page = 'white'; draw(); };
      bindDrag();
    };
    // ドラッグ：控え→ピッチの選手で交代、ピッチの選手→空いているマスで移動（選手どうしなら入れ替え）。動かさずに離したらカード
    const bindDrag = () => {
      const box = el.querySelector('.sb2-box');
      const start = (ev, kind, id, q) => {
        if (ev.button > 0) return;
        ev.preventDefault();
        const sx = ev.clientX, sy = ev.clientY; let ghost = null, over = null;
        const toBox = (x, y) => { const r = box.getBoundingClientRect(), k = r.width / 1080; return [(x - r.left) / k, (y - r.top) / k]; };
        const targetAt = (x, y) => { const hit = document.elementsFromPoint(x, y); for (const h of hit) { if (h.classList && (h.classList.contains('sb2-p') || h.classList.contains('sb2-gc'))) return h; const pp = h.closest && h.closest('.sb2-p'); if (pp) return pp; } return null; };
        const move = (e) => {
          if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) < 8) return;
          if (!ghost) {
            if (kind === 'b' && (left() <= 0 || ev.currentTarget && false)) { /* 枠がないときは動かさない */ }
            ghost = document.createElement('div'); ghost.className = 'sb2-ghost'; ghost.innerHTML = `<b class="sb2-tag ${ZC[q.position]}">${esc(q.name)}</b>${facePic(q, 'sb2-fci', false)}`; box.appendChild(ghost);
          }
          const [x, y] = toBox(e.clientX, e.clientY); ghost.style.left = x + 'px'; ghost.style.top = y + 'px';
          const t = targetAt(e.clientX, e.clientY);
          if (over !== t) { if (over) over.classList.remove('hov'); over = t; if (over && !(kind === 'b' && !over.classList.contains('sb2-p'))) over.classList.add('hov'); }
        };
        const up = async (e) => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          if (over) over.classList.remove('hov');
          if (!ghost) { showCard(q); return; }
          ghost.remove();
          const t = targetAt(e.clientX, e.clientY);
          if (!t) return;
          if (kind === 'b') {
            if (!t.classList.contains('sb2-p') || left() <= 0) return;
            const k = +t.dataset.k, out = ps[onPitch()[k]];
            if ((k === 0) !== (q.position === 'GK')) return;
            const ok = await ask(`${esc(out.name)}に代えて<br>${esc(q.name)}を起用しますか？`);
            if (ok) { const old = plan.subs.findIndex((x) => x.slot === k); if (old >= 0) plan.subs.splice(old, 1); plan.subs.push({ slot: k, bench: id }); }
            draw(); return;
          }
          const k = id; if (k === 0) return;
          if (t.classList.contains('sb2-gc') && t.classList.contains('free')) { plan.cells[k] = { r: +t.dataset.r, c: +t.dataset.c }; draw(); return; }
          if (t.classList.contains('sb2-p')) { const k2 = +t.dataset.k; if (k2 > 0 && k2 !== k) { const tmp = plan.cells[k]; plan.cells[k] = plan.cells[k2]; plan.cells[k2] = tmp; draw(); } }
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      };
      el.querySelectorAll('.sb2-p').forEach((d) => d.onpointerdown = (ev) => { const k = +d.dataset.k; start(ev, 'p', k, ps[onPitch()[k]]); });
      el.querySelectorAll('.sb2-b').forEach((d) => d.onpointerdown = (ev) => { const j = +d.dataset.j, q = ps[j]; if (d.classList.contains('off')) { ev.preventDefault(); showCard(q); return; } start(ev, 'b', j, q); });
    };
    // 作戦ボード（カルチョビットAのホワイトボード）：攻守の意識だけ
    const drawWhite = () => {
      const opt = [['attacking', '攻撃的'], ['balanced', 'バランス'], ['defensive', '守備的']];
      el.innerHTML = `<div class="sb-room"><div class="wb">
          <div class="wb-pitch">${plan.cells.map((c, i) => { if (!i) return '<i class="wb-dot z-GK" style="left:6px;top:50%"></i>'; const z = C.zoneOf(c.r); return `<i class="wb-dot z-${z}" style="left:${30 + c.r * 40}px;top:${18 + c.c * 18}px"></i>`; }).join('')}<i class="wb-half"></i><i class="wb-circle"></i><i class="wb-box l"></i><i class="wb-box r"></i><span class="wb-dir">攻撃方向 →</span><span class="wb-vs">${esc(mt.opp || '')}戦</span></div>
          <div class="wb-side"><p class="wb-title">攻守の意識</p>${opt.map(([v, nm]) => `<button class="wb-btn${plan.att === v ? ' on' : ''}" data-v="${v}">${plan.att === v ? '<i class="wb-ball">⚽</i>' : ''}${nm}</button>`).join('')}</div>
        </div><button class="sb-round sb-back" title="試合にもどる"><i class="bk-ico" aria-hidden="true"></i></button></div>`;
      el.querySelectorAll('.wb-btn').forEach((b) => b.onclick = () => { plan.att = b.dataset.v; draw(); });
      el.querySelector('.sb-back').onclick = finish;
    };
    // 「はい／いいえ」の確認
    const ask = (html) => new Promise((res) => {
      const d = document.createElement('div'); d.className = 'sb-ask';
      d.innerHTML = `<div class="sb-askbox"><p>${html}</p><div class="sb-askbtns"><button class="primary ib ib-ok" data-v="1">は　い</button><button class="ib ib-no" data-v="0">いいえ</button></div></div>`;
      el.appendChild(d);
      d.querySelectorAll('button').forEach((b) => b.onclick = () => { d.remove(); res(b.dataset.v === '1'); });
    });
    // 戻る：変わったところだけ試合に伝えて、続きから
    const finish = () => {
      const moved = JSON.stringify(plan.cells) !== JSON.stringify(ms.cells), attCh = plan.att !== ms.att;
      if (!plan.subs.length && !moved && !attCh) { el.hidden = true; if (info.cancel) info.cancel(); return; }
      { const bb = el.querySelector('.sb2-back') || el.querySelector('.sb-back'); if (bb) bb.disabled = true; }   // 版556：ボタンが見つからずに止まって、もどれなくなっていた
      const t = base;
      const ch = { team: 0, at: info.atHalf ? null : info.t, subs: plan.subs.map((x) => ({ slot: x.slot, player: ps[x.bench] })), tac: { attitude: plan.att, press: t.press, pass_style: t.pass, attack_side: t.side, line_height: t.line, zone_width: t.width, compact: t.compact, situ: { ...t.situ } } };
      if (moved) ch.tac.cells = plan.cells.map((c) => c && { ...c });
      setTimeout(() => {
        ms.changes.push(ch);
        info.apply(ms.changes, () => {
          for (const x of plan.subs) { ms.out.push(ps[ms.on[x.slot]].name); ms.on[x.slot] = x.bench; ms.used.push(x.bench); ms.subsIn.push(ps[x.bench].name); }
          ms.cells = plan.cells; ms.att = plan.att;
          el.hidden = true;
        });
      }, 30);
    };
    draw();
  }

  // ================= サッカー協会：日程・順位 =================
  function renderAssoc() {
    const lg = save.league, st = C.standings(save);
    const table = `<table class="cr-tbl"><tr><th></th><th>チーム</th><th>試</th><th>勝</th><th>分</th><th>敗</th><th>得失</th><th>点</th></tr>${st.map((t, k) => `<tr class="${t.me ? 'me' : ''}"><td>${k + 1}</td><td>${esc(t.name)}</td><td>${t.stats.P}</td><td>${t.stats.W}</td><td>${t.stats.D}</td><td>${t.stats.L}</td><td>${t.stats.GF - t.stats.GA}</td><td><b>${t.stats.Pts}</b></td></tr>`).join('')}</table>`;
    const me = lg.teams.findIndex((t) => t.me);
    const rows = [];
    const resB = (sc) => (sc ? `<b class="${sc[0] > sc[1] ? 'w' : sc[0] < sc[1] ? 'l' : 'd'}">${sc[0]}-${sc[1]}</b>` : '―');
    lg.rounds.forEach((pairs, r) => { const pr = pairs.find(([a2, b2]) => a2 === me || b2 === me); if (!pr) return; const res = lg.results[r] && lg.results[r].find((x) => x.a === pr[0] && x.b === pr[1]); const opp = lg.teams[pr[0] === me ? pr[1] : pr[0]]; const sc = res ? (pr[0] === me ? res.s : [res.s[1], res.s[0]]) : null; rows.push({ w: lg.weeks[r], now: r === lg.round, c: `第${r + 1}節`, ha: pr[0] === me ? 'ホーム' : 'アウェイ', opp: opp.name, res: resB(sc) }); });
    const cup = save.cup;
    if (cup) {
      cup.log.forEach((g, k) => rows.push({ w: g.week || C.CUP_WEEKS[k], cup: true, c: `国内カップ ${g.label}`, ha: '', opp: g.opp, res: resB(g.s) + (g.pk ? `<small>PK${g.win ? '勝' : '負'}</small>` : '') }));
      const nf = C.nextFixture(save);
      if (nf && nf.kind === 'cup') rows.push({ w: nf.week, cup: true, c: `国内カップ ${nf.label}`, ha: nf.home ? 'ホーム' : 'アウェイ', opp: nf.opp.name, res: '―' });
    }
    if (save.post) for (const m of save.post.matches) if (m.a === save.team.name || m.b === save.team.name) { const mine = m.a === save.team.name; rows.push({ w: m.week, cup: true, c: `${m.comp} ${m.label}`, ha: '', opp: (mine ? m.b : m.a) || '未定', res: m.done ? resB(mine ? m.s : [m.s[1], m.s[0]]) : '―' }); }
    rows.sort((x, y) => x.w - y.w);
    const sched = rows.map((x) => { const k = cal(x.w); return `<tr class="${x.now ? 'now' : ''}${x.cup ? ' cupr' : ''}"><td>${esc(x.c)}</td><td>${k.m}月${k.w}週</td><td>${x.ha}</td><td>${esc(x.opp)}</td><td>${x.res}</td></tr>`; }).join('');
    const cupInfo = cup ? (cup.champion ? `国内カップ優勝：<b>${esc(cup.champion)}</b>` : (cup.waiting || []).includes(save.team.name) ? '国内カップ：<b>3回戦から登場</b>（D1・D2のチーム）' : cup.alive.includes(save.team.name) ? `国内カップ：<b>勝ち残り中</b>（残り${cup.alive.length}チーム）` : `国内カップ：敗退（残り${cup.alive.length}チーム）`) : '';
    const hist = save.history.length ? save.history.map((h) => `<p>シーズン${h.season}　${esc(h.league)}　${esc(h.msg)}</p>`).join('') : '<p>まだありません</p>';
    $('#clubLayer').innerHTML = `<div class="dpanel assoc"><h2>${esc(lg.name)}　<small>シーズン${save.season}</small></h2><div class="as-grid"><div><h4>順位表</h4>${table}<h4>これまでの戦績</h4>${hist}<button id="crReset" class="quiet">最初からやり直す</button></div><div><h4>日程</h4><p class="cupinfo">${cupInfo}</p><table class="sched">${sched}</table></div></div></div>`;
    $('#crReset').onclick = async () => {
      const ok = await modal('<h2>最初からやり直しますか？</h2><p>育てた選手・順位はすべて消えます。</p>', [{ label: 'やり直す', value: true }, { label: 'やめる', value: false, primary: true }]);
      if (ok) { save = C.newCareer(); store(); runners.length = 0; go('home'); }
    };
  }

  // ---------- モーダル ----------
  function modal(html, buttons) {
    $('#crModalBody').innerHTML = html + `<div class="cr-mbtns">${buttons.map((b, k) => `<button data-k="${k}" class="${b.primary ? 'primary ' : ''}${ibCls(b.label, !!b.primary || buttons.length === 1)}">${esc(b.label)}</button>`).join('')}</div>`;
    $('#crModal').hidden = false;
    return new Promise((res) => { $('#crModalBody').querySelectorAll('.cr-mbtns button').forEach((el) => el.onclick = () => { $('#crModal').hidden = true; res(buttons[+el.dataset.k].value); }); });
  }
  const pname = (k) => C.PNAME[k] || k;
  // 版834：新しいデザインの結果カード（覚醒の画面と同じ見た目：青い帯の見出し・白い枠・大きいボタン）。画面に合わせて縮む
  //  o.tag：見出しの上の小さい札　o.title：見出し　o.theme：'win'（金）・'lose'（灰）・''（青）　o.body：中身　o.btn：ボタン
  function resCard(o) {
    return new Promise((done) => {
      const d = document.createElement('div'); d.className = 'rc2' + (o.who ? ' who' : '');
      d.innerHTML = `${o.who ? `<img class="rc2-bg" src="${clubhouseBg()}" alt=""><img class="rc2-who${staffImg[o.who] ? ' art' : ''}" src="${staffFace(o.who)}" alt="">` : ''}<div class="rc2-box ${o.theme || ''}"><div class="rc2-hd">${o.tag ? `<span class="rc2-tag">${o.tag}</span>` : ''}<b>${o.title}</b></div><div class="rc2-body">${o.body}</div><div class="rc2-btns"><button class="rc2-ok">${esc(o.btn || 'OK')}</button></div></div>`;
      (document.getElementById('app') || document.body).appendChild(d);
      const bx = d.querySelector('.rc2-box'), fit = () => { bx.style.transform = ''; const k = Math.min(1, (d.clientWidth - 16 - (o.who ? 330 : 0)) / bx.offsetWidth, (d.clientHeight - 16) / bx.offsetHeight); bx.style.transform = `scale(${k.toFixed(3)})`; };
      fit(); requestAnimationFrame(fit); try { faceFill(); } catch (_) {}
      d.querySelector('.rc2-ok').onclick = (e) => { e.stopPropagation(); d.remove(); done(); };
    });
  }

  // ---------- 週をすすめる：練習 → 結果 → 試合 ----------
  // 1人の特訓結果カード
  function resultCard(o) {
    const p = save.team.players[o.i], spm = o.sp != null ? C.SP[o.sp] : null;
    const rows = Object.entries(o.ups).filter(([, v]) => v >= 1 || v < 0).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="pv"><span>${ico(k, 'sm')}${esc(C.PNAME[k])}</span>${gauge(o.before[k], v)}<b class="plus${v < 0 ? ' minus' : ''}">${v > 0 ? '+' : ''}${Math.round(v)}</b></div>`).join('');
    const notes = [];
    if (spm) notes.push(`<div class="spban${o.spNew ? ' new' : ''}">${o.spNew ? 'NEW！ ' : ''}スペシャルメニュー「${esc(spm.name)}」</div>`);
    if (o.learned && o.got) notes.push(`<b class="cr-learn">★ スキル「${esc(D.SKILLS[o.learned].name)}」を覚えた！</b>${o.forgot ? `（${esc(D.SKILLS[o.forgot].name)}を忘れた）` : ''}`);
    if (o.skillMiss) notes.push(`<b class="cr-miss">スキル「${esc(D.SKILLS[o.skillMiss].name)}」は覚えられなかった…（${Math.round((o.rate || C.SKILL_RATE) * 100)}%）　次は${Math.round((o.nextRate || 0) * 100)}%</b>`);
    if (o.learned && o.skipped) notes.push(`「${esc(D.SKILLS[o.learned].name)}」は覚えなかった`);
    if (o.typeTo) notes.push(`<b class="cr-type">タイプが ${esc(o.typeFrom)} → ${esc(o.typeTo)} に変わった！</b>`);
    if (o.injured) notes.push('<b class="cr-inj">ケガをしてしまった…</b>');
    return `<div class="rcard"><div class="rc-h">${portrait(p)}<div><b>${p.number} ${esc(o.name)}</b><span>${o.cards.map((c) => `<i class="mini ${CATC[C.CARDS[c].cat]}">${esc(C.CARDS[c].name)}</i>`).join('')}</span></div></div>${notes.join('')}<div class="rc-p">${rows || '<p class="hintp">―</p>'}</div></div>`;
  }
  // 版632：特訓の結果（参考画像の形）：顔・使ったカード・「特訓完了！」か「スキル習得！」・能力の成長
  function trainResult(o) {
    const p = save.team.players[o.i], spm = o.sp != null ? C.SP[o.sp] : null, camp = C.campState(save);
    const cards = o.cards.map((c) => artCard(c)).join('<i class="trr-plus">＋</i>');
    let ban;
    if (o.learned && o.got) ban = `<div class="trr-ban gold"><span class="trr-shield">${HG_ICO.sp}</span><div class="trr-bt"><b class="trr-big">スキル習得！</b><span class="trr-rib">${esc(D.SKILLS[o.learned].name)}</span>${spm ? `<small class="trr-sub">スペシャルメニュー「${esc(spm.name)}」成功${o.spNew ? '<em>NEW</em>' : ''}</small>` : ''}</div><i class="trr-sp s1"></i><i class="trr-sp s2"></i><i class="trr-sp s3"></i><i class="trr-sp s4"></i></div>`;
    else {
      const sub = o.skillMiss ? `<div class="trr-pill"><b>${esc(D.SKILLS[o.skillMiss].name)}</b><span>未習得</span></div><small class="trr-sub dk">今回はスキルを習得できませんでした（次の成功率 ${Math.round((o.nextRate || 0) * 100)}%）</small>`
        : spm ? `<small class="trr-sub">スペシャルメニュー「${esc(spm.name)}」${o.spNew ? '<em>NEW</em>' : ''}</small>` : '';
      ban = `<div class="trr-ban blue"><div class="trr-bt"><b class="trr-big">特訓完了！</b>${sub}</div></div>`;
    }
    const notes = [];
    if (o.learned && o.got && o.forgot) notes.push(`${esc(D.SKILLS[o.forgot].name)}を忘れた`);
    if (o.learned && o.skipped) notes.push(`「${esc(D.SKILLS[o.learned].name)}」は覚えなかった`);
    // 版699：タイプが変わったら大きく見せる（音つき）。タイプのメニューで変わらなかった時は「近づいた」
    const tyBan = o.typeTo ? `<div class="trr-type"><b class="trr-tyh">タイプチェンジ！</b><span class="tbadge ${TYPE_CLS[o.typeFrom] || 'ty-bal'}">${esc(o.typeFrom || '')}</span><i class="trr-tyar">▶</i><span class="tbadge big ${TYPE_CLS[o.typeTo] || 'ty-bal'}">${esc(o.typeTo)}</span></div>`
      : spm && spm.type && p.type !== spm.type ? `<p class="trr-tynear">タイプ「${esc(spm.type)}」に近づいた（もう少しで変わるかも）</p>` : '';
    if (o.injured) notes.push('<b class="inj">ケガをしてしまった…</b>');
    const ups = Object.entries(o.ups).filter(([, v]) => v >= 1 || v <= -1).sort((x, y) => y[1] - x[1]);
    const rows = ups.map(([k, v]) => { const b0 = o.before[k], a = C.rankInfo(b0), b = C.rankInfo(Math.min(C.PMAX - 1, Math.max(0, b0 + v))), up = b.g !== a.g;
      const g0 = up ? 0 : a.pct, g1 = v > 0 ? b.pct : a.pct;
      return `<div class="trr-row"><span class="trr-ic">${ico(k)}</span><span class="trr-pn">${esc(PSHORT[k] || C.PNAME[k])}</span><span class="trr-rk">${up ? `<b class="gr-${a.g}">${a.g}</b><i>→</i>` : ''}<b class="gr-${b.g}">${b.g}</b></span><span class="trr-bar"><s style="width:${(v > 0 ? g0 : g1) * 100}%"></s>${v > 0 ? `<u style="left:${g0 * 100}%;width:${Math.max(2, (g1 - g0) * 100)}%"></u>` : ''}</span><b class="trr-v${v < 0 ? ' m' : ''}">${v > 0 ? '+' : ''}${Math.round(v)}</b></div>`; }).join('');
    const cols = ups.length > 8 ? 3 : ups.length > 4 ? 2 : 1;
    let el = document.getElementById('trRes');
    if (!el) { el = document.createElement('div'); el.id = 'trRes'; (document.getElementById('app') || document.body).appendChild(el); }
    el.innerHTML = `<div class="trr-box">
      <div class="trr-h"><b>特訓の結果</b>${camp ? `<small>合宿ボーナス ×${C.CAMP.mult}</small>` : ''}</div>
      <div class="trr-top"><div class="trr-face">${facePic(p, '')}</div><div class="trr-info"><div class="trr-nm"><i class="pos ${POSC[p.position]}">${p.position}</i><b>${p.number}</b><span>${esc(p.name)}</span></div><div class="trr-cards">${cards}</div></div></div>
      ${ban}
      ${tyBan}
      ${notes.length ? `<p class="trr-notes">${notes.join('　')}</p>` : ''}
      <div class="trr-gr"><span class="trr-gl">能力の成長</span><div class="trr-rows c${cols}">${rows || '<p class="trr-none">―</p>'}</div></div>
      <button class="trr-ok">OK</button></div>`;
    const fit = () => { const bx = el.querySelector('.trr-box'); if (!bx) return; const k = Math.min((el.clientWidth || innerWidth) * 0.97 / 860, (el.clientHeight || innerHeight) * 0.97 / Math.max(580, bx.offsetHeight || 580));   /* 版675：上がった能力が多い時は箱が縦に伸びるので、その分小さくして全部見せる */ bx.style.transform = `scale(${k})`; bx.style.setProperty('--k', k); };
    el.hidden = false; fit(); addEventListener('resize', fit); requestAnimationFrame(() => el.classList.add('on'));
    try { window.DotSound && DotSound.play(o.got ? 'skill' : 'ok'); } catch (_) {}
    { const rankUp = ups.some(([k, v]) => v > 0 && C.rankInfo(Math.min(C.PMAX - 1, o.before[k] + v)).g !== C.rankInfo(o.before[k]).g);   // 版717：ランクが上がった能力がある時の音
      if (rankUp) setTimeout(() => { try { window.DotSound && DotSound.play('rankUp'); } catch (_) {} }, 380); }
    if (o.typeTo) setTimeout(() => { try { window.DotSound && DotSound.play('typeChange'); } catch (_) {} }, 1000);
    return new Promise((res) => { el.querySelector('.trr-ok').onclick = () => { removeEventListener('resize', fit); el.classList.remove('on'); el.hidden = true; res(); }; });
  }
  // 「特訓する！」：その場でこの選手だけ特訓して結果を見せる
  async function doTrain(i) {
    const o = C.trainOne(save, i, (save.plan.cards || {})[i] || []);
    if (!o) return;
    store();
    if (o.learned) {
      const p = save.team.players[i];
      if (C.learnSkill(p, o.learned)) o.got = true;
      else {
        const nm = D.SKILLS[o.learned].name;
        const pk = await modal(`<h2>${esc(p.name)}が「${esc(nm)}」を覚えようとしている！</h2><p>スキル枠（${C.slots(p)}つ）がいっぱいです。忘れるスキルを1つ選んでください。</p>`,
          [...p.skills.map((k) => ({ label: `${D.SKILLS[k].name}を忘れる`, value: k })), { label: `${nm}を覚えない`, value: null }]);
        if (pk) { C.learnSkill(p, o.learned, pk); o.got = true; o.forgot = pk; } else o.skipped = true;
      }
      store();
    }
    await trainResult(o);   // 版632：特訓の結果を専用の画面で
    // 次の未特訓の選手へ自動で移る
    const ps = save.team.players;
    for (let k = 1; k <= ps.length; k++) { const j = (i + k) % ps.length; if (!(ps[j].injury > 0) && !C.trainedThisWeek(save, ps[j])) { selIdx = j; break; } }
    renderTrain();
  }

  // ---------- 週をすすめる：全体練習（自動） → 試合 ----------
  // セットしたまま特訓していないカードがあれば確認
  async function confirmLeft(next) {
    const ps = save.team.players;
    const left = ps.filter((q, i) => !(q.injury > 0) && !C.trainedThisWeek(save, q) && ((save.plan.cards || {})[i] || []).length).length;
    if (!left) return true;
    return coachAsk(`監督、カードをセットしたまま特訓していない選手が${left}人います。<br>このまま${({ '試合に進む': '試合に進みますか？', '週をすすめる': '週をすすめますか？', '練習試合をする': '練習試合をしますか？' })[next] || next + 'ますか？'}`);
  }
  // ▶：試合の週ならスタジアムへ。試合がない週は、そのまま1週間すすむ
  async function advance() {
    const fx = C.nextFixture(save);
    const matchWeek = fx && fx.week <= save.week && !C.campState(save);
    if (matchWeek && !(await coachAsk('監督、今週は公式戦があります。<br>スタジアムに移動しますか？'))) return;
    if (!matchWeek && !(await coachAsk(`監督、週を進めますか？<br><small>練習をして、${(() => { const k = cal((save.week || 1) + 1); return `${k.m}月${k.w}週`; })()}に進みます。</small>`))) return;   // 版661：週を進める前に確認
    if (!(await confirmLeft(matchWeek ? '試合に進む' : '週をすすめる'))) return;
    if (matchWeek) { stadium(true); return; }
    await endWeek();
  }
  // コーチからの報告（ケガ）
  const WHERE = { practice: 'クラブハウスでの練習中に', match: '試合中に', train: '特訓中に' };
  async function coachNews(list) {   // 版834：ケガの知らせも、ほかの会話と同じ画面（コーチの絵＋下の帯）に
    if (!list || !list.length) return;
    await facesReady();
    const F = { name: 'コーチ', face: staffFace('coach'), art: !!staffImg.coach };
    await talkScreen(list.map((n) => ({ ...F, text: `監督！${WHERE[n.where] || ''}${n.name}がケガをしてしまいました。\n${n.kind}で、回復には${n.weeks}週間必要です。` })), `<img class="sec-bg" src="${clubhouseBg()}" alt="">`);
    await blackClear(300);
  }
  // 1週間を終える（全体練習・疲労回復・ケガの経過 → 次の週）
  // 版478：週が変わる時、画面が一瞬うす暗くなって、新しい週を見せて、また明るくなる
  function weekFx(phase, label, sub) {
    let el = document.getElementById('weekFx');
    if (!el) { el = document.createElement('div'); el.id = 'weekFx'; el.innerHTML = '<div class="wf-in"><b></b><small></small></div>'; (document.getElementById('app') || document.body).appendChild(el); }
    if (phase === 'dark') { el.querySelector('b').textContent = ''; el.querySelector('small').textContent = ''; el.className = 'wf-dark'; return new Promise((r) => setTimeout(r, 420)); }
    if (phase === 'show') { try { window.DotSound && DotSound.play('week'); } catch (_) {} el.querySelector('b').textContent = label; el.querySelector('small').textContent = sub || ''; el.className = 'wf-dark wf-show'; return new Promise((r) => setTimeout(r, sub ? 1250 : 850)); }
    el.className = 'wf-light'; return new Promise((r) => setTimeout(r, 450));
  }
  async function endWeek() {
    const sn0 = seasonOfMonth(cal(save.week || 1).m);
    await weekFx('dark');
    const res = C.endWeek(save); store();
    { const k = cal(save.week || 1), sn1 = seasonOfMonth(k.m); if (view === 'home') renderHome(); await weekFx('show', `${k.m}月 ${k.w}週`, sn1 !== sn0 ? `${SEASON_JP[sn1]}になりました` : ''); await weekFx('light'); }
    await coachNews(res.news);
    const tc = res.rep.filter((o) => o.typeTo).map((o) => `<p><b class="cr-type">${esc(o.name)}：タイプが ${esc(o.typeFrom)} → ${esc(o.typeTo)} に変わった！</b></p>`).join('');
    if (res.camp) { const cp = res.camp, summer = cp.name === '夏合宿', chips = [['特訓', `週${C.CAMP.trains}回`], ['カードの効果', `${C.CAMP.mult}倍`], ['全体練習', '充実'], ['ケガ', '注意']];   // 版805：始まりの知らせと同じ4つ
      if (res.campDone) await campCard({ name: cp.name, summer, title: `${esc(cp.name)}終了！`, weeks: cp.weeks, done: cp.weeks, msg: `${cp.weeks}週間の合宿で、全員がひとまわり成長しました。<br>${summer ? '9月から<b>リーグ後半戦</b>です！' : '3月から<b>新シーズン</b>です！'}`, extra: tc, btn: 'OK' });
      else await campCard({ name: cp.name, summer, title: `${cp.week}週目 終了`, weeks: cp.weeks, done: cp.week, chips, msg: `全体練習で、全員が少しずつ成長しました。<br>あと<b>${cp.weeks - cp.week}週</b>です。`, extra: tc, btn: 'OK' }); }
    else if (tc) await modal(`<h2>今週の練習</h2>${tc}`, [{ label: 'OK', primary: true }]);
    if (res.leagueDone) {   /* 版744：本家のように、リーグ戦が終わったら秘書が結果と来年のことを伝えて、協会の順位表（昇格・降格の色分け）を見せる */
      await facesReady();
      const pos = res.pos, id = save.league.id, nT = ((save.league && save.league.teams) || []).length || 8, lg = save.league.name, F = { name: '秘書', face: staffFace('sec'), art: !!staffImg.sec };
      const tier = (C.LG[id] || {}).tier ?? 0, byTier = (t) => (t <= 0 ? '地域2部リーグ' : t === 1 ? '地域1部リーグ' : (C.LEAGUES.find((l) => l.tier === t) || {}).name || '');
      const up = byTier(tier + 1), dn = byTier(tier - 1), z = zoneOf(id, pos - 1, nT), place = pos === 1 ? `${lg}優勝！` : `${lg}、${pos}位。`;
      const L = [{ ...F, text: z && (z[0] === 'ex' || (z[0] === 'up' && z[1] !== '昇格')) ? '監督、お疲れさまです。\nリーグ戦の全試合が終わりました。' : '監督、お疲れさまです。\nリーグの全日程が終了しました。' }];   // 版834：1月に入れ替え戦などがある時は、まだ「全日程」ではない
      if (id === 'd1' && pos === 1) L.push({ ...F, text: 'D1リーグ優勝！日本一ですね！\n来年も王者として、よろしくお願いします！' });
      else if (z && z[0] === 'up' && z[1] === '昇格') L.push({ ...F, text: `${place}\n来年は${up}ですね！更に厳しいスケジュールにはなりますが、よろしくお願いします！` });
      else if (z && z[0] === 'up') L.push({ ...F, text: `${place}\n1月の「${z[1]}」に出場します。\n勝ち抜けば、来年は${up}です！` });
      else if (z && z[0] === 'ex') L.push({ ...F, text: `${place}\n1月の「${z[1].replace(/（.*）/, '')}」で、${tier === 4 ? 'D1残留' : id === 'd3' ? 'D2昇格' : '残留'}をかけて戦います。` });
      else if (z && z[0] === 'dn') L.push({ ...F, text: `${place}\n残念ですが、来年は${dn}で戦うことになります…。\n気持ちを切り替えて、また上を目指しましょう。` });
      else L.push({ ...F, text: `${place}\n来年も${lg}で戦います。\n次こそ上を目指しましょう！` });
      if (/^reg.2$/.test(id) && pos <= 2) L.push({ ...F, text: '1月には、東西の上位チームとの親善試合もあります。' });
      L.push({ ...F, text: 'サッカー協会の順位表で、今年昇格するチーム・降格するチームを見ておきましょう。' });
      await talkScreen(L, `<img class="sec-bg" src="${clubhouseBg()}" alt="">`);
      await new Promise(async (done) => { await blackFade(250); openAssoc({ tab: 'stats', sub: { kind: 'table', id }, direct: true, onClose: async () => { await blackFade(300); done(); } }); await blackClear(300); });
    }
    if (res.seasonEnd && res.seasonEnd.post) { await facesReady(); await talkScreen([{ name: '秘書', face: staffFace('sec'), art: !!staffImg.sec, text: '監督、お疲れさまです。\n今シーズンの全日程が終了しました。' }], `<img class="sec-bg" src="${clubhouseBg()}" alt="">`); await blackClear(250); }   // 版834：入れ替え戦などが終わってから「全日程が終了」
    if (res.seasonEnd) await seasonEndCard(res.seasonEnd);   /* 版762：自分の1月の試合が全部終わった時が、シーズンの終わり */
    if (res.renovStart) await renovTalk('start', res.renovStart);
    if (res.renovDone) await renovTalk('done', res.renovDone);
    if (res.season) await venueTalk(res.season);
    if (res.season) await seasonStartCard(res.season);   /* 版762：シーズンの終わりは1月に済んでいる。3月は新シーズンの開幕 */
    if (res.season && res.season.prize && res.season.prize.total > 0) {   /* 版747：シーズンの賞金をまとめて受け取る */
      const pz = res.season.prize;
      await resCard({ tag: `シーズン${pz.season}`, title: 'シーズンの賞金', theme: 'win', body: prizeHTML(pz), btn: '受け取る' });
    }
    const cs = C.campState(save);
    if (res.campStart && cs) { const summer = cs.name === '夏合宿';
      await campCard({ name: cs.name, summer, start: true, title: summer ? '8月は夏合宿！' : '2月は春季キャンプ！', weeks: cs.weeks || C.CAMP.weeks, done: 0, chips: [['特訓', `週${cs.trains}回`], ['カードの効果', `${cs.mult}倍`], ['全体練習', '充実'], ['ケガ', '注意']], msg: `${summer ? 'リーグは中断期間に入ります。' : '新シーズンに向けた合宿です。'}<br>合宿中は公式戦がありません（練習試合はできます）。`, btn: '合宿スタート！' }); }
    store();
    if (view === 'home') renderHome(); else go(view);
  }

  $('#hmNext').onclick = advance;
  // ================= コーチの声かけ（カルチョビットAのように、コーチが出てきて はい／いいえ） =================
  // 版528：監督の作った「決定／やめる」ボタン（青＝進む・白＝もどる）。文字が「決定」「やめる」の時はその絵、ほかは同じ形の無地に文字
  const ibCls = (label, go) => { const t = String(label).replace(/\s|　/g, ''); return go ? (t === '決定' ? 'ib ib-ok ib-img' : 'ib ib-ok') : (t === 'やめる' ? 'ib ib-no ib-img' : 'ib ib-no'); };
  function coachAsk(html, buttons, who) {
    const sec = who === 'sec';
    buttons = buttons || [{ label: 'は　い', value: true }, { label: 'いいえ', value: false }];
    coachFace();
    let el = document.getElementById('coachTalk');
    if (!el) { el = document.createElement('div'); el.id = 'coachTalk'; (document.getElementById('app') || $('#career')).appendChild(el); }
    el.innerHTML = `<div class="ct-bust">${sec ? `<img class="art" src="${staffFace('sec')}" alt="秘書">` : staffImg.coach ? `<img class="art" src="${staffImg.coach}" alt="コーチ">` : `<img src="${coachURL}" alt="コーチ">`}</div><div class="ct-btns">${buttons.map((b, k) => `<button data-k="${k}" class="${ibCls(String(b.label).replace(/<[^>]*>/g, ''), b.value !== false)}">${b.label}</button>`).join('')}</div><div class="ct-box"><b class="ct-name">${sec ? '秘書' : 'コーチ'}</b><p>${html}</p></div>`;
    el.hidden = false; { const im = el.querySelector('.ct-bust img'); const go = () => requestAnimationFrame(() => el.classList.add('on')); if (im && !im.complete) { im.style.visibility = 'hidden'; const ok = () => { im.style.visibility = ''; go(); }; im.onload = ok; im.onerror = ok; } else go(); }   /* 版559：絵が読めてから出す（一瞬四角が見えないように） */
    { const bx = el.querySelector('.ct-box'), bt = el.querySelector('.ct-btns'); if (bx && bt) bt.style.bottom = (bx.offsetHeight + 30 + 6) + 'px'; }   /* 版536：本家と同じく、文の枠のすぐ上の右に */   // 版510：文が長い時も、ボタンが文の上に出る（押せるように）
    return new Promise((res) => el.querySelectorAll('.ct-btns button').forEach((b) => b.onclick = () => { el.classList.remove('on'); el.hidden = true; res(buttons[+b.dataset.k].value); }));
  }
  // ================= 試合前：入場口（LIVE）→ 対戦カード → キックオフ =================
  const STADIUM_SUF = ['スタジアム', '陸上競技場', 'フットボールパーク', '総合運動公園'];
  function stadiumName(op, meta) {
    /* 版743：会場は、リーグが上のチームのもの（同じリーグならホームのチーム。練習試合は自分の練習場） */
    const tierOf = (name) => ((C.LG[lgOf(name)] || {}).tier ?? 2), myT = C.homeTier(save);
    if (op.name === save.team.name) { const t = myT ?? tierOf(op.name); return (save.team.short || save.team.name) + (t <= 1 ? ['市民グラウンド', '運動公園'][Math.max(0, t)] : t === 4 ? 'フットボールパーク' : STADIUM_SUF[3]); }   /* 自分のホーム（改装後の名前も） */
    const opUp = tierOf(op.name) > (myT ?? -1);
    if (meta.practice && tierOf(op.name) <= tierOf(save.team.name)) return `${save.team.name}　練習場`;
    const atMe = !opUp && meta.home;
    const homeTown = atMe ? (save.team.short || save.team.name) : (op.short || op.name), sd = atMe ? 3 : (C.findTeam(save, op.name) || { seed: 1 }).seed || 1;
    const tier = venueOf(op, meta);
    if (tier <= 1) return homeTown + ['市民グラウンド', '運動公園'][tier];   // 地域リーグは小さな会場
    return homeTown + (tier === 4 ? ['スタジアム', 'フットボールパーク'][sd % 2] : STADIUM_SUF[sd % STADIUM_SUF.length]);
  }
  function rankOf(name) { const st = C.standings(save), i = st.findIndex((t) => t.name === name); return i >= 0 ? i + 1 : 0; }
  function lgOf(name) { if (name === save.team.name) return save.league.id; const t = C.findTeam(save, name); return t && t.lg ? t.lg : (Object.keys(save.world.leagues).find((id) => save.world.leagues[id].some((x) => x.name === name)) || save.league.id); }
  // 勝敗の予想（TOTO）：チームの強さの差から
  function totoOf(op, meta) {
    const me = C.teamLevel(save), ot = (C.findTeam(save, op.name) || { lvl: me }).lvl, d = (me - ot + (meta.home ? 1.5 : -1.5)) / 8;
    const pw = 1 / (1 + Math.exp(-d)), dr = 0.24 * Math.exp(-Math.abs(d) * 0.45) + 0.06, win = (1 - dr) * pw, lose = (1 - dr) * (1 - pw);
    const r = [win, dr, lose].map((v) => Math.round(v * 100)); r[1] = 100 - r[0] - r[2];
    return meta.home ? r : [r[2], r[1], r[0]];   // 上のチーム（ホーム）から
  }
  let liveRaf = 0;
  function preMatch(op, meta) {
    let el = document.getElementById('liveScr');
    if (!el) { el = document.createElement('div'); el.id = 'liveScr'; $('#career').appendChild(el); }
    el.hidden = true; el.className = 'lv2';   // 版623：絵が描けるまで出さない（前は空の画面が一瞬見えていた）
    const home = meta.home ? { name: save.team.name, me: true } : { name: op.name }, away = meta.home ? { name: op.name } : { name: save.team.name, me: true };
    const lgH = lgOf(home.name), lgA = lgOf(away.name), stad = stadiumName(op, meta);
    const title = `${esc(meta.comp)}${meta.label ? '　' + esc(meta.label) : ''}`;
    return new Promise((resolve) => {
      const showLive = () => { try { window.DotSound && (DotSound.bgm(null), DotSound.crowd('pre'), setTimeout(() => DotSound.chant && DotSound.chant(true, 0.7), 400)); } catch (_) {}   // 版730：試合前の画面から太鼓つき   // 版728：試合前（LIVE）の画面は、曲ではなくスタジアムの歓声（少し小さめ）
        const ICO = {
          lineup: '<svg viewBox="0 0 48 40"><rect x="3" y="3" width="42" height="34" rx="3" fill="none" stroke="#fff" stroke-width="3"/><line x1="3" y1="20" x2="45" y2="20" stroke="#fff" stroke-width="2.5"/><circle cx="24" cy="20" r="5" fill="none" stroke="#fff" stroke-width="2.5"/><circle cx="14" cy="11" r="2.6" fill="#fff"/><circle cx="34" cy="11" r="2.6" fill="#fff"/><circle cx="14" cy="29" r="2.6" fill="#fff"/><circle cx="34" cy="29" r="2.6" fill="#fff"/></svg>',
          tac: '<svg viewBox="0 0 48 40"><rect x="3" y="3" width="42" height="34" rx="3" fill="none" stroke="#fff" stroke-width="3"/><path d="M10 10l6 6M16 10l-6 6M32 25l6 6M38 25l-6 6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="13" cy="29" r="3.4" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="35" cy="12" r="3.4" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M17 26c5-8 9-10 14-12" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M27 12l4 2-2 4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
          kit: '<svg viewBox="0 0 48 40"><path d="M16 3l-12 7 5 9 5-3v21h20V16l5 3 5-9-12-7c-1 4-4 6-8 6s-7-2-8-6z" fill="#fff"/></svg>',
          stad: '<svg viewBox="0 0 40 24"><ellipse cx="20" cy="12" rx="17" ry="9" fill="none" stroke="currentColor" stroke-width="3.4"/><ellipse cx="20" cy="12" rx="8" ry="3.6" fill="currentColor"/><path d="M3 12v4c0 5 8 8 17 8s17-3 17-8v-4" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
          play: '<svg viewBox="0 0 24 24"><path d="M6 3l15 9-15 9z" fill="#fff"/></svg>' };
        el.className = 'lv2';
        el.innerHTML = `<canvas width="1280" height="720"></canvas>
          <div class="lv2-head"><div class="lv2-t"><b>LIVE</b><span>${esc(meta.comp)}</span>${meta.label ? `<i></i><span>${esc(meta.label)}</span>` : ''}</div>
            <div class="lv2-m"><img src="${emblemURL(home.name, 64)}" alt=""><span>${esc((C.findTeam(save, home.name) || {}).short || home.name.replace(/FC$/, ''))}</span>${lgBadge(lgH)}<em>×</em><img src="${emblemURL(away.name, 64)}" alt=""><span>${esc((C.findTeam(save, away.name) || {}).short || away.name.replace(/FC$/, ''))}</span>${lgBadge(lgA)}</div>
            <div class="lv2-s">${ICO.stad}<span>${esc(stad)}</span></div></div>
          <div class="rbtns lv-btns"><button data-a="lineup"><span>${rbLineupSVG()}</span><b>スタメン</b></button><button data-a="tac"><span>${RB_TAC_SVG}</span><b>戦術</b></button><button data-a="kit" class="lv-kit lv-kitimg" title="ユニフォーム"><img src="icons/off_kit.png" alt="ユニフォーム"></button><button data-a="ko" class="lv-ko lv-koimg" title="試合開始"><img src="icons/btn_kickoff.png" alt="試合開始"></button></div>`;
        el.hidden = false;
        try { A().applyKits(C.kitsFor(save, op.name, meta.kitSel, meta.oppSel)); } catch (_) {}   // 版482：並んでいる選手も、この試合のユニフォームで
        const cv = el.querySelector('canvas'), ctx2 = cv.getContext('2d');
        const myL = save.team.players.slice(0, 11), opT = C.opponentTeam(save, op).players.slice(0, 11);
        const rows = meta.home ? [{ ps: myL, team: 0 }, { ps: opT, team: 1 }] : [{ ps: opT, team: 1 }, { ps: myL, team: 0 }];
        cancelAnimationFrame(liveRaf);
        let tInfo = { home: home.name, away: away.name, homeCol: '#2f5fc8', awayCol: '#c8322a' };
        try { const kk = C.kitsFor(save, op.name, meta.kitSel, meta.oppSel), mine = kk[0].shirt, opc = kk[1].shirt; tInfo = { ...tInfo, homeCol: meta.home ? mine : opc, awayCol: meta.home ? opc : mine }; } catch (_) {}
        const loop = (t) => { drawTunnel2(ctx2, rows, t, tInfo); liveRaf = requestAnimationFrame(loop); };   // 版601：新しい入場通路
        try { drawTunnel2(ctx2, rows, 0, tInfo); } catch (_) {}   // 版623：最初の1枚をすぐ描く（描くまでの一瞬、暗い背景が見えていた）
        liveRaf = requestAnimationFrame(loop);
        el.querySelectorAll('button[data-a]').forEach((b) => b.onclick = () => {
          const a = b.dataset.a;
          if (a === 'lineup' || a === 'tac') { cancelAnimationFrame(liveRaf); { const sc = el.querySelector('canvas'); liveSnap = document.createElement('canvas'); liveSnap.width = 1280; liveSnap.height = 720; try { liveSnap.getContext('2d').drawImage(sc, 0, 0, 1280, 720); } catch (_) { liveSnap = null; } } el.hidden = true; sqTab = a === 'tac' ? 'tac' : 'pos'; liveBack = () => { showLive(); }; go('lineup'); return; }
          if (a === 'kit') { kitPick(el, op, meta, () => showLive()); return; }
          cancelAnimationFrame(liveRaf); showVs();
        });
        if (window.__tut) window.__tut.onLive(el, meta);   // チュートリアル：試合前の画面の説明
      };
      // 本家の流れ：暗転 → 動くスタンドに両チームの帯とTOTO → 帯がはけて入場 → サポーターの旗とコール → （試合画面で）入場とズーム → キックオフ
      const showVs = () => {
        el.className = '';
        try { const kk = C.kitsFor(save, op.name, meta.kitSel, meta.oppSel); crowdCol = meta.home ? [kk[0].shirt, kk[1].shirt] : [kk[1].shirt, kk[0].shirt]; } catch (_) {}   // 版604：観客の服（ホームのサポーターが多い）
        const tt = totoOf(op, meta);
        const sub = (nm, side, lg) => { const rk = meta.online ? 0 : rankOf(nm); return `<div class="vs-sub">${side}${lgBadge(lg)}${rk ? `<b>${rk}位</b>` : ''}</div>`; };
        el.innerHTML = `<canvas width="1280" height="720"></canvas><div class="vs2">
          <div class="vs-top">${title}</div>
          <div class="vs-row h"><div class="vs-ban"><img src="${emblemURL(home.name, 96)}" alt=""><b>${esc(home.name)}</b></div>${sub(home.name, 'HOME', lgH)}</div>
          <div class="vs-vs">VS</div>
          <div class="vs-row a"><div class="vs-ban"><img src="${emblemURL(away.name, 96)}" alt=""><b>${esc(away.name)}</b></div>${sub(away.name, 'AWAY', lgA)}</div>
          <div class="vs-toto"><h5>TOTO</h5><div><small>WIN</small><b>${tt[0]}%</b></div><div><small>DRAW</small><b>${tt[1]}%</b></div><div><small>WIN</small><b>${tt[2]}%</b></div><h5>DOT</h5></div>
          <div class="vs-bot">${esc(stad)}</div></div><div class="ko-fade"></div><button class="vs-go ui-img" title="とばす"><img src="icons/ui_next.png" alt="次へ"></button>`;
        const cv = el.querySelector('canvas'), cx3 = cv.getContext('2d'), vs = el.querySelector('.vs2'), fade = el.querySelector('.ko-fade');
        const homeRow = meta.home ? save.team.players.slice(0, 11) : C.opponentTeam(save, op).players.slice(0, 11), awayRow = meta.home ? C.opponentTeam(save, op).players.slice(0, 11) : save.team.players.slice(0, 11);
        const hT = meta.home ? 0 : 1, aT = 1 - hT;
        const steps = [[0, 'v0'], [700, 'v1'], [1100, 'v2'], [1500, 'v3'], [2000, 'v4'], [7600, 'v5'], [10400, 'v6']];
        const timers = steps.map(([ms, cls]) => setTimeout(() => vs.classList.add(cls), ms));
        let t0 = 0, done = false, holdAt = 0;
        const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); cancelAnimationFrame(liveRaf); el.hidden = true; resolve('watch'); };
        if (window.__tut) window.__tut.onVs(el, meta);   // チュートリアル：TOTOの説明（説明の間は、絵を止める）
        const loop = (now) => {
          if (!t0) t0 = now;
          if (window.__tutHold) { if (!holdAt) holdAt = now; liveRaf = requestAnimationFrame(loop); return; } if (holdAt) { t0 += now - holdAt; holdAt = 0; }
          const t = (now - t0) / 1000;
          if (t < 10.6) drawStandsPan(cx3, t, homeRow, awayRow, hT, aT);
          else drawFlagsScene(cx3, t - 10.6, home.name);
          // 暗転：はじめ・入場のあと・コールのあと
          const f = t < 0.6 ? 1 - t / 0.6 : t > 10.1 && t < 10.6 ? (t - 10.1) / 0.5 : t >= 10.6 && t < 11 ? 1 - (t - 10.6) / 0.4 : t > 15.9 ? Math.min(1, (t - 15.9) / 0.5) : 0;
          fade.style.opacity = f;
          if (t > 16.5) { finish(); return; }
          liveRaf = requestAnimationFrame(loop);
        };
        liveRaf = requestAnimationFrame(loop);
        el.querySelector('.vs-go').onclick = finish;
      };
      // 版623：通路の絵とエンブレムが読めてから出す（最大1.5秒）。待つ間も画面は暗くしない
      const imgs = [TUN.bg, tunImg(emblemURL(home.name, 128)), tunImg(emblemURL(away.name, 128))];
      const ready = () => imgs.every((im) => im.complete && im.naturalWidth);
      if (ready()) showLive(); else { const t0 = Date.now(); const w = () => (ready() || Date.now() - t0 > 1500 ? showLive() : setTimeout(w, 40)); w(); }
    });
  }
  // 入場口（カルチョビットAの画面を写したレイアウト）：実況席のガラス・奥へ続く通路・ピッチへ出る帯と手すり・カメラマン・運営スタッフ・審判・記録係の机
  // 座標は元の画面（幅892×高さ541）の位置で書いて、1280×720に写す
  const LVS = 1.331, LVX = 46;
  const LT = (x, y) => [(x - 158) * LVS + LVX, y * LVS];
  let tunnelBg = null;
  const peopleCache = new Map();
  // 服の色を塗り替えた人（スーツのスタッフ・審判・カメラマン・実況）
  function dressed(key, info, view, frame, cols) {
    const k = key + '|' + view + '|' + frame;
    if (peopleCache.has(k)) return peopleCache.get(k);
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const src = A().spriteCanvas(info, 2, view, frame, false, false);
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
    const MAP = [['#2f6fd6', cols[0]], ['#6ea2f2', cols[1]], ['#1d4796', cols[2]], ['#ffffff', cols[3]]].map(([a2, b2]) => [hex(a2), hex(b2)]);
    for (let i = 0; i < px.length; i += 4) for (const [f, t] of MAP) if (px[i] === f[0] && px[i + 1] === f[1] && px[i + 2] === f[2]) { px[i] = t[0]; px[i + 1] = t[1]; px[i + 2] = t[2]; }
    x.putImageData(d, 0, 0);
    // スーツは胸元に白いシャツとネクタイ
    if (cols[4] === 'suit') { for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) { const q = (yy * c.width + xx) * 4; } x.fillStyle = '#f2f2f2'; x.fillRect(8, 13, 2, 3); x.fillStyle = '#c03030'; x.fillRect(8, 14, 1, 2); }
    // 審判はたてじま
    if (cols[4] === 'stripe') { const im = x.getImageData(0, 0, c.width, c.height), p2 = im.data, sh = hex(cols[0]); for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) { const q = (yy * c.width + xx) * 4; if (xx % 3 === 0 && p2[q] === sh[0] && p2[q + 1] === sh[1] && p2[q + 2] === sh[2]) { p2[q] = 140; p2[q + 1] = 90; p2[q + 2] = 130; } } x.putImageData(im, 0, 0); }
    peopleCache.set(k, c); return c;
  }
  const SUIT_NAVY = ['#2c3566', '#3d4880', '#1c2244', '#252c55', 'suit'], SUIT_GRAY = ['#6c6e74', '#8a8d93', '#4e5055', '#55575c', 'suit'], SHIRT = ['#f4f4f2', '#ffffff', '#cfcfcc', '#2a2f45', ''], REF = ['#5a3450', '#74486a', '#3a2034', '#3a2a36', 'stripe'], CAMMAN = ['#f2962a', '#ffb44e', '#c26c12', '#2a3a6e', ''];
  function panelFace(c, q, cols, rows, base, line) {
    // q：[左下, 右下, 右上, 左上]
    const P = q.map(([x, y]) => LT(x, y));
    c.fillStyle = base; c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fill();
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    c.save(); c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.clip();
    c.strokeStyle = line; c.lineWidth = 2;
    for (let i = 0; i <= cols; i++) { const a = lerp(P[0], P[1], i / cols), b = lerp(P[3], P[2], i / cols); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }
    for (let j = 0; j <= rows; j++) { const a = lerp(P[0], P[3], j / rows), b = lerp(P[1], P[2], j / rows); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }
    // 光の当たるふち・ボルト
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const p0 = lerp(lerp(P[0], P[1], (i + 0.06) / cols), lerp(P[3], P[2], (i + 0.06) / cols), (j + 0.08) / rows);
      const p1 = lerp(lerp(P[0], P[1], (i + 0.94) / cols), lerp(P[3], P[2], (i + 0.94) / cols), (j + 0.08) / rows);
      c.beginPath(); c.moveTo(...p0); c.lineTo(...p1); c.stroke();
      c.fillStyle = 'rgba(60,60,60,0.45)';
      for (const [u, v] of [[0.12, 0.15], [0.88, 0.15], [0.12, 0.85], [0.88, 0.85]]) { const b = lerp(lerp(P[0], P[1], (i + u) / cols), lerp(P[3], P[2], (i + u) / cols), (j + v) / rows); c.fillRect(b[0] - 1, b[1] - 1, 2, 2); }
    }
    c.restore();
  }
  function noisePoly(c, pts, base, dark, light, n) {
    const P = pts.map(([x, y]) => LT(x, y));
    c.save(); c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fillStyle = base; c.fill(); c.clip();
    const r = seeded(n || 5); for (let k = 0; k < 2600; k++) { c.fillStyle = r() < 0.5 ? dark : light; c.fillRect(r() * 1280, r() * 720, 2, 2); }
    c.restore();
  }
  function railing(c, a, b) {
    const A2 = LT(...a), B2 = LT(...b), H = 24;
    c.strokeStyle = '#f6f09a'; c.lineWidth = 3;
    for (const h of [H, H * 0.45]) { c.beginPath(); c.moveTo(A2[0], A2[1] - h); c.lineTo(B2[0], B2[1] - h); c.stroke(); }
    c.strokeStyle = '#ffffff'; c.lineWidth = 3;
    const n = Math.round(Math.hypot(B2[0] - A2[0], B2[1] - A2[1]) / 52);
    for (let k = 0; k <= n; k++) { const x = A2[0] + (B2[0] - A2[0]) * k / n, y = A2[1] + (B2[1] - A2[1]) * k / n; c.beginPath(); c.moveTo(x, y + 2); c.lineTo(x, y - H); c.stroke(); }
    c.lineWidth = 1;
  }
  function buildTunnelBg() {
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const c = cv.getContext('2d');
    // 通路の床（青緑）
    noisePoly(c, [[100, -10], [1100, -10], [1100, 560], [100, 560]], '#2b6a84', 'rgba(0,0,0,0.08)', 'rgba(255,255,255,0.05)', 3);
    // 床：奥（右上）ほど暗く、天井の照明が床に落ちる
    { const g = c.createLinearGradient(...LT(400, 520), ...LT(1100, 40)); g.addColorStop(0, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,10,20,0.32)'); c.fillStyle = g; c.fillRect(0, 0, 1280, 720);
      for (let k = 0; k < 5; k++) { const [x, y] = LT(560 + k * 150, 300 - k * 52); const r = c.createRadialGradient(x, y, 6, x, y, 150); r.addColorStop(0, 'rgba(210,240,255,0.16)'); r.addColorStop(1, 'rgba(210,240,255,0)'); c.fillStyle = r; c.beginPath(); c.ellipse(x, y, 190, 80, -0.32, 0, 7); c.fill(); }
      // 床の目地（通路の向きにそって）
      c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 2; for (let k = -6; k < 14; k++) { c.beginPath(); c.moveTo(...LT(160 + k * 90, 600)); c.lineTo(...LT(160 + k * 90 + 520, 600 - 520 * 1.2)); c.stroke(); } }
    // 左下：茶色の地面・緑のピッチ・茶色の地面（手すりで区切られた帯）
    noisePoly(c, [[90, 170], [300, 278], [393, 310], [158, 435], [90, 472]], '#6e4a22', 'rgba(0,0,0,0.1)', 'rgba(255,255,255,0.04)', 7);
    noisePoly(c, [[90, 472], [393, 310], [594, 430], [320, 560], [90, 560]], '#2f7a2a', 'rgba(0,0,0,0.1)', 'rgba(255,255,255,0.04)', 8);
    noisePoly(c, [[320, 560], [594, 430], [800, 560]], '#6e4a22', 'rgba(0,0,0,0.1)', 'rgba(255,255,255,0.04)', 9);
    // 床と地面のさかいめ（少し暗い）
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 3; c.beginPath(); c.moveTo(...LT(300, 278)); c.lineTo(...LT(800, 560)); c.stroke(); c.lineWidth = 1;
    // 奥の壁（通路の左側・コンクリート）と、角から奥へ続く通路
    // 通路は1本道：左の壁が、そのまま奥（右上）までまっすぐ続く
    panelFace(c, [[300, 278], [1180, -17], [1180, -320], [300, -20]], 14, 6, '#c3c2bc', 'rgba(90,90,86,0.55)');
    // 実況席の建物（左上のかど）
    panelFace(c, [[90, 172], [300, 278], [300, -40], [90, -150]], 4, 7, '#cdccc6', 'rgba(90,90,86,0.55)');
    // 壁のつけ根の影
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.moveTo(...LT(300, 278)); c.lineTo(...LT(1180, -17)); c.lineTo(...LT(1180, -5)); c.lineTo(...LT(300, 290)); c.closePath(); c.fill();
    // 壁の飾り：幅木・クラブカラーの帯・バナー・照明（安っぽく見えないように、奥行きと光を足す）
    { const yb = (x) => 278 - (x - 300) * 0.33523;
      const wq = (x1, x2, h1, h2) => [[x1, yb(x1) - h1], [x2, yb(x2) - h1], [x2, yb(x2) - h2], [x1, yb(x1) - h2]].map(([x, y]) => LT(x, y));
      const fillQ = (P, col) => { c.fillStyle = col; c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fill(); };
      fillQ(wq(300, 1180, 0, 12), '#55575a');
      fillQ(wq(300, 1180, 12, 15), '#8d8f92');
      fillQ(wq(420, 1180, 22, 32), '#1f8a44'); fillQ(wq(420, 1180, 32, 36), '#f2c21c');
      const banners = [[450, '#123a2a', '#e7ff62', 'DOT SOCCER'], [620, '#f4f2ea', '#1f8a44', 'FAIR PLAY']];
      for (const [x, bg, fg, tx] of banners) {
        const P = wq(x, x + 130, 50, 112); fillQ(P, 'rgba(0,0,0,0.2)'); const Q = wq(x + 4, x + 126, 54, 108); fillQ(Q, bg);
        c.save(); const [ax, ay] = Q[3], [bx, by] = Q[2]; c.translate((Q[0][0] + Q[2][0]) / 2, (Q[0][1] + Q[2][1]) / 2); c.transform(1, (by - ay) / (bx - ax), 0, 1, 0, 0);
        c.fillStyle = fg; c.font = '900 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(tx, 0, 0); c.restore();
      }
      for (let x = 380; x < 760; x += 170) { const L = wq(x, x + 46, 140, 148); fillQ(L, '#fffbe6'); const [lx, ly] = L[0];
        const g = c.createRadialGradient(lx + 30, ly + 10, 4, lx + 30, ly + 10, 120); g.addColorStop(0, 'rgba(255,248,215,0.35)'); g.addColorStop(1, 'rgba(255,248,215,0)'); c.fillStyle = g; c.fillRect(lx - 100, ly - 110, 260, 240); }
    }
    // 実況席のガラス（かどをはさんで2面）
    const glass = (q, tone) => { const P = q.map(([x, y]) => LT(x, y)); c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fillStyle = tone; c.fill(); c.strokeStyle = '#8a8c88'; c.lineWidth = 4; c.stroke(); c.lineWidth = 1; };
    glass([[215, 182], [300, 225], [300, 140], [215, 140]], '#8fb2b8');
    glass([[300, 225], [420, 182], [420, 140], [300, 140]], '#7ea2aa');
    // 実況の2人（ガラスの向こう）
    const ann = [[{ hair: 1, hairColor: 1, skin: 0 }, SUIT_GRAY, 312, 222, false], [{ hair: 2, hairColor: 1, skin: 0 }, SUIT_NAVY, 392, 196, true]];
    for (const [info, cols, x, y, fl] of ann) {
      const img = dressed('ann' + x, info, 'f34', 0, cols), [X, Y] = LT(x, y), sc = 2.5, S = A().SPR;
      c.save(); const G = [[215, 182], [300, 225], [420, 182], [420, 140], [215, 140]].map(([gx, gy]) => LT(gx, gy)); c.beginPath(); G.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.clip();
      c.imageSmoothingEnabled = false; c.translate(X, 0); if (fl) c.scale(-1, 1); c.globalAlpha = 0.85; c.drawImage(img, -S.W * sc / 2, Y - (S.H - 2) * sc, S.W * sc, S.H * sc); c.restore();
    }
    // ガラスの映りこみ
    c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.moveTo(...LT(230, 142)); c.lineTo(...LT(262, 142)); c.lineTo(...LT(240, 190)); c.lineTo(...LT(222, 186)); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(...LT(360, 142)); c.lineTo(...LT(386, 142)); c.lineTo(...LT(372, 190)); c.lineTo(...LT(350, 197)); c.closePath(); c.fill();
    // 手すり（ピッチの両側）
    railing(c, [158, 435], [383, 316]);
    railing(c, [323, 540], [586, 434]);
    tunnelBg = cv;
  }
  function drawTunnel(c, rows, t) {
    if (!tunnelBg) buildTunnelBg();
    c.drawImage(tunnelBg, 0, 0);
    const S = A().SPR, sc = 2.5, objs = [];
    const put = (img, x, y, flip, extra) => { const [X, Y] = LT(x, y); objs.push({ y: Y, f: () => { c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(X, Y, 9 * sc, 3 * sc, 0, 0, 7); c.fill(); c.save(); c.imageSmoothingEnabled = false; c.translate(X, 0); if (flip) c.scale(-1, 1); c.drawImage(img, -S.W * sc / 2, Y - (S.H - 2) * sc, S.W * sc, S.H * sc); c.restore(); if (extra) extra(X, Y); } }); };
    const bob = (k) => (Math.floor(t / 460 + k * 0.63) % 2 ? 1 : 0);
    // 2列に並んだ両チーム（ホームが壁側）。先頭はGK、ピッチ（左下）を向いている
    // 2列はまっすぐ・等間隔に。となりの列とは横並び
    const ROW1 = Array.from({ length: 11 }, (_, k) => [494 + 44 * k, 322 - 22 * k]);
    const ROW2 = ROW1.map(([x, y]) => [x + 62, y + 38]);
    [ROW1, ROW2].forEach((pos, ri) => { const row = rows[ri]; const gkI = row.ps.findIndex((p) => p.position === 'GK'); const order = [gkI >= 0 ? gkI : 0, ...row.ps.map((_, i) => i).filter((i) => i !== (gkI >= 0 ? gkI : 0))];
      order.slice(0, 11).forEach((pi, k) => { const p = row.ps[pi]; put(A().spriteCanvas(p, row.team, 'f34', bob(k + ri), false, k === 0), pos[k][0], pos[k][1], true); }); });
    // 審判3人（列の先頭・ピッチの入口）
    [[403, 365], [433, 412], [513, 425]].forEach(([x, y], k) => put(dressed('ref' + k, { hair: k % 3, hairColor: 0, skin: k % 2 }, 'f34', bob(k + 5), REF), x, y, true));
    // 運営スタッフ（スーツ・白シャツ）
    const STAFF = [[420, 262, SUIT_NAVY, 0, false], [470, 236, SUIT_GRAY, 1, true], [560, 212, SHIRT, 2, true], [760, 150, SHIRT, 3, true], [905, 300, SUIT_NAVY, 1, true], [800, 342, SHIRT, 0, false], [890, 392, SHIRT, 2, true]];
    STAFF.forEach(([x, y, cols, h, fl], k) => put(dressed('st' + k, { hair: h, hairColor: k % 2 ? 1 : 0, skin: 0 }, k === 5 ? 'b34' : 'f34', 0, cols), x, y, fl));
    // 記録係の机（黄土色の長机と書類）
    const TB = [[723, 367], [760, 353], [883, 413], [847, 430]].map(([x, y]) => LT(x, y));
    objs.push({ y: LT(800, 395)[1], f: () => {
      c.fillStyle = '#7a7a7a'; for (const [x, y] of [TB[0], TB[1], TB[2], TB[3]]) c.fillRect(x - 2, y, 4, 26);
      c.fillStyle = '#9a8628'; c.beginPath(); c.moveTo(TB[3][0], TB[3][1]); c.lineTo(TB[2][0], TB[2][1]); c.lineTo(TB[2][0], TB[2][1] + 7); c.lineTo(TB[3][0], TB[3][1] + 7); c.closePath(); c.fill();
      c.fillStyle = '#c9ad3c'; c.beginPath(); TB.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fill();
      c.fillStyle = '#f4f4f0'; for (const [x, y] of [[795, 388], [818, 400]]) { const [X, Y] = LT(x, y); c.beginPath(); c.moveTo(X - 9, Y); c.lineTo(X, Y - 5); c.lineTo(X + 10, Y); c.lineTo(X + 1, Y + 5); c.closePath(); c.fill(); }
    } });
    // カメラマン（手すりの外から選手を撮る。ときどきフラッシュ）
    const CAM = [[195, 400, false], [223, 360, false], [295, 365, false], [318, 300, false], [368, 335, false], [520, 515, true], [585, 470, true], [640, 505, true], [700, 478, true], [740, 522, true]];
    CAM.forEach(([x, y, back], k) => put(dressed('cam' + k, { hair: k % 4, hairColor: (k * 3) % 5, skin: k % 3 }, back ? 'b34' : 'f34', 0, CAMMAN), x, y, back, (X, Y) => {
      const dir = back ? -1 : 1, cx2 = X + dir * 8, cy2 = Y - 44;
      c.fillStyle = '#2a2a2a'; c.fillRect(cx2 - 7, cy2 - 5, 16, 11); c.fillStyle = '#4a4a4a'; c.fillRect(cx2 + dir * 8 - 3, cy2 - 3, 7, 7); c.fillStyle = '#888'; c.fillRect(cx2 - 4, cy2 - 8, 6, 3);
      if ((Math.floor(t / 210) + k * 5) % 26 === 0) { c.fillStyle = 'rgba(255,255,255,0.95)'; c.beginPath(); c.arc(cx2 + dir * 14, cy2, 15, 0, 7); c.fill(); }
    }));
    objs.sort((a, b) => a.y - b.y).forEach((o) => o.f());
  }
  // ---------- 版601：試合前の入場通路（絵の背景＋旗＋並んだ両チーム） ----------
  const TUN = { bg: null, emb: new Map() };
  TUN.bg = new Image(); TUN.bg.src = 'img/tunnel.jpg';   // 版623：はじめから読んでおく（入った瞬間に真っ暗にならないように）
  const REF_BLACK = ['#1e1f24', '#34363d', '#0d0e11', '#1a1a1e', ''];
  function tunImg(src) { let im = TUN.emb.get(src); if (!im) { im = new Image(); im.src = src; TUN.emb.set(src, im); } return im; }
  const tunOk = (im) => im && im.complete && im.naturalWidth > 0;
  // 壁の旗：チームの色の布にエンブレム（平行四辺形にゆがめて壁に貼る）
  const tunFlagCache = new Map();
  function tunFlag(name, color) {
    const key = name + '|' + color, emb = tunImg(emblemURL(name, 128)), ready = tunOk(emb);
    let f = tunFlagCache.get(key); if (f && f.ok) return f.cv; if (f && !ready) return f.cv;
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 240; const x = cv.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, 160, 240);
    const g = x.createLinearGradient(0, 0, 160, 0); g.addColorStop(0, 'rgba(255,255,255,.14)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.22)'); x.fillStyle = g; x.fillRect(0, 0, 160, 240);
    x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 5; x.strokeRect(9, 9, 142, 222);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.moveTo(20, 236); x.lineTo(150, 150); x.lineTo(150, 168); x.lineTo(46, 236); x.closePath(); x.fill();
    if (ready) { x.fillStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.arc(80, 92, 58, 0, 7); x.fill(); x.drawImage(emb, 30, 42, 100, 100); }
    tunFlagCache.set(key, { cv, ok: ready }); return cv;
  }
  function tunPutFlag(c, cv, TL, TR, BL) {
    c.save(); c.setTransform((TR[0] - TL[0]) / cv.width, (TR[1] - TL[1]) / cv.width, (BL[0] - TL[0]) / cv.height, (BL[1] - TL[1]) / cv.height, TL[0], TL[1]);
    c.drawImage(cv, 0, 0); c.restore();
    c.save(); c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.moveTo(TR[0], TR[1]); c.lineTo(TR[0] + 5, TR[1] + 3); c.lineTo(TR[0] + 5 + BL[0] - TL[0], TR[1] + 3 + BL[1] - TL[1]); c.lineTo(TR[0] + BL[0] - TL[0], TR[1] + BL[1] - TL[1]); c.closePath(); c.fill(); c.restore();
  }
  function drawTunnel2(c, rows, t, info) {
    if (!TUN.bg) TUN.bg = tunImg('img/tunnel.jpg');
    if (tunOk(TUN.bg)) c.drawImage(TUN.bg, 0, 0, 1280, 720); else { c.fillStyle = '#8f96a3'; c.fillRect(0, 0, 1280, 720); }
    // 壁の旗：左の壁にホーム、奥の壁にアウェー
    try { tunPutFlag(c, tunFlag(info.home, info.homeCol), [74, 388], [196, 356], [74, 612]); tunPutFlag(c, tunFlag(info.away, info.awayCol), [612, 150], [688, 112], [612, 268]); } catch (_) {}
    const objs = [];
    const scaleAt = (y) => 3.0 + Math.max(0, Math.min(1, (y - 250) / 470)) * 2.1;
    const put = (img, X, Y, flip, after) => { objs.push({ y: Y, f: () => { const s = scaleAt(Y), w = img.width * s, h = img.height * s;
      c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(X, Y - s, 8 * s * 0.7, 2.6 * s * 0.7, 0, 0, 7); c.fill();
      c.save(); c.imageSmoothingEnabled = false; c.translate(X, 0); if (flip) c.scale(-1, 1); c.drawImage(img, -w / 2, Y - h, w, h); c.restore(); if (after) after(X, Y, s); } }); };
    const bob = (k) => (Math.floor(t / 460 + k * 0.63) % 2 ? 1 : 0);
    // 2列（左＝壁側がホーム）。先頭はGK、出口（右上）へ向かって並ぶ。奥ほど間がつまる
    const line = (x0, y0) => { const out = []; let x = x0, y = y0, d = 64; for (let k = 0; k < 11; k++) { out.push([x, y]); x -= d * 0.78; y += d * 0.63; d *= 1.045; } return out; };
    const ROWS = [line(892, 306), line(1030, 356)];
    ROWS.forEach((pos, ri) => { const row = rows[ri]; const gkI = Math.max(0, row.ps.findIndex((p) => p.position === 'GK')); const order = [gkI, ...row.ps.map((_, i) => i).filter((i) => i !== gkI)];
      order.slice(0, 11).forEach((pi, k) => { const p = row.ps[pi], [X, Y] = pos[k];
        put(A().spriteCanvas(p, row.team, 'b34', 0, false, k === 0), X, Y, false); }); });
    // 審判3人（列の先頭・出口の前）
    [[942, 254], [990, 250], [1046, 262]].forEach(([x, y], k) => put(dressed('refB' + k, { hair: k % 3, hairColor: 0, skin: k % 2 }, 'b34', 0, REF_BLACK), x, y, false));
    // 運営スタッフ（壁ぎわに立つ）
    [[748, 274, SUIT_NAVY, 1], [388, 500, SUIT_NAVY, 2]].forEach(([x, y, cols, h], k) => put(dressed('tst' + k, { hair: h, hairColor: 0, skin: 0 }, 'f34', 0, cols), x, y, true));
    objs.sort((a, b) => a.y - b.y).forEach((o) => o.f());
  }
  // ---------- 対戦カード〜入場の背景：屋根つきの大きなスタンド（カメラがゆっくり横へ・下へ動く） ----------
  let standPano = null, standTier = -1, venueNow = 4;
  const standPanos = {};
  function buildStandPano() {
    if (standPanos[venueNow]) { standPano = standPanos[venueNow]; standTier = venueNow; return; }
    const W = 2600, H = 1180, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'), r = seeded(21);
    if (venueNow <= 1) {   // 地域リーグ：空と木立、土手（地域1部は小さなスタンド）、金網の向こうのグラウンド
      const bot = 840;
      const sky = c.createLinearGradient(0, 0, 0, 640); sky.addColorStop(0, '#5fb3ff'); sky.addColorStop(1, '#cdebff'); c.fillStyle = sky; c.fillRect(0, 0, W, 660);
      c.fillStyle = '#fff'; for (let k = 0; k < 9; k++) { const x = r() * W, y = 60 + r() * 300; for (let j = 0; j < 4; j++) { c.beginPath(); c.ellipse(x + j * 46, y + (j % 2) * 10, 60, 30, 0, 0, 7); c.fill(); } }
      for (let x = -40; x < W + 60; x += 46) { const h = 120 + r() * 90; c.fillStyle = ['#2f6b2a', '#3a7d31', '#2a5f26'][Math.floor(r() * 3)]; c.beginPath(); c.ellipse(x, 640 - h * 0.35, 48, h * 0.55, 0, 0, 7); c.fill(); }
      c.fillStyle = '#5d9a33'; c.fillRect(0, 610, W, bot - 610);   // 土手
      c.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 620; y < bot; y += 14) c.fillRect(0, y, W, 3);
      if (venueNow === 1) {   // 小さな仮設スタンド
        const sx0 = 520, sx1 = 1500, st = 650;
        c.fillStyle = '#8c8f96'; c.fillRect(sx0 - 10, st - 20, sx1 - sx0 + 20, bot - st + 20);
        for (let y = st; y < bot - 10; y += 15) { c.fillStyle = ((y - st) / 15) % 2 ? '#3d5a8c' : '#35507e'; c.fillRect(sx0, y, sx1 - sx0, 13); }
        for (let y = st + 6; y < bot - 16; y += 15) for (let x = sx0 + 4; x < sx1 - 8; x += 9) { if (r() < 0.62) continue; c.fillStyle = ['#e8e2d2', '#3a5ad0', '#d94a3a', '#2a2a2a', '#f2c21c', '#3aa84a'][Math.floor(r() * 6)]; c.fillRect(x, y + 2, 6, 7); c.fillStyle = ['#f2c99c', '#d9a46e', '#9a6a44'][Math.floor(r() * 3)]; c.fillRect(x + 1, y - 3, 4, 4); }
      } else for (let k = 0; k < 40; k++) { const x = 100 + r() * (W - 200), y = 700 + r() * 120; c.fillStyle = ['#e8e2d2', '#3a5ad0', '#d94a3a', '#2a2a2a', '#f2c21c'][Math.floor(r() * 5)]; c.fillRect(x, y, 7, 9); c.fillStyle = '#f2c99c'; c.fillRect(x + 1, y - 5, 5, 5); }   // 土手で見ている人
      // 金網と、クラブハウスの入り口
      c.fillStyle = '#b7a888'; c.fillRect(0, bot, W, 128);   // 土の通路
      for (let k = 0; k * 160 < W; k++) { c.fillStyle = venueNow === 1 ? (k % 2 ? '#4c9f26' : '#55a72c') : '#5b9a2e'; c.fillRect(k * 160, bot + 128, 160, H - bot - 128); }
      c.fillStyle = '#fff'; c.fillRect(0, bot + 150, W, 4);
      c.strokeStyle = 'rgba(220,225,225,0.7)'; c.lineWidth = 2; for (let x = 0; x < W; x += 14) { c.beginPath(); c.moveTo(x, bot - 40); c.lineTo(x + 14, bot + 4); c.moveTo(x + 14, bot - 40); c.lineTo(x, bot + 4); c.stroke(); }
      c.fillStyle = '#8f969a'; for (let x = 0; x < W; x += 180) c.fillRect(x, bot - 46, 6, 52); c.fillRect(0, bot - 46, W, 4);
      { const gx0 = 760, gx1 = 880, gy0 = 772, gyB = bot + 82; c.fillStyle = '#c9b48a'; c.fillRect(gx0 - 40, gy0 - 60, gx1 - gx0 + 80, gyB - gy0 + 60); c.fillStyle = '#a2471e'; c.fillRect(gx0 - 50, gy0 - 76, gx1 - gx0 + 100, 22); c.fillStyle = '#3a2a1a'; c.fillRect(gx0, gy0, gx1 - gx0, gyB - gy0); c.fillStyle = '#1a8a3a'; c.fillRect(gx0 + 6, gy0 - 40, gx1 - gx0 - 12, 24); c.fillStyle = '#fff'; c.font = '900 15px sans-serif'; c.textAlign = 'center'; c.fillText('PLAYERS', (gx0 + gx1) / 2, gy0 - 22); }
      standPano = cv; standPanos[venueNow] = cv; standTier = venueNow; return;
    }
    // 屋根（鉄骨）
    c.fillStyle = '#d7d9de'; c.fillRect(0, 0, W, 210);
    c.fillStyle = '#b9bcc4'; for (let x = 0; x < W; x += 180) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 90, 210); c.lineTo(x + 110, 210); c.lineTo(x + 20, 0); c.fill(); }
    c.fillStyle = '#9da1aa'; c.fillRect(0, 196, W, 22); c.fillStyle = '#6f737c'; c.fillRect(0, 214, W, 8);
    // スタンド（段ごとに少し暗く・赤い座席）
    const top = 222, bot = 840;
    for (let y = top; y < bot; y += 15) { c.fillStyle = ((y - top) / 15) % 2 ? '#5a2a2c' : '#4c2224'; c.fillRect(0, y, W, 15); }
    // 観客（小さな人がぎっしり）
    for (let y = top + 6; y < bot - 6; y += 15) for (let x = 0; x < W; x += 9) {
      if (r() < [0.93, 0.72, 0.42, 0.16, 0.08][venueNow]) continue;   // 会場が小さいほど、空いている席が多い
      const col = ['#e8e2d2', '#3a5ad0', '#d94a3a', '#2a2a2a', '#f2c21c', '#3aa84a', '#8a6ad0', '#f2f2f2', '#c8204a'][Math.floor(r() * 9)];
      c.fillStyle = col; c.fillRect(x + r() * 2, y + 2, 6, 7); c.fillStyle = ['#f2c99c', '#d9a46e', '#9a6a44'][Math.floor(r() * 3)]; c.fillRect(x + 1, y - 3, 4, 4);
    }
    // 通路（階段）と、段の間の通路
    for (let x = 140; x < W; x += 420) { c.fillStyle = '#9a9ca2'; c.beginPath(); c.moveTo(x, top); c.lineTo(x + 34, top); c.lineTo(x + 60, bot); c.lineTo(x + 10, bot); c.closePath(); c.fill(); c.fillStyle = 'rgba(0,0,0,0.15)'; for (let y = top; y < bot; y += 15) c.fillRect(x + (y - top) * 0.04, y, 46, 2); }
    c.fillStyle = '#8c8f96'; c.fillRect(0, 520, W, 26); c.fillStyle = '#6e7178'; c.fillRect(0, 544, W, 6);
    for (let x = 300; x < W; x += 520) { c.fillStyle = '#5a5d63'; c.fillRect(x, 470, 70, 50); c.fillStyle = '#2a2c30'; c.fillRect(x + 8, 480, 54, 40); }
    // スタンドの前の壁と看板
    c.fillStyle = '#7f828a'; c.fillRect(0, bot, W, 40);
    const ads = [['DOT SOCCER', '#ffffff', '#1a8a3a'], ['はじまり商店', '#f2c21c', '#1a1a1a'], ['GOAL!!', '#c8202a', '#ffffff'], ['ドット牛乳', '#ffffff', '#2a5ad0'], ['SHOOT', '#1a1a1a', '#f2c21c']];
    for (let k = 0; k * 260 < W; k++) { const [tx, bg, fg] = ads[k % ads.length]; c.fillStyle = bg; c.fillRect(k * 260 + 6, bot + 44, 248, 34); c.fillStyle = fg; c.font = '900 20px sans-serif'; c.textAlign = 'center'; c.fillText(tx, k * 260 + 130, bot + 68); }
    // 陸上トラックとピッチ
    c.fillStyle = '#b8562a'; c.fillRect(0, bot + 82, W, 46); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2; for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(0, bot + 82 + k * 11.5); c.lineTo(W, bot + 82 + k * 11.5); c.stroke(); }
    for (let k = 0; k * 160 < W; k++) { c.fillStyle = k % 2 ? '#3fae38' : '#48ba40'; c.fillRect(k * 160, bot + 128, 160, H - bot - 128); }
    c.fillStyle = '#fff'; c.fillRect(0, bot + 150, W, 4);
    // 選手の入場ゲート（スタンド下の壁をくりぬいた通路）
    { const gx0 = 760, gx1 = 880, gy0 = 772, gyB = bot + 82;
      c.fillStyle = '#6e7178'; c.fillRect(gx0 - 16, gy0 - 14, gx1 - gx0 + 32, gyB - gy0 + 14);
      c.fillStyle = '#9a9da4'; c.fillRect(gx0 - 12, gy0 - 10, gx1 - gx0 + 24, 10); c.fillRect(gx0 - 12, gy0, 10, gyB - gy0); c.fillRect(gx1 + 2, gy0, 10, gyB - gy0);
      const g = c.createLinearGradient(0, gy0, 0, gyB); g.addColorStop(0, '#050506'); g.addColorStop(0.55, '#14151a'); g.addColorStop(1, '#34363e');
      c.fillStyle = g; c.fillRect(gx0, gy0, gx1 - gx0, gyB - gy0);
      c.fillStyle = 'rgba(255,240,190,0.18)'; c.fillRect(gx0 + 34, gy0 + 18, gx1 - gx0 - 68, 26);
      c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 2; for (let k = 1; k < 5; k++) { const y = gy0 + 44 + k * k * 4.5; c.beginPath(); c.moveTo(gx0, y); c.lineTo(gx1, y); c.stroke(); }
      c.fillStyle = '#1a8a3a'; c.fillRect(gx0 + 6, gy0 - 40, gx1 - gx0 - 12, 24); c.fillStyle = '#fff'; c.font = '900 15px sans-serif'; c.textAlign = 'center'; c.fillText('PLAYERS', (gx0 + gx1) / 2, gy0 - 22);
      // 足もとの黄色と黒の縁取り
      for (let x = gx0 - 12; x < gx1 + 12; x += 12) { c.fillStyle = ((x - gx0) / 12) % 2 ? '#1a1a1a' : '#f2c21c'; c.fillRect(x, gyB - 4, 12, 4); }
    }
    standPano = cv; standPanos[venueNow] = cv; standTier = venueNow;
  }
  // 版603：会場の絵（リーグごと）。side＝入場口のある横から、goal＝ゴール裏から
  const VEN = {};
  function venImg(kind) { const k = kind + '_' + Math.max(0, Math.min(4, venueNow ?? 4)); if (!VEN[k]) { const im = new Image(); im.src = `img/venue/${k}.jpg`; VEN[k] = im; } return VEN[k]; }
  const VEN_DOOR = [[134, 277, 335, 445], [129, 268, 349, 445], [134, 273, 373, 478], [139, 263, 407, 493], [153, 268, 440, 524]];   // 入場口（絵の1600×900の座標：左・右・上・下）
  const VEN_S = 0.9, VEN_PAN = 1600 * VEN_S - 1280;   // 絵を少し大きくして、横にゆっくり流す
  // 版604：観客のドット絵（席の位置は img/venue/crowd.json。リーグが上がるほど埋まる）
  const CROWD_OCC = [0.6, 0.3, 0.5, 0.72, 0.9];   // 地域2部は立ち見（数はもともと少ない）
  let crowdPos = null, crowdLoading = false, crowdCol = ['#2f5fc8', '#c8322a'];
  const crowdCache = {};
  function loadCrowd() { if (crowdPos || crowdLoading) return; crowdLoading = true; fetch('img/venue/crowd.json').then((r) => r.json()).then((j) => { crowdPos = j; }).catch(() => { crowdLoading = false; }); }
  function venCrowd(kind) {
    const tier = Math.max(0, Math.min(4, venueNow ?? 4)), key = kind + '_' + tier, im = venImg(kind);
    loadCrowd();
    if (!(im.complete && im.naturalWidth)) return null;
    if (!crowdPos) return [im, im];
    const ck = key + '|' + crowdCol.join(',');
    if (crowdCache[ck]) return crowdCache[ck];
    const pos = crowdPos[key] || [], r = seeded(77 + tier * 13 + (kind === 'goal' ? 5 : 0)), occ = CROWD_OCC[tier];
    const SKIN = ['#f2c99c', '#e8b384', '#d9a46e', '#b9824e', '#8a5a34'], HAIR = ['#1e1a18', '#2a2420', '#4a3426', '#6a4a2a', '#9a9a9a', '#c88a3a'], WEAR = ['#f2f2f0', '#2a2a2e', '#e8e2d2', '#3a8a4a', '#f2c21c', '#7a4a9a', '#d96a2a', '#5a6a7a'];
    const people = [];
    for (const q of pos) { if (r() > occ) continue; const fan = r(); people.push({ x: q[0], y: q[1], p: q[2], st: q[3] === 1, skin: SKIN[Math.floor(r() * 5)], hair: HAIR[Math.floor(r() * 6)], wear: fan < 0.5 ? crowdCol[kind === 'goal' ? 0 : (r() < 0.6 ? 0 : 1)] : WEAR[Math.floor(r() * WEAR.length)], jump: r() < 0.5, arms: r() < 0.25 }); }
    const frames = [0, 1].map((f) => {
      const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 900; const x = cv.getContext('2d');
      x.drawImage(im, 0, 0, 1600, 900);
      for (const h of people) {
        const p = h.st ? h.p : h.p * 1.3, up = f && h.jump ? Math.max(1, Math.round(p * 0.12)) : 0, R = (v) => Math.round(v);
        if (h.st) {   // 立ち見：足から上まで
          const hh = R(p * 0.38), bw = R(p * 0.5), by = h.y - R(p * 0.95) - up;
          x.fillStyle = '#2a2f45'; x.fillRect(R(h.x - bw * 0.4), by + hh + R(p * 0.38), R(bw * 0.8), R(p * 0.2) + up);
          x.fillStyle = h.wear; x.fillRect(R(h.x - bw / 2), by + hh, bw, R(p * 0.4));
          x.fillStyle = h.skin; x.fillRect(R(h.x - bw / 2) - R(p * 0.1), by + hh + R(p * 0.04) - (f && h.arms ? R(p * 0.3) : 0), R(p * 0.1), R(p * 0.3)); x.fillRect(R(h.x + bw / 2), by + hh + R(p * 0.04) - (f && h.arms ? R(p * 0.3) : 0), R(p * 0.1), R(p * 0.3));
          x.fillStyle = h.skin; x.fillRect(R(h.x - hh / 2), by, hh, hh); x.fillStyle = h.hair; x.fillRect(R(h.x - hh / 2), by, hh, R(hh * 0.4));
          continue;
        }
        const hh = R(p * 0.42), bw = R(p * 0.7), top = h.y - R(p * 0.32) - up;
        x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(R(h.x - bw / 2), h.y + R(p * 0.48), bw, R(p * 0.08));
        x.fillStyle = h.wear; x.fillRect(R(h.x - bw / 2), top + hh - 1, bw, R(p * 0.82) - hh + 2 + up);
        if (f && h.arms) { x.fillRect(R(h.x - bw / 2) - R(p * 0.12), top - R(p * 0.2), R(p * 0.14), R(p * 0.5)); x.fillRect(R(h.x + bw / 2) - R(p * 0.02), top - R(p * 0.2), R(p * 0.14), R(p * 0.5)); }
        x.fillStyle = h.skin; x.fillRect(R(h.x - hh / 2), top, hh, hh);
        x.fillStyle = h.hair; x.fillRect(R(h.x - hh / 2), top, hh, Math.max(1, R(hh * 0.38)));
      }
      return cv;
    });
    crowdCache[ck] = frames; return frames;
  }
  function drawStandsPan(c, t, homeRow, awayRow, hT, aT) {
    const im = venImg('side'), tier = Math.max(0, Math.min(4, venueNow ?? 4));
    // カメラ：右から左へゆっくり流れて、入場口が見えてくる
    const u = Math.min(1, t / 9.5), camX = VEN_PAN * (1 - u * u * (3 - 2 * u)) , camY = (900 * VEN_S - 720) / 2;
    { const fr = venCrowd('side'); if (fr) c.drawImage(fr[Math.floor(t * 2.6) % 2], -camX, -camY, 1600 * VEN_S, 900 * VEN_S); else { c.fillStyle = '#3fa83a'; c.fillRect(0, 0, 1280, 720); } }
    const [dl, dr, dtp, db] = VEN_DOOR[tier].map((v) => v * VEN_S), DX = (dl + dr) / 2 - camX, DB = db - camY, DT = dtp - camY;
    // 入場：入場口から2列で出てきて、ピッチの手前右へななめに走っていく
    if (t > 4.6) {
      const S = A().SPR, d = (t - 4.6) * 120, list = [], doorH = DB - DT, L1 = 40;
      [[homeRow, hT, 0], [awayRow, aT, 1]].forEach(([row, team, li]) => row.forEach((p, k) => {
        const sd = d - k * 58; if (sd < 0) return;
        const off = li ? 16 : -16;
        let x, y, view;
        if (sd < L1) { x = DX + off; y = DB - 12 + sd * 0.6; view = 'front'; }
        else { const e = sd - L1, m = Math.min(1, e / 90), side = li ? 1 : -1;   // 2列：進む向きに対して横に並ぶ（アウェーが手前）
          x = DX + off * (1 - m) + e * 0.9 - side * 0.44 * 34 * m; y = DB - 12 + L1 * 0.6 + e * 0.44 + side * 0.9 * 34 * m; view = e < 24 ? 'front' : 'f34'; }
        list.push({ p, team, k, x, y, inside: sd < L1 * 0.5, view });
      }));
      // 版663：入場口の中にいる選手だけ入場口の形で切る（外に出た選手の頭が切れないように）
      list.sort((a2, b2) => a2.y - b2.y).forEach(({ p, team, k, x, y, inside, view }) => {
        c.save(); if (inside) { c.beginPath(); c.rect(DX - (dr - dl) / 2 + 4, DT, dr - dl - 8, doorH); c.rect(-50, DB - 4, 1400, 900); c.clip(); }
        const sc = (doorH * 0.78) / S.H * (1 + Math.max(0, y - DB) / 260);
        const img = A().spriteCanvas(p, team, view, Math.floor(t * 10 + k) % 4, true, k === 0);
        c.imageSmoothingEnabled = false;
        if (!inside) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x, y, 7 * sc, 2 * sc, 0, 0, 7); c.fill(); }
        if (inside) c.filter = 'brightness(0.55)';
        c.drawImage(img, x - S.W * sc / 2, y - (S.H - 2) * sc, S.W * sc, S.H * sc);
        c.filter = 'none'; c.restore();
      });
    }
  }
  // サポーター席：エンブレムの白い旗がたくさん振られ、チーム名のコール
  let flagBg = null, flagTier = -1;
  function buildFlagBg() {
    const W = 1600, H = 720, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'), r = seeded(33);
    c.fillStyle = '#9da1aa'; c.fillRect(0, 0, W, 40);
    for (let y = 40; y < 470; y += 26) { c.fillStyle = ((y - 40) / 26) % 2 ? '#5a2a2c' : '#4c2224'; c.fillRect(0, y, W, 26); }
    for (let y = 48; y < 466; y += 26) for (let x = 0; x < W; x += 15) { if (r() < [0.86, 0.66, 0.4, 0.18, 0.08][venueNow ?? 4]) continue;   /* 版469：会場が小さいほど空席が多い */ c.fillStyle = ['#e8e2d2', '#3a5ad0', '#d94a3a', '#2a2a2a', '#f2c21c', '#f2f2f2', '#2a5ad0'][Math.floor(r() * 7)]; c.fillRect(x, y + 4, 11, 12); c.fillStyle = ['#f2c99c', '#d9a46e', '#9a6a44'][Math.floor(r() * 3)]; c.fillRect(x + 2, y - 4, 8, 8); c.fillStyle = '#3a2a1a'; c.fillRect(x + 2, y - 5, 8, 3); }
    c.fillStyle = '#8c8f96'; c.fillRect(0, 470, W, 36);
    const ads = [['DOT SOCCER', '#ffffff', '#1a8a3a'], ['はじまり商店', '#f2c21c', '#1a1a1a'], ['GOAL!!', '#c8202a', '#ffffff'], ['ドット牛乳', '#ffffff', '#2a5ad0'], ['SHOOT', '#1a1a1a', '#f2c21c'], ['カルチョ堂', '#2a8a3a', '#ffffff']];
    for (let k = 0; k * 220 < W; k++) { const [tx, bg, fg] = ads[k % ads.length]; c.fillStyle = bg; c.fillRect(k * 220 + 4, 508, 212, 44); c.fillStyle = fg; c.font = '900 24px sans-serif'; c.textAlign = 'center'; c.fillText(tx, k * 220 + 110, 539); }
    for (let k = 0; k * 140 < W; k++) { c.fillStyle = k % 2 ? '#3fae38' : '#48ba40'; c.beginPath(); c.moveTo(k * 140, 552); c.lineTo(k * 140 + 140, 552); c.lineTo(k * 140 + 100, H); c.lineTo(k * 140 - 40, H); c.closePath(); c.fill(); }
    c.strokeStyle = '#fff'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 600); c.lineTo(W, 600); c.stroke(); c.beginPath(); c.moveTo(860, 600); c.lineTo(790, H); c.stroke();
    // ゴール（ピッチ側から見た正面。奥にネット、手前に白い枠）
    const gx0 = 1010, gx1 = 1250, gy = 600, gh = 84, bk = 16;
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(gx0 + 6, gy - gh - bk + 4, gx1 - gx0 - 12, gh + 2);
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.5;
    for (let x = gx0 + 6; x <= gx1 - 6; x += 10) { c.beginPath(); c.moveTo(x, gy - gh - bk + 4); c.lineTo(x, gy - bk + 6); c.stroke(); }
    for (let y = gy - gh - bk + 4; y <= gy - bk + 6; y += 10) { c.beginPath(); c.moveTo(gx0 + 6, y); c.lineTo(gx1 - 6, y); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    for (let k = 0; k <= 4; k++) { const u = k / 4; c.beginPath(); c.moveTo(gx0, gy - gh * u); c.lineTo(gx0 + 6, gy - bk + 6 - (gh + 2) * u); c.stroke(); c.beginPath(); c.moveTo(gx1, gy - gh * u); c.lineTo(gx1 - 6, gy - bk + 6 - (gh + 2) * u); c.stroke(); }
    for (let x = gx0; x <= gx1; x += 20) { c.beginPath(); c.moveTo(x, gy - gh); c.lineTo(gx0 + 6 + (x - gx0) * (gx1 - gx0 - 12) / (gx1 - gx0), gy - gh - bk + 4); c.stroke(); }
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(gx0 - 4, gy - 2, gx1 - gx0 + 8, 6);
    c.fillStyle = '#9a9ca6'; c.fillRect(gx0 - 3, gy - gh - 3, 9, gh + 3); c.fillRect(gx1 - 6, gy - gh - 3, 9, gh + 3); c.fillRect(gx0 - 3, gy - gh - 3, gx1 - gx0 + 6, 9);
    c.fillStyle = '#ffffff'; c.fillRect(gx0 - 3, gy - gh - 3, 6, gh + 1); c.fillRect(gx1 - 6, gy - gh - 3, 6, gh + 1); c.fillRect(gx0 - 3, gy - gh - 3, gx1 - gx0 + 6, 6);
    // ゴールエリアとペナルティエリアの線
    c.strokeStyle = '#fff'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(960, gy); c.lineTo(935, 660); c.lineTo(1335, 660); c.lineTo(1300, gy); c.stroke();
    flagBg = cv; flagTier = venueNow;
  }
  const VEN_STAND = [531, 493, 469, 497, 536];   // ゴール裏の絵：観客席（フェンス）の下の高さ
  function drawFlagsScene(c, t, teamName) {
    const im = venImg('goal'), tier = Math.max(0, Math.min(4, venueNow ?? 4));
    const camX = Math.min(VEN_PAN, 20 + t * 34), camY = (900 * VEN_S - 720) / 2;
    { const fr = venCrowd('goal'); if (fr) c.drawImage(fr[Math.floor(t * 3.2) % 2], -camX, -camY, 1600 * VEN_S, 900 * VEN_S); else { c.fillStyle = '#3fa83a'; c.fillRect(0, 0, 1280, 720); } }
    const baseY = VEN_STAND[tier] * VEN_S - camY;
    const emb = embImgFor(teamName);
    const N = [0, 0, 8, 11, 14][tier] ?? 14, FK = [1, 7, 3, 11, 5, 9, 0, 13, 2, 12, 4, 10, 6, 8];   /* 版469：地域リーグは旗も少ない */
    for (let k0 = 0; k0 < N; k0++) { const k = FK[k0];
      const bx = 80 + k * 98 - camX + (k % 2) * 30, by = baseY - 6 - (k % 3) * 34;
      const ang = Math.sin(t * 3.4 + k * 1.7) * 0.75 - 0.15, L = 170;
      const px = bx + Math.sin(ang) * L, py = by - Math.cos(ang) * L;
      c.strokeStyle = '#d0d2d6'; c.lineWidth = 4; c.beginPath(); c.moveTo(bx, by); c.lineTo(px, py); c.stroke();
      // 布（波打つ白い旗にエンブレム）
      const W2 = 96, H2 = 70, dir = Math.cos(ang) >= 0 ? 1 : -1;
      c.fillStyle = '#e9ebef'; c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i <= 8; i++) { const u = i / 8; c.lineTo(px + u * W2 * dir, py + Math.sin(t * 9 + u * 5 + k) * 9 * u); }
      for (let i = 8; i >= 0; i--) { const u = i / 8; c.lineTo(px + u * W2 * dir, py + H2 + Math.sin(t * 9 + u * 5 + k) * 9 * u); }
      c.closePath(); c.fill(); c.stroke();
      if (emb.complete) c.drawImage(emb, px + dir * W2 * 0.5 - 24, py + H2 / 2 - 24 + Math.sin(t * 9 + 2.5 + k) * 4, 48, 48);
    }
    // チーム名のコール（黄色い札が場所を変えて浮かぶ）
    const slot = Math.floor(t / 1.2), pos = [[0.25, 0.32], [0.62, 0.45], [0.38, 0.28], [0.7, 0.3], [0.5, 0.55]][slot % 5];
    c.font = '900 30px "Hiragino Kaku Gothic ProN",sans-serif'; c.textAlign = 'center';
    const w = c.measureText(teamName).width + 44;
    const x = Math.max(w / 2 + 12, Math.min(1268 - w / 2, 1280 * pos[0])), y = 720 * pos[1] - Math.abs(Math.sin(t * 6)) * 6;   // 札が画面からはみ出さないように
    c.fillStyle = '#ffe23a'; c.strokeStyle = '#1a1a1a'; c.lineWidth = 3; roundRect(c, x - w / 2, y - 26, w, 48, 12); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(x - 10, y + 22); c.lineTo(x, y + 36); c.lineTo(x + 10, y + 22); c.fill();
    c.fillStyle = '#1a1a1a'; c.fillText(teamName, x, y + 9);
  }
  const embImgs = new Map();
  function embImgFor(name) { if (!embImgs.has(name)) { const im = new Image(); im.src = emblemURL(name, 96); embImgs.set(name, im); } return embImgs.get(name); }
  // 試合を行う（観る／結果だけ）→ done(score, events, played)
  // ハーフタイムの「途中経過」：同じ節のほかの試合（前半の点数）と、暫定の順位
  function halfOthers(my, minute) {
    const lg = save.league, pk = C.peekRound ? C.peekRound(save) : null;
    if (!lg || !pk || C.nextFixture(save)?.kind !== 'league') return null;
    const nm = (i) => lg.teams[i].short || lg.teams[i].name;
    const atMin = minute == null ? 45 : minute;   // その時間までに入った点（ハーフタイムは前半の分）
    for (const g of pk) if (!g.me) g.half = g.mins ? g.mins.map((l) => l.filter((m) => m <= atMin).length) : g.half;
    const games = pk.filter((g) => !g.me).map((g) => ({ home: nm(g.a), away: nm(g.b), s: g.half, homeFull: lg.teams[g.a].name, awayFull: lg.teams[g.b].name }));
    // 暫定順位：今の勝ち点に、前半の点数で終わったとした分を足す
    const tb = lg.teams.map((t, i) => ({ name: t.name, me: t.me, Pts: t.stats.Pts, GF: t.stats.GF, GA: t.stats.GA, i }));
    for (const g of pk) if (g.me && my) g.half = lg.teams[g.a].me ? [my[0], my[1]] : [my[1], my[0]];
    for (const g of pk) if (g.half) { const [x, y] = g.half, A = tb[g.a], B = tb[g.b]; A.GF += x; A.GA += y; B.GF += y; B.GA += x; if (x > y) A.Pts += 3; else if (x < y) B.Pts += 3; else { A.Pts++; B.Pts++; } }
    tb.sort((x, y) => y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF);
    return { league: lg.name, round: lg.round + 1, games, table: tb };
  }
  // 会場の格：ホームのチームのリーグ（0＝地域2部 … 4＝D1）。リーグが上のチームの会場で行う（練習試合も）
  function venueOf(op, meta) {
    meta = meta || {};
    const tierOf = (name) => ((C.LG[lgOf(name)] || {}).tier ?? 2);
    /* 版743：練習試合も、相手のリーグが上なら相手の会場で（前は練習試合だけ、いつも自分の練習場だった） */
    if (meta.practice && tierOf(op.name) <= tierOf(save.team.name)) return Math.min(1, tierOf(save.team.name));
    const myT = C.homeTier(save);   /* 版745：改装工事中（null）は相手の会場で。改装後は新しいスタジアムの格 */
    return myT == null ? tierOf(op.name) : Math.max(myT, tierOf(op.name));   // 版658：会場は、リーグが上のチームのスタジアムに合わせる（カップ戦など）
  }
  // 試合のユニフォームを選ぶ（カルチョビットAの、ホーム・アウェー・キーパーが並ぶ画面）
  function kitPick(el, op, meta, back) {
    const cl = C.ensureClub(save), cur = meta.kitSel || 'auto', curO = meta.oppSel || 'auto', ps = save.team.players, ok = C.oppKits(save, op.name), opPs = C.opponentTeam(save, op).players;
    const now = C.kitsFor(save, op.name, cur, curO);
    const same = (a, b) => a.shirt === b.shirt && a.pat === b.pat;
    const onMine = (k) => same(now[0], k === 'home' ? cl.kit : cl.kit2), onOpp = (k) => same(now[1], ok[k]);
    const card = (side, k, label, on) => `<button class="kp-c${on ? ' on' : ''}" data-side="${side}" data-k="${k}"><b>${label}</b><div class="kp-cv" data-kit="${side}-${k}"></div></button>`;
    let ov = el.querySelector('.kp'); if (!ov) { ov = document.createElement('div'); ov.className = 'kp'; el.appendChild(ov); }
    ov.innerHTML = `<div class="kp-in kp2"><h3>この試合のユニフォーム</h3><div class="kp-teams">
        <div class="kp-team"><div class="kp-tn"><img src="${emblemURL(save.team.name, 32)}" alt="">${esc(save.team.name)}</div><div class="kp-row">${card('me', 'home', 'ホーム', onMine('home'))}${card('me', 'away', 'アウェー', onMine('away'))}</div></div>
        <div class="kp-team"><div class="kp-tn"><img src="${emblemURL(op.name, 32)}" alt="">${esc(op.name)}</div><div class="kp-row">${card('op', 'home', 'ホーム', onOpp('home'))}${card('op', 'away', 'アウェー', onOpp('away'))}</div></div></div>
      <p class="kp-note">${cur === 'auto' && curO === 'auto' ? 'おまかせ：色がかぶらないように選びます' : '色がかぶって見にくい時は、どちらかをアウェーに'}</p><div class="kp-btns"><button data-auto="1" class="${cur === 'auto' && curO === 'auto' ? 'on' : ''}">おまかせ</button><button class="kp-ok primary">決定</button></div></div>`;
    const draw1 = (key, kit, pl) => { const host = ov.querySelector(`[data-kit="${key}"]`); for (const [view, p] of [['front', pl[9]], ['f34', pl[5]]]) { const cv = A().kitSprite(kit, p || {}, view); if (cv) { const c2 = document.createElement('canvas'); c2.width = cv.width * 4; c2.height = cv.height * 4; const x = c2.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(cv, 0, 0, c2.width, c2.height); host.appendChild(c2); } } };
    draw1('me-home', cl.kit, ps); draw1('me-away', cl.kit2, ps); draw1('op-home', ok.home, opPs); draw1('op-away', ok.away, opPs);
    const apply = () => { try { A().applyKits(C.kitsFor(save, op.name, meta.kitSel, meta.oppSel)); } catch (_) {} };
    ov.querySelectorAll('[data-side]').forEach((b) => b.onclick = () => { if (b.dataset.side === 'me') { meta.kitSel = b.dataset.k; if (!meta.oppSel || meta.oppSel === 'auto') meta.oppSel = onOpp('away') ? 'away' : 'home'; } else { meta.oppSel = b.dataset.k; if (!meta.kitSel || meta.kitSel === 'auto') meta.kitSel = onMine('away') ? 'away' : 'home'; } apply(); kitPick(el, op, meta, back); });
    ov.querySelector('[data-auto]').onclick = () => { meta.kitSel = 'auto'; meta.oppSel = 'auto'; apply(); kitPick(el, op, meta, back); };
    ov.querySelector('.kp-ok').onclick = () => { ov.remove(); apply(); back(); };
  }
  // 版804：試合前（スタジアム）で変えたスタメン・戦術は、その試合だけ。試合が終わったら、クラブハウスで決めた形に戻す
  function lineupKeep() { save.lineupKeep = { order: save.team.players.map((q) => q.name), tac: JSON.parse(JSON.stringify(C.ensureTactics(save))) }; }
  function lineupRestore(played) {
    const k = save.lineupKeep; if (!k) return played; save.lineupKeep = null;
    const names = (played || []).map((i) => (save.team.players[i] || {}).name);
    const pos = new Map(k.order.map((n, i) => [n, i]));
    save.team.players.sort((a, b) => (pos.has(a.name) ? pos.get(a.name) : 999) - (pos.has(b.name) ? pos.get(b.name) : 999));
    if (k.tac) save.tactics = k.tac;
    const alive = new Set(save.team.players.map((q) => q.name));
    for (const r in (save.tactics.roles || {})) if (save.tactics.roles[r] && !alive.has(save.tactics.roles[r])) save.tactics.roles[r] = null;
    return names.map((n) => save.team.players.findIndex((q) => q.name === n)).filter((i) => i >= 0);
  }
  async function runMatch(title, sub, opTeamInfo, done, meta) {
    venueNow = venueOf(opTeamInfo, meta); try { venImg('side'); venImg('goal'); loadCrowd(); } catch (_) {}   // 版603：会場の絵を先に読む
    if (!(meta && meta.skipPre)) lineupKeep();
    const how = meta && meta.skipPre ? 'watch' : await preMatch(opTeamInfo, meta || { comp: title, label: '', home: true });
    const mt = C.matchTeam(save), opp = C.opponentTeam(save, opTeamInfo), seed = 1 + Math.floor(Math.random() * 999999);
    if (how === 'watch') {
      cancelAnimationFrame(raf);
      const ms = { subsIn: [] }, subsIn = ms.subsIn;
      mt.opp = opTeamInfo.short;
      A().startWith(mt.team, opp, seed, save.team.short, opTeamInfo.short, (score) => {
        const played = mt.played.slice();
        for (const nm of subsIn) { const i = save.team.players.findIndex((q) => q.name === nm); if (i >= 0 && !played.includes(i)) played.push(i); }
        done(score, (A().match || {}).events || [], lineupRestore(played));
      }, { venue: venueNow, kits: C.kitsFor(save, opTeamInfo.name, (meta || {}).kitSel, (meta || {}).oppSel), tut: window.__tut ? window.__tut.matchOpts(meta || {}) : null, onSub: (info) => subSheet(mt, info, ms), noIntro: true, comp: (meta || {}).comp || title, label: (meta || {}).label || '', absent: save.team.players.filter((q) => q.injury > 0 || q.suspend > 0).map((q) => ({ name: q.name, pos: q.position, number: q.number, weeks: q.injury, why: q.suspend > 0 ? '出場停止' : `ケガ（あと${q.injury}週）` })), homeName: save.team.name, awayName: opTeamInfo.name, champCheck: (meta || {}).fx ? (sc) => champView((meta || {}).fx, sc) : null, halfOthers: ((meta || {}).practice || (meta || {}).online) ? null : (my, minute) => halfOthers(my, minute), oneHalf: !!((meta || {}).practice && !(meta || {}).tut), embH: emblemURL(save.team.name, 48), embA: emblemURL(opTeamInfo.name, 48), grade: (q, k, tm) => { const sp = tm ? null : save.team.players.find((x) => x.name === q.name); if (sp) { C.ensurePts(sp); return C.rankInfo(sp.pts[k]).g; } { const op = tm ? (opp.players || []).find((x) => x.name === q.name && x.bg) : null; if (op && op.bg[k]) return op.bg[k]; } return C.rankInfo(C.toPts((q.params || q)[k])).g; } });
      return;
    }
    const r = D.simulateMatch(mt.team, opp, seed, { frames: false });
    const goals = r.events.filter((e) => e.type === 'goal').map((e) => `${Math.ceil((e.t * r.clockScale) / 60)}分 ${esc(e.player)}`).join('　') || '得点なし';
    await modal(`<h2>試合結果</h2><p class="cr-score">${esc(save.team.short)} ${r.score[0]} − ${r.score[1]} ${esc(opTeamInfo.short)}</p><p>${goals}</p>`, [{ label: 'OK', primary: true }]);
    done(r.score.slice(), r.events, lineupRestore(mt.played.slice()));
  }
  async function stadium(afterTrain) {
    const fx = C.nextFixture(save);
    const official = fx && fx.week <= save.week && !C.campState(save);
    if (!official && h2Renov()) {   /* 版756：改装工事中は、スタジアムに入れない（公式戦は相手の会場で行うので、そのまま進める） */
      const k = cal(save.renov.open);
      await coachAsk(`スタジアムは<b>改装工事中</b>なので、中に入れません。<br><small>${k.m}月${k.w}週から、新しいスタジアムが使えます。</small>`, [{ label: 'OK', value: true }]);
      return;
    }
    if (!official) {
      // 公式戦のない週：練習試合（カードを少しかせげる）
      const fk = fx ? cal(fx.week) : null;
      const info = fx ? `次の公式戦は <b>${fk.m}月${fk.w}週</b>（あと${fx.weeksLeft}週）です。` : '今シーズンの公式戦は終わりました。';
      const op = await practiceBoard(info);
      if (!op || !(await confirmLeft('練習試合をする'))) return;
      runMatch('練習試合', `${esc((C.LG[op.lg] || {}).name || '')}の${esc(op.name)}と練習試合`, op, (score, ev, played) => { const got = C.playPractice(save, score, played, op.name); afterRound(got, { practice: true }); }, { comp: '練習試合', label: '', home: true, practice: true });
      return;
    }
    if (!afterTrain) { advance(); return; }
    runMatch('試合の日！', `${esc(fx.comp)}　${esc(fx.label)}（${fx.home ? 'ホーム' : 'アウェイ'}）`, fx.opp, (score, ev, played) => officialDone(fx, score, ev, played), { comp: fx.comp, label: fx.label, home: !!fx.home, fx });
  }
  // 練習試合申し込み（カルチョビットAの黒板）：相手を選ぶ
  const LG_BADGE = { regE2: ['東2', 'b-e2'], regW2: ['西2', 'b-w2'], regE1: ['東1', 'b-e1'], regW1: ['西1', 'b-w1'], d3: ['D3', 'b-d3'], d2: ['D2', 'b-d2'], d1: ['D1', 'b-d1'] };
  function practiceBoard(info) {
    const list = C.practiceOptions(save);
    const slots = [...list, ...Array(Math.max(0, 8 - list.length)).fill(null)].slice(0, 8);
    let el = document.getElementById('pbModal');
    if (!el) { el = document.createElement('div'); el.id = 'pbModal'; el.className = 'modal pb-wrap'; $('#career').appendChild(el); }
    return new Promise((res) => {
      el.innerHTML = `<div class="pb-board"><button class="sb-round pb-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button>
        <h2>練習試合申し込み</h2>
        <div class="pb-grid">${slots.map((t, k) => t ? `<button class="pb-slot" data-k="${k}"><span class="pb-top"><i class="lgb ${LG_BADGE[t.lg][1]}">${LG_BADGE[t.lg][0]}</i>${t.rank ? `${t.rank}位` : ''}${t.strong ? '<em>格上</em>' : ''}</span><b>${esc(t.name)}</b></button>` : '<div class="pb-slot empty"><span class="pb-top"></span><b></b></div>').join('')}</div>
        <p class="pb-info">${info}　練習試合をすると、今週はそれで終わりです。</p></div>`;
      el.hidden = false;
      const close = (v) => { el.hidden = true; res(v); };
      el.querySelector('.pb-back').onclick = () => close(null);
      el.querySelectorAll('.pb-slot[data-k]').forEach((b) => b.onclick = async () => {
        const t = slots[+b.dataset.k];
        el.hidden = true;
        const ok = await coachAsk(`監督、${esc(t.name)}（${esc((C.LG[t.lg] || {}).name || '')}）と<br>練習試合をしますか？`);
        if (ok) res({ ...C.findTeam(save, t.name), lg: t.lg }); else { el.hidden = false; }
      });
    });
  }
  // 公式戦の結果を記録して、試合のあとの流れへ（ロッカールームの会話 → 順位表／トーナメント表 → 秘書 → ホーム）
  function officialDone(fx, score, ev, played) {
    const before = save.league ? C.standings(save).map((t) => t.name) : null;
    const injBefore = new Set(save.team.players.filter((q) => q.injury > 0).map((q) => q.name));
    const champ = C.champPeek(save, fx, score);   // 版580：この試合で優勝が決まったか（記録する前に調べる）
    const res = C.playFixture(save, fx, score, played);
    if (!champ && res.champion) Object.assign(res, { champNow: { kind: 'cup', title: '国内カップ', n: (save.history || []).filter((h) => h.cup).length + 1 } });   // PK戦で優勝
    if (champ) res.champNow = champ;
    if (res.champNow) { (save.trophies = save.trophies || []).push({ season: save.season, kind: res.champNow.kind, title: res.champNow.title }); }
    C.recordStats(save, ev, played);
    C.recordGoals(save, fx, ev);
    const got = C.rewardCards(save, score, ev, (A().match || {}).stats, fx.opp && fx.opp.name, played);
    if (res.coins) { save.coins = (save.coins || 0) + res.coins; got.coins = (got.coins || 0) + res.coins; }
    const off = C.afterOfficial(save, ev, score, res, played, fx.kind);
    const newInj = save.team.players.filter((q) => q.injury > 0 && !injBefore.has(q.name));
    afterRound(got, res, { fx, score, ev, off, newInj, before });
  }
  async function afterRound(got, res, info) {
    res = res || {};
    if (info) {
      await postLocker(got, res, info);
      store(); open();
      await postComp(res, info);
      store(); open();
      if (res.champNow) { await champAfter(res.champNow); store(); open(); }   // 版580：優勝のあと（選手のひとこと → トロフィー → 秘書）
      await blackClear(350);   // 版561：順位表のあとの暗転を明ける（前は秘書の画面が明けていたが、支持率をなくしたので真っ暗のまま止まっていた）
      await endWeek();
      return;
    }
    if (res.kind === 'cup' || res.kind === 'post') {
      const pk = res.pk ? '（PK戦）' : '';
      const head = res.champion ? `🏆 ${esc(res.comp)} 優勝！！` : res.win === true ? `${esc(res.comp)} ${esc(res.label)} 勝利${pk}！` : res.win === false ? `${esc(res.comp)} ${esc(res.label)} 敗退${pk}…` : `${esc(res.comp)} ${esc(res.label)}`;
      store(); open();
      await storyCard({ theme: res.win === true || res.champion ? 'win' : res.win === false ? 'lose' : '', tag: esc(res.comp), title: res.champion ? '優勝！！' : res.win === true ? `${esc(res.label)} 勝利${pk}！` : res.win === false ? `${esc(res.label)} 敗退${pk}…` : esc(res.label),
        body: `${res.prize ? `<div class="gc-prize"><b>賞金</b><em>${DCOIN}+${res.prize} Dコイン</em></div><p class="cp-msg gc-msg">賞金は、シーズンが終わった時にまとめて受け取れます。</p>` : `<p class="cp-msg">${res.win === false ? '次こそ勝ちましょう。' : 'おめでとうございます！'}</p>`}` });   // 版791：カップ戦の結果も、カードの見た目に
    }
    if (got && got.length) {
      store(); open();
      // 版791：カード獲得も、ほかの知らせ（合宿・シーズン）と同じカードの見た目に
      await storyCard({ theme: 'gcard', tag: 'トレーニングカード', title: `${got.length}枚 獲得！`, body: `${got.coins ? `<p class="cp-msg gc-coin">${COIN}+${got.coins} コイン</p>` : ''}<div class="gc-cards${got.length > 8 ? ' lots' : got.length > 4 ? ' many' : ''}">${got.map((c) => artCard(c, { ups: true })).join('')}</div><p class="cp-msg gc-msg">クラブハウスの「特訓」で、選手に最大3枚セットできます。</p>` });
    }
    store(); open();
    await endWeek();
  }

  // ---------- 試合のあと：ロッカールームで、コーチ・選手が話す ----------
  const STAFF = { coach: { name: 'コーチ', number: 0, hair: 2, hairColor: 0, skin: 2, position: 'MF' }, sec: { name: '秘書', number: 0, hair: 7, hairColor: 2, skin: 0, position: 'MF' } };
  const faceOf = (p) => { try { return faceURL(p) || ''; } catch (e) { return ''; } };
  const facesReady = () => { faceLoad(); return new Promise((ok) => { const t0 = Date.now(); const chk = () => ((faceTotal && faceLoaded >= faceTotal) || Date.now() - t0 > 4000 ? ok() : setTimeout(chk, 60)); chk(); }); };
  async function postLocker(got, res, info) {
    await facesReady();
    const [a, b] = info.score, w = a > b, d = a === b;
    const lines = [];
    let t1 = w ? `監督、${a}−${b}で勝利です！` : d ? `監督、${a}−${b}の引き分けでした。` : `監督、${a}−${b}で負けてしまいました…。`;
    if (res.champion || res.champNow) t1 = `監督、優勝です！！\n${a}−${b}、本当におめでとうございます！`;
    else if (res.kind === 'cup' || res.kind === 'post') t1 += res.win ? `\n${res.label}突破です！` : '\nここで敗退です…。';
    const iss = (info.ev || []).some((e) => e.type === 'issue' && e.team === 0);
    const t2 = w ? 'この調子でいきましょう！' : d ? '次は勝ち点3をとりにいきましょう。' : '切りかえて、次の試合に向けて練習しましょう。';
    lines.push({ name: 'コーチ', face: staffFace('coach'), art: !!staffImg.coach, text: `${t1}\n${t2}` });
    if (got && got.length) lines.push({ name: 'コーチ', face: staffFace('coach'), art: !!staffImg.coach, text: `トレーニングカードを${got.length}枚手に入れました。${got.gapN > 0 ? '\n格上との試合だったので、多めにもらえましたね。' : ''}${got.coins ? `（コイン+${got.coins}）` : ''}`, cards: got.map((c) => ({ id: c, name: C.CARDS[c] ? C.CARDS[c].name : c })) });
    if ((info.off.condUp || []).length) { const L = info.off.condUp; lines.push({ name: 'コーチ', face: staffFace('coach'), art: !!staffImg.coach, text: `勝ったので、試合に出た選手の調子が上がりました！\n${L.slice(0, 5).join('・')}${L.length > 5 ? ` ほか${L.length - 5}人` : ''}` }); }   // 版515
    for (const nm of info.off.reds) { const p = save.team.players.find((q) => q.name === nm); if (p) lines.push({ name: p.name, face: faceOf(p), text: '今日のレッドカードで\n次の公式戦は出場停止になってしまいました。\n監督、すみませんでした…。' }); }
    // 試合中のケガ：ここで本人が報告する（週の終わりのコーチの報告では、もう言わない）
    const told = new Set();
    for (const p of info.newInj) {
      const n = (save.news || []).find((x) => x.name === p.name && x.where === 'match');
      lines.push({ name: p.name, face: faceOf(p), text: `ケガをしてしまいました…。\n${n ? `${n.kind}で、` : ''}全治${p.injury}週だそうです。監督、すみません。` });
      told.add(p.name);
    }
    if (told.size) save.news = (save.news || []).filter((x) => !(x.where === 'match' && told.has(x.name)));
    return new Promise((res2) => A().lockerTalk(lines, res2));
  }
  // ---------- 試合後の全画面（1280×720 を画面に合わせて拡大縮小）：順位表・秘書 ----------
  function fullScreen(id, cls) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div'); el.id = id; el.className = 'lk-wrap ' + cls; el.hidden = true;
      el.innerHTML = '<div class="lk-box"></div>';
      (document.getElementById('app') || document.body).appendChild(el);
      const fit = () => { const bx = el.querySelector('.lk-box');
        if (id === 'assocScreen' && (document.documentElement.classList.contains('short') || document.documentElement.classList.contains('phone'))) { bx.style.width = (el.clientWidth || innerWidth) + 'px'; bx.style.height = (el.clientHeight || innerHeight) + 'px'; bx.style.transform = 'translate(-50%,-50%)'; return; }   // 版486：スマホでは協会の画面を縮めずに、画面の大きさのまま作る（文字が大きくなる）
        bx.style.width = ''; bx.style.height = '';
        const A = document.getElementById('app'); const k = Math.min((el.clientWidth || (A && A.clientWidth) || innerWidth) / 1280, (el.clientHeight || (A && A.clientHeight) || innerHeight) / 720); bx.style.transform = `translate(-50%,-50%) scale(${k.toFixed(4)})`; };
      addEventListener('resize', fit); el._fit = fit;
    }
    return el;
  }
  // 画面の切り替え：黒へ暗転 → 中身を入れかえ → 明ける
  const blackFade = (ms) => new Promise((ok) => {
    let f = document.getElementById('blkFade');
    if (!f) { f = document.createElement('div'); f.id = 'blkFade'; (document.getElementById('app') || document.body).appendChild(f); }
    f.style.transition = `opacity ${ms}ms`; f.style.display = 'block'; requestAnimationFrame(() => { f.style.opacity = '1'; setTimeout(ok, ms + 20); });
  });
  // 版561：念のため、真っ暗のまま6秒以上たったら明ける（画面が黒いまま固まらないように）
  { let blkSince = 0; setInterval(() => { const f = document.getElementById('blkFade'); const on = f && f.style.display === 'block' && f.style.opacity === '1'; if (!on) { blkSince = 0; return; } if (!blkSince) blkSince = Date.now(); else if (Date.now() - blkSince > 6000) { blkSince = 0; blackClear(300); } }, 1000); }
  const blackClear = (ms) => new Promise((ok) => { const f = document.getElementById('blkFade'); if (!f) return ok(); f.style.transition = `opacity ${ms}ms`; f.style.opacity = '0'; setTimeout(() => { f.style.display = 'none'; ok(); }, ms + 20); });
  // リーグを表す4つのアイコン（仮）と、リーグのロゴ
  const LG_ICONS = '<div class="std-ic"><i class="i1">D1</i><i class="i2">D2</i><i class="i3">D3</i><i class="i4">地域</i></div>';
  const ARW = {
    s: '<svg viewBox="0 0 20 16" class="ar"><path d="M1 5h9V1l9 7-9 7v-4H1z" fill="#111"/></svg>',
    u: '<svg viewBox="0 0 20 20" class="ar"><path d="M3 13l7-7-3-3h10v10l-3-3-7 7z" fill="#1d6fe0" stroke="#0b3a80" stroke-width=".8"/></svg>',
    d: '<svg viewBox="0 0 20 20" class="ar"><path d="M3 7l7 7-3 3h10V7l-3 3-7-7z" fill="#e0261d" stroke="#7a0e0a" stroke-width=".8"/></svg>',
  };
  function postComp(res, info) {
    const isLg = res.kind === 'league' && save.league, isCup = (res.kind === 'cup' || res.kind === 'post') && save.cup;
    if (!isLg && !isCup) return Promise.resolve();
    return new Promise(async (done) => {
      await blackFade(250);
      openAssoc({ tab: 'stats', sub: isLg ? { kind: 'table', id: save.league.id, before: info.before } : res.kind === 'post' ? { kind: 'post' } : { kind: 'cup' }, direct: true, onClose: async () => { await blackFade(300); done(); } });
      await blackClear(300);
    });
  }

  // ---- D1観戦：次の節のD1の試合を見る（見た試合の結果は、そのまま順位に入る）----
  function watchHTML() {
    const R = C.d1Round(save);
    if (!R) return `<div class="std-body"><div class="std-h"><span>D1観戦</span></div><p class="std-soon">今シーズンのD1の試合は、すべて終わりました。</p></div>`;
    const k = cal(R.week), sh = (n) => { const t = C.findTeam(save, n); return esc((t && t.short) || n); };
    const row = (f, i) => `<div class="wt-row"><span class="wt-t">${sh(f.A)}<img src="${emblemURL(f.A, 48)}" alt=""></span>${f.done ? `<b class="wt-s">${f.done.s[0]} − ${f.done.s[1]}</b>` : '<b class="wt-vs">VS</b>'}<span class="wt-t r"><img src="${emblemURL(f.B, 48)}" alt="">${sh(f.B)}</span>${f.done ? '<em class="wt-dn">観戦済み</em>' : `<button class="wt-go" data-watch="${i}">観戦する</button>`}</div>`;
    const last = R.last.length ? `<div class="wt-h2">前の節の結果</div>${R.last.map((x) => `<div class="wt-row past"><span class="wt-t">${sh(x.A)}<img src="${emblemURL(x.A, 48)}" alt=""></span><b class="wt-s">${x.s[0]} − ${x.s[1]}</b><span class="wt-t r"><img src="${emblemURL(x.B, 48)}" alt="">${sh(x.B)}</span>${x.w ? '<em class="wt-dn">観戦</em>' : '<em></em>'}</div>`).join('')}` : '';
    return `<div class="std-body"><div class="std-h"><span>D1観戦</span><em>第${R.round + 1}節　${k.m}月${k.w}週</em></div><div class="wt"><p class="wt-note">D1リーグの次の節の試合を、試合の画面で観戦できます。観戦した試合の結果は、そのまま記録に残ります。</p>${R.list.map(row).join('')}${last}</div></div>`;
  }
  function watchD1(i, el) {
    const R = C.d1Round(save), f = R && R.list[i]; if (!f || f.done) return;
    const ta = C.opponentTeam(save, { name: f.A }), tb = C.opponentTeam(save, { name: f.B });
    const shA = (C.findTeam(save, f.A) || {}).short || f.A, shB = (C.findTeam(save, f.B) || {}).short || f.B, seed = 1 + Math.floor(Math.random() * 999999);
    el.hidden = true; assocState = null; cancelAnimationFrame(raf);
    A().startWith(ta, tb, seed, shA, shB, (score) => {
      C.pinWatch(save, R.id, R.round, f.a, f.b, score, (A().match || {}).events || []); store();
      open(); openAssoc({ tab: 'watch' });
    }, { confirmQuit: () => coachAsk('観戦をやめますか？'), onQuit: () => { open(); openAssoc({ tab: 'watch' }); }, venue: 4, kits: C.kitsPair(save, f.A, f.B), watch: true, noIntro: true, comp: 'D1観戦', label: `第${R.round + 1}節`, homeName: f.A, awayName: f.B, embH: emblemURL(f.A, 48), embA: emblemURL(f.B, 48), grade: (q, k, tm) => { const tp = ((tm ? tb : ta) || {}).players || [], pl = tp.find((x) => x.name === q.name && x.number === q.number) || tp.find((x) => x.name === q.name); if (pl && pl.bg && pl.bg[k]) return pl.bg[k]; return C.rankInfo(C.toPts((q.params || q)[k])).g; } });   // 版629：クラブ画面と同じ、素の能力ランクを表示
  }
  // ================= サッカー協会（本家の N.LEAGUE の画面）：試合日程・成績・監督成績・移籍情報 =================
  const LG_ORDER = ['d1', 'd2', 'd3', 'regE1', 'regW1', 'regE2', 'regW2'];
  const LG_LABEL = { d1: 'D1リーグ', d2: 'D2リーグ', d3: 'D3リーグ', regE1: '地域1部 東', regW1: '地域1部 西', regE2: '地域2部 東', regW2: '地域2部 西' };
  // 順位表の色分け（シーズンの終わりにどうなるか）
  function zoneOf(id, k, n) {
    if (id === 'd1') return k === 0 ? ['champ', '優勝'] : k >= n - 2 ? ['ex', 'D1/D2入れ替え戦（残留をかけて）'] : null;
    if (id === 'd2') return k < 2 ? ['up', 'D1/D2入れ替え戦'] : k === n - 2 ? ['ex', '入れ替え戦'] : k === n - 1 ? ['dn', '降格'] : null;
    if (id === 'd3') return k === 0 ? ['up', '昇格'] : k === 1 ? ['ex', '入れ替え戦'] : k >= n - 2 ? ['dn', '降格'] : null;
    if (id === 'regE1' || id === 'regW1') return k < 2 ? ['up', 'D3昇格トーナメント'] : k === n - 1 ? ['dn', '降格'] : null;
    return k === 0 ? ['up', '昇格'] : null;
  }
  const ZONE_COL = { champ: '優勝', up: '昇格', ex: '入れ替え', dn: '降格' };
  // リーグの4〜5つのアイコン（仮）：GPTの絵ができたら icons/lg/all.png に置きかわる
  function lgIconsHTML() {
    if (ART.leagues.includes('all')) return '<img class="std-icall" src="icons/lg/all.png" alt="">';
    // 5つの盾を、本家のような長方形にまとめる：左に大きくD1、右に2×2でD2・D3・地域1部・地域2部
    if (false && ['d1', 'd2', 'd3', 'reg1', 'reg2'].every((k) => ART.leagues.includes(k))) return `<div class="std-icr"><img class="big" src="icons/lg/d1.png" alt="D1"><div><img src="icons/lg/d2.png" alt="D2"><img src="icons/lg/d3.png" alt="D3"><img src="icons/lg/reg1.png" alt="地1"><img src="icons/lg/reg2.png" alt="地2"></div></div>`;
    // 本家（N1・N2・S・葉っぱの4マス）のように、シンプルな色の四角を3×2に：D1 D2 D3 ／ 地1 地2 ボール
    const top = ['d1', 'd2', 'd3'].map((k) => ART.leagues.includes(k) ? `<img class="t-img" src="icons/lg/${k}.png?v=768" alt="${k.toUpperCase()}">` : `<i class="t-${k}">D<b>${k[1]}</b></i>`).join('');
    const reg = [['regE1', 'e1', '東', 1], ['regW1', 'w1', '西', 1], ['regE2', 'e2', '東', 2], ['regW2', 'w2', '西', 2]].map(([k, c, r, n]) => ART.leagues.includes(k) ? `<img class="t-img t-${c}i" src="icons/lg/${k}.png?v=768" alt="${r}${n}">` : `<i class="t-${c}">${r}<b>${n}</b></i>`).join('');
    return `<div class="std-tiles">${top}${reg}</div>`;
  }
  let assocState = null;
  // 版515：相手チームの情報（チーム・スタメン）を、はみ出さない大きさに縮めて1画面に収める
  function tvFit(box) {
    const tv = box.querySelector('.tv'), ti = tv && tv.querySelector('.tv-in');
    if (ti) { ti.style.zoom = 1; const k = Math.min(1, (tv.clientHeight - 20) / ti.scrollHeight, (tv.clientWidth - 20) / ti.scrollWidth); ti.style.zoom = k.toFixed(3); }
    const tx = box.querySelector('.tx'), xi = tx && tx.querySelector('.tx-in');
    if (xi) { const W = tx.clientWidth, H = tx.clientHeight, k = Math.min(W / 1000, H / 490); xi.style.transform = `scale(${k.toFixed(4)})`; xi.style.left = Math.max(0, (W - 1000 * k) / 2) + 'px'; }
  }
  function openAssoc(opt) {
    opt = opt || {};
    const el = fullScreen('assocScreen', 'std-wrap'), box = el.querySelector('.lk-box');
    assocState = { tab: opt.tab || 'sched', sub: opt.sub || null, direct: !!opt.direct, onClose: opt.onClose || null, cupRound: null };
    const draw = () => {
      const S = assocState, myLg = save.league.id;
      const names = save.league.teams.map((t) => t.name);
      const head = `<div class="std-top">${lgIconsHTML()}<div class="std-logo"><b>D.LEAGUE</b><small>Professional Football League</small></div><div class="std-embs">${names.map((n) => `<img src="${emblemURL(n, 48)}" alt="" title="${esc(n)}">`).join('')}</div><button class="std-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button></div>
        <div class="std-tabs">${[['sched', '試合日程'], ['stats', '成績'], ['mgr', '監督成績'], ['watch', 'D1観戦']].map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      let body = '';
      if (S.tab === 'sched') body = schedHTML();
      else if (S.tab === 'stats') body = S.sub ? statSubHTML(S.sub) : statMenuHTML(myLg);
      else if (S.tab === 'mgr') body = mgrHTML();
      else body = watchHTML();
      const tvm = S.tab === 'stats' && S.sub && S.sub.kind === 'team';
      box.innerHTML = `<div class="std${tvm ? ' tvm' : ''}">${head}${body}</div>`;
      if (tvm) requestAnimationFrame(() => tvFit(box));   // 版515：相手チームの情報は1画面に収める
      { const m = box.querySelector('.sm-menu'), bd = box.querySelector('.std-body'), H = document.documentElement;   // 版489：成績のメニューは、画面に少し余裕をもって収まる大きさに
        if (m && bd && (H.classList.contains('short') || H.classList.contains('phone'))) { m.style.zoom = 1; requestAnimationFrame(() => { const z0 = parseFloat(getComputedStyle(m.parentElement).zoom) || 1, avail = bd.clientHeight / z0 - 24, need = m.offsetHeight + 12; m.style.zoom = Math.max(0.6, Math.min(1.5, avail / need)).toFixed(3); }); } }
      box.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; S.sub = null; S.direct = false; draw(); });
      box.querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => { const [kind, id] = b.dataset.sub.split(':'); S.sub = { kind, id }; draw(); });
      box.querySelectorAll('[data-cupr]').forEach((b) => b.onclick = () => { S.cupRound = +b.dataset.cupr; draw(); });
      box.querySelectorAll('[data-cupv]').forEach((b) => b.onclick = () => { S.cupView = b.dataset.cupv; draw(); });
      box.querySelectorAll('[data-team]').forEach((b) => b.onclick = () => { S.sub = { kind: 'team', id: b.dataset.team, back: S.sub, backTab: S.tab, view: 'info' }; S.tab = 'stats'; draw(); });
      box.querySelectorAll('[data-tmv]').forEach((b) => b.onclick = () => { S.sub.view = b.dataset.tmv; draw(); });
      box.querySelectorAll('.tm-row[data-pi]').forEach((r) => r.onclick = () => cpuCard(r.dataset.tid, +r.dataset.pi, el));
      box.querySelectorAll('.tx-p[data-pi],.tv-ace[data-pi]').forEach((r) => r.onclick = () => { if (+r.dataset.pi >= 0) cpuCard(r.dataset.tid, +r.dataset.pi, el); });
      box.querySelectorAll('.tm-star[data-spi]').forEach((r) => r.onclick = () => cpuCard(r.dataset.tid, +r.dataset.spi, el));
      box.querySelectorAll('.rk-row[data-rkp]').forEach((r) => r.onclick = () => {   // ランキングの選手をタップ：選手情報
        const tn = r.dataset.rkt, pn = r.dataset.rkp;
        if (tn === save.team.name) { const i = save.team.players.findIndex((q) => q.name === pn); if (i >= 0) playerDetail(i, { noNav: true }); return; }
        const t = C.findTeam(save, tn); if (!t) return; const pi = cpuList(t.id).findIndex((q) => q.name === pn); if (pi >= 0) cpuCard(t.id, pi, el, { noNav: true });
      });
      box.querySelectorAll('[data-watch]').forEach((b) => b.onclick = () => watchD1(+b.dataset.watch, el));
      const rs = box.querySelector('#crReset2');
      if (rs) rs.onclick = async () => {
        const ok = await coachAsk('監督、最初からやり直しますか？<br>育てた選手・順位は、すべて消えます。');
        if (ok) { el.hidden = true; save = C.newCareer(); store(); runners.length = 0; go('home'); }
      };
      box.querySelector('.std-back').onclick = () => {
        if (S.tab === 'stats' && S.sub && S.sub.kind === 'team') { S.tab = S.sub.backTab || 'stats'; S.sub = S.sub.back || null; draw(); return; }
        if (S.tab === 'stats' && S.sub && !S.direct) { S.sub = null; draw(); return; }
        if (S.onClose) { const f = S.onClose; el.hidden = true; assocState = null; f(); return; }
        el.hidden = true; assocState = null; go('home');
      };
      const cur = box.querySelector('.sc-row.now'); if (cur) cur.scrollIntoView({ block: 'center' });
    };
    draw(); el.hidden = false; el._fit();
    { const cur = box.querySelector('.sc-row.now'); if (cur) cur.scrollIntoView({ block: 'center' }); }
  }
  // ---- 試合日程・結果：1年（3月1週〜翌2月4週）の全部の週。試合・カップ・合宿・シーズン終盤の予定。何もない週は空欄 ----
  function schedHTML() {
    const lg = save.league, me = lg.teams.findIndex((t) => t.me), myName = save.team.name, byW = {};
    const add = (w, x) => { (byW[w] = byW[w] || []).push(x); };
    lg.rounds.forEach((pairs, r) => {
      const pr = pairs.find(([a, b]) => a === me || b === me); if (!pr) return;
      const res = lg.results[r] && lg.results[r].find((x) => x.a === pr[0] && x.b === pr[1]), home = pr[0] === me;
      add(lg.weeks[r], { badge: `<i class="sc-b">第${r + 1}節</i>`, opp: lg.teams[home ? pr[1] : pr[0]].name, ha: home ? 'H' : 'A', s: res ? (home ? res.s : [res.s[1], res.s[0]]) : null, played: !!res, match: true, note: r === lg.rounds.length - 1 ? '最終節' : '' });
    });
    const cup = save.cup;
    if (cup) {
      for (const g of cup.log) add(g.week, { badge: '<i class="sc-b cup">CUP</i>', opp: g.opp, s: g.s, played: true, match: true, note: (g.label || '') + (g.pk ? (g.win ? '・PK勝' : '・PK負') : '') });
      const inCup = C.cupIn(cup, myName), inPre = (cup.pre || []).some((x) => x.includes(myName));
      if (inCup) {
        const nf = C.nextFixture(save);
        C.CUP_WEEKS.forEach((w, k) => {
          if (k < cup.round || byW[w] && byW[w].some((x) => x.badge.includes('CUP'))) return;
          if (k === 0 && !inPre) return;   // 出場決定戦は地域2部の4チームだけ
          const lbl = C.CUP_LABELS[k] || `${k}回戦`;
          if (nf && nf.kind === 'cup' && nf.week === w) add(w, { badge: '<i class="sc-b cup">CUP</i>', opp: nf.opp.name, ha: nf.home ? 'H' : 'A', s: null, match: true, note: nf.label });
          else add(w, { badge: '<i class="sc-b cup">CUP</i>', label: `国内カップ ${lbl}（勝ち進んだら）`, plan: true });
        });
      }
    }
    // シーズン終盤：組み合わせが決まっていれば自分の試合、まだなら自分のリーグの予定（順位しだい）
    const PW = C.POST_WEEKS;
    if (save.post) { for (const m of save.post.matches) if (m.a === myName || m.b === myName) { const mine = m.a === myName; add(m.week, { badge: `<i class="sc-b post">${esc(m.label)}</i>`, opp: (mine ? m.b : m.a) || '', label: m.comp, ha: mine ? 'H' : 'A', s: m.done ? (mine ? m.s : [m.s[1], m.s[0]]) : null, played: !!m.done, match: true, note: m.comp }); } }
    else {
      const id = lg.id, P = (w, b, l) => add(w, { badge: `<i class="sc-b post">${b}</i>`, label: l, plan: true });
      if (/^reg.2$/.test(id)) { P(PW[0], '準決勝', '地域2部 東西親善試合（1・2位。昇格には関係なし）'); P(PW[1], '決勝', '地域2部 東西親善試合'); }
      else if (/^reg.1$/.test(id)) { P(PW[0], '準決勝', 'D3昇格トーナメント（1・2位。勝てばD3へ）'); }
      else if (id === 'd3') P(PW[0], '入れ替え戦', 'D3/D2入れ替え戦（2位）');
      else if (id === 'd2') { P(PW[0], '入れ替え戦', 'D1/D2入れ替え戦（1・2位。勝てばD1へ）／D3/D2入れ替え戦（13位）'); }
      else if (id === 'd1') { P(PW[0], '入れ替え戦', 'D1/D2入れ替え戦（11・12位は残留をかけて）'); }
    }
    for (const cp of C.CAMPS) for (let w = cp.from; w <= cp.to; w++) add(w, { badge: '<i class="sc-b camp">合宿</i>', label: `${cp.name}（${w - cp.from + 1}/${cp.to - cp.from + 1}週目）`, plan: true });
    { const fin = save.post && save.post.matches.some((m) => m.label === '決勝' && (m.a === myName || m.b === myName));   /* 版765：シーズンの終わりは1月の試合のあと（ふつう1月2週、親善試合の決勝に出たら1月3週） */
      add(fin ? PW[1] + 1 : PW[0] + 1, { badge: '<i class="sc-b end">終了</i>', label: 'シーズン終了（順位・昇格・降格が決まる／賞金）', plan: true });
      add(C.SEASON_WEEKS, { badge: '<i class="sc-b end">次へ</i>', label: '3月から新シーズン', plan: true }); }
    const others = (w) => {
      let h = '';
      for (const id of LG_ORDER) { if (id === lg.id) continue; const o = save.lgs && save.lgs[id]; if (o && o.weeks.includes(w)) h += lgBadge(id); }
      if (C.CUP_WEEKS.includes(w)) h += '<i class="lgb b-cup">杯</i>';
      return h;
    };
    const nextW = Math.max(1, save.week);
    let lastM = 0, html = '';
    for (let w = 1; w <= C.SEASON_WEEKS; w++) {
      const k = cal(w), d = k.m !== lastM ? `${k.m}/${k.w}` : `／${k.w}`; lastM = k.m;
      const list = byW[w] || [{}];
      list.forEach((x, j) => {
        const res = x.s ? `<b class="${x.s[0] > x.s[1] ? 'w' : x.s[0] < x.s[1] ? 'l' : 'd'}">${x.s[0]}−${x.s[1]}</b>` : '';
        const what = x.opp ? `<img src="${emblemURL(x.opp, 32)}" alt="">${esc(x.opp)}${x.ha ? ` [${x.ha}]` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}` : x.label ? `<span class="${x.plan ? 'sc-plan' : ''}">${esc(x.label)}</span>` : '';
        const tapT = x.opp && x.opp !== myName && C.findTeam(save, x.opp) ? ` data-team="${esc(x.opp)}"` : '';   // 版511：相手をタップでチーム情報
        html += `<div class="sc-row${tapT ? ' tap' : ''}${w === nextW && j === 0 ? ' now' : ''}${w < save.week ? ' past' : ''}"${tapT}><span class="sc-d">${j === 0 ? d : ''}</span>${x.badge || '<i class="sc-b none"></i>'}<span class="sc-o">${what}</span><span class="sc-x">${j === 0 ? others(w) : ''}</span><span class="sc-r">${res}</span></div>`;
      });
    }
    return `<div class="std-body"><div class="std-h"><span>年間の予定・結果</span><em>シーズン${save.season}　試合結果</em></div><div class="std-list">${html}</div></div>`;
  }
  // ---- 成績のメニュー ----
  function statMenuHTML(myLg) {
    const rows = LG_ORDER.map((id) => `<div class="sm-row${id === myLg ? ' mine' : ''}"><span class="sm-n">${lgBadge(id)}${LG_LABEL[id]}</span><button data-sub="table:${id}">順位表</button><button data-sub="goal:${id}">ゴール</button><button data-sub="assist:${id}">アシスト</button></div>`).join('');
    const cup = `<div class="sm-row"><span class="sm-n"><i class="lgb b-cup">杯</i>国内カップ</span><button data-sub="cup">組み合わせ</button><button data-sub="goal:cup">ゴール</button><button data-sub="assist:cup">アシスト</button></div>`;
    const post = save.post ? `<div class="sm-row"><span class="sm-n"><i class="lgb b-post">決</i>昇格・入れ替え戦</span><button data-sub="post">結果</button></div>` : '';
    return `<div class="std-body"><div class="sm-menu">${rows}${cup}${post}</div></div>`;
  }
  function statSubHTML(sub) {
    if (sub.kind === 'table') return tableHTML(sub.id, sub.before);
    if (sub.kind === 'goal' || sub.kind === 'assist') return rankHTML(sub.id, sub.kind);
    if (sub.kind === 'cup') return cupHTML();
    if (sub.kind === 'post') return postHTML();
    if (sub.kind === 'team') return teamHTML(sub.id, sub.view);
    return '';
  }
  const lgName = (id) => (id === 'cup' ? '国内カップ' : id === 'post' ? '昇格・入れ替え戦' : LG_LABEL[id] || '');
  function tableHTML(id, before) {
    const t = C.leagueTable(save, id); if (!t) return '';
    const n = t.rows.length; before = t.round <= 1 ? [] : before && before.length ? before : C.prevOrder(save, id);   // 第1節が終わっただけなら、矢印は全部→
    const arrow = (row, k) => { const b = before.indexOf(row.name); return b < 0 || b === k ? ARW.s : b > k ? ARW.u : ARW.d; };
    const rowH = Math.min(38, Math.floor((720 - 136 - 36 - 40) / n));
    const used = new Set();
    const body = t.rows.map((r, k) => { const z = zoneOf(id, k, n); if (z) used.add(z[0] + ':' + z[1]); const gd = r.stats.GF - r.stats.GA;
      return `<tr class="${z ? 'z-' + z[0] : ''}${r.me ? ' me' : ''}"${r.me ? '' : ` data-team="${esc(r.name)}"`}><td class="s-rk">${k + 1}</td><td class="s-aw">${arrow(r, k)}</td><td class="s-em"><img src="${emblemURL(r.name, 40)}" alt=""></td><td class="s-nm">${esc(r.name)}</td><td>${r.stats.Pts}</td><td>${r.stats.P}</td><td>${r.stats.W}</td><td>${r.stats.D}</td><td>${r.stats.L}</td><td>${r.stats.GF}</td><td>${r.stats.GA}</td><td>${gd > 0 ? '+' : ''}${gd}</td></tr>`; }).join('');   // 版559：失点も
    const legend = [...used].map((u) => { const [k, l] = u.split(':'); return `<span><i class="z-${k}"></i>${esc(l)}</span>`; }).join('');
    return `<div class="std-body"><table class="std-tbl" style="--rh:${rowH}px"><tr class="std-h"><th colspan="4"><span>${esc(LG_LABEL[id])} 順位表</span><small>第${t.round}節まで（全${t.rounds}節）</small></th><th>勝点</th><th>試合</th><th>勝</th><th>分</th><th>負</th><th>得点</th><th>失点</th><th>得失</th></tr>${body}</table><div class="std-legend">${legend}</div></div>`;
  }
  function rankHTML(id, kind) {
    const k = kind === 'goal' ? 'g' : 'a', list = C.goalRank(save, id).filter((x) => x[k] > 0).sort((x, y) => y[k] - x[k] || (y[kind === 'goal' ? 'a' : 'g'] - x[kind === 'goal' ? 'a' : 'g']));
    let rank = 0, prev = -1;
    const rows = list.slice(0, 60).map((x, i) => { const show = x[k] !== prev; if (show) { rank = i + 1; prev = x[k]; } return `<div class="rk-row${x.me ? ' me' : ''}" data-rkt="${esc(x.team)}" data-rkp="${esc(x.player)}"><span class="rk-n">${show ? rank : ''}</span><span class="rk-p">${esc(x.player)}</span><span class="rk-t"><img src="${emblemURL(x.team, 32)}" alt="">${esc(x.team)}</span><span class="rk-v">${x[k]}</span></div>`; }).join('');
    return `<div class="std-body"><div class="std-h"><span>${esc(lgName(id))} ${kind === 'goal' ? 'ゴール' : 'アシスト'}ランキング</span><em>${kind === 'goal' ? 'ゴール数' : 'アシスト数'}</em></div><div class="std-list">${rows || '<p class="std-soon">まだ記録がありません</p>'}</div></div>`;
  }
  // ---- 国内カップ：トーナメント表（64チームを16チームずつ4ブロック＋ベスト8からの決勝トーナメント、出場決定戦）----
  const LGT = { d1: ['D1', '#d8202a'], d2: ['D2', '#1f5fd0'], d3: ['D3', '#2f9e44'], regE1: ['東1', '#f2c200'], regW1: ['西1', '#f2c200'], regE2: ['東2', '#8b46c8'], regW2: ['西2', '#8b46c8'] };   /* 版768：1部＝黄・2部＝紫 */
  function cupHTML() {
    const cup = save.cup; if (!cup || !cup.bracket) return `<div class="std-body"><div class="std-h"><span>国内カップ</span></div><p class="std-soon">まだ始まっていません</p></div>`;
    const me = save.team.name, H = (r) => (cup.hist || []).find((h) => h.round === r);
    const myIdx = cup.bracket.indexOf(me);
    let view = assocState.cupView || (cup.round >= 4 ? 'final' : myIdx >= 0 ? 'ABCD'[Math.floor(myIdx / 16)] : (cup.pre || []).some((x) => x.includes(me)) && cup.round === 0 ? 'pre' : 'A');
    const esc2 = (x) => esc(String(x));
    const nameOf = (n) => (n === '#pre0' || n === '#pre1' ? '出場決定戦の勝者' : n);
    const lgOf = (n) => (n === me ? save.league.id : (C.findTeam(save, n) || {}).lg);
    // チーム名（エンブレム＋リーグの札＋名前）
    const label = (n, x, y, right) => {
      if (!n) return '';
      const nm = nameOf(n), real = nm === n, t = real ? LGT[lgOf(n)] : null, col = n === me ? '#c8102e' : '#111';
      const img = real ? `<image href="${emblemURL(n, 32)}" x="${right ? x - 26 : x}" y="${y - 13}" width="26" height="26"/>` : '';
      const bx = right ? x - 60 : x + 30, badge = t ? `<rect x="${bx}" y="${y - 9}" width="28" height="18" rx="3" fill="${t[1]}"/><text x="${bx + 14}" y="${y + 5}" font-size="12" font-weight="900" fill="#fff" text-anchor="middle">${t[0]}</text>` : '';
      const tx = right ? x - 66 : x + (t ? 64 : real ? 30 : 0);
      const out = `${img}${badge}<text x="${tx}" y="${y + 6}" font-size="17" font-weight="${n === me ? 900 : 700}" fill="${real ? col : '#888'}" text-anchor="${right ? 'end' : 'start'}">${esc2(nm)}</text>`;
      return lost.has(n) ? `<g opacity=".3">${out}</g>` : out;
    };
    const RED = '#e0261d', GRAY = '#9a9a9a';
    // 版658：負けたチームは名前を薄く（どこまで残っているか分かりやすく）
    const RR = view === 'pre' ? [0] : view === 'final' ? [4, 5, 6] : [1, 2, 3];   // この表に出ている回戦の負けだけ
    const lost = new Set(); for (const h of (cup.hist || []).filter((h) => RR.includes(h.round))) for (const g of h.games || []) if (g && g.w) { if (g.a && g.a !== g.w) lost.add(g.a); if (g.b && g.b !== g.w) lost.add(g.b); }
    // ひとつの試合の線：2つの入口(y1,y2)を x0→x で受けて、勝った方を赤くし、xから先へ出す
    const match = (x0, x, y1, y2, g, dir) => {
      const ym = (y1 + y2) / 2, w = g && g.w, aWin = w && w === g.a, bWin = w && w === g.b, d = dir || 1;
      let o = `<path d="M${x0} ${y1}H${x}" stroke="${aWin ? RED : GRAY}" stroke-width="${aWin ? 4 : 2}" fill="none"/><path d="M${x0} ${y2}H${x}" stroke="${bWin ? RED : GRAY}" stroke-width="${bWin ? 4 : 2}" fill="none"/>`;
      o += `<path d="M${x} ${y1}V${ym}" stroke="${aWin ? RED : GRAY}" stroke-width="${aWin ? 4 : 2}"/><path d="M${x} ${ym}V${y2}" stroke="${bWin ? RED : GRAY}" stroke-width="${bWin ? 4 : 2}"/>`;
      if (g && g.s) o += `<text x="${x - 6 * d}" y="${ym + 5}" font-size="13" font-weight="800" fill="#333" text-anchor="${d > 0 ? 'end' : 'start'}">${g.s[0]}-${g.s[1]}${g.pk ? 'PK' : ''}</text>`;
      return { svg: o, ym, out: w ? RED : GRAY, outW: w ? 4 : 2 };
    };
    let svg = '', W = 1256, Hh = 540;
    if (view === 'pre') {
      const g = H(0); W = 900; Hh = 252;   // 版659：勝者の名前が右で切れないように広く   // 版490：出場決定戦は2試合だけなので、表示を大きく（見る範囲をせまく）
      svg = (cup.pre || []).map(([a, b], k) => { const gg = g && g.games[k]; const y = 30 + k * 128; const m = match(330, 470, y, y + 52, gg); return label(a, 20, y) + label(b, 20, y + 52) + m.svg + `<path d="M470 ${m.ym}H560" stroke="${m.out}" stroke-width="${m.outW}"/>` + (gg ? label(gg.w, 570, m.ym) : `<text x="570" y="${m.ym + 6}" font-size="16" fill="#888">1回戦へ</text>`); }).join('');
    } else if (view === 'final') {
      const r3 = H(3), qf = H(4), sf = H(5), fn = H(6);
      const ent = [...Array(8)].map((_, k) => (r3 ? r3.games[k].w : null));
      const ph = (k) => `ブロック${'ABCD'[Math.floor(k / 2)]}の勝者`;
      const ys = [70, 190, 310, 430];
      // 左：0〜3、右：4〜7
      for (const side of [0, 1]) {
        const R = side === 1, xN = R ? 1236 : 20, x0 = R ? 930 : 326, x1 = R ? 840 : 416, x2 = R ? 750 : 506;
        for (let k = 0; k < 4; k++) { const i = side * 4 + k, n = ent[i]; svg += n ? label(n, R ? xN : xN, ys[k], R) : `<text x="${R ? xN : xN}" y="${ys[k] + 6}" font-size="16" fill="#888" text-anchor="${R ? 'end' : 'start'}">${ph(i)}</text>`; svg += `<path d="M${R ? 1236 - 300 : 320} ${ys[k]}H${x0}" stroke="${GRAY}" stroke-width="2"/>`; }
        const m1 = match(x0, x1, ys[0], ys[1], qf && qf.games[side * 2], R ? -1 : 1), m2 = match(x0, x1, ys[2], ys[3], qf && qf.games[side * 2 + 1], R ? -1 : 1);
        const m3 = match(x1, x2, m1.ym, m2.ym, sf && sf.games[side], R ? -1 : 1);
        svg += m1.svg + m2.svg + m3.svg + `<path d="M${x2} ${m3.ym}H628" stroke="${m3.out}" stroke-width="${m3.outW}"/>`;
      }
      const champ = fn && fn.games[0].w;
      svg += `<circle cx="628" cy="250" r="44" fill="#ffd23a" stroke="#b08a12" stroke-width="4"/><text x="628" y="262" font-size="36" text-anchor="middle">🏆</text>`;
      svg += `<text x="628" y="${champ ? 330 : 330}" font-size="20" font-weight="900" text-anchor="middle" fill="#c8102e">${champ ? '優勝　' + esc2(champ) : '決勝　12月3週'}</text>`;
      if (fn && fn.games[0].s) svg += `<text x="628" y="356" font-size="16" font-weight="800" text-anchor="middle" fill="#333">${esc2(fn.games[0].a)} ${fn.games[0].s[0]}-${fn.games[0].s[1]} ${esc2(fn.games[0].b)}</text>`;
    } else {
      const b = 'ABCD'.indexOf(view), base = b * 16, rowY = (i) => 30 + i * 31.5;
      let ys = [...Array(16)].map((_, i) => rowY(i));
      for (let i = 0; i < 16; i++) svg += label(cup.bracket[base + i], 14, ys[i]);
      let names = cup.bracket.slice(base, base + 16), x0 = 360;
      const xs = [400, 520, 640];
      for (let r = 1; r <= 3; r++) {
        const h = H(r), n = names.length / 2, off = base / 2 ** r, nys = [], nnames = [];
        for (let m = 0; m < n; m++) {
          const g = h && h.games[off + m]; const mm = match(r === 1 ? 330 : x0, xs[r - 1], ys[2 * m], ys[2 * m + 1], g);
          svg += mm.svg; nys.push(mm.ym); nnames.push(g ? g.w : null);
          if (r === 3) svg += `<path d="M${xs[2]} ${mm.ym}H${xs[2] + 70}" stroke="${mm.out}" stroke-width="${mm.outW}"/>` + (g ? label(g.w, xs[2] + 80, mm.ym) : `<text x="${xs[2] + 80}" y="${mm.ym + 6}" font-size="16" fill="#888">準々決勝へ</text>`);
        }
        ys = nys; names = nnames; x0 = xs[r - 1];
      }
      // 自分の名前の行のしるし
      const mi = cup.bracket.slice(base, base + 16).indexOf(me); if (mi >= 0) svg = `<rect x="6" y="${rowY(mi) - 14}" width="318" height="28" rx="4" fill="#fff3c4"/>` + svg;
      Hh = 540;
    }
    const tabs = [['pre', '出場決定戦'], ['A', 'ブロックA'], ['B', 'ブロックB'], ['C', 'ブロックC'], ['D', 'ブロックD'], ['final', '準々決勝から']].map(([k, l]) => `<button data-cupv="${k}" class="${view === k ? 'on' : ''}">${l}${k !== 'final' && k !== 'pre' && myIdx >= 0 && 'ABCD'[Math.floor(myIdx / 16)] === k ? '<small>★</small>' : ''}</button>`).join('');
    const now = cup.champion ? `優勝：${esc(cup.champion)}` : `次は ${esc(C.CUP_LABELS[cup.round] || '')}`;
    return `<div class="std-body"><div class="std-h"><span>国内カップ トーナメント表</span><em>${now}</em></div><div class="cg-tabs">${tabs}</div><div class="cup-svg"><svg viewBox="0 0 ${W} ${Hh}" font-family="Hiragino Kaku Gothic ProN, Yu Gothic, sans-serif">${svg}</svg></div></div>`;
  }
  function postHTML() {
    const post = save.post; if (!post) return '';
    const me = save.team.name, comps = [...new Set(post.matches.map((m) => m.comp))];
    const tm = (n) => (n ? `<span class="cg-t${n === me ? ' me' : ''}"><img src="${emblemURL(n, 32)}" alt="">${esc(n)}</span>` : '<span class="cg-t">未定</span>');
    const blocks = comps.map((c) => `<div class="pm-h">${esc(c)}</div>${post.matches.filter((m) => m.comp === c).map((m) => { const k = cal(m.week); return `<div class="cg${m.a === me || m.b === me ? ' mine' : ''}"><small class="pm-w">${k.m}/${k.w} ${esc(m.label)}</small>${tm(m.a)}<b class="cg-s">${m.done ? `${m.s[0]}−${m.s[1]}` : 'vs'}</b>${tm(m.b)}</div>`; }).join('')}`).join('');
    return `<div class="std-body"><div class="std-h"><span>昇格・入れ替え戦</span></div><div class="std-list pm">${blocks}</div></div>`;
  }
  // ---- スター選手の専用の顔（シャツをチームの色に塗り替える。GKは黄色）----
  const starImgs = {}, starURLs = new Map();
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  function starKey(tid, q) { const F = window.STAR_FACES; if (F && q && q.face && !q.face.startsWith('mob_') && q.face in F) return q.face; if (F && q && q.face) return null; return F && q && !q.gen && (tid + '_' + q.no) in F ? tid + '_' + q.no : null; }   /* 移籍してきた選手は、元の顔のまま（版455） */
  // 版513：自分のチームに来た選手の顔は、ほかの選手と同じ大きさに見えるよう縮めて下にそろえる
  const STAR_FIT = 0.8;
  function starFace(key, shirt, gk, fit) {
    const ck = key + '|' + shirt + '|' + (gk ? ((C.ensureClub(save).gk) || {}).shirt : 0) + '|' + (fit || 1); if (starURLs.has(ck)) return starURLs.get(ck);
    let L = starImgs[key];
    if (!L) { L = starImgs[key] = { img: new Image(), n: 0 }; L.img.onload = L.img.onerror = () => { L.n = 1; starFill(); try { faceFill(); } catch (_) {} }; L.img.src = `faces/star/${key}.png`; }
    if (!L.n) return null;
    let url = `faces/star/${key}.png`;
    try {
      const W = L.img.naturalWidth, H = L.img.naturalHeight, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      x.drawImage(L.img, 0, 0); const d = x.getImageData(0, 0, W, H), px = d.data;
      // シャツ：画像の下半分の「青」で、いちばん下の行とつながっている所（髪の青メッシュは塗らない）
      const blue = (i) => px[i + 3] > 100 && px[i + 2] > px[i] + 45 && px[i + 2] > px[i + 1] + 25 && px[i + 2] > 70;
      const y0 = Math.floor(H * 0.5), mask = new Uint8Array(W * H), st = [];
      for (let xx = 0; xx < W; xx++) for (let yy = H - 3; yy < H; yy++) { const k = yy * W + xx; if (blue(k * 4)) { mask[k] = 1; st.push(k); } }
      while (st.length) { const k = st.pop(), xx = k % W, yy = (k - xx) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = xx + dx, ny = yy + dy; if (nx < 0 || nx >= W || ny < y0 || ny >= H) continue; const n = ny * W + nx; if (!mask[n] && blue(n * 4)) { mask[n] = 1; st.push(n); } } }
      // 線の内側のすき間（しわの線など）も塗る：上下左右が青の画素
      for (let yy = y0 + 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++) { const k = yy * W + xx; if (!mask[k] && px[k * 4 + 3] > 0 && mask[k - 1] && mask[k + 1] && mask[k - W] && mask[k + W]) mask[k] = 2; }
      const t = gk ? hexRgb(((C.ensureClub(save).gk) || {}).shirt || '#f2c230') : hexRgb(shirt || '#2f6fd6'), base = window.STAR_FACES[key] || 80;
      for (let k = 0; k < W * H; k++) if (mask[k]) { const i = k * 4, l = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / base; px[i] = Math.min(255, t[0] * l); px[i + 1] = Math.min(255, t[1] * l); px[i + 2] = Math.min(255, t[2] * l); }
      x.putImageData(d, 0, 0);
      if (fit && fit < 1) { const c2 = document.createElement('canvas'), H2 = Math.round(W * 308 / 320); c2.width = W; c2.height = H2; c2.getContext('2d').drawImage(c, (W - W * fit) / 2, H2 - H * fit, W * fit, H * fit); url = c2.toDataURL(); /* ほかの選手の顔（320×308）と同じ形・同じ頭の大きさに */ } else url = c.toDataURL();
    } catch (e) { /* 読み込めない環境では、元の青いシャツのまま */ }
    starURLs.set(ck, url); return url;
  }
  function starFill() { document.querySelectorAll('img[data-star]').forEach((im) => { const [k, sh, g] = im.dataset.star.split('|'); const u = starFace(k, sh, g === '1'); if (u) { im.src = u; im.removeAttribute('data-star'); } }); }
  function starPic(key, shirt, gk, cls) { const u = starFace(key, shirt, gk); return u ? `<img class="${cls}" src="${u}" alt="">` : `<img class="${cls}" data-star="${key}|${shirt}|${gk ? 1 : 0}" src="${BLANK}" alt="">`; }
  // ---- CPUチームの選手カード（チームのページで選手をタップ）：顔・能力・スキルを全部見せる。◀▶で同じチームの前後の選手 ----
  const cpuFaceP = new Map();
  function cpuList(tid) {
    const ro = C.rosterOfTeam(tid, save.season); if (!ro) return [];
    const KS = D.PARAM_KEYS, ovr = (q) => KS.reduce((a, k) => a + q[k], 0) / KS.length, order = { GK: 0, DF: 1, MF: 2, FW: 3 };
    return ro.players.slice().sort((a, b) => (b.starter - a.starter) || order[a.pos] - order[b.pos] || ovr(b) - ovr(a));
  }
  function cpuFace(tid, q, shirt) {
    const sk = starKey(tid, q);
    if (sk) return starPic(sk, shirt, q.pos === 'GK', 'fc sf');
    const mk = mobKey(tid, q);
    if (mk) return starPic(mk, shirt, q.pos === 'GK', 'fc sf');
    const id = tid + '_' + q.no;
    if (!cpuFaceP.has(id)) cpuFaceP.set(id, { name: q.name, number: q.no, hair: q.looks[0], hairColor: q.looks[1], skin: q.looks[2], position: q.pos });
    return facePic(cpuFaceP.get(id), '');
  }
  // そのほかの選手の顔：54人分のモブの顔から、チームの中でかぶらないように選ぶ（チームと背番号で決まるので、いつも同じ顔）
  const mobMaps = {};
  function mobKey(tid, q) {
    const F = window.STAR_FACES; if (!F || !('mob_1' in F)) return null;
    { const rp = q.face ? q : C.rosterOfTeam(tid, 1).players.find((p) => p.no === q.no); if (rp && rp.face) return rp.face.startsWith('mob_') ? rp.face : null; }   /* 移籍してきた選手は、元の顔のまま（版455） */
    if (!mobMaps[tid]) {
      const ro = C.rosterOfTeam(tid, 1), used = new Set(), map = {}, N = Object.keys(F).filter((k) => k.startsWith('mob_')).length;
      for (const p of ro.players.slice().sort((a, b) => a.no - b.no)) {
        if (starKey(tid, p) || p.face) continue;
        let h = 7; for (const ch of tid + '|' + p.no + '|' + p.name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
        let i = h % N; for (let k = 0; k < N && used.has(i); k++) i = (i + 1) % N;
        used.add(i); map[p.no] = 'mob_' + (i + 1);
      }
      mobMaps[tid] = map;
    }
    return mobMaps[tid][q.no] || null;
  }
  // CPUの選手の利き足（データには無いので、チームと背番号から決める。右6割・左4割。いつも同じ）
  const cpuFoot = (tid, q) => { let h = 7; for (const ch of tid + '|' + q.no + '|' + q.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 10 < 6 ? 'R' : 'L'; };
  let ccPage = 0;
  // 見た目は自分の選手のカード（playerCardHTML）と同じ。ページは「選手情報」「習得スキル」の2つ
  function cpuCardHTML(tid, pi) {
    const list = cpuList(tid), q = list[pi], ro = C.rosterOfTeam(tid, save.season), tm = C.TEAM_BY_ID[tid] || {}, t = C.findTeam(save, tm.name) || {};
    const tt = C.titleOf(save, tid, q.name), G = (v) => D.grade(v), foot = cpuFoot(tid, q);
    const grades = D.PARAMS.map((pp) => `<div><b class="rk rk-${G(q[pp.k])}">${G(q[pp.k])}</b></div>`).join('');
    const icons = D.PARAMS.map((pp) => ico(pp.k)).join('');
    const role = tt ? `国内屈指の${tt}` : q.role === 'ace' ? 'エース' : q.role === 'core' ? '中心選手' : '';
    const pages = ['選手情報', '習得スキル'];
    let body;
    if (ccPage === 0) {
      body = `<div class="pc-st"><span class="pc-chip">利き足${footSVG(foot)}<small>${foot === 'L' ? '左' : '右'}</small></span><span class="pc-chip">${q.starter ? 'スタメン' : '控え'}</span></div>
        <div class="pc-car"><span>所属</span><b>${esc(tm.name || '')}</b><span>リーグ</span><b>${esc((C.LG[t.lg] || {}).name || '')}</b></div>`;
    } else {
      const sk = C.noSkillLg(t.lg) ? [] : q.skills || [];   // 版559：地域リーグのCPUはスキルなし
      const cells = sk.length ? sk.map((k) => `<button class="has pc-skb" data-sk="${k}">${esc((D.SKILLS[k] || {}).name || k)}<i>説明</i></button>`) : ['<span>なし</span>'];
      const uk = q.top && D.UNIQ_BY_TOP ? D.UNIQ_BY_TOP[q.top] : null, u = uk && D.UNIQ[uk];   // 国内屈指：その選手だけの固有スキル
      // 固有スキル：名前だけ出しておき、タップすると発動の条件と効果が開く
      const uq = u ? `<details class="pc-uq"><summary><span class="pc-uqh">固有スキル</span><b>${esc(u.name)}</b><i class="pc-uqi">説明</i></summary><div class="pc-uqd"><p><span>発動</span>${esc(u.sw || u.when)}</p><p><span>効果</span>${esc(u.se || u.what)}</p>${u.st ? `<p><span>凸</span>${esc(u.st)}</p>` : ''}</div></details>` : '';
      body = `${uq}<div class="pc-sk"><div class="pc-skh">習得スキル　${sk.length}</div><div class="pc-skg">${cells.join('')}</div><div class="pc-skd" hidden></div></div>`;
    }
    return `<div class="pc-card"><img class="pc-emb" src="${emblemURL(tm.name, 80)}" alt="">
      <div class="pc-head"><i class="pos ${POSC[q.pos]}">${q.pos}</i><b>${esc(q.name)}</b><span>${esc(tm.name || '')}</span></div>
      <div class="pc-main">
        <div class="pc-left">
          <div class="pc-photo">${cpuFace(tid, q, ro.kit.shirt)}<div class="pc-rare">${starHTML(C.starOf(tid, q), C.totsuOf(tid, q))}${capBadge(C.GRADES[C.capIdx(C.starOf(tid, q), C.totsuOf(tid, q))])}</div></div>
          <b class="pc-num">${q.no}</b>
          <div class="pc-meta"><span>タイプ</span>${typeBadge(q.type)}</div>
          ${role ? `<div class="pc-ttl${tt ? ' top' : q.role === 'ace' ? ' ace' : ''}"><i>${tt ? '♛' : q.role === 'ace' ? '★' : '◆'}</i><span>称号</span><b>${esc(role)}</b></div>` : ''}   <!-- 版470：役割ではなく「称号」 -->
        </div>
        <div class="pc-right">
          <div class="pc-icons">${icons}</div>
          <div class="pc-grades">${grades}</div>
          <div class="pc-page">${body}</div>
          <div class="pc-dots"><button class="pc-nav prev ui-img" title="前の選手"><img src="icons/ui_next.png" alt="前へ" style="transform:scaleX(-1)"></button>${pages.map((nm, k) => `<button data-pg="${k}" class="${k === ccPage ? 'on' : ''}">${nm}</button>`).join('')}<button class="pc-nav next ui-img" title="次の選手"><img src="icons/ui_next.png" alt="次へ"></button></div>
        </div>
      </div>
      <button class="sb-round pc-close" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button>
    </div>`;
  }
  function cpuCard(tid, pi, host, o = {}) {
    let el = document.getElementById('ccModal');
    if (!el) { el = document.createElement('div'); el.id = 'ccModal'; el.className = 'modal pc-wrap'; }
    if (el.parentNode !== host) host.appendChild(el);
    const n = cpuList(tid).length, go = (k) => cpuCard(tid, (k + n) % n, host), redraw = () => cpuCard(tid, pi, host, o);
    el.innerHTML = cpuCardHTML(tid, pi); el.hidden = false;
    bindSkillDesc(el);
    el.querySelectorAll('[data-pg]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); ccPage = +b.dataset.pg; redraw(); });
    el.querySelector('.pc-nav.prev').onclick = (e) => { e.stopPropagation(); go(pi - 1); };
    el.querySelector('.pc-nav.next').onclick = (e) => { e.stopPropagation(); go(pi + 1); };
    el.querySelector('.pc-close').onclick = () => { el.hidden = true; };
    el.onclick = (e) => { if (e.target === el) el.hidden = true; };
    if (o.noNav) el.querySelectorAll('.pc-nav').forEach((b) => b.remove());   /* 版470 */
  }
  // ---- チームの情報：監督・方針・フォーメーションと、固定の25人 ----
  function teamHTML(name, view) {
    view = view || 'info';
    const tabs = `<div class="cg-tabs tm-tabs">${[['info', 'チーム'], ['list', '選手データ'], ['xi', 'スタメン']].map(([k, l]) => `<button data-tmv="${k}" class="${view === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (view !== 'list') { const h = teamViewHTML(name, view); if (h) return h.replace('<!--tabs-->', tabs); }
    const t = C.findTeam(save, name), ro = t && C.rosterOfTeam(t.id, save.season);
    if (!ro) return `<div class="std-body"><div class="std-h"><span>${esc(name)}</span></div><p class="std-soon">選手の情報がありません</p></div>`;
    const KS = D.PARAM_KEYS, ovr = (q) => Math.round(KS.reduce((a, k) => a + q[k], 0) / KS.length), G = (v) => D.grade(v);
    const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
    const ps = cpuList(t.id);   // 選手カードと同じ並び（番号で選手を取り違えないように）
    const sk = (q) => C.noSkillLg(t.lg) ? '' : q.skills.slice(0, 3).map((k) => ((D.SKILLS[k] || {}).name || k)).join('・') + (q.skills.length > 3 ? ` ほか${q.skills.length - 3}` : '');
    const rows = ps.map((q, pi) => `<div class="tm-row${q.starter ? ' st' : ''}" data-pi="${pi}" data-tid="${t.id}"><span class="tm-no">${q.no}</span><i class="pos ${POSC[q.pos]}">${q.pos}</i><span class="tm-nm">${esc(q.name)}${starHTML(C.starOf(t.id, q), C.totsuOf(t.id, q), 'sm')}${C.titleOf(save, t.id, q.name) ? `<b class="tm-top" title="国内屈指の${esc(C.titleOf(save, t.id, q.name))}">国内屈指</b>` : ''}${C.titleOf(save, t.id, q.name) ? '' : q.role === 'ace' ? '<b class="tm-ace">エース</b>' : q.role === 'core' && !q.top ? '<b class="tm-core">中心</b>' : ''}</span><span class="tm-ty">${typeBadge(q.type, 'sm')}</span>${KS.map((k) => `<span class="tm-g"><b class="rk rk-${G(q[k])}">${G(q[k])}</b></span>`).join('')}<span class="tm-sk" title="${esc(q.skills.map((k) => (D.SKILLS[k] || {}).name || k).join('・'))}">${esc(sk(q))}</span></div>`).join('');
    const lg = (C.LG[t.lg] || {}).name || '';
    const rank = (q) => (C.titleOf(save, t.id, q.name) ? 0 : q.role === 'ace' ? 1 : 2);
    const stars = ro.players.filter((q) => starKey(t.id, q)).sort((a, b) => rank(a) - rank(b));
    const strip = stars.length ? `<div class="tm-stars">${stars.map((q) => { const tt = C.titleOf(save, t.id, q.name); return `<div class="tm-star r${rank(q)}" data-spi="${ps.indexOf(q)}" data-tid="${t.id}">${starPic(starKey(t.id, q), ro.kit.shirt, q.pos === 'GK', 'tm-sf')}<b>${esc(q.name)}</b><small>${tt ? '国内屈指' : q.role === 'ace' ? 'エース' : '中心選手'}・${q.pos}</small></div>`; }).join('')}</div>` : '';
    return `<div class="std-body"><div class="std-h"><span><img class="tv-emb" src="${emblemURL(name, 40)}" alt="">${esc(name)}</span>${tabs}<em>${lgBadge(t.lg)} ${esc(lg)}</em></div><div class="tm-head"><img src="${emblemURL(name, 96)}" alt=""><div><b>${esc(name)}</b><p>監督：${esc(ro.coach.name)}　方針：<em>${esc(ro.coach.policy)}</em>　フォーメーション：${esc(cpuForm(t.id, ro))}</p><small>${esc(ro.coach.desc)}</small></div>${strip}</div><div class="tm-cols"><span>No.</span><span>Pos.</span><span>選手</span><span>タイプ</span>${D.PARAMS.map((pp) => `<span class="tm-pk">${esc(pp.name.slice(0, 2))}</span>`).join('')}<span>スキル</span></div><div class="std-list">${rows}</div></div>`;
  }

  // 版511：相手チームの情報（カルチョビットAの、試合日程から相手を選んだ画面）：チーム（スタイル・対戦）／選手データ／スタメン
  const STYLE_SL = { balance: [0.5, 0.5, 0.5], possession: [0.65, 0.2, 0.45], counter: [0.3, 0.85, 0.3], highpress: [0.8, 0.5, 0.95], wing: [0.7, 0.6, 0.55] };
  const cpuForm = (id, ro) => { const lu = window.DOT_LINEUPS && window.DOT_LINEUPS[id]; return lu && Array.isArray(lu.cells) && lu.cells.length >= 11 ? C.formationLabel(lu.cells) : ro.formation; };   // 版787：手で決めた並びは、マスの人数から
  function teamViewHTML(name, view) {
    const t = C.findTeam(save, name), ro = t && C.rosterOfTeam(t.id, save.season); if (!ro) return null;
    const lgN = (C.LG[t.lg] || {}).name || '', shirt = (ro.kit || {}).shirt || '#e2453a';
    const head = `<div class="std-h"><span><img class="tv-emb" src="${emblemURL(name, 40)}" alt="">${esc(name)}</span><!--tabs--><em>${lgBadge(t.lg)} ${esc(lgN)}</em></div>`;
    if (view === 'xi') {
      let st = ro.players.filter((q) => q.starter); const bench = ro.players.filter((q) => !q.starter).slice(0, 7);
      // 版520：並びは、試合で実際に立つ場所（入れ替え・真ん中の指定をした後）と同じにする
      let cellsXI = null;
      try { const ct = C.cpuTeam(t.id), all = new Map(ro.players.map((q) => [q.name, q])), ord = ct.players.slice(0, 11).map((p) => all.get(p.name)).filter(Boolean); if (ord.length === 11) { st = ord; if (Array.isArray(ct.cells) && ct.cells.length >= 11 && ct.cells.slice(1, 11).every(Boolean)) cellsXI = ct.cells; } } catch (_) {}
      if (cellsXI) {   // 版787：手で決めた並び（lineups.js）は、マスの場所そのままに置く（FW＝上の帯、MF＝真ん中、DF＝下）
        const benchX = ro.players.filter((q) => !st.includes(q)).sort((a, b) => ({ GK: 0, DF: 1, MF: 2, FW: 3 }[a.pos] - { GK: 0, DF: 1, MF: 2, FW: 3 }[b.pos])).slice(0, 7);
        const yOf = (r) => (r >= 7 ? 40 + (9 - r) * 38 : r >= 3 ? 160 + (6 - r) * 36 : 304 + (2 - r) * 36), xOf = (c) => 30 + 700 * (c + 0.5) / 15;
        const outX = [{ q: st[0], x: 380, y: 432 }, ...st.slice(1).map((q, i) => ({ q, x: xOf(cellsXI[i + 1].c), y: yOf(cellsXI[i + 1].r) }))];
        // 版788：縦に近い2人（顔と名前が重なる）は、上下に押し広げる。横に近い時も少しずらす（場所の前後・左右の関係は変えない）
        for (let it = 0; it < 30; it++) {
          let moved = false;
          for (let a = 1; a < outX.length; a++) for (let b2 = 1; b2 < outX.length; b2++) {
            if (a === b2) continue; const A = outX[a], B = outX[b2];
            if (A.y > B.y || Math.abs(A.x - B.x) >= 74) continue;   // A が上（yが小さい）
            const need = 96 - (B.y - A.y); if (need <= 0) continue;
            A.y = Math.max(28, A.y - need / 2); B.y = Math.min(400, B.y + need / 2); moved = true;
          }
          if (!moved) break;
        }
        for (let a = 1; a < outX.length; a++) for (let b2 = a + 1; b2 < outX.length; b2++) {   // 上下に広げきれない時は、横に少し離す
          const A = outX[a], B = outX[b2]; if (Math.abs(A.y - B.y) >= 90 || Math.abs(A.x - B.x) >= 74) continue;
          const d = (74 - Math.abs(A.x - B.x)) / 2, sg = A.x <= B.x ? -1 : 1; A.x += sg * d; B.x -= sg * d;
        }
        const chipX = (q, x, y, cls) => `<div class="tx-p ${cls || ''}" style="left:${x}px;top:${y}px" data-pi="${cpuList(t.id).indexOf(q)}" data-tid="${t.id}">${(C.faceKeyOf(t.id, q) ? starPic(C.faceKeyOf(t.id, q), shirt, q.pos === 'GK', 'tx-f') : '<i class="tx-f"></i>')}<b class="${POSC[q.pos]}">${esc(q.name)}</b></div>`;
        const fl = C.formationLabel(cellsXI);
        return `<div class="std-body">${head}<div class="tx"><div class="tx-in"><div class="tx-pitch">${['FW', 'MF', 'DF'].map((z, k) => `<i class="tx-z z${k}">${z}</i>`).join('')}<i class="tx-box"></i>${outX.map((o) => chipX(o.q, o.x, o.y)).join('')}</div><div class="tx-bench"><b>控え</b>${benchX.map((q, k) => chipX(q, 60, 66 + k * 60, 'bn')).join('')}</div><p class="tx-note">${esc(fl)}<small>いつもの先発。試合の日は疲れやケガで変わることもあります</small></p></div></div></div>`;
      }
      const line = (pos) => st.filter((q) => q.pos === pos);
      const form = String(ro.formation || '4-4-2').split('-').map(Number), W = 760, H = 470;
      const rows = [['GK', line('GK')], ...[['DF', line('DF')], ['MF', line('MF')], ['FW', line('FW')]]];
      // MFが2列のフォーメーション（4-2-3-1など）は、MFを前と後ろに分ける
      const mfRows = form.length > 3 ? form.slice(1, -1) : [line('MF').length];
      const out = []; let mfs = line('MF').slice(), y = H - 50;
      const put = (arr, yy) => arr.forEach((q, k) => out.push({ q, x: 60 + (W - 120) * (k + 1) / (arr.length + 1), y: yy }));
      put(line('GK'), H - 40); put(line('DF'), H - 150);
      const nRow = mfRows.length; mfRows.forEach((n, k) => { const arr = mfs.splice(0, n); put(arr, H - 150 - (k + 1) * (230 / (nRow + 1)) - 10); });
      if (mfs.length) put(mfs, 200); put(line('FW'), 70);
      const chip = (q, x, y, cls) => `<div class="tx-p ${cls || ''}" style="left:${x}px;top:${y}px" data-pi="${cpuList(t.id).indexOf(q)}" data-tid="${t.id}">${(C.faceKeyOf(t.id, q) ? starPic(C.faceKeyOf(t.id, q), shirt, q.pos === 'GK', 'tx-f') : '<i class="tx-f"></i>')}<b class="${POSC[q.pos]}">${esc(q.name)}</b></div>`;
      return `<div class="std-body">${head}<div class="tx"><div class="tx-in"><div class="tx-pitch">${['FW', 'MF', 'DF'].map((z, k) => `<i class="tx-z z${k}">${z}</i>`).join('')}<i class="tx-box"></i>${out.map((o) => chip(o.q, o.x, o.y)).join('')}</div><div class="tx-bench"><b>控え</b>${bench.map((q, k) => chip(q, 60, 66 + k * 60, 'bn')).join('')}</div><p class="tx-note">${esc(ro.formation)}<small>いつもの先発。試合の日は疲れやケガで変わることもあります</small></p></div></div></div>`;
    }
    // チーム（スタイル・対戦）
    const sl = STYLE_SL[ro.style] || STYLE_SL.balance, tblRank = (() => { try { const stn = C.standings(save); const k = stn.findIndex((x) => x.name === name); return k >= 0 ? `${k + 1}位` : ''; } catch (_) { return ''; } })();
    const slider = (l, r, v) => `<div class="tv-sl"><span>${l}</span><i><b style="left:${Math.round(v * 100)}%"></b></i><span>${r}</span></div>`;
    const lg = save.league, me = lg.teams.findIndex((x) => x.me), them = lg.teams.findIndex((x) => x.name === name), games = [];
    if (them >= 0) lg.rounds.forEach((pairs, r) => { const pr = pairs.find(([a, b]) => (a === me && b === them) || (a === them && b === me)); if (!pr) return; const res = lg.results[r] && lg.results[r].find((x) => x.a === pr[0] && x.b === pr[1]), home = pr[0] === me; games.push(`<div class="tv-g"><i class="tv-ha ${home ? 'h' : 'a'}">${home ? 'H' : 'A'}</i><span>第${r + 1}節</span>${res ? (() => { const sc = home ? res.s : [res.s[1], res.s[0]]; return `<b class="${sc[0] > sc[1] ? 'w' : sc[0] < sc[1] ? 'l' : 'd'}">${sc[0]}−${sc[1]}</b>`; })() : '<em>これから</em>'}</div>`); });
    const ace = ro.players.filter((q) => q.top || q.role === 'ace').slice(0, 3);
    return `<div class="std-body">${head}<div class="tv"><div class="tv-in">
      <div class="tv-l"><div class="tv-hd"><img src="${emblemURL(name, 96)}" alt=""><div><b>${esc(name)}</b><small>（${esc(stadiumName({ name, short: t.short }, {}))}）</small><p>${lgBadge(t.lg)} ${esc(lgN)}　<em>${esc(tblRank)}</em></p></div></div>
        <div class="tv-co"><b>監督　${esc(ro.coach.name)}</b><span>方針：${esc(ro.coach.policy)}　／　${esc(cpuForm(t.id, ro))}</span><small>${esc(ro.coach.desc)}</small></div>
        <div class="tv-st"><div class="tv-sh">スタイル</div>${slider('守備的', '攻撃的', sl[0])}<div class="tv-sh">攻め方</div>${slider('パスでつなぐ', 'すばやく縦へ', sl[1])}<div class="tv-sh">守り方</div>${slider('引いて守る', '前から奪う', sl[2])}</div></div>
      <div class="tv-r"><div class="tv-rh">対戦</div>${games.join('') || '<p class="std-soon">今シーズンのリーグ戦では当たりません</p>'}
        ${ace.length ? `<div class="tv-rh">注目の選手</div>${ace.map((q) => `<div class="tv-ace" data-pi="${cpuList(t.id).indexOf(q)}" data-tid="${t.id}">${(C.faceKeyOf(t.id, q) ? starPic(C.faceKeyOf(t.id, q), shirt, q.pos === 'GK', 'tv-af') : '')}<div><b>${esc(q.name)}</b><small>${esc(q.pos)}・${esc(q.type)}</small>${starHTML(C.starOf(t.id, q), C.totsuOf(t.id, q), 'sm')}</div></div>`).join('')}` : ''}</div>
    </div></div></div>`;
  }
  // 版834：監督成績（作り込み）。左に監督のプロフィールとタイトル、右に通算成績・今シーズン・シーズンごとの成績・クラブの得点ランキング
  function mgrHTML() {
    const lg = save.league, st = C.standings(save), pos = st.findIndex((t) => t.me) + 1, me = st.find((t) => t.me) || { stats: { W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0, P: 0 } }, cur = me.stats;
    const H = save.history || [], tro = save.trophies || [], on = save.online || {};
    const tot = { W: cur.W, D: cur.D, L: cur.L, GF: cur.GF, GA: cur.GA };
    for (const h of H) if (h.rec) for (const k in tot) tot[k] += h.rec[k] || 0;
    const games = tot.W + tot.D + tot.L, wr = games ? Math.round(tot.W / games * 100) : 0;
    const nLg = tro.filter((t) => t.kind === 'league').length, nCup = tro.filter((t) => t.kind === 'cup').length, nUp = H.filter((h) => h.move === 'up' || /昇格/.test(h.msg || '')).length;
    const lgIdOf = (name) => (C.LEAGUES.find((l) => l.name === name) || {}).id || Object.keys(C.LG).find((k) => C.LG[k].name === name) || '';
    const mv = (h) => { const m = h.move || (/昇格/.test(h.msg) ? 'up' : /降格/.test(h.msg) ? 'dn' : 'st'); return `<b class="mg-mv ${m}">${m === 'up' ? '昇格' : m === 'dn' ? '降格' : '残留'}</b>`; };
    const rows = H.slice().reverse().map((h) => { const id = h.lgId || lgIdOf(h.league), r = h.rec;
      return `<tr><td>${h.season}</td><td class="lg">${id ? lgBadge(id) : ''}${esc(h.league)}</td><td class="ps${h.pos === 1 ? ' g' : ''}">${h.pos}位</td><td>${r ? `${r.W}勝${r.D}分${r.L}敗` : '—'}</td><td>${r ? `${r.GF}−${r.GA}` : '—'}</td><td>${mv(h)}</td><td>${h.cup ? '<b class="mg-cup">🏆 カップ</b>' : ''}</td></tr>`; }).join('');
    // クラブの得点ランキング（今いる選手の、このクラブでの通算）
    const club = save.team.short || save.team.name, all = [...save.team.players, ...(save.reserve || [])];
    const sc = all.map((p) => { let G = 0, A = 0, P = 0; for (const k in p.rec || {}) { const r = p.rec[k]; if (r.club === club) { G += r.G || 0; A += r.A || 0; P += r.P || 0; } } return { p, G, A, P }; }).filter((x) => x.P > 0).sort((a, b) => b.G - a.G || b.A - a.A).slice(0, 5);
    const trCups = `${Array.from({ length: Math.min(nLg, 6) }, () => `<img src="${trophyImg('league')}" alt="">`).join('')}${Array.from({ length: Math.min(nCup, 6) }, () => `<img src="${trophyImg('cup')}" alt="">`).join('')}`;
    const tile = (l, v, u) => `<div class="mg-t"><small>${l}</small><b>${v}${u ? `<em>${u}</em>` : ''}</b></div>`;
    return `<div class="std-body"><div class="std-h"><span>監督成績</span></div><div class="mg2">
      <div class="mg2-l"><div class="mg2-pf"><img class="mg2-emb" src="${emblemURL(save.team.name, 120)}" alt=""><small>監督</small><b class="mg2-nm">${esc(save.manager || '監督')}</b><span class="mg2-cl">${esc(save.team.name)}</span><span class="mg2-yr">就任 <b>${save.season}</b> 年目</span>${on.rp != null ? rankBadge(rankIdx(on.rp), true) : ''}</div>
        <div class="mg2-tr"><div class="mg2-trh">獲得タイトル</div><div class="mg2-trc">${trCups || '<span class="none">まだありません</span>'}</div><div class="mg2-trn"><span>リーグ優勝 <b>${nLg}</b></span><span>カップ優勝 <b>${nCup}</b></span><span>昇格 <b>${nUp}</b></span></div></div></div>
      <div class="mg2-r">
        <div class="mg2-sh">通算成績</div><div class="mg-ts">${tile('試合', games)}${tile('勝ち', tot.W)}${tile('分け', tot.D)}${tile('負け', tot.L)}${tile('勝率', wr, '%')}${tile('得点', tot.GF)}${tile('失点', tot.GA)}</div>
        <div class="mg2-sh">今シーズン</div><div class="mg2-now">${lgBadge(save.world && save.world.me || lg.id)}<b>${esc(lg.name)}</b><span class="ps">${pos}位</span><span>${cur.W}勝 ${cur.D}分 ${cur.L}敗</span><span>得点 ${cur.GF}・失点 ${cur.GA}</span><span>勝ち点 <b>${cur.Pts}</b></span></div>
        <div class="mg2-sh">これまでのシーズン</div>${rows ? `<table class="mg2-tb"><tr><th>シーズン</th><th>リーグ</th><th>順位</th><th>成績</th><th>得失</th><th>結果</th><th></th></tr>${rows}</table>` : '<p class="std-soon">まだありません（シーズンが終わると、ここに残ります）</p>'}
        <div class="mg2-sh">クラブの得点ランキング（今の選手の通算）</div>${sc.length ? `<div class="mg2-sc">${sc.map((x, k) => `<div><i>${k + 1}</i><b>${esc(x.p.name)}</b><small>${esc(x.p.position || '')}</small><span>${x.G}<em>点</em></span><span>${x.A}<em>アシスト</em></span><span>${x.P}<em>試合</em></span></div>`).join('')}</div>` : '<p class="std-soon">まだ公式戦の記録がありません</p>'}
      </div></div></div>`;
  }
  let assocBefore = null;   // 試合の前の順位（順位表の矢印）

  // ================= クラブ設定：名前・ユニフォーム・エンブレム =================
  const PALETTE = ['#d8202a', '#e2453a', '#f28a1a', '#f2c41a', '#ffd23a', '#7fbf3a', '#2f9e44', '#0e5e6e', '#1a8fd0', '#7fd0ff', '#2f6fd6', '#1f3a8a', '#14205a', '#6a1fb0', '#5a2a8a', '#d84a7a', '#f2a3b0', '#8a5a2a', '#e0c27a', '#ffffff', '#c0c8d0', '#6e7480', '#2a2a2a', '#b8642a'];
  const KIT_PATS = [['solid', '無地'], ['vstripe', '縦じま'], ['hstripe', '横じま'], ['band', '胸ライン'], ['sash', 'たすき'], ['half', 'ハーフ']];
  const EMB_SHAPES = [[0, '盾'], [1, '丸'], [2, '紋章'], [3, 'ひし形'], [4, '六角形'], [5, 'ペナント']];
  const EMB_PATS = [[1, '2色'], [0, '縦じま'], [2, 'ななめ帯'], [3, '横帯'], [5, '十字'], [4, '無地']];
  const EMB_ICONS = [['ball', 'ボール'], ['star', '星'], ['crown', '王冠'], ['bolt', 'いなずま'], ['wing', 'つばさ'], ['wave', '波'], ['sun', '太陽'], ['mountain', '山'], ['flame', 'ほのお'], ['leaf', '葉'], ['castle', 'お城'], ['heart', 'ハート'], ['none', 'なし']];
  let clubTab = 'name';
  function openClub(opt) {
    opt = opt || {};
    const el = fullScreen('clubScreen', 'std-wrap club-wrap'), box = el.querySelector('.lk-box');
    const club = C.ensureClub(save);
    const st = { name: save.team.name, short: save.team.short || '', kit: null, kits: { home: { ...club.kit }, away: { ...club.kit2 }, gk: { ...club.gk } }, kside: 'home', emb: { ...club.emb }, err: '', home: save.hometown || '' }; st.kit = st.kits.home;
    clubTab = opt.first ? 'name' : clubTab;
    const embOf = () => ({ ...st.emb, ch: st.emb.ch || (st.short || st.name || 'H')[0] });
    const embCanvas = (lk, size) => { const cv = document.createElement('canvas'); cv.width = size; cv.height = size; drawEmblem(cv.getContext('2d'), size / 2, size / 2, size * 0.92, lk); return cv.toDataURL(); };
    const sw = (key, cur) => `<div class="cl-sw">${PALETTE.map((c) => `<button data-col="${key}" data-v="${c}" class="${cur.toLowerCase() === c ? 'on' : ''}" style="background:${c}" title="${c}"></button>`).join('')}<label class="cl-pick" title="好きな色"><input type="color" data-colin="${key}" value="${cur}"><span>他の色</span></label></div>`;
    const draw = () => {
      const lk = embOf(), ps = save.team.players;
      const preview = `<div class="cl-prev"><img class="cl-emb" src="${embCanvas(lk, 240)}" alt=""><div class="cl-name"><b>${esc(st.name || 'クラブ名')}</b><small>略称：${esc(st.short || '―')}</small></div><div class="cl-kits" id="clKits"></div></div>`;
      let body = '';
      if (clubTab === 'name') body = `<div class="cl-form">${!save.clubSet ? `<label>ホームタウン<select id="clHome"><option value="">（選んでください）</option>${C.PREFS.map((pf) => `<option${st.home === pf ? ' selected' : ''}>${pf}</option>`).join('')}</select></label><p class="cl-note">ホームタウンで、最初に入る地域リーグが決まります（北海道〜中部は<b>東</b>、三重〜沖縄は<b>西</b>）。あとから変えられません。</p>` : `<p class="cl-note">ホームタウン：<b>${esc(save.hometown || '高知県')}</b>（地域リーグ${(save.world && save.world.region) === 'E' ? '東' : '西'}）</p>`}<label>クラブ名<input id="clName" maxlength="12" value="${esc(st.name)}" placeholder="例：はじまりサンライズFC"></label><p class="cl-note">12文字まで。ほかのチームと同じ名前は使えません。</p><label>略称（試合の点数の横に出る名前）<input id="clShort" maxlength="6" value="${esc(st.short)}" placeholder="例：はじまり"></label><p class="cl-note">6文字まで。空にすると、クラブ名から自動で作ります。</p>${st.err ? `<p class="cl-err">${esc(st.err)}</p>` : ''}</div>`;   /* 版474：やり直し（初期化）はクラブ事務所の「退任」だけ */
      else if (clubTab === 'kit') body = `<div class="cl-form"><div class="cl-kside">${[['home', 'ホーム'], ['away', 'アウェー'], ['gk', 'GK']].map(([k, l]) => `<button data-kside="${k}" class="${st.kside === k ? 'on' : ''}">${l}</button>`).join('')}</div>${st.kside === 'gk' ? '<p class="cl-note">GK（ゴールキーパー）のユニフォームです。試合の時、GKだけこの色になります（無地）。</p>' : `<div class="cl-h">柄</div><div class="cl-opts">${KIT_PATS.map(([k, l]) => `<button data-kpat="${k}" class="${st.kit.pat === k ? 'on' : ''}">${l}</button>`).join('')}</div>`}
        <div class="cl-h">シャツの色</div>${sw('shirt', st.kit.shirt)}${st.kside === 'gk' ? '' : `<div class="cl-h">シャツの柄の色${st.kit.pat === 'solid' ? '<small>（無地のときは使いません）</small>' : ''}</div>${sw('sub', st.kit.sub)}`}<div class="cl-h">パンツの色</div>${sw('shorts', st.kit.shorts)}<div class="cl-h">ソックスの色</div>${sw('socks', st.kit.socks)}</div>`;
      else body = `<div class="cl-form"><div class="cl-h">形</div><div class="cl-opts img">${EMB_SHAPES.map(([k, l]) => `<button data-eshape="${k}" class="${st.emb.shape === k ? 'on' : ''}"><img src="${embCanvas({ ...lk, shape: k }, 56)}" alt="">${l}</button>`).join('')}</div>
        <div class="cl-h">模様</div><div class="cl-opts img">${EMB_PATS.map(([k, l]) => `<button data-epat="${k}" class="${st.emb.pat === k ? 'on' : ''}"><img src="${embCanvas({ ...lk, pat: k }, 56)}" alt="">${l}</button>`).join('')}</div>
        <div class="cl-h">マーク</div><div class="cl-opts img">${EMB_ICONS.map(([k, l]) => `<button data-eicon="${k}" class="${st.emb.icon === k ? 'on' : ''}"><img src="${embCanvas({ ...lk, icon: k }, 56)}" alt="">${l}</button>`).join('')}</div>
        <div class="cl-h">上の文字<small>（1〜2文字。空なら略称の1文字目）</small></div><input id="clCh" class="cl-ch" maxlength="2" value="${esc(st.emb.ch || '')}">
        <div class="cl-h">土台の色</div>${sw('c1', st.emb.c1)}<div class="cl-h">模様の色</div>${sw('c2', st.emb.c2)}<div class="cl-h">マークと文字の色</div>${sw('c3', st.emb.c3)}</div>`;
      const scKeep = (() => { const b0 = box.querySelector('.cl-body'), s0 = box.querySelector('.cl-side'); return [b0 ? b0.scrollTop : 0, s0 ? s0.scrollTop : 0, box._clTab]; })(); box._clTab = clubTab;   /* 版473：色などを選んでも、スクロールの位置をそのままに */
      box.innerHTML = `<div class="std cl"><div class="cl-top"><b>${opt.only ? { name: 'チーム名変更', kit: 'ユニフォーム', emb: 'エンブレム' }[opt.only] : 'クラブ設定'}</b><span>${opt.first ? 'あなたのクラブを作りましょう' : opt.only ? { name: 'クラブ名と略称', kit: 'ホーム・アウェーのユニフォーム', emb: 'クラブのエンブレム' }[opt.only] : '名前・ユニフォーム・エンブレム'}</span>${opt.first ? '' : '<button class="std-back" title="もどる（変えない）"><i class="bk-ico" aria-hidden="true"></i></button>'}</div>
        ${preview}<div class="cl-side"><div class="std-tabs cl-tabs"${opt.only ? ' hidden' : ''}>${[['name', '名前'], ['kit', 'ユニフォーム'], ['emb', 'エンブレム']].map(([k, l]) => `<button data-ctab="${k}" class="${clubTab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="cl-body">${body}</div><button class="cl-ok">決定</button></div></div>`;
      if (scKeep[2] === clubTab) requestAnimationFrame(() => { const b1 = box.querySelector('.cl-body'), s1 = box.querySelector('.cl-side'); if (b1) b1.scrollTop = scKeep[0]; if (s1) s1.scrollTop = scKeep[1]; });
      // ユニフォームの見本（正面・ななめ・GKなしの3人）
      const kits = box.querySelector('#clKits');
      for (const [view, p] of [['front', ps[9]], ['f34', ps[5]], ['side', ps[2]]]) { const cv = A().kitSprite(st.kit, p || {}, view); if (cv) { const im = document.createElement('canvas'); im.width = cv.width * 6; im.height = cv.height * 6; const c = im.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(cv, 0, 0, im.width, im.height); kits.appendChild(im); } }
      const keep = () => { const n = box.querySelector('#clName'), sh = box.querySelector('#clShort'), ch = box.querySelector('#clCh'), hm = box.querySelector('#clHome'); if (hm) st.home = hm.value; if (n) st.name = n.value; if (sh) st.short = sh.value; if (ch) st.emb.ch = ch.value; };
      box.querySelectorAll('[data-ctab]').forEach((b) => b.onclick = () => { keep(); clubTab = b.dataset.ctab; draw(); });
      box.querySelectorAll('[data-kside]').forEach((b) => b.onclick = () => { st.kside = b.dataset.kside; st.kit = st.kits[st.kside]; draw(); });
      box.querySelectorAll('[data-kpat]').forEach((b) => b.onclick = () => { st.kit.pat = b.dataset.kpat; draw(); });
      box.querySelectorAll('[data-eshape]').forEach((b) => b.onclick = () => { keep(); st.emb.shape = +b.dataset.eshape; draw(); });
      box.querySelectorAll('[data-epat]').forEach((b) => b.onclick = () => { keep(); st.emb.pat = +b.dataset.epat; draw(); });
      box.querySelectorAll('[data-eicon]').forEach((b) => b.onclick = () => { keep(); st.emb.icon = b.dataset.eicon; draw(); });
      const setCol = (key, v) => { if (key in st.kit) st.kit[key] = v; else st.emb[key] = v; };
      box.querySelectorAll('[data-col]').forEach((b) => b.onclick = () => { keep(); setCol(b.dataset.col, b.dataset.v); draw(); });
      box.querySelectorAll('[data-colin]').forEach((inp) => inp.onchange = () => { keep(); setCol(inp.dataset.colin, inp.value); draw(); });
      ['#clName', '#clShort', '#clCh'].forEach((q) => { const i = box.querySelector(q); if (i) i.oninput = () => { keep(); const pv = box.querySelector('.cl-name b'), ps2 = box.querySelector('.cl-name small'), em = box.querySelector('.cl-emb'); if (pv) pv.textContent = st.name || 'クラブ名'; if (ps2) ps2.textContent = '略称：' + (st.short || '―'); if (em) em.src = embCanvas(embOf(), 240); }; });
      const rz = box.querySelector('#clReset');
      if (rz) rz.onclick = async () => { const ok = await coachAsk('監督、最初からやり直しますか？<br>育てた選手・順位は、すべて消えます。'); if (ok) { el.hidden = true; save = C.newCareer(); store(); runners.length = 0; go('home'); open(); } };
      const back = box.querySelector('.std-back'); if (back) back.onclick = () => { el.hidden = true; if (opt.onDone) opt.onDone(false); };
      box.querySelector('.cl-ok').onclick = () => {
        keep();
        if (!save.clubSet && !st.home) { st.err = 'ホームタウンを選んでください'; clubTab = 'name'; draw(); return; }
        if (!String(st.name).trim()) { st.err = 'クラブ名を入れてください'; clubTab = 'name'; draw(); return; }
        if (!C.renameClub(save, st.name, st.short)) { st.err = 'その名前は使えません（ほかのチームと同じ名前です）'; clubTab = 'name'; draw(); return; }
        save.club.kit = { ...st.kits.home }; save.club.kit2 = { ...st.kits.away }; save.club.gk = { ...st.kits.gk, pat: 'solid' }; save.club.emb = { ...st.emb }; if (!save.clubSet && st.home) C.setHometown(save, st.home); save.clubSet = true;   /* 版766：ホームタウンで東西のリーグが決まる */
        embURL.clear(); bannerCache.clear(); store();
        el.hidden = true; if (opt.onDone) opt.onDone(true); else if (view === 'home') renderHome();
      };
    };
    draw(); el.hidden = false; el._fit();
  }


  // ---------- 秘書：クラブハウスに戻ったところで、サポーターの支持率 ----------
  // コーチ・秘書の絵：staff/coach.png・staff/secretary.png があればそれを使う（ないあいだは仮の顔）
  const STAFF_ART = { coach: 'staff/coach.png', sec: 'staff/secretary.png' }, staffImg = {};
  for (const k in STAFF_ART) { const im = new Image(); im.onload = () => { staffImg[k] = STAFF_ART[k]; }; im.src = STAFF_ART[k]; }
  const staffFace = (k) => staffImg[k] || faceOf(STAFF[k]);
  let clubBg = null;
  function clubhouseBg() {
    if (clubBg) return clubBg;
    // ホームの街の絵を、クラブハウスに寄せて描き直す（夕方の暗さ）
    const [cx, cy] = iso(18.0, 10.9, 0.6), s = 3.2;
    const cv = buildTown({ s, x: cx - 760 / s, y: cy - 400 / s });
    const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = 'rgba(24,22,40,0.42)'; c.fillRect(0, 0, 1280, 720);
    const g = c.createRadialGradient(780, 380, 80, 780, 380, 760); g.addColorStop(0, 'rgba(255,220,150,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.35)'); c.fillStyle = g; c.fillRect(0, 0, 1280, 720);
    return (clubBg = cv.toDataURL());
  }
  // 版588：トロフィーの絵（監督の絵）。リーグごとに違う。カップは今は金（D1）と同じ
  const trophyImg = (kind, lgId) => { if (kind === 'cup') return 'img/trophy/cup.png'; const id = lgId || save.league.id; return `img/trophy/${/^reg.2/.test(id) ? 'reg2' : /^reg.1/.test(id) ? 'reg1' : id}.png`; };
  // ================= 版580：優勝 =================
  // 試合の最後に出す演出のための情報（app.js の優勝演出が使う）
  function champView(fx, sc) {
    const ch = C.champPeek(save, fx, sc); if (!ch) return null;
    const ps = save.team.players.slice(0, 18);
    return { ...ch, team: save.team.name, short: save.team.short || save.team.name, faces: ps.map((p) => faceOf(p)).filter(Boolean), emb: emblemURL(save.team.name, 96), trophy: trophyImg(ch.kind),
      sec: staffImg.sec || '', small: ch.kind === 'cup' ? 'DOT SOCCER CUP' : 'DOT SOCCER LEAGUE' };
  }
  // だれかが話す画面（背景・顔・名前・文）。タップで次へ
  function talkScreen(lines, bg) {
    const el = fullScreen('talkScreen', 'sec-wrap2'), box = el.querySelector('.lk-box');
    return new Promise(async (res) => {
      let k = 0;
      box.innerHTML = `${bg}<img class="sec-face" alt="" hidden><div class="sec-band"><b class="sec-name"></b><p></p><i class="lk-more">▶</i></div>`;   /* 版760：背景は1回だけ。めくる時は顔と文字だけ変える（点滅しないように） */
      const draw = () => { const L = lines[k], f = box.querySelector('.sec-face'); if (L.face) { if (f.getAttribute('src') !== L.face) f.src = L.face; f.className = 'sec-face' + (L.art ? ' art' : ''); f.hidden = false; } else f.hidden = true; box.querySelector('.sec-name').textContent = L.name || ''; box.querySelector('.sec-band p').innerHTML = esc(L.text).replace(/\n/g, '<br>'); };
      draw(); el.hidden = false; el._fit();
      await blackClear(350);
      el.onclick = async () => { k++; if (k >= lines.length) { el.onclick = null; await blackFade(300); el.hidden = true; res(); } else draw(); };
    });
  }
  // トロフィーの部屋：台の上にトロフィーが光って出てくる
  const TROPHY_SVG = (c1, c2) => `<svg viewBox="0 0 120 170" class="tr-cup"><defs><linearGradient id="tg${c1.slice(1)}" x1="0" x2="1"><stop offset="0" stop-color="${c2}"/><stop offset=".45" stop-color="#fff"/><stop offset=".6" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <path d="M14 18h92c0 34-14 58-38 66v26h-16V84C28 76 14 52 14 18z" fill="url(#tg${c1.slice(1)})" stroke="#555" stroke-width="2"/><path d="M14 26C2 26 2 52 22 58M106 26c12 0 12 26-8 32" fill="none" stroke="${c1}" stroke-width="7" stroke-linecap="round"/>
    <path d="M44 110h32l8 30H36z" fill="url(#tg${c1.slice(1)})" stroke="#555" stroke-width="2"/><rect x="28" y="140" width="64" height="24" rx="3" fill="#2a2a2a" stroke="#777" stroke-width="2"/><rect x="40" y="146" width="40" height="10" rx="2" fill="${c1}"/></svg>`;
  function trophyHTML(ch, anim) {
    const lgName = (C.LG[save.league.id] || {}).name || 'リーグ', got = (save.trophies || []).filter((t) => t.season === save.season);
    const slots = [{ kind: 'league', label: lgName, c: ['#d9dde3', '#7d8590'] }, { kind: 'cup', label: '国内カップ', c: ['#ffd84a', '#a86f00'] }];
    const cup = (s) => `<img class="tr-cup" src="${trophyImg(s.kind)}" alt="">`;
    return `<div class="tr-bg"></div><div class="tr-floor"></div>${slots.map((s, i) => { const has = got.some((g) => g.kind === s.kind), now = anim && s.kind === ch.kind;
      return `<div class="tr-slot${has ? ' has' : ''}${now ? ' now' : ''}" style="left:${300 + i * 560}px"><i class="tr-spot"></i>${cup(s)}<b>${esc(s.label)}</b></div>`; }).join('')}`;
  }
  function trophyRoom(ch) {
    const el = fullScreen('trophyScreen', 'tr-wrap'), box = el.querySelector('.lk-box');
    const lgName = (C.LG[save.league.id] || {}).name || 'リーグ', got = (save.trophies || []).filter((t) => t.season === save.season);
    const slots = [{ kind: 'league', label: lgName, c: ['#d9dde3', '#7d8590'] }, { kind: 'cup', label: '国内カップ', c: ['#ffd84a', '#a86f00'] }];
    box.innerHTML = trophyHTML(ch, true);
    el.hidden = false; el._fit();
    try { DotSound.play('reveal5'); setTimeout(() => DotSound.play('uniq'), 900); } catch (_) {}
    return new Promise(async (res) => { await blackClear(350); const go = async () => { el.onclick = null; await blackFade(300); el.hidden = true; res(); }; el.onclick = go; setTimeout(() => { if (el.onclick) go(); }, 4200); });
  }
  async function champAfter(ch) {
    await facesReady();
    const ps = save.team.players.slice(0, 11).filter((p) => !p.gk && p.position !== 'GK'), p = ps[Math.floor(Math.random() * ps.length)] || save.team.players[0];
    const name = save.team.name, title = ch.kind === 'cup' ? '国内カップ' : ch.title;
    const lines = [];
    if (ch.kind === 'league' && ch.last) lines.push({ name: p.name, face: faceOf(p), text: 'リーグ戦の全試合が終わりました。' });   // 版834：「全日程が終了」は1月の入れ替え戦などが終わった後
    lines.push({ name: p.name, face: faceOf(p), text: `監督、${title}を制覇しましたね！\n${name}でプレーできて幸せです。` });
    await talkScreen(lines, `<img class="sec-bg" src="${clubhouseBg()}" alt="">`);
    await trophyRoom(ch);
    const k = (save.trophies || []).filter((t) => t.season === save.season).length;
    const sec = { name: '秘書', face: staffFace('sec'), art: !!staffImg.sec };
    const lines2 = [{ ...sec, text: k >= 2 ? `監督、今期${k}つ目のタイトルです！\n二冠達成、おめでとうございます！` : `監督、今期1つ目のタイトルを獲得しましたね！` },
      { ...sec, text: k >= 2 ? 'このチームなら、どこまでも行けそうですね。\n来シーズンも、もっと上を目指しましょう。' : 'このタイトルを自信にして、\n来シーズンはもっと上を目指しましょう。' }];
    await talkScreen(lines2, `<div class="tr-dim">${trophyHTML(ch, false)}</div>`);
  }
  async function postSecretary(info) {
    await facesReady();
    const v = info.off.support, nm = save.team.name;
    const lines = v >= 90 ? [`サポーターの一番の心配事は、監督が${nm}からいなくなることだそうです。`, '愛されてますね！'] :
      v >= 70 ? ['サポーターの期待が、どんどん高まっていますよ。', 'この調子でいきましょう！'] :
      v >= 45 ? ['サポーターは、もう少し結果を見たいようです。', '次の試合が大事ですね。'] : ['サポーターから、厳しい声が上がっています…。', 'なんとか巻き返しましょう。'];
    const el = fullScreen('secScreen', 'sec-wrap2'), box = el.querySelector('.lk-box');
    const old = document.getElementById('stdScreen');
    return new Promise(async (res) => {
      let k = 0;
      const draw = () => { box.innerHTML = `<img class="sec-bg" src="${clubhouseBg()}" alt=""><div class="sec-rate"><span>支持率</span><b>${v}%</b>${info.off.delta ? `<em class="${info.off.delta > 0 ? 'u' : 'd'}">${info.off.delta > 0 ? '▲' : '▼'}${Math.abs(info.off.delta)}</em>` : ''}</div><img class="sec-face${staffImg.sec ? ' art' : ''}" src="${staffFace('sec')}" alt=""><div class="sec-band"><b class="sec-name">秘書</b><p>${esc(lines[k])}</p><i class="lk-more">▶</i></div>`; };
      draw(); el.hidden = false; el._fit(); if (old) old.hidden = true;
      await blackClear(350);
      el.onclick = async () => { k++; if (k >= lines.length) { el.onclick = null; await blackFade(300); el.hidden = true; res(); blackClear(350); } else draw(); };
    });
  }

  // ---- 昇格・降格：ホームの会場が変わる（秘書が案内） ----
  const VENUE_TALK = {
    1: ['地域1部にふさわしい会場として、小さなスタンドのある「運動公園」が使えるようになりました。', 'お客さんも、少しずつ来てくれるはずです！'],
    2: ['D3からは、屋根つきのメインスタンドがあるスタジアムで戦えます。', '看板も出て、すっかりプロのクラブらしくなりましたね！'],
    3: ['D2のスタジアムは、四方をスタンドが囲み、照明の塔も立っています。', '夜の試合も映えますよ。お客さんもたくさん入ります！'],
    4: ['ついにD1です！大型ビジョンのある、大きなスタジアムがホームになります。', '満員のお客さんの前で戦えますよ。夢の二冠まで、あと少しです！'],
  };
  /* 版762：シーズンの終わり・始まりのカード（合宿のカードと同じ作り。秘書が立つ） */
  function storyCard(o) {
    return new Promise(async (res) => {
      await facesReady();
      const el = fullScreen('storyScreen', 'sec-wrap2 cp-wrap'), box = el.querySelector('.lk-box'), who = o.who || 'sec';
      box.innerHTML = `<img class="sec-bg" src="${clubhouseBg()}" alt=""><img class="sec-face${staffImg[who] ? ' art' : ''}" src="${staffFace(who)}" alt="">
        <div class="cp-card sn-card ${o.theme || ''}"><div class="cp-head"><span class="cp-tag">${o.tag}</span><h2>${o.title}</h2></div>${o.body}<button class="ib ib-ok cp-ok">${esc(o.btn || 'OK')}</button></div>`;
      el.hidden = false; el._fit(); await blackClear(250);
      box.querySelector('.cp-ok').onclick = async (e) => { e.stopPropagation(); await blackFade(250); el.hidden = true; res(); blackClear(300); };
    });
  }
  // 版834：賞金の表（新しいデザイン）
  const prizeHTML = (pz) => `<div class="rc2-sec"><div class="rc2-sh dk">シーズンの賞金</div><div class="rc2-pz">${pz.items.map((x) => `<p><span>${esc(x.label)}</span><em>${DCOIN}${x.coins.toLocaleString()}</em></p>`).join('')}<p class="tot"><span>合計</span><em>${DCOIN}+${pz.total.toLocaleString()}</em></p></div></div>`;
  // 版834：シーズン終了の画面（新しいデザイン）：見出し・リーグの移動（昇格／残留／降格）・成績・賞金
  function seasonEndCard(se) {
    const up = se.toTier > se.fromTier, dn = se.toTier < se.fromTier, st = up ? ['up', '昇格'] : dn ? ['dn', '降格'] : ['st', '残留'], r = se.rec;
    const body = `<div class="rc2-move">${se.fromId ? lgBadge(se.fromId) : ''}<span>${esc(se.from)}</span><i>▶</i>${se.toId ? lgBadge(se.toId) : ''}<span class="nx">${esc(se.to)}</span><b class="rc2-st ${st[0]}">${st[1]}</b></div>
      <div class="rc2-recs"><div><small>順位</small><b>${se.pos}<em>位</em></b></div>${r ? `<div><small>成績</small><b>${r.W}<em>勝</em>${r.D}<em>分</em>${r.L}<em>敗</em></b></div><div><small>得点・失点</small><b>${r.GF}<em>−</em>${r.GA}</b></div><div><small>勝ち点</small><b>${r.Pts}</b></div>` : ''}</div>
      ${se.cup ? '<div class="rc2-ban up">🏆 国内カップ 優勝</div>' : ''}${se.prize && se.prize.total > 0 ? prizeHTML(se.prize) : ''}
      <p class="rc2-note">${up ? '来年は新しいリーグです。春季キャンプで力をつけましょう！' : dn ? 'また上を目指して、チームを鍛え直しましょう。' : '春季キャンプで力をつけて、来年こそ上を目指しましょう！'}</p>`;
    return resCard({ tag: `シーズン${se.season} 終了`, title: se.champ ? `${esc(se.from)} 優勝！` : `${esc(se.from)} ${se.pos}位`, theme: se.champ || up ? 'win' : dn ? 'lose' : '', body, who: 'sec' });
  }
  function seasonStartCard(se) {
    const ti = (se.titles || []).map((x) => x.mine ? `<p class="cr-learn">★ ${esc(x.name)}が「国内屈指の${esc(x.type)}」になった！</p>` : x.lost ? `<p>${esc(x.lost)}は「国内屈指の${esc(x.type)}」ではなくなった…（${esc(x.team)}の${esc(x.name)}へ）</p>` : `<p class="sn-t">国内屈指の${esc(x.type)}：${esc(x.team)}の${esc(x.name)}</p>`).join('');
    const rt = '';   /* 版763：引退の仕組みはない（CPUの選手は年をとらない）ので、引退の知らせは出さない */
    return storyCard({ theme: 'start', tag: `シーズン${save.season}`, title: '新シーズン開幕！', body: `<div class="sn-move one"><span class="nx">${esc(se.to)}</span></div><p class="cp-msg sn-msg">${esc(se.to)}での、新しいシーズンが始まります。</p>${ti || rt ? `<div class="sn-news">${ti}${rt}</div>` : ''}`, btn: '新シーズンへ' });
  }
  /* 版760：合宿の知らせ（始まる時・毎週・終わった時）を、クラブハウスを背景にしたカードで見せる */
  function campCard(o) {
    return new Promise(async (res) => {
      await facesReady();
      const el = fullScreen('campScreen', 'sec-wrap2 cp-wrap'), box = el.querySelector('.lk-box');
      const dots = Array.from({ length: o.weeks }, (_, k) => `<i class="${k < o.done ? 'on' : k === o.done && o.start ? 'now' : ''}"><b>${k + 1}</b><small>週目</small></i>`).join('<em></em>');
      box.innerHTML = `<img class="sec-bg" src="${clubhouseBg()}" alt=""><img class="sec-face${staffImg.coach ? ' art' : ''}" src="${staffFace('coach')}" alt="">
        <div class="cp-card${o.summer ? ' summer' : ''}"><div class="cp-head"><span class="cp-tag">⛺ ${esc(o.name)}</span><h2>${o.title}</h2></div>
          <div class="cp-prog">${dots}</div>
          ${o.chips ? `<div class="cp-chips">${o.chips.map(([a, b]) => `<span><small>${a}</small><b>${b}</b></span>`).join('')}</div>` : ''}
          <p class="cp-msg">${o.msg}</p>${o.extra || ''}
          <button class="ib ib-ok cp-ok">${esc(o.btn || 'OK')}</button></div>`;
      el.hidden = false; el._fit(); await blackClear(250);
      box.querySelector('.cp-ok').onclick = async (e) => { e.stopPropagation(); await blackFade(250); el.hidden = true; res(); blackClear(300); };
    });
  }
  /* 版745：改装工事の知らせ（始まる時・終わった時） */
  async function renovTalk(kind, r) {
    const wk = (w) => { const k = cal(w); return `${k.m}月${k.w}週`; }, up = r.to > r.from, lgName = (C.LG[r.lg] || {}).name || '';
    const nm = stadiumName({ name: save.team.name }, { home: true });
    const lines = kind === 'start'
      ? [up ? `監督、来年は${esc(lgName)}で戦うことが決まりました！` : `来年は${esc(lgName)}で戦うことになりました…。`,
         up ? '新しいリーグにふさわしいスタジアムにするため、ホームを改装工事します。' : 'ホームのスタジアムも、新しいリーグに合わせて改装します。',
         `${wk(r.start)}〜${wk(r.open - 1)}は工事のため、ホームは使えません。\nその間の試合は、相手の会場で行います。`,
         `${wk(r.open)}から、新しいスタジアムになります。楽しみにしていてくださいね！`]
      : [`監督！ホームの改装工事が終わりました！`, ...(up ? VENUE_TALK[r.to] || [] : []), `新しいホームは「${esc(nm)}」です。`];
    await secPicTalk(lines.map((t) => t.replace(/\n/g, '<br>')), kind === 'done' ? `img/venue/side_${Math.max(0, Math.min(4, r.to))}.jpg` : null, nm);
  }
  async function secPicTalk(lines, pic, nm) {
    await facesReady();
    const el = fullScreen('secScreen', 'sec-wrap2'), box = el.querySelector('.lk-box');
    await blackFade(250);
    return new Promise(async (res) => {
      let k = 0;
      box.innerHTML = `<img class="sec-bg" src="${clubhouseBg()}" alt="">${pic ? `<div class="vn-pic"><img src="${pic}" alt=""><b>${esc(nm)}</b></div>` : ''}<img class="sec-face${staffImg.sec ? ' art' : ''}" src="${staffFace('sec')}" alt=""><div class="sec-band"><b class="sec-name">秘書</b><p></p><i class="lk-more">▶</i></div>`;
      const draw = () => { box.querySelector('.sec-band p').innerHTML = lines[k]; };   /* 版760：めくる時は文字だけ変える（絵を毎回作り直して点滅していた） */
      draw(); el.hidden = false; el._fit();
      await blackClear(350);
      el.onclick = async () => { k++; if (k >= lines.length) { el.onclick = null; await blackFade(300); el.hidden = true; res(); blackClear(350); } else draw(); };
    });
  }
  async function venueTalk(se) {
    const from = (C.LEAGUES.find((l) => l.name === se.from) || {}).tier, to = (C.LG[save.league.id] || {}).tier;
    if (from == null || to == null || from === to) return;
    const up = to > from;
    venueNow = to;
    let pic = `img/venue/side_${Math.max(0, Math.min(4, to))}.jpg`;   // 版603：新しい会場の絵
    const nm = stadiumName({ name: save.team.name }, { home: true });
    const rv = save.renov && save.renov.season === save.season - 1 && save.renov.done;   /* 版745：スタジアムは1月に改装済み。シーズンの始まりは予算のことだけ */
    const lines = rv ? (up ? [`監督、${esc(save.league.name)}での新しいシーズンが始まります！`, `改装した「${esc(nm)}」で、思いきり戦いましょう！`] : [`${esc(save.league.name)}での新しいシーズンです。`, 'また昇格して、大きなスタジアムを取り戻しましょう！'])
      : up ? [`監督、${esc(save.league.name)}への昇格、おめでとうございます！`, ...VENUE_TALK[to], `新しいホームは「${esc(nm)}」です。`]
      : [`${esc(save.league.name)}に降格してしまいました…。`, `ホームの会場は「${esc(nm)}」に変わります。`, 'また昇格して、大きなスタジアムを取り戻しましょう！'];
    await facesReady();
    const el = fullScreen('secScreen', 'sec-wrap2'), box = el.querySelector('.lk-box');
    return new Promise(async (res) => {
      let k = 0;
      box.innerHTML = `<img class="sec-bg" src="${clubhouseBg()}" alt="">${pic ? `<div class="vn-pic"><img src="${pic}" alt=""><b>${esc(nm)}</b></div>` : ''}<img class="sec-face${staffImg.sec ? ' art' : ''}" src="${staffFace('sec')}" alt=""><div class="sec-band"><b class="sec-name">秘書</b><p></p><i class="lk-more">▶</i></div>`;
      const draw = () => { box.querySelector('.sec-band p').innerHTML = lines[k]; };   /* 版760：めくる時は文字だけ変える（絵を毎回作り直して点滅していた） */
      draw(); el.hidden = false; el._fit();
      await blackClear(350);
      el.onclick = async () => { k++; if (k >= lines.length) { el.onclick = null; await blackFade(300); el.hidden = true; res(); blackClear(350); } else draw(); };
    });
  }

  // ================= クラブ事務所（カルチョビットAの事務所）：会議室の部屋。左＝ユニフォーム・エンブレム・クラブ名・退任、右＝経営状況・チーム編成 =================
  // 版475：クラブ事務所を作り込み。ななめ見下ろし（2:1）の部屋に、テレビ・ロッカー・会議机・監督の机・作戦ボード・トロフィー棚・窓
  let officeBg = null;
  const OFX = 640, OFY = 262, OK = 0.78;
  const OP = (u, v, z = 0) => [OFX + (u - v) * OK, OFY + ((u + v) / 2 - z) * OK];
  function ofPoly(c, pts, col, st, lw) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); if (col) { c.fillStyle = col; c.fill(); } if (st) { c.strokeStyle = st; c.lineWidth = lw || 1.5; c.stroke(); } }
  // 箱：上面・手前左の面（v＝v+dv）・手前右の面（u＝u+du）
  function ofBox(c, u, v, z, du, dv, dz, top, fl, fr, st) {
    ofPoly(c, [OP(u, v + dv, z), OP(u + du, v + dv, z), OP(u + du, v + dv, z + dz), OP(u, v + dv, z + dz)], fl, st);
    ofPoly(c, [OP(u + du, v, z), OP(u + du, v + dv, z), OP(u + du, v + dv, z + dz), OP(u + du, v, z + dz)], fr, st);
    ofPoly(c, [OP(u, v, z + dz), OP(u + du, v, z + dz), OP(u + du, v + dv, z + dz), OP(u, v + dv, z + dz)], top, st);
  }
  const wR = (u0, z0, u1, z1, v = 0) => [OP(u0, v, z0), OP(u1, v, z0), OP(u1, v, z1), OP(u0, v, z1)];   // 右の壁（v＝0）の上の四角
  const wL = (v0, z0, v1, z1, u = 0) => [OP(u, v0, z0), OP(u, v1, z0), OP(u, v1, z1), OP(u, v0, z1)];   // 左の壁（u＝0）の上の四角
  function buildOfficeBg() {
    const W = 1280, H = 720, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    const HW = 1100;
    // ---- 床（木の床）と会議スペースのじゅうたん ----
    ofPoly(c, [OP(0, 0), OP(1500, 0), OP(1500, 1500), OP(0, 1500)], '#a8794a');
    c.strokeStyle = 'rgba(70,40,15,0.22)'; c.lineWidth = 1.5;
    for (let v = 0; v < 1500; v += 34) { const [x0, y0] = OP(0, v), [x1, y1] = OP(1500, v); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    for (let v = 0; v < 1500; v += 34) for (let u = ((v / 34) % 3) * 70; u < 1500; u += 210) { const [x0, y0] = OP(u, v), [x1, y1] = OP(u, v + 34); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    ofPoly(c, [OP(150, 210), OP(560, 210), OP(560, 470), OP(150, 470)], '#2f5a3e');
    ofPoly(c, [OP(162, 222), OP(548, 222), OP(548, 458), OP(162, 458)], null, 'rgba(240,220,120,0.55)', 3);
    // ---- 左の壁（u＝0）：腰の高さまで木の板、上はクリーム色 ----
    ofPoly(c, wL(0, 0, 1500, HW), '#e6dcc4');
    ofPoly(c, wL(0, 0, 1500, 95), '#8a5a2c');
    c.strokeStyle = 'rgba(40,20,5,0.35)'; c.lineWidth = 2; for (let v = 0; v < 900; v += 40) { const [x0, y0] = OP(0, v, 0), [x1, y1] = OP(0, v, 95); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    ofPoly(c, wL(0, 95, 1500, 103), '#5e3a18');
    // ---- 右の壁（v＝0）：明るい壁 ----
    ofPoly(c, wR(0, 0, 1500, HW), '#f1ece0');
    ofPoly(c, wR(0, 0, 1500, 95), '#9a6a38');
    c.strokeStyle = 'rgba(40,20,5,0.3)'; for (let u = 0; u < 900; u += 40) { const [x0, y0] = OP(u, 0, 0), [x1, y1] = OP(u, 0, 95); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    ofPoly(c, wR(0, 95, 1500, 103), '#6e4520');
    // 壁の角の影
    { const g = c.createLinearGradient(OFX - 40, 0, OFX + 40, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(OFX - 40, 0, 80, OFY + 10); }
    // ---- 右の壁：窓3つ（空と街）・ブラインド ----
    for (const u0 of [250, 400, 550]) {
      const q = wR(u0, 130, u0 + 120, 300);
      ofPoly(c, wR(u0 - 8, 122, u0 + 128, 308), '#c9c3b4');
      c.save(); ofPoly(c, q, null); c.clip();
      const [ax, ay] = OP(u0, 0, 300); const g = c.createLinearGradient(0, ay - 20, 0, ay + 200); g.addColorStop(0, '#6fb6ef'); g.addColorStop(1, '#cfeaf8'); c.fillStyle = g; c.fillRect(ax - 10, ay - 40, 160, 320);
      for (let k = 0; k < 6; k++) { const bu = u0 + k * 22, bh = 30 + ((k * 37 + u0) % 50); ofPoly(c, wR(bu, 130, bu + 18, 130 + bh), k % 2 ? '#8fa3b5' : '#a5b6c4'); for (let j = 0; j < 3; j++) ofPoly(c, wR(bu + 4, 140 + j * 12, bu + 8, 146 + j * 12), 'rgba(255,255,200,0.7)'); }
      c.fillStyle = 'rgba(255,255,255,0.35)'; ofPoly(c, [OP(u0 + 10, 0, 290), OP(u0 + 40, 0, 290), OP(u0 + 20, 0, 150), OP(u0 + 6, 0, 160)], 'rgba(255,255,255,0.3)');
      for (let z = 300; z > 266; z -= 7) ofPoly(c, wR(u0, z - 3, u0 + 120, z), 'rgba(235,235,225,0.95)');   // 上がったブラインド
      c.restore();
      ofPoly(c, wR(u0 + 58, 130, u0 + 62, 300), '#c9c3b4');
      ofBox(c, u0 - 10, 0, 118, 140, 10, 6, '#ddd6c6', '#bdb5a3', '#cfc8b8');   // 窓の下の台
    }
    // 時計
    { const [x, y] = OP(470, 0, 335); c.save(); c.translate(x, y); c.transform(1, 0.5, 0, 1, 0, 0); c.scale(OK, OK); c.fillStyle = '#fff'; c.strokeStyle = '#333'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 17, 0, 7); c.fill(); c.stroke(); c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -11); c.moveTo(0, 0); c.lineTo(8, 3); c.stroke(); c.restore(); }
    // 作戦ボード（ホワイトボード）
    { ofPoly(c, wR(40, 130, 200, 290), '#9aa0a8'); ofPoly(c, wR(46, 136, 194, 284), '#fbfbf8');
      const [x, y] = OP(46, 0, 284); c.save(); c.translate(x, y); c.transform(1, 0.5, 0, 1, 0, 0); c.scale(OK, OK);
      c.strokeStyle = '#2a7a3a'; c.lineWidth = 2; c.strokeRect(10, 10, 128, 128); c.beginPath(); c.moveTo(10, 74); c.lineTo(138, 74); c.stroke(); c.beginPath(); c.arc(74, 74, 14, 0, 7); c.stroke();
      const dots = [[74, 126], [30, 108], [58, 112], [90, 112], [118, 108], [40, 84], [74, 88], [108, 84], [50, 52], [98, 52], [74, 34]];
      dots.forEach(([dx, dy], i) => { c.fillStyle = i ? '#2f6fd6' : '#e8a020'; c.beginPath(); c.arc(dx, dy, 4.5, 0, 7); c.fill(); });
      c.strokeStyle = '#d83a3a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(98, 52); c.quadraticCurveTo(122, 34, 112, 18); c.stroke(); c.beginPath(); c.moveTo(106, 22); c.lineTo(112, 18); c.lineTo(116, 25); c.stroke();
      c.beginPath(); c.moveTo(40, 84); c.lineTo(28, 46); c.stroke();
      c.restore(); ofBox(c, 40, 0, 120, 160, 8, 6, '#c8ccd2', '#8a9098', '#a4aab2'); }
    // トロフィーの飾り棚（窓の下の低い棚）
    ofBox(c, 250, 0, 0, 290, 44, 92, '#7a4a22', '#5a3416', '#6a3e1c');
    for (let k = 0; k < 4; k++) ofPoly(c, [OP(258 + k * 70, 44, 12), OP(318 + k * 70, 44, 12), OP(318 + k * 70, 44, 80), OP(258 + k * 70, 44, 80)], 'rgba(180,220,240,0.35)', '#3a2410', 2);
    [[272, '#e8c34a', 1.2], [310, '#c0c4cc', 1], [350, '#e8c34a', 1.4], [395, '#cd8a4a', 1], [435, '#e8c34a', 1.1], [480, '#c0c4cc', 1], [515, '#e8c34a', 1.25]].forEach(([u, col, h]) => { const [x, y] = OP(u, 22, 92); c.fillStyle = '#3a2a1a'; c.fillRect(x - 7, y - 5, 14, 5); c.fillStyle = col; c.fillRect(x - 3, y - 5 - 10 * h, 6, 10 * h); c.beginPath(); c.moveTo(x - 9, y - 5 - 22 * h); c.lineTo(x + 9, y - 5 - 22 * h); c.lineTo(x + 5, y - 5 - 10 * h); c.lineTo(x - 5, y - 5 - 10 * h); c.closePath(); c.fill(); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(x - 6, y - 3 - 22 * h, 3, 8); });
    // ペナント（左の壁、奥の角の近く）
    [[20, '#d83a3a'], [70, '#2f6fd6']].forEach(([v, col]) => ofPoly(c, [OP(0, v, 300), OP(0, v + 44, 300), OP(0, v + 22, 236)], col, '#fff', 2));
    // ---- 左の壁：ONE TEAM の横断幕 ----
    { const [x, y] = OP(0, 590, 320); c.save(); c.translate(x, y); c.transform(1, -0.5, 0, 1, 0, 0); c.scale(OK, OK); c.fillStyle = '#fbfaf4'; c.fillRect(0, 0, 250, 82); c.strokeStyle = '#2a6e3a'; c.lineWidth = 6; c.strokeRect(0, 0, 250, 82);
      c.fillStyle = '#1b2a20'; c.font = 'italic 900 42px "Arial Black",Arial'; c.textAlign = 'center'; c.fillText('ONE TEAM', 125, 46); c.font = '800 15px "Hiragino Kaku Gothic ProN",sans-serif'; c.fillText('〜 全員で、一つのゴールへ 〜', 125, 70); c.restore(); }
    // 左の壁：大きなテレビ（試合の映像）とテレビ台
    { const v0 = 130, v1 = 290; ofPoly(c, wL(v0 - 6, 136, v1 + 6, 238), '#111418'); ofPoly(c, wL(v0, 142, v1, 232), '#3e8f3a');
      const [x, y] = OP(0, v1, 232); c.save(); c.translate(x, y); c.transform(1, -0.5, 0, 1, 0, 0); c.scale(OK, OK);
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5; c.strokeRect(8, 8, 144, 74); c.beginPath(); c.moveTo(80, 8); c.lineTo(80, 82); c.stroke(); c.beginPath(); c.arc(80, 45, 12, 0, 7); c.stroke();
      [[40, 30, '#2f6fd6'], [56, 58, '#2f6fd6'], [92, 40, '#d83a3a'], [110, 62, '#d83a3a'], [70, 50, '#2f6fd6'], [124, 30, '#d83a3a']].forEach(([px, py, col]) => { c.fillStyle = col; c.fillRect(px, py, 4, 7); });
      c.fillStyle = '#fff'; c.fillRect(84, 46, 3, 3); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(8, 8, 52, 12); c.fillStyle = '#fff'; c.font = '800 9px sans-serif'; c.fillText('LIVE 1-0', 12, 17);
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.moveTo(8, 8); c.lineTo(60, 8); c.lineTo(20, 82); c.lineTo(8, 82); c.fill(); c.restore();
      ofBox(c, 0, v0 - 10, 0, 44, v1 - v0 + 20, 52, '#4a3020', '#2e1c10', '#3a2416');
      ofPoly(c, [OP(44, v0 + 10, 12), OP(44, v0 + 70, 12), OP(44, v0 + 70, 40), OP(44, v0 + 10, 40)], '#1e120a'); ofPoly(c, [OP(44, v0 + 90, 12), OP(44, v0 + 150, 12), OP(44, v0 + 150, 40), OP(44, v0 + 90, 40)], '#1e120a');
      { const [sx, sy] = OP(22, v0 + 40, 52); c.fillStyle = '#222'; c.fillRect(sx - 14, sy - 10, 28, 10); c.fillStyle = '#4ae04a'; c.fillRect(sx + 8, sy - 7, 3, 2); }   // レコーダー
    }
    // ウォーターサーバー（左の壁ぎわ）
    ofBox(c, 0, 330, 0, 36, 36, 95, '#f2f2f2', '#c8c8c8', '#dedede'); { const [x, y] = OP(18, 348, 95); c.fillStyle = 'rgba(120,190,240,0.85)'; c.fillRect(x - 11, y - 34, 22, 30); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(x - 8, y - 32, 4, 24); }
    // 左の壁：ロッカー（番号つき）とベンチ
    for (let k = 0; k < 5; k++) { const v = 400 + k * 56;
      ofBox(c, 0, v, 0, 48, 54, 200, '#7d8590', '#5f6670', '#8d96a2', 'rgba(30,35,40,0.6)');
      ofPoly(c, [OP(48, v + 6, 14), OP(48, v + 48, 14), OP(48, v + 48, 190), OP(48, v + 6, 190)], '#9aa3ae', 'rgba(30,35,40,0.5)');
      for (let j = 0; j < 4; j++) ofPoly(c, [OP(48, v + 14, 160 - j * 7), OP(48, v + 40, 160 - j * 7), OP(48, v + 40, 163 - j * 7), OP(48, v + 14, 163 - j * 7)], '#4e555e');
      ofPoly(c, [OP(48, v + 16, 120), OP(48, v + 38, 120), OP(48, v + 38, 132), OP(48, v + 16, 132)], '#f4f2ea');
      const [tx, ty] = OP(48, v + 27, 122); c.fillStyle = '#222'; c.font = '900 10px sans-serif'; c.textAlign = 'center'; c.fillText(String([7, 9, 10, 11, 14][k]), tx, ty);
      ofPoly(c, [OP(48, v + 40, 90), OP(48, v + 44, 90), OP(48, v + 44, 110), OP(48, v + 40, 110)], '#d8dde3');
    }
    [[76, 420], [76, 668], [108, 420], [108, 668]].forEach(([u, v]) => ofBox(c, u, v, 0, 6, 6, 26, '#555', '#333', '#444')); ofBox(c, 70, 410, 26, 46, 270, 10, '#b88a52', '#8a6236', '#9a703f');   // 脚を先に、座面をあとに
    // 奥の角：大きな観葉植物とクラブの旗
    { ofBox(c, 20, 20, 0, 50, 50, 46, '#c8a070', '#9a7448', '#b08858'); const [x, y] = OP(45, 45, 46); c.fillStyle = '#245f2a'; for (let k = 0; k < 14; k++) { c.beginPath(); c.ellipse(x + Math.sin(k * 2.1) * 22, y - 20 - k * 6, 10, 22, Math.sin(k * 1.3) * 0.9, 0, 7); c.fill(); } c.fillStyle = '#3a9a3e'; for (let k = 0; k < 10; k++) { c.beginPath(); c.ellipse(x + Math.cos(k * 1.7) * 18, y - 28 - k * 7, 6, 16, Math.cos(k) * 0.8, 0, 7); c.fill(); } }
    officeBg = cv;
  }
  // 人：u・v（床の位置）、向き（view）、左右反転、服
  const OFF_PEOPLE = [
    // 会議机の奥の列（手前を向く）
    { u: 225, v: 226, view: 'f34', fl: true, cl: 'navy' }, { u: 300, v: 226, view: 'f34', fl: true, cl: 'gray' }, { u: 375, v: 226, view: 'f34', fl: true, cl: 'shirt' }, { u: 450, v: 226, view: 'f34', fl: true, cl: 'navy' },
    // 机のはし（議長）
    { u: 150, v: 318, view: 'f34', fl: false, cl: 'navy' },
    // 手前の列（奥を向く）
    { u: 262, v: 414, view: 'b34', fl: false, cl: 'gray' }, { u: 340, v: 414, view: 'b34', fl: false, cl: 'navy' }, { u: 418, v: 414, view: 'b34', fl: false, cl: 'shirt' },
  ];
  const officeEmb = new Map(); let officeRedraw = null;
  const OFF_CL = () => ({ navy: SUIT_NAVY, gray: SUIT_GRAY, shirt: SHIRT });
  function drawOfficeRoom(c) {
    c.drawImage(officeBg, 0, 0);
    const S = A().SPR, sc = 2.7, CL = OFF_CL();
    // 版479：テレビの上に、クラブのエンブレム（エンブレムを変えたら、ここも変わる）
    { const url = emblemURL(save.team.name, 128); let im = officeEmb.get(url); if (!im) { im = new Image(); im.onload = () => { if (officeRedraw) officeRedraw(); }; im.src = url; officeEmb.set(url, im); }
      if (im.complete && im.naturalWidth) { const [x, y] = OP(0, 256, 352); c.save(); c.translate(x, y); c.transform(1, -0.5, 0, 1, 0, 0); c.scale(OK, OK); c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowOffsetX = 3; c.shadowOffsetY = 4; c.drawImage(im, 4, 2, 90, 90); c.restore(); } }
    const person = (o, k) => { const img = dressed('of' + k, { hair: k % 4, hairColor: (k * 2) % 3, skin: k % 3 }, o.view, 0, CL[o.cl]); const [x, y] = OP(o.u, o.v); c.save(); c.imageSmoothingEnabled = false; c.translate(x, 0); if (o.fl) c.scale(-1, 1); c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.ellipse(0, y, 15, 5, 0, 0, 7); c.fill(); c.drawImage(img, -S.W * sc / 2, y - (S.H - 3) * sc, S.W * sc, S.H * sc); c.restore(); };
    const chair = (u, v, backSide) => { // backSide：'v-'＝奥に背もたれ、'v+'＝手前に背もたれ、'u-'＝左奥に背もたれ
      ofBox(c, u - 15, v - 15, 20, 30, 30, 6, '#2a2e36', '#16181d', '#1f2228');
      ofBox(c, u - 3, v - 3, 0, 6, 6, 20, '#444', '#222', '#333');
      if (backSide === 'v-') ofBox(c, u - 15, v - 19, 20, 30, 6, 40, '#30343c', '#1b1e24', '#262a31');
      if (backSide === 'u-') ofBox(c, u - 19, v - 15, 20, 6, 30, 40, '#30343c', '#1b1e24', '#262a31');
      if (backSide === 'v+') ofBox(c, u - 15, v + 13, 20, 30, 6, 22, '#30343c', '#1b1e24', '#262a31');
    };
    // 監督の机（窓ぎわ）：秘書がこちらに背中を向けてパソコンで仕事（画面に表とグラフ）
    ofBox(c, 540, 70, 0, 130, 62, 50, '#7a5232', '#4e3218', '#5e3c1e');
    ofBox(c, 544, 74, 50, 122, 54, 4, '#8a6240', '#5a3a20', '#6a4626');
    { ofBox(c, 598, 84, 54, 10, 8, 10, '#2a2c30', '#1a1c20', '#22252a');   // モニターの足
      ofBox(c, 572, 80, 64, 62, 6, 40, '#2a2c30', '#16181c', '#1e2024');   // モニター
      const q = [OP(576, 86, 68), OP(630, 86, 68), OP(630, 86, 100), OP(576, 86, 100)]; ofPoly(c, q, '#f4f8fc');
      for (let k = 0; k < 4; k++) ofPoly(c, [OP(580, 86, 94 - k * 6), OP(600, 86, 94 - k * 6), OP(600, 86, 96 - k * 6), OP(580, 86, 96 - k * 6)], '#9aa8b8');
      [[606, 8, '#2f6fd6'], [613, 14, '#e8a020'], [620, 20, '#2a8a3a']].forEach(([u, h, col]) => ofPoly(c, [OP(u, 86, 72), OP(u + 5, 86, 72), OP(u + 5, 86, 72 + h), OP(u, 86, 72 + h)], col));
      ofPoly(c, [OP(576, 86, 98), OP(630, 86, 98), OP(630, 86, 100), OP(576, 86, 100)], '#3a7ad8'); }
    ofBox(c, 580, 104, 54, 44, 14, 3, '#e8e8ea', '#b8b8bc', '#cfcfd2');   // キーボード
    ofBox(c, 640, 100, 54, 22, 26, 6, '#f8f8f4', '#ddd', '#e8e8e4'); ofBox(c, 642, 102, 60, 22, 26, 3, '#fff8d8', '#ddd', '#e8e8e4');   // 書類の山
    ofBox(c, 548, 96, 54, 22, 18, 8, '#2a2a2e', '#18181b', '#202024'); ofBox(c, 551, 98, 62, 6, 14, 4, '#3a3a40', '#222', '#2c2c30');   // 電話
    { const [x, y] = OP(662, 86, 54); c.fillStyle = '#fff'; c.fillRect(x - 5, y - 12, 10, 12); c.fillStyle = '#c8392d'; c.fillRect(x - 5, y - 9, 10, 3); }   // マグカップ
    { ofBox(c, 640, 130, 54, 30, 3, 12, '#f4f2ea', '#c8c4b4', '#dedacb'); const [x, y] = OP(655, 133, 60); c.save(); c.translate(x, y); c.transform(1, -0.5, 0, 1, 0, 0); c.scale(OK, OK); c.fillStyle = '#333'; c.font = '900 10px sans-serif'; c.textAlign = 'center'; c.fillText('秘書', 0, 4); c.restore(); }   // 名札
    person({ u: 606, v: 150, view: 'b34', fl: false, cl: 'shirt' }, 9);
    chair(606, 156, 'v+');
    // 会議机：奥のいす → 奥の人 → 机 → 手前の人 → 手前のいす
    [225, 300, 375, 450].forEach((u) => chair(u, 222, 'v-'));
    chair(150, 318, 'u-');
    OFF_PEOPLE.slice(0, 5).forEach((o, k) => person(o, k));
    // 机（脚4本と天板）
    [[186, 262], [486, 262], [186, 376], [486, 376]].forEach(([u, v]) => ofBox(c, u, v, 0, 8, 8, 32, '#3a2414', '#24160a', '#2e1c0e'));
    ofBox(c, 180, 255, 32, 316, 132, 9, '#7a4f2a', '#4e3018', '#5e3a1e');
    ofPoly(c, [OP(196, 270, 41), OP(480, 270, 41), OP(480, 372, 41), OP(196, 372, 41)], null, 'rgba(255,230,190,0.25)', 2);
    // 机の上：書類・ノートPC・ペットボトル
    [[230, 290], [305, 290], [380, 290], [455, 290], [270, 350], [345, 350], [420, 350]].forEach(([u, v], i) => { ofBox(c, u - 12, v - 9, 41, 24, 18, 1.5, i % 3 === 1 ? '#fff8d8' : '#fbfbf8', '#ccc', '#ddd'); });
    ofBox(c, 200, 300, 41, 30, 22, 2, '#9aa0a8', '#6a7078', '#80868e'); ofPoly(c, [OP(200, 300, 43), OP(230, 300, 43), OP(230, 300, 64), OP(200, 300, 64)], '#2a2e34');
    [[330, 318], [410, 322]].forEach(([u, v]) => { const [x, y] = OP(u, v, 41); c.fillStyle = 'rgba(150,210,250,0.85)'; c.fillRect(x - 3, y - 16, 6, 16); c.fillStyle = '#3a8ad8'; c.fillRect(x - 3, y - 19, 6, 3); });
    OFF_PEOPLE.slice(5).forEach((o, k) => person(o, k + 5));
    [262, 340, 418].forEach((u) => chair(u, 418, 'v+'));
    // 手前右：ソファとローテーブル（お客さん用）
    ofBox(c, 640, 380, 0, 60, 150, 28, '#3a5aa0', '#243a70', '#2e4a88');
    ofBox(c, 690, 380, 28, 14, 150, 34, '#4466b0', '#284480', '#30508f');
    ofBox(c, 560, 410, 0, 50, 90, 24, '#c8a070', '#8a6236', '#9a703f');
    { const [x, y] = OP(585, 450, 24); c.fillStyle = '#fff'; c.beginPath(); c.ellipse(x, y - 4, 7, 4, 0, 0, 7); c.fill(); c.fillStyle = '#7a4a22'; c.fillRect(x - 5, y - 10, 10, 6); }
    // 手前左：植木鉢
    { ofBox(c, 150, 600, 0, 34, 34, 34, '#c8a070', '#9a7448', '#b08858'); const [x, y] = OP(167, 617, 34); c.fillStyle = '#2f8a3a'; for (let k = 0; k < 9; k++) { c.beginPath(); c.ellipse(x + Math.sin(k * 2.3) * 14, y - 10 - k * 5, 7, 15, Math.sin(k) * 0.8, 0, 7); c.fill(); } }
  }
  function openOffice() {
    const el = fullScreen('officeScreen', 'std-wrap off-wrap'), box = el.querySelector('.lk-box');
    if (!officeBg) buildOfficeBg();
    let panel = null, sortK = 'order', sortDir = 1, mode = 'st';   // 版518：最初はスタメン順→ベンチ順→ベンチ外順
    const cvs = document.createElement('canvas'); cvs.width = 1280; cvs.height = 720;
    const drawRoom = () => { const c = cvs.getContext('2d'); drawOfficeRoom(c); };
    officeRedraw = drawRoom;
    const BTN = (a, ico, label) => `<button class="of-b" data-a="${a}"><span>${ico}</span><b>${label}</b></button>`;
    const PIC = (a, f, label) => `<button class="of-b of-pic" data-a="${a}" title="${label}"><img src="icons/${f}.png" alt="${label}"></button>`;   /* 版470：送ってもらったアイコンの絵 */
    const I = {
      kit: '<svg viewBox="0 0 40 40"><path d="M12 6l-9 6 4 8 4-2v16h18V18l4 2 4-8-9-6c-1 3-4 5-8 5s-7-2-8-5z" fill="#2f6fd6" stroke="#fff" stroke-width="2"/></svg>',
      emb: `<svg viewBox="0 0 40 40"><path d="M20 3l14 5v11c0 9-6 15-14 18C12 34 6 28 6 19V8z" fill="#d83a3a" stroke="#fff" stroke-width="2.5"/><text x="20" y="25" font-size="14" font-weight="900" text-anchor="middle" fill="#fff">A</text></svg>`,
      name: '<svg viewBox="0 0 40 40"><rect x="4" y="10" width="32" height="20" rx="3" fill="#fff" stroke="#333" stroke-width="2"/><path d="M9 16h22M9 21h16" stroke="#333" stroke-width="2.5"/></svg>',
      bye: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="#e8e2d0" stroke="#333" stroke-width="2"/><path d="M13 13l14 14M27 13L13 27" stroke="#d83a3a" stroke-width="4"/></svg>',
      biz: '<svg viewBox="0 0 40 40"><rect x="5" y="22" width="7" height="12" fill="#2f8a4e"/><rect x="16" y="14" width="7" height="20" fill="#f2c21c"/><rect x="27" y="7" width="7" height="27" fill="#d83a3a"/></svg>',
      team: '<svg viewBox="0 0 40 40"><rect x="5" y="6" width="30" height="28" rx="3" fill="#2a5a32" stroke="#fff" stroke-width="2"/><path d="M9 13h22M9 19h22M9 25h22" stroke="#e7ff62" stroke-width="2.5"/></svg>',
    };
    // 版681：経営状況 → 「クラブ情報」：今シーズン・クラブの歴史・トロフィーの3つのタブ（予算の数字はなくした）
    let bizTab = 'now';
    const bizHTML = () => {
      const me = save.team.name, lgN = save.league.name, st = C.standings(save), pos = st.findIndex((t) => t.me) + 1, S = (st[pos - 1] || {}).stats || { P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 };
      const head = `<div class="ob-h"><img src="${emblemURL(me, 64)}" alt=""><div><b>${esc(me)}</b><small>（${esc(stadiumName({ name: me }, { home: true }))}）</small><em>${esc(save.manager || '')}${save.manager ? '監督　' : ''}${save.season}年目</em></div>
        <div class="ob-tabs">${[['now', '今シーズン'], ['hist', 'クラブの歴史'], ['tro', 'トロフィー']].map(([k, n]) => `<button data-bt="${k}" class="${bizTab === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
      let body = '';
      if (bizTab === 'now') {
        const cup = save.cup; let cupTxt = '―';
        if (cup && cup.season === save.season) { const inCup = !cup.champion && (cup.round === 0 ? (cup.alive || []).includes(me) : (cup.slots || []).includes(me));
          if (cup.champion === me) cupTxt = '<b class="ob-gold">優勝！</b>'; else if (inCup) cupTxt = cup.round === 0 ? 'これから' : `勝ち残り（次は${esc((C.CUP_LABELS || [])[cup.round] || `${cup.round + 1}回戦`)}）`;
          else { const h = (cup.hist || []).filter((x) => JSON.stringify(x.games || []).includes(me)).pop(); cupTxt = h ? `${esc(h.label)}で敗退` : '敗退'; } }
        const key = String(save.season), rk = (f) => save.team.players.map((p) => ({ p, v: ((p.rec || {})[key] || {})[f] || 0 })).filter((o) => o.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
        const rank = (f, t, u) => `<div class="ob-rk"><b>${t}</b>${rk(f).map((o, k) => `<p><i>${k + 1}</i><span>${esc(o.p.name)}</span><em>${o.v}${u}</em></p>`).join('') || '<p class="ob-none">まだいません</p>'}</div>`;
        body = `<div class="ob-now"><div class="ob-pos">${lgBadge(save.league.id)}<span>${esc(lgN)}</span><b>${pos}<small>位</small></b><em>/ ${st.length}チーム</em></div>
          <div class="ob-rec">${[['試合', S.P], ['勝', S.W], ['分', S.D], ['敗', S.L], ['得点', S.GF], ['失点', S.GA], ['勝点', S.Pts]].map(([n, v]) => `<div><small>${n}</small><b>${v}</b></div>`).join('')}</div>
          <p class="ob-cup"><span>国内カップ</span>${cupTxt}</p>
          <div class="ob-rks">${rank('G', '得点', '点')}${rank('A', 'アシスト', '')}${rank('P', '出場', '試合')}</div></div>`;
      } else if (bizTab === 'hist') {
        const rows = (save.history || []).map((h) => `<tr><td>${h.season}年目</td><td>${esc(h.league)}</td><td class="c">${h.pos}位</td><td>${h.cup ? '<b class="ob-gold">優勝</b>' : '―'}</td><td class="m">${esc(h.msg || '')}</td></tr>`).join('');
        body = `<div class="ob-sc"><table class="ob-ht"><tr><th>シーズン</th><th>リーグ</th><th>順位</th><th>カップ</th><th>できごと</th></tr>${rows}<tr class="now"><td>${save.season}年目</td><td>${esc(lgN)}</td><td class="c">${pos}位</td><td>${save.cup && save.cup.season === save.season && save.cup.champion === me ? '<b class="ob-gold">優勝</b>' : '―'}</td><td class="m">今シーズン（${S.P}試合）</td></tr></table></div>`;
      } else {
        const tr = [...(save.trophies || [])], has = (k, n) => tr.some((t) => t.season === n && t.kind === k);
        (save.history || []).forEach((h) => { if (h.pos === 1 && !has('league', h.season)) tr.push({ season: h.season, kind: 'league', title: h.league }); if (h.cup && !has('cup', h.season)) tr.push({ season: h.season, kind: 'cup', title: '国内カップ' }); });
        tr.sort((a, b) => a.season - b.season || (a.kind === 'cup') - (b.kind === 'cup'));
        const lgId = (t) => { for (const k in C.LG) if (C.LG[k].name === t.title) return k; return null; };
        body = tr.length ? `<div class="ob-tro">${tr.map((t) => `<div><img src="${trophyImg(t.kind, lgId(t))}" alt=""><b>${esc(t.title)}</b><small>${t.season}年目</small></div>`).join('')}</div>` : '<p class="ob-empty">まだタイトルはありません。<br>リーグ優勝・カップ優勝で、ここにトロフィーが並びます。</p>';
      }
      return `<div class="of-p of-biz">${head}${body}</div>`;
    };
    const PK = D.PARAMS.map((q) => q.k);
    const teamHTML = () => {
      const ps = save.team.players.map((p, i) => ({ p, i })), key = String(save.season);
      const rec = (p) => (p.rec && p.rec[key]) || { P: 0, G: 0, A: 0, Y: 0, R: 0 };
      const val = { order: (o) => o.i, no: (o) => o.p.number, pos: (o) => ({ GK: 0, DF: 1, MF: 2, FW: 3 })[o.p.position], P: (o) => -rec(o.p).P, G: (o) => -rec(o.p).G, A: (o) => -rec(o.p).A, Y: (o) => -(rec(o.p).Y + rec(o.p).R * 2), X: (o) => -(o.p.injury || 0), star: (o) => -C.ensureStar(o.p), fat: (o) => -(o.p.fatigue || 0) };
      PK.forEach((k) => { val[k] = (o) => { C.ensurePts(o.p); return -o.p.pts[k]; }; });
      const f = val[sortK] || val.order; ps.sort((a, b) => (f(a) - f(b)) * sortDir || a.i - b.i);
      const th = (k, label, cls) => `<th class="${cls || ''}${sortK === k ? ' on' : ''}" data-s="${k}">${label}</th>`;
      let head, row;
      if (mode === 'st') { head = th('P', '試合') + th('G', '得点') + th('A', 'アシスト') + th('Y', '<i class="ob-y"></i>') + th('X', '<i class="ob-x">×</i>'); row = (o) => { const r = rec(o.p); return `<td>${r.P}</td><td>${r.G}</td><td>${r.A}</td><td>${r.Y + r.R}</td><td>${o.p.injury > 0 ? o.p.injury + '週' : '0'}</td>`; }; }
      else if (mode === 'ab') { head = PK.map((k, j) => th(k, ico(k), 'ic')).join('') + '<th>タイプ</th>'; row = (o) => { C.ensurePts(o.p); return PK.map((k) => { const g = C.rankInfo(o.p.pts[k]).g; return `<td><i class="rk2 g-${g}">${g}</i></td>`; }).join('') + `<td><span class="tbadge ${TYPE_CLS[o.p.type] || 'ty-bal'}">${esc(o.p.type || '')}</span></td>`; }; }
      else { head = th('star', 'レア度') + '<th>上限</th>' + th('fat', '疲労'); row = (o) => `<td>${starHTML(C.ensureStar(o.p), o.p.totsu)}</td><td>${capBadge(C.capGrade(o.p))}</td><td><i class="cdot ${condDot(o.p)}"></i> ${Math.round(o.p.fatigue || 0)}%</td>`; }
      return `<div class="of-p of-team"><div class="ot-h">${esc(save.team.name)}　チーム編成<span>${['成績', '能力', '状態'][['st', 'ab', 'cd'].indexOf(mode)]}</span></div><div class="ot-sc"><table class="ot ${mode}"><tr>${th('pos', 'Pos.')}${th('no', 'No.')}<th class="nm${sortK === 'order' ? ' on' : ''}" data-s="order" title="スタメン順にもどす">選手</th><th></th>${head}</tr>
        ${ps.map((o) => `<tr data-i="${o.i}" class="${o.i < 11 ? '' : o.i < 11 + C.BENCH_N ? 'sub' : 'sub out'}${sortK === 'order' && (o.i === 11 || o.i === 11 + C.BENCH_N) ? ' sep' : ''}"><td><i class="pos ${POSC[o.p.position]}">${o.p.position}</i></td><td class="no">${o.p.number}</td><td class="nm">${esc(o.p.name)}</td><td><i class="cdot ${condDot(o.p)}"></i></td>${row(o)}</tr>`).join('')}</table></div>
        <button class="ot-mode ui-img" title="表示を切りかえる"><img src="icons/ui_change.png" alt="切りかえ"></button><p class="ot-hint">見出しをタップで並べかえ。右下のボタンで「成績・能力・状態」を切りかえ</p></div>`;
    };
    const draw = () => {
      box.innerHTML = `<div class="off"><div class="of-room"></div>
        <div class="of-l">${PIC('kit', 'off_kit', 'ユニフォーム')}${PIC('emb', 'off_emblem', 'エンブレム')}${PIC('name', 'off_name', 'チーム名変更')}${PIC('bye', 'off_retire', '退任')}${PIC('set', 'off_setting', '設定')}</div>
        <div class="of-r">${PIC('biz', 'off_biz', 'クラブ状況')}${PIC('team', 'off_team', 'チーム編成')}${PIC('friend', 'off_friend', 'フレンド')}</div>
        <button class="std-back of-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button>
        ${panel === 'biz' ? bizHTML() : panel === 'team' ? teamHTML() : ''}</div>`;
      box.querySelector('.of-room').appendChild(cvs); drawRoom();
      box.querySelectorAll('.of-b').forEach((b) => b.onclick = async () => { const a = b.dataset.a;
        if (a === 'biz' || a === 'team') { panel = panel === a ? null : a; draw(); return; }
        if (a === 'friend') { el.hidden = true; friendMenu(() => { el.hidden = false; draw(); }); return; }   // 版618：事務所からもフレンド申請
        if (a === 'set') { if (window.__openMenu) window.__openMenu(); return; }   /* 版470：設定（チュートリアル・全画面など。右上のメニューの代わり） */
        if (a === 'kit' || a === 'emb' || a === 'name') { clubTab = a; el.hidden = true; openClub({ only: a, onDone: () => { el.hidden = false; draw(); } }); return; }
        if (a === 'bye') {
          const ok = await coachAsk('え、退任…？<br>このクラブの監督をやめる、ということでしょうか？<br><small>（育てた選手・順位など、セーブデータがすべて消えます）</small>', null, 'sec');
          if (ok) { el.hidden = true; save = C.newCareer(); store(); runners.length = 0; go('home'); open(); }
          else await coachAsk('やっぱり冗談ですよね。<br>これからもよろしくお願いします、監督！', [{ label: 'OK', value: true }], 'sec');
        } });
      box.querySelectorAll('[data-bt]').forEach((b) => b.onclick = () => { bizTab = b.dataset.bt; draw(); });
      box.querySelector('.of-back').onclick = () => { if (panel) { panel = null; draw(); return; } el.hidden = true; go('home'); };
      box.querySelectorAll('[data-s]').forEach((t) => t.onclick = () => { const k = t.dataset.s; if (sortK === k) sortDir = -sortDir; else { sortK = k; sortDir = 1; } draw(); });
      { const m = box.querySelector('.ot-mode'); if (m) m.onclick = () => { mode = mode === 'st' ? 'ab' : mode === 'ab' ? 'cd' : 'st'; draw(); }; }
      box.querySelectorAll('.ot tr[data-i]').forEach((tr) => tr.onclick = () => playerDetail(+tr.dataset.i, { office: true, onChange: () => draw() }));
    };
    draw(); el.hidden = false; el._fit();
  }


  // ================= 版505：スカウト（選手ガチャ）=================
  const SND2 = (n) => { try { window.DotSound && DotSound.play(n); } catch (_) {} };
  function gcTeamShort(tid) { const t = (C.TEAMS || []).find((x) => x.id === tid); return t ? t.short || t.name : ''; }
  function gcFace(tid, q, cls) { const k = C.faceKeyOf(tid, q); return k ? starPic(k, '#ffffff', q.pos === 'GK', cls) : `<img class="${cls}" alt="">`; }
  // 版521：スカウトの背景（監督の絵）。赤い斜めの演出だけを、ピックアップ選手の色に塗りかえる（スタジアムはそのまま）
  const gcBgCache = new Map(); let gcBgImg = null;
  function gcBgFor(chip, cb) {
    const toHsl = (h) => { const n = parseInt(h.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
      let hh = 0; if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(hh * 60 + 360) % 360, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l]; };
    const cs = (chip || ['#c8141e']).map(toHsl), ok = (c) => c[1] > 0.45 && c[2] > 0.25 && c[2] < 0.7, best = cs.find(ok) || cs.slice().sort((a, b) => b[1] - a[1])[0];   // 選手の色（1つ目が濃すぎる・白い時は2つ目）
    const H = best[0], Sk = Math.min(1, best[1] / 0.6), key = Math.round(H) + '|' + Sk.toFixed(2);
    if (gcBgCache.has(key)) { cb(gcBgCache.get(key)); return; }
    const go = () => { try {
      const im = gcBgImg, W = im.naturalWidth, Hh = im.naturalHeight, c = document.createElement('canvas'); c.width = W; c.height = Hh; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      if (!(H < 12 || H > 350) || Sk < 0.9) {
        const d = x.getImageData(0, 0, W, Hh), px = d.data;
        for (let i = 0; i < px.length; i += 4) { const r = px[i], g = px[i + 1], b = px[i + 2], w = Math.max(0, Math.min(1, (r - Math.max(g, b) - 25) / 70)); if (!w) continue;
          // 赤の明るさ（陰影）はそのまま、色あいだけを選手の色へ
          const mx = r / 255, mn = Math.min(g, b) / 255, l = (mx + mn) / 2, sat = (mx - mn) / (1 - Math.abs(2 * l - 1) || 1) * Sk;
          const C2 = (1 - Math.abs(2 * l - 1)) * sat, X = C2 * (1 - Math.abs(((H / 60) % 2) - 1)), m = l - C2 / 2;
          const [r1, g1, b1] = H < 60 ? [C2, X, 0] : H < 120 ? [X, C2, 0] : H < 180 ? [0, C2, X] : H < 240 ? [0, X, C2] : H < 300 ? [X, 0, C2] : [C2, 0, X];
          px[i] = r * (1 - w) + (r1 + m) * 255 * w; px[i + 1] = g * (1 - w) + (g1 + m) * 255 * w; px[i + 2] = b * (1 - w) + (b1 + m) * 255 * w; }
        x.putImageData(d, 0, 0); }
      const u = c.toDataURL('image/jpeg', 0.88); gcBgCache.set(key, u); cb(u); } catch (e) { cb('img/gacha_bg.jpg'); } };
    if (gcBgImg && gcBgImg.complete && gcBgImg.naturalWidth) go(); else { if (!gcBgImg) { gcBgImg = new Image(); gcBgImg.src = 'img/gacha_bg.jpg'; } gcBgImg.addEventListener('load', go, { once: true }); }
  }
  function openGacha() {
    const el = fullScreen('gachaScreen', 'std-wrap gc-wrap'), box = el.querySelector('.lk-box');
    const g = C.ensureGacha(save);
    if (!g.gift) { g.gift = 1; save.coins = (save.coins || 0) + 2000; store(); setTimeout(() => coachAsk('スカウトがオープンしました！<br>記念に <b>2,000コイン</b> をプレゼントします。<br>さっそく選手をスカウトしてみましょう！', [{ label: 'OK', value: true }], 'sec'), 300); }
    const draw = () => {
      const bn = C.gachaBanner(), U = bn.uniq, q = C.rosterAt(bn.tid, 1).players.find((x) => x.no === bn.no), left = C.GACHA_PITY - (g.pity[bn.id] || 0);
      const cc = U.chip || ['#c8141e', '#ffd23a', '#ffe45a'];
      const tp = U.type || q.type || '';
      // 版519：監督の作ったスカウト画面（夜のスタジアム・大きな選手・右に操作パネル）に合わせた
      // 版523：監督のデザイン案（1672×940）を、1280×720の画面にそのままの位置・大きさで写した
      box.innerHTML = `<div class="gc gc2 gc3" style="--c0:${cc[0]};--c1:${cc[1]};--c2:${cc[2]}">
        <div class="gc2-bg"></div>
        ${SCOUT_ART[bn.key] ? `<img class="gc3-art" src="${SCOUT_ART[bn.key]}" alt="">` : `<div class="gc3-fc">${gcFace(bn.tid, q, 'gc3-face')}</div>`}
        <div class="gc3-ttl"><b>スカウト</b></div>
        <div class="gc3-pills"><span class="gc3-coin">${COIN}<b>${(save.coins || 0).toLocaleString()}</b></span>
        <span class="gc3-kk"><img class="kk-ico" src="icons/kakera.png" alt="カケラ" draggable="false">覚醒のカケラ<b>${(save.kakera || 0).toLocaleString()}</b></span></div>
        <button class="std-back gc-back gc3-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button>
        <div class="gc3-rib"><span>今月のピックアップ</span><span>${esc(bn.until)}まで</span></div>
        <div class="gc3-star">${'<i>★</i>'.repeat(5)}</div>
        <div class="gc3-nm"><i class="gc3-brush"></i><b>${esc(U.who)}</b></div>
        <div class="gc3-pos"><i>${esc(q.pos)}</i><span>${esc(gcTeamShort(bn.tid))}</span><s></s><span>${esc(tp)}</span></div>
        <div class="gc3-line"></div>
        <p class="gc3-title">国内屈指の${esc(tp)}</p>
        <div class="gc3-un"><i class="gc3-lbl">固有スキル</i><i class="gc3-brush2"></i><b>${esc(U.name)}</b><small>${esc(U.se || '')}</small></div>
        <div class="gc3-side">
          <div class="gc3-pity"><span>ピックアップ確定まで</span><b>あと<em>${left}</em>回</b><i><s style="width:${Math.max(4, Math.round((1 - left / C.GACHA_PITY) * 100))}%"></s></i></div>
          <button class="gc2-btn gc3-btn ten" data-n="10"><b>10回スカウト</b><span>${COIN}${C.GACHA_COST.ten.toLocaleString()}</span><small>★3以上 1人確定</small></button>
          <button class="gc2-btn gc3-btn one" data-n="1"><b>1回スカウト</b><span>${COIN}${C.GACHA_COST.one}</span></button>
          <button class="gc-rate gc3-sb s1">出る確率<em>›</em></button><button class="gc-rule gc3-sb s2">獲得ルール<em>›</em></button><button class="gc-auto gc3-sb s3${g.auto ? ' on' : ''}"><span>自動放出<small>${['しない', '★1', '★2以下'][g.auto || 0]}</small></span><i class="gc2-sw"></i></button>
        </div></div>`;
      { const bgEl = box.querySelector('.gc2-bg'); gcBgFor(U.chip, (u) => { bgEl.style.backgroundImage = `url(${u})`; bgEl.classList.add('on'); }); }
      box.querySelector('.gc-rule').onclick = () => coachAsk('<b>獲得ルール</b><br><small>同じ選手が出たら凸（最大3凸）。完凸のあとは覚醒のカケラになります。<br>自動放出をオンにすると、はじめて出た選手のうち、その★以下はカケラになります（持っている選手は凸）。<br>チームが25人の時は、リザーブ（控え室）に入ります。</small>', [{ label: 'とじる', value: true }], 'sec');
      box.querySelector('.gc-back').onclick = () => { el.hidden = true; go('home'); };
      box.querySelector('.gc-auto').onclick = () => { g.auto = ((g.auto || 0) + 1) % 3; store(); draw(); };
      box.querySelector('.gc-rate').onclick = () => coachAsk(`<b>出る確率</b><br>${C.GACHA_RATE.map(([st, pc]) => `☆${st}：${pc}%`).join('　')}<br><small>☆5は今月のピックアップの${esc(U.who)}だけ。<br>このスカウトで${C.GACHA_PITY}回引くと、${esc(U.who)}が確定（出たら数え直し）。<br>10回スカウトは、☆3以上が1人確定。</small>`, [{ label: 'とじる', value: true }], 'sec');
      box.querySelectorAll('.gc2-btn').forEach((b) => b.onclick = async () => {
        const n = +b.dataset.n, res = C.gachaPull(save, n);
        if (!res) { coachAsk('コインが足りません。<br>カップ戦で勝つと、コインがもらえますよ。', [{ label: 'OK', value: true }], 'sec'); return; }
        store(); await gachaShow(el, res); draw();
      });
    };
    draw(); el.hidden = false; el._fit();
  }
  // 引いた時の演出：光の玉が落ちてきて（いちばん良い☆の色）→ カードが1枚ずつめくれる → 凸の選手は☆の色が変わる
  // 版554：スカウトの演出（抽選はもう終わっている。結果に合わせて見せるだけ）
  //  ☆1〜3＝青いカード／☆4＝金色に光って粒が広がる／☆5＝暗転→赤い稲妻→カットイン→登場
  //  昇格：青いカードが開く直前に割れて、金色（☆4）か赤色（☆5）に変わる
  //  10回：ふつうの選手はテンポよくめくり、☆4・☆5だけ真ん中で大きく見せる。最後に10人の一覧。いつでも「スキップ」
  // 版816：スカウトの演出の確認ページ（gachalab.html）用：コインやセーブを使わずに、決めた☆の結果で演出だけ見る
  function gachaDemo(stars, promo, fx) {
    const clone = save ? JSON.parse(JSON.stringify(save)) : C.newCareer('テストFC'); clone.coins = 1e12; C.ensureGacha(clone);   // 版819：保存が使えない所（確認ページ）でも動く
    const results = stars.map((st) => { for (let k = 0; k < 6000; k++) { const r0 = C.gachaPull(clone, 1); const r = r0 && r0.results[0]; if (r && r.star === st) return r; } return null; }).filter(Boolean);
    const el = fullScreen('gachaScreen', 'std-wrap gc-wrap'); el.style.zIndex = 9000; el.hidden = false; el._fit();   // 確認ページ：ほかの画面（クラブ設定など）より上に出す
    return gachaShow(el, { results, promo, fx }).then(() => { el.hidden = true; });
  }
  function gachaShow(el, res) {
    // 版821：スカウト中はドキドキする曲。止まり始めたら曲を止めて、音が上がっていく。終わったら元の曲に戻す
    const DS = window.DotSound, bgmBack = DS && DS.state ? DS.state.want : null; try { DS && DS.bgm('gacha'); } catch (_) {}
    const BACK = bgmBack || 'club'; let cheered = false;
    const faceCheer = (big) => { if (cheered) return; cheered = true; SND2(big ? 'gachaCheer' : 'gachaCheerS'); setTimeout(() => { try { DS && (DS.bgmIn ? DS.bgmIn(BACK, 3.5) : DS.bgm(BACK)); } catch (_) {} }, 1800); };   // 版822：顔が出たら歓声 → 歓声が小さくなるころ、いつもの曲がだんだん大きく
    return new Promise((done0) => { const done = (v) => { try { DS && DS.bgm(BACK); } catch (_) {} done0(v); };
      const rs = res.results, one = rs.length === 1, box = el.querySelector('.lk-box');
      const ov = document.createElement('div'); ov.className = 'gcs gx'; box.appendChild(ov);
      let skip = false, finished = false; const timers = new Set();
      const wait = (ms) => new Promise((ok) => { if (skip) { ok(); return; } const t = setTimeout(() => { timers.delete(t); ok(); }, ms); timers.add(t); waiters.add(ok); });
      const waiters = new Set();
      const doSkip = () => { if (skip) return; skip = true; timers.forEach(clearTimeout); timers.clear(); waiters.forEach((f) => f()); waiters.clear(); };
      const tierOf = (r) => (r.star >= 5 ? 'red' : r.star >= 4 ? 'gold' : 'blue');
      // 昇格するか：☆5は半分、☆4は3枚に1枚くらい（結果は変わらない。見せ方だけ）
      const promo = rs.map((r) => (r.star < 3 ? false : res.promo != null ? !!res.promo : r.star >= 5 ? Math.random() < 0.5 : r.star >= 4 ? Math.random() < 0.35 : Math.random() < 0.2));   // res.promo：確認ページで「昇格あり／なし」を決める時だけ
      const badgeOf = (r) => (r.kind === 'new' ? (r.reserve ? '<em class="b-res">NEW・リザーブへ</em>' : '<em class="b-new">NEW</em>') : r.kind === 'totsu' ? `<em class="b-tz">凸UP ${r.from}→${r.to}</em>` : r.kind === 'auto' ? `<em class="b-auto">放出・カケラ +${r.kakera}</em>` : `<em class="b-kk">カケラ +${r.kakera}</em>`);
      const faceHTML = (r) => { const tz = r.kind === 'totsu' ? r.to : r.p ? r.p.totsu || 0 : 0; return `${gcFace(r.tid, r.q, 'gcc-face')}<div class="gcc-st">${starHTML(r.star, tz)}</div><b>${esc(r.q.name)}</b><small>${esc(gcTeamShort(r.tid))}・${esc(r.q.pos)}</small>${badgeOf(r)}`; };
      const cardHTML = (r, i, back) => `<div class="gx-c s${r.star}" data-i="${i}"><div class="gx-in"><div class="gx-b ${back}"><i class="gx-crk"></i></div><div class="gx-f">${faceHTML(r)}</div></div></div>`;
      const burst = (host, n, col) => { const w = document.createElement('div'); w.className = 'gx-burst'; w.style.setProperty('--pc', col); let h = ''; for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260; h += `<i style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;--s:${(0.5 + Math.random()).toFixed(2)};animation-delay:${(Math.random() * 0.12).toFixed(2)}s"></i>`; } w.innerHTML = h; host.appendChild(w); setTimeout(() => w.remove(), 1400); };
      const skipBtn = () => { const b = document.createElement('button'); b.className = 'gx-skip'; b.textContent = 'スキップ ▶▶'; b.onclick = (e) => { e.stopPropagation(); doSkip(); }; ov.appendChild(b); };
      // 版815：ウイイレ（myClub）のボール演出：ボールが横に流れてきて、真ん中のリングで止まる → 昇格（色が変わる）→ ほかのボールが消える → 稲妻・光 → 選手のカード
      //  ボールの色：☆1・☆2＝白、☆3＝銀、☆4＝金、☆5＝黒
      const BALL = (st) => (st >= 5 ? 'black' : st >= 4 ? 'gold' : st >= 3 ? 'silver' : 'white');
      const BSRC = (c) => `img/gacha/ball_${c}.png`;
      const SP = 188, BS = 172, CX = 640, CY = 420, NB = 34, TG = 28;   // 版816：ボールを大きく（リングいっぱいに）
      const fillCol = () => { const x = Math.random(); return x < 0.04 ? 'black' : x < 0.18 ? 'gold' : x < 0.48 ? 'silver' : 'white'; };
      async function roll(r, i, multi) {
        // 版817：ボールは流れ続け、画面をタップしたら止まり始める（タップしないと12秒で自動で止まる）
        // 版818：☆5の確定演出（タップで雷の音／流れるボールが全部黒）とサプライズ（黒のとなりで止まって、黒へズレる）
        const mode = r.star < 5 ? '' : res.fx != null ? res.fx : (() => { const x = Math.random(); return x < 0.25 ? 'thunder' : x < 0.4 ? 'black' : x < 0.65 ? 'slip' : ''; })();
        const pr = promo[i] && mode !== 'black' && mode !== 'slip';
        const shown = pr ? (r.star >= 5 ? 4 : r.star >= 4 ? 3 : 2) : r.star;
        const row = ov.querySelector('.gb-row'), ring = ov.querySelector('.gb-ring'), NBB = 220, V = 1.25;   // V：流れる速さ（1ミリ秒あたりの点の数）
        row.className = 'gb-row'; ring.classList.remove('lock');
        row.innerHTML = Array.from({ length: NBB }, (_, k) => `<img class="gb-b" src="${BSRC(mode === 'black' ? 'black' : fillCol())}" style="left:${k * SP}px" alt="" draggable="false">`).join('');
        const bs = [...row.querySelectorAll('.gb-b')];
        let x = CX - BS / 2 - 2 * SP, tb = null; const hint = document.createElement('p'); hint.className = 'gb-hint'; hint.textContent = 'タップでストップ'; ov.appendChild(hint);
        SND2('gachaOrb');
        await new Promise((ok) => {
          let tap = false, t1 = 0, x1 = 0, xEnd = 0, dur = 0, last = performance.now(); const t0 = last;
          const go = () => { if (tap) return; tap = true; hint.remove(); ov.removeEventListener('pointerdown', onTap);
            const c = (CX - BS / 2 - x) / SP, T = Math.min(Math.ceil(c) + 6, bs.length - 2); tb = bs[T]; tb.classList.add('t'); tb.src = BSRC(BALL(shown));
            if (mode === 'slip') { bs[T - 1].src = BSRC(Math.random() < 0.5 ? 'silver' : 'gold'); }   // いったん黒のひとつ手前で止まる
            else if (mode !== 'black' && shown < 5 && Math.random() < 0.3) bs[T + 1].src = BSRC('black');   // 惜しい！（黒のとなりで止まる）
            const T0 = mode === 'slip' ? T - 1 : T;
            x1 = x; xEnd = CX - (T0 * SP + BS / 2); dur = Math.max(900, 3 * (x1 - xEnd) / V); t1 = performance.now(); SND2('gachaTap'); try { DS && DS.bgm(null); } catch (_) {} SND2('gachaRise');
            if (r.star >= 5 && (mode === 'thunder' || mode === 'black' || (mode === '' && !pr))) { SND2('thunder');   // 版829：☆5はサプライズ（ズレ・色が変わる昇格）以外、タップで雷の音＋画面の揺れ
              const fl = ov.querySelector('.gb-flash'); fl.className = 'gb-flash on'; ov.classList.add('quake'); setTimeout(() => { fl.className = 'gb-flash'; }, 120); setTimeout(() => ov.classList.remove('quake'), 700); } };
          const onTap = (e) => { if (e.target.closest('.gx-skip')) return; go(); };
          ov.addEventListener('pointerdown', onTap);
          const step = (now) => {
            if (skip && !tap) go();
            if (!tap) { x -= V * (now - last); last = now; if (now - t0 > 12000) go(); }
            if (tap) { const u = skip ? 1 : Math.min(1, (now - t1) / dur), e = 1 - Math.pow(1 - u, 3); x = x1 + (xEnd - x1) * e; if (u >= 1) { row.style.transform = `translateX(${x.toFixed(1)}px)`; ok(); return; } }
            row.style.transform = `translateX(${x.toFixed(1)}px)`; requestAnimationFrame(step); };
          requestAnimationFrame(step); waiters.add(() => { skip = true; });
        });
        ring.classList.add('lock'); await wait(380);   // 版825：止まった時は音なし
        if (mode === 'slip' && !skip) {   // サプライズ：少し止まってから、カクッと黒へズレる
          await wait(900); ring.classList.remove('lock'); SND2('gachaUp5');
          await new Promise((ok) => { const xa = parseFloat(row.style.transform.replace(/[^\d.-]/g, '')) || 0, xb = xa - SP, t2 = performance.now();
            const st = (now) => { const u = skip ? 1 : Math.min(1, (now - t2) / 650), e = u < 1 ? 1 - Math.pow(1 - u, 2) * (1 - 0.15 * Math.sin(u * Math.PI)) : 1; row.style.transform = `translateX(${(xa + (xb - xa) * e).toFixed(1)}px)`; if (u < 1) requestAnimationFrame(st); else ok(); };
            requestAnimationFrame(st); });
          ring.classList.add('lock'); ov.querySelector('.gb-flash').className = 'gb-flash on'; setTimeout(() => { const f = ov.querySelector('.gb-flash'); if (f) f.className = 'gb-flash'; }, 140); await wait(500);
        }
        if (pr) {   // 昇格：リングの中のボールが震えて光り、上の色に変わる
          tb.classList.add('shake'); await wait(520);
          ov.querySelector('.gb-flash').className = 'gb-flash on'; tb.src = BSRC(BALL(r.star)); tb.classList.remove('shake'); tb.classList.add('up');
          burst(ov.querySelector('.gb-fx'), 34, r.star >= 5 ? '#7aa8ff' : r.star >= 4 ? '#ffd23a' : '#e8eef8'); SND2(r.star >= 5 ? 'gachaUp5' : r.star >= 4 ? 'gachaUp4' : 'gachaUp3');
          await wait(160); ov.querySelector('.gb-flash').className = 'gb-flash'; await wait(560);
        }
        row.classList.add('focus'); await wait(450);   // ほかのボールが消えて、リングの中の1つだけ
        if (r.star >= 4) {   // 稲妻（☆4は金、☆5は青白く2本）
          const bolt = document.createElement('div'); bolt.className = 'gb-bolt ' + (r.star >= 5 ? 's5' : 's4');
          // 版820：雷は画像（img/gacha/bolt.png）。先の光る所がボールに当たる。☆5は2本
          // 版830：本物の雷のように：細い光が上から地面まで一瞬で伸びる → ドカンと光る（空・会場が明るくなる）→ 2〜3回チカチカ → 消える。当たった所に光の玉と衝撃の輪、火花。向きは毎回ランダム
          const D = r.star >= 5 ? 1300 : 1000; bolt.style.setProperty('--bd', D + 'ms'); if (Math.random() < 0.5) bolt.classList.add('flip');
          bolt.innerHTML = `<i class="bsky"></i><img class="bt1" src="img/gacha/bolt.png" alt="">${r.star >= 5 ? '<img class="bt2" src="img/gacha/bolt.png" alt="">' : ''}<i class="bimp"></i><i class="bwave"></i>`;
          ov.appendChild(bolt); ov.style.setProperty('--bd', D + 'ms'); ov.classList.add('strike');
          await wait(Math.round(D * 0.09));   // 光が地面まで届いた瞬間
          SND2(r.star >= 5 ? 'gachaBolt5' : 'gachaBolt4'); ov.classList.add('quake'); burst(ov.querySelector('.gb-fx'), r.star >= 5 ? 40 : 26, r.star >= 5 ? '#bcd4ff' : '#ffe08a');
          await wait(Math.round(D * 0.91)); bolt.remove(); ov.classList.remove('strike', 'quake');
        }
        tb.classList.add('glow'); if (r.star >= 4) tb.classList.add(r.star >= 5 ? 'g5' : 'g4'); await wait(r.star >= 4 ? 750 : 450);
        const fl = ov.querySelector('.gb-flash'); fl.className = 'gb-flash white'; await wait(260);
        if (multi) { row.innerHTML = ''; ring.classList.remove('lock'); return; }   // 10回：10人まとめて見せる
        if (r.star >= 5) {   // ☆5：カットイン
          const U = (C.gachaBanner().key && r.q.uniq && window.DotSoccer.UNIQ[r.q.uniq]) || null;
          const ci = document.createElement('div'); ci.className = 'gx-cut'; ci.innerHTML = `<div class="gx-cut-band"></div><div class="gx-cut-fc">${gcFace(r.tid, r.q, 'gx-cut-face')}</div><div class="gx-cut-tx"><i>★★★★★</i><b>${esc(r.q.name)}</b>${U ? `<em>${esc(U.name)}</em>` : ''}</div>`;
          ov.appendChild(ci); fl.className = 'gb-flash'; faceCheer(true); await wait(1700); ci.classList.add('out'); await wait(300); ci.remove();
        }
        // 選手のカード
        row.innerHTML = ''; ring.classList.remove('lock');
        const cd = document.createElement('div'); cd.className = `gb-card s${r.star}`; cd.innerHTML = `<div class="gcc s${r.star}"><div class="gcc-in done"><div class="gcc-b"></div><div class="gcc-f">${faceHTML(r)}</div></div></div>`;
        ov.appendChild(cd); requestAnimationFrame(() => cd.classList.add('in')); faceCheer(r.star >= 4); fl.className = 'gb-flash';
        SND2(r.star >= 4 ? 'gachaHit' : 'reveal'); if (r.star >= 4) burst(ov.querySelector('.gb-fx'), r.star >= 5 ? 46 : 30, r.star >= 5 ? '#7aa8ff' : '#ffd23a');
        const dot = ov.querySelectorAll('.gb-dots i')[i]; if (dot) dot.className = 'on b-' + BALL(r.star);
        await wait(r.star >= 4 ? 1700 : one ? 1200 : 750);
        cd.classList.add('out'); await wait(220); cd.remove();
      }
      function finalList() {
        if (finished) return; finished = true; timers.forEach(clearTimeout); ov.className = 'gcs gx'; faceCheer(rs.some((x) => x.star >= 4));
        ov.innerHTML = `<div class="gcs-grid${one ? ' one' : ''}">${rs.map((r, i) => `<div class="gcc s${r.star}" style="--d:${one ? 0 : (i * 0.07).toFixed(2)}s"><div class="gcc-in${one ? ' done' : ''}"><div class="gcc-b"></div><div class="gcc-f">${faceHTML(r)}</div></div></div>`).join('')}</div><p class="gx-ttl">${one ? '' : `獲得した${rs.length}人`}</p><button class="gcs-ok primary">OK</button>`;
        ov.onclick = null; ov.querySelector('.gcs-ok').onclick = (e) => { e.stopPropagation(); totsuShow(0); };
      }
      // 凸の演出（今まで通り）
      const ups = rs.filter((r) => r.kind === 'totsu');
      const totsuShow = (k) => {
        if (k >= ups.length) { ov.remove(); done(); return; }
        const r = ups[k];
        ov.innerHTML = `<div class="gct"><div class="gct-card s${r.star}">${gcFace(r.tid, r.q, 'gct-face')}<b>${esc(r.q.name)}</b><div class="gct-st">${starHTML(r.star, r.from)}</div><p>凸UP！　${r.from}凸 → <span class="tz${r.to}">${r.to}凸</span>${r.to >= 3 ? '　<b class="gct-max">完凸</b>' : ''}</p></div><p class="gcs-tap">タップで次へ</p></div>`;
        const tl = []; [...ov.querySelectorAll('.gct-st .tz')].forEach((stz, i) => tl.push(setTimeout(() => { stz.className = 'tz tz' + r.to + ' pop'; SND2('reveal'); }, 500 + i * 220)));
        ov.onclick = () => { tl.forEach(clearTimeout); totsuShow(k + 1); };
      };
      (async () => {
        ov.className = 'gcs gb';
        ov.innerHTML = `<img class="gb-bg" src="img/gacha/stage.jpg" alt=""><div class="gb-fx"></div><div class="gb-row"></div><img class="gb-ring" src="img/gacha/ring.png" alt="" draggable="false"><div class="gb-flash"></div>`;
        skipBtn();
        if (one) await roll(rs[0], 0, false);
        else {   // 版817：10回は、10人のうちいちばん良い☆のボールで止めて、10人を一気に見せる
          let bi = 0; rs.forEach((r, k) => { if (r.star > rs[bi].star) bi = k; });
          await roll(rs[bi], bi, true);
          for (const r of rs) if (r.star >= 5 && !skip) {   // ☆5はカットイン
            const U = (C.gachaBanner().key && r.q.uniq && window.DotSoccer.UNIQ[r.q.uniq]) || null, fl = ov.querySelector('.gb-flash');
            const ci = document.createElement('div'); ci.className = 'gx-cut'; ci.innerHTML = `<div class="gx-cut-band"></div><div class="gx-cut-fc">${gcFace(r.tid, r.q, 'gx-cut-face')}</div><div class="gx-cut-tx"><i>★★★★★</i><b>${esc(r.q.name)}</b>${U ? `<em>${esc(U.name)}</em>` : ''}</div>`;
            ov.appendChild(ci); if (fl) fl.className = 'gb-flash'; faceCheer(true); await wait(1700); ci.classList.add('out'); await wait(300); ci.remove();
          }
        }
        finalList();
      })();
    });
  }
  // ================= ショップ =================
  // 版526：ショップ（監督のデザイン案3枚：おすすめ／特訓カード／プレミアムパス）。案の絵を下地にして、数字・ピックアップ・カードは中身に合わせて描く
  const SH_CATS = [['all', 'すべて'], ['tact', '戦術'], ['tech', 'テクニック'], ['phys', 'フィジカル'], ['sup', 'サポート']];
  const SCOUT_ART = {};   // 版543：スカウト画面の大きな絵（監督の素材）。ない選手は顔の絵
  const SH_PICK_ART = { guren: 'img/pick_guren_542.jpg' };   // 版542：ピックアップの絵がある選手は、その絵を使う（ない選手は顔の絵）
  const SH_CATCOL = { tact: '#1f9a45', tech: '#d81e1e', phys: '#2f6fd6', sup: '#d4a017' };
  let shopSt = { tab: 'rec', cat: 'tact', sel: null, qty: 1 };
  // 版564：カードパックを開ける演出 — パックが落ちてくる → タップで破れて光る → カードが飛び出して並ぶ → 1枚ずつめくる → まとめ
  function openPack(got, before, big) {
    const el = fullScreen('packScreen', 'pk-wrap'), box = el.querySelector('.lk-box');
    box.classList.remove('opened', 'spread', 'wait');   // 版565：前に開けた時の状態が残っていて、2回目からパックが出なかった
    const n = got.length, cols = 5, rows = Math.ceil(n / cols), CW = big ? 150 : 176, CH = Math.round(CW * 1.33), GX = big ? 22 : 26, GY = 20;
    const x0 = 640 - (cols * CW + (cols - 1) * GX) / 2, y0 = (big ? 330 : 360) - (rows * CH + (rows - 1) * GY) / 2;
    const seen = {}, items = got.map((k, i) => { const isNew = !(before[k] > 0) && !seen[k]; seen[k] = 1; return { k, i, isNew, x: x0 + (i % cols) * (CW + GX), y: y0 + Math.floor(i / cols) * (CH + GY) }; });
    const grp = {}; got.forEach((k) => grp[k] = (grp[k] || 0) + 1);
    const sum = Object.entries(grp).map(([k, c]) => `<span style="--cc:${SH_CATCOL[C.CARDS[k].cat]}"><b>${esc(C.CARDS[k].name)}</b>×${c}<small>所持 ${before[k] || 0}→${save.cards[k]}</small></span>`).join('');
    box.innerHTML = `<div class="pk-bg"><i class="pk-rays"></i></div>
      <p class="pk-ttl">${big ? 'カードパック（大）' : 'カードパック'}</p>
      <div class="pk-pack${big ? ' gold' : ''}"><div class="pk-top"></div><div class="pk-body"><b>CARD<br>PACK</b><i class="pk-ball">⚽</i><em>${n}枚入り</em></div><i class="pk-shine"></i></div>
      <p class="pk-tap">タップして開ける</p><div class="pk-flash"></div>
      <div class="pk-cards">${items.map((it) => `<div class="pk-c" data-i="${it.i}" style="--x:${it.x}px;--y:${it.y}px;width:${CW}px;height:${CH}px;--cc:${SH_CATCOL[C.CARDS[it.k].cat]}"><div class="pk-in"><div class="pk-back"><i>D</i></div><div class="pk-front"><img src="cards/${it.k}.jpg" alt="${esc(C.CARDS[it.k].name)}">${it.isNew ? '<em>NEW</em>' : ''}</div></div></div>`).join('')}</div>
      <div class="pk-sum" hidden><div class="pk-sl">${sum}</div><button class="pk-ok ib ib-ok ib-img">OK</button></div>
      <button class="pk-skip">スキップ ▶▶</button>`;
    // カードの絵を先に読んでおく
    got.forEach((k) => { const im = new Image(); im.src = `cards/${k}.jpg`; });
    el.hidden = false; el._fit();
    const S = (nm) => { try { DotSound.play(nm); } catch (_) {} };
    const cs = [...box.querySelectorAll('.pk-c')], timers = [];
    const later = (ms, f) => timers.push(setTimeout(f, ms));
    return new Promise((done) => {
      let stage = 0;   // 0：パック 1：開けている 2：まとめ
      const finish = () => { if (stage === 2) return; stage = 2; timers.forEach(clearTimeout); box.classList.add('opened', 'spread'); cs.forEach((c) => c.classList.add('out', 'flip')); box.querySelector('.pk-sum').hidden = false; box.querySelector('.pk-skip').hidden = true; box.querySelector('.pk-ttl').textContent = `手に入れたカード（${n}枚）`; S('ok'); };
      const open = () => {
        if (stage) return; stage = 1; S('tap');
        box.classList.add('opened'); S('gachaOrb');
        later(450, () => { box.classList.add('spread'); cs.forEach((c, i) => later(i * 55, () => c.classList.add('out'))); });
        const t0 = 450 + n * 55 + 450;
        cs.forEach((c, i) => later(t0 + i * (big ? 150 : 210), () => { c.classList.add('flip'); S(c.querySelector('.pk-front em') ? 'reveal5' : 'reveal'); }));
        later(t0 + n * (big ? 150 : 210) + 500, finish);
      };
      box.onclick = () => { if (!stage) open(); };   // 版566：画面のどこをさわっても開ける
      box.querySelector('.pk-skip').onclick = (e) => { e.stopPropagation(); if (!stage) { stage = 1; box.classList.add('opened'); } finish(); };
      box.querySelector('.pk-ok').onclick = (e) => { e.stopPropagation(); box.onclick = null; el.hidden = true; box.innerHTML = ''; done(); };
      later(1300, () => { if (!stage) box.classList.add('wait'); });
    });
  }
  // ================= 版570：コイン購入（課金）の画面 =================
  // いまはテスト版：本当のお金はかからない（あとでアプリの課金につなぐ）。買った記録は save.buys に残す
  // 版571：ピックアップのスカウト200回（20,000コイン）が、だいたい1.3万円になるように（いちばん大きいパックで1円＝約1.54コイン）
  const COIN_PACKS = [
    // 版813：650円〜12,800円（大きいパックほど増量：0・3・6・9・12・16%）
    { id: 'c1', coins: 870, yen: 650 },
    { id: 'c2', coins: 1790, yen: 1300 },
    { id: 'c3', coins: 3680, yen: 2600 },
    { id: 'c4', coins: 6540, yen: 4500, tag: '人気' },
    { id: 'c5', coins: 11950, yen: 8000 },
    { id: 'c6', coins: 19800, yen: 12800, tag: 'いちばんお得' },
  ];
  const COIN_BASE = 870 / 650;
  const csN = (v) => { const n = (v || 0).toLocaleString().length; return n >= 7 ? 'n7' : n >= 6 ? 'n6' : ''; };   // いちばん小さいパックの「1円あたりのコイン」を基準に、お得さを出す
  // ================= 版695：プレミアムパス（720円・30日） =================
  //  買った時：300コイン。毎日（ホームを開いた時に1日1回）：30コイン・特訓カード1枚・覚醒のカケラ2
  //  持っている間：試合の早送り（2倍・4倍）、SPメニューのヒント（毎週1枚）、特訓カードを199枚まで、名前の横に金のマーク
  const DAY = 86400000;
  const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const premDayN = () => { const P = save && save.prem; if (!P) return 0; return Math.floor((midnight(Date.now()) - midnight(P.start)) / DAY) + 1; };
  const premLeft = () => { const P = save && save.prem; if (!C.premOn(save)) return 0; return Math.max(1, Math.ceil((P.until - Date.now()) / DAY)); };
  const premMark = (on) => (on ? '<i class="prem-mk" title="プレミアムパス">P</i>' : '');
  function premSync() { try { document.documentElement.classList.toggle('prem-on', C.premOn(save)); window.__premOn = C.premOn(save); } catch (_) {} }
  // 版703：お金での購入（Stripe）。支払いの画面へ行き、払い終わったらサーバーから受け取る
  const payReal = () => !!(window.DotNet && DotNet.on && DotNet.PAY_ON);
  async function payGo(item, label, yen) {
    const q = item === 'prem'
      ? `<b>プレミアムパス</b>を <b>月額 ¥${yen.toLocaleString()}</b> ではじめますか？<br><small>毎月、自動で ¥${yen.toLocaleString()} のお支払いがあり、パスが続きます。<br>解約はいつでもできます。解約しても、その月の終わりまで使えます。<br>支払いの画面（Stripe）が開きます。払い終わったら、ゲームにもどってください。</small>`
      : `<b>${label}</b>を <b>¥${yen.toLocaleString()}</b> で購入しますか？<br><small>支払いの画面（Stripe）が開きます。払い終わったら、ゲームにもどってください。</small>`;
    if (!(await coachAsk(q, [{ label: '支払いへ進む', value: true }, { label: 'やめる', value: false }], 'sec'))) return;
    const t = document.createElement('div'); t.className = 'pay-wait'; t.innerHTML = '<p>支払いの画面を開いています…</p>'; (document.getElementById('app') || document.body).appendChild(t);
    try { const r = await DotNet.payCheckout(item); save.payPending = { item, at: Date.now() }; store();
      payOpen(t, r.url); }
    catch (e) { t.remove(); const code = String((e && (e.code || e.message)) || e);
      if (/already-exists/.test(code)) { await coachAsk('プレミアムパスは、もう申し込みずみです。<br><small>解約やカードの変更は、ショップのプレミアムパスの「お支払いの管理」からできます。</small>', [{ label: 'OK', value: true }], 'sec'); payCollect(); return; }
      coachAsk(`支払いの画面を開けませんでした。<br><small>ネットにつながっているか確かめて、もう一度お試しください。<br>（${esc(code.slice(0, 80))}）</small>`, [{ label: 'OK', value: true }], 'sec'); }
  }
  // 版712：月額パスの解約・カードの変更（Stripeのお客さま用ページ）
  async function payManage() {
    const t = document.createElement('div'); t.className = 'pay-wait'; t.innerHTML = '<p>お支払いの管理の画面を開いています…</p>'; (document.getElementById('app') || document.body).appendChild(t);
    try { const r = await DotNet.payPortal(); save.payPending = { item: 'portal', at: Date.now() }; store(); payOpen(t, r.url); }
    catch (e) { t.remove(); coachAsk(`お支払いの管理の画面を開けませんでした。<br><small>ネットにつながっているか確かめて、もう一度お試しください。<br>（${esc(String((e && (e.code || e.message)) || e).slice(0, 80))}）</small>`, [{ label: 'OK', value: true }], 'sec'); }
  }
  function payOpen(t, url) {
      if (window.top !== window) {   // 版709：PCなど、ページの中で開いている時。自動で開けない時は、押して開くボタンを出す
        let w = null; try { w = window.open(url, '_blank'); } catch (_) {}
        if (w) t.remove();
        else { t.innerHTML = `<p>下のボタンを押すと、支払いの画面が<br>別のタブで開きます。</p><a class="pay-wait-go" href="${esc(url)}" target="_blank" rel="noopener">支払いの画面を開く</a><button type="button" class="pay-wait-x">やめる</button>`;
          t.querySelector('.pay-wait-go').onclick = () => setTimeout(() => t.remove(), 300); t.querySelector('.pay-wait-x').onclick = () => t.remove(); }
      } else {
        location.href = url;
        // 版708：支払いの画面を閉じてもどった時（iPhoneのホーム画面アプリなど）に「開いています…」が残らないように
        setTimeout(() => { if (t.isConnected) { t.innerHTML = '<p>支払いの画面を開いています…</p><button type="button" class="pay-wait-x">閉じる</button>'; t.querySelector('button').onclick = () => t.remove(); } }, 5000);
      }
  }
  // パスを足す（購入・受け取りの時）。until：月額パスの時は、Stripeの「この月の終わり」＋1日（更新の受け取りが少し遅れても切れないように）
  function premAdd(days, until) { const now = Date.now();
    if (until) { const u = until + DAY; if (C.premOn(save)) save.prem.until = Math.max(save.prem.until, u); else save.prem = { start: midnight(now), until: u, got: [] }; return; }
    if (C.premOn(save)) save.prem.until += days * DAY; else save.prem = { start: midnight(now), until: midnight(now) + days * DAY, got: [] }; }
  const subLive = () => { const S = save && save.premSub; return !!(S && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(S.status)); };
  // 払い終わったものを受け取る（ゲームにもどった時・ホーム・ショップを開いた時）
  let payBusy = false;
  async function payCollect() {
    if (payBusy || !save || !payReal()) return; payBusy = true;
    try {
      const got = await DotNet.payClaim();
      { const old = JSON.stringify(save.premSub || null); save.premSub = got.sub || null;   // 版712：月額パスの状態（自動更新中・解約予定）
        if (JSON.stringify(save.premSub) !== old) { if (save.payPending && save.payPending.item === 'portal') delete save.payPending; store(); const sb = document.querySelector('#shopScreen:not([hidden])'); if (sb && sb._redraw) sb._redraw(); } }
      if (!got.length) return;
      for (let i = 0; i < 600 && document.getElementById('ttTitle'); i++) await new Promise((r) => setTimeout(r, 200));   // 版707：タイトル画面の上では飛ばさない
      for (const g of got) {
        const c0 = save.coins || 0; save.coins = c0 + (g.coins || 0); if (g.premDays) premAdd(g.premDays, g.premUntil);
        (save.buys = save.buys || []).push({ id: g.item, coins: g.coins, yen: g.yen, at: Date.now(), pay: g.id, live: !!g.live }); delete save.payPending;
        addPost({ kind: 'buy', coins: g.coins || 0, yen: g.yen || 0, prem: g.premDays || 0, renew: !!g.renew, test: !g.live }); try { postBadge(); } catch (_) {}   // 版705：ポストに記録
        store(); premSync();
        const cs = document.querySelector('#coinScreen:not([hidden]) .lk-box'), sb = document.querySelector('#shopScreen:not([hidden]) .lk-box');
        if (cs && g.coins) { coinGain(cs, cs.querySelector('.cs-have') || cs, c0, save.coins, null); await new Promise((r) => setTimeout(r, 1900)); }
        else if (sb && g.coins) { const cn = sb.querySelector('.sh3-cn'), tg = sb.querySelector('.sh3-coin'); if (cn) { coinGain(sb, sb.querySelector('.pm-buy') || tg, c0, save.coins, null, { to: tg, num: cn }); await new Promise((r) => setTimeout(r, 1900)); } }
        else { const hc = document.querySelector('.h2-coin'), hb = hc && hc.querySelector('b');   // 版706：ホームの時は、上の帯のコインへ飛ばす
          if (hc && hb && g.coins) { homeCoinFly(hc, hb, c0, save.coins); await new Promise((r) => setTimeout(r, 1900)); } else { try { DotSound.play('coinBurst'); } catch (_) {} } }
        await coachAsk(g.item === 'prem' ? (g.renew ? `プレミアムパスが<b>自動で更新</b>されました。<br>今月もよろしくお願いします！<b>${g.coins}コイン</b>をどうぞ。` : `ご購入ありがとうございます！<br><b>プレミアムパス（月額）</b>がはじまりました。<br><b>${g.coins}コイン</b>もどうぞ。<br><small>毎月、自動で更新されます。解約は、ショップのプレミアムパスからいつでもできます。</small>`) : `ご購入ありがとうございます！<br><b>${(g.coins || 0).toLocaleString()} コイン</b>が届きました。`, [{ label: 'OK', value: true }], 'sec');
      }
      if (got.some((g) => g.item === 'prem')) premDaily();
    } catch (_) {} finally { payBusy = false; }
  }
  const payWaitOff = () => document.querySelectorAll('.pay-wait').forEach((e) => e.remove());   // 版708
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { payWaitOff(); setTimeout(payCollect, 400); } });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { payWaitOff(); setTimeout(payCollect, 400); } });
  addEventListener('focus', () => setTimeout(payCollect, 400));
  // 版713：iPhoneのホーム画面アプリでは、支払いの画面を閉じても「もどった」合図が来ないことがある。
  //  払っている途中（payPending）の間は、こちらから見に行く（はじめの2分は3秒ごと、そのあと30分までは20秒ごと）
  setInterval(() => { const P = save && save.payPending; if (!P || document.hidden || payBusy) return;
    const age = Date.now() - (P.at || 0); if (age > 30 * 60 * 1000) { delete save.payPending; store(); return; }
    if (age < 2 * 60 * 1000 || Math.floor(Date.now() / 3000) % 7 === 0) payCollect(); }, 3000);
  async function buyPrem(redraw) {
    const P = C.PREM, on = C.premOn(save);
    if (payReal()) {   // 版712：月額パス
      if (!subLive()) return payGo('prem', 'プレミアムパス（月額）', P.yen);
      const S = save.premSub, end = S.until ? new Date(S.until) : null, ds = end ? `${end.getMonth() + 1}月${end.getDate()}日` : '';
      const v = await coachAsk(S.cancelAtEnd ? `プレミアムパスは<b>解約ずみ</b>です。<br><small>${ds ? `${ds}まで使えます。そのあとは、お金はかかりません。<br>` : ''}続けたくなったら、「お支払いの管理」から解約を取り消せます。</small>` : `プレミアムパスは<b>自動更新中</b>です。<br><small>${ds ? `次の更新日：${ds}（¥${P.yen.toLocaleString()}）<br>` : ''}解約・カードの変更は「お支払いの管理」からできます。<br>解約しても、${ds || 'その月の終わり'}まで使えます。</small>`, [{ label: 'お支払いの管理', value: true }, { label: '閉じる', value: false }], 'sec');
      if (v) payManage(); return;
    }
    const ok = await coachAsk(`<b>プレミアムパス（${P.days}日）</b>を <b>¥${P.yen.toLocaleString()}</b> で購入しますか？${on ? `<br><small>今のパスに ${P.days}日 足されます（残り ${premLeft()}日 → ${premLeft() + P.days}日）</small>` : ''}<br><small>（テスト版のため、本当のお金はかかりません）</small>`, [{ label: '購入する', value: true }, { label: 'やめる', value: false }], 'sec');
    if (!ok) return;
    const now = Date.now();
    if (on) save.prem.until += P.days * DAY;
    else save.prem = { start: midnight(now), until: midnight(now) + P.days * DAY, got: [] };
    const c0 = save.coins || 0; save.coins = c0 + P.bonus;
    (save.buys = save.buys || []).push({ id: 'prem', yen: P.yen, at: now, test: true });
    store(); premSync();
    // 版696：コインが左上へ飛んでいく（ショップの画面の時）
    { const sb = document.querySelector('#shopScreen:not([hidden]) .lk-box'), btn = sb && sb.querySelector('.pm-buy'), cn = sb && sb.querySelector('.sh3-cn'), tg = sb && sb.querySelector('.sh3-coin');
      if (btn && cn) { coinGain(sb, btn, c0, save.coins, null, { to: tg, num: cn }); await new Promise((r) => setTimeout(r, 1900)); } }
    await coachAsk(`プレミアムパスを手に入れました！<br><b>${P.bonus}コイン</b>をどうぞ。<br><small>これから${P.days}日間、毎日ホームでプレゼントを受け取れます。</small>`, [{ label: 'OK', value: true }], 'sec');
    if (redraw) redraw();
    premDaily();
  }
  // 毎日の受け取り（1〜30日のマス）
  let premBusy = false;
  async function premDaily(look) {   // look：版709 ショップから「毎日のプレゼント」を見る時
    if (premBusy || !save || !C.premOn(save)) return;
    const n = premDayN(), P = save.prem; P.got = P.got || [];
    if (n < 1 || (!look && P.got.includes(n))) return;
    premBusy = true;
    if (!look) {
      for (let k = 0; k < 80 && (document.getElementById('ttTitle') || !$('#crModal').hidden || view !== 'home'); k++) await new Promise((r) => setTimeout(r, 250));   // タイトル・ほかの画面が閉じるまで待つ
      if (view !== 'home' || P.got.includes(n)) { premBusy = false; return; }
    }
    const done = P.got.includes(n);
    const blk = Math.floor((n - 1) / 30), D0 = C.PREM.daily;
    const cells = Array.from({ length: 30 }, (_, i) => { const d = blk * 30 + i + 1, got = P.got.includes(d), today = d === n, past = d < n && !got;
      return `<div class="pd-c${got ? ' got' : ''}${today ? ' today' : ''}${past ? ' miss' : ''}"><small>${i + 1}日目</small><span>${COIN}<img src="icons/kakera.png" alt=""></span>${got ? '<b class="pd-ok">受取済</b>' : ''}</div>`; }).join('');
    const el = document.createElement('div'); el.className = 'pd-wrap';
    el.innerHTML = `<div class="pd-box"><div class="pd-h"><b>プレミアムパス</b><span>毎日のプレゼント</span><em>残り ${premLeft()}日</em></div>
      <div class="pd-grid">${cells}</div>
      <div class="pd-f">${done ? `<p>今日のプレゼントは、受け取りました。<br><small>明日も ${COIN}<b>${D0.coins}</b>コイン　特訓カード<b>${D0.cards}</b>枚　カケラ<b>${D0.kak}</b> が届きます。</small></p><button class="pd-go">閉じる</button>` : `<p>今日のプレゼント：${COIN}<b>${D0.coins}</b>コイン　特訓カード<b>${D0.cards}</b>枚　<img class="kk-ico" src="icons/kakera.png" alt="">カケラ<b>${D0.kak}</b></p><button class="pd-go">受け取る</button>`}</div></div>`;
    (document.getElementById('app') || document.body).appendChild(el);
    await new Promise((ok) => { el.querySelector('.pd-go').onclick = ok; });
    if (done) { el.remove(); premBusy = false; return; }
    // 受け取り
    const cards = Object.keys(C.CARDS); let cd = null;
    for (let k = 0; k < D0.cards; k++) { for (let j = 0; j < 40; j++) { const c = cards[Math.floor(Math.random() * cards.length)]; if ((save.cards[c] || 0) < C.cardMax(save)) { cd = c; break; } } if (cd) save.cards[cd] = (save.cards[cd] || 0) + 1; }
    save.coins = (save.coins || 0) + D0.coins; save.kakera = (save.kakera || 0) + D0.kak; P.got.push(n); store();
    try { window.DotSound && DotSound.play('coinBurst'); } catch (_) {}
    el.querySelector('.pd-c.today').classList.add('got'); el.querySelector('.pd-c.today').insertAdjacentHTML('beforeend', '<b class="pd-ok">受取済</b>');
    el.querySelector('.pd-f').innerHTML = `<div class="pd-got">${COIN}<b>+${D0.coins}</b>${cd ? `<img class="pd-card" src="cards/${cd}.jpg" alt=""><b>${esc(C.CARDS[cd].name)}</b>` : ''}<img class="kk-ico" src="icons/kakera.png" alt=""><b>+${D0.kak}</b></div><button class="pd-go">OK</button>`;
    await new Promise((ok) => { el.querySelector('.pd-go').onclick = ok; });
    el.remove(); premBusy = false;
    try { renderHome(); } catch (_) {}
  }
  // SPメニューのヒント：毎週1つ、まだ見つけていないメニューのカードを1枚見せる
  function premHint() {
    if (!C.premOn(save)) return null;
    const wk = `${save.season}-${save.week}`, found = new Set(save.spFound || []);
    const P = save.prem;
    if (P.hint && P.hint.wk === wk && !found.has(P.hint.id)) return P.hint;
    if (P.hint && P.hint.wk === wk) return null;   // 今週のヒントはもう見つけた
    const rest = C.SP.filter((m) => !found.has(m.id)); if (!rest.length) return null;
    const m = rest[Math.floor(Math.random() * rest.length)];
    P.hint = { wk, id: m.id, c: m.cards[Math.floor(Math.random() * m.cards.length)] }; store();
    return P.hint;
  }
  function coinShop(onClose) {
    const el = fullScreen('coinScreen', 'cs-wrap'), box = el.querySelector('.lk-box');
    // 版573：監督の絵（img/coin_shop.jpg）をそのまま使い、押せる場所と「所持」の数字だけ重ねる（版814：650円〜12,800円の絵に差し替え）
    const AREA = [[113, 300, 318, 58], [492, 300, 297, 58], [849, 300, 320, 58], [113, 577, 318, 57], [492, 577, 297, 57], [849, 577, 320, 57]];   // 版574：青い「購入」ボタンのところだけ
    const draw = () => {
      box.innerHTML = `<img class="cs-img" src="img/coin_shop.jpg?v=814" alt="">
        <button class="cs-back cs-hit" style="left:104px;top:8px;width:68px;height:68px" title="もどる"></button>
        <span class="cs-have">${COIN}<small class="cs-hl">所持</small><em class="${csN(save.coins)}">${(save.coins || 0).toLocaleString()}</em><small>コイン</small></span>
        ${COIN_PACKS.map((p, i) => `<button class="cs-item cs-hit cs-buyb" data-id="${p.id}" style="left:${AREA[i][0]}px;top:${AREA[i][1]}px;width:${AREA[i][2]}px;height:${AREA[i][3]}px" title="${p.coins}コイン ¥${p.yen}"></button>`).join('')}`;
      box.querySelector('.cs-back').onclick = () => { el.hidden = true; if (onClose) onClose(); };
      box.querySelectorAll('.cs-item').forEach((b) => b.onclick = async () => {
        const p = COIN_PACKS.find((x) => x.id === b.dataset.id);
        if (payReal()) return payGo(p.id, `${p.coins.toLocaleString()} コイン`, p.yen);   // 版703：本物の支払い
        if (!(await coachAsk(`<b>${p.coins.toLocaleString()} コイン</b>を <b>¥${p.yen.toLocaleString()}</b> で購入しますか？<br><small>（テスト版のため、本当のお金はかかりません）</small>`, [{ label: '購入する', value: true }, { label: 'やめる', value: false }], 'sec'))) return;
        const from = save.coins || 0; save.coins = from + p.coins; (save.buys = save.buys || []).push({ id: p.id, coins: p.coins, yen: p.yen, at: Date.now(), test: true }); store();
        coinGain(box, b, from, save.coins, draw);
      });
    };
    draw(); el.hidden = false; el._fit(); setTimeout(payCollect, 300);
  }
  // 買ったあとの演出：押したところからコインが飛び出して、上の数字へ吸い込まれ、数字が増えていく
  // 版706：ホーム画面で、画面のまん中からコインが出て、上の帯の所持コインへ吸い込まれる
  function homeCoinFly(toEl, numEl, c0, c1) {
    const S = (n) => { try { DotSound.play(n); } catch (_) {} };
    const host = document.getElementById('app') || document.body, hr = host.getBoundingClientRect(), to = (toEl.querySelector('.coin-ico') || toEl).getBoundingClientRect();
    const fx = hr.width / 2, fy = hr.height / 2, tx = to.left + to.width / 2 - hr.left, ty = to.top + to.height / 2 - hr.top;
    const lay = document.createElement('div'); lay.className = 'hc-lay'; host.appendChild(lay);
    S('coinBurst');
    for (let i = 0; i < 14; i++) {
      const c = document.createElement('img'); c.src = 'icons/coin.png'; c.className = 'cs-fly'; const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 80;
      c.style.cssText = `left:${fx}px;top:${fy}px;width:40px;height:40px;margin:-20px 0 0 -20px;--mx:${Math.cos(a) * r}px;--my:${Math.sin(a) * r}px;--tx:${tx - fx}px;--ty:${ty - fy}px;animation-delay:${i * 40}ms`;
      lay.appendChild(c); setTimeout(() => { c.remove(); S('coin'); if (toEl.animate) toEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 160 }); }, 900 + i * 40);
    }
    const t0 = performance.now() + 700, dur = 900;
    const tick = (now) => { const u = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - u, 3); numEl.textContent = Math.round(c0 + (c1 - c0) * e).toLocaleString(); if (u < 1) requestAnimationFrame(tick); else setTimeout(() => lay.remove(), 400); };
    requestAnimationFrame(tick);
  }
  function coinGain(box, from, c0, c1, redraw, opt) {   // 版696：opt＝{ to: 吸い込まれる先, num: 数字の所 }（ショップのパスでも使う）
    const S = (n) => { try { DotSound.play(n); } catch (_) {} };
    const toEl = (opt && opt.to) || box.querySelector('.cs-have .coin-ico');
    const br = box.getBoundingClientRect(), k = br.width / 1280, fr = from.getBoundingClientRect(), to = toEl.getBoundingClientRect();
    const fx = (fr.left + fr.width / 2 - br.left) / k, fy = (fr.top + fr.height / 2 - br.top) / k, tx = (to.left + to.width / 2 - br.left) / k, ty = (to.top + to.height / 2 - br.top) / k;
    const fl = document.createElement('div'); fl.className = 'cs-flash'; box.appendChild(fl);
    S('coinBurst');   // 版696：チャリチャリン
    for (let i = 0; i < 14; i++) {
      const c = document.createElement('img'); c.src = 'icons/coin.png'; c.className = 'cs-fly'; const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 90;
      c.style.cssText = `left:${fx}px;top:${fy}px;--mx:${Math.cos(a) * r}px;--my:${Math.sin(a) * r}px;--tx:${tx - fx}px;--ty:${ty - fy}px;animation-delay:${i * 40}ms`;
      box.appendChild(c); setTimeout(() => { c.remove(); S('coin'); if (toEl.animate) toEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 160 }); }, 900 + i * 40);
    }
    const em = (opt && opt.num) || box.querySelector('.cs-have em'), t0 = performance.now() + 700, dur = 900;
    const tick = (now) => { const u = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - u, 3); { const v = Math.round(c0 + (c1 - c0) * e); em.textContent = v.toLocaleString(); if (!opt) em.className = csN(v); } if (u < 1) requestAnimationFrame(tick); else { em.parentElement.classList.add('pop'); S('ok'); setTimeout(() => { fl.remove(); }, 400); } };
    requestAnimationFrame(tick);
    const msg = document.createElement('p'); msg.className = 'cs-got'; msg.innerHTML = `${COIN}<b>+${(c1 - c0).toLocaleString()}</b> コイン`; box.appendChild(msg); setTimeout(() => msg.remove(), 2400);
  }
  function shop(tab) {
    const el = fullScreen('shopScreen', 'std-wrap sh3-wrap'), box = el.querySelector('.lk-box');
    if (tab) shopSt.tab = tab;
    const toast = (msg) => { const t = document.createElement('p'); t.className = 'sh3-toast'; t.innerHTML = msg; box.appendChild(t); setTimeout(() => t.classList.add('out'), 1600); setTimeout(() => t.remove(), 2200); };
    const coins = () => (save.coins || 0).toLocaleString();
    const hit = (cls, x, y, w, h, attr, title) => `<button class="sh3-hit ${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" ${attr || ''} title="${title || ''}"></button>`;
    const price = (c) => (C.CARDS[c].cat === 'sup' ? C.PRICE.sup : C.PRICE.card);
    const effText = (c) => { const cd = C.CARDS[c]; return `${Object.entries(cd.up).map(([k, v]) => `${C.PNAME[k]}+${v}`).join('・')}${cd.fat ? `（疲労${cd.fat > 0 ? '+' : ''}${cd.fat}）` : ''}`; };
    const draw = () => {
      const S = shopSt; let h = '';
      // 版527：3つの画面で、上の帯（もどる・ショップ・コイン）とタブを同じ形に（監督の4枚目の絵）
      const head = `<span class="sh3-coin" data-go="coin" title="コインを買う"><em class="sh3-cn">${coins()}</em><small>コイン</small><img class="sh3-plus" src="icons/ui_plus.png" alt="コインを買う"></span><span class="sh3-coin sh3-dc" title="Dコイン（特訓カードが買える）"><img src="icons/dcoin.png" alt=""><em class="sh3-cn">${C.earnedOf(save).toLocaleString()}</em><small>コイン</small></span>${hit('', 34, 12, 72, 70, 'data-go="back"', 'もどる')}
        <div class="sh3-tabs">${[['rec', 'おすすめ'], ['cards', '特訓カード'], ['prem', 'プレミアムパス']].map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      if (S.tab === 'rec') {
        const bn = C.gachaBanner(), U = bn.uniq, q = C.rosterAt(bn.tid, 1).players.find((x) => x.no === bn.no), cc = U.chip || ['#c8141e', '#ffd23a', '#ffe45a'];
        h = `<div class="sh3 sh3-rec"><img class="sh3-bgimg" src="img/shop_rec.jpg" alt="">${head}
          <button class="sh3-ban" data-go="scout" style="--c0:${cc[0]}"><div class="sh3-ban-bg"></div>${SH_PICK_ART[bn.key] ? `<img class="sh3-ban-art" src="${SH_PICK_ART[bn.key]}" alt="">` : ''}<div class="sh3-ban-fc"${SH_PICK_ART[bn.key] ? ' hidden' : ''}><i class="sh3-ban-glow"></i>${(() => { const k = C.faceKeyOf(bn.tid, q), sh = ((C.ROSTERS[bn.tid] || {}).kit || {}).shirt || '#2f6fd6'; return k ? starPic(k, sh, q.pos === 'GK', 'sh3-ban-face') : ''; })()}</div>
            <i class="sh3-ban-rib">今月のピックアップ</i><b class="sh3-ban-nm" style="font-size:${Math.min(96, Math.round(360 / Math.max(3, U.who.length)))}px">${esc(U.who)}</b><em class="sh3-ban-sk">${esc(U.name)}</em>
            <span class="sh3-ban-go">スカウトを見る<span>›</span></span></button>
          <span class="sh3-pmst">${C.premOn(save) ? `残り${premLeft()}日` : `月額 ¥${C.PREM.yen.toLocaleString()}`}</span>   <!-- 版752：絵の「準備中」の上に、パスの状態を出す -->
          ${hit('', 843, 142, 391, 270, 'data-tab="prem"', 'プレミアムパス')}
          ${hit('sh3-area', 46, 419, 586, 206, 'data-ask="5"', 'カードパック')}${hit('sh3-area', 640, 419, 594, 206, 'data-ask="10"', 'カードパック（大）')}
          ${hit('', 63, 571, 198, 42, 'data-info="5"', 'パック内容を見る')}<span class="sh3-pr" style="left:351px;top:553px;width:262px">${DCOIN}<b>${C.PRICE.pack5}</b></span>${hit('sh3-buy', 351, 553, 262, 64, 'data-pack="5"', 'カードパックを買う')}
          ${hit('', 646, 571, 196, 42, 'data-info="10"', 'パック内容を見る')}<span class="sh3-pr" style="left:977px;top:553px;width:236px">${DCOIN}<b>${C.PRICE.pack12}</b></span>${hit('sh3-buy', 977, 553, 236, 64, 'data-pack="10"', 'カードパック（大）を買う')}
          ${hit('', 46, 631, 1188, 66, 'data-tab="cards"', '特訓カードを1枚ずつ選ぶ')}</div>`;
      } else if (S.tab === 'prem') {
        const on = C.premOn(save);
        h = `<div class="sh3 sh3-prem"><img class="sh3-bgimg" src="img/shop_prem.jpg" alt="">${head}
          <div class="pm-perks"><b>パスを持っている間</b><span>・毎日 コイン・カード・カケラ</span><span>・試合の早送り（2倍・4倍）</span><span>・SPメニューのヒント（毎週1枚）</span><span>・特訓カードを199枚まで持てる</span><span>・名前の横に金のマーク</span><span>・${payReal() ? '毎月' : '買った時に'} ${C.PREM.bonus}コイン</span></div>
          <button class="pm-buy${on ? ' on' : ''}" data-prem="1">${payReal()
            ? (subLive() ? (save.premSub.cancelAtEnd ? `<small>残り ${premLeft()}日</small>解約ずみ・管理` : `<small>自動更新中</small>お支払いの管理`) : on ? `<small>残り ${premLeft()}日</small>月額で続ける ¥${C.PREM.yen.toLocaleString()}` : `はじめる <b>月額¥${C.PREM.yen.toLocaleString()}</b>`)
            : (on ? `<small>残り ${premLeft()}日</small>延長する ¥${C.PREM.yen.toLocaleString()}` : `購入する <b>¥${C.PREM.yen.toLocaleString()}</b><small>30日</small>`)}</button>${on ? '<button class="pm-cal" data-pcal="1">毎日のプレゼント</button>' : ''}</div>`;
      } else {
        const list = Object.keys(C.CARDS).filter((c) => S.cat === 'all' || C.CARDS[c].cat === S.cat);
        if (!S.sel || !list.includes(S.sel)) { S.sel = list[0]; S.qty = 1; }
        const room = Math.max(0, C.cardMax(save) - ((save.cards || {})[S.sel] || 0)); if (S.qty > Math.max(1, room)) S.qty = Math.max(1, room);   // 版562：持てるのは99枚まで
        const c = S.sel, cd = C.CARDS[c], pr = price(c), tot = pr * S.qty, lack = Math.max(0, tot - C.earnedOf(save));   /* 版748：特訓カードはDコインで */
        h = `<div class="sh3 sh3-cards"><img class="sh3-bgimg" src="img/shop_cards.jpg" alt="">${head}
          <div class="sh3-sub">${SH_CATS.map(([k, l]) => `<button data-cat="${k}" class="${S.cat === k ? 'on' : ''}" style="--cc:${SH_CATCOL[k] || '#ee5a12'}">${l}</button>`).join('')}</div>
          <div class="sh3-grid">${list.map((k) => { const d = C.CARDS[k]; return `<button class="sh3-card${k === c ? ' on' : ''}" data-c="${k}" style="--cc:${SH_CATCOL[d.cat]}"><img src="cards/${k}.jpg" alt="${esc(d.name)}" draggable="false"><span class="sh3-cf"><small>所持 ${save.cards[k] || 0}枚</small><em>${DCOIN}${price(k)}</em></span></button>`; }).join('')}</div>
          <div class="sh3-det"><h3>${esc(cd.name)}</h3><div class="sh3-dr"><img src="cards/${c}.jpg" alt="" style="border-color:${SH_CATCOL[cd.cat]}"><p class="sh3-eff">${esc(effText(c))}</p></div>
            <div class="sh3-one">1枚 ${DCOIN}<b>${pr}</b><small>Dコイン</small></div>
            <div class="sh3-qty"><button data-q="-1" class="m"${S.qty <= 1 ? ' disabled' : ''}>−</button><span>${S.qty}</span><button data-q="1" class="p"${S.qty >= Math.max(1, room) ? ' disabled' : ''}>＋</button></div>
            <div class="sh3-tot">合計<span>${DCOIN}<b>${tot}</b><small>Dコイン</small></span></div>
            <button class="sh3-go"${lack || !room ? ' disabled' : ''}>${room ? '購入する' : `上限（${C.cardMax(save)}枚）`}</button><p class="sh3-lack">${!room ? `もう${C.cardMax(save)}枚持っているので買えません` : lack ? `Dコインが あと <b>${lack}</b> 必要` : `カードに使えるDコイン：${C.earnedOf(save).toLocaleString()}`}</p>
            <button class="sh3-pk" data-tab="rec">まとめ買いならカードパックへ <span>→</span></button></div></div>`;
      }
      box.innerHTML = h;
      box.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { shopSt.tab = b.dataset.tab; draw(); });
      box.querySelectorAll('[data-go="back"]').forEach((b) => b.onclick = () => { el.hidden = true; renderHome(); });
      box.querySelectorAll('[data-go="scout"]').forEach((b) => b.onclick = () => { el.hidden = true; openGacha(); });
      box.querySelectorAll('[data-go="coin"]').forEach((b) => b.onclick = () => coinShop(() => draw()));   // 版570：左上のコインを押すと、コイン購入
      box.querySelectorAll('[data-prem]').forEach((b) => b.onclick = () => buyPrem(() => draw()));
      box.querySelectorAll('[data-pcal]').forEach((b) => b.onclick = async () => { await premDaily(true); draw(); });
      box.querySelectorAll('[data-info]').forEach((b) => b.onclick = () => coachAsk(`<b>カードパック${b.dataset.info === '10' ? '（大）' : ''}</b><br>特訓カード（戦術・テクニック・フィジカル・サポート）から<br>ランダムで <b>${b.dataset.info}枚</b> 入っています。<br><b>${b.dataset.info === '10' ? C.PRICE.pack12 : C.PRICE.pack5}</b> コイン（1枚あたり ${Math.round((b.dataset.info === '10' ? C.PRICE.pack12 : C.PRICE.pack5) / +b.dataset.info)} コイン）<br><small>1枚ずつ買う（${C.PRICE.card}コイン）より、お得です。</small>`, [{ label: 'とじる', value: true }], 'sec'));
      // 版564：カードパックは、必ず確認してから買う → 開ける演出 → 手に入れたカードを全部見せる（黄色いボタンでも、すぐには買わない）
      const packFlow = async (n) => { const big = n >= 10, pr = big ? C.PRICE.pack12 : C.PRICE.pack5;
        if (C.earnedOf(save) < pr) { coachAsk(`Dコインが足りません。<br><small>特訓カードは、試合の賞金などでもらえる<b>Dコイン</b>でだけ買えます。<br>カードパック${big ? '（大）' : ''}は ${DCOIN}<b>${pr}</b>（いまのDコイン ${C.earnedOf(save).toLocaleString()}）。</small>`, [{ label: 'OK', value: true }]); return; }
        if (!(await coachAsk(`<b>カードパック${big ? '（大）' : ''}</b>（特訓カード ${n}枚）を<br>${DCOIN}<b>${pr}</b> Dコインで買いますか？<br><small>Dコイン ${C.earnedOf(save).toLocaleString()} → 買ったあと ${(C.earnedOf(save) - pr).toLocaleString()}</small>`, [{ label: '買う', value: true }, { label: 'やめる', value: false }]))) return;
        const before = { ...(save.cards || {}) }, got = C.buyPack(save, n); if (!got) return; store(); draw();
        await openPack(got, before, big); draw(); };
      box.querySelectorAll('[data-ask]').forEach((b) => b.onclick = () => packFlow(+b.dataset.ask));
      box.querySelectorAll('[data-pack]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); packFlow(+b.dataset.pack); });
      box.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { shopSt.cat = b.dataset.cat; shopSt.sel = null; draw(); });
      box.querySelectorAll('.sh3-card').forEach((b) => b.onclick = () => { if (shopSt.sel !== b.dataset.c) shopSt.qty = 1; shopSt.sel = b.dataset.c; const g = box.querySelector('.sh3-grid'), st = g ? g.scrollTop : 0; draw(); const g2 = box.querySelector('.sh3-grid'); if (g2) g2.scrollTop = st; });
      box.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { shopSt.qty = Math.max(1, Math.min(99, shopSt.qty + +b.dataset.q)); const g = box.querySelector('.sh3-grid'), st = g ? g.scrollTop : 0; draw(); const g2 = box.querySelector('.sh3-grid'); if (g2) g2.scrollTop = st; });
      { const go = box.querySelector('.sh3-go'); if (go) go.onclick = () => { const c = shopSt.sel, had = (save.cards || {})[c] || 0, coin0 = save.coins || 0; let n = 0; for (let k = 0; k < shopSt.qty; k++) { if (C.buyCard(save, c)) n++; else break; } store(); const g = box.querySelector('.sh3-grid'), st = g ? g.scrollTop : 0; shopSt.qty = 1; draw(); const g2 = box.querySelector('.sh3-grid'); if (g2) g2.scrollTop = st; try { DotSound.play(n ? 'ok' : 'back'); } catch (_) {} toast(n ? `<img class="sh3-tc" src="cards/${c}.jpg" alt=""><span><b>${esc(C.CARDS[c].name)}</b> を ${n}枚 買いました！<br><small>所持 ${had}枚 → <em>${save.cards[c]}枚</em>　／　コイン ${coin0.toLocaleString()} → ${(save.coins || 0).toLocaleString()}</small></span>` : had >= C.CARD_MAX ? 'もう99枚持っているので買えません' : 'コインが足りません'); }; }   // 版562：買えたことが分かるように、枚数とコインの変化を見せる
      { const bg = box.querySelector('.sh3-ban-bg'); if (bg) { const bn = C.gachaBanner(); gcBgFor(bn.uniq.chip, (u) => { bg.style.backgroundImage = `url(${u})`; }); } }
    };
    el._redraw = () => draw();   // 版712：月額パスの状態が変わった時に描き直す
    draw(); el.hidden = false; el._fit();
  }

  let clubAsked = false;
  function open() {
    ensure(); A().stop(); A().showScreen('career'); go('home');
    if (/vs=/.test(location.hash) && save.clubSet) setTimeout(() => checkVsLink(), 600);
    setTimeout(() => { try { watchPost(); } catch (_) {} }, 800);   // 版624   // 版610：対戦のリンクから開いた
    if (window.__tut && window.__tut.boot(save)) return;   // はじめて遊ぶ人：チュートリアル（クラブ作りもその中で）
    if (!save.clubSet && !clubAsked && (save.week || 1) <= 1 && save.season === 1) { clubAsked = true; openClub({ first: true, onDone: () => go('home') }); }   // はじめて：クラブを作る
    if (save.migratedWorld) { delete save.migratedWorld; store(); modal('<h2>リーグが新しくなりました</h2><p>地域2部（東・西）→ 地域1部（東・西）→ D3 → D2 → D1 の7リーグになりました。選手はそのままで、<b>地域2部リーグ西</b>の開幕（3月1週）からのスタートです。</p>', [{ label: 'OK', primary: true }]); }
  }
  $('#goCareer').onclick = open;
  // 確認画面用：次の公式戦を、試合前の画面を飛ばしてそのまま観る（結果は記録しない）
  // 版581：（テスト用）優勝の演出を見る（記録は何も変えない）
  function champDemo() {
    const fx = C.nextFixture(save); if (!fx) return false;
    const ch = { kind: 'league', title: (C.LG[save.league.id] || {}).name || 'リーグ', n: 1, last: true };
    const v = { ...ch, team: save.team.name, short: save.team.short || save.team.name, faces: save.team.players.slice(0, 18).map((p) => faceOf(p)).filter(Boolean), emb: emblemURL(save.team.name, 96), trophy: trophyImg('league'), sec: staffImg.sec || '', small: 'DOT SOCCER LEAGUE' };
    document.querySelectorAll('.lk-wrap').forEach((w) => { w.hidden = true; });   // 版582：開いている画面（クラブ事務所など）を閉じてから（前は事務所の上で演出が出ていた）
    { const pc = document.getElementById('pcModal'); if (pc) pc.hidden = true; }
    const m0 = A().match;
    runMatch('優勝の演出', '', fx.opp, async () => {
      const keep = save.trophies; save.trophies = [...(Array.isArray(keep) ? keep : []), { season: save.season, kind: 'league', title: ch.title }];
      try { open(); await blackFade(200); await champAfter(ch); } catch (err) { console.error(err); try { const t = document.getElementById('errTip') || document.body.appendChild(Object.assign(document.createElement('p'), { id: 'errTip' })); t.textContent = 'エラー：' + (err && err.message || err) + '（優勝のあと）'; t.hidden = false; } catch (_) {} document.querySelectorAll('.lk-wrap').forEach((w) => { w.hidden = true; }); } finally { save.trophies = keep; }
      await blackClear(350); open();
    }, { comp: fx.comp, label: fx.label, home: !!fx.home, skipPre: true });
    { const t0 = Date.now(); const tryGo = () => { const m = A().match, vis = !document.getElementById('match').hidden; if (m && m !== m0 && vis && A().champDemo(v)) return; if (Date.now() - t0 < 20000) setTimeout(tryGo, 300); }; setTimeout(tryGo, 600); }
    return true;
  }
  function labMatch(full) { const fx = C.nextFixture(save); if (!fx) return false; runMatch('試合の日！', '', fx.opp, full ? (score, ev, played) => officialDone(fx, score, ev, played) : () => {}, { comp: fx.comp, label: fx.label, home: !!fx.home, skipPre: true }); return true; }
  // 試合中のパネル（得点・交代・カード）に出す顔写真：CPUの選手は専用・モブの顔、自分のクラブの選手はその選手の顔
  function matchFace(info, shirt) {
    if (!info) return null;
    if (info.faceKey) return starFace(info.faceKey, shirt, !!info.gk || info.position === 'GK');
    if (info.cpuTid && info.cpuNo != null) { const mk = mobKey(info.cpuTid, { no: info.cpuNo }); if (mk) return starFace(mk, shirt, !!info.gk || info.position === 'GK'); }   // CPUのモブ選手：共有の顔（ユニフォームの色を塗り替え）
    const mine = save && save.team && save.team.players.find((q) => q.name === info.name && (q.number == null || info.number == null || q.number === info.number));
    return mine ? faceURL(mine) : null;
  }
  function townRect(key) {   // ホームの建物（名前の札と建物の絵）が画面のどこにあるか（チュートリアルで光らせる）
    const hs = (hot && hot.length ? hot : townHot).filter((h) => h.go === key); if (!hs.length) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const h of hs) { x0 = Math.min(x0, h.r.x); y0 = Math.min(y0, h.r.y); x1 = Math.max(x1, h.r.x + h.r.w); y1 = Math.max(y1, h.r.y + h.r.h); }
    const rc = hc.getBoundingClientRect(), sc = Math.max(rc.width / 1280, rc.height / 720), ox = rc.left + (rc.width - 1280 * sc) / 2, oy = rc.top + (rc.height - 720 * sc) / 2;
    return { left: ox + x0 * sc, top: oy + y0 * sc, width: (x1 - x0) * sc, height: (y1 - y0) * sc };
  }
  function tutPractice(onDone) {   // チュートリアルの練習試合：同じ地域リーグの相手と（練習試合と同じ扱い）
    const list = C.practiceOptions(save), t = list.find((x) => !x.strong) || list[0]; if (!t) return false;
    const op = { ...C.findTeam(save, t.name), lg: t.lg };
    runMatch('練習試合', '', op, (score, ev, played) => { const got = C.playPractice(save, score, played, op.name); afterRound(got, { practice: true }); if (onDone) onDone(); }, { comp: '練習試合', label: '', home: true, practice: true, tut: 'practice' });
    return true;
  }
  // 版570：コインの数が出ているところ（スカウト・ホーム）を押しても、コイン購入へ
  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('.gc3-coin, .hm-next .coin'); if (!t) return; e.stopPropagation(); coinShop(() => { const b = document.querySelector('.gc3-coin b'); if (b) b.textContent = (save.coins || 0).toLocaleString(); try { renderHome(); } catch (_) {} }); }, true);
  // ================= 版610：空港（対戦）：ランクマッチ・フレンド対戦 =================
  // 版617：監督ライセンス（D級〜S級）。RPが下限を割ると降格する
  const RANKS = [
    { n: 'D級', k: 'D', c: '#7f8c99', lg: ['regW2', 'regE2'] }, { n: 'C級', k: 'C', c: '#c07a3a', lg: ['regW1', 'regE1'] }, { n: 'B級', k: 'B', c: '#9fb3c8', lg: ['d3'] },
    { n: 'A級', k: 'A', c: '#f2b51c', lg: ['d2'] }, { n: 'S級', k: 'S', c: '#c94cff', lg: ['d1'] }];
  const RANK_AT = [0, 100, 250, 450, 700];   // その級になるのに必要なRP
  const RP_WIN = 30, RP_DRAW = -5, RP_LOSE = 15, RP_DEF = 10;   // 版616：引き分けは −5。守備で勝つと +10
  // ライセンス取得のごほうび（はじめてその級になった時だけ。S級はコイン500枚）
  const RANK_REWARD = [null, { coins: 50, cards: 5, kak: 5 }, { coins: 100, cards: 10, kak: 10, pack: '金のパック×1' }, { coins: 250, cards: 20, kak: 30, pack: '金のパック×2' }, { coins: 500, cards: 30, kak: 60, pack: '金のパック×3' }];
  function ensureOnline() { if (!save.online) save.online = { rp: 0, best: 0, w: 0, d: 0, l: 0, fw: 0, fd: 0, fl: 0, friends: [] }; return save.online; }
  const rankIdx = (rp) => { let i = 0; for (let k = 0; k < RANK_AT.length; k++) if ((rp || 0) >= RANK_AT[k]) i = k; return i; };
  function rankBadge(i, big) { const R = RANKS[i]; return `<span class="ap-rank${big ? ' big' : ''}" style="--rc:${R.c}">${R.n}ライセンス</span>`; }
  // チームコード：JSON → 圧縮（できる端末だけ）→ URLに入れられる文字
  const b64u = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  async function packCode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    try { if (window.CompressionStream) { const cs = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')); return 'Z' + b64u(new Uint8Array(await new Response(cs).arrayBuffer())); } } catch (_) {}
    return 'J' + b64u(raw);
  }
  async function unpackCode(code) {
    code = String(code || '').trim(); const m = code.match(/[#&?]vs=([A-Za-z0-9_\-]+)/); if (m) code = m[1];
    code = code.replace(/[^A-Za-z0-9_\-]/g, '');
    if (code.length < 20) throw new Error('short');
    const kind = code[0], u = unb64u(code.slice(1));
    let txt;
    if (kind === 'Z') { const ds = new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw')); txt = await new Response(ds).text(); } else txt = new TextDecoder().decode(u);
    const d = JSON.parse(txt); if (!d || !d.team || !Array.isArray(d.team.players) || d.team.players.length < 11) throw new Error('bad'); return d;
  }
  const shareURL = (code) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}#vs=${code}`;
  async function shareMyTeam() {
    const code = await packCode(C.guestCode(save)), url = shareURL(code);
    const text = `${save.team.name}（${save.manager ? save.manager + '監督' : ''}）と「ドットサッカー」で対戦しよう！リンクを開くと対戦できます。`;
    try { if (navigator.share) { await navigator.share({ title: 'ドットサッカー 対戦', text, url }); return 'shared'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    try { await navigator.clipboard.writeText(text + '\n' + url); return 'copied'; } catch (_) {}
    await modal(`<h2>チームコード</h2><p>下の文字をすべてコピーして、友達に送ってください。</p><textarea class="ap-code" readonly onclick="this.select()">${esc(url)}</textarea>`, [{ label: 'とじる', primary: true }]);
    return 'shown';
  }
  // はじめて上がったランクだけ、ごほうび（攻めでも守りでも）
  function rankReward(i0, i1) {
    const on = ensureOnline();
    if (!(i1 > i0 && i1 > rankIdx(on.best || 0))) return null;
    const RW = RANK_REWARD[i1] || RANK_REWARD[1];
    const main = Object.keys(C.CARDS).filter((c) => C.CARDS[c].cat !== 'sup' && !C.CARDS[c].sp), sup = Object.keys(C.CARDS).filter((c) => C.CARDS[c].cat === 'sup');
    const cards = Array.from({ length: RW.cards }, () => (Math.random() < 0.25 && sup.length ? sup[Math.floor(Math.random() * sup.length)] : main[Math.floor(Math.random() * main.length)]));
    save.cards = save.cards || {}; for (const c of cards) save.cards[c] = Math.min(C.cardMax(save), (save.cards[c] || 0) + 1);
    C.ensureGacha(save); save.kakera = (save.kakera || 0) + RW.kak; C.earnCoins(save, RW.coins);
    return { cards, kak: RW.kak, coins: RW.coins, rank: i1 };
  }
  // 版834：スコアの段（左に自分、右に相手。エンブレムと名前、大きい数字）
  const rcScore = (score, op) => `<div class="rc2-score"><div class="rc2-tm"><img src="${emblemURL(save.team.name, 96)}" alt=""><b>${esc(save.team.name)}</b></div><div class="rc2-sc"><b class="${score[0] > score[1] ? 'w' : ''}">${score[0]}</b><i>−</i><b class="${score[1] > score[0] ? 'w' : ''}">${score[1]}</b></div><div class="rc2-tm"><img src="${emblemURL(op.srcName || op.name, 96)}" alt=""><b>${esc(op.name)}</b></div></div>`;
  // 版834：ライセンス取得のごほうび（新しいデザイン）
  const rewardCard = (rw) => ({ tag: 'ライセンス取得', title: `${RANKS[rw.rank].n}ライセンス 取得のごほうび！`, theme: 'win', body: `<div class="rc2-lic">${rankBadge(rw.rank, true)}</div>
    <div class="rc2-gifts"><div class="rc2-gift"><img src="icons/dcoin.png" alt=""><span>Dコイン</span><b>+${rw.coins}</b></div>${rw.kak ? `<div class="rc2-gift"><img src="icons/kakera.png" alt=""><span>覚醒のカケラ</span><b>+${rw.kak}</b></div>` : ''}<div class="rc2-gift"><img src="icons/cb_train.png" alt=""><span>特訓カード</span><b>${rw.cards.length}枚</b></div></div>
    ${RANK_REWARD[rw.rank].pack ? `<p class="rc2-note">${RANK_REWARD[rw.rank].pack}つき</p>` : ''}<div class="rc2-cards">${[...new Set(rw.cards)].map((c) => { const n = rw.cards.filter((x) => x === c).length; return `<div class="rc2-cw">${artCard(c, { ups: true })}${n > 1 ? `<i>×${n}</i>` : ''}</div>`; }).join('')}</div>` });
  const rewardHTML = (rw) => `<h2>${rankBadge(rw.rank, true)} 取得のごほうび！</h2><p class="coin big">${COIN}+${rw.coins} コイン${rw.kak ? `　／　覚醒のカケラ +${rw.kak}` : ''}</p><p>特訓カード ${rw.cards.length}枚${RANK_REWARD[rw.rank].pack ? `（${RANK_REWARD[rw.rank].pack}）` : ''}</p><div class="hrow rw ap-rw">${[...new Set(rw.cards)].map((c) => { const n = rw.cards.filter((x) => x === c).length; return `<div class="ap-rwc">${artCard(c, { ups: true })}${n > 1 ? `<b>×${n}</b>` : ''}</div>`; }).join('')}</div>`;
  // ================= 版618：ポスト（フレンド申請・守備の結果・お知らせ） =================
  function ensurePost() { if (!save.mbox) save.mbox = { items: [], newsRead: {} }; return save.mbox; }   // save.post はシーズン後の大会で使っているので別の名前
  const myCard = () => { const on = ensureOnline(), cl = C.ensureClub(save); return { name: save.team.name, mgr: save.manager || '', emb: cl.emb, fid: on.fid || '', rank: rankIdx(on.rp) }; };
  let postBusy = null, postAt = 0, postNews = [];
  function postUnread() { const p = ensurePost(); return p.items.filter((x) => !x.read).length + postNews.filter((x) => !p.newsRead[x.id]).length; }
  function postBadge() { const b = document.querySelector('.h2-post i'); if (!b) return; const n = postUnread(); b.textContent = n > 9 ? '9+' : String(n); b.hidden = !n; }
  function addPost(it) { const p = ensurePost(); p.items.unshift({ id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), at: Date.now(), read: false, ...it }); p.items = p.items.slice(0, 60); }
  // サーバーから届いたものを受け取って、ポストに入れる（守備のRPもここで入る）
  function syncPost(force) {
    if (!(window.DotNet && DotNet.on)) return Promise.resolve(0);
    if (postBusy) return postBusy;
    if (!force && Date.now() - postAt < 60000) { postBadge(); return Promise.resolve(postUnread()); }
    postBusy = (async () => {
      postAt = Date.now();
      try { await publishMe(); } catch (_) {}
      const on = ensureOnline(); on.flist = on.flist || [];
      // 守備の結果
      let bl = []; try { bl = await DotNet.inbox(); } catch (_) {}
      if (bl.length) {
        const before = on.rp, i0 = rankIdx(before); let dw = 0;
        for (const b of bl) { const my = b.s[1], op = b.s[0], r = my > op ? 'W' : my === op ? 'D' : 'L'; if (r === 'W') dw++; on['d' + r.toLowerCase()] = (on['d' + r.toLowerCase()] || 0) + 1;
          addPost({ kind: 'def', r, name: b.name, mgr: b.mgr, s: [my, op], at: b.at || Date.now() }); }
        on.rp = before + dw * RP_DEF; const i1 = rankIdx(on.rp), rw = rankReward(i0, i1); on.best = Math.max(on.best || 0, on.rp);
        if (dw) addPost({ kind: 'info', ico: 'defrp', title: `守備で ${dw}勝！ +${dw * RP_DEF} RP`, text: `ほかの監督の挑戦を ${dw}回 はね返しました。` });
        if (rw) addPost({ kind: 'reward', rank: rw.rank, coins: rw.coins, kak: rw.kak, cards: rw.cards.length });
        try { await DotNet.clearInbox(bl.map((b) => b.id)); } catch (_) {}
      }
      // フレンド申請・承認
      let ml = []; try { ml = await DotNet.mailbox(); } catch (_) {}
      for (const m of ml) {
        if (m.type === 'freq') { if (!ensurePost().items.some((x) => x.kind === 'freq' && x.uid === m.from && !x.done)) addPost({ kind: 'freq', uid: m.from, name: m.name, mgr: m.mgr, emb: m.emb, fid: m.fid, rank: m.rank }); }
        else if (m.type === 'fok') { if (!on.flist.some((f) => f.uid === m.from)) on.flist.unshift({ uid: m.from, fid: m.fid, name: m.name, mgr: m.mgr, emb: m.emb, rank: m.rank, w: 0, d: 0, l: 0 }); on.fsent = (on.fsent || []).filter((x) => x !== m.from); addPost({ kind: 'fok', uid: m.from, name: m.name, mgr: m.mgr, emb: m.emb }); }
        else if (m.type === 'room') { addPost({ kind: 'room', uid: m.from, room: m.room, name: m.name, mgr: m.mgr, emb: m.emb }); }
        else if (m.type === 'fno') { on.fsent = (on.fsent || []).filter((x) => x !== m.from); }
      }
      if (ml.length) try { await DotNet.delMail(ml.map((m) => m.id)); } catch (_) {}
      try { postNews = await DotNet.news(); } catch (_) {}
      store(); postBadge(); return postUnread();
    })().finally(() => { postBusy = null; });
    return postBusy;
  }
  // 版710：絵文字のかわりに絵を使うお知らせ
  const postImg = (it) => it.kind === 'buy' ? 'icons/coin.png'
    : it.kind === 'def' ? (it.r === 'W' ? 'icons/post_def_win.png' : it.r === 'D' ? 'icons/post_def_draw.png' : 'icons/post_def_lose.png')
    : (it.ico === 'defrp' || (it.kind === 'info' && /^守備で/.test(it.title || ''))) ? 'icons/post_def_rp.png'
    : it.kind === 'reward' ? 'icons/post_reward.png' : (it.kind === 'news' || it.kind === 'info') ? 'icons/post_news.png' : '';   // 版711：のこりの絵文字も絵に
  const POST_ICO = { buy: '🪙', room: '⚽', freq: '🤝', fok: '🎉', def: '🛡️', info: '📣', reward: '🎁', news: '📰' };
  const fmtAt = (t) => { const d = new Date(t || Date.now()); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  async function openPost(back) {
    back = back || (() => {});
    const el = fullScreen('postScreen', 'ap-wrap po-wrap'), box = el.querySelector('.lk-box');
    const draw = () => {
      const p = ensurePost(), on = ensureOnline();
      const list = [...postNews.map((n) => ({ kind: 'news', id: 'n:' + n.id, nid: n.id, title: n.title, text: n.text, at: n.at, read: !!p.newsRead[n.id] })), ...p.items].sort((a, b) => (b.at || 0) - (a.at || 0));
      const row = (it) => {
        let t = '', body = '', btns = '';
        if (it.kind === 'freq') { t = 'フレンド申請が届きました'; body = `<b>${esc(it.name)}</b>${it.mgr ? `（${esc(it.mgr)}監督）` : ''}から、フレンド申請です。`; btns = it.done ? `<span class="po-done">${it.done === 'ok' ? '承認しました' : 'おことわりしました'}</span>` : `<button class="po-ok" data-ok="${it.id}">承認する</button><button class="po-ng" data-ng="${it.id}">ことわる</button>`; }
        else if (it.kind === 'fok') { t = 'フレンドになりました！'; body = `<b>${esc(it.name)}</b>${it.mgr ? `（${esc(it.mgr)}監督）` : ''}がフレンド申請を承認しました。空港の「フレンド」から対戦できます。`; }
        else if (it.kind === 'def') { t = it.r === 'W' ? '守った！' : it.r === 'D' ? '引き分け' : 'やられた…'; body = `<b>${esc(it.name)}</b>${it.mgr ? `（${esc(it.mgr)}監督）` : ''}がランクマッチで挑んできました。<em>${it.s[0]} − ${it.s[1]}</em>`; }
        else if (it.kind === 'reward') { t = `${RANKS[it.rank].n}ライセンス取得！`; body = `ごほうび：コイン${it.coins}枚・特訓カード${it.cards}枚${it.kak ? `・覚醒のカケラ${it.kak}` : ''}（受け取りずみ）`; }
        else if (it.kind === 'buy') { t = it.prem ? (it.renew ? 'プレミアムパスの更新' : 'プレミアムパスのご購入') : 'コインのご購入'; body = `ご購入ありがとうございます。<br>${it.prem ? `<b>プレミアムパス（${it.renew ? '自動更新・' : ''}${it.prem}日）</b>と ` : ''}<b class="po-coin">${COIN}${(it.coins || 0).toLocaleString()} コイン</b>が入りました（¥${(it.yen || 0).toLocaleString()}）。${it.test ? '<br><small>（テストの購入です。本当のお金はかかっていません）</small>' : ''}`; }   // 版705：課金の記録
        else if (it.kind === 'room') { t = 'フレンド対戦の招待'; body = `<b>${esc(it.name)}</b>${it.mgr ? `（${esc(it.mgr)}監督）` : ''}がルームを作りました。`; btns = Date.now() - (it.at || 0) < 30 * 60 * 1000 ? `<button class="po-ok" data-room="${it.id}">ルームに入る</button>` : '<span class="po-done">時間切れ</span>'; }
        else if (it.kind === 'news') { t = it.title || 'お知らせ'; body = esc(it.text || '').replace(/\n/g, '<br>'); }
        else { t = it.title || 'お知らせ'; body = esc(it.text || ''); }
        const emb = it.emb ? `<img src="${embFromLook(it.emb, 56)}" alt="">` : (postImg(it) ? `<span class="po-ico po-coin"><img src="${postImg(it)}" alt="" draggable="false"></span>` : `<span class="po-ico">${POST_ICO[it.kind] || '✉️'}</span>`);
        return `<div class="po-it${it.read ? '' : ' new'}${it.kind === 'def' ? ' def-' + it.r : ''}" data-id="${it.id}">${emb}<div class="po-b"><div class="po-t"><b>${esc(t)}</b><small>${fmtAt(it.at)}</small></div><p>${body}</p>${btns ? `<div class="po-btns">${btns}</div>` : ''}</div>${it.read ? '' : '<i class="po-dot"></i>'}</div>`;
      };
      box.innerHTML = `${apBg()}<div class="ap-top"><img class="po-top-img" src="icons/post.png" alt=""><div><b>ポスト</b><small>フレンド申請・対戦の結果・お知らせが届きます</small></div><button class="std-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button></div>
        <div class="po-bar"><span>${list.filter((x) => !x.read).length}件の未読<small class="po-st">受信：${esc((window.DotNet && DotNet.watchState) || '-')}　最終確認 ${postAt ? fmtAt(postAt).split(' ')[1] : '-'}</small></span><button class="po-all" data-a="allread">すべて既読にする</button><button class="po-all" data-a="clear">読んだものを消す</button></div>
        <div class="po-list">${list.length ? list.map(row).join('') : '<p class="ap-note po-empty">ポストは空っぽです。</p>'}</div>`;
      el.hidden = false; el._fit && el._fit();
      const markRead = (id) => { if (id.startsWith('n:')) p.newsRead[id.slice(2)] = 1; else { const it = p.items.find((x) => x.id === id); if (it) it.read = true; } };
      box.querySelector('.std-back').onclick = () => { store(); el.hidden = true; postBadge(); back(); };
      box.querySelectorAll('.po-it').forEach((d) => d.onclick = (e) => { if (e.target.closest('button')) return; markRead(d.dataset.id); store(); d.classList.remove('new'); const dot = d.querySelector('.po-dot'); if (dot) dot.remove(); postBadge(); });
      box.querySelector('[data-a="allread"]').onclick = () => { list.forEach((x) => markRead(x.id)); store(); draw(); postBadge(); };
      box.querySelector('[data-a="clear"]').onclick = () => { p.items = p.items.filter((x) => !x.read || (x.kind === 'freq' && !x.done)); store(); draw(); };
      box.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => { const it = p.items.find((x) => x.id === b.dataset.ok); if (!it) return;
        b.disabled = true; try { await DotNet.sendMail(it.uid, { type: 'fok', ...myCard() }); } catch (_) { b.disabled = false; return modal('<h2>通信できませんでした</h2><p>もう一度押してください。</p>', [{ label: 'OK', primary: true }]); }
        on.flist = on.flist || []; if (!on.flist.some((f) => f.uid === it.uid)) on.flist.unshift({ uid: it.uid, fid: it.fid, name: it.name, mgr: it.mgr, emb: it.emb, rank: it.rank, w: 0, d: 0, l: 0 });
        it.done = 'ok'; it.read = true; store(); draw(); postBadge(); });
      box.querySelectorAll('[data-room]').forEach((b) => b.onclick = () => { const it = p.items.find((x) => x.id === b.dataset.room); if (!it) return; it.read = true; store(); el.hidden = true; joinRoom(it.room); });
      box.querySelectorAll('[data-ng]').forEach((b) => b.onclick = async () => { const it = p.items.find((x) => x.id === b.dataset.ng); if (!it) return; try { await DotNet.sendMail(it.uid, { type: 'fno', ...myCard() }); } catch (_) {} it.done = 'ng'; it.read = true; store(); draw(); postBadge(); });
    };
    openPost.redraw = () => { if (!el.hidden) draw(); };
    draw(); syncPost(true).then(() => { if (!el.hidden) draw(); });
  }
  // ================= 版622：フレンドのルーム対戦 =================
  //  ホストがルームを作る → 相手のポストに招待 → 相手が入る → ふたりとも「対戦する」→ 同じ種で、2つの画面で同じ試合
  //  （試合中の交代・作戦変更はなし。変えると2つの画面で試合が変わってしまうため）
  async function makeRoom(f) {
    try {
      const code = await packCode(C.guestCode(save)), me = myCard();
      const id = await DotNet.createRoom(f.uid, { hostCode: code, hostName: me.name, hostMgr: me.mgr, hostEmb: me.emb, guestName: f.name, guestMgr: f.mgr || '', guestEmb: f.emb || null });
      DotNet.sendMail(f.uid, { type: 'room', room: id, ...me }).catch(() => {});
      return id;
    } catch (e) { modal('<h2>ルームを作れませんでした</h2><p>通信の状態をたしかめてください。</p>', [{ label: 'OK', primary: true }]); return null; }
  }
  async function joinRoom(id) {
    let r = null; try { r = await DotNet.roomGet(id); } catch (_) {}
    if (!r || r.state !== 'open') return modal('<h2>このルームはもう閉じています</h2>', [{ label: 'OK', primary: true }]);
    try { const code = await packCode(C.guestCode(save)), me = myCard(); await DotNet.roomUpdate(id, { guestIn: true, guestCode: code, guestName: me.name, guestMgr: me.mgr, guestEmb: me.emb }); }
    catch (_) { return modal('<h2>ルームに入れませんでした</h2>', [{ label: 'OK', primary: true }]); }
    roomScreen(id, 'guest');
  }
  function roomScreen(id, role) {
    const el = fullScreen('roomScreen', 'ap-wrap rm-wrap'), box = el.querySelector('.lk-box');
    let r = null, unsub = null, started = false, cdT = 0;
    const me = role, other = role === 'host' ? 'guest' : 'host';
    const leave = async (msg) => { if (unsub) unsub(); unsub = null; clearInterval(cdT); el.hidden = true; if (!started) { try { await DotNet.roomUpdate(id, { state: 'closed' }); } catch (_) {} } if (msg) await modal(msg, [{ label: 'OK', primary: true }]); friendMenu(); };
    const side = (who) => { const nm = r[who + 'Name'] || '', mg = r[who + 'Mgr'] || '', inn = r[who + 'In'], rd = r[who + 'Ready'];
      return `<div class="rm-side ${who}${inn ? '' : ' wait'}${rd ? ' ready' : ''}"><small>${who === 'host' ? 'ホーム' : 'アウェー'}</small><div class="rm-sb"><img src="${embFromLook(r[who + 'Emb'], 128)}" alt=""><b>${esc(nm)}</b><span>${mg ? esc(mg) + '監督' : ''}</span><em>${!inn ? '入室待ち…' : rd ? '準備OK！' : '準備中'}</em></div></div>`; };
    const draw = () => {
      if (!r) return;
      const bothIn = r.hostIn && r.guestIn, myReady = r[me + 'Ready'];
      const msg = r.state === 'go' ? '<b class="rm-cd">まもなくキックオフ！</b>' : !bothIn ? (me === 'host' ? '<b>相手のポストに招待を送りました。</b><small>相手がルームに入るのを待っています…</small>' : '<b>ルームに入りました</b>') : myReady ? '<b>相手の準備を待っています…</b>' : '<b>準備ができたら「対戦する」を押してください</b>';
      box.innerHTML = `${apBg()}<div class="ap2">${apTop('フレンド対戦ルーム', 'ふたりとも「対戦する」を押すと、試合が始まります')}
        <div class="rm-vs">${side('host')}<div class="rm-x" style="background-image:url('${AP_VS_BG}')"><i class="ap-vs-t">VS</i></div>${side('guest')}</div>
        <div class="rm-msg"><img class="rm-post" src="icons/post.png" alt=""><div>${msg}</div></div>
        <div class="rm-btns">${r.state === 'go' ? '' : `<button class="rm-go ${myReady ? 'rm-cancel' : ''}" data-a="ready" ${bothIn ? '' : 'disabled'}><b>${myReady ? '準備を取り消す' : '対戦する'}</b></button>${bothIn ? '' : '<small class="rm-hint">相手の入室後に準備できます</small>'}`}</div>
        <p class="ap-foot rm-foot">${AP_SVG.info}<span>ルーム対戦では、試合中の交代・作戦変更はできません。</span><i></i><span>ふたりの画面で同じ試合を再現します。</span></p></div>`;
      el.hidden = false; el._fit && el._fit();
      box.querySelector('.std-back').onclick = () => leave();
      const rb = box.querySelector('[data-a="ready"]'); if (rb) rb.onclick = async () => { rb.disabled = true; try { await DotNet.roomUpdate(id, { [me + 'Ready']: !myReady }); } catch (_) { rb.disabled = false; } };
    };
    unsub = DotNet.roomWatch(id, async (nr) => {
      if (started) return;
      if (!nr || nr.state === 'closed') { if (unsub) unsub(); unsub = null; el.hidden = true; await modal('<h2>ルームが閉じられました</h2><p>相手が退出しました。</p>', [{ label: 'OK', primary: true }]); friendMenu(); return; }
      r = nr; draw();
      if (r.state === 'open' && r.hostReady && r.guestReady) DotNet.roomStart(id).catch(() => {});
      if (r.state === 'go' && r.seed && r.hostCode && r.guestCode) {
        started = true; if (unsub) unsub(); unsub = null;
        const wait = Math.max(0, Math.min(6000, (r.startAt || 0) - Date.now()));
        let left = Math.ceil(wait / 1000); const cd = box.querySelector('.rm-cd'); if (cd) cd.textContent = left > 0 ? `キックオフまで ${left}…` : 'キックオフ！';
        cdT = setInterval(() => { left--; const c2 = box.querySelector('.rm-cd'); if (c2) c2.textContent = left > 0 ? `キックオフまで ${left}…` : 'キックオフ！'; }, 1000);
        setTimeout(async () => { clearInterval(cdT); el.hidden = true; try { await playRoom(r, me); } catch (e) { modal('<h2>試合を始められませんでした</h2>', [{ label: 'OK', primary: true }]); } }, wait);
      }
    });
  }
  async function playRoom(r, me) {
    const hd = await unpackCode(r.hostCode), gd = await unpackCode(r.guestCode);
    const oppD = me === 'host' ? gd : hd, g = C.registerGuest(save, oppD);
    const hostTeam = JSON.parse(JSON.stringify(hd.team)), guestTeam = JSON.parse(JSON.stringify(gd.team));
    const hx = (h) => [1, 3, 5].map((i) => parseInt(String(h || '#888888').slice(i, i + 2), 16) || 0), dist = (a, b) => { const A = hx(a), B = hx(b); return Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2]); };
    const k0 = hd.kit || C.KIT_DEFAULT, k1 = gd.kit && hd.kit && dist(gd.kit.shirt, hd.kit.shirt) < 120 && gd.kit2 ? gd.kit2 : (gd.kit || C.KIT_DEFAULT);
    venueNow = Math.max(0, Math.min(4, (C.LG[hd.lg] || {}).tier ?? 2));
    cancelAnimationFrame(raf);
    const op = { name: g.name, short: oppD.short || g.short, srcName: oppD.name + (oppD.mgr ? `（${oppD.mgr}）` : ''), fuid: me === 'host' ? r.guest : r.host };
    // 版769：2つの画面の時間あわせ。2秒ごとに自分の試合の時間を送り、相手のほうが進んでいたら、そこまで飛ばす（遅れている側が進んでいる側に合わせる）
    const other = me === 'host' ? 'guest' : 'host'; let syncT = null, syncU = null, otherAt = null, syncGone = 0;
    const syncEnd = () => { clearInterval(syncT); syncT = null; if (syncU) syncU(); syncU = null; };
    try {
      syncU = DotNet.roomWatch(r.id, (nr) => { if (nr && nr[other + 'T'] != null) otherAt = { t: nr[other + 'T'], run: !!nr[other + 'Run'], got: Date.now() }; });
      syncT = setInterval(() => {
        const ap = A(), ms = document.getElementById('match'); if (!ap || !ap.match) return;
        if (!ms || ms.hidden) { if (++syncGone > 8) syncEnd(); return; } syncGone = 0;
        DotNet.roomUpdate(r.id, { [me + 'T']: Math.round(ap.simT * 10) / 10, [me + 'Run']: !!ap.playing }).catch(() => {});
        if (!otherAt) return;
        const est = otherAt.t + (otherAt.run ? Math.min(4, (Date.now() - otherAt.got) / 1000) * ap.RATE : 0);
        if (est > ap.simT + 1.5) ap.catchUp(est);
      }, 2000);
    } catch (_) {}
    A().startWith(hostTeam, guestTeam, r.seed, hd.short || hd.name, gd.short || gd.name, (score) => {
      syncEnd();
      const my = me === 'host' ? score.slice() : [score[1], score[0]];
      onlineDone('friend', op, my);
    }, { venue: venueNow, kits: [k0, k1], noIntro: true, lockEdit: true, comp: 'フレンド対戦', label: 'ルーム', homeName: hd.name, awayName: gd.name, embH: embFromLook(hd.emb, 48), embA: embFromLook(gd.emb, 48), grade: (q, k, tm) => { const pl = ((tm ? gd : hd).team.players || []).find((x) => x.name === q.name && x.number === q.number) || ((tm ? gd : hd).team.players || []).find((x) => x.name === q.name); if (pl && pl.bg && pl.bg[k]) return pl.bg[k]; return C.rankInfo(C.toPts((q.params || q)[k])).g; } });   // 版629：クラブ画面と同じ、素の能力ランクを表示
  }
  // 版624：ポストの見張り（申請・招待・挑戦が届いたら、すぐポストに入れて知らせる）
  let mailWatching = false;
  function watchPost() {
    if (mailWatching || !(window.DotNet && DotNet.on && DotNet.watchMail)) return; mailWatching = true;
    DotNet.ready().then((ok) => { if (!ok) { mailWatching = false; return; }
      const got = () => { const before = postUnread(); syncPost(true).then(() => { postBadge(); const sc = document.getElementById('postScreen'); if (sc && !sc.hidden) { if (postUnread() !== before && openPost.redraw) openPost.redraw(); return; } if (postUnread() > before) postToast(); }); };
      DotNet.watchMail((n) => { if (n) got(); });
      // 見張りがつながらない端末のために、15秒ごとにも確認（画面が見えている時だけ）
      setInterval(() => { if (document.hidden || $('#career').hidden) return; DotNet.mailbox && Promise.all([DotNet.mailbox().catch(() => []), DotNet.inbox().catch(() => [])]).then(([m, b]) => { if (m.length || b.length) got(); }); }, 15000);
    });
  }
  function postToast() {
    const n = postUnread(); if (!n) return;
    let t = document.getElementById('postToast'); if (!t) { t = document.createElement('div'); t.id = 'postToast'; (document.getElementById('app') || document.body).appendChild(t); }
    const last = ensurePost().items[0];
    const msg = last && !last.read ? ({ freq: `${esc(last.name)}からフレンド申請が届きました`, room: `${esc(last.name)}がルームを作りました`, fok: `${esc(last.name)}とフレンドになりました`, def: 'ランクマッチで挑まれました' }[last.kind] || 'ポストにお知らせが届きました') : 'ポストにお知らせが届きました';
    t.innerHTML = `<img src="icons/post.png" alt=""><span>${msg}</span>`; t.className = 'on';
    t.onclick = () => { t.className = ''; openPost(() => { try { renderHome(); } catch (_) {} }); };
    clearTimeout(postToast.tm); postToast.tm = setTimeout(() => { t.className = ''; }, 4500);
  }
  // フレンド申請を送る（空港・事務所の「フレンド」から）
  async function sendFriendReq(idText) {
    const on = ensureOnline(), id = String(idText || '').replace(/\D/g, '');
    if (id.length !== 8) return modal('<h2>8けたのフレンドIDを入れてください</h2>', [{ label: 'OK', primary: true }]);
    if (id === on.fid) return modal('<h2>それはあなたのIDです</h2>', [{ label: 'OK', primary: true }]);
    let p = null; try { p = await DotNet.byFid(id); } catch (_) {}
    if (!p) return modal('<h2>見つかりませんでした</h2><p>IDをもう一度たしかめてください。</p>', [{ label: 'OK', primary: true }]);
    const ok = await modal(`<h2>フレンド申請</h2><div class="ap-vs"><img src="${embFromLook(p.emb, 64)}" alt=""><b>${esc(p.name)}</b></div><p>${p.mgr ? esc(p.mgr) + '監督　' : ''}${rankBadge(Math.max(0, Math.min(4, p.rank || 0)))}</p><p class="hintp">相手のポストに申請が届きます。相手が承認すると、フレンドになります。</p>`, [{ label: '申請する', primary: true, value: true }, { label: 'やめる', value: false }]);
    if (!ok) return false;
    try { await DotNet.sendMail(p.uid, { type: 'freq', ...myCard() }); } catch (_) { return modal('<h2>通信できませんでした</h2>', [{ label: 'OK', primary: true }]); }
    on.fsent = [...new Set([...(on.fsent || []), p.uid])]; store();
    await modal(`<h2>申請しました！</h2><p>${esc(p.name)}が承認すると、あなたのポストにお知らせが届きます。</p>`, [{ label: 'OK', primary: true }]);
    return true;
  }
  // 版616：ランキング（全国のRP順）
  async function ranking() {
    const on = ensureOnline(); let top = [];
    try { top = await DotNet.top(50); } catch (_) {}
    const el = fullScreen('apScreen', 'ap-wrap'), box = el.querySelector('.lk-box');
    const myI = top.findIndex((p) => p.uid === DotNet.uid);
    const row = (p, k) => `<div class="ap-rkr${p.uid === DotNet.uid ? ' me' : ''}${k < 3 ? ' top' + (k + 1) : ''}"><span class="ap-rkr-no">${k + 1}</span><img src="${embFromLook(p.emb, 48)}" alt=""><div class="ap-rkr-n"><b>${esc(p.name)}${premMark(p.prem)}</b><small>${p.mgr ? esc(p.mgr) + '監督' : ''}</small></div>${rankBadge(Math.max(0, Math.min(4, p.rank || 0)))}<b class="ap-rkr-rp">${p.rp || 0}<small>RP</small></b></div>`;
    box.innerHTML = `${apBg()}<div class="ap-top"><img src="icons/home_online.png" alt=""><div><b>全国ランキング</b><small>RPの多い監督 TOP50</small></div><button class="std-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button></div>
      <div class="ap-rkl">${top.length ? top.map(row).join('') : '<p class="ap-note">まだランキングを読みこめませんでした。</p>'}</div>
      <div class="ap-rkme">あなた：${myI >= 0 ? `<b>${myI + 1}位</b>` : '<b>圏外</b>'}　${rankBadge(rankIdx(on.rp))}　<b>${on.rp}</b> RP</div>`;
    el.hidden = false; el._fit && el._fit();
    box.querySelector('.std-back').onclick = () => airport();
  }
  function onlineDone(kind, op, score) {
    const on = ensureOnline(), res = score[0] > score[1] ? 'W' : score[0] === score[1] ? 'D' : 'L';
    let html = '', rewards = null;
    const resTxt = res === 'W' ? '勝利！' : res === 'D' ? '引き分け' : '敗北…';
    if (kind === 'rank') {
      const before = on.rp, i0 = rankIdx(before);
      on.rp = res === 'W' ? before + RP_WIN : res === 'D' ? Math.max(0, before + RP_DRAW) : Math.max(0, before - RP_LOSE);   // 版617：下がる（降格あり）
      on[res.toLowerCase()]++;
      const i1 = rankIdx(on.rp);
      rewards = rankReward(i0, i1);
      on.best = Math.max(on.best || 0, on.rp);
      if (op.ruid && window.DotNet && DotNet.on) { try { DotNet.report(op.ruid, { res, s: score.slice(), name: save.team.name, mgr: save.manager || '' }); } catch (_) {} }   // 版616：相手に守備の結果を届ける
      const d = on.rp - before;
      // 版834：新しいデザインの結果カード（スコア・ライセンスとRP・次の級までのゲージ・昇格／降格）
      const nx = RANK_AT[i1 + 1], lo = RANK_AT[i1], pct = nx ? Math.max(0, Math.min(100, Math.round((on.rp - lo) / (nx - lo) * 100))) : 100;
      html = { tag: 'ランクマッチ', title: resTxt, theme: res === 'W' ? 'win' : res === 'L' ? 'lose' : '', body: `${rcScore(score, op)}
        <div class="rc2-sec"><div class="rc2-sh">ライセンス</div><div class="rc2-rp">${rankBadge(i1, true)}<b class="rc2-rpn">${on.rp}<small>RP</small></b><em class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}</em>
          <div class="rc2-bar"><i style="width:${pct}%;--rc:${RANKS[i1].c}"></i></div><small class="rc2-nx">${nx ? `${RANKS[i1 + 1].n}ライセンスまで あと${nx - on.rp} RP` : '最高のライセンスです'}</small></div></div>
        ${i1 > i0 ? `<div class="rc2-ban up">昇格！　${RANKS[i0].n} ▶ <b>${RANKS[i1].n}ライセンス</b></div>` : i1 < i0 ? `<div class="rc2-ban dn">降格…　${RANKS[i0].n} ▶ ${RANKS[i1].n}ライセンス</div>` : ''}` };
    } else {
      on['f' + res.toLowerCase()]++;
      const f = on.friends.find((x) => x.name === op.srcName); if (f) { f[res.toLowerCase()] = (f[res.toLowerCase()] || 0) + 1; }
      if (op.fuid) { const g2 = (on.flist || []).find((x) => x.uid === op.fuid); if (g2) g2[res.toLowerCase()] = (g2[res.toLowerCase()] || 0) + 1; }
      html = { tag: 'フレンド対戦', title: resTxt, theme: res === 'W' ? 'win' : res === 'L' ? 'lose' : '', body: `${rcScore(score, op)}${f ? `<p class="rc2-note">${esc(op.srcName)}との対戦成績：<b>${f.w || 0}勝 ${f.d || 0}分 ${f.l || 0}敗</b></p>` : ''}` };
    }
    store(); open(); publishMe();
    (async () => {
      await resCard(html);
      if (rewards) await resCard(rewardCard(rewards));
      store(); try { renderHome(); } catch (_) {}
    })();
  }
  function rankOpponent() {
    const on = ensureOnline(), R = RANKS[rankIdx(on.rp)];
    const lgs = R.lg.filter((id) => save.world.leagues[id] && id !== save.league.id || (save.world.leagues[id] && R.lg.length === 1));
    let list = []; for (const id of (lgs.length ? lgs : R.lg)) for (const t of (save.world.leagues[id] || [])) if (t.name !== save.team.name) list.push(t);
    if (R.part && list.length) { const s = list.slice().sort((a, b) => (b.lvl || 0) - (a.lvl || 0)); list = s.slice(Math.floor(s.length * R.part[0]), Math.max(1, Math.ceil(s.length * R.part[1]))); }
    if (!list.length) for (const id in save.world.leagues) for (const t of save.world.leagues[id]) if (t.name !== save.team.name) list.push(t);
    return list[Math.floor(Math.random() * list.length)];
  }
  // 版613：自分のクラブをオンラインに公開（ロビーを開いた時・対戦のあと）
  let pubBusy = false;
  async function publishMe() {
    if (!(window.DotNet && DotNet.on) || pubBusy) return null; pubBusy = true;
    try { const on = ensureOnline(), d = C.guestCode(save), code = await packCode(d);
      const fid = await DotNet.publish({ fid: on.fid, name: d.name, short: d.short, mgr: d.mgr, lg: d.lg, emb: d.emb, kit: d.kit, rank: rankIdx(on.rp), rp: on.rp, lvl: C.teamLevel(save), code, sv: save.cloudCode || null, prem: C.premOn(save) });
      if (fid && fid !== on.fid) { on.fid = fid; store(); } return fid;
    } catch (_) { return null; } finally { pubBusy = false; }
  }
  const embLookCache = new Map();
  function embFromLook(lk, size) { if (!lk) return 'icons/home_lineup.png'; const k = JSON.stringify(lk) + size; if (!embLookCache.has(k)) { const cv = document.createElement('canvas'); cv.width = size; cv.height = size; try { drawEmblem(cv.getContext('2d'), size / 2, size / 2, size * 0.92, lk); } catch (_) {} embLookCache.set(k, cv.toDataURL()); } return embLookCache.get(k); }
  const fmtFid = (s) => (s ? String(s).replace(/(\d{4})(\d{4})/, '$1 $2') : '');
  async function startRank() {
    const on = ensureOnline(), ri = rankIdx(on.rp), R = RANKS[ri];
    let op = null, who = '', live = null;
    if (window.DotNet && DotNet.on) {   // 版613：オンライン：同じくらいのランクの、ほかの監督のクラブ
      try { const rv = await DotNet.rankRival(ri); if (rv && rv.code) { const d = await unpackCode(rv.code); const g = C.registerGuest(save, d); op = { name: g.name, short: g.short, ruid: rv.uid }; who = `${rv.mgr ? esc(rv.mgr) + '監督の' : ''}クラブ　${rankBadge(Math.max(0, Math.min(4, rv.rank || 0)))}`; live = rv; } } catch (_) {}
    }
    if (!op) { op = rankOpponent(); who = 'CPUのクラブ'; }
    if (!op) return;
    const ok = await rankConfirm(ri, op, live);   // 版634：専用の画面（ホーム／アウェーのカードとVS）
    if (!ok) return airport();
    runMatch('ランクマッチ', '', op, (score) => onlineDone('rank', op, score), { comp: 'ランクマッチ', label: R.n, home: true, online: 'rank' });
  }
  // 版634：ランクマッチの相手が見つかった画面
  function rankConfirm(ri, op, live) {
    const el = fullScreen('rkScreen', 'ap-wrap rk-wrap'), box = el.querySelector('.lk-box');
    const ori = live ? Math.max(0, Math.min(4, live.rank || 0)) : -1;
    const chip = (k) => (k < 0 ? '<span class="rk-lc cpu"><i>CPU</i>CPUのクラブ</span>' : `<span class="rk-lc" style="--rc:${RANKS[k].c}"><img src="icons/lic/${RANKS[k].k}.png" alt="">${RANKS[k].n}ライセンス</span>`);
    const card = (side, emb, nm, mg, k) => `<div class="rk-card ${side}"><small>${side === 'home' ? 'ホーム' : 'アウェー'}</small><div class="rk-cb"><img src="${emb}" alt=""><b>${esc(nm)}</b>${mg ? `<span>${esc(mg)}監督</span>` : ''}${chip(k)}</div></div>`;
    box.innerHTML = `${apBg()}<div class="ap2 rkm"><button class="std-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button>
      <div class="rk-box"><div class="rk-ttl">${AP_SVG.gtrophy}<b>ランクマッチ</b></div>
        <div class="rk-stage" style="background-image:url('${AP_VS_BG}')">
          <div class="rk-found"><span class="rk-lc" style="--rc:${RANKS[ri].c}">${RANKS[ri].n}ライセンス</span>の相手が見つかりました！</div>
          <div class="rk-vs">${card('home', emblemURL(save.team.name, 128), save.team.name, save.manager || '', ri)}<i class="ap-vs-t">VS</i>${card('away', emblemURL(op.name, 128), op.name, live && live.mgr, ori)}</div>
        </div>
        <div class="rk-rps"><span class="w"><b>勝利</b><em>+${RP_WIN}<small>RP</small></em></span><span class="d"><b>引き分け</b><em>${RP_DRAW}<small>RP</small></em></span><span class="l"><b>敗北</b><em>−${RP_LOSE}<small>RP</small></em></span></div>
        <p class="rk-note">RPが今の級の下限を割ると、ライセンスが1つ下がります。<br>選手の疲れ・ケガ・週は進みません。</p>
        <div class="rk-btns"><button class="rk-no">やめる</button><button class="rk-go">${AP_SVG.ball}対戦する</button></div>
      </div></div>`;
    el.hidden = false; el._fit && el._fit();
    return new Promise((res) => {
      const done = (v) => { el.hidden = true; res(v); };
      box.querySelector('.rk-go').onclick = () => done(true);
      box.querySelector('.rk-no').onclick = () => done(false);
      box.querySelector('.std-back').onclick = () => done(false);
    });
  }
  async function startFriend(d, o) {
    o = o || {};
    const g = C.registerGuest(save, d), on = ensureOnline();
    const srcName = d.name + (d.mgr ? `（${d.mgr}）` : '');
    let f = on.friends.find((x) => x.name === srcName);
    if (!f) { f = { name: srcName, w: 0, d: 0, l: 0 }; on.friends.unshift(f); } else { on.friends.splice(on.friends.indexOf(f), 1); on.friends.unshift(f); }
    f.code = await packCode(d); f.at = Date.now(); on.friends = on.friends.slice(0, 8); store();
    const ok = await modal(`<h2>フレンド対戦</h2><div class="ap-vs"><img src="${emblemURL(g.name, 64)}" alt=""><b>${esc(g.name)}</b></div><p>${d.mgr ? esc(d.mgr) + '監督の' : ''}チームと対戦します。</p><p class="hintp">選手の疲れ・ケガ・週は進みません。</p>`, [{ label: '対戦する', primary: true, value: true }, { label: 'やめる', value: false }]);
    if (!ok) return airport();
    const op = { name: g.name, short: g.short, srcName, fuid: o.uid };
    runMatch('フレンド対戦', '', op, (score) => onlineDone('friend', op, score), { comp: 'フレンド対戦', label: '', home: true, online: 'friend' });
  }
  const AP_SVG = {
    trophy: '<svg viewBox="0 0 48 48"><path d="M14 6h20v6h8c0 9-5 14-11 15-2 4-4 6-5 7v5h7v5H15v-5h7v-5c-1-1-3-3-5-7C11 26 6 21 6 12h8z" fill="#fff"/><path d="M10 15c1 5 4 8 6 9-1-3-2-6-2-9zM38 15c-1 5-4 8-6 9 1-3 2-6 2-9z" fill="rgba(0,0,0,.25)"/></svg>',
    hands: '<svg viewBox="0 0 48 48"><path d="M4 20l9-8 7 3 4-2 4 2 7-3 9 8-6 6-3-2-9 9c-2 2-5 2-6 0l-8-8-3 2z" fill="#fff"/><path d="M20 22l6-3 6 5-5 5" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M2 11l19-8-6 18-4-7z" fill="#fff"/><path d="M11 14l10-11" stroke="rgba(0,0,0,.3)" stroke-width="1.6"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="13" height="17" rx="2" fill="#4a8cff" stroke="#fff" stroke-width="1.6"/><rect x="8" y="6" width="7" height="7" rx="1" fill="#fff" opacity=".8"/></svg>',
    gem: '<svg viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 13L2 9z" fill="#c76aff" stroke="#fff" stroke-width="1.4"/><path d="M2 9h20M8 3l4 19 4-19" stroke="#fff" stroke-width="1" opacity=".6" fill="none"/></svg>',
    // 版634：空港の画面（参考画像の形）で使う絵
    gtrophy: '<svg viewBox="0 0 64 64"><path d="M18 8h28v8h10c0 11-6 18-14 19-2 5-5 8-7 9v6h9v6H20v-6h9v-6c-2-1-5-4-7-9C14 34 8 27 8 16h10z" fill="#ffd23a" stroke="#8a5a00" stroke-width="2.5" stroke-linejoin="round"/><path d="M13 20c1 6 5 10 8 11-1-3-2-7-2-11zM51 20c-1 6-5 10-8 11 1-3 2-7 2-11z" fill="#b8860b"/><path d="M24 12c0 10 2 18 6 22" stroke="#fff6b0" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="18" y="54" width="28" height="6" rx="2" fill="#c8901a" stroke="#8a5a00" stroke-width="2"/></svg>',
    muscle: '<svg viewBox="0 0 32 32"><path d="M6 24c-2-6 0-12 4-15l3-4 4 2-2 4 3 2c4-2 9 0 10 4 1 5-3 9-8 9H9c-1 0-2-1-3-2z" fill="#1d3f8f"/></svg>',
    trophy2: '<svg viewBox="0 0 32 32"><path d="M9 4h14v3h5c0 6-3 9-7 10-1 2-3 4-4 4v4h4v3H11v-3h4v-4c-1 0-3-2-4-4C7 16 4 13 4 7h5z" fill="#1d3f8f"/></svg>',
    shield: '<svg viewBox="0 0 32 32"><path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#1d3f8f"/><path d="M16 8l6 2v5c0 4-3 7-6 8z" fill="#fff" opacity=".35"/></svg>',
    hand2: '<svg viewBox="0 0 32 32"><path d="M2 14l6-5 5 2 3-1 3 1 5-2 6 5-4 4-2-1-6 6c-1 1-3 1-4 0l-6-6-2 1z" fill="#1d3f8f"/></svg>',
    mail: '<svg viewBox="0 0 48 36"><rect x="2" y="4" width="36" height="28" rx="3" fill="#fff6d8" stroke="#d89a1a" stroke-width="2.5"/><path d="M3 6l17 14L37 6" fill="none" stroke="#d89a1a" stroke-width="2.5"/><path d="M40 10h6M41 17h6M40 24h5" stroke="#ffd23a" stroke-width="3" stroke-linecap="round"/></svg>',
    people: '<svg viewBox="0 0 48 36"><circle cx="16" cy="10" r="7" fill="#fff"/><path d="M3 34c0-8 6-14 13-14s13 6 13 14z" fill="#fff"/><circle cx="33" cy="11" r="6" fill="#cfe0ff"/><path d="M27 21c2-1 4-2 6-2 7 0 12 6 12 15H31c0-5-1-9-4-13z" fill="#cfe0ff"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="7" y="6" width="12" height="15" rx="2" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M5 17V5a2 2 0 012-2h9" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M10 11h6M10 15h6" stroke="#fff" stroke-width="2"/></svg>',
    ball: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#fff" stroke="#222" stroke-width="2"/><polygon points="16,10 21.5,14 19.5,20.5 12.5,20.5 10.5,14" fill="#222"/><path d="M16 2v8M29 13l-7.5 1M24 27l-4.5-6.5M8 27l4.5-6.5M3 13l7.5 1" stroke="#222" stroke-width="1.8"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1d4fb8"/><rect x="10.6" y="10" width="2.8" height="8" rx="1" fill="#fff"/><circle cx="12" cy="6.6" r="1.7" fill="#fff"/></svg>',
    qshield: '<svg viewBox="0 0 64 64"><path d="M32 4l24 8v18c0 15-11 26-24 30C19 56 8 45 8 30V12z" fill="#e8ecf4" stroke="#9aa6bc" stroke-width="3"/><text x="32" y="42" text-anchor="middle" font-size="28" font-weight="900" fill="#9aa6bc">?</text></svg>' };
  const AP_VS_BG = 'img/venue/goal_4.jpg';
  // 空港の背景：ホームの絵の空港あたりを大きく写して、ぼかす
  function apBg() { let src = ''; try { const im = H2.cur(); src = im && im.src; } catch (_) {} return src ? `<div class="ap-bg" style="background-image:url('${src}')"></div>` : '<div class="ap-bg"></div>'; }
  function apTop(t, sub, ic) { return `<div class="ap-top"><img src="${ic || 'icons/home_online.png'}" alt=""><div><b>${t}</b><small>${sub}</small></div><button class="std-back" title="もどる"><i class="bk-ico" aria-hidden="true"></i></button></div>`; }
  function apMedal(i, size) { const R = RANKS[i]; return `<div class="ap-medal ap-lic" style="--rc:${R.c};--sz:${size}px"><img src="icons/lic/${R.k}.png" alt="${R.n}" draggable="false"></div>`; }   // 版683：ライセンスのバッジ絵
  async function friendMenu(back) {
    if (typeof back === 'function') friendMenu.back = back; else if (back !== 'keep') friendMenu.back = null;
    const on = ensureOnline(); on.flist = on.flist || [];
    if (window.DotNet && DotNet.on && Date.now() - (friendMenu.fixT || 0) > 60000) { friendMenu.fixT = Date.now(); (async () => { let ch = false; for (const f of on.flist) { if (!f.fid) continue; try { const p = await DotNet.byFid(f.fid); if (p && p.uid && p.uid !== f.uid) { f.uid = p.uid; ch = true; } if (p && !!p.prem !== !!f.prem) { f.prem = !!p.prem; ch = true; } } catch (_) {} } if (ch) store(); })(); }   // 版672：フレンドが機種変更（データ引き継ぎ）していたら、新しい端末へつなぎ直す
    const el = fullScreen('apScreen', 'ap-wrap'), box = el.querySelector('.lk-box'), net = !!(window.DotNet && DotNet.on);
    const card = (f, k) => `<div class="ap-fc"><img src="${embFromLook(f.emb, 96)}" alt=""><div class="ap-fc-n"><b>${esc(f.name)}${premMark(f.prem)}</b>${f.mgr ? `<small>${esc(f.mgr)}監督</small>` : ''}${f.rank != null ? rankBadge(f.rank) : ''}<small class="ap-fc-r">${f.w || 0}勝 ${f.d || 0}分 ${f.l || 0}敗</small></div><button class="ap-fc-go${(friendMenu.inv || []).some((r) => r.host === f.uid) ? ' inv' : ''}" data-fu="${k}"><img src="icons/home_stadium.png" alt="">${(friendMenu.inv || []).some((r) => r.host === f.uid) ? 'ルームに入る' : 'ルームを作る'}</button><button class="ap-fc-x xbtn" data-fx="${k}" title="フレンドから外す"><img class="xbtn-img" src="icons/ui_close.png" alt="×" draggable="false"></button></div>`;
    box.innerHTML = `${apBg()}<div class="ap2">${apTop('フレンド', 'フレンド申請して、いつでも対戦！')}
      <div class="ap-fgrid2">
        <div class="ap-pnl ap-reg"><h3><span class="ap-hi">${AP_SVG.mail}</span>フレンド申請</h3><div class="ap-pb">
          <div class="ap-myid"><div><small>あなたのフレンドID</small><b id="apMyId">${net ? (on.fid ? fmtFid(on.fid) : '取得中…') : '――――'}</b></div>${net ? `<button class="ap-copy" data-a="copyid">${AP_SVG.copy}コピー</button>` : ''}</div>
          ${net ? `<p class="ap-note">友達のIDで申請し、承認されるとフレンドになります。<br>フレンド対戦は、フレンドどうしだけで遊べます。${(on.fsent || []).length ? `<br><b class="ap-wait">返事待ち ${on.fsent.length}件</b>` : ''}</p>
          <div class="ap-idrow"><input id="apFid" inputmode="numeric" maxlength="9" placeholder="8けたのID"><button class="ap-reg-go" data-a="add">${AP_SVG.ball}<b>申請</b></button></div>`
          : '<p class="ap-note">フレンドの機能は、インターネットにつながっている時だけ使えます。</p>'}
        </div></div>
        <div class="ap-pnl ap-flist"><h3><span class="ap-hi">${AP_SVG.people}</span>フレンド一覧 <em>${on.flist.length}人</em></h3><div class="ap-pb">
          <div class="ap-fcs">${on.flist.length ? on.flist.map(card).join('') : `<p class="ap-note">まだフレンドがいません。${net ? '左でフレンドIDを入れて申請しましょう。' : ''}</p>`}</div>
          </div></div>
      </div></div>`;
    el.hidden = false; el._fit && el._fit();
    const close = () => { el.hidden = true; };
    const q = (s) => box.querySelector(s);
    q('.std-back').onclick = () => { close(); if (friendMenu.back) friendMenu.back(); else airport(); };
    if (net && !friendMenu.invLoaded) { friendMenu.invLoaded = true; DotNet.roomInvites().then((v) => { friendMenu.inv = v; if (!el.hidden && v.length) friendMenu('keep'); }).catch(() => {}).finally(() => setTimeout(() => { friendMenu.invLoaded = false; }, 3000)); }
    if (net && !on.fid) publishMe().then((fid) => { const e = q('#apMyId'); if (e) e.textContent = fid ? fmtFid(fid) : 'つながりません'; if (!fid) { const n = document.createElement('p'); n.className = 'ap-note ap-err'; n.textContent = '通信できませんでした（' + ((window.DotNet && DotNet.err) || '不明') + '）'; const m = q('.ap-myid'); m && m.after(n); } });
    if (q('[data-a="copyid"]')) q('[data-a="copyid"]').onclick = async () => { try { await navigator.clipboard.writeText(on.fid || ''); modal('<h2>フレンドIDをコピーしました</h2>', [{ label: 'OK', primary: true }]); } catch (_) {} };
    if (q('[data-a="add"]')) q('[data-a="add"]').onclick = async () => { if (await sendFriendReq(q('#apFid').value)) friendMenu('keep'); };
    box.querySelectorAll('[data-fu]').forEach((b) => b.onclick = async () => {   // 版622：ルームを作って、相手が入るのを待つ
      const f = on.flist[+b.dataset.fu], inv = (friendMenu.inv || []).find((r) => r.host === f.uid);
      if (inv) { close(); return joinRoom(inv.id); }
      b.disabled = true; const id = await makeRoom(f); b.disabled = false;
      if (id) { close(); roomScreen(id, 'host'); }
    });
    box.querySelectorAll('[data-fx]').forEach((b) => b.onclick = async () => { const f = on.flist[+b.dataset.fx]; if (await modal(`<h2>${esc(f.name)} をフレンドから外しますか？</h2><p>外すと、このクラブとはフレンド対戦ができなくなります。<br>もう一度フレンドになるには、申請しなおしが必要です。</p>`, [{ label: '外さない', primary: true, value: false }, { label: '外す', value: true }])) { on.flist.splice(+b.dataset.fx, 1); store(); } friendMenu(); });
  }
  async function airport() {
    const on = ensureOnline(), i = rankIdx(on.rp), last = i === RANKS.length - 1, lo = RANK_AT[i], hi = last ? lo : RANK_AT[i + 1], into = on.rp - lo, span = hi - lo, pct = last ? 100 : Math.round(into / span * 100);
    const el = fullScreen('apScreen', 'ap-wrap'), box = el.querySelector('.lk-box');
    const nx = last ? null : RANK_REWARD[i + 1], gotNx = !last && rankIdx(on.best || 0) >= i + 1;
    const ladder = RANKS.map((R, k) => `<div class="ap-lad${k === i ? ' on' : ''}${k < i ? ' done' : ''}" style="--rc:${R.c}"><img src="icons/lic/${R.k}.png" alt="" draggable="false"><small>${R.n}</small></div>`).join('<span class="ap-lad-ln"></span>');
    const net = !!(window.DotNet && DotNet.on), f0 = (on.flist || [])[0];
    const statRow = (ic, l, v) => `<div><span class="ap-si">${AP_SVG[ic]}</span><small>${l}</small><b>${v}</b></div>`;
    const wdl = (w, d, l) => `${w || 0}<i>勝</i> ${d || 0}<i>分</i> ${l || 0}<i>敗</i>`;
    box.innerHTML = `${apBg()}<div class="ap2">${apTop('空港　対戦ロビー', '勝ってライセンスを上げよう！ S級を目指せ')}
      <div class="ap-frame">
      <div class="ap-main">
        <div class="ap-pnl ap-club"><h3>マイクラブ</h3><div class="ap-pb"><img class="ap-emb" src="${emblemURL(save.team.name, 128)}" alt=""><b class="ap-tn">${esc(save.team.name)}${premMark(C.premOn(save))}</b>
          <div class="ap-fidl"><span>フレンドID</span><b id="apFidL">${net ? (on.fid ? fmtFid(on.fid) : '…') : 'オフライン'}</b></div>
          <div class="ap-stats">${statRow('muscle', '総合力', Math.round(C.teamLevel(save)))}${statRow('trophy2', 'ランクマッチ', wdl(on.w, on.d, on.l))}${statRow('shield', '守備', wdl(on.dw, on.dd, on.dl))}${statRow('hand2', 'フレンド', wdl(on.fw, on.fd, on.fl))}</div></div></div>
        <div class="ap-pnl ap-rankp"><h3>監督ライセンス${net ? `<button class="ap-rkbtn" data-a="ranking">${AP_SVG.trophy2}全国ランキング</button>` : ''}</h3><div class="ap-pb"><div class="ap-rk-row">${apMedal(i, 150)}<div class="ap-rk-info"><b class="ap-rk-n">${RANKS[i].n}ライセンス</b><div class="ap-rk-rp"><b>${on.rp}</b> RP</div>
            ${last ? '<div class="ap-sm2">最高の S級ライセンス！</div>' : `<div class="ap-bar2"><i style="width:${pct}%"></i><span>${into} / ${span}</span></div><div class="ap-sm2">${RANKS[i + 1].n}まであと <b>${hi - on.rp}</b> RP${i > 0 ? `<small>（${lo} RP を割ると降格）</small>` : ''}</div>`}</div></div>
          ${last ? '' : `<div class="ap-rw2"><span class="ap-rw2-h">${gotNx ? '受け取りずみ' : `${RANKS[i + 1].n}ライセンス取得のごほうび`}</span><span class="ap-rw2-i"><img class="coin-ico" src="icons/coin.png" alt="">${nx.coins}</span><span class="ap-rw2-i">${AP_SVG.card}×${nx.cards}</span>${nx.kak ? `<span class="ap-rw2-i"><img class="kk-ico" src="icons/kakera.png" alt="カケラ" draggable="false">×${nx.kak}</span>` : ''}</div>`}
          <div class="ap-ladder">${ladder}</div></div></div>
      </div>
      <div class="ap-modes"><button class="ap-mode ap-gold" data-a="rank">${AP_SVG.gtrophy}<div><b>ランクマッチ</b><small>勝ち +${RP_WIN} ／ 引き分け ${RP_DRAW} ／ 負け −${RP_LOSE} RP</small></div><i class="ap-chev"></i></button>
        <button class="ap-mode ap-blue" data-a="friend"><span class="ap-vsm"><img src="${emblemURL(save.team.name, 96)}" alt=""><em>VS</em>${f0 && f0.emb ? `<img src="${embFromLook(f0.emb, 96)}" alt="">` : AP_SVG.qshield}</span><div><b>フレンド</b><small>フレンドになった監督のクラブと対戦</small></div><i class="ap-chev"></i></button></div>
      </div>
      <p class="ap-foot">${net ? 'ランクマッチは、同じくらいのランクの監督と対戦します' : '※ いまのランクマッチの相手はCPUのクラブです'}　・　対戦では疲れ・ケガ・週は進みません</p></div>`;
    el.hidden = false; el._fit && el._fit();
    const close = () => { el.hidden = true; };
    box.querySelector('.std-back').onclick = close;
    box.querySelector('[data-a="rank"]').onclick = () => { close(); startRank(); };
    box.querySelector('[data-a="friend"]').onclick = () => friendMenu();
    publishMe().then((fid) => { const e = box.querySelector('#apFidL'); if (!e) return; const f = fid || ensureOnline().fid; e.textContent = f ? fmtFid(f) : 'つながりません';   // 版684：公開に失敗しても、IDは見せる。理由を小さく出す
      if (!fid) { const er = (window.DotNet && DotNet.err) || ''; e.title = er; const fl = e.closest('.ap-fidl'); if (fl && !fl.querySelector('.ap-neterr')) fl.insertAdjacentHTML('afterend', `<small class="ap-neterr">通信エラー${er ? `（${esc(String(er).slice(0, 60))}）` : ''}</small>`); } });
    if (box.querySelector('[data-a="ranking"]')) box.querySelector('[data-a="ranking"]').onclick = () => ranking();
    if (!airport.busy) { airport.busy = true; syncPost(true).then(() => { airport.busy = false; if (!el.hidden && on.rp !== (airport.lastRp ?? on.rp)) airport(); }).catch(() => { airport.busy = false; }); }
    airport.lastRp = on.rp;
  }
  // リンク（#vs=...）から開いたとき：その友達と対戦するか聞く
  async function checkVsLink() {
    const m = location.hash.match(/vs=([A-Za-z0-9_\-]+)/); if (!m || !save) return;
    history.replaceState(null, '', location.pathname + location.search);
    modal('<h2>フレンド対戦は、フレンドどうしだけです</h2><p>空港かクラブ事務所の「フレンド」で、相手のフレンドIDに申請してください。相手が承認するとフレンドになり、対戦できます。</p>', [{ label: 'OK', primary: true }]);   // 版621：リンクだけでは対戦しない
  }
  // ---------- 版672：データ引き継ぎ（クラウドに保存・クラウドから復元）  版674：画面を新しいデザインに ----------
  const cloudInfoOf = (sv) => { const k = cal(sv.week || 1); return { season: sv.season || 1, m: k.m, w: k.w, mgr: sv.manager || '', team: (sv.team && sv.team.name) || '', lg: (sv.league && sv.league.name) || '', emb: (sv.club && sv.club.emb) || null }; };
  const fmtCode = (c) => (c || '').replace(/(.{4})(?=.)/g, '$1-');
  const clAt = (t) => { if (!t) return '—'; const d = new Date(t), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}/${z(d.getMonth() + 1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
  // ドット絵のアイコン（行ごとの文字＝色）
  const pixSvg = (rows, pal, px) => { const w = rows[0].length, h = rows.length; let r = ''; rows.forEach((row, y) => { for (let x = 0; x < w; x++) { const c = pal[row[x]]; if (c) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`; } }); return `<svg viewBox="0 0 ${w} ${h}" width="${w * px}" height="${h * px}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`; };
  const CLOUD_ROWS = ['.....kkkk.......', '....kwwwwk......', '...kwwwwwwkkk...', '.kkwwwwwwwwwwk..', 'kwwwwwwwwwwwwwk.', 'kwwwwwwwwwwwwbwk', 'kwbwwwwwwwwwbbwk', '.kbbbwwwwwbbbbk.', '..kkkkkkkkkkkk..'];
  const icoCloud = (px) => pixSvg(CLOUD_ROWS, { k: '#24406e', w: '#eaf6ff', b: '#9fd2f5' }, px);
  const icoPhone = (px) => pixSvg(['.kkkkkk.', 'kbbbbbbk', 'kbccccbk', 'kbccccbk', 'kbccccbk', 'kbccccbk', 'kbccccbk', 'kbbbbbbk', 'kbbwwbbk', '.kkkkkk.'], { k: '#0d1a3a', b: '#e8f0ff', c: '#36a2ff', w: '#8aa0c8' }, px);
  const icoArrow = (up) => `<svg viewBox="0 0 24 20" width="34" height="28" aria-hidden="true"><path d="M5 17h14a4.5 4.5 0 0 0 .6-9A6.5 6.5 0 0 0 7 6.5 5 5 0 0 0 5 17z" fill="#fff"/><path d="${up ? 'M12 7l-4 4h2.6v5h2.8v-5H16z' : 'M12 17l4-4h-2.6V8h-2.8v5H8z'}" fill="${up ? '#1c9c3c' : '#1662d8'}"/></svg>`;
  const icoCal = '<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true"><rect x="2" y="4" width="16" height="14" rx="2" fill="none" stroke="#24406e" stroke-width="2"/><path d="M2 8h16M6 2v4M14 2v4" stroke="#24406e" stroke-width="2"/><g fill="#24406e"><rect x="5" y="10" width="2" height="2"/><rect x="9" y="10" width="2" height="2"/><rect x="13" y="10" width="2" height="2"/><rect x="5" y="14" width="2" height="2"/><rect x="9" y="14" width="2" height="2"/></g></svg>';
  const icoMgr = '<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true"><circle cx="10" cy="6" r="4" fill="#24406e"/><path d="M2 19c0-5 3.5-7 8-7s8 2 8 7z" fill="#24406e"/><path d="M8.6 12.5h2.8l-.6 4h-1.6z" fill="#fff"/></svg>';
  const icoClock = '<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="#24406e" stroke-width="2"/><path d="M10 5v5l3.5 2" stroke="#24406e" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  const icoKey = '<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><circle cx="8" cy="9" r="5.5" fill="#f2b51d" stroke="#7a4b00" stroke-width="1.6"/><circle cx="8" cy="9" r="2" fill="#fff6d0" stroke="#7a4b00" stroke-width="1.2"/><path d="M12 12l9 9M17 17l-2 2M19.5 19.5l-2 2" stroke="#7a4b00" stroke-width="2.6" stroke-linecap="round"/><path d="M12 12l9 9" stroke="#f2b51d" stroke-width="1.2" stroke-linecap="round"/></svg>';
  const icoMemo = '<svg viewBox="0 0 16 18" width="18" height="20" aria-hidden="true"><rect x="1" y="1" width="14" height="16" rx="2" fill="#e9e3cf" stroke="#6b6b6b" stroke-width="1.4"/><path d="M4 6h8M4 9h8M4 12h6" stroke="#6b6b6b" stroke-width="1.4"/></svg>';
  const icoCheck = '<svg viewBox="0 0 40 40" width="46" height="46" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#1fa83f" stroke="#0e5a20" stroke-width="2"/><path d="M11 20.5l6 6 12-13" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const icoWarn = '<svg viewBox="0 0 24 22" width="28" height="26" aria-hidden="true"><path d="M12 2L1 21h22z" fill="#ffcf2e" stroke="#2a2a2a" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8v6" stroke="#2a2a2a" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.5" fill="#2a2a2a"/></svg>';
  const csEmb = (i, sz) => `<img class="cs-emb" src="${embFromLook(i && i.emb, 96)}" alt="" style="width:${sz}px;height:${sz}px">`;
  async function openCloud() {
    if (!save) { try { window.__career.open(); } catch (_) {} }
    let scr = $('#cloudScr');
    if (!document.getElementById('cloudCss')) {
      const st = document.createElement('style'); st.id = 'cloudCss';
      st.textContent = `#cloudScr{position:fixed;inset:0;z-index:150;display:flex;align-items:center;justify-content:center;background:rgba(8,20,40,.5);font-family:'M PLUS 1p','Hiragino Sans',sans-serif}
#cloudScr *{box-sizing:border-box}
#cloudScr .cs-box{position:relative;width:880px;height:412px;flex:none;background:#fbf6e4;border:5px solid #13306b;border-radius:22px;box-shadow:0 0 0 4px #fff,0 0 0 7px #13306b,0 10px 30px rgba(0,0,0,.45);padding:6px 18px 6px;color:#13306b;transform-origin:center center}
#cloudScr .cs-hd{display:flex;align-items:center;gap:14px;height:56px}
#cloudScr .cs-hd h1{margin:0;font-size:33px;line-height:1;font-weight:900;letter-spacing:1px;color:#13306b}
#cloudScr .cs-hd p{margin:4px 0 0;font-size:15px;font-weight:700;color:#2b3f6b}
#cloudScr .cs-x{all:unset;cursor:pointer;position:absolute;right:14px;top:8px;width:46px;height:46px;border-radius:50%;background:#13306b;box-shadow:0 0 0 3px #fff,0 0 0 5px #13306b;display:flex;align-items:center;justify-content:center}
#cloudScr .cs-x svg{width:26px;height:26px}
#cloudScr .cs-cols{display:flex;gap:12px;height:238px;margin-top:2px}
#cloudScr .cs-pan{flex:1;border:3px solid #13306b;border-radius:12px;background:#fff;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 0 2px #dfe7f5 inset}
#cloudScr .cs-ph{height:42px;display:flex;align-items:center;gap:10px;padding:0 12px;color:#fff;font-size:21px;font-weight:900;letter-spacing:.5px}
#cloudScr .cs-pan.dev .cs-ph{background:#14275a}#cloudScr .cs-pan.cld .cs-ph{background:#1d6fe0}
#cloudScr .cs-badge{margin-left:auto;font-size:12.5px;font-weight:800;padding:3px 10px;border-radius:99px;white-space:nowrap}
#cloudScr .cs-badge.new{background:#1fa83f;color:#fff;border:1.5px solid #c9f5d2}#cloudScr .cs-badge.ok{background:#9cc8ff;color:#123c86}#cloudScr .cs-badge.none{background:#c9d0dc;color:#4b5563}
#cloudScr .cs-pb{flex:1;padding:6px 14px 0;display:flex;flex-direction:column}
#cloudScr .cs-team{display:flex;align-items:center;gap:12px;height:56px;border-bottom:1.5px solid #dfe5f0}
#cloudScr .cs-emb{image-rendering:pixelated;object-fit:contain;flex:none}
#cloudScr .cs-team b{display:block;font-size:24px;font-weight:900;line-height:1.1;color:#13233f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:290px}
#cloudScr .cs-team small{display:block;font-size:14px;font-weight:700;color:#24406e;margin-top:2px}
#cloudScr .cs-row{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#1d2c4a;height:24px}
#cloudScr .cs-rows{padding:4px 0;border-bottom:1.5px solid #dfe5f0}
#cloudScr .cs-at{font-size:13.5px;font-weight:600;padding-top:2px}
#cloudScr .cs-empty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:#5b6b88;font-weight:700;font-size:15px;line-height:1.6}
#cloudScr .cs-btn{all:unset;cursor:pointer;margin:4px 10px 10px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:12px;color:#fff;font-size:23px;font-weight:900;letter-spacing:1px;border:3px solid #0d1a3a;box-shadow:0 4px 0 #0d1a3a;text-shadow:0 2px 0 rgba(0,0,0,.25)}
#cloudScr .cs-btn.save{background:linear-gradient(#36c157,#1c9c3c)}#cloudScr .cs-btn.load{background:linear-gradient(#3d8cff,#1662d8)}
#cloudScr .cs-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #0d1a3a}
#cloudScr .cs-code{margin-top:8px;height:50px;border:3px solid #d9b860;background:#fff6d6;border-radius:12px;display:flex;align-items:center;gap:12px;padding:0 12px}
#cloudScr .cs-code > b{font-size:20px;font-weight:900;color:#13306b;white-space:nowrap}
#cloudScr .cs-cv{flex:1;height:40px;border:2px solid #b8bfcc;background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;font:900 26px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:2px;color:#13233f}
#cloudScr .cs-cv.none{font:700 15px/1.2 'M PLUS 1p',sans-serif;letter-spacing:0;color:#6b7280}
#cloudScr .cs-mini{all:unset;cursor:pointer;height:40px;padding:0 18px;border:3px solid #13306b;border-radius:10px;background:#fff;font-size:17px;font-weight:900;color:#13306b;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 0 #13306b}
#cloudScr .cs-ft{display:flex;align-items:center;gap:8px;height:32px;margin-top:3px;font-size:14px;font-weight:600;color:#3b4252}
#cloudScr .cs-ft .cs-mini{margin-left:auto;height:30px;font-size:14px;padding:0 20px;border-width:2px;background:#eaf1ff}
#cloudScr .cs-dlg{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:rgba(10,20,45,.45);border-radius:17px}
#cloudScr .cs-db{width:500px;max-height:400px;overflow:auto;background:#fffdf4;border:4px solid #13306b;border-radius:16px;box-shadow:0 0 0 3px #fff,0 8px 20px rgba(0,0,0,.35);padding:12px 18px 14px;text-align:center;color:#13233f}
#cloudScr .cs-dt{display:flex;align-items:center;justify-content:center;gap:12px;font-size:23px;font-weight:900;color:#13306b;margin:2px 0 8px}
#cloudScr .cs-card{display:flex;align-items:center;gap:12px;text-align:left;border:2px solid #dfe5f0;border-radius:10px;padding:6px 12px;background:#fff;margin:6px 0}
#cloudScr .cs-card b{display:block;font-size:20px;font-weight:900;line-height:1.15}#cloudScr .cs-card small{display:block;font-size:13.5px;font-weight:700;color:#24406e}#cloudScr .cs-card i{display:block;font-style:normal;font-size:12px;color:#4b5563}
#cloudScr .cs-cardh{border:2px solid #1d6fe0;border-radius:10px;overflow:hidden;margin:6px 0;text-align:left}
#cloudScr .cs-cardh > span{display:block;background:#1d6fe0;color:#fff;font-size:13.5px;font-weight:800;padding:2px 10px}
#cloudScr .cs-cardh.dev{border-color:#c8ccd4}#cloudScr .cs-cardh.dev > span{background:#dfe2e8;color:#3b4252}
#cloudScr .cs-cardh .cs-card{border:0;margin:0;border-radius:0}
#cloudScr .cs-ow{margin-left:auto;align-self:center;background:#ffd2cf;color:#c21d12;font-size:12.5px;font-weight:800;padding:3px 10px;border-radius:99px;white-space:nowrap}
#cloudScr .cs-warn{display:flex;align-items:center;justify-content:center;gap:8px;background:#fff3c4;border:1.5px solid #f1d27a;border-radius:8px;padding:5px 8px;color:#d1281b;font-size:14.5px;font-weight:800;margin:8px 0}
#cloudScr .cs-txt{font-size:14.5px;font-weight:600;line-height:1.6;margin:6px 0}
#cloudScr .cs-db .cs-code{margin:6px 0;height:52px;padding:0 10px}#cloudScr .cs-db .cs-cv{font-size:24px}
#cloudScr .cs-db input{width:100%;height:50px;border:3px solid #13306b;border-radius:10px;text-align:center;font:900 24px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:2px;text-transform:uppercase;color:#13233f;margin:4px 0}
#cloudScr .cs-dbs{display:flex;gap:12px;justify-content:center;margin-top:10px}
#cloudScr .cs-dbs button{all:unset;cursor:pointer;flex:1;max-width:220px;height:48px;border-radius:12px;border:3px solid #0d1a3a;display:flex;align-items:center;justify-content:center;gap:10px;font-size:20px;font-weight:900;box-shadow:0 3px 0 #0d1a3a}
#cloudScr .cs-dbs .no{background:#fff;color:#13233f}#cloudScr .cs-dbs .g{background:linear-gradient(#36c157,#1c9c3c);color:#fff}#cloudScr .cs-dbs .b{background:linear-gradient(#3d8cff,#1662d8);color:#fff}
#cloudScr .cs-dbs svg{width:30px;height:26px}
#cloudScr .cs-msg{position:absolute;left:50%;bottom:52px;transform:translateX(-50%);background:#13306b;color:#fff;font-size:14px;font-weight:700;padding:6px 16px;border-radius:99px;white-space:nowrap;z-index:4}
#cloudScr .cs-help{text-align:left;font-size:14px;line-height:1.7;margin:4px 0}#cloudScr .cs-help b{color:#1662d8}`;
      document.head.appendChild(st);
    }
    if (!scr) { scr = document.createElement('div'); scr.id = 'cloudScr'; document.body.appendChild(scr); }
    let cloud = null, loading = false, msgTxt = '';
    const code = () => save && save.cloudCode;
    const fit = () => { const b = scr.querySelector('.cs-box'); if (b) b.style.transform = `scale(${Math.min(innerWidth * 0.82 / 900, innerHeight * 0.92 / 430)})`; };
    const panel = (kind, i, at, badge) => `<div class="cs-pan ${kind}"><div class="cs-ph">${kind === 'dev' ? icoPhone(3) : icoCloud(2.4)}<span>${kind === 'dev' ? 'この端末のデータ' : 'クラウドのデータ'}</span>${badge ? `<span class="cs-badge ${badge[0]}">${badge[1]}</span>` : ''}</div>
      <div class="cs-pb">${i ? `<div class="cs-team">${csEmb(i, 50)}<div><b>${esc(i.team)}</b><small>${esc(i.lg)}</small></div></div>
        <div class="cs-rows"><div class="cs-row">${icoCal}<span>${i.season}年目　${i.m}月${i.w}週</span></div><div class="cs-row">${icoMgr}<span>監督　${esc(i.mgr || '—')}</span></div></div>
        <div class="cs-row cs-at">${icoClock}<span>最終更新日時　${clAt(at)}</span></div>`
        : `<div class="cs-empty">${loading ? '読み込み中…' : kind === 'cld' ? 'まだクラウドに<br>保存していません' : 'データがありません'}</div>`}</div>
      <button class="cs-btn ${kind === 'dev' ? 'save' : 'load'}">${icoArrow(kind === 'dev')}<span>${kind === 'dev' ? 'クラウドに保存' : 'クラウドから復元'}</span></button></div>`;
    const draw = () => {
      const dAt = (save && save.savedAt) || 0, cAt = (cloud && cloud.at) || 0;
      const bd = cloud && dAt > cAt + 60000 ? ['new', '新しいデータ'] : null;
      const bc = !cloud ? (loading ? null : ['none', '未保存']) : cAt > dAt + 60000 ? ['new', '新しいデータ'] : ['ok', '保存済み'];
      scr.innerHTML = `<div class="cs-box"><div class="cs-hd">${icoCloud(4.4)}<div><h1>クラウドセーブ</h1><p>大切なクラブデータを保存・引き継ぎ</p></div></div>
        <button class="cs-x" aria-label="閉じる"><svg viewBox="0 0 20 20"><path d="M4 4l12 12M16 4L4 16" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/></svg></button>
        <div class="cs-cols">${panel('dev', save ? cloudInfoOf(save) : null, dAt, bd)}${panel('cld', cloud && cloud.info, cAt, bc)}</div>
        <div class="cs-code">${icoKey}<b>引き継ぎコード</b><div class="cs-cv${code() ? '' : ' none'}">${code() ? fmtCode(code()) : 'クラウドに保存すると、ここにコードが出ます'}</div>${code() ? '<button class="cs-mini cs-copy">コピー</button>' : ''}</div>
        <div class="cs-ft">${icoMemo}<span>新しい端末では、引き継ぎコードを入力して復元できます。</span><button class="cs-mini cs-how">使い方</button></div>
        ${msgTxt ? `<div class="cs-msg">${esc(msgTxt)}</div>` : ''}</div>`;
      fit();
      scr.querySelector('.cs-x').onclick = () => { removeEventListener('resize', fit); scr.remove(); };
      const cp = scr.querySelector('.cs-copy'); if (cp) cp.onclick = () => copyCode();
      scr.querySelector('.cs-btn.save').onclick = doSave; scr.querySelector('.cs-btn.load').onclick = doLoad;
      scr.querySelector('.cs-how').onclick = () => dlg(`<div class="cs-dt">${icoCloud(3)}<span>クラウドセーブの使い方</span></div><div class="cs-help">① 今の端末で <b>「クラウドに保存」</b> を押す<br>② 出てきた <b>引き継ぎコード</b> を、スクリーンショットやメモで残す<br>③ 新しい端末で <b>「クラウドから復元」</b> を押して、コードを入れる<br>・データは1つだけ保存できます（保存するたびに上書き）<br>・通信できる所で使ってください<br>・フレンドIDも新しい端末へ引き継がれます</div>`, [{ label: 'OK', cls: 'b', value: true }]);
    };
    const copyCode = async () => { let ok = false; try { await navigator.clipboard.writeText(fmtCode(code())); ok = true; } catch (_) {} flash(ok ? 'コピーしました' : 'コピーできませんでした。書き写してください'); };
    const flash = (t) => { msgTxt = t; draw(); setTimeout(() => { if (msgTxt === t) { msgTxt = ''; if (document.body.contains(scr) && !scr.querySelector('.cs-dlg')) draw(); } }, 2200); };
    // 確認・お知らせは、この画面の中に出す（版673）
    const dlg = (html, btns) => new Promise((res) => {
      const box = scr.querySelector('.cs-box'), d = document.createElement('div'); d.className = 'cs-dlg';
      d.innerHTML = `<div class="cs-db">${html}<div class="cs-dbs">${btns.map((b, k) => `<button data-k="${k}" class="${b.cls || 'no'}">${b.ico || ''}<span>${esc(b.label)}</span></button>`).join('')}</div></div>`;
      box.appendChild(d); const inp = d.querySelector('input'); if (inp) setTimeout(() => { try { inp.focus(); } catch (_) {} }, 60);
      const cp = d.querySelector('.cs-copy'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(fmtCode(code())); cp.textContent = 'コピー済み'; } catch (_) { cp.textContent = 'できません'; } };
      d.querySelectorAll('.cs-dbs button').forEach((b) => b.onclick = () => { const bt = btns[+b.dataset.k]; d.remove(); res(bt.value == null ? null : inp ? inp.value : bt.value); });
    });
    const NO = { label: 'やめる', value: null };
    const card = (i, extra) => `<div class="cs-card">${csEmb(i, 46)}<div><b>${esc(i ? i.team : '—')}</b><small>${i ? `${i.season}年目 ${i.m}月${i.w}週｜${esc(i.lg)}` : ''}</small>${extra || ''}</div></div>`;
    const err = (t, e) => dlg(`<div class="cs-dt">${icoWarn}<span>${t}</span></div><p class="cs-txt">通信できる所で、もう一度ためしてください。</p>${e ? `<p class="cs-txt" style="font-size:12px;color:#6b7280">${esc(String(e && e.message || e))}</p>` : ''}`, [{ label: 'OK', cls: 'b', value: true }]);
    async function doSave() {
      if (!(window.DotNet && DotNet.on)) return err('通信できません');
      const i = cloudInfoOf(save);
      if (!(await dlg(`<div class="cs-dt">${icoArrow(true).replace('fill="#fff"', 'fill="#d8eeff" stroke="#24406e" stroke-width="1"')}<span>クラウドに保存しますか？</span></div>${card(i)}<p class="cs-txt">この端末のデータをクラウドに保存します。</p>${cloud ? `<div class="cs-warn">${icoWarn}<span>クラウドのデータは上書きされます。</span></div>` : ''}`, [NO, { label: '保存する', cls: 'g', ico: icoArrow(true), value: true }]))) return;
      msgTxt = '保存しています…'; draw();
      try {
        const on = ensureOnline(); if (!on.fid) { try { await publishMe(); } catch (_) {} }
        save.savedAt = Date.now();
        const c = await DotNet.cloudPut(save.cloudCode, save, cloudInfoOf(save), ensureOnline().fid || null);
        save.cloudCode = c; store(); try { publishMe(); } catch (_) {}
        cloud = { info: cloudInfoOf(save), at: save.savedAt }; msgTxt = ''; draw();
        await dlg(`<div class="cs-dt">${icoCheck}<span>クラウドに保存しました</span></div><div class="cs-code" style="flex-direction:column;align-items:stretch;height:auto;padding:4px 10px 8px;gap:2px"><b style="font-size:14px;text-align:left">引き継ぎコード</b><div style="display:flex;gap:10px;align-items:center"><div class="cs-cv">${fmtCode(c)}</div><button class="cs-mini cs-copy">コピー</button></div></div><p class="cs-txt">新しい端末で、このコードを入力してください。<br>スクリーンショットやメモで大切に保管してください。</p>`, [{ label: 'OK', cls: 'b', value: true }]);
      } catch (e) { msgTxt = ''; draw(); err('保存できませんでした', e); }
    }
    async function doLoad() {
      if (!(window.DotNet && DotNet.on)) return err('通信できません');
      const inp = await dlg(`<div class="cs-dt">${icoCloud(3)}<span>クラウドから復元</span></div><p class="cs-txt">引き継ぎコード（12文字）を入れてください</p><input maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" value="${code() ? fmtCode(code()) : ''}">`, [NO, { label: '次へ', cls: 'b', value: true }]);
      if (inp == null) return;
      const c = DotNet.normCode(inp); if (c.length !== 12) return dlg(`<div class="cs-dt">${icoWarn}<span>コードがちがいます</span></div><p class="cs-txt">引き継ぎコードは12文字です（ハイフンは入れなくてもOK）。</p>`, [{ label: 'OK', cls: 'b', value: true }]);
      msgTxt = 'クラウドのデータを読んでいます…'; draw();
      let got = null; try { got = await DotNet.cloudGet(c); } catch (e) { msgTxt = ''; draw(); return err('通信できませんでした', e); }
      msgTxt = ''; draw();
      if (!got || !got.save) return dlg(`<div class="cs-dt">${icoWarn}<span>見つかりませんでした</span></div><p class="cs-txt">この引き継ぎコードのデータはありません。<br>コードをもう一度確かめてください。</p>`, [{ label: 'OK', cls: 'b', value: true }]);
      const gi = got.info || cloudInfoOf(got.save), di = save ? cloudInfoOf(save) : null;
      if (!(await dlg(`<div class="cs-dt">${icoArrow(false).replace('fill="#fff"', 'fill="#d8eeff" stroke="#24406e" stroke-width="1"')}<span>このデータで復元しますか？</span></div>
        <div class="cs-cardh"><span>復元するデータ</span>${card(gi, `<i>保存日時：${clAt(got.at)}</i>`)}</div>
        <div class="cs-cardh dev"><span>この端末のデータ</span><div class="cs-card">${csEmb(di, 40)}<div><b style="font-size:18px">${esc(di ? di.team : 'なし')}</b><small>${di ? `${di.season}年目 ${di.m}月${di.w}週` : ''}</small></div>${di ? '<span class="cs-ow">上書き対象</span>' : ''}</div></div>
        <div class="cs-warn">${icoWarn}<span>この端末のデータは上書きされ、元に戻せません。</span></div>`, [NO, { label: '復元する', cls: 'b', ico: icoArrow(false), value: true }]))) return;
      try {
        const sv = got.save; sv.cloudCode = c; sv.savedAt = Date.now();
        localStorage.setItem(KEY, JSON.stringify(sv));
        try { await DotNet.cloudClaim(c, (sv.online && sv.online.fid) || got.fid || null); } catch (_) {}
        await dlg(`<div class="cs-dt"><span style="color:#f2b51d;font-size:22px">✦</span>${icoCheck}<span>復元しました</span></div>${card(gi)}<p class="cs-txt">復元したデータでゲームを再開します。</p>`, [{ label: 'ゲームへ戻る', cls: 'b', value: true }]);
        location.reload();
      } catch (e) { err('復元できませんでした', e); }
    }
    addEventListener('resize', fit);
    loading = !!(code() && window.DotNet && DotNet.on);
    draw();
    if (loading) { try { const r = await DotNet.cloudInfo(code()); cloud = r ? { info: r.info, at: r.at } : null; } catch (_) { flash('通信できませんでした（クラウドの情報が読めません）'); } loading = false; if (document.body.contains(scr) && !scr.querySelector('.cs-dlg')) draw(); }
  }
  window.__career = { playerDetail: (i, o) => playerDetail(i, o), resCard: (o) => resCard(o), seasonEndCard: (o) => seasonEndCard(o), coachNews: (l) => coachNews(l), rewardCard: (r) => rewardCard(r), gachaDemo: (st, pr, fx) => gachaDemo(st, pr, fx), storyCard: (o) => storyCard(o), gotCardsHTML: (got) => `<div class="gc-cards${got.length > 8 ? ' lots' : got.length > 4 ? ' many' : ''}">${got.map((c) => artCard(c, { ups: true })).join('')}</div><p class="cp-msg gc-msg">クラブハウスの「特訓」で、選手に最大3枚セットできます。</p>`, trainResult: (o) => trainResult(o), airport, openPost, syncPost, onlineDone, setVenue: (k) => { venueNow = k; }, champDemo, champAfter, coinShop, faceFill: () => faceFill(), openGacha, venueTalk: (se) => venueTalk(se), matchFace, openOffice, cpuCard, openClub, openAssoc, open, go, stadium, advance, subSheet, labMatch, townRect, tutPractice, shop, store: () => store(), renderHome: () => renderHome(), clubhouseBg: () => clubhouseBg(), isMatchWeek: () => isMatchWeek(), get view() { return view; }, staffFace: (k) => staffFace(k), get save() { return save; }, get drill() { return clubDrill; }, faceURL, starFace, setDrill(d) { clubDrill = d; drillT0 = -1; drillSnap = true; } };
  window.__career.openCloud = openCloud;
  window.__career.shop = (t) => shop(t); window.__career.premDaily = () => premDaily();
  window.__career.embURL = () => { try { return save ? embFromLook(C.ensureClub(save).emb, 96) : ''; } catch (_) { return ''; } };   // 版680：設定のアカウントIDの横に出す、自分のクラブのエンブレム
  window.__career.myFid = async () => { if (!save) return null; const on = ensureOnline(); if (on.fid && !(window.DotNet && DotNet.FID_MOVE && DotNet.FID_MOVE[on.fid])) return on.fid; return (await publishMe()) || on.fid; };   // 版678：アカウントID（なければ作る）
})();

// ===== 画面の器：論理サイズで組んで、端末に合わせて拡大縮小（PC・スマホ横画面共通） =====
(function () {
  const $ = (q) => document.querySelector(q);
  const html = document.documentElement, app = $('#app');
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (touch) html.classList.add('touch');
  // 版656：iPhoneでボタンを押しても反応しないことがあった
  //  原因：タップ中に指が少し（10ドットほど）動くと、iPhoneが「スクロールしようとした」と見なして、押した合図（click）を出さない
  //  対策：指の動きが小さく（28ドット以内）、画面がスクロールしていなくて、合図が出なかった時は、こちらで押したことにする
  if (touch) {
    let ts = null;
    const NO = '.sq2,.s2board,.s2p,.s2sc,.dg-track,.lk-zl,input,select,textarea,#pitch,.sb2-box';
    addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { ts = null; return; } const t = e.touches[0]; ts = { x: t.clientX, y: t.clientY, tg: e.target, at: Date.now(), clicked: false, scrolled: false, max: 0 }; }, { passive: true, capture: true });
    addEventListener('touchmove', (e) => { if (!ts || e.touches.length !== 1) return; const t = e.touches[0]; ts.max = Math.max(ts.max, Math.hypot(t.clientX - ts.x, t.clientY - ts.y)); }, { passive: true, capture: true });
    addEventListener('scroll', () => { if (ts) ts.scrolled = true; }, { passive: true, capture: true });
    addEventListener('click', () => { if (ts) ts.clicked = true; }, true);
    addEventListener('touchend', (e) => {
      const s = ts; ts = null; if (!s || s.scrolled || s.max > 28 || Date.now() - s.at > 900) return;
      const t = e.changedTouches[0]; if (!t || !(s.tg instanceof Element) || s.tg.closest(NO)) return;
      ts = s; setTimeout(() => { if (ts === s) ts = null; if (s.clicked || s.scrolled || !s.tg.isConnected) return;
        const el = document.elementFromPoint(t.clientX, t.clientY); if (!el || !(el === s.tg || s.tg.contains(el) || el.contains(s.tg))) return;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY, view: window })); }, 350);
    }, { passive: true, capture: true });
  }
  html.classList.add('stage');
  // 端の切り欠き（iPhoneのノッチ）ぶんを避ける
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  // スマホのアプリの中（Claudeの画面の中）で開くと、画面の上の帯がアプリのボタンに重なってさわれない：
  // その分だけ上を空けて、ゲームを下にずらす（メニューで切り替え可）
  const inFrame = (() => { try { return window.self !== window.top; } catch (_) { return true; } })();
  let topGap = 0;
  try { const v = localStorage.getItem('dotTopGap'); topGap = v == null ? (touch && inFrame ? 1 : 0) : +v; } catch (_) { topGap = touch && inFrame ? 1 : 0; }
  function fit() {
    const vv = window.visualViewport;
    const standalone = !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches));
    const vw = Math.round(vv ? vv.width : innerWidth), vh = Math.round(standalone ? Math.max(innerHeight, vv ? vv.height : 0, document.documentElement.clientHeight || 0) : (vv ? vv.height : innerHeight));   // 版484：ホーム画面アプリでは、iPhoneが高さを小さく返すことがある（下が白く空く）ので大きい方を使う
    const portrait = touch && vh > vw;
    html.classList.toggle('portrait', portrait);
    if (portrait) return;
    const cs = getComputedStyle(probe);
    const sl = parseFloat(cs.paddingLeft) || 0, sr = parseFloat(cs.paddingRight) || 0, sb = parseFloat(cs.paddingBottom) || 0, st = parseFloat(cs.paddingTop) || 0;
    const tg = document.fullscreenElement ? 0 : topGap ? Math.max(st, 52) : 0;   // 上を空ける分（全画面の時は空けない）
    const aw = vw - sl - sr, ah = vh - tg;   // 版495：上下には余白を作らない（緑の帯は左右だけ）
    const small = Math.min(vw, vh) <= 600;
    // スマホは高さ520相当、PCは720相当で組む（PCは大きな画面でも1.35倍まで）
    let s = small ? Math.min(ah / 520, aw / 960) : Math.min(ah / 720, aw / 1100, 1.35);
    s = Math.max(0.3, s);
    // 横に長すぎる画面（ブラウザのバーで高さが減ったときなど）は、本家のように左右に帯を出して、絵が切れないようにする
    const lh = ah / s, lw = Math.min(aw / s, lh * 2.0);
    app.style.width = lw + 'px'; app.style.height = lh + 'px';
    app.style.left = (sl + (aw - lw * s) / 2) + 'px'; app.style.top = tg + 'px'; app.style.transform = `scale(${s})`;
    html.style.setProperty('--lh', lh + 'px');
    html.classList.toggle('short', lh < 640);
    html.classList.toggle('phone', touch && Math.min(screen.width || 9999, screen.height || 9999) <= 540);   // 版487：スマホ（画面の短い辺が540以下）
  }
  let raf = 0;
  let synth = false;
  const refit = () => { if (synth) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { fit(); window.dispatchEvent(new Event('stagefit')); }); };
  fit();
  [200, 700, 1500].forEach((ms) => setTimeout(refit, ms)); addEventListener('pageshow', refit);   // 版484：起動直後に高さが変わることがあるので、少しあとにも合わせ直す
  addEventListener('resize', refit); addEventListener('orientationchange', () => setTimeout(refit, 250));
  if (window.visualViewport) visualViewport.addEventListener('resize', refit);
  // 試合画面のキャンバスは器の大きさが変わったら描き直す
  addEventListener('stagefit', () => { synth = true; window.dispatchEvent(new Event('resize')); synth = false; });
  // ヘッダーの代わりの「メニュー」
  const sheet = $('#mSheet');
  const fsOk = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  if (!fsOk) $('#mFull').hidden = true;
  if (!inFrame && $('#mTab')) $('#mTab').hidden = true;
  window.__openMenu = () => $('#mMenu').onclick();
  const sndLabel = () => { const P = window.DotSound ? DotSound.pref : { sfx: true, bgm: true }; for (const [id, on] of [['#mSfx', P.sfx], ['#mBgm', P.bgm]]) { const b = $(id); if (!b) continue; b.classList.toggle('on', !!on); const em = b.querySelector('.st-sw em'); if (em) em.textContent = on ? 'ON' : 'OFF'; } };   // 版679：スイッチの見た目
  // 版678：アカウントID（＝フレンドID・8けた）を設定に出す。テスト用のボタンは、開発用のアカウントだけに出す
  const DEV_IDS = ['11111111', '99995139', '84539075'];   // ここに開発用のアカウントID（8けた）を入れる
  let acctFid = null;
  const acctShow = (fid) => { acctFid = fid || null; const dev = !!(fid && DEV_IDS.includes(String(fid))); const b = $('#mAcct .st-id'); if (b) b.textContent = fid ? String(fid).replace(/(\d{4})(\d{4})/, '$1 $2') : '―'; const sm = $('#mAcct .st-dev'); if (sm) sm.hidden = !dev; const dv = $('#mDev'); if (dv) dv.hidden = !dev; stFit(); };
  const stFit = () => { const bx = document.querySelector('#mSheet .st-box'); if (!bx || $('#mSheet').hidden) return; const h = bx.offsetHeight || 420; bx.style.transform = `translate(-50%,-50%) scale(${Math.min(1.4, innerWidth * 0.84 / 760, innerHeight * 0.94 / h)})`; };
  addEventListener('resize', stFit);
  window.__devIds = DEV_IDS;
  const acctRefresh = async () => { { const im = document.querySelector('#mAcct .st-emb'), u = window.__career && window.__career.embURL && window.__career.embURL(); if (im) { if (u) { im.src = u; im.hidden = false; } else im.hidden = true; } } const sv = window.__career && window.__career.save; let fid = sv && sv.online && sv.online.fid; acctShow(fid); if ((!fid || (window.DotNet && DotNet.FID_MOVE && DotNet.FID_MOVE[fid])) && window.__career && window.__career.myFid) { try { fid = await window.__career.myFid(); } catch (_) {} acctShow(fid); } };
  $('#mMenu').onclick = () => { setTimeout(stFit, 0); acctRefresh(); sndLabel(); $('#mFull').textContent = document.fullscreenElement ? '全画面をやめる' : '全画面にする'; if ($('#mGap')) $('#mGap').textContent = topGap ? '画面の上を空けない（上までゲームを広げる）' : '画面の上を空ける（上がさわれない時）'; sheet.hidden = false; };
  addEventListener('fullscreenchange', refit); addEventListener('webkitfullscreenchange', refit);
  sheet.addEventListener('click', async (e) => {
    const tb = e.target.closest ? e.target.closest('[data-m]') : null, m = tb && tb.dataset.m;   // 版679：ボタンの中の絵や文字を押しても効くように
    if (e.target === sheet) { sheet.hidden = true; return; }
    if (!m) return;
    if (m === 'copyid') { if (acctFid) { try { await navigator.clipboard.writeText(String(acctFid)); tb.textContent = 'コピーした'; tb.classList.add('ok'); setTimeout(() => { tb.textContent = 'コピー'; tb.classList.remove('ok'); }, 1500); } catch (_) { tb.textContent = 'できません'; } } return; }
    sheet.hidden = true;
    if (m === 'career') window.__career.open();
    else if (m === 'cloud') { window.__career.openCloud(); return; }
    else if (m === 'free') $('#newGame').click();
    else if (m === 'champdemo') { sheet.hidden = true; if (!window.__career.save) window.__career.open(); setTimeout(() => { window.__career.champDemo(); }, 300); return; }   // 版581：（テスト用）
    else if (m === 'testkk') { const sv = window.__career.save; sv.kakera = (sv.kakera || 0) + 1000; window.__career.store(); sheet.hidden = true; try { window.__career.renderHome(); } catch (_) {} return; }
    else if (m === 'testcoin') { const sv = window.__career.save; sv.coins = (sv.coins || 0) + 10000; window.__career.store(); sheet.hidden = true; try { window.__career.renderHome(); } catch (_) {} return; }   // 版552：演出のテスト用
    else if (m === 'tut') { if (window.__tut) { const of = $('#officeScreen'); if (of) { of.hidden = true; try { window.__career.go('home'); } catch (_) {} } if ($('#career').hidden) window.__career.open(); setTimeout(() => window.__tut.replay(), 300); } }
    else if (m === 'sfx' || m === 'bgm') { if (window.DotSound) DotSound.set(m, !DotSound.pref[m]); sndLabel(); sheet.hidden = false; return; }
    else if (m === 'gap') { topGap = topGap ? 0 : 1; try { localStorage.setItem('dotTopGap', String(topGap)); } catch (_) {} refit(); }
    else if (m === 'tab') { try { window.open(location.href, '_blank'); } catch (_) {} }
    else if (m === 'fs') {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else { const el = document.documentElement; await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen());
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }
      } catch (_) { /* 使えない端末では何もしない */ }
    }
  });
  // 試合中はメニューを隠す（結果画面や育成で出す）
  // メニューはホーム・フリー試合の設定・結果画面だけに出す（試合中やクラブハウスの中では出さない）
  const mm = $('#mMenu'), mt = $('#match'), club = $('#cv-club'), car = $('#career');
  const upd = () => { mm.hidden = true; };   /* 版470：右上のメニューはなし（クラブ事務所の「設定」から） */
  const mo = new MutationObserver(upd);
  for (const el of [mt, club, car]) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  // 開いたらいきなり育成ホーム
  window.__career.open(); upd();
})();
