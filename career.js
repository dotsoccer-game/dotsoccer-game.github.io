// ドットサッカー 育成・シーズン（特訓／全体練習／スキル枠／リーグ戦）
// 画面（app.js）と試合エンジン（engine/engine.js）の間で、セーブデータを進める。
(function (root) {
  'use strict';
  const D = root.DotSoccer;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const KEYS = D.PARAM_KEYS;
  const PNAME = Object.fromEntries(D.PARAMS.map((p) => [p.k, p.name]));

  // ---------- 乱数（セーブデータに種を持たせて再現できるように） ----------
  function rng(save) {
    return () => { save.rs = (Math.imul(save.rs, 1664525) + 1013904223) >>> 0; let x = save.rs; x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b) >>> 0; x ^= x >>> 16; return (x >>> 0) / 4294967296; };   // 下位ビットの偏りを混ぜて消す
  }

  // ---------- 通常メニュー ----------
  // main：大きく上がる / sub：少し上がる / hid：裏パラ（動きの傾向）/ fat：疲れ
  const MENUS = {
    dash: { name: 'ダッシュ', main: ['speed', 'dash'], sub: ['stamina'], hid: { run_space: 3 }, fat: 15 },
    run: { name: '持久走', main: ['stamina'], sub: ['mental'], hid: { overlap: 3 }, fat: 22 },
    muscle: { name: '筋トレ', main: ['physical'], sub: ['jump'], hid: { press: 3 }, fat: 15 },
    jump: { name: 'ジャンプ', main: ['jump'], sub: ['physical'], hid: { goal_wait: 2 }, fat: 15 },
    shoot: { name: 'シュート', main: ['kick'], sub: ['technique'], hid: { goal_wait: 3 }, fat: 12 },
    dribble: { name: 'ドリブル', main: ['dribble'], sub: ['technique', 'speed'], hid: { run_space: 2 }, fat: 12 },
    pass: { name: 'パス回し', main: ['pass'], sub: ['vision'], hid: { support: 3 }, fat: 8 },
    duel: { name: '1対1守備', main: ['defense'], sub: ['physical'], hid: { zone_man: 5, press: 2 }, fat: 14 },
    line: { name: 'ライン練習', main: ['defense'], sub: ['vision'], hid: { zone_man: -5 }, fat: 8 },
    mini: { name: 'ミニゲーム', main: [], sub: ['vision', 'technique', 'stamina'], all: 0.4, hid: { support: 1, overlap: 1 }, fat: 14 },
    meeting: { name: 'ミーティング', main: ['mental'], sub: ['vision'], hid: {}, fat: -5 },
    rest: { name: '休養', main: [], sub: [], hid: {}, fat: -35, cond: 1 },
    // GK
    gkCatch: { name: 'キャッチング', main: ['technique'], sub: ['mental'], hid: {}, fat: 10, gk: true },
    gkSave: { name: 'セービング', main: ['jump', 'vision'], sub: ['dash'], hid: {}, fat: 14, gk: true },
    gkHigh: { name: 'ハイボール', main: ['jump'], sub: ['physical', 'vision'], hid: {}, fat: 12, gk: true },
    gkFeed: { name: 'フィード', main: ['kick'], sub: ['pass'], hid: {}, fat: 8, gk: true },
  };
  // ---------- スペシャルメニュー（能力・タイプ） ----------
  const SPECIAL = {
    hard: { name: '猛特訓', all: 1.2, fat: 30 },
    power: { name: '筋力強化', up: { physical: 5, jump: 3 }, fat: 28 },
    sprint: { name: 'スプリント強化', up: { speed: 4, dash: 4 }, fat: 26 },
    power_shot: { name: 'シュート強化', up: { kick: 5, technique: 1 }, fat: 24 },
    tech: { name: 'テクニック強化', up: { technique: 4, dribble: 2 }, fat: 22 },
    defend: { name: '守備強化', up: { defense: 5, physical: 1 }, fat: 24 },
    eye: { name: '戦術眼トレーニング', up: { vision: 4, mental: 1 }, fat: 18 },
    mind: { name: '精神修行', up: { mental: 5 }, fat: 18 },
    massage: { name: 'マッサージ', up: {}, fat: -60, cond: 1 },
    // タイプ転向：裏パラを狙ったタイプへ大きく動かす
    toStriker: { name: 'ストライカー養成', type: 'ストライカー', fat: 20, pos: 'FW' },
    toAttacker: { name: 'アタッカー養成', type: 'アタッカー', fat: 20, pos: 'FW' },
    toRegista: { name: 'レジスタ養成', type: 'レジスタ', fat: 20, pos: 'MF' },
    toDynamo: { name: 'ダイナモ養成', type: 'ダイナモ', fat: 20, pos: 'MF' },
    toMaker: { name: 'ゲームメイカー養成', type: 'ゲームメイカー', fat: 20, pos: 'MF' },
    toSweeper: { name: 'スイーパー養成', type: 'スイーパー', fat: 20, pos: 'DF' },
    toStopper: { name: 'ストッパー養成', type: 'ストッパー', fat: 20, pos: 'DF' },
    toMarker: { name: 'マンマーカー養成', type: 'マンマーカー', fat: 20, pos: 'DF' },
    // コンバート（ポジション変更）
    toFW: { name: 'FWへコンバート', convert: 'FW', fat: 10 },
    toMF: { name: 'MFへコンバート', convert: 'MF', fat: 10 },
    toDF: { name: 'DFへコンバート', convert: 'DF', fat: 10 },
  };
  // ---------- スキルのスペシャルメニュー：覚えやすさに効く能力 ----------
  const GROUP_PARAMS = { dribble: ['dribble', 'technique'], shot: ['kick', 'technique'], pass: ['pass', 'vision'], set: ['kick', 'mental'], def: ['defense', 'vision'], gk: ['vision', 'jump', 'technique'], offball: ['vision', 'dash'], mental: ['mental'] };
  const SKILL_PARAMS = {
    knuckle: ['kick', 'technique'], curve: ['kick', 'technique'], fk: ['kick', 'technique'], slide: ['defense', 'physical'],
    speedDribble: ['speed', 'dribble'], cutIn: ['dribble', 'dash'], aerial: ['jump', 'physical'], volley: ['kick', 'technique'],
    bicycle: ['jump', 'technique'], divingHeader: ['jump', 'dash'], longThrow: ['physical'], shoulder: ['physical', 'defense'],
    pressMonster: ['stamina', 'defense'], recovery: ['stamina', 'speed'], overlap: ['stamina', 'dash'], behindRun: ['speed', 'vision'],
    postPlay: ['physical', 'technique'], ironMan: ['stamina', 'physical'], lateGrit: ['stamina', 'mental'], captaincy: ['mental', 'vision'],
  };
  const skillParams = (k) => SKILL_PARAMS[k] || GROUP_PARAMS[(D.SKILLS[k] || {}).group] || ['technique'];
  // 前提スキル（これを覚えていないと特訓できない）
  const SKILL_REQ = { elastico: 'scissors', roulette: 'doubleTouch', bicycle: 'volley', loftedThrough: 'throughPass', pinpointCross: 'earlyCross', oneTwo: 'wallPass' };
  const SKILL_LIST = Object.keys(D.SKILLS).filter((k) => k !== 'feint');
  const isGKSkill = (k) => (D.SKILLS[k] || {}).group === 'gk';

  function skillChance(team, p, k) {
    const ps = skillParams(k);
    const avg = ps.reduce((a, q) => a + p[q], 0) / ps.length;
    let c = 0.1 + (avg - 50) * 0.008;
    if ((D.SKILLS[k] || {}).group === 'mental') c -= 0.04;
    if (team.players.some((m) => m !== p && (m.skills || []).includes(k))) c += 0.1;   // 先輩がいると覚えやすい
    return clamp(c, 0.04, 0.65);
  }
  // 版938：スキル枠は2種類（設計一覧25章）。「技」（ドリブル・シュート・パス・守備・GKなど）と「特性」（メンタル・動き・セットプレー）
  //  技：2枠から。能力の平均（育成ポイント）が上がるごとに増え、平均82（D1くらい）で8枠、90で9枠、99（S満タン）で10枠
  //  特性：1枠から。平均67で2枠、82で3枠
  const SLOT_MAX = 10, TRAIT_MAX = 3;
  const TRAIT_GROUPS = new Set(['mental', 'offball', 'set']);
  const skKind = (k) => (k === 'fk' || TRAIT_GROUPS.has((D.SKILLS[k] || {}).group) ? 'trait' : 'tech');
  const TECH_AT = [237, 375, 512, 649, 787, 924, 1106, 1280];   // 3〜10枠目に必要な平均ポイント（924≒能力82、1106≒90、1280＝S満タン）
  const TRAIT_AT = [471, 924];                                   // 2・3枠目（471≒能力67）
  function slotInfo(p) {
    ensurePts(p);
    const avg = KEYS.reduce((a, k) => a + p.pts[k], 0) / KEYS.length;
    const tech = 2 + TECH_AT.filter((v) => avg >= v - 1e-9).length, trait = 1 + TRAIT_AT.filter((v) => avg >= v - 1e-9).length;
    const nextTech = TECH_AT.find((v) => avg < v - 1e-9) ?? null, nextTrait = TRAIT_AT.find((v) => avg < v - 1e-9) ?? null;
    return { techAt: TECH_AT, traitAt: TRAIT_AT, techMax: SLOT_MAX, traitMax: TRAIT_MAX, total: tech + trait, tech, trait, ability: tech + trait, exp: 0, avg, nextAvg: nextTech, nextTech, nextTrait, nextGames: null };
  }
  function slotsOf(p, kind) { const si = slotInfo(p); return kind === 'trait' ? si.trait : si.tech; }
  function skillsOf(p, kind) { return (p.skills || []).filter((k) => skKind(k) === kind); }
  function slots(p) { return slotInfo(p).total; }
  function avgParam(p) { return KEYS.reduce((a, k) => a + p[k], 0) / KEYS.length; }

  // 選べるメニュー（選手ごと）
  function menusFor(team, p) {
    const gk = p.position === 'GK';
    const normal = Object.entries(MENUS).filter(([, m]) => !m.gk || gk).map(([k, m]) => ({ id: 'n:' + k, name: m.name }));
    const special = Object.entries(SPECIAL).filter(([, m]) => !(gk && (m.type || m.convert)) && !(m.pos && m.pos !== p.position) && !(m.convert && m.convert === p.position)).map(([k, m]) => ({ id: 's:' + k, name: m.name }));
    const skills = SKILL_LIST.filter((k) => (gk ? isGKSkill(k) : !isGKSkill(k)) && !(p.skills || []).includes(k) && (!SKILL_REQ[k] || (p.skills || []).includes(SKILL_REQ[k])))
      .map((k) => ({ id: 'k:' + k, name: D.SKILLS[k].name + '特訓', pct: Math.round(skillChance(team, p, k) * 100) }));
    return { normal, special, skills };
  }

  // ---------- 能力の伸び ----------
  // 低い能力ほど伸びやすく、高くなるほど伸びにくい。疲れていると伸びが落ちる
  function grow(p, k, base, r, out) {
    const v = p[k];
    let g = base * 0.5 * clamp((100 - v) / 50, 0.1, 1.1) * (0.75 + r() * 0.5);   // 1シーズンで主な能力が+8〜12くらい
    g *= p.fatigue > 70 ? 0.5 : p.fatigue > 50 ? 0.8 : 1;
    g *= 1 + (p.cond || 0) * 0.1;
    const nv = clamp(v + g, 1, 99);
    p[k] = Math.round(nv * 10) / 10;
    if (g > 0.05) out.ups[k] = (out.ups[k] || 0) + g;
  }
  // タイプの変わりやすさ（hid：カードで動きのくせが動く量、spPull：タイプ養成SPで近づく割合）
  const TYPE_TUNE = { hid: 0.45, spPull: 0.22 };   // 2枚組み合わせで平均10回ほど、タイプ養成SPは2〜3回でタイプが変わる
  function moveHidden(p, hid, mul) {
    if (p.uniq) return;   // 版677：国内屈指級（固有スキルを持つ選手）は、動き方のくせ（裏パラ）もタイプも変わらない
    for (const k in hid) p[k] = k === 'zone_man' ? clamp(p[k] + hid[k] * mul, -90, 95) : clamp(p[k] + hid[k] * mul, 0, 100);
  }
  // 裏パラから選手タイプを決める（ポジションごとに一番近いタイプ）
  const TYPES_BY_POS = { DF: ['スイーパー', 'ストッパー', 'マンマーカー', 'ラインコントローラー', 'ビルドアップ型'], MF: ['レジスタ', 'ダイナモ', 'ゲームメイカー', 'パサー', 'ファンタジスタ', 'シャドー', 'アンカー'], FW: ['ストライカー', 'アタッカー', '偽9番', 'デコイラン'], GK: ['ゴールキーパー', 'スイーパーキーパー'] };
  const HKEYS = ['zone_man', 'press', 'support', 'overlap', 'run_space', 'goal_wait'];
  function protoOf(t) { return { ...D.HIDDEN0, ...(D.TYPE_HIDDEN[t] || {}) }; }
  function decideType(p) {
    if (p.uniq) return p.type || (D.UNIQ[p.uniq] && D.UNIQ[p.uniq].type) || 'バランス';   // 版677：国内屈指級はタイプが変わらない
    const list = TYPES_BY_POS[p.position] || [];
    if (p.position === 'GK') {   // GK：飛び出す癖（run_space）が強ければスイーパーキーパー
      const dd = (t) => { const pr = protoOf(t); return ['run_space', 'goal_wait'].reduce((a, k) => a + (p[k] - pr[k]) ** 2, 0); };
      return dd('スイーパーキーパー') < dd('ゴールキーパー') * 0.6 ? 'スイーパーキーパー' : 'ゴールキーパー';
    }
    let best = 'バランス', bd = 1e9;
    for (const t of list) {
      const pr = protoOf(t);
      const d = HKEYS.reduce((a, k) => a + ((p[k] - pr[k]) / (k === 'zone_man' ? 2 : 1)) ** 2, 0);
      if (d < bd) { bd = d; best = t; }
    }
    // どのタイプにも寄っていなければバランス
    const b0 = HKEYS.reduce((a, k) => a + ((p[k] - D.HIDDEN0[k]) / (k === 'zone_man' ? 2 : 1)) ** 2, 0);
    return b0 < bd * 0.8 ? 'バランス' : best;
  }

  // ---------- 1週間の練習 ----------
  // plan: { team: 'base'|'phys'|'tactic'|'scrim'|'rest', each: { playerIndex: menuId } }
  const TEAM_MENUS = {
    base: { name: '基礎練習', all: 0.35, fat: 6 },
    phys: { name: 'フィジカル練習', up: { stamina: 0.8, physical: 0.6, speed: 0.4 }, fat: 10 },
    tactic: { name: '戦術練習', up: { vision: 0.8, defense: 0.4 }, fat: 4 },
    scrim: { name: '紅白戦', up: { vision: 0.6, technique: 0.4, mental: 0.3 }, fat: 10 },
    rest: { name: '全体休養', fat: -15 },
  };
  function train(save, plan) {
    const r = rng(save), team = save.team, report = [];
    const tm = TEAM_MENUS[plan.team] || TEAM_MENUS.base;
    team.players.forEach((p, i) => {
      const out = { i, name: p.name, menu: '', ups: {}, learned: null, failed: null, typeFrom: p.type, typeTo: null, injured: false, fatigueBefore: p.fatigue };
      if (p.injury > 0) { p.injury--; out.menu = 'ケガで休み'; p.fatigue = clamp(p.fatigue - 25, 0, 100); report.push(out); return; }
      // 全体練習
      if (tm.all) for (const k of KEYS) grow(p, k, tm.all, r, out);
      if (tm.up) for (const k in tm.up) grow(p, k, tm.up[k], r, out);
      let fat = tm.fat;
      // 個別の特訓
      const id = (plan.each && plan.each[i]) || (p.position === 'GK' ? 'n:gkSave' : 'n:mini');
      const [kind, key] = id.split(':');
      if (kind === 'n' && MENUS[key]) {
        const m = MENUS[key]; out.menu = m.name;
        for (const k of m.main) grow(p, k, 2.6, r, out);
        for (const k of m.sub) grow(p, k, 1.1, r, out);
        if (m.all) for (const k of KEYS) grow(p, k, m.all, r, out);
        moveHidden(p, m.hid, 1); fat += m.fat; if (m.cond) p.cond = clamp((p.cond || 0) + m.cond, -2, 2);
      } else if (kind === 's' && SPECIAL[key]) {
        const m = SPECIAL[key]; out.menu = m.name;
        if (m.all) for (const k of KEYS) grow(p, k, m.all, r, out);
        if (m.up) for (const k in m.up) grow(p, k, m.up[k], r, out);
        if (m.type) { const pr = protoOf(m.type); for (const k of HKEYS) p[k] += (pr[k] - p[k]) * 0.35; }
        if (m.convert) { out.convert = [p.position, m.convert]; p.position = m.convert; }
        fat += m.fat; if (m.cond) p.cond = clamp((p.cond || 0) + m.cond, -2, 2);
      } else if (kind === 'k' && D.SKILLS[key]) {
        out.menu = D.SKILLS[key].name + '特訓';
        const c = skillChance(team, p, key);
        if (r() < c * (p.fatigue > 70 ? 0.6 : 1)) out.learned = key;
        else { out.failed = key; for (const k of skillParams(key)) grow(p, k, 0.9, r, out); }
        fat += 14;
      }
      p.fatigue = clamp(p.fatigue + fat - 26, 0, 100);   // 週の自然回復を差し引く
      // 疲れすぎていると、ケガをすることがある
      if (p.fatigue > 75 && r() < (p.fatigue - 70) * 0.006 * injMul(p)) { p.injury = 1 + Math.floor(r() * 3); out.injured = true; }
      condTick(p, r);
      const nt = decideType(p); if (nt !== p.type) { out.typeTo = nt; p.type = nt; }
      report.push(out);
    });
    return report;
  }
  // スキル習得：枠が空いていれば入る。いっぱいなら忘れるスキルを選んでもらう
  function learnSkill(p, k, forget) {
    p.skills = p.skills || [];
    if (p.skills.includes(k)) return true;
    const kind = skKind(k);
    if (skillsOf(p, kind).length < slotsOf(p, kind)) { p.skills.push(k); return true; }
    if (forget && p.skills.includes(forget) && skKind(forget) === kind) { p.skills = p.skills.filter((s) => s !== forget); p.skills.push(k); return true; }
    return false;
  }

  // ---------- リーグ（7リーグ・66チーム）----------
  // 地域2部（東・西 各6）→ 地域1部（東・西 各8）→ D3（12）→ D2（14）→ D1（12）
  const LEAGUES = [
    { id: 'regE2', name: '地域2部リーグ東', tier: 0, region: 'E', size: 6, base: [40, 46], skills: [0, 1] },
    { id: 'regW2', name: '地域2部リーグ西', tier: 0, region: 'W', size: 6, base: [40, 46], skills: [0, 1] },
    { id: 'regE1', name: '地域1部リーグ東', tier: 1, region: 'E', size: 8, base: [44, 51], skills: [0, 1] },
    { id: 'regW1', name: '地域1部リーグ西', tier: 1, region: 'W', size: 8, base: [44, 51], skills: [0, 1] },
    { id: 'd3', name: 'D3リーグ', tier: 2, size: 12, base: [50, 58], skills: [1, 2] },
    { id: 'd2', name: 'D2リーグ', tier: 3, size: 14, base: [58, 67], skills: [2, 3] },
    { id: 'd1', name: 'D1リーグ', tier: 4, size: 12, base: [67, 78], skills: [3, 5] },
  ];
  const LG = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));
  const TOWN_W = ['宿毛', '土佐', '四万十', '高松', '松山', '徳島', '今治', '宇和島', '室戸', '鳴門', '丸亀', '新居浜', '岡山', '倉敷', '広島', '福山', '下関', '小倉', '博多', '久留米', '佐賀', '長崎', '熊本', '別府', '宮崎', '薩摩', '那覇', '姫路', '堺', '奈良', '和歌山', '鳥取', '出雲', '尾道', '呉', '周南'];
  const TOWN_E = ['函館', '旭川', '小樽', '青森', '盛岡', '石巻', '秋田', '山形', 'いわき', '会津', '水戸', '日立', '宇都宮', '高崎', '川越', '所沢', '船橋', '市原', '藤沢', '小田原', '甲府', '長岡', '上越', '松本', '富山', '金沢', '福井', '沼津', '浜松', '豊橋', '岐阜', '四日市', '伊勢', '飛騨', '諏訪', '佐渡'];
  const SUFFIX = ['イレブン', 'ユナイテッド', 'レイズ', 'ブルーム', 'アクア', 'ヴォルテ', 'ウィンズ', 'スターズ', 'ドルフィン', 'シャイン'];
  const SKILL_POOL = { FW: ['bodyFeint', 'scissors', 'cutIn', 'volley', 'nearPost', 'knuckle', 'speedDribble', 'behindRun', 'looseBall', 'powerMid', 'driveShot', 'lob'], MF: ['curve', 'throughPass', 'doubleTouch', 'controlShot', 'switchPlay', 'earlyCross', 'oneTouchPass', 'pressMonster', 'fk', 'noLook'], DF: ['slide', 'intercept', 'cover', 'aerial', 'shotBlock', 'manMark', 'longFeed', 'recovery', 'overlap'], GK: ['punching', 'superReflex', 'oneOnOne', 'coaching', 'lowThrow', 'rushOut'] };
  const OPP_NAME_POOL = ['タカ', 'ゴウ', 'ミツ', 'サキ', 'ヨシ', 'ダイ', 'ケン', 'ショウ', 'ノブ', 'アキ', 'マサ', 'トモ', 'ヒロ', 'テツ', 'ジュン', 'ユキ', 'リョウ', 'カズ', 'ハヤト', 'ソウタ', 'レイ', 'ジン', 'タク', 'コウ', 'ナオ', 'ユウマ', 'ハル', 'リク', 'カイト', 'イツキ', 'ショウマ', 'ツバサ', 'アラタ', 'ケイタ', 'ダイチ', 'ユウト', 'マコト', 'シュン', 'タイガ', 'ゲン', 'ヒナタ', 'ソラ', 'ルイ', 'アオ', 'トウマ', 'キョウ', 'ラン', 'セイ', 'イオリ', 'ヤマト', 'ムサシ', 'コタロウ', 'ゴロウ', 'サブロウ', 'テツヤ', 'ミナト', 'カケル', 'ハジメ', 'ススム', 'ワタル', 'エイジ', 'ヨウ', 'ケンタ', 'リュウ', 'ガク', 'シン', 'トオル', 'マナブ', 'ヒカル', 'ノボル'];
  const newStats = () => ({ P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 });

  // 世界（全リーグのチーム）を作る
  // 全チームは teams.js（DOT_TEAMS）で固定：名前・略称・地域・最初のリーグ・イメージカラー。強さと戦い方はセーブごとに決まる
  const TEAMS = root.DOT_TEAMS || [], TEAM_BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
  const ROSTERS = root.DOT_ROSTERS || {};   // rosters.js：CPUチームの監督・方針・ユニフォーム・固定の25人
  const teamEntry = (m, lg, r) => { const e = { id: m.id, name: m.name, short: m.short, region: m.region, preset: D.PRESET_NAMES[Math.floor(r() * D.PRESET_NAMES.length)], lvl: Math.round(lg.base[0] + r() * (lg.base[1] - lg.base[0])), seed: Math.floor(r() * 1e6) }; if (ROSTERS[m.id]) e.lvl = ROSTERS[m.id].lvl; return e; };
  function makeWorld(save) {
    const r = rng(save), leagues = {};
    for (const lg of LEAGUES) leagues[lg.id] = TEAMS.filter((m) => m.lg === lg.id).map((m) => teamEntry(m, lg, r));
    // 自分のチームは地域2部リーグ西から（地域2部西は自分を入れて6チーム）
    save.world = { leagues, me: 'regW2', region: 'W', fixed: 1 };
  }
  // ランダムな名前だった頃のセーブ：同じリーグのチームを、固定のチームに名前ごと置きかえる（強さ・戦い方はそのまま）
  function fixWorldNames(save) {
    if (!save.world || save.world.fixed) return;
    const used = new Set(), map = {};
    for (const lg of LEAGUES) for (const t of save.world.leagues[lg.id] || []) {
      const m = TEAMS.find((x) => !used.has(x.id) && x.lg === lg.id) || TEAMS.find((x) => !used.has(x.id));
      if (!m) continue; used.add(m.id);
      map[t.name] = m.name; Object.assign(t, { id: m.id, name: m.name, short: m.short, region: lg.region || m.region });
    }
    const w = save.world; delete save.world;
    let js = JSON.stringify(save);
    for (const old in map) js = js.split(JSON.stringify(old)).join(JSON.stringify(map[old]));
    const nw = JSON.parse(js); for (const k in nw) save[k] = nw[k];
    save.world = w; w.fixed = 1;
  }
  const myLgId = (save) => save.world.me;
  // 版610：対戦（空港）の相手チーム。友達のチームコードから作る（セーブには入れない）
  const GUESTS = {};
  function registerGuest(save, d) {
    let name = String(d.name || 'ゲストFC').slice(0, 16);
    const taken = (n) => n === save.team.name || Object.values(save.world.leagues).some((l) => l.some((x) => x.name === n));
    let k = 2; const base = name; while (taken(name)) name = base + '・' + (k++);
    const team = JSON.parse(JSON.stringify(d.team)); team.name = name; team.short = String(d.short || name).slice(0, 6); team.color = 'red';
    const lvl = team.players.slice(0, 11).reduce((a, p) => a + avgParam(p), 0) / 11;
    GUESTS[name] = { name, short: team.short, guest: true, lg: LG[d.lg] ? d.lg : 'regW2', lvl, seed: [...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0, emb: d.emb || null, kit: d.kit || null, kit2: d.kit2 || null, mgr: d.mgr || '', team };
    return GUESTS[name];
  }
  function guestCode(save) {   // 自分のチームを、相手に渡すデータにする（能力・スキル・戦術・ユニフォーム・エンブレム）
    const t = matchTeam(save).team, cl = ensureClub(save);
    t.players = t.players.map((p) => { const q = { ...p }; try { ensurePts(p); q.bg = Object.fromEntries(KEYS.map((k) => [k, rankInfo(p.pts[k]).g])); } catch (_) {}   // 版629：表示用の素の能力ランク（調子・疲れの影響なし）
      for (const k of ['pts', 'fatigue', 'injury', 'games', 'cond', 'startCur', 'goals', 'assists', 'hist', 'log']) delete q[k]; return q; });
    return { v: 1, name: save.team.name, short: save.team.short, mgr: save.manager || '', lg: save.league.id, emb: cl.emb, kit: cl.kit, kit2: cl.kit2, team: t };
  }
  function findTeam(save, name) {
    if (GUESTS[name]) return { ...GUESTS[name] };
    if (name === save.team.name) return { name, short: save.team.short, me: true, region: save.world.region, lvl: teamLevel(save) };
    for (const id in save.world.leagues) { const t = save.world.leagues[id].find((x) => x.name === name); if (t) return { ...t, lg: id }; }
    return null;
  }
  // 相手チームのデータ（試合用）：プリセットの個性を残して、レベルに合わせる
  // 固定の25人から、試合に出る18人（先発11人＋控え7人）を選ぶ。能力は rosters.js のまま（上がりも下がりもしない）
  const STYLE_ID = { possession: 'possession', counter: 'counter', highpress: 'highpress', wing: 'wing', balance: 'balance' };
  function rosterPlayer(q, k) {
    const h = { ...D.HIDDEN0, ...(D.TYPE_HIDDEN[q.type] || {}) }, wob = (j) => ((q.no * 7 + j * 13 + k) % 9) - 4;
    const p = { number: q.no, name: q.name, position: q.pos, type: q.type, role: q.role, age: q.age, skills: (q.skills || []).slice(), hair: q.looks[0], hairColor: q.looks[1], skin: q.looks[2],
      zone_man: h.zone_man + wob(1), press: clamp(h.press + wob(2), 0, 100), support: clamp(h.support + wob(3), 0, 100), overlap: clamp(h.overlap + wob(4), 0, 100), run_space: clamp(h.run_space + wob(5), 0, 100), goal_wait: clamp(h.goal_wait + wob(6), 0, 100) };
    for (const k2 of KEYS) p[k2] = q[k2];
    if (q.top && D.UNIQ_BY_TOP && D.UNIQ_BY_TOP[q.top]) { p.uniq = D.UNIQ_BY_TOP[q.top]; p.uniqLv = 1; p.topHair = D.UNIQ[p.uniq].hair; if (D.UNIQ[p.uniq].skin != null) p.skin = D.UNIQ[p.uniq].skin; }   // 顔を入れ替えた選手は、肌も顔に合わせる   // 国内屈指：その選手だけの固有スキル
    return p;
  }
  // CPUの選手の顔（faces/star）：専用の顔（チームID_背番号）か、チームの中で重ならないモブの顔（career-ui.js の顔と同じ決め方）
  const MOBMAP = {};
  function faceKeyOf(tid, q) {
    const F = root.STAR_FACES; if (!F || !q || !tid) return null;
    if (q.face && q.face in F) return q.face;   /* 移籍してきた選手は、元の顔のまま（版455） */
    const own = (p) => !p.gen && (tid + '_' + p.no) in F;
    if (own(q)) return tid + '_' + q.no;
    if (!('mob_1' in F)) return null;
    if (!MOBMAP[tid]) {
      const ro = rosterAt(tid, 1), used = new Set(), map = {}, N = Object.keys(F).filter((k) => k.startsWith('mob_')).length;
      for (const p of ro.players.slice().sort((a, b) => a.no - b.no)) {
        if (own(p) || p.face) continue;
        let h = 7; for (const ch of tid + '|' + p.no + '|' + p.name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
        let i = h % N; for (let k = 0; k < N && used.has(i); k++) i = (i + 1) % N;
        used.add(i); map[p.no] = 'mob_' + (i + 1);
      }
      MOBMAP[tid] = map;
    }
    return MOBMAP[tid][q.no] || null;
  }
  const noSkillLg = (lg) => /^reg/.test(lg || '');   // 地域リーグ（東1・東2・西1・西2）
  function rosterTeam(save, tm, ro) {
    const st = STYLES.find((x) => x.id === STYLE_ID[ro.style]) || STYLES[0];
    const ovr = (q) => KEYS.reduce((a, k) => a + q[k], 0) / KEYS.length;
    // 版785：手で決めたスタメン・並び（lineups.js）があれば、それを使う
    const lu0 = (root.DOT_LINEUPS || {})[tm.id], luP = lu0 && Array.isArray(lu0.order) && lu0.order.length === 11 && Array.isArray(lu0.cells) ? lu0.order.map((nm) => ro.players.find((q) => q.name === nm)) : null, lu = luP && luP.every(Boolean) && new Set(luP).size === 11 ? lu0 : null;
    const starters = lu ? luP : ro.players.filter((q) => q.starter), rest = ro.players.filter((q) => !starters.includes(q)).sort((a, b) => ovr(b) - ovr(a));
    const bench = [];
    for (const [pos, n] of [['GK', 1], ['DF', 2], ['MF', 2], ['FW', 2]]) bench.push(...rest.filter((q) => q.pos === pos).slice(0, n));
    const noSk = noSkillLg(tm.lg);   // 版559：地域リーグのCPUはスキルを持たない
    const ps = [...starters, ...bench].map((q, k) => { const p = rosterPlayer(q, k); if (noSk) p.skills = []; const fk = faceKeyOf(tm.id, q), hc = p.topHair || (fk && root.STAR_HAIR && root.STAR_HAIR[fk]); delete p.topHair; if (hc) p.hairColor = hc; if (fk) p.faceKey = fk; p.cpuTid = tm.id; p.cpuNo = q.no; return p; });   // 国内屈指はその選手だけの鮮やかな色   // 試合のドット絵の髪は、顔の絵と同じ色に
    const t = { name: tm.name, short: tm.short, color: 'red', policies: [], autoSubs: true, kit: ro.kit, players: ps };
    applyTactics(t, { ...st.t, formation: ro.formation });
    if (lu) {   // 並びはそのまま（フォーメーションの名前はマスの人数から）
      t.cells = [null, ...lu.cells.slice(1, 11).map((c) => ({ r: clamp(c.r | 0, 0, GRID_R - 1), c: clamp(c.c | 0, 0, GRID_C - 1) }))];
      t.formation = formationLabel(t.cells); t.style = st.name; t.coach = ro.coach;
      return t;
    }
    t.players = fitLines(ps.slice(0, 11), ro.formation).concat(ps.slice(11));
    { const dfs = t.players.map((p, k) => (k < 11 && p.position === 'DF' ? k : -1)).filter((k) => k >= 0);   // 5バック：スイーパーが真ん中（全体の底からカバーする役）
      if (dfs.length >= 5) { const mid = dfs[Math.floor(dfs.length / 2)], sw = dfs.filter((k) => t.players[k].type === 'スイーパー').sort((a, b) => (t.players[b].defense + t.players[b].vision) - (t.players[a].defense + t.players[a].vision))[0];
        if (sw != null && sw !== mid) [t.players[sw], t.players[mid]] = [t.players[mid], t.players[sw]]; } }
    for (const [n1, n2] of ro.swap || []) {   // 指定した2人の持ち場を入れ替える（例：神戸のかまたを左ウイングへ）
      const i = t.players.findIndex((p, k) => k < 11 && p.name === n1), j = t.players.findIndex((p, k) => k < 11 && p.name === n2);
      if (i >= 0 && j >= 0) [t.players[i], t.players[j]] = [t.players[j], t.players[i]];
    }
    for (const nm of ro.inner || []) {   // 指定した選手を、真ん中のすぐ隣（CB）に置く（例：広島のひがし）
      const dfs = t.players.map((p, k) => (k < 11 && p.position === 'DF' ? k : -1)).filter((k) => k >= 0), i = t.players.findIndex((p, k) => k < 11 && p.name === nm); if (i < 0 || dfs.length < 4) continue;
      const m = Math.floor(dfs.length / 2), inner = dfs.length >= 5 ? [dfs[m + 1], dfs[m - 1]] : [dfs[m], dfs[m - 1]]; if (inner.includes(i)) continue;
      const to = inner.find((k) => t.players[k].type !== 'スイーパー') ?? inner[0]; [t.players[i], t.players[to]] = [t.players[to], t.players[i]];
    }
    for (const nm of ro.center || []) {   // 指定した選手を、そのラインの真ん中に置く（例：神戸のおおかわはMFの真ん中）。人数が偶数のラインは、内側の2つのどちらか
      const i = t.players.findIndex((p, k) => k < 11 && p.name === nm); if (i < 0) continue;
      const lines = String(ro.formation).split('-').map(Number); let st0 = 1, li = -1;
      for (let k = 0; k < lines.length; k++) { if (i >= st0 && i < st0 + lines[k]) { li = k; break; } st0 += lines[k]; }
      if (li < 0) continue;
      const n = lines[li], mids = n % 2 ? [st0 + (n - 1) / 2] : [st0 + n / 2 - 1, st0 + n / 2];
      if (mids.includes(i)) continue;
      const free = mids.filter((k) => !(ro.center || []).includes(t.players[k].name)); if (!free.length) continue;   // 先に真ん中へ置いた選手は動かさない
      const to = free.find((k) => t.players[k].position === t.players[i].position) ?? free[0];   // 同じポジションの選手と入れ替える（偽9番などはそのまま）
      [t.players[i], t.players[to]] = [t.players[to], t.players[i]];
    }
    if (ro.order && ro.order.length === 11) { const ix = ro.order.map((nm) => t.players.findIndex((p, k) => k < 11 && p.name === nm)); if (ix.every((i) => i >= 0) && new Set(ix).size === 11) t.players = ix.map((i) => t.players[i]).concat(t.players.slice(11)); }   // 並びの指定（例：広島の3-4-2-1。ウイングバックにDF、シャドーの2人をFWのすぐ後ろへ）
    t.style = st.name; t.coach = ro.coach;
    return t;
  }

  // ---------- CPU選手の年齢・成長・引退（決まった流れなので、誰が遊んでも同じ年に同じことが起きる）----------
  // 1年目は rosters.js のまま。27歳までは毎年少しずつ成長し、27歳で完成（それ以降は上がりも下がりもしない）。
  // 33〜36歳で引退。空いた枠には、同じ素質（ポジション・タイプ・完成形の能力・スキル）の18〜19歳の新人が、新しい名前と顔で入る
  const NEW_JP = 'あいかわ あいざわ あおき あおやま あかい あかぎ あきやま あさい あさの あさひ あずま あだち あべ あまの あらい あらき あらた ありま いいだ いがらし いけだ いけの いしい いしかわ いしだ いしばし いしはら いずみ いそべ いだ いちかわ いちの いとう いなば いのうえ いまい いまむら いりえ いわさき いわた いわもと うえだ うえの うえむら うしお うすい うちだ うの うめだ うめはら うらた えがわ えぐち えだ えのもと えんどう おいかわ おおいし おおうち おおかわ おおくぼ おおさわ おおしま おおた おおつか おおの おおはし おおや おか おかざき おかだ おがた おかの おかべ おかもと おぎの おくだ おくむら おぐら おざき おざわ おだ おちあい おの おのでら かい かがわ かきた かくた かさい かじ かしわぎ かたおか かとう かない かなざわ かねこ かのう かまた かみお かみや かめい かやの かわい かわかみ かわぐち かわしま かわの かわばた かわむら かんだ きくち きしだ きしもと きただ きたの きたむら きど きのした きむら きよた くが くさの くどう くの くぼ くぼた くまがい くもい くらた くりた くりはら くろかわ くろさき くろだ こいけ こうの こが こじま こだま ことう こばやし こまつ こみや こやま こんどう さいき さいとう さえき さかい さかぐち さかもと さがら さくま さくらい ささき ささの さとう さなだ さの さわだ さわむら しいな しおた しおの しげた しの しのだ しばた しま しまだ しみず しもだ しらいし しらかわ しんどう すぎた すぎの すぎもと すずき すだ すどう すなが すみた せき せきね せの せら そうま そえだ そね そのだ たいら たか たかぎ たかしま たかだ たかの たかはし たかやま たき たきざわ たくま たけうち たけだ たけなか たけの たけむら たじま たちばな たなか たにぐち たにの たむら たるい ちば ちかだ つかだ つかもと つじ つじむら つだ つちや つつみ つのだ つぼい てらだ てらにし とおやま とがし とくなが とだ となみ とみた ともだ とよだ ないとう ながい なかがわ ながさわ なかじま なかた ながの なかむら なかやま なぐも なつめ なみき なりた なんぶ にいの にしい にしかわ にしだ にしの にしむら にった ぬまた ねぎし のぐち のざき のだ のなか のむら はがわ はしだ はしもと はせ はた はたの はっとり はなだ はまだ はまの はやかわ はやし はやの はら はらだ ひうら ひがし ひぐち ひさの ひの ひらい ひらた ひらの ひろせ ひろた ふかい ふかさわ ふくだ ふくち ふじい ふじおか ふじた ふじの ふじわら ふせ ふなき ふるかわ ふるた ほうじょう ほしの ほそだ ほった ほんだ まえだ まきの まさき ますだ まちだ まつい まつお まつだ まつの まつもと まなべ まるやま みうら みかみ みずの みずはら みぞぐち みたに みなみ みね みやうち みやざき みやた みやの みやもと むかい むらい むらおか むらた もちづき もとき もとやま もりおか もりた もりの もりや やぎ やすだ やなぎ やなせ やの やまうち やまおか やまぎし やまぐち やまさき やました やまだ やまの やまべ やまもと ゆあさ ゆうき ゆき よこい よこた よこやま よしい よしかわ よしだ よしの よしむら よねだ よもぎ わかばやし わかまつ わだ わたなべ わたぬき あきもと いくた いせ うるま えなみ おきた おとわ かざま かすが かみじょう きりたに くすのき こいずみ こうさか さいじょう さかき しまむら すがわら そらい たかつき つきしま ときた なぎさ はるな ひびの ふゆき みかど みずき やましろ ゆずき れんの'.split(' ');
  const NEW_FR = 'アルベルト ブルーノ カルロス ディエゴ エミリオ ファビオ ガブリエル ウーゴ イバン ハビエル ケビン ルーカス マルコ ニコ オスカル パブロ ラファエル セルジオ ティアゴ ウォルター ビクトル アドリアン ベルント クラウス デニス エリック フェリペ ゴメス ハンス イゴール ヨナス カルロ レアンドロ マテオ ネイマ ペドロ キケ ロベルト シモン トマス ウーリ バレンテ ビルツ ザビエル アンドレ ボリス セサル ダニエル エンツォ フランコ ジャン ヘンリー イサーク ジュリオ カイオ ロレンツォ ミゲル ノア オットー パトリス クインシー ルベン ステファン テオ ウーゴ ベニート ワグナー ジエゴ ヤン ゼノ アレックス ベルナト クリス ドミンゴ エドゥ フリオ ギジェルモ ホルヘ イシドロ ホアキン カリム ルイス マキシ ナウエル オリバー ピエール ラウル サンティ トニ ウマル バスコ ウェズリー シャビ ユーリ ザック アラン ブラス チコ ダビド エルナン ファン ジルベルト ハイメ イニゴ ジョエル クルト レオ モイセス ネストル オビ ポール ラミロ サウル ティモ ヴィニ ウィレム ヨアン'.split(' ');
  const GROW = 1.3, PEAK_AGE = 27;
  const hsh = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); return (h ^ (h >>> 15)) >>> 0; };
  const deficit = (age) => Math.max(0, PEAK_AGE - age) * GROW;
  const isJP = (n) => /^[ぁ-ゖー]+$/.test(n);
  const LIFE = {}, RCACHE = {};
  function lifeOf(id) {
    if (LIFE[id]) return LIFE[id];
    const ro = ROSTERS[id];
    return (LIFE[id] = { upto: 1, fr: ro.players.filter((q) => !isJP(q.name)).length / ro.players.length, slots: ro.players.map((q, i) => {
      const peak = {}; for (const k of KEYS) peak[k] = q[k] + deficit(q.age);
      return { q, peak, gens: [{ g: 0, from: 1, age0: q.age, ra: Math.max(q.age, 33 + hsh(id + '|' + i + '|0|r') % 4), name: q.name, looks: q.looks }] };
    }) });
  }
  function extendLife(id, season) {
    const L = lifeOf(id);
    while (L.upto < season) {
      const s = ++L.upto, active = new Set(L.slots.map((sl) => sl.gens[sl.gens.length - 1].name));
      L.slots.forEach((sl, i) => {
        const cur = sl.gens[sl.gens.length - 1];
        if (cur.from + (cur.ra - cur.age0) >= s) return;   // まだ現役
        const g = cur.g + 1, key = id + '|' + i + '|' + g, pool = (hsh(key + '|f') % 1000) / 1000 < L.fr ? NEW_FR : NEW_JP;
        let name, k = 0;
        do { name = pool[hsh(key + '|n' + k) % pool.length]; k++; } while ((active.has(name) || name === cur.name) && k < 300);
        active.delete(cur.name); active.add(name);
        const h = hsh(key + '|l');
        sl.gens.push({ g, from: s, age0: 18 + hsh(key + '|a') % 2, ra: 33 + hsh(key + '|r') % 4, name, looks: [h % 6, (h >>> 4) % 5, (h >>> 8) % 10 < 8 ? (h >>> 12) % 2 : 2] });
      });
    }
    return L;
  }
  const rOvr = (q) => KEYS.reduce((a, k) => a + q[k], 0) / KEYS.length;
  // そのシーズンのチームの25人
  // ガチャ移籍にするので、CPUの選手は年をとらない・引退しない（誰が遊んでも、いつでも同じ顔ぶれ）。LIFE_ON を true にすると成長・引退が動く
  const LIFE_ON = false;
  function rosterAt(id, season) {
    const ro = ROSTERS[id]; if (!ro) return null;
    season = LIFE_ON ? Math.max(1, (season | 0) || 1) : 1;
    const ck = id + '@' + season; if (RCACHE[ck]) return RCACHE[ck];
    const L = extendLife(id, season);
    const players = L.slots.map((sl) => {
      let gi = sl.gens.length - 1; while (gi > 0 && sl.gens[gi].from > season) gi--;
      const gen = sl.gens[gi], age = gen.age0 + (season - gen.from), q = sl.q;
      const p = { ...q, name: gen.name, looks: gen.looks, age, gen: gen.g, skills: q.skills.slice() };
      for (const k of KEYS) p[k] = clamp(Math.round(sl.peak[k] - deficit(age)), 20, 99);
      if (gen.g > 0) {
        delete p.top; delete p.face;   // 引退した選手の後に入る新人は、移籍してきた選手の顔を引き継がない
        p.skills = q.skills.slice(0, clamp(Math.round(q.skills.length * (age - 17) / 8), 0, q.skills.length));   // スキルは育つにつれて身につく
        if (age < 23) p.role = '';
      }
      p.totsu = totsuOf(id, p);   // 能力はそのまま。☆の上限より上の能力を持っている選手は、その分だけ凸している（☆3でSがあれば1凸）
      return p;
    });
    if (season > 1) {   // スタメン：ポジションごとに、今いちばん力のある選手（今のスタメンを少しだけ優先）
      for (const pos of ['GK', 'DF', 'MF', 'FW']) {
        const g = players.filter((p) => p.pos === pos), n = g.filter((p) => p.starter).length;
        g.sort((a, b) => (rOvr(b) + (b.starter ? 3 : 0)) - (rOvr(a) + (a.starter ? 3 : 0))).forEach((p, k) => { p.starter = k < n; });
      }
    }
    return (RCACHE[ck] = { ...ro, season, players });
  }
  // そのシーズンのチームの強さ（1年目＝rosters.js の強さ。スタメンの平均の上がり下がりの分だけ変わる）
  const stOvr = (r) => { const st = r.players.filter((p) => p.starter); return st.reduce((a, p) => a + rOvr(p), 0) / (st.length || 1); };
  function lvlAt(id, season) { const ro = ROSTERS[id]; if (!ro) return null; return Math.round(ro.lvl + stOvr(rosterAt(id, season)) - stOvr(rosterAt(id, 1))); }
  // シーズンの変わり目に引退した選手（エース・国内屈指だった選手だけ）
  function retiredAt(save, season) {
    if (!LIFE_ON) return [];
    const out = [], hold = save.titles || {};
    for (const id in ROSTERS) {
      const a = rosterAt(id, season - 1), b = rosterAt(id, season);
      a.players.forEach((p, i) => {
        if (b.players[i].gen === p.gen) return;
        const tt = Object.keys(hold).find((k) => hold[k].id === id && hold[k].name === p.name);
        if (p.role === 'ace' || tt) out.push({ name: p.name, team: (TEAM_BY_ID[id] || {}).name || id, age: p.age, title: tt || '', next: b.players[i].name });
      });
    }
    return out;
  }
  // 版854：画面に出すCPUの名簿も、試合と同じ「プロの上乗せ」（D3 +6・D2 +5・D1 +4）をのせる（save を渡した時）
  function rosterOfTeam(id, season, save) {
    const ro = rosterAt(id, season); if (!save || !ro) return ro;
    let b = 0; try { const tm = TEAM_BY_ID[id], t = tm && findTeam(save, tm.name); b = t ? PRO_BOOST[t.lg] || 0 : 0; } catch (e) {}
    if (!b) return ro;
    const r2 = { ...ro, players: ro.players.map((q) => { const p = { ...q }; for (const k of KEYS) if (typeof p[k] === 'number') p[k] = clamp(Math.round(p[k] + b), 25, 99); return p; }) };
    return r2;
  }
  // 版850：D3から上はプロ。CPUのチームは、名簿の能力より少し上の力で試合をする（D3 +6・D2 +5・D1 +4）
  const PRO_BOOST = { d3: 6, d2: 5, d1: 4 };
  function opponentTeam(save, op) {
    const t = opponentTeam0(save, op);
    try { const tm0 = op && !GUESTS[op.name] ? (op.preset ? op : findTeam(save, op.name)) : null; if (tm0 && tm0.lg) t.lgId = tm0.lg; } catch (e) {}   // 版851：固有スキルの強さ（リーグ）に使う
    try { if (op && !GUESTS[op.name]) { const tm = op.preset ? op : findTeam(save, op.name); const b = tm ? PRO_BOOST[tm.lg] || 0 : 0;
      if (b) for (const p of t.players) for (const k of KEYS) if (typeof p[k] === 'number') p[k] = clamp(Math.round(p[k] + b), 25, 99); } } catch (e) {}
    return t;
  }
  function opponentTeam0(save, op) {
    if (op && GUESTS[op.name]) return JSON.parse(JSON.stringify(GUESTS[op.name].team));   // 版610：対戦の相手は、もらったチームそのまま
    const tm = op.preset ? op : findTeam(save, op.name);
    if (tm && ROSTERS[tm.id]) return rosterTeam(save, tm, rosterAt(tm.id, save.season));
    const lg = LG[tm.lg] || LG[myLgId(save)] || LEAGUES[0];
    const t = D.presetTeam(tm.preset);
    let s = tm.seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    t.players.forEach((p) => {
      D.fillParams(p, 0);
      for (const k of KEYS) p[k] = clamp(Math.round(tm.lvl + (p[k] - 50) * 0.8 + (r() - 0.5) * 6), 25, 95);
      const pool = SKILL_POOL[p.position] || [];
      const n = noSkillLg(tm.lg) ? 0 : lg.skills[0] + Math.floor(r() * (lg.skills[1] - lg.skills[0] + 1));
      const sk = new Set(noSkillLg(tm.lg) ? [] : p.skills || []);
      for (let j = 0; j < n && pool.length; j++) sk.add(pool[Math.floor(r() * pool.length)]);
      p.skills = [...sk];
    });
    t.name = tm.name; t.short = tm.short; t.color = 'red';
    // 選手の名前と見た目はチームごとに違う（チームの種から決める）
    { let s2 = (tm.seed * 2654435761) >>> 0; const r2 = () => { s2 = (Math.imul(s2, 1664525) + 1013904223) >>> 0; let x = s2 ^ (s2 >>> 16); x = Math.imul(x, 0x45d9f3b) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
      const used = new Set();
      t.players.forEach((p) => { let n; do { n = OPP_NAME_POOL[Math.floor(r2() * OPP_NAME_POOL.length)]; } while (used.has(n)); used.add(n); p.name = n; p.hair = Math.floor(r2() * 4); p.hairColor = Math.floor(r2() * 4); p.skin = Math.floor(r2() * 3); }); }
    const sts = PRESET_STYLE[tm.preset] || ['balance'], sid = sts[tm.seed % sts.length], st = STYLES.find((x) => x.id === sid) || STYLES[0];
    const forms = STYLE_FORMS[sid] || [st.formation], formation = forms[(tm.seed >> 3) % forms.length];
    applyTactics(t, { ...st.t, formation });
    t.players = fitLines(t.players, formation);
    t.style = st.name;
    return t;
  }

  // ---------- 1年のカレンダー（1シーズン＝1年：3月1週〜翌2月4週の48週。1週に試合は1つまで）----------
  const SEASON_WEEKS = 48;
  const CAMPS = [{ from: 21, to: 24, name: '夏合宿' }, { from: 45, to: 48, name: '春季キャンプ' }];   // 8月と2月（オフ）は合宿
  const CAMP_FROM = 21, CAMP_TO = 24;
  // 国内カップ（8回戦。決勝は12月3週）。D1・D2のチームは3回戦から登場（天皇杯のように）
  // 国内カップ：出場決定戦（地域2部の4チーム）→ 64チームのトーナメント（1回戦〜決勝）。決勝は12月3週
  const CUP_WEEKS = [6, 11, 15, 19, 27, 31, 39];
  const CUP_LABELS = ['出場決定戦', '1回戦', '2回戦', '3回戦', '準々決勝', '準決勝', '決勝'];
  const CUP_LATE = ['d1', 'd2', 'd3', 'regE1', 'regW1'], CUP_LATE_ROUND = 1;   // 出場決定戦に出るのは地域2部だけ
  const LEAGUE_FROM = 2, LEAGUE_TO = 40;           // リーグ戦は3月2週〜12月4週
  const POST_WEEKS = [41, 42, 43];                 // 1月1週：昇格トーナメント・入れ替え戦（v746：すべて1月1週）。1月2週：地域2部 東西親善試合の決勝
  function leagueWeeks(R, id) {
    const avail = [], cupW = CUP_LATE.includes(id) ? CUP_WEEKS.slice(CUP_LATE_ROUND) : CUP_WEEKS;   // 出ないカップの週（出場決定戦）はリーグに使える
    for (let w = LEAGUE_FROM; w <= LEAGUE_TO; w++) if ((w < CAMP_FROM || w > CAMP_TO) && !cupW.includes(w)) avail.push(w);
    if (R <= 1) return [avail[0]];
    return Array.from({ length: R }, (_, k) => avail[Math.round((k * (avail.length - 1)) / (R - 1))]);
  }
  // 2回総当たりの日程
  function makeSchedule(n) {
    const arr = [...Array(n).keys()], rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const pairs = [];
      for (let k = 0; k < n / 2; k++) { const a = arr[k], b = arr[n - 1 - k]; pairs.push(r % 2 ? [b, a] : [a, b]); }
      rounds.push(pairs);
      arr.splice(1, 0, arr.pop());
    }
    return [...rounds, ...rounds.map((ps) => ps.map(([a, b]) => [b, a]))];
  }
  // 自分のリーグの今シーズン
  /* v766：ホームタウン（都道府県）で、最初に入る地域リーグ（東・西）が決まる。北海道〜中部は東、三重〜沖縄は西 */
  const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
    '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
  const prefRegion = (pf) => (PREFS.indexOf(pf) >= 0 && PREFS.indexOf(pf) < PREFS.indexOf('三重県') ? 'E' : 'W');
  function setHometown(save, pf) {
    if (PREFS.indexOf(pf) < 0) return false;
    save.hometown = pf;
    const reg = prefRegion(pf), from = myLgId(save);
    if (reg === save.world.region || !/^reg.2$/.test(from) || save.season !== 1 || (save.league && save.league.round > 0)) return true;   // 始めたばかりの時だけ、リーグを移せる
    const to = reg === 'E' ? 'regE2' : 'regW2', W = save.world.leagues;
    // 移る先のCPUチームを1つ、元のリーグへ（6チームずつにそろえる）
    const sw = W[to].find((t) => t.id === (to === 'regE2' ? 'hida' : '')) || W[to].slice().sort((a, b) => (a.lvl || 0) - (b.lvl || 0))[Math.floor(W[to].length / 2)];   /* v767：東に入る時は、東でいちばん西寄りの飛騨（岐阜）が西へ */
    W[to] = W[to].filter((t) => t !== sw); sw.region = LG[from].region; W[from].push(sw);
    save.world.me = to; save.world.region = reg;
    newLeague(save); newCup(save);
    return true;
  }
  function newLeague(save) {
    const id = myLgId(save), lg = LG[id], r = rng(save);
    const teams = [{ name: save.team.name, me: true, stats: newStats() }, ...save.world.leagues[id].map((t) => ({ name: t.name, stats: newStats() }))];
    for (let i = teams.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [teams[i], teams[j]] = [teams[j], teams[i]]; }
    const rounds = makeSchedule(teams.length);
    save.league = { id, name: lg.name, tier: lg.tier, teams, rounds, weeks: leagueWeeks(rounds.length, id), round: 0, results: [] };
    newOthers(save);
  }
  // ---------- 自分のいないリーグも、毎週同じように試合を進める（サッカー協会で順位表・ゴール・アシストを見られるように）----------
  function newOthers(save) {
    const r = rng(save), lgs = { season: save.season };
    for (const lg of LEAGUES) {
      if (lg.id === myLgId(save)) continue;
      const teams = (save.world.leagues[lg.id] || []).map((t) => ({ name: t.name, stats: newStats() }));
      for (let i = teams.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [teams[i], teams[j]] = [teams[j], teams[i]]; }
      const rounds = makeSchedule(teams.length);
      lgs[lg.id] = { id: lg.id, name: lg.name, teams, rounds, weeks: leagueWeeks(rounds.length, lg.id), round: 0, results: [] };
    }
    save.lgs = lgs;
    save.gstats = { season: save.season, by: {} };   // 得点・アシスト：by[大会][チーム名][選手名] = [得点, アシスト]
  }
  function advanceOthers(save, week) {
    if (!save.lgs) return;
    const r = rng(save);
    for (const id in save.lgs) {
      const lg = save.lgs[id]; if (!lg || !lg.rounds) continue;
      while (lg.round < lg.rounds.length && lg.weeks[lg.round] <= week) {
        const res = [];
        for (const [a, b] of lg.rounds[lg.round]) {
          const A = lg.teams[a].name, B = lg.teams[b].name, pin = watchedOf(save, id, lg.round, a, b); let sc = quickScore(r, lvlOf(save, A), lvlOf(save, B));
          if (pin) { sc = pin.s.slice(); pinGoals(save, id, A, B, pin); } else { addGoals(save, id, A, sc[0], r); addGoals(save, id, B, sc[1], r); }
          record(lg, a, b, sc[0], sc[1]); res.push({ a, b, s: sc, w: pin ? 1 : 0 });
        }
        lg.results.push(res); lg.round++;
      }
    }
  }
  // ---------- D1観戦：次の節のD1の試合を、試合の画面で見られる。見た試合の結果は、そのまま記録に残る ----------
  const watchKey = (save, id, round, a, b) => `${save.season}|${id}|${round}|${a}|${b}`;
  function watchedOf(save, id, round, a, b) { return save.watched && save.watched[watchKey(save, id, round, a, b)] || null; }
  function pinGoals(save, id, A, B, pin) {
    for (const g of pin.goals || []) { const team = g[0] === 0 ? A : B; tallyOf(save, id, team, g[1])[0]++; if (g[2]) tallyOf(save, id, team, g[2])[1]++; }
  }
  function d1Round(save) {
    const mine = save.league && save.league.id === 'd1', lg = mine ? save.league : save.lgs && save.lgs.d1;
    if (!lg || !lg.rounds || lg.round >= lg.rounds.length) return null;
    const me = mine ? meIdx(save) : -1;
    const list = lg.rounds[lg.round].filter(([a, b]) => a !== me && b !== me).map(([a, b]) => ({ a, b, A: lg.teams[a].name, B: lg.teams[b].name, done: watchedOf(save, 'd1', lg.round, a, b) }));
    return { id: 'd1', round: lg.round, week: lg.weeks[lg.round], list, last: (lg.results[lg.round - 1] || []).filter((x) => x.a !== me && x.b !== me).map((x) => ({ A: lg.teams[x.a].name, B: lg.teams[x.b].name, s: x.s, w: x.w })) };
  }
  function pinWatch(save, id, round, a, b, score, events) {
    save.watched = save.watched || {};
    for (const k of Object.keys(save.watched)) if (!k.startsWith(save.season + '|')) delete save.watched[k];   // 前のシーズンの分は消す
    save.watched[watchKey(save, id, round, a, b)] = { s: score.slice(), goals: (events || []).filter((e) => e.type === 'goal' && e.player !== 'オウンゴール').map((e) => [e.team, e.player, e.assist || ''].slice(0, e.assist ? 3 : 2)) };
  }
  // 古いセーブ：今の週までの試合をまとめて進めておく
  function ensureOthers(save) {
    if (save.lgs && save.lgs.season === save.season && save.gstats) return;
    newOthers(save);
    advanceOthers(save, save.week - 1);
  }
  // 得点・アシスト
  const rosterCache = new Map();
  function rosterOf(save, name) {
    if (name === save.team.name) return save.team.players.slice(0, 11).map((p) => ({ name: p.name, pos: p.position }));
    if (!rosterCache.has(name)) { try { const t = opponentTeam(save, findTeam(save, name)); rosterCache.set(name, t.players.slice(0, 11).map((p) => ({ name: p.name, pos: p.position }))); } catch (e) { rosterCache.set(name, []); } }
    return rosterCache.get(name);
  }
  function tallyOf(save, comp, team, player) {
    const g = save.gstats || (save.gstats = { season: save.season, by: {} });
    const c = (g.by[comp] = g.by[comp] || {}), t = (c[team] = c[team] || {});
    return (t[player] = t[player] || [0, 0]);
  }
  const G_W = { FW: 6, MF: 3, DF: 1, GK: 0 }, A_W = { FW: 3, MF: 5, DF: 2, GK: 0.2 };
  function pickW(r, list, W, not) { const c = list.filter((p) => p.name !== not); const tot = c.reduce((a, p) => a + (W[p.pos] ?? 1), 0); let u = r() * tot; for (const p of c) { u -= W[p.pos] ?? 1; if (u <= 0) return p; } return c[c.length - 1]; }
  function addGoals(save, comp, team, n, r) {
    if (!n) return;
    const ro = rosterOf(save, team); if (!ro.length) return;
    for (let k = 0; k < n; k++) {
      const sc = pickW(r, ro, G_W); if (!sc) continue;
      tallyOf(save, comp, team, sc.name)[0]++;
      if (r() < 0.7) { const as = pickW(r, ro, A_W, sc.name); if (as) tallyOf(save, comp, team, as.name)[1]++; }
    }
  }
  // 自分の試合：本当に試合で決めた選手で数える（相手チームの得点も）
  function recordGoals(save, fx, events) {
    if (!fx) return;
    const comp = fx.kind === 'league' ? myLgId(save) : fx.kind === 'cup' ? 'cup' : 'post', opp = fx.opp && fx.opp.name;
    for (const e of events || []) {
      if (e.type !== 'goal' || e.player === 'オウンゴール') continue;
      const team = e.team === 0 ? save.team.name : opp; if (!team) continue;
      tallyOf(save, comp, team, e.player)[0]++;
      if (e.assist) tallyOf(save, comp, team, e.assist)[1]++;
    }
  }
  function goalRank(save, comp) {
    const out = [], by = (save.gstats && save.gstats.by[comp]) || {};
    for (const team in by) for (const pl in by[team]) { const [g, a] = by[team][pl]; out.push({ team, player: pl, g, a, me: team === save.team.name }); }
    return out;
  }
  // ひとつ前の節が終わった時点の順位（順位表の矢印）
  function prevOrder(save, id) {
    const lg = id === myLgId(save) ? save.league : save.lgs && save.lgs[id];
    if (!lg || !lg.results || lg.results.length < 2) return [];
    const tmp = { teams: lg.teams.map((t) => ({ name: t.name, stats: newStats() })) };
    lg.results.slice(0, -1).forEach((res) => res.forEach((x) => record(tmp, x.a, x.b, x.s[0], x.s[1])));
    return tmp.teams.sort((x, y) => y.stats.Pts - x.stats.Pts || (y.stats.GF - y.stats.GA) - (x.stats.GF - x.stats.GA) || y.stats.GF - x.stats.GF).map((t) => t.name);
  }
  function leagueTable(save, id) {
    const lg = id === myLgId(save) ? save.league : save.lgs && save.lgs[id];
    if (!lg) return null;
    return { id, name: (LG[id] || {}).name, round: lg.round, rounds: lg.rounds.length, weeks: lg.weeks, rows: lg.teams.map((t) => ({ ...t, me: t.name === save.team.name })).sort((x, y) => y.stats.Pts - x.stats.Pts || (y.stats.GF - y.stats.GA) - (x.stats.GF - x.stats.GA) || y.stats.GF - x.stats.GF) };
  }
  function newCareer(teamName) {
    const team = D.beginningTeam();
    if (teamName) { team.name = teamName; team.short = teamName.replace(/FC$/, ''); }
    for (const p of team.players) { D.fillParams(p, 0); p.fatigue = 10; p.cond = 0; p.injury = 0; p.skills = p.skills || []; p.games = 0; }
    // カルチョビットAと同じく、最初はみんな「バランス」。特訓で動きのくせ（裏パラ）が変わって、タイプが決まっていく
    for (const p of team.players) if (p.position !== 'GK') { p.type = 'バランス'; for (const k of HKEYS) p[k] = D.HIDDEN0[k]; }
    const save = { version: 1, ptsVer: 3, rs: 20261005, season: 1, week: 1, team, history: [], cards: {}, cardsVer: 0, spFound: [] };
    makeWorld(save); newLeague(save); newCup(save);
    migrate(save);
    return save;
  }
  const meIdx = (save) => save.league.teams.findIndex((t) => t.me);
  function record(lg, a, b, ga, gb) {
    const A = lg.teams[a].stats, B = lg.teams[b].stats;
    A.P++; B.P++; A.GF += ga; A.GA += gb; B.GF += gb; B.GA += ga;
    if (ga > gb) { A.W++; B.L++; A.Pts += 3; } else if (ga < gb) { B.W++; A.L++; B.Pts += 3; } else { A.D++; B.D++; A.Pts++; B.Pts++; }
  }
  // 自分以外の試合：チームの強さから点数を決める（すぐに終わる）
  function quickScore(r, la, lb) {
    const pois = (m) => { let k = 0, p = Math.exp(-m), s = p, u = r(); while (u > s && k < 9) { k++; p *= m / k; s += p; } return k; };
    const d = (la - lb) / 6;   // 版773：実際の試合（能力差5で8割勝つ）に近い差の出方に（前は /12 で差が出にくかった）
    return [pois(clamp(1.3 + d * 0.9, 0.2, 5)), pois(clamp(1.3 - d * 0.9, 0.2, 5))];
  }
  // トーナメント：引き分けはPK戦（メンタル＝強さで少しだけ有利）
  function koWinner(r, la, lb, s) { if (s[0] !== s[1]) return s[0] > s[1] ? 0 : 1; return r() < 0.5 + (la - lb) * 0.01 ? 0 : 1; }
  function teamLevel(save) { const ps = save.team.players.slice(0, 11); return ps.reduce((a, p) => a + avgParam(p), 0) / ps.length; }
  const lvlOf = (save, name) => (name === save.team.name ? teamLevel(save) : (findTeam(save, name) || { lvl: 50 }).lvl);

  // 試合に出た選手：判断力が伸びる・疲れる・ケガ
  function afterPlayed(save, playedIdx, r, practice) {
    save.team.players.forEach((p, i) => {
      if (playedIdx.includes(i)) {
        if (!practice) p.games = (p.games || 0) + 1;
        addPts(p, 'vision', practice ? 0.3 : 0.8 + r() * 0.6); if (!practice) addPts(p, 'mental', 0.3 + r() * 0.4);   // 試合経験：ほんの少し（伸びの中心は特訓）
        p.fatigue = clamp(p.fatigue + (practice ? 8 : 12), 0, 100);
        if (!(p.injury > 0) && r() < ((practice ? 0.003 : 0.006) + Math.max(0, p.fatigue - 60) * 0.003) * injMul(p)) injure(save, p, r, 'match');
      } else p.fatigue = clamp(p.fatigue - 10, 0, 100);
    });
  }
  // 公式戦のあと：出場停止（レッドカード→次の公式戦）と、勝った時の調子アップ
  // 版835：出場停止は大会ごと。リーグで退場→その年のリーグの次の試合だけ、カップで退場→カップの次の試合だけ（1月の入れ替え戦などは別）。年をまたいだら消える
  //  p.susp = { season, league, cup, post }。p.suspend（スタメン画面の印・自動の入れ替え）は「次の公式戦で出られないか」を毎回計算し直す
  function syncSuspend(save) {
    const fx = (() => { try { return nextFixture(save); } catch (_) { return null; } })(), kind = fx ? fx.kind : null;
    for (const p of [...((save.team && save.team.players) || []), ...(save.reserve || [])]) {
      if (p.susp && p.susp.season !== save.season) delete p.susp;
      p.suspend = kind && p.susp && p.susp[kind] > 0 ? 1 : 0;
    }
  }
  function afterOfficial(save, events, myScore, res, played, kind) {
    const ps = save.team.players, served = [], reds = [], k = kind || 'league';
    for (const p of ps) if (p.susp && p.susp.season === save.season && p.susp[k] > 0) { p.susp[k]--; served.push(p.name); }   // この大会の出場停止が明けた
    for (const e of events || []) if (e.type === 'card' && e.team === 0 && e.color === 'red') { const q = ps.find((x) => x.name === e.player); if (q) { if (!q.susp || q.susp.season !== save.season) q.susp = { season: save.season }; q.susp[k] = 1; reds.push(q.name); } }
    syncSuspend(save);
    const d = myScore[0] - myScore[1];
    // 版515：公式戦に勝つと、試合に出た選手の調子が1段上がる（PK戦で勝ち上がった時も）
    const won = d > 0 || (d === 0 && res && res.win === true), condUp = [];
    if (won) (played || []).forEach((i) => { const q = ps[i]; if (q && condOf(q) < 2) { q.cond = condOf(q) + 1; condUp.push(q.name); } });
    delete save.support;   // 版559：支持率はなくした
    return { reds, served, condUp };
  }
  // 公式戦の記録（シーズンごとの 出場P・得点G・アシストA・警告Y・退場R）
  function recordStats(save, events, playedIdx) {
    const ps = save.team.players, key = String(save.season), club = save.team.short || save.team.name;
    const st = (p) => { p.rec = p.rec || {}; return (p.rec[key] = p.rec[key] || { club, lg: LG[myLgId(save)] ? LG[myLgId(save)].name : '', P: 0, G: 0, A: 0, Y: 0, R: 0 }); };
    playedIdx.forEach((i) => { if (ps[i]) st(ps[i]).P++; });
    for (const e of events || []) {
      if (e.team !== 0) continue;
      if (e.type === 'goal') { const sc = ps.find((q) => q.name === e.player); if (sc) st(sc).G++; const as = e.assist && ps.find((q) => q.name === e.assist); if (as) st(as).A++; }
      if (e.type === 'card') { const q = ps.find((x) => x.name === e.player); if (q) st(q)[e.color === 'red' ? 'R' : 'Y']++; }
    }
  }
  // リーグ戦の結果
  function finishRound(save, myScore, playedIdx) {
    const lg = save.league, r = rng(save), me = meIdx(save);
    const res = [];
    for (const [a, b] of lg.rounds[lg.round]) {
      let s;
      if (a === me || b === me) s = a === me ? myScore : [myScore[1], myScore[0]];
      else { s = quickScore(r, lvlOf(save, lg.teams[a].name), lvlOf(save, lg.teams[b].name)); const pin = watchedOf(save, lg.id, lg.round, a, b); if (pin) { s = pin.s.slice(); pinGoals(save, lg.id, lg.teams[a].name, lg.teams[b].name, pin); } else { addGoals(save, lg.id, lg.teams[a].name, s[0], r); addGoals(save, lg.id, lg.teams[b].name, s[1], r); } }
      record(lg, a, b, s[0], s[1]); res.push({ a, b, s });
    }
    lg.results.push(res); lg.round++;
    afterPlayed(save, playedIdx, r, false);
    return res;
  }
  // ハーフタイムの「途中経過」：このあと finishRound で出る結果を、乱数を進めずに先に計算する（前半の点数は、その中から前半に入った分）
  function peekRound(save) {
    const lg = save.league; if (!lg || !lg.rounds || !lg.rounds[lg.round]) return null;
    const me = meIdx(save), tmp = { rs: save.rs }, r = rng(tmp), out = [];
    for (const [a, b] of lg.rounds[lg.round]) {
      if (a === me || b === me) { out.push({ a, b, me: true }); continue; }
      let s = quickScore(r, lvlOf(save, lg.teams[a].name), lvlOf(save, lg.teams[b].name));
      const pin = watchedOf(save, lg.id, lg.round, a, b); if (pin) s = pin.s.slice();
      let h = 0x9e3779b9 ^ (lg.round * 131 + a * 17 + b * 7); const hr = () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; return (h % 1000) / 1000; };
      // それぞれのゴールが入った分（前半 1〜45分／後半 46〜90分）
      const mins = [[], []]; for (let k = 0; k < 2; k++) for (let g = 0; g < s[k]; g++) mins[k].push(hr() < 0.47 ? 1 + Math.floor(hr() * 45) : 46 + Math.floor(hr() * 45));
      const half = mins.map((l) => l.filter((m) => m <= 45).length);
      out.push({ a, b, s, half, mins });
    }
    return out;
  }
  // 版580：この試合のあとで「優勝が決まる」か（試合の前の状態で調べる。セーブは変えない）
  //  リーグ：残りの試合を全部勝っても、どのチームも追いつけなくなった時（前の節までに決まっていた時は出さない）
  //  カップ：決勝で勝った時（引き分けのPK戦は、試合のあとに決まるので、ここでは出さない）
  function champPeek(save, fx, my) {
    if (!fx || !my) return null;
    if (fx.kind === 'cup') { const cup = save.cup; if (cup && !cup.champion && cup.slots && cup.slots.length === 2 && my[0] > my[1]) return { kind: 'cup', title: '国内カップ', n: (save.history || []).filter((h) => h.cup).length + 1 }; return null; }
    if (fx.kind !== 'league') return null;
    const lg = save.league, pk = peekRound(save); if (!lg || !pk) return null;
    const me = meIdx(save), pts0 = lg.teams.map((t) => t.stats.Pts), pts = pts0.slice();
    for (const g of pk) { const s = g.me ? (g.a === me ? my : [my[1], my[0]]) : g.s; if (!s) continue; if (s[0] > s[1]) pts[g.a] += 3; else if (s[0] < s[1]) pts[g.b] += 3; else { pts[g.a]++; pts[g.b]++; } }
    const left = lg.rounds.length - (lg.round + 1);
    const lock = (P, L) => P.every((p, i) => i === me || P[me] > p + 3 * L);
    if (lock(pts0, left + 1) || !lock(pts, left)) return null;
    const name = (LG[lg.id] || {}).name || lg.name;
    return { kind: 'league', title: name, n: (save.history || []).filter((h) => h.league === name && h.pos === 1).length + 1, last: left === 0 };
  }
  function standings(save) {
    return save.league.teams.map((t, i) => ({ ...t, i })).sort((x, y) => y.stats.Pts - x.stats.Pts || (y.stats.GF - y.stats.GA) - (x.stats.GF - x.stats.GA) || y.stats.GF - x.stats.GF);
  }
  // 自分がいないリーグ：1シーズン分をまとめて計算して順位を出す
  function simLeague(save, id, r) {
    const names = save.world.leagues[id].map((t) => t.name);
    const lg = { teams: names.map((name) => ({ name, stats: newStats() })) };
    for (const rd of makeSchedule(names.length)) for (const [a, b] of rd) { const s = quickScore(r, lvlOf(save, names[a]), lvlOf(save, names[b])); record(lg, a, b, s[0], s[1]); }
    return lg.teams.sort((x, y) => y.stats.Pts - x.stats.Pts || (y.stats.GF - y.stats.GA) - (x.stats.GF - x.stats.GA)).map((t) => t.name);
  }

  // ---------- 国内カップ：全66チームのトーナメント（組み合わせはシーズンの初めに決まって、最後まで変わらない）----------
  //  出場決定戦：地域2部のうち4チームが2試合 → 勝った2チームが64チームのトーナメントへ
  //  トーナメント：64 → 32 → 16 → 8（準々決勝）→ 4（準決勝）→ 決勝。D1は早く当たらないように散らして置く
  function newCup(save) {
    const r = rng(save), all = [];
    for (const id in save.world.leagues) for (const t of save.world.leagues[id]) all.push({ name: t.name, lg: id });
    all.push({ name: save.team.name, lg: myLgId(save) });
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const reg2 = shuffle(all.filter((t) => /^reg.2$/.test(t.lg)));
    const pre = reg2.slice(0, 4).map((t) => t.name), slots = Array(64).fill(null);
    // D1 → D2 の順に、ばらばらの場所へ
    const place = (list) => { const n = list.length; shuffle(list).forEach((t, k) => { let i = Math.floor((k * 64) / n); while (slots[i] !== null) i = (i + 1) % 64; slots[i] = t.name; }); };
    place(all.filter((t) => t.lg === 'd1')); place(all.filter((t) => t.lg === 'd2'));
    const free = () => { const f = slots.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0); return f[Math.floor(r() * f.length)]; };
    const preSlots = [free()]; slots[preSlots[0]] = '#pre0'; preSlots.push(free()); slots[preSlots[1]] = '#pre1';
    const rest = shuffle(all.filter((t) => t.lg !== 'd1' && t.lg !== 'd2' && !pre.includes(t.name)));
    for (const t of rest) slots[free()] = t.name;
    save.cup = { season: save.season, ver: 3, round: 0, bracket: slots.slice(), slots, pre: [[pre[0], pre[1]], [pre[2], pre[3]]], preSlots, log: [], hist: [], champion: null, alive: all.map((t) => t.name), waiting: [], bye: null };
    save.cup.pairs = save.cup.pre.map((x) => x.slice());
  }
  // カップ戦（CPU同士）：力の差がはっきり出る。準決勝はほぼD1、ときどきD2のジャイアントキリング
  function cupScore(r, la, lb) {
    const pois = (m) => { let k = 0, p = Math.exp(-m), s = p, u = r(); while (u > s && k < 9) { k++; p *= m / k; s += p; } return k; };
    const d = (la - lb) / 3.6;
    return [pois(clamp(1.3 + d * 0.9, 0.12, 6)), pois(clamp(1.3 - d * 0.9, 0.12, 6))];
  }
  const cupRoundLabel = (cup) => CUP_LABELS[cup.round] || `${cup.round}回戦`;
  const cupIn = (cup, name) => !cup.champion && (cup.round === 0 ? cup.alive.includes(name) : cup.slots.includes(name));
  // カップの1回戦分を決着させる（自分の試合の結果があれば使う）
  function resolveCupRound(save, my) {
    const cup = save.cup, r = rng(save), me = save.team.name;
    const hist = { label: cupRoundLabel(cup), week: CUP_WEEKS[cup.round], round: cup.round, games: [] };
    const play = (a, b) => {
      let w, s = null, pk = false;
      if (my && (a === me || b === me)) { w = my.win ? me : (a === me ? b : a); if (my.s) s = a === me ? my.s.slice() : [my.s[1], my.s[0]]; pk = !!my.pk; }
      else { const la = lvlOf(save, a), lb = lvlOf(save, b); s = cupScore(r, la, lb); w = koWinner(r, la, lb, s) ? b : a; pk = s[0] === s[1]; addGoals(save, 'cup', a, s[0], r); addGoals(save, 'cup', b, s[1], r); }
      hist.games.push({ a, b, s, w, pk });
      return w;
    };
    if (cup.round === 0) {
      cup.pre.forEach(([a, b], k) => { const w = play(a, b); cup.slots[cup.preSlots[k]] = w; cup.bracket[cup.preSlots[k]] = w; });
    } else {
      const next = [];
      for (let k = 0; k < cup.slots.length; k += 2) next.push(play(cup.slots[k], cup.slots[k + 1]));
      cup.slots = next;
    }
    cup.hist.push(hist);
    cup.round++;
    cup.alive = cup.slots.slice();
    if (cup.slots.length === 1) { cup.champion = cup.slots[0]; cup.pairs = []; }
    else { cup.pairs = []; for (let k = 0; k < cup.slots.length; k += 2) cup.pairs.push([cup.slots[k], cup.slots[k + 1]]); }
  }

  // ---------- シーズン終盤（1月1週。地域2部の親善試合の決勝だけ1月2週）----------
  // ・地域2部 東西親善試合：東西の地域2部の1位・2位。昇格には関係ない親善試合（準決勝 → 決勝）
  // ・D3昇格トーナメント：東西の地域1部の1位・2位。1試合で、勝った2チームがD3へ
  // ・D3/D2入れ替え戦：D3の2位 vs D2の13位
  // ・D1/D2入れ替え戦：D2 1位 vs D1 12位、D2 2位 vs D1 11位（v746。前は4チーム総当たりの「D1昇格リーグ」）
  function setupPost(save) {
    const r = rng(save), fin = {};
    for (const lg of LEAGUES) { const ot = save.lgs && save.lgs[lg.id]; fin[lg.id] = lg.id === myLgId(save) ? standings(save).map((t) => t.name) : ot && ot.round >= ot.rounds.length ? leagueTable(save, lg.id).rows.map((t) => t.name) : simLeague(save, lg.id, r); }
    const post = { fin, events: [], matches: [] };
    const ko = (comp, label, a, b, wk, next) => post.matches.push({ comp, label, a, b, week: wk, ko: true, next });
    /* v746：1月1週で昇格・降格をすべて決める（本家のように）。地域2部の東西親善試合だけ、1月2週に決勝 */
    // 地域2部 東西親善試合（準決勝 → 決勝）
    ko('地域2部 東西親善試合', '準決勝', fin.regE2[0], fin.regW2[1], POST_WEEKS[0], '地域2部 東西親善試合:F'); ko('地域2部 東西親善試合', '準決勝', fin.regW2[0], fin.regE2[1], POST_WEEKS[0], '地域2部 東西親善試合:F');
    // D3昇格トーナメント：地域1部の東西1・2位。1試合で、勝った2チームがD3へ（決勝はなし）
    ko('D3昇格トーナメント', '準決勝', fin.regE1[0], fin.regW1[1], POST_WEEKS[0], null); ko('D3昇格トーナメント', '準決勝', fin.regW1[0], fin.regE1[1], POST_WEEKS[0], null);
    ko('D3/D2入れ替え戦', '入れ替え戦', fin.d3[1], fin.d2[12], POST_WEEKS[0], null);
    // D1/D2入れ替え戦：D2 1位 vs D1 12位、D2 2位 vs D1 11位。勝った方が来季D1
    ko('D1/D2入れ替え戦', '入れ替え戦', fin.d2[0], fin.d1[11], POST_WEEKS[0], null); ko('D1/D2入れ替え戦', '入れ替え戦', fin.d2[1], fin.d1[10], POST_WEEKS[0], null);
    save.post = post;
  }
  // 終盤の試合を1つ決着させる
  function settlePost(save, m, s) {
    const post = save.post, r = rng(save);
    m.s = s; m.done = true;
    if (m.a !== save.team.name && m.b !== save.team.name) { addGoals(save, 'post', m.a, s[0], r); addGoals(save, 'post', m.b, s[1], r); }
    if (m.rr) { const lg = { teams: post.playoff }; record(lg, post.playoff.findIndex((t) => t.name === m.a), post.playoff.findIndex((t) => t.name === m.b), s[0], s[1]); return; }
    m.w = koWinner(r, lvlOf(save, m.a), lvlOf(save, m.b), s) ? m.b : m.a;
    if (m.next) {   // 準決勝の勝者は決勝へ（決勝は12月4週）
      const fin = post.matches.find((x) => x.key === m.next);
      if (fin) fin.b = m.w; else post.matches.push({ comp: m.comp, label: '決勝', key: m.next, a: m.w, b: null, week: POST_WEEKS[1], ko: true, next: null });
    }
  }
  function postMatchesAt(save, week) { return save.post ? save.post.matches.filter((m) => m.week === week && !m.done && m.a && m.b) : []; }

  // ---------- 次の自分の公式戦（リーグ・カップ・シーズン終盤）----------
  function nextFixture(save) {
    const me = save.team.name, list = [];
    const lg = save.league;
    if (lg.round < lg.rounds.length) {
      const pr = lg.rounds[lg.round].find(([a, b]) => lg.teams[a].me || lg.teams[b].me);
      if (pr) { const home = lg.teams[pr[0]].me; list.push({ kind: 'league', comp: lg.name, label: `第${lg.round + 1}節`, round: lg.round + 1, week: lg.weeks[lg.round], home, opp: findTeam(save, lg.teams[home ? pr[1] : pr[0]].name) }); }
    }
    const cup = save.cup;
    if (cup && cupIn(cup, me) && cup.round < CUP_WEEKS.length) {
      const pr = cup.pairs.find(([a, b]) => a === me || b === me);
      if (pr) list.push({ kind: 'cup', comp: '国内カップ', label: cupRoundLabel(cup), week: CUP_WEEKS[cup.round], home: pr[0] === me, opp: findTeam(save, pr[0] === me ? pr[1] : pr[0]) });
    }
    if (save.post) for (const m of save.post.matches) if (!m.done && m.a && m.b && (m.a === me || m.b === me)) list.push({ kind: 'post', comp: m.comp, label: m.label, week: m.week, home: m.a === me, opp: findTeam(save, m.a === me ? m.b : m.a), m });
    if (!list.length) return null;
    list.sort((x, y) => x.week - y.week);
    const fx = list[0]; fx.weeksLeft = Math.max(0, fx.week - save.week);
    return fx;
  }
  // 公式戦の結果を反映
  /* v747 賞金：シーズン中にためて、シーズンが終わった時にまとめてコインで受け取る */
  const PRIZE_LG = [30, 60, 120, 200, 300];   /* v748：多すぎたので約3分の1に */   // リーグの格ごとの順位賞金（優勝の額。順位が下がるほど少なく）
  const PRIZE_UP = [0, 100, 150, 250, 500];     // 昇格ボーナス（上がった先のリーグ）
  /* v762：リーグの賞金を足して、たまった賞金をまとめて払う */
  function payPrize(save, fromId, pos, n0, toId) {
    const t0 = LG[fromId].tier, base = PRIZE_LG[t0] || 100;
    addPrize(save, `${LG[fromId].name} ${pos}位`, Math.round(base * Math.max(0.2, 1 - (pos - 1) / Math.max(1, n0 - 1) * 0.8) / 10) * 10);
    if (pos === 1) addPrize(save, `${LG[fromId].name} 優勝ボーナス`, base);
    if (toId && LG[toId].tier > t0) addPrize(save, `${LG[toId].name}へ昇格ボーナス`, PRIZE_UP[LG[toId].tier] || 0);
    const pz = save.prize && save.prize.season === save.season ? save.prize.items.filter((x) => x.coins > 0) : [], total = pz.reduce((a, x) => a + x.coins, 0);
    earnCoins(save, total); save.lastPrize = { season: save.season, items: pz, total }; save.prize = null; save.prizePaid = save.season;
    return save.lastPrize;
  }
  /* v762：シーズンの終わり＝自分の1月の試合（入れ替え戦・親善試合など）がすべて終わった時。結果と来季のリーグ、賞金をまとめる */
  function seasonWrapTick(save, out) {
    if (save.wrapped === save.season || save.week <= POST_WEEKS[0] || save.week > SEASON_WEEKS) return;
    const lg = save.league; if (!lg || lg.round < lg.rounds.length || !save.post) return;
    const me = save.team.name; if (save.post.matches.some((m) => !m.done && (m.a === me || m.b === me))) return;
    const nx = myNextLg(save); if (!nx) return;
    const st = standings(save), pos = st.findIndex((t) => t.me) + 1, id = myLgId(save);
    save.wrapped = save.season;
    const prize = save.prizePaid === save.season ? null : payPrize(save, id, pos, st.length, nx);
    out.seasonEnd = { season: save.season, pos, from: LG[id].name, to: LG[nx].name, fromId: id, toId: nx, fromTier: LG[id].tier, toTier: LG[nx].tier, champ: pos === 1, cup: save.cup && save.cup.champion === me, prize, rec: st[pos - 1] ? { ...st[pos - 1].stats } : null, n: st.length, post: save.post.matches.some((m) => m.a === me || m.b === me) };   // 版834：成績と、1月の試合（入れ替え戦など）に出たか
  }
  function addPrize(save, label, coins) {
    if (!save.prize || save.prize.season !== save.season) save.prize = { season: save.season, items: [] };
    const it = save.prize.items.find((x) => x.label === label); if (it) it.coins += coins; else save.prize.items.push({ label, coins });
    return coins;
  }
  function playFixture(save, fx, myScore, playedIdx) {
    const r = rng(save), win = myScore[0] > myScore[1] ? true : myScore[0] < myScore[1] ? false : null;
    const out = { kind: fx.kind, comp: fx.comp, label: fx.label };
    if (fx.kind === 'league') { finishRound(save, myScore, playedIdx); return out; }
    afterPlayed(save, playedIdx, r, false);
    if (fx.kind === 'cup') {
      let w = win; if (w === null) { w = koWinner(r, teamLevel(save), fx.opp.lvl, [0, 0]) === 0; out.pk = true; }
      out.win = w; save.cup.log.push({ label: fx.label, opp: fx.opp.name, s: myScore, win: w, pk: out.pk, week: fx.week });
      resolveCupRound(save, { win: w, s: myScore, pk: out.pk });
      if (w) { out.prize = addPrize(save, '国内カップ', 5 + save.cup.round * 3); if (save.cup.champion === save.team.name) out.prize += addPrize(save, '国内カップ 優勝', 100); }
      out.champion = save.cup.champion === save.team.name;
      return out;
    }
    const m = fx.m, s = m.a === save.team.name ? myScore : [myScore[1], myScore[0]];
    settlePost(save, m, s);
    if (m.ko) { out.win = m.w === save.team.name; out.pk = myScore[0] === myScore[1]; if (out.win) out.prize = addPrize(save, m.comp, m.label === '決勝' ? 20 : 10); if (out.win && m.label === '決勝') out.champion = true; }
    else if (win) out.prize = addPrize(save, m.comp, 10);
    return out;
  }
  // 練習試合（公式戦のない週だけ。カードは2〜4枚）
  // チームのエンブレム（旗・ユニフォームに使う）：チームごとに色・形・模様・マークが決まる
  const EMB_COLS = [['#1f4fbf', '#e23b2b'], ['#0f7a3a', '#ffd23a'], ['#6a1fb0', '#ffffff'], ['#d9541e', '#1a1a1a'], ['#1a8fd0', '#ffffff'], ['#c41e3a', '#ffd23a'], ['#222222', '#e8e8e8'], ['#2f9e44', '#ffffff'], ['#f2b51c', '#1f3f8f'], ['#d94a7a', '#2a2a6a'], ['#0e5e6e', '#f2c94c'], ['#8b1e2e', '#f0e0b0'], ['#3a6fd8', '#ffd23a'], ['#5a2a8a', '#ffb020'], ['#e86a1a', '#ffffff'], ['#14467a', '#7fd0ff']];
  const EMB_ICONS = ['ball', 'star', 'wave', 'crown', 'bolt', 'wing'];
  function teamLook(save, name) {
    if (!name || name === save.team.name) { const e = ensureClub(save).emb; return { ...e, ch: e.ch || (save.team.short || save.team.name || 'H')[0], me: true }; }
    if (GUESTS[name] && GUESTS[name].emb) { const e = GUESTS[name].emb; return { ...e, ch: e.ch || (GUESTS[name].short || name)[0] }; }
    const t = findTeam(save, name) || { seed: [...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0, short: name };
    let x = (t.seed * 2654435761 + 12345) >>> 0; const r = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return ((x ^ (x >>> 15)) >>> 0) / 4294967296; };
    const [c1, c2] = EMB_COLS[Math.floor(r() * EMB_COLS.length)];
    const m = TEAM_BY_ID[t.id] || TEAMS.find((x) => x.name === name);
    const sh = Math.floor(r() * 3), pat = Math.floor(r() * 4), ic = EMB_ICONS[Math.floor(r() * EMB_ICONS.length)];
    if (m) return { c1: m.c1, c2: m.c2, shape: sh, pat, icon: m.icon || ic, ch: (m.short || name)[0], id: m.id };   // 固定チーム：イメージカラーで
    return { c1, c2, shape: sh, pat, icon: ic, ch: (t.short || name)[0] };
  }
  // ---------- 国内屈指（タイプごとに国内でいちばんの選手）----------
  //  最初は rosters.js の11人。シーズンが終わるたびに、自分の選手がそのタイプの「大事な能力」の合計で上回っていたら、称号が移る
  //  （CPUの選手は能力が変わらないので、自分の選手が育つほど国内屈指になれる。自分の選手が衰えたら、元の選手に戻ることもある）
  const TOP_KEYS = {   // そのタイプに大事な能力（国内屈指の選手がSの能力）
    'ストライカー': 'SSAASSASSCSS', 'アタッカー': 'ASSASSABBCAS', 'ゲームメイカー': 'ASSSBAACCCSS', 'パサー': 'SSASAAABBBSA', 'レジスタ': 'ASASBBABBASS',
    'ダイナモ': 'AAAAASSABAAS', 'スイーパー': 'CABAAAASSSSS', 'ストッパー': 'CBCBAAASSSAS', 'マンマーカー': 'CABBSSSAASAA', 'ラインコントローラー': 'CABSAAAASSSS', 'ゴールキーパー': 'BBCABSAASASS',
    '偽9番': 'ASASBBABCCSS', 'デコイラン': 'BAABSSSABCAS', 'ファンタジスタ': 'ASSSAABCCCSA', 'シャドー': 'SAABSSABACAS', 'アンカー': 'BACABASSASSS', 'ビルドアップ型': 'AABSBBAAASSS', 'スイーパーキーパー': 'ABCASSAASASS',
  };
  const K12 = ['kick', 'technique', 'dribble', 'pass', 'speed', 'dash', 'stamina', 'physical', 'jump', 'defense', 'vision', 'mental'];
  const topScore = (type, p) => [...(TOP_KEYS[type] || '')].reduce((a, ch, j) => a + (ch === 'S' ? (p[K12[j]] || 0) : ch === 'A' ? (p[K12[j]] || 0) * 0.3 : 0), 0);
  function ensureTitles(save) {
    const t = save.titles || (save.titles = {});
    // 国内屈指がまだ記録されていないタイプ（あとから増えたタイプも）は、最初の持ち主を入れる
    for (const id in ROSTERS) for (const q of ROSTERS[id].players) if (q.top && !t[q.top]) t[q.top] = { id, name: q.name, orig: { id, name: q.name } };
    return t;
  }
  function titleOf(save, teamId, name) { const t = ensureTitles(save); for (const k in t) if (t[k].id === teamId && t[k].name === name) return k; return null; }
  function evalTitles(save) {
    // 国内屈指：最初の持ち主（CPUの選手は能力が変わらない）と、自分の同じタイプの選手を比べる。今の持ち主は少しだけ有利
    const t = ensureTitles(save), out = [];
    /* v764：国内屈指は入れ替わらない（ガチャの18人だけの称号）。前に自分の選手が持っていたら、元の持ち主に戻す */
    for (const type in t) { const cur = t[type]; if (cur.orig && (cur.id !== cur.orig.id || cur.name !== cur.orig.name)) t[type] = { id: cur.orig.id, name: cur.orig.name, orig: cur.orig }; }
    if (t) return out;
    for (const type in t) {
      const cur = t[type], o = cur.orig, oq = ROSTERS[o.id] && ROSTERS[o.id].players.find((q) => q.name === o.name);
      let best = { id: o.id, name: o.name, sc: oq ? topScore(type, oq) * (cur.id === o.id ? 1.02 : 1) : 0 };
      for (const p of save.team.players) if (p.type === type) { const sc = topScore(type, p) * (cur.id === 'me' && cur.name === p.name ? 1.02 : 1); if (sc > best.sc) best = { id: 'me', name: p.name, sc }; }
      if (best.id !== cur.id || best.name !== cur.name) {
        out.push({ type, name: best.name, team: best.id === 'me' ? save.team.name : (TEAM_BY_ID[best.id] || {}).name, mine: best.id === 'me', lost: cur.id === 'me' ? cur.name : null });
        t[type] = { id: best.id, name: best.name, orig: o };
      }
    }
    return out;
  }


  // ---------- 自分のクラブ：名前・ユニフォーム・エンブレム（クラブ設定で変えられる）----------
  const KIT_DEFAULT = { pat: 'solid', shirt: '#2f6fd6', sub: '#ffffff', shorts: '#ffffff', socks: '#2f6fd6' };
  const EMB_DEFAULT = { shape: 0, pat: 1, icon: 'ball', c1: '#1f5fd0', c2: '#ffd23a', c3: '#ffffff', ch: '' };
  function ensureClub(save) {
    if (!save.club) save.club = { kit: { ...KIT_DEFAULT }, emb: { ...EMB_DEFAULT } };
    save.club.kit = { ...KIT_DEFAULT, ...save.club.kit }; save.club.emb = { ...EMB_DEFAULT, ...save.club.emb };
    if (!save.club.kit2) { const k = save.club.kit; save.club.kit2 = { pat: 'solid', shirt: '#f4f4f0', sub: k.shirt, shorts: k.shirt, socks: '#f4f4f0' }; }   // アウェーのユニフォーム（はじめは白）
    if (!save.club.gk) save.club.gk = { pat: 'solid', shirt: '#f2c230', sub: '#2a2a2a', shorts: '#2a2a2a', socks: '#f2c230' };   // 版651：GKのユニフォーム
    return save.club;
  }
  // クラブ名を変える：セーブの中の「自分のチーム名」をすべて置きかえる（順位表・カップ・記録）
  function renameClub(save, name, short) {
    name = String(name || '').trim().slice(0, 12); short = String(short || '').trim().slice(0, 6);
    if (!name) return false;
    if (TEAMS.some((t) => t.name === name)) return false;   // ほかのチームと同じ名前はだめ
    const old = save.team.name;
    if (name !== old) {
      const club = save.club, world = save.world; delete save.club; delete save.world;
      let js = JSON.stringify(save); js = js.split(JSON.stringify(old)).join(JSON.stringify(name));
      const nw = JSON.parse(js); for (const k in nw) save[k] = nw[k];
      save.club = club; save.world = world;
      if (save.history) for (const h of save.history) if (h.club === old) h.club = name;
    }
    save.team.name = name; save.team.short = short || name.replace(/FC$|SC$/, '').slice(0, 6);
    return true;
  }
  // 試合のユニフォーム：相手と色がかぶったら、相手は2着目（サブの色か白）
  const colDist = (a, b) => { const x = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), y = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)); return Math.hypot(x[0] - y[0], (x[1] - y[1]) * 1.2, x[2] - y[2]); };
  // 相手のホーム・アウェー（アウェーはサブの色を地にした無地）
  function oppKits(save, oppName) {
    const t = findTeam(save, oppName), ro = t && (t.guest ? (t.kit ? { kit: t.kit } : null) : ROSTERS[t.id]);
    const home = ro ? { ...ro.kit } : { pat: 'solid', shirt: '#e2453a', sub: '#ffffff', shorts: '#ffffff', socks: '#e2453a' };
    const light = colDist(home.sub || '#ffffff', home.shirt) >= 120 ? (home.sub || '#ffffff') : '#f4f4f0';
    const away = { pat: 'solid', shirt: light, sub: home.shirt, shorts: home.shirt === light ? '#1a1a1a' : home.shirt, socks: light };
    return { home, away };
  }
  function kitsFor(save, oppName, sel, oppSel) { const r = kitsFor0(save, oppName, sel, oppSel); r[0] = { ...r[0], gk: { ...ensureClub(save).gk } }; return r; }   // 版651：自分のGKのユニフォームもつける
  function kitsFor0(save, oppName, sel, oppSel) {
    const cl = ensureClub(save); let mine = { ...(sel === 'away' ? cl.kit2 : cl.kit) };
    if (!sel || sel === 'auto') { const t0 = findTeam(save, oppName), r0 = t0 && (t0.guest ? (t0.kit ? { kit: t0.kit } : null) : ROSTERS[t0.id]); if (r0 && colDist(mine.shirt, r0.kit.shirt) < 120 && colDist(cl.kit2.shirt, r0.kit.shirt) >= 120) mine = { ...cl.kit2 }; }   // おまかせ：相手と色がかぶったらアウェー
    const t = findTeam(save, oppName), ro = t && (t.guest ? (t.kit ? { kit: t.kit } : null) : ROSTERS[t.id]);
    let opp = ro ? { ...ro.kit } : { pat: 'solid', shirt: '#e2453a', sub: '#ffffff', shorts: '#ffffff', socks: '#e2453a' };
    if (oppSel === 'home' || oppSel === 'away') return [mine, { ...oppKits(save, oppName)[oppSel] }];   // 版482：相手のユニフォームも選べる
    if (colDist(mine.shirt, opp.shirt) < 120) {
      const alt = colDist(mine.shirt, opp.sub) >= 120 ? opp.sub : colDist(mine.shirt, '#f4f4f0') >= 120 ? '#f4f4f0' : '#1a1a1a';
      opp = { pat: 'solid', shirt: alt, sub: opp.shirt, shorts: alt === '#f4f4f0' ? opp.shirt : '#f4f4f0', socks: alt };
    }
    return [mine, opp];
  }
  // ほかのチーム同士（D1観戦）のユニフォーム：アウェイの色がかぶったら替える
  function kitsPair(save, A, B) {
    const k = (n) => { const t = findTeam(save, n), ro = t && ROSTERS[t.id]; return ro ? { ...ro.kit } : { pat: 'solid', shirt: '#e2453a', sub: '#ffffff', shorts: '#ffffff', socks: '#e2453a' }; };
    const a = k(A); let b = k(B);
    if (colDist(a.shirt, b.shirt) < 120) { const alt = colDist(a.shirt, b.sub) >= 120 ? b.sub : colDist(a.shirt, '#f4f4f0') >= 120 ? '#f4f4f0' : '#1a1a1a'; b = { pat: 'solid', shirt: alt, sub: b.shirt, shorts: alt === '#f4f4f0' ? b.shirt : '#f4f4f0', socks: alt }; }
    return [a, b];
  }
  // 練習試合の申し込み一覧（週ごとに決まる）：実力の近いチームが中心。ときどき、日程の空いた格上が受けてくれる
  function practiceOptions(save) {
    const key = wkKey(save);
    // 版792：順位は、ほかのリーグの相手も、そのリーグでの今の順位を出す（開くたびに新しい順位で）
    const rankOf = (t) => { try { const tb = leagueTable(save, t.lg); const k = tb ? tb.rows.findIndex((x) => x.name === t.name) : -1; return k >= 0 ? k + 1 : 0; } catch (e) { return 0; } };
    if (save.practiceOpts && save.practiceOpts.key === key) return save.practiceOpts.list.map((t) => ({ ...t, rank: rankOf(t) }));
    let s0 = (save.season * 977 + save.week * 131 + 7) >>> 0;
    const r = () => { s0 = (Math.imul(s0, 1664525) + 1013904223) >>> 0; let x = s0 ^ (s0 >>> 16); x = Math.imul(x, 0x45d9f3b) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
    const me = teamLevel(save), myLg = myLgId(save), myTier = LG[myLg].tier;
    const all = [];
    for (const lg of LEAGUES) for (const t of save.world.leagues[lg.id] || []) all.push({ ...t, lg: lg.id, tier: lg.tier });
    const nf = nextFixture(save), busy = new Set(nf && nf.week <= save.week && nf.opp ? [nf.opp.name] : []);
    // 近い実力（同じリーグ＋前後のリーグで、強さの差が小さい順）
    const region = save.world.region;
    const near = all.filter((t) => !busy.has(t.name) && Math.abs(t.tier - myTier) <= 1 && t.lvl <= me + 7 && !(t.tier <= 1 && t.region && t.region !== region))
      .map((t) => ({ t, d: Math.abs(t.lvl - me) + (t.lg === myLg ? -5 : 0) + r() * 5 })).sort((a, b) => a.d - b.d).slice(0, 5).map((x) => x.t);
    const list = near.slice();
    // 格上：そのリーグが今週お休みのときだけ、ときどき
    if (r() < 0.5) {
      const strong = all.filter((t) => t.tier > myTier && t.lvl >= me + 8 && !list.includes(t) && !leagueWeeks(2 * (LG[t.lg].size - 1), t.lg).includes(save.week));
      if (strong.length) list.push(strong[Math.floor(r() * strong.length)]);
    }
    const out = list.map((t) => ({ name: t.name, short: t.short, lg: t.lg, rank: 0, strong: t.lvl >= me + 8 }));
    save.practiceOpts = { key, list: out };
    return out.map((t) => ({ ...t, rank: rankOf(t) }));
  }
  function practiceOpponent(save) {
    const pool = save.world.leagues[myLgId(save)], r = rng(save);
    return { ...pool[Math.floor(r() * pool.length)], lg: myLgId(save) };
  }
  function playPractice(save, myScore, playedIdx, oppName) {
    const r = rng(save); afterPlayed(save, playedIdx, r, true);
    const got = rewardCards(save, myScore, null, null, oppName, playedIdx, true);   // 版809：公式戦と同じ決め方（前半だけなので2枚少ない）
    got.coins = 0; save.practicedAt = wkKey(save);
    return got;
  }
  // 週の終わり：自分の関わらない試合（カップ・終盤）を決着させる
  function settleWeek(save) {
    const w = save.week, out = [];
    ensureOthers(save); advanceOthers(save, w);
    const ci = CUP_WEEKS.indexOf(w);
    if (save.cup && !save.cup.champion && ci === save.cup.round) {
      const wasIn = cupIn(save.cup, save.team.name);
      resolveCupRound(save, null);
      if (wasIn && !cupIn(save.cup, save.team.name)) out.push('cupOut');
    }
    if (w === LEAGUE_TO && !save.post) setupPost(save);
    for (const m of postMatchesAt(save, w)) { const s = quickScore(rng(save), lvlOf(save, m.a), lvlOf(save, m.b)); settlePost(save, m, s); }
    return out;
  }

  // シーズン終了（2月4週のあと）：昇格・降格して、次のシーズンを作る
  function endSeason(save) {
    if (!save.post) setupPost(save);
    for (const m of save.post.matches) if (!m.done && m.a && m.b) settlePost(save, m, quickScore(rng(save), lvlOf(save, m.a), lvlOf(save, m.b)));
    const r = rng(save), W = save.world.leagues, fin = save.post.fin, me = save.team.name;
    const pos = fin[myLgId(save)].indexOf(me) + 1, fromId = myLgId(save);
    // 全チームの所属（自分も含む名前のリスト）
    const lists = {}; for (const id in fin) lists[id] = fin[id].slice();
    const move = (name, from, to) => { lists[from] = lists[from].filter((n) => n !== name); lists[to].push(name); };
    /* 地域2部 ⇄ 地域1部（東西それぞれ）：1位が自動昇格、地域1部の最下位が降格。1月の東西親善試合は昇格に関係ない */
    for (const [two, one] of [['regE2', 'regE1'], ['regW2', 'regW1']]) { const up = fin[two][0], down = fin[one][fin[one].length - 1]; move(up, two, one); move(down, one, two); }
    // D3昇格トーナメント：決勝の2チームがD3へ。D3の下位2チームは地域1部へ
    const semis = save.post.matches.filter((m) => m.comp === 'D3昇格トーナメント' && m.label === '準決勝' && m.w);
    const promo = semis.length === 2 ? semis.map((m) => m.w) : [fin.regE1[0], fin.regW1[0]];
    for (const n of promo) move(n, lists.regE1.includes(n) ? 'regE1' : 'regW1', 'd3');
    for (const n of fin.d3.slice(-2)) { const t = findTeam(save, n); move(n, 'd3', (t && t.region) === 'E' ? 'regE1' : 'regW1'); }
    // D3→D2：1位は自動昇格、2位はD2の13位と入れ替え戦。D2の最下位は自動降格
    move(fin.d3[0], 'd3', 'd2'); move(fin.d2[13], 'd2', 'd3');
    const ex = save.post.matches.find((m) => m.comp === 'D3/D2入れ替え戦');
    if (ex && ex.w === fin.d3[1]) { move(fin.d3[1], 'd3', 'd2'); move(fin.d2[12], 'd2', 'd3'); }
    // D1昇格リーグ：上位2チームがD1、下位2チームがD2
    if (save.post.playoff) {   /* 版745までのセーブ（D1昇格リーグ）：上位2チームがD1 */
      const pl = save.post.playoff.slice().sort((x, y) => y.stats.Pts - x.stats.Pts || (y.stats.GF - y.stats.GA) - (x.stats.GF - x.stats.GA));
      pl.forEach((t, k) => { const cur = lists.d1.includes(t.name) ? 'd1' : 'd2', to = k < 2 ? 'd1' : 'd2'; if (cur !== to) move(t.name, cur, to); });
    } else for (const m of save.post.matches.filter((x) => x.comp === 'D1/D2入れ替え戦' && x.w)) {   /* v746：D1/D2入れ替え戦の勝者がD1 */
      const d2t = lists.d2.includes(m.a) ? m.a : m.b, d1t = d2t === m.a ? m.b : m.a;
      if (m.w === d2t) { move(d2t, 'd2', 'd1'); move(d1t, 'd1', 'd2'); }
    }
    /* 地域2部の東西を6チームずつにそろえる（あふれた方から移す） */
    for (let guard = 0; guard < 6 && lists.regE2.length !== lists.regW2.length; guard++) {
      const [big, small] = lists.regE2.length > lists.regW2.length ? ['regE2', 'regW2'] : ['regW2', 'regE2'];
      const n = lists[big].filter((x) => x !== me).pop(); move(n, big, small);
    }
    // 地域1部の東西を8チームずつにそろえる（あふれた方から移す）
    for (let guard = 0; guard < 6 && lists.regE1.length !== lists.regW1.length; guard++) {
      const [big, small] = lists.regE1.length > lists.regW1.length ? ['regE1', 'regW1'] : ['regW1', 'regE1'];
      const n = lists[big].filter((x) => x !== me).pop(); move(n, big, small);
    }
    // 新しい世界：AIチームは少しずつ強さが変わる
    const all = {}; for (const id in W) for (const t of W[id]) all[t.name] = t;
    const nw = {}; let myNew = fromId;
    for (const id in lists) {
      nw[id] = [];
      for (const n of lists[id]) {
        if (n === me) { myNew = id; continue; }
        const t = all[n]; if (!ROSTERS[t.id]) t.lvl = clamp(t.lvl + Math.floor(r() * 4) - 1, 30, 92); if (LG[id].region) t.region = LG[id].region; nw[id].push(t);
      }
    }
    save.world.leagues = nw; save.world.me = myNew; if (LG[myNew].region) save.world.region = LG[myNew].region;
    const up = LG[myNew].tier > LG[fromId].tier, down = LG[myNew].tier < LG[fromId].tier;
    if (save.prizePaid !== save.season) payPrize(save, fromId, pos, fin[fromId].length, myNew);   /* v762：ふつうは1月の試合が終わった時に払い済み */
    else save.lastPrize = null;
    const msg = up ? `${pos}位！${LG[myNew].name}へ昇格！` : down ? `${pos}位…${LG[myNew].name}へ降格` : LG[fromId].tier === 4 && pos === 1 ? 'D1リーグ優勝！！' : `${pos}位。${LG[fromId].name}に残留`;
    { const rec = (() => { const t = (save.league && save.league.teams || []).find((x) => x.name === me); return t ? { ...t.stats } : null; })();   // 版834：監督成績用に、成績・リーグの数・行き先も残す
      save.history.push({ season: save.season, league: LG[fromId].name, lgId: fromId, pos, n: (fin[fromId] || []).length || 0, msg, move: up ? 'up' : down ? 'dn' : 'st', to: LG[myNew].name, rec, club: save.team.name, cup: save.cup && save.cup.champion === me ? '国内カップ優勝' : '' }); }
    save.season++; save.week = 1; save.post = null;
    for (const id in save.world.leagues) for (const t of save.world.leagues[id]) if (ROSTERS[t.id]) t.lvl = lvlAt(t.id, save.season);   // 選手の成長・引退で強さが変わる
    for (const p of save.team.players) { p.fatigue = 0; p.injury = 0; }
    newLeague(save); newCup(save);
    return msg;
  }

  // ---------- 戦術：フォーメーションとチーム戦術 ----------
  const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-5-1', '4-4-1-1', '3-5-2', '3-4-3', '3-4-2-1', '5-3-2', '5-4-1'];
  // 戦術の項目：key, 名前, 選択肢（値と名前）, 説明
  const TACTIC_ITEMS = [
    { key: 'line', name: 'ラインの高さ', opts: [[1, '深く'], [2, 'やや深く'], [3, 'ふつう'], [4, 'やや高く'], [5, '高く']], desc: '高いほど前でボールを奪えるが、裏を取られやすい' },
    { key: 'width', name: '横の幅', opts: [[1, '狭く'], [2, 'やや狭く'], [3, 'ふつう'], [4, 'やや広く'], [5, '広く']], desc: '広いとピッチを大きく使える。狭いと中央が固い' },
    { key: 'compact', name: '縦の間隔', opts: [[1, '広く'], [2, 'ふつう'], [3, 'コンパクト']], desc: 'コンパクトだと守りが固いが、走る量が増える' },
    { key: 'attitude', name: '攻撃の姿勢', opts: [['defensive', '守備的'], ['balanced', 'バランス'], ['attacking', '攻撃的']], desc: '攻撃的だとシュートが増え、守備的だと奪ってからの速攻が増える' },
    { key: 'press', name: 'プレス', opts: [[-1, '控えめ'], [0, 'ふつう'], [1, '前から']], desc: '前からだとボールを奪いやすいが、疲れやすい' },
    { key: 'pass', name: 'パスの方針', opts: [[-1, 'つなぐ'], [0, 'バランス'], [1, '縦に速く']], desc: 'つなぐと確実、縦に速くだとスルーパスや速攻が増える' },
    { key: 'side', name: '攻める場所', opts: [[-1, '中央'], [0, 'バランス'], [1, 'サイド']], desc: 'サイドだとクロスが増える。中央だと短いパスで崩す' },
  ];
  // サッカーを知らなくても選べる「戦い方」：選ぶと全部の項目がそろう
  const STYLES = [
    { id: 'balance', name: 'バランス', desc: '攻守のバランスがよい、基本の戦い方', formation: '4-4-2', t: { line: 3, width: 3, compact: 2, attitude: 'balanced', press: 0, pass: 0, side: 0 } },
    { id: 'counter', name: '堅守速攻', desc: '深く守って、奪ったら一気に前へ', formation: '4-5-1', t: { line: 2, width: 2, compact: 3, attitude: 'defensive', press: -1, pass: 1, side: 0 } },
    { id: 'possession', name: 'ポゼッション', desc: 'パスをつないでボールを持ち続ける', formation: '4-3-3', t: { line: 4, width: 4, compact: 2, attitude: 'balanced', press: 0, pass: -1, side: -1 } },
    { id: 'highpress', name: 'ハイプレス', desc: '前からどんどん奪いに行く（疲れやすい）', formation: '4-4-2', t: { line: 5, width: 3, compact: 3, attitude: 'attacking', press: 1, pass: 1, side: 0 } },
    { id: 'wing', name: 'サイド攻撃', desc: 'サイドを広く使って、クロスで勝負', formation: '4-3-3', t: { line: 3, width: 5, compact: 2, attitude: 'balanced', press: 0, pass: 0, side: 1 } },
  ];
  // マス目：縦10マス（行0〜2 DF・3〜6 MF・7〜9 FW）×横15マス。代表的なフォーメーションは最初の形の見本
  const GRID_R = 10, GRID_C = 15;
  const zoneOf = (r) => (r <= 2 ? 'DF' : r <= 6 ? 'MF' : 'FW');
  function cellsFor(formation) {
    const lines = String(formation).split('-').map(Number), rows = lines.length === 3 ? [1, 4, 8] : lines.length === 4 ? [1, 3, 5, 8] : [1, 3, 4, 6, 8];
    const out = [null];
    lines.forEach((n, li) => { const sp = n > 1 ? Math.min(4, 12 / (n - 1)) : 0; for (let k = 0; k < n; k++) out.push({ r: rows[li], c: Math.round(7 + (k - (n - 1) / 2) * sp) }); });
    return out;
  }
  // 今の並びを「4-4-2」のような呼び名にする（ゾーンごとの人数）
  function formationLabel(cells) { const n = { DF: 0, MF: 0, FW: 0 }; for (let i = 1; i < 11; i++) if (cells[i]) n[zoneOf(cells[i].r)]++; return `${n.DF}-${n.MF}-${n.FW}`; }
  function defaultTactics() { const st = STYLES[0]; return { style: st.id, formation: '4-4-2', cells: cellsFor('4-4-2'), roles: {}, ...st.t }; }
  function ensureTactics(save) {
    if (!save.tactics) save.tactics = defaultTactics();
    const t = save.tactics;
    if (!t.cells) t.cells = cellsFor(t.formation || '4-4-2');
    if (!t.roles) t.roles = {};
    if (!t.situ) t.situ = { ...SITU_DEFAULT };
    delete t.adj;
    return t;
  }
  // 状況別の作戦：残り時間になったら、点差に合わせて動きを変える（試合中に自動で切りかわる）
  const SITU_DEFAULT = { from: 70, lead: 'keep', draw: 'keep', behind: 'attack' };
  const SITU_ACTS = [
    ['keep', 'そのまま', 'いつもの戦い方を続ける'],
    ['defend', '守りを固める', '無理に攻めず、ボールを持たせない守備で失点を防ぐ'],
    ['attack', '攻めに出る', '縦へ急ぎ、前からプレスをかける（疲れやすい）'],
    ['allout', '総攻撃', 'DFも上がって全員で点を取りにいく（裏を取られやすく、とても疲れる）'],
  ];
  const SITU_ROWS = [['lead', '勝っている時'], ['draw', '引き分けの時'], ['behind', '負けている時']];
  const SITU_FROM = [[60, '残り30分から'], [70, '残り20分から'], [80, '残り10分から']];
  // フォーメーションの各ポジションが DF・MF・FW のどれか（GK→1列目→…→最前列）
  function slotRoles(formation) {
    if (Array.isArray(formation)) return ['GK', ...formation.slice(1, 11).map((c) => zoneOf(c.r))];   // マス目の配置
    const lines = String(formation).split('-').map(Number);
    const out = ['GK'];
    lines.forEach((n, li) => { for (let k = 0; k < n; k++) out.push(li === 0 ? 'DF' : li === lines.length - 1 ? 'FW' : 'MF'); });
    return out;
  }
  // チーム戦術を試合用のチームに書き込む
  function applyTactics(t, tac) {
    t.formation = tac.formation; t.line_height = tac.line; t.zone_width = tac.width; t.compact = tac.compact;
    t.attitude = tac.attitude; t.press = tac.press; t.pass_style = tac.pass; t.attack_side = tac.side;
    if (tac.cells) t.cells = tac.cells.slice(0, 11);
    if (tac.situ) t.situ = { ...tac.situ };
    return t;
  }
  // 相手チームの戦い方：チームの個性（プリセット）に合わせて
  const PRESET_STYLE = { 'バランス型': ['balance', 'balance', 'wing'], '堅守型': ['counter', 'counter', 'balance'], 'パス型': ['possession', 'possession', 'balance'], 'プレス型': ['highpress', 'highpress', 'balance'], '走力型': ['wing', 'counter', 'wing'], '裏抜け型': ['counter', 'highpress', 'balance'] };
  const STYLE_FORMS = { balance: ['4-4-2', '4-2-3-1', '4-4-1-1'], counter: ['4-5-1', '5-3-2', '4-1-4-1', '5-4-1'], possession: ['4-3-3', '4-2-3-1', '3-4-3'], highpress: ['4-4-2', '4-3-3', '3-4-2-1'], wing: ['4-3-3', '3-5-2', '4-4-2'] };
  // 選手をフォーメーションの列に合わせて並べる（DFの列にはDF、という順で埋める）
  function fitLines(players, formation) {
    const roles = slotRoles(formation), pool = players.slice(), out = [];
    for (const role of roles) {
      let k = pool.findIndex((p) => p.position === role);
      if (k < 0) k = pool.findIndex((p) => p.position !== 'GK');
      if (k < 0) k = 0;
      out.push(pool.splice(k, 1)[0]);
    }
    return [...out, ...pool];
  }
  // 試合用の自チーム（ケガ人は控えと入れ替える）
  const BENCH_N = 7;   // ベンチ入りの控え（カルチョビットAと同じ7人）
  function matchTeam(save) {
    const t = JSON.parse(JSON.stringify(save.team));
    const ps = t.players;
    for (let i = 0; i < 11; i++) {
      if (ps[i].injury > 0 || ps[i].suspend > 0) {   // ケガ・出場停止の選手は、控えと入れ替える
        const ok = (q, k) => k >= 11 && !(q.injury > 0) && !(q.suspend > 0) && (q.position === 'GK') === (ps[i].position === 'GK');
        let j = ps.findIndex((q, k) => k < 11 + BENCH_N && ok(q, k)); if (j < 0) j = ps.findIndex(ok);   // まずベンチ入りの選手から
        if (j > 0) [ps[i], ps[j]] = [ps[j], ps[i]];
      }
    }
    // 疲れている選手は能力が少し落ちる
    for (const p of ps) { p.startCur = 100 - (p.fatigue || 0) * 0.5; const f = p.fatigue > 70 ? 0.92 : p.fatigue > 50 ? 0.96 : 1; for (const k of KEYS) p[k] = Math.round(p[k] * f * (1 + (p.cond || 0) * 0.015)); }
    // 凸の効果：サポートパッシブ（☆2は3凸で付与、☆3は2凸で付与・3凸で強化、☆4は1凸で付与・2凸で強化・3凸で範囲拡大、☆5は2凸で付与・3凸で強化）と、固有スキルの覚醒（☆5の1凸から）
    for (const p of ps) { const st = ensureStar(p), tz = p.totsu || 0; p.passive = st === 2 ? (tz >= 3 ? 1 : 0) : st === 3 ? (tz >= 3 ? 2 : tz >= 2 ? 1 : 0) : st === 4 ? Math.min(3, tz) : st >= 5 ? (tz >= 3 ? 2 : tz >= 2 ? 1 : 0) : 0; if (p.uniq) p.uniqLv = st >= 5 && tz >= 1 ? 2 : 1; }
    const tac = ensureTactics(save);
    applyTactics(t, tac);
    t.roles = {};
    for (const k of ['captain', 'pk', 'fk', 'ck']) { const n = tac.roles[k]; const i = n ? ps.slice(0, 11).findIndex((q) => q.name === n) : -1; if (i >= 0) t.roles[k] = i; }
    t.lgId = myLgId(save);   // 版851：固有スキルの強さ（リーグ）に使う
    t.players = ps.slice(0, 11 + BENCH_N);   // ベンチ入り（控え7人）まで。ベンチ外の選手は試合に出られない
    return { team: t, played: ps.slice(0, 11).map((p) => save.team.players.findIndex((q) => q.name === p.name)) };
  }


  // ================= 育成ポイント（内部の数値）とランク =================
  // 能力は内部で「育成ポイント」を持ち、ランクごとに必要なポイントが増えていく（上ほど伸びにくい）
  //   E 0〜49 / D 50〜149 / C 150〜389 / B 390〜659 / A 660〜989 / S 990〜（最大1280）
  //   E・Dはすぐ上がり、Cから伸び悩み、B→A、A→Sの順に長くなる。毎週特訓して1年でオールC＋ちらほらB、4年でS・A・Bだけ
  // 試合エンジンへは 1〜99 の数値に直して渡す（E〜Sの境目がエンジン側の境目とぴったり合うように）
  const RANK = [['E', 0, 50], ['D', 50, 150], ['C', 150, 390], ['B', 390, 660], ['A', 660, 990], ['S', 990, 1280]];
  const RANK_V2 = [['E', 0, 50], ['D', 50, 150], ['C', 150, 390], ['B', 390, 630], ['A', 630, 910], ['S', 910, 1180]];
  const RANK_OLD = [['E', 0, 100], ['D', 100, 250], ['C', 250, 450], ['B', 450, 700], ['A', 700, 1000], ['S', 1000, 1300]];
  const ENG = [30, 45, 55, 64, 74, 84, 99];
  const PMAX = RANK[RANK.length - 1][2];
  function toEng(pt) { pt = clamp(pt, 0, PMAX); for (let i = 0; i < RANK.length; i++) { const [, a, b] = RANK[i]; if (pt < b || i === RANK.length - 1) return Math.round((ENG[i] + (ENG[i + 1] - ENG[i]) * clamp((pt - a) / (b - a), 0, 1)) * 10) / 10; } return 99; }
  function toPts(v) { v = clamp(v, ENG[0], 99); for (let i = 0; i < RANK.length; i++) { if (v < ENG[i + 1] || i === RANK.length - 1) { const [, a, b] = RANK[i]; return Math.round(a + (b - a) * clamp((v - ENG[i]) / (ENG[i + 1] - ENG[i]), 0, 1)); } } return PMAX; }
  function rankInfo(pt) { const r = RANK.find(([, a, b]) => pt >= a && pt < b) || RANK[5]; return { g: r[0], lo: r[1], hi: r[2], pct: clamp((pt - r[1]) / (r[2] - r[1]), 0, 1), next: r[2] }; }
  function ensurePts(p) { if (!p.pts) p.pts = Object.fromEntries(KEYS.map((k) => [k, toPts(p[k])])); }
  // ---------- ☆（レア度）：育てられるランクの上限を決める ----------
  // ☆1＝オールCまで ☆2＝Bまで ☆3＝Aまで ☆4・☆5＝Sまで。凸（覚醒）1回ごとに上限が1段上がる（Sまで）
  // CPU：国内屈指＝☆5、エース・中心選手＝☆4、そのほかは最初のリーグで D1/D2＝☆3、D3/地域1部＝☆2、地域2部＝☆1
  // 自分のチームの最初の選手：☆1と☆2がまざる（Bの能力をもう持っている選手が☆2）
  const GRADES = ['E', 'D', 'C', 'B', 'A', 'S'];
  function ensureStar(p) {
    if (p.star >= 1 && p.star <= 5) return p.star;
    ensurePts(p);
    p.star = Math.max(...KEYS.map((k) => p.pts[k] || 0)) >= RANK[3][1] ? 2 : 1;   // もうBの能力がある選手は☆2、それ以外は☆1
    p.totsu = p.totsu || 0;
    return p.star;
  }
  function starOf(tid, q) {
    if (q.top) return 5;
    if (q.role === 'ace' || q.role === 'core') return 4;
    const lg = (TEAM_BY_ID[tid] || {}).lg || '';
    return lg === 'd1' || lg === 'd2' ? 3 : lg === 'd3' || /1$/.test(lg) ? 2 : 1;
  }
  // CPUの選手の凸：いちばん高い能力のランクに届くのに必要な数だけ（☆3＝Aまでなので、Sがあれば1凸）
  function totsuOf(tid, q) { const mx = Math.max(...KEYS.map((k) => q[k] || 0)); let gi = 0; for (let i = 1; i < ENG.length - 1; i++) if (mx >= ENG[i]) gi = i; return Math.max(0, Math.min(3, gi - capIdx(starOf(tid, q), 0))); }
  const capIdx = (star, totsu) => Math.min(5, star + 1 + (totsu || 0));   // GRADES の番号（2＝C … 5＝S）
  const capGrade = (p) => GRADES[capIdx(ensureStar(p), p.totsu)];
  const capPts = (p) => { const i = capIdx(ensureStar(p), p.totsu); return i >= 5 ? PMAX : RANK[i][2] - 0.1; };
  function addPts(p, k, g) {
    ensurePts(p); let v = p.pts[k] + g;
    if (g > 0) v = Math.min(v, Math.max(p.pts[k], capPts(p)));   // 上限より上には伸びない（もともと上にいる分は下げない）
    p.pts[k] = clamp(Math.round(v * 10) / 10, 0, PMAX); p[k] = toEng(p.pts[k]);
  }

  // ================= トレーニングカード（試合で手に入れ、選手に最大3枚かけ合わせて特訓） =================
  // up：上がる育成ポイント / hid：裏パラ / fat：疲れ（0〜100の疲労ゲージにはこの1/4がたまる）
  // 数値は本家の表（キック・スピード・スタミナ・テクニック・フィジカル・ジャンプ・メンタル）をもとに、
  // このゲームで増やした5つ（瞬発力・ドリブル・パス・ディフェンス・判断）を内容に合わせて足したもの
  const CARDS = {
    // TACTICAL
    video: { name: 'ビデオ研究', cat: 'tact', up: { kick: 1, mental: 1, vision: 2 }, hid: { support: 1 }, fat: 10 },
    manMark: { name: 'マンツーマン', cat: 'tact', up: { stamina: 2, physical: 2, defense: 2 }, hid: { zone_man: 5 }, fat: 40 },
    press: { name: 'プレス', cat: 'tact', up: { speed: 2, technique: 1, defense: 2 }, hid: { press: 5 }, fat: 40 },
    counter: { name: 'カウンター', cat: 'tact', up: { speed: 2, stamina: 1, technique: 1, dash: 1, vision: 1 }, hid: { run_space: 4 }, fat: 40 },
    mini: { name: 'ミニゲーム', cat: 'tact', up: { kick: 1, technique: 1, jump: 2, pass: 1, vision: 1 }, hid: { support: 2, overlap: 1 }, fat: 60 },
    line: { name: 'ラインコントロール', cat: 'tact', up: { stamina: 2, mental: 2, defense: 2, vision: 1 }, hid: { zone_man: -5 }, fat: 20 },
    setplay: { name: 'セットプレー', cat: 'tact', up: { kick: 1, mental: 2, vision: 1 }, hid: { goal_wait: 2 }, fat: 20 },
    // TECHNICAL
    dribble: { name: 'ドリブル', cat: 'tech', up: { speed: 3, stamina: 2, technique: 2, dribble: 3 }, hid: { run_space: 3 }, fat: 100 },
    placeKick: { name: 'プレースキック', cat: 'tech', up: { kick: 4, mental: 2, pass: 1 }, hid: {}, fat: 80 },
    shoot: { name: 'シュート', cat: 'tech', up: { kick: 4, technique: 1 }, hid: { goal_wait: 4 }, fat: 100 },
    pass: { name: 'パス', cat: 'tech', up: { speed: 3, technique: 3, pass: 3, vision: 1 }, hid: { support: 4 }, fat: 100 },
    lifting: { name: 'リフティング', cat: 'tech', up: { technique: 4, dribble: 2 }, hid: {}, fat: 100 },
    sliding: { name: 'スライディング', cat: 'tech', up: { kick: 1, technique: 2, physical: 3, defense: 3 }, hid: { press: 3 }, fat: 100 },
    heading: { name: 'ヘディング', cat: 'tech', up: { kick: 2, jump: 7 }, hid: { goal_wait: 3 }, fat: 100 },
    // PHYSICAL
    running: { name: 'ランニング', cat: 'phys', up: { speed: 3, stamina: 6, mental: 1 }, hid: { overlap: 4 }, fat: 90 },
    weight: { name: 'ウエイト', cat: 'phys', up: { kick: 2, technique: 1, physical: 4 }, hid: { press: 2 }, fat: 100 },
    kickTr: { name: 'キック', cat: 'phys', up: { kick: 2, technique: 1, physical: 4 }, hid: {}, fat: 100 },
    dash: { name: 'ダッシュ', cat: 'phys', up: { kick: 1, speed: 6, jump: 3, dash: 3 }, hid: { run_space: 3 }, fat: 100 },
    agility: { name: 'アジリティ', cat: 'phys', up: { speed: 3, technique: 1, jump: 4, dash: 3 }, hid: {}, fat: 100 },
    aerobics: { name: 'エアロビクス', cat: 'phys', up: { stamina: 4, technique: 2, physical: 2 }, hid: {}, fat: 100 },
    stretch: { name: 'ストレッチ', cat: 'phys', up: { speed: 4, physical: 4, jump: 2 }, hid: {}, fat: 100 },
    // SUPPORT
    aroma: { name: 'アロマテラピー', cat: 'sup', up: {}, rand: { kick: 5, speed: 10, stamina: 10, technique: 4, physical: 10, jump: 10, mental: 2 }, fat: 0 },
    zazen: { name: '座禅', cat: 'sup', up: { stamina: 1, mental: 6 }, fat: 10 },
    signing: { name: 'サイン会', cat: 'sup', up: { kick: 1, mental: 5 }, cond: 1, fat: 10 },
    pk: { name: 'PK練習', cat: 'sup', up: { kick: 2, mental: 4 }, fat: 40 },
    aikido: { name: '合気道', cat: 'sup', up: { technique: 1, mental: 4 }, fat: 20 },
    image: { name: 'イメージトレーニング', cat: 'sup', up: { technique: 1, jump: 2, mental: 2, vision: 1 }, fat: 40 },
    meeting: { name: 'ミーティング', cat: 'sup', up: { stamina: 1, mental: 4, vision: 1 }, fat: 10 },
    onsen: { name: '温泉', cat: 'sup', up: { physical: 3, mental: 2 }, fat: -60 },
    camp: { name: 'ミニキャンプ', cat: 'sup', up: { speed: 2, stamina: 2, mental: 2 }, fat: 40 },
    gameNight: { name: 'サッカーゲーム', cat: 'sup', up: { technique: 1, mental: 2 }, cond: 1, fat: 20 },
    karaoke: { name: 'カラオケ', cat: 'sup', up: { technique: 1, mental: 3 }, cond: 1, fat: 10 },
  };
  const CAT_NAME = { tact: 'TACTICAL', tech: 'TECHNICAL', phys: 'PHYSICAL', sup: 'SUPPORT' };
  // スペシャルメニュー：カード3枚の組み合わせ（順番は関係なし）
  //  skill：覚えるスキル / type：裏パラをそのタイプへ / up：大きく上がる育成ポイント
  const SP = [
    // シュート
    ['無回転シュート', 'shoot placeKick lifting', { skill: 'knuckle', up: { kick: 15, technique: 9 } }],
    ['パワーシュート', 'shoot kickTr weight', { skill: 'powerMid', up: { kick: 16, physical: 10 } }],
    ['コントロールショット', 'shoot lifting image', { skill: 'controlShot', up: { kick: 11, technique: 13 } }],
    ['ニア上ぶち抜き', 'shoot kickTr dash', { skill: 'nearPost', up: { kick: 18, speed: 7, dash: 4 } }],
    ['ボレーシュート', 'shoot heading lifting', { skill: 'volley', up: { kick: 10, technique: 8, jump: 6 } }],
    ['バイシクル', 'heading lifting stretch', { skill: 'bicycle', up: { technique: 12, physical: 2, jump: 15 } }],
    ['ダイビングヘッド', 'heading dash stretch', { skill: 'divingHeader', up: { speed: 5, dash: 12, jump: 20 } }],
    ['ループシュート', 'shoot image video', { skill: 'lob', up: { kick: 10, vision: 10 } }],
    ['トゥーキック', 'shoot agility kickTr', { skill: 'toeKick', up: { kick: 16, dash: 10 } }],
    ['ドライブシュート', 'shoot kickTr lifting', { skill: 'driveShot', up: { kick: 18, technique: 10 } }],
    ['超ロングシュート', 'kickTr placeKick weight', { skill: 'superLong', up: { kick: 20, physical: 6 } }],
    ['ダイレクトシュート', 'shoot agility image', { skill: 'direct', up: { kick: 14, technique: 11 } }],
    // ドリブル
    ['シザース', 'dribble lifting agility', { skill: 'scissors', up: { technique: 11, dribble: 17, speed: 3 } }],
    ['ダブルタッチ', 'dribble lifting stretch', { skill: 'doubleTouch', up: { technique: 12, dribble: 14, speed: 4 } }],
    ['エラシコ', 'dribble lifting aikido', { skill: 'elastico', up: { technique: 14, dribble: 10 } }],
    ['マルセイユルーレット', 'dribble stretch agility', { skill: 'roulette', up: { technique: 8, dribble: 13, speed: 4, physical: 8, jump: 3 } }],
    ['ボディフェイント', 'dribble agility image', { skill: 'bodyFeint', up: { technique: 3, dribble: 13, speed: 4, dash: 11 } }],
    ['股抜き', 'dribble lifting mini', { skill: 'nutmeg', up: { technique: 14, dribble: 11 } }],
    ['高速ドリブル', 'dribble dash running', { skill: 'speedDribble', up: { dribble: 12, speed: 15, dash: 7, stamina: 4 } }],
    ['カットイン', 'dribble agility shoot', { skill: 'cutIn', up: { kick: 10, technique: 2, dribble: 15, speed: 3 } }],
    ['ヒールリフト', 'dribble lifting heading', { skill: 'heelLift', up: { technique: 12, dribble: 8, jump: 9 } }],
    ['キックフェイント', 'dribble shoot image', { skill: 'kickFeint', up: { kick: 11, technique: 3, dribble: 10 } }],
    // キック・パス
    ['カーブキック', 'placeKick lifting kickTr', { skill: 'curve', up: { kick: 13, technique: 10 } }],
    ['FKマイスター', 'placeKick setplay shoot', { skill: 'fk', up: { kick: 15, technique: 5, pass: 4 } }],
    ['CKマイスター', 'placeKick setplay heading', { skill: 'ckMaster', up: { kick: 16, pass: 7 } }],
    ['アーリークロス', 'pass placeKick dash', { skill: 'earlyCross', up: { kick: 3, pass: 18, speed: 10, dash: 4 } }],
    ['ピンポイントクロス', 'pass placeKick image', { skill: 'pinpointCross', up: { kick: 8, technique: 3, pass: 15 } }],
    ['スルーパス', 'pass video counter', { skill: 'throughPass', up: { technique: 3, pass: 11, vision: 10 } }],
    ['浮き球スルーパス', 'pass placeKick counter', { skill: 'loftedThrough', up: { kick: 10, technique: 3, pass: 13 } }],
    ['ノールックパス', 'pass video image', { skill: 'noLook', up: { technique: 2, pass: 7, vision: 14 } }],
    ['ワンタッチパス', 'pass mini agility', { skill: 'oneTouchPass', up: { technique: 9, dribble: 4, pass: 15, speed: 3 } }],
    ['ヒールパス', 'pass lifting dribble', { skill: 'heelPass', up: { technique: 12, dribble: 7, pass: 8, speed: 3 } }],
    ['ロングフィード', 'pass kickTr video', { skill: 'longFeed', up: { kick: 10, technique: 3, pass: 11 } }],
    ['サイドチェンジ', 'pass kickTr counter', { skill: 'switchPlay', up: { technique: 4, pass: 12, vision: 10 } }],
    ['壁パス', 'pass mini dash', { skill: 'wallPass', up: { pass: 17, speed: 11, dash: 5 } }],
    ['ワンツーの名手', 'pass mini counter', { skill: 'oneTwo', up: { technique: 3, pass: 13, vision: 9 } }],
    ['ロングスロー', 'weight stretch setplay', { skill: 'longThrow', up: { pass: 4, physical: 20 } }],
    ['PKの名手', 'pk zazen shoot', { skill: 'pkMaster', up: { kick: 9, mental: 13 } }],
    // 守備
    ['スライディング', 'sliding dash agility', { skill: 'slide', up: { speed: 6, dash: 13, defense: 19 } }],
    ['インターセプト', 'line video agility', { skill: 'intercept', up: { dash: 2, defense: 10, vision: 11, mental: 2 } }],
    ['マンマーク', 'manMark running dash', { skill: 'manMark', up: { speed: 5, stamina: 12, defense: 16 } }],
    ['カバーリング', 'line manMark running', { skill: 'cover', up: { defense: 14, vision: 9, mental: 3 } }],
    ['ショルダーチャージ', 'manMark weight aikido', { skill: 'shoulder', up: { physical: 16, defense: 6 } }],
    ['空中戦の鬼', 'heading weight stretch', { skill: 'aerial', up: { physical: 12, jump: 18 } }],
    ['シュートブロック', 'sliding aikido zazen', { skill: 'shotBlock', up: { defense: 13, mental: 11 } }],
    ['プレスの鬼', 'press running aerobics', { skill: 'pressMonster', up: { speed: 2, stamina: 16, defense: 8 } }],
    ['帰陣ダッシュ', 'running dash line', { skill: 'recovery', up: { speed: 13, dash: 7, stamina: 15 } }],
    // オフザボール
    ['裏への抜け出し', 'counter dash video', { skill: 'behindRun', up: { speed: 10, dash: 6, vision: 10 } }],
    ['ポストプレー', 'weight lifting aikido', { skill: 'postPlay', up: { technique: 9, physical: 12 } }],
    ['ニアに飛び込む', 'heading agility counter', { skill: 'nearRun', up: { speed: 3, dash: 13, jump: 14 } }],
    ['ファーで待つ', 'heading image setplay', { skill: 'farWait', up: { jump: 11, vision: 9, mental: 2 } }],
    ['オーバーラップ', 'running aerobics counter', { skill: 'overlap', up: { speed: 9, stamina: 19 } }],
    ['こぼれ球の嗅覚', 'agility video shoot', { skill: 'looseBall', up: { speed: 3, dash: 10, vision: 10 } }],
    // メンタル・特性
    ['キャプテンシー', 'meeting zazen signing', { skill: 'captaincy', up: { vision: 5, mental: 17 } }],
    ['大舞台に強い', 'signing image pk', { skill: 'bigStage', up: { vision: 5, mental: 16 } }],
    ['終盤の粘り', 'running aerobics zazen', { skill: 'lateGrit', up: { stamina: 17, mental: 12 } }],
    ['勝負強さ', 'pk image karaoke', { skill: 'clutch', up: { kick: 4, vision: 4, mental: 12 } }],
    ['ムードメーカー', 'karaoke gameNight signing', { skill: 'moodMaker', up: { mental: 18 } }],
    ['闘志', 'aikido press sliding', { skill: 'fighting', up: { defense: 10, mental: 12 } }],
    ['冷静', 'zazen image meeting', { skill: 'calm', up: { vision: 5, mental: 17 } }],
    ['鉄人', 'running weight aerobics', { skill: 'ironMan', up: { stamina: 18, physical: 11 } }],
    // GK
    ['超反応', 'heading stretch agility', { skill: 'superReflex', gk: true, up: { speed: 3, dash: 13, jump: 19 } }],
    ['パンチング', 'heading weight aikido', { skill: 'punching', gk: true, up: { physical: 12, jump: 12 } }],
    ['飛び出し', 'dash counter line', { skill: 'rushOut', gk: true, up: { speed: 12, dash: 7, vision: 11 } }],
    ['PKストッパー', 'pk image zazen', { skill: 'pkStopper', gk: true, up: { jump: 6, vision: 4, mental: 12 } }],
    ['1対1の鬼', 'manMark aikido image', { skill: 'oneOnOne', gk: true, up: { physical: 8, vision: 8, mental: 4 } }],
    ['低弾道スロー', 'pass weight setplay', { skill: 'lowThrow', gk: true, up: { technique: 2, pass: 12, physical: 10 } }],
    ['低弾道パントキック', 'placeKick kickTr counter', { skill: 'lowPunt', gk: true, up: { kick: 18, vision: 5 } }],
    ['コーチング', 'meeting line video', { skill: 'coaching', gk: true, up: { vision: 13, mental: 9 } }],
    ['鉄壁', 'stretch image line', { gk: true, up: { technique: 9, physical: 3, jump: 13, vision: 9, mental: 3 } }],
    // 能力・タイプ
    ['野人', 'running dash aerobics', { up: { speed: 16, dash: 8, stamina: 20, mental: -2 } }],
    ['肉体改造', 'weight dash stretch', { up: { kick: 6, speed: 10, dash: 5, physical: 10, jump: 11 } }],
    ['総合トレーニング', 'camp running mini', { all: 4 }],
    ['ストライカー養成', 'shoot heading kickTr', { type: 'ストライカー', up: { kick: 14, jump: 10 } }],
    ['アタッカー養成', 'dribble dash agility', { type: 'アタッカー', up: { dribble: 15, speed: 15, dash: 9 } }],
    ['レジスタ養成', 'pass video lifting', { type: 'レジスタ', up: { technique: 4, pass: 11, vision: 8 } }],
    ['ダイナモ養成', 'running press mini', { type: 'ダイナモ', up: { speed: 4, dash: 6, stamina: 14 } }],
    ['ゲームメイカー養成', 'pass image mini', { type: 'ゲームメイカー', up: { technique: 3, pass: 10, vision: 12 } }],
    ['スイーパー養成', 'line video zazen', { type: 'スイーパー', up: { defense: 8, vision: 9, mental: 5 } }],
    ['ストッパー養成', 'manMark sliding weight', { type: 'ストッパー', up: { physical: 12, defense: 13 } }],
    ['マンマーカー養成', 'manMark dash agility', { type: 'マンマーカー', up: { speed: 12, dash: 8, defense: 15 } }],
    ['ラインコントローラー養成', 'line press video', { type: 'ラインコントローラー', up: { defense: 11, vision: 9, mental: 2 } }],
    ['パサー養成', 'pass placeKick video', { type: 'パサー', up: { kick: 7, pass: 12, vision: 5 } }],
    // 下がる能力もあるメニュー
    ['オーバートレーニング', 'sliding running weight', { up: { kick: -2, stamina: -5, physical: 24, mental: -2 }, fat: 145 }],
    ['のんびり休日', 'karaoke gameNight onsen', { up: { technique: 7, physical: -4, mental: 10 }, fat: -60 }],
    // ---- 能力をのばすメニュー（3枚） ----
    ['鋼の肉体', 'weight kickTr stretch', { up: { kick: 6, physical: 20, jump: 4 } }],
    ['スプリンター', 'dash agility running', { up: { speed: 20, dash: 16, stamina: 4 } }],
    ['跳躍力強化', 'heading aerobics stretch', { up: { stamina: 3, physical: 11, jump: 20 } }],
    ['精密機械', 'lifting placeKick image', { up: { kick: 7, technique: 13, pass: 4 } }],
    ['キープ力', 'lifting weight dribble', { up: { technique: 7, dribble: 12, physical: 10 } }],
    ['ゲームの支配者', 'pass mini video', { up: { technique: 3, pass: 11, vision: 11 } }],
    ['不屈の精神', 'zazen aikido karaoke', { up: { mental: 20 } }],
    ['鉄の肺', 'running aerobics camp', { up: { speed: 10, stamina: 20 } }],
    ['攻守の要', 'press pass running', { up: { pass: 8, speed: 4, stamina: 12, defense: 7 } }],
    ['ハードワーク', 'press running dash', { up: { speed: 10, dash: 4, stamina: 14, defense: 7 } }],
    ['鬼プレス', 'press weight camp', { up: { speed: 3, stamina: 7, physical: 7, defense: 7 } }],
    ['カウンター特訓', 'counter dash dribble', { up: { dribble: 11, speed: 13, dash: 7, vision: 5 } }],
    ['ポゼッション', 'pass mini lifting', { up: { technique: 13, pass: 10, vision: 5 } }],
    ['サイドアタック', 'dribble running agility', { up: { dribble: 13, speed: 11, stamina: 15 } }],
    ['空中戦強化', 'heading weight kickTr', { up: { physical: 13, jump: 16 } }],
    ['パワーヘッド', 'heading shoot weight', { up: { kick: 11, physical: 5, jump: 10 } }],
    ['ミドルレンジ', 'shoot kickTr image', { up: { kick: 15, technique: 2, vision: 6 } }],
    ['ゴールハンター', 'shoot dash image', { up: { kick: 13, speed: 8, dash: 4, vision: 5 } }],
    ['決定力', 'shoot zazen image', { up: { kick: 9, vision: 3, mental: 11 } }],
    ['クロス精度', 'placeKick pass mini', { up: { kick: 10, technique: 3, pass: 16 } }],
    ['視野の広さ', 'video image meeting', { up: { vision: 14, mental: 8 } }],
    ['戦術眼', 'video line mini', { up: { defense: 6, vision: 13, mental: 2 } }],
    ['読みの鋭さ', 'video line sliding', { up: { defense: 14, vision: 11 } }],
    ['対人の強さ', 'manMark sliding aikido', { up: { physical: 10, defense: 15 } }],
    ['ラインの統率', 'line meeting signing', { up: { vision: 8, mental: 16 } }],
    ['ボディバランス', 'lifting stretch aikido', { up: { technique: 11, physical: 11, mental: 4 } }],
    ['体幹トレーニング', 'stretch aerobics weight', { up: { speed: 2, stamina: 9, physical: 20 } }],
    ['柔軟性', 'stretch aikido onsen', { up: { physical: 13, jump: 7 }, fat: 20 }],
    ['リカバリー', 'onsen karaoke zazen', { up: { physical: 3, mental: 9 }, fat: -80 }],
    ['チーム愛', 'signing meeting gameNight', { up: { vision: 4, mental: 15 } }],
    ['ファンサービス', 'signing karaoke video', { up: { kick: 3, vision: 4, mental: 11 } }],
    ['オフの過ごし方', 'gameNight onsen meeting', { up: { vision: 4, mental: 13 }, fat: -40 }],
    ['イメージ戦略', 'image video setplay', { up: { kick: 4, vision: 11, mental: 3 } }],
    ['セットプレー職人', 'setplay placeKick kickTr', { up: { kick: 19, pass: 4 } }],
    ['PK職人', 'pk placeKick zazen', { up: { kick: 12, mental: 13 } }],
    ['ロングボール', 'kickTr placeKick pass', { up: { kick: 15, technique: 3, pass: 12 } }],
    ['テクニシャン', 'lifting dribble video', { up: { technique: 12, dribble: 10, vision: 3 } }],
    ['走力強化', 'running dash stretch', { up: { speed: 15, dash: 7, stamina: 16, physical: 2 } }],
    ['瞬発力強化', 'agility dash stretch', { up: { speed: 10, dash: 20, jump: 6 } }],
    ['フィジカルモンスター', 'weight aerobics kickTr', { up: { kick: 4, stamina: 7, physical: 17 } }],
    ['根性論', 'running zazen weight', { up: { stamina: 11, physical: 8, mental: 11 } }],
    ['アロマ集中', 'aroma zazen image', { up: { vision: 6, mental: 14 }, fat: 0 }],
    ['温泉療養', 'onsen aroma karaoke', { up: { physical: 5, mental: 7 }, fat: -100 }],
    // ---- 集中トレーニング ----
    ['炎天下ダッシュ', 'camp running dash', { all: 2, up: { speed: 9, stamina: 8 } }],
    ['雪中トレーニング', 'camp aerobics stretch', { all: 2, up: { stamina: 6, physical: 5 } }],
    ['鉄人トレーニング', 'camp weight sliding', { all: 2, up: { physical: 6, defense: 5 } }],
    ['ボールマスター', 'camp lifting dribble', { all: 2, up: { technique: 6, dribble: 5 } }],
    ['作戦会議', 'camp video line', { all: 2, up: { defense: 5, vision: 6 } }],
    ['シュート千本', 'camp shoot kickTr', { all: 2, up: { kick: 11 } }],
    // ---- クセのあるメニュー（下がる能力も） ----
    ['天才肌', 'lifting gameNight image', { up: { technique: 13, stamina: -2, mental: 6 } }],
    ['気分屋', 'karaoke gameNight aroma', { up: { technique: 8, stamina: -4, mental: 10 } }],
    ['野生の勘', 'agility video karaoke', { up: { speed: 2, dash: 12, vision: 10, mental: -2 } }],
    ['演技派', 'aikido signing karaoke', { up: { technique: 6, defense: -4, mental: 13 } }],
    ['ラフプレー', 'sliding press weight', { up: { physical: 10, defense: 16, mental: -5 } }],
    // ---- GK専用 ----
    ['守護神の構え', 'heading image zazen', { gk: true, up: { jump: 12, vision: 7, mental: 9 } }],
    ['ゴールの守護神', 'line setplay heading', { gk: true, up: { jump: 13, vision: 9, mental: 3 } }],
    ['キャッチング強化', 'lifting image meeting', { gk: true, up: { technique: 14, vision: 6, mental: 3 } }],
    ['セービング特訓', 'agility stretch image', { gk: true, up: { speed: 4, dash: 13, physical: 2, jump: 15 } }],
    // ---- タイプ ----
    ['オールラウンダー養成', 'mini running lifting', { type: 'バランス', all: 3 }],
    // ---- 2枚で発動するメニュー（ちょうど2枚セットした時だけ） ----
    ['基礎体力', 'running stretch', { up: { speed: 3, stamina: 12, physical: 8 } }],
    ['トラップ練習', 'lifting pass', { up: { technique: 14, pass: 6 } }],
    ['1対1', 'manMark dribble', { up: { dribble: 10, defense: 10 } }],
    ['ゴール前の練習', 'shoot heading', { up: { kick: 9, jump: 9 } }],
    ['メンタルケア', 'zazen karaoke', { up: { mental: 14 } }],
    ['戦術ミーティング', 'meeting video', { up: { vision: 10, mental: 3 } }],
    ['ハイボール', 'heading line', { gk: true, up: { jump: 15, vision: 5 } }],
    ['フィード練習', 'placeKick pass', { up: { kick: 10, pass: 11 } }],
    ['スピード練習', 'dash agility', { up: { speed: 16, dash: 12 } }],
    ['体づくり', 'weight aerobics', { up: { stamina: 7, physical: 12 } }],
    // ---- 追加タイプの養成（2026-10-08。番号がずれないよう、いちばん後ろに足す） ----
    ['偽9番養成', 'pass image dribble', { type: '偽9番', up: { technique: 6, pass: 9, vision: 9 } }],
    ['デコイラン養成', 'running agility counter', { type: 'デコイラン', up: { speed: 10, dash: 12, stamina: 8 } }],
    ['ファンタジスタ養成', 'dribble lifting image', { type: 'ファンタジスタ', up: { technique: 8, dribble: 14, vision: 6 } }],
    ['シャドー養成', 'shoot running counter', { type: 'シャドー', up: { kick: 10, dash: 8, technique: 4 } }],
    ['アンカー養成', 'press sliding meeting', { type: 'アンカー', up: { defense: 12, vision: 6, physical: 6 } }],
    ['ビルドアップ型養成', 'pass line counter', { type: 'ビルドアップ型', up: { pass: 12, vision: 8, defense: 4 } }],
    ['スイーパーキーパー養成', 'dash line kickTr', { type: 'スイーパーキーパー', gk: true, up: { dash: 10, kick: 6, vision: 6 } }],
    // ---- 版676：能力をのばすメニューを増やす（スキルより能力のメニューの方がずっと多くなるように。番号がずれないよう、いちばん後ろに足す） ----
    ['キック力強化', 'kickTr shoot aerobics', { up: { kick: 18, physical: 8 } }],
    ['シュート練習', 'shoot running dash', { up: { kick: 12, speed: 7, dash: 6 } }],
    ['左右の足', 'shoot lifting agility', { up: { kick: 10, technique: 10, dash: 4 } }],
    ['枠を狙え', 'shoot image placeKick', { up: { kick: 16, technique: 4, mental: 5 } }],
    ['ゴール前の落ち着き', 'shoot zazen meeting', { up: { kick: 8, mental: 14, vision: 3 } }],
    ['こぼれ球シュート', 'shoot agility sliding', { up: { kick: 11, dash: 8, speed: 5 } }],
    ['ヘディング練習', 'heading running agility', { up: { jump: 16, speed: 5, dash: 5 } }],
    ['ヘディングの技術', 'heading lifting image', { up: { jump: 13, technique: 8, mental: 3 } }],
    ['高い打点', 'heading stretch camp', { up: { jump: 17, physical: 9 } }],
    ['競り合い', 'heading manMark weight', { up: { jump: 12, physical: 10, defense: 5 } }],
    ['パス回し', 'pass mini dribble', { up: { pass: 14, technique: 8, dribble: 4 } }],
    ['ロングパス', 'pass kickTr weight', { up: { pass: 13, kick: 10, physical: 3 } }],
    ['パスの精度', 'pass lifting image', { up: { pass: 13, technique: 10, vision: 3 } }],
    ['展開力', 'pass video meeting', { up: { pass: 10, vision: 13, mental: 3 } }],
    ['縦パス', 'pass counter dash', { up: { pass: 12, speed: 6, vision: 6, dash: 3 } }],
    ['パス＆ゴー', 'pass running dash', { up: { pass: 10, speed: 9, stamina: 7 } }],
    ['サイドからの攻撃', 'pass dribble running', { up: { pass: 9, dribble: 9, stamina: 8 } }],
    ['判断の速さ', 'pass agility image', { up: { pass: 8, vision: 10, dash: 7 } }],
    ['ドリブル練習', 'dribble running stretch', { up: { dribble: 13, speed: 8, stamina: 5 } }],
    ['ボールタッチ', 'dribble lifting gameNight', { up: { dribble: 11, technique: 11, mental: 2 } }],
    ['突破力', 'dribble dash weight', { up: { dribble: 12, speed: 6, physical: 8 } }],
    ['細かいステップ', 'dribble agility aerobics', { up: { dribble: 10, dash: 8, stamina: 6 } }],
    ['ドリブルの判断', 'dribble video image', { up: { dribble: 10, vision: 10, technique: 4 } }],
    ['運ぶドリブル', 'dribble counter running', { up: { dribble: 11, speed: 9, stamina: 6 } }],
    ['狭い所の打開', 'dribble mini agility', { up: { dribble: 12, technique: 6, dash: 6 } }],
    ['足もとの技術', 'lifting stretch pass', { up: { technique: 13, dribble: 8, speed: 3 } }],
    ['トラップの精度', 'lifting meeting zazen', { up: { technique: 14, mental: 5, vision: 3 } }],
    ['ボール扱い', 'lifting gameNight karaoke', { up: { technique: 12, mental: 8 } }],
    ['止めて蹴る', 'lifting placeKick pass', { up: { technique: 12, kick: 7, pass: 7 } }],
    ['リフティング100回', 'lifting zazen agility', { up: { technique: 14, mental: 6, dash: 3 } }],
    ['坂道ダッシュ', 'dash running weight', { up: { dash: 12, speed: 10, physical: 6 } }],
    ['スタートダッシュ', 'dash agility zazen', { up: { dash: 15, speed: 8, mental: 3 } }],
    ['50m走', 'dash stretch aerobics', { up: { speed: 16, dash: 8, stamina: 4 } }],
    ['反応速度', 'agility image video', { up: { dash: 12, vision: 8, mental: 3 } }],
    ['ラダートレーニング', 'agility aerobics running', { up: { dash: 12, speed: 8, stamina: 8 } }],
    ['砂浜ダッシュ', 'dash camp agility', { up: { dash: 12, speed: 8, stamina: 6 } }],
    ['切り返し', 'agility dribble weight', { up: { dash: 10, dribble: 8, speed: 6 } }],
    ['持久走', 'running aerobics stretch', { up: { stamina: 20, speed: 5, physical: 3 } }],
    ['インターバル走', 'running dash meeting', { up: { stamina: 16, speed: 8, dash: 4 } }],
    ['90分走れる体', 'running camp weight', { up: { stamina: 16, physical: 8, mental: 3 } }],
    ['山ごもり', 'running camp zazen', { up: { stamina: 14, mental: 10, physical: 3 } }],
    ['朝練', 'running meeting stretch', { up: { stamina: 12, speed: 6, mental: 6 } }],
    ['サーキット', 'aerobics weight agility', { up: { stamina: 10, physical: 9, dash: 7 } }],
    ['筋トレ', 'weight stretch running', { up: { physical: 16, stamina: 6, speed: 3 } }],
    ['当たり負けしない体', 'weight manMark zazen', { up: { physical: 15, defense: 6, mental: 4 } }],
    ['下半身強化', 'weight dash kickTr', { up: { physical: 12, dash: 7, kick: 7 } }],
    ['体幹', 'weight aikido zazen', { up: { physical: 13, mental: 8, technique: 3 } }],
    ['ジャンプ力', 'stretch heading running', { up: { jump: 16, physical: 6, dash: 4 } }],
    ['けがに強い体', 'stretch onsen aerobics', { up: { physical: 12, stamina: 8 }, fat: -20 }],
    ['守備練習', 'sliding manMark line', { up: { defense: 18, physical: 6 } }],
    ['奪う力', 'sliding press dash', { up: { defense: 14, dash: 7, speed: 4 } }],
    ['ボール奪取', 'press manMark agility', { up: { defense: 13, dash: 8, speed: 4 } }],
    ['守備の約束事', 'line meeting zazen', { up: { defense: 10, vision: 10, mental: 5 } }],
    ['寄せの速さ', 'press dash stretch', { up: { defense: 10, speed: 9, stamina: 7 } }],
    ['体を寄せる', 'manMark weight running', { up: { defense: 12, physical: 12 } }],
    ['粘り強い守備', 'manMark zazen running', { up: { defense: 11, mental: 8, stamina: 7 } }],
    ['ゴール前の守り', 'line sliding heading', { up: { defense: 12, jump: 10, physical: 3 } }],
    ['カウンター対策', 'line counter video', { up: { defense: 10, vision: 10, speed: 5 } }],
    ['ピッチ全体を見る', 'video image mini', { up: { vision: 16, pass: 5, mental: 3 } }],
    ['相手の分析', 'video meeting zazen', { up: { vision: 13, mental: 10 } }],
    ['試合の流れを読む', 'video counter image', { up: { vision: 14, speed: 4, mental: 5 } }],
    ['首を振る', 'mini image agility', { up: { vision: 12, dash: 6, technique: 5 } }],
    ['ポジショニング', 'line image mini', { up: { vision: 12, defense: 8, mental: 3 } }],
    ['自信をつける', 'signing pk karaoke', { up: { mental: 18, kick: 3 } }],
    ['プレッシャーに強い', 'pk zazen signing', { up: { mental: 17, kick: 5 } }],
    ['チームの和', 'meeting karaoke gameNight', { up: { mental: 15, vision: 4 }, fat: -20 }],
    ['気分転換', 'onsen gameNight signing', { up: { mental: 12, technique: 4 }, fat: -50 }],
    ['リフレッシュ', 'aroma onsen gameNight', { up: { mental: 10, physical: 4 }, fat: -70 }],
    ['集中力', 'zazen aroma meeting', { up: { mental: 16, vision: 5 }, fat: -10 }],
    ['平常心', 'zazen aikido image', { up: { mental: 18, technique: 3 } }],
    ['攻撃の練習', 'shoot pass dribble', { up: { kick: 8, pass: 8, dribble: 8 } }],
    ['守備から攻撃', 'sliding pass counter', { up: { defense: 8, pass: 8, speed: 7 } }],
    ['ミニゲーム大会', 'mini gameNight camp', { up: { technique: 6, pass: 6, vision: 6, mental: 5 } }],
    ['紅白戦', 'mini running counter', { up: { stamina: 8, pass: 6, vision: 6, speed: 5 } }],
    ['セットプレーの練習', 'setplay heading shoot', { up: { kick: 10, jump: 10, pass: 4 } }],
    ['サイドの攻防', 'dribble manMark running', { up: { dribble: 9, defense: 9, stamina: 7 } }],
    ['合宿の成果', 'camp mini meeting', { all: 2, up: { vision: 4, mental: 4 } }],
    ['シュート練', 'shoot kickTr', { up: { kick: 14, physical: 4 } }],
    ['ドリブル練', 'dribble agility', { up: { dribble: 11, dash: 7 } }],
    ['守備練', 'sliding manMark', { up: { defense: 14, physical: 4 } }],
    ['持久力', 'running aerobics', { up: { stamina: 16, physical: 3 } }],
    ['筋力', 'weight stretch', { up: { physical: 14, speed: 4 } }],
    ['精神統一', 'zazen aikido', { up: { mental: 15 } }],
    ['パス練', 'pass mini', { up: { pass: 12, technique: 5 } }],
    ['ジャンプ練', 'heading agility', { up: { jump: 13, dash: 5 } }],
    ['分析', 'video image', { up: { vision: 12, mental: 4 } }],
    ['ボールタッチ練', 'lifting dribble', { up: { technique: 10, dribble: 9 } }],
  ].map(([name, rec, o], id) => { const tot = Object.values(o.up || {}).reduce((a, v) => a + Math.max(0, v), 0) + (o.all || 0) * 12;
    return { id, name, key: rec.split(' ').sort().join('+'), cards: rec.split(' '), fat: Math.min(150, Math.round(40 + tot * 3)), ...o }; });
  const SP_BY_KEY = Object.fromEntries(SP.map((m) => [m.key, m]));
  function findSpecial(cards, p) {
    if (cards.length < 2) return null;
    const m = SP_BY_KEY[cards.slice().sort().join('+')];
    if (!m || (m.gk && p.position !== 'GK')) return null;
    return m;
  }
  // ---------- 調子（版514：ポテンシャルの代わり）----------
  // 5段階：絶好調(2)・好調(1)・普通(0)・不調(-1)・絶不調(-2)。毎週ゆらぐ（ふつうに戻りやすい）。年をとって下がり続けることはない。
  // 調子が良いほど特訓が効く（0.6〜1.4倍）。好調以上だと、試合に出なくても能力が少し伸びることがある。ケガで1段下がる。
  const COND_NAME = { 2: '絶好調', 1: '好調', 0: '普通', '-1': '不調', '-2': '絶不調' };
  const condOf = (p) => clamp(Math.round(p.cond || 0), -2, 2);
  function condTick(p, r) {
    const c = condOf(p);
    if (r() < 0.4) { const downP = c > 0 ? 0.65 : c < 0 ? 0.35 : 0.5; p.cond = clamp(c + (r() < downP ? -1 : 1), -2, 2); } else p.cond = c;
  }
  const INJURIES = [
    { name: '打撲', w: [2, 2], p: 0.35 }, { name: '捻挫', w: [3, 3], p: 0.30 }, { name: '肉離れ', w: [4, 6], p: 0.21 },
    { name: '靭帯損傷', w: [8, 8], p: 0.09 }, { name: '骨折', w: [10, 12], p: 0.05 },
  ];
  // ケガをさせる：種類と期間を決めて、ニュース（コーチからの報告）に積む
  /* v740 フィジカルが高いほどケガをしにくい：E（40）1.0倍・C（60）0.75倍・S（88）0.4倍 */
  const injMul = (p) => clamp(1.5 - (p.physical || 50) / 80, 0.35, 1.1);
  function injure(save, p, r, where) {
    let u = r(), it = INJURIES[INJURIES.length - 1];
    for (const x of INJURIES) { if (u < x.p) { it = x; break; } u -= x.p; }
    const weeks = it.w[0] + Math.floor(r() * (it.w[1] - it.w[0] + 1));
    p.injury = weeks; p.cond = clamp(condOf(p) - 1, -2, 2);
    if (weeks >= 8) { for (let k = 0; k < 3; k++) addPts(p, KEYS[Math.floor(r() * KEYS.length)], -(4 + Math.floor(r() * 6))); }   // 長いケガは能力も少し落ちる
    const n = { name: p.name, number: p.number, kind: it.name, weeks, where };
    save.news = save.news || []; save.news.push(n);
    return n;
  }
  const condMul = (p) => (p.fatigue > 75 ? 0.6 : p.fatigue > 55 ? 0.85 : 1) * (1 + condOf(p) * 0.2);   // 絶不調0.6倍〜絶好調1.4倍
  // セットしたカードで、どの能力が何ポイント上がるか（予想）
  function previewCards(p, cards, mult) {
    ensurePts(p);
    const ups = {}, sp = findSpecial(cards, p), m = condMul(p), g = mult || 1;
    const add = (k, v) => { ups[k] = (ups[k] || 0) + v * (v > 0 ? m * g : m); };
    if (sp) {
      // スペシャル：カードの伸びの代わりに、そのメニューならではの大きな伸び（下がる能力があるメニューも）
      if (sp.up) for (const k in sp.up) add(k, sp.up[k] * (sp.up[k] > 0 ? 1 : 1 / m));
      if (sp.all) for (const k of KEYS) add(k, sp.all);
    } else {
      for (const c of cards) { const cd = CARDS[c]; for (const k in cd.up) add(k, cd.up[k]); if (cd.all) for (const k of KEYS) add(k, cd.all); }
    }
    return { ups, sp };
  }
  // 1週間：全体練習＋カード特訓
  const TEAM_PTS = {
    base: { name: '基礎練習', all: 1, fat: 6 },
    phys: { name: 'フィジカル練習', up: { stamina: 4, physical: 3, speed: 2 }, fat: 10 },
    tactic: { name: '戦術練習', up: { vision: 4, defense: 2 }, fat: 4 },
    scrim: { name: '紅白戦', up: { vision: 3, technique: 2, mental: 2 }, fat: 10 },
    rest: { name: '全体休養', fat: -15 },
  };
  const SKILL_RATE = 0.20;   // スペシャルメニューでスキルを覚える確率（基本）
  // 失敗するたびに、その選手・そのスキルは+10%ずつ覚えやすくなる（覚えたら元に戻る）
  const skillRate = (p, k) => Math.min(1, SKILL_RATE + 0.10 * ((p.skTry || {})[k] || 0));
  const wkKey = (save) => save.season + '-' + save.week;
  // ---------- 合宿：リーグ前半が終わったら4週間の中断期間 ----------
  // 試合はなし。特訓は週2回まで・カードの効果1.5倍・全体練習は少し強め
  const CAMP = { weeks: 4, trains: 2, mult: 1.5, team: 0.8 };
  function campState(save) {
    const c = CAMPS.find((x) => save.week >= x.from && save.week <= x.to);
    if (!c) return null;
    return { name: c.name, week: save.week - c.from + 1, weeks: c.to - c.from + 1, trains: CAMP.trains, mult: CAMP.mult, team: CAMP.team };
  }
  const trainLimit = (save) => (campState(save) ? CAMP.trains : 1);
  const trainMult = (save) => (campState(save) ? CAMP.mult : 1);
  const trainsDone = (save, p) => (p.trainedAt === wkKey(save) ? (p.trainN || 1) : 0);
  const trainedThisWeek = (save, p) => trainsDone(save, p) >= trainLimit(save);
  // カード特訓：1人ずつ、その場で終わらせる（本家方式）
  function trainOne(save, i, cardsIn) {
    const r = rng(save), p = save.team.players[i];
    save.spFound = save.spFound || [];
    ensurePts(p);
    const before = { ...p.pts };
    const out = { i, name: p.name, cards: [], ups: {}, sp: null, learned: null, typeFrom: p.type, typeTo: null, injured: false, before };
    if (p.injury > 0 || trainedThisWeek(save, p)) return null;
    const add = (k, g) => { if (!g) return; addPts(p, k, g); out.ups[k] = (out.ups[k] || 0) + g; };
    const cards = (cardsIn || []).filter((c) => CARDS[c] && (save.cards[c] || 0) > 0).slice(0, 3);
    if (!cards.length) return null;
    for (const c of cards) save.cards[c]--;
    out.cards = cards;
    p.trainHist = [...(p.trainHist || []), ...cards].slice(-4);   // 特訓履歴（最近の4枚）
    let fat = 0;
    const pv = previewCards(p, cards, trainMult(save));
    for (const k in pv.ups) add(k, Math.round(pv.ups[k]));
    for (const c of cards) { const cd = CARDS[c]; if (cd.hid && !(pv.sp && pv.sp.type)) moveHidden(p, cd.hid, (pv.sp ? 2 : 1) * TYPE_TUNE.hid);   // 版735：タイプ養成のSPは、カードごとのくせ（例：パスはsupport＋）を足さない。足すと目標のタイプを通り越して、近いタイプ（ゲームメイカー→レジスタ）に止まってしまう
      if (cd.rand) for (const k in cd.rand) add(k, Math.floor(r() * (cd.rand[k] + 1)));
      if (!pv.sp) fat += (cd.fat || 0) / 12; if (cd.cond) p.cond = clamp((p.cond || 0) + cd.cond, -2, 2); }
    if (pv.sp) { out.sp = pv.sp.id; fat += (pv.sp.fat ?? 100) / 6;
      if (!save.spFound.includes(pv.sp.id)) { save.spFound.push(pv.sp.id); out.spNew = true; }
      if (pv.sp.type && !p.uniq) { const pr = protoOf(pv.sp.type); for (const k of HKEYS) p[k] += (pr[k] - p[k]) * TYPE_TUNE.spPull; }
      if (pv.sp.skill && !(p.skills || []).includes(pv.sp.skill)) { const k = pv.sp.skill; out.rate = skillRate(p, k); if (r() < out.rate) { out.learned = k; if (p.skTry) delete p.skTry[k]; } else { out.skillMiss = k; p.skTry = p.skTry || {}; p.skTry[k] = (p.skTry[k] || 0) + 1; out.nextRate = skillRate(p, k); } } }
    p.fatigue = clamp(p.fatigue + fat, 0, 100);
    if (p.fatigue > 75 && r() < (p.fatigue - 70) * 0.006 * injMul(p)) { out.injured = injure(save, p, r, 'train'); save.news.pop(); }
    const nt = decideType(p); if (nt !== p.type) { out.typeTo = nt; p.type = nt; }
    p.trainN = trainsDone(save, p) + 1; p.trainedAt = wkKey(save);
    if (save.plan && save.plan.cards) delete save.plan.cards[i];
    return out;
  }
  // 週送り：全体練習は自動（全員の全能力が少しずつ上がる）＋疲労回復・ケガの経過
  const TEAM_AUTO = { all: 0.3, fat: 6 };   // 全体練習だけでは、半年で数ポイント（ランクはほぼ動かない）
  function weekTick(save, teamAll) {
    if (save.tickedAt === wkKey(save)) return [];
    save.tickedAt = wkKey(save);
    const r = rng(save), report = [];
    save.team.players.forEach((p, i) => {
      ensurePts(p);
      const out = { i, name: p.name, typeFrom: p.type, typeTo: null };
      if (p.injury > 0) { p.injury--; p.fatigue = clamp(p.fatigue - 25, 0, 100); out.rest = true; }
      else { for (const k of KEYS) addPts(p, k, teamAll || TEAM_AUTO.all); p.fatigue = clamp(p.fatigue + TEAM_AUTO.fat - 30, 0, 100); }
      if (!(p.injury > 0) && p.fatigue > 70 && r() < (p.fatigue - 65) * 0.004 * injMul(p)) injure(save, p, r, 'practice');
      // 調子が良いと、試合に出なくても少し伸びる（好調10%・絶好調20%で、どれか1つが少しだけ）
      if (condOf(p) >= 1 && !(p.injury > 0) && r() < 0.1 * condOf(p)) { addPts(p, KEYS[Math.floor(r() * KEYS.length)], 1); out.natural = true; }
      condTick(p, r);
      const nt = decideType(p); if (nt !== p.type) { out.typeTo = nt; p.type = nt; }
      report.push(out);
    });
    if (save.plan) save.plan.cards = {};
    return report;
  }
  // 1週間を終える：全体練習（合宿中は強化）→ 週を進める → 年が明けたらシーズン終了（昇格・降格）
  /* v745 来季のリーグが決まったか（決まっていなければ null）。決まった時点でホームのスタジアムを改装する */
  function myNextLg(save) {
    const me = save.team.name, id = myLgId(save), lg = save.league;
    if (!lg || lg.round < lg.rounds.length) return null;
    const st = standings(save), n = st.length, pos = st.findIndex((t) => t.me) + 1, post = save.post;
    const regOne = (two) => (two === 'regE2' ? 'regE1' : 'regW1'), regTwo = (one) => (one === 'regE1' ? 'regE2' : 'regW2');
    const ko = (comp) => post && post.matches.find((m) => m.comp === comp && (m.a === me || m.b === me) && m.label !== '決勝');
    if (/^reg.2$/.test(id)) return pos === 1 ? regOne(id) : id;
    if (/^reg.1$/.test(id)) {
      if (pos === n) return regTwo(id);
      if (pos > 2) return id;
      const m = ko('D3昇格トーナメント'); if (!m || !m.done) return null; return m.w === me ? 'd3' : id;
    }
    if (id === 'd3') { if (pos === 1) return 'd2'; if (pos >= n - 1) return (findTeam(save, me) || {}).region === 'E' || save.world.region === 'E' ? 'regE1' : 'regW1'; if (pos !== 2) return id;
      const m = ko('D3/D2入れ替え戦'); if (!m || !m.done) return null; return m.w === me ? 'd2' : id; }
    if (id === 'd2' || id === 'd1') {
      if (id === 'd2' && pos === n) return 'd3';
      if (id === 'd2' && pos === n - 1) { const m = ko('D3/D2入れ替え戦'); if (!m || !m.done) return null; return m.w === me ? 'd2' : 'd3'; }
      const inPl = id === 'd2' ? pos <= 2 : pos >= n - 1; if (!inPl) return id;
      if (post && !post.playoff) { const m = ko('D1/D2入れ替え戦'); if (!m || !m.done) return null; return m.w === me ? 'd1' : 'd2'; }
      if (!post || post.matches.some((m) => m.comp === 'D1昇格リーグ' && !m.done && (m.a === me || m.b === me))) return null;
      const pl = post.playoff.slice().sort((x, y) => y.stats.Pts - x.stats.Pts || (y.stats.GF - y.stats.GA) - (x.stats.GF - x.stats.GA));
      return pl.findIndex((t) => t.name === me) < 2 ? 'd1' : 'd2';
    }
    return id;
  }
  /* 改装工事：来季のリーグが決まった次の週から2週間ホームを閉じて、3週目から新しいスタジアム */
  const RENOV_WEEKS = 2;
  function renovTick(save, out) {
    if (save.week > SEASON_WEEKS) return;
    const r = save.renov;
    if (!r || r.season !== save.season) {
      const nx = myNextLg(save); if (!nx) return;
      if (save.post && save.post.matches.some((m) => !m.done && (m.a === save.team.name || m.b === save.team.name))) return;   /* v757：自分の1月の試合（親善試合の決勝など）が残っている間は、工事を始めない（工事中に公式戦はない） */
      const from = LG[myLgId(save)].tier, to = LG[nx].tier;
      if (to === from) { save.renov = { season: save.season, none: true }; return; }
      save.renov = { season: save.season, from, to, lg: nx, start: save.week, open: save.week + RENOV_WEEKS };
      out.renovStart = { ...save.renov };
    } else if (!r.none && !r.done && save.week >= r.open) { r.done = true; out.renovDone = { ...r }; }
  }
  /* ホームの会場の格（改装中は null＝使えない） */
  function homeTier(save) {
    const r = save.renov, cur = LG[myLgId(save)].tier;
    if (!r || r.none || r.season !== save.season) return cur;
    if (save.week >= r.open) return r.to;
    if (save.week >= r.start) return null;
    return cur;
  }
  function endWeek(save) {
    const cs = campState(save);
    const rep = weekTick(save, cs ? CAMP.team : 0);
    const settled = settleWeek(save);
    const out = { rep, camp: cs, campDone: !!(cs && cs.week >= cs.weeks), news: (save.news || []).splice(0), cupOut: settled.includes('cupOut') };
    save.week++;
    out.campStart = CAMPS.some((c) => c.from === save.week);
    const lg = save.league;
    out.leagueDone = lg.round >= lg.rounds.length && !lg.doneShown;
    if (out.leagueDone) { lg.doneShown = true; out.pos = standings(save).findIndex((t) => t.me) + 1; }
    seasonWrapTick(save, out);
    renovTick(save, out);
    if (save.week > SEASON_WEEKS) { const pos = standings(save).findIndex((t) => t.me) + 1, from = lg.name, msg = endSeason(save), retired = retiredAt(save, save.season), titles = evalTitles(save); out.season = { msg, pos, from, to: save.league.name, titles, retired, prize: save.lastPrize }; }
    syncSuspend(save);   // 版835
    return out;
  }
  function campAdvance(save) { const o = endWeek(save); return { week: o.camp ? o.camp.week : 0, weeks: CAMP.weeks, done: o.campDone, rep: o.rep }; }
  // 旧API（テスト互換）：全員分のカードを特訓してから週送り
  function trainCards(save, plan) {
    const rep = [];
    save.team.players.forEach((p, i) => { const o = trainOne(save, i, plan.cards && plan.cards[i]); if (o) rep.push(o); });
    weekTick(save);
    plan.cards = {};
    return rep;
  }
  // 試合のあとにもらえるカード：勝つと多い。ゴール・アシスト・無失点に応じた種類も
  const CARD_POOL = Object.keys(CARDS);
  // 版809：試合でもらえる特訓カード（ネット対戦以外のすべての試合）。もらえるのは試合のあとだけで、中身は全種類から同じ確率でランダム。
  //  枚数：結果（負けるほど多い）＋相手との実力差（格上ほど多い。弱い選手を出して格上と戦うと、たくさんもらえる）
  function cardCount(save, myScore, oppName, playedIdx, practice) {
    const r = rng(save), res = myScore[0] > myScore[1] ? 'W' : myScore[0] === myScore[1] ? 'D' : 'L';
    const xi = (playedIdx && playedIdx.length ? playedIdx.slice(0, 11) : [...Array(11).keys()]).map((i) => save.team.players[i]).filter(Boolean);
    const mine = xi.length ? xi.reduce((a, p) => a + avgParam(p), 0) / xi.length : teamLevel(save);
    const opp = oppName ? lvlOf(save, oppName) : mine, gap = opp - mine;
    const gapN = clamp(Math.floor(gap / 3), -1, 6);   // 版811：3ちがうごとに1枚（格上なら最大+6、かなり格下なら−1）
    const n = (res === 'W' ? 4 : res === 'D' ? 5 : 6) + gapN + (r() < 0.5 ? 1 : 0);   // 版810：練習試合も公式戦と同じ枚数
    return { n: clamp(n, 3, 12), gap: Math.round(gap), gapN };   // 版811：最大12枚
  }
  function rewardCards(save, myScore, events, stats, oppName, playedIdx, practice) {
    const r = rng(save), cc = cardCount(save, myScore, oppName, playedIdx, practice), got = [];
    { const pool = CARD_POOL.slice(); for (let k = 0; k < cc.n && pool.length; k++) got.push(pool.splice(Math.floor(r() * pool.length), 1)[0]); }   // 全32種類から同じ確率で。版811：1試合の中では同じカードがダブらない
    save.cards = save.cards || {};
    for (const c of got) save.cards[c] = Math.min(cardMax(save), (save.cards[c] || 0) + 1);
    got.gap = cc.gap; got.gapN = cc.gapN; got.issueN = 0; got.weakN = 0; got.why = [];
    got.coins = 0;   // リーグ戦ではコインはもらえない（コインはカップ戦の賞金と購入で）
    return got;
  }
  // ---------- ショップ（ゲーム内コイン） ----------
  const PRICE = { card: 50, sup: 50, pack5: 200, pack12: 350 };   // 版569：1枚50コイン。パック5枚＝200（1枚40）、金のパック10枚＝350（1枚35）。pack12 の名前は昔のまま（中身は10枚）   // コインは基本、課金で手に入る
  function coinsFor(myScore, events) {
    const goals = (events || []).filter((e) => e.type === 'goal' && e.team === 0).length;
    return (myScore[0] > myScore[1] ? 5 : myScore[0] === myScore[1] ? 3 : 1) + Math.min(goals, 3);   // 試合ではほんの少しだけ
  }
  /* v748 稼いだコイン：試合の賞金など、遊んで手に入れたコイン。特訓カードはこのコインでしか買えない（課金で買ったコインでは買えない） */
  function earnCoins(save, n) { save.coins = (save.coins || 0) + n; save.earned = (save.earned || 0) + n; }
  const earnedOf = (save) => Math.min(save.earned || 0, save.coins || 0);
  function buyCard(save, c) {
    const pr = CARDS[c].cat === 'sup' ? PRICE.sup : PRICE.card;
    if ((save.cards[c] || 0) >= cardMax(save)) return false;   // 版562：もう99枚持っている時は買えない（前はコインだけ減って、枚数は増えなかった）
    if (earnedOf(save) < pr) return false;
    save.coins -= pr; save.earned = earnedOf(save) - pr; save.cards[c] = (save.cards[c] || 0) + 1; return true;
  }
  function buyPack(save, n) {
    const pr = n >= 10 ? PRICE.pack12 : PRICE.pack5;
    if (earnedOf(save) < pr) return null;
    save.coins -= pr; save.earned = earnedOf(save) - pr;
    const r = rng(save), got = [];
    for (let k = 0; k < n; k++) { let c = CARD_POOL[Math.floor(r() * CARD_POOL.length)]; for (let j = 0; j < 30 && (save.cards[c] || 0) >= cardMax(save); j++) c = CARD_POOL[Math.floor(r() * CARD_POOL.length)]; got.push(c); save.cards[c] = Math.min(cardMax(save), (save.cards[c] || 0) + 1); }   // 版564：99枚のカードは出にくく（むだにならないように）
    return got;
  }
  const CARD_MAX = 99;
  // 版695：プレミアムパス（30日）。持っている間は、特訓カードを199枚まで持てる
  const PREM = { yen: 720, days: 30, bonus: 300, daily: { coins: 30, cards: 1, kak: 2 } };
  const premOn = (save) => !!(save && save.prem && save.prem.until > Date.now());
  const cardMax = (save) => (premOn(save) ? 199 : CARD_MAX);
  const TEST_MAX_CARDS = false;   // テスト中：全カードを最大枚数で持つ（版563で外した）
  function starterCards() { const o = {}; for (const c of CARD_POOL) o[c] = TEST_MAX_CARDS ? CARD_MAX : CARDS[c].cat === 'sup' ? 1 : 3; return o; }
  // 暦の変更（リーグ12月4週まで・カップ8回戦）に合わせて、今のシーズンを組み直す
  function migrateCal2(save) {
    const lg = save.league, nw = leagueWeeks(lg.rounds.length, lg.id);
    // 終わった節はそのまま、残りの節は今の週以降の空き週へ
    const rest = nw.filter((w) => w >= save.week);
    for (let k = lg.round; k < lg.rounds.length; k++) lg.weeks[k] = rest[k - lg.round] ?? Math.min(LEAGUE_TO, save.week + (k - lg.round));
    newCup(save);
    while (save.cup.round < CUP_WEEKS.length && CUP_WEEKS[save.cup.round] < save.week && !save.cup.champion) resolveCupRound(save, null);
    if (save.post && save.week <= LEAGUE_TO) save.post = null;
  }
  // 古いセーブを新しい育成ポイントとカードへ
  function migrate(save) {
    try { gachaFixOld(save); } catch (_) {}
    try { for (const p of [...((save.team && save.team.players) || []), ...(save.reserve || [])]) if (p.suspend > 0 && !p.susp) p.suspend = 0; syncSuspend(save); } catch (_) {}   // 版835：前の仕組みで残っていた出場停止（年をまたいだものなど）は消す   // 版506：スカウトで来た強い選手を、弱い状態に
    // ランクの幅を変えた（E→Dを短く）：今までの育成ポイントを、同じランクの同じ位置に移しかえる
    if (save.ptsVer !== 3) {
      const FROM = save.ptsVer === 2 ? RANK_V2 : RANK_OLD;
      for (const p of (save.team && save.team.players) || []) if (p.pts) for (const k of KEYS) {
        const v = p.pts[k], f = FROM.findIndex(([, a0, b0]) => v < b0), i = f < 0 ? 5 : f, [, a, b] = FROM[i], [, a2, b2] = RANK[i];
        p.pts[k] = Math.round((a2 + (b2 - a2) * clamp((v - a) / (b - a), 0, 1)) * 10) / 10; p[k] = toEng(p.pts[k]);
      }
      save.ptsVer = 3;
    }
    if (!save.nameVer) { const NM = {'あおい': 'たちかわ', 'レン': 'ひむろ', 'カイ': 'きりはら', 'ソラ': 'あまみや', 'ナギ': 'なぎさわ', 'リク': 'はやせ', 'ユウ': 'おがわ', 'トワ': 'ときわ', 'ハル': 'はるかわ', 'シン': 'いぶき', 'レオ': 'つつい', 'ケイ': 'あさぎり', 'ルイ': 'みなせ', 'ミナ': 'あやせ', 'コウ': 'ゆうざき', 'ジン': 'ひいらぎ'}; for (const p of (save.team && save.team.players) || []) if (NM[p.name]) p.name = NM[p.name]; save.nameVer = 1; }   // 版456：最初の選手の名前を、カタカナからひらがなの苗字に
    for (const p of (save.team && save.team.players) || []) ensureStar(p);   // ☆（レア度）
    // 利き足（右6割・左4割）。まだ決まっていない選手に付ける
    { const r = rng(save); for (const p of (save.team && save.team.players) || []) if (p.foot !== 'L' && p.foot !== 'R') p.foot = r() < 0.6 ? 'R' : 'L'; }
    // 7リーグ制より前のセーブ：世界を作り直して、地域2部リーグ西の開幕から
    if (!save.world) { makeWorld(save); newLeague(save); newCup(save); save.week = 1; save.post = null; save.migratedWorld = true; }
    fixWorldNames(save);
    /* v737：地域2部カップ／地域1部昇格トーナメント → 地域2部 東西親善試合（シーズン途中のセーブも名前を付け替える） */
    if (save.post) for (const m of save.post.matches) { if (m.comp === '地域2部カップ' || m.comp === '地域1部昇格トーナメント') m.comp = '地域2部 東西親善試合'; for (const k of ['key', 'next']) if (m[k] === '地域2部カップ:F' || m[k] === '地域1部昇格トーナメント:F') m[k] = '地域2部 東西親善試合:F'; }
    if (save.world) for (const id in save.world.leagues) for (const t of save.world.leagues[id]) if (ROSTERS[t.id]) t.lvl = lvlAt(t.id, save.season);   // 固定選手の強さに合わせる
    if (save.league) ensureOthers(save);
    if (save.cup && save.cup.ver !== 2 && save.cup.ver !== 3) migrateCal2(save);
    if (save.cup && save.cup.ver === 2) {   // 毎回組み合わせを決め直す方式 → 最初から最後まで決まっているトーナメントへ（今の週までの試合は進めておく）
      const log = save.cup.log || []; newCup(save); save.cup.log = log;
      while (save.cup.round < CUP_WEEKS.length && CUP_WEEKS[save.cup.round] < save.week && !save.cup.champion) resolveCupRound(save, null);
      save.cupRemade = true;
    }
    if (save.titles) evalTitles(save);   /* v764：国内屈指は元の持ち主に戻す */
    if (save.earned == null) save.earned = Math.max(0, (save.coins || 0) - (save.buys || []).reduce((a, b) => a + (b.coins || 0), 0) - (save.premBonusGot || 0));   /* v748：今あるコインのうち、買った分をのぞいた分を「稼いだコイン」に */
    const r0 = rng(save);
    if (save.potVer !== 3) { for (const p of save.team.players.concat(save.reserve || [])) { delete p.pot; p.cond = condOf(p); } save.potVer = 3; }   // 版514：ポテンシャルをやめて調子に   // ポテンシャルの進み方を本家のペースに直したので、付け直す
    for (const p of save.team.players) { ensurePts(p); }
    for (const p of [...save.team.players, ...(save.reserve || [])]) { const U = p.uniq && D.UNIQ[p.uniq]; if (U && U.type && p.type !== U.type) { p.type = U.type; const pr = protoOf(U.type); for (const k of HKEYS) p[k] = pr[k]; } }   // 版677：国内屈指級で、前の版でタイプが変わってしまった選手は、元のタイプに戻す
    if (!(save.cardsVer >= 4)) { save.cards = starterCards(); save.cardsVer = 4; if (save.plan) save.plan.cards = {}; }
    if (save.coins == null || save.coinsVer !== 2) { save.coins = 0; save.coinsVer = 2; }
    if (TEST_MAX_CARDS) for (const c of CARD_POOL) save.cards[c] = CARD_MAX;
    else if (save.cardsVer === 4) { save.cards = starterCards(); save.cardsVer = 5; if (save.plan) save.plan.cards = {}; }   // 版563：テストで99枚になっていたカードを、始めた時の枚数に戻す（1回だけ）
  }
  root.__resolveCup = (s) => resolveCupRound(s, null);
  const cpuTeam = (id) => (ROSTERS[id] && TEAM_BY_ID[id] ? rosterTeam(null, TEAM_BY_ID[id], rosterAt(id, 1)) : null);   // 確認ページ用：CPUチームをそのまま試合に出す

  // ================= 版505：スカウト（選手ガチャ）=================
  // 毎月1日に切りかわる。ピックアップは固有スキルを持つ☆5の18人を1か月に1人ずつ。天井：そのガチャで200回引くとピックアップ確定
  const GACHA_ORDER = ['guren', 'tsukikage', 'minato', 'byakuya', 'midori', 'kinshachi', 'aonoouza', 'harinoana', 'shiden', 'kagenui', 'matsuri', 'miyabi', 'sakurajima', 'ikari', 'uzushio', 'kage', 'tetsurou', 'sutemi'];
  const GACHA_START = [2026, 9];   // 2026年10月から（月は0から数える）
  const GACHA_RATE = [[5, 1], [4, 4], [3, 15], [2, 30], [1, 50]];   // 版912：☆5は1%（版911の0.5%から戻した）。☆5は国内屈指の18人のだれか（ピックアップなし）   // 版662：☆5は1%（☆1を50%に）   // ☆ と 確率（％）
  const GACHA_COST = { one: 100, ten: 900 }, GACHA_PITY = 200;   // 版572：10回まとめてだと1回ぶんお得（900）
  const KAKERA_OF = { 1: 1, 2: 2, 3: 5, 4: 15, 5: 50 };
  // 版642：覚醒のカケラで凸（覚醒）する。1回で凸が1つ上がる（最大3凸）。☆が高いほどたくさん必要
  const AWAKE_COST = { 1: 10, 2: 20, 3: 50, 4: 150, 5: 500 };
  const awakeCost = () => 100;   // 版643：レア度に関係なく、カケラ100個で1凸
  function awaken(save, p) { const tz = p.totsu || 0, c = awakeCost(p); if (tz >= 3 || (save.kakera || 0) < c) return false; save.kakera -= c; p.totsu = tz + 1; return true; }   // 完凸のあとに同じ選手が出た時の覚醒のカケラ
  let gachaPool = null;
  function gachaPoolAll() {
    if (gachaPool) return gachaPool;
    gachaPool = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const tid in ROSTERS) for (const q of rosterAt(tid, 1).players) { const st = starOf(tid, q); gachaPool[st].push({ tid, no: q.no }); }
    return gachaPool;
  }
  // 版910：ピックアップをやめて、国内屈指の18人を全員入れる（☆5が出たら18人のだれか。1人あたり0.5%÷18）
  const GACHA_ALL = true;
  let gachaUL = null;
  function gachaUniqList() {   // 版912：国内屈指の18人は、ロスターの「国内屈指」の印（top）で探す（顔の絵の番号ではない。針の穴通しのきのしたは、なにわの顔の絵を使っている）
    if (gachaUL) return gachaUL; const L = [];
    for (const key of GACHA_ORDER) { let hit = null; for (const tid in ROSTERS) { const q = rosterAt(tid, 1).players.find((x) => x.top && D.UNIQ_BY_TOP && D.UNIQ_BY_TOP[x.top] === key); if (q) { hit = { key, tid, no: q.no }; break; } } if (hit) L.push(hit); }
    return (gachaUL = L);
  }
  function gachaBanner(date) {
    if (GACHA_ALL) return { id: 'all', key: 'all', all: true, list: gachaUniqList(), until: '' };
    const d = date || new Date(), m = (d.getFullYear() - GACHA_START[0]) * 12 + d.getMonth() - GACHA_START[1];
    const i = ((m % GACHA_ORDER.length) + GACHA_ORDER.length) % GACHA_ORDER.length, key = GACHA_ORDER[i], U = D.UNIQ[key];
    const [tid, no] = U.face.split('_'), end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { id: (d.getFullYear() * 100 + d.getMonth() + 1) + ':' + key, key, uniq: U, tid, no: +no, until: `${end.getMonth() + 1}月${end.getDate()}日` };
  }
  function gachaQ(tid, no) { return rosterAt(tid, 1).players.find((q) => q.no === no); }
  function ensureGacha(save) { if (!save.gacha) save.gacha = { pity: {}, total: 0 }; if (GACHA_ALL && save.gacha.pity && save.gacha.pity.all == null) { const d = new Date(), k = (d.getFullYear() * 100 + d.getMonth() + 1) + ':'; let c = 0; for (const id in save.gacha.pity) if (id.startsWith(k)) c = Math.max(c, save.gacha.pity[id] || 0); save.gacha.pity.all = c; }   /* 版910：今月のピックアップの天井の回数を、そのまま引き継ぐ */ if (save.kakera == null) save.kakera = 0; gachaFixOld(save); return save.gacha; }
  function gachaOne(save, bn, r, minStar) {
    const g = ensureGacha(save); g.pity[bn.id] = (g.pity[bn.id] || 0) + 1;
    let star; const u = r() * 100; let acc = 0; for (const [s, pct] of GACHA_RATE) { acc += pct; if (u < acc) { star = s; break; } } star = star || 1;
    if (minStar && star < minStar) star = minStar;
    let pick;
    if (g.pity[bn.id] >= GACHA_PITY) star = 5;   // 天井：200回で☆5確定
    if (bn.all) {
      if (star === 5) { const L = bn.list, u5 = L[Math.floor(r() * L.length)]; pick = { tid: u5.tid, no: u5.no }; g.pity[bn.id] = 0; }   // 版910：☆5は18人のだれか。☆5が出たら天井の数え直し
      else { const L = gachaPoolAll()[star]; pick = L[Math.floor(r() * L.length)]; }
    } else {
      if (star === 5) pick = { tid: bn.tid, no: bn.no };   // 版553：☆5は今月のピックアップの選手だけ
      else { const L = gachaPoolAll()[star]; pick = L[Math.floor(r() * L.length)]; }
      if (pick.tid === bn.tid && pick.no === bn.no) g.pity[bn.id] = 0;   // ピックアップが出たら天井の数え直し
    }
    return { ...pick, star };
  }
  // 引いた選手を自分のチームへ：はじめての選手は加入、同じ選手は凸、完凸のあとは覚醒のカケラ
  function gachaApply(save, pick) {
    const q = gachaQ(pick.tid, pick.no), ps = save.team.players;
    if (!save.reserve) save.reserve = [];
    const own = ps.find((p) => p.gsrc === pick.tid + '_' + pick.no) || save.reserve.find((p) => p.gsrc === pick.tid + '_' + pick.no);
    if (own) {
      if ((own.totsu || 0) < 3) { const from = own.totsu || 0; own.totsu = from + 1; return { kind: 'totsu', p: own, from, to: own.totsu, star: pick.star, q, tid: pick.tid }; }
      const k = KAKERA_OF[pick.star] || 1; save.kakera = (save.kakera || 0) + k; return { kind: 'kakera', p: own, kakera: k, star: pick.star, q, tid: pick.tid };
    }
    if ((save.gacha && save.gacha.auto || 0) >= pick.star) { const k = KAKERA_OF[pick.star] || 1; save.kakera = (save.kakera || 0) + k; return { kind: 'auto', kakera: k, star: pick.star, q, tid: pick.tid }; }   // 版509：自動放出（はじめての選手でも、その☆以下ならカケラに）
    const full = ps.length >= 25;   // チームは25人まで。あふれた選手はリザーブ（控え室）へ
    const p = rosterPlayer(q, ps.length); const topHc = p.topHair; delete p.topHair; delete p.role;
    const used = new Set([...ps, ...save.reserve].map((x) => x.number)); let n = q.no; if (used.has(n)) { n = 12; while (used.has(n)) n++; } p.number = n;   // 版559：控え室（リザーブ）の選手の番号も見る（26番が何人もできていた）
    p.star = pick.star; p.totsu = 0; p.gsrc = pick.tid + '_' + pick.no; p.faceKey = faceKeyOf(pick.tid, q) || undefined;
    { const hc = topHc || (p.faceKey && root.STAR_HAIR && root.STAR_HAIR[p.faceKey]); if (hc != null) p.hairColor = hc; }   // 版555：国内屈指級はその選手だけの髪の色（CPUの時と同じ）
    p.fatigue = 10; p.cond = 0; p.injury = 0; p.games = 0; p.foot = p.foot || (Math.random() < 0.2 ? 'L' : 'R'); delete p.age; gachaWeak(p);
    if (full) { p.gNew = 1; save.reserve.push(p); } else ps.push(p);   // 版915：リザーブに入った新しい選手は、リザーブの一番上に出す（gNew）
    return { kind: 'new', p, star: pick.star, q, tid: pick.tid, reserve: full };
  }
  // 版506：スカウトで来た選手は、育てる前の弱い状態（能力はE〜C）。得意・不得意の形（どの能力が高いか）はそのまま残す
  function gachaWeak(p) {
    if (p.gweak >= 2) return; if (p.gweak) { p.skills = []; p.gweak = 2; return; } ensurePts(p);
    const v = KEYS.map((k) => p.pts[k]), lo = Math.min(...v), hi = Math.max(...v), A = RANK[0][1] + 2, B = RANK[2][2] - 1;
    for (const k of KEYS) { const u = hi > lo ? (p.pts[k] - lo) / (hi - lo) : 0.5; p.pts[k] = Math.round((A + (B - A) * Math.pow(u, 1.15)) * 10) / 10; p[k] = toEng(p.pts[k]); }
    p.skills = []; p.totsu = p.totsu || 0;   // 版507：スキルは0から（固有スキルはそのまま）
    p.gweak = 2;
  }
  // 版559：背番号がかぶっていたら直す（先にいる選手はそのまま、あとの選手を空いている番号へ）。試合では背番号で選手を探すので、かぶると得点者や演出が別の選手になる
  function fixNumbers(save) {
    const all = [...save.team.players, ...(save.reserve || [])], seen = new Set(), dup = [];
    for (const p of all) { if (p.number >= 1 && p.number <= 99 && !seen.has(p.number)) seen.add(p.number); else dup.push(p); }
    for (const p of dup) { let n = 12; while (seen.has(n) && n < 99) n++; if (seen.has(n)) { n = 1; while (seen.has(n)) n++; } p.number = n; seen.add(n); }
    return dup.length;
  }
  function gachaFixOld(save) { try { fixNumbers(save); } catch (_) {}
    try {   // 版912：版911のスカウトで、針の穴通しの代わりに、なにわの「おおの」（ふつうの選手）が☆5で来てしまった。正しい国内屈指（薩摩のきのした）に入れ替える
      const lists = [save.team.players, save.reserve || []];
      for (const L of lists) for (let i = 0; i < L.length; i++) { const p = L[i]; if (!(p.gsrc === 'naniwa_10' && p.star === 5)) continue;
        const ok = [...save.team.players, ...(save.reserve || [])].find((x) => x.gsrc === 'satsuma_8');
        if (ok) { ok.totsu = Math.min(3, (ok.totsu || 0) + 1 + (p.totsu || 0)); L.splice(i, 1); i--; continue; }
        const q = gachaQ('satsuma', 8); if (!q) continue; const np = rosterPlayer(q, 0); const hc = np.topHair; delete np.topHair; delete np.role;
        Object.assign(np, { gNew: 1, number: p.number, star: 5, totsu: p.totsu || 0, gsrc: 'satsuma_8', faceKey: faceKeyOf('satsuma', q) || undefined, fatigue: p.fatigue || 10, cond: 0, injury: 0, games: p.games || 0, foot: np.foot || 'R' }); delete np.age;
        { const h2 = hc || (np.faceKey && root.STAR_HAIR && root.STAR_HAIR[np.faceKey]); if (h2 != null) np.hairColor = h2; }
        np.gweak = 0; gachaWeak(np); L[i] = np; }
    } catch (_) {} for (const p of [...save.team.players, ...(save.reserve || [])]) { if (p.gsrc && (p.gweak || 0) < 2) gachaWeak(p); if (p.gsrc && p.uniq && D.UNIQ[p.uniq] && D.UNIQ[p.uniq].hair) p.hairColor = D.UNIQ[p.uniq].hair; } }   // 版555：前に来た国内屈指級の髪の色も直す
  function gachaPull(save, n, r) {
    r = r || Math.random; const bn = gachaBanner(), cost = n >= 10 ? GACHA_COST.ten : GACHA_COST.one * n;
    if ((save.coins || 0) < cost) return null;
    save.coins -= cost; save.earned = earnedOf(save); ensureGacha(save).total += n;   /* スカウトは、課金のコインから先に使う */
    const picks = []; for (let i = 0; i < n; i++) picks.push(gachaOne(save, bn, r, n >= 10 && i === n - 1 && !picks.some((x) => x.star >= 3) ? 3 : 0));   // 10連は☆3以上を1人確定
    return { banner: bn, results: picks.map((pk) => gachaApply(save, pk)) };
  }
  root.DotCareer = { skKind, slotsOf, skillsOf, syncSuspend, PREFS, prefRegion, setHometown, earnCoins, earnedOf, homeTier, myNextLg, PREM, premOn, cardMax, awaken, awakeCost, AWAKE_COST, registerGuest, guestCode, GUESTS, champPeek, CARD_MAX, noSkillLg, gachaBanner, gachaPull, gachaPoolAll, ensureGacha, GACHA_RATE, GACHA_COST, GACHA_PITY, KAKERA_OF, oppKits, BENCH_N, kitsPair, d1Round, pinWatch, faceKeyOf, cpuTeam, ensureStar, starOf, totsuOf, capGrade, capPts, capIdx, GRADES, rosterAt, lvlAt, retiredAt, titleOf, ensureTitles, evalTitles, CUP_LABELS, cupIn, ensureClub, renameClub, kitsFor, KIT_DEFAULT, EMB_DEFAULT, TEAMS, TEAM_BY_ID, ROSTERS, rosterOfTeam, leagueTable, prevOrder, goalRank, recordGoals, CUP_WEEKS_ALL: CUP_WEEKS, leagueWeeksOf: leagueWeeks, POST_WEEKS, CARDS, CAT_NAME, SP, findSpecial, previewCards, trainCards, trainOne, weekTick, GRID_R, GRID_C, zoneOf, cellsFor, formationLabel, FORMATIONS, TACTIC_ITEMS, STYLES, SITU_DEFAULT, SITU_ACTS, SITU_ROWS, SITU_FROM, ensureTactics, slotRoles, applyTactics, skillRate, endWeek, SEASON_WEEKS, INJURIES, TYPE_TUNE, COND_NAME, condOf, trainedThisWeek, trainsDone, trainLimit, trainMult, campState, campAdvance, CAMP, slotInfo, SLOT_MAX, SKILL_RATE, rewardCards, newLeague, newCup, playFixture, peekRound, afterOfficial, playPractice, practiceOpponent, practiceOptions, teamLook, recordStats, teamLevel, findTeam, CUP_WEEKS, CAMPS, LG, rankInfo, PMAX, PRICE, buyCard, buyPack, toEng, toPts, migrate, ensurePts, TEAM_MENUS: TEAM_PTS, MENUS, SPECIAL, LEAGUES, PNAME, newCareer, menusFor, train, learnSkill, slots, skillChance, nextFixture, finishRound, standings, endSeason, opponentTeam, matchTeam, avgParam, decideType, TYPES_BY_POS };
})(typeof window !== 'undefined' ? window : globalThis);
