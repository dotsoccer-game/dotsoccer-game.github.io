// ドットサッカー 試合エンジン
// ボール・選手を毎ステップ動かして試合を作る。勝敗はプレーの結果だけで決まる。
// 通常の <script> でも Node の import でも動くよう、import/export は使わず globalThis に載せる。
(function (root) {
  'use strict';

  // ---------- 基本定数 ----------
  const L = 105, W = 68;                 // ピッチ（m）
  const GOAL_Y = 34, POST = 4.6;         // ゴール中央と半幅（見やすさと得点のため本物より少し大きめ）
  const BAR = 3.1;
  const DT = 0.1;                        // 1ステップの秒数
  // ---------- スキル・動きを使うエリア（「スキルのエリア設定」ページで決めた表）----------
  // 15文字＝縦5（自陣ゴール前・自陣・中盤・敵陣・敵ゴール前）×横3（左サイド・中央・右サイド。攻める向きで見る）。0＝使わない 1＝普通 2＝積極的
  const ZONE_RULES = {"break":"000101111222222","carry":"111111111111111","pace":"000111111222111","speedDribble":"000000212222111","scissors":"000000111222111","bodyFeint":"000000111222222","doubleTouch":"000000111222111","roulette":"000000111222111","elastico":"000000111222111","nutmeg":"000000111222222","cutIn":"000000101202212","heelLift":"000000000202101","kickFeint":"000000000121222","driveShot":"000000000020020","powerMid":"000000000121111","superLong":"000000010121111","controlShot":"000000000111222","nearPost":"000000000111222","toeKick":"000000000111222","lob":"000000000111222","volley":"000000000111222","direct":"000000000111222","divingHeader":"000000000000222","bicycle":"000000000000222","throughPass":"000111222222111","loftedThrough":"000111222222111","longFeed":"111222111000000","switchPlay":"000111222111000","earlyCross":"000000000202101","pinpointCross":"000000000101202","oneTouchPass":"000111111222222","noLook":"000111111222222","heelPass":"000000111222222","wallPass":"000000111222222","slide":"000222111111111","intercept":"111111222111111","manMark":"222222111111111","cover":"222222111000000","shoulder":"111111111111111","aerial":"222111111111222","shotBlock":"222111000000000","pressMonster":"111111222222222","recovery":"222222111111111","behindRun":"000000111222222","postPlay":"000000111121111","nearRun":"000000000000222","farWait":"000000000000222","overlap":"000101202202101","looseBall":"111111111111222","oneTwo":"000000111222222"};
  const FAT_KEYS = ['kick', 'technique', 'dribble', 'pass', 'dash', 'physical', 'jump', 'defense', 'vision', 'mental'];   /* 疲れで下がる能力（スピードは別の計算） */
  const STAM_K = 3.5;   // スタミナの減り（本家に合わせて、終盤はしっかり疲れる）
  const HALF_REST = 10;
  const KICKOUT_WAIT = 12;               // 交代を待つ時間（実時間の秒。12秒＝試合時間で約2分半）がこれを超えたら、外へ蹴り出す
  const OUT_CLEAR = 0.5, POKE_EDGE = 12, POKE_OUT = 0.5;   // ボールが外に出る頻度（蹴り出すクリア・タッチライン際でつつき出したボール）                  // ハーフタイムの回復
  const HALF = 225;                      // 前後半それぞれの実時間（秒）
  const CLOCK_SCALE = (45 * 60) / HALF;  // 表示時計への倍率
  const FRAME_EVERY = 1;                 // 何ステップごとに記録するか

  // ---------- 乱数 ----------
  function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    const next = () => {
      let t = (s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range: (a, b) => a + (b - a) * next(),
      int: (n) => Math.floor(next() * n),
      gauss: () => Math.sqrt(-2 * Math.log(Math.max(1e-9, next()))) * Math.cos(2 * Math.PI * next()),
    };
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hyp = Math.hypot;

  // ---------- チームデータ ----------
  const HIDDEN0 = { zone_man: 0, press: 10, support: 10, overlap: 10, run_space: 10, goal_wait: 10 };
  const TYPE_HIDDEN = {
    'ゴールキーパー': {},
    'スイーパー': { zone_man: -68, press: 22 },
    'ストッパー': { zone_man: 45, press: 74 },
    'マンマーカー': { zone_man: 78, press: 30 },
    'レジスタ': { support: 80, overlap: 22, run_space: 18, goal_wait: 12 },
    'ダイナモ': { support: 30, overlap: 82, run_space: 62, goal_wait: 22 },
    'ストライカー': { support: 14, overlap: 12, run_space: 34, goal_wait: 88 },
    'アタッカー': { support: 22, overlap: 34, run_space: 86, goal_wait: 52 },
    'ゲームメイカー': { support: 66, overlap: 28, run_space: 24, goal_wait: 16 },
    'ラインコントローラー': { zone_man: -20, press: 52 },
    'パサー': { support: 48, overlap: 44, run_space: 36, goal_wait: 22 },
    // 追加タイプ（2026-10-08）
    '偽9番': { support: 72, overlap: 20, run_space: 28, goal_wait: 30 },          // 中盤に下りて受け、組み立てにも参加するFW
    'デコイラン': { support: 8, overlap: 50, run_space: 96, goal_wait: 18 },       // 裏へ走り続けて相手DFを引きつけ、味方のスペースを作るFW
    'ファンタジスタ': { support: 50, overlap: 30, run_space: 42, goal_wait: 36 },  // ドリブルと発想で崩す自由なMF
    'シャドー': { support: 18, overlap: 58, run_space: 72, goal_wait: 64 },        // FWの後ろから飛び出して点を取るMF
    'アンカー': { zone_man: 20, press: 64, support: 42, overlap: 4, run_space: 4, goal_wait: 2 },   // 中盤の底にどっしり構える守備的MF
    'ビルドアップ型': { zone_man: -40, press: 18, support: 52 },                    // 後ろから正確なパスで組み立てるDF
    'スイーパーキーパー': { run_space: 80, goal_wait: 4 },                          // 前へ飛び出して裏へのボールを処理するGK
    'バランス': {},
  };

  // スペシャルスキル（特訓のスペシャルメニューで覚える。覚えていないと試合では出ない）
  const SKILLS = {
    knuckle: { name: '無回転シュート', short: '無回転' },
    curve: { name: 'カーブキック', short: 'カーブ' },
    fk: { name: 'FKマイスター', short: 'FKマイスター' },
    ckMaster: { name: 'CKマイスター', short: 'CKマイスター', group: 'set' },
    longThrow: { name: 'ロングスロー', short: 'ロングスロー', group: 'set' },
    pkMaster: { name: 'PKの名手', short: 'PKの名手', group: 'set' },
    wallPass: { name: '壁パス', short: '壁パス', group: 'set' },
    slide: { name: 'スライディング', short: 'スライディング' },
    feint: { name: 'ボディフェイント', short: 'ボディフェイント' },   // 旧名（ボディフェイントとして扱う）
    dribbleShot: { name: 'ドライブシュート', short: 'ドライブ' },   // 旧名（ドリブルシュートは標準の打ち方になった。覚えていた選手はドライブシュートとして扱う）
    // ドリブル系
    scissors: { name: 'シザース', short: 'シザース', group: 'dribble' },
    roulette: { name: 'マルセイユルーレット', short: 'ルーレット', group: 'dribble' },
    elastico: { name: 'エラシコ', short: 'エラシコ', group: 'dribble' },
    doubleTouch: { name: 'ダブルタッチ', short: 'ダブルタッチ', group: 'dribble' },
    bodyFeint: { name: 'ボディフェイント', short: 'ボディフェイント', group: 'dribble' },
    nutmeg: { name: '股抜き', short: '股抜き', group: 'dribble' },
    speedDribble: { name: '高速ドリブル', short: '高速ドリブル', group: 'dribble' },
    cutIn: { name: 'カットイン', short: 'カットイン', group: 'dribble' },
    heelLift: { name: 'ヒールリフト', short: 'ヒールリフト', group: 'dribble' },
    kickFeint: { name: 'キックフェイント', short: 'キックフェイント', group: 'dribble' },
    // シュート系
    volley: { name: 'ボレー', short: 'ボレー', group: 'shot' },
    lob: { name: 'ループ', short: 'ループ', group: 'shot' },
    direct: { name: 'ダイレクト', short: 'ダイレクト', group: 'shot' },
    bicycle: { name: 'バイシクル', short: 'バイシクル', group: 'shot' },
    divingHeader: { name: 'ダイビングヘッド', short: 'ダイビングヘッド', group: 'shot' },
    toeKick: { name: 'トゥーキック', short: 'トゥーキック', group: 'shot' },
    nearPost: { name: 'ニア上ぶち抜き', short: 'ニア上', group: 'shot' },
    driveShot: { name: 'ドライブシュート', short: 'ドライブ', group: 'shot' },   // 縦回転：バーを越えると見せて急に落ち、バーすれすれに入る
    powerMid: { name: '強烈ミドル', short: '強烈ミドル', group: 'shot' },
    controlShot: { name: 'コントロールショット', short: 'コントロール', group: 'shot' },
    superLong: { name: '超ロングシュート', short: '超ロング', group: 'shot' },
    // パス系
    throughPass: { name: 'スルーパス', short: 'スルーパス', group: 'pass' },
    loftedThrough: { name: '浮き球スルーパス', short: '浮き球スルー', group: 'pass' },
    noLook: { name: 'ノールックパス', short: 'ノールック', group: 'pass' },
    oneTouchPass: { name: 'ワンタッチパス', short: 'ワンタッチ', group: 'pass' },
    heelPass: { name: 'ヒールパス', short: 'ヒール', group: 'pass' },
    longFeed: { name: 'ロングフィード', short: 'ロングフィード', group: 'pass' },
    earlyCross: { name: 'アーリークロス', short: 'アーリー', group: 'pass' },
    pinpointCross: { name: 'ピンポイントクロス', short: 'ピンポイント', group: 'pass' },
    switchPlay: { name: 'サイドチェンジ', short: 'サイドチェンジ', group: 'pass' },
    // 守備系（基本の動作なので吹き出しは出さない。動きと結果で分かる）
    intercept: { name: 'インターセプト', short: 'インターセプト', group: 'def' },
    manMark: { name: 'マンマーク', short: 'マンマーク', group: 'def' },
    cover: { name: 'カバーリング', short: 'カバーリング', group: 'def' },
    shoulder: { name: 'ショルダーチャージ', short: 'ショルダー', group: 'def' },
    aerial: { name: '空中戦の鬼', short: '空中戦', group: 'def' },
    shotBlock: { name: 'シュートブロック', short: 'ブロック', group: 'def' },
    pressMonster: { name: 'プレスの鬼', short: 'プレス', group: 'def' },
    recovery: { name: '帰陣ダッシュ', short: '帰陣', group: 'def' },
    // GK
    superReflex: { name: '超反応', short: '超反応', group: 'gk' },
    punching: { name: 'パンチング', short: 'パンチング', group: 'gk' },
    rushOut: { name: '飛び出し', short: '飛び出し', group: 'gk' },
    pkStopper: { name: 'PKストッパー', short: 'PKストッパー', group: 'gk' },
    oneOnOne: { name: '1対1の鬼', short: '1対1', group: 'gk' },
    lowThrow: { name: '低弾道スロー', short: '低弾道スロー', group: 'gk' },
    lowPunt: { name: '低弾道パントキック', short: '低弾道パント', group: 'gk' },
    coaching: { name: 'コーチング', short: 'コーチング', group: 'gk' },
    // オフザボール
    behindRun: { name: '裏への抜け出し', short: '裏抜け', group: 'offball' },
    postPlay: { name: 'ポストプレー', short: 'ポスト', group: 'offball' },
    nearRun: { name: 'ニアに飛び込む', short: 'ニア', group: 'offball' },
    farWait: { name: 'ファーで待つ', short: 'ファー', group: 'offball' },
    overlap: { name: 'オーバーラップ', short: 'オーバーラップ', group: 'offball' },
    looseBall: { name: 'こぼれ球の嗅覚', short: 'こぼれ球', group: 'offball' },
    oneTwo: { name: 'ワンツーの名手', short: 'ワンツー', group: 'offball' },
    // メンタル・特性
    captaincy: { name: 'キャプテンシー', short: 'キャプテン', group: 'mental' },
    bigStage: { name: '大舞台に強い', short: '大舞台', group: 'mental' },
    lateGrit: { name: '終盤の粘り', short: '粘り', group: 'mental' },
    clutch: { name: '勝負強さ', short: '勝負強さ', group: 'mental' },
    moodMaker: { name: 'ムードメーカー', short: 'ムード', group: 'mental' },
    fighting: { name: '闘志', short: '闘志', group: 'mental' },
    calm: { name: '冷静', short: '冷静', group: 'mental' },
    ironMan: { name: '鉄人', short: '鉄人', group: 'mental' },
  };
  // パス技の正確さ（ブレの倍率。小さいほど正確）と、相手に読まれにくいか
  const PASS_ACC = { throughPass: 0.55, loftedThrough: 0.6, noLook: 0.7, oneTouchPass: 0.65, heelPass: 0.8, longFeed: 0.4, earlyCross: 0.6, pinpointCross: 0.1, switchPlay: 0.45 };
  const PASS_TRICK = { throughPass: 1, loftedThrough: 1, noLook: 1, heelPass: 1, oneTouchPass: 1 };
  // シュート技が出せる場面
  //  ・PA内：ボレー・ループ・ダイレクト・バイシクル・ダイビングヘッド・ドリブルシュート・トゥーキック・ニア上ぶち抜き
  //  ・PA外のミドル：無回転・強烈ミドル
  //  ・PA内外の、少し角度のついた両翼付近：コントロールショット・強烈ミドル・ドリブルシュート・ニア上ぶち抜き
  //  ・ハーフウェーライン付近：超ロングシュート
  const SHOT_ZONES = {
    box: ['volley', 'lob', 'bicycle', 'divingHeader', 'toeKick', 'nearPost', 'controlShot'],
    mid: ['knuckle', 'powerMid', 'controlShot'],
    vital: ['driveShot'],
    wing: ['controlShot', 'powerMid', 'nearPost'],
    half: ['superLong'],
  };
  // GKの止めやすさへの影響（大きいほど止めにくい）
  const SHOT_GK_PEN = { toeKick: 0.05, dribbleShot: 0, driveShot: 0.3, nearPost: 0.12, volley: 0.08, bicycle: 0.15, powerMid: 0.06, controlShot: 0.18, divingHeader: 0.06, direct: 0.06, superLong: 0.1 };
  // ドリブル技が出せる場面
  //  ・中盤より前（自陣の最終ライン付近以外）ならいつでも：シザース・ルーレット・エラシコ・ダブルタッチ・ボディフェイント・股抜き・高速ドリブル・切り返し
  //  ・狭い所（相手に囲まれている）の打開：ダブルタッチ・股抜き・切り返し
  //  ・サイドでの1対1：ヒールリフト・股抜き・シザース・エラシコ・ダブルタッチ・ボディフェイント
  //  ・ゴール前：キックフェイント・切り返し・ボディフェイント
  const DRIB_ZONES = {
    mid: ['scissors', 'roulette', 'elastico', 'doubleTouch', 'bodyFeint', 'nutmeg', 'speedDribble'],
    narrow: ['doubleTouch', 'nutmeg'],
    side: ['heelLift', 'nutmeg', 'scissors', 'elastico', 'doubleTouch', 'bodyFeint', 'cutIn'],
    goal: ['kickFeint', 'bodyFeint'],
  };

  // ---------- 表の能力（12個）----------
  // カルチョビットAの7つ（キック・スピード・スタミナ・テクニック・フィジカル・ジャンプ・メンタル）に、
  // ダッシュ・ドリブル・パス・ディフェンス・判断の5つを足した12個。S〜Eで表示
  const PARAMS = [
    { k: 'kick', name: 'キック', g: 'tech', desc: 'シュートの強さと正確さ' },
    { k: 'technique', name: 'テクニック', g: 'tech', desc: 'トラップ・キープ・ボール扱い' },
    { k: 'dribble', name: 'ドリブル', g: 'tech', desc: '相手を抜く力・ボールを運ぶ力' },
    { k: 'pass', name: 'パス', g: 'tech', desc: 'パス・クロスの正確さと強さ' },
    { k: 'speed', name: 'スピード', g: 'phys', desc: '走る速さ（最高速）' },
    { k: 'dash', name: '瞬発力', g: 'phys', desc: '加速・一歩目の速さ' },
    { k: 'stamina', name: 'スタミナ', g: 'phys', desc: '試合中の運動量・バテにくさ' },
    { k: 'physical', name: 'フィジカル', g: 'phys', desc: '当たりの強さ・競り合い' },
    { k: 'jump', name: 'ジャンプ', g: 'phys', desc: 'ハイボール・ヘディング（GKにも大事）' },
    { k: 'defense', name: '守備', g: 'mind', desc: 'ボールを奪う力・パスカット' },
    { k: 'vision', name: '判断', g: 'mind', desc: '視野・パスコースを読む・良い選択' },
    { k: 'mental', name: 'メンタル', g: 'mind', desc: 'PK・1対1・終盤など大事な場面の強さ' },
  ];
  const PARAM_KEYS = PARAMS.map((p) => p.k);
  // タイプごとの得意・不得意（5つの基本能力から残りの7つを作る時のくせ）
  const TYPE_BIAS = {
    'ゴールキーパー': { jump: 10, mental: 4, dribble: -16, pass: -6, defense: -10, vision: 2, dash: 2 },
    'スイーパー': { jump: 4, defense: 10, vision: 8, pass: 4, dribble: -6 },
    'ストッパー': { jump: 8, defense: 12, physical: 0, dribble: -8, vision: -2 },
    'マンマーカー': { jump: 2, defense: 12, dash: 4, dribble: -6 },
    'レジスタ': { pass: 10, vision: 10, dribble: 2, defense: -2, jump: -4 },
    'ダイナモ': { dash: 6, defense: 4, pass: 2, mental: 2 },
    'ストライカー': { jump: 6, dribble: 2, defense: -14, vision: -2, mental: 4 },
    'アタッカー': { dribble: 10, dash: 6, defense: -12, jump: -4 },
    'ゲームメイカー': { pass: 9, vision: 12, technique: 6, kick: 2, defense: -6, jump: -4 },
    'ラインコントローラー': { defense: 10, vision: 10, mental: 4, dribble: -6, jump: 2 },
    'パサー': { pass: 12, vision: 8, kick: 4, technique: 2, defense: -8, jump: -4 },
    '偽9番': { pass: 6, vision: 8, dribble: 4, defense: -10, jump: -4 },
    'デコイラン': { dash: 10, mental: 4, dribble: -2, defense: -10 },
    'ファンタジスタ': { dribble: 12, vision: 6, pass: 2, defense: -12, jump: -6 },
    'シャドー': { dash: 6, dribble: 4, defense: -8, jump: 2 },
    'アンカー': { defense: 12, vision: 6, pass: 4, mental: 4, dribble: -6 },
    'ビルドアップ型': { pass: 10, vision: 8, defense: 6, dribble: -2 },
    'スイーパーキーパー': { jump: 6, dash: 8, pass: 2, mental: 4, dribble: -10, defense: -8 },
    'バランス': {},
  };
  // ===== 固有スキル（国内屈指の18人だけが持つ。その選手だけのもの）=====
  //  chip＝頭の上の吹き出しの色（地・ふち・文字）。スキル名に合わせた色
  //  hair＝試合のドット絵の髪の色（その選手だけの鮮やかな色。ほかの選手とかぶらない）、skin＝顔を入れ替えた選手のドット絵の肌（顔の絵に合わせる）
  //  p.uniq＝キー、p.uniqLv＝強さ（1＝ふつう、2＝凸で強化：出やすさ・効果・続く時間が上がる）
  //  dur＝効果が続く時間（秒）、cd＝次に出せるまでの間（秒）、ch＝条件がそろった時に出る確率
  const UNIQ = {
    guren:      { sw: 'シュートを打つとき', se: 'シュートの威力と精度が大きく上がり、GKが反応しにくくなる', st: '発動の間隔が短くなる', name: '紅蓮の牙', chip: ['#c8141e', '#ffd23a', '#ffe45a'],       who: 'かとう',   face: 'tokyo_9', hair: '#ff1e1e',     type: 'ストライカー',       when: 'シュート・ヘディングシュートをするとき（PK・直接FKは除く）', what: 'シュートの威力と精度が大きく上がり、GKが反応しにくくなる。シュートが赤い風をまとう。ほかのシュート技と同時に出せる', dur: 1.2, cd: 14, cd2: 3, ch: 1 },   // 覚醒（凸）：ほぼ毎回のシュートで出る
    tsukikage:  { sw: 'ボールを持った味方が近くにいるとき', se: 'DFラインの裏へ一瞬で抜け出し、オフサイドにならないスルーパスを受ける', st: '抜け出した後も速いまま', name: '月影の抜け出し', chip: ['#141c46', '#b8c8ff', '#e8eeff'], who: 'にしの',   face: 'sendai_9', hair: '#9db4ff',    type: 'アタッカー',         when: 'ボールを持った味方が近くにいるとき', what: 'DFラインの裏へ一瞬で抜け出し、オフサイドにかからない完璧なタイミングでスルーパスが届く。受けた後の速さは0.4秒（凸で1.5秒）', dur: 4, cd: 7, ch: 1 },
    minato:     { sw: 'パスを出したとき', se: 'チーム全体のパスが正確になり、短いパスでテンポよく崩していく（12秒）', st: '続く時間が15秒に', name: '港の指揮者', chip: ['#31044e', '#b133ff', '#f3e0ff'],     who: 'おおかわ', face: 'kobe_10', hair: '#b030ff', skin: 0,     type: 'ゲームメイカー',     when: 'パスを出したとき（自陣ゴール前以外。前・横・後ろ、どの向きでも）', what: 'シャビ型。指揮棒の合図とともに出した1本（相手は触れない）から、チーム全体の指揮が始まる（無凸12秒・凸15秒）。味方はダイレクト・ワンタッチのショートパスでテンポよく前へ運ぶ（前へのパスコースが無く前が空いていれば、コースを作るために運ぶドリブル。横・後ろは、どちらも無い時だけ。ロングボールは、通せばGKと1対1になるスルーパスだけ）、パスの正確さが飛躍的に上がる。相手に取られた・外に出たらいったん止まり、また味方ボールになったら残りの秒数だけ戻る。相手のプレスは空回りし、遠くからは打たずにゴール前まで運ぶ。ゴール前（約30m）で前が空いていたら、もうつながずに運ぶ。少しでもスペースがあればさらに近づき、ペナルティエリアにしっかり入ってから打つ（ミドルは前をふさがれた時）', dur: 12, cd: 12, ch: 1 },
    harinoana:  { sw: '相手陣内で前を向き、通るすき間が見えたとき', se: 'DFの間を抜く、取られないスルーパスをゴール前へ通す', st: '受けた味方が長く有利に', name: '針の穴通し', chip: ['#4e4304', '#ffea70', '#fffae0'],     who: 'きのした', face: 'naniwa_10', hair: '#fff2a8',   type: 'パサー',             when: '相手陣内で前を向いてボールを持ち、だれにも見えない1本が見えたとき', what: 'エジル・デ・ブライネ型。DFとDFの、本来は通らない狭いすき間に、金の糸のようなスルーパスを、裏の深い所（ゴール前）へ通す。受け手がオンサイドの時だけ出し、相手は触れず、走り込む味方とボールが同時に着く。最強のラストパス：受けた味方は前を向いたまま収め、まわりのDFは置き去り。まっすぐゴールへ向かい、ほぼ奪われず、シュートも少しだけ正確に（無凸5秒・凸6秒）', dur: 1.6, cd: 15, ch: 1 },
    byakuya:    { sw: '自陣〜中盤で前を向き、ロングフィードが通せるとき', se: '裏へ走る味方へ、取られないロングフィードを通す', st: 'より深く、味方の走りがさらに速く', name: '白夜の視界', chip: ['#190f43', '#6f55dd', '#e9e5fa'],     who: 'ことう',   face: 'sapporo_6', hair: '#5a3cd8',   type: 'レジスタ',           when: '自陣〜中盤の低い位置で前を向き、35m以上のロングフィードが通せる時（プレスを受けていても）', what: 'ピルロ型。時間がゆっくり流れる白夜の中でピッチ全体を見渡し、寄せてくる相手をいなす。DFラインの近くの味方が合図で一斉に裏へ走り出し（いつもより速い）、その走る先へ、自陣の奥から相手のペナルティアークまで届くロングフィード1本。受け手が触るまで相手は触れず、走りながら収めて「はい、チャンス」（凸：ゆっくりの時間が長く、より深く、走る味方がさらに速い）', dur: 2.6, cd: 14, ch: 0.9 },
    kinshachi:  { sw: 'いつも／ボールを奪った・奪われた瞬間', se: 'スタミナがほとんど減らず、攻守の切り替えで誰よりも走る。チームも疲れにくい', st: 'スタミナの減りがさらに少なく、走る時間も長い', name: '金鯱の心臓', chip: ['#4e3b04', '#ffcb33', '#fff7e0'],     who: 'かい',     face: 'nagoya_7', hair: '#ffbe00',    type: 'ダイナモ',           when: 'いつも（スタミナ）／味方がボールを奪った・奪われた瞬間（走り）', what: 'ダイナモの心臓。そもそもスタミナがほとんど減らない（無凸1/3・凸1/4）。その走力で攻守にわたって全体を整える。奪った瞬間は前線のサポートへ駆け上がり、ボールより前のパスを受けられる空いた所に顔を出して、決定力のある味方へつなぐ。奪われた瞬間は、上がっていれば全力でボールとゴールの間へ戻り、味方が空けたスペース・フリーの相手を埋めて守備のバランスを整える（走りは8秒・凸10秒、約1.25倍の速さ。間隔は攻め・守りそれぞれ2秒）。奪い合いに強く、受けたら速く正確につなぎ、出したらまた走る。かいがいると、チーム全体が疲れにくく、競り合いにも少し強くなる', dur: 8, cd: 2, ch: 1 },
    kagenui:    { sw: '相手のエースがゴール前に入ってきたとき', se: 'エースに張りついてボールを受けさせない', st: '持たれても足を止めて、前を向かせない', name: '影縫い', chip: ['#4e0430', '#ff33ac', '#ffe0f3'],         who: 'ひがし',   face: 'hiroshima_8', hair: '#e8008a', type: 'マンマーカー',       when: '相手のエース（国内屈指。いなければチーム一の点取り屋）がバイタルエリア（ゴール前約35m）に入ってきたとき', what: '狙った相手に影のように張りつき（最長60秒・相手ボールの間）、ボールを受けさせない。張りつかれた相手は足が重くなり、パスが来てもカットされやすく、受けてもトラップが乱れやすい。凸すると、ボールを持たれても追いついた所で足を縫い止め、約1秒その場から動けず前も向けない', dur: 60, cd: 25, ch: 1 },
    matsuri:    { sw: '自陣で相手と向き合ったとき', se: '1対1・空中戦にほぼ負けず、シュートにも体を投げ出す', st: 'ぶつかった相手の動きが鈍り、奪ったらすぐ前へ', name: '祭り太鼓の壁', chip: ['#0e1644', '#5267e0', '#e5e8fa'],   who: 'あおやま', face: 'hakata_2', hair: '#1c2f9e',    type: 'ストッパー',         when: '自陣で、上がってきた相手（FW・MF・DF）と向き合ったとき', what: '対人の鬼。受けた瞬間に体をぶつけてトラップを乱し、1対1の奪い合い・ドリブル突破・空中戦にほぼ負けない。シュートにも体を投げ出す。凸すると、ぶつかった相手はしばらく動きが鈍り、奪ったらすぐ前へ蹴り出してカウンターの起点になる', dur: 3, cd: 14, ch: 1 },
    miyabi:     { sw: '裏を取られた・味方DFが抜かれたとき', se: '速く回り込んで、抜け出した相手を止める', st: '', name: '雅の後始末', chip: ['#24360a', '#c8f040', '#f6ffd8'],     who: 'みやうち', face: 'kyoto_2', hair: '#a8e000',     type: 'スイーパー',         when: '裏を取られた・味方DFが抜かれたとき', what: '月影の抜け出しなみの速さで、抜け出した相手の前（ゴールとの間）へ回り込み、体を入れて止める', dur: 3, cd: 20, ch: 1 },
    sakurajima: { sw: '相手FWへ縦パスが出る瞬間', se: 'DF全員でラインを上げてオフサイドにする。深い所から走られたら一斉に下げる', st: '', name: '桜島の号令', chip: ['#0b3a2e', '#7cffc4', '#e8fff6'],     who: 'あかい',   face: 'satsuma_4', hair: '#7cffc4', skin: 0,   type: 'ラインコントローラー', when: 'ラインの近くにいる相手FWへ縦パスが出る瞬間／深い所から相手が走り出した時', what: 'オフサイドトラップの超強化版。パスが出る瞬間にDF全員で一斉に押し上げ、相手FWを置き去りにしてオフサイドにする。深い所から走られた時は、全員で一斉にラインを下げて裏を消す', dur: 1.5, cd: 40, cd2: 60, ch: 0.85 },
    ikari:      { sw: 'シュートを打たれたとき', se: 'セービングが大きく上がる。1対1とPKはさらに強い', st: '強いシュートでも、はじかずにキャッチ', name: '白亜の城壁', chip: ['#f6f8fc', '#8fa4c4', '#1c2638'],     who: 'れんの',   face: 'yokohama_1', hair: '#ffffff', skin: 0,  type: 'ゴールキーパー',     when: 'シュートを打たれたとき（1対1・PKはさらに強い）', what: '純粋な守備的GKの極み。シュートへの反応と手の届く範囲が飛躍的に上がり、ほかのGKを遥かに凌ぐセービングを見せる。反応が速く、キャッチ率も高い。はじく時も手の届く範囲が広く、相手のいない外へ正確に逃がす。1対1とPKでは、さらに止める。凸すると、止める力はそのままに、至近距離や紅蓮の牙（覚醒）のシュートでも、はじかずにがっちり抱える（こぼれ球を詰めさせない）', dur: 1.5, cd: 2, ch: 1 },
    aonoouza:   { sw: '最前線のくもいへ縦パスが出たとき', se: '下りて受けてCBを釣り出し、空いた裏へ走る味方にパスを通す', st: '釣り出すCB・走る味方が2人に', name: '蒼の王座', chip: ['#04264e', '#3391ff', '#e0eeff'],       who: 'くもい',   face: 'kyoto_9', hair: '#2a8cff',     type: '偽9番',              when: '最前線で相手CBに張りついているくもいへ、味方から縦パス（34m以内のグラウンダー）が出たとき（受ける前に発動）', what: '手前に下りて受ける司令塔。下りてくるくもいにCBが釣り出され、DFラインの裏に穴が空く。受けたらくるっと前を向き（寄せられても取られにくい）、その穴へ走り込む2列目の味方に、正確な縦パス・スルーパスを通す。出したら自分もゴール前へ入り直す（凸：釣り出すCBが2人、走り込む味方も2人、パスがさらに正確）', dur: 6, cd: 14, ch: 0.85 },
    uzushio:    { sw: '相手陣内で、後ろの味方がボールを持ったとき', se: '裏へ何度も走ってDFを下げ、空いた手前で味方に打たせる', st: '引きつけるDFが3人に', name: '渦潮の囮', chip: ['#4e2504', '#ff8f33', '#ffeee0'],       who: 'てらだ',   face: 'hiroshima_9', hair: '#ff7300', type: 'デコイラン',         when: '相手陣内（相手ゴールから約50m以内）で、2列目の味方が自分より後ろでボールを持ったとき', what: '奥へ走って手前を空ける囮。DFラインの裏へ、ニアからファー・ファーからニアへ斜めに何度も走り直し（渦を巻くように）、相手DF2人を下げさせる。空いたDFラインの手前（バイタルエリア）に2列目の味方が入ってきて受け、前を向いてシュートかラストパス。走っている間、てらだにはほとんどパスが来ない（自分は点を取らず、味方に取らせる）（凸：引きつけるDFが3人、渦を巻く時間も長く、2列目のMFも1人一緒に駆け上がる）', dur: 7, cd: 6, ch: 1 },
    shiden:     { sw: '相手陣内でドリブルを仕掛けたとき', se: 'ドリブル突破が大きく決まりやすくなり、抜いた後のパス・シュートも正確に', st: '抜いた勢いで次の相手もかわす', name: '紫電の遊戯', chip: ['#4e0404', '#ff7070', '#ffe0e0'],     who: 'かまた',   face: 'kobe_7', hair: '#ff8c8c', skin: 2,      type: 'ファンタジスタ',     when: 'ドリブルで仕掛けたとき（相手陣内）', what: 'フェイント系の技はいつでも全部使える。発動中はドリブル突破の成功率が大きく上がり、フェイントを連続で何回でも出せる。抜いた後のノールックのラストパス・シュートも正確になる。凸すると、抜いた勢いのまま次の相手も置き去りにする', dur: 10, cd: 14, ch: 1 },
    kage:       { sw: '相手陣内で、前にFWがいる時にボールを持ったとき', se: '相手に見失われ、FWが一番打ちやすい所へ取られないパスを刺す', st: '見失わせる時間が長く、さらに正確に', name: '影の一刺し', chip: ['#212731', '#90aedf', '#e8eef7'],   who: 'かめい',   face: 'tokyo_8', hair: '#b8bec8', skin: 1,     type: 'シャドー',           when: '相手陣内（センターフォワードの後ろ）で、前に味方のFWがいる時にボールを持ったとき', what: 'ストライカーを活かす影。影のように気配を消して（銀色の残像）、寄せてくる相手は一瞬かめいを見失い、囲まれずに前を向ける。同時に前のFWが、ゴール前の打てる所へ動き出す。かめいはFWがいちばん打ちやすい所へ、相手に取られない1本（銀の光の尾）を刺し、受けたFWはトラップせずにそのまま打つ。刺したかめいはそのままゴール前へ走り込み、FWが打てない時はかめいへ返して、かめいが決める。FWにDFが寄ったら、空いた背後のスペースへ自分で抜けて打つ（凸：見失わせる時間が長く、パスもシュートもさらに正確）', dur: 4, cd: 8, ch: 1 },
    tetsurou:   { sw: '自陣ゴール前の真ん中に相手が来たとき', se: '素早く寄せてボールを奪い、すぐ縦パスでカウンターの起点に', st: '守る範囲が広く、さらに速く寄せる', name: '鉄狼の関所', chip: ['#1e2733', '#618dd1', '#e8eef7'],     who: 'さかぐち', face: 'sapporo_7', hair: '#6c7f9c',   type: 'アンカー',           when: '自陣のゴール前の真ん中（バイタルエリア）に、相手がボールを運んできた・パスを通そうとしたとき', what: '関所を閉じる（鋼色の門）。狼のような速さで寄せて、ほぼ確実にボールを奪い切る（ドリブルの技もほとんど通じない）。そばを通るパスにも足が届いてカットする。奪ったら、すぐ前の味方へ正確な縦パスを出して、カウンターの起点になる（凸：関所が広く、寄せがさらに速く、奪った後のパスがさらに正確）', dur: 3, cd: 10, ch: 1 },
    midori:     { sw: '自陣でボールを持ち、相手がプレスに来るとき', se: 'プレスを引きつけて、空いた味方へつなぐ。発動するたびにチームのパスが良くなっていく', st: '引きつける相手が3人に', name: '翠の起点', chip: ['#044e24', '#33ff8d', '#e0ffee'],       who: 'むらおか', face: 'sendai_2', hair: '#00a84a',    type: 'ビルドアップ型',     when: '自陣でボールを持ち、相手がプレスに来られる所にいるとき', what: '誘い込んで、組み立てる。わざとボールを晒して相手のプレスを引き寄せ（翠の点線）、相手のDFラインも押し上げさせて陣形を前のめりにする。引きつけ切った瞬間、食いつかれて空いたフリーの味方へつなぐ（翠の光の尾）。受けた味方は前を向いて落ち着いてプレーでき、しばらくはチーム全体のパスがつながりやすい（数的優位）。組み立てている間もDFは守備の形を保つので、取られても崩れない。発動するたびに、チーム全員のパスの精度と速さ、ボールの持ちやすさ、仕掛けやすさが積み重なって上がっていく（試合の間ずっと）（凸：引き寄せる相手が3人、ラインがさらに上がり、つながりやすい時間が長い）', dur: 5, cd: 11, ch: 1 },
    sutemi:     { sw: '相手のスルーパスが出たとき', se: '先に触れると見たら飛び出して、必ずボールに触る', st: 'パスが出た瞬間に飛び出す', name: '捨て身の守護神', chip: ['#5a0616', '#ff4d6d', '#ffe8ec'], who: 'なかむら', face: 'hakata_1', hair: '#a8102e', skin: 2,    type: 'スイーパーキーパー', when: '相手のスルーパス・裏へのボールが出たとき', what: '飛び出しの超強化版。裏へのボールに相手より先に着けると判断した瞬間、全力で飛び出して必ずボールに触る（エリアの外では大きく蹴り出す）。凸すると、パスが出た瞬間に読んで1歩目から飛び出す', dur: 3, cd: 40, ch: 1 },
  };
  // 最初の持ち主（rosters.js の国内屈指）→ 固有スキル
  const UNIQ_BY_TOP = Object.fromEntries(Object.entries(UNIQ).map(([k, u]) => [u.type, k]));
  // ===== サポートパッシブ（タイプごとに1つ。凸で付く：p.passive＝1 付与、2 強化）=====
  //  ピッチにいる間、まわりの味方（rad：何m以内。null＝全員）が少し強くなる。p.passive：1 付与、2 強化（効き目1.6倍）、3 範囲拡大（☆4の3凸：rad があるものは味方全員に、ないものは効き目1.9倍）
  const PASSIVE = {
    'ストライカー':       { k: 'fwBack',   name: '点取り屋の背中', what: '近くの味方がFWへ出すパスの精度が上がる', rad: 18 },
    'アタッカー':         { k: 'stir',     name: 'かき回し',       what: '相手DFが引きつけられ、味方の抜け出しが通りやすい', rad: null },
    '偽9番':              { k: 'drawOut',  name: '引き出し',       what: '相手DFが前に釣り出され、味方の裏抜けが通りやすい', rad: null },
    'デコイラン':         { k: 'decoy',    name: 'おとり',         what: '味方FWへのマークが少しゆるむ', rad: null },
    'ゲームメイカー':     { k: 'signal',   name: '攻めの合図',     what: '味方の攻め上がりの動き出しが少し早くなる', rad: null },
    'パサー':             { k: 'guide',    name: 'パスの道しるべ', what: '味方のパスが少し通りやすい', rad: null },
    'レジスタ':           { k: 'calmness', name: '落ち着き',       what: '味方がプレスを受けたときのミスが減る', rad: null },
    'ダイナモ':           { k: 'runBack',  name: '走る背中',       what: '近くの味方のスタミナの減りが少し少なくなる', rad: 20 },
    'ファンタジスタ':     { k: 'spark',    name: 'ひらめき',       what: '味方のスルーパスの成功率が少し上がる', rad: null },
    'シャドー':           { k: 'pushUp',   name: '押し上げ',       what: '味方のゴール前への飛び込みが少し増える', rad: null },
    'アンカー':           { k: 'shield',   name: '盾',             what: '相手の中央突破の成功率が少し下がる', rad: null },
    'スイーパー':         { k: 'lastFort', name: '最後の砦',       what: '味方DFが抜かれたあとのカバーが少し早くなる', rad: null },
    'ストッパー':         { k: 'bodyVoice', name: '体を張る声',    what: '味方DFの競り合いが少し強くなる', rad: null },
    'マンマーカー':       { k: 'eyesOn',   name: '目を離すな',     what: '味方がマークを外されにくくなる', rad: null },
    'ラインコントローラー': { k: 'lineCall', name: 'ラインの号令', what: '味方DFラインがそろい、オフサイドを取りやすい', rad: null },
    'ビルドアップ型':     { k: 'origin',   name: '起点',           what: '味方DFのパスミスが減る', rad: null },
    'ゴールキーパー':     { k: 'relief',   name: '守護神の安心感', what: 'DFラインの集中が少し上がる', rad: null },
    'スイーパーキーパー': { k: 'backCover', name: '背後の安心',    what: '味方DFラインを高く保ちやすい', rad: null },
    'バランス':           { k: 'mood',     name: 'ムードメーカー', what: '負けている時、または引き分けている時に、味方全員の能力が少し上がる', rad: null },
  };
  const PASSIVE_BY_K = Object.fromEntries(Object.values(PASSIVE).map((v) => [v.k, v]));
  function fillParams(p, salt) {
    const b = TYPE_BIAS[p.type] || {};
    const w = (k) => (((p.number || 1) * 11 + k * 7 + (salt || 0)) % 7) - 3;
    const def = {
      dash: p.speed + (b.dash || 0) + w(1),
      jump: p.physical + (b.jump || 0) + w(2),
      mental: 50 + (b.mental || 0) + w(3) * 2,
      dribble: p.technique + (b.dribble || 0) + w(4),
      pass: p.technique + (b.pass || 0) + w(5),
      defense: Math.round(p.technique * 0.4 + p.physical * 0.6) + (b.defense || 0) + w(6),
      vision: p.technique + (b.vision || 0) + w(7),
    };
    for (const k in def) if (p[k] == null) p[k] = clamp(Math.round(def[k]), 20, 99);
    return p;
  }
  // 数値 → S〜E
  function grade(v) { return v >= 84 ? 'S' : v >= 74 ? 'A' : v >= 64 ? 'B' : v >= 55 ? 'C' : v >= 45 ? 'D' : 'E'; }

  // 表示用の見た目（髪型・髪色・肌）
  function looks(i, salt) {
    return { hair: (i * 3 + salt) % 6, hairColor: (i * 5 + salt) % 5, skin: (i * 7 + salt) % 3 };
  }

  function makePlayer(i, name, position, type, attrs, salt) {
    const h = { ...HIDDEN0, ...(TYPE_HIDDEN[type] || {}) };
    const wob = (k) => ((i * 7 + k * 13 + salt) % 9) - 4; // 選手ごとの小さな個人差
    return fillParams({
      number: i + 1, name, position, type,
      kick: attrs[0], speed: attrs[1], stamina: attrs[2], technique: attrs[3], physical: attrs[4],
      zone_man: h.zone_man + wob(1), press: clamp(h.press + wob(2), 0, 100),
      support: clamp(h.support + wob(3), 0, 100), overlap: clamp(h.overlap + wob(4), 0, 100),
      run_space: clamp(h.run_space + wob(5), 0, 100), goal_wait: clamp(h.goal_wait + wob(6), 0, 100),
      ...looks(i, salt),
      skills: [],
    }, salt);
  }

  // 自チーム：タイプがばらばらの16人
  function beginningTeam() {
    const rows = [
      ['たちかわ', 'GK', 'ゴールキーパー', [44, 46, 50, 52, 55]],
      ['ひむろ', 'DF', 'スイーパー', [40, 50, 52, 46, 58]],
      ['きりはら', 'DF', 'ストッパー', [42, 54, 50, 42, 60]],
      ['あまみや', 'DF', 'マンマーカー', [38, 56, 54, 44, 56]],
      ['なぎさわ', 'DF', 'スイーパー', [46, 48, 50, 50, 54]],
      ['はやせ', 'MF', 'レジスタ', [52, 46, 52, 60, 44]],
      ['おがわ', 'MF', 'ダイナモ', [46, 58, 62, 48, 46]],
      ['ときわ', 'MF', 'ダイナモ', [48, 60, 58, 50, 44]],
      ['はるかわ', 'MF', 'レジスタ', [50, 48, 50, 58, 46]],
      ['いぶき', 'FW', 'ストライカー', [62, 52, 46, 50, 54]],
      ['つつい', 'FW', 'アタッカー', [56, 62, 50, 52, 44]],
      ['あさぎり', 'FW', 'ストライカー', [60, 48, 46, 50, 56]],
      ['みなせ', 'FW', 'アタッカー', [54, 60, 48, 52, 42]],
      ['あやせ', 'FW', 'バランス', [50, 52, 50, 52, 48]],
      ['ゆうざき', 'MF', 'バランス', [48, 50, 52, 50, 48]],
      ['ひいらぎ', 'GK', 'ゴールキーパー', [42, 44, 48, 50, 52]],
    ];
    return {
      name: 'はじまりFC', short: 'はじまり', color: 'blue',
      formation: '4-4-2', line_height: 3, zone_width: 3, attitude: 'balanced', policies: [],
      players: rows.map((r, i) => makePlayer(i, r[0], r[1], r[2], r[3], 1)),
    };
  }

  // 対戦相手：育て方の違う6チーム。勝ち負けの決め打ちはせず、能力と動きの違いだけを持たせる。
  const PRESETS = {
    'バランス型': {
      line: 3, width: 3, attitude: 'balanced', policies: [],
      df: 'バランス', mf: 'バランス', fw: 'バランス', bias: [0, 0, 0, 0, 0],
      skills: { 0: ['punching'], 9: ['knuckle', 'scissors', 'volley', 'captaincy', 'looseBall'], 10: ['doubleTouch', 'cutIn', 'nearPost'], 6: ['curve', 'powerMid'], 2: ['slide', 'cover'] },
    },
    '堅守型': {
      line: 2, width: 2, attitude: 'defensive', policies: [['LEADING_LATE', 'LINE_DOWN']],
      df: 'スイーパー', mf: 'マンマーカー', fw: 'ストライカー', bias: [0, -4, 0, -2, 8],
      skills: { 0: ['superReflex', 'coaching'], 2: ['slide', 'shotBlock', 'aerial', 'fighting'], 3: ['slide', 'cover'], 1: ['manMark'], 9: ['fk', 'postPlay'], 10: ['behindRun'] },
    },
    'パス型': {
      line: 3, width: 3, attitude: 'balanced', policies: [],
      df: 'スイーパー', mf: 'レジスタ', fw: 'ストライカー', bias: [0, -3, 0, 10, -5],
      types: { 5: 'ゲームメイカー' }, skills: { 0: ['lowThrow'], 5: ['curve', 'fk', 'roulette', 'throughPass', 'noLook', 'oneTouchPass', 'intercept', 'oneTwo', 'calm'], 9: ['oneTwo', 'farWait'], 6: ['curve', 'doubleTouch', 'switchPlay', 'pinpointCross'], 10: ['bodyFeint', 'nutmeg', 'heelPass'], 2: ['longFeed'] },
    },
    'プレス型': {
      line: 4, width: 2, attitude: 'attacking', policies: [['OWN_STAMINA_LOW', 'LESS_PRESS']],
      df: 'マンマーカー', mf: 'ストッパー', fw: 'ストッパー', bias: [-2, 6, 4, -4, 0],
      skills: { 0: ['rushOut', 'lowPunt'], 1: ['slide', 'shoulder', 'fighting'], 2: ['slide'], 6: ['slide', 'pressMonster', 'lateGrit'], 7: ['slide', 'pressMonster', 'ironMan'], 9: ['pressMonster', 'looseBall'] },
    },
    '走力型': {
      line: 3, width: 4, attitude: 'balanced', policies: [],
      df: 'スイーパー', mf: 'ダイナモ', fw: 'アタッカー', bias: [-2, 2, 12, -4, -4],
      skills: { 10: ['bodyFeint', 'speedDribble', 'scissors', 'nearRun'], 9: ['knuckle', 'speedDribble'], 6: ['slide', 'recovery', 'ironMan'], 7: ['speedDribble', 'recovery'], 3: ['recovery', 'overlap'], 4: ['overlap'] },
    },
    '裏抜け型': {
      line: 3, width: 3, attitude: 'attacking', policies: [['OPP_HIGH_LINE', 'THROUGH_BALLS']],
      df: 'スイーパー', mf: 'レジスタ', fw: 'アタッカー', bias: [4, 8, -2, 0, -6],
      skills: { 0: ['rushOut', 'lowPunt'], 9: ['bodyFeint', 'kickFeint', 'behindRun', 'clutch'], 10: ['elastico', 'knuckle', 'heelLift', 'behindRun'], 5: ['curve', 'throughPass', 'loftedThrough'], 1: ['longFeed'] },
    },
  };
  const PRESET_NAMES = Object.keys(PRESETS);
  const OPP_NAMES = ['タカ', 'ゴウ', 'ミツ', 'サキ', 'ヨシ', 'ダイ', 'ケン', 'ショウ', 'ノブ', 'アキ', 'マサ', 'トモ', 'ヒロ', 'テツ', 'ジュン', 'ユキ'];

  function presetTeam(name) {
    const s = PRESETS[name] || PRESETS['バランス型'];
    const pos = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW', 'MF', 'DF', 'MF', 'GK'];
    const base = [50, 52, 52, 50, 52];
    const salt = PRESET_NAMES.indexOf(name) * 3 + 2;
    const players = pos.map((p, i) => {
      const type = p === 'GK' ? 'ゴールキーパー' : p === 'DF' ? s.df : p === 'MF' ? s.mf : s.fw;
      const attrs = base.map((b, k) => clamp(b + s.bias[k] + (((i * 5 + k * 3 + salt) % 7) - 3), 30, 80));
      const pl = makePlayer(i, OPP_NAMES[i], p, type, attrs, salt);
      pl.skills = (s.skills && s.skills[i]) ? s.skills[i].slice() : [];
      if (s.types && s.types[i]) pl.type = s.types[i];
      return pl;
    });
    return {
      name, short: name, color: 'red', formation: '4-4-2', line_height: s.line, zone_width: s.width,
      attitude: s.attitude, policies: s.policies.map(([c, a]) => ({ condition: c, action: a })), players, autoSubs: true,
    };
  }

  // ---------- レベル変換：オールS（カルチョビットAの強豪級） ----------
  // 能力はチームの個性（バイアス）を少し残したまま S 帯（85〜99）へ。スキルも一通り覚えている
  const S_SKILLS = {
    FW: [['knuckle', 'bodyFeint', 'scissors', 'kickFeint', 'cutIn', 'speedDribble', 'volley', 'direct', 'nearPost', 'driveShot', 'bicycle', 'heelPass', 'oneTouchPass', 'pkMaster', 'wallPass', 'behindRun', 'looseBall', 'clutch', 'calm'], ['curve', 'elastico', 'heelLift', 'doubleTouch', 'kickFeint', 'lob', 'toeKick', 'divingHeader', 'controlShot', 'postPlay', 'farWait', 'bigStage'], ['knuckle', 'curve', 'roulette', 'nutmeg', 'cutIn', 'powerMid', 'volley', 'direct', 'driveShot', 'noLook', 'throughPass', 'nearRun', 'looseBall', 'behindRun']],
    MF: [['curve', 'fk', 'roulette', 'doubleTouch', 'superLong', 'controlShot', 'throughPass', 'loftedThrough', 'longFeed', 'noLook', 'oneTouchPass', 'ckMaster', 'captaincy', 'oneTwo', 'calm'], ['bodyFeint', 'curve', 'scissors', 'heelLift', 'speedDribble', 'powerMid', 'driveShot', 'cutIn', 'earlyCross', 'pinpointCross', 'switchPlay', 'throughPass', 'lateGrit', 'ironMan', 'overlap'], ['knuckle', 'slide', 'nutmeg', 'cutIn', 'powerMid', 'lob', 'oneTouchPass', 'heelPass', 'throughPass', 'switchPlay', 'wallPass', 'pressMonster', 'intercept', 'recovery', 'fighting', 'moodMaker', 'oneTwo'], ['fk', 'elastico', 'doubleTouch', 'bodyFeint', 'controlShot', 'nearPost', 'cutIn', 'pinpointCross', 'earlyCross', 'noLook', 'ckMaster', 'fk']],
    DF: [['slide', 'longFeed', 'aerial', 'shotBlock', 'cover', 'intercept', 'bigStage'], ['slide', 'curve', 'earlyCross', 'switchPlay', 'longThrow', 'recovery', 'manMark', 'overlap'], ['slide', 'speedDribble', 'longFeed', 'aerial', 'shoulder', 'shotBlock', 'manMark'], ['slide', 'bodyFeint', 'earlyCross', 'recovery', 'intercept', 'cover', 'overlap', 'fighting']],
    GK: [['superReflex', 'punching', 'pkStopper', 'oneOnOne', 'lowThrow', 'lowPunt', 'coaching']],
  };
  function atLevel(team, level) {
    if (level !== 'S') return team;
    const t = JSON.parse(JSON.stringify(team));
    const cnt = { FW: 0, MF: 0, DF: 0, GK: 0 };
    t.players.forEach((p, i) => {
      fillParams(p, 0);
      for (const k of PARAM_KEYS) p[k] = clamp(Math.round(91 + (p[k] - 52) * 0.35 + (((i * 7 + k.length * 3) % 5) - 2)), 84, 99);
      const pool = S_SKILLS[p.position] || [[]];
      p.skills = pool[cnt[p.position]++ % pool.length].slice();
      // GK：攻めるチーム（ライン高め・攻撃的）は攻撃的GK（飛び出し）
      if (p.position === 'GK' && ((t.line_height || 3) >= 4 || t.attitude === 'attacking')) p.skills.push('rushOut');
    });
    t.name = t.name + '（オールS）'; t.short = (t.short || t.name);
    return t;
  }

  // ---------- 試合 ----------
  function parseFormation(f) {
    const parts = String(f || '4-4-2').split('-').map(Number).filter((n) => n > 0);
    return parts.length >= 2 && parts.reduce((a, b) => a + b, 0) === 10 ? parts : [4, 4, 2];
  }

  // チームの基本配置（自陣ゴール方向を0とした前向き座標、DFラインからの相対x）
  function buildSlots(team) {
    const lines = parseFormation(team.formation);
    // 縦のコンパクトさ（1＝広く 2＝ふつう 3＝コンパクト）：ライン間の距離
    const cf = [1.15, 1, 0.85][clamp(team.compact || 2, 1, 3) - 1];
    const wf0 = 0.8 + clamp(team.zone_width || 3, 1, 5) * 0.07;
    // マス目で自由に置いた配置（カルチョビットAと同じ考え方）：縦10マス（DF3・MF4・FW3）×横15マス
    // 行0〜2がDFゾーン、3〜6がMFゾーン、7〜9がFWゾーン。0-10のような極端な形も組める
    if (Array.isArray(team.cells) && team.cells.length >= 11) {
      const out = [{ rel: 0, y: GOAL_Y, gk: true }];
      for (let i = 1; i < 11; i++) {
        const c = team.cells[i] || { r: 4, c: 7 }, zone = c.r <= 2 ? 0 : c.r <= 6 ? 1 : 2;
        const y0 = 4 + c.c * (60 / 14);
        out.push({ rel: (c.r - 1) * 4 * cf, y: clamp(GOAL_Y + (y0 - GOAL_Y) * wf0 / 1.01, 3, W - 3), line: zone, last: zone === 2, cell: c });
      }
      return out;
    }
    const rels = (lines.length === 3 ? [0, 15, 30] : [0, 11, 21, 31]).map((r) => r * cf);
    const widths = lines.map((n) => (n >= 5 ? 50 : n === 4 ? 46 : n === 3 ? 36 : n === 2 ? 22 : 0));
    const wf = 0.8 + clamp(team.zone_width || 3, 1, 5) * 0.07;
    const slots = [{ rel: 0, y: GOAL_Y, gk: true }];
    lines.forEach((n, li) => {
      for (let k = 0; k < n; k++) {
        const y = n === 1 ? GOAL_Y : GOAL_Y + (k - (n - 1) / 2) * (widths[li] * wf / (n - 1));
        slots.push({ rel: rels[li], y, line: li, last: li === lines.length - 1 });
      }
    });
    // ポジションごとの微調整（前後・左右に数メートル）
    const adj = team.slot_adj || [];
    slots.forEach((sl, i) => { const a = adj[i]; if (!a || sl.gk) return; sl.rel = clamp(sl.rel + (a.dx || 0), -4, 40); sl.y = clamp(sl.y + (a.dy || 0), 4, W - 4); });
    return slots;
  }

  function simulateMatch(homeIn, awayIn, seed, opts) {
    opts = opts || {};
    const rec = opts.frames !== false || !!opts.acts;   // acts：絵は作らず、動作の記録だけ残す（確認画面の集計用）
    const R = rngFrom(seed || 1);
    const teamsIn = [homeIn, awayIn];

    // 実行時の選手
    const P = [];
    // チーム戦術：プレス（-1 控えめ／0／1 前から）・パスの方針（-1 つなぐ／0／1 縦に速く）・攻める場所（-1 中央／0／1 サイド）
    const teamTac = (t) => ({ press: [-25, 0, 25][clamp((t.press ?? 0) + 1, 0, 2)], through: [-15, 0, 20][clamp((t.pass_style ?? 0) + 1, 0, 2)], vert: [-0.02, 0, 0.04][clamp((t.pass_style ?? 0) + 1, 0, 2)], side: clamp(t.attack_side ?? 0, -1, 1) });
    function mkPlayer(p, ti, i, slot, idx) {
      const q = {
        ...fillParams({ ...p }, 0), team: ti, idx, slot,
        x: 0, y: 0, vx: 0, vy: 0, cur: clamp(p.startCur ?? 100, 30, 100), facing: ti ? -1 : 1,
        touchCd: 0, tackleCd: 0, stun: 0, run: 0, runCd: R.range(2, 6), mark: -1,
        gk: i === 0, sk: new Set((p.skills || []).map((k) => (k === 'feint' ? 'bodyFeint' : k === 'dribbleShot' ? 'driveShot' : k))),   // 旧ドリブルシュートはドライブシュートに
      };
      // 攻撃的GK（飛び出しを持つ）：高い位置で裏へのボールをケア。守備的GK：ゴール前でどっしり、セービングが高め
      q.gkAtk = q.gk && (q.sk.has('rushOut') || q.type === 'スイーパーキーパー');   // スイーパーキーパーは飛び出し型
      // 利き足（なければ名前から決める：右6割・左4割）
      if (q.foot !== 'L' && q.foot !== 'R') { let h = 7; for (const ch of String(q.name || '') + (q.number || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; q.foot = ((h >>> 3) % 10) < 6 ? 'R' : 'L'; }
      if (q.sk.has('oneTwo')) q.sk.add('wallPass');            // ワンツーの名手：壁パスの効果＋走り込みが速い
      if (q.sk.has('overlap')) q.overlap = Math.max(q.overlap, 80);   // オーバーラップ：SBが積極的に前線へ
      // 固有スキル・サポートパッシブ
      q.uniq = p.uniq && UNIQ[p.uniq] ? p.uniq : null; q.uniqLv = q.uniq ? clamp(p.uniqLv || 1, 1, 2) : 0; q.uOn = -1; q.uCd = 0;
      q.pasK = p.passive > 0 && PASSIVE[q.type] ? PASSIVE[q.type].k : null; q.passive = q.pasK ? clamp(p.passive, 1, 3) : 0;   // 1 付与、2 強化、3 範囲が味方全員に（もともと全員なら効き目がさらに上がる）
      return q;
    }
    const T = teamsIn.map((t, ti) => {
      const slots = buildSlots(t);
      const starters = t.players.slice(0, 11);
      const mods = { line: 0, press: 0, through: 0, attack: 0 };
      const tac = teamTac(t);
      const roles = t.roles || {};
      return {
        tac, roles, situ: t.situ || null, sitAct: 'keep',
        autoSubs: !!t.autoSubs, subsLeft: 3, lastSubT: -999, bench: t.players.slice(11).filter((q) => !(q.injury > 0)).map((q) => ({ ...q })),
        ti, name: t.name, short: t.short || t.name, color: t.color || (ti ? 'red' : 'blue'),
        line_height: t.line_height || 3, attitude: t.attitude || 'balanced',
        policies: (t.policies || []).slice(0, 5), activePolicy: -1, mods, urg: 0,
        players: starters.map((p, i) => { const q = mkPlayer(p, ti, i, slots[i] || slots[slots.length - 1], P.length); q.slotIdx = i; P.push(q); return q; }),
      };
    });
    const infoOf = (p) => ({ params: Object.fromEntries(PARAM_KEYS.map((k) => [k, p[k]])), name: p.name, number: p.number, type: p.type, position: p.position, hair: p.hair, hairColor: p.hairColor, skin: p.skin, gk: p.gk, skills: [...p.sk], uniq: p.uniq || undefined, passive: p.passive || undefined, faceKey: p.faceKey || undefined, cpuTid: p.cpuTid || undefined, cpuNo: p.cpuNo ?? undefined });
    const rosterStart = T.map((tm) => tm.players.map(infoOf));   // キックオフ時の顔ぶれ（途中で交代したら、表示はこれと交代の記録から決める）
    const pendingCh = (opts.changes || []).filter((c) => c.at != null).sort((a, b) => a.at - b.at);
    // 選手を入れ替える（ユーザーの交代・相手の自動交代で共通）
    function doSub(tm, k, pl) {
      const old = tm.players[k];
      const q = mkPlayer({ ...pl, startCur: pl.startCur ?? 100 }, tm.ti, k, old.slot0 || old.slot, old.idx);
      q.x = old.x; q.y = old.y; q.facing = old.facing; q.vx = 0; q.vy = 0;
      if (tm.players.some((p) => p !== old && p.sk.has('moodMaker'))) q.mental = Math.min(99, q.mental + 6);
      q.slotIdx = old.slotIdx ?? k;   // 名簿の何番目か（退場で配列が詰まっても、交代の記録は名簿の位置で）
      tm.players[k] = q; P[old.idx] = q; teamPas(tm);
      for (const r of ['captain', 'pk', 'fk', 'ck']) if (tm.role[r] === old) tm.role[r] = null;
      if (S.ball.owner === old.idx) S.ball.owner = -1;
      // 下がる選手がからんでいたプレー（ワンツー・溜めシュートなど）は取り消す
      if (S.oneTwo && (S.oneTwo.a === old.idx || S.oneTwo.b === old.idx)) S.oneTwo = null;
      if (S.charge && S.charge.p === old.idx) S.charge = null;
      for (const o of P) if (o.mark === old.idx) o.mark = -1;
      tm.subsLeft--; tm.lastSubT = S.t;
      ev('sub', { team: tm.ti, out: old.name, outNumber: old.number, outPos: old.position, in: q.name, number: q.number, pos: q.position, slot: q.slotIdx, info: infoOf(q) });
      return q;
    }
    // 交代できる瞬間：ボールがピッチの外に出た・ファウルやオフサイドで止まった・ゴールのあと（プレーが切れている時だけ）
    const subOk = () => (S.celebrate > 1 && S.celebrate < 3.2) ||   /* ゴールのあとは、喜び終わって戻ってくる最後のところで（キックオフの直前） */ (S.restart && S.restart.type !== 'penalty' && S.restart.stage !== 'ready');
    // 相手チームの自動交代：一番疲れた選手を、同じポジションの控えと替える
    // 負けている終盤はFWを入れて攻めに、勝っている終盤はDFを入れて守りに
    function autoSub(tm) {
      if (tm.subsLeft <= 0 || !tm.bench.length) return false;
      const minute = S.t * CLOCK_SCALE / 60, diff = S.score[tm.ti] - S.score[1 - tm.ti];
      const want = minute >= 65 && diff < 0 ? 'FW' : minute >= 72 && diff > 0 ? 'DF' : null;
      let k = -1, worst = 1e9;
      tm.players.forEach((p, i) => {
        if (p.gk) return;
        if (p.uniq === 'midori' && (tm.mdStack || 0) < 4 && p.cur > 18) return;   // 翠の起点：4段たまるまでは替えない（へとへとなら替える）
        let sc = p.cur;
        if (want === 'FW' && p.position === 'DF') sc -= 6;      // 攻めたいときは守りの選手から外す
        if (want === 'DF' && p.position === 'FW') sc -= 6;
        if (sc < worst) { worst = sc; k = i; }
      });
      if (k < 0 || !subOk()) return false;
      const pos = tm.players[k].position;
      let j = want ? tm.bench.findIndex((q) => q.position === want) : -1;
      if (j < 0) j = tm.bench.findIndex((q) => q.position === pos);
      if (j < 0) j = tm.bench.findIndex((q) => q.position !== 'GK');
      if (j < 0) return false;
      doSub(tm, k, tm.bench.splice(j, 1)[0]);
      return true;
    }
    // ハーフタイムの変更（交代・作戦）。前半は同じシードなら毎回同じになるので、後半からだけ変わる
    function applyHalfChange(ch) {
      const tm = T[ch.team];
      if (!tm) return;
      if (ch.tac) {
        const c = ch.tac;
        if (c.attitude) tm.attitude = c.attitude;
        if (c.line_height) tm.line_height = c.line_height;
        if (c.markOn) tm.markOn = c.markOn.slice(0, 3);   // ハーフタイムの作戦ボードで「この選手をマーク」（相手の名簿の位置）
        tm.tac = teamTac({ ...teamsIn[ch.team], ...c });
        if (c.situ) tm.situ = c.situ;
        if (c.compact || c.zone_width || c.cells) {
          const sl = buildSlots({ formation: c.formation || teamsIn[ch.team].formation, cells: c.cells || teamsIn[ch.team].cells, compact: c.compact || teamsIn[ch.team].compact, zone_width: c.zone_width || teamsIn[ch.team].zone_width });
          tm.players.forEach((p, i) => { p.slot = sl[i] ? (side[ch.team] < 0 ? mirSlot(sl[i]) : sl[i]) : p.slot; p.slot0 = null; });
        }
      }
      for (const sb of ch.subs || []) {
        const k = tm.players.findIndex((p) => p.slotIdx === sb.slot), old = tm.players[k];   // 名簿の位置で探す（退場者がいても正しい選手を替える）
        if (!old || !sb.player || k === 0 && sb.player.position !== 'GK' || tm.subsLeft <= 0) continue;
        doSub(tm, k, sb.player);
      }
    }
    // キャプテンシー（キャプテン＝最初に持っている選手）：味方全員のスタミナの減りが少し遅い
    // ムードメーカー：チーム全体のメンタルが上がる
    // 指名された役割（キャプテン・PK・FK・CK）を選手に結びつける
    for (const tm of T) { const rp = (k) => (tm.roles[k] != null && tm.players[tm.roles[k]] ? tm.players[tm.roles[k]] : null); tm.role = { captain: rp('captain'), pk: rp('pk'), fk: rp('fk'), ck: rp('ck') }; }
    for (const tm of T) {
      // キャプテン：キャプテンシーを持っていれば全員のスタミナの減りが遅くなる（指名がなければ、持っている選手がいれば）
      const cap = tm.role.captain;
      tm.stamMul = (cap ? cap.sk.has('captaincy') : tm.players.some((p) => p.sk.has('captaincy'))) ? 0.9 : 1;
      if (cap) { const bonus = clamp(Math.round((cap.mental - 50) / 12), 0, 3); if (bonus) for (const p of tm.players) if (p !== cap) p.mental = Math.min(99, p.mental + bonus); }   // メンタルの強いキャプテンは、まわりを落ち着かせる
      if (tm.players.some((p) => p.sk.has('moodMaker'))) for (const p of tm.players) p.mental = Math.min(99, p.mental + 6);
      teamPas(tm);
    }
    // 力の差（チームの平均能力の差）：圧倒的に強いチームは、迷わず縦に速く攻めて、打てば入る
    const teamRating = (tm) => tm.players.reduce((a, p) => a + PARAM_KEYS.reduce((x, k) => x + p[k], 0) / PARAM_KEYS.length, 0) / tm.players.length;
    const DOM = [0, 1].map((ti) => clamp((teamRating(T[ti]) - teamRating(T[1 - ti]) - 12) / 28, 0, 1));
    // 版840：チームの「つなぐ力」（0〜1）。パスと判断力が高いほど、横・後ろでつないで相手を動かし、空いた瞬間に縦へ入れる（D2はそこそこ、D1は高い）
    //  パス型（短くつなぐ）は高く、縦に速い攻めのチーム・守備的なチームは低い（チームの色は残す）
    for (const tm of T) { const ps = tm.players.filter((q) => !q.gk), vp = ps.reduce((a, q) => a + (q.vision + q.pass) / 2, 0) / Math.max(1, ps.length);
      tm.pat = clamp(clamp((vp - 40) / 40, 0, 1) * (tm.tac.vert < 0 ? 1.2 : tm.tac.vert > 0 ? 0.65 : 1) * (tm.attitude === 'defensive' ? 0.8 : 1), 0, 1); }
    // 攻める向き（+1 なら x が大きい方へ攻める）。後半は入れ替わる
    const CELEB_LONG = 9.0, CELEB_SHORT = 5.0, CELEB_HURRY = 7.5;   // ゴール後の喜び〜戻りの時間（3点差より開いたら短く）
    const side = [1, -1];
    const sgn = (ti) => side[ti];
    // 港の指揮者（おおかわ）：指揮が続いている間の、チーム全体の強さ（0＝なし 1＝無凸 2＝凸）
    const condLv = (ti) => { for (const m of T[ti].players) if (m.uniq === 'minato' && m.uOn > S.t && !m.off) return m.uniqLv >= 2 ? 2 : 1; return 0; };
    // 左右の持ち場：名簿の配置は「右へ攻める向き」で作ってある（y が小さい方が左）。左へ攻めるときは上下を裏返す
    // （裏返さないと、左へ攻める側は左ウイングが右サイドに立ってしまう。前後半のコートチェンジで左右が入れ替わる不具合の元）
    const mirSlot = (sl) => (sl ? { ...sl, y: W - sl.y } : sl);
    const mirrorSlots = (tm) => { for (const p of tm.players) { p.slot = mirSlot(p.slot); p.slot0 = mirSlot(p.slot0); } };
    for (const tm of T) if (side[tm.ti] < 0) mirrorSlots(tm);
    const fx = (ti, x) => (side[ti] > 0 ? x : L - x);    // 前向きx
    // その選手が今いるエリアで、スキル・動き k をどう使うか（0＝使わない 1＝普通 2＝積極的）。表にないものは「普通」
    const zoneIdx = (p) => { const xf = fx(p.team, p.x), b = xf < 18 ? 0 : xf < 40 ? 1 : xf < 65 ? 2 : xf < 87 ? 3 : 4, yy = side[p.team] > 0 ? p.y : W - p.y, l = yy < 20 ? 0 : yy > 48 ? 2 : 1; return b * 3 + l; };
    const zr = (p, k) => { const z = ZONE_RULES[k]; return z ? +z[zoneIdx(p)] : 1; };
    const SHIDEN_SK = new Set(['scissors', 'elastico', 'bodyFeint', 'doubleTouch', 'roulette', 'nutmeg', 'heelLift']);
    const skZ = (p, k) => (p.sk.has(k) || (p.uniq === 'shiden' && SHIDEN_SK.has(k))) && zr(p, k) > 0;   // 紫電の遊戯（かまた）：フェイント系の技はいつでも全部使える   // スキルを覚えていて、しかも今のエリアで使ってよい（紫電の遊戯の間は、ドリブル技をぜんぶ出せる）
    const zw = (p, k) => [0, 1, 2.2][zr(p, k)];        // 選ぶ時の重み（積極的なエリアは2.2倍）
    const S = {
      t: 0, half: 1, score: [0, 0], poss: 0,
      ball: { x: L / 2, y: W / 2, z: 0, vx: 0, vy: 0, vz: 0, owner: -1, kind: 'dead', lastTeam: 0, lastPlayer: -1, kicker: -1, intended: -1, offside: false, shotOnTarget: false },
      restart: null, decision: 0, dribbleDir: null, celebrate: 0, scorer: -1, kickRec: -1,
      lastPass: [null, null], passStreak: [0, 0],
    };
    // 選手の動き（ヘディング・スライディング・フェイント・競り合い・転倒・スキル発動）の記録。描画用
    const actions = [];
    function act(p, a, d, extra) {
      if (rec) actions.push({ t: +S.t.toFixed(2), i: p.idx, a, d, ...(extra || {}) });
      // 技を出したら、しばらくは次の技を出さない（コンマ何秒の間に技が重なって「いま何が起きた？」とならないように）
      if (a === 'skill') p.skLastT = S.t;
      // 技の動き（足さばき・溜め）が終わるまでは、次の技を始めない。終わってからなら、持っている技どうしをつなげてよい（見ていて何が起きたか分かる間を少し置く）
      if (a === 'dmove' || a === 'charge') p.skLock = Math.max(p.skLock || 0, S.t + (d || 0.6) + 0.2);
    }
    const stats = [0, 1].map(() => ({
      shots: 0, shots_on_target: 0, saves: 0, passes: 0, passes_completed: 0, offsides: 0, corners: 0, fouls: 0,
      tackles_won: 0, tackles_lost: 0, possession: 0, yellows: 0, reds: 0, goals: [], issues: [], distance: 0,
      through_balls: 0, dribbles_past: 0, failed_passes: 0, off_target: 0,
      fwd_passes: 0, one_two: 0, high_wins: 0, cutbacks: 0, edge_volleys: 0, counterpress_wins: 0,
    }));
    const events = [];
    const frames = [];
    const typeLog = {}; // タイプごとの位置の記録（本物の座標から集計）

    const ev = (type, extra) => events.push({ t: +S.t.toFixed(1), clock: Math.round(S.t * CLOCK_SCALE + (S.half === 2 ? 0 : 0)), type, ...extra });

    // ---------- 固有スキル・サポートパッシブ ----------
    const uniqLog = [];
    const uOn = (p, k) => !!p && p.uniq === k && p.uOn > S.t;
    const uP = (p) => (p.uniqLv >= 2 ? 1.3 : 1);   // 凸で強化：効果が1.3倍
    const grF = (p) => clamp(((p.kick || 0) * 0.5 + (p.technique || 0) * 0.3 + (p.mental || 0) * 0.2 - 45) / 45, 0.25, 1.15);   // 版665：紅蓮の牙の強さは、本人のシュート力（キック・テクニック・メンタル）に連動。スカウト直後（60台）は4割ほど、国内屈指（90前後）で満額
    // GKの固有スキル（白亜の城壁・捨て身の守護神）の止める力の上乗せは、本人のセービング力に連動（CPUの国内屈指＝満額、手に入れた直後のE〜D＝2〜3割、99まで育てると満額を超える）
    const gkF = (p) => clamp((p.vision * 0.25 + p.technique * 0.3 + p.jump * 0.2 + p.dash * 0.1 + p.mental * 0.15 - 30) / 56, 0.2, 1.2), gP = (p) => (p.uniq === 'ikari' ? 1 : uP(p)) * gkF(p);
    const mtF = (p) => clamp(((p.physical + p.defense + p.jump) / 3 - 30) / 54, 0.2, 1.2);   // 祭り太鼓の壁：上乗せはフィジカル・守備・ジャンプに連動   // 白亜の城壁の凸は、止める力ではなくキャッチにだけ効く（強すぎないように・育て切っても凸の違いが残るように）
    // 条件がそろった時に呼ぶ。出たら（出ている最中も）true。出なかったら少し待ってから、また狙える
    function sjForce(p) {   // 桜島の号令（凸）の2段構え：下げた後の押し上げは、クールタイムに関係なく出る
      S.sjBait = null; const u = UNIQ.sakurajima; p.uOn = S.t + u.dur * 1.25;
      act(p, 'uniq', 2.2, { k: 'sakurajima', lv: p.uniqLv || 1 }); ev('uniq', { team: p.team, player: p.name, number: p.number, k: 'sakurajima', name: u.name, lv: p.uniqLv || 1, face: u.face, gk: 0 });
      uniqLog.push({ t: +S.t.toFixed(2), i: p.idx, team: p.team, k: 'sakurajima' }); return true;
    }
    function uFire(p, k, chMul) {
      if (!p || p.uniq !== k || p.off || S.celebrate > 0) return false;
      if (p.uOn > S.t) return true;
      if (p.uCd > S.t) return false;
      if (k === 'minato' && p.cdRem > 0) return false;
      if (k === 'sakurajima') { const o = ownerP(); if (o && o.team !== p.team && !o.gk) { const xs = T[p.team].players.filter((m) => !m.off).map((m) => fx(o.team, m.x)).sort((a, c) => c - a); if (fx(o.team, o.x) > xs[1] - 1.5) return false; } }   // 桜島の号令：ボールを持った相手がもう最終ラインを越えている（GKと1対1）なら、号令をかけても意味がない
      if (k === 'miyabi') { const r = miyabiTarget(p), own0 = ownerP(); if ((own0 && own0.team === p.team) || !r) return false; const dr = hyp(r.x - p.x, r.y - p.y); if (dr > 25) return false; if (dr > 14 && T[p.team].players.filter((m) => m !== p && !m.gk && !m.off && hyp(r.x - m.x, r.y - m.y) < dr).length >= 3) return false; }   // 雅の後始末：守備の時だけ。奪いに行ける距離・近い順で2番目までの時だけ（持ち場を捨てて遠くへは行かない）   // 雅の後始末：守備の時だけ。遠すぎる所へは行かない（近くの味方に任せる）
      const u = UNIQ[k], lv2 = p.uniqLv >= 2;
      if (R.next() > Math.min(1, u.ch * (chMul ?? 1) * (lv2 ? 1.25 : 1))) { p.uCd = S.t + 1.5; return false; }
      p.uOn = S.t + u.dur * (lv2 ? 1.25 : 1); p.uCd = p.uOn + (lv2 && u.cd2 != null ? u.cd2 : u.cd * (lv2 ? 0.8 : 1));
      if (k === 'midori' && (T[p.team].mdStack || 0) < 3) p.uCd = p.uOn + 4;   /* 版468：積み重ねが4回になるまでは、間隔を短く */
      if (!(k === 'kinshachi' && p.ksShownT && S.t - p.ksShownT < 60)) { p.ksShownT = k === 'kinshachi' ? S.t : p.ksShownT; act(p, 'uniq', 2.2, { k, lv: p.uniqLv || 1 }); } /* 金鯱の心臓は何度も出るので、吹き出しは1分に1回だけ */ ev('uniq', { team: p.team, player: p.name, number: p.number, k, name: u.name, lv: p.uniqLv || 1, face: u.face, gk: p.gk ? 1 : 0 });
      uniqLog.push({ t: +S.t.toFixed(2), i: p.idx, team: p.team, k });
      uStart(p, k);
      return true;
    }
    // スイーパーキーパーの飛び込み：読んで詰めたGKが、抜け出した相手の足もと（シュートの瞬間も）へ飛び込む。成功すればキャッチ、失敗すれば倒れて無人のゴール
    // GKがシュートする選手の前（ゴールとの間）にいるか。GKを抜いた後ろからは、もう止められない
    function gkInFront(g, p) { return !!g && fx(p.team, g.x) > fx(p.team, p.x) - 0.3 && segDist(g.x, g.y, p.x, p.y, fx(p.team, L), GOAL_Y).d < 3.2; }
    // 無人のゴール：GKが倒れている・ゴールを大きく離れてコースにいない・抜かれて後ろにいる
    function emptyGoal(p) {
      const gx = fx(p.team, L), dg = hyp(gx - p.x, GOAL_Y - p.y), gk = opps(p).find((q) => q.gk && !q.off);
      if (!gk || dg > 25) return false;
      return ((gk.downT > 0 || gk.diveT > 0) && dg < 16) || (hyp(gk.x - gx, gk.y - GOAL_Y) > 9 && segDist(gk.x, gk.y, p.x, p.y, gx, GOAL_Y).d > 3) || (fx(p.team, gk.x) < fx(p.team, p.x) - 0.5 && dg < 22);
    }
    function skSmother(own, rad) {
      if (own.gk || fx(own.team, own.x) <= L - 30) return false;
      const g = opps(own).find((q) => q.gk && !q.off);
      if (!g || !gkInFront(g, own) || g.type !== 'スイーパーキーパー' || !((g.skRead || 0) > S.t || uOn(g, 'sutemi')) || g.downT > 0 || (g.smCd || 0) > S.t || hyp(g.x - own.x, g.y - own.y) > rad) return false;
      g.smCd = S.t + 3;
      const gq = (g.vision + g.speed + g.technique) / 3, pS = clamp(0.46 + (gq - own.dribble) * 0.004 + (uOn(g, 'sutemi') ? 0.35 * uP(g) : 0) + ((g.skRead || 0) > S.t ? 0.1 : 0), 0.2, 0.85);
      act(g, 'gkplay', 1.2, { k: 'rushOut' });
      if (R.next() < pS) { stats[g.team].saves++; ev('save', { team: g.team, player: g.name, act: 'smother' }); g.skRead = 0; gainBall(g, 'save'); return true; }
      g.skRead = 0; startDive(g, Math.sign(own.y - g.y) || 1, Math.max(0.8, Math.abs(own.y - g.y) + 0.6), 0.3); return false;   // かわされた：足もとへ飛び込んで倒れている間に流し込まれる
    }
    // ラインコントローラー：相手の裏への走り出しを読んで、パスが出る直前に一斉に押し上げる（読み勝てばオフサイド・読み負ければ裏を取られる）
    function lcReadRun(att) {
      const d = 1 - att.team, lcs = T[d].players.filter((m) => m.type === 'ラインコントローラー' && !m.gk && !m.off && !(m.stun > 0));
      if (!lcs.length) return;
      const lc = lcs.reduce((a, c) => (c.vision + c.mental > a.vision + a.mental ? c : a)), ps = ownerP();
      let pr = clamp(0.15 + lc.vision * 0.0035 + lc.mental * 0.0015 - (ps && ps.team === att.team ? ps.vision * 0.0025 : 0.15) + 0.06 * (lcs.length - 1) + 0.12 * aura(lc, 'lineCall', true), 0.08, 0.62);
      const skj = T[d].players.find((m) => m.uniq === 'sakurajima' && !m.off); if (skj && uOn(skj, 'sakurajima')) pr = Math.min(0.9, pr + 0.3 * uP(skj));   // 桜島の号令：一斉に、大きく
      if (skj && uOn(skj, 'sakurajima') && S.lcStep && S.lcStep.all && S.lcStep.until > S.t) { if (S.forcePass) S.forcePass.noRelease = true; return; }   // 桜島の号令で押し上げている最中：号令を優先（下げない）
      if (R.next() < pr) {
        const gap = fx(att.team, att.x) - offsideLine(att.team), big = !!(skj && uOn(skj, 'sakurajima'));
        if (gap > (big ? -8 : -6)) { S.lcStep = { team: d, until: S.t + 1.5, mode: 'up', r: att.idx, big }; act(lc, 'lcread', 1.3, { k: 'offTrap' }); if (S.forcePass) S.forcePass.noRelease = true; }   // ラインの近くから走り出した：一斉に押し上げて置き去りにする（オフサイド）
        else { const sjD = skj && !uOn(skj, 'sakurajima') && uFire(skj, 'sakurajima'); S.lcStep = { team: d, until: S.t + 2.4, mode: 'drop', r: att.idx, big: big || sjD }; act(lc, 'lcread', 1.3, { k: 'lineDrop' }); if (sjD) { act(skj, 'sjline', 1.6, { dt: d, drop: 1, lv: skj.uniqLv || 1 }); if (skj.uniqLv >= 2) S.sjBait = { team: d, until: S.t + 12 }; } }   // 桜島の号令でラインを下げる時も、同じ吹き出しとエフェクト   // 深い所から走り出した：ラインを下げて裏のスペースを消す
      }
    }
    // 優秀なDF：裏へ走り出した相手を読む。マークの受け渡し（近くのDFが走り出した選手についていく）と、スイーパーの裏のカバー
    const READ_TYPES = { 'ストッパー': 1, 'スイーパー': 1, 'アンカー': 1, 'マンマーカー': 1 };
    function dfTrack(runners) {
      const d = 1 - runners[0].team, used = new Set();
      const drop = S.lcStep && S.lcStep.team === d && S.lcStep.mode === 'drop' && S.lcStep.until > S.t;
      for (const r of runners) {
        const back = !(r.tact && r.tact.role === 'foot');   // 下りてくる選手には、DFはついていかない（中盤が見る）。DFは裏へ走る選手だけ
        let best = null, bd = 14;
        for (const o of T[d].players) { if (o.gk || o.off || used.has(o.idx) || o.position === 'FW') continue; if (o.position === 'DF' && (!back || drop)) continue; const dd = hyp(o.x - r.x, o.y - r.y); if (dd < bd) { bd = dd; best = o; } }
        if (!best) continue; used.add(best.idx);
        const pr = clamp(0.25 + best.vision * 0.003 + best.defense * 0.002 + (READ_TYPES[best.type] ? 0.18 : 0) + (best.type === 'マンマーカー' ? 0.1 : 0), 0.15, 0.9);
        if (R.next() < pr) best.trackRun = { until: S.t + 2.8, r: r.idx };   // ついていく
      }
      // スイーパー（雅の後始末を含む）：裏のスペースの後ろへ先回りしてカバー
      for (const o of T[d].players) { if (o.off || o.gk || !(o.type === 'スイーパー' || o.uniq === 'miyabi') || used.has(o.idx)) continue;
        const r = runners.find((q) => q.tact ? q.tact.role === 'ura' : true) || runners[0];
        if (R.next() < clamp(0.35 + o.vision * 0.004, 0.3, 0.85)) { o.coverRun = { until: S.t + 3.2, r: r.idx }; } }
    }
    // ふつうの裏への走り出しも、守る側は読む（ラインコントローラー・スイーパーキーパー・マークの受け渡し）。固有スキルだけの対策ではない
    function ctrPen(d) {
      S.ctrPenC = S.ctrPenC || {}; const ck = d + '|' + Math.floor(S.t / 5); if (S.ctrPenC[ck] != null) return S.ctrPenC[ck];
      let v = 0; const ps = T[d].players.filter((m) => !m.off);
      const g = ps.find((m) => m.gk); if (g && g.type === 'スイーパーキーパー') v += 0.12 + (g.uniq === 'sutemi' ? 0.08 : 0);
      if (ps.some((m) => m.type === 'ラインコントローラー' && !m.gk)) v += 0.12 + (ps.some((m) => m.uniq === 'sakurajima') ? 0.08 : 0);
      v += Math.min(2, ps.filter((m) => !m.gk && (m.type === 'スイーパー' || m.type === 'ストッパー')).length) * 0.08 + (ps.some((m) => m.uniq === 'miyabi') ? 0.08 : 0);
      return (S.ctrPenC[ck] = v);
    }
    function counterRead(att) {
      S.ctrT = S.ctrT || [-9, -9]; const d = 1 - att.team;
      if (S.t - S.ctrT[d] < 2.5 || S.forcePass) return; S.ctrT[d] = S.t;
      lcReadRun(att); skReadRun(att); dfTrack([att]);
    }
    // スイーパーキーパー：相手の裏への走り出しを読む（判断力が高いほど読める。捨て身の守護神はほぼ読む）
    function skReadRun(att) {
      const g = opps(att).find((q) => q.gk && !q.off); if (!g || g.type !== 'スイーパーキーパー') return;
      if (S.lcStep && S.lcStep.team === g.team && S.lcStep.mode === 'drop' && S.lcStep.until > S.t) return;   // ラインを下げている時は、GKは出ずにゴールを守る（DFとGKの意思をそろえる）
      const pr = clamp(0.45 + g.vision * 0.004 + (g.uniq === 'sutemi' && !(g.uCd > S.t) ? 0.35 : 0), 0, 0.92);
      if (R.next() < pr) g.skRead = S.t + 6;
    }
    // 港の指揮者：指揮棒の合図で、前線の味方が別々の方向へ同時に走り出す（裏・逆サイド・足もと）。いちばんいい1本を出す
    function tactStart(p) {
      const lv2 = p.uniqLv >= 2, n = lv2 ? 3 : 2, offL = offsideLine(p.team), pxf = fx(p.team, p.x);
      const cand = mates(p).filter((q) => q !== p && !q.gk && !q.off && fx(p.team, q.x) > pxf - 6);
      if (!cand.length) return;
      const used = new Set(), runs = [];
      const pick = (f, sc) => { let best = null, bs = -1e9; for (const q of cand) { if (used.has(q) || !f(q)) continue; const v = sc(q); if (v > bs) { bs = v; best = q; } } if (best) used.add(best); return best; };
      // 裏：いちばん前の選手（オフサイドラインの手前から）。月影の抜け出しを持つ選手がいれば、その選手
      const ura = pick((q) => fx(p.team, q.x) < offL - 0.3, (q) => fx(p.team, q.x) + (q.uniq === 'tsukikage' ? 40 : 0) + (q.position === 'FW' ? 6 : 0));
      if (ura) runs.push({ q: ura, role: 'ura', x: fx(p.team, Math.min(offL + 7, L - 16)), y: clamp(ura.y + (GOAL_Y - ura.y) * 0.25, 6, W - 6) });
      // 逆サイド：ボールと反対側の選手が、斜めに前へ
      const side = p.y > GOAL_Y ? -1 : 1;
      const wide = pick((q) => (q.y - GOAL_Y) * side > -4, (q) => (q.y - GOAL_Y) * side + fx(p.team, q.x) * 0.3);
      if (wide) runs.push({ q: wide, role: 'wide', x: fx(p.team, clamp(Math.max(fx(p.team, wide.x) + 10, pxf + 8), 0, Math.min(offL - 1, L - 14))), y: GOAL_Y + side * 18 });
      // 足もと（凸）：近くの味方が、相手のライン間に下りて受ける
      if (n >= 3) { const foot = pick(() => true, (q) => -hyp(q.x - p.x, q.y - p.y));
        if (foot) runs.push({ q: foot, role: 'foot', x: fx(p.team, Math.min(pxf + 12, offL - 4)), y: clamp(p.y + (GOAL_Y - p.y) * 0.5 + (foot.y > p.y ? 4 : -4), 6, W - 6) }); }
      const list = runs.slice(0, n);
      for (const r of list) { r.q.tact = { x: r.x, y: r.y, until: S.t + 2.6, role: r.role }; r.q.run = Math.max(r.q.run || 0, 2.6); }   // 走り出しの矢印は出さない
      if (!list.length) return;
      dfTrack(list.map((r) => r.q));   // 相手は走り出しにつられる（パスを出すのは、ボールを持つ味方が自分で選ぶ）
    }
    // 港の指揮者：走り出した中から、いちばん通って、いちばん前に進める1本を選ぶ
    function tactPick(p, ids) {
      let best = null, bs = -1e9;
      for (const i of ids) { const q = P[i]; if (!q || q.off || !q.tact) continue;
        const open = Math.min(9, nearestOpp(q, q.x, q.y).d), prog = fx(p.team, q.x) - fx(p.team, p.x), offL = offsideLine(p.team);
        const off = fx(p.team, q.x) > offL + 0.1 ? -50 : 0;
        const lane = opps(p).filter((o) => !o.gk && !o.off && (() => { const sd = segDist(o.x, o.y, p.x, p.y, q.x, q.y); return sd.u > 0.1 && sd.u < 0.92 && sd.d < 1.4; })()).length;
        const v = open * 1.0 + prog * 0.18 + off - lane * 2.5 + (q.tact.role === 'ura' ? 1.5 : 0) + (q.uniq === 'tsukikage' ? 3 : 0);
        if (v > bs) { bs = v; best = q; } }
      return best;
    }
    // 出た瞬間の動き
    function uStart(p, k) {
      if (k === 'aonoouza' || k === 'uzushio') {   // 相手DFを動かす：蒼の王座は前へ釣り出す（1人・凸2人）、渦潮の囮は後ろへ引っぱる（2人・凸3人）
        const n = (k === 'uzushio' ? 2 : 1) + (p.uniqLv >= 2 ? 1 : 0);
        const pulled = opps(p).filter((q) => !q.gk && !q.off && q.position === 'DF').sort(k === 'uzushio' ? (a, c) => Math.abs(a.y - GOAL_Y) - Math.abs(c.y - GOAL_Y) : (a, c) => hyp(a.x - p.x, a.y - p.y) - hyp(c.x - p.x, c.y - p.y)).slice(0, n);   /* 渦潮の囮は、真ん中のCBを連れていく */
        pulled.forEach((q) => { q.uPull = { until: p.uOn, to: p.idx }; act(q, k === 'aonoouza' ? 'aopull' : 'uzpull', p.uOn - S.t, { to: p.idx, lv: p.uniqLv || 1 }); });   // 釣られた・引っぱられたDFから本人へ、光の線（ついて行っているのが分かるように）
        if (k === 'aonoouza') { p.aoHoldT = 0;   // 釣り出したCBがいた所（DFラインの穴）へ、2列目の味方が走り込む
          const hole = pulled[0] ? [pulled[0].x, pulled[0].y] : [p.x + sgn(p.team) * 14, GOAL_Y], olA = offsideLine(p.team), own0 = ownerP();
          const ps0 = S.aoPasser != null ? P[S.aoPasser] : null, passer = ps0 && ps0 !== p && !ps0.gk && !ps0.off && ps0.team === p.team && ps0.position !== 'DF' ? ps0 : null;   // くもいにパスを出した2列目の味方が、そのまま穴へ走る（パス＆ゴー）
          const others = mates(p).filter((m) => m !== p && m !== passer && !m.gk && !m.off && m.position !== 'DF' && m !== own0 && fx(p.team, m.x) > olA - 16 && fx(p.team, m.x) < olA - 0.3).sort((a, c) => (hyp(a.x - hole[0], a.y - hole[1]) - fx(p.team, a.x) * 0.3 - (a.position === 'FW' ? 12 : 0)) - (hyp(c.x - hole[0], c.y - hole[1]) - fx(p.team, c.x) * 0.3 - (c.position === 'FW' ? 12 : 0)));   /* もう1人のFWがいれば、真っ先に裏へ抜け出す */
          const fwM = others.find((m) => m.position === 'FW'), mfM = passer && passer.position === 'MF' ? passer : others.find((m) => m.position === 'MF'), rest = others.filter((m) => m !== fwM && m !== mfM);
          const cand = [fwM, mfM].filter(Boolean).concat(rest, passer && passer !== mfM ? [passer] : []).slice(0, p.uniqLv >= 2 ? 3 : 2);   /* 味方のFWと2列目のMFが、そろって裏へ（凸はもう1人） */
          for (const m of cand) { m.run = Math.max(m.run || 0, 4.5); m.runCd = 0; m.otRun = { x: Math.min(olA + 7, L - 8), y: clamp(hole[1] + (m === passer ? 0 : (m.y > hole[1] ? 6 : -6)), 6, W - 6), until: S.t + 5 }; m.pgRun = S.t + 5; m.aoRun = S.t + 5; act(m, 'aorun', 5, { lv: p.uniqLv || 1 }); }
        }
        if (k === 'uzushio') {   // 空いた手前（バイタルエリア）へ入ってくる2列目の味方
          const own0 = ownerP(); const ho = own0 && own0.team === p.team ? own0 : p, atkT = (m) => (['シャドー', 'ファンタジスタ', 'アタッカー', 'ストライカー'].includes(m.type) ? 8 : 0) + fx(p.team, m.x) * 0.3 - hyp(m.x - (ho.x + sgn(p.team) * 10), m.y - GOAL_Y) * 0.6;   /* 呼ぶのは、持っている味方の前（ゴールの方）に近い攻めの選手 */ const cand = p.uniqLv >= 2 ? mates(p).filter((m) => m !== p && !m.gk && !m.off && m.position === 'MF' && m !== own0).sort((a, c) => atkT(c) - atkT(a)).slice(0, 1) : [];   /* 無凸：MFは呼ばない（守りが手薄にならないように）。凸：2列目のMFも1人、空いたスペースへ駆け上がる */   /* 仲間は呼ばない：空いたスペースは、持っている選手がドリブルで使う */   /* 仲間を呼ぶ：シャドー・ファンタジスタが、空く真ん中へ駆け上がる */
          { const olZ = offsideLine(p.team); for (const m of mates(p)) if (m !== p && !m.off && m.position === 'FW' && m !== own0) { m.run = Math.max(m.run || 0, 4.5); m.runCd = 0; m.otRun = { x: Math.min(olZ + 9, L - 8), y: clamp(GOAL_Y + (m.y - GOAL_Y) * 0.3, 8, W - 8), until: S.t + 5 }; m.aoFast = S.t + 5; m.uzFwT = S.t + 5; act(m, 'uzrun', 4, { lv: p.uniqLv || 1 }); } }   // 相方のFW：CBがいなくなった真ん中の裏へ、速い足で抜け出す
          p.uzGo = S.t; T[p.team].uzCounter = own0 && own0.team === p.team && (own0.wonT || -9) > S.t - 3 ? own0.idx : -1; T[p.team].uzStart = S.t; cand.forEach((m, k2) => { m.run = 0; m.uzT = p.uOn; m.uzSide = k2 ? -1 : 1; m.uzSpot = null; act(m, 'uzrun', p.uOn - S.t, { lv: p.uniqLv || 1 }); });
          { const o0 = ownerP(), by = o0 ? o0.y : S.ball.y, side = Math.abs(by - GOAL_Y) > 6 ? -Math.sign(by - GOAL_Y) : (Math.sign(p.y - GOAL_Y) || 1); p.uzTo = [fx(p.team, L - 5), GOAL_Y + side * 26]; }   // ボールと逆のサイドの、コーナーフラッグの方へ走り抜ける
        }
      }
      if (k === 'aonoouza') { p.protect = Math.max(p.protect || 0, S.t + 0.7); S.decision = Math.min(S.decision, 0.15); }
      if (k === 'kage') { act(p, 'kmfire', 1.0, { lv: p.uniqLv || 1 }); act(p, 'kmshade', 1.4, { lv: p.uniqLv || 1 }); p.protect = Math.max(p.protect || 0, S.t + 0.8); p.kmHoldT = S.t; for (const o of opps(p)) if (!o.gk && hyp(o.x - p.x, o.y - p.y) < 7) { o.lagT = Math.max(o.lagT || 0, S.t + (p.uniqLv >= 2 ? 0.9 : 0.7)); if (o.mark === p.idx) { o.mark = -1; o.markHard = false; } }   // 影の一刺し：気配が消える（寄せてくる相手が一瞬見失う）
        const olK = offsideLine(p.team), fw = mates(p).filter((m) => m !== p && !m.off && !m.gk && m.position === 'FW' && fx(p.team, m.x) > fx(p.team, p.x) + 2).sort((a, c) => ((c.type === 'ストライカー' || c.uniq === 'guren' ? 8 : 0) - hyp(L - fx(p.team, c.x), GOAL_Y - c.y) * 0.2) - ((a.type === 'ストライカー' || a.uniq === 'guren' ? 8 : 0) - hyp(L - fx(p.team, a.x), GOAL_Y - a.y) * 0.2))[0];
        if (fw) { fw.kmRunT = S.t + 4; fw.kmBy = p.idx; fw.run = Math.max(fw.run || 0, 4); fw.runCd = 0; { let bs = -1e9, by = GOAL_Y; for (const dy of [-9, -5, -2, 2, 5, 9]) { const yy = GOAL_Y + dy, wx = fx(p.team, Math.min(olK + 4, L - 9)); let m = 9; for (const o of opps(p)) if (!o.off && !o.gk) m = Math.min(m, hyp(o.x - wx, o.y - yy)); const v = m - Math.abs(dy) * 0.12 - Math.abs(yy - fw.y) * 0.05; if (v > bs) { bs = v; by = yy; } } fw.otRun = { x: Math.min(olK + 8, L - 9), y: by, until: S.t + 4 }; }   /* DFラインの裏へ（パスが出るまではオフサイドラインの手前で駆け引き） */ fw.aoFast = Math.max(fw.aoFast || 0, S.t + 3.5); p.kmFw = fw.idx; act(fw, 'kmrun', 3.5, { lv: p.uniqLv || 1 }); } else p.kmFw = -1; }   // 前のFW：ゴール前の打てる所へ動き出す
      if (k === 'tetsurou') { act(p, 'ttgate', 1.1, { lv: p.uniqLv || 1 }); act(p, 'ttwolf', p.uOn - S.t, { lv: p.uniqLv || 1 }); }   // 鉄狼の関所：鋼色の門が閉じる   // 前を向くのが速い
      if (k === 'midori') { const lv2 = p.uniqLv >= 2, lv = p.uniqLv || 1, dl = lv2 ? 3.0 : 2.7;   /* 版448 翠の起点：わざとボールを晒して、相手のプレスとDFラインを引き寄せる */
        T[p.team].mdStack = (T[p.team].mdStack || 0) + (globalThis.__mdFix != null ? 0 : 1);
        if ((T[p.team].mdStack || 0) <= 4 + 2) for (const m of T[p.team].players) if (!m.off) act(m, 'mdbuff', 1.6, { k: Math.min(4, T[p.team].mdStack || 0), max: (T[p.team].mdStack || 0) >= 4 });   /* 版467：積み重なるたびに、味方全員の足もとに緑の光 */   /* 版450：発動するたびに、チームのパスの精度・速さが1.1倍ずつ上がっていく（試合の間ずっと） */
        p.protect = Math.max(p.protect || 0, S.t + dl + 0.3); p.mdT0 = S.t; p.mdGo = 0; p.mdSpot = null; p.mdTo = -1; p.mdMax = S.t + (lv2 ? 2.2 : 1.9); act(p, 'mdfire', 1.0, { lv }); act(p, 'mdlure', dl, { lv });
        const os0 = opps(p).filter((o) => !o.off && !o.gk && hyp(o.x - p.x, o.y - p.y) < 28).sort((a2, c2) => (a2.position === 'DF' ? 12 : 0) + hyp(a2.x - p.x, a2.y - p.y) - ((c2.position === 'DF' ? 12 : 0) + hyp(c2.x - p.x, c2.y - p.y)));
        os0.slice(0, lv2 ? 3 : 2).forEach((o) => { o.mdLure = { by: p.idx, until: S.t + dl }; o.mark = -1; act(o, 'mdpull', dl, { to: p.idx, lv }); });   // 食いついてくる相手（前線・中盤から）
        T[1 - p.team].mdPush = { by: p.idx, until: S.t + dl + 0.6, amt: lv2 ? 15 : 12 }; }   // 相手のDFライン・中盤も前のめりに押し上げる
      if (k === 'byakuya') { p.protect = Math.max(p.protect || 0, S.t + 1.2); act(p, 'bycalm', p.uniqLv >= 2 ? 1.1 : 0.8, { lv: p.uniqLv || 1 });   // 白夜：時間がゆっくり流れる。寄せてくる相手をいなす
        for (const o of opps(p)) if (!o.gk && hyp(o.x - p.x, o.y - p.y) < 4) { o.lagT = Math.max(o.lagT || 0, S.t + 0.7); o.touchCd = Math.max(o.touchCd || 0, 0.8); } S.decision = Math.min(S.decision, 0.35);
        // 裏へ走らせる：DFラインの近くにいる前の味方が、ことうの目を見て一斉に裏へ走り出す（いつもより速く）
        p.byRunner = -1; { const ol = offsideLine(p.team); let best = null, bs = -1e9;
          for (const q of mates(p)) { if (q === p || q.gk || q.off || q.position === 'DF') continue; const qf = fx(p.team, q.x); if (qf > ol - 0.3 || qf < ol - 18 || qf < L / 2 - 5) continue;
            const v = qf * 0.2 - Math.abs(q.y - GOAL_Y) * 0.05 + (q.position === 'FW' ? 2 : 0) + Math.min(8, nearestOpp(q, q.x, q.y).d) * 0.3; if (v > bs) { bs = v; best = q; } }
          if (best) { const lv2 = p.uniqLv >= 2, tx0 = Math.min(ol + (lv2 ? 14 : 11), L - 11); best.byRunT = S.t + (lv2 ? 4 : 3.4); best.byRunLv = p.uniqLv || 1; best.byRunTo = [fx(p.team, tx0), clamp(best.y + (GOAL_Y - best.y) * 0.35, 6, W - 6)]; best.run = Math.max(best.run || 0, 3); p.byRunner = best.idx; act(best, 'byrun', 2.5, { lv: p.uniqLv || 1 }); } } }
      if (k === 'tsukikage') p.run = Math.max(p.run || 0, 3.4);
      if (k === 'shiden') p.uFireT = S.t;
      if (k === 'tsukikage') { p.uFireT = S.t; p.tsukiRecv = 0; } if (k === 'tsukikage') { const o = ownerP(); if (o && o.team === p.team && o !== p) S.forcePass = { to: p.idx, from: o.idx, at: S.t + 0.55, until: S.t + 2.4 }; lcReadRun(p); skReadRun(p); dfTrack([p]); }   // 抜け出しに合わせて、ボールを持った味方がスルーパスを出す
      if (k === 'minato') { p.uFireT = S.t; p.cdOn = true; T[p.team].cdNext = S.t + 2.4; tactStart(p);   // 港の指揮者：合図で前線が動き出し、チーム全体の指揮が始まる
        for (const m of mates(p)) if (!m.off && !m.gk) act(m, 'cdon', p.uOn - S.t, { lv: p.uniqLv || 1, c: p.idx }); act(p, 'cdon', p.uOn - S.t, { lv: p.uniqLv || 1, c: p.idx }); }
      if (k === 'miyabi') { p.uChase = null; const r = miyabiTarget(p); p.miyabiR = r ? r.idx : -1; act(p, 'myb', p.uOn - S.t, { r: p.miyabiR }); }
      if (k === 'matsuri') p.uOn = Math.min(p.uOn, S.t + 1.8);   // 祭り太鼓の壁：効果は吹き出しが出ている間（1.8秒）だけ
      if (k === 'matsuri') { const o = ownerP(); if (o && o.team !== p.team) { o.mtLock = S.t + 1.2; p.mtCharge = { o: o.idx, at: S.t + 0.3 }; const hx = o.x - p.x, hy = o.y - p.y, hl = hyp(hx, hy) || 1; act(p, 'mtrush', 0.35, { dx: hx / hl, dy: hy / hl }); } }   // 発動したら、相手は詰め寄られて逃げのパスを出す間がない（その間にぶつかる）
      if (k === 'sutemi') { p.uChase = { until: p.uOn, mode: 'ball' }; p.sutemiBall = S.t + 3; }
    }
    // 競り合い（q がボールを奪いにいく、own が持っている）の有利・不利
    function uDuel(q, own) {
      if (globalThis.__mdFix != null) for (const t of T) if (t.players.some((m) => m.uniq === 'midori')) t.mdStack = globalThis.__mdFix;
      let a = 0;
      if ((q.sw5 || -9) > S.t - 0.5) a += 0.22;   // 5バックの真ん中のスイーパー：抜けてきた相手を最後に止める
      if (q.uniq && q.uOn > S.t) {
        if (q.uniq === 'matsuri') a += (0.55 + Math.max(0, q.physical - own.physical) * 0.006 + (S.t - (own.recvT || -9) < 0.7 ? 0.25 : 0)) * uP(q) * mtF(q);   // 受けた瞬間に背中から体をぶつけて、トラップを乱す
        if (q.uniq === 'tetsurou') a += (q.uniqLv >= 2 ? 0.85 : 0.75) * uP(q);   // 鉄狼の関所：体ごとぶつかって奪い切る
        if (q.uniq === 'miyabi') a += 0.35 * uP(q);   // 雅の後始末：抜けてきた相手を、体を入れて確実に止める
        if (q.uniq === 'kinshachi') a += uOn(q, 'kinshachi') ? (q.uniqLv >= 2 ? 0.6 : 0.5) : 0.22;   // 全力で戻って奪い返す
      }
      if (q.uniq !== 'kinshachi' && ksTeam(q.team)) a += 0.05;   // 金鯱の心臓：かいがいると、チーム全体の守備が整って、競り合いに少し強い
      if (opps(own).some((o) => (o.kgT === own.idx || o.mark === own.idx) && uOn(o, 'kagenui'))) a += 0.45;   // 影縫い
      { const k = T[own.team].mdStack || 0; if (k) a -= Math.min(0.45, 0.12 * k); }   /* 版452 翠の起点の積み重ね：落ち着いて持てる（奪われにくい） */
      if ((own.tactBuff || 0) > S.t) a -= 0.08;   // 指揮の余韻：奪われにくい
      { const c = condLv(own.team); if (c) a -= c >= 2 ? 0.34 : 0.28; }   // 港の指揮者：テンポよく回されて、相手のプレスが空回りする
      if ((own.hariT || 0) > S.t) a -= own.hariLv >= 2 ? 0.8 : 0.65;   // 針の穴通しの1本で抜け出した：勢いのまま、追いつかれても奪われにくい
      if (own.uniq && own.uOn > S.t) a -= { shiden: 0.85 * uP(own), midori: 0.25, aonoouza: 0.12 }[own.uniq] || 0;
      if (q.position === 'DF') a += 0.04 * aura(q, 'bodyVoice', true) + 0.02 * aura(q, 'relief');
      if (Math.abs(own.y - GOAL_Y) < 15) a += 0.04 * aura(q, 'shield', true);
      return a;
    }
    // ドリブル技の成功率の増減
    function uDrib(own, q) {
      let a = 0;
      if ((own.tactBuff || 0) > S.t) a += own.tactLv >= 2 ? 0.15 : 0.1;   // 指揮の余韻
      { const k = T[own.team].mdStack || 0; if (k) a += Math.min(0.3, 0.08 * k); }   /* 版452 翠の起点の積み重ね：前を向いて仕掛けやすい */
      if (uOn(own, 'shiden')) a += 0.7 * uP(own);   // 紫電の遊戯：屈指のDFでも手を焼く
      if (opps(own).some((o) => (o.kgT === own.idx || o.mark === own.idx) && uOn(o, 'kagenui'))) a -= 0.45;
      if (uOn(q, 'matsuri')) a -= 0.45 * mtF(q);   // ドン！と体を当てて、抜かせない
      if (uOn(q, 'tetsurou')) a -= 0.6;   // 鉄狼の関所：ドリブルの技がほとんど通じない
      if (Math.abs(own.y - GOAL_Y) < 15) a -= 0.04 * aura(q, 'shield', true);
      return a;
    }
    // 味方DFが抜かれた：雅の後始末（カバー）・最後の砦（立て直しが早い）
    // 雅の後始末：いちばん危ない相手（裏へ抜け出した・抜けてきた相手FW）を選ぶ
    function miyabiTarget(m) {
      const b = S.ball, own = ownerP();
      if (own && own.team !== m.team) return own;
      if (b.kind === 'pass' && b.intended >= 0 && P[b.intended] && P[b.intended].team !== m.team) return P[b.intended];
      return opps(m).filter((q) => !q.gk && !q.off).sort((a, c) => fx(c.team, c.x) - fx(a.team, a.x))[0] || null;
    }
    function uBeaten(q) {
      if (q.position !== 'DF') return;
      for (const m of T[q.team].players) if (m !== q && m.uniq === 'miyabi') uFire(m, 'miyabi');
      const a = aura(q, 'lastFort'); if (a) { q.tackleCd *= 1 - 0.3 * a; q.stun *= 1 - 0.3 * a; }
    }
    // 毎コマ：場面で出る固有スキル（後半30分・マークの相手が持った・相手が攻めてきた・味方FWがゴール前で持った）と、ムードメーカー
    function uTick() {
      if (S.celebrate > 0) return;
      const own = ownerP(), minute = S.t * CLOCK_SCALE / 60;
      if (S.forcePass && S.t < S.forcePass.at && !S.forcePass.noRelease) { const q = P[S.forcePass.to];   // 月影の抜け出し：ラインを越える直前に出す（完璧なタイミング＝オフサイドにならない。間に合わなければ、ふつうにオフサイド）
        if (q && !q.off && fx(q.team, q.x + q.vx * 0.2) > offsideLine(q.team) - 0.15 && S.t - (q.uFireT || 0) > 0.12) S.forcePass.at = S.t; }
      for (const p of P) {   // 固有スキルが終わった瞬間を記録（エフェクトを止めるため）。月影の抜け出し：パスが相手に渡ったら、その場で終わる
        if (!p.uniq) continue;
        if (p.uniq === 'shiden' && p.uOn > S.t && S.t - (p.uFireT || 0) > 0.5 && !(own === p) && !(S.ball.owner < 0 && S.ball.intended === p.idx && S.ball.lastPlayer === p.idx)) p.uOn = S.t;   // 紫電の遊戯：ボールを離したら（パス・シュート・奪われた）終わり
        if (p.uniq === 'tsukikage' && p.uOn > S.t && !(p.tsukiRecv > (p.uFireT || 0)) && !S.forcePass && S.t - (p.uFireT || 0) > 0.6 && (S.restart || (own && own !== p) || (S.ball.kind !== 'pass' && !own))) p.uOn = S.t;
        if (p.uniq === 'matsuri' && p.uOn > S.t && own && own.team === p.team) p.uOn = S.t;
        if (p.uniq === 'minato' && p.uOn > S.t && S.t - (p.uFireT || 0) > 0.3 && (S.poss !== p.team || S.restart || S.celebrate > 0)) { p.cdRem = S.celebrate > 0 ? 0 : p.uOn - S.t; p.uOn = S.t; }   // 港の指揮者：相手に取られた・外に出たら、いったん止める（残りの秒数は取っておく。ゴールが決まったら終わり）
        if (p.uniq === 'minato' && p.cdRem > 0 && !(p.uOn > S.t) && own && own.team === p.team && !S.restart && !S.setPiece && S.celebrate <= 0 && !p.off) { p.uOn = S.t + p.cdRem; p.cdRem = 0; p.uFireT = S.t; p.cdOn = true; T[p.team].cdNext = S.t;   // また味方のボールになったら、残りの秒数だけ指揮が戻る
          act(p, 'uniq', 1.2, { k: 'minato', lv: p.uniqLv || 1, resume: 1 }); for (const m of T[p.team].players) if (!m.off && !m.gk) act(m, 'cdon', p.uOn - S.t, { lv: p.uniqLv || 1, c: p.idx }); }
        if (p.uniq === 'minato' && p.cdOn && !(p.uOn > S.t)) { p.cdOn = false; for (const m of T[p.team].players) if (!m.off) act(m, 'cdoff', 0.1, {}); }
        if (p.kgShow && (!(p.uOn > S.t) || S.restart || S.celebrate > 0)) { p.kgShow = false; act(p, 'kgoff', 0.1, {}); }
        if (p.uOnSeen > 0 && p.uOn <= S.t) { act(p, 'uend', 0.1, { k: p.uniq }); p.uOnSeen = 0; } else if (p.uOn > S.t) p.uOnSeen = 1;
      }
      if (!S.restart) for (const p of P) {
        if (!p.uniq || p.off) continue;
        switch (p.uniq) {
          case 'kinshachi': {   // 金鯱の心臓：味方がボールを奪った・奪われた瞬間に、全力で走り出す（攻めは前へ、守りはボールへ）
            const ps = S.poss, ksGo = (mode) => { const key = mode === 'atk' ? 'ksCdA' : 'ksCdD';   // 攻めの走りと守りの走りは、それぞれ別に間隔をとる（片方を使った直後でも、もう片方は使える）
              if (p.uOn > S.t && p.ksMode === mode) return;
              if ((p[key] || 0) > S.t) { if (p.uOn > S.t && p.ksMode !== mode) { p.uOn = S.t; p.ksMode = null; } return; }
              p.uOn = 0; p.uCd = 0; if (uFire(p, 'kinshachi')) { p.ksMode = mode; p[key] = p.uOn + UNIQ.kinshachi.cd * (p.uniqLv >= 2 ? 0.8 : 1); act(p, 'ksrun', p.uOn - S.t, { m: mode, lv: p.uniqLv || 1 }); } };
            // 攻め：奪ってすぐ前へ走らない。まず顔を出して組み立て、ボールが相手陣内の手前（45m）まで運ばれてから、前線のサポートへ駆け上がる
            const ksAdv = () => { const o = ownerP(); return !!o && o.team === p.team && o !== p && !o.gk && fx(p.team, o.x) > (o.position === 'DF' ? 55 : 45); };
            if (p.ksPoss !== ps && ps != null && ps >= 0) { const prev = p.ksPoss; p.ksPoss = ps; p.ksPend = false; if (prev != null && !S.setPiece && S.celebrate <= 0) { if (ps !== p.team) ksGo('def'); else if (ksAdv()) ksGo('atk'); else { p.ksPend = true; if (p.uOn > S.t) p.ksMode = 'wait'; } } }
            else if (p.ksPend && ps === p.team && !S.setPiece && ksAdv()) { p.ksPend = false; ksGo('atk'); }
            break; }
          case 'kagenui': {   // 影縫い：マークしている相手が、パスを受けられそうな所にいる（相手ボール・自陣側・ボールから30m以内・自分が8m以内）
            let q = p.mark >= 0 ? P[p.mark] : null;
            if (!p.kgT && own && own.team !== p.team && !(p.uCd > S.t)) {   // 狙うのは相手のエース：国内屈指がいればその選手、いなければ一番の点取り屋（シュート力・FW・点取り屋タイプ）
              const thr = (o) => o.kick * 0.4 + o.technique * 0.3 + o.dribble * 0.2 + o.speed * 0.1 + (o.position === 'FW' ? 15 : o.position === 'MF' ? 4 : -30) + (o.type === 'ストライカー' || o.type === 'アタッカー' ? 10 : 0) + (o.uniq || o.top ? 40 : 0);
              let ace = null, av = -1e9; for (const o of opps(p)) { if (o.off || o.gk) continue; const v = thr(o); if (v > av) { av = v; ace = o; } }
              if (ace && hyp(ace.x - p.x, ace.y - p.y) < 20 && fx(p.team, ace.x) < 35 && uFire(p, 'kagenui')) { q = ace; p.kgT = q.idx; act(p, 'kgon', p.uOn - S.t, { r: q.idx, lv: p.uniqLv || 1 }); }
            }
            if (p.kgT && p.uniqLv >= 2 && uOn(p, 'kagenui') && own && own.idx === p.kgT && !own.gk && hyp(own.x - p.x, own.y - p.y) < 3.5 && !((own.kgPin || 0) > S.t - 4)) { own.kgPin = S.t + 1.0; own.vx *= 0.1; own.vy *= 0.1; act(own, 'kgpin', 1.0, { o: p.idx }); act(p, 'kgsew', 0.6, { o: own.idx }); S.decision = Math.max(S.decision, 0.3); }   // 凸：張りついた相手がボールを持っていたら、追いついた所で影を縫い止める
            if (p.kgT && (!(p.uOn > S.t) || P[p.kgT].off)) { if (p.uOn > S.t) p.uOn = S.t; p.kgT = 0; }   // 狙った相手を、続く間ずっと追い続ける（味方ボールの間は持ち場に戻り、相手ボールになったらまた張りつく）   // 味方ボールになったら、そこで終わる
            { const qv = p.kgT ? P[p.kgT] : null, vis = !!(qv && uOn(p, 'kagenui') && own && own.team !== p.team && !S.restart && !(S.celebrate > 0) && fx(p.team, qv.x) < 50);   // 糸を見せるのは、実際に張りついている間（相手ボール・プレー中）だけ
              if (vis !== !!p.kgShow) { p.kgShow = vis; act(p, vis ? 'kgsh' : 'kgoff', vis ? 120 : 0.1, { r: p.kgT || -1, lv: p.uniqLv || 1 }); } }
            if (p.kgT) { p.mark = p.kgT; p.markHard = true; const q2 = P[p.kgT]; if (hyp(q2.x - p.x, q2.y - p.y) < 4) q2.kgSlow = S.t + 0.3; }   // 影を縫われた相手は、足が重くなる（張りついている間は動きが鈍い）
            break; }
          case 'miyabi': if (own && own.team !== p.team && !own.gk && fx(p.team, own.x) < 32 && hyp(own.x - p.x, own.y - p.y) < 9 && !T[p.team].players.some((m) => m !== p && !m.gk && !m.off && hyp(m.x - own.x, m.y - own.y) < hyp(p.x - own.x, p.y - own.y))) uFire(p, 'miyabi'); break;   // 雅の後始末：ゴール前へ運んでくる相手に、いちばん近いのが自分なら奪いに行く
          case 'sakurajima': break;   // 桜島の号令は、相手が縦パスを出す瞬間（オフサイドトラップの瞬間）にだけ出る（startPass で判定）
          case 'matsuri': if (own && own.team !== p.team && !own.gk && hyp(own.x - p.x, own.y - p.y) < 5.5 && fx(p.team, own.x) < 52 && fx(p.team, p.x) < fx(p.team, own.x) - 0.3 && !(p.uCd > S.t)) p.mtHunt = S.t + 1.8; break;   // 向き合った相手へ寄せる（発動＝吹き出しとエフェクトは、体をぶつけた瞬間）   // 向き合った時だけ（ゴール側にいる時）。後ろから追いかける時は出ない   // 上がってきた相手（FW・MF・DFだれでも）と向き合った
          case 'tetsurou': { const zw = p.uniqLv >= 2 ? 21 : 18, zr = p.uniqLv >= 2 ? 12 : 10; if (own && own.team !== p.team && !own.gk && Math.abs(own.y - GOAL_Y) < zw && fx(p.team, own.x) < 46 && hyp(own.x - p.x, own.y - p.y) < zr && fx(p.team, p.x) < fx(p.team, own.x) + 1.5) uFire(p, 'tetsurou');   /* 正面・横から（相手の後ろからは追わない） */   // 自陣ゴール前の真ん中へ運んできた相手
            else if (!own && S.ball.kind === 'pass' && S.ball.intended >= 0 && P[S.ball.intended].team !== p.team) { const q = P[S.ball.intended], sd = segDist(p.x, p.y, S.ball.x, S.ball.y, q.x, q.y); if (Math.abs(q.y - GOAL_Y) < zw && fx(p.team, q.x) < 46 && (sd.d < 4 || hyp(q.x - p.x, q.y - p.y) < 6)) uFire(p, 'tetsurou'); }   // 真ん中へ通そうとしたパス
            break; }
          case 'kage': if (globalThis.__kmZ && own === p && S.t > (p.kmZt || 0)) { p.kmZt = S.t + 1; const z = globalThis.__kmZ; z.own++; if (fx(p.team, p.x) > L / 2 + 2 && fx(p.team, p.x) < L - 12) { z.zone++; if (Math.abs(p.y - GOAL_Y) < 28) { z.cen++; if (mates(p).some((m) => m !== p && !m.off && !m.gk && m.position === 'FW' && fx(p.team, m.x) > fx(p.team, p.x) + 2 && fx(p.team, m.x) < offsideLine(p.team) + 3)) z.fw++; if (p.uCd > S.t) z.cd++; } } }
            if (own === p && !S.setPiece && fx(p.team, p.x) > L / 2 + 2 && fx(p.team, p.x) < L - 12 && Math.abs(p.y - GOAL_Y) < 28 && mates(p).some((m) => m !== p && !m.off && !m.gk && m.position === 'FW' && fx(p.team, m.x) > fx(p.team, p.x) + 2 && fx(p.team, m.x) < offsideLine(p.team) + 3)) uFire(p, 'kage'); break;   // 影の一刺し：FWのすぐ後ろで、前を向いて持った
        }
      }
      // ムードメーカー（バランスのサポートパッシブ）：負けている時・引き分けの時、味方全員の能力が少し上がる
      if (Math.round(S.t * 10) % 10 === 0) for (const tm of T) {
        let lv = 0; if (tm.pas && tm.pas.has('mood')) for (const m of tm.players) if (m.pasK === 'mood' && !m.off) lv = Math.max(lv, m.passive);
        const want = lv && S.score[tm.ti] <= S.score[1 - tm.ti] ? (lv >= 2 ? 3 : 2) : 0;
        for (const p of tm.players) { const dlt = want - (p.moodAdd || 0); if (dlt) { for (const k of PARAM_KEYS) p[k] += dlt; p.moodAdd = want; } }
      }
    }
    const teamU = (ti, k) => T[ti].players.find((m) => m.uniq === k && m.uOn > S.t) || null;
    // サポートパッシブ：持っている味方（rad があれば、その距離以内）がいれば強さを返す（0＝なし、1、1.6＝強化）
    function aura(p, k, self) {
      const tm = T[p.team]; if (!tm.pas || !tm.pas.has(k)) return 0;
      let lv = 0; const ps = PASSIVE_BY_K[k];
      for (const m of tm.players) { if (m.pasK !== k || m.off || (!self && m === p)) continue; if (ps.rad != null && m.passive < 3 && hyp(m.x - p.x, m.y - p.y) > ps.rad) continue; lv = Math.max(lv, m.passive); }
      return lv >= 3 ? (ps.rad != null ? 1.6 : 1.9) : lv >= 2 ? 1.6 : lv;
    }
    // パスに触ってよい選手か：味方へのパスを、ほかの味方は触らない（頭で触る・カットする、をしない）。
    // 月影の抜け出しのスルーパスは、届かせると決まった相手DF（パスの出し手よりずっと上手いDF）と、飛び出したスイーパーキーパーだけが触れる
    // カバーリングできるDF：カバーリングのスキル・スイーパーのタイプ・雅の後始末が出ている選手
    const isCover = (q) => !q.gk && (skZ(q, 'cover') || q.type === 'スイーパー' || uOn(q, 'miyabi'));
    // 白夜の視界の1本を、受け手以外が触れない間：飛んでいる間と、落ちた後も受け手がすぐそばまで来ている間だけ（短くなって転がった球は、誰でも拾える。置き去りにしない）
    function byLock(b) { if (!b.byP) return false; if (S.t - (b.byT0 ?? S.t) > 4.5) return false; if (b.z >= 0.6) return true; const q = P[b.intended]; return hyp(b.vx, b.vy) > 3 && !!q && !q.off && hyp(q.x - b.x, q.y - b.y) < 7; }
    function passOk(p, b) {
      if (b.kind === 'shot' && p.team === b.lastTeam && b.lastPlayer !== p.idx) return false;   // 味方のシュートには触らない（ゴールへ向かう球を、横から触ってコースを変えたり、オフサイドにしたりしない）
      if (byLock(b) && b.intended >= 0 && p.idx !== b.intended && P[b.intended] && !P[b.intended].off) return p.team !== b.lastTeam && p.gk && fx(p.team, b.x) < 5.5;   // 白夜の視界の1本：受け手が触るまで、ほかの味方も相手も触らない
      if (b.kind !== 'pass' || b.intended < 0 || p.idx === b.intended) return true;
      if (p.team === b.lastTeam) return false;
      if (b.aoIn) return false;   // 蒼の王座：発動した瞬間の、くもいへの縦パスはカットされない（くもいが体を入れて受ける）
      if (b.mdP && (p.lagT || 0) > S.t && !p.gk) return false;   /* 版448 翠の起点：食いついて置き去りにされた相手の足は届かない */
      if (b.aoP && S.t - (b.passT ?? -9) < 0.25 && !p.gk) { const vl = hyp(b.vx, b.vy) || 1, rx = p.x - b.x, ry = p.y - b.y; if ((rx * b.vx + ry * b.vy) / vl < 0.3) return false; }   // 蒼の王座の1本：蹴った瞬間、背中・横で押さえていた相手の足は届かない（出す方向の前にいる相手は触れる）
      if ((b.tsukiP || b.tact) && b.z < 0.6 && hyp(b.vx, b.vy) < 7.5) return true;   // 勢いが落ちて足もとに転がってきた球は、相手もふつうに触れる（目の前の球を見送ることはない）
      if (b.tsukiP) return p.idx === b.tsukiDef || (p.gk && p.gkAtk);
      if (b.tact) return p.idx === b.tactDef || (p.gk && p.gkAtk);   // 港の指揮者の1本も、決まった相手しか触れない
      if (byLock(b)) return p.gk && fx(p.team, b.x) < 5.5;   // 白夜の視界：裏への1本は、受け手が触るまで相手は触れない（GKもゴールエリアの外では触れない）   // 落ちた球も、受け手が先に着けば相手は触れない   // 白夜の視界：空中の球には、相手の頭は届かない（落ちてきた所は、ふつうに競る）
      if (b.hari && !(b.z < 0.6 && hyp(b.vx, b.vy) < 1.2)) return p.gk && fx(p.team, b.x) < 5.5;   // GKもゴールエリアの中に来るまでは触れない   // 針の穴通し：すき間を抜ける1本には、相手の足が届かない（勢いが落ちるまで）
      return true;
    }
    function teamPas(tm) { tm.pas = new Set(tm.players.filter((m) => m.pasK && !m.off).map((m) => m.pasK)); }

    // ---------- 補助 ----------
    const ownerP = () => (S.ball.owner >= 0 ? P[S.ball.owner] : null);
    const mates = (p) => T[p.team].players;
    const opps = (p) => T[1 - p.team].players;
    function maxSpeed(p) {
      const st = 0.7 + 0.3 * (p.cur / 100);
      return (4.4 + p.speed * 0.047) * st * ((T[p.team].capBuff || 0) > S.t ? 1.04 : 1) * ((p.recUntil || 0) > S.t ? 1.1 : 1) * ((p.ovUntil || 0) > S.t ? 1.06 : 1) * ((p.ctRun || 0) > S.t ? 1.07 : 1) * (p.stun > 0 ? 0.45 : 1) * ((p.mtSlow || 0) > S.t ? 0.8 : 1) * (p.uniq && p.uOn > S.t ? uSpd(p) : 1) * (p.mtCharge && p.uOn > S.t ? 1.15 : 1) * ((p.mtHeld || 0) > S.t ? 0.25 : 1) * ((p.kgPin || 0) > S.t ? 0.08 : 1) * ((p.kgSlow || 0) > S.t ? 0.65 : 1) * ((p.hariT || 0) > S.t ? 1.22 : 1) * ((p.byT || 0) > S.t ? (p.byLv >= 2 ? 1.12 : 1.06) : 1) * ((p.byRunT || 0) > S.t ? (p.byRunLv >= 2 ? 1.2 : 1.15) : 1) * ((p.uzT || 0) > S.t ? 1.15 : 1) * ((p.aoFast || 0) > S.t || (p.aoKeepFast && S.ball.owner === p.idx) ? 1.15 : 1) * ((p.aoShield || 0) > S.t ? 0.3 : 1) * (S.lcStep && S.lcStep.mode === 'up' && S.lcStep.team === p.team && S.lcStep.until > S.t && p.position === 'DF' ? (S.lcStep.trap ? 1.55 : 1.2) : 1);   // オフサイドトラップ：一斉に鋭く押し上げる   // S（90台）は約8.7m/s、E（40台）は約6.4m/s
    }
    // 固有スキルが出ている間の速さ
    // 紫電の遊戯：運ぶ向きは縦が基本（横にも行くが、後ろへは戻らない）。ゴール前20m以内では、シュートコースを開けるための切り返し（後ろ向き）もあり
    function sdFwd(p, dx, dy) {
      const gx = fx(p.team, L) - p.x, gy = GOAL_Y - p.y, gl = hyp(gx, gy) || 1, dl = hyp(dx, dy) || 1; let ux = dx / dl, uy = dy / dl;
      if (gl < 20 && opps(p).some((o) => !o.gk && hyp(o.x - p.x, o.y - p.y) < 3 && (o.x - p.x) * gx + (o.y - p.y) * gy > 0)) return [ux, uy];   // ゴール前20m以内で、前をふさがれている時だけ切り返し（後ろ向き）もあり
      const fwd = (ux * gx + uy * gy) / gl;
      if (fwd < 0.4) { const k = (0.4 - fwd) * 1.6; ux += gx / gl * k; uy += gy / gl * k; const l = hyp(ux, uy) || 1; ux /= l; uy /= l; }
      return [ux, uy];
    }
    let ksC = [-1, 0, 0]; function ksTeam(ti) { if (ksC[0] !== S.t) ksC = [S.t, +T[0].players.some((m) => m.uniq === 'kinshachi' && !m.off && m.slot), +T[1].players.some((m) => m.uniq === 'kinshachi' && !m.off && m.slot)]; return ksC[1 + ti]; }
    function uSpd(p) {
      const m = { tsukikage: 1.15, uzushio: 1.18, kinshachi: 1.25, miyabi: 1.38, sutemi: 1.35, matsuri: 1.3, kagenui: 1.25, shiden: 1.08, kage: p.uniqLv >= 2 ? 1.28 : 1.2, midori: p.mdT0 != null && !p.mdGo ? 0.55 : 1, tetsurou: p.uniqLv >= 2 ? 1.35 : 1.28 }[p.uniq];
      return m ? 1 + (m - 1) * uP(p) : 1;
    }
    // 相手の後ろから2人目（前向き座標、ハーフウェーより手前にはならない）
    function mainShadow(team) {   /* 版445：FWのそばに残るシャドーはチームに1人だけ（固有スキル持ち＞足の速い順）。ほかのシャドーはふだんどおり守備にも戻る */
    let bs = -1e9, bp = null; for (const m of T[team].players) { if (m.off || m.type !== 'シャドー' || m.position !== 'MF') continue; const v = (m.uniq ? 1000 : 0) + (m.speed || 0) + (m.dash || 0) * 0.5; if (v > bs) { bs = v; bp = m; } } return bp; }
  function aceFw(team, ex) {   /* 版444：チームの点取り屋＝FWのうち、紅蓮の牙 > ストライカー > 決定力（キック）の高い順 */
    let bs = -1e9, bp = null; for (const m of T[team].players) { if (m.off || m.gk || m.position !== 'FW' || m === ex) continue; const v = (m.uniq === 'guren' ? 1000 : 0) + (m.type === 'ストライカー' ? 100 : 0) + (m.kick || 0); if (v > bs) { bs = v; bp = m; } } return bp; }
  function offsideLine(ti) {
      const xs = T[1 - ti].players.filter((q) => !q.off).map((q) => fx(ti, q.x)).sort((a, b) => b - a);   /* v749：退場した選手は数えない */
      return Math.max(xs[1], L / 2, fx(ti, S.ball.x));
    }
    // 攻める側が「見ている」オフサイドライン。相手にラインコントローラーがいると、
    // 一斉の押し上げに気づくのが遅れる（＝オフサイドトラップにかかる）。いなければ本当のラインと同じ
    function seenOffLine(ti) {
      const real = offsideLine(ti);
      if (!T[1 - ti].players.some((m) => m.type === 'ラインコントローラー')) return real;
      S.offSeen = S.offSeen || [null, null]; S.offSeenT = S.offSeenT || [-1, -1];
      if (S.offSeenT[ti] !== S.t) {
        const prev = S.offSeen[ti] ?? real;
        S.offSeen[ti] = real < prev ? real : Math.min(real, prev + DT * (teamU(1 - ti, 'sakurajima') ? 0.5 : 1.6));   // 桜島の号令：一斉の押し上げに、なかなか気づけない   // 下がるのはすぐ分かる、上がるのは遅れて気づく
        S.offSeenT[ti] = S.t;
      }
      return Math.max(S.offSeen[ti], fx(ti, S.ball.x), L / 2);   /* 版447：ボールの位置はいつも見えている（ボールより後ろならオフサイドにならない） */
    }
    function nearestOpp(p, x, y) {
      let best = null, bd = 1e9;
      for (const q of opps(p)) { const d = hyp(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
      return { q: best, d: bd };
    }
    function segDist(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const u = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
      return { d: hyp(ax + dx * u - px, ay + dy * u - py), u };
    }

    // ---------- 配置 ----------
    function lineX(team, attacking) {
      const lh = clamp(team.line_height + team.mods.line + (team.urg ? 1.5 : 0) + (teamU(team.ti, 'sakurajima') ? 1.3 : 0) + (team.pas && team.pas.has('backCover') ? 0.35 * Math.max(...team.players.map((m) => (m.pasK === 'backCover' ? (m.passive >= 2 ? 1.6 : 1) : 0))) : 0), 1, 5);   // 桜島の号令：ラインが一斉に上がる／背後の安心：少し高く保てる
      const base = [0, 13, 19, 25, 31, 37][Math.floor(lh)] + (lh % 1) * 6;
      const bx = fx(team.ti, S.ball.x);
      if (attacking) return clamp(base + 8 + (bx - 40) * 0.5, 14, 60);
      return clamp(Math.min(base + (bx - 52) * 0.45, bx - 4), 6, 48);
    }

    // キックオフ：蹴る2人以外は、センターサークル（半径9.15m）の外で待つ
    function koOut(xf, y) { const R0 = 9.8, dy = y - W / 2; if (Math.abs(dy) < R0 && hyp(L / 2 - xf, dy) < R0) xf = Math.min(xf, L / 2 - Math.sqrt(R0 * R0 - dy * dy)); return xf; }
    function kickoffSpot(p, kickTeam) {
      // 前向き座標で返す
      if (p.gk) return [3, GOAL_Y];
      const fwd = T[p.team].players.filter((q) => q.slot.last);
      if (p.team === kickTeam && fwd[0] === p) return [L / 2 - 0.6, W / 2];
      if (p.team === kickTeam && fwd[1] === p) return [50.5, W / 2 + 6];
      return [koOut(Math.min(18 + p.slot.rel * 0.95, 49.5), p.slot.y), p.slot.y];
    }
    function kickoffPositions(kickTeam) {
      for (const tm of T) {
        for (const p of tm.players) {
          const xf = p.gk ? 3 : koOut(Math.min(18 + p.slot.rel * 0.95, 49.5), p.slot.y);
          p.x = fx(tm.ti, xf);
          p.y = p.slot.y;
          p.vx = p.vy = 0; p.run = 0; p.touchCd = 0; p.tackleCd = 0; p.stun = 0;
        }
      }
      const k = T[kickTeam].players.filter((p) => p.slot.last);
      const taker = k[0] || T[kickTeam].players[9] || T[kickTeam].players.filter((p) => !p.gk).sort((a, c) => (c.slot.rel || 0) - (a.slot.rel || 0))[0] || T[kickTeam].players[0];   // 退場で人数が減っていても、必ずだれかがキックオフする
      taker.x = L / 2 - sgn(kickTeam) * 0.6; taker.y = W / 2;
      if (k[1]) { k[1].x = fx(kickTeam, 50.5); k[1].y = W / 2 + 6; }
      Object.assign(S.ball, { x: L / 2, y: W / 2, z: 0, vx: 0, vy: 0, vz: 0, owner: taker.idx, kind: 'owned', lastTeam: kickTeam, lastPlayer: taker.idx, intended: -1, offside: false });
      S.poss = kickTeam;
      S.restart = null; S.celebrate = 0;
      S.decision = 0.6;
      S.dribbleDir = null;
    }

    // ---------- 目標地点 ----------
    const targets = new Array(22);
    const urgent = new Array(22);

    const cornerSpots = {};
    // ---- 版465：フリーキックの立ち位置（攻める側・守る側とも、決まった形に並ぶ）----
    const fkSpots = {};
    function planFK(r) {
      for (const k in fkSpots) delete fkSpots[k];
      const att = r.team, def = 1 - att, xf = fx(att, r.x), wallSet = new Set((r.wall || []).map((w) => w.idx));
      const lineOf = (p) => p.slot && p.slot.line != null ? p.slot.line : 1;
      const atk = T[att].players.filter((p) => !p.gk && !p.off && p.idx !== r.taker).sort((a, c) => lineOf(c) - lineOf(a));   // 前の選手から
      const dfs = T[def].players.filter((p) => !p.gk && !p.off && !wallSet.has(p.idx));
      const W2 = (x, y) => [fx(att, x), clamp(y, 1, W - 1)];
      if (xf > L - 36) {
        // 敵陣の深い所：ゴール前に人数をかける（壁があれば直接のこぼれ球に備えて、なければクロスに合わせて）。後ろには2人残す
        const nBack = Math.min(2, Math.max(0, atk.length - 4)), front = atk.slice(0, atk.length - nBack), back = atk.slice(atk.length - nBack);
        const near = r.y < GOAL_Y ? -1 : 1;   // ボールのある側
        const box = r.wall
          ? [[L - 10.6, -6.5], [L - 10.6, 6.5], [L - 10.2, -2], [L - 10.2, 2.5], [L - 17, near * -9], [L - 19, near * 6]]
          : [[L - 10.5, near * 3], [L - 10.8, -1], [L - 11, near * -5], [L - 10.6, near * -8.5], [L - 13.5, near * 1.5], [L - 18, near * -4]];
        front.forEach((p, k) => { const b = box[k % box.length]; fkSpots[p.idx] = W2(b[0] - (k >= box.length ? 4 : 0), GOAL_Y + b[1]); });
        // 壁の横に1人：短くつなぐ・おとりの選択肢
        if (r.wall && front.length) { const p = front[front.length - 1]; fkSpots[p.idx] = [r.x + (r.y < GOAL_Y ? 1 : -1) * 0 - sgn(att) * 1.2, clamp(r.y + (r.y < GOAL_Y ? 3 : -3), 1, W - 1)]; }
        back.forEach((p, k) => { fkSpots[p.idx] = W2(L / 2 + 2, GOAL_Y + (k ? 9 : -9)); });
        // 守る側：ゴール前の相手に1人ずつ、ゴール側にぴったりつく。最後の1人はカウンターに備えて前に残る
        const ds = dfs.slice().sort((a, c) => lineOf(a) - lineOf(c));   // 後ろの選手から
        const keepUp = ds.length > front.length + 1 ? ds.pop() : null;
        front.forEach((a, k) => { const d = ds[k]; if (!d) return; const [ax, ay] = fkSpots[a.idx]; fkSpots[d.idx] = [ax + sgn(att) * 0.9, ay + (GOAL_Y - ay) * 0.1]; });
        ds.slice(front.length).forEach((d, k) => { fkSpots[d.idx] = W2(L - 20, GOAL_Y + (k % 2 ? 7 : -7)); });   // あまった選手はペナルティエリアの前（こぼれ球）
        if (keepUp) fkSpots[keepUp.idx] = W2(L / 2 - 2, GOAL_Y + (r.y < GOAL_Y ? 8 : -8));
      } else {
        // 中盤・自陣：近くの味方2人が受けに来る（横と前）。ほかはいつもの形のまま
        const near2 = atk.slice().sort((a, c) => hyp(a.x - r.x, a.y - r.y) - hyp(c.x - r.x, c.y - r.y)).slice(0, 2);
        const inY = r.y < GOAL_Y ? 1 : -1;
        if (near2[0]) fkSpots[near2[0].idx] = [clamp(r.x - sgn(att) * 2, 1, L - 1), clamp(r.y + inY * 9, 1, W - 1)];
        if (near2[1]) fkSpots[near2[1].idx] = [clamp(r.x + sgn(att) * 12, 1, L - 1), clamp(r.y + inY * 4, 1, W - 1)];
        // ほかの味方：ボールを基準に、陣形の列（DF・MF・FW）をそろえて並ぶ。横は自分の持ち場を保ちつつボール側に少し寄る
        const AX = { 0: -16, 1: 3, 2: 17 }, cap = L - 13;
        for (const p of atk) { if (fkSpots[p.idx]) continue; const ln = clamp(lineOf(p), 0, 2), y0 = p.slot && p.slot.y != null ? p.slot.y : p.y;
          fkSpots[p.idx] = W2(clamp(xf + AX[ln], 6, cap), y0 * 0.75 + r.y * 0.25); }
        // 守る側：ボールとゴールの間に、3本の列でまとまる（DFは深く、MFはボールの少し後ろ、FWは前に残る）
        const DX = { 0: 24, 1: 12, 2: -6 }, defX = (v) => clamp(v, xf - 20, L - 6);
        for (const p of dfs) { const ln = clamp(lineOf(p), 0, 2), y0 = p.slot && p.slot.y != null ? p.slot.y : p.y;
          fkSpots[p.idx] = W2(defX(xf + DX[ln] + (ln === 0 ? Math.max(0, 70 - xf) * 0.25 : 0)), y0 * 0.65 + r.y * 0.35); }
      }
    }
    const throwHelp = [-1, -1];
    function planCorner(r) {
      for (const k in cornerSpots) delete cornerSpots[k];
      const att = r.team, def = 1 - att;
      const spots = [[L - 5.5, -2.6], [L - 6.5, 3.2], [L - 10.5, 0], [L - 8.5, -6.5], [L - 9, 6.5], [L - 13.5, -2.5], [L - 17.5, 4]];
      const atk = T[att].players.filter((p) => !p.gk && p.idx !== r.taker).sort((a, c) => (c.slot.line ?? 0) - (a.slot.line ?? 0)).slice(0, 7);
      // CKの種類（基本は3択）：ニアへ速いボール／ファーへ頭で合わせる高いボール／中間（PKスポット付近）。
      // 相手のほうが空中戦に強ければ、ショートコーナーでつなぐこともある
      const air = (q) => q.jump * 0.6 + q.physical * 0.4;
      const top4 = (arr) => arr.map(air).sort((a, c) => c - a).slice(0, 4).reduce((a, v) => a + v, 0) / 4;
      const dfAll = T[def].players.filter((p) => !p.gk && !p.off);
      const gap = top4(dfAll) - top4(atk);   // ＋なら相手のほうが空中戦に強い
      const tk0 = P[r.taker], u = R.next();
      const ckm = tk0 && tk0.sk.has('ckMaster');
      r.ck = !ckm && gap > 6 && atk.length > 2 && u < clamp(0.25 + (gap - 6) * 0.03, 0.25, 0.6) ? 'short'
        : (() => { const v = R.next(), far = 0.34 + (top4(atk) - 60) * 0.004; return v < 0.33 ? 'near' : v < 0.33 + far ? 'far' : 'mid'; })();
      // 合わせる選手：ニアは速くて動き出しのいい選手、ファー・中間は空中戦に強い選手を、その場所へ
      const nearSide = r.y < GOAL_Y ? 1 : -1;
      const spotFor = { near: [L - 7.5, -3.2], far: [L - 8.5, 6.5], mid: [L - 12.5, 0] };
      atk.forEach((p, k) => { cornerSpots[p.idx] = [fx(att, spots[k][0]), GOAL_Y + spots[k][1] * nearSide]; });
      if (r.ck === 'short') {
        // ショートコーナー：近くの味方がボールの近く（ゴールライン沿い5〜6m）へ寄ってくる
        const sq = atk.slice().sort((a, c) => (c.pass + c.technique) - (a.pass + a.technique))[0];
        r.ckTo = sq.idx; cornerSpots[sq.idx] = [fx(att, L - 5.5), clamp(r.y + nearSide * 6, 1, W - 1)];
      } else {
        const want = r.ck === 'near' ? (q) => q.speed + q.dash : (q) => air(q) + q.technique * 0.2;
        const main = atk.slice().sort((a, c) => want(c) - want(a))[0];
        const sp = spotFor[r.ck], tgt = [fx(att, sp[0]), GOAL_Y + sp[1] * nearSide];
        // その場所にいた選手と入れかえる
        const other = atk.reduce((b0, p) => (hyp(cornerSpots[p.idx][0] - tgt[0], cornerSpots[p.idx][1] - tgt[1]) < hyp(cornerSpots[b0.idx][0] - tgt[0], cornerSpots[b0.idx][1] - tgt[1]) ? p : b0), atk[0]);
        if (other !== main) cornerSpots[other.idx] = cornerSpots[main.idx];
        cornerSpots[main.idx] = tgt; r.ckTo = main.idx;
      }
      const dfs = T[def].players.filter((p) => !p.gk).sort((a, c) => (a.slot.line ?? 0) - (c.slot.line ?? 0));
      dfs.slice(0, Math.min(dfs.length - 1, atk.length + 1)).forEach((p, k) => {
        if (k < atk.length) { const [ax, ay] = cornerSpots[atk[k].idx]; cornerSpots[p.idx] = [ax + sgn(def) * -0.9, ay + (GOAL_Y - ay) * 0.12]; }
        else cornerSpots[p.idx] = [fx(att, L - 5), GOAL_Y + (r.y < GOAL_Y ? -1 : 1) * 4.5];   // ニアポスト
      });
    }
    // 版467：チームの縦の間延びを詰める（最後に、ふつうの選手の目標だけを直す）
    function shapePost() {
      if (globalThis.__noCompact || S.restart || S.celebrate > 0 || S.setPiece) return;
      const own = ownerP(); if (!own || own.gk) return;
      const t = own.team, tm = T[t], bxf = fx(t, own.x), offL = offsideLine(t);
      for (const p of tm.players) {
        if (p.off || p.gk || p === own || !targets[p.idx] || urgent[p.idx]) continue;
        if ((p.run || 0) > 0 || p.uniq || (S.ball.intended === p.idx)) continue;
        const tx = fx(t, targets[p.idx][0]); let nx = tx;
        if (p.position === 'MF' && p.type !== 'アンカー' && p.type !== 'レジスタ' && bxf > 34 && !globalThis.__noMfPush) nx = Math.max(tx, Math.min(bxf - 11, offL - 3));
        if (p.position === 'FW' && p.type !== 'ストライカー' && p.type !== '偽9番' && bxf < 38 && !globalThis.__noFwDrop) nx = Math.min(tx, bxf + 26);
        if (nx !== tx) { targets[p.idx] = [fx(t, nx), targets[p.idx][1]]; }
      }
    }
    function mdPost() {   /* 版448 翠の起点：食いついた相手は前から寄せ、相手のDFライン・中盤は前のめりに押し上げる */
      const own = ownerP();
      for (const ti of [0, 1]) { const pu = T[ti].mdPush; if (!pu) continue; const m = P[pu.by];
        if (S.t > pu.until || !m || m.off || S.poss !== m.team || (own && own.team !== m.team) || m.mdT0 == null) { T[ti].mdPush = null; for (const o of T[ti].players) if (o.mdLure) { o.mdLure = null; act(o, 'upoff', 0.1); } continue; }
        const bf = fx(ti, S.ball.x);
        for (const o of T[ti].players) { if (o.off || o.gk || !targets[o.idx]) continue;
          if (o.mdLure && o.mdLure.until > S.t) { targets[o.idx] = [m.x + sgn(m.team) * 1.1 + m.vx * 0.2, m.y + (o.y - m.y) * 0.2]; urgent[o.idx] = true; continue; }
          if (o.position === 'DF' || o.position === 'MF') { const tf = fx(ti, targets[o.idx][0]), nf = Math.min(tf + pu.amt * Math.min(1, (S.t - (pu.until - 3.3)) / 0.8), bf - 7); if (nf > tf) { targets[o.idx] = [fx(ti, nf), targets[o.idx][1]]; urgent[o.idx] = true; } } } }
    }
    function computeTargets() {
      computeTargetsMain();
      const r = S.restart;
      // 固有スキルで動きが変わる選手：影からの一撃（ゴール前へ飛び込む）・雅の後始末／捨て身の守護神（ボールへ一直線）・釣り出されたDF
      if (!r && !(S.celebrate > 0)) {
        const own = ownerP(), b = S.ball;
        for (const p of P) {
          if (p.off) continue;
          if (p.uPull && (S.poss === p.team || p.uPull.until <= S.t)) { act(p, 'upoff', 0.1); p.uPull = null; }   // ボールを奪い返した・終わった：釣られる・引っぱられるのをやめる（線も消す）
          if (p.uPull && p.uPull.until > S.t && S.poss !== p.team && P[p.uPull.to] && !P[p.uPull.to].off) { const m = P[p.uPull.to]; targets[p.idx] = [m.x - sgn(m.team) * 1.0, m.y + (GOAL_Y - m.y) * 0.1]; urgent[p.idx] = true; p.trackRun = null; p.coverRun = null; if (globalThis.__upLog) globalThis.__upLog.push([+S.t.toFixed(1), p.idx, +p.x.toFixed(0), +p.y.toFixed(0), +targets[p.idx][0].toFixed(0), +targets[p.idx][1].toFixed(0)]); continue; }   // 釣られた・引っぱられたDFは、ほかの仕事より先に、本人について行く
          if (!globalThis.__noPk && p.uniq === 'kage' && !p.off && S.poss === p.team && own && own.team === p.team && own !== p && fx(p.team, own.x) > 28 && !(b.kind === 'pass' && b.intended === p.idx) && !(p.otRun && S.t < p.otRun.until && p.run > 0)) {   // シャドー（かめい）：FWのすぐ後ろ、相手のDFラインとMFの間の空いた所（ポケット）で受ける
            if (!p.kmPk || S.t >= (p.kmPkT || 0)) { p.kmPkT = S.t + 0.3; const olP = offsideLine(p.team), fw = aceFw(p.team, p) || mates(p).find((m) => m !== p && !m.off && m.position === 'FW'), fwX = fw ? fx(p.team, fw.x + fw.vx * 0.6) : olP - 2, fwY = fw ? fw.y + fw.vy * 0.6 : GOAL_Y; let bs = -1e9, bp = null;   /* 版444：相棒のFW（点取り屋）のすぐ後ろ・斜め後ろ（4〜8m）に立つ */
              for (const dx of [-4, -6, -8]) for (const dy of [-6, -3, 0, 3, 6]) { const ax = Math.min(fwX + dx, olP - 2.5, L - 14), ay = clamp(fwY + dy + (GOAL_Y - fwY) * 0.25, 6, W - 6), wx = fx(p.team, ax); let m = 9, lc = 9; for (const o of opps(p)) { if (o.off || o.gk) continue; m = Math.min(m, hyp(o.x - wx, o.y - ay)); const sd = segDist(o.x, o.y, own.x, own.y, wx, ay); if (sd.u > 0.08 && sd.u < 0.95) lc = Math.min(lc, sd.d); }
                const v = Math.min(m, 7) + Math.min(lc, 4) * 0.8 - Math.abs(dy) * 0.08 - Math.max(0, hyp(fwX - ax, fwY - ay) - 6) * 0.5 - hyp(fx(p.team, p.x) - ax, p.y - ay) * 0.04; if (v > bs) { bs = v; bp = [wx, ay]; } }
              p.kmPk = bp; }
            if (globalThis.__pkLog && p.kmPk) { const fw0 = aceFw(p.team, p); globalThis.__pkLog.push([hyp(p.x - p.kmPk[0], p.y - p.kmPk[1]), hyp(p.vx, p.vy), p.stamina, fx(p.team, p.kmPk[0]) - fx(p.team, p.x), fw0 ? hyp(fw0.x - p.kmPk[0], fw0.y - p.kmPk[1]) : -1, fw0 ? hyp(fw0.x - p.x, fw0.y - p.y) : -1]); }
            if (p.kmPk) { targets[p.idx] = p.kmPk; urgent[p.idx] = hyp(p.kmPk[0] - p.x, p.kmPk[1] - p.y) > 3; continue; } }
          if (uOn(p, 'tetsurou') && S.poss !== p.team && !p.gk) {   // 鉄狼の関所：持っている相手へ一直線に寄せる／真ん中を通そうとしたパスの通り道へ
            let tg = null; if (own && own.team !== p.team) { const gx0 = fx(p.team, 0), ex = own.x + own.vx * 0.3, ey = own.y + own.vy * 0.3, gl = hyp(gx0 - ex, GOAL_Y - ey) || 1; tg = [ex + (gx0 - ex) / gl * 0.9, ey + (GOAL_Y - ey) / gl * 0.9]; }   // 相手とゴールの間に入って、正面から
            else if (b.kind === 'pass' && b.intended >= 0 && P[b.intended].team !== p.team) { const q = P[b.intended], sd = segDist(p.x, p.y, b.x, b.y, q.x, q.y), u = clamp(sd.u + 0.1, 0, 1); tg = [b.x + (q.x - b.x) * u, b.y + (q.y - b.y) * u]; }
            else tg = [b.x, b.y];
            targets[p.idx] = tg; urgent[p.idx] = true; chasing[p.idx] = 1; continue; }
          if (uOn(p, 'kagenui') && p.kgT && own && own.team !== p.team && own.idx !== p.kgT && fx(p.team, P[p.kgT].x) < 50 && !(fx(p.team, own.x) < 19 && Math.abs(own.y - GOAL_Y) < 22 && !T[p.team].players.some((m) => m !== p && !m.off && !m.gk && hyp(m.x - own.x, m.y - own.y) < hyp(p.x - own.x, p.y - own.y)))) {   // ペナルティエリア付近でボールホルダーに一番近いなら、マークより先に寄せる   // 影縫い：相手とゴールの間に入り、影のように張りつく（少しボール側へ寄ってパスの通り道もふさぐ）
            const q = P[p.kgT], bx = b.owner >= 0 ? own.x : b.x, by = b.owner >= 0 ? own.y : b.y, ql = hyp(bx - q.x, by - q.y) || 1, gx0 = fx(p.team, 0), gl = hyp(gx0 - q.x, GOAL_Y - q.y) || 1;
            const ux = (bx - q.x) / ql * 0.35 + (gx0 - q.x) / gl * 1.0, uy = (by - q.y) / ql * 0.35 + (GOAL_Y - q.y) / gl * 1.0, ul = hyp(ux, uy) || 1;   // いつも相手とゴールの間（ゴール側）をキープ。少しだけボール側へ寄って、パスの通り道も消す
            const behind = fx(p.team, p.x) > fx(p.team, q.x) - 0.3, dd = behind ? 2.4 : 1.2;   // 背中側にいたら、まずゴール側へ回り込む
            targets[p.idx] = [q.x + q.vx * 0.35 + ux / ul * dd, q.y + q.vy * 0.35 + uy / ul * dd]; urgent[p.idx] = true; chasing[p.idx] = 0; continue; }
          if ((uOn(p, 'matsuri') || (p.mtHunt || 0) > S.t) && own && own.team !== p.team && !own.gk && hyp(own.x - p.x, own.y - p.y) < 9) {   // 祭り太鼓の壁：向き合った相手へ、ゴール側から一気に体を寄せる
            if (p.mtGrip && p.mtGrip.o === own.idx) { const cx = p.x - own.x, cy = p.y - own.y, cl = hyp(cx, cy) || 1; targets[p.idx] = [own.x + cx / cl * 0.55, own.y + cy / cl * 0.55]; urgent[p.idx] = true; chasing[p.idx] = 0; continue; }   // 押し合い中：体を密着させて押し込む
            const gx0 = fx(p.team, 0), dl = hyp(gx0 - own.x, GOAL_Y - own.y) || 1; targets[p.idx] = [own.x + own.vx * 0.3 + (gx0 - own.x) / dl * 0.7, own.y + own.vy * 0.3 + (GOAL_Y - own.y) / dl * 0.7]; urgent[p.idx] = true; chasing[p.idx] = 0; continue; }
          if (p.uniq === 'miyabi' && (uOn(p, 'miyabi') || p.mybStay)) {
            const bb = S.ball, mine = (own && own.team === p.team) || (!own && bb.lastTeam === p.team && bb.kind !== 'loose') || S.restart || S.setPiece;
            if (mine) { if (uOn(p, 'miyabi')) p.uOn = S.t; p.mybStay = false; }   // 味方ボールになったら、その場で終わる（攻撃の時には出ない）
          }
          if (uOn(p, 'miyabi')) { p.mybStay = true; const r0 = miyabiTarget(p); if (r0 && r0.idx !== p.miyabiR) { p.miyabiR = r0.idx; act(p, 'myb', p.uOn - S.t, { r: p.miyabiR }); } }   // 今ボールを持つ（受ける）相手へ切り替える
          if (p.mybStay && !uOn(p, 'miyabi')) { const r0 = own && own.team !== p.team ? own : null; if (r0 ? (hyp(r0.x - p.x, r0.y - p.y) > 16 || fx(p.team, r0.x) > 40) : hyp(S.ball.x - p.x, S.ball.y - p.y) > 16) p.mybStay = false; else if (r0) p.miyabiR = r0.idx; }   // スキルが切れても、目の前の相手が攻めてくる間は守り続ける（埋めたスペースを空けない）
          if ((uOn(p, 'miyabi') || p.mybStay) && p.miyabiR >= 0 && P[p.miyabiR] && !P[p.miyabiR].off) {   // 雅の後始末：ボールを奪いに行く（スペースではなく、ボールへ）。取り切るまで
            const r = P[p.miyabiR], bb = S.ball, gx0 = fx(p.team, 0);
            if (own === r) { const dmr = hyp(p.x - r.x, p.y - r.y), lt = Math.min(0.9, dmr / Math.max(4, maxSpeed(p) * 1.38)), ax = r.x + r.vx * lt, ay = r.y + r.vy * lt, dl = hyp(gx0 - ax, GOAL_Y - ay) || 1;
              targets[p.idx] = [ax + (gx0 - ax) / dl * 0.6, ay + (GOAL_Y - ay) / dl * 0.6]; }   // 持っている相手へ、行く先を読んで最短で詰める（ゴール側から）
            else targets[p.idx] = p._cx != null && p._ct < 99 ? [p._cx, p._cy] : [bb.x + bb.vx * 0.4, bb.y + bb.vy * 0.4];   // 足から離れた球・パス：ボールそのものを奪いに行く
            urgent[p.idx] = true; chasing[p.idx] = 1; continue; }
          const trapNow = S.lcStep && S.lcStep.trap && S.lcStep.team === p.team && S.lcStep.until > S.t;   // 桜島の号令の最中は、全員がラインを上げる（ついていかない）
          if (trapNow) { p.trackRun = null; p.coverRun = null; }
          if (p.trackRun && p.trackRun.until > S.t && S.poss !== p.team) { const r = P[p.trackRun.r]; if (r && !r.off) { const gx0 = fx(p.team, 0); targets[p.idx] = [r.x + r.vx * 0.45 + (gx0 - r.x) * 0.06, r.y + r.vy * 0.45 + (GOAL_Y - r.y) * 0.08]; urgent[p.idx] = true; continue; } }   // マークの受け渡し：走り出した相手に、ゴール側からついていく
          if (p.trackRun && (S.poss === p.team || p.trackRun.until <= S.t)) p.trackRun = null;
          if (p.coverRun && p.coverRun.until > S.t && S.poss !== p.team) { const r = P[p.coverRun.r]; if (r && !r.off) { const gx0 = fx(p.team, 0), k = 0.35; targets[p.idx] = [r.x + r.vx * 0.6 + (gx0 - r.x) * k, r.y + (GOAL_Y - r.y) * 0.3]; { const gk = T[p.team].players.find((m) => m.gk && !m.off), f0 = fx(p.team, targets[p.idx][0]), fmin = Math.max(gk ? fx(p.team, gk.x) + 2.5 : 0, 5); if (f0 < fmin) targets[p.idx][0] = fx(p.team, fmin); }   /* 版733：先回りのカバーも、GKより後ろへは行かない */ urgent[p.idx] = true; continue; } }   // スイーパー：裏のスペースの後ろへ先回り
          if (p.coverRun && (S.poss === p.team || p.coverRun.until <= S.t)) p.coverRun = null;
          if (p.tact && p.tact.until > S.t && S.poss === p.team && own && own !== p && !(b.kind === 'pass' && b.intended === p.idx)) { targets[p.idx] = [p.tact.x, p.tact.y]; urgent[p.idx] = true; continue; }   // 港の指揮者：合図で走り出す
          if (p.tact && (S.poss !== p.team || p.tact.until <= S.t)) p.tact = null;
          // 渦潮の囮で呼ばれた仲間：ボールを持った味方を追い越して、空く真ん中（ペナルティエリアの入口）へ全力で駆け上がる（オフサイドにならない所まで）
          if ((p.uzT || 0) > S.t && S.poss === p.team && own && own !== p && !p.gk && teamU(p.team, 'uzushio') && !(b.kind === 'pass' && b.intended === p.idx)) { const olU = offsideLine(p.team), tf = Math.min(olU - 1, Math.max(fx(p.team, own.x) + 14, fx(p.team, p.x) + 6), L - 12);
            targets[p.idx] = [fx(p.team, tf), clamp(GOAL_Y + (p.uzSide || 1) * 6, 6, W - 6)]; urgent[p.idx] = true; continue; }
          // 組み立て：自陣で味方が持っている時、真ん中のMF（2人）は持っている味方の近くに顔を出して、パスコースを作る（はたいたら、また受けに行く）
          if (!p.gk && p.position === 'MF' && p.slot && Math.abs(p.slot.y - GOAL_Y) < 18 && S.poss === p.team && own && own.team === p.team && own !== p && !(b.kind === 'pass' && b.intended === p.idx) && fx(p.team, own.x) < 50 && !(uOn(p, 'kinshachi') && p.ksMode === 'atk') && !(p.otRun && S.t < p.otRun.until && p.run > 0) && !((p.byRunT || 0) > S.t)) {
            if (!p.showSpot || S.t > (p.showT || 0) || p.showOwn !== own.idx) { const sg = sgn(p.team), ofx = fx(p.team, own.x), olS = offsideLine(p.team); let best = null, bs = -1e9;
              for (const r of [9, 13, 17]) for (const ag of [-75, -45, -20, 0, 20, 45, 75]) { const a = ag * Math.PI / 180, sx = own.x + sg * Math.cos(a) * r, sy = clamp(own.y + Math.sin(a) * r, 4, W - 4), sf = fx(p.team, sx); if (sf > olS - 1 || sf < 4) continue;
                let sp = 8; for (const o of opps(p)) { if (o.off) continue; sp = Math.min(sp, hyp(o.x - sx, o.y - sy)); }
                let lane = 4; for (const o of opps(p)) { if (o.off) continue; const sd = segDist(o.x, o.y, own.x, own.y, sx, sy); if (sd.u > 0.08 && sd.u < 0.95) lane = Math.min(lane, sd.d); }
                let mt = 9; for (const m of mates(p)) if (m !== p && m !== own && !m.off) mt = Math.min(mt, hyp(m.x - sx, m.y - sy));
                const v = Math.min(sp, 7) * 0.8 + Math.min(lane, 3) * 1.2 + Math.min(mt, 8) * 0.35 + (sf - ofx) * 0.05 - Math.abs(sy - p.slot.y) * 0.04 - hyp(sx - p.x, sy - p.y) * 0.06; if (v > bs) { bs = v; best = [sx, sy]; } }
              p.showSpot = best; p.showT = S.t + 0.6; p.showOwn = own.idx; }
            if (globalThis.__showCnt) globalThis.__showCnt[p.name] = (globalThis.__showCnt[p.name] || 0) + 1;
            if (p.showSpot) { targets[p.idx] = p.showSpot; urgent[p.idx] = hyp(p.showSpot[0] - p.x, p.showSpot[1] - p.y) > 3; continue; } }
          if ((p.uniq === 'uzushio' || p.uniq === 'aonoouza') && p.uOn > S.t && S.poss != null && S.poss >= 0 && S.poss !== p.team) { p.uOn = S.t; act(p, 'uend', 0.1, { k: p.uniq }); if (p.uniq === 'aonoouza') act(p, 'aopostend', 0.1); for (const m of mates(p)) { m.uzT = 0; if ((m.aoRun || 0) > S.t) { m.aoRun = 0; m.otRun = null; m.run = 0; } } }   // ボールを奪われたら、囮・釣り出しは終わり
          // 渦潮の囮（てらだ）：ボールと逆のサイドの、コーナーフラッグの方へ全力で走り抜ける。相手DF2人がついて行ってしまい、真ん中が空く
          if (uOn(p, 'uzushio') && p.uzTo && S.t >= (p.uzGo || 0) && S.poss === p.team && own && own !== p && !(b.kind === 'pass' && b.intended === p.idx)) { targets[p.idx] = p.uzTo; urgent[p.idx] = true; continue; }   /* 仲間が駆け上がり始めてから、0.5秒遅れて走り抜ける */
          // 渦潮の囮で空いたDFラインの手前（バイタルエリア）へ、2列目の味方が入ってきて受ける
          if ((p.uzT || 0) > S.t && S.poss === p.team && own && own !== p && !p.gk && teamU(p.team, 'uzushio') && !(b.kind === 'pass' && b.intended === p.idx)) {
            if (!p.uzSpot || S.t > (p.uzSpotT || 0)) { const olU = offsideLine(p.team); let best = null, bs = -1e9;
              for (const dx of [-8, -4, -1]) for (const dy of [-8, -4, 0, 4, 8]) { const sxF = Math.min(olU + dx, L - 12), sy = clamp(GOAL_Y + p.uzSide * 5 + dy, 6, W - 6), sx = fx(p.team, sxF);
                let sp = 9; for (const o of opps(p)) if (!o.off && !o.gk) sp = Math.min(sp, hyp(o.x - sx, o.y - sy)); let lane = 5; for (const o of opps(p)) { if (o.off) continue; const sd = segDist(o.x, o.y, own.x, own.y, sx, sy); if (sd.u > 0.08 && sd.u < 0.95) lane = Math.min(lane, sd.d); }
                let mt = 9; for (const m of mates(p)) if (m !== p && !m.off) mt = Math.min(mt, hyp(m.x - sx, m.y - sy));
                const v = Math.min(sp, 8) * 0.7 + Math.min(lane, 4) * 0.9 + Math.min(mt, 7) * 0.3 - hyp(sx - p.x, sy - p.y) * 0.03; if (v > bs) { bs = v; best = [sx, sy]; } }
              p.uzSpot = best; p.uzSpotT = S.t + 0.6; }
            if (p.uzSpot) { targets[p.idx] = p.uzSpot; urgent[p.idx] = true; continue; } }
          // 蒼の王座（くもい）：いつもは最前線で、相手の真ん中のCBに張りつく（オフサイドにならない所）。縦パスが来たら、そこから落ちてきて受ける
          if ((p.aoDrop || 0) > S.t && p.aoDropTo && !own && (b.kind === 'pass' || b.kind === 'loose') && b.intended === p.idx) { const mt = tsukiMeet(p); targets[p.idx] = mt && mt.t < 3 ? [mt.x, mt.y] : [b.x + b.vx * 0.3, b.y + b.vy * 0.3]; urgent[p.idx] = true; continue; }   /* ボールと合う所へ（置き去りにしない） */   // 縦パスに向かって、DFとMFの間へ落ちてくる（CBがついてくる）
          if (p.uniq === 'aonoouza' && !p.off && S.poss === p.team && (!own || own !== p) && !(b.kind === 'pass' && b.intended === p.idx) && !(p.otRun && S.t < p.otRun.until && p.run > 0)) {
            const olA = offsideLine(p.team); let cb = null, cd = 99; for (const o of opps(p)) { if (o.gk || o.off || o.position !== 'DF') continue; const v = Math.abs(o.y - GOAL_Y) + Math.abs(fx(p.team, o.x) - olA) * 0.5; if (v < cd) { cd = v; cb = o; } }
            const oy = own ? own.y : b.y, cy = cb ? clamp(cb.y + (oy > cb.y ? 1.2 : -1.2), 8, W - 8) : GOAL_Y; targets[p.idx] = [fx(p.team, Math.min(olA - 1.0, L - 12)), cy]; urgent[p.idx] = hyp(fx(p.team, olA - 1) - p.x, cy - p.y) > 6; continue; }
          if (p.uniq === 'kinshachi' && !p.off && S.poss !== p.team && own && own.team !== p.team && !own.gk && fx(p.team, own.x) < 34 && hyp(own.x - p.x, own.y - p.y) < 16) {   // 金鯱の心臓：ゴール前（シュートを打たれる所）では、ボールを持った相手にガツガツ厳しく寄せる（ゴール側から体を寄せて、打たせない）
            const gx0 = fx(p.team, 0), dl = hyp(gx0 - own.x, GOAL_Y - own.y) || 1; targets[p.idx] = [own.x + own.vx * 0.25 + (gx0 - own.x) / dl * 0.7, own.y + own.vy * 0.25 + (GOAL_Y - own.y) / dl * 0.7]; urgent[p.idx] = true; continue; }
          if (uOn(p, 'kinshachi') && !p.gk) {   // 金鯱の心臓：攻守にわたって全体を整える走り
            const gx0 = fx(p.team, 0);
            if (!globalThis.__ksNoDef && p.ksMode === 'def' && S.poss !== p.team && !(own && own.gk)) {   /* 相手GKがキャッチしたら、追わずに自分の位置へ戻る */   // 守り：ボールには行かない。空いたスペース・フリーの相手を埋めて、守備のバランスを整える
              const bb = S.ball; if (!own && bb.z < 1.5 && hyp(bb.x - p.x, bb.y - p.y) < 12 && !(bb.kind === 'pass' && bb.lastTeam !== p.team && P[bb.intended] && hyp(P[bb.intended].x - bb.x, P[bb.intended].y - bb.y) < hyp(p.x - bb.x, p.y - bb.y) - 2)) { targets[p.idx] = [bb.x + bb.vx * 0.35, bb.y + bb.vy * 0.35]; urgent[p.idx] = true; continue; }   // こぼれ球・浮いた球：近ければ真っ先に拾いに行く（奪い返し）
              if (fx(p.team, p.x) > fx(p.team, bb.x) - 3) { const bx = fx(p.team, bb.x), tx0 = Math.max(4, bx - 9), ty0 = bb.y + (GOAL_Y - bb.y) * 0.45; targets[p.idx] = [fx(p.team, tx0), ty0]; urgent[p.idx] = true; continue; }   // ボールより前にいる：まずボールとゴールの間へ全力で戻る
              let best = null, bs = -1e9;
              for (const o of opps(p)) { if (o.gk || o.off || o === own) continue; if (fx(p.team, o.x) > 42 || hyp(o.x - p.x, o.y - p.y) > 25 || (globalThis.__ksNoMark)) continue;   // 自陣のゴール前（42m以内）にいる、近くの相手
                let md = 99; for (const m of mates(p)) { if (m === p || m.gk || m.off) continue; md = Math.min(md, hyp(m.x - o.x, m.y - o.y)); }
                if (md < 5) continue;   // もう誰かが見ている
                const dGoalO = hyp(gx0 - o.x, GOAL_Y - o.y), v = md * 0.6 - dGoalO * 0.12 - hyp(o.x - p.x, o.y - p.y) * 0.05 + (hyp(o.x - bb.x, o.y - bb.y) < 30 ? 1.5 : 0); if (v > bs) { bs = v; best = o; } }
              if (best) { const dl = hyp(gx0 - best.x, GOAL_Y - best.y) || 1; targets[p.idx] = [best.x + (gx0 - best.x) / dl * 1.8, best.y + (GOAL_Y - best.y) / dl * 1.8]; urgent[p.idx] = true; continue; }   // フリーの相手とゴールの間に入る
              { const bx = fx(p.team, bb.x); let gap = null;   // 上がったままのDF（サイドバックなど）が空けたスペースを埋める
                for (const m of mates(p)) { if (m === p || m.gk || m.off || m.position !== 'DF' || !m.slot) continue; if (fx(p.team, m.x) > bx + 4 && bx < 62) { const sp = [fx(p.team, Math.max(6, bx - 10)), clamp(m.slot.y, 4, W - 4)]; let occ = false; for (const q of mates(p)) if (q !== p && !q.gk && hyp(q.x - sp[0], q.y - sp[1]) < 7) occ = true; if (!occ && (!gap || hyp(sp[0] - p.x, sp[1] - p.y) < hyp(gap[0] - p.x, gap[1] - p.y))) gap = sp; } }
                if (gap) { targets[p.idx] = gap; urgent[p.idx] = true; continue; } }
              if (own && hyp(own.x - p.x, own.y - p.y) < 18) { targets[p.idx] = [own.x + own.vx * 0.3, own.y + own.vy * 0.3]; urgent[p.idx] = true; continue; }   // 埋める所がない：ボールを持った相手へ全力で寄せて、奪い返す
              urgent[p.idx] = true;   // 埋める相手がいない：自分の持ち場へ全力で戻る（ふつうの位置取りを、全力で）
            }
            if (!globalThis.__ksNoAtk && p.ksMode === 'atk' && S.poss === p.team && own && own !== p) {   // 攻め：前線のサポート。ボールより前の、パスを受けられる空いた所へ駆け上がる（受けたら決定力のある味方へつなぐ）
              if (!own.gk && own.position !== 'DF' && hyp(own.vx, own.vy) > 2.5 && fx(p.team, own.x) > L / 2 - 5 && !(b.kind === 'pass' && b.intended === p.idx)) {   // FWがドリブルしている：空いている側のスペースへ全速力で走り抜ける（パスコースとおとりを作る）
                const ol = offsideLine(p.team); let fr = [0, 0]; for (const sd of [-1, 1]) { let m = 12; for (const o of opps(p)) { if (o.gk || o.off) continue; m = Math.min(m, hyp(o.x - own.x, o.y - (own.y + sd * 10))); } fr[sd > 0 ? 1 : 0] = m; }
                const sd = fr[1] > fr[0] ? 1 : -1, tx1 = fx(p.team, Math.min(fx(p.team, own.x) + 12, ol - 0.6, L - 8)), ty1 = clamp(own.y + sd * 11, 4, W - 4);
                targets[p.idx] = [tx1, ty1]; urgent[p.idx] = true; p.ksSpot = null; continue; }
              if (!p.ksSpot || S.t > (p.ksSpotT || 0)) { const ol = offsideLine(p.team), of = fx(p.team, own.x); let best = null, bs = -1e9;
                for (const dx of [8, 12, 16]) for (const dy of [-12, -6, 0, 6, 12]) { const fxS = Math.min(of + dx, ol - 0.6, L - 9), sy = clamp(own.y + dy + (GOAL_Y - own.y) * 0.3, 5, W - 5), sx = fx(p.team, fxS);
                  let sp = 9; for (const o of opps(p)) sp = Math.min(sp, hyp(o.x - sx, o.y - sy)); let lane = 9; for (const o of opps(p)) { const sd = segDist(o.x, o.y, own.x, own.y, sx, sy); if (sd.u > 0.1 && sd.u < 0.95) lane = Math.min(lane, sd.d); }
                  let mt = 9; for (const m of mates(p)) if (m !== p && m !== own) mt = Math.min(mt, hyp(m.x - sx, m.y - sy));
                  const v = Math.min(sp, 6) * 0.7 + Math.min(lane, 3) * 1.0 + Math.min(mt, 7) * 0.35 + (fxS - of) * 0.12; if (v > bs) { bs = v; best = [sx, sy]; } }
                p.ksSpot = best; p.ksSpotT = S.t + 0.7; }
              if (p.ksSpot) { targets[p.idx] = p.ksSpot; urgent[p.idx] = true; continue; } } }
          if ((p.byRunT || 0) > S.t && p.byRunTo && own && own.team === p.team && own !== p) { const olR = offsideLine(p.team); targets[p.idx] = [fx(p.team, Math.min(fx(p.team, p.byRunTo[0]), olR - 1.5)), p.byRunTo[1]]; urgent[p.idx] = true; continue; }   /* パスが出るまでは、オフサイドラインの手前まで（出た瞬間に裏へ） */   // 白夜の視界：裏へ全力で走る（パスが出るまで）
          const ch = p.uChase && p.uChase.until > S.t ? p.uChase : null;
          if (ch && own && own.team !== p.team && ch.mode === 'any') { targets[p.idx] = [own.x + own.vx * 0.4, own.y + own.vy * 0.4]; urgent[p.idx] = true; continue; }
          if (ch && !own && (b.tsukiP || b.hari || b.byP || b.aoP) && b.kind === 'pass' && b.intended === p.idx) {   // 月影の抜け出し：ボールと同時に着く所へ全力で（追い越さず、待たず）
            const mt = tsukiMeet(p); p.uMeet = { x: mt.x, y: mt.y, at: S.t + mt.t };
            const dm = hyp(mt.x - p.x, mt.y - p.y), ext = dm < 1.2 && p.uRunDir && !b.byP ? 1.5 : 0;   // 合う直前は、そのまま走り抜ける向きへ（止まらない）
            targets[p.idx] = [mt.x + (p.uRunDir ? p.uRunDir[0] * ext : 0), mt.y + (p.uRunDir ? p.uRunDir[1] * ext : 0)]; urgent[p.idx] = true; p.tsukiRun = S.t; continue; }
          if (ch && !own && p.gk) { if (p._ct != null && p._ct < 99) { targets[p.idx] = [p._cx, p._cy]; urgent[p.idx] = true; chasing[p.idx] = 1; continue; } p.uChase = null; }   // 捨て身の守護神：飛んでいる球そのものではなく、触れる地点（落ちる所）へ。届かないなら追わずにゴールを守る
          if (ch && !own) { const lnd = (b.tsukiP || b.hari || b.byP) && b.landX != null && b.z > 0.4 && b.intended === p.idx; targets[p.idx] = lnd ? [b.landX, b.landY] : [b.x + b.vx * 0.45, b.y + b.vy * 0.45]; urgent[p.idx] = true; chasing[p.idx] = 1; continue; }   // 浮き球は落ちる所へ
          if (ch && own && ch.mode === 'ball') p.uChase = null;   // 相手に先に収められたら、すぐゴールへ戻る

          if (p.vsMark && !p.gk && S.poss !== p.team) { const q = P.find((x) => x.team !== p.team && x.name === p.vsMark && !x.off); if (q) { const gx0 = fx(p.team, 0), gl = hyp(gx0 - q.x, GOAL_Y - q.y) || 1; targets[p.idx] = [q.x + (gx0 - q.x) / gl * 1.0, q.y + (GOAL_Y - q.y) / gl * 1.0]; urgent[p.idx] = true; } }   // 確認画面「選手の対決」：指定した相手に、ゴール側からぴったり付いていく
        }
      }
      if (r && r.type === 'corner' && !r.planned) { planCorner(r); r.planned = true; }
      if (r && r.type === 'free' && !r.planned) { planFK(r); r.planned = true; }
      if (r && r.type === 'throw' && !r.planned) {
        const near = T[r.team].players.filter((m) => !m.gk && !m.off && m.idx !== r.taker).sort((a, c) => hyp(a.x - r.x, a.y - r.y) - hyp(c.x - r.x, c.y - r.y));
        throwHelp[0] = near[0] ? near[0].idx : -1; throwHelp[1] = near[1] ? near[1].idx : -1; r.planned = true;
      }
      if (!r || r.type !== 'throw') { throwHelp[0] = throwHelp[1] = -1; }
      for (const p of P) {
        if (p.off) { targets[p.idx] = [L / 2 + ((p.idx % 11) - 5) * 1.5, W + 4]; urgent[p.idx] = false; continue; }
        if (!r) continue;
        if (r.wall) { const w = r.wall.find((q) => q.idx === p.idx); if (w) { targets[p.idx] = [w.x, w.y]; urgent[p.idx] = true; } }
        // キッカーの助走：ボールの後ろに下がって構え、最後に走り込んで一度で蹴る
        if (p.idx === r.taker && r.type !== 'throw' && r.stage === 'ready') {
          // 蹴る方向（PKはゴール、ゴールキックは前方、それ以外はゴール前）
          const [gx, gy] = r.type === 'goalkick' ? [r.x + sgn(r.team) * 20, r.y] : r.type === 'penalty' ? [fx(r.team, L), GOAL_Y] : [fx(r.team, L - 11), GOAL_Y];
          let dx = gx - r.x, dy = gy - r.y; const dl = hyp(dx, dy) || 1; dx /= dl; dy /= dl;
          // 助走の長さと角度：PKは長く、コーナー・FK・ゴールキックもしっかり
          const runD = { penalty: 6.5, corner: 5, free: r.wall ? 5 : 3.2, goalkick: 5 }[r.type] || 3.5;
          const a = (r.type === 'penalty' ? 0.3 : 0.55) * (p.idx % 2 ? 1 : -1), c0 = Math.cos(a), s0 = Math.sin(a);
          const rx = dx * c0 - dy * s0, ry = dx * s0 + dy * c0;
          const sx = clamp(r.x - rx * runD, -4, L + 4), sy = clamp(r.y - ry * runD, -3.5, W + 3.5);
          const atSpot = hyp(p.x - sx, p.y - sy) < 0.7;
          const runTime = hyp(sx - r.x, sy - r.y) / 5 + 0.3;
          if (!r.runup && atSpot && r.wait <= runTime && (r.type !== 'penalty' || pkClear(r) || (r.pkHold || 0) >= 8)) { r.runup = true; if (r.type === 'penalty') ev('pkgo', { team: r.team }); else if (r.type === 'free' && (r.wall || fx(r.team, r.x) > L / 2)) ev('fkgo', { team: r.team }); }   /* 版846：FKも、笛が鳴ってから蹴る */   /* v742 PK：全員がエリアの外に出てから、笛で助走 */
          if (!r.runup) { targets[p.idx] = [sx, sy]; urgent[p.idx] = !atSpot; }
          else { targets[p.idx] = [r.x - rx * 0.4, r.y - ry * 0.4]; urgent[p.idx] = true; }
        }
        // フリーキック：決まった立ち位置へ。相手はボールから9.15m以上はなれる。味方もキッカーのまわりに固まらない
        if (r.type === 'free' && !p.gk && p.idx !== r.taker && !(r.wall && r.wall.some((w) => w.idx === p.idx))) {
          if (fkSpots[p.idx]) { const [tx, ty] = fkSpots[p.idx]; targets[p.idx] = [tx, ty]; urgent[p.idx] = hyp(p.x - tx, p.y - ty) > 5; }
          if (targets[p.idx]) { let [tx, ty] = targets[p.idx]; const dx = tx - r.x, dy = ty - r.y, d = hyp(dx, dy), need = p.team !== r.team ? 9.6 : 4.5;
            if (d < need) { const ux = d > 0.1 ? dx / d : -sgn(r.team), uy = d > 0.1 ? dy / d : 0; tx = r.x + ux * need; ty = r.y + uy * need; targets[p.idx] = [clamp(tx, 0.5, L - 0.5), clamp(ty, 0.5, W - 0.5)]; } }
        }
        // コーナー：攻撃側はゴール前の決まった場所へ、守備側はそれぞれマークにつく
        if (r.type === 'corner' && !p.gk && p.idx !== r.taker && cornerSpots[p.idx]) {
          const [tx, ty] = cornerSpots[p.idx]; targets[p.idx] = [tx, ty]; urgent[p.idx] = hyp(p.x - tx, p.y - ty) > 6;
        }
        // スローイン：近くの味方2人が受けに来る（1人は足元へ、1人はライン沿いの前へ）
        if (r.type === 'throw' && p.team === r.team && !p.gk && p.idx !== r.taker && (throwHelp[0] === p.idx || throwHelp[1] === p.idx)) {
          const k = throwHelp[0] === p.idx ? 0 : 1, inY = r.y < GOAL_Y ? 1 : -1;
          const tx = r.x + sgn(r.team) * (k === 0 ? -5 : 9), ty = r.y + inY * (k === 0 ? 7 : 3.5);
          targets[p.idx] = [clamp(tx, 1, L - 1), clamp(ty, 1, W - 1)]; urgent[p.idx] = true;
        }
        // コーナー・FKの待ち時間：ゴール前の選手は小刻みに動いて位置を取り合う
        if ((r.type === 'corner' || (r.type === 'free' && r.wall)) && !p.gk && p.idx !== r.taker && targets[p.idx]) {
          const [tx, ty] = targets[p.idx];
          if (fx(r.team, tx) > L - 20) targets[p.idx] = [tx + Math.sin(S.t * 1.7 + p.idx) * 1.1, ty + Math.cos(S.t * 1.3 + p.idx * 2) * 1.3];
        }
        if (r.type === 'penalty' && p.idx !== r.taker) {
          // PKの時はキッカーとGK以外はペナルティエリアの外
          const att = r.team;
          if (p.gk && p.team !== att) { targets[p.idx] = [fx(att, L - 0.4), GOAL_Y]; continue; }
          let [tx, ty] = targets[p.idx];
          const xf = fx(att, tx);
          if (xf > L - 18.5) tx = fx(att, L - 18.5 - (p.idx % 4) * 1.2);
          if (hyp(tx - r.x, ty - r.y) < 10) tx = fx(att, L - 21 - (p.idx % 3) * 1.0);   /* v742 ペナルティアーク（PKスポットから9.15m）の中にも入らない */
          targets[p.idx] = [tx, ty];
          if (pkInZone(p, r)) urgent[p.idx] = true;   /* まだ中にいる選手は急いで出る */
        }
      }
    }
    const CARE_S = 70;
    const coverer = [-1, -1];
    const chasing = new Array(22).fill(0);
    function computeTargetsMain() {
      chasing.fill(0);
      const own = ownerP();
      const b = S.ball;
      const freeBall = b.owner < 0 && !S.restart;
      const chasers2 = [-1, -1], goalDanger = [null, null];   // goalDanger：自陣ゴールに向かっている球の通り道
      // ボールを追う選手（各チーム1人）：到達予測が一番早い選手
      const chasers = [-1, -1];
      if (freeBall) {
        // ボールの予測軌道（3秒先まで）
        const path = [];
        {
          // 高さも含めて予測する（浮き球は落下点・頭の高さで触れる所へ向かう）
          let bx = b.x, by = b.y, bz = b.z, vx = b.vx, vy = b.vy, vz = b.vz || 0;
          const bsv = b.bs || 0; let spn = b.spin || 0;
          for (let k = 1; k <= 30; k++) {
            if (bz > 0 || vz > 0) {
              // 回転で曲がる分も見込む（カーブのクロス・パスの落ち所を読み違えない）
              { const s0 = hyp(vx, vy); if (spn && s0 > 3 && bz > 0.15) { const lat = spn * s0 * 0.24; vx += (-vy / s0) * lat * 0.1; vy += (vx / s0) * lat * 0.1; } }
              const v = Math.hypot(vx, vy, vz);
              vx -= AIR * v * vx * 0.1; vy -= AIR * v * vy * 0.1;
              vz -= (9.8 + AIR * v * vz - LIFT * bsv * hyp(vx, vy)) * 0.1; bz += vz * 0.1;
              if (bz <= 0) { bz = 0; spn *= 0.4; if (Math.abs(vz) > 2.2) { vx *= 0.65; vy *= 0.65; vz = -vz * 0.42; } else vz = 0; }
            } else {
              const sp = hyp(vx, vy);
              if (sp > 0) { const ns = Math.max(0, sp - groundDec(sp) * 0.1); vx *= ns / sp; vy *= ns / sp; }
            }
            bx += vx * 0.1; by += vy * 0.1;
            path.push([clamp(bx, 0.5, L - 0.5), clamp(by, 0.5, W - 0.5), bz]);
          }
        }
        for (const tm of T) {
          let best = -1, bt = 99;
          for (const p of tm.players) {
            p._ct = 99; p._cx = path[path.length - 1][0]; p._cy = path[path.length - 1][1];
            const oppBall = b.lastTeam !== tm.ti;
            if (p.gk && !oppBall && !(fx(tm.ti, b.x) < 20 && Math.abs(b.y - GOAL_Y) < 22)) continue;
            const gc = p.gk && S.gkCk && S.gkCk.g === p.idx && S.t < S.gkCk.until ? S.gkCk.mode : null;
            if (gc === 'stay') continue;   // CK：出ないと決めたGKはゴールを守る
            const v = maxSpeed(p) * (gc ? 1.15 : 1);
            // GK：クロスや裏へのボールが「自分のエリアに落ちてくる」なら飛び出して処理する。判断力が高いほど早く正確に決断できる
            // スイーパーキーパー：裏へのボールを一歩早く読み、ペナルティエリアの外まで出て処理する（捨て身の守護神はさらに遠く・速く）
            const isSK = p.gk && p.type === 'スイーパーキーパー', sut = p.gk && uOn(p, 'sutemi');
            const thruB = b.tsukiP || b.tact || b.hari || (b.kind === 'pass' && b.style), sutR = 24, gkX = sut && thruB ? sutR : isSK && thruB ? 25 : p.gkAtk ? 19 : 12, gkY = sut && thruB ? sutR : isSK && thruB ? 25 : p.gkAtk ? 20 : 15;   // 版800：スイーパーキーパーは、ペナルティエリアの外（25mまで）の裏へのボールも取りに出る   // 捨て身の守護神でも、ゴールを守れる範囲まで（凸で少し広く）   // 国内屈指でも、飛び出すのはペナルティエリアの少し外まで
            const swR = !p.gk && p.type === 'スイーパー' && oppBall && b.kind !== 'shot' && (() => { const e = path[path.length - 1], dl = tm.players.filter((m) => !m.off && !m.gk && m.position === 'DF').map((m) => fx(tm.ti, m.x)).sort((a0, c0) => a0 - c0); const lineX = dl.length ? dl[Math.floor(dl.length / 2)] : 30; return fx(tm.ti, e[0]) < lineX - 1 && fx(tm.ti, b.x + b.vx) < fx(tm.ti, b.x); })();   // 版800：自分たちのDFラインの裏へ落ちる相手のボール
            const icR = !p.gk && oppBall && b.kind === 'pass' && skZ(p, 'intercept');   // 版838：インターセプト：相手のパスに一瞬で反応する
            const react = swR ? 0.0 : icR ? 0.04 : gc ? 0.05 : p.gk ? Math.max(0.04, 0.22 + (1 - p.vision / 100) * 0.35 - (isSK ? 0.12 : 0) - (sut ? 0.08 : 0) - ((p.skRead || 0) > S.t ? 0.2 : 0)) : skZ(p, 'looseBall') ? 0.1 : 0.35;
            for (let k = 0; k < path.length; k++) {
              const tt = (k + 1) * 0.1;
              if (path[k][2] > (p.gk ? (fx(tm.ti, path[k][0]) < 16.5 && Math.abs(path[k][1] - GOAL_Y) < 20.2 ? gkReachZ(p) : 1.9) : 2.6)) continue;   // ペナルティエリアの外では手が使えない：頭を越える浮き球には飛び出さない   // 頭より高いうちは触れない（GKはジャンプして手が届く高さまで）
              if (p.gk && oppBall && !(fx(tm.ti, path[k][0]) < gkX && Math.abs(path[k][1] - GOAL_Y) < gkY)) continue;
              if (hyp(path[k][0] - p.x, path[k][1] - p.y) <= v * Math.max(0, tt - react) + (gc ? 1.6 : p.gk ? 0.9 : 0.5)) { p._ct = tt; p._cx = path[k][0]; p._cy = path[k][1]; break; }
            }
            let score = p._ct + (p._ct === 99 ? hyp(p._cx - p.x, p._cy - p.y) / v : 0);
if (icR && p._ct < 99) score -= 0.2;   // 版838
                        if (swR) { score -= 0.35; p.swRead = S.t + 0.6; }   // 版800：スイーパー：裏へのボールには、誰よりも先に反応して触りに行く（一歩目が速い）
            if ((b.tsukiP || b.tact) && b.kind === 'pass' && b.lastTeam !== tm.ti && !passOk(p, b)) score += 6;   // 触れない相手より、触れる選手（GKなど）を優先して行かせる
            if (score < bt) { bt = score; best = p.idx; }
          }
          // GKは「相手より明らかに先に触れる」時だけ飛び出す（五分五分なら出ずにゴールを守る。DFが追う）
          if (best >= 0 && P[best].gk && b.lastTeam !== tm.ti && !(S.gkCk && S.gkCk.g === best)) {
            const g = P[best], oT = Math.min(99, ...P.filter((q) => q.team !== tm.ti && !q.off).map((q) => q._ct ?? 99));
            const deep = fx(tm.ti, g._cx) < 6 && Math.abs(g._cy - GOAL_Y) < 10;   // ゴールエリア付近なら出る
            const thru = (b.tsukiP || b.tact || (b.kind === 'pass' && b.style && b.intended >= 0 && P[b.intended] && P[b.intended].team !== tm.ti)) && fx(tm.ti, g._cx) > 14;   // 裏へのスルーパス・バイタル付近に落ちてくるボールだけ
            const margin = g.type === 'スイーパーキーパー' && thru ? (uOn(g, 'sutemi') || (g.uniq === 'sutemi' && !(g.uCd > S.t)) ? 0.05 : 0.08) : 0.45;   // ペナルティエリアの中の球は、ふつうに五分なら出ない   // スイーパーキーパーは五分に近くても出る（間に合わなければ無人のゴール）
            if (!deep && g._ct > oT - margin) { let b2 = -1, t2 = 1e9; for (const p of tm.players) { if (p.gk) continue; const sc2 = p._ct + (p._ct === 99 ? hyp(p._cx - p.x, p._cy - p.y) / maxSpeed(p) : 0); if (sc2 < t2) { t2 = sc2; b2 = p.idx; } } best = b2; }
          }
          if (best >= 0 && P[best].gk && P[best].uniq === 'sutemi' && b.lastTeam !== tm.ti && b.owner < 0 && b.kind === 'pass' && b.intended >= 0 && P[b.intended] && P[b.intended].team !== tm.ti && fx(tm.ti, P[best]._cx) > 12 && P[best]._ct < 99 && (() => { const g = P[best], oT = Math.min(99, ...P.filter((q) => q.team !== tm.ti && !q.off).map((q) => q._ct ?? 99)); return oT < 99 && g._ct < oT - 0.15 && hyp(g._cx - g.x, g._cy - g.y) < 20 && b.z < 2; })()) uFire(P[best], 'sutemi');   // 相手と競り合う裏へのボールで、はっきり先に着けて、届く高さの時だけ   // 捨て身の守護神：相手より先にボールへ行くと決めたら、迷わず全力で飛び出す
          chasers[tm.ti] = best;
          // ゴールに向かうシュート・こぼれ球：守る側は2人目のDFも、ゴールラインの手前でコースに入って防ぎに行く（スライディングしてでも割らせない）
          chasers2[tm.ti] = -1;
          if (b.lastTeam !== tm.ti && (b.kind === 'shot' || b.kind === 'loose')) {
            const end = path[path.length - 1], gl0 = fx(tm.ti, 0), toGoal = fx(tm.ti, b.x) < 14 && Math.abs(end[0] - gl0) < 1.2 && Math.abs(end[1] - GOAL_Y) < POST + 0.8;
            if (toGoal) goalDanger[tm.ti] = path;
            if (toGoal) { let b2 = -1, t2 = 99; for (const p of tm.players) { if (p.gk || p.idx === best || p._ct >= 99 || p._ct > 1.2 || fx(tm.ti, p._cx) > 6) continue; if (p._ct < t2) { t2 = p._ct; b2 = p.idx; } } chasers2[tm.ti] = b2; }   // ゴールライン際（6m以内）で間に合う時だけ。マークを捨ててまで追わない
          }
          // CKで出ると決めたGKは、届くなら必ず自分で行く
          const gk0 = S.gkCk && S.gkCk.mode !== 'stay' && S.t < S.gkCk.until ? P[S.gkCk.g] : null;
          if (gk0 && gk0.team === tm.ti && gk0._ct < 99) chasers[tm.ti] = gk0.idx;
        }
        if (b.intended >= 0 && b.kind === 'pass') {
          chasers[P[b.intended].team] = b.intended;
          // 受け手はボールの通り道に体を入れる：自分に一番近い通り道の点へ、ボールより先に着けるならそこで待つ
          const q = P[b.intended], v = maxSpeed(q);
          let best = null;
          // 間に合ういちばん早い点で受ける（ボールに寄る。先へ走りすぎて背中の後ろを通されない）。ピッチの外の点は使わない
          for (let k = 0; k < path.length; k++) {
            if (path[k][2] > 1.6) continue;
            if (path[k][1] <= 0.6 || path[k][1] >= W - 0.6) break;
            const tt = (k + 1) * 0.1, dd = hyp(path[k][0] - q.x, path[k][1] - q.y);
            if (dd <= v * Math.max(0, tt - 0.3) + 0.3) { best = { dd, x: path[k][0], y: path[k][1] }; break; }
          }
          if (!best) { let bl = 1e9; for (let k = 0; k < path.length; k++) { if (path[k][2] > 1.6) continue; if (path[k][1] <= 0.6 || path[k][1] >= W - 0.6) break; const tt = (k + 1) * 0.1, late = hyp(path[k][0] - q.x, path[k][1] - q.y) / v + 0.3 - tt; if (late < bl) { bl = late; best = { x: path[k][0], y: path[k][1] }; } } }   // 間に合う点がない：いちばん早く追いつける所へ（通り道から外れたまま見送らない）
          if (best) { q._cx = best.x; q._cy = best.y; }
        }
      }

      for (const tm of T) {
        const attacking = S.poss === tm.ti;
        if (attacking) tm.atkT = S.t;   // 版837：最後に攻めていた時刻（ボールを失った直後を知るため）
        const Lx = lineX(tm, attacking);
        const bxf = fx(tm.ti, b.x);
        const shiftY = (b.y - GOAL_Y) * (attacking ? 0.28 : 0.45);
        const offL = seenOffLine(tm.ti);
        // 版843：崩しの局面：相手のゴールまで約40mの所でボールを持ったら、状況を見て2〜4人がボールの近くへ寄り、短い距離で崩す（持ち場にこだわらない）。
        //  寄る人数は、つなぐ力・戦い方・点差・攻撃のスイッチが入ったかで決まる。逆サイドの大外の1人は残して幅を取る
        if (!attacking || S.restart || S.setPiece || (S.counter > 0)) tm.ovl = null;
        else if (own && own.team === tm.ti && !own.gk) {
          const ox = fx(tm.ti, own.x);
          if (ox < L - 52) tm.ovl = null;
          else if (ox > L - 40 && (!tm.ovl || tm.ovl.until < S.t) && S.t >= (tm.ovlNext || 0)) {
            tm.ovlNext = S.t + 1.2;
            const behindS = S.score[tm.ti] < S.score[1 - tm.ti];
            const want = 0.3 + tm.pat * 0.35 + (tm.attitude === 'attacking' ? 0.2 : 0) - (tm.attitude === 'defensive' ? 0.25 : 0) + (behindS ? 0.2 : 0) + ((tm.accelT || 0) > S.t ? 0.3 : 0) + DOM[tm.ti] * 0.3;
            if (!globalThis.__noOvl && R.next() < want) {
              const n = clamp(Math.round(1.6 + want * 1.6), 2, 4), sdB = Math.sign(own.y - GOAL_Y) || 1;
              const widest = tm.players.filter((m) => !m.off && !m.gk && m.slot && m.slot.line >= 1 && Math.sign(m.y - GOAL_Y) === -sdB).sort((a, c) => Math.abs(c.y - GOAL_Y) - Math.abs(a.y - GOAL_Y))[0];   // 逆サイドの大外は残す
              const cand = tm.players.filter((m) => m !== own && m !== widest && !m.gk && !m.off && m.slot && !(m.position === 'FW' && (m.type === 'ストライカー' || m.uniq === 'guren')) && (m.slot.line >= 1 || (want > 0.8 && Math.abs(m.slot.y - GOAL_Y) >= 12 && Math.sign(m.slot.y - GOAL_Y) === sdB)) && !(m.run > 0 && m.otRun && S.t < m.otRun.until) && hyp(m.x - own.x, m.y - own.y) < 30)
                .sort((a, c) => hyp(a.x - own.x, a.y - own.y) - hyp(c.x - own.x, c.y - own.y)).slice(0, n);
              if (cand.length >= 2) {
                const oy = own.y, sd = Math.sign(GOAL_Y - oy) || 1, cen = Math.abs(oy - GOAL_Y) < 8;
                const spots = [[9, cen ? 9 : sd * 10], [-7, cen ? -9 : sd * 7], [14, cen ? -4 : sd * 15], [-3, cen ? 14 : -sd * 9]];
                const used = new Set(), ids = [], spot = {};
                for (const m of cand) { let bi = -1, bd = 1e9; spots.forEach((sp, i) => { if (used.has(i) || i >= cand.length) return; const dd = hyp(fx(tm.ti, m.x) - (ox + sp[0]), m.y - (oy + sp[1])); if (dd < bd) { bd = dd; bi = i; } }); if (bi < 0) continue; used.add(bi); ids.push(m.idx); spot[m.idx] = bi; }
                tm.ovl = { until: S.t + R.range(5, 8), ids, spot, t0: S.t };
                if (globalThis.__ovDbg) { globalThis.__ovDbg.n++; globalThis.__ovDbg.p += ids.length; } if (globalThis.__scnLog) globalThis.__scnLog.push(['ovl', +S.t.toFixed(1), tm.ti, ids.length]);
              }
            }
          }
        }
        // 版844：サイドの深い所（ゴールまで約24m）で持ったら、3〜4人がゴール前の決まった所へ入る（ニア・ファー・PKマーク・マイナス）。えぐった時に中に誰もいない、をなくす
        tm.boxR = null;
        if (attacking && own && own.team === tm.ti && !own.gk && !S.restart && !S.setPiece && fx(tm.ti, own.x) > L - 24 && Math.abs(own.y - GOAL_Y) > 11) {
          const ns = Math.sign(own.y - GOAL_Y) || 1, ol = offL;
          const spots = [[L - 5.5, GOAL_Y + ns * 2.5, 1], [L - 7.5, GOAL_Y - ns * 4.5, 1], [L - 11, GOAL_Y - ns * 0.5, 1], [L - 15.5, GOAL_Y + ns * 2, 0]];
          const nB = 3 + (tm.attitude === 'attacking' || S.score[tm.ti] < S.score[1 - tm.ti] ? 1 : 0) - (tm.attitude === 'defensive' ? 1 : 0);
          const cand = tm.players.filter((m) => m !== own && !m.gk && !m.off && m.slot && (m.slot.line >= 1 || (m.ovUntil || 0) > S.t) && !((m.run > 0) && m.otRun && S.t < m.otRun.until && m.uniq));
          const R2 = {}, used = new Set();
          for (const [i, sp] of spots.slice(0, Math.max(3, nB)).entries()) { let bm = null, bc = 1e9; for (const m of cand) { if (used.has(m.idx)) continue; const c = hyp(fx(tm.ti, m.x) - sp[0], m.y - sp[1]) - (sp[2] && m.position === 'FW' ? 12 : 0) - (!sp[2] && m.position === 'MF' ? 6 : 0) + (m.slot.line === 0 ? 8 : 0); if (c < bc) { bc = c; bm = m; } } if (bm && bc < 70) { used.add(bm.idx); R2[bm.idx] = [Math.min(sp[0], ol - 0.3), sp[1]]; } }
          tm.boxR = R2;
        }
        // 守備でボールに寄せる選手
        const pressers = new Set();
        coverer[tm.ti] = -1;
        const gkHolding = own && own.gk && own.hold;   // GKがキャッチ中は寄せない（キーパーチャージ）。自分の位置に戻って備える
        if (!attacking && !S.restart && !freeBall && !gkHolding) {   // こぼれ球の時は追う1人だけ（味方同士で被らない）
          const target = own || b;
          const ranked = tm.players.filter((p) => !p.gk).map((p) => ({ p, d: hyp(p.x - target.x, p.y - target.y) })).sort((a, c) => a.d - c.d);
          if (ranked[0]) pressers.add(ranked[0].p.idx);
          // 2人目：ボールとゴールを結ぶ線上に入って中央を締める（カバー）
          { const cv = ranked.slice(1, 5).find((r) => skZ(r.p, 'cover') && r.d < 24);   // カバーリング：少し離れていても2人目としてカバーに入る
            if (cv) coverer[tm.ti] = cv.p.idx; else if (ranked[1] && ranked[1].d < 18) coverer[tm.ti] = ranked[1].p.idx; else coverer[tm.ti] = -1; }
          let extra = 0;
          // 負け・引き分けで70分過ぎ：全体で前から追い込む（パスの出し先にも寄せてミスを誘う）
          const urg = tm.urg;
          for (let k = 1; k < ranked.length && extra < (urg ? 2 : 1); k++) {   // 寄せるのは1人（＋近くにいれば2人目まで）。全員で囲まない
            const { p, d } = ranked[k];
            const pr = clamp(p.press + tm.mods.press + tm.tac.press + DOM[tm.ti] * 50 + urg * 40 + (skZ(p, 'pressMonster') ? 40 : 0), 0, 100);
            if (pr >= 35 && d < 3 + pr * 0.07 + urg * 4) { pressers.add(p.idx); extra++; }
          }
          // 版841：守備の合図で一斉に寄せる（2人目も行く）：相手がタッチライン際・後ろ向き（自分のゴールへ戻りながら）で受けた時。抜かれた直後は隣がすぐカバーに出る
          if (own && own.team !== tm.ti && !own.gk && ranked[1]) {
            const touch = Math.abs(own.y - GOAL_Y) > 27, backT = (own.vx || 0) * sgn(own.team) < -0.6, beaten = S.t - (own.beatT ?? -9) < 1.2;
            const org = clamp(0.4 + tm.pat * 0.6 + (tm.tac.press || 0) / 50, 0, 1.2);   // 組織の良いチームほど合図に反応する
            if ((touch || backT) && ranked[1].d < 11 + org * 4 && R.next() < 0.08 + org * 0.12) { tm.trapT = S.t + 1.6; tm.trapP = ranked[1].p.idx; if (globalThis.__ctDbg) globalThis.__ctDbg.trap++; }
            if (beaten && ranked[1].d < 14) { pressers.add(ranked[1].p.idx); if (globalThis.__ctDbg) globalThis.__ctDbg.cover++; }
            if ((tm.trapT || 0) > S.t && P[tm.trapP] && !P[tm.trapP].off) pressers.add(tm.trapP);
          }
          // 版843：即時奪回：ボールを失った直後（約3〜4.5秒）、相手陣〜中盤なら、近くの2〜3人が一斉に奪い返しに行く（組織・プレスが強いチームほど多く・長く）
          if (own && own.team !== tm.ti && !own.gk && !globalThis.__noCP) {
            const org = clamp(0.3 + tm.pat * 0.4 + (tm.tac.press || 0) / 50 + (tm.attitude === 'attacking' ? 0.2 : 0) - (tm.attitude === 'defensive' ? 0.3 : 0) + DOM[tm.ti] * 0.3, 0, 1.2), dur = 2.8 + org * 1.6;
            if (S.t - (tm.lostT ?? -9) < dur && bxf > 30 && (tm.lostT ?? -9) - (tm.ownSince ?? -99) > 3) {   // 版844：落ち着いて持っていた時に失った場合だけ（奪い合いの最中は全員で群がらない）
              const nCP = org > 0.75 ? 3 : org > 0.35 ? 2 : 1; let k2 = 0;
              for (const r of ranked) { if (k2 >= nCP) break; if (r.p.off || pressers.has(r.p.idx)) continue; if (r.d > 10 + org * 6) break; if (r.p.slot && r.p.slot.line === 0 && Math.abs(r.p.slot.y - GOAL_Y) < 9) continue; pressers.add(r.p.idx); r.p.cpT = S.t; k2++; }
            }
          }
          // シュートレンジ（ゴールから約30m）に入られたら、いちばん近いDFが必ず寄せて打たせない（原理原則）
          if (own && fx(tm.ti, own.x) < 32 && Math.abs(own.y - GOAL_Y) < 24) {   // いちばん早く寄せられる選手（DFでもMFでも）が、シュートコースを切りに行く
            const nd = tm.players.filter((p) => !p.gk && !p.off && p.position !== 'FW' && fx(tm.ti, p.x) < fx(tm.ti, own.x) + 6).map((p) => ({ p, t: hyp(p.x - own.x, p.y - own.y) / maxSpeed(p) })).sort((a, c) => a.t - c.t)[0];
            if (nd && nd.t < 3.2) pressers.add(nd.p.idx);
            // 2人目は、ボールとゴールの間（シュートの通り道）に入って締める
            if (coverer[tm.ti] < 0) { const c2 = tm.players.filter((p) => !p.gk && !p.off && !pressers.has(p.idx) && p.position !== 'FW').map((p) => ({ p, d: hyp(p.x - own.x, p.y - own.y) })).sort((a, c) => a.d - c.d)[0]; if (c2 && c2.d < 26) coverer[tm.ti] = c2.p.idx; } }
          // CBの裏を取られて独走・GKと1対1になりそう（保持者とゴールの間に味方がいない）：
          //  近くのSBや味方は並走せずに内へ絞り、保持者の前（ゴール側）へ斜めに詰めてシュートを打たせない
          if (own && fx(tm.ti, own.x) < 40) {
            const ox = fx(tm.ti, own.x), lane = 6 + ox * 0.12;
            const between = tm.players.some((p) => !p.gk && !p.off && fx(tm.ti, p.x) < ox - 0.5 && Math.abs(p.y - own.y - (GOAL_Y - own.y) * (1 - fx(tm.ti, p.x) / Math.max(1, ox))) < lane);
            if (!between) {
              const near = tm.players.filter((p) => !p.gk && !p.off).map((p) => ({ p, d: hyp(p.x - own.x, p.y - own.y) })).filter((r) => r.d < 26).sort((a, c) => a.d - c.d).slice(0, 3);
              for (const r of near) { pressers.add(r.p.idx); r.p.breakT = S.t; }
            }
          }
        }
        // 原理原則：シュートレンジの中へ横パス・折り返し：受け手にいちばん近いDFが、受ける所へ寄せてシュートコースを消す
        let recvPress = -1;
        if (!attacking && freeBall && b.kind === 'pass' && b.intended >= 0 && P[b.intended] && P[b.intended].team !== tm.ti && b.lastTeam !== tm.ti) {
          const r = P[b.intended];
          if (fx(tm.ti, r.x) < 30 && Math.abs(r.y - GOAL_Y) < 20) { const c = tm.players.filter((p) => !p.gk && !p.off && p.idx !== chasers[tm.ti]).map((p) => ({ p, d: hyp(p.x - r.x, p.y - r.y) })).sort((a, c2) => a.d - c2.d)[0]; if (c && c.d < 18) recvPress = c.p.idx; }
        }
        // マンマークの割り当て（1秒ごと）
        if (!attacking && Math.round(S.t * 10) % 10 === 0) {
          const taken = new Set(), hard = new Set();
          for (const p of tm.players) { p.mark = -1; p.markHard = false; }
          // 作戦ボードで指名した相手：いちばん近い位置の守備の選手が、ぴったり付く
          for (const si of tm.markOn || []) {
            const q = P.find((x) => x.team !== tm.ti && x.slotIdx === si && !x.off && !x.gk); if (!q) continue;
            let best = null, bd = 1e9;
            for (const p of tm.players) {
              if (p.gk || p.off || hard.has(p.idx)) continue;
              const sx = fx(tm.ti, Lx + p.slot.rel), sy = p.slot.y + shiftY, d = hyp(q.x - sx, q.y - sy) + (p.position === 'FW' ? 12 : 0);
              if (d < bd) { bd = d; best = p; }
            }
            if (best) { best.mark = q.idx; best.markHard = true; hard.add(best.idx); taken.add(q.idx); }
          }
          for (const p of tm.players) {   // 確認画面「選手の対決」：指定した守りの選手が、指定した攻めの選手にぴったり付く
            if (!p.vsMark || p.gk || p.off || p.markHard) continue;
            const q = P.find((x) => x.team !== tm.ti && x.name === p.vsMark && !x.off && !x.gk); if (!q) continue;
            for (const o of tm.players) if (o.mark === q.idx) o.mark = -1;
            p.mark = q.idx; p.markHard = true; hard.add(p.idx); taken.add(q.idx);
          }
          for (const p of tm.players) {   // 版800：マンマーカー：相手のエース（いちばん点を取りそうなFW）に、どこまでもついて行く
            if (p.markHard || p.gk || p.off || p.type !== 'マンマーカー') continue;
            const ace = aceFw(1 - tm.ti); if (!ace || ace.off || taken.has(ace.idx)) continue;
            p.mark = ace.idx; p.markHard = true; hard.add(p.idx); taken.add(ace.idx);
          }
          for (const p of tm.players) {
            if (p.markHard) continue;
            if (p.gk || (p.zone_man < 20 && !(tm.urg && p.slot.line > 0) && !skZ(p, 'manMark'))) continue;   // 追いかける終盤は中盤・前線もパスの受け手に付く
            const sx = fx(tm.ti, Lx + p.slot.rel), sy = p.slot.y + shiftY;
            let best = -1, bd = 1e9;
            for (const q of opps(p)) {
              if (q.gk || taken.has(q.idx)) continue;
              const d = hyp(q.x - sx, q.y - sy);
              if (d < bd) { bd = d; best = q.idx; }
            }
            if (best >= 0 && bd < 28) { p.mark = best; taken.add(best); }
          }
        }

        for (const p of tm.players) {
          let tx, ty, u = false;
          if (p.gk) {
            // GK：ボールと「ゴールの中心より少しニア寄りの点」を結んだ線の上に立ち、ボールに合わせて動く
            const ballNear = bxf < 30;
            tx = clamp(1.2 + (ballNear ? 1.6 : 2.6 + (bxf - 30) * 0.04), 1, 6.5);   // 基本はゴール寄り
            if (p.type === 'スイーパーキーパー') tx = bxf > 55 ? clamp(9 + (bxf - 55) * 0.15, 9, 15) : bxf > 40 ? clamp(6.5 + (bxf - 40) * 0.17, 6.5, 9) : tx;   // 相手陣にボールがある時だけ高く。相手が持ってシュートレンジ（約40m以内）に来たら、ふつうの距離   // スイーパーキーパー：ふだんは高い位置（DFラインの後ろ）、シュートレンジでは適切な距離に戻る
            else if (p.gkAtk) tx = clamp(tx + (bxf > 58 ? 2.5 + (bxf - 58) * 0.12 : bxf > 40 ? 0.8 : 0.3), 1, 13);   // 攻撃的GK：明らかに余裕がある時（ボールが相手陣内）だけ高い位置を取る
            else tx = clamp(tx - (ballNear ? 0.6 : 1.5), 0.8, 6);                            // 守備的GK：ゴール前に構える
            // 版458：相手が持ってシュートを狙える所に来たら、距離に合わせて前に出て角度を消す（遠いシュートには下がり気味、近いほど前へ）。相手に詰められているなら出すぎない
            if (!globalThis.__noDepth && own && own.team !== tm.ti && !S.restart && p.type !== 'スイーパーキーパー' || (own && own.team !== tm.ti && p.type === 'スイーパーキーパー' && bxf < 40)) {
              const dG = hyp(bxf, b.y - GOAL_Y), cen = Math.abs(b.y - GOAL_Y) < 20;
              if (dG < 30 && cen) { let want = tx;
                const free = !opps(own).some((q) => !q.gk && !q.off && hyp(q.x - own.x, q.y - own.y) < 2.5 && fx(tm.ti, q.x) < bxf);   // 前に相手（味方DF）がいない＝1対1に近い
                if (free && dG < 13) want = clamp(dG * 0.36, want, 5);   // 1対1：前へ詰めて、シュートコースを小さくする
                tx = want; } }
            // 判断力が低いGKは、立ち位置が少しずつズレる（ニアを空ける・前に出すぎる）
            const posErr = (1 - p.vision / 100) * 1.4;
            tx += posErr * 0.5 * Math.sin(S.t * 0.43 + p.idx * 1.7);
            { const anc = GOAL_Y + clamp((b.y - GOAL_Y) * 0.12, -1.2, 1.2), k = clamp(tx / Math.max(bxf, tx + 0.5), 0, 1);   // ゴールの中心より少しニア寄りの点
              ty = clamp(anc + (b.y - anc) * k, GOAL_Y - (tx > 8 ? 14 : POST - 0.3), GOAL_Y + (tx > 8 ? 14 : POST - 0.3)) + posErr * 0.4 * Math.sin(S.t * 0.61 + p.idx * 2.3); }
            // 角度のない所（ゴールライン近く・ポストより外）にボールがある：前に出ずにゴールライン上でニアポストの内側に立つ。ニアを消しつつ、ファーへの球にも手が届く
            if (bxf < 10 && Math.abs(b.y - GOAL_Y) > POST - 0.5 && Math.abs(b.y - GOAL_Y) < 22 && S.poss !== tm.ti) { tx = Math.min(tx, 0.9); ty = GOAL_Y + Math.sign(b.y - GOAL_Y) * (POST - 1.3); u = true; }
            // スイーパーキーパーの読み：相手が裏へ走り出したのを見て、DFラインの裏のスペースへ先に出ておく。抜け出した相手には、正面から詰める
            const lcDrop = S.lcStep && S.lcStep.team === tm.ti && S.lcStep.mode === 'drop' && S.lcStep.until > S.t;   // ラインを下げている時は、GKはゴールを守る
            if ((p.skRead || 0) > S.t && !lcDrop && S.poss !== tm.ti && !(own && own.team !== tm.ti && bxf < 30)) { const lineB = Math.min(...tm.players.filter((q) => !q.gk && !q.off).map((q) => fx(tm.ti, q.x))); tx = Math.max(tx, clamp(lineB - 9, 4, uOn(p, 'sutemi') ? 18 : 14)); }
            // 1対1の鬼：フリーで向かってくる相手には、前へ出て角度を消し、体を投げ出す準備
            if (p.sk.has('oneOnOne') && own && own.team !== tm.ti && bxf < 22 && Math.abs(b.y - GOAL_Y) < 14 && !opps(own).some((q) => !q.gk && hyp(q.x - own.x, q.y - own.y) < 3)) {
              const dd = hyp(bxf, b.y - GOAL_Y); tx = clamp(dd * 0.38, 2, 8); ty = GOAL_Y + (b.y - GOAL_Y) * (tx / Math.max(dd, 1)); u = true;
            }
            const react = 0.34 - p.vision * 0.0012 - p.technique * 0.0008 - (p.sk.has('superReflex') ? 0.05 : 0) - (p.uniq === 'ikari' && b.kind === 'shot' ? 0.08 * gP(p) : 0) + (b.csPlace && b.kind === 'shot' ? (b.csType === 'ground' && b.csGkNear > 0.5 ? 0.24 : 0.12) : 0) + (b.shotSkill === 'toeKick' && b.kind === 'shot' ? 0.06 : 0) + (b.kind === 'shot' ? b.uDelay || 0 : 0);   // トゥーキックは構えがないので、GKの反応が遅れる   // 打たれてから反応するまでの一瞬（うまいGKほど早い）。置きに行くコントロールショットは出だしが少し遅れる
            if (b.kind === 'shot' && b.lastTeam !== tm.ti && S.t - (b.shotT ?? -9) < react) { tx = fx(tm.ti, p.x); ty = p.y; u = false; }
            else if (b.kind === 'shot' && b.lastTeam !== tm.ti) {
              // 飛んでくるシュートのコースへ。届かなければ横っ跳び
              const gx = fx(tm.ti, 0);
              const tHit = Math.abs((b.x - gx) / (b.vx || 1e-6));
              let yc = b.y + b.vy * tHit;
              // GKのいる位置をボールが通る時刻と場所（ゴールラインではなく自分の前で判定）
              const tG = Math.max(0, (p.x - b.x) / (b.vx || 1e-6));
              let yG = b.y + b.vy * tG;
              // 巻いてくるシュートは、曲がった先（ファー）を読んで飛ぶ
              if (b.curveAll && b.aimY != null) { yc = b.aimY; yG = b.aimY; }
              ty = clamp(tG < 0.7 ? yG : yc, GOAL_Y - POST - 0.8, GOAL_Y + POST + 0.8);
              tx = tG < 0.7 ? fx(tm.ti, p.x) : 0.8; u = true;      // 迫ってきたら下がらずにその場で構える
              const gap = yG - p.y;
              // 枠に飛んでくるシュートには、届かなくても必ず飛びつく（ボールを眺めたまま決められない）
              const onFrame = Math.abs(yc - GOAL_Y) < POST + 0.6;
              if (!p.diveT && !p.downT && !p.lateDive && tG < 0.5 && Math.abs(gap) > 0.8 && (Math.abs(gap) < gkDiveMax(p) + 1 || onFrame)) {   /* 版460：飛び方は版457に戻した */
                // 飛ぶ瞬間に「届くかどうか」を決めておく：届かない時は手前で落ち、届く時はしっかり触る（見た目と結果をそろえる）
                const r0 = R.next(), g0 = gkSaveProb(p, b, 0.1, yG, Math.max(5, hyp(b.vx, b.vy) - 4)), est = g0.prob + 0.04 + 0.5 * clamp((g0.skill - 45) / 40, 0, 1), miss = r0 >= est;   // 版790：上手なGK（D2・D1級）ほど、飛ぶ向きと間合いを外さない   // 届く頃の球の速さで見積もる
                p.preSave = { t: b.shotT, r: r0, miss, est, sp: hyp(b.vx, b.vy), d: hyp(P[b.kicker].x - p.x, P[b.kicker].y - p.y) };
                if (miss) missDive(p, gap, tG, b.csPlace && b.csType === 'ground');   // 版781：届かない時は、伸ばした手（絵）もボールに重ならない所まで
                else startDive(p, Math.sign(gap), Math.abs(gap), tG);
              }
            }
            if (p.lateDive) {   // 版782：反応が遅れて、その場で固まっている
              if (S.t > p.lateDive.until || S.restart) p.lateDive = null;
              else { tx = fx(tm.ti, p.x); ty = p.y; u = false; p.vx *= 0.5; p.vy *= 0.5; if (S.t >= p.lateDive.at) { const ld = p.lateDive; p.lateDive = null; if (!p.diveT && !p.downT) startDive(p, ld.dir, ld.dist, 0.3); } }
            }
            if (own && own.idx === p.idx) { tx = fx(tm.ti, p.x); ty = p.y; }
            if (freeBall && chasers[tm.ti] === p.idx) { tx = fx(tm.ti, p._cx); ty = p._cy; u = true; chasing[p.idx] = 1; }
            if (S.restart && S.restart.taker === p.idx) { const rr = S.restart, fb = rr.stage === 'fetch' || rr.stage === 'settle'; tx = fx(tm.ti, fb && rr.type === 'throw' ? S.ball.x : rr.x); ty = fb && rr.type === 'throw' ? S.ball.y : rr.y; u = true; }
            if (S.celebrate > 0) { tx = 3; ty = GOAL_Y; u = false; if (p.team !== S.scoreTeam && S.celebrate > S.cel0 - 4) { tx = fx(tm.ti, p.x); ty = p.y; } }
            if (!u && own && own.team !== tm.ti && hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 3) u = true;   // 相手にボールが渡ったら、出ていたGKは全力で戻る
            targets[p.idx] = [fx(tm.ti, tx), ty]; urgent[p.idx] = u;
            continue;
          }
          const s = p.slot;
          const wide = Math.abs(s.y - GOAL_Y) > 14;
          // 守備の時はコンパクトに：ライン間を詰め、横幅を絞って中央を空けない
          tx = Lx + s.rel * (attacking ? 1.05 : 0.8) + (s.line > 0 ? (wide ? 3 : -2) : (wide ? 1.5 : -1)) + ((p.number * 37) % 5) - 2;
          ty = GOAL_Y + (s.y - GOAL_Y) * (attacking ? 1.05 : 0.78) + shiftY * (attacking ? 0.9 : 0.8);
          if (attacking) {
            // 前に出る（オーバーラップ）
            if (bxf > 18) tx += ((s.line === 0 && !wide ? Math.min(p.overlap, 25) : p.overlap) - 10) * 0.3 * clamp((bxf - 18) / 25, 0, 1);   // 真ん中のDF（CB）は、オーバーラップを持っていても上がりすぎない（SBだけが前線へ）
            if (p.uniq === 'shiden' && s.line === 1 && bxf > 30) { tx = Math.max(tx, Math.min(bxf + 6, offL - 4)); ty += (b.y - ty) * 0.35; }   // 紫電の遊戯（かまた）：自由に動くファンタジスタ。攻撃の時は前線の手前（相手のMFとDFの間）へ上がり、ボールの方へ寄ってボールを受けに行く
            if (s.line === 0 && Math.abs(s.y - GOAL_Y) >= 12 && tm.players.filter((m) => !m.off && m.slot && m.slot.line === 0).length >= 5 && !tm.players.some((m) => m !== p && !m.off && m.slot && m.slot.line === 0 && Math.sign(m.slot.y - GOAL_Y) === Math.sign(s.y - GOAL_Y) && Math.abs(m.slot.y - GOAL_Y) > Math.abs(s.y - GOAL_Y) + 3) && bxf > 30) {
              tx = Math.max(tx, Math.min(bxf + 3, L - 22)); ty = GOAL_Y + Math.sign(s.y - GOAL_Y) * Math.max(Math.abs(ty - GOAL_Y), 26); }   // 5バックの両端（ウイングバック）：攻撃の時は一気に上がり、サイドハーフのように攻めに加わる
            // ゴール前で待つ
            if (s.last || p.goal_wait > 50) {
              const gw = p.goal_wait / 100;
              tx += (offL - 1.2 - tx) * gw;
              ty += (GOAL_Y - ty) * gw * 0.6;
            }
            if (!p.run) tx = Math.min(tx, L - 7);   /* v749：ボールが深い時も、GKの横（ゴールライン際）までは入らない。PKスポットの少し手前で待つ */
            // 押し上げ（シャドーのサポートパッシブ）：ゴール前へ少し多く入っていく
            if (bxf > L - 42 && p.position !== 'DF' && tm.pas && tm.pas.has('pushUp')) { const a = aura(p, 'pushUp'); if (a) tx += 2.4 * a; }
            // ボール保持者に寄る（サポート）
            const anc = own ? (own.team === tm.ti ? own : null) : (b.lastTeam === tm.ti && b.kind !== 'shot' ? { x: b.intended >= 0 ? P[b.intended].x : b.x, y: b.intended >= 0 ? P[b.intended].y : b.y } : null);
            if (anc && anc !== p && !(b.intended === p.idx && !own)) {
              const own2 = anc;
              const d = hyp(own2.x - p.x, own2.y - p.y);
              if (d > 6) {
                const side = Math.sign(p.slot.y - own2.y) || 1;
                const sx = fx(tm.ti, own2.x) - 1, sy = own2.y + side * 12;   // 少し離れて、パスを受けられる角度に立つ
                const k = clamp((p.support - 15) / 85 + 0, 0, 0.75);   // 港の指揮者：みんなが受けに動く
                tx += (sx - tx) * k; ty += (sy - ty) * k;
              }
            }
            // 版467：チームの縦の長さを詰める（FWだけ前・MFは後ろ、の間延びをなくす）。
            //  中盤より前でボールを持ったら、MFはボールのすぐ後ろまで上がって攻撃に加わり、自陣で持っている時はFWが少し下りてつなぎ役になる
            if (!globalThis.__noCompact && !p.run) {
              if (s.line === 1 && bxf > 32) tx = Math.max(tx, Math.min(bxf - 7 + (wide ? 4 : 0), offL - 3));
              if (s.last && bxf < 40 && !(p.goal_wait > 70)) tx = Math.min(tx, bxf + 24);
              if (s.line === 0 && bxf > 60) tx = Math.max(tx, Math.min(bxf - 28, L / 2 + 8));
            }
            // 幅を取る：サイドの選手はタッチライン際に張って相手の守備を広げる
            if (wide && !p.run) ty += (p.slot.y > GOAL_Y ? 1 : -1) * (6 + tm.tac.side * 3) - shiftY * 0.5;
            if (p.ovUntil > S.t && p.ovSide) { tx = Math.min(Math.max(tx, bxf + 9), offL - 1); ty = GOAL_Y + p.ovSide * 29; u = true; }   // 版837：オーバーラップの走り（ボールの外側を追い越す）
            // サイドの深い所にボール → ゴール前へ飛び込む（ニア・ファー・こぼれ球）
            const bWide = bxf > L - 32 && Math.abs(b.y - GOAL_Y) > 11;
            if (bWide && (!own || own.idx !== p.idx)) {
              const nearSide = Math.sign(b.y - GOAL_Y);
              if (s.last) {
                const near = (p.number % 2) === 0;
                tx = L - (near ? 5.5 : 7.5); ty = GOAL_Y + nearSide * (near ? 2.5 : -4); u = true;
              } else if (s.line === 1 && !wide && p.goal_wait + p.overlap > 70) { tx = L - 14; ty = GOAL_Y - nearSide * 2; u = true; }
              else if (s.line === 1 && !wide && bxf > L - 20 && !tm.players.some((m) => m !== p && !m.off && m.cbWait === tm.ti + 1 && (m.cbWaitT || 0) > S.t - 0.2)) { tx = Math.min(L - 15, bxf - 4); ty = GOAL_Y + nearSide * 1.5; u = true; p.cbWait = tm.ti + 1; p.cbWaitT = S.t; }   // 版843：ゴールライン際までえぐったら、1人がマイナス（PKマークの手前）へ入る
              // ニアに飛び込む／ファーで待つ
              if (!globalThis.__noStX && p.type === 'ストライカー' && p.position === 'FW') {   // 版795：クロスの前はファーへ離れて（プルアウェイ）DFの視界から消え、蹴られた瞬間にゴール前へ飛び込む
                const crossIn = !own && b.lastTeam === tm.ti && (b.kind === 'pass' || b.kind === 'cross');
                if (crossIn && b.intended === p.idx) { tx = fx(tm.ti, b.landX != null ? b.landX : b.x + b.vx * 0.6); ty = b.landY != null ? b.landY : b.y + b.vy * 0.6; u = true; } else if (crossIn) { tx = L - 5.8; ty = GOAL_Y + nearSide * 0.8; u = true; } else { tx = L - 8; ty = GOAL_Y - nearSide * 3.5; u = hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 3; }
              }
              else if (skZ(p, 'nearRun')) { tx = L - 5; ty = GOAL_Y + nearSide * 2.8; u = true; }
              else if (skZ(p, 'farWait')) { tx = L - 7.5; ty = GOAL_Y - nearSide * 5; u = true; }
            }
            if (tm.boxR && tm.boxR[p.idx] && own !== p && !(b.intended === p.idx && !own)) { const sp = tm.boxR[p.idx]; tx = sp[0] + Math.sin(S.t * 1.1 + p.idx) * 0.8; ty = sp[1]; u = true; p.boxIn = S.t; }   // 版844：ゴール前の決まった所へ入る
            // こぼれ球の嗅覚：味方がシュートしたら、こぼれそうな所へすぐ詰める
            if (skZ(p, 'looseBall') && b.kind === 'shot' && b.lastTeam === tm.ti && b.kicker !== p.idx) { tx = L - 7; ty = GOAL_Y + (b.y - GOAL_Y) * 0.5; u = true; }
            // 裏へ走る
            if (p.uniq === 'aonoouza' && p.otRun && S.t < p.otRun.until && (p.aoCutT || 0) > S.t && own && own.team === p.team && own !== p && own.aoCutBy === p.idx && S.t >= (p.aoSpotT || 0)) {   // 蒼の王座：折り返しをもらえる、ゴール正面の空いている所へ（ボールより後ろ＝オフサイドにならない）
              p.aoSpotT = S.t + 0.4; const ox = fx(p.team, own.x); let bs = -1e9, bp = null;
              for (const sx of [L - 9, L - 11.5, L - 14, L - 17, L - 20]) for (const dy of [-6, -3, 0, 3, 6]) { const ax = Math.min(sx, ox - 1.2), ay = GOAL_Y + dy; let m = 9, lc = 9; const wx = fx(p.team, ax); for (const o of opps(p)) { if (o.off) continue; if (!o.gk) m = Math.min(m, hyp(fx(p.team, o.x) - ax, o.y - ay)); const sd = segDist(o.x, o.y, own.x, own.y, wx, ay); if (sd.u > 0.05 && sd.u < 1) lc = Math.min(lc, sd.d); }
                const v = Math.min(m, 6) * 1.0 + Math.min(lc, 4) * 0.8 - Math.abs(dy) * 0.15 - (L - ax) * 0.12 - hyp(fx(p.team, p.x) - ax, p.y - ay) * 0.05; if (v > bs) { bs = v; bp = [ax, ay]; } }
              if (bp) { p.otRun.x = bp[0]; p.otRun.y = bp[1]; } }
            if ((p.uzFwT || 0) > S.t && p.otRun && S.t < p.otRun.until && own && own.team === p.team && own !== p && S.t >= (p.uzFwSpotT || 0)) {   // 渦潮の囮：もう1人のFWは、DFがいなくなった一番空いた所へ（持っている味方からのコースも空いている所）
              p.uzFwSpotT = S.t + 0.5; const olW = offsideLine(p.team); let bs = -1e9, bp = null;
              for (const dx of [-4, 0, 4, 8]) for (const dy of [-12, -8, -4, 0, 4, 8, 12]) { const ax = Math.min(olW + dx, L - 8), ay = clamp(GOAL_Y + dy, 5, W - 5), wx = fx(p.team, ax); let m = 9, lc = 9; for (const o of opps(p)) { if (o.off) continue; if (!o.gk) m = Math.min(m, hyp(o.x - wx, o.y - ay)); const sd = segDist(o.x, o.y, own.x, own.y, wx, ay); if (sd.u > 0.05 && sd.u < 1) lc = Math.min(lc, sd.d); }
                const v = Math.min(m, 7) + Math.min(lc, 4) * 0.6 - hyp(L - ax, GOAL_Y - ay) * 0.1 - hyp(fx(p.team, p.x) - ax, p.y - ay) * 0.04; if (v > bs) { bs = v; bp = [ax, ay]; } }
              if (bp) { p.otRun.x = bp[0]; p.otRun.y = bp[1]; } }
            if (p.otRun && S.t < p.otRun.until && p.run > 0) {
              // ワンツーの走り込み：裏のスペースへ。リターンが出るまではオフサイドラインを越えない
              const ret = b.intended === p.idx && !own;
              tx = ret ? p.otRun.x : Math.min(p.otRun.x, offL - 0.3); ty = p.otRun.y; u = true;
            } else if (p.run > 0) {
              tx = Math.min(offL + 9, L - 6); ty = ty + (GOAL_Y - ty) * 0.4; u = true;
              if (p.brTimed && skZ(p, 'behindRun') && !(b.intended === p.idx && !own)) tx = Math.min(tx, offL - 0.3);   /* 版789：うまい抜け出し（判断が高い）：パスが出るまではラインの手前で並走し、出た瞬間に裏へ */   /* v749：相手が深く守っている時に、ゴールラインの先（GKの横）まで走り込まない */
            } else {
              tx = Math.min(skZ(p, 'behindRun') && (s.last || p.run_space > 50) ? Math.max(tx, offL - 0.2) : tx, skZ(p, 'behindRun') ? offL - 0.2 : offL - 0.6); // オフサイドにならない位置で待つ（裏への抜け出し：最終ラインぎりぎり）
            }
            // 屈指の点取り屋：下がって受けに来ない。最終ラインぎりぎり・ゴール前の中央で待ち、ラストパスを仕留める
            if ((p.uniq === 'guren' || (p.type === 'ストライカー' && p.position === 'FW' && !(bWide && !globalThis.__noStX))) && !(p.otRun && S.t < p.otRun.until && p.run > 0) && bxf > L / 2 - 12 && (!own || own.idx !== p.idx)) { /* ストライカー：いつも最終ラインぎりぎり・ゴール前の真ん中で、決めるボールを待つ */ tx = Math.max(tx, Math.min(L - 9, offL - 0.8)); ty = GOAL_Y + (ty - GOAL_Y) * 0.5;
              /* 版447：攻撃の時は、DFを振り切ってゴール前の空いた所へ（オフサイドにならない範囲で、マークのいない所・持っている味方からのコースが空いている所） */
              if (!globalThis.__noStF && own && own.team === p.team) { if (!p.stF || S.t >= (p.stFT || 0)) { p.stFT = S.t + 0.35; let bs = -1e9, bp = null;
                for (const ax0 of [offL - 0.6, offL - 2]) for (const dy of [-10, -6, -3, 0, 3, 6, 10]) {   /* v758：下がって空いた所を探さない（最終ラインぎりぎりで横に動いて外す） */ const ax = Math.min(ax0, L - 7), ay = GOAL_Y + dy, wx = fx(p.team, ax); let m = 9, lc = 9; for (const o of opps(p)) { if (o.off || o.gk) continue; m = Math.min(m, hyp(o.x - wx, o.y - ay)); const sd = segDist(o.x, o.y, own.x, own.y, wx, ay); if (sd.u > 0.08 && sd.u < 0.95) lc = Math.min(lc, sd.d); }
                  const v = Math.min(m, 6) * 1.0 + Math.min(lc, 3) * 0.6 + ax * 0.12 - Math.abs(dy) * 0.08 - hyp(fx(p.team, p.x) - ax, p.y - ay) * 0.03 - Math.max(0, fx(p.team, p.x) - ax) * 0.5; if (v > bs) { bs = v; bp = [ax, ay]; } }
                p.stF = bp; }
                if (p.stF) { tx = Math.max(Math.min(p.stF[0], offL - 0.6), tx - 1); ty = p.stF[1]; u = u || hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 2.5; } } if (globalThis.__tgHook) { p._dbgS = S.t; p._dbgSx = tx; p._dbgOff = offL; } }
            if ((p.stPullT || 0) > S.t && p.stPullP && !(p.run > 0) && !bWide && own && own.team === p.team && own.idx !== p.idx && !(b.intended === p.idx && !own)) { tx = p.stPullP[0]; ty = p.stPullP[1]; u = false; }   // 版796：プルアウェイ（DFから離れて、足元で受ける間合いを作る）
            // 版664：タイプごとの動きのくせ（攻撃）。見ているだけで違いが分かるように、持ち場の取り方をはっきり変える
            if (!globalThis.__noTypeMove && (!own || own.idx !== p.idx) && !(p.run > 0) && !S.restart && !bWide) {
              const tt = p.type, side0 = Math.sign(p.slot.y - GOAL_Y) || (p.number % 2 ? 1 : -1);
              if (globalThis.__dcDbg && tt === 'デコイラン') { const G = globalThis.__dcDbg, mt = mates(p).find((m) => m !== p && m.position === 'FW' && !m.off); if (mt) { let md = 99; for (const o of opps(p)) if (!o.off) md = Math.min(md, hyp(o.x - mt.x, o.y - mt.y)); const k = p.dcUntil > S.t ? 'run' : 'idle'; G[k] = G[k] || [0, 0]; G[k][0]++; G[k][1] += md; } }
              const dcM = p.position === 'FW' && tt !== 'デコイラン' ? mates(p).find((m) => m !== p && m.dcUntil > S.t) : null;
              if (dcM) { ty = clamp(GOAL_Y + (GOAL_Y - dcM.dcY) * 0.45, 8, W - 8); tx = Math.max(tx, offL - 1.2); u = true; }   // 版794：囮が連れ出した逆側（空いた所）へ、相棒のFWが入る
              else if (tt === 'デコイラン' && p.dcUntil > S.t) { tx = Math.min(L - 9, offL + 4.5); ty = p.dcY; u = true; }   // 版794：囮の走り（裏へ斜めに）
              else if (tt === '偽9番') { tx = Math.min(tx, Math.max(bxf - 2, offL - 14), offL - 7); ty += (b.y - ty) * 0.45; }   // 中盤まで下りて受ける
              else if (tt === 'デコイラン') { tx = Math.max(tx, offL - 0.6); ty = GOAL_Y + Math.sin(S.t * 0.75 + p.idx * 1.3) * 15; u = true; }   // 最終ラインの上を横へ走り続けて、DFを引っぱる
              else if (tt === 'アタッカー') { ty += (GOAL_Y + side0 * 13 - ty) * 0.6; tx = Math.max(tx, offL - 1.5); }   // サイドの裏（ハーフスペース）をねらう
              else if (tt === 'レジスタ' && !globalThis.__noReg && own && own.team === p.team && (own.gk || own.position === 'DF') && bxf < L / 2 - 4 && mates(p).filter((m) => m.type === 'レジスタ' && m.position === 'MF' && !m.off).sort((m, n) => Math.abs(m.y - GOAL_Y) - Math.abs(n.y - GOAL_Y))[0] === p) {   // 版797：レジスタ：DF・GKが持ったら、CBの間まで下りて受ける（3枚目のCBのように）
                const cbs = mates(p).filter((m) => !m.off && !m.gk && m.position === 'DF' && Math.abs(m.y - GOAL_Y) < 15).map((m) => fx(tm.ti, m.x)); tx = (cbs.length ? cbs.reduce((a0, c0) => a0 + c0, 0) / cbs.length : Lx) - 0.5; ty = GOAL_Y; u = true;
                if (globalThis.__tyDbg) globalThis.__tyDbg.regDrop = (globalThis.__tyDbg.regDrop || 0) + 1; }
              else if (tt === 'レジスタ') { tx = Math.min(tx, Math.max(Lx + 8, bxf - 10)); ty = GOAL_Y + (ty - GOAL_Y) * 0.35 + (b.y - GOAL_Y) * 0.2; }   // DFのすぐ前、真ん中で受けて配る
              else if (tt === 'アンカー') { tx = Math.min(tx, Lx + 11); ty = GOAL_Y + (ty - GOAL_Y) * 0.25; }   // 上がらずに中盤の底を守る
              else if (tt === 'ゲームメイカー') {   // 版798：ゲームメイカー（シャビ）：持っている味方の近く（8〜12m）の、相手から一番離れた所に顔を出して、いつでも受けられる角度を作る
                tx = clamp(bxf + 5, Lx + 14, offL - 7); ty = GOAL_Y + (ty - GOAL_Y) * 0.4 + (b.y - GOAL_Y) * 0.3;
                if (!globalThis.__noGmSup && own && own.team === p.team && own !== p && bxf > Lx + 4 && bxf < offL - 4 && nearestOpp(own, own.x, own.y).d < 4) { if (!p.gmSup || S.t >= (p.gmSupT || 0)) { p.gmSupT = S.t + 0.5; let bs = -1e9, bp = null;
                  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, r = 10, sx = clamp(bxf + Math.cos(a) * r, Lx + 6, offL - 3), sy = clamp(b.y + Math.sin(a) * r, 6, W - 6), wx = fx(tm.ti, sx); let m = 9, lc = 9;
                    for (const o of opps(p)) { if (o.off) continue; m = Math.min(m, hyp(o.x - wx, o.y - sy)); const sd = segDist(o.x, o.y, b.x, b.y, wx, sy); if (sd.u > 0.1 && sd.u < 0.9) lc = Math.min(lc, sd.d); }
                    const v = Math.min(m, 7) + Math.min(lc, 3) * 0.9 - hyp(fx(tm.ti, p.x) - sx, p.y - sy) * 0.05 + (sx - bxf) * 0.03; if (v > bs) { bs = v; bp = [sx, sy]; } }
                  p.gmSup = bp; }
                  if (p.gmSup) { tx = p.gmSup[0]; ty = p.gmSup[1]; u = hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 4; } }
              }
              else if (tt === 'パサー') { ty += (GOAL_Y + side0 * 10 - ty) * 0.5; tx = Math.max(tx, Math.min(bxf + 3, offL - 8)); }   // 版798：パサー（デブライネ）：右・左のハーフスペース（サイドと真ん中の間）で、前向きに受ける
              else if (tt === 'ダイナモ') { tx = Math.max(tx, Math.min(bxf + 7, offL - 2)); ty += (b.y - ty) * 0.2; u = true; }   // ボールを追い越して前へ走る
              else if (tt === 'ファンタジスタ') { tx = Math.min(Math.max(tx, bxf + 3), offL - 4); ty += (b.y + Math.sin(S.t * 0.5 + p.idx) * 8 - ty) * 0.55; }   // ボールの近くを自由に動き回る
              else if (tt === 'シャドー') { if (bxf > L / 2 - 6) { tx = Math.max(tx, Math.min(offL - 1.5, bxf + 11)); ty = GOAL_Y + (ty - GOAL_Y) * 0.45; u = true; } }   // FWの後ろから、ゴール前へ飛び込む
              else if (tt === 'スイーパー' && s.line === 0) { tx = Math.min(tx, Lx + 1); }   // 上がらずに後ろを守る
              else if (tt === 'ビルドアップ型' && s.line === 0 && bxf < L / 2 + 6) { tx = Math.max(tx, Math.min(bxf - 4, L / 2 - 4)); ty += (b.y - ty) * 0.3; }   // 中盤へ持ち上がって、組み立てに加わる
            }
            // 版841：カウンター：奪った直後は、ボールより前・前線の選手が一気にゴールへ走る（サイドは外のレーン、真ん中はゴール前へ）。持つ人の両側を追い越して数で上回る
            if (S.counter > 0 && s.line >= 1 && !p.run && own && own.team === tm.ti && own !== p && (fx(tm.ti, p.x) > bxf - 16 || s.last)) {
              tx = Math.max(tx, Math.min(offL - 0.5, bxf + (fx(tm.ti, p.x) > bxf - 4 ? 14 : 6))); ty = wide ? GOAL_Y + Math.sign(s.y - GOAL_Y) * 19 : GOAL_Y + (ty - GOAL_Y) * 0.5; u = true;
              if (globalThis.__ctDbg) globalThis.__ctDbg.run++; }
            // 版843：こぼれ球待ち：ゴール前で攻めている時、中盤の1人（ミドルが打てる選手ほど）はエリアの外（ゴールまで約20m）に残り、クリア・はじかれたボールを拾う
            if (bxf > L - 30 && s.line >= 1 && !wide && !s.last && !(p.run > 0) && own && own.team === tm.ti && own !== p && p.boxIn !== S.t && !(tm.ovl && tm.ovl.spot[p.idx] != null)) {
              if (tm.rbT !== S.t) { tm.rbT = S.t; const c = tm.players.filter((m) => m !== own && !m.off && !m.gk && m.slot && m.slot.line >= 1 && !m.slot.last && Math.abs(m.slot.y - GOAL_Y) <= 14 && !(tm.ovl && tm.ovl.spot[m.idx] != null)).sort((a, c2) => (c2.kick + c2.technique + (c2.sk.has('volley') ? 30 : 0) + (c2.sk.has('powerMid') ? 30 : 0)) - (a.kick + a.technique + (a.sk.has('volley') ? 30 : 0) + (a.sk.has('powerMid') ? 30 : 0)))[0]; tm.rbP = c ? c.idx : -1; }
              if (tm.rbP === p.idx) { tx = L - 20.5; ty = GOAL_Y + (b.y - GOAL_Y) * 0.25 + Math.sin(S.t * 0.6 + p.idx) * 2; p.rbWait = S.t; }
            }
            // 版843：崩しの局面：選ばれた選手は、ボールのまわりの決まった場所（斜め前の内側・斜め後ろ・ライン際・外側の追い越し）へ寄る
            if (tm.ovl && tm.ovl.until > S.t && own && own.team === tm.ti && own !== p && !(p.run > 0 && p.otRun && S.t < p.otRun.until) && !(b.intended === p.idx && !own) && tm.ovl.spot[p.idx] != null && p.boxIn !== S.t && !(bWide && (s.last || p.position === 'FW' || p.cbWaitT === S.t))) {
              const k = tm.ovl.spot[p.idx], ox = fx(tm.ti, own.x), oy = own.y, sd = Math.sign(GOAL_Y - oy) || 1, cen = Math.abs(oy - GOAL_Y) < 8;
              const sp = [[Math.min(ox + 9, offL - 0.6, L - 9), cen ? oy + 9 : oy + sd * 10], [ox - 7, cen ? oy - 9 : oy + sd * 7], [Math.min(offL - 0.5, ox + 14, L - 8), cen ? oy - 4 : oy + sd * 15], [Math.min(ox - 3, offL - 1), cen ? oy + 14 : oy - sd * 9]][k];   // 版844：近すぎて団子にならないよう、8〜15m離れて三角形を作る
              tx = sp[0] + Math.sin(S.t * 0.9 + p.idx) * 1.5; ty = clamp(sp[1] + Math.cos(S.t * 0.7 + p.idx) * 1.5, 3, W - 3); u = hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 4; p.ovlOn = S.t;
            }
            // 版841：攻めている時の備え：CBは上がりすぎない（ボールから20m後ろまで）。両SBが上がっている時は、ボールと逆のSBが内へ絞って残る
            if (s.line === 0 && !(p.ovUntil > S.t) && p.ovlOn !== S.t && bxf > L / 2 && !(S.counter > 0)) {
              if (!wide) tx = Math.min(tx, Math.max(L / 2 - 8, bxf - 20));
              else if (Math.sign(b.y - GOAL_Y) !== Math.sign(s.y - GOAL_Y)) { const other = tm.players.find((m) => m !== p && !m.off && m.slot && m.slot.line === 0 && Math.abs(m.slot.y - GOAL_Y) >= 9 && Math.sign(m.slot.y - GOAL_Y) !== Math.sign(s.y - GOAL_Y));
                if (other && (fx(tm.ti, other.x) > bxf - 12 || other.ovUntil > S.t)) { tx = Math.min(tx, bxf - 16); ty += (GOAL_Y - ty) * 0.45; } }
            }
            // 味方と重なりすぎない
            for (const m of tm.players) {
              if (m === p || m.gk) continue;
              const d = hyp(fx(tm.ti, m.x) - tx, m.y - ty), mn = p.ovlOn === S.t ? 7 : 9;   // 版843：崩しの局面では、近い距離で立つ
              if (d < mn) { ty += (ty >= m.y ? 1 : -1) * (mn - d) * 0.5; }
            }
          } else {
            // 守備
            if (p.zone_man < 0 && s.line === 0) tx -= -p.zone_man * 0.06; // ゾーンの最終ラインは少し深く
            // 最終ラインの選手（SB・CB）：ボールと逆サイドにいる時は、内へ絞ってゴール前を固める（抜かれた時のカバーが間に合う位置）
            const sbW = s.line === 0 && Math.abs(s.y - GOAL_Y) >= 12 && !tm.players.some((m) => m !== p && !m.off && m.slot && m.slot.line === 0 && Math.sign(m.slot.y - GOAL_Y) === Math.sign(s.y - GOAL_Y) && Math.abs(m.slot.y - GOAL_Y) > Math.abs(s.y - GOAL_Y) + 3);   // SB（最終ラインのいちばん外側。5バックの外から2番目はCB扱い）
            const farS = s.line === 0 && Math.sign(ty - GOAL_Y) !== Math.sign(b.y - GOAL_Y) && Math.abs(b.y - GOAL_Y) > 6;
            // CBが釣り出された（保持者へ寄せに出た／外へ引っぱられた）：SBは空いた中央へ予め絞る
            const cbOut = sbW && (Math.sign(s.y - GOAL_Y) !== Math.sign(b.y - GOAL_Y) || Math.abs(b.y - GOAL_Y) < 8) && !(own && own.team !== tm.ti && Math.sign(own.y - GOAL_Y) === Math.sign(s.y - GOAL_Y) && Math.abs(own.y - GOAL_Y) > 10) && tm.players.some((m) => m !== p && !m.gk && !m.off && m.slot && m.slot.line === 0 && Math.abs(m.slot.y - GOAL_Y) < 12 && (pressers.has(m.idx) || Math.abs(m.y - GOAL_Y) > 13 || fx(tm.ti, m.x) > fx(tm.ti, p.x) + 9));
            if (farS || cbOut) { ty = GOAL_Y + (ty - GOAL_Y) * (cbOut ? 0.3 : 0.28); tx -= 1; }   // 逆サイドのSBは中央（CBの隣）まで絞ってカバーリング
            else if (s.line === 0 && bxf < 40) ty = GOAL_Y + (ty - GOAL_Y) * 0.8;   // ゴールに近づかれたら、ボール側も少し絞る
            // 5バック：真ん中のCBは全体の底からカバー（少し下がり、ボールの方へ少しずれる）。ボールが中央にある時は、両端のウイングバックも内へ絞る
            const back5 = s.line === 0 && tm.players.filter((m) => !m.off && m.slot && m.slot.line === 0).length >= 5;
            const sweep5 = back5 && Math.abs(s.y - GOAL_Y) < 4; p.b5 = back5 ? S.t : 0;
            if (s.line === 1 && tm.players.filter((m) => !m.off && m.slot && m.slot.line === 0).length >= 5) { tx -= 3; ty = GOAL_Y + (ty - GOAL_Y) * 0.85; }
            if (s.line === 0) {   // 影縫いでひがしが持ち場を離れたら、近い方のWB／SB（いなければCB）が内へ絞り、空いた所の近くにいる相手から守る
              const kgm = tm.players.find((m) => m !== p && !m.off && m.kgT && uOn(m, 'kagenui') && m.slot && m.slot.line === 0);
              if (kgm) { const kx = Lx + kgm.slot.rel * 0.8, ky = kgm.slot.y + shiftY * 0.8;
                if (hyp(fx(tm.ti, kgm.x) - kx, kgm.y - ky) > 7) {
                  const side = Math.sign(kgm.slot.y - GOAL_Y) || 1, cands = tm.players.filter((m) => m !== kgm && !m.off && !m.gk && m.slot && m.slot.line === 0);
                  const outer = (m) => Math.abs(m.slot.y - GOAL_Y) >= 12 && !cands.some((o) => o !== m && Math.sign(o.slot.y - GOAL_Y) === Math.sign(m.slot.y - GOAL_Y) && Math.abs(o.slot.y - GOAL_Y) > Math.abs(m.slot.y - GOAL_Y) + 3);
                  const cv = cands.find((m) => outer(m) && Math.sign(m.slot.y - GOAL_Y) === side) || cands.slice().sort((a, c) => Math.abs(a.slot.y - kgm.slot.y) - Math.abs(c.slot.y - kgm.slot.y))[0];
                  if (cv === p) {   // 空いた所の近くにいる相手（中の選手ほど危ない）から守る。いなければ、その場所へ絞る
                    const gx0 = fx(tm.ti, 0); let foe = null, fv = 1e9;
                    for (const o of opps(p)) { if (o.off || o.gk || o.idx === kgm.kgT) continue; const ox = fx(tm.ti, o.x); if (ox > 40) continue; const v = hyp(ox - kx, o.y - ky) + Math.abs(o.y - GOAL_Y) * 0.35; if (v < fv && hyp(ox - kx, o.y - ky) < 16) { fv = v; foe = o; } }
                    if (foe) { const gl = hyp(gx0 - foe.x, GOAL_Y - foe.y) || 1; tx = fx(tm.ti, foe.x + (gx0 - foe.x) / gl * 1.3); ty = foe.y + (GOAL_Y - foe.y) / gl * 1.3; }
                    else { tx += (kx - tx) * 0.85; ty += (ky - ty) * 0.85; }
                    p.kgCover = S.t; u = true; } } }
            }
            if (s.line >= 1 && p.position !== 'FW' && bxf < 36) { tx = Math.min(tx, bxf + 1.5); ty += (b.y - ty) * 0.25; }
            if (s.line >= 1 && p.position !== 'FW' && bxf < 24 && !globalThis.__noBoxD) { tx = Math.min(tx, Math.max(9, Math.min(15, bxf - 5))); ty = GOAL_Y + (ty - GOAL_Y) * 0.6 + (b.y - GOAL_Y) * 0.15; u = hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 4; }   // 版843：ゴール前まで来られたら、中盤もペナルティエリアの中まで戻って人数で固める（シュートコースに体を入れる）
            else if (s.line === 0 && bxf < 22 && !globalThis.__noBoxD) tx = Math.min(tx, Math.max(6, Math.min(13, bxf - 1)));   // 版843：最終ラインも、ボールがゴール前まで来たらエリアの中まで下がって守る
            else if (s.line >= 1 && p.position === 'FW' && bxf < 24 && !s.last) { tx = Math.min(tx, 24); ty += (GOAL_Y - ty) * 0.3; }   // 前の選手も、エリアの外（こぼれ球の所）まで戻る   // ゴール前に攻め込まれたら、中盤はボールより後ろ（ゴール側）へ戻り、ボールの方へ寄って、シュートを打つスペースを消す   // 5バックの中盤：少し下がって幅を詰め、DFラインの前で壁を作る（ミドルを打たせない）
            p.sw5 = sweep5 && p.type === 'スイーパー' ? S.t : 0;   // 真ん中のスイーパー：カバーが上手い（下の読み・競り合いの補正）
            if (sweep5) { tx -= 1.0; ty = GOAL_Y + (b.y - GOAL_Y) * 0.2; if (p.sw5) u = true; }
            else if (back5 && sbW && !farS && !cbOut && Math.abs(b.y - GOAL_Y) < 14) ty = GOAL_Y + (ty - GOAL_Y) * 0.85;
            if (back5 && sbW && fx(tm.ti, p.x) > bxf - 6) u = true;   // 上がっていたウイングバックは、ボールを失ったら全力で戻る
            if (p.mark >= 0) {
              const q = P[p.mark];
              let w = clamp(Math.max(p.zone_man, tm.urg && p.slot.line > 0 ? 70 : 0, skZ(p, 'manMark') || p.markHard ? 95 : 0) / 85, 0, 1);
              if (sweep5 && !p.markHard) w *= 0.7;
              if (p.type === 'ストッパー' && !p.markHard && !globalThis.__stpOld && fx(tm.ti, q.x) > Lx + 6) w *= 0.25;   // 版807：ストッパー：DFラインから離れて下がる相手には、ついて行きすぎない（ラインに残る）
              if (p.kgCover === S.t) w = 0;   // 影縫いで空いた所をカバー中（狙う相手は上で決めている）   // 5バックの真ん中は、人より後ろのスペースを見る
              if (q.position === 'FW' && q.uniq !== 'uzushio' && teamU(q.team, 'uzushio')) w *= 0.35;   // 渦潮の囮：ほかのFWのマークがゆるむ
              if (q.position === 'FW') { const a = aura(q, 'decoy'); if (a) w *= 1 - 0.22 * a; }               // おとり
              if (q.uniq === 'guren') w *= 0.4 + 0.6 * Math.abs(Math.sin(S.t * 0.9 + q.idx));   // 屈指の点取り屋：マークを外す動き（時々フリーになる）
              { const a = aura(p, 'eyesOn', true); if (a) w = Math.min(1, w * (1 + 0.15 * a)); }               // 目を離すな
              // マークの基本：ゴール（中央）と相手を結んだ線の上、相手のゴール側に立つ。ボールから遠い相手ほど、少し下がって（絞って）ボールの状況を見る
              const gwx = fx(tm.ti, 0), gl = hyp(gwx - q.x, GOAL_Y - q.y) || 1, dBall = hyp(b.x - q.x, b.y - q.y);
              const dm = (skZ(p, 'manMark') || p.markHard ? 0.9 : 1.6) + (p.markHard ? 0 : Math.min(5, Math.max(0, dBall - 12) * 0.18)) + ((farS || cbOut) && dBall > 14 ? Math.min(9, gl * 0.3) : 0);   // 逆サイド／CBが釣り出された：相手とゴールの間、さらに内側（ゴール寄り）で待つ
              if ((farS || cbOut) && dBall > 14 && p.type !== 'マンマーカー') w *= farS && dBall > 22 ? 0.35 : 0.7;   // ボールから遠い相手は、ついて行かずに中で待つ（マンマーカーはどこまでもついて行く）
              if (p.type === 'マンマーカー' && !sweep5) w = Math.max(w, 0.97);
              if (!globalThis.__noTypeMove && !globalThis.__noSwW && p.type === 'スイーパー' && !sweep5 && !p.markHard) w *= 0.55;   // スイーパー：人につかず、ラインの後ろのスペースを見る
              const wx = q.x + (gwx - q.x) / gl * dm, wy = q.y + (GOAL_Y - q.y) / gl * dm, mx = fx(tm.ti, wx), my = wy;
              tx += (mx - tx) * w; ty += (my - ty) * w;
              u = w > 0.6;
            }
            // 版664：タイプごとの動きのくせ（守備）
            if (!globalThis.__noTypeMove && !S.restart) {
              const tt = p.type;
              if (tt === 'スイーパー' && s.line === 0 && !sweep5) { const lm = tm.players.filter((m) => m !== p && !m.off && !m.gk && m.slot && m.slot.line === 0).map((m) => fx(tm.ti, m.x)); tx = Math.min(tx, Lx - 1, lm.length ? Math.min(...lm) - 1 : tx);   /* 版800：スイーパーもDFラインに並ぶ（1mだけ後ろ） */ { const gk = tm.players.find((m) => m.gk && !m.off); tx = Math.max(tx, gk ? fx(tm.ti, gk.x) + 3 : 0, 6); }   /* 版733：GKより後ろには下がらない（GKの3m前・ゴールラインから6mより前） */ if (fx(tm.ti, p.x) > tx + 2) u = true; ty = GOAL_Y + (ty - GOAL_Y) * 0.55 + (b.y - GOAL_Y) * 0.2; }   // DFラインの後ろで、抜かれた時に備える
              else if (tt === 'ストッパー' && s.line === 0 && b.kind === 'pass' && b.lastTeam !== tm.ti && b.intended >= 0 && P[b.intended] && P[b.intended].team !== tm.ti && !P[b.intended].gk && P[b.intended].position === 'FW' && hyp(P[b.intended].x - p.x, P[b.intended].y - p.y) < 8 && fx(tm.ti, P[b.intended].x) < Lx + 7 && fx(tm.ti, P[b.intended].x) < 40) {   // 版800：ストッパー：相手FWにパスが入る瞬間、背中から強く寄せる（版807：DFラインのすぐ前・8m以内の相手FWだけ）
                const rc = P[b.intended], gx = fx(tm.ti, 0), gl = hyp(gx - rc.x, GOAL_Y - rc.y) || 1; tx = fx(tm.ti, rc.x + (gx - rc.x) / gl * 0.7); ty = rc.y + (GOAL_Y - rc.y) / gl * 0.7; u = true; if (p.stpJ !== b.passT) { p.stpJ = b.passT; if (globalThis.__tyDbg) globalThis.__tyDbg.stopJump = (globalThis.__tyDbg.stopJump || 0) + 1; } }
              else if (tt === 'ストッパー' && s.line === 0 && bxf < 40 && bxf < Lx + 10 && Math.abs(b.y - ty) < 12) { tx = Math.max(tx, Math.min(bxf - 2, Lx + 3)); ty += (b.y - ty) * 0.25; }   // 版807：ふだんはDFラインに残り、ボールがラインのすぐ前に来た時だけ、少し（3mまで）前に出て当たる
              else if (tt === 'ラインコントローラー' && s.line === 0) { tx += 2.5; }   // ラインを高く保つ
              else if (tt === 'アンカー') { tx = Math.min(tx, Lx + 7); ty += (b.y - ty) * 0.3; }   // DFラインのすぐ前で、真ん中のコースを消す
              else if (tt === 'ダイナモ' && own && own.team !== tm.ti && S.t - (tm.lostT ?? -9) < 3.5 && hyp(p.x - own.x, p.y - own.y) < 24) { tx = fx(tm.ti, own.x); ty = own.y; u = true; if (p.dyT !== tm.lostT) { p.dyT = tm.lostT; if (globalThis.__tyDbg) globalThis.__tyDbg.dynPress = (globalThis.__tyDbg.dynPress || 0) + 1; } }   // 版797：ダイナモ：奪われた瞬間、一番に奪い返しに全力で走る
              else if (tt === 'ダイナモ') { tx += (bxf - tx) * 0.35; ty += (b.y - ty) * 0.35; u = true; }   // ボールへ走って奪いに行く
              else if (tt === 'ストライカー' && p.position === 'FW') { tx = Math.max(tx, Math.min(L / 2 + 6, bxf + 18)); }   // 守備に戻らず、前で待つ
              else if (tt === 'デコイラン' && p.position === 'FW') { tx = Math.max(tx, L / 2 - 2); ty = GOAL_Y + Math.sin(S.t * 0.6 + p.idx) * 12; }
            }
            { // 版794：囮（デコイラン）の走りに、つられてついて行くDF
              const dq = opps(p).find((q) => q.dcUntil > S.t && q.dcPull && q.dcPull.includes(p.idx));
              if (dq && globalThis.__dcDbg) { const G = globalThis.__dcDbg, ph = (dq.dcUntil - S.t) > 1.8 ? 'a' : (dq.dcUntil - S.t) > 0.9 ? 'b' : 'c'; G[ph] = G[ph] || [0, 0, 0]; G[ph][0]++; G[ph][1] += hyp(p.x - dq.x, p.y - dq.y); G[ph][2] += hyp(p.vx || 0, p.vy || 0); }
              if (dq && !p.gk && !globalThis.__dcNoFollow) { const gx = fx(tm.ti, 0), gl2 = hyp(gx - dq.x, GOAL_Y - dq.y) || 1; const ax = dq.x + (dq.vx || 0) * 0.7, ay = dq.y + ((dq.dcY || dq.y) - dq.y) * 0.25 + (dq.vy || 0) * 0.4; tx = fx(tm.ti, ax + (gx - ax) / gl2 * 1.1); ty = ay + (GOAL_Y - ay) / gl2 * 1.1; u = true; }
            }
            if (skZ(p, 'recovery') && fx(tm.ti, p.x) > bxf + 4) u = true;   // 帰陣ダッシュ：ボールより前に残っていたら全力で戻る
            // 版837：帰陣ダッシュ（目に見える形に）：ボールを失った直後、ボールより前にいたら、すぐにボールより後ろ（ゴール側）へ一直線に全力で戻る。少し速くなる
            if (p.sk.has('recovery') && !p.gk && !S.restart && !S.setPiece && S.t - (tm.atkT ?? -9) < 1.5 && fx(tm.ti, p.x) > bxf + 3 && !(p.recUntil > S.t) && S.t > (p.recNext || 0)) {
              p.recUntil = S.t + R.range(2.6, 3.4); p.recNext = p.recUntil + R.range(5, 8); act(p, 'recrun', p.recUntil - S.t); /* 版839：帰陣ダッシュは吹き出しなし（オレンジの風の線だけ） */ if (globalThis.__tyDbg) globalThis.__tyDbg.rec = (globalThis.__tyDbg.rec || 0) + 1; }
            // 版838：インターセプト：持っている相手から、自分の近くの相手へのパスコースに先回りして立つ（パスを読んでいる）
            if (p.sk.has('intercept') && !p.gk && own && own.team !== tm.ti && !pressers.has(p.idx) && !S.restart) {
              let bq = null, bd = 14; for (const o of opps(p)) { if (o.off || o === own || o.gk) continue; const d0 = hyp(o.x - p.x, o.y - p.y); if (d0 < bd) { bd = d0; bq = o; } }
              if (bq) { const lx = own.x + (bq.x - own.x) * 0.7, ly = own.y + (bq.y - own.y) * 0.7; tx += (fx(tm.ti, lx) - tx) * 0.35; ty += (ly - ty) * 0.35; }
            }
            if (p.recUntil > S.t && !pressers.has(p.idx)) { if (fx(tm.ti, p.x) > bxf - 4) { tx = Math.min(tx, bxf - 5); ty += (b.y - ty) * 0.25; } else p.recUntil = 0; u = true; }
            if (pressers.has(p.idx)) {
              // ボール保持者へ寄せる：ゴール側から間合いを詰める（抜かれにくい位置）
              const tgt = own || b, gx0 = fx(tm.ti, 0);
              let ax = tgt.x, ay = tgt.y;
              if (own && p.breakT === S.t) { const lt = Math.min(1.4, hyp(p.x - own.x, p.y - own.y) / maxSpeed(p)); ax += own.vx * lt; ay += own.vy * lt; }   // 抜け出した相手には、行く先へ斜めに詰める（後ろから並走しない）
              const dx = gx0 - ax, dy = GOAL_Y - ay, dl = hyp(dx, dy) || 1;
              const gap = own ? (p.breakT === S.t ? 1.6 : 0.9) : 0;
              tx = fx(tm.ti, ax + (dx / dl) * gap); ty = ay + (dy / dl) * gap; u = true;
            } else if (recvPress === p.idx) {
              // 横パスの受け手へ：ボールが着く頃の位置の、ゴール側へ詰める
              const r = P[b.intended], ta = Math.min(1.5, hyp(r.x - b.x, r.y - b.y) / Math.max(6, hyp(b.vx, b.vy))), rx = r.x + r.vx * ta, ry = r.y + r.vy * ta, gx0 = fx(tm.ti, 0), dl = hyp(gx0 - rx, GOAL_Y - ry) || 1;
              tx = fx(tm.ti, rx + (gx0 - rx) / dl * 1.1); ty = ry + (GOAL_Y - ry) / dl * 1.1; u = true;
            } else if (coverer[tm.ti] === p.idx) {
              // カバー：保持者とゴールの間、少し下がった位置で中央のコースを消す
              const tgt = own || b, gx0 = fx(tm.ti, 0);
              const dx = gx0 - tgt.x, dy = GOAL_Y - tgt.y, dl = hyp(dx, dy) || 1, k = Math.min(6, dl * 0.35);
              tx = fx(tm.ti, tgt.x + (dx / dl) * k); ty = tgt.y + (dy / dl) * k; u = true;
            }
            // 再開時は9.15m離れる
            if (S.restart && S.restart.team !== tm.ti) {
              const d = hyp(fx(tm.ti, S.restart.x) - tx, S.restart.y - ty);
              if (d < 9.2) { const a = Math.atan2(ty - S.restart.y, tx - fx(tm.ti, S.restart.x)); tx = fx(tm.ti, S.restart.x) + Math.cos(a) * 9.5; ty = S.restart.y + Math.sin(a) * 9.5; }
            }
          }
          if (freeBall && (chasers[tm.ti] === p.idx || chasers2[tm.ti] === p.idx)) { tx = fx(tm.ti, p._cx); ty = p._cy; u = true; chasing[p.idx] = 1; }
          // 自陣ゴールに球が向かっている：ゴール前にいるDFは全員、ボールの通り道（ゴールラインの手前）へ戻って防ぎに行く（マークより優先）
          else if (goalDanger[tm.ti] && !p.gk && fx(tm.ti, p.x) < 24) {
            let bd = 1e9, bp = null;
            for (const q of goalDanger[tm.ti]) { if (fx(tm.ti, q[0]) < 0.5) continue; const dd = hyp(q[0] - p.x, q[1] - p.y); if (dd < bd) { bd = dd; bp = q; } }
            if (bp) { tx = fx(tm.ti, bp[0]); ty = bp[1]; u = true; }
          }
          // GKがボールを持っている間は、相手ペナルティエリアから出て待つ
          if (!attacking && gkHolding && tx > L - 18) tx = L - 18 - ((p.number * 13) % 6);
          // 守備でも味方と重ならない（同じボールに2人で寄って被らない）
          if (!attacking && !pressers.has(p.idx) && coverer[tm.ti] !== p.idx && !chasing[p.idx]) {
            for (const m of tm.players) {
              if (m === p || m.gk) continue;
              const d = hyp(fx(tm.ti, m.x) - tx, m.y - ty);
              if (d < 6) { ty += (ty >= m.y ? 1 : -1) * (6 - d) * 0.5; }
            }
          }
          if (S.restart && S.restart.taker === p.idx) { const rr = S.restart, fb = rr.type === 'throw' && (rr.stage === 'fetch' || rr.stage === 'settle'); tx = fx(tm.ti, fb ? S.ball.x : rr.x); ty = fb ? S.ball.y : rr.y; u = true; }
          if (S.celebrate > 0) {
            chasing[p.idx] = 0;   // キックオフ待ち：センターに置かれたボールを「こぼれ球」として追いかけない（中央で止まってしまうバグ）
            const ko = kickoffSpot(p, S.kickoffTeam); tx = ko[0]; ty = ko[1]; u = S.celebrate < 3.5;
            // ゴール直後：決めた選手はコーナーへ走って喜び、味方が駆け寄る
            if (S.celebrate > S.cel0 - 4.2 && p.team === S.scoreTeam && S.scorer >= 0) {
              const sc = P[S.scorer];
              if (p.idx === S.scorer) { tx = fx(tm.ti, S.celebSpot[0]); ty = S.celebSpot[1]; u = true; }
              else if (hyp(p.x - sc.x, p.y - sc.y) < 40) { const a = p.idx * 1.7; tx = fx(tm.ti, sc.x + Math.cos(a) * 1.6); ty = sc.y + Math.sin(a) * 1.6; u = true; }
            }
            // 失点した側：しばらくその場で立ち尽くして悔しがる
            if (p.team !== S.scoreTeam && S.celebrate > S.cel0 - 4) { tx = fx(tm.ti, p.x); ty = p.y; u = false; }
            // 負けている側の得点：喜ばずに、すぐ自分の位置へ。取りに行く選手は、ネットのボール → センターへ
            if (S.hurry && p.team === S.scoreTeam) {
              u = true;
              { const ko = kickoffSpot(p, S.kickoffTeam); tx = ko[0]; ty = ko[1]; }   // 駆け寄らずに、自分の位置へ
              if (p.idx === S.hurry.i) {
                const h = S.hurry, b = S.ball;
                if (h.stage === 'net') { tx = fx(tm.ti, b.x); ty = b.y; }
                else if (h.stage === 'carry') { tx = fx(tm.ti, L / 2); ty = W / 2; }
              }
            }
          }
          if ((T[tm.ti].mdShape || 0) > S.t && attacking && p.position === 'DF' && !p.gk && !S.restart && !(own && own.idx === p.idx) && !chasing[p.idx] && !(b.kind === 'pass' && b.intended === p.idx)) { const capX = L / 2 - 4; if (tx > capX) { tx = capX; u = hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 6; } if (S.t - (p.mdGuardT || -9) > 2) { p.mdGuardT = S.t; act(p, 'mdguard', 2.1, {}); } }   /* 版449 翠の起点：組み立てている間も、DFはハーフラインの手前で守備の形を保つ（取られても崩れない） */
          if (p.type === 'アンカー' && p.position === 'MF' && !p.gk && !S.restart && !(S.celebrate > 0) && !(own && own.idx === p.idx) && !chasing[p.idx] && !(b.kind === 'pass' && b.intended === p.idx) && !(pressers.has(p.idx) && hyp(p.x - S.ball.x, p.y - S.ball.y) < 9 && fx(tm.ti, S.ball.x) > fx(tm.ti, p.x) - 1)) {   // アンカー：攻撃の時も上がらず、CBの少し前（真ん中）にいて、来た相手を正面で止める
            const dfx = tm.players.filter((q) => !q.off && !q.gk && q.position === 'DF').map((q) => fx(tm.ti, q.x)).sort((a2, c2) => a2 - c2), defL = dfx.length ? dfx[Math.floor(dfx.length / 2)] : 25;
            tx = Math.min(defL + (attacking ? 9 : 5.5), attacking ? L / 2 + 6 : L); ty = clamp(GOAL_Y + (S.ball.y - GOAL_Y) * 0.3, GOAL_Y - 12, GOAL_Y + 12); u = hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 6;
            if (!attacking && !globalThis.__noAnc) {   // 版797：アンカー：相手の縦パスのコース（ボールと、一番前の真ん中の相手の間）に立ち、縦パスが入ったら真っ先に寄せる
              const rc = b.kind === 'pass' && b.lastTeam !== tm.ti && b.intended >= 0 ? P[b.intended] : null;
              if (rc && !rc.gk && hyp(rc.x - p.x, rc.y - p.y) < 9 && fx(tm.ti, rc.x) > defL + 1 && fx(tm.ti, rc.x) < defL + 16) { const gx = fx(tm.ti, 0), gl = hyp(gx - rc.x, GOAL_Y - rc.y) || 1; tx = fx(tm.ti, rc.x + (gx - rc.x) / gl * 1.2); ty = rc.y + (GOAL_Y - rc.y) / gl * 1.2; u = true; if (p.ancJ !== b.passT) { p.ancJ = b.passT; if (globalThis.__tyDbg) globalThis.__tyDbg.ancJump = (globalThis.__tyDbg.ancJump || 0) + 1; } }
              else if (own && own.team !== tm.ti) { const fwd = T[1 - tm.ti].players.filter((q) => !q.off && !q.gk && q !== own && Math.abs(q.y - GOAL_Y) < 14).sort((m, n) => fx(tm.ti, m.x) - fx(tm.ti, n.x))[0];
                if (fwd && hyp(fwd.x - own.x, fwd.y - own.y) < 30) { const mx = own.x + (fwd.x - own.x) * 0.6, my = own.y + (fwd.y - own.y) * 0.6; tx = Math.max(defL + 4, Math.min(fx(tm.ti, mx), defL + 8)); ty = clamp(ty + (my - ty) * 0.6, GOAL_Y - 11, GOAL_Y + 11); u = hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 3; } }
            } }
          if (!globalThis.__noSh && p.type === 'シャドー' && p.position === 'MF' && mainShadow(tm.ti) === p && !p.gk && !S.restart && !(S.celebrate > 0) && !(own && own.idx === p.idx) && !chasing[p.idx] && !(b.kind === 'pass' && b.intended === p.idx)) {   /* 版444：シャドー：いつも相棒のFW（点取り屋）の近くにいる。攻撃の時はFWの6〜8m後ろ、守備の時も前に残る（ハーフライン付近より下がらない） */
            const fw = aceFw(tm.ti, p); if (fw) { const fwX = fx(tm.ti, fw.x), olS = offsideLine(tm.ti);
              if (attacking) { const ax = Math.min(fwX - 7, olS - 2.5); if (tx < ax || Math.abs(fx(tm.ti, p.x) - fwX) > 12) { tx = ax; ty = clamp(fw.y + (GOAL_Y - fw.y) * 0.35 + (p.slot.y > GOAL_Y ? 3 : -3), 6, W - 6); u = hyp(fx(tm.ti, p.x) - tx, p.y - ty) > 5; } }
              else { const ax = Math.min(fwX - 13, L / 2 + 2); if (tx < ax) { tx = ax; ty = clamp(GOAL_Y + (fw.y - GOAL_Y) * 0.5 + (S.ball.y - GOAL_Y) * 0.2, 8, W - 8); } } } }
          if (!globalThis.__noStay && !attacking && !S.restart && !(S.celebrate > 0) && !p.gk && p.position === 'FW' && (p.type === 'ストライカー' || p.type === '偽9番') && !(chasing[p.idx] && fx(tm.ti, S.ball.x) > L / 2) && !(own && own.team === tm.ti)) {   // 偽9番・ストライカー：守備はほぼしない（こぼれ球を追うのは相手陣内だけ）：守備の時も、相手のDFラインに残る（奪ったらすぐ前で受けられる）
            const xs = T[1 - tm.ti].players.filter((q) => !q.off).map((q) => fx(tm.ti, q.x)).sort((a2, c2) => c2 - a2), lineD = xs[1] ?? L - 20;
            const dfs = T[1 - tm.ti].players.filter((q) => !q.off && !q.gk && q.position === 'DF'), sy = GOAL_Y + (p.slot.y - GOAL_Y) * 0.5, cb = dfs.sort((a2, c2) => Math.abs(a2.y - sy) - Math.abs(c2.y - sy))[0];   // いちばん近い相手DF（CB）のそば
            tx = clamp(Math.min(lineD - 0.8, cb ? fx(tm.ti, cb.x) - 1 : lineD), L / 2 + 1, L - 12); ty = clamp(cb ? cb.y + (sy > cb.y ? 1.5 : -1.5) : sy, 6, W - 6); u = false; }
          if (own && own.idx === p.idx) { tx = fx(tm.ti, p.x); ty = p.y; }
          if (globalThis.__tgHook) { p._dbgT = S.t; p._dbgTx = tx; }
          const offOk = (S.restart && S.restart.taker === p.idx) || (S.hurry && S.celebrate > 0 && S.hurry.i === p.idx);   // ネットの中までボールを取りに行く
          if (attacking && !chasing[p.idx] && !(own && own.idx === p.idx) && !S.restart && S.ball.intended !== p.idx && !(S.hurry && S.celebrate > 0 && S.hurry.i === p.idx)) tx = Math.min(tx, L - 6);   /* 版781：ネットのボールを取りに行く選手は除く（ゴールの手前で止まって、ずっと取りに行けなかった） */   /* v749：攻めている時、ボールを追っていない選手は、ゴールラインから6mより奥（GKの横）には立たない */
          targets[p.idx] = [fx(tm.ti, clamp(tx, offOk ? -4 : 0.8, offOk ? L + 4 : L - 0.8)), clamp(ty, offOk ? -3.5 : 1, offOk ? W + 3.5 : W - 1)];
          urgent[p.idx] = u;
        }
        // 版807：最終ライン（DF）はそろえる：寄せ・追いかけ・カバー・ぴったりマークの役目がない時は、ラインの高さ（前後2.5mまで）に並ぶ。スイーパーは1m後ろ、ストッパーは3m前まで
        if (!attacking && !S.restart && !(S.celebrate > 0) && !globalThis.__noLineKeep) {
          for (const m of tm.players) {
            if (m.gk || m.off || !m.slot || m.slot.line !== 0 || !targets[m.idx] || pressers.has(m.idx) || chasing[m.idx] || coverer[tm.ti] === m.idx || m.markHard) continue;
            const cur = fx(tm.ti, targets[m.idx][0]), lo = m.type === 'スイーパー' ? Lx - 2 : Lx - 1.5, hi = m.type === 'スイーパー' ? Lx - 0.3 : Lx + (m.type === 'ストッパー' ? 3 : 2.5);
            const nx = clamp(cur, lo, hi); if (nx !== cur) targets[m.idx][0] = fx(tm.ti, nx);
            if (fx(tm.ti, m.x) - nx > 6) urgent[m.idx] = true;   // ラインより前に取り残されていたら、全力で戻る
          }
        }
        // ラインコントローラー：最終ラインの高さをこの選手が決め、ほかのDFが合わせる。
        // 相手が縦パスを出せる形になったら、一斉に押し上げてオフサイドを取りにいく（オフサイドトラップ）
        if (!attacking && !S.restart && !(S.celebrate > 0)) {
          const stepOn = S.lcStep && S.lcStep.team === tm.ti && S.lcStep.until > S.t;
          const lc = tm.players.find((m) => m.type === 'ラインコントローラー' && !m.gk && m.slot && m.slot.line === 0 && targets[m.idx] && !(m.stun > 0)) || (stepOn ? tm.players.find((m) => !m.gk && !m.off && m.slot && m.slot.line === 0 && targets[m.idx]) : null);   // 号令・読みで動く時は、ラインコントローラーが一瞬止まっていてもライン全体で動く
          if (lc) {
            const back = tm.players.filter((m) => !m.gk && m.slot && m.slot.line === 0 && targets[m.idx] && !pressers.has(m.idx) && coverer[tm.ti] !== m.idx && !chasing[m.idx] && !urgent[m.idx]);
            let lineF = fx(tm.ti, targets[lc.idx][0]) + 1.0;          // 少し高めに保つ
            const holder = own && own.team !== tm.ti ? own : null;
            let trap = false;
            if (holder) {
              const hF = fx(tm.ti, holder.x);
              // 自分たちのラインの近くで待っている相手FWがいて、出し手が少し離れている → 押し上げる
              const lurk = opps(lc).some((q) => !q.gk && fx(tm.ti, q.x) > lineF - 3.5 && fx(tm.ti, q.x) < lineF + 3);
              if (lurk && hF - lineF > 6 && hF - lineF < 40) { trap = true; const skj = teamU(tm.ti, 'sakurajima'); lineF += (2.2 + lc.vision * 0.02 + lc.mental * 0.008) * (skj ? 1 + 0.5 * uP(skj) : 1); S.lcTrap = S.lcTrap || [-9, -9]; S.lcTrap[tm.ti] = S.t; S.lcWho = S.lcWho || [null, null]; S.lcWho[tm.ti] = lc; }
            }
            { // 版800：ラインコントローラー：相手が後ろを向いた（ボールを下げた）瞬間、DF全員で一斉にラインを上げる
              const st0 = S.lcStep && S.lcStep.team === tm.ti && S.lcStep.until > S.t, dir = Math.sign(fx(tm.ti, 1) - fx(tm.ti, 0)) || 1;
              if (lc.type === 'ラインコントローラー' && !st0 && S.t > (tm.lcBackCd || 0)) {
                const backNow = holder ? (holder.vx || 0) * dir > 1.3 && fx(tm.ti, holder.x) - lineF < 35 : (b.kind === 'pass' && b.lastTeam !== tm.ti && (b.vx || 0) * dir > 3 && fx(tm.ti, b.x) - lineF < 40);
                if (backNow) { tm.lcBack = S.t + 1.4; tm.lcBackCd = S.t + 4.5; if (globalThis.__tyDbg) globalThis.__tyDbg.lcBack = (globalThis.__tyDbg.lcBack || 0) + 1; }
              }
              if ((tm.lcBack || 0) > S.t && !(st0 && S.lcStep.mode === 'drop')) { trap = true; lineF += 4.5; }
            }
            const step = S.lcStep && S.lcStep.team === tm.ti && S.lcStep.until > S.t;
            if (step && S.lcStep.mode === 'up') { trap = true; const rr = P[S.lcStep.r];
              if (S.lcStep.all) { const ad = opps(lc).filter((q) => !q.gk && !q.off).map((q) => fx(tm.ti, q.x)), deep = Math.min(...ad); lineF = Math.max(lineF + 2, Math.min(deep + 3, lineF + 9)); }   // 桜島の号令：いちばん前の相手FWより前まで、DF全員で一斉に押し上げ続ける（気づくのが遅れた相手はオフサイド）
              else lineF = Math.max(lineF + 2, rr ? fx(tm.ti, rr.x + rr.vx * 0.6) + 2.5 : lineF + 5); }   // 読んだ：走り出した相手を置き去りにする所まで一斉に押し上げる
            if (step && S.lcStep.mode === 'drop') { trap = true; lineF -= S.lcStep.big ? 7 : 5; }   // 読んだ：一斉に下がって、裏のスペースを消す
            lineF = Math.min(lineF, bxf - (step ? 1 : 3));
            for (const m of (step ? tm.players.filter((m) => !m.gk && !m.off && targets[m.idx] && !(chasing[m.idx] && !S.lcStep.trap) && !(S.lcStep.trap && own && hyp(m.x - own.x, m.y - own.y) < 4) && (m.slot && m.slot.line === 0 || (S.lcStep.trap && fx(tm.ti, m.x) < lineF + 1))) : back)) {   // 桜島の号令：ラインより後ろにいる選手は、中盤の選手も含めて全員が一斉に上がる
              const cur = fx(tm.ti, targets[m.idx][0]);
              const nx = cur + (lineF - cur) * (m === lc ? 1 : 0.85);
              targets[m.idx][0] = fx(tm.ti, nx);
              if (trap) urgent[m.idx] = true;
            }
          }
        }
      }
    }

    // ---------- 移動 ----------
    // GKの横っ跳び：横へ一気に飛び、そのあと倒れて少し動けない
    // GKの土台：判断力（ポジショニング・飛び出しの判断）→ ジャンプ力（届く高さ・横っ跳びの距離）→ テクニック（キャッチ・パンチの質）
    const headZ = (p) => 1.95 + p.jump * 0.008 + (skZ(p, 'aerial') ? 0.15 : 0);   /* 頭で触れる最高の高さ：ジャンプ40で約2.3m、85で約2.6m */
    const gkReachZ = (p) => 2.1 + p.jump * 0.011;          // ジャンプ50で約2.65m、95で約3.15mまで手が届く
    const gkDiveMax = (p) => 2.6 + p.jump * 0.028;          // 横っ跳びの最大距離：ジャンプ50で約4m、95で約5.3m
    // 版782：止められないシュートは、GKの反応を遅らせる。ボールが横を抜けるまで構えたまま動けず、抜けたあとに遅れて飛ぶ（明らかに触っていないと見えるように）
    function missDive(p, gap, tHit, roll) {
      p.lateDive = { at: S.t + Math.max(0.04, tHit - (Math.abs(gap) > 2.4 ? R.range(0.1, 0.16) : R.range(0.0, 0.05))),   /* 版791：抜けた後ではなく、ボールが横を通るほんの少し前に飛び始める（遅すぎて見えた）。手が伸びきる前に球が通り過ぎる */ dir: Math.sign(gap) || 1, dist: Math.abs(gap) * (roll ? R.range(0.4, 0.55) : R.range(0.6, 0.75)), until: S.t + tHit + 2 };
      p.vx *= 0.2; p.vy *= 0.2;
    }
    function startDive(p, dir, dist, tHit, src) {
      p.diveT = 0.7; p.diveDir = dir;
      dist = Math.min(dist, gkDiveMax(p));
      const v = clamp(dist / Math.max(tHit, 0.18), 3, 5.2 + p.speed * 0.015 + p.jump * 0.025);
      p.vy = dir * v; p.vx *= 0.3;
    }
    // 選手はゴールのネットをすり抜けない：ゴールの中に入っても奥のネットの手前まで、外から横のネットを通り抜けて中へは入れない
    function movePlayers() {
      for (const p of P) { p.ppx = p.x; p.ppy = p.y; }
      movePlayers0();
      for (const p of P) {
        if (p.off) continue;
        // 流れの中では、選手はタッチラインの外へ出ない（ライン際でパスを受ける・運ぶ時に、外にいて球を出してしまわない）
        if (!S.restart && !S.celebrate && !p.gk) { if (p.y < 0.45) { p.y = 0.45; if (p.vy < 0) p.vy = 0; } else if (p.y > W - 0.45) { p.y = W - 0.45; if (p.vy > 0) p.vy = 0; } }
        for (const gl of [0, L]) {
          const d = gl === 0 ? -1 : 1, behind = (p.x - gl) * d, wasBehind = (p.ppx - gl) * d;
          if (behind <= 0) continue;
          const inY = Math.abs(p.y - GOAL_Y) < POST + 0.3, wasInY = Math.abs(p.ppy - GOAL_Y) < POST + 0.3;
          if (inY && !wasInY && wasBehind > 0.15) { p.y = GOAL_Y + Math.sign(p.ppy - GOAL_Y) * (POST + 0.32); p.vy = 0; }   // 横のネット（外側）
          else if (inY && behind > NET_D - 0.5) { p.x = gl + d * (NET_D - 0.5); p.vx = 0; }   // 奥のネット
        }
      }
    }
    function movePlayers0() {
      const own = ownerP();
      // 審判と副審
      moveOfficials();
      for (const p of P) {
        p.touchCd = Math.max(0, p.touchCd - DT);
        p.tackleCd = Math.max(0, p.tackleCd - DT);
        p.stun = Math.max(0, p.stun - DT);
        p.punchT = Math.max(0, (p.punchT || 0) - DT);
        p.highT = Math.max(0, (p.highT || 0) - DT);
        // 版834：ハイボール：出ると決めたGKは、ボールが来る少し前に踏み切って、いちばん高い所で両手を伸ばして取る（パンチング）
        if (p.gk && !(p.highT > 0) && S.gkCk && S.gkCk.g === p.idx && S.gkCk.mode !== 'stay' && S.t < S.gkCk.until && S.ball.owner < 0 && S.ball.z > 1.3 && S.ball.vz < 2) {
          const bb = S.ball, dd = hyp(bb.x - p.x, bb.y - p.y), cs = Math.max(4, hyp(bb.vx, bb.vy));
          if (dd < cs * 0.32 + 0.6) { p.highT = 0.62; p.highZ = bb.z; act(p, 'jump', 0.62); }
        }
        if (p.slideT > 0) {
          p.slideT -= DT;
          p.x += p.vx * DT; p.y += p.vy * DT; p.vx *= 0.82; p.vy *= 0.82;
          if (p.slideT <= 0) { p.slideT = 0; p.downT = 0.7; p.vx = p.vy = 0; }
          continue;
        }
        if (p.diveT > 0) {
          p.diveT -= DT;
          p.x += p.vx * DT; p.y += p.vy * DT; p.vx *= 0.9; p.vy *= 0.88;
          if (p.diveT <= 0) { p.diveT = 0; p.downT = 0.8; p.vx = p.vy = 0; }
          continue;
        }
        // 股を抜かれたDFの素早い反応：振り返ってボールへ全力（加速は瞬発力の鋭いダッシュ）
        if (p.nmChase && S.t < p.nmChase && S.ball.owner < 0 && !(p.downT > 0)) {
          const b = S.ball, ux = b.x - p.x, uy = b.y - p.y, ul = hyp(ux, uy) || 1, vm = maxSpeed(p) * 1.02, acc = (6 + p.dash * 0.12) * DT;
          let dvx = ux / ul * vm - p.vx, dvy = uy / ul * vm - p.vy; const dv = hyp(dvx, dvy), k = dv > acc ? acc / dv : 1;
          p.vx += dvx * k; p.vy += dvy * k; p.x += p.vx * DT; p.y += p.vy * DT; continue;
        } else if (p.nmChase && (S.t >= p.nmChase || S.ball.owner >= 0)) p.nmChase = null;
        // シールド中：相手が寄ってきたら、肩・背中でぶつけてブロック（相手は弾かれる）→ それからボールを持ち出す
        if (p.shieldFrom && S.ball.owner === p.idx) {
          const sf = p.shieldFrom, o = P[sf.o];
          if (S.t > sf.until) p.shieldFrom = null;
          else {
            const ux = p.x - o.x, uy = p.y - o.y, ul = hyp(ux, uy) || 1;
            if (!sf.bumped && ul < 1.4) {
              sf.bumped = true; sf.until = S.t + 0.6;
              act(p, 'bodyIn', 0.85, { dx: ux / ul, dy: uy / ul, bump: 1 });
              act(o, 'lose', 0.9, { o: p.idx, dx: -ux / ul, dy: -uy / ul }); o.vx = -ux / ul * 2.4; o.vy = -uy / ul * 2.4; o.stun = Math.max(o.stun, 0.9); o.moveQ = null; o.moveEnd = null;
            }
            p.vx *= 0.6; p.vy *= 0.6; p.vx += ux / ul * 0.4; p.vy += uy / ul * 0.4; p.x += p.vx * DT; p.y += p.vy * DT; continue;   // 腰を落として、相手から離れる向きへ少しずつ
          }
        }
        if (p.sway && S.t >= p.sway.t) { p.vx = p.sway.vx; p.vy = p.sway.vy; p.lagT = Math.max(p.lagT || 0, p.sway.lag); p.sway = null; }   // ダブルシザースの2回目につられる
        if (p.hl && S.t >= p.hl.t) { const h = p.hl; p.hl = null; heelLiftFlick(p, h); }   // 版666：ヒールリフトの跳ね上げ
        if (p.hlHead && S.t >= p.hlHead.t) { const h = p.hlHead; p.hlHead = null; heelLiftHead(p, h); }
        if (p.lateLose && S.t >= p.lateLose.t) { const l = p.lateLose; p.lateLose = null; act(p, l.fall ? 'fall' : 'lose', l.fall ? 1.2 : 0.9, { o: l.o, dx: l.dx, dy: l.dy }); if (l.fall) p.downT = Math.max(p.downT || 0, 1.0); }
        if (p.downT > 0) { p.downT = Math.max(0, p.downT - DT * (p.sk.has('ironMan') && !p.gk ? 1.7 : 1)); p.vx = p.vy = 0; continue; }
        if (S.refCard && S.refCard.p === p) { p.vx *= 0.8; p.vy *= 0.8; p.x += p.vx * DT; p.y += p.vy * DT; continue; }   // カードを受ける選手はその場で止まる
        let tx, ty, vmax = maxSpeed(p);
        // 技の足さばき：決まった向き・速さでステップを刻む（ボディフェイント・ダブルタッチ）
        if (own === p && p.moveQ && p.moveQ.length) {
          while (p.moveQ.length && S.t >= p.moveQ[0].until) p.moveQ.shift();
          if (p.moveQ.length) {
            const m = p.moveQ[0];
            p.vx += (m.dx * m.v - p.vx) * m.snap; p.vy += (m.dy * m.v - p.vy) * m.snap;
            if (m.v > 0.5) S.dribbleDir = [m.dx, m.dy];
            p.x = clamp(p.x + p.vx * DT, -4, L + 4); p.y = clamp(p.y + p.vy * DT, -3.5, W + 3.5);
            continue;
          }
          if (p.moveEnd) { const e = p.moveEnd; p.moveEnd = null; S.dribbleDir = [e.dx, e.dy]; p.vx = e.dx * e.v; p.vy = e.dy * e.v; p.burstT = S.t + 0.5; }
        }
        if (own === p && p.settle) {
          // 足を伸ばして止めたボールへ寄っていく（ボールの方が吸い付いてこない）
          if (p.settle === 'meet' && p.meet) { tx = p.meet[0]; ty = p.meet[1]; } else { tx = S.ball.x; ty = S.ball.y; }
        } else if (own === p && S.dribbleDir) {
          if ((uOn(p, 'shiden') || (p.hariT || 0) > S.t || (p.finT || 0) > S.t)) S.dribbleDir = sdFwd(p, S.dribbleDir[0], S.dribbleDir[1]);
          // ゴール前（30m以内）を運んでいる時、外へ流れていたら少しずつゴールの方へ向き直す（コントロールショットを持つ選手は、外へ流れて巻くのもあり）
          if (!skZ(p, 'controlShot') && fx(p.team, p.x) > L - 30 && Math.abs(p.y - GOAL_Y) > 3 && Math.sign(S.dribbleDir[1]) === Math.sign(p.y - GOAL_Y)) {
            const gx = fx(p.team, L) - p.x, gy = GOAL_Y - p.y, gl = hyp(gx, gy) || 1, k = 0.12;
            const nx = S.dribbleDir[0] * (1 - k) + gx / gl * k, ny = S.dribbleDir[1] * (1 - k) + gy / gl * k, nl = hyp(nx, ny) || 1; S.dribbleDir = [nx / nl, ny / nl]; }
          vmax *= 0.8 + p.dribble * 0.0016;   // ドリブルが上手いほど速く運べる（S 約0.94、E 約0.86。全力疾走より少し遅い）
          if (S.dribbleMode === 'carry') {
            vmax *= 0.58 + p.technique * 0.0015;   // 運ぶドリブル：足元に置いたまま、ゆっくり
            // ぶつかる前に向きを変える：向かう先に相手が近づいてきたら（4m以内）、その場で選び直す（取られない向き・縦→横→後ろ・FWの方）
            const th = opps(p).filter((q) => !q.gk).map((q) => ({ q, d: hyp(q.x - p.x, q.y - p.y) })).filter((o) => o.d < 4).sort((x, y) => x.d - y.d)[0];
            if (th && ((th.q.x - p.x) * S.dribbleDir[0] + (th.q.y - p.y) * S.dribbleDir[1]) / th.d > 0.2) { S.dribbleDir = carryDir(p); if ((uOn(p, 'shiden') || (p.hariT || 0) > S.t)) S.dribbleDir = sdFwd(p, S.dribbleDir[0], S.dribbleDir[1]); }
          }
          else {
            // 突破のドリブル：緩急。前に相手がいる間は普通のドリブル（巡航）で間合いを測り、2.5〜5mまで来たら前傾してグン！と一気に加速して置き去りにする
            if (p.pace && S.t > p.pace.until) p.pace = null;
            const fr = opps(p).filter((q) => !q.gk && ((q.x - p.x) * S.dribbleDir[0] + (q.y - p.y) * S.dribbleDir[1]) > 0.5).map((q) => ({ q, d: hyp(q.x - p.x, q.y - p.y) })).filter((o) => o.d < 8).sort((x, y) => x.d - y.d)[0];
            if (p.pace) vmax = maxSpeed(p) * (0.96 + p.dribble * 0.001);
            else if (fr) {
              vmax *= 0.6 + p.dribble * 0.0016;   // 巡航：ドリブルが上手いほど速いまま間合いを詰められる
              if (fr.d < 5 && fr.d > 2.5 && zr(p, 'pace') > 0 && (p.paceCd || 0) < S.t && R.next() < 0.3 * (0.4 + p.dribble / 100) * (zr(p, 'pace') === 2 ? 1.6 : 1)) {
                p.pace = { ph: 'burst', until: S.t + 0.8 }; p.paceCd = S.t + (zr(p, 'pace') === 2 ? 1.8 : 2.5); act(p, 'pace', 0.8, { k: 'burst' });
                // 緩急についていけるかは瞬発力の差（ランクの差がはっきり出る）：遅い相手ほど反応が遅れる
                for (const q of opps(p)) { const d2 = hyp(q.x - p.x, q.y - p.y); if (d2 < 5 && !q.gk) q.lagT = S.t + clamp(0.15 + (p.dash - q.dash) * 0.01 + (p.dribble - q.defense) * 0.004, 0.03, 0.7); }
              }
            }
          }
          // 高速ドリブル：前が空いていれば、ほとんど全力のままボールを運ぶ
          // 高速ドリブルは3秒まで（そのあと4秒は使えない）。走っている間はスタミナの減りが2.2倍
          if ((p.sdOn || 0) < S.t - 0.3) p.sdStart = null;
          if (p.sdStart != null && S.t - p.sdStart > 3) { p.sdCd = S.t + 4; p.sdStart = null; p.sdOn = 0; }
          if (skZ(p, 'speedDribble') && !((p.sdCd || 0) > S.t) && !(p.sdStart == null && (p.skLock || 0) > S.t) && nearestOpp(p, p.x, p.y).d > (zr(p, 'speedDribble') === 2 ? 3.5 : 4.5)) {   // どこで使うかは「スキルのエリア設定」の表で決める
            if (p.sdStart == null) p.sdStart = S.t;
            vmax = Math.max(vmax, maxSpeed(p) * 1.02);   // 高速ドリブル：大きく蹴り出して、全力疾走のまま運ぶ
            // 高速ドリブル：ボールを大きく前へ蹴り出しては、全力で追いつく（前傾したまま走り切る）
            if (S.t - (p.sdAct || 0) > 0.45) { act(p, 'sdrun', 0.5); p.sdAct = S.t; }
            p.sdOn = S.t + 0.25;
            if (!p.sdShown) { p.sdShown = true; act(p, 'skill', 1.3, { k: 'speedDribble' }); }
          }
          tx = clamp(p.x + S.dribbleDir[0] * 7, 1.5, L - 1.5); ty = clamp(p.y + S.dribbleDir[1] * 7, 1.8, W - 1.8);   // 7m先を目標に（5m先だと秒速8mで頭打ちになっていた）
          if (S.charge && S.charge.p === p.idx && !S.charge.dShot) vmax *= 0.15;
          if ((p.burstT || 0) > S.t) vmax = Math.max(vmax, maxSpeed(p));   // 技で抜いた直後は一気に加速   // 溜めている間はほぼ止まる
        } else if (own === p) {
          tx = p.x; ty = p.y; vmax *= 0.3;
        } else {
          [tx, ty] = targets[p.idx];
          if (!urgent[p.idx]) vmax *= 0.78;
          if (p.run > 0 && (skZ(p, 'behindRun') || (p.otRun && skZ(p, 'oneTwo')))) vmax *= 1.07;
          if ((p.swRead || 0) > S.t && chasing[p.idx]) { vmax *= 1.08; if (p.swCnt !== S.ball.passT) { p.swCnt = S.ball.passT; if (globalThis.__tyDbg) globalThis.__tyDbg.swRead = (globalThis.__tyDbg.swRead || 0) + 1; } }   // 版800：スイーパーの裏のカバーは、一歩目から全力   // 抜け出しの一歩目が速い
        }
        const dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy);
        // こぼれ球を追う選手は減速せずに最後まで詰める（お見合いしない）
        const want = p.tsukiRun === S.t && own !== p && p.uMeet ? Math.min(vmax, d / Math.max(0.15, p.uMeet.at - S.t) + 1.0) : (chasing[p.idx] || (own === p && p.settle)) && d > 0.25 ? vmax : Math.min(vmax, d * 1.6);   // 月影の抜け出し：ボールと同時に着く速さで（先に着いて待たない・追い越さない）
        let dvx = (d > 0.01 ? (dx / d) * want : 0) - p.vx, dvy = (d > 0.01 ? (dy / d) * want : 0) - p.vy;
        // 転がるボールに寄る時は、通り過ぎないよう最後はボールの速さに合わせて足元に収める
        if (chasing[p.idx] && own !== p && S.ball.owner < 0 && S.ball.z < 1.3) {
          const bb = S.ball, bx = bb.x + bb.vx * 0.12, by = bb.y + bb.vy * 0.12, db = hyp(bx - p.x, by - p.y);
          if (db < 4.5) {
            const ap = Math.min(vmax, db * 2.4 + 0.4);
            let wx = bb.vx + ((bx - p.x) / (db || 1)) * ap, wy = bb.vy + ((by - p.y) / (db || 1)) * ap;
            const wl = hyp(wx, wy); if (wl > vmax) { wx *= vmax / wl; wy *= vmax / wl; }
            dvx = wx - p.vx; dvy = wy - p.vy;
          }
        }
        // 加速は 7m/s²、止まる・切り返す時はもっと強く（人は急には加速できないが、止まるのは早い）
        const brake = (p.vx * dvx + p.vy * dvy) < 0;
        const acc = (brake ? 6.5 + p.dash * 0.085 : (own === p && p.pace && p.pace.ph === 'burst' ? 6 + p.dash * 0.12 : Math.max(4.5, 1.4 + p.dash * 0.1))) * DT * (uOn(p, 'miyabi') ? 1.9 + 0.4 * (uP(p) - 1) / 0.3 : uOn(p, 'sutemi') ? 1.7 : uOn(p, 'matsuri') ? 1.8 : 1), dv = hyp(dvx, dvy);   // 雅の後始末：一歩目から一気に加速（凸でさらに）   // 緩急の加速は初速が命（瞬発力）
        if (p.lagT > S.t && own !== p) { dvx = 0; dvy = 0; }   // 緩急に一瞬ついていけない（そのままの勢いで流れる）
        const k = dv > acc ? acc / dv : 1;
        p.vx += dvx * k; p.vy += dvy * k;
        p.x = clamp(p.x + p.vx * DT, -4, L + 4); p.y = clamp(p.y + p.vy * DT, -3.5, W + 3.5);
        const sp = hyp(p.vx, p.vy);
        if (Math.abs(p.vx) > 0.3) p.facing = p.vx > 0 ? 1 : -1;
        stats[p.team].distance += sp * DT;
        // スタミナ：走るほど減り、ゆっくりなら少し回復
        const frac = sp / (5.4 + p.speed * 0.034);
        const minute = S.t * CLOCK_SCALE / 60;
        const drain = (0.012 + frac * frac * 0.16) * STAM_K * Math.max(0.4, 1.3 - p.stamina / 120) * (skZ(p, 'pressMonster') || skZ(p, 'recovery') ? 0.85 : 1) * T[p.team].stamMul * ((T[p.team].capBuff || 0) > S.t ? 0.75 : 1) * (T[p.team].sitTire || 1) * (p.sk.has('ironMan') ? 0.65 : 1) * (p.sk.has('lateGrit') && minute >= 70 ? 0.55 : 1) * ((p.sdOn || 0) > S.t ? 2.2 : 1) * (uOn(p, 'kinshachi') ? 1 - 0.85 * Math.min(1, uP(p)) : 1) * (1 - 0.1 * aura(p, 'runBack')) * (p.uniq !== 'kinshachi' && ksTeam(p.team) ? 0.85 : 1) * DT;   // 金鯱の心臓：かいがいると、チーム全体の走りが整って疲れにくい   // 鉄人・終盤の粘り・金鯱の心臓・走る背中
        p.cur = clamp(p.cur - drain * (p.uniq === 'kinshachi' ? (p.uniqLv >= 2 ? 0.25 : 0.35) : 1) + (sp < 1.5 ? 0.025 * DT : 0), 0, 100);   // 金鯱の心臓：そもそもスタミナがほとんど減らない
        /* v740 スタミナ：元気が70を切ると、全部の能力が下がっていく（元気0で2割減。スピードは最高速の計算で下がる） */
        if (!p.base0) p.base0 = Object.fromEntries(FAT_KEYS.map((k) => [k, p[k]]));
        { const ff = 1 - Math.max(0, 70 - p.cur) / 70 * 0.2; if (Math.abs(ff - (p.ffLast ?? 1)) > 0.005) { for (const k of FAT_KEYS) p[k] = Math.round(p.base0[k] * ff); p.ffLast = ff; } }
        // 走り込みのタイマー
        if (p.uniq === 'uzushio' && !p.off && S.poss === p.team && own && own.team === p.team && own !== p && !own.gk && own.position !== 'DF' && !S.setPiece && !S.restart && fx(p.team, p.x) > 60 && fx(p.team, own.x) > 55 && fx(p.team, own.x) < 92 && Math.abs(own.y - GOAL_Y) < 28 && fx(p.team, own.x) < fx(p.team, p.x) - 2) uFire(p, p.uniq);   /* 渦潮の囮：相手陣内（相手ゴールから約50m以内）で、2列目の味方が自分より後ろで持ったら（走っている途中でも） */
        if (p.run > 0) { p.run -= DT; if (p.run <= 0) p.runCd = R.range(2, 4); }
        else if (S.poss === p.team && !p.gk && own && own.team === p.team && own !== p) {
          p.runCd -= DT;
          const xf = fx(p.team, p.x);
          // 版837：オーバーラップ（目に見える形に）：同じサイドの味方が相手陣でボールを持ったら、その外側を後ろから全力で追い越して、タッチライン際の前のスペースへ
          if (p.sk.has('overlap') && !(p.ovUntil > S.t) && S.t > (p.ovNext || 0) && !own.gk && !S.setPiece && !S.restart && p.slot && Math.abs(p.slot.y - GOAL_Y) > 9) {
            const sd = Math.sign(p.slot.y - GOAL_Y), oxf = fx(p.team, own.x);
            if (Math.sign(own.y - GOAL_Y) === sd && Math.abs(own.y - GOAL_Y) > 6 && oxf > L / 2 - 8 && oxf < L - 14 && xf < oxf + 1 && xf > oxf - 26) {
              p.ovUntil = S.t + R.range(3, 4); p.ovNext = p.ovUntil + R.range(4, 7); p.ovSide = sd; act(p, 'ovrun', p.ovUntil - S.t); if (globalThis.__tyDbg) globalThis.__tyDbg.ov = (globalThis.__tyDbg.ov || 0) + 1; }
          }
          const thr = clamp(p.run_space + T[p.team].mods.through + T[p.team].tac.through + T[p.team].urg * 35 + (T[p.team].attitude === 'defensive' ? 12 : 0), 0, 100);
          // 渦潮の囮：味方が前を向いて持ったら、裏へ全力で走る／月影の抜け出し：ボールを持った味方が近くにいたら、裏へ抜け出してスルーパスを呼び込む
          if (globalThis.__uzOpp && p.uniq === 'uzushio' && !own.gk) { const c = globalThis.__uzOpp; c.all++; if (own.position !== 'DF') c.nd++; if (own.position !== 'DF' && fx(p.team, own.x) > 62 && fx(p.team, own.x) < 90) { c.zone++; if (xf > 62) c.tz++; if (Math.abs(own.y - GOAL_Y) < 28) c.cen++; if (fx(p.team, own.x) < xf - 2) c.beh++; if (p.uCd > S.t) c.cd++; } }
          if (p.uniq === 'tsukikage' && xf > 30 && !own.gk && hyp(own.x - p.x, own.y - p.y) < (p.uniqLv >= 2 ? 48 : 44) && fx(p.team, own.x) > 28 && fx(p.team, own.x) < xf + 3 && offsideLine(p.team) < L - 7 && xf < offsideLine(p.team) - 0.4 && !(p.uCd > S.t)) {   // 走り出す時は、オフサイドラインの手前から
            // 裏のスペースに、相手より先に着けそうな時だけ（読まれていたら走らない）
            const offL0 = offsideLine(p.team), sx = fx(p.team, Math.min(Math.max(xf + 7, offL0 + 3), L - 8)), sy = p.y + (GOAL_Y - p.y) * 0.15;
            const tN = hyp(sx - p.x, sy - p.y) / (maxSpeed(p) * 1.1);
            let tD = 99; for (const o of opps(p)) { if (o.off) continue; tD = Math.min(tD, hyp(sx - o.x, sy - o.y) / maxSpeed(o) + (o.gk ? 0.3 : 0.4)); }   // DFは前を向いているので、振り返る分だけ遅れる
            // パスのコースに相手の足がかからないこと（出してもカットされるなら走らない）
            const lane = opps(p).some((o) => !o.gk && !o.off && (() => { const sd = segDist(o.x, o.y, own.x, own.y, sx, sy); return sd.u > 0.12 && sd.u < 0.92 && sd.d < 1.3; })());
            if (tN < tD + (p.uniqLv >= 2 ? 0.35 : 0.0) - ctrPen(1 - p.team) && !lane) uFire(p, 'tsukikage');   // 対策役がいる相手には、抜け出すスペースそのものが少ない   // 凸：抜け出せる場面が少し増える
          }
          // 版789：裏への抜け出し：2列目の味方が前を向いて持った瞬間に、裏へ走り出す（持ち主が変わるたびに1回）
          if (own.idx !== p.brOwn || S.t - (p.brT || -9) > 2.6) {   // 同じ味方が持ち続けている時も、少し間をあけて走り直す
            p.brOwn = own.idx;
            const fwd = Math.sign(fx(p.team, 1) - fx(p.team, 0)) || 1, ox = fx(p.team, own.x), offB = offsideLine(p.team);
            if (skZ(p, 'behindRun') && p.run <= 0 && !own.gk && own.position !== 'DF' && xf > 40 && ox > 35 && ox < xf - 2 && (own.vx || 0) * fwd > -0.5 && offB < L - 7 && xf < offB + 0.5 && !S.setPiece && !S.restart) {
              p.brT = S.t; p.run = R.range(2.6, 3.8); p.runCd = 0; p.brTimed = R.next() < 0.35 + p.vision * 0.0065;   // 判断（視野）が高いほど、パスが出るまでラインを越えない
            }
          }
          // 版796：ストライカーのプルアウェイ：最終ラインの上で、すぐ近くにDFがいる時だけ。DFから横・少し後ろへ離れて、足元で受けられる間合いを作る
          if (!globalThis.__noPull && p.type === 'ストライカー' && p.position === 'FW' && p.run <= 0 && !((p.stPullT || 0) > S.t) && S.t > (p.stPullNext || 0) && !own.gk && xf > L - 42 && Math.abs(xf - offsideLine(p.team)) < 2.5 && fx(p.team, own.x) < xf - 4 && !S.setPiece && !S.restart) {
            let dn = null, dd = 99; for (const o of opps(p)) { if (o.gk || o.off) continue; const d0 = hyp(o.x - p.x, o.y - p.y); if (d0 < dd) { dd = d0; dn = o; } }
            if (dn && dd < 3.5 && R.next() < 0.5) { const sy = Math.sign(p.y - dn.y) || (p.number % 2 ? 1 : -1); p.stPullT = S.t + R.range(0.9, 1.3); p.stPullP = [offsideLine(p.team) - R.range(2.5, 3.5), clamp(p.y + sy * R.range(3, 4.5), 6, W - 6)]; p.stPullNext = S.t + R.range(4, 7); if (globalThis.__tyDbg) { globalThis.__tyDbg.pull = (globalThis.__tyDbg.pull || 0) + 1; (globalThis.__tyDbg.pl = globalThis.__tyDbg.pl || []).push([+xf.toFixed(1), +offsideLine(p.team).toFixed(1), +dd.toFixed(1)]); } }
          }
          // 版795：ストライカーのダイアゴナル：最終ラインの近くから、斜めに裏の一番空いた所へ（プルアウェイとは別の動き）
          //  真ん中にいる時はボールと逆のDFの背中へ外向きに、サイドにいる時はゴール前へ内向きに。パスが出るまではオフサイドにならない
          if (!globalThis.__noStDg && p.type === 'ストライカー' && p.position === 'FW' && p.run <= 0 && !((p.stPullT || 0) > S.t) && S.t > (p.stDgNext || 0) && !own.gk && xf > L / 2 - 4 && xf > offsideLine(p.team) - 10 && fx(p.team, own.x) > 30 && fx(p.team, own.x) < xf - 3 && offsideLine(p.team) < L - 8 && !S.setPiece && !S.restart && R.next() < 0.55) {
            const offS = offsideLine(p.team), wideS = Math.abs(p.y - GOAL_Y) > 7, ax = Math.min(offS + 7, L - 9), wax = fx(p.team, ax);
            // 斜めに走って、裏の一番空いている所へ（今いる所から横に4m以上ずれる所。DFから遠く、持っている味方からのコースが空いている所）
            let bs = -1e9, ny = null;
            for (const dy of [-11, -8, -5, -2, 2, 5, 8, 11]) { const ay = GOAL_Y + dy; if (Math.abs(ay - p.y) < 4) continue; let m = 9, lc = 9;
              for (const o of opps(p)) { if (o.off || o.gk) continue; m = Math.min(m, hyp(o.x - wax, o.y - ay)); const sd = segDist(o.x, o.y, own.x, own.y, wax, ay); if (sd.u > 0.1 && sd.u < 0.95) lc = Math.min(lc, sd.d); }
              const v = Math.min(m, 8) + Math.min(lc, 4) * 0.8 - Math.abs(dy) * 0.12; if (v > bs) { bs = v; ny = ay; } }
            if (ny == null || bs < 6) { p.stDgNext = S.t + 1.2; } else {
            const dur = R.range(3.0, 3.6);
            p.run = dur; p.runCd = 0; p.otRun = { x: Math.min(offS + 8, L - 9), y: clamp(ny, 7, W - 7), until: S.t + dur }; p.stDg = S.t + dur;
            p.stDgNext = S.t + dur + R.range(3, 5.5); if (globalThis.__tyDbg) globalThis.__tyDbg.dg++; }
          }
          // 版795：偽9番：偽9番が下りて受けたら、空いた最終ラインの所へ、近くのMF・FWが1人走り込む
          if (own.type === '偽9番' && own.position === 'FW' && own !== p && (p.position === 'MF' || p.position === 'FW') && p.run <= 0 && S.t > (own.f9Next || 0) && fx(p.team, own.x) > 35 && !S.setPiece && !S.restart) {
            const cand = mates(own).filter((m) => m !== own && !m.off && !m.gk && (m.position === 'MF' || m.position === 'FW') && fx(m.team, m.x) > fx(own.team, own.x) - 8 && m.run <= 0).sort((m, n) => hyp(m.x - own.x, m.y - own.y) - hyp(n.x - own.x, n.y - own.y))[0];
            if (cand === p) { const offF = offsideLine(p.team), dur = R.range(2.8, 3.4); own.f9Next = S.t + R.range(5, 8);
              p.run = dur; p.runCd = 0; p.otRun = { x: Math.min(offF + 7, L - 9), y: clamp(GOAL_Y + (p.y - GOAL_Y) * 0.25, 8, W - 8), until: S.t + dur }; p.f9Run = S.t + dur; } if (globalThis.__tyDbg) globalThis.__tyDbg.f9++;
          }
          // 版797：シャドー：相棒のFWが下りて（最終ラインから離れて）受けに来たら、空いたその場所へ後ろから飛び込む
          if (p.type === 'シャドー' && p.position === 'MF' && p.run <= 0 && S.t > (p.shNext || 0) && !own.gk && xf > L / 2 - 12 && !S.setPiece && !S.restart) {
            const fw = aceFw(p.team, p), offH = offsideLine(p.team);
            if (fw && fw !== p && !fw.off && fx(p.team, fw.x) < offH - 6 && (own === fw || (fw.vx || 0) * (fx(p.team, 1) - fx(p.team, 0)) < -1)) {
              const dur = R.range(2.8, 3.4); p.run = dur; p.runCd = 0; p.otRun = { x: Math.min(offH + 6, L - 9), y: clamp(fw.y + (GOAL_Y - fw.y) * 0.3, 7, W - 7), until: S.t + dur }; p.shRun = S.t + dur; p.shNext = S.t + dur + R.range(3, 5); if (globalThis.__tyDbg) globalThis.__tyDbg.shRun = (globalThis.__tyDbg.shRun || 0) + 1; }
          }
          // 版797：ゲームメイカーが「ため」を作っている間に、FWが裏へ走り出す
          if (own.type === 'ゲームメイカー' && (own.gmHold || 0) > S.t && own !== p && p.position === 'FW' && p.run <= 0 && !((p.stDg || 0) > S.t)) { p.run = R.range(2.4, 3.2); p.runCd = 0; p.gmRun = S.t + 3.2; }
          // 版794：デコイラン（囮）：味方が前を向いて持ったら、ボールと逆の方へ、相手の裏へ斜めに全力で走る（自分は受けない走り）。
          //  近くの相手DF（1〜2人）がこれについて行くので、ボールの近くと2列目が目に見えて空く
          if (p.type === 'デコイラン' && p.position === 'FW' && !(p.dcUntil > S.t) && S.t > (p.dcNext || 0) && !own.gk && xf > 38 && fx(p.team, own.x) > 30 && !S.setPiece && !S.restart) {
            const mate = mates(p).filter((m) => m !== p && !m.off && m.position === 'FW').sort((m, n) => hyp(m.x - p.x, m.y - p.y) - hyp(n.x - p.x, n.y - p.y))[0];
            const sd = (mate ? Math.sign(p.y - mate.y) : Math.sign(GOAL_Y - own.y)) || (p.number % 2 ? 1 : -1);   // 相棒のFWから離れる方へ走って、相棒のまわりのDFを連れ出す
            p.dcUntil = S.t + R.range(2.8, 3.6); p.dcNext = p.dcUntil + R.range(3.5, 6);
            p.dcY = clamp(GOAL_Y + sd * R.range(10, 17), 8, W - 8);
            const ds = opps(p).filter((o) => !o.gk && !o.off && o.position === 'DF').sort((m, n) => hyp(m.x - p.x, m.y - p.y) - hyp(n.x - p.x, n.y - p.y));
            if (globalThis.__dcDbg) globalThis.__dcDbg.trig++;
            p.dcPull = ds.slice(0, 1).map((o) => o.idx);
            // 囮が効いた時：相棒FWについていたDFまで、つられて囮の方へ行く（相棒がフリーになる）。判断（メンタル）が高い囮ほど、よく引っかかる
            if (mate && R.next() < 0.45 + Math.max(0, p.mental - 50) / 100) { const mk = ds.filter((o) => !p.dcPull.includes(o.idx)).sort((m, n) => hyp(m.x - mate.x, m.y - mate.y) - hyp(n.x - mate.x, n.y - mate.y))[0]; if (mk) p.dcPull.push(mk.idx); }
            if (globalThis.__dcDbg) (globalThis.__dcDbg.list = globalThis.__dcDbg.list || []).push({ t: S.t, until: p.dcUntil, i: p.idx, pull: p.dcPull.slice(), mate: mate ? mate.idx : -1 });
          }
          const runMul = (1 + 0.25 * aura(p, 'signal') + 0.2 * aura(p, 'stir'));   // 港の指揮者・攻めの合図・かき回し
          if (p.run > 0) { /* 走り出した */ }
          else if (p.runCd <= 0 && !(p.slot && p.slot.line === 0 && (Math.abs(p.slot.y - GOAL_Y) < 9 || Math.sign(p.slot.y - GOAL_Y) !== Math.sign(own.y - GOAL_Y))) && xf > (S.counter > 0 ? 35 : 45) && fx(p.team, own.x) > (S.counter > 0 ? 20 : 30) && R.next() < Math.pow(thr / 100, 1.5) * 0.4 * (0.5 + p.speed / 100) * (S.counter > 0 ? 2.2 : 1) * (skZ(own, 'throughPass') || skZ(own, 'loftedThrough') ? 2 : 1) * (skZ(p, 'behindRun') ? 2.2 : 1) * (0.7 + Math.max(0, own.vision - 40) / 40) * runMul) { p.run = R.range(2.4, 3.8); counterRead(p); }   // 判断力の高い味方が持てば、裏へ走り出す（守る側の対策役は、ふつうの走り出しも読む）
        } else if (S.poss !== p.team) { p.run = 0; p.brOwn = -1; }
      }
    }

    // ---------- キック ----------
    // キック：キック力で出せる速さが変わる。浮き球には回転（カーブ）、強いロングシュートは無回転（ブレ球）になりうる
    // ---------- ボールの物理 ----------
    // 空気抵抗（速いほど強く効く）・芝の転がり抵抗・バウンドで勢いが落ちる
    const AIR = 0.0075, ROLL = 1.7, BOUNCE_V = 0.42, BOUNCE_H = 0.7;
    // 縦回転 bs：＋がバックスピン（浮き上がって伸び、落ちたら止まる）、−がトップスピン（落ちて、跳ねたあと前へ伸びる）
    const LIFT = 0.045;
    function groundDec(sp) { return ROLL + AIR * 1.4 * sp * sp; }
    // 月影の抜け出し：いまのボールの進み方を先読みして、走り込む選手が全力で走ってちょうど同時に着く所（追い越さず・待たず、足もとで合う所）
    function tsukiMeet(q) {
      const b = S.ball; let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz;
      const vR = maxSpeed(q), r0 = 0.6; let first = null;
      for (let k = 1; k <= 45; k++) {
        x += vx * DT; y += vy * DT;
        if (z > 0 || vz > 0) { const v = Math.hypot(vx, vy, vz); vx -= AIR * v * vx * DT; vy -= AIR * v * vy * DT; vz -= (9.8 + AIR * v * vz) * DT; z += vz * DT; if (z <= 0) { z = 0; const hard = Math.abs(vz) > 2.2; vx *= hard ? BOUNCE_H : 0.92; vy *= hard ? BOUNCE_H : 0.92; vz = hard ? -vz * BOUNCE_V : 0; } }
        else { const sp = hyp(vx, vy); if (sp > 0) { const ns = Math.max(0, sp - groundDec(sp) * DT); vx *= ns / sp; vy *= ns / sp; } }
        const t = k * DT;
        if (z < 1.6 && hyp(x - q.x, y - q.y) - r0 <= vR * t) { const fwd = !q.uRunDir || (x - q.x) * q.uRunDir[0] + (y - q.y) * q.uRunDir[1] > -0.4; if (fwd) return { x, y, t, vx, vy }; if (!first) first = { x, y, t, vx, vy }; }
      }
      return first || { x, y, t: 4.5, vx, vy };
    }
    // 浮き球：初速と角度から、最初に落ちる地点までの距離
    function flightDist(speed, angle, bs) {
      let vx = speed * Math.cos(angle), vz = speed * Math.sin(angle), x = 0, z = 0.1;
      for (let k = 0; k < 120; k++) {
        const v = Math.hypot(vx, vz);
        vx -= AIR * v * vx * DT; vz -= (9.8 + AIR * v * vz - LIFT * (bs || 0) * vx) * DT;
        x += vx * DT; z += vz * DT;
        if (z <= 0) return x;
      }
      return x;
    }
    // 転がす球：distだけ転がったときの速さ
    function rollEnd(speed, dist) {
      let v = speed, x = 0;
      for (let k = 0; k < 200 && x < dist; k++) { x += v * DT; v -= groundDec(v) * DT; if (v <= 0) return -1; }
      return v;
    }
    // 実際に蹴るパス（転がって減速する）の平均の速さ。パスコースの読みに使う（速く見積もりすぎると、カットされるパスを出してしまう）
    const PAV = new Map();
    function passAvgV(p, d) {
      const key = Math.round(d) + '|' + Math.round(p.pass / 5) + '|' + Math.round(DOM[p.team] * 10);
      let v = PAV.get(key);
      if (v == null) {
        const dd = Math.max(3, Math.round(d)), vEnd = (4.5 + dd * 0.1 + Math.round(p.pass / 5) * 5 * 0.045) * (1 + Math.round(DOM[p.team] * 10) / 10 * 0.2);
        const v0 = solve((x) => rollEnd(x, dd), 4, 40, vEnd);
        let x = 0, vv = v0, t = 0; while (x < dd && t < 6) { x += vv * DT; vv -= groundDec(vv) * DT; t += DT; if (vv <= 0.2) break; }
        v = dd / Math.max(0.2, t); PAV.set(key, v);
      }
      return v;
    }
    function solve(f, lo, hi, want) { // f(lo) < want < f(hi) となる単調な関数の逆算
      if (f(hi) < want) return hi;
      for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (f(m) < want) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }
    // 蹴り方ごとの打ち上げ角度
    const LOFT_ANGLE = { dink: [0.42, 0.5], drive: [0.32, 0.42], high: [0.62, 0.74], lob: [0.6, 0.78], cross: [0.42, 0.55], clear: [0.6, 0.85] };

    function kick(p, tx, ty, kind, loft, opt) {
      opt = opt || {};
      const b = S.ball;
      const dx = tx - b.x, dy = ty - b.y, d = Math.max(0.5, hyp(dx, dy));
      const opp = nearestOpp(p, p.x, p.y);
      let pressure = opp.d < 2.5 ? 1 : opp.d < 5 ? 0.4 : 0;
      if (globalThis.__shLog && kind === 'shot' && !(opt && opt.pk)) globalThis.__shLog.push({ t: S.t, team: p.team, pr: pressure, d: hyp(fx(p.team, L) - p.x, GOAL_Y - p.y) });
      if (uOn(p, 'byakuya') || uOn(p, 'midori')) pressure = 0;                  // 白夜の視界・翠の起点：プレスを受けても落ち着いて蹴れる
      else if (pressure) { const a = aura(p, 'calmness'); if (a) pressure *= 1 - 0.3 * a; }   // 落ち着き（レジスタのサポートパッシブ）
      const fatigue = 1 - (p.sk.has('lateGrit') && S.t * CLOCK_SCALE / 60 >= 70 ? Math.max(p.cur, 60) : p.cur) / 100;   // 終盤の粘り：疲れてもプレーが落ちない
      const maxV = 12 + p.kick * 0.28;                      // キック力 50 → 26m/s、80 → 34m/s
      let csGkNear = 0, driveG = 0, driveUp = 0, driveOn = false, csPlace = false, csType = '', ang = Math.atan2(dy, dx), speed, vz = 0, spin = 0, knuckle = false, bs = -0.4, aimCurve = false;
      if (kind === 'shot') {
        // 目で追える速さ（カルチョビットA程度）。強い選手ほど速いが、最速でも70km/h台
        speed = clamp((15.5 + p.kick * 0.1 + (p.physical - 50) * 0.03) * (0.93 + R.next() * 0.12) * (1 - fatigue * 0.1), 14, 27);   // 時速50〜95km（入りそうな強さ）
        if (opt.calm) speed *= 0.88;   // 1対1は流し込む
        const SPD = { powerMid: 1.22, toeKick: 1.0, volley: 1.12, bicycle: 1.02, nearPost: 1.12, direct: 1.04, divingHeader: 0.85 };
        if (opt.skill && SPD[opt.skill]) speed *= SPD[opt.skill];
        if (uOn(p, 'guren') && !opt.fk && !opt.pk) speed = p.uniqLv >= 2 ? Math.min(36, speed * (1 + 0.36 * grF(p))) : Math.min(34, speed * (1 + 0.28 * grF(p)));   // 紅蓮の牙：威力が上がる（凸でさらに速く強く）
        // コントロールショット：どれもコースを正確に狙って隅へ「置きに行く」シュート。強さは3段階
        //  しっかり強い球で置きに行く（3割）／浮き球で置きに行く（5割）／グラウンダーで置きに行く（2割：半分はゆるく転がす、半分は強いグラウンダー）
        if (opt.skill === 'controlShot') { csPlace = true; const r = R.next();
          // GKがニア寄りに立っている時だけ、ファーへ転がすコロコロ（反応が遅れて届かない）。それ以外はほとんど浮かせるか強く蹴る
          { const g0 = opps(p).find((q) => q.gk), ns = Math.sign(p.y - GOAL_Y) || 1;
            csGkNear = g0 ? ((g0.y - GOAL_Y) * ns > POST - 0.9 || g0.vy * ns > 1.2 ? 1 : 0) : 0; }   // ニアの柱に寄っている／ニアへ動いている
          const gNear = csGkNear > 0.5, pg = gNear ? 0.2 : 0.03;
          csType = r < pg ? 'ground' : r < pg + (gNear ? 0.16 : 0.1) ? 'groundStrong' : r < 0.62 ? 'loft' : 'strong';
          speed *= csType === 'strong' ? R.range(1.12, 1.25) : csType === 'loft' ? R.range(0.82, 0.95) : csType === 'groundStrong' ? R.range(1.08, 1.2) : R.range(0.98, 1.08); }
        if (opt.skill === 'powerMid' || opt.skill === 'nearPost') speed = R.range(35, 37.5) * (0.9 + p.kick * 0.001);   // 溜めて時速130km前後
        // 大事な場面（PK・終盤の接戦）はメンタルが低いと精度が落ちる
        const late = (S.t % HALF) > HALF * 0.85 && Math.abs(S.score[0] - S.score[1]) <= 1;
        let menF = 1 + ((opt.pk || late) ? Math.max(0, 75 - p.mental) * 0.012 : 0);
        { const close = S.t >= HALF && Math.abs(S.score[0] - S.score[1]) <= 1;
          if ((T[p.team].capBuff || 0) > S.t) menF *= 0.85;   // 版838：キャプテンシー：落ち着いて蹴れる
          if (p.sk.has('calm') && (opt.pk || d < 18)) menF = Math.min(menF, 1) * 0.72;          // 冷静：ゴール前・PKで慌てない
          if (p.sk.has('clutch') && (T[p.team].urg || opt.pk)) menF *= 0.72;                   // 勝負強さ：追いかける終盤・PKで決める
          if (p.sk.has('bigStage') && close) menF *= 0.82; }                                   // 大舞台に強い：接戦の後半
        ang += menF * Math.max(0.3, 2.1 - p.kick / 55) * (1 - DOM[p.team] * 0.72) * R.gauss() * (opt.calm ? 0.3 + (1 - p.mental / 100) * 0.6 : 1) * (opt.pk ? 0.03 + (1 - p.mental / 100) * 0.03 : 0.065 + d * 0.0032 - p.kick * 0.0004 + pressure * 0.05 + fatigue * 0.04);
        if (!opt.pk && !opt.empty && d > 12) ang += R.gauss() * (d - 12) * 0.006 * (1.15 - p.kick / 200) * (opt.fk ? 0.6 : 1);   // 版790：遠くからのシュートは、キックがSでも隅ぴったりには行きにくい（上のリーグでミドル・ロングが入りすぎていた）
        if (opt.empty) ang = Math.atan2(dy, dx) + (ang - Math.atan2(dy, dx)) * 0.12;   // 無人のゴール：ほとんどズレない
        // 弾道：低く速いグラウンダーは2割。多くはすねから胸の高さ、時々バーの下ギリギリへズバッと
        {
          // グラウンダー・すね〜胸・頭上〜バーぎりぎりまで幅広く。キックが下手・遠い・寄せられていると上下にもブレる（バーの上へふかす）
          const r0 = R.next();
          let h = opt.pk ? R.range(0.2, 2.0) : r0 < 0.22 ? R.range(0.1, 0.4) : r0 < 0.62 ? R.range(0.5, 1.8) : R.range(1.8, 2.75);
          if (!opt.pk) h += R.gauss() * menF * (0.1 + (1 - p.kick / 100) * 0.6 + pressure * 0.3 + d * 0.008) * (1 - DOM[p.team] * 0.6) * (uOn(p, 'guren') ? Math.max(0.2, 1 - (p.uniqLv >= 2 ? 0.7 : 0.55) * grF(p)) : 1);   // 紅蓮の牙：ふかさない
          h = Math.max(0.05, h);
          if (opt.empty) h = R.range(0.1, 0.7);   // 無人のゴール：低く確実に
          const t = Math.max(0.15, d / speed);
          vz = clamp((h * 1.06 - b.z + 4.9 * t * t) / t, 0.2, 10);   // 空気抵抗で落ちる分を少し見込む
        }
        // インパクトの強いシュート（しっかり振り抜く）：ふつうより速い
        if (!opt.pk && !opt.calm && !opt.skill && R.next() < 0.35) speed = Math.min(30, speed * 1.18);
        // 技ごとの精度（コントロールショットは正確、ボレー・バイシクルは難しい）
        const NOISE = { driveShot: 0.9, controlShot: 0.6, toeKick: 0.9, volley: 1.15, bicycle: 1.3, powerMid: 1.05, nearPost: 0.85, direct: 0.85, divingHeader: 1.1 };
        if ((p.ppShot || 0) > S.t) { ang = Math.atan2(dy, dx) + (ang - Math.atan2(dy, dx)) * 0.55; p.ppShot = 0; }   // 版838：ピンポイントクロスを合わせたシュートは正確
        if (opt.skill && NOISE[opt.skill]) ang = Math.atan2(dy, dx) + (ang - Math.atan2(dy, dx)) * NOISE[opt.skill] * (csPlace ? 0.6 : 1);   // 置きに行く時はさらに正確
        // 固有スキル：紅蓮の牙（威力と精度が大きく上がる）・紫電の遊戯／影からの一撃（精度が上がる）
        { const m = uOn(p, 'guren') ? Math.max(0.12, 1 - (p.uniqLv >= 2 ? 0.85 : 0.83) * grF(p)) : uOn(p, 'kage') ? (p.uniqLv >= 2 ? 0.2 : 0.26) : uOn(p, 'shiden') ? 0.55 : uOn(p, 'tsukikage') && p.uniqLv >= 2 ? 0.72 : 1;   // 月影の抜け出し：シュートの補正は凸してから（若干）
          if (m < 1) { const um = Math.max(0.15, 1 - (1 - m) * uP(p)); ang = Math.atan2(dy, dx) + (ang - Math.atan2(dy, dx)) * um; }
          if (p.uniq === 'tsukikage' && !(p.uniqLv >= 2) && S.t - Math.max(p.tsukiRecv || -99, p.uFireT || -99) < 8) ang = Math.atan2(dy, dx) + (ang - Math.atan2(dy, dx)) * 1.35;   // 月影の抜け出し（無凸）：走り抜けた勢いのまま打つので、シュートは少しぶれる
          if ((p.tactBuff || 0) > S.t) ang = Math.atan2(dy, dx) + (ang - Math.atan2(dy, dx)) * ((p.hariT || 0) > S.t ? 0.8 : p.tactLv >= 2 ? 0.7 : 0.85); }   // 指揮の余韻：シュートも正確（凸でさらに）
        if (opt.skill === 'nearPost') { const t = d / speed; vz = clamp((2.25 + 4.9 * t * t) / t, 0.5, 8); }   // ニアの上（バーの下）へ
        if (opt.skill === 'volley' || opt.skill === 'bicycle' || opt.skill === 'toeKick') vz = R.range(0.2, 1.6);
        bs = -0.25;                                       // 強いシュートは少しドライブ回転（落ちる）
        if (opt.fk) {
          const master = p.sk.has('fk');
          speed = clamp(18 + p.kick * 0.06, 18, 25) * (master ? 1.05 : 1);
          const t = d / speed * 1.08, h = master ? R.range(1.6, 2.4) : R.range(1.3, 2.8);
          vz = clamp((h + 4.9 * t * t) / t, 4, 9); bs = -0.5;
          ang = Math.atan2(dy, dx) + R.gauss() * (master ? 0.012 : 0.04 - p.kick * 0.0002);
        }
        if (opt.chip) {
          const elev = R.range(0.7, 0.88);
          bs = 0.6;
          const v3 = solve((v) => flightDist(v, elev, bs), 4, maxV, d * R.range(0.9, 1.02)) * (1 + R.gauss() * 0.04 * (1.4 - p.technique / 100));
          speed = v3 * Math.cos(elev); vz = v3 * Math.sin(elev);
        } else if (opt.skill === 'superLong') {
          // 超ロング：高く上げて、GKの頭上から落とす
          const elev = R.range(0.42, 0.55); bs = 0.2;
          const v3 = solve((v) => flightDist(v, elev, bs), 4, maxV * 1.1, d * R.range(0.97, 1.03));
          speed = v3 * Math.cos(elev); vz = v3 * Math.sin(elev);
        } else if (opt.skill === 'knuckle') {
          // 無回転：普通のシュートより強く（強烈ミドルほどではない）、すね〜バーの下の高さを、ブレながら飛ぶ（グラウンダーにはしない）
          knuckle = true; bs = 0; speed = R.range(29, 32) * (0.92 + p.kick * 0.001);
          { const t = Math.max(0.2, d / speed * 1.1), h = R.range(1.3, 2.4); vz = clamp((h + 4.9 * t * t) / t, 1.5, 9); }
          if (opt.fk) { speed *= 0.9; const t = d / speed * 1.1, tw = 9.15 / speed, h = R.range(1.9, 2.6); vz = Math.max(clamp((h + 4.9 * t * t) / t, 1.5, 10), (2.9 + 4.9 * tw * tw) / tw); }   // FKの無回転：壁を越えてから、ブレながら落ちる
        } else if (opt.skill === 'driveShot') {
          // ドライブシュート（強い縦回転）：強く蹴り上げ、バーの上を越える高さまで上がる。頂点を過ぎると急に落ちて、バーすれすれに入る
          bs = 0; speed = R.range(24, 27) * (0.94 + p.kick * 0.0008);
          const z0 = Math.max(b.z, 0.1);
          // 試合と同じ刻みで弾道を計算する（g2：頂点を過ぎてからの落ち方）。ゴールライン上の高さ／頂点の高さを返す
          const fly = (w0, up, g2) => { let x = 0, z = z0, vh = speed, w = w0, top = z0;
            for (let k = 0; k < 400; k++) { const px0 = x, pz0 = z; x += vh * DT; const v3 = Math.hypot(vh, w); vh -= AIR * v3 * vh * DT; w -= (9.8 + AIR * v3 * w + (w < 0 ? g2 : up)) * DT; z += w * DT; top = Math.max(top, z);
              if (x >= d) return { z: pz0 + (z - pz0) * (d - px0) / (x - px0 || 1), top, t: (k + (d - px0) / (x - px0 || 1)) * DT }; if (z < -3) break; }
            return { z, top, t: 9 }; };
          const tTot = (() => { let x = 0, vh = speed; for (let k = 1; k < 400; k++) { const px0 = x; x += vh * DT; vh -= AIR * vh * vh * DT; if (x >= d) return (k - 1 + (d - px0) / (x - px0)) * DT; } return 3; })();
          const tA = tTot - Math.max(0.42, tTot * R.range(0.36, 0.42)), H = BAR + R.range(1.0, 1.6);
          driveUp = Math.max(0, 2 * (H - z0) / (tA * tA) - 9.8);   // 上がる間：ぐんと上がって、頂点で止まる
          { let lo = 1, hi = 30; for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (fly(m, driveUp, 200).top < H) lo = m; else hi = m; } vz = (lo + hi) / 2; }   // 空気抵抗を見込んで、狙った高さまで上がる初速
          const zT = BAR - R.range(0.6, 1.1) + R.gauss() * (0.16 + (1 - p.kick / 100) * 0.3) * menF;   // 狙いはバーのすぐ下（キックが下手だとバーの上へ外れる）
          if (fly(vz, driveUp, 0).z <= zT) driveG = 0;
          else { let lo = 0, hi = 200; for (let it = 0; it < 28; it++) { const m = (lo + hi) / 2; if (fly(vz, driveUp, m).z > zT) lo = m; else hi = m; } driveG = (lo + hi) / 2; }
          driveG = Math.max(driveG, 0.01); driveOn = zT < BAR - 0.1;
        } else if (opt.skill === 'controlShot' && opt.fk) {
          // FKのコントロールショット：壁の上を越えて、巻きながら隅へ正確に置く
          spin = (R.next() < 0.5 ? 1 : -1) * (0.4 + p.technique * 0.005); aimCurve = true; bs = 0.1; csPlace = false;
          speed *= 1.18;   // FKのコントロールショットは強めに蹴る
          { const t = d / speed * 1.08, tw = 9.15 / speed, h = R.range(1.7, 2.5); vz = Math.min(10, Math.max(clamp((h + 4.9 * t * t) / t, 3, 10), (2.7 + 4.9 * tw * tw) / tw)); }
        } else if (opt.skill === 'controlShot') {
          spin = 0; bs = 0.1; vz = R.range(0.4, 1.4);   // ファーの隅へ、低く正確に置く
        } else if (opt.fk && p.sk.has('curve')) {
          // カーブキックはセットプレー（直接FK）で：壁の外から巻いてゴールへ
          spin = (R.next() < 0.5 ? 1 : -1) * (0.45 + p.technique * 0.006); aimCurve = true; bs = 0.1;
          act(p, 'skill', 1.4, { k: 'curve' });
        } else spin = R.gauss() * 0.1;
        if (opt.fk && p.sk.has('fk')) act(p, 'skill', 1.6, { k: 'fk' });
        if (opt.pk && p.sk.has('pkMaster')) { act(p, 'skill', 1.6, { k: 'pkMaster' }); ang = Math.atan2(dy, dx) + R.gauss() * 0.01; }
      } else if (loft) {
        // 浮き球：蹴り方で角度が決まり、落下地点に届く強さを逆算。届かない距離はキック力で頭打ち
        const style = typeof loft === 'string' ? loft : 'drive';
        const [a0, a1] = LOFT_ANGLE[style] || LOFT_ANGLE.drive;
        const elev = a0 + R.next() * (a1 - a0);
        const land = d * (opt.landFrac ?? (style === 'lob' || style === 'cross' || style === 'dink' ? 1 : 0.9));
        const curve = opt.spinSign != null;
        // 回転：キックがうまいほど、まっすぐ蹴る球はきれいなバックスピン、曲げる球はしっかり曲がる
        const clean = clamp(p.kick * 0.4 + p.pass * 0.6, 0, 100) / 100;
        if (curve) {
          // カーブキックを覚えていると大きく曲げられる
          const cs = p.sk.has('curve');
          spin = opt.spinSign * (0.2 + p.pass * 0.0065) * (opt.spinMul ?? 1) * (cs ? 1.35 : 0.25 + p.pass * 0.006);   /* v741 カーブの技がなくても、パスが上手いほど曲げられる（E 0.49・S 0.78） */
          if (cs && style === 'cross' && !((p.skLock || 0) > S.t && S.t - (p.skLastT ?? -9) > 0.05)) act(p, 'skill', 1.2, { k: 'curve' });   // 前の技の直後なら吹き出しは重ねない
          bs = 0.15 + clean * 0.25;
          aimCurve = true;
        } else {
          bs = style === 'lob' || style === 'dink' ? 0.35 + clean * 0.35 : style === 'clear' ? R.range(-0.2, 0.5) : (0.25 + clean * 0.65) * (1 - pressure * 0.3);
          spin = R.gauss() * (0.05 + (1 - clean) * 0.32 + pressure * 0.08);   // 下手だと意図しない横回転で曲がる
        }
        const v3 = solve((v) => flightDist(v, elev, bs), 4, maxV * 1.05, land) * (1 + (opt.acc ?? 1) * R.gauss() * 0.045 * (1.4 - p.pass / 100));
        speed = v3 * Math.cos(elev); vz = v3 * Math.sin(elev);
        ang += (opt.acc ?? 1) * R.gauss() * clamp(0.06 - p.pass * 0.0006 + pressure * 0.04 + fatigue * 0.03 + d * 0.0005, 0.01, 0.2);
      } else {
        const vEnd = (opt.vEnd || (3.5 + d * 0.1 + p.pass * 0.065) * (1 + DOM[p.team] * 0.2)) * (kind === 'pass' && T[p.team].mdStack && !globalThis.__mdNoSpd ? Math.min(1.12, Math.pow(1.03, T[p.team].mdStack)) : 1);   /* 版451 翠の起点の積み重ね：パスの速さ（1回ごとに1.08倍・最大1.4倍。速すぎるとトラップが難しくなるので控えめ） */   // 格上はテンポよく強いパス   // うまい選手ほど強く正確なパス（相手に追いつかれにくい）
        speed = solve((v) => rollEnd(v, d), 4, 40, vEnd);
        if (opt.arriveT) { const rt = (v) => { let x = 0, vv = v, t = 0; while (x < d && t < 8) { x += vv * DT; vv -= groundDec(vv) * DT; t += DT; if (vv <= 0.1) return 99; } return t; };
          let lo = 4, hi = maxV; for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (rt(m) > opt.arriveT) lo = m; else hi = m; } speed = Math.max(speed * 0.8, (lo + hi) / 2); }   // 月影の抜け出し：走り込む本人と同時に着く強さ
        speed = clamp(speed * (1 + R.gauss() * (0.02 + (1 - p.pass / 100) * 0.1 + (1 - p.vision / 100) * 0.08) * (opt.arriveT ? 0.5 : 1) * Math.min(1, (opt.acc ?? 1) * 2)), 6, maxV);   // 下手だと強すぎ・弱すぎ
        if (opt.spinSign != null && kind === 'pass') { spin = opt.spinSign * (0.1 + p.pass * 0.005); aimCurve = true; }   /* v741 巻いたグラウンダー：パスが上手いほど強く・狙いどおりに曲げられる */
        ang += (opt.acc ?? 1) * (S.oneTouch ? Math.max(0.4, 2.2 - (p.pass + p.vision) / 80) * (S.oneTouchBoost ? 0.55 : 1) : 1) * R.gauss() * clamp(0.12 - p.pass * 0.0013 + pressure * 0.045 * clamp(1.6 - p.pass / 100, 0.5, 1.2) + fatigue * 0.035 + d * 0.0006, 0.008, 0.2);
      }
      // 利き足：逆足で蹴ると精度とパワーが落ちる（キック・テクニックが低いほど差が大きく、Sで差がなくなる）
      let usedFoot = p.foot === 'L' ? 'L' : 'R';   // 実際に蹴った足（絵で右足・左足を描き分ける）
      if (!opt.pk && !opt.fk) {
        const foot = p.foot === 'L' ? -1 : 1, side = sgn(p.team) * (p.y - GOAL_Y) * foot;   // side>0：利き足の側（右利きなら右サイド）
        const style2 = typeof loft === 'string' ? loft : '';
        const pw = kind === 'shot' ? (side > 6 ? 0.38 : side < -6 ? 0.14 : 0.26) : style2 === 'cross' ? (side > 6 ? 0.12 : side < -6 ? 0.46 : 0.25) : 0.25;
        if (R.next() < pw) {
          const gap = clamp((84 - (p.kick + p.technique) / 2) / 50, 0, 1);
          if (gap > 0) {
            const base = Math.atan2(dy, dx);
            ang = base + (ang - base) * (1 + 0.9 * gap) + R.gauss() * 0.035 * gap;
            speed *= 1 - 0.15 * gap; vz *= 1 - 0.06 * gap;
          }
          S.weakKick = (S.weakKick || 0) + 1; usedFoot = usedFoot === 'L' ? 'R' : 'L';
        }
      }
      let forced = 0; if (p.forceFoot && S.t < p.forceFoot.until) { usedFoot = p.forceFoot.f; p.forceFoot = null; forced = 1; }   // キックフェイントでずらした側の足
      // コントロールショット：狙うファーの隅の側の足で巻く（左サイドから右隅へは右足、右サイドから左隅へは左足）
      if (kind === 'shot' && opt.skill === 'controlShot') { const toRight = sgn(p.team) * (ty - GOAL_Y) > 0; usedFoot = toRight ? 'R' : 'L'; forced = 1; }
      act(p, 'kf', 0.6, forced ? { f: usedFoot, forced } : { f: usedFoot });   // 蹴った足（右・左）
      // 曲がる分を見越して狙いをずらす（うまい選手ほど正確）
      // 曲げる球は曲がる分を見越して狙う（うまい選手ほど見積もりが正確）
      if (spin && (aimCurve || kind === 'shot') && opt.skill !== 'controlShot') ang -= 0.12 * spin * d / speed * (1 + R.gauss() * clamp(0.4 - (kind === 'pass' ? p.pass : p.technique) * 0.0042, 0.04, 0.3));   /* パスの曲がりの読みはパスの能力 */
      let curveAll = false;
      if (opt.skill === 'controlShot') {
        // ファーへ外巻き：ゴールの外へ向かって飛び出し、外から巻いてファーの隅へ入る
        const fs = Math.sign(ty - GOAL_Y) || 1, sv = Math.sign(dx) || 1;
        spin = -fs * sv * (0.95 + Math.max(0, p.kick - 60) * 0.012); curveAll = true;   // 強く巻く：キック力があるほど鋭い
        { const t = Math.max(0.2, d / speed * 1.12);
          let h = (csType === 'ground' || csType === 'groundStrong' ? R.range(0.05, 0.35) : csType === 'loft' ? R.range(0.9, 1.9) : R.range(0.5, 2.2)) + R.gauss() * (0.08 + (1 - p.technique / 100) * 0.6);   // 置きに行く：低め〜腰の高さで隅へ。強く巻く：膝上〜バーの下。精度の低い選手はふかすことも
          h = Math.max(0.05, h); vz = clamp((h + 4.9 * t * t) / t, csType === 'ground' || csType === 'groundStrong' ? 0.3 : 1.0, csType === 'ground' ? 2.6 : csType === 'groundStrong' ? 1.6 : csType === 'loft' ? 7 : 10); }   // グラウンダーは低く滑らせる。浮き球は高すぎない弧で隅へ
        const simY = (a) => {
          let x = b.x, y = b.y, vx = Math.cos(a) * speed, vy = Math.sin(a) * speed, z = Math.max(b.z, 0.1), w = vz;
          for (let k = 0; k < 200; k++) {
            const sp = hyp(vx, vy) || 1, lat = spin * sp * 0.24;
            const nx0 = -vy / sp, ny0 = vx / sp; vx += nx0 * lat * DT; vy += ny0 * lat * DT;
            if (z > 0 || w > 0) {
              const v3 = Math.hypot(vx, vy, w); vx -= AIR * v3 * vx * DT; vy -= AIR * v3 * vy * DT; w -= (9.8 + AIR * v3 * w) * DT; z += w * DT;
              if (z <= 0) { z = 0; const hard = Math.abs(w) > 2.2; const kp = hard ? BOUNCE_H : 0.92; vx *= kp; vy *= kp; w = hard ? -w * BOUNCE_V : 0; }
            } else { const ns = Math.max(0, sp - groundDec(sp) * DT); vx *= ns / sp; vy *= ns / sp; }
            const nx = x + vx * DT; if ((nx - tx) * (x - tx) <= 0) return y + vy * DT * ((tx - x) / (nx - x || 1)); x = nx; y += vy * DT;
          }
          return y;
        };
        const base = Math.atan2(dy, dx); let lo = base - 0.7, hi = base + 0.7;
        const f0 = (a) => simY(a) - ty, sLo = f0(lo), sHi = f0(hi);
        if ((sLo < 0) === (sHi < 0)) { spin = 0; curveAll = false; ang = base; }
        else {
          for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2, fm = f0(mid); if ((fm < 0) === (sLo < 0)) lo = mid; else hi = mid; }
          ang = (lo + hi) / 2 + R.gauss() * clamp(0.03 - p.technique * 0.00025, 0.004, 0.03);
        }
      }
      Object.assign(b, {
        owner: -1, kind, selfPass: false, gkPen: 0, uSafe: 0, uDelay: 0, guren: 0, tsukiP: false, trapP: false, tact: false, hari: false, hariS: 0, byP: false, aoP: false, brk: false, csPlace, csType, csGkNear, shotSkill: '', ot: 0, conv: false, pkStop: false, shotT: S.t, sx0: p.x, sy0: p.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        z: Math.max(b.z, 0.1), vz, spin, bs, knuckle, wob: 0, wobW: null, curveAll, curlP: kind === 'pass' && !loft && !!spin && opt.spinSign != null, aimY: ty, drive: driveG, driveUp, driveOn,
        lastTeam: p.team, lastPlayer: p.idx, kicker: p.idx, kickKind: kind, style: kind === 'shot' ? 'shot' : loft ? (typeof loft === 'string' ? loft : 'drive') : 'ground',
      });
      if (kind === 'pass' && loft && !S.restart && !(S.gkCk && S.t < S.gkCk.until)) gkHighCall(p, b);   // 版834：浮き球のクロス・放り込みに、GKが出るか決める
      p.touchCd = 0.6; p.hold = false; p.dO = 0.5; p.dV = 0; p.settle = false;
      S.dribbleDir = null;
      S.kickRec = p.idx;   // キックのモーション用
      S.oneTouch = false; S.oneTouchBoost = false;
    }

    // ワンツーのリターン先：走り込む味方の前方、相手の裏のスペース（足元ではない）
    function otSpot(p, rn) {
      const o = rn.otRun || { x: Math.min(L - 6, fx(p.team, rn.x) + 8), y: rn.y }, offL = offsideLine(p.team);
      const rxf = fx(p.team, rn.x), ahead = Math.min(Math.max(rxf + 4.5, Math.min(o.x, offL + 3)), rxf + 9, L - 6);
      const k = clamp((ahead - rxf) / Math.max(1, o.x - rxf), 0, 1);
      return [fx(p.team, ahead), clamp(rn.y + (o.y - rn.y) * Math.max(k, 0.6), 3, W - 3)];
    }
    // 相手（DFもGKも）が取れない所へ落とすスルーパスの地点：ボールの通り道で相手の足が届かず、落ちる所には受け手が先に着く。その中でいちばんゴールに近い所。なければ null
    // 蒼の王座・渦潮の囮の1本：蹴ったボールの進み方（転がる・浮く・落ちてから転がる）を先読みして、受け手が相手（DF・GK）より確実に先に触れる所だけを選ぶ
    const AOV = new Map();
    function aoReach(p, q, lx, ly, ch, vEnd, sp, os, fr, need) {
      const dx = lx - p.x, dy = ly - p.y, d = hyp(dx, dy), ux = dx / d, uy = dy / d, ne = need ?? 9;
      let tl = 0, vg;   // 地面を転がる速さ（浮き玉は落ちるまで触れない）
      if (ch) { tl = 0.38 * Math.sqrt(d) + 0.08; vg = Math.max(2, d / tl * 0.5); } else { const key = Math.round(d * 2) * 100 + Math.round(vEnd * 10); vg = AOV.get(key); if (vg == null) { vg = solve((x) => rollEnd(x, Math.round(d * 2) / 2), 4, 40, vEnd); AOV.set(key, vg); } }
      const n = os.length, tO = new Array(n).fill(99), osp = os.map((o) => maxSpeed(o) * (o.gk ? 1.15 : 1)), ovs = os.map((o) => (o.downT > 0 ? o.downT : 0) + Math.max(0, (o.lagT || 0) - S.t));   // 見失っている・倒れている相手は、そのぶん遅れる
      if (!fr) for (let i = 0; i < n; i++) { const o = os[i]; if (o.gk || hyp(o.x - p.x, o.y - p.y) > 3.5 || (o.lagT || 0) > S.t + 0.1) continue; const sd = segDist(o.x, o.y, p.x, p.y, p.x + ux * Math.min(d, 4), p.y + uy * Math.min(d, 4)); if (sd.u > 0.02 && sd.d < (ch ? 1.0 : 1.3)) return { tR: 9, m: -9, tO }; ovs[i] += 0.2; }   // 蹴る足もとの相手：出す方向をふさいでいる時だけ引っかけられる。背中・横にいる相手は、出た球を追いかけるだけ
      let x = 0, t = 0, tR = 99; const st = 0.06;
      for (let k = 0; k < 90; k++) {
        if (ch && t < tl) { x = d * t / tl; } else { if (ch && t - st < tl) x = d; x += vg * st; vg -= groundDec(vg) * st; }
        t += st; const bx = p.x + ux * x, by = p.y + uy * x; if (bx < 0.5 || bx > L - 0.5 || by < 0.5 || by > W - 0.5) break;
        const zz = ch && t < tl ? 4.9 * t * (tl - t) : 0, low = !ch || zz < 2.4 || (t > tl / 2 && zz < 3.4);   // 浮き球：上がっていく間は頭も届かない。落ちてきて3.3mより下になると、ヘディングで触られる
        if (low) { if (tR === 99 && (!ch || zz < 1.8 && t > tl / 2) && x >= d * (fr || 0.5) && (ch || vg < 12)) { const dq = hyp(bx - q.x, by - q.y), mom = dq > 0.5 ? clamp((q.vx * (bx - q.x) + q.vy * (by - q.y)) / dq / sp, 0, 1) * 0.2 : 0; if (Math.max(0, dq - 0.8) / sp + 0.25 - mom <= t) tR = t; }   // もう走っている受け手は、その勢いのぶん速い
          const bxf = fx(p.team, bx);
          for (let i = 0; i < n; i++) { if (tO[i] < 99) continue; const o = os[i], gkB = o.gk && L - bxf < 16.5 && Math.abs(by - GOAL_Y) < 20.16, ex = bx - o.x, ey = by - o.y, dd = hyp(ex, ey), mo = dd > 0.5 ? clamp((o.vx * ex + o.vy * ey) / dd / osp[i], 0, 1) * 0.3 : 0;
            if (Math.max(0, dd - (gkB ? 1.8 : 1.3)) / osp[i] - mo + (o.gk ? 0.3 : dd < 3.5 && hyp(o.x - p.x, o.y - p.y) > 3.5 ? 0.05 : 0.25) + (!o.gk && dd > 4 && bxf > fx(p.team, o.x) + 4 ? 0.25 : 0) + ovs[i] <= t) { tO[i] = t; if (t < (tR === 99 ? 99 : tR) + ne && (tR === 99 || t - tR < ne)) return { tR: tR === 99 ? t + 1 : tR, m: t - (tR === 99 ? t + 1 : tR), tO }; } } }   // 相手が先に（余裕なく）触れる：その時点で不可
        if (!ch && vg < 0.3) { if (tR === 99) tR = t + Math.max(0, hyp(bx - q.x, by - q.y) - 0.8) / sp; break; }
        if (tR < 99 && t > tR + Math.min(ne, 0.6)) break;
      }
      return { tR, m: Math.min(...tO) - tR, tO };
    }
    const MD_CFG = { maxD: 62, maxG: 46, maxY: 18, maxT: 5.8, lobLate: 1.3, mL: 0.5, mG: 0.35 };   /* 版448 翠の起点：自陣から、がら空きの裏へ（遠くまで） */
    function safeThrough(p, q, cfg) {
      const ck = p.idx * 100 + q.idx + (cfg ? 50000 : 0); if (S.aoSTc && S.aoSTc.k === ck && S.t - S.aoSTc.t < 0.15) return S.aoSTc.v;
      const offLp = offsideLine(p.team), qf = fx(p.team, q.x), sp = maxSpeed(q) * ((q.aoFast || 0) > S.t || q.aoKeepFast ? 1.15 : 1), os = opps(p).filter((o) => !o.off && !(cfg && o.mdLure && o.mdLure.by === p.idx));
      let best = null, bm = -1e9;
      for (const ch of [false, true]) for (let dx = -6; dx <= 22; dx += 2) { if (ch && dx < 2) continue; const lf = Math.min(Math.max(offLp + dx, qf + 3), L - 10); for (const yo of [0, -4, 4, -8, 8, -13, 13]) {
          const ly = clamp(q.y + (GOAL_Y - q.y) * 0.2 + yo, 4, W - 4), lx = fx(p.team, lf), dB = hyp(lx - p.x, ly - p.y); if (dB < 8 || dB > (cfg ? cfg.maxD : 40) || (ch && dB < 12) || L - lf > (cfg ? cfg.maxG : 33) || Math.abs(ly - GOAL_Y) > (cfg ? cfg.maxY : 19)) continue;   // 出たら決定的：ゴール前（PAの幅・30m以内）に落とせる時だけ
          for (const ve of ch ? [0] : [3.2, 5.5]) { const r = aoReach(p, q, lx, ly, ch, ve, sp, os, 0, 0.45); if (globalThis.__stD) { const d0 = globalThis.__stD; d0.n++; if (r.tR > 4.5) d0.late++; else if (r.m < (ch ? 0.8 : 0.45)) { const i = r.tO.indexOf(Math.min(...r.tO)); const o = os[i]; const k = o.gk ? 'GK' : hyp(o.x - p.x, o.y - p.y) < 6 ? 'nearPasser' : hyp(o.x - q.x, o.y - q.y) < 5 ? 'nearRecv' : fx(p.team, o.x) > fx(p.team, q.x) + 3 ? 'ahead' : 'path'; d0[k] = (d0[k] || 0) + 1; } else d0.ok++; } if (r.tR > (cfg ? cfg.maxT : 4.5) || r.m < (cfg ? (ch ? cfg.mL : cfg.mG) : (ch ? 0.8 : 0.45))) continue;
            if (ch && r.tR > 0.38 * Math.sqrt(dB) + 0.08 + 0.35 + (cfg ? cfg.lobLate : 0)) continue;   // 浮き球は、落ちてすぐ受け手が触れる所だけ（弾んでいる間に相手に寄せられない）
            if (globalThis.__stD) { const d0 = globalThis.__stD; if (r.m > (d0.bm ?? -99)) { d0.bm = r.m; } }
            if (ch) { const fS = cfg ? 0.94 : 0.85, r2 = aoReach(p, q, p.x + (lx - p.x) * fS, p.y + (ly - p.y) * fS, true, 0, sp, os, 0, 0.3); if (r2.m < (cfg ? 0.1 : 0.3)) { if (globalThis.__stD) globalThis.__stD.short = (globalThis.__stD.short || 0) + 1; continue; } }   // 浮き球が少し手前に落ちても、相手が先に触れないこと
            const v = lf * 0.5 - Math.abs(yo) * 0.05 + Math.min(r.m, 1.5) * 2 - (ch ? 1.5 : 0) - r.tR * 0.3; if (v > bm) { bm = v; best = [lx, ly, ch, ve, +r.m.toFixed(2), +r.tR.toFixed(2)]; } } } }   // 浮き玉：グラウンダーで通らない時は、DFの頭を越えて落とす
      S.aoSTc = { k: ck, t: S.t, v: best };
      return best;
    }
    // 版848：クリアの向き：目の前（4m以内・蹴る向き±30°）に相手がいたら、当てないように空いている側へ角度を変える（当てて跳ね返り合うのを防ぐ）
    function clearAim(p, tx, ty) {
      const dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy) || 1;
      const blk = (ax, ay) => opps(p).some((o) => { if (o.off) return false; const ox = o.x - p.x, oy = o.y - p.y, od = hyp(ox, oy); return od < 4.5 && (ox * ax + oy * ay) / (od || 1) > 0.85; });
      const ux = dx / d, uy = dy / d; if (!blk(ux, uy)) return [tx, ty];
      for (const a of [0.6, -0.6, 0.95, -0.95]) { const c = Math.cos(a), sn = Math.sin(a), vx = ux * c - uy * sn, vy = ux * sn + uy * c, nx = p.x + vx * d, ny = p.y + vy * d; if (!blk(vx, vy) && ny > -6 && ny < W + 6 && nx > 1 && nx < L - 1) return [nx, ny]; }
      return [tx, ty];
    }
    // 版848：奪った時、ボールは瞬間移動させずに、相手の足もとから自分の足もとへ転がして収める（どうやって取ったかが見えるように）
    function stealRoll(q, own) {
      const b = S.ball, tx = q.x + sgn(q.team) * 0.5, ty = q.y, bx = tx - b.x, by = ty - b.y, bl = hyp(bx, by) || 1;
      if (globalThis.__scnLog) globalThis.__scnLog.push(['tk', +S.t.toFixed(1), q.team]);
      if (bl < 0.6) { gainBall(q, 'tackle'); return; }
      const v = clamp(bl / 0.3, 3, 7);
      act(q, 'poke', 0.35, { dx: (b.x - q.x) / (hyp(b.x - q.x, b.y - q.y) || 1), dy: (b.y - q.y) / (hyp(b.x - q.x, b.y - q.y) || 1) });
      Object.assign(b, { owner: -1, kind: 'loose', vx: bx / bl * v, vy: by / bl * v, vz: 0, z: 0, lastTeam: own ? own.team : 1 - q.team, lastPlayer: own ? own.idx : -1, intended: -1 });   // 拾った瞬間に「奪った」扱いになるよう、最後に触ったのは奪われた側
      if (own) own.touchCd = Math.max(own.touchCd || 0, 0.7);
      for (const o of opps(q)) if (o !== own && hyp(o.x - b.x, o.y - b.y) < 3) o.touchCd = Math.max(o.touchCd || 0, 0.3);
      q.touchCd = Math.min(0.2, bl / v * 0.7); S.dribbleDir = null; if (own) own.settle = false;
    }
    // 版842：カウンターの走り出し：奪った選手より前・近くの選手が、一斉に相手ゴールへ走る（足が速い・スタミナがある選手ほど長く速く）
    function ctLaunch(p) {
      if (!p || S.setPiece || S.restart) return;
      const bx = fx(p.team, p.x), offL = offsideLine(p.team); let n = 0;
      const cand = mates(p).filter((m) => m !== p && !m.gk && !m.off && m.slot && (m.slot.line >= 1 || (Math.abs(m.slot.y - GOAL_Y) >= 9 && Math.sign(m.slot.y - GOAL_Y) === Math.sign(p.y - GOAL_Y) && fx(p.team, m.x) > bx - 10)) && fx(p.team, m.x) > bx - 18 && hyp(m.x - p.x, m.y - p.y) < 45)
        .sort((a, c) => (fx(p.team, c.x) - fx(p.team, a.x)) * 0.1 + (c.speed - a.speed) * 0.02);
      const maxN = 3 + (T[p.team].attitude === 'attacking' ? 1 : 0) - (T[p.team].attitude === 'defensive' ? 1 : 0);
      for (const m of cand) {
        if (n >= maxN) break;
        if (m.otRun && S.t < m.otRun.until && m.run > 0) continue;
        const mx = fx(p.team, m.x), wide = Math.abs(m.y - GOAL_Y) > 14, dur = 3.5 + (m.stamina || 50) / 60 + m.speed / 80;
        let rx, ry;
        if (wide) { rx = Math.min(Math.max(mx + 18, bx + 14), L - 10); ry = GOAL_Y + Math.sign(m.y - GOAL_Y) * 20; }   // サイド：外のレーンを一気に駆け上がる
        else { const sd = Math.sign(m.y - p.y) || (n % 2 ? 1 : -1); rx = Math.min(Math.max(mx + 16, offL + 8), L - 9); ry = clamp(GOAL_Y + sd * (4 + n * 2.5), 6, W - 6); }   // 中：斜めに相手CBの間・裏へ
        m.run = dur; m.runCd = 0; m.otRun = { x: rx, y: ry, until: S.t + dur }; m.pgRun = S.t + dur; m.ctRun = S.t + dur; n++;
        if (globalThis.__ctDbg) globalThis.__ctDbg.launch = (globalThis.__ctDbg.launch || 0) + 1;
      }
    }
    // パス＆ゴー・3人目の動き：出した選手は、もう一度裏へ抜け出す／開いてスペースで受け直す（ラインを越えるのは、自分にパスが出てから）
    function pgGo(p, q, mode) {
      if (!p || p.gk || p.off || S.setPiece || S.restart || globalThis.__noPG) return;
      const ax = fx(p.team, p.x), offL = offsideLine(p.team);
      if (ax < L / 2 - 8 || (p.position === 'DF' && ax < L - 40)) return;
      if (p.otRun && S.t < p.otRun.until && p.run > 0) return;
      let rx, ry; const nearLine = ax > offL - 13 && L - offL > 9;
      const free = (x, y) => { let m = 12; for (const o of opps(p)) { if (o.off || o.gk) continue; m = Math.min(m, hyp(fx(p.team, o.x) - x, o.y - y)); } return m; };
      if (mode === 'behind' || (mode !== 'open' && (nearLine ? R.next() < 0.7 : R.next() < 0.4))) {   // もう一度裏へ
        rx = Math.min(Math.max(ax + 10, offL + 7), L - 7); ry = clamp(p.y + (GOAL_Y - p.y) * 0.3 + (q && Math.abs(q.y - p.y) < 6 ? Math.sign(p.y - q.y || 1) * 4 : 0), 5, W - 5);
      } else {   // 開いて、空いているスペースで受け直す（そこから自分で仕掛ける）
        let best = null, bs = -1e9;
        for (const dy of [-14, -9, 9, 14]) for (const dx of [3, 8]) { const sx = Math.min(ax + dx, offL - 1), sy = clamp(p.y + dy, 4, W - 4); const v = free(sx, sy) - (q ? Math.max(0, 6 - hyp(fx(p.team, q.x) - sx, q.y - sy)) : 0) * 0.6 + R.next() * 1.5; if (v > bs) { bs = v; best = [sx, sy]; } }
        if (!best) return; [rx, ry] = best;
      }
      p.run = R.range(2.4, 3.4); p.runCd = 0; p.otRun = { x: rx, y: ry, until: S.t + 3.4 }; p.pgRun = S.t + 3.4; if (globalThis.__pgCnt) globalThis.__pgCnt.go++;
    }
    function isOTReturn(p, q) { return S.oneTwo && S.oneTwo.b === p.idx && S.oneTwo.a === q.idx && q.otRun && S.t < q.otRun.until; }
    function startPass(p, q, through, chip, skill) {
      if (globalThis.__tyDbg && (p.type === 'パサー' || p.type === 'ゲームメイカー')) { const G = globalThis.__tyDbg, k = p.type === 'パサー' ? 'PA' : 'GM'; G[k + 'pass'] = (G[k + 'pass'] || 0) + 1; if (through) G[k + 'thr'] = (G[k + 'thr'] || 0) + 1; if (fx(p.team, q.x) > fx(p.team, p.x) + 5) G[k + 'fwd'] = (G[k + 'fwd'] || 0) + 1; }
      if (globalThis.__tyDbg) { const G = globalThis.__tyDbg; if ((q.stDg || 0) > S.t) G.dgP++; if ((q.f9Run || 0) > S.t && p.type === '偽9番') G.f9P++; }
      const b = S.ball;
      // 桜島の号令（オフサイドトラップの超強化版）：ラインの近くの相手FWへ縦パスが出る瞬間を読み、出し手が蹴るまでのわずかな間にDF全員で一斉に押し上げる
      if (!S.trapGo && !S.setPiece && !S.restart && q && q.team === p.team && !p.gk && fx(p.team, q.x) > fx(p.team, p.x) + 3 && fx(p.team, q.x) > L / 2) {
        const d = 1 - p.team, gap = fx(p.team, q.x) - offsideLine(p.team), sk = T[d].players.find((m) => m.uniq === 'sakurajima' && !m.off), lv2 = sk && sk.uniqLv >= 2;
        const bait = lv2 && S.sjBait && S.sjBait.team === d && S.sjBait.until > S.t;   // 凸：ラインを下げて誘い込んだ直後は、クールタイム中でももう一度押し上げる（2段構え）
        if (sk && gap > (bait ? -11 : lv2 ? -3.0 : -2.0) && gap <= 0.3 && q.vx * sgn(p.team) > -0.5 && (bait ? sjForce(sk) : uFire(sk, 'sakurajima'))) {   // 凸：4m手前の相手にも仕掛けられる   // 下りてくる相手には効かない（裏を狙って待つ・走る相手に）
          S.lcStep = { team: d, until: S.t + (bait ? 1.6 : 1.2), mode: 'up', r: q.idx, big: true, all: true, trap: true }; act(sk, 'sjline', 1.6, { dt: d, lv: sk.uniqLv || 1, bait: bait ? 1 : 0 });
          const wt = bait ? 1.15 : 0.85; S.trapPend = { p: p.idx, q: q.idx, through, chip, skill, at: S.t + wt }; p.protect = Math.max(p.protect || 0, S.t + wt + 0.05);
          S.decision = wt; return;
        }
      }
      const trapRel = S.trapGo; S.trapGo = false;
      b.aoP = false; b.aoIn = false; b.mdP = !!(S.mdWant && uOn(p, 'midori')); b.aoFw = uOn(p, 'aonoouza') && !p.gk && fx(p.team, q.x) > fx(p.team, p.x) - 2;   // 前の1本の印は持ち越さない。蒼の王座の前へのパス
      if (skill && (p.skLock || 0) > S.t) skill = null;   // 技の直後に別の技は重ねない（ふつうのパスになる）
      // 走っている受け手には、ボールが届く頃にいる所へ出す（短いパスでも、届くまでの時間ぶん先へ）
      const dq = hyp(q.x - p.x, q.y - p.y), leadT = through ? 1.0 : chip ? 1.1 : clamp(0.25 + dq / 16, 0.35, 1.0);
      let tx = q.x + q.vx * leadT, ty = q.y + q.vy * leadT, aoStyle = null, aoVEnd = null;
      if (q.uniq === 'aonoouza' && !through && !chip && !q.off && !S.setPiece && !(q.uOn > S.t) && !(q.uCd > S.t) && fx(q.team, q.x) > 55 && fx(q.team, q.x) > fx(p.team, p.x) + 10 && dq < 34) {   // 蒼の王座：CBに張りついたくもいへの縦パスは、くもいが落ちてくる所（DFとMFの間）へ
        const dd = Math.min(5.5, (fx(q.team, q.x) - fx(p.team, p.x)) * 0.3); tx = fx(q.team, Math.max(fx(q.team, q.x) - dd, L / 2 + 4)); ty = q.y + (p.y - q.y) * 0.15; q.aoDrop = S.t + 2.5; q.aoDropTo = [tx, ty]; p.aoFast = S.t + 4.5; }   /* 落ちすぎない（自陣には戻らない）。縦パスを入れた選手は、抜け出す足が速くなる */
      if (through && !skill) {
        // スルーパス：相手DFラインの裏のスペースへ（受け手の足元ではない）
        const offLp = offsideLine(p.team), behind = Math.min(offLp + R.range(4, 8), L - 7);
        tx = fx(p.team, Math.max(behind, fx(p.team, q.x) + 3)); ty = clamp(q.y + q.vy * 0.5 + (GOAL_Y - q.y) * 0.15, 4, W - 4);
        if (S.uzWant) { const sp0 = safeThrough(p, q); if (sp0) { tx = sp0[0]; ty = sp0[1]; aoStyle = sp0[2] ? 'lob' : false; aoVEnd = sp0[3] || null; }  if (globalThis.__aoDbg) globalThis.__aoDbg.push({ t: S.t, ok: !!sp0, ch: sp0 ? sp0[2] : null, ve: sp0 && sp0[3], m: sp0 && sp0[4], tR: sp0 && sp0[5], py: +p.y.toFixed(1), pxf: +fx(p.team, p.x).toFixed(1), qy: +q.y.toFixed(1), tx: +fx(p.team, tx).toFixed(1), ty: +ty.toFixed(1), q: q.idx, qx: +fx(p.team, q.x).toFixed(1), ol: +offsideLine(p.team).toFixed(1), d: +hyp(tx - p.x, ty - p.y).toFixed(1) }); }   // 蒼の王座・渦潮の囮の1本：DFもGKも取れない所の中で、いちばんゴールに近い所へ落とす
        q.run = Math.max(q.run, 2.5);
      }
      if (S.mdWant && uOn(p, 'midori') && p.mdTo === q.idx) { tx = q.x + q.vx * 0.4; ty = q.y + q.vy * 0.4; aoStyle = false; aoVEnd = 6; }   /* 版449 翠の起点：フリーの味方の足もとへ、速いグラウンダー */
      if (uOn(p, 'kage') && (q.kmRunT || 0) > S.t && q.kmBy === p.idx && !through && !chip && !S.uzWant) { tx = q.x + q.vx * 0.45; ty = q.y + q.vy * 0.45; aoVEnd = 6; aoStyle = false; }   // 影の一刺し：走り込むFWの足もとの少し先へ
      if ((q.aoFin || 0) > S.t && q.uniq === 'aonoouza' && !through && !chip) { [tx, ty] = q.aoCutSpot || [q.x + q.vx * 0.3, q.y + q.vy * 0.3]; q.aoCutSpot = null; q.otRun = null; q.run = 0; q.uChase = { until: S.t + 1.5, mode: 'ball' }; aoVEnd = 6; aoStyle = false; }   // 蒼の王座の折り返し：走り込んできたくもいの足元へ、強めのグラウンダーで
      const otRet = isOTReturn(p, q);
      if (otRet) { [tx, ty] = otSpot(p, q); q.run = Math.max(q.run, 1.5); }
      if (skill === 'throughPass' || skill === 'loftedThrough') {
        // スルーパス：相手の最終ラインの裏のスペースへ。受け手が走り込む先に落とす
        const offLp = offsideLine(p.team), behind = Math.min(offLp + R.range(5, 9), L - 7);
        tx = fx(p.team, Math.max(behind, fx(p.team, q.x) + 3)); ty = clamp(q.y + q.vy * 0.6 + (GOAL_Y - q.y) * 0.2, 4, W - 4);
        q.run = Math.max(q.run, 2.5);
      }
      // 月影の抜け出し：走り込んでくる味方の、少し先（DFラインのすぐ裏）へ。走るコースの上に、ぴたりと届く強さで
      const tsukiPass = uOn(q, 'tsukikage') && (through || skill === 'throughPass' || skill === 'loftedThrough');   // 港の指揮者の裏への1本も、走り込む先へぴたりと合わせる
      if (tsukiPass) {
        const offLp = offsideLine(p.team), vR = maxSpeed(q) * 0.97, qxf = fx(p.team, q.x);
        // 走る向き：いま前へ走っていればその向き、そうでなければゴールの方へ（少し中へ）
        let ux = q.vx, uy = q.vy, ul = hyp(ux, uy);
        if (ul < 2 || ux * sgn(p.team) < 0.35 * ul) { ux = sgn(p.team); uy = clamp((GOAL_Y - q.y) / 45, -0.35, 0.35); ul = hyp(ux, uy); }
        ux /= ul; uy /= ul;
        // ボールが届くまでの時間に、本人が全力で進む所（走るコースの上）へ出す
        let T = 1.0;
        for (let k = 0; k < 6; k++) { const mx = q.x + ux * vR * T, my = q.y + uy * vR * T, dd = Math.max(3, hyp(mx - b.x, my - b.y)); T = 0.1 + dd / passAvgV(p, dd); }
        let sRun = vR * T; const fxu = ux * sgn(p.team);
        const axMax = Math.max(qxf + 2, L - 17.5), axMin = Math.max(qxf + 2, offLp + 2);   // GKに先に取られない所（PAの手前寄り）まで
        if (qxf + fxu * sRun > axMax) sRun = (axMax - qxf) / Math.max(0.2, fxu);
        if (qxf + fxu * sRun < axMin) sRun = (axMin - qxf) / Math.max(0.2, fxu);
        tx = q.x + ux * sRun; ty = clamp(q.y + uy * sRun, 4, W - 4); q.uRunDir = [ux, uy];
        q.run = Math.max(q.run, 2.5); q.uChase = { until: S.t + 2.5, mode: 'ball' };   // 出たボールへまっすぐ向かう
      }
      tx = clamp(tx, 1, L - 1); ty = clamp(ty, 3.2, W - 3.2);   // タッチライン際の受け手には、ラインの内側へ出す（何でもないパスがラインを割らない）
      const d = hyp(tx - b.x, ty - b.y);
      // パスを出した瞬間のオフサイド判定
      const offL = offsideLine(p.team);
      const tsuki = uOn(q, 'tsukikage');   // 月影の抜け出し：飛び出すタイミングが完璧（オフサイドにかかりにくい）
      let off = fx(p.team, q.x) > offL + 0.3 && fx(p.team, q.x) > fx(p.team, b.x) && fx(p.team, q.x) > L / 2;   // 月影の抜け出し：パスが出た瞬間はオフサイドラインの手前（完璧なタイミング）
      if (S.setPiece && (S.spType === 'corner' || S.spType === 'goalkick')) off = false;   // コーナーキック・ゴールキックを直接受ける時はオフサイドにならない（スローインも）
      // オフサイドは、パスが出た瞬間の本当の位置だけで判定する（オフサイドトラップは、DFラインが実際に押し上げることで取る）
      const trapLine = null;
      // 蹴り方：サイドからゴール前へはクロス、相手の頭越しはふわっと、遠くは低めの弾道
      const wideFinal = fx(p.team, p.x) > L - 32 && Math.abs(p.y - GOAL_Y) > 15 && fx(p.team, tx) > L - 18 && Math.abs(ty - GOAL_Y) < 12;
      const cutB = fx(p.team, p.x) > L - 17 && Math.abs(p.y - GOAL_Y) > 7 && fx(p.team, tx) < fx(p.team, p.x) - 2 && Math.abs(ty - GOAL_Y) < 12 && !skill;   // 版843：マイナスの折り返しは、速いグラウンダー
      let ppGround = false; if (cutB && p.sk.has('pinpointCross') && skZ(p, 'pinpointCross') && !S.setPiece) { skill = 'pinpointCross'; ppGround = true; }   // 版846：ピンポイントクロスを持つ選手は、えぐってからの折り返しもピンポイント（速いグラウンダーのまま）
      if (cutB) { stats[p.team].cutbacks = (stats[p.team].cutbacks || 0) + 1; if (globalThis.__scnLog) globalThis.__scnLog.push(['cut', +S.t.toFixed(1), p.team]); }
      let style = (wideFinal && d > 12 && !cutB) || skill === 'earlyCross' || (skill === 'pinpointCross' && !ppGround) ? 'cross' : chip ? 'lob' : d > 27 || (through && d > 18) ? (d > 40 && R.next() < 0.35 ? 'high' : 'drive') : false;
      if (style === 'cross' && !skill && p.sk.has('pinpointCross') && skZ(p, 'pinpointCross') && !S.setPiece) skill = 'pinpointCross';   // 版838：ピンポイントクロスを持つ選手は、サイドからのクロスをいつもピンポイントで（効果が見えるように）
      if (skill === 'longFeed') style = 'drive';
      if (aoStyle != null && style !== 'cross') style = aoStyle;   // 蒼の王座・渦潮の囮の1本：通ると読んだ蹴り方（グラウンダー／浮き玉）のまま
      // 月影の抜け出し：パスのコースに相手がいれば、DFの頭上を越えて足もとに落とす浮き球。いなければグラウンダー
      let tsukiDef = -1;
      if (tsukiPass) {
        const inLane = opps(p).filter((o) => !o.gk && !o.off && (() => { const sd = segDist(o.x, o.y, p.x, p.y, tx, ty); return sd.u > 0.08 && sd.u < 0.95 && sd.d < 2.4; })());
        style = inLane.length ? 'drive' : false;
        if (style) {   // 浮き球は滞空するぶん、走り込む選手がそれだけ先へ進む：落ちる頃にいる所（の少し手前）へ
          const sp = maxSpeed(q) * 1.1, ux = q.vx, uy = q.vy, ul = hyp(ux, uy) || 1, d0 = hyp(tx - p.x, ty - p.y), T = 0.45 + d0 / 24;
          const ax = clamp(fx(p.team, q.x) + (ux * sgn(p.team) / ul) * sp * T * 0.92, fx(p.team, q.x) + 2, Math.max(fx(p.team, q.x) + 2, L - 17.5));
          tx = fx(p.team, ax); ty = clamp(q.y + (uy / ul) * sp * T * 0.92, 4, W - 4);
        }
        // 届くかどうか：出し手のパスの力（パス・判断、パサーのタイプ、スルーパスのスキル）と、コースにいるDFの守備の力の差。DFがずっと上手い時だけ、そのDFが触れる
        const passQ = p.pass * 0.6 + p.vision * 0.4 + (p.type === 'パサー' ? 8 : 0) + (p.sk.has('throughPass') || p.sk.has('loftedThrough') ? 6 : 0);
        const lvK = 1;   
        for (const o of inLane) { const rd = READ_TYPES[o.type] || o.trackRun ? 1 : 0, defQ = o.defense * 0.6 + o.jump * 0.2 + o.vision * 0.2 + (rd ? 10 : 0), pc = clamp((defQ - passQ + 2) / 40, rd ? 0.08 : 0, 0.6) * lvK; if (R.next() < pc) { tsukiDef = o.idx; break; } }
        // 2人目：落ちる所の近くにカバーリングできるDFがいれば、先に触られることもある（相手は国内屈指のアタッカーなので、なかなか難しい）
        // スイーパーキーパーの読み：落ちる所（ボールの落下地点）へ相手より先に着けるなら、GKが先に触る
        if (tsukiDef < 0) { const g = opps(p).find((o) => o.gk && !o.off);
          if (g && g.type === 'スイーパーキーパー' && ((g.skRead || 0) > S.t || uOn(g, 'sutemi'))) { const tG = hyp(tx - g.x, ty - g.y) / (maxSpeed(g) * (uOn(g, 'sutemi') ? 1.22 : 1)), tR = hyp(tx - q.x, ty - q.y) / Math.max(1, maxSpeed(q));
            if (tG < tR + 0.35 && R.next() < (uOn(g, 'sutemi') ? 0.95 : 0.65)) { tsukiDef = g.idx; g.skRead = S.t + 3; } } }
        // 雅の後始末（凸）：パスが出た瞬間に読み、受ける前にカットしに行ける
        if (tsukiDef < 0) { const m = opps(p).find((o) => o.uniq === 'miyabi' && !o.off && o.uniqLv >= 2 && !(o.uCd > S.t));
          if (m && hyp(m.x - tx, m.y - ty) < 14) { const tM = hyp(tx - m.x, ty - m.y) / (maxSpeed(m) * 1.45), tR = hyp(tx - q.x, ty - q.y) / Math.max(1, maxSpeed(q)); if (tM < tR + 0.3 && R.next() < 0.5) { tsukiDef = m.idx; uFire(m, 'miyabi'); } } }
        // マークの受け渡しでついてきたDF：走る相手のすぐそばにいれば、先に足を出せる
        if (tsukiDef < 0) for (const o of opps(p)) { if (o.off || o.gk || !(o.trackRun && o.trackRun.r === q.idx) || hyp(o.x - q.x, o.y - q.y) > 3.5) continue; const pc = clamp(0.18 + (o.defense + o.speed - q.speed - q.dribble) * 0.004, 0.08, 0.4); if (R.next() < pc) { tsukiDef = o.idx; break; } }
        if (tsukiDef < 0) { const attQ = (q.speed + q.dash + q.dribble) / 3 + 10;
          for (const o of opps(p)) { const drop = S.lcStep && S.lcStep.mode === 'drop' && S.lcStep.team === o.team && S.lcStep.until > S.t; if (o.off || !(isCover(o) || (drop && o.position === 'DF')) || hyp(o.x - tx, o.y - ty) > (drop ? 13 : 9)) continue; const defQ = o.defense * 0.5 + o.speed * 0.3 + o.vision * 0.2, pc = clamp((defQ - attQ + 8) / 50, 0.04, 0.35) * lvK * (drop ? 2.4 : 1); if (R.next() < pc) { tsukiDef = o.idx; break; } } }
      }
      if (skill === 'switchPlay') style = d > 38 ? 'high' : 'drive';
      if (skill === 'heelPass' || skill === 'noLook' || skill === 'oneTouchPass') style = false;
      // 港の指揮者の1本：相手の頭の上を通す浮き球ではなく、足もとへの速いグラウンダー（遠い時だけ低い弾道）。コースの相手は、ずっと上手い時だけ触れる
      let tactDef = -1;
      if (false) {
        style = d > 32 ? 'drive' : false;
        const passQ = p.pass * 0.6 + p.vision * 0.4 + 10;
        for (const o of opps(p)) { if (o.gk || o.off) continue; const sd = segDist(o.x, o.y, p.x, p.y, tx, ty); if (sd.u < 0.08 || sd.u > 0.95 || sd.d > 2.2) continue;
          const rd = READ_TYPES[o.type] || (o.trackRun && o.trackRun.r === q.idx) ? 1 : 0, defQ = o.defense * 0.6 + o.vision * 0.4 + (rd ? 10 : 0), pc = clamp((defQ - passQ) / 40, rd ? 0.1 : 0.02, rd ? 0.45 : 0.3) * (p.uniqLv >= 2 ? 0.6 : 1); if (R.next() < pc) { tactDef = o.idx; break; } }
      }
      if (skill) {
        act(p, 'skill', 1.3, { k: skill }); p.pskCd = S.t + 4;
        const ux = tx - p.x, uy = ty - p.y, ul = hyp(ux, uy) || 1;
        if (skill === 'heelPass') act(p, 'heel', 0.45, { dx: -ux / ul, dy: -uy / ul });
        if (skill === 'noLook') act(p, 'nolook', 0.5, { dx: ux / ul, dy: uy / ul, lx: -uy / ul, ly: ux / ul });
      }
      // クロスの回転：縦に突破して同サイドの足で上げる → ゴールから遠ざかる（アウトスイング）
      //               カットインして中から上げる → ゴールへ向かってくる（インスイング）
      let spinSign;
      if (style === 'cross') {
        const out = sgn(p.team) * (p.y < GOAL_Y ? 1 : -1);
        const cut = (p.cutInT || 0) > S.t - 3 || Math.abs(p.y - GOAL_Y) < 15 || ((GOAL_Y - p.y) * p.vy > 0 && Math.abs(p.vy) > 1.5 && Math.abs(p.vy) > Math.abs(p.vx) * 0.6);   // 中へ持ち込んでいる＝カットイン
        spinSign = cut ? -out : out;
        // 落下点はゴールマウスの中ではなく、GKが出にくいゴール前（ゴールラインから5.5m以上手前）
        tx = fx(p.team, Math.min(fx(p.team, tx), L - 5.5));
      }
      // クロスの高さを受け手の得意な技に合わせる（ボレーは腰、ダイビングヘッドは低く速く、バイシクルは頭の上）
      let landFrac;
      if (style === 'cross' && R.next() < 0.75) {
        if (skZ(q, 'volley')) landFrac = 1.08;
        else if (skZ(q, 'divingHeader')) landFrac = 1.05;
        else if (skZ(q, 'bicycle')) landFrac = 1.17;
      }
      if (skill === 'pinpointCross') landFrac = skZ(q, 'volley') ? 1.08 : skZ(q, 'bicycle') ? 1.17 : 1.02;
      if (skill === 'earlyCross') landFrac = 1.0;
      if (tsukiPass && style) landFrac = 1.0;   // 走り込む足もとにちょうど落ちる
      // 固有スキル・サポートパッシブ：パスの精度（uAcc：小さいほど正確）と、相手に触られにくさ（uSafe）
      if (p.uniq === 'minato' && !(p.uOn > S.t) && !(p.cdRem > 0) && !S.setPiece && fx(p.team, p.x) > 12 && uFire(p, 'minato')) p.cdFirst = S.t;   /* 自陣ゴール前以外から、どの向きでも、パスを出したら */   // 港の指揮者：中盤から出したパスで、指揮が始まる
      let uAcc = 1, uSafe = 0, hrNow = false, byNow = false;
      if (uOn(p, 'byakuya') && S.byWant) {   /* 白夜の視界で選んだ1本は、必ずロングフィードにする（距離の見直しでショートパスにしない） */   // 白夜の視界：60mのロングフィード。相手の頭を越えて、走り込む先へぴたりと落とす
        byNow = true; const lead = Math.min(6, 2 + hyp(q.vx, q.vy) * 0.6), fwd = fx(p.team, q.x) + lead * (fx(p.team, q.x) > fx(p.team, p.x) - 5 ? 1 : 0.4);
        { const olB = offsideLine(p.team), qf = fx(p.team, q.x); tx = fx(p.team, qf > olB - 24 ? Math.min(olB + 8, L - 11) : Math.min(fwd + 3, olB - 0.5)); ty = clamp(q.y + q.vy * 0.6 + (qf > olB - 24 ? (GOAL_Y - q.y) * 0.25 : 0), 3, W - 3); }   // ラインの近くの味方：DFラインの裏へ落とす。遠い味方：走る先のスペースへ
        if ((q.byRunT || 0) > S.t && q.byRunTo) { tx = q.byRunTo[0]; ty = q.byRunTo[1]; }   // 裏へ走る味方：走っていく先へ
        { const dB = hyp(tx - p.x, ty - p.y), T = dB / 18 + (dB > 50 ? 1.3 : 0.8), reach = maxSpeed(q) * T * ((q.byRunT || 0) > S.t ? 0.95 : 0.8), dq = hyp(tx - q.x, ty - q.y); if (dq > reach) { tx = q.x + (tx - q.x) * reach / dq; ty = q.y + (ty - q.y) * reach / dq; } }   // 受け手が落ちる所に間に合うように
        style = hyp(tx - p.x, ty - p.y) > 50 ? 'high' : 'drive'; uAcc *= p.uniqLv >= 2 ? 0.1 : 0.15;   /* いつもロングフィード（浮き球） */   /* 40m未満は、走り込む足もとへ同時に着く速いグラウンダー。それより遠い時だけ浮かせる */ uSafe = Math.max(uSafe, 0.85); }
      { const thr = through || skill === 'throughPass' || skill === 'loftedThrough', fwd = fx(p.team, tx) > fx(p.team, p.x) + 6;
        if ((thr || S.hrWant) && fx(p.team, tx) > L - 42 && fx(p.team, q.x) > L - 42 && fx(p.team, q.x) < offsideLine(p.team) - 0.3 && uFire(p, 'harinoana')) { hrNow = true; { const ol = offsideLine(p.team), qf = fx(p.team, q.x), lx = clamp(Math.max(qf + 9, ol + 9), qf + 4, L - 14); tx = fx(p.team, lx); ty = clamp(q.y + (GOAL_Y - q.y) * 0.4, 8, W - 8); } if (style === 'cross' || Math.abs(p.y - GOAL_Y) > 20 || hyp(tx - p.x, ty - p.y) < 25) style = false; else if (style) style = 'drive';   /* サイドからの1本は、走り込む足もとへ同時に着くグラウンダー（後ろを通り過ぎない） */   /* 裏の深い所（ゴール前）へ、走り込む先にぴたりと */ uAcc *= p.uniqLv >= 2 ? 0.1 : 0.15; uSafe = Math.max(uSafe, 0.85); }   // 針の穴通し：すき間を通す、ぴたりと届く1本
        if (uOn(p, 'shiden') && fx(p.team, tx) > L - 32) { uAcc *= 0.4; uSafe = Math.max(uSafe, S.t - (p.sdBeat || -9) < 1.5 ? 0.8 : 0.35); }   // 紫電の遊戯：ノールックのラストパス（抜いた直後は、相手も読めない）                     // 紫電の遊戯：抜いた後のラストパス
        if (uOn(p, 'aonoouza') && (thr || fwd || S.uzWant)) { uAcc *= 0.4 / uP(p); uSafe = Math.max(uSafe, (thr || S.uzWant) ? (p.uniqLv >= 2 ? 0.93 : 0.9) : (p.uniqLv >= 2 ? 0.9 : 0.85)); }   // 蒼の王座：スルーパス・前線へのパスは、相手の足が出ても抜けやすい（通る確率を上げる）   /* 取れない所へ落とすので、相手の足をすり抜けるような補正はしない */                        // 蒼の王座：縦パス・スルーパス
        if (uOn(p, 'byakuya') && hyp(tx - p.x, ty - p.y) > 20) { uAcc *= 0.45 / uP(p); uSafe = Math.max(uSafe, 0.2); }   // 白夜の視界：ロングパス
        if ((T[p.team].mdBuild || 0) > S.t && !(S.mdWant && uOn(p, 'midori'))) { uAcc *= T[p.team].mdBuildLv >= 2 ? 0.7 : 0.8; uSafe = Math.max(uSafe, T[p.team].mdBuildLv >= 2 ? 0.35 : 0.25); }   /* 版449 翠の起点：きれいな形で組み立てている間は、パスがつながりやすい（数的優位） */
        if (S.mdWant && uOn(p, 'midori')) { uAcc *= p.uniqLv >= 2 ? 0.2 : 0.3; uSafe = Math.max(uSafe, p.uniqLv >= 2 ? 0.9 : 0.85); act(p, 'mdpass', 3.4, { r: q.idx, lv: p.uniqLv || 1 }); }   /* 版448 翠の起点：裏返す1本は正確で、相手の足をすり抜ける */
        if (tsuki && thr) { uAcc *= q.uniqLv >= 2 ? 0.4 : 0.55; uSafe = Math.max(uSafe, q.uniqLv >= 2 ? 0.6 : 0.4); }   // 月影の抜け出し：無凸はスルーパスが少しだけ通りにくい
        if (p.cdFirst === S.t) { uAcc *= 0.3; uSafe = Math.max(uSafe, 0.85); }   // 港の指揮者：合図の1本は確実に通す
        { const c = condLv(p.team); if (c) { uAcc *= c >= 2 ? 0.12 : 0.18; uSafe = Math.max(uSafe, c >= 2 ? 0.93 : 0.9); }   /* パスの正確さが飛躍的に上がる */ }   // 港の指揮者：指揮の間は、チーム全員のパスが正確で通りやすい                  // 港の指揮者：合図した1本はほぼ確実に通る
        if (uOn(p, 'kinshachi')) { uAcc *= p.uniqLv >= 2 ? 0.35 : 0.45; uSafe = Math.max(uSafe, 0.4); }   // 金鯱の心臓：受けたら、正確に速くつなぐ
        if ((T[p.team].capBuff || 0) > S.t) uAcc *= 0.82;   // 版838：キャプテンシー
        if ((p.tactBuff || 0) > S.t) uAcc *= 0.75;                                                                              // 指揮の余韻：次のパスも正確                                                         // 月影の抜け出し：走り込む先へぴたりと届くスルーパス
        if ((p.uTetsu || 0) > S.t && fwd) { uAcc *= p.uniqLv >= 2 ? 0.25 : 0.35; uSafe = Math.max(uSafe, p.uniqLv >= 2 ? 0.7 : 0.6); p.uTetsu = 0; act(p, 'ttpass', 1.6, { r: q.idx, lv: p.uniqLv || 1 }); }
        if (uOn(p, 'kage') && (q.kmRunT || 0) > S.t) act(p, 'kmpass', 2.2, { r: q.idx, lv: p.uniqLv || 1 });
        if (uOn(p, 'kage') && q.position === 'FW' && fwd) { uAcc *= p.uniqLv >= 2 ? 0.3 : 0.4; uSafe = Math.max(uSafe, p.uniqLv >= 2 ? 0.9 : 0.85); }   // 影の一刺し：FWへの1本は正確で、相手の足をすり抜ける
        if (opps(p).some((o) => (o.kgT === p.idx || o.mark === p.idx) && uOn(o, 'kagenui'))) uAcc *= 1.8;                                            // 影縫い：マークされた相手のパスが乱れる
        let a;
        if (q.position === 'FW' && (a = aura(p, 'fwBack'))) uAcc *= 1 - 0.18 * a;                                              // 点取り屋の背中
        if ((a = aura(p, 'guide'))) { uAcc *= 1 - 0.1 * a; uSafe += 0.05 * a; }                                               // パスの道しるべ
        if (thr && (a = aura(p, 'spark'))) { uAcc *= 1 - 0.15 * a; uSafe += 0.06 * a; }                                         // ひらめき
        if (thr && (a = aura(p, 'drawOut'))) uSafe += 0.08 * a;                                                                  // 引き出し
        if (thr && (a = aura(p, 'stir'))) uSafe += 0.04 * a;                                                                     // かき回し
        if ((p.position === 'DF' || p.gk) && (a = aura(p, 'origin'))) uAcc *= 1 - 0.2 * a;                                     // 起点
        // 捨て身の守護神：相手のスルーパス・裏へのボールに、GKが飛び出す
        //   （相手より先に触れそうな時だけ。間に合わない時は飛び出さずにゴールを守る）
        if (thr || (style && fx(p.team, tx) > offL - 1 && fx(p.team, tx) > L - 40)) { const og = opps(p).find((o) => o.gk && o.uniq === 'sutemi');
          if (og && og.uniqLv >= 2 && !og.off && !(og.downT > 0) && fx(og.team, tx) < 22 && fx(og.team, tx) > 12 && !style) { const tG = hyp(tx - og.x, ty - og.y) / (maxSpeed(og) * 1.35), tR = hyp(tx - q.x, ty - q.y) / Math.max(1, maxSpeed(q)); if (tG < tR - 0.1 && !T[og.team].players.some((m) => !m.gk && !m.off && hyp(tx - m.x, ty - m.y) / Math.max(1, maxSpeed(m)) < tG + 0.3) && uFire(og, 'sutemi') && globalThis.__sutEarly) globalThis.__sutEarly.n++; } } }   // 味方のDFが先に拾えるなら、GKは出ない   // 凸：パスが出た瞬間に読んで、飛び出す1歩目から発動（確実に先に触れる時だけ。浮き球には出ない）
      if (T[p.team].mdStack) { uAcc /= Math.min(3, Math.pow(1.3, T[p.team].mdStack)); uSafe = Math.max(uSafe, Math.min(0.6, T[p.team].mdStack * 0.15)); }   /* 版451 翠の起点の積み重ね：パスの精度（1回ごとに1.15倍・最大2倍） */
      if (skill === 'pinpointCross') { uSafe = Math.max(uSafe, 0.45); q.ppShot = S.t + 3; }   // 版838：ピンポイントクロス：相手に触られにくく、受けた選手のシュートも正確に
      const accP = (PASS_ACC[skill] ?? 1) * (p.type === 'パサー' && (through || skill === 'throughPass' || skill === 'loftedThrough') ? 0.72 : 1) * uAcc;   // パサーのスルーパスは正確
      if (hrNow && style && style !== 'cross') { let best = null; for (const o of opps(p)) { if (o.gk) continue; const sd = segDist(o.x, o.y, p.x, p.y, tx, ty); if (sd.u > 0.1 && sd.u < 0.9 && (!best || sd.d < best.d)) best = { d: sd.d, o }; }
        if (best) { const cr = (tx - p.x) * (best.o.y - p.y) - (ty - p.y) * (best.o.x - p.x); spinSign = cr > 0 ? -1 : 1; } }   // 針の穴通し：浮かせる1本は、間にいるDFをよけるように曲げる
      /* v740 判断：浮き球のコースに相手がいたら、よけるように曲げる（判断が高いほど気づく） */
      /* v741 回転のコントロール：コースに相手の足があれば、逃げるように巻く。気づくのは判断、蹴れるのはパスの能力 */
      if (spinSign == null && style !== 'cross' && d > (style ? 14 : 8) && R.next() < clamp((p.vision - 45) / 55, 0, 0.85) * clamp((p.pass - 40) / 40, 0, 1)) {
        let bo = null, bd = style ? 3 : 2.6; for (const o of opps(p)) { if (o.gk || o.off) continue; const sd = segDist(o.x, o.y, p.x, p.y, tx, ty); if (sd.d < bd && sd.u > 0.2 && sd.u < 0.85) { bd = sd.d; bo = o; } }
        if (bo) { const cr = (tx - p.x) * (bo.y - p.y) - (ty - p.y) * (bo.x - p.x); spinSign = cr > 0 ? -1 : 1; } }
      kick(p, tx, ty, 'pass', style, { vEnd: !style ? aoVEnd : null, spinSign, spinMul: hrNow ? 0.9 : undefined, landFrac, acc: accP, arriveT: (tsukiPass || hrNow || byNow) && !style ? Math.max(0.5, (hyp(tx - q.x, ty - q.y) + 0.3) / (maxSpeed(q) * 0.97)) : 0 });
      if (tsukiPass) { const mt = tsukiMeet(q); q.uMeet = { x: mt.x, y: mt.y, at: S.t + mt.t }; }
      b.uSafe = Math.min(condLv(p.team) || uOn(p, 'aonoouza') ? 0.93 : 0.85, uSafe); b.trapP = trapRel && off; b.tsukiP = tsukiPass; b.tsukiDef = tsukiDef; b.landX = tsukiPass ? tx : null; b.landY = tsukiPass ? ty : null;   // 月影の抜け出しのスルーパス（DFの足に当たらず、走り込む本人に届く）
      if (skill === 'pinpointCross') act(p, 'pppass', 1.9, { r: q.idx, lx: +tx.toFixed(1), ly: +ty.toFixed(1) });   // 版838：ピンポイントクロス：落ちる所に金の的、ボールに金の光の尾
      if ((tsukiPass || through) && fx(p.team, tx) > offL + 1.5 && fx(p.team, tx) > L - 40 && !off) for (const m of opps(p)) if (m.uniq === 'miyabi' && !m.off) uFire(m, 'miyabi');   // 裏を取られた：雅の後始末
      b.tact = p.cdFirst === S.t; b.tactLv = 1; b.tactDef = -1;   // 港の指揮者：合図の1本は、相手が触れない（勢いが落ちるまで）
      if (q.uniq === 'aonoouza' && q !== p && !q.off && !S.setPiece && !through && fx(q.team, q.x) > 55 && fx(q.team, q.x) < 95 && fx(q.team, q.x) > fx(p.team, p.x) + 4 && hyp(q.x - p.x, q.y - p.y) < 34 && !style && S.t > 4 && !(q.uOn > S.t) && !(q.uCd > S.t)) { S.aoPasser = p.idx; uFire(q, 'aonoouza'); S.aoPasser = null; q.aoHoldT = 0; if (q.uOn > S.t) { act(q, 'aopost', 4.5, { lv: q.uniqLv || 1 }); act(q, 'aoflash', 1.1, { lv: q.uniqLv || 1 }); b.aoP = true; b.aoIn = true; q.aoTurn = 0; b.uSafe = Math.max(b.uSafe || 0, 0.4); }   /* 縦パスは、落ちてきたくもいが体を入れて収める */ }   /* くもいへの縦パスは、落ちてきたくもいが体を入れて受ける（カットされにくい） */   // 蒼の王座：下りてきたくもいにパスが出た瞬間、CBが釣り出され、2列目が穴へ走り出す
      b.byP = byNow; b.byLv = p.uniqLv || 1; b.byT0 = S.t; if (byNow) { p.byHoldT = 0; b.landX = tx; b.landY = ty; q.uChase = { until: S.t + 6, mode: 'ball' }; { const mt = tsukiMeet(q); if (mt && mt.t < 6) { b.landX = mt.x; b.landY = mt.y; } } act(p, 'bypass', 4, { x0: +p.x.toFixed(2), y0: +p.y.toFixed(2), r: q.idx, lv: p.uniqLv || 1 }); p.uOn = Math.min(p.uOn, S.t + 0.5); }   // 白い光の尾を引いて大きな弧
      b.aoP = b.aoP || (S.uzWant && !hrNow && !byNow); if (b.aoP && uOn(p, 'aonoouza')) { act(p, 'aopass', 3, { r: q.idx, lv: p.uniqLv || 1 }); if (p.uniq === 'aonoouza') act(p, 'aopostend', 0.1); }   // 蒼の王座の1本は、どの出し方でも青い光の尾 S.uzWant = false; if (b.aoP) q.uChase = { until: S.t + 3.5, mode: 'ball' };   // 蒼の王座：穴へ走り込む味方への1本は、相手に触られずに届く（受け手は合う所へ全力で）
      b.hari = hrNow; b.hariLv = p.uniqLv || 1; if (hrNow && style !== 'cross') { b.landX = tx; b.landY = ty; q.uChase = { until: S.t + 3.5, mode: 'ball' }; }   // 受け手は、ボールと同時に着く所へ全力で走り込む
      if (hrNow && globalThis.__hrLog) globalThis.__hrLog.push({ t: +S.t.toFixed(2), q: q.idx, qo: +(fx(p.team, q.x) - offsideLine(p.team)).toFixed(1), tx: +(fx(p.team, tx) - offsideLine(p.team)).toFixed(1), st: style || 'gr', d: +hyp(tx - p.x, ty - p.y).toFixed(1), via: through ? 'thr' : skill || '' });
      if (hrNow) { act(p, 'hrpass', 2.8, { st: style || '', x0: +p.x.toFixed(2), y0: +p.y.toFixed(2), x1: +tx.toFixed(2), y1: +ty.toFixed(2), r: q.idx, lv: p.uniqLv || 1 }); p.uOn = Math.min(p.uOn, S.t + 1.6); }   // 金の糸（どこからどこへ通したか）   // 港の指揮者の1本（受けた味方に指揮の余韻）
      if (globalThis.__psLog) globalThis.__psLog.push({ t: S.t, p: p.idx, q: q.idx, st: style || '', ao: !!b.aoP, on: uOn(p, 'aonoouza'), fw: fx(p.team, tx) - fx(p.team, p.x) });
      b.intended = q.idx; b.offside = off; b.offX = q.x; b.offY = q.y; b.passT = S.t; b.offLineX = trapLine != null ? fx(p.team, trapLine) : fx(p.team, Math.max(offL, fx(p.team, b.x)));
      b.otRet = otRet; if (otRet) q.otRun.until = S.t + 2.5;
      if (fx(p.team, tx) > fx(p.team, p.x) + 6) stats[p.team].fwd_passes++;
      // 前線で横・後ろへ預けたら、出した選手はすぐ前のスペースへ走り込む（ワンツー・もう一度受けてシュート）
      // アタッキングサード・ゴール前：近くの味方に当てて、自分は前へ走り込む（ワンツー）。パスと判断がうまいほど狙う
      const atk3 = fx(p.team, p.x) > L - 60, wantOT = atk3 && d > 4 && d < 20 && !through && style !== 'cross' && R.next() < 0.38 + (p.pass + p.vision) / 170 + DOM[p.team] * 0.3 + (skZ(p, 'throughPass') ? 0.15 : 0) + (skZ(p, 'wallPass') ? 0.3 : 0);
      const otOK = !otRet && !b.aoP && d < 20 && fx(p.team, tx) > fx(p.team, p.x) - 8;   // 近くの味方に当てる時だけワンツー（リターンをさらに返す往復はしない）
      if (otRet) S.oneTwo = null;
      else if (!p.gk && otOK && ((fx(p.team, p.x) > L - 55 && fx(p.team, tx) < fx(p.team, p.x) + 5 && !through) || wantOT)) {   // 版842：ワンツーは中盤の前（ゴールまで60m）から狙う
        p.run = R.range(2.0, 3.0); S.oneTwo = { a: p.idx, b: q.idx, t: S.t };
        // 出した選手は、受け手の横を抜けて相手の裏のスペースへダッシュ（ワン）→ そこへダイレクトで落としてもらう（ツー）
        { const ax = fx(p.team, p.x), bx = fx(p.team, q.x), no = nearestOpp(q, q.x, q.y);
          const side = Math.abs(p.y - q.y) > 6 ? Math.sign(p.y - q.y) : (no.q ? Math.sign(q.y - no.q.y) || 1 : 1);
          const ry = clamp(Math.abs(p.y - q.y) > 6 ? p.y + (GOAL_Y - p.y) * 0.15 : q.y + side * 7, 5, W - 5);
          p.otRun = { x: Math.min(Math.max(ax + 12, bx + 8), L - 6), y: ry, until: S.t + 3.2 }; }
      } else {
        if (!S.oneTwo || S.oneTwo.b !== p.idx) S.oneTwo = null;
        // 前線で横・後ろへ預けたら、出した選手は前のスペースへ走り直す（パス＆ゴー）
        if (!p.gk && !otRet && fx(p.team, p.x) > L - 45 && fx(p.team, tx) < fx(p.team, p.x) + 5 && !through) p.run = R.range(2.0, 3.0);
        const egoSt = !p.gk && (p.uniq === 'guren' || (p.type === 'ストライカー' && p.position === 'FW')) && fx(p.team, p.x) > L / 2 - 5;   // ストライカー：出したら、最後は自分が決めに行く（すぐゴール前へ）
        if (egoSt) { const offE = offsideLine(p.team); p.run = R.range(3.0, 4.0); p.runCd = 0; p.otRun = { x: Math.min(Math.max(fx(p.team, p.x) + 8, offE + 6), L - 8), y: clamp(GOAL_Y + (p.y - GOAL_Y) * 0.35 + (Math.abs(q.y - GOAL_Y) < 6 ? Math.sign(p.y - q.y || 1) * 4 : 0), 6, W - 6), until: S.t + 4 }; p.pgRun = S.t + 4; }
        else if (!p.gk && !otRet && !through && style !== 'cross' && d < 28 && (uOn(p, 'kinshachi') || (p.type === 'パサー' && R.next() < 0.85) || R.next() < 0.45 + (p.vision + (p.stamina || 50)) / 500)) pgGo(p, q, uOn(p, 'aonoouza') ? 'behind' : null);   // パス＆ゴー：預けたら、裏へ抜け直す／開いて受け直す
        if (p.uniq === 'aonoouza') act(p, 'aopostend', 0.1);
        if (p.uniq === 'kage' && (p.kmBackT || 0) > S.t) { p.run = Math.max(p.run || 0, 4); p.runCd = 0; p.otRun = { x: L - 13, y: GOAL_Y + (q.y > GOAL_Y ? -3 : 3), until: S.t + 4.5 }; p.pgRun = S.t + 4.5; p.aoFast = Math.max(p.aoFast || 0, S.t + 4.5); }   // 影の一刺し：刺したら、自分もゴール前へ（返しを受けて決める）
        if (uOn(p, 'aonoouza') && !p.gk) { pgGo(p, q, 'behind'); p.aoHoldT = 0;
          if (b.aoP) { const lf = fx(p.team, tx), sd = Math.sign(ty - GOAL_Y) || 1; p.run = Math.max(p.run || 0, 5); p.runCd = 0; p.otRun = { x: L - 12, y: GOAL_Y - sd * R.range(1, 3.5), until: S.t + 7 }; p.pgRun = S.t + 7; p.run = Math.max(p.run, 7); p.aoFast = Math.max(p.aoFast || 0, S.t + 7); p.aoCutT = S.t + 8; q.aoCutBy = p.idx; } }   // 蒼の王座：裏へ出したら、ゴール正面（PKマーク付近）へ全力で入り直す。折り返しを受けて決める
        if (globalThis.__aoLog && p.uniq === 'aonoouza') globalThis.__aoLog.push({ t: S.t, q: q.idx, on: uOn(p, 'aonoouza'), run: (q.aoRun || 0) > S.t, thr: !!through, d: +d.toFixed(0), fwd: +(fx(p.team, tx) - fx(p.team, p.x)).toFixed(0), xf: +fx(p.team, p.x).toFixed(0), st: style || '', src: globalThis.__aoSrc ? new Error().stack.split('\n')[2].trim().slice(0, 60) : '' });   // 蒼の王座：出したら、自分もゴール前へ入り直す（スルーパスでも）
      }
      stats[p.team].passes++;
      (S.passHist ||= []).push({ a: p.idx, b: q.idx, t: S.t }); if (S.passHist.length > 12) S.passHist.shift();
      if (through) stats[p.team].through_balls++;
      S.lastPass[p.team] = { from: p.idx, t: S.t };
    }

    function shotCtx(p) {
      const xf = fx(p.team, p.x), dy = Math.abs(p.y - GOAL_Y), dG = hyp(L - xf, dy);
      const box = xf > L - 16.5 && dy < 20.16;
      return {
        box,
        mid: !box && dG < 32 && dy < 20,
        wing: xf > L - 30 && xf < L - 7 && dy > 9 && dy < 24,
        corner: xf > L - 25 && xf < L - 8 && dy > 6.5 && dy < 22,   // ペナルティエリアの角付近（ゴールから少し角度がついた所）
        half: xf > 40 && xf < 64 && dy < 24,
        vital: !box && xf > L - 27 && dy < 12,   // バイタルエリア：PAの外、ペナルティアークの手前
      };
    }
    // いま使えるシュート技（場面に合うものだけ）
    function shotSkillsFor(p, ctx) {
      const set = new Set();
      for (const z in ctx) if (ctx[z] && SHOT_ZONES[z]) for (const k of SHOT_ZONES[z]) if (skZ(p, k)) set.add(k);
      return set;
    }
    function shoot(p, aimY, how, charged) { if (globalThis.__tyDbg && (p.stDg || 0) > S.t - 2.5) globalThis.__tyDbg.dgS++;
      if (uOn(p, 'kage')) act(p, 'kmshot', 0.8, { lv: p.uniqLv || 1 });   // 影の一刺し：自分で突いて打つ時は、銀の閃光
      if (!S.pk && !S.fkDirect && S.ball.owner === p.idx && skSmother(p, 2.4)) return;   // 目の前で打とうとした相手には、体を投げ出す   // 詰めてきたスイーパーキーパーが、打つ瞬間に足もとへ飛び込む
      S.lastShotT = S.t; S.lastShotTeam = p.team;   // こぼれ球（GKがはじいた・ポストに当たった）を詰める判断に使う
      const gx = fx(p.team, L);
      // シュート技：場面ごとに出せるものから選ぶ（ボレー等の「来た球に合わせる技」は how で指定）
      const ctx = shotCtx(p), can = S.pk ? new Set() : S.fkDirect ? new Set(p.sk.has('fk') ? ['knuckle', 'driveShot', 'controlShot'].filter((k) => p.sk.has(k)) : []) : shotSkillsFor(p, ctx);   // FKマイスターは、持っているシュート技（無回転・ドライブ・コントロール）を直接FKでも使える
      let skill = how && can.has(how) && !(!charged && (p.skLock || 0) > S.t) ? how : null;
      const locked = !charged && !how && (p.skLock || 0) > S.t;   // 技の直後：シュート技は重ねない（ふつうのシュートになる）
      if (S.fkDirect && can.size && !skill) {
        // FKのキックの種類（ふつう・カーブ／無回転／ドライブ／コントロール）は、持っているものから同じくらいの頻度で選ぶ
        const dF = hyp(gx - p.x, GOAL_Y - p.y), o = [['', 1]];
        if (can.has('knuckle') && dF > 14) o.push(['knuckle', 1]);
        if (can.has('driveShot') && dF > 14) o.push(['driveShot', 1]);
        if (can.has('controlShot')) o.push(['controlShot', 1]);
        let r = R.next() * o.reduce((a, c) => a + c[1], 0); for (const [k, w] of o) { r -= w; if (r <= 0) { skill = k || null; break; } }
      } else if (!skill && !how && can.size && !locked) {
        const gk0 = opps(p)[0], gkOut0 = Math.abs(gk0.x - gx) > 7 && hyp(gk0.x - p.x, gk0.y - p.y) < 12 && hyp(gk0.x - p.x, gk0.y - p.y) > 3;
        const press = nearestOpp(p, p.x, p.y).d < 2.2;
        const opts2 = [];
        // GKの立ち位置：ニアに寄っている（＝ファーが空いている）か、ニアが空いているか
        const nS0 = p.y < GOAL_Y ? -1 : 1, gOff = (gk0.y - GOAL_Y) * nS0 + (gk0.vy || 0) * nS0 * 0.3, angled = Math.abs(p.y - GOAL_Y) > 3;
        const farOpen = angled && gOff > 1.5, nearOpen = angled && gOff < 0.8;   // 中央付近にいればニアの上が空く
        if (globalThis.__shDbg) globalThis.__shDbg.push(+gOff.toFixed(2));
        if (can.has('lob') && gkOut0) opts2.push(['lob', 2]);
        // トゥーキック：構えずにそのまま突く。囲まれて踏み込めない時・寄せられた時・走りながらタイミングを外したい時
        { const crowd = opps(p).filter((q) => !q.gk && hyp(q.x - p.x, q.y - p.y) < 3.5).length, runK = hyp(p.vx, p.vy) > 3;
          if (can.has('toeKick') && hyp(gx - p.x, GOAL_Y - p.y) < 16 && (crowd >= 2 || press || runK)) opts2.push(['toeKick', crowd >= 2 ? 1.6 : press ? 1 : 0.3]); }   // ゴール前の近い所だけ（遠くからは決まらない）
        if (can.has('nearPost') && Math.abs(p.y - GOAL_Y) > 5) opts2.push(['nearPost', 7]);
        if (can.has('powerMid')) opts2.push(['powerMid', 4]);
        if (can.has('controlShot') && (ctx.wing || ctx.corner || ctx.mid || Math.abs(p.y - GOAL_Y) > 4)) opts2.push(['controlShot', ctx.corner ? 22 : 10]);   // 角度のある所・PAの外からは、コントロールショットが多い   // PAの角付近（少し角度のある所）からは、ほぼコントロールショット
        if (can.has('knuckle') && ctx.mid && hyp(gx - p.x, GOAL_Y - p.y) > 18) opts2.push(['knuckle', 13]);   // 無回転：1試合に1本弱
        if (can.has('driveShot') && ctx.vital) opts2.push(['driveShot', 2]);   // ドライブシュート：PAの外、アーク手前のバイタルエリアから
        if (can.has('superLong') && ctx.half && !ctx.mid) opts2.push(['superLong', 5]);
        for (const o of opts2) {
          if (o[0] === 'controlShot') o[1] *= farOpen ? 3 : nearOpen ? 0.1 : 1;   // ファーが空いていたらコントロールショット
          if (o[0] === 'nearPost') o[1] *= nearOpen ? 3 : farOpen ? 0.1 : 1;      // ニアが空いていたらニア上ぶち抜き
        }
        for (const o of opts2) o[1] *= zw(p, o[0]);   // 積極的なエリアでは選ばれやすい
        const tot = opts2.reduce((a, c) => a + c[1], 0);
        if (tot && R.next() < (can.has('controlShot') ? 0.9 : 0.7)) { let r = R.next() * tot; for (const [k, w] of opts2) { r -= w; if (r <= 0) { skill = k; break; } } }
      }
      // ドリブルシュート（だれでもできる標準の打ち方）：走りながら、止まらずに打つ（ほかのシュート技と重ねられる）
      const dribbling = S.ball.owner === p.idx && S.dribbleDir && hyp(p.vx, p.vy) > 3;
      const dShot = charged ? charged.dShot : dribbling && !S.pk && !S.fkDirect && R.next() < 0.22 + p.dribble * 0.002;
      // 強烈ミドル・ニア上ぶち抜き：グッと溜めてから打つ（溜めている間に寄せられたら奪われることもある）
      if (!charged && (skill === 'powerMid' || skill === 'nearPost')) {
        const dur = dShot ? 0.35 : 0.6;
        S.charge = { p: p.idx, t: S.t + dur, aimY, skill, dShot };
        act(p, 'skill', 1.4, { k: skill });
        if (dShot) act(p, 'dshot', 1.4);
        act(p, 'charge', dur, { dShot: dShot ? 1 : 0 });
        S.decision = 9; return;
      }
      if (charged) { skill = charged.skill; }
      if (skill && !charged) act(p, 'skill', 1.4, { k: skill });
      if (dShot && !charged) act(p, 'dshot', 1.4);
      // GKのいない側を狙う
      const gk = opps(p)[0];
      const sideG = gk.y > GOAL_Y ? -1 : 1;
      // フリーでGKと1対1：落ち着いてGKのいない側へ流し込む（現実なら8割決まる場面）
      const dgk = hyp(gx - p.x, GOAL_Y - p.y);
      const free = !opps(p).some((q) => !q.gk && (hyp(q.x - p.x, q.y - p.y) < 2.6 || segDist(q.x, q.y, p.x, p.y, gx, GOAL_Y).d < 1.2));
      const oneOnOne = !S.pk && !S.fkDirect && free && dgk < 18;
      // 固有スキル：紅蓮の牙（シュート）／白亜の城壁（1対1・PKを受けるGK）
      if (!S.pk && !S.fkDirect) uFire(p, 'guren');   // どこから打っても（PK・直接FKは除く）
      if (S.pk && gk && gk.gk) uFire(gk, 'ikari');   // 白亜の城壁：シュートの瞬間に構える（セーブの判定でも出る）
      let aim = aimY ?? GOAL_Y + sideG * (oneOnOne ? R.range(2.6, 3.7) : R.range(2.7, 3.9));   // GKのいない側の隅を狙う
      const nearSide = p.y < GOAL_Y ? -1 : 1;
      if (skill === 'nearPost') aim = GOAL_Y + nearSide * R.range(3.0, 3.8);           // ニアの上を撃ち抜く
      if (skill === 'controlShot') aim = GOAL_Y - nearSide * R.range(3.2, 4.0);   // ファーのサイドネット・隅        // ファーの隅へ巻いて置く
      // ループ：GKが前に出ていれば頭越し（技を持っていなくても、たまにはやる）
      const gkOut = Math.abs(gk.x - gx) > 5.5, dg = hyp(gx - p.x, GOAL_Y - p.y);
      const chip = skill === 'lob' || (!skill && !S.pk && !S.fkDirect && Math.abs(gk.x - gx) > 9 && dg > 11 && dg < 28 && R.next() < 0.08);
      if (S.fkDirect) aim = GOAL_Y + (gk.y > GOAL_Y ? -1 : 1) * R.range(2.9, 3.9);   // 直接FKはGKの逆の隅
      // コーチング：DFがシュートコースを切っているので、正面付近にしか打てない
      if (gk.sk.has('coaching') && !S.pk && !S.fkDirect && !oneOnOne && skill !== 'controlShot' && !aimY) aim += (gk.y - aim) * 0.2;
      // 無人のゴール：GKが倒れている・ゴールを大きく離れている時は、空いている所へほぼ確実に流し込む
      let emptyNet = false;
      if (!S.pk && !S.fkDirect && gk && gk.gk && dg < 25) {
        const gkGone = emptyGoal(p);   // GKが倒れている／ゴールを大きく離れて、シュートコースにいない
        if (gkGone) {
          const side2 = Math.abs(gk.y - GOAL_Y) > 0.5 ? (gk.y > GOAL_Y ? -1 : 1) : (p.y > GOAL_Y ? -1 : 1), a2 = GOAL_Y + side2 * R.range(0.6, 2.2);
          const blocked = opps(p).some((q) => !q.gk && !q.off && segDist(q.x, q.y, p.x, p.y, gx, a2).d < 1.0 && (fx(p.team, q.x) > fx(p.team, p.x)));
          if (!blocked) { emptyNet = true; aim = a2; skill = null; S.ball.shotSkill = ''; }
        }
      }
      // 版732：コースはGKの手が届かない所へ：GKがねらう線の近く（1.7m以内）にいる時は、枠の中でGKからいちばん遠くなる高さへずらす（GKの体を通り抜けて入るように見えないように）
      if (!S.pk && !chip && !emptyNet && gk && gk.gk && !aimY) {
        const lim = POST - 0.6, gd = (ay) => { const r = segDist(gk.x, gk.y, p.x, p.y, gx, ay); return r.u > 0 && r.u < 1 ? r.d : 9; };
        if (gd(aim) < 1.7) { let best = aim, bd = gd(aim); for (let k = -12; k <= 12; k++) { const ay = GOAL_Y + (lim * k) / 12, d2 = gd(ay) - Math.abs(ay - aim) * 0.04; if (d2 > bd) { bd = d2; best = ay; } } aim = best; }
      }
      kick(p, gx, chip && !emptyNet ? GOAL_Y + R.gauss() * 1.2 : aim, 'shot', false, { pk: S.pk, fk: S.fkDirect, chip: chip && !emptyNet, calm: oneOnOne || emptyNet, skill, dShot, empty: emptyNet });
      const fkMaster = S.fkDirect && p.sk.has('fk');
      S.ball.gkPen = (SHOT_GK_PEN[skill] || 0) + (dShot ? SHOT_GK_PEN.dribbleShot : 0) + (fkMaster ? 0.4 : 0) + (S.ball.csPlace ? 0.04 : 0);   // 置きに行くコントロールショット：遅くても、GKの届かない隅へ正確に置くので止めにくい
      S.ball.shotSkill = skill || (dShot ? 'dribbleShot' : '');
      if (emptyNet) S.ball.gkPen += 0.6;   // 無人のゴール：GKは届かない
      S.ball.brk = !emptyNet && (p.tsukiRecv > 0 || (p.uFireT && S.t - p.uFireT < 7 && p.uniq === 'tsukikage'));   // 抜け出してからの1対1のシュート
      S.ball.tsukiShot = p.uniq === 'tsukikage' && !(p.uniqLv >= 2) && S.t - Math.max(p.tsukiRecv || -99, p.uFireT || -99) < 8;   // 月影の抜け出し（無凸）：抜け出した後の決定力は控えめ（エースのかとうより下）
      if ((p.hariT || 0) > S.t) { S.ball.gkPen += p.hariLv >= 2 ? 0.3 : 0.22; }   // 針の穴通しの1本から：シュートの補正は若干だけ   // 最強のラストパス：受けたら1点   // 針の穴通しの1本を受けて：決めきる
      S.ball.gkPen += uOn(p, 'guren') ? (p.uniqLv >= 2 ? 1.1 : 0.95) * grF(p) : uOn(p, 'kage') ? (p.uniqLv >= 2 ? 0.8 : 0.65) : uOn(p, 'shiden') ? (S.t - (p.sdBeat || -9) < 1.5 ? 0.35 : 0.06) : uOn(p, 'tsukikage') && p.uniqLv >= 2 ? 0.09 : 0;   // GKが反応しにくい（月影の抜け出し：抜け出した勢いのまま1対1を決める）
      S.ball.uDelay = uOn(p, 'guren') ? 0.15 * uP(p) * grF(p) : 0; S.ball.grF = uOn(p, 'guren') ? grF(p) : 1; S.ball.pkShot = !!S.pk; S.ball.guren = uOn(p, 'guren') ? p.uniqLv || 1 : 0;   // 紅蓮の牙のシュート（2＝凸：GKはキャッチできない）
      S.fkDirect = false;
      S.ball.oneOnOne = oneOnOne;
      // 枠内かどうか（GKを無視した弾道）
      const b = S.ball;
      const tHit = (gx - b.x) / b.vx;
      const yHit = b.y + b.vy * tHit;
      const zHit = b.z + b.vz * tHit - 4.9 * tHit * tHit;
      b.shotOnTarget = Math.abs(yHit - GOAL_Y) < POST && (b.drive > 0 ? b.driveOn : zHit < BAR);   // ドライブシュートは、上へ外れそうに見えて落ちてくる
      b.shotFrom = hyp(gx - p.x, GOAL_Y - p.y);
      const s = stats[p.team];
      s.shots++;
      if (b.shotOnTarget) s.shots_on_target++; else s.off_target++;
      
      if (globalThis.__gkLog) { const g = T[1 - p.team].players[0], gxl = fx(1 - p.team, 0), sx = fx(1 - p.team, p.x), ga = Math.atan2(p.y - GOAL_Y, sx), gy = GOAL_Y + Math.tan(ga) * fx(1 - p.team, g.x); globalThis.__gkLog.push({ k: 'shot', t: S.t, gkX: +fx(1 - p.team, g.x).toFixed(1), gkY: +(g.y - GOAL_Y).toFixed(1), idealY: +(gy - GOAL_Y).toFixed(1), sd: +b.shotFrom.toFixed(1), sy: +(p.y - GOAL_Y).toFixed(1), on: b.shotOnTarget, down: (g.downT > 0 || g.diveT > 0) ? 1 : 0 }); }
      ev('shot', { team: p.team, player: p.name, number: p.number, d: +b.shotFrom.toFixed(1), on: b.shotOnTarget, knuckle: !!b.knuckle, chip: !!chip, one: !!S.ball.oneOnOne, power: Math.round(hyp(b.vx, b.vy) * 3.6) });
    }

    // ---------- 判断 ----------
    // GKがキャッチした後の配球
    //  ・カウンターを狙える時（前線の味方がフリーで、相手の戻りが少ない）はすぐに手放す（スロー／低いパントキック）
    //  ・それ以外は味方が上がるのを待ってから、フリーの味方へスロー、またはポストプレーが得意なFWへキック
    function gkDistribute(p) {
      const b = S.ball, held = S.t - (p.holdT ?? S.t);
      const mts = mates(p).filter((m) => m !== p && !m.off);
      const freeOf = (m) => nearestOpp(m, m.x, m.y).d;
      const fwd = (m) => fx(p.team, m.x);
      // カウンター
      const counter = mts.filter((m) => fwd(m) > 45 && freeOf(m) > 7 && opps(p).filter((q) => fx(p.team, q.x) < fwd(m) - 2 && !q.gk).length <= 3).sort((a, c) => fwd(c) - fwd(a))[0];
      if (held < 1.6 && counter) {
        const dC = hyp(counter.x - p.x, counter.y - p.y);
        // 低弾道パント：相手DFラインの裏へ。低弾道スロー：ハーフウェーライン手前まで頭の高さで
        if (p.sk.has('lowPunt') && dC > 30) { gkRelease(p, counter, 'lowPunt'); return true; }
        gkRelease(p, counter, dC < (p.sk.has('lowThrow') ? 46 : 32) ? 'throw' : 'punt'); return true;
      }
      if (held < 3.5) { S.decision = 0.3; return true; }     // 味方が上がるのを待つ
      // フリーの味方へスロー（近くに相手がいない、パスコースに相手がいない）
      const safe = mts.filter((m) => { const d = hyp(m.x - p.x, m.y - p.y); if (d < 8 || d > 34 || freeOf(m) < 8) return false; return !opps(p).some((q) => segDist(q.x, q.y, p.x, p.y, m.x, m.y).d < 2.5); }).sort((a, c) => freeOf(c) - freeOf(a));
      if (safe.length && R.next() < 0.9) { gkRelease(p, safe[0], 'throw'); return true; }   /* 版458：フリーの味方がいれば、まずつなぐ */
      { const sh2 = mts.filter((m) => { const d = hyp(m.x - p.x, m.y - p.y); if (d < 6 || d > 38 || freeOf(m) < 5.5) return false; return !opps(p).some((q) => segDist(q.x, q.y, p.x, p.y, m.x, m.y).d < 2); }).sort((a, c) => (freeOf(c) + fwd(c) * 0.05) - (freeOf(a) + fwd(a) * 0.05));
        if (sh2.length && R.next() < 0.75) { gkRelease(p, sh2[0], 'throw'); return true; } }   // 少し寄せられていても、コースが空いていれば近くの味方へ
      { const sc = (m) => { const near = (arr, r) => arr.filter((q) => !q.off && !q.gk && hyp(q.x - m.x, q.y - m.y) < r).length; return Math.min(freeOf(m), 12) + (m.jump * 0.6 + m.physical * 0.4) / 30 + near(mts.filter((x) => x !== m), 9) * 1.2 - near(opps(p), 8) * 1.0; };
        const lk = mts.filter((m) => fwd(m) > 38).sort((a, c) => sc(c) - sc(a))[0];
        if (lk) { gkRelease(p, lk, 'kick'); return true; } }   // 蹴る時は、空いていて味方が近くにいる所へ（競り合いになるFWの頭ではなく）
      // ポストプレーが得意なFW（フィジカルが高い）へキック
      const pw = (m) => m.jump * 0.6 + m.physical * 0.4 + m.goal_wait * 0.2 + (skZ(m, 'postPlay') ? 40 : 0);
      const fw = mts.filter((m) => m.slot.last).sort((a, c) => pw(c) - pw(a))[0] || mts[mts.length - 1];
      gkRelease(p, fw, 'kick'); return true;
    }
    function gkRelease(p, q, how) {
      const b = S.ball;
      p.hold = false;
      if (how === 'throw' && p.sk.has('lowThrow') && hyp(q.x - p.x, q.y - p.y) > 22) {
        // 低弾道スロー：頭くらいの高さで一直線に、遠くまで
        const tx = q.x + q.vx * 0.8, ty = q.y + q.vy * 0.8, d = hyp(tx - p.x, ty - p.y) || 1;
        const v = clamp(15 + d * 0.3, 18, 27), t = d / v;
        Object.assign(b, { owner: -1, kind: 'pass', style: 'drive', z: 2.0, vx: ((tx - p.x) / d) * v, vy: ((ty - p.y) / d) * v, vz: clamp((4.9 * t * t - 0.6) / t, 0.5, 6), spin: 0, bs: 0, knuckle: false, lastTeam: p.team, lastPlayer: p.idx, kicker: p.idx, intended: q.idx, offside: false });
        p.touchCd = 0.6; act(p, 'throwgk', 0.5); act(p, 'skill', 1.3, { k: 'lowThrow' });
      } else if (how === 'lowPunt') {
        // 低弾道パントキック：頭くらいの弾道で、ポップアップしながら相手DFラインの裏へ
        const offL = offsideLine(p.team), tx = fx(p.team, Math.min(offL + 7, L - 14)), ty = clamp(q.y + R.gauss() * 3, 6, W - 6);
        kick(p, tx, ty, 'pass', 'drive', { landFrac: 0.62 });
        b.vz = Math.min(b.vz, 5.2); b.bs = -0.2;
        b.intended = q.idx; b.offside = false; q.run = Math.max(q.run, 3);
        act(p, 'skill', 1.3, { k: 'lowPunt' });
      } else if (how === 'throw') {
        const tx = q.x + q.vx * 0.5, ty = q.y + q.vy * 0.5, d = hyp(tx - p.x, ty - p.y) || 1;
        const v = clamp(8 + d * 0.42, 9, 22) * (0.98 + p.technique * 0.0004);
        Object.assign(b, { owner: -1, kind: 'pass', style: 'ground', z: 1.0, vx: ((tx - p.x) / d) * v, vy: ((ty - p.y) / d) * v, vz: d > 20 ? 2.2 : 0.2, spin: 0, bs: 0, knuckle: false, lastTeam: p.team, lastPlayer: p.idx, kicker: p.idx, intended: q.idx, offside: false });
        p.touchCd = 0.6; act(p, 'throwgk', 0.5);
      } else {
        // パント：カウンターは低い弾道で速く、通常は高く蹴って競らせる
        kick(p, q.x + sgn(p.team) * 3, q.y, 'pass', how === 'punt' ? 'drive' : 'high', { landFrac: 0.95 });
        b.intended = q.idx; b.offside = false;
      }
      stats[p.team].passes++; S.lastPass[p.team] = { from: p.idx, t: S.t };
    }

    function decide(p) {
      const b = S.ball, tm = T[p.team];
      const PAT = S.counter > 0 && S.poss === p.team ? Math.min(0.15, tm.pat) : (tm.accelT || 0) > S.t ? Math.min(0.2, tm.pat) : tm.pat;   // 版843：攻撃のスイッチが入ったら（縦パスが入った瞬間）、テンポを上げる   // 版841：カウンターの間は、つながずに速く前へ
      if (globalThis.__mdE && p.uniq === 'midori') globalThis.__mdE.push([+fx(p.team, p.x).toFixed(0), S.setPiece ? 1 : 0, S.oneTouch ? 1 : 0]);
      if ((p.kgPin || 0) > S.t && !p.gk && !S.setPiece) {   // 影縫い（凸）：縫い止められている間は前を向けない。少しこらえてから、後ろの味方へ戻すだけ
        const back = mates(p).filter((q) => !q.off && !q.gk && fx(p.team, q.x) < fx(p.team, p.x) - 2 && hyp(q.x - p.x, q.y - p.y) < 30 && nearestOpp(q, q.x, q.y).d > 3).sort((a, c) => nearestOpp(c, c.x, c.y).d - nearestOpp(a, a.x, a.y).d)[0];
        if (back && S.t > p.kgPin - 0.55) { startPass(p, back, false, false, null); return; }
        S.decision = 0.1; return; }
      if (p.gk && p.hold && !S.setPiece && gkDistribute(p)) return;
      // GKがペナルティエリアの外で触った（飛び出し）：手は使えないので、迷わずはっきり処理する。近くにフリーの味方がいればつなぐ、いなければ大きくクリア
      if (p.gk && !p.hold && !S.setPiece && !S.restart && (fx(p.team, p.x) > 16.5 || Math.abs(p.y - GOAL_Y) > 20.16)) {
        const press = nearestOpp(p, p.x, p.y).d;
        let best = null, bs = -1e9;
        for (const q of mates(p)) { if (q.gk || q.off) continue; const d = hyp(q.x - p.x, q.y - p.y); if (d < 8 || d > 34) continue; const op = nearestOpp(q, q.x, q.y).d; if (op < 6) continue;
          const lane = opps(p).some((o) => { const sd = segDist(o.x, o.y, p.x, p.y, q.x, q.y); return sd.u > 0.1 && sd.u < 0.9 && sd.d < 2; }); if (lane) continue;
          const v = op + (fx(p.team, q.x) - fx(p.team, p.x)) * 0.1; if (v > bs) { bs = v; best = q; } }
        if (best && press > (S.t - (p.sweepT || -9) < 1.5 ? 7 : 3)) { act(p, 'gkplay', 1.2, { k: 'gkPass' });   // 捨て身の守護神で触った直後は、相手が近ければ迷わずクリア
          startPass(p, best, false, false, null); return; }
        act(p, 'gkplay', 1.2, { k: 'gkClear' });
        kick(p, clamp(p.x + sgn(p.team) * R.range(28, 42), 2, L - 2), p.y < GOAL_Y ? R.range(3, 12) : W - R.range(3, 12), 'pass', 'clear', { landFrac: R.range(0.85, 1.0) });
        b.intended = -1; b.offside = false; b.kind = 'loose'; return;
      }
      if (!p.gk && !S.setPiece && S.ball.owner === p.idx && S.ball.z > 0.15) { S.decision = 0.05; return; }   // 版812：胸・ももで止めたボールが足もとに落ちてくるまでは、蹴らない（頭の上から真っすぐ飛んでいた。ワンタッチで打つ時も、落ちてから）
      if (S.forceShot != null) { const a = S.forceShot, h = S.forceHow; S.forceShot = null; S.forceHow = null; shoot(p, a, h); return; }
      if ((p.mtCounter || 0) > S.t && !S.setPiece) { p.mtCounter = 0;   // 祭り太鼓の壁（凸）：奪った瞬間、前にいるフリーの味方へ蹴り出してカウンター
        let best = null, bv = -1e9; for (const q of mates(p)) { if (q.gk || q.off) continue; const ad = fx(p.team, q.x) - fx(p.team, p.x), op = nearestOpp(q, q.x, q.y).d; if (ad < 12 || op < 4 || hyp(q.x - p.x, q.y - p.y) > 45) continue; const v = ad + op * 1.5; if (v > bv) { bv = v; best = q; } }
        if (best) { act(p, 'taiko', 0.7, { lv: 2 }); startPass(p, best, false, false, null); return; } }
      if (S.trapPend) { const tp = S.trapPend;   // 出し手は、蹴るまでのわずかな間（その間にラインが上がる）
        if (tp.p !== p.idx || !P[tp.q] || P[tp.q].off) S.trapPend = null;
        else if (S.t < tp.at) { S.decision = tp.at - S.t; return; }
        else { S.trapPend = null; S.trapGo = true; if (globalThis.__trapLog) { const q = P[tp.q]; globalThis.__trapLog.push({ t: S.t, qx: +fx(p.team, q.x).toFixed(1), line: +offsideLine(p.team).toFixed(1), def2: +T[1 - p.team].players.map((m) => fx(p.team, m.x)).sort((a, c) => c - a)[1].toFixed(1), bx: +fx(p.team, S.ball.x).toFixed(1) }); } startPass(p, P[tp.q], tp.through, tp.chip, tp.skill); return; } }
      if (!p.gk && !S.setPiece && emptyGoal(p)) { shoot(p, null, null); return; }   // ゴールが空いていたら、必ず打つ
      if (S.mustClear && S.mustClear.i === p.idx && S.t - S.mustClear.t < 1.5 && !S.setPiece) {   // こぼれ球のクリア：外へ・前へ大きく
        S.mustClear = null; act(p, 'gkplay', 1.2, { k: 'dfClear' });
        { const [ax, ay] = clearAim(p, clamp(p.x + sgn(p.team) * R.range(20, 34), 2, L - 2), p.y < GOAL_Y ? R.range(-4, 10) : W - R.range(-4, 10)); kick(p, ax, ay, 'pass', 'clear', { landFrac: R.range(0.8, 1.0) }); }
        b.intended = -1; b.offside = false; b.kind = 'loose'; return; }
      // 版795：アタッカー：サイドで受けたら、中へ切り込んで打つ
      if (p.type === 'アタッカー' && p.position === 'FW' && !S.setPiece && !S.restart && !p.gk) {
        const xq = fx(p.team, p.x), wd = Math.abs(p.y - GOAL_Y), sd = Math.sign(p.y - GOAL_Y) || 1;
        if (p.atCut && p.atCut.until > S.t) {
          if ((xq > L - 21 && wd < 11) || hyp(L - xq, GOAL_Y - p.y) < 18) { p.atCut = null; p.wantShot = S.t + 1.2; }   // 打てる所まで来た：打つ（ふだんの判断へ。シュートを選びやすい）
          else { const gx = fx(p.team, L - 16), gy = GOAL_Y + sd * 3, dx = gx - p.x, dy = gy - p.y, dl = hyp(dx, dy) || 1; S.dribbleDir = [dx / dl, dy / dl]; S.dribbleMode = 'break'; p.burstT = S.t + 0.4; S.decision = 0.3; return; }
        } else if (xq > L - 46 && xq < L - 14 && wd > 7 && S.t - (p.atCutT || -9) > 5 && nearestOpp(p, p.x, p.y).d > 2 && R.next() < 0.6) {
          p.atCutT = S.t; p.atCut = { until: S.t + 2.2 }; if (globalThis.__tyDbg) globalThis.__tyDbg.cut++; act(p, 'dmode', 0.3, { m: 'break' });
          const gx = fx(p.team, L - 16), gy = GOAL_Y + sd * 3, dx = gx - p.x, dy = gy - p.y, dl = hyp(dx, dy) || 1; S.dribbleDir = [dx / dl, dy / dl]; S.dribbleMode = 'break'; p.burstT = S.t + 0.4; S.decision = 0.3; return;
        }
      }
      // 版800：ビルドアップ型：自陣で前が空いていたら、ボールを持ったまま中盤まで運ぶ（相手が来たら離す）
      if (p.type === 'ビルドアップ型' && p.position === 'DF' && !S.setPiece && !S.restart && !p.gk) {
        const xq = fx(p.team, p.x), front = () => opps(p).some((o) => !o.off && !o.gk && fx(p.team, o.x) > xq - 1 && hyp(o.x - p.x, o.y - p.y) < 5.5);
        if ((p.buCarry || 0) > S.t) { if (xq > L / 2 + 6 || front() || nearestOpp(p, p.x, p.y).d < 3) p.buCarry = 0; else { S.dribbleDir = [sgn(p.team) * 0.95, (GOAL_Y - p.y) * 0.012]; S.dribbleMode = 'carry'; S.decision = 0.35; return; } }
        else if (xq > 12 && xq < L / 2 - 6 && S.t - (p.buT ?? -9) > 7 && !front() && nearestOpp(p, p.x, p.y).d > 4.5 && R.next() < 0.8) { p.buT = S.t; p.buCarry = S.t + 3.5; S.dribbleDir = [sgn(p.team) * 0.95, (GOAL_Y - p.y) * 0.012]; S.dribbleMode = 'carry'; act(p, 'dmode', 0.3, { m: 'carry' }); S.decision = 0.35; if (globalThis.__tyDbg) globalThis.__tyDbg.buCarry = (globalThis.__tyDbg.buCarry || 0) + 1; return; }
      }
      // 版798：ゲームメイカー（シャビ）：すぐ近くに寄せられたら、体を回して相手から離れる（取られない）
      if (p.type === 'ゲームメイカー' && p.position === 'MF' && !S.setPiece && !S.restart && !p.gk && S.t - (p.gmTurnT ?? -9) > 2.5) {
        let dn = null, dd = 99; for (const o of opps(p)) { if (o.off || o.gk) continue; const d0 = hyp(o.x - p.x, o.y - p.y); if (d0 < dd) { dd = d0; dn = o; } }
        if (dn && dd < 2.4 && fx(p.team, p.x) < L - 20) { p.gmTurnT = S.t; const ax = p.x - dn.x, ay = p.y - dn.y, al = hyp(ax, ay) || 1, rot = (p.number % 2 ? 1 : -1) * 0.9, c = Math.cos(rot), sn = Math.sin(rot);
          S.dribbleDir = [(ax * c - ay * sn) / al, (ax * sn + ay * c) / al]; S.dribbleMode = 'carry'; p.protect = Math.max(p.protect || 0, S.t + 0.8); act(p, 'dmode', 0.3, { m: 'carry' }); S.decision = 0.45; if (globalThis.__tyDbg) globalThis.__tyDbg.gmTurn = (globalThis.__tyDbg.gmTurn || 0) + 1; return; }
      }
      // 版797：ゲームメイカー：相手陣で前を向いて受けたら、一度止まって「ため」を作る（その間に味方が走り出す）→ 決定的なパス
      if (p.type === 'ゲームメイカー' && p.position === 'MF' && !S.setPiece && !S.restart && !p.gk) {
        if ((p.gmHold || 0) > S.t) { S.dribbleMode = 'carry'; S.dribbleDir = [sgn(p.team), 0]; p.protect = Math.max(p.protect || 0, p.gmHold); S.decision = Math.max(0.05, p.gmHold - S.t); return; }
        const xq = fx(p.team, p.x);
        if (xq > L / 2 - 8 && xq < L - 22 && S.t - (p.gmT ?? -9) > 6 && S.t - (p.recvT || -9) < 1.2 && nearestOpp(p, p.x, p.y).d > 2.5 && R.next() < 0.75) { p.gmT = S.t; p.gmHold = S.t + R.range(0.6, 0.9); p.protect = Math.max(p.protect || 0, p.gmHold); S.dribbleMode = 'carry'; S.dribbleDir = [sgn(p.team), 0]; S.decision = p.gmHold - S.t; if (globalThis.__tyDbg) globalThis.__tyDbg.gmHold = (globalThis.__tyDbg.gmHold || 0) + 1; return; }
      }
      // 月影の抜け出し：受けたら止まらずに前へ持ち出し、打てる所まで来たら打つ
      if (p.tsukiRecv && S.t - p.tsukiRecv < 4 && !S.setPiece) {   // 受けてから：速さは1.5秒でふつうに戻るが、ゴールへ向かって運び、打てる所で打つ
        const xq = fx(p.team, p.x), dG = hyp(L - xq, GOAL_Y - p.y);
        const gk = opps(p).find((q) => q.gk && !q.off), gkD = gk ? hyp(gk.x - p.x, gk.y - p.y) : 99, inBox = xq > L - 16.5 && Math.abs(p.y - GOAL_Y) < 20.16;
        if ((inBox && Math.abs(p.y - GOAL_Y) < 14) || dG < 15 || gkD < 8) {   // ペナルティエリアに入った・GKが出てきた：待たずに、ゴールの空いている側へ打つ
          const side = gk ? (Math.abs(gk.y - GOAL_Y) > 0.4 ? (gk.y > GOAL_Y ? -1 : 1) : (p.y > GOAL_Y ? -1 : 1)) : 1;
          p.tsukiRecv = 0; p.wantShot = S.t + 1.5; shoot(p, GOAL_Y + side * R.range(2.2, 3.0), null); return; }
        else {
        const gx = fx(p.team, L), dx = gx - p.x, dy = (GOAL_Y - p.y) * 0.6, dl = hyp(dx, dy) || 1;
        S.dribbleDir = [dx / dl, dy / dl]; S.dribbleMode = 'break'; p.pace = { ph: 'burst', until: S.t + 0.8 }; p.burstT = S.t + 0.5; p.settle = false; if (S.t - p.tsukiRecv < (p.uniqLv >= 2 ? 1.5 : 0.4)) p.tsukiGuard = S.t + 0.5;   // 抜け出して運んでいる間：止めに来られるのは、カバーリングできるDFだけ
        S.decision = 0.35; return; }
      }
      // 月影の抜け出し：走り出した味方へ、すぐにスルーパス
      if (S.forcePass) { const fp = S.forcePass, q = P[fp.to];
        if (S.t > fp.until || !q || q.off || q.team !== p.team || p.idx === fp.to || p.gk) S.forcePass = null;
        else if (S.t < fp.at && p.idx === fp.from) { S.decision = Math.max(S.decision, fp.at - S.t); return; }   // 走り出すのを待ってから出す
        else if (S.t >= fp.at) { S.forcePass = null; if (globalThis.__fp) globalThis.__fp.push(S.t);
          const q2 = fp.pick ? tactPick(p, fp.pick) || q : q, thr = !fp.pick || (q2.tact && q2.tact.role === 'ura');
          startPass(p, q2, thr, false, thr && skZ(p, 'throughPass') && !((p.skLock || 0) > S.t) ? 'throughPass' : null); return; } }
      // ワンツー：走り込んだ味方へ、ダイレクトで前へ落とす
      // ゴール前で自分が打てる時は、ワンツーの落としより自分で打つ
      const canShootHere = (() => { const xq = fx(p.team, p.x), dG = hyp(L - xq, GOAL_Y - p.y); if (xq < L - 18 || dG > 18 || Math.abs(p.y - GOAL_Y) > (L - xq) * 1.6 + 4) return false; let bl = 0; for (const q of opps(p)) { if (q.gk) continue; const sd = segDist(q.x, q.y, p.x, p.y, fx(p.team, L), GOAL_Y); if (sd.d < 1.3 && sd.u > 0.05) bl++; } return bl <= 1; })();
      if (S.oneTouch && S.oneTwo && S.oneTwo.b === p.idx && !canShootHere) {
        const rn = P[S.oneTwo.a];
        const offL2 = offsideLine(p.team);
        const spot = rn && otSpot(p, rn);
        // パスコースに相手の足が届くか（通常のパスと同じ読み）。うまい選手ほど正確に読む
        const laneOK = rn && (() => { const d = hyp(spot[0] - p.x, spot[1] - p.y), pv = 7 + d * 0.35 + p.pass * 0.04; let danger = 0;
          for (const o of opps(p)) { const sd = segDist(o.x, o.y, p.x, p.y, spot[0], spot[1]); const reach = 1.3 + maxSpeed(o) * Math.max(0, (d * sd.u) / pv - 0.25) * 0.9; if (sd.d < reach) danger += (reach - sd.d) / reach; }
          return danger * (1 + R.gauss() * (1 - p.vision / 100) * 0.9) < 0.2; })();
        const running = rn && rn.otRun && S.t < rn.otRun.until;
        // 落とす先に、走り込む味方より先に相手が着くなら出さない（読まれていれば当然カットされる）
        const spotSafe = rn && (() => { const tR = hyp(spot[0] - rn.x, spot[1] - rn.y) / maxSpeed(rn);
          let tD = 99; for (const o of opps(p)) { if (o.gk && hyp(spot[0] - o.x, spot[1] - o.y) > 8) continue; tD = Math.min(tD, hyp(spot[0] - o.x, spot[1] - o.y) / maxSpeed(o)); }
          return tD > tR + 0.15; })();
        if (rn && running && laneOK && spotSafe && !rn.off && fx(p.team, rn.x) < offL2 + 0.2 && hyp(spot[0] - p.x, spot[1] - p.y) < 24 && R.next() < 0.45 + (p.pass + p.vision) / 300 + DOM[p.team] * 0.3) { if (skZ(p, 'throughPass') || skZ(p, 'wallPass')) S.oneTouchBoost = true; if (skZ(p, 'wallPass') && !((p.skLock || 0) > S.t)) act(p, 'skill', 1.2, { k: 'wallPass' }); startPass(p, rn, false); S.oneTouchBoost = false; return; }
      }
      const xf = fx(p.team, p.x);
      // GKや自陣ゴール前の守備者が足元で持ち、目の前に相手がいる → 迷わず大きくクリア（セオリー）
      {
        const nd = nearestOpp(p, p.x, p.y).d;
        if (!S.setPiece && ((p.gk && !p.hold && nd < 14) || (!p.gk && xf < 18 && Math.abs(p.y - GOAL_Y) < 22 && nd < 4))) {
          let ty = p.y < GOAL_Y ? R.range(2, 14) : W - R.range(2, 14), tx = clamp(p.x + sgn(p.team) * R.range(38, 52), 2, L - 2);   // サイドへ、遠くへ
          // サイド寄りなら、安全にタッチラインの外へ蹴り出す（プレーを切る）
          if (!p.gk && Math.abs(p.y - GOAL_Y) > 10 && R.next() < OUT_CLEAR) { ty = p.y < GOAL_Y ? -5 : W + 5; tx = clamp(p.x + sgn(p.team) * R.range(10, 26), 2, L - 2); }
          kick(p, tx, ty, 'pass', p.gk ? 'high' : 'clear', { landFrac: R.range(0.85, 1.0) });
          b.intended = -1; b.offside = false; b.kind = 'loose';
          return;
        }
      }
      const dGoal = hyp(L - xf, GOAL_Y - p.y);
      const near = nearestOpp(p, p.x, p.y);
      let pressure = 0;
      for (const q of opps(p)) if (hyp(q.x - p.x, q.y - p.y) < 3.2) pressure++;
      // 固有スキル（自分がボールを持った場面で出る）
      if (p.uniq && !S.setPiece) {
        if (globalThis.__mdA && p.uniq === 'midori') globalThis.__mdA.push(+xf.toFixed(0));
        if (p.uniq === 'midori' && !p.gk && xf < ((T[p.team].mdStack || 0) < 4 ? 66 : 52) && !globalThis.__noMd) { const eager = (T[p.team].mdStack || 0) < 4, pr = opps(p).filter((o) => !o.off && !o.gk && hyp(o.x - p.x, o.y - p.y) < (eager ? 38 : 26) && fx(p.team, o.x) > xf - 3).length, fwA = mates(p).some((m) => m !== p && !m.off && !m.gk && m.position === 'FW' && fx(p.team, m.x) > xf + (eager ? 6 : 20));   /* 版467：積み重ねがMAXになるまでは、出しやすく */ if (globalThis.__mdF) globalThis.__mdF.push([+xf.toFixed(0), pr, fwA ? 1 : 0, p.uCd > S.t ? 1 : 0]); if ((pr >= 1 || eager) && (fwA || eager)) uFire(p, 'midori'); }   /* 版448：自陣（ハーフライン付近まで）で持って、前から寄せられる相手がいる・前にFWがいる */
      }
      const opts = [];
      const att = tm.attitude === 'attacking' ? 1.25 : tm.attitude === 'defensive' ? 0.8 : 1;

      // ゴール前・サイドの1対1では、目の前の相手に自分から技を仕掛ける（キックフェイント・ヒールリフトなど）
      if (!p.gk && !S.setPiece) {
        const gx = fx(p.team, L), fdx = gx - p.x, fdy = GOAL_Y - p.y, fl = hyp(fdx, fdy) || 1;
        const front = opps(p).filter((o) => !o.gk && hyp(o.x - p.x, o.y - p.y) < 3.8 && ((o.x - p.x) * fdx + (o.y - p.y) * fdy) / fl > 0.5).sort((a, c) => hyp(a.x - p.x, a.y - p.y) - hyp(c.x - p.x, c.y - p.y))[0];
        if (front) {
          const { ctx } = dribbleCtx(p, front);
          const want = (ctx.goal && skZ(p, 'kickFeint')) || (ctx.side && (skZ(p, 'heelLift') || skZ(p, 'cutIn') || globalThis.__forceSkill === 'heelLift'));   // 確認用：ヒールリフトを選んだ時は、技を持っていない選手も仕掛ける
          if (want && R.next() < 0.45 && skillMove(p, front)) return;
        }
      }
      // 超ロングシュート：ハーフウェーライン付近から、GKが前に出ていれば狙う
      if (!p.gk && skZ(p, 'superLong') && !S.setPiece && shotCtx(p).half) {
        const gk0 = opps(p)[0], gkOff = Math.abs(gk0.x - fx(p.team, L));
        if (gkOff > 6 || R.next() < 0.02) opts.push({ kind: 'shot', w: gkOff > 6 ? 3 : 0.4 });
      }
      // シュート
      const range = 22 + p.kick * 0.09 + ((p.wantShot || 0) > S.t ? 5 : 0) + (p.type === 'パサー' ? 4 : 0);   // 版798：パサー（デブライネ）はミドルも打つ   // E（40）でも26m、S（90）なら30mまでは打つ候補に入る
      const striker = p.type === 'ストライカー' && p.position === 'FW';   // 版732：ストライカーはゴールに貪欲
      const justWon = S.t - (p.wonT ?? -9) < 0.7 && !S.setPiece && !(striker && dGoal < 16);   // ストライカーは、ゴール前でこぼれ球を拾ったら、そのまま打てる   // 相手から奪った・相手のパスを拾った直後：まずボールを収めてから（いきなりシュートは打たない）
      if (dGoal < range && !p.gk && !justWon) {
        let blockers = 0;
        for (const q of opps(p)) {
          if (q.gk) continue;
          const sd = segDist(q.x, q.y, p.x, p.y, fx(p.team, L), GOAL_Y);
          if (sd.d < 1.3 && sd.u > 0.05) blockers++;
        }
        let v = 4.8 - (dGoal - 10) * 0.13 - Math.max(0, dGoal - 16) * 0.4 - DOM[p.team] * Math.max(0, dGoal - 18) * 0.35   /* 力の差があるなら、確実に決まる所まで運ぶ */   /* 遠すぎるミドルは打たない。崩してから */ + p.goal_wait / 110 + p.kick / 160 - blockers * 0.9 + tm.mods.attack;
        if (Math.abs(p.y - GOAL_Y) > (L - xf) * 1.1) v -= 1.2;
        if (dGoal < 11) v += 0.8;
        if (S.fkDirect) v += 1.4 + blockers * 0.9;
        v += Math.max(0, p.kick + p.vision - 100) / 80;   // うまい選手は決められる位置なら迷わず打つ
        // GKとの力の差：圧倒的にうまい選手は、少し遠くからでも迷わず打つ（打てば入る）
        { const gk0 = opps(p)[0]; if (gk0 && gk0.gk) v += Math.max(0, (p.kick * 0.6 + p.technique * 0.4) - (gk0.technique * 0.4 + gk0.jump * 0.25 + gk0.dash * 0.2 + gk0.mental * 0.15) - 15) * 0.04; }
        v += DOM[p.team] * (dGoal < 18 ? 3.6 : 0);
        if ((p.wantShot || 0) > S.t) v += 2.5;   // カットインからは打つ
        { const sc0 = shotCtx(p);
          if (skZ(p, 'controlShot') && blockers <= 1) v += sc0.corner ? 2.6 + blockers * 0.9 : sc0.wing ? 0.8 : 0;   // PAの角付近は、コントロールショットの得意な位置
          if (skZ(p, 'powerMid') && sc0.mid && blockers === 0) v += 0.9;
          // トゥーキック：囲まれて踏み込めない狭い所でも、構えずに打てる
          if (skZ(p, 'toeKick') && dGoal < 16 && opps(p).filter((q) => !q.gk && hyp(q.x - p.x, q.y - p.y) < 3.5).length >= 2) v += 0.3 + blockers * 0.3; }   // 強烈ミドル：ミドルレンジから思い切って
        if (p.uniq === 'guren' && dGoal < 26 && blockers <= 1) v += 0.9;   // 屈指の点取り屋：打てる所では迷わず打つ
        v += 1.1 + DOM[p.team] * 1.4;   // 打てる場面では打つ（ゴールが大きくなった分）
        // 版732：ストライカーはゴールに貪欲：ゴール前では、横パスより自分で打つ（コースに1人いても打つ）
        if (striker) v += dGoal < 18 ? 1.8 + (blockers <= 1 ? 0.8 : 0) : dGoal < 25 ? 1.1 + (blockers === 0 ? 0.6 : 0) : 0;   // 版846：ストライカーは25mまで、打てるなら打つ
        if (tm.urg && dGoal < 26) v += 0.6;   // 追いかける終盤は、打てる所では積極的に打つ
        // シュートコースが空いていれば、ミドルレンジでも思い切って打つ（カルチョビットAのように、打てる所では打つ）
        if (blockers === 0 && dGoal < 27) v += dGoal < 21 ? 1.4 : 0.3;   // 遠めは打てても、運べるならもっと近づいてから
        // 寄せられて奪われそうな時も、コースがあれば打ってしまう
        if (pressure >= 1 && blockers === 0 && dGoal < 25) v += 0.5;
        // ゴール前で自分が打てる（近くて、コースに相手が1人以下・角度もある）：横パスより、まず自分で打つ
        const spot = xf > L - 18 && dGoal < 18 && blockers <= 1 && Math.abs(p.y - GOAL_Y) < (L - xf) * 1.6 + 4;
        if (spot) v += 1.8 + (blockers === 0 && dGoal < 12 ? 1.2 : 0);
        p.shootSpot = spot ? S.t : -9; if (globalThis.__spotN && spot) globalThis.__spotN.n++;
        let w = Math.exp(v * 1.5) * att;
        opts.push({ kind: 'shot', w });
      }

      // 前（相手ゴール方向）の空き具合
      let frontSpace = 9;
      { const dx0 = fx(p.team, L) - p.x, dy0 = GOAL_Y - p.y, dl0 = hyp(dx0, dy0) || 1;
        for (const q of opps(p)) { const rx = q.x - p.x, ry = q.y - p.y, dd = hyp(rx, ry); if (dd > 9) continue; if ((rx * dx0 + ry * dy0) / (dl0 * (dd || 1)) > 0.45) frontSpace = Math.min(frontSpace, dd); } }
      // パス（判断力が高い選手はトラップを見抜く）
      const offL = p.vision >= 80 && !teamU(1 - p.team, 'sakurajima') ? offsideLine(p.team) : seenOffLine(p.team);   // 桜島の号令の一斉の押し上げは、判断力の高い選手でも気づくのが遅れる
      // パス技：場面（自陣・中盤より前・アタッキングゾーン・サイド）と覚えている技から選ぶ
      const zDef = xf < 35, zMid = xf >= 35, zAtk = xf > L - 35, zSide = Math.abs(p.y - GOAL_Y) > 16;
      const passSkill = (q, pxf, py, d, danger) => {
        const has = (k) => skZ(p, k) && !((p.pskCd || 0) > S.t && k !== 'oneTouchPass');   // 同じ選手が技を連発しない。使ってよいエリアかどうかは「スキルのエリア設定」の表で決める
        let best = null;
        const cand = (k, bonus, extra) => { if (!has(k)) return; bonus += zr(p, k) === 2 ? 0.6 : 0; if (!best || bonus > best.bonus) best = { k, bonus, ...(extra || {}) }; };   // 積極的なエリアでは選ばれやすい
        // 裏を狙える味方：走り出している、または相手の最終ライン付近で待っている
        const runner = (q.run > 0 && fx(p.team, q.x) > offL - 6) || (fx(p.team, q.x) > offL - 3 && fx(p.team, q.x) < offL + 0.2 && L - offL > 8);
        if (runner && L - offL > 7 && pxf > xf + 3) cand('throughPass', 1.4 + (zAtk ? 0.5 : 0), { through: true });   /* 版840：2.2→1.4 */
        if (runner && danger > 0.15 && d > 9 && d < 38) cand('loftedThrough', 1.6 + (zAtk ? 0.4 : 0), { through: true, chip: true });   /* 版840：2.4→1.6 */
        if (danger > 0.3 && danger < 1.0 && d < 22) cand('noLook', 0.2 + (zAtk ? 0.4 : 0));
        if (pxf < xf - 1 && d > 3 && d < 13) cand('heelPass', (zAtk ? 2.4 : 1.0));
        if (d > 26 && pxf > xf + 16) cand('longFeed', 2.3);
        if (pxf > L - 18 && Math.abs(py - GOAL_Y) < 12 && pxf > xf + 8) cand('earlyCross', 1.6, { cross: true });
        if (pxf > L - 18 && Math.abs(py - GOAL_Y) < 12 && Math.abs(p.y - GOAL_Y) > 12) cand('pinpointCross', 1.5, { cross: true });
        if (Math.abs(q.y - p.y) > 26 && d > 24) cand('switchPlay', 1.4);
        if (S.oneTouch && p.otPass) cand('oneTouchPass', 1.2 + (zAtk ? 0.6 : 0));
        return best;
      };
      // 直前に同じ相手と何度もやり取りしているか
      let recentPair = 0;
      { const hist = (S.passHist || []).filter((h) => S.t - h.t < 14 && (h.a === p.idx || h.b === p.idx));
        const cnt = {}; for (const h of hist) { const o = h.a === p.idx ? h.b : h.a; cnt[o] = (cnt[o] || 0) + 1; }
        recentPair = Math.max(0, ...Object.values(cnt)); }
      // 縦への意識：堅守型も奪ったら縦へ。負け・引き分けの終盤は全チームが縦へ急ぐ
      const vert = (tm.attitude === 'defensive' ? 0.035 : 0) + tm.urg * 0.05 + (p.type === 'ゲームメイカー' ? 0.03 : 0) + (p.type === 'パサー' ? 0.065 : 0) + (p.type === 'ビルドアップ型' ? 0.05 : 0) + (p.type === '偽9番' ? 0.02 : 0) + tm.tac.vert;
      // 針の穴通し（きのした）：相手陣内で前を向いたら、ふつうは見えない「すき間の1本」が見える
      const hrReady = p.uniq === 'harinoana' && !(p.uCd > S.t) && !p.off && xf > L / 2 - 6 && !S.setPiece;
      for (const q of mates(p)) {
        if (q === p) continue;
        if (q.gk && !(pressure >= 1 && xf < 35)) continue;
        if (hyp(q.x - p.x, q.y - p.y) > 26 + p.kick * 0.45) continue;   /* v740 キックで届く距離（E 約44m・S 約66m）より遠い味方には出さない */
        const otR = isOTReturn(p, q);
        // 判断力が高いほど、少しでも裏にスペースがあれば走り出しに合わせてスルーパスを狙う
        const spaceBehind = L - offL > 8 && fx(p.team, q.x) > offL - 7 && fx(p.team, q.x) > xf - 2 && !q.gk;
        const isPasser = p.type === 'パサー';
        let through = !otR && ((q.run > 0 && fx(p.team, q.x) > offL - ((q.aoRun || 0) > S.t && uOn(p, 'aonoouza') ? 7 : 4)) || (spaceBehind && hrReady) || (spaceBehind && L - offL > 12 && (isPasser ? p.vision > 40 && R.next() < (p.vision - 30) / 50 * 0.6 : p.vision > 50 && R.next() < (p.vision - 45) / 55 * 0.4)));
        if (through && !hrReady && PAT > 0 && L - offL < 16 && R.next() < 0.8 * PAT) through = false;   // 版840：つなぐチームは、裏が広く空いていなければ、走る味方の足もとへ（何でもスルーパスにしない）
        const lead = (through ? 1.0 : 0.35) * clamp(0.7 + p.vision * 0.005, 0.8, 1);   /* v740 判断：走る味方の先へ出せるか（低いと足元の後ろへ） */
        let px = q.x + q.vx * lead + (through ? sgn(p.team) * 3.5 : 0), py = q.y + q.vy * lead;
        if (otR) [px, py] = otSpot(p, q);
        if (q.uniq === 'aonoouza' && !through && !(q.uOn > S.t) && !(q.uCd > S.t) && fx(p.team, q.x) > 55 && fx(p.team, q.x) > xf + 10) { const dd = Math.min(5.5, (fx(p.team, q.x) - xf) * 0.3); px = fx(p.team, Math.max(fx(p.team, q.x) - dd, L / 2 + 4)); py = q.y + (p.y - q.y) * 0.15; }   // くもいが落ちてきて受ける所で、パスの危なさを見る
        const d = hyp(px - p.x, py - p.y);
        if (d < 5 || d > (p.uniq === 'byakuya' ? 80 : 48)) continue;
        let danger = 0;
        for (const o of opps(p)) {
          const sd = segDist(o.x, o.y, p.x, p.y, px, py);
          // 相手がパスコースに届くか（ボールの速さ・相手の足を考慮。うまい選手ほど正確に読む）
          const pv = passAvgV(p, d), tAt = (d * sd.u) / pv;
          const reach = (1.3 + maxSpeed(o) * Math.max(0, tAt - 0.25) * 0.9) * (p.vision >= 80 ? 1.25 : 1);   // Sクラスは相手の足の届く範囲を広めに見て、危ないコースを避ける
          if (sd.d < reach) danger += (reach - sd.d) / reach;
          // 目の前で寄せている相手の足：出だしのコースに体があると、蹴った瞬間に当たる
          else if (sd.u < 0.3 && sd.d < 2.4 && hyp(o.x - p.x, o.y - p.y) < 3.5) danger += 0.5 * (2.4 - sd.d) / 2.4 + 0.15;
          // 走っている相手は、その勢いのままコースに入ってくる（寄せてくる相手の進む先も見る）
          if (hyp(o.vx, o.vy) > 2) { const t2 = Math.min(1.2, tAt + 0.1), sd2 = segDist(o.x + o.vx * t2, o.y + o.vy * t2, p.x, p.y, px, py); if (sd2.d < 1.1 && sd2.d < sd.d) danger += 0.7 * (1.1 - sd2.d) / 1.1; }
        }
        if (otR && S.t - S.oneTwo.t < 2.2) danger *= 0.45;   // ワンツーのリターン：ダイレクトで裏へはたくので、相手の足は間に合いにくい
        const recvOpp = nearestOpp(q, px, py).d;
        const pxf = fx(p.team, px);
        const qOff = fx(p.team, q.x) > offL + 0.3 && fx(p.team, q.x) > xf && fx(p.team, q.x) > L / 2;
        // 危なさの見積もり：うまい選手ほど正確、下手だと危ないパスを出してしまう
        danger = Math.max(0, danger * (1 + R.gauss() * (1 - p.vision / 100) * 1.3));
        const qOffNow = fx(p.team, q.x) > offL - 0.4;
        const needle = hrReady && !q.gk && !qOffNow && fx(p.team, q.x) > L - 42 && pxf > L - 36 && pxf > xf + 3 && (through || pxf > L - 30) && danger < 2.6;   /* 受け手がゴール前（ラインの近く）にいる時だけ：受けたら1点の位置へ */   // 受け手がオフサイドの位置にいる時は出さない（出す瞬間にオンサイド）   // すき間の1本：相手の足が届きそうなコースでも通せる
        if (needle) danger *= 0.12;
        if (q.uniq === 'aonoouza' && !through && !(q.uOn > S.t) && !(q.uCd > S.t) && !q.off && fx(p.team, q.x) > 55 && fx(p.team, q.x) > xf + 10 && d < 34) danger *= 0.5;   // 蒼の王座：くもいへの縦パスは、くもいが体を入れて収める（通りやすい）
        if (p.uniq && p.uOn > S.t) danger *= { byakuya: 0.55, aonoouza: 0.7 }[p.uniq] || 1;
        if (uOn(p, 'aonoouza') && (q.aoRun || 0) > S.t) danger *= 0.35;   // 蒼の王座：穴へ走り込む味方への1本は、すき間を通せる
        // うまい選手ほど危ないパスを嫌い、確実につなぐ（Sクラスのビルドアップ）
        const care = 1.35 + Math.max(0, p.vision - 50) / 38, careS = 1 + Math.max(0, p.vision - 50) / CARE_S;
        let v = 0.6 + (pxf - xf) * (1 - 0.45 * PAT) * (0.06 + Math.max(0, p.vision - 50) * 0.0009 + (S.counter > 0 ? 0.04 : 0) + DOM[p.team] * 0.06 + vert) + Math.min(recvOpp, 9) * 0.13 * careS - danger * 2.4 * care * (1 + 0.5 * PAT) * (1 - DOM[p.team] * 0.6) * (isPasser ? 0.85 : 1) - (d > 30 ? 0.5 : 0);
        if (pxf > L - 18 && Math.abs(py - GOAL_Y) < 20) v += 0.5;
        if (S.dribbleMode === 'carry' && p.carryFW === q.idx && danger < 0.5) v += 0.45;   // 運びながら意識していた前のFWへ、コースが空いた瞬間に縦パス
        if (tm.tac.side) v += Math.abs(py - GOAL_Y) > 14 ? tm.tac.side * 0.3 : -tm.tac.side * 0.15;
        // サイドの深い位置からはゴール前へクロス
        if (xf > L - 36 && Math.abs(p.y - GOAL_Y) > 12 && pxf > L - 18 && Math.abs(py - GOAL_Y) < 12) v += 1.9 + (skZ(q, 'nearRun') || skZ(q, 'farWait') ? 0.7 : 0) + (q.type === 'ストライカー' && q.position === 'FW' ? 0.6 : 0);
        if (skZ(p, 'postPlay') && pressure >= 1 && d < 16 && danger < 0.3 && fx(p.team, q.x) > xf - 8) v += 0.8;   // ポストプレー：背負って、上がってきた味方へ落とす
        if (q.dcUntil > S.t) v -= 2.2;
        if ((q.stDg || 0) > S.t && through) v += 2.0;
        if (p.type === 'レジスタ' && Math.abs(py - p.y) > 20 && d > 24 && danger < 1.2) v += 1.3;   // 版797：レジスタ：逆サイドへ大きく振る
        // 版799：ゲームメイカー：シャビとデブライネを兼ねる。中盤・自陣ではシャビ（取られないパスで少しずつ前へ）、相手陣の深い所（ゴールまで40m）ではデブライネ（走っている味方へ決定的な1本）
        if (p.type === 'ゲームメイカー' && xf < L - 40) { if (danger < 0.5) v += 0.5 + (pxf > xf + 3 ? 0.6 : 0); if (danger > 1.2) v -= 0.8; }
        if (p.type === 'ゲームメイカー' && xf >= L - 40 && (through || ((q.run || 0) > 0 && fx(p.team, q.x) > xf) || (q.gmRun || 0) > S.t)) v += 1.3 + (S.t - (p.gmT ?? -9) < 2.5 ? 0.3 : 0);
        if (p.type === 'パサー' && xf > L - 45 && (through || ((q.run || 0) > 0 && fx(p.team, q.x) > xf))) v += 1.3;   // 版798：パサー（デブライネ）：前を向いたら、走っている味方へ決定的な1本
        if (p.type === 'パサー' && xf > L - 40 && Math.abs(p.y - GOAL_Y) > 6 && pxf > L - 14 && Math.abs(py - GOAL_Y) < 9) v += 1.5;   // 版798：パサー：ハーフスペースから、GKとDFの間へ速いクロス
        if ((q.shRun || 0) > S.t && through) v += 1.4;   // 版797：シャドーの飛び込みへ
        if ((q.ovUntil || 0) > S.t && pxf > xf && danger < 1.2) { v += 1.4; if (globalThis.__tyDbg) globalThis.__tyDbg.ovPassV = (globalThis.__tyDbg.ovPassV || 0) + 1; }   // 版837：追い越した味方へ
        if (!globalThis.__noPullB && (q.stPullT || 0) > S.t) { v += 1.0; if (globalThis.__tyDbg) globalThis.__tyDbg.pullV = (globalThis.__tyDbg.pullV || 0) + 1; }   // 版796：プルアウェイで離れたストライカーの足元へ   // 版795：ストライカーの斜めの抜け出しへ、スルーパス
        if ((q.f9Run || 0) > S.t && p.type === '偽9番') v += 1.6 + (through ? 0.4 : 0);   // 版795：偽9番が下りて引きつけ、走り込んだ味方へ
        else if (q.position === 'FW' && mates(q).some((m) => m !== q && m.dcUntil > S.t)) v += 0.9;   // 版794：囮が引きつけている間は、空いた相棒のFWへ   // 版794：囮の走りをしているFWには出さない（引きつけた分、ほかへ）
        if (skZ(q, 'behindRun') && through) v += 1.3 + (q.run > 0 ? 0.6 : 0);   // 版789：裏へ抜け出した選手へ、スルーパスを出しやすい
        if (tm.ovl && tm.ovl.until > S.t && xf > L - 44 && !(xf > L - 22 && Math.abs(p.y - GOAL_Y) < 14) && d < 16 && danger < 1.0 && !qOff && (tm.ovl.ids.includes(q.idx) || tm.ovl.ids.includes(p.idx))) v += 0.6 + Math.max(0, p.technique - 50) / 100;   // 版843：崩しの局面：寄ってきた味方と短くつなぐ
        if (q.type === 'ストライカー' && q.position === 'FW' && !qOff && fx(p.team, q.x) > L - 26 && Math.abs(q.y - GOAL_Y) < 14 && recvOpp > 2 && danger < 1.0 && !(p.type === 'ストライカー')) v += 0.8 + Math.max(0, q.kick - 50) / 60;   // 版846：打てる所にいるストライカーへ預ける（点取り屋に打たせる）
        let b842 = 0; if ((q.pgRun || 0) > S.t && q.run > 0 && pxf > xf + 2 && !qOff) { const tmB = p.tmFor && p.tmFor.i === q.idx && S.t - p.tmFor.t < 3 && danger < 0.8 ? 0.8 + Math.max(0, p.vision - 50) / 50 : 0; v += 1.5 + (through ? 0.5 : 0) + tmB; b842 = tmB + ((q.ctRun || 0) > S.t ? 1.5 : 0); }   // 版842：3人目：自分が受けた時に走り出した味方へ（判断が高いほど見逃さない）   // パス＆ゴー・3人目の動き：走り直した味方へ
        if (through) v += 0.9 + (tm.mods.through + tm.tac.through) / 50 + Math.max(0, p.vision - 55) / 30;   // 版840：スルーパスの上乗せを下げた（1.6→0.9）
        if (isPasser && through) v += 0.7 + (pxf > L - 32 ? 0.35 : 0);   // パサー：決定的なパスを狙う
        if (needle) v += 1.5 + (pxf > L - 30 ? 1.0 : 0);   // 針の穴通し：決定的な1本を狙う
        // 固有スキルで選びやすくなるパス
        if (p.uniq && p.uOn > S.t) {
          if (p.uniq === 'byakuya' && d > 22) v += 1.2 * uP(p);                     // 白夜の視界：遠くの味方へ
          if (p.uniq === 'aonoouza' && (through || pxf > xf + 8)) v += 1.0 * uP(p); // 蒼の王座：縦パス・スルーパス
          if (p.uniq === 'minato' && pxf > xf + 4) v += 0.35;
          if (q.uniq === 'minato' && !q.off && !(q.uOn > S.t) && !(q.uCd > S.t) && danger < 0.6 && fx(q.team, q.x) > 25) v += 0.9;   /* 版467：港の指揮者を出すため、味方はおおかわに預ける */
        }
        if ((p.uTetsu || 0) > S.t && pxf > xf + 6) v += 1.0;
        if (q.uniq === 'kage' && !(q.uCd > S.t) && !q.off && pxf > L / 2 + 2 && pxf < L - 14 && pxf > xf - 4 && danger < 0.9 && mates(p).some((m) => m !== q && m !== p && !m.off && m.position === 'FW' && fx(p.team, m.x) > pxf + 2)) v += 1.8;   // 影の一刺し：FWの後ろにいるかめいへ、まず預ける                        // 鉄狼の関所：奪ったらすぐ前へ
        if (!globalThis.__ksNoPass && uOn(q, 'kinshachi') && q.ksMode === 'atk' && danger < 0.6 && recvOpp > 2.2 && pxf > xf - 8) v += 1.6 + (pressure >= 1 ? 0.6 : 0) + (pxf > xf + 3 ? 0.4 : 0);   // 寄せられたら、サポートに来たダイナモへ預ける
        if (!globalThis.__ksNoPass && p.uniq === 'kinshachi' && pxf > xf - 4 && (q.position === 'FW' || (q.kick + q.technique) / 2 >= 78)) v += 0.9 + (pxf > L - 32 ? 0.6 : 0);   // ダイナモ：自分で決めに行くより、決定力のある味方へつなぐ                                               // 影からの一撃：飛び込んでくる味方へ
        if (uOn(q, 'tsukikage') && through) v += 0.8;
        if (uOn(p, 'aonoouza') && (q.aoRun || 0) > S.t && q.run > 0 && !qOff && pxf > xf + 4) v += 2.2 + (through ? 0.8 : 0);   // 蒼の王座：釣り出して空けた穴へ走り込む味方へ、縦パス・スルーパス
        if ((q.uzT || 0) > S.t && teamU(p.team, 'uzushio') && !qOff && danger < 0.8) v += 1.5;   // 渦潮の囮で空いた手前で受ける2列目の味方へ
        if (q.uniq === 'uzushio' && !p.gk) { const one = !opps(q).some((o) => !o.gk && !o.off && fx(q.team, o.x) > fx(q.team, q.x) - 1 && hyp(o.x - q.x, o.y - q.y) < 7); if ((!one || qOff) && uOn(q, 'uzushio')) v -= 3; }   // 渦潮の囮：走っている間は、てらだにはほとんど出さない（完全に1対1の時だけ）
        if (q.uniq === 'aonoouza' && !(q.uCd > S.t) && !(q.uOn > S.t) && !q.off && fx(p.team, q.x) > 55 && fx(p.team, q.x) > xf + 10 && d < 34 && !through && danger < 0.9) v += 2.4;   // 蒼の王座：CBに張りついたくもいへ、縦パスを入れる（落ちてきて受ける）
        if (q.uniq === 'byakuya' && !(q.uCd > S.t) && !q.off && fx(p.team, q.x) < 60 && danger < 0.5 && recvOpp > 3 && pxf > xf - 25) v += 0.8;   // 白夜の視界：レジスタが空いていれば、まず預けて、そこからロングフィード
        if (q.uniq === 'midori' && !q.off && (T[q.team].mdStack || 0) < 4 && fx(q.team, q.x) < 72 && danger < 1.0) v += 4.5 + (S.t > 150 ? 1.5 : 0);   /* 版468：4回たまるまでは、チームで積極的にむらおかへ通す（後半はさらに） */
        else if (q.uniq === 'midori' && !(q.uCd > S.t) && !q.off && !p.gk && pxf < 46 && danger < 0.6 && opps(q).some((o) => !o.off && !o.gk && hyp(o.x - q.x, o.y - q.y) < 26 && fx(q.team, o.x) > pxf - 3)) v += 1.8;
        if (q.uniq === 'midori' && !q.off && p.gk && (T[q.team].mdStack || 0) < 4 && danger < 0.5) v += 2.0;   // GKからも   /* 版448 翠の起点：自陣では、まずむらおかに預ける（そこから誘い込む） */
        if (q.uniq === 'guren' && pxf > L - 45 && danger < 0.5) v += 2.0;
        else if (aceFw(p.team) === q && !qOffNow && pxf > L - 40 && danger < 0.5) v += 1.2;   /* 版444：どのチームも、ゴール前では点取り屋（エースFW）に集める */
        if (p.uniq === 'kage' && aceFw(p.team, p) === q && !qOffNow && pxf > xf + 1 && pxf > L - 40 && danger < 0.8) v += 1.6 + (through ? 0.6 : 0);   /* 版444：シャドーは相棒の点取り屋へラストパス */   // 屈指の点取り屋：ゴール前ではエースに預ける
        if (q.vsFocus) v += 3;
        if (uOn(p, 'shiden') && S.t - (p.sdBeat || -9) < 1.5 && pxf > xf + 2 && pxf > L - 30 && danger < 0.9) v += 1.4;   // 紫電の遊戯：抜いた直後、前の味方へ決定的なパス
        if (opps(q).some((o) => o.kgT === q.idx && uOn(o, 'kagenui') && hyp(o.x - q.x, o.y - q.y) < 3.5)) v -= 3.5;   // 影縫い：影のように張りつかれている味方には、パスを出せない   // 確認画面「選手の対決」：注目の攻めの選手にボールを集める（対決の場面を増やす）
        if (pxf < xf - 12) v -= pressure >= 1 ? 0.1 : 0.6;   // 寄せられていれば下げてやり直すのも良い選択
        if (tm.urg && pxf < xf - 3) v -= pressure >= 2 ? 0.3 : 1.0;   // 追いかける時間帯：後ろへ戻さず前へ
        // 相手のバイタルエリアでは「縦→横→後ろ」。意味のないバックパスはしない
        const vital = xf > L - 38;
        if (vital && pxf < xf - 3) v -= pressure >= 2 ? 0.5 : 1.5;
        // 前が空いているのに横・後ろへ回さない（判断力が低い選手でも、ここは分かる）
        if (frontSpace >= 5 && pressure <= 1 && xf > L / 2 - 15) { const k0 = 1 - 0.55 * PAT; if (pxf < xf - 3) v -= 2.2 * k0; else if (pxf < xf + 3) v -= 1.4 * k0; else if (!through) v -= 0.4 * k0; }
        // 版840：つなぐサッカー（チームのつなぐ力 PAT）。前が詰まっている・寄せられている時は、空いている横・後ろの味方へつないでやり直す
        { const P = PAT, safe = danger < 0.25 && recvOpp > 4.5;
          if (P > 0 && safe && pxf <= xf + 3) v += P * (frontSpace < 5 || pressure >= 1 ? 1.1 : 0.45) * (vital ? 0.6 : 1);
          if (P > 0 && safe && pxf < xf - 3 && xf < L / 2 + 12) v += P * 0.7;   // 組み立て：CB・GKへ戻してやり直す
          if (P > 0 && Math.abs(py - p.y) > 22 && recvOpp > 7 && danger < 0.4) v += P * 1.0;   // 逆サイドへ大きく展開
          if (P > 0 && xf > L - 36 && d < 14 && danger < 0.4 && pxf > xf - 8) v += P * 0.55;   // ゴール前の短いつなぎ（ワンツー・3人目）
          if (S.t - (p.beatT ?? -9) < 1.6 && danger < 0.6 && !(p.uniq && p.uOn > S.t)) v += 0.8; }   // 1人引きつけて抜いたら、空いた味方へはたく
        if (pxf > xf + 3) v += 0.02 * Math.min(20, pxf - xf);   // 前へのパスは、だれでも少し評価する
        if (S.counter > 0 && S.poss === p.team && pxf > xf + 4 && danger < 0.7 && !qOff) v += 0.9 + (q.run > 0 || fx(p.team, q.x) > xf + 8 ? 0.5 : 0);   // 版841：カウンター：前を走る味方へ、速く
        // ワンツー：さっき預けてくれた味方が前へ走り込んでいたら、すぐ返す
        const pair = (S.passHist || []).filter((h) => S.t - h.t < 14 && ((h.a === p.idx && h.b === q.idx) || (h.a === q.idx && h.b === p.idx))).length;
        if (otR && S.t - S.oneTwo.t < 4 && pair < 3) v += 1.6 + (p.pass + p.vision) / 70;
        // 前をふさがれたら、近くの味方に当てて自分は裏へ（ワンツーの1本目）
        if (!otR && !through && xf > L - 48 && d > 5 && d < 15 && pxf > xf - 4 && frontSpace < 5 && danger < 0.4 && pair < 2) v += 0.5 + (p.pass + p.vision) / 300 + (skZ(p, 'oneTwo') || skZ(p, 'wallPass') ? 0.6 : 0);
        // 同じ相手と2往復したら、もうその人には返さず逆サイドへ散らす
        if (pair >= 3) v -= 3;
        else if (recentPair >= 3 && Math.abs(q.y - p.y) > 18) v += 1.2;
        let w = Math.exp(v * 1.5);
        if (qOff) w *= through ? 0.3 : 0.04;
        // うまい選手は「通らない」と読めるパスはそもそも出さない
        if (danger > (otR ? 0.45 : p.vision >= 80 ? 0.22 : 0.35) && R.next() < (p.vision - 40) / (p.vision >= 80 ? 45 : 60)) w *= p.vision >= 80 ? 0.01 : 0.03;   // Sクラスは「通らない」パスをまず出さない
        opts.push({ kind: 'pass', q, through, w, danger, d, dv: v, qOff, otR, needle });
        { const ps = passSkill(q, pxf, py, d, danger);
          if (ps) { const th = ps.through ?? through, dv = 0; opts.push({ kind: 'pass', q, through: th, chip: ps.chip, skill: ps.k, needle, danger, d, w: Math.exp((v + ps.bonus + dv) * 1.5) * (qOff ? (th ? 0.3 : 0.04) : 1) }); } }
        // 相手の頭越しに、ふわっと浮かせるパス
        if (danger > 0.6 && d > 9 && d < 32) opts.push({ kind: 'pass', q, through, chip: true, w: Math.exp((v - b842 + danger * 1.3 - 0.9) * 1.5) * (qOff ? 0.1 : 1) * (0.5 + p.pass / 100) });
      }

      // ドリブル
      const dir = [fx(p.team, L) - p.x, GOAL_Y - p.y];
      const dl = hyp(dir[0], dir[1]) || 1;
      dir[0] /= dl; dir[1] /= dl;
      let space = 9;
      for (const q of opps(p)) {
        const rx = q.x - p.x, ry = q.y - p.y, dd = hyp(rx, ry);
        if (dd > 9) continue;
        const cos = (rx * dir[0] + ry * dir[1]) / (dd || 1);
        if (cos > 0.45) space = Math.min(space, dd);
      }
      if (!p.gk && !S.setPiece) {
        let w = Math.exp((space - 3.5) * 0.5) * (0.6 + p.dribble / 120 + p.dash / 160) * (1 + DOM[p.team] * 2.5);
        if (pressure >= 2) w *= 0.35 + DOM[p.team] * 0.6;
        // 空いている側へ少し曲げる
        let bend = 0;
        for (const q of opps(p)) { const dd = hyp(q.x - p.x, q.y - p.y); if (dd < 7) bend += (p.y - q.y) / (dd * dd + 1); }
        let dy2 = dir[1] + clamp(bend * 3, -0.9, 0.9);
        if ((p.y < 4 && dy2 < 0) || (p.y > W - 4 && dy2 > 0)) dy2 = -dy2 * 0.3;   // タッチライン際では外へ向かわない
        // ゴール前（約28m以内）で外へ流れると、自分でシュートの角度を消してしまう。コントロールショットを持たない選手は、外へは流れずゴールへ向かう
        if (xf > L - 28 && !skZ(p, 'controlShot') && Math.abs(p.y - GOAL_Y) > 4 && Math.sign(dy2) === Math.sign(p.y - GOAL_Y)) dy2 = Math.sign(dy2) * Math.min(Math.abs(dy2) * 0.25, Math.abs(dir[1]) * 0.3) + (GOAL_Y - p.y) / (Math.abs(p.y - GOAL_Y) || 1) * 0.15;
        // 相手のバイタルエリアで前が空いていれば、どんどん仕掛ける
        if (xf > L - 38 && space > 4) w *= 1.8;
        if (S.counter > 0 && S.poss === p.team && space >= 5 && pressure <= 1 && xf < L - 22) w *= 1.5 + p.dash / 100 + p.dribble / 200;   // 版843：足の速い・ドリブルのうまい選手ほど、長く運ぶ   // 版842：カウンター：前が空いていれば、持った選手も運んで一気に前へ
        w *= 1 - 0.35 * PAT;   // 版840：つなぐチームほど、まずパス（ドリブルは空いた時・相手を引きつける時）
        if (S.t - (p.beatT ?? -9) < 1.6 && !(p.uniq && p.uOn > S.t) && !(xf > L - 22 && space > 7)) w *= 0.4;   // 版840：1人抜いたら、続けて何人も抜きにいかず、はたく（固有スキルの間は別）
        else if (xf > L / 2 - 15 && space >= 5 && pressure <= 1) w *= (pressure ? 2.2 : 3.6) * (1 - 0.45 * PAT);   // 版840：つなぐチームは、むやみに運ばない   // 前が空いている：横パスより、まず縦に運ぶ
        // ドリブルは2種類
        //  突破のドリブル：前へ速く・ボールを大きく押し出す・緩急で抜く（前が空いている時、相手陣、高速ドリブル・カットインを持つ選手）
        //  運ぶドリブル　：ボールを足元から離さず、360°どこへでも動いてキープ（囲まれている・前に相手・自陣）
        if (p.type === 'ファンタジスタ') w *= xf > L / 2 - 5 && pressure >= 1 ? 2.8 : 1.6;   // ファンタジスタは自分で仕掛ける（版797：相手陣の狭い所では、1人かわしにいく）
        if (p.uniq === 'shiden') w *= 1.5;   // 紫電の遊戯（かまた）：遊び心。いつでもドリブルで仕掛ける
        const brk = w * (skZ(p, 'speedDribble') || skZ(p, 'cutIn') ? 1.4 : 1) * (space >= 5 ? 1.15 : 0.9);
        { const zb = zr(p, 'break'); if (zb > 0) opts.push({ kind: 'dribble', mode: 'break', w: brk * (zb === 2 ? 1.8 : 1), dir: [dir[0], dy2] });   // 突破のドリブル：使わないエリアでは、前へは「運ぶ」だけ
          else if (zr(p, 'carry') > 0) opts.push({ kind: 'dribble', mode: 'carry', w: brk * 0.5, dir: [dir[0], dy2] }); }
        let ax = 0, ay = 0;   // 寄せてくる相手（9m以内）がいれば、運ぶドリブルも候補に
        for (const q of opps(p)) { const rx = p.x - q.x, ry = p.y - q.y, dd = hyp(rx, ry); if (dd < 9) { ax += rx / (dd * dd + 0.5); ay += ry / (dd * dd + 0.5); } }
        const al = hyp(ax, ay);
        if (al > 0.02) {
          const [cx, cy] = carryDir(p);
          const cw = (0.45 + p.dribble / 140 + p.technique / 200) * (pressure >= 1 ? 1.5 : space < 4 ? 0.6 : 0.25) * (xf < L / 2 ? 1.25 : xf > L - 35 ? 0.35 : 0.75) * (1 + DOM[p.team] * 1.5);   // ゴール前では運ぶより仕掛ける
          if (zr(p, 'carry') > 0) opts.push({ kind: 'dribble', mode: 'carry', w: cw * (zr(p, 'carry') === 2 ? 1.6 : 1), dir: [cx, cy] });
        }
      }

      // 自陣で囲まれたらクリア
      if (((xf < 30 && pressure >= 1) || p.gk) && !(S.setPiece && !p.gk)) {
        opts.push({ kind: 'clear', w: p.gk ? 0.6 : 0.9 + pressure * 0.5 });
      }

      // 選ぶ（うまい選手ほど良い選択に寄る）
      // 判断力：高いほど一番良い選択にはっきり寄る。低いと見誤る（重みにブレが入る）
      const sharp = 0.3 + p.vision / 40;   // E（40）1.3／C（65）1.9／S（90）2.55：低いと良し悪しの差が見えず、色々なプレーを選んでしまう
      let sum = 0;
      let sdCtx = null;
      if (uOn(p, 'shiden')) for (const o of opts) {   // 紫電の遊戯：発動したら、ゴール前まで1人で運ぶ。パスは、ゴール前でフリーの味方への決定的な1本だけ。打てる所まで来たら打つ
        // GKとの距離を、詰められるだけ詰めてから打つ（前が空いている間は運ぶ。GKが出てきた・前をふさがれた・ゴール目の前、で打つ）
        const inRange = dGoal < 21;
        if (sdCtx === null) { const gq = opps(p).find((q) => q.gk); let spF = 9;
          for (const q of opps(p)) { if (q.gk) continue; const rx = q.x - p.x, ry = q.y - p.y, dd = hyp(rx, ry); if (dd < 9 && (rx * dir[0] + ry * dir[1]) / (dd || 1) > 0.45) spF = Math.min(spF, dd); }
          const gkD = gq ? hyp(gq.x - p.x, gq.y - p.y) : 99;
          sdCtx = { shootNow: dGoal < 9 || gkD < 4.2 || (inRange && spF < 2.2), carry: dGoal < 26 && spF >= 2.2, spF, gkD }; }
        const { shootNow, carry } = sdCtx;
        if (o.kind === 'dribble') o.w *= shootNow ? 0.15 : carry ? (o.mode === 'break' ? 5 : 1.2) : o.mode === 'break' ? 4 : 1.5;
        else if (o.kind === 'pass') { const qd = o.q ? hyp(L - fx(p.team, o.q.x), GOAL_Y - o.q.y) : 99; o.w *= inRange && (o.danger ?? 1) < 0.45 && qd < dGoal - (carry && !shootNow ? 6 : 2) ? 2.2 : xf > L - 17 && (o.danger ?? 1) < 0.35 && o.q && fx(p.team, o.q.x) > xf - 2 ? 1 : 0.015; }
        else if (o.kind === 'shot') o.w *= shootNow ? 4 : carry ? 0.06 : dGoal < 17 ? 3 : dGoal < 21 ? 1.6 : dGoal < 25 ? 0.4 : 0.1;
        else o.w *= 0.2;
      }
      { const c = condLv(p.team) || (p.uniq === 'minato' && !(p.uCd > S.t) && !(p.cdRem > 0) && !S.setPiece && xf > 22 ? (p.uniqLv >= 2 ? 2 : 1) : 0);   // 合図の1本（おおかわ）も、ショートパスから
        if (c && !p.gk && !uOn(p, 'shiden') && dGoal > 25) for (const o of opts) {   // 港の指揮者：テンポよくつなぐ（空いた味方へ。囲まれる前に離す）
          if (o.kind === 'pass') {   // 基本はショートパスでつなぐ。ロングボールは「この1本でGKと1対1」の時だけ
            const dd = o.d ?? (o.q ? hyp(o.q.x - p.x, o.q.y - p.y) : 30);
            if (dd > 22) { const qf = o.q ? fx(p.team, o.q.x) : 0, ol = offsideLine(p.team);
              const oneOnOne = o.q && o.through && qf > ol - 3 && qf < ol - 0.3 && !opps(p).some((r) => !r.gk && !r.off && fx(p.team, r.x) > qf + 1 && Math.abs(r.y - o.q.y) < 12);
              o.w *= oneOnOne ? 4 : 0.04; }
            else if ((o.danger ?? 1) < 0.45) { const g = o.q ? fx(p.team, o.q.x) - xf : 0; o.w *= (g > 5 ? 3.5 : g > -2 ? 0.8 : 0.2) * (o.through ? 1.6 : 1) * (dd < 18 ? 1.4 : 1) * (c >= 2 ? 2.6 : 2.2); } }   /* 前へ前へ：12秒でゴール前まで */
          else if (o.kind === 'dribble' && space < 5) o.w *= 0.55; }
        if (c && !p.gk && dGoal > 21) for (const o of opts) if (o.kind === 'shot') o.w *= 0.03;   // 指揮の間は、遠くから打たずにゴール前まで運ぶ
        if (condLv(p.team) && !p.gk && !uOn(p, 'shiden') && dGoal > 22 && opts.some((o) => o.kind === 'pass' && (o.danger ?? 1) < 0.9)) for (const o of opts) if (o.kind === 'dribble') o.w *= 0.005; }   // 指揮の間はドリブルしない：持たずにはたく   // ダイレクトで受けたら、持たずにそのままはたく
      // 版847：ゴール前（約35m）で相手に囲まれたら（5m以内に2人以上）、1人で抜きにいかず、近くの味方と速くつなぐ（ワンツー・落とし）。ドリブルの名手・固有スキルの間は別
      if (!p.gk && !S.setPiece && xf > L - 35 && !(p.uniq && p.uOn > S.t)) {
        const nOpp = opps(p).filter((q) => !q.off && !q.gk && hyp(q.x - p.x, q.y - p.y) < 5).length;
        const shortOK = opts.some((o) => o.kind === 'pass' && o.q && (o.d ?? 99) < 16 && (o.danger ?? 1) < 1.2);
        if (nOpp >= 2 && shortOK) { const k = p.dribble >= 85 || p.type === 'ファンタジスタ' ? 0.55 : 0.22; for (const o of opts) { if (o.kind === 'dribble') o.w *= k; else if (o.kind === 'pass' && o.q && (o.d ?? 99) < 16 && (o.danger ?? 1) < 1.2) o.w *= 1.6; } if (globalThis.__qk) globalThis.__qk.crowd++; }
      }
      for (const o of opts) o.w *= Math.exp(R.gauss() * (1 - p.vision / 100) * 0.9);   /* v740 判断：低いと、パス・ドリブル・シュートのどれが良いかを見誤る */
      for (const o of opts) o.ww = Math.pow(Math.max(o.w, 1e-6), sharp);
      // 港の指揮者：指揮の間は「前へ運ぶ」。①前へ通るショートパス（ダイレクト）②前が空いていれば、パスコースを作るための運ぶドリブル ③どちらも無い時だけ、横・後ろへつないでやり直す
      //   ゴール前（約30m）で前が空いていたら、もうつながない：運んでシュート
      if (condLv(p.team) && !p.gk && !uOn(p, 'shiden') && !(p.hariT > S.t) && dGoal < 34) {
        const mx = Math.max(...opts.map((o) => o.ww)), gOf = (o) => (o.q ? fx(p.team, o.q.x) - xf : -99), top = (list, sc) => list.reduce((a, o) => (sc(o) > sc(a) ? o : a)), olC = offsideLine(p.team), onS = (o) => o.q && fx(p.team, o.q.x) < olC - 0.3;
        const gq = opps(p).find((q) => q.gk); let spF = 9; for (const q of opps(p)) { if (q.gk) continue; const rx = q.x - p.x, ry = q.y - p.y, dd = hyp(rx, ry); if (dd < 9 && (rx * dir[0] + ry * dir[1]) / (dd || 1) > 0.45) spF = Math.min(spF, dd); }
        const gkD = gq ? hyp(gq.x - p.x, gq.y - p.y) : 99, shots = opts.filter((o) => o.kind === 'shot'), drbs = opts.filter((o) => o.kind === 'dribble');
        let best = null;
        const inBox = L - xf < 13.5 && Math.abs(p.y - GOAL_Y) < 16;   // ペナルティエリアにしっかり入った
        if (shots.length && (inBox || gkD < 4.5 || (dGoal < 24 && spF < 2.0))) best = top(shots, (o) => o.ww);   // 打てる所まで来た（少しでもスペースがあれば、もっと近づく。ミドルは前をふさがれた時）
        else if (spF >= 2 && drbs.length) { best = top(drbs, (o) => (o.mode === 'break' ? 1 : 0) + (o.dir ? (o.dir[0] * dir[0] + o.dir[1] * dir[1]) : 0)); S.oneTouch = false; }   // 前が空いている：ゴールへ運ぶ
        if (best) { best.ww = Math.max(best.ww, mx * 3); for (const o of opts) if (o !== best && !(o.kind === 'pass' && o.through && onS(o) && gOf(o) > 6 && (o.danger ?? 1) < 0.4)) o.ww = Math.min(o.ww, best.ww * 0.03); } }
      if (condLv(p.team) && !p.gk && !uOn(p, 'shiden') && dGoal >= 34 && !(p.hariT > S.t)) {
        const mx = Math.max(...opts.map((o) => o.ww)), gOf = (o) => (o.q ? fx(p.team, o.q.x) - xf : -99), olC = offsideLine(p.team), onS = (o) => o.q && fx(p.team, o.q.x) < olC - 0.3;   // オフサイドの位置にいる味方には出さない
        const fwd = opts.filter((o) => o.kind === 'pass' && onS(o) && (o.danger ?? 1) < 0.7 && (o.d ?? 30) <= 24 && gOf(o) >= 2);
        const drb = opts.filter((o) => o.kind === 'dribble'), carried = S.t - (p.recvT || S.t);
        const top = (list, sc) => list.reduce((a, o) => (sc(o) > sc(a) ? o : a));
        let best = null;
        if (fwd.length) best = top(fwd, (o) => gOf(o) * 0.25 - (o.danger ?? 1) * 2 + (o.through ? 0.8 : 0) + R.next() * 0.3);
        else if (drb.length && (space >= 7 || (space >= 4 && carried < 2.5))) { best = top(drb, (o) => (o.mode === 'break' ? 1 : 0) + (o.dir ? (o.dir[0] * dir[0] + o.dir[1] * dir[1]) : 0)); S.oneTouch = false; }   // 前が大きく空いている：少しだけ運んで相手を引きつけ、次のパスコースを作る（長くは持たない）
        else { const side = opts.filter((o) => o.kind === 'pass' && onS(o) && (o.danger ?? 1) < 0.55 && (o.d ?? 30) <= 22); if (side.length) best = top(side, (o) => gOf(o) * 0.15 - (o.danger ?? 1) * 2.5 + R.next() * 0.3); }
        if (best) { best.ww = Math.max(best.ww, mx * 3); for (const o of opts) if (o !== best && o.kind !== 'shot') o.ww = Math.min(o.ww, best.ww * 0.03); } }
      if (condLv(p.team) && !p.gk) { const olC = offsideLine(p.team); for (const o of opts) if (o.kind === 'pass' && o.q && fx(p.team, o.q.x) > olC - 0.3) o.ww = 1e-30; }   // 港の指揮者：オフサイドの位置の味方には出さない
      // 蒼の王座：受けたら背中でキープ（ポストプレー）。抜け出している味方（呼んだ2人に限らず、裏へ走っている・走れる味方）がオフサイドぎりぎりまで来たら、DFラインの裏へスルーパス。もう来ていればダイレクトで
      // 蒼の王座：基本はパス。ただしゴール前（25m以内）で、自分の前に相手がいない（フリー）なら、自分で運んで打つ
      const clrShot = !p.gk && dGoal < 13.5 && !opps(p).some((o) => !o.gk && !o.off && !(o.downT > 0) && segDist(o.x, o.y, p.x, p.y, fx(p.team, L), GOAL_Y).d < 1.1 && segDist(o.x, o.y, p.x, p.y, fx(p.team, L), GOAL_Y).u > 0.03);   // PKマークより前で、コースに相手がいない
      const aoFree = uOn(p, 'aonoouza') && !p.gk && !S.setPiece && dGoal < 25 && !opps(p).some((o) => { if (o.gk || o.off) return false; const rx = (o.x - p.x) * sgn(p.team), ry = o.y - p.y, dd = hyp(rx, ry); return dd < 9 && rx > 0 && Math.abs(ry) < rx * 0.9 + 1.5; });
      if (aoFree) { p.finT = Math.max(p.finT || 0, S.t + 2); act(p, 'aopostend', 0.1); const mx = Math.max(...opts.map((o) => o.ww)), sh = opts.filter((o) => o.kind === 'shot'), br = opts.filter((o) => o.kind === 'dribble' && o.mode === 'break'); const top = dGoal < 17 && sh.length ? sh : br.length ? br : sh; if (top.length) { const best = top.reduce((a2, o) => (o.ww > a2.ww ? o : a2)); best.ww = Math.max(best.ww, mx * 3); for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * 0.03); } }
      else if (uOn(p, 'aonoouza') && !p.gk && !S.setPiece) { const olA = offsideLine(p.team), sg = sgn(p.team), xk = fx(p.team, p.x);
        // 蒼の王座：受けたらキープして、裏を取る味方（FWと2列目）を待つ。出すのはゴールへ向かう縦パス（スルーパスか足もと）だけ。横・後ろへは出さない
        if (!p.aoHoldT) p.aoHoldT = S.t; const held = S.t - p.aoHoldT;
        const rq = (m) => !m.off && !m.gk && m !== p && m.position !== 'DF' && fx(p.team, m.x) < olA - 0.3 && fx(p.team, m.x) > xk + 3 && fx(p.team, m.x) > olA - 16;
        const cands = opts.filter((o) => o.kind === 'pass' && o.q && rq(o.q) && ((o.q.aoRun || 0) > S.t || o.q.position === 'FW' || fx(p.team, o.q.x) > olA - 8));
        const ease = (o) => { const q = o.q, qx = Math.min(L - 8, Math.max(fx(p.team, q.x), Math.min(olA + 6, L - 10))), dg = hyp(L - qx, GOAL_Y - q.y), nm = Math.min(5, nearestOpp(q, q.x, q.y).d); return -dg - Math.abs(q.y - GOAL_Y) * 0.25 + nm * 0.8 + (q.vx * sg > 2 ? 2 : 0) + ((q.aoRun || 0) > S.t ? 1.5 : 0) + (safeThrough(p, q) ? 3 : 0); };   // ゴールを決めやすい方
        const goNow = cands.some((o) => fx(p.team, o.q.x) > olA - 3.5 && o.q.vx * sg > 1.5) || cands.some((o) => safeThrough(p, o.q) && fx(p.team, o.q.x) > olA - 6) || held > 2.4;   // 裏へ抜け出す瞬間（オフサイドぎりぎり）か、待ちすぎたら
        if (globalThis.__aoW) globalThis.__aoW.push({ t: +S.t.toFixed(2), held: +held.toFixed(2), c: cands.length, go: goNow });
        if ((!cands.length || !goNow) && held < 3.2 && !clrShot) { S.decision = 0.08; p.protect = Math.max(p.protect || 0, S.t + 0.3); S.dribbleMode = 'carry';
          let bk = null, bd = 9; for (const o of opps(p)) { if (o.gk || o.off) continue; const dd = hyp(o.x - p.x, o.y - p.y); if (dd < 4.5 && fx(p.team, o.x) > fx(p.team, p.x) - 0.5 && dd < bd) { bd = dd; bk = o; } }
          if (bk) { p.aoShield = S.t + 0.25; p.dO = Math.min(p.dO || 0.4, 0.35); if (S.t > (p.aoDuelT || 0)) { p.aoDuelT = S.t + 0.7; act(p, 'duel', 0.5, { o: bk.idx }); act(bk, 'duel', 0.5, { o: p.idx }); bk.lagT = Math.max(bk.lagT || 0, S.t + 0.3); } const vx = p.x - bk.x, vy = p.y - bk.y, vl = hyp(vx, vy) || 1, ux = vx / vl, uy = vy / vl; let qx = -uy, qy = ux; if ((qy * (GOAL_Y - p.y)) < 0) { qx = -qx; qy = -qy; } const dx = qx * 0.9 + ux * 0.3, dy = qy * 0.9 + uy * 0.3, dl = hyp(dx, dy) || 1; S.dribbleDir = [dx / dl, dy / dl]; p.aoTurn = 0; }   // CBを背負っている：背中で押さえたまま、横へずらしてボールを隠す（前へは進まない）
          else { if (!p.aoTurn) { p.aoTurn = 1; act(p, 'aopostend', 0.1); } S.dribbleDir = sdFwd(p, sg, 0); }   // 背中に相手がいない（前が空いている）：前を向いて運びながら待つ
          return; }
        if (cands.length) { const best = cands.reduce((a2, o) => (ease(o) > ease(a2) ? o : a2)), near = fx(p.team, best.q.x) > olA - 7 || (best.q.vx * sg > 2.5);
          const mx = Math.max(...opts.map((o) => o.ww)); best.ww = Math.max(best.ww, mx * 3); best.aoLong = true; best.through = near; best.chip = false; best.skill = null;   // 裏へ抜けた味方にはスルーパス、手前の味方には足もとへ
          for (const o of opts) if (o !== best && !(o.kind === 'shot' && clrShot)) o.ww = Math.min(o.ww, best.ww * 0.01); }
        else if (!clrShot) { const br = opts.filter((o) => o.kind === 'dribble' && o.mode === 'break'); if (br.length) { const best = br.reduce((a2, o) => (o.ww > a2.ww ? o : a2)), mx = Math.max(...opts.map((o) => o.ww)); best.ww = Math.max(best.ww, mx * 3); for (const o of opts) if (o !== best && o.kind !== 'shot') o.ww = Math.min(o.ww, best.ww * 0.01); } }   // 縦に出せる味方がいない：横・後ろへは戻さず、自分で前へ運ぶ
      }
      if (uOn(p, 'aonoouza') && !p.gk && !S.setPiece) for (const o of opts) if (o.kind === 'pass' && o.q && (o.through || o.chip || o.skill === 'throughPass' || o.skill === 'loftedThrough')) { if (o.aoLong || safeThrough(p, o.q)) { o.aoSafe = true; o.through = true; o.chip = false; o.skill = null; } else o.ww = 1e-30; }   // 蒼の王座：裏へのボールは、相手（DF・GK）が取れない所に落とせる時だけ。落とせない時は蹴らない
      // 渦潮の囮：自分で決めに行くより、2列目の味方に預けて決めさせる（ゴール目の前・完全にフリーな時は打つ）
      if (uOn(p, 'uzushio') && !p.gk && !S.setPiece && dGoal > 13) { const mp = opts.filter((o) => o.kind === 'pass' && o.q && !o.q.gk && o.q.position !== 'DF' && (o.danger ?? 1) < 0.7 && fx(p.team, o.q.x) > xf - 10); for (const o of mp) o.ww *= 3; const bp = Math.max(0, ...mp.map((o) => o.ww)); for (const o of opts) if (o.kind === 'shot') o.ww = mp.length ? Math.min(o.ww * 0.2, bp * 0.4) : o.ww * 0.5; else if (o.kind === 'dribble' && mp.length) o.ww = Math.min(o.ww * 0.4, bp); }
      // 白夜の視界：自陣の深い所から、相手のペナルティアークまで届く35m以上のロングフィードがある時だけ出る。裏へ走る味方の走る先へ（いなければ相手陣内の空いた味方へ）
      if (globalThis.__byCnt && p.uniq === 'byakuya') { globalThis.__byCnt.all++; if (xf < 66) globalThis.__byCnt.zone++; }
      if (p.uniq === 'byakuya' && !p.gk && !S.setPiece && xf < 66 && (uOn(p, 'byakuya') || !(p.uCd > S.t))) { const olB = offsideLine(p.team);
        const longOk = (o) => o.kind === 'pass' && o.q && o.q.position !== 'DF' && (o.d ?? 0) >= 35 && fx(p.team, o.q.x) < olB - 0.3 && fx(p.team, o.q.x) > L / 2 - 5;
        const cand = opts.filter(longOk), nearLine = cand.filter((o) => fx(p.team, o.q.x) > olB - 18);
        if (globalThis.__byCnt) { const c = globalThis.__byCnt; c.dec++; if (cand.length) c.cand++; if (p.uCd > S.t) c.cd++; }
        if (cand.length && (uOn(p, 'byakuya') || uFire(p, 'byakuya'))) {
          { const rn = p.byRunner >= 0 ? P[p.byRunner] : null; if (!p.byHoldT || S.t - p.byHoldT > 4) p.byHoldT = S.t;   // ダイレクトで蹴らなくてよい：裏へ走る味方の動き出しを待って、いちばん良いタイミングで蹴る
            const held = S.t - p.byHoldT, rnf = rn ? fx(p.team, rn.x) : 0, rv = rn ? rn.vx * sgn(p.team) : 0, rnOk = rn && !rn.off && (rn.byRunT || 0) > S.t && rnf < olB - 0.3;
            const ready = !rnOk || held > 1.4 || rnf > olB - 2.2 || (rnf > olB - 6 && rv > 2.5) || nearestOpp(p, p.x, p.y).d < 1.6;   /* オフサイドになる前に：ラインの手前で加速したら蹴る */
            if (!ready) { S.decision = 0.08; p.protect = Math.max(p.protect || 0, S.t + 0.3);   // 待つ間は止まらず、前へ運びながら周りを見る（相手が来たら向きを変える）
              const sg = sgn(p.team); let fr = 9; for (const o of opps(p)) { if (o.gk || o.off) continue; const rx = (o.x - p.x) * sg; if (rx > 0 && rx < 7 && Math.abs(o.y - p.y) < 4) fr = Math.min(fr, hyp(o.x - p.x, o.y - p.y)); }
              S.dribbleMode = 'carry'; S.dribbleDir = fr > 5 ? [sg, (GOAL_Y - p.y) * 0.01] : carryDir(p); { const l = hyp(S.dribbleDir[0], S.dribbleDir[1]) || 1; S.dribbleDir = [S.dribbleDir[0] / l, S.dribbleDir[1] / l]; } return; } }
          let best = p.byRunner >= 0 ? cand.find((o) => o.q.idx === p.byRunner) : null;
          if (!best) { const pool = nearLine.length ? nearLine : cand; const sc = (o) => Math.min(10, nearestOpp(o.q, o.q.x, o.q.y).d) * 1.0 + (fx(p.team, o.q.x) - xf) * 0.15 + (o.through ? 1.5 : 0) + R.next() * 0.5; best = pool.reduce((a, o) => (sc(o) > sc(a) ? o : a)); }
          const mx = Math.max(...opts.map((o) => o.ww)); best.ww = Math.max(best.ww, mx * 3); best.byLong = true; for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * 0.03); } }
      // 白夜の視界のロングフィードを受けた味方：前を向いたまま、空いている前へ運ぶ（すぐ戻さない）
      if ((p.byT || 0) > S.t && !p.gk && !(p.hariT > S.t)) { const d0 = Math.max(0, ...opts.filter((o) => o.kind === 'dribble' && o.mode === 'break').map((o) => o.ww)), mx = Math.max(...opts.map((o) => o.ww));
        if (d0 > 0 && space >= 3 && dGoal > 20) { const bd = opts.filter((o) => o.kind === 'dribble' && o.mode === 'break').reduce((a, o) => (o.ww > a.ww ? o : a)); bd.ww = Math.max(bd.ww, mx * 2); for (const o of opts) if (o !== bd && !(o.kind === 'pass' && o.q && fx(p.team, o.q.x) > xf + 6 && (o.danger ?? 1) < 0.5) && !(o.kind === 'shot' && dGoal < 22)) o.ww = Math.min(o.ww, bd.ww * 0.05); } }
      // 針の穴通しの1本を受けた味方：裏へ抜けたら、GKとの距離を詰めてから打つ（前が空いている間は運ぶ。GKが出てきた・前をふさがれた・ゴール目の前で打つ）
      if (((p.hariT || 0) > S.t || (p.finT || 0) > S.t) && !sdCtx && !p.gk) { const best2 = (k, f) => Math.max(0, ...opts.filter((o) => o.kind === k && (!f || f(o))).map((o) => o.ww));
        const gq = opps(p).find((q) => q.gk); let spF = 9; for (const q of opps(p)) { if (q.gk) continue; const rx = q.x - p.x, ry = q.y - p.y, dd = hyp(rx, ry); if (dd < 9 && (rx * dir[0] + ry * dir[1]) / (dd || 1) > 0.45) spF = Math.min(spF, dd); }
        const gkD = gq ? hyp(gq.x - p.x, gq.y - p.y) : 99, kIn = p.aoKeepFast && p.aoCutBy != null && P[p.aoCutBy] && (P[p.aoCutBy].aoCutT || 0) > S.t && !P[p.aoCutBy].off && hyp(P[p.aoCutBy].x - p.x, P[p.aoCutBy].y - p.y) < 15 && Math.abs(P[p.aoCutBy].y - GOAL_Y) + 4 < Math.abs(p.y - GOAL_Y), shootNow = p.aoKeepFast ? (dGoal < 18 || gkD < 5) && !(kIn && Math.abs(p.y - GOAL_Y) > 7 && dGoal > 8 && gkD > 3) : (dGoal < 16 || gkD < 5 || (dGoal < 24 && spF < 2.0)),   /* 蒼の王座の1本を受けた味方は、18m以内に入るまで遠くから打たない */ s0 = best2('shot'), d0 = best2('dribble', (o) => o.mode === 'break');
        if (shootNow && s0 > 0) { for (const o of opts) if (o.kind !== 'shot') o.ww = Math.min(o.ww, s0 * 0.08); }
        else if (d0 > 0 && dGoal < 45) { for (const o of opts) if (o.kind === 'shot' || (o.kind === 'pass' && !(o.danger < 0.3 && o.q && hyp(L - fx(p.team, o.q.x), GOAL_Y - o.q.y) < dGoal - 8))) o.ww = Math.min(o.ww, d0 * 0.05); } }
      // 蒼の王座の1本を受けた味方：パス＆ゴーでゴール正面に入ってきたくもいが空いていれば、ダイレクトで折り返す（くもいが決める）
      if (p.aoKeepFast && !p.gk && !S.setPiece && p.aoCutBy != null && P[p.aoCutBy]) { const k = P[p.aoCutBy];
        if (!k.off && k.team === p.team && (k.aoCutT || 0) > S.t && !(S.ball.owner === k.idx)) { const kx = fx(p.team, k.x), kd = hyp(L - kx, GOAL_Y - k.y), dk = hyp(k.x - p.x, k.y - p.y);
          const onside = kx <= Math.max(fx(p.team, p.x) + 0.3, offsideLine(p.team) - 0.3);
          const kFree = !opps(p).some((o) => !o.gk && !o.off && hyp(o.x - k.x, o.y - k.y) < 2.2);
          const os2 = opps(p).filter((o) => !o.off); let rc = null, cs = null;   // くもいの走る先（前のスペース）へ折り返す：相手が先に触れない所
          if (dk > 3) for (const T of [0, 0.3, 0.7, 1.1]) { const cx = clamp(k.x + k.vx * T, 1, L - 1), cy = clamp(k.y + k.vy * T, 3, W - 3); if (hyp(L - fx(p.team, cx), GOAL_Y - cy) > 22) continue; const r = aoReach(p, k, cx, cy, false, 6, maxSpeed(k) * 1.15, os2, 0.7); if (!rc || r.m > rc.m) { rc = r; cs = [cx, cy]; } }
          const lane = rc && rc.m > (globalThis.__aoLoose ? -9 : 0.05) && rc.tR < 1.8;   // 折り返しが相手に触られずに、くもいの足元へ届く
          const gq = opps(p).find((o) => o.gk), gkP = gq ? hyp(gq.x - p.x, gq.y - p.y) : 99, gkK = gq ? hyp(gq.x - k.x, gq.y - k.y) : 99;
          const pBlk = opps(p).some((o) => !o.gk && !o.off && segDist(o.x, o.y, p.x, p.y, fx(p.team, L), GOAL_Y).d < 1.5), better = kd < dGoal - 1.5 || Math.abs(p.y - GOAL_Y) > Math.abs(k.y - GOAL_Y) + 5 || (gkP < 8 && gkK > gkP + 2) || (pBlk && kd < dGoal + 4);   // 自分のシュートコースがふさがれている時も
          
          if (globalThis.__aoEv) globalThis.__aoEv.push([+S.t.toFixed(1), 'p', +(L - fx(p.team, p.x)).toFixed(0), +(p.y - GOAL_Y).toFixed(0), 'k', +(L - kx).toFixed(0), +(k.y - GOAL_Y).toFixed(0), 'kd', +kd.toFixed(0), 'on' + (onside ? 1 : 0), 'fr' + (kFree ? 1 : 0), 'ln' + (lane ? 1 : 0), 'bt' + (better ? 1 : 0), rc ? +rc.m.toFixed(1) : '-', rc ? (() => { const i = rc.tO.indexOf(Math.min(...rc.tO)); const o = os2[i]; return 'blk' + o.idx + (o.gk ? 'GK' : '') + '@' + (L - fx(p.team, o.x)).toFixed(0) + ',' + (o.y - GOAL_Y).toFixed(0) + ' cs' + (cs ? (L - fx(p.team, cs[0])).toFixed(0) + ',' + (cs[1] - GOAL_Y).toFixed(0) : '') + ' tR' + rc.tR.toFixed(2); })() : ''].join(' '));
          if (onside && kFree && lane && (better || globalThis.__aoLoose) && kd < 24 && dGoal < 26 && Math.abs(k.y - GOAL_Y) < 11 && dk > 3 && dk < 24) { const cp = opts.find((o) => o.kind === 'pass' && o.q === k);
            if (cp) { const mx = Math.max(...opts.map((o) => o.ww)); cp.ww = Math.max(cp.ww, mx * 3); cp.aoCut = true; k.aoCutSpot = cs; if (globalThis.__aoCut) globalThis.__aoCut.dbg = { cs: cs.map((v) => +v.toFixed(1)), tR: rc.tR, k: [+k.x.toFixed(1), +k.y.toFixed(1), +k.vx.toFixed(1), +k.vy.toFixed(1)], p: [+p.x.toFixed(1), +p.y.toFixed(1)], o: os2.map((o, i) => [o.idx, +o.x.toFixed(1), +o.y.toFixed(1), +rc.tO[i].toFixed(2)]) }; cp.through = false; cp.chip = false; cp.skill = null; for (const o of opts) if (o !== cp) o.ww = Math.min(o.ww, cp.ww * 0.03); } } } }
      // 版467：攻め急がない。敵陣で味方のサポートが少なく（ボールの近くに味方1人以下）、相手が大勢戻っている時は、遠目のシュート・強引な突破を控えて、
      //  後ろ・横の味方につないで味方が上がってくるのを待つ（2人で8人の守備に突っ込まない）
      if (!p.gk && !S.setPiece && !globalThis.__noCompact && xf > L / 2 + 5 && dGoal > 16) {
        const forcedC = opts.some((o) => o.byLong || o.uzLong || o.aoLong || o.aoCut || o.kmPass || o.kmSelf || o.kmRet || o.ttPass || o.mdPass || o.tsuki || o.hari);
        const sup = mates(p).filter((m) => m !== p && !m.off && !m.gk && fx(p.team, m.x) > xf - 12 && hyp(m.x - p.x, m.y - p.y) < 26).length;
        const dAhead = opps(p).filter((o) => !o.off && !o.gk && fx(p.team, o.x) > xf - 2).length;
        if (!forcedC && sup <= 1 && dAhead >= 5) {
          for (const o of opts) {
            if (o.kind === 'shot' && dGoal > 20) o.ww *= 0.3;
            else if (o.kind === 'dribble' && o.mode === 'break') o.ww *= 0.45;
            else if (o.kind === 'pass' && o.q && !o.q.gk && fx(p.team, o.q.x) < xf + 2 && (o.danger ?? 1) < 0.6) o.ww *= 2.2;
          }
        }
      }
      // サイド（PAの横・ゴールライン寄り）でボールを持ったら：角度のない所からは打たない。第一の選択はクロス（ヘディング・ボレーに合わせる）か、ゴール前へ入ってくる味方への折り返し
      if (!p.gk && !S.setPiece && !sdCtx && xf > L - 30 && Math.abs(p.y - GOAL_Y) > 9) {
        const gx = Math.max(0.3, L - xf), ang = Math.abs(Math.atan2(GOAL_Y + POST - p.y, gx) - Math.atan2(GOAL_Y - POST - p.y, gx)) * 57.3, olW = offsideLine(p.team);
        const tg = opts.filter((o) => o.kind === 'pass' && o.q && !o.q.gk && !o.q.off && fx(p.team, o.q.x) > L - 22 && Math.abs(o.q.y - GOAL_Y) < 11 && fx(p.team, o.q.x) <= olW - 0.2 && (o.danger ?? 1) < 1.6 && !o.byLong && !o.uzLong && !o.aoLong);
        const forced = opts.some((o) => o.byLong || o.uzLong || o.aoLong || o.aoCut || o.kmPass || o.kmSelf || o.kmRet || o.ttPass || o.mdPass);
        if (ang < 17 && !forced) for (const o of opts) if (o.kind === 'shot') o.ww *= dGoal < 7 ? 0.3 : 0.02;   // 角度がない：打たない
        // 版843：えぐる：ゴールライン際（ゴールまで12m）まで縦に運べる時は、早めに上げずに運ぶ（その後マイナスへ折り返す）
        const lineAhead = !opps(p).some((o) => !o.off && !o.gk && fx(p.team, o.x) > xf + 0.5 && fx(p.team, o.x) < xf + 7 && Math.abs(o.y - p.y) < 4);   // 版846：えぐれる条件を少しゆるく
        const drv = !forced && xf < L - 9 && Math.abs(p.y - GOAL_Y) > 12 && lineAhead && !(S.counter > 0) ? opts.filter((o) => o.kind === 'dribble' && o.dir && o.dir[0] * sgn(p.team) > 0.75) : [];
        if (drv.length && R.next() < 0.62 + p.dribble / 220 + (p.sk.has('pinpointCross') ? 0.1 : 0)) { /* 版846：えぐる回数を増やす */ const mx = Math.max(...opts.map((o) => o.ww)), best = drv.reduce((a2, o) => (o.dir[0] * sgn(p.team) > a2.dir[0] * sgn(p.team) ? o : a2)); best.ww = Math.max(best.ww, mx * 2.5); for (const o of opts) if (o !== best && o.kind !== 'shot') o.ww = Math.min(o.ww, best.ww * 0.2); if (globalThis.__wide) globalThis.__wide.drive = (globalThis.__wide.drive || 0) + 1; }
        else if (tg.length && !forced) { const deep = xf > L - 17, mx = Math.max(...opts.map((o) => o.ww)), sc = (o) => -(L - fx(p.team, o.q.x)) * 0.15 - Math.abs(o.q.y - GOAL_Y) * 0.1 - (o.danger ?? 1) * 2 + Math.min(4, nearestOpp(o.q, o.q.x, o.q.y).d) * 0.4 + (deep && fx(p.team, o.q.x) < xf - 2 && nearestOpp(o.q, o.q.x, o.q.y).d > 2.2 ? 2.0 : 0);   // 版843：深くえぐったら、後ろ（マイナス）で空いている味方へ折り返す
          const best = tg.reduce((a2, o) => (sc(o) > sc(a2) ? o : a2)); const cbk = deep && fx(p.team, best.q.x) < xf - 2; best.ww = Math.max(best.ww, mx * (ang < 17 || cbk ? 3 : 1.5)); best.through = false; best.chip = false; if (cbk) for (const o of opts) if (o.kind === 'shot') o.ww = Math.min(o.ww, best.ww * 0.1);
          for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * (o.kind === 'dribble' ? 0.35 : o.kind === 'shot' ? (ang < 17 ? 0.02 : 0.25) : 0.15)); if (globalThis.__wide) { globalThis.__wide.cross++; (globalThis.__wide.log ||= []).push([S.t, p.team, best.q.idx]); } }
        else if (globalThis.__wide) globalThis.__wide.none++; }
      // ゴール前（PKマークより前・約13m以内）で、シュートコースに相手がいない：迷わず打つ（くもいのキープ中も）
      if (!p.gk && !S.setPiece && dGoal < 13.5 && !opts.some((o) => o.aoCut || o.byLong || o.kmPass)) { const sh = opts.filter((o) => o.kind === 'shot');
        if (sh.length) { const gx = fx(p.team, L), gxa = Math.max(0.3, L - xf), ang = Math.abs(Math.atan2(GOAL_Y + POST - p.y, gxa) - Math.atan2(GOAL_Y - POST - p.y, gxa)) * 57.3;
          const lane = !opps(p).some((o) => !o.gk && !o.off && !(o.downT > 0) && segDist(o.x, o.y, p.x, p.y, gx, GOAL_Y).d < 1.1 && segDist(o.x, o.y, p.x, p.y, gx, GOAL_Y).u > 0.03);
          if (lane && ang >= 20) { const best = sh.reduce((a2, o) => (o.ww > a2.ww ? o : a2)), mx = Math.max(...opts.map((o) => o.ww)); best.ww = Math.max(best.ww, mx * 4); for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * 0.02); best.mustShoot = true; } } }
      // 版845：ゴール前（約20m以内）でフリー（3.5m以内に相手がいない・シュートコースが空いている）なら、横パスより自分で打つ（崩しのパスにこだわらない）
      if (!p.gk && !S.setPiece && dGoal < 20 && dGoal >= 13.5 && !opps(p).some((q) => !q.gk && !q.off && hyp(q.x - p.x, q.y - p.y) < 3.5) && !opts.some((o) => o.aoCut || o.byLong || o.kmPass || o.mustShoot)) { const sh = opts.filter((o) => o.kind === 'shot');
        if (sh.length) { const gx = fx(p.team, L), gxa = Math.max(0.3, L - xf), ang = Math.abs(Math.atan2(GOAL_Y + POST - p.y, gxa) - Math.atan2(GOAL_Y - POST - p.y, gxa)) * 57.3;
          const lane = !opps(p).some((o) => !o.gk && !o.off && !(o.downT > 0) && segDist(o.x, o.y, p.x, p.y, gx, GOAL_Y).d < 1.3 && segDist(o.x, o.y, p.x, p.y, gx, GOAL_Y).u > 0.03);
          if (lane && ang >= 16) { const best = sh.reduce((a2, o) => (o.ww > a2.ww ? o : a2)), mx = Math.max(...opts.map((o) => o.ww)); best.ww = Math.max(best.ww, mx * 2.5); for (const o of opts) if (o !== best && !(o.kind === 'pass' && o.q && hyp(L - fx(p.team, o.q.x), GOAL_Y - o.q.y) < dGoal - (o.q.type === 'ストライカー' && o.q.position === 'FW' && p.type !== 'ストライカー' ? 3 : 7) && nearestOpp(o.q, o.q.x, o.q.y).d > 3)) o.ww = Math.min(o.ww, best.ww * 0.12); if (globalThis.__fsh) globalThis.__fsh.n++; } } }
      // 影の一刺しを受けたFW：自分で打てない（遠い・コースがない）時は、ゴール前へ走り込んできたかめいへ返す
      if (p.kmBack != null && P[p.kmBack] && (P[p.kmBack].kmBackT || 0) > S.t && !p.gk && !S.setPiece) { const k = P[p.kmBack];
        const blockers = opps(p).filter((o) => !o.gk && !o.off && segDist(o.x, o.y, p.x, p.y, fx(p.team, L), GOAL_Y).d < 1.2 && segDist(o.x, o.y, p.x, p.y, fx(p.team, L), GOAL_Y).u > 0.05).length, canShoot = dGoal < 21 && blockers === 0;
        const kx = fx(p.team, k.x), kd = hyp(L - kx, GOAL_Y - k.y), onK = kx <= Math.max(offsideLine(p.team) - 0.2, xf - 0.3), kFree = !opps(p).some((o) => !o.gk && !o.off && hyp(o.x - k.x, o.y - k.y) < 2);
        if (!canShoot && onK && kFree && kd < 22 && kd < dGoal + 2) { const r = aoReach(p, k, k.x + k.vx * 0.35, k.y + k.vy * 0.35, false, 6, maxSpeed(k), opps(p).filter((o) => !o.off), 0.6, 0.3), cp = opts.find((o) => o.kind === 'pass' && o.q === k);
          if (cp && r.m > 0) { const mx = Math.max(...opts.map((o) => o.ww)); cp.ww = Math.max(cp.ww, mx * 3); cp.kmRet = true; cp.through = false; cp.chip = false; cp.skill = null; for (const o of opts) if (o !== cp) o.ww = Math.min(o.ww, cp.ww * 0.02); } } }
      // 影の一刺し（かめい）：FWが打てる所へ動き出すのを、囲まれずに持って待ち、いちばん打ちやすい所へ取られない1本を刺す。FWにDFが寄ったら、空いた背後へ自分で抜けて打つ
      if (uOn(p, 'kage') && !p.gk && !S.setPiece) { const fw = p.kmFw >= 0 ? P[p.kmFw] : null, held = S.t - (p.kmHoldT || S.t), olK = offsideLine(p.team);
        for (const o of opts) if (o.kind === 'pass' && o.q && fx(p.team, o.q.x) > olK - 0.3) o.ww = 1e-30;   // オフサイドの位置の味方には出さない
        const fwOk = fw && !fw.off && fw.team === p.team && fx(p.team, fw.x) < olK - 0.3 && fx(p.team, fw.x + fw.vx * 0.15) < olK - 0.1, /* オフサイドでない瞬間だけ（走っている先も見る） */ fwD = fw ? hyp(L - fx(p.team, fw.x), GOAL_Y - fw.y) : 99, fwMark = fw ? nearestOpp(fw, fw.x, fw.y).d : 0;
        const cp = fwOk ? opts.find((o) => o.kind === 'pass' && o.q === fw) : null, ahead = fw && fx(p.team, fw.x) > xf + 3;
        const feet = cp ? aoReach(p, fw, fw.x + fw.vx * 0.45, fw.y + fw.vy * 0.45, false, 6, maxSpeed(fw), opps(p).filter((o) => !o.off), 0.6, 0.3).m > -0.15 : false, thrSp = cp && ahead && !feet ? safeThrough(p, fw) : null, lane = feet || !!thrSp;   // 足もとへ通るか、だめなら取られない所へのスルーパス
        const selfGo = space >= 6 && dGoal < 30 && (fwMark < 2.2 || !lane);   // FWにDFが寄った・コースがない：空いた前へ自分で
        if (globalThis.__kmS) globalThis.__kmS.push([+S.t.toFixed(1), +held.toFixed(1), fwOk ? 1 : 0, +fwD.toFixed(0), lane ? 1 : 0, +fwMark.toFixed(1), +space.toFixed(1), +dGoal.toFixed(0)]);
        const fwGo = fw && fx(p.team, fw.x) > olK - 3 && fw.vx * sgn(p.team) > 1.5;   // FWがラインぎりぎりで抜け出す瞬間
        if (cp && lane && (fwGo || fwD < 20 || held > 1.0)) { const mx = Math.max(...opts.map((o) => o.ww)); cp.ww = Math.max(cp.ww, mx * 3); cp.kmPass = true; cp.through = !feet; cp.aoLong = true; cp.chip = false; cp.skill = null; for (const o of opts) if (o !== cp && !(o.kind === 'shot' && clrShot)) o.ww = Math.min(o.ww, cp.ww * 0.02); }
        else if ((selfGo && held > 0.9) || held > 2.6) { p.finT = Math.max(p.finT || 0, S.t + 1.5); const mx = Math.max(...opts.map((o) => o.ww)), sh = opts.filter((o) => o.kind === 'shot'), br = opts.filter((o) => o.kind === 'dribble' && o.mode === 'break'); const top = dGoal < 18 && sh.length ? sh : br.length ? br : sh; if (top.length) { const best = top.reduce((a2, o) => (o.ww > a2.ww ? o : a2)); best.ww = Math.max(best.ww, mx * 3); best.kmSelf = true; for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * 0.03); } }
        else { S.decision = 0.1; p.protect = Math.max(p.protect || 0, S.t + 0.3); const kp = opts.filter((o) => o.kind === 'dribble' && o.mode === 'carry'); if (kp.length) { const best = kp.reduce((a2, o) => (o.ww > a2.ww ? o : a2)), mx = Math.max(...opts.map((o) => o.ww)); best.ww = Math.max(best.ww, mx * 3); for (const o of opts) if (o !== best && !(o.kind === 'shot' && clrShot)) o.ww = Math.min(o.ww, best.ww * 0.02); } } }   // 囲まれずに前を向いて持ち、FWの動き出しを待つ
      if ((p.mdDrive || 0) > S.t && !p.gk && !S.setPiece && frontSpace >= 6) { const br = opts.filter((o) => o.kind === 'dribble' && o.mode === 'break'); if (br.length) { const bk = br.reduce((a2, o) => (o.ww > a2.ww ? o : a2)); bk.ww *= 2.5; } }   /* 版449：フリーで受けた味方は、空いた前へ運んで数的優位を活かす */
      // 版449 翠の起点（むらおか）：晒して食いつかせる → 引きつけ切ったら、食いつかれて空いた中盤（フリーのMF）へつなぐ。そこから数的優位で組み立てる（守備の形は崩さない）
      if (uOn(p, 'midori') && p.mdT0 != null && !p.gk && !S.setPiece) { const lv2 = p.uniqLv >= 2, olM = offsideLine(p.team), mx0 = Math.max(...opts.map((o) => o.ww));
        for (const o of opts) if (o.kind === 'pass' && o.q && fx(p.team, o.q.x) > olM - 0.3) o.ww = 1e-30;   // オフサイドの位置の味方には出さない
        const lured = opps(p).filter((o) => o.mdLure && o.mdLure.by === p.idx), close = lured.filter((o) => hyp(o.x - p.x, o.y - p.y) < 5).length, tight = opps(p).some((o) => !o.gk && !o.off && hyp(o.x - p.x, o.y - p.y) < 2.2);
        if (!p.mdGo && (close >= Math.min(2, Math.max(1, lured.length)) || tight || S.t >= p.mdMax)) { p.mdGo = S.t; if (globalThis.__mdC) globalThis.__mdC.go++; }   // 引きつけ切った
        let best = null;
        if (p.mdGo) { const os = opps(p).filter((o) => !o.off && !(o.mdLure && o.mdLure.by === p.idx)); let bv = -1e9;   // 食いついた相手は置き去り（数に入れない）
          for (const o of opts) { if (o.kind !== 'pass' || !o.q || o.q.gk || o.q.off) continue; const q = o.q, qf = fx(p.team, q.x), dq = hyp(q.x - p.x, q.y - p.y); if (q.position === 'DF' || qf < xf - 3 || dq < 7 || dq > 38) continue;
            let sp = 9; for (const r of os) if (!r.gk) sp = Math.min(sp, hyp(r.x - q.x, r.y - q.y)); if (sp < 3.5) continue;   // 食いつかれて空いた、前を向けるフリーの味方
            const rc = aoReach(p, q, q.x + q.vx * 0.4, q.y + q.vy * 0.4, false, 6, maxSpeed(q), os, 0.6, 0.3); if (rc.m < 0.15) continue;
            const v = Math.min(sp, 9) + (qf - xf) * 0.12 + (q.position === 'MF' ? 1.5 : 0) + Math.min(rc.m, 1) * 1.5; if (v > bv) { bv = v; best = o; } } }
        if (best) { best.ww = Math.max(best.ww, mx0 * 3); best.mdPass = true; best.through = false; best.chip = false; best.skill = null; p.mdTo = best.q.idx; for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * 0.02); }
        else if (p.mdGo && S.t - p.mdGo > 0.8) { p.mdT0 = null; if (globalThis.__mdC) globalThis.__mdC.none++; }   // つなげる味方がいない：ふつうのプレーに戻る
        else { S.decision = 0.12; p.protect = Math.max(p.protect || 0, S.t + 0.4); if (globalThis.__mdPk) globalThis.__mdPk.push([+S.t.toFixed(1), 'hold']); return; } }   // 晒して待つ：足もとに置いたまま、寄せてくる相手を待つ（奪われない）
      // 鉄狼の関所：奪ったら、すぐ前の味方へ正確な縦パス（カウンターの起点）
      // 版467：鉄狼の関所で奪ったら、まず味方のレジスタ（白夜の視界のことう）へ。ことうが前を向いて白夜の視界を出す
      if ((p.uTetsu || 0) > S.t && uOn(p, 'tetsurou') && !p.gk && !globalThis.__noTT) { const rg = opts.find((o) => o.kind === 'pass' && o.q && !o.q.off && o.q.uniq === 'byakuya' && (o.danger ?? 1) < 0.9 && hyp(o.q.x - p.x, o.q.y - p.y) < 30);
        if (rg) { const mx = Math.max(...opts.map((o) => o.ww)); rg.ww = Math.max(rg.ww, mx * 3); rg.ttPass = true; for (const o of opts) if (o !== rg) o.ww = Math.min(o.ww, rg.ww * 0.03); p.uTetsu = 0; } }
      if ((p.uTetsu || 0) > S.t && uOn(p, 'tetsurou') && !p.gk && !globalThis.__noTT) { const fwd = opts.filter((o) => o.kind === 'pass' && o.q && !o.q.gk && !o.q.off && fx(p.team, o.q.x) > xf + 8 && fx(p.team, o.q.x) < offsideLine(p.team) - 0.3 && (o.danger ?? 1) < 1.0);
        if (fwd.length) { const best = fwd.reduce((a2, o) => (fx(p.team, o.q.x) - (o.danger ?? 1) * 12 > fx(p.team, a2.q.x) - (a2.danger ?? 1) * 12 ? o : a2)), mx = Math.max(...opts.map((o) => o.ww)); best.ww = Math.max(best.ww, mx * 3); best.ttPass = true; for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * 0.03); } }
      // 紫電の遊戯：重みの桁がシュートだけ大きいので、掛け算では足りない。前が空いている間は「運ぶ」を必ず上に、打つ時は「打つ」を必ず上に
      if (sdCtx) { const best = (k) => Math.max(0, ...opts.filter((o) => o.kind === k).map((o) => o.ww));
        if (sdCtx.shootNow) { const s0 = best('shot'); if (s0 > 0) for (const o of opts) if (o.kind === 'dribble') o.ww = Math.min(o.ww, s0 * 0.08); }
        else if (sdCtx.carry) { const d0 = best('dribble'); if (d0 > 0) for (const o of opts) if (o.kind === 'shot') o.ww = Math.min(o.ww, d0 * 0.04); } }
      // 渦潮の囮がコーナーへ走り抜けて、CBがついて行った：持っている2列目は、空いたドリブルスペースへ突っ込み、打てる所まで来たら打つ
      { const uz = teamU(p.team, 'uzushio'); if (uz && uz !== p && !p.gk && p.position !== 'DF' && !S.setPiece && xf > 45) {
          const olU = offsideLine(p.team), fw = opts.filter((o) => o.kind === 'pass' && o.q && o.q !== uz && (o.q.position === 'FW' || (o.q.uzT || 0) > S.t) && !o.q.off && fx(p.team, o.q.x) > Math.max(olU - 9, xf + 4) && fx(p.team, o.q.x) < olU - 0.3 && (o.danger ?? 1) < 2.2 && safeThrough(p, o.q));   // 相方のFWがいれば、空いた裏へスルーパスが一番速い
          if (globalThis.__uzFw) { globalThis.__uzFw.dec++; if (fw.length) globalThis.__uzFw.fw++; const ab = mates(p).find((m) => m.position === 'FW' && m !== uz); if (ab) globalThis.__uzFw.d.push(+(fx(p.team, ab.x) - olU).toFixed(0)); }
          if (fw.length) { const mx0 = Math.max(...opts.map((o) => o.ww)), best = fw.reduce((a2, o) => ((o.danger ?? 1) < (a2.danger ?? 1) ? o : a2)); best.ww = Math.max(best.ww, mx0 * 3); best.uzLong = true; best.through = true; for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * 0.03); }
          else if (dGoal < 36 || space >= 8) { p.finT = Math.max(p.finT || 0, S.t + 1.2); p.uzT = Math.max(p.uzT || 0, S.t + 1.2);   // 突っ込むのはゴールから約36m以内か、前が大きく空いている時（遠くから無理に運んで奪われない）   // 空いたスペースへ、いつもより速く突っ込む
            { let bs = -1e9, bp = null; for (const ax of [6, 10, 14, 18]) for (const dy of [-10, -6, -3, 0, 3, 6, 10]) { const tf = Math.min(xf + ax, L - 11), ty = clamp(GOAL_Y + dy, 5, W - 5), tx = fx(p.team, tf); let m = 9; for (const o of opps(p)) { if (o.off || o.gk) continue; const sd = segDist(o.x, o.y, p.x, p.y, tx, ty); m = Math.min(m, hyp(o.x - tx, o.y - ty), sd.d + 1.5); } const v = Math.min(m, 7) - hyp(L - tf, GOAL_Y - ty) * 0.12; if (v > bs) { bs = v; bp = [tx, ty]; } }   // いちばん空いている、ゴールに近い所
              if (bp) { const dx = bp[0] - p.x, dy = bp[1] - p.y, dl = hyp(dx, dy) || 1; p.uzDrive = { until: S.t + 0.6, dir: [dx / dl, dy / dl] }; } }
            const mx = Math.max(...opts.map((o) => o.ww)), sh = opts.filter((o) => o.kind === 'shot'), br = opts.filter((o) => o.kind === 'dribble' && o.mode === 'break');
          const top = dGoal < 24 && sh.length ? sh : br.length ? br : sh; if (top.length) { const best = top.reduce((a2, o) => (o.ww > a2.ww ? o : a2)); best.ww = Math.max(best.ww, mx * 3); for (const o of opts) if (o !== best) o.ww = Math.min(o.ww, best.ww * 0.03); } } } }
      // パスの候補は味方の数だけあるので、そのまま足すと「なんとなくのパス」が選ばれやすくなる。
      // パス全体の重みは、いちばん良いパスの1.4倍までに抑える（運べる時に、適当な横パス・危ないパスへ逃げない）
      // 打てる位置なのにパス：受け手がもっと近く・正面でフリーな時（ほぼ無人のゴールに流し込める）以外は選ばない
      if (p.shootSpot === S.t) for (const o of opts) if (o.kind === 'pass' && o.q) {
        const q = o.q, dq = hyp(L - fx(p.team, q.x), GOAL_Y - q.y), qFree = !opps(p).some((r) => !r.gk && hyp(r.x - q.x, r.y - q.y) < 2.5), gk0 = opps(p).find((r) => r.gk);
        const open = qFree && dq < dGoal - 4 && (!gk0 || hyp(gk0.x - q.x, gk0.y - q.y) > 5);
        if (!open) { if (o.w != null) o.w *= 0.2; if (o.ww != null) o.ww *= 0.2; }
      }
      { const ps = opts.filter((o) => o.kind === 'pass'); if (ps.length > 1) { const mx = Math.max(...ps.map((o) => o.ww)), tot = ps.reduce((a, o) => a + o.ww, 0), cap = mx * 1.4; if (tot > cap) for (const o of ps) o.ww *= cap / tot; } }
      // 版732：ストライカーはゴール前（18m以内）では、横や後ろへのパスより自分で打つ。パスは、はっきり良い（自分より6m以上ゴールに近く、フリー）時だけ
      if (striker && dGoal < 24) { const so = opts.find((o) => o.kind === 'shot');   // 版846：18m→24m
        if (so) for (const o of opts) if (o.kind === 'pass' && o.q && !(o.mdPass || o.kmPass || o.aoCut || o.kmRet)) {
          const q = o.q, dq = hyp(L - fx(p.team, q.x), GOAL_Y - q.y), qFree = !opps(p).some((r) => !r.gk && hyp(r.x - q.x, r.y - q.y) < 2.5);
          if (!(qFree && dq < dGoal - 6)) o.ww = Math.min(o.ww, so.ww * 0.3); } }
      for (const o of opts) sum += o.ww;
      let r = R.next() * sum, pick = opts[opts.length - 1];
      for (const o of opts) { r -= o.ww; if (r <= 0) { pick = o; break; } }
      { const bl = opts.find((o) => o.byLong || o.uzLong || o.aoLong); if (bl && pick !== bl && pick.kind !== 'shot') pick = bl; }
      { const ms = opts.find((o) => o.mustShoot); if (ms) pick = ms; }
      if (globalThis.__mdRk && (p.mdRecv || 0) > S.t) globalThis.__mdRk.push([+S.t.toFixed(1), p.name, +xf.toFixed(0), +dGoal.toFixed(0), pick.kind + (pick.mode ? ':' + pick.mode : '') + (pick.q ? '>' + pick.q.name + '@' + fx(p.team, pick.q.x).toFixed(0) : ''), +space.toFixed(1), (p.finT || 0) > S.t ? 'fin' : '']);
      if (globalThis.__mdPk && p.uniq === 'midori' && uOn(p, 'midori')) globalThis.__mdPk.push([+S.t.toFixed(1), p.mdT0 != null ? 1 : 0, pick.kind + (pick.mode ? ':' + pick.mode : ''), opts.filter((o) => o.kind === 'dribble').map((o) => o.mode).join(','), +S.decision.toFixed(2)]);
      { const mp = opts.find((o) => o.mdPass); if (mp) { pick = mp; for (const o of opps(p)) if (o.mdLure && o.mdLure.by === p.idx) { o.lagT = Math.max(o.lagT || 0, S.t + (p.uniqLv >= 2 ? 1.8 : 1.5)); o.mdLure = null; act(o, 'upoff', 0.1); } p.mdT0 = null; mp.q.mdFree = S.t + 3; mp.q.mdRecv = S.t + 9; T[p.team].mdBuild = S.t + (p.uniqLv >= 2 ? 10 : 8); T[p.team].mdBuildLv = p.uniqLv || 1; T[p.team].mdShape = S.t + 12; if (globalThis.__mdC) { globalThis.__mdC.pass++; (globalThis.__mdC.log ||= []).push([S.t, p.team, mp.q.idx, +fx(p.team, p.x).toFixed(0), +fx(p.team, mp.q.x).toFixed(0), 0]); } } }   /* 版448 翠の起点：裏返す（食いついた相手は置き去り） */
      { const kr = opts.find((o) => o.kmRet); if (kr) { pick = kr; kr.q.kmFin = S.t + 2.5; p.kmBack = null; if (globalThis.__kmC) globalThis.__kmC.ret = (globalThis.__kmC.ret || 0) + 1; } }   // 返す
      { const kc = opts.find((o) => o.kmPass); if (kc && pick.kind !== 'shot') { pick = kc; kc.q.kmFin = S.t + 2.5; kc.q.kmBack = p.idx; p.kmBackT = S.t + 5; if (globalThis.__kmC) globalThis.__kmC.cut++; } }   // 影の一刺し：刺す（刺したら自分もゴール前へ）   // 影からの一撃：落とす
      { const ac = opts.find((o) => o.aoCut); if (ac) { pick = ac; ac.q.aoFin = S.t + 2.5; p.aoCutBy = null; S.oneTouch = true; if (globalThis.__aoCut) { globalThis.__aoCut.cut++; (globalThis.__aoCut.log ||= []).push({ t: +S.t.toFixed(1), px: +fx(p.team, p.x).toFixed(1), py: +p.y.toFixed(1), kx: +fx(p.team, ac.q.x).toFixed(1), ky: +ac.q.y.toFixed(1) }); } } }   // 折り返しは必ず出す（ダイレクト）
      if (globalThis.__aoDec && uOn(p, 'aonoouza')) globalThis.__aoDec.push({ pick: pick.kind + (pick.q ? ((pick.q.aoRun || 0) > S.t ? ':RUN' : ':' + pick.q.position) : ''), runOpts: opts.filter((o) => o.q && (o.q.aoRun || 0) > S.t).map((o) => (o.danger ?? 0).toFixed(1) + '/' + (+o.ww).toPrecision(1) + (o.through ? 'T' : '')).join(','), best: opts.reduce((a2, o) => (o.ww > a2.ww ? o : a2)).kind, runners: mates(p).filter((m) => (m.aoRun || 0) > S.t).length, xf: +xf.toFixed(0) });   // 白夜の視界が出たら、必ずそのロングフィードを蹴る（ショートパスにしない）

      if (globalThis.__decLog) globalThis.__decLog.push({ xf, dGoal, space, frontSpace, pressure, pick: pick.kind, through: !!pick.through, danger: pick.danger, pd: pick.d, chip: !!pick.chip, back: pick.kind === 'pass' ? fx(p.team, pick.q.x) - xf : 0, lv: p.vision, gk: p.gk });
      if (globalThis.__cdLog && condLv(p.team)) globalThis.__cdLog.push(['pick', opts.filter((o) => o.kind === 'pass').map((o) => (o.danger ?? -1).toFixed(1) + '/' + (+o.ww).toPrecision(1)).join(' '), opts.filter((o) => o.kind === 'dribble').map((o) => (+o.ww).toPrecision(1)).join(' '), +S.t.toFixed(2), p.idx, pick.kind, pick.mode || '', !!S.oneTouch, +dGoal.toFixed(0), pick.danger != null ? +pick.danger.toFixed(2) : '', pick.q ? pick.q.idx : '', pick.d ? +pick.d.toFixed(0) : '', pick.through ? 'T' : '', pick.chip ? 'C' : '']);
      if (sdCtx && globalThis.__sdLog) globalThis.__sdLog.push({ ws: opts.map((o) => o.kind[0] + (o.mode ? o.mode[0] : '') + ':' + (+o.ww).toPrecision(2)).join(' '), d: +dGoal.toFixed(1), spF: +sdCtx.spF.toFixed(1), gkD: +sdCtx.gkD.toFixed(1), now: sdCtx.shootNow, carry: sdCtx.carry, pick: pick.kind, sp: +space.toFixed(1) });
      if (pick.kind !== 'shot') S.fkDirect = false;
      if (globalThis.__kmP && mates(p).some((m) => m !== p && uOn(m, 'kage'))) globalThis.__kmP.push([+S.t.toFixed(1), pick.kind + (pick.mode ? ':' + pick.mode : '') + (pick.kmCut ? ':KM' : ''), +dGoal.toFixed(0), p.kmWaitT ? +(S.t - p.kmWaitT).toFixed(1) : '-']);
      if (uOn(p, 'aonoouza')) p.aoLastPick = pick.kind + (pick.mode ? ':' + pick.mode : '') + (pick.q ? ':' + (pick.aoSafe || pick.aoLong ? 'safe' : 'norm') : '');
      if (globalThis.__strk && p.type === 'ストライカー' && p.position === 'FW' && dGoal < 18) globalThis.__strk.push(pick.kind === 'pass' ? 'pass' + (pick.through ? ':through' : '') + (pick.needle ? ':needle' : '') + (pick.kmPass ? ':km' : '') + (pick.mdPass ? ':md' : '') + (pick.skill ? ':' + pick.skill : '') + ':d' + Math.round(pick.danger || 0) + ':dq' + (pick.q ? Math.round(Math.hypot(L - fx(p.team, pick.q.x), GOAL_Y - pick.q.y)) : 0) + ':me' + Math.round(dGoal) + ':shw' + (opts.find((o) => o.kind === 'shot') ? (opts.find((o) => o.kind === 'shot').ww).toPrecision(2) : 'none') + ':pw' + (+pick.ww).toPrecision(2) + ':jw' + (S.t - (p.wonT ?? -9) < 0.7 ? 1 : 0) + ':sp' + (S.setPiece ? 1 : 0) : pick.kind);
      if (pick.kind === 'shot') shoot(p);
      else if (pick.kind === 'pass') { S.hrWant = !!pick.needle; S.byWant = !!pick.byLong; S.uzWant = !!pick.uzLong || !!pick.aoLong || !!pick.aoSafe; S.mdWant = !!pick.mdPass; startPass(p, pick.q, pick.through, pick.chip, pick.skill); S.mdWant = false; S.hrWant = false; S.byWant = false; b.predD = pick.danger ?? -1; b.predLen = pick.d ?? -1; }
      else if (pick.kind === 'clear' && !p.gk && Math.abs(p.y - GOAL_Y) > 16 && R.next() < OUT_CLEAR) {
        // タッチライン際で囲まれたら、外へ蹴り出してプレーを切る
        { const [ax, ay] = clearAim(p, clamp(p.x + sgn(p.team) * R.range(8, 22), 2, L - 2), p.y < GOAL_Y ? -5 : W + 5); kick(p, ax, ay, 'pass', 'clear', { landFrac: R.range(0.8, 1.0) }); }
        b.intended = -1; b.offside = false; b.kind = 'loose';
      }
      else if (pick.kind === 'clear') {
        const fw = mates(p).filter((m) => m.slot.last || m.slot.line === 1);
        const tgt = fw[R.int(fw.length)] || mates(p)[9];
        const tx = clamp(tgt.x + sgn(p.team) * 4, 1, L - 1);
        { const [ax, ay] = p.gk ? [tx, tgt.y + R.gauss() * 4] : clearAim(p, tx, tgt.y + R.gauss() * 4); kick(p, ax, ay, 'pass', p.gk ? 'high' : 'clear', { landFrac: p.gk ? 0.95 : R.range(0.75, 1.0) }); }
        b.intended = tgt.idx; b.offside = false;
        stats[p.team].passes++;
        S.lastPass[p.team] = { from: p.idx, t: S.t };
      } else {
        const dd = hyp(pick.dir[0], pick.dir[1]) || 1;
        S.dribbleDir = [pick.dir[0] / dd, pick.dir[1] / dd];
        if (S.dribbleMode !== pick.mode) { p.pace = null; p.carrySide = 0; act(p, 'dmode', 0.3, { m: pick.mode }); }
        S.dribbleMode = pick.mode;
        if (p.uniq === 'shiden' && xf > L / 2 - 8) uFire(p, 'shiden');
        if (uOn(p, 'shiden')) { S.dribbleDir = sdFwd(p, S.dribbleDir[0], S.dribbleDir[1]); if (dGoal > 20) S.dribbleMode = 'break'; }
        if ((p.hariT || 0) > S.t || (p.finT || 0) > S.t) { S.dribbleDir = sdFwd(p, S.dribbleDir[0], S.dribbleDir[1]); S.dribbleMode = 'break'; }
        if (p.uzDrive && p.uzDrive.until > S.t) { S.dribbleDir = p.uzDrive.dir; S.dribbleMode = 'break'; S.decision = Math.min(S.decision, 0.35); }   // 渦潮の囮で空いたスペースへ、まっすぐ突っ込む（こまめに見直して、打てる所で打つ）
        if (condLv(p.team) && !uOn(p, 'shiden')) { S.dribbleDir = sdFwd(p, S.dribbleDir[0], S.dribbleDir[1]); if (dGoal < 34 || space >= 6) S.dribbleMode = 'break'; }   // 港の指揮者：運ぶドリブルは前へ（後ろへは戻らない）   // 針の穴通しで抜け出した：まっすぐゴールへ   // 紫電の遊戯：ドリブルで仕掛けたら発動
        if (globalThis.__dribLog) globalThis.__dribLog.push(pick.mode);
        // 前が空いている時は、しばらく迷わず運び続ける（すぐに考え直して横パスに逃げない）
        S.decision = pick.mode === 'carry' ? R.range(0.35, 0.7) : space >= 6 && xf > L / 2 - 10 ? R.range(1.0, 1.5) : space >= 4.5 ? R.range(0.7, 1.1) : R.range(0.45, 0.9);   // 運ぶドリブルはこまめに向きを変える
        // 目の前に相手がいれば、自分から技を仕掛ける
        const front = opps(p).filter((o) => !o.gk && hyp(o.x - p.x, o.y - p.y) < 3.0 && ((o.x - p.x) * S.dribbleDir[0] + (o.y - p.y) * S.dribbleDir[1]) > 0).sort((a, c) => hyp(a.x - p.x, a.y - p.y) - hyp(c.x - p.x, c.y - p.y))[0];
        if (front && R.next() < 0.5) skillMove(p, front);
      }
    }

    // ---------- 課題の発見 ----------
    const ISSUE_TEXT = {
      running: ['ランニング', 'へばってる！スタミナが足りないぞ。'],
      video: ['ビデオ研究', '完全にペースを握られている！ビデオ研究で相手チームの分析が必要だ。'],
      setplay: ['セットプレー', 'セットプレーで押し込まれている！セットプレーの練習が必要だ。'],
      man_marking: ['マンツーマン', 'マークが甘い！フリーにさせすぎだ。'],
      press: ['プレス', 'プレスが甘い！好きにパスを回されている。'],
      pass: ['パス', 'パスがつながらない！もっと正確に。'],
      dash: ['ダッシュ', '裏を取られてる！足で負けているぞ。'],
      shoot: ['シュート', 'シュートが入らない！決めきる力が足りない。'],
      line_control: ['ラインコントロール', '押し上げが足りない！ラインが低すぎる。'],
    };
    const issueSeen = [new Set(), new Set()];
    function issue(ti, key) {
      if (issueSeen[ti].has(key) || issueSeen[ti].size >= 8) return;
      issueSeen[ti].add(key);
      stats[ti].issues.push(key);
      ev('issue', { team: ti, key, card: ISSUE_TEXT[key][0], text: ISSUE_TEXT[key][1] });
    }
    let deepTime = [0, 0];
    function checkIssues() {
      for (const tm of T) {
        const ti = tm.ti, s = stats[ti];
        if (tm.players.some((p) => !p.gk && p.cur < 30)) issue(ti, 'running');
        if (s.failed_passes >= 10) issue(ti, 'pass');
        if (s.off_target >= 4) issue(ti, 'shoot');
        { const pa = s.possession || 0, pb = stats[1 - ti].possession || 0; if (S.t > 120 && pa + pb > 0 && pb / (pa + pb) > 0.58) issue(ti, 'video'); }   // ボールを持たれ続けている
        if (stats[1 - ti].corners >= 4) issue(ti, 'setplay');
        if (S.passStreak[1 - ti] >= 9) issue(ti, 'press');
        if (stats[1 - ti].through_balls >= 4 && stats[1 - ti].offsides < stats[1 - ti].through_balls) issue(ti, 'dash');
        if (S.poss === ti) {
          const dl = Math.min(...tm.players.filter((p) => p.slot.line === 0).map((p) => fx(ti, p.x)));
          if (fx(ti, S.ball.x) > 55 && dl < 24) deepTime[ti] += DT;
          if (deepTime[ti] > 20) issue(ti, 'line_control');
        }
      }
    }

    // ---------- 方針 ----------
    function checkPolicies() {
      for (const tm of T) {
        const ti = tm.ti;
        const minute = S.t * CLOCK_SCALE / 60 + (S.half === 2 ? 0 : 0);
        const diff = S.score[ti] - S.score[1 - ti];
        const oppTeam = T[1 - ti];
        const avgSt = tm.players.filter((p) => !p.gk).reduce((a, p) => a + p.cur, 0) / 10;
        // 70分を過ぎて負け・引き分け：縦へ急ぎ、前から全体でプレス
        if (tm.situ) {
          // 状況別の作戦（プレイヤーが決める）：残り時間になったら、勝っている／引き分け／負けているで動きを変える
          const sit = tm.situ, on = minute >= (sit.from || 70);
          const a = on ? (diff > 0 ? sit.lead : diff < 0 ? sit.behind : sit.draw) || 'keep' : 'keep';
          if (a !== tm.sitAct) {
            tm.sitAct = a;
            // [ライン, プレス, 裏へのパス, シュートの積極性, 縦への急ぎ]。守りを固める＝無理に攻めず、前からの守備は続けてボールを持たせない
            const M = { keep: [0, 0, 0, 0, 0], defend: [0, 10, -25, -0.3, 0], attack: [0, 0, 0, 0, 1], allout: [1.5, 20, 25, 0.3, 1.4] }[a] || [0, 0, 0, 0, 0];
            Object.assign(tm.mods, { line: M[0], press: M[1], through: M[2], attack: M[3] });
            tm.urg = M[4];
            // 攻めるほど疲れる。総攻撃はDFも前に出るので、裏（カウンター）が空く
            tm.sitTire = { attack: 1.6, allout: 2.2 }[a] || 1;
            const push = { attack: 4, allout: 10 }[a] || 0;
            for (const p of tm.players) { if (p.gk) continue; if (!p.slot0) p.slot0 = p.slot; p.slot = push && p.slot0.line === 0 ? { ...p.slot0, rel: p.slot0.rel + push } : p.slot0; }
            if (a !== 'keep') ev('policy', { team: ti, action: 'SIT_' + a.toUpperCase() });
          }
          continue;
        }
        const urg = minute >= 70 && diff <= 0 ? 1 : 0;
        if (urg !== tm.urg) { tm.urg = urg; if (urg) ev('policy', { team: ti, action: 'URGENT' }); }
        const cond = {
          LEADING_LATE: diff > 0 && minute >= 75,
          TRAILING_LATE: diff < 0 && minute >= 70,
          OPP_GK_WEAK_KICK: oppTeam.players[0].kick < 50,
          OPP_HIGH_LINE: oppTeam.line_height >= 4,
          OWN_STAMINA_LOW: avgSt < 45,
        };
        let act = -1;
        for (let i = 0; i < tm.policies.length; i++) if (cond[tm.policies[i].condition]) { act = i; break; }
        if (act !== tm.activePolicy) {
          tm.activePolicy = act;
          Object.assign(tm.mods, { line: 0, press: 0, through: 0, attack: 0 });
          if (act >= 0) {
            const a = tm.policies[act].action;
            if (a === 'LINE_DOWN') tm.mods.line = -2;
            if (a === 'PUSH_UP') { tm.mods.line = 2; tm.mods.attack = 0.3; }
            if (a === 'HIGH_PRESS') tm.mods.press = 30;
            if (a === 'LESS_PRESS') tm.mods.press = -30;
            if (a === 'THROUGH_BALLS') tm.mods.through = 30;
            ev('policy', { team: ti, action: a });
          }
        }
      }
    }

    // ---------- 再開 ----------
    // プレーが切れた時：ボールは瞬間移動させず、転がって止まる→戻ってくる（スローインは拾いに行く）
    const RESTART_CODE = { throw: 1, corner: 2, goalkick: 3, free: 4, penalty: 7 };
    function setRestart(type, team, x, y, takerIdx) {
      S.dRun = null;
      S.charge = null;
      const tm = T[team];
      let taker = takerIdx;
      if (taker == null) {
        let bd = 1e9;
        for (const p of tm.players) { if (p.gk) continue; const d = hyp(p.x - x, p.y - y); if (d < bd) { bd = d; taker = p.idx; } }
      }
      // 再開までの「間」：審判・副審が判定を示し、選手が位置につくまで待つ
      const WAIT = { corner: 5.2, penalty: 7.5, throw: 3.0, goalkick: 4.6, free: 3.6 };
      S.restart = { type, team, x, y, taker, wait: WAIT[type] || 3.6, stage: 'settle', settle: hyp(S.ball.vx, S.ball.vy) > 9 || S.ball.z > 1 ? 1.8 : 0.9 };   // 勢いのある球は、飛んでいく先まで見せる
      if (S.refCard) S.restart.wait = Math.max(S.restart.wait, S.refCard.t + 2.6);   // カードを見せ終わってから
      // ゴールに近い直接フリーキックは壁を作る
      if (type === 'free' && fx(team, x) > L - 32 && Math.abs(y - GOAL_Y) < 24) {
        const gx = fx(team, L), dx = gx - x, dy = GOAL_Y - y, d = hyp(dx, dy) || 1;
        const ux = dx / d, uy = dy / d, n = fx(team, x) > L - 24 ? 4 : 3;
        const cx = x + ux * 9.4, cy = y + uy * 9.4;
        const spots = Array.from({ length: n }, (_, k) => [cx - uy * (k - (n - 1) / 2) * 0.75, cy + ux * (k - (n - 1) / 2) * 0.75]);
        const pool = T[1 - team].players.filter((q) => !q.gk).sort((a, c) => hyp(a.x - cx, a.y - cy) - hyp(c.x - cx, c.y - cy)).slice(0, n);
        S.restart.wall = pool.map((q, k) => ({ idx: q.idx, x: spots[k][0], y: spots[k][1] }));
        S.restart.wait = Math.max(S.restart.wait, 5.6);
      }
      Object.assign(S.ball, { owner: -1, kind: 'dead', intended: -1, offside: false });
      S.poss = team;
      S.dribbleDir = null;
      S.passStreak = [0, 0];
      if (type === 'throw') ev('throw', { team });
      if (type === 'free') ev('freekick', { team, wall: !!S.restart.wall });
      if (type === 'penalty') ev('penalty', { team, player: P[taker].name });
    }

    // ゴールのネット（外側）：外れたシュートがサイドネット・後ろのネット・天井に当たったら、本物のネットのように勢いを吸われて落ちる（すり抜けない）
    const NET_D = 2.6;   // 画面のゴールと同じ奥行き
    // スタジアム：ゴール裏の壁は x=-9 と L+9、奥の壁は y=-5（高さ3.2m）。壁の向こうは10mかけて8m上がる観客席（画面と同じ）
    const WALL_H = 3.2;
    function standZ(x, y) { const d = Math.max(-9 - x, x - (L + 9), -5 - y, 0); return d > 0 ? WALL_H + 8 * Math.min(1, d / 10) : 0; }   // 画面のゴールと同じ奥行き
    function netCollide(b, px, py, pz) {
      for (const gl of [0, L]) {
        const d = gl === 0 ? -1 : 1, dep = (x) => (x - gl) * d, inX = (x) => dep(x) > 0 && dep(x) < NET_D;
        const roof = (x) => BAR - BAR * 0.08 * clamp(dep(x) / NET_D, 0, 1);
        let hit = '';
        for (const sy of [GOAL_Y - POST, GOAL_Y + POST]) {   // 横のネット（外から当たる）
          if ((py - sy) * (b.y - sy) >= 0 || py === b.y) continue;
          const u = (sy - py) / (b.y - py), xc = px + (b.x - px) * u, zc = pz + (b.z - pz) * u;
          if (!inX(xc) || zc > roof(xc)) continue;
          const out = Math.sign(py - sy) || 1;
          b.x = xc; b.y = sy + out * 0.13; b.vy = out * (Math.abs(b.vy) * R.range(0.1, 0.2) + 1.6); b.vx *= 0.5; b.vz = Math.min(b.vz, 0) * 0.3; hit = 'side';   // ネットにはね返されて、外側へ少し転がる（柱にくっついたままにしない）
        }
        { const bx = gl + d * NET_D;   // 後ろのネット（ゴールの裏から当たる）
          if ((px - bx) * (b.x - bx) < 0 && Math.abs(b.y - GOAL_Y) < POST && b.z < roof(bx)) { b.x = bx + d * 0.13; b.vx = -b.vx * 0.1; b.vy *= 0.4; b.vz = Math.min(b.vz, 0) * 0.3; hit = 'back'; } }
        if (inX(b.x) && Math.abs(b.y - GOAL_Y) < POST && pz >= roof(px) - 0.02 && b.z < roof(b.x)) {   // 天井のネットに上から落ちる：少し弾んで、後ろへ転がり落ちる
          b.z = roof(b.x) + 0.11; b.vz = Math.abs(b.vz) * 0.35; b.vx = d * Math.max(Math.abs(b.vx) * 0.75, 3.5); b.vy *= 0.7; hit = 'roof';   // 天井のネットではずんで、そのまま後ろへ落ちる（上に乗ったままにはしない）
        }
        if (hit) { if (!b.netHit) { b.netHit = 1; ev('sidenet', { gx: gl, y: +b.y.toFixed(2), z: +b.z.toFixed(2), where: hit }); } return true; }
      }
      return false;
    }
    // ゴールの中・裏にあるボールを戻す時は、ネットや柱をすり抜けない道を通る（中なら口から出し、裏なら横へ回る）
    function goalWay(b, tx, ty) {
      for (const gl of [0, L]) {
        const d = gl === 0 ? -1 : 1, behind = (b.x - gl) * d;
        if (behind <= 0) continue;
        if (behind < NET_D + 0.05 && Math.abs(b.y - GOAL_Y) < POST) return [gl - d * 1.0, clamp(b.y, GOAL_Y - POST + 0.6, GOAL_Y + POST - 0.6)];
        if (Math.abs(b.y - GOAL_Y) < POST + 0.8) { const sd = Math.sign(b.y - GOAL_Y) || Math.sign(ty - GOAL_Y) || 1; return [b.x, GOAL_Y + sd * (POST + 1.2)]; }
      }
      return [tx, ty];
    }
    function restartBall() {
      const r = S.restart, b = S.ball, tk = P[r.taker];
      if (r.stage === 'settle') {
        // 外に出たボールが転がって止まる（ゴールのネットに当たれば止められる）
        //  勢いが余っていれば、ゴール裏・奥の壁まで飛んで当たる。壁より高ければ観客席に飛び込む（見えない壁で止めない）
        const px0 = b.x, py0 = b.y, pz0 = b.z;
        if (!b.inStands) {
          b.x += b.vx * DT; b.y += b.vy * DT;
          if (b.z > 0 || b.vz > 0) { const v = Math.hypot(b.vx, b.vy, b.vz); b.vx -= AIR * v * b.vx * DT; b.vy -= AIR * v * b.vy * DT; b.vz -= (9.8 + AIR * v * b.vz) * DT; b.z += b.vz * DT; }
          netCollide(b, px0, py0, pz0);
          // 壁（ゴール裏は x=-9 と L+9、奥は y=-5）：壁の高さより低ければ跳ね返る、高ければ観客席へ
          const walls = [[0, -9, 1], [0, L + 9, -1], [1, -5, 1]];
          for (const [k, wv, inward] of walls) {
            const a0 = k ? py0 : px0, a1 = k ? b.y : b.x;
            if ((a0 - wv) * (a1 - wv) >= 0 || a0 === a1) continue;
            const u = (wv - a0) / (a1 - a0), zc = pz0 + (b.z - pz0) * u;
            if (zc < WALL_H) { if (k) { b.y = wv + inward * 0.12; b.vy = -b.vy * 0.35; } else { b.x = wv + inward * 0.12; b.vx = -b.vx * 0.35; } b.vz *= 0.6; if (!b.wallHit) { b.wallHit = 1; ev('wall', { x: +b.x.toFixed(1), y: +b.y.toFixed(1) }); } }
          }
          const gz = standZ(b.x, b.y);
          if (gz > 0 && b.z <= gz) {   // 観客席に落ちた：段の上で小さく弾んで止まる
            b.z = gz; if (!b.standB) ev('stands', { x: +b.x.toFixed(1), y: +b.y.toFixed(1) });
            b.standB = (b.standB || 0) + 1;
            if (b.vz < -2 && b.standB <= 2) { b.vz = -b.vz * 0.3; b.vx *= 0.35; b.vy *= 0.35; } else { b.vx = b.vy = b.vz = 0; b.inStands = 1; } }   // 観客席に落ちた
          else if (b.z <= 0) { b.z = 0; if (b.vz < -2.2) { b.vz = -b.vz * BOUNCE_V; b.vx *= BOUNCE_H; b.vy *= BOUNCE_H; } else b.vz = 0; }
          if (b.z === 0 && b.vz === 0) { const sp = hyp(b.vx, b.vy); if (sp > 0) { const ns = Math.max(0, sp - groundDec(sp) * DT * 1.6); b.vx *= ns / sp; b.vy *= ns / sp; } }
          if (b.y > W + 6) { b.y = W + 6; b.vy = 0; }   // 手前（カメラ側）の看板
        }
        r.settle -= DT;
        if (r.settle <= 0) {
          b.vx = b.vy = 0;
          // 観客席・壁ぎわまで行ったボールは、ボールボーイが新しいボールをピッチの外の近くに置く
          if (b.inStands || b.z > 0.3 || (r.type === 'throw' && (b.y < -1.6 || b.y > W + 1.6))) { b.x = clamp(r.type === 'throw' ? r.x : b.x, -1.5, L + 1.5); b.y = clamp(r.type === 'throw' ? r.y : b.y, -1.5, W + 1.5); }   // スローインは、壁ぎわまで転がった球の代わりに新しいボールを渡される
          b.z = 0; b.vz = 0; b.inStands = 0; b.wallHit = 0; b.standB = 0;
          r.stage = r.type === 'throw' ? 'fetch' : 'return';
        }
        return;
      }
      if (r.stage === 'fetch') {
        if (hyp(tk.x - b.x, tk.y - b.y) < 0.9) { r.stage = 'held'; r.heldAt = S.t; }
        return;
      }
      if (r.stage === 'held') {
        // 頭の上で持つ
        b.x = tk.x; b.y = tk.y; b.z = 2.0; b.vx = b.vy = b.vz = 0;
        return;
      }
      if (r.stage === 'return') {
        // ボールが再開の場所まで戻ってくる（ボールボーイから渡される）
        const [wx, wy] = goalWay(b, r.x, r.y), way = wx !== r.x || wy !== r.y;
        const dx = wx - b.x, dy = wy - b.y, d = hyp(dx, dy) || 1e-6;
        const v = clamp(hyp(r.x - b.x, r.y - b.y) / 1.2, 4, 13);
        if (d < v * DT + 0.05) { b.x = wx; b.y = wy; if (!way) r.stage = 'ready'; return; }
        b.x += (dx / d) * v * DT; b.y += (dy / d) * v * DT; b.z = 0;
      }
    }

    // CKに対するGKの判断：出てキャッチ／パンチング／判断ミス（かぶる）／出ずにゴールを守る
    // ジャンプ力（届く高さ）・判断力（出るかどうか）・テクニック（キャッチの確かさ）で決まる
    // 版838：キャプテンシー：キャプテン（キャプテンシーを持つ選手）が、失点した時・後半の始まり・終盤（勝っていなければ）に仲間を奮い立たせる
    //  約45秒（試合時間で約9分）、チーム全員が少し速く、パス・シュートが正確に、疲れにくくなる。キャプテンは金の輪と技の名前、仲間の足もとに金の輪
    function capRally(ti) {
      const tm = T[ti], cap = (tm.role && tm.role.captain && tm.role.captain.sk.has('captaincy') && !tm.role.captain.off) ? tm.role.captain : tm.players.find((q) => !q.off && q.sk.has('captaincy'));
      if (!cap || (tm.capBuff || 0) > S.t + 5) return;
      const dur = 45; tm.capBuff = S.t + dur; act(cap, 'capcall', 1.4);
      for (const m of tm.players) if (!m.off) act(m, 'capbuf', dur, { c: m === cap ? 1 : 0 });
      if (globalThis.__tyDbg) globalThis.__tyDbg.cap = (globalThis.__tyDbg.cap || 0) + 1;
    }
    // 版834：流れの中のハイボール（クロス・放り込み）に対するGKの判断。CKと同じ「出てキャッチ／パンチング／かぶる／出ない」
    //  落ちてくる場所がゴールに近いほど出る。判断力・ジャンプ力が高いほど出て、ミスも少ない。人が密集しているところはパンチングが増える
    function gkHighCall(kk, b) {
      let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, w = b.vz, t = 0, lx = null, ly = null, lt = 0;
      for (let k = 0; k < 120 && t < 4; k++) { const v3 = Math.hypot(vx, vy, w); vx -= AIR * v3 * vx * 0.05; vy -= AIR * v3 * vy * 0.05; w -= (9.8 + AIR * v3 * w) * 0.05; x += vx * 0.05; y += vy * 0.05; z += w * 0.05; t += 0.05;
        if (w < 0 && z < 3.0 && lx == null) { lx = x; ly = y; lt = t; } if (z <= 0) break; }   // 頭の上（3m）まで落ちてきた所＝GKが手を伸ばして取れる高さ
      if (lx == null || lt < 0.5) return;
      const dt = 1 - kk.team, g = T[dt].players.find((q) => q.gk && !q.off); if (!g) return;
      const dx = fx(dt, lx), dy = Math.abs(ly - GOAL_Y);
      if (dx > 16.5 || dy > 20 || dx < -0.5) return;   // ペナルティエリアの外に落ちる球は関係ない
      const reach = hyp(lx - g.x, ly - g.y) / (maxSpeed(g) * 1.1) + 0.25; if (reach > lt + 0.15) return;   // 間に合わない球には出ない
      const zone = dx < 6 && dy < 10 ? 0.92 : dx < 11 ? 0.55 : 0.22;   // ゴールエリア／PKスポットまで／その外
      const crowd = P.filter((q) => !q.off && !q.gk && hyp(q.x - lx, q.y - ly) < 3).length;   // 落下点のまわりの人の数
      const comeP = clamp(zone * (0.7 + g.vision * 0.004 + g.jump * 0.003) * (g.gkAtk ? 1.2 : 1) * (g.type === 'スイーパーキーパー' ? 1.15 : 1) - crowd * 0.05, 0, 0.97);
      if (R.next() > comeP) return;   // 出ない（DFに任せて、ゴールを守る）
      const miss = clamp(0.22 - g.vision * 0.0016 - g.jump * 0.0012 + crowd * 0.02, 0.03, 0.25);
      const catchP = clamp(0.55 + g.technique * 0.004 - crowd * 0.08 - (g.sk.has('punching') ? 0.15 : 0), 0.15, 0.92);
      const v = R.next();
      S.gkCk = { g: g.idx, mode: v < miss ? 'miss' : v < miss + (1 - miss) * catchP ? 'claim' : 'punch', until: S.t + lt + 1.2, hb: 1 };
      if (globalThis.__hbLog) globalThis.__hbLog.push({ t: S.t, mode: S.gkCk.mode, dx: +dx.toFixed(1), crowd });
    }
    function gkCornerCall(tk, ck) {
      const g = T[1 - tk.team].players.find((p) => p.gk && !p.off);
      if (!g) return;
      const comeP = { near: 0.22, far: 0.6, mid: 0.42 }[ck] * (0.75 + g.vision * 0.004 + g.jump * 0.002) * (g.gkAtk ? 1.25 : 1);
      if (R.next() > comeP) { S.gkCk = { g: g.idx, mode: 'stay', until: S.t + 3 }; return; }
      const miss = clamp(0.3 - g.vision * 0.0022 - g.jump * 0.0012, 0.05, 0.28);
      const catchP = clamp(0.3 + g.technique * 0.005 - (ck === 'near' ? 0.25 : 0) - (g.sk.has('punching') ? 0.15 : 0), 0.1, 0.85);
      const v = R.next();
      S.gkCk = { g: g.idx, mode: v < miss ? 'miss' : v < miss + (1 - miss) * catchP ? 'claim' : 'punch', until: S.t + 3 };
    }
    /* v742 PK：キッカーと守るGK以外が、ペナルティエリアとアークの外に出るまで蹴らない */
    function pkInZone(q, r) { return fx(r.team, q.x) > L - 16.5 - 0.6 && Math.abs(q.y - GOAL_Y) < 20.16 + 0.6 || hyp(q.x - r.x, q.y - r.y) < 9.15 + 0.4; }
    function pkClear(r) { return P.every((q) => q.off || q.idx === r.taker || (q.gk && q.team !== r.team) || !pkInZone(q, r)); }
    function tickRestart() {
      const r = S.restart;
      r.wait -= DT;
      if (r.type === 'penalty' && r.wait <= 0 && !pkClear(r) && (r.pkHold = (r.pkHold || 0) + DT) < 8) return;   /* 全員が外に出るまで待つ（最大8秒） */
      const tk = P[r.taker];
      // スローインはボールを頭の上でしっかり持ってから（カウンターなら素早く）
      const quick = r.type === 'throw' && fx(r.team, r.x) > 40 && opps(tk).filter((q) => fx(r.team, q.x) < fx(r.team, r.x)).length <= 4;
      const ready = r.type === 'throw' ? r.stage === 'held' && S.t - (r.heldAt ?? S.t) >= (quick ? 0.4 : 1.0) : r.stage === 'ready' && r.runup;
      if (r.wait <= 0 && ready && hyp(tk.x - r.x, tk.y - r.y) < (r.type === 'throw' ? 1.0 : 0.75)) {
        if (r.type === 'throw') { tk.x = r.x; tk.y = r.y; }
        S.ball.x = r.x; S.ball.y = r.y; S.ball.z = 0;
        S.ball.owner = tk.idx; S.ball.kind = 'owned'; S.ball.lastTeam = tk.team; S.ball.lastPlayer = tk.idx;
        S.restart = null;
        if (r.type === 'corner' || r.type === 'throw') {
          // スローインはマークの外れた味方へ（近くに相手がいない・前向き）。コーナーはゴール前へ
          const cand = mates(tk).filter((m) => m !== tk && !m.gk && !m.off).map((m) => ({ m, s: r.type === 'corner' ? -hyp(fx(tk.team, m.x) - (L - 8), m.y - GOAL_Y) + R.gauss() * 3 : Math.min(nearestOpp(m, m.x, m.y).d, 8) * 1.4 - Math.abs(hyp(m.x - tk.x, m.y - tk.y) - 10) * 0.35 + (fx(tk.team, m.x) - fx(tk.team, tk.x)) * 0.05 - (opps(tk).some((q) => segDist(q.x, q.y, tk.x, tk.y, m.x, m.y).d < 1.5) ? 6 : 0) + R.gauss() * 0.6 }));
          cand.sort((a, c) => c.s - a.s);
          const q = cand[0].m;
          if (r.type === 'corner') {
            // インスイング（ゴールへ曲がる）かアウトスイング
            const toGoal = Math.sign((GOAL_Y - tk.y) * (fx(tk.team, L) - tk.x)) || 1;
            if (tk.sk.has('ckMaster')) {
              // CKマイスター：いちばん空中戦に強い味方の頭へ、ほぼピンポイント（カーブを持っていれば巻いて合わせる）
              const box = mates(tk).filter((m) => m !== tk && !m.gk && !m.off && fx(tk.team, m.x) > L - 18).sort((a, c) => (c.jump * 0.6 + c.physical * 0.4) - (a.jump * 0.6 + a.physical * 0.4));
              const hq = box[0] || q;
              act(tk, 'skill', 1.4, { k: 'ckMaster' });
              kick(tk, hq.x + R.gauss() * 0.4, hq.y + R.gauss() * 0.4, 'pass', 'cross', { spinSign: tk.sk.has('curve') ? -sgn(tk.team) * (tk.y < GOAL_Y ? -1 : 1) : undefined, spinMul: tk.sk.has('curve') ? 1.4 : 0.3, acc: 0.25, landFrac: 1.0 });
              S.ball.intended = hq.idx;
            } else {
              // 3択（＋ショート）。キッカーのキックの数値が高いほど、狙った所へ正確に・質の高いボールが行く
              const ck = r.ck || 'mid', nearSide = tk.y < GOAL_Y ? 1 : -1, qq = r.ckTo != null && P[r.ckTo] && !P[r.ckTo].off ? P[r.ckTo] : q;
              const err = clamp(2.4 - tk.kick * 0.022, 0.35, 1.8), acc = clamp(1.5 - tk.kick / 85, 0.25, 1.2);
              const inSw = sgn(tk.team) * (tk.y < GOAL_Y ? -1 : 1);   // ゴールへ向かって曲がる向き
              if (ck === 'short') {
                // ショートコーナー：足元へ短いパス
                kick(tk, qq.x, qq.y, 'pass', false, {});
              } else if (ck === 'near') {
                // ニアへ速く低いボール：頭か足でコースを変える
                const ax = fx(tk.team, L - 5.2) + sgn(tk.team) * R.gauss() * err * 0.6, ay = GOAL_Y + nearSide * (2.6 + R.gauss() * err * 0.5);
                kick(tk, ax, ay, 'pass', 'drive', { landFrac: 1.35, spinSign: inSw, spinMul: 0.6, acc });
              } else if (ck === 'far') {
                // ファーへ高く：空中戦に強い選手の頭へ
                const ax = fx(tk.team, L - 7.5) + sgn(tk.team) * R.gauss() * err, ay = GOAL_Y - nearSide * (4.2 + R.gauss() * err);
                kick(tk, ax, ay, 'pass', 'high', { landFrac: 1.0, acc });
              } else {
                // 中間（PKスポットのあたり）へ、ゴールへ向かって巻いて落とす
                const ax = fx(tk.team, L - 10.5) + sgn(tk.team) * R.gauss() * err, ay = GOAL_Y + R.gauss() * err * 1.2;
                kick(tk, ax, ay, 'pass', 'cross', { spinSign: inSw, spinMul: 1.0, acc });
              }
              S.ball.intended = qq.idx;
              if (ck !== 'short') gkCornerCall(tk, ck);
              if (typeof globalThis !== 'undefined' && globalThis.__ckLog) globalThis.__ckLog.push({ ck, gk: S.gkCk && S.gkCk.mode, t: S.t, team: tk.team });
            }
            S.ball.offside = false; stats[tk.team].passes++;
          } else {
            // スローイン：頭の上から投げる
            let tq = q, hz = 0.25;
            // ロングスロー：敵陣の深い所なら、ゴール前の空中戦に強い味方へ頭の高さで投げ込む（フィジカルが強いほど遠くへ）
            const ltMax = 16 + tk.physical * 0.2;
            if (tk.sk.has('longThrow') && fx(tk.team, tk.x) > L - 34) {
              const box = mates(tk).filter((m) => m !== tk && !m.gk && !m.off && fx(tk.team, m.x) > L - 18 && hyp(m.x - tk.x, m.y - tk.y) < ltMax).sort((a, c) => (c.jump + c.physical) - (a.jump + a.physical));
              if (box[0]) { tq = box[0]; hz = 1.9; act(tk, 'skill', 1.4, { k: 'longThrow' }); }
            }
            const d = hyp(tq.x - tk.x, tq.y - tk.y);
            // 受け手の足元（少し前）に落ちる高さで投げる（ロングスローは頭の高さ）
            const v = clamp(4 + d * 0.62, 7, tk.sk.has('longThrow') ? 13 + tk.physical * 0.12 : 15), tf = d / v;
            const vz = clamp((hz - 2.0 + 4.9 * tf * tf) / tf, -1.5, 9);
            Object.assign(S.ball, { owner: -1, kind: 'pass', style: 'ground', z: 2.0, y: clamp(r.y, 0.3, W - 0.3), vx: ((tq.x - tk.x) / d) * v, vy: ((tq.y - tk.y) / d) * v, vz, lastTeam: tk.team, lastPlayer: tk.idx, kicker: tk.idx, intended: tq.idx, offside: false });
            tk.touchCd = 0.5; stats[tk.team].passes++;
            S.lastPass[tk.team] = { from: tk.idx, t: S.t };
          }
        } else if (r.type === 'goalkick' && R.next() < 0.75) {
          // ゴールキック：キック力があるほど遠くへ
          const dist = Math.min(26 + tk.kick * 0.38 + R.gauss() * 3, L / 2 + 9.15 - fx(tk.team, tk.x));   // 届いても相手のセンターサークルの終わりくらいまで
          const fwds = mates(tk).filter((m) => m.slot.last || m.slot.line === 1);
          const tgt = fwds.reduce((best, m) => (Math.abs(fx(tk.team, m.x) - fx(tk.team, tk.x) - dist) < Math.abs(fx(tk.team, best.x) - fx(tk.team, tk.x) - dist) ? m : best), fwds[0]);
          const tx = clamp(tk.x + sgn(tk.team) * dist, 5, L - 5), ty = clamp(tgt.y + R.gauss() * 5, 6, W - 6);
          kick(tk, tx, ty, 'pass', 'high', { landFrac: 1 });
          S.ball.intended = tgt.idx; S.ball.offside = false; stats[tk.team].passes++;
          S.lastPass[tk.team] = { from: tk.idx, t: S.t };
        } else if (r.type === 'penalty') {
          // PK：GKはどちらかへ跳ぶ（読みが当たるかどうか）
          const gk = T[1 - tk.team].players[0];
          const sideAim = R.next() < 0.5 ? -1 : 1;
          const aim = GOAL_Y + sideAim * R.range(1.8, 3.7);
          S.pk = true;
          shoot(tk, aim);
          S.pk = false;
          // PKの名手：最後までGKを見て、逆をつく
          const guess = R.next() < (0.42 + gk.mental * 0.002 + (gk.sk.has('pkStopper') ? 0.12 : 0) + (uOn(gk, 'ikari') ? 0.25 : 0)) * (tk.sk.has('pkMaster') ? 0.3 : 1) ? sideAim : -sideAim;   // 白亜の城壁：読みも当たりやすい
          startDive(gk, guess, 2.4 + R.next() * 0.8, 0.12);
          // PKストッパー：同じ方向に来たら、高確率で触る
          if (gk.sk.has('pkStopper') && guess === sideAim) { S.ball.pkStop = true; act(gk, 'skill', 1.4, { k: 'pkStopper' }); }
        } else {
          // 助走からそのまま蹴る（止まってドリブルしない）
          // バイタルエリアのFKは基本、直接狙う
          if (r.type === 'free' && r.wall) { S.fkDirect = true; S.setPiece = true; shoot(tk); S.setPiece = false; }
          else { S.setPiece = true; S.spType = r.type; decide(tk); S.setPiece = false; S.spType = null; }
        }
      }
    }

    // ---------- ボール ----------
    function ballOut() {
      const b = S.ball;
      if (b.x < 0 || b.x > L) {
        const goalTeam = b.x < 0 ? (side[0] > 0 ? 0 : 1) : (side[0] > 0 ? 1 : 0);       // このゴールを守るチーム
        const scorer = 1 - goalTeam;
        // ゴールラインを割った「その場所」で判定する（ラインを越えた後に横へ流れた位置では判定しない：枠外から入る・枠内なのにゴールキック、をなくす）
        const gl = b.x < 0 ? 0 : L;
        let yCross = b.y, zCross = b.z;
        if (b.px != null && (b.px - gl) * (b.x - gl) <= 0 && b.px !== b.x) { const u = (gl - b.px) / (b.x - b.px); yCross = b.py + (b.y - b.py) * u; zCross = b.pz != null ? b.pz + (b.z - b.pz) * u : b.z - (b.vz || 0) * DT * (1 - u); }   // ラインを越えた瞬間の高さ（前後のコマの間をつなぐ。上がりながら・落ちながらでも正しく）
        if (Math.abs(yCross - GOAL_Y) < POST && zCross < BAR) {
          if (globalThis.__goalLog) { const g = T[goalTeam].players.find((q) => q.gk); globalThis.__goalLog.push({ sp: hyp(b.vx, b.vy), from: b.shotFrom, kind: b.kind, gkD: g ? Math.abs(g.y - yCross) : -1, gkX: g ? Math.abs(g.x - gl) : -1, pre: g && g.preSave ? (g.preSave.t === b.shotT ? (g.preSave.miss ? 'miss' : 'reach') + ' est' + g.preSave.est.toFixed(2) + ' r' + g.preSave.r.toFixed(2) + ' sp' + g.preSave.sp.toFixed(1) + ' d' + g.preSave.d.toFixed(1) : 'old') : 'none', down: g ? !!(g.downT > 0 || g.diveT > 0) : false, z: zCross, y: yCross - GOAL_Y }); }
          S.score[scorer]++;
          capRally(1 - scorer);   // 版838：失点したチームのキャプテンが、仲間を奮い立たせる
          // 負けている側が決めた：喜ばずに、ボールを拾ってすぐ自陣へ戻る
          const hurry = S.score[scorer] - 1 < S.score[goalTeam];
          // 相手に当たって入ったシュート（ブロック・GKがはじいた・体に当たった）は、打った選手の得点。相手が自分で蹴った・頭で触ったボールが入った時だけオウンゴール
          const kk = b.kicker >= 0 ? P[b.kicker] : null, defl = P[b.lastPlayer] && P[b.lastPlayer].team !== scorer && kk && kk.team === scorer && (b.kickKind === 'shot' || b.kickKind === 'head');
          const k = defl ? kk : P[b.lastPlayer];
          const lp = S.lastPass[scorer];
          let assist = null;
          if (k.team === scorer && lp && lp.from !== k.idx && S.t - lp.t < 8) assist = P[lp.from].name;
          const g = { t: S.t, clock: Math.round(S.t * CLOCK_SCALE), player: k.team === scorer ? k.name : 'オウンゴール', number: k.number, assist };
          stats[scorer].goals.push(g);
          ev('goal', { team: scorer, player: g.player, number: k.number, assist, score: [...S.score], kind: b.kind, style: b.style || '', speed: Math.round(hyp(b.vx, b.vy) * 3.6), dist: b.shotFrom ? Math.round(b.shotFrom) : -1, knuckle: !!b.knuckle, conv: !!b.conv, hurry, roll: b.z < 0.4 && hyp(b.vx, b.vy) < 18, gkOut: (() => { const g = T[goalTeam].players[0]; return g.downT > 0 || g.diveT > 0 || fx(goalTeam, g.x) > 6; })() }); if (globalThis.__gkLog) { const g = T[goalTeam].players[0]; globalThis.__gkLog.push({ k: 'goal', pk: !!S.ball.pkShot, curve: !!S.ball.curveAll, kind: S.ball.kind, sinceShot: +(S.t - (S.ball.shotT ?? -9)).toFixed(2), lastTouch: S.ball.lastPlayer, kicker: S.ball.kicker, t: S.t, dive: g.diveT > 0 || g.downT > 0 ? (g.diveDir || 0) : 0, by: +(S.ball.y - GOAL_Y).toFixed(1), gy: +(g.y - GOAL_Y).toFixed(1), gx: +fx(goalTeam, g.x).toFixed(1), style: S.ball.style || '', dist: S.ball.shotFrom ? +S.ball.shotFrom.toFixed(0) : -1 }); }
          // 失点の時、得点者に一番近い守備者が遠ければ「マークが甘い」
          const nd = nearestOpp(k, k.x, k.y).d;
          if (nd > 4) issue(goalTeam, 'man_marking');
          b.kind = 'net';
          if (T[goalTeam].players.some((q) => q.sk.has('moodMaker'))) for (const q of T[goalTeam].players) q.cur = Math.min(100, q.cur + 4);   // ムードメーカー：失点してもチームを盛り上げる
          S.cel0 = hurry ? CELEB_HURRY : Math.abs(S.score[0] - S.score[1]) > 3 ? CELEB_SHORT : CELEB_LONG; S.celebrate = S.cel0; S.kickoffTeam = goalTeam;
          S.scorer = k.team === scorer ? k.idx : -1; S.scoreTeam = scorer;
          // ボールを取りに行く選手：決めた選手（オウンゴールなら、ゴールに一番近い味方）
          S.hurry = hurry ? { i: k.team === scorer ? k.idx : T[scorer].players.filter((q) => !q.gk).sort((x, y) => hyp(x.x - b.x, x.y - b.y) - hyp(y.x - b.x, y.y - b.y))[0].idx, stage: 'net' } : null;
          // 喜びに行く場所：近い方のコーナー付近
          S.celebSpot = [fx(scorer, L - 4), k.y < GOAL_Y ? 5 : W - 5];
          return;
        }
        b.netHit = 0; if (b.px != null) netCollide(b, b.px, b.py, b.pz != null ? b.pz : b.z - (b.vz || 0) * DT);   // 外れた球がネットの外側に当たった
        if (b.lastTeam === goalTeam) {   // CKは守備側が最後に触った時だけ（見えない当たりでCKにしない）
          stats[scorer].corners++;
          ev('corner', { team: scorer });
          { const ckR = T[scorer].role && T[scorer].role.ck; setRestart('corner', scorer, b.x < 0 ? 0.5 : L - 0.5, b.y < GOAL_Y ? 0.5 : W - 0.5, ckR && !ckR.off ? ckR.idx : null); }   // 指名されたCKキッカー
        } else {
          ev('goalkick', { team: goalTeam });
          setRestart('goalkick', goalTeam, fx(goalTeam, 5.5), GOAL_Y + (b.y < GOAL_Y ? -7 : 7), T[goalTeam].players[0].idx);
        }
        return;
      }
      if (b.y < 0 || b.y > W) {
        const team = 1 - b.lastTeam;
        if (globalThis.__outLog) globalThis.__outLog.push({ t: S.t, kind: b.kind, style: b.style || '', sp: +hyp(b.vx, b.vy).toFixed(1), lp: b.lastPlayer, kicker: b.kicker, intended: b.intended ?? -1, lastTeam: b.lastTeam, sinceKick: +(S.t - (b.shotT ?? S.t)).toFixed(1), x: +b.x.toFixed(1), owner: b.owner, z: +b.z.toFixed(2), selfPass: !!b.selfPass, trap: b.lastPlayer >= 0 && P[b.lastPlayer] ? P[b.lastPlayer].settle || '' : '', lpY: b.lastPlayer >= 0 ? +P[b.lastPlayer].y.toFixed(1) : -1, intY: b.intended >= 0 && P[b.intended] ? +P[b.intended].y.toFixed(1) : -1, aimY: b.aimY != null ? +b.aimY.toFixed(1) : -1, lastAct: S.lastTouch || '' });
        setRestart('throw', team, clamp(b.x, 1, L - 1), b.y < 0 ? -0.3 : W + 0.3);
      }
    }

    function stepBall() {
      const b = S.ball;
      if (S.restart) { restartBall(); return; }
      const own = ownerP();
      if (own) {
        const dir = S.dribbleDir || own.bdir || [own.facing, 0];
        if (own.gk && own.hold) { b.x += (own.x + sgn(own.team) * 0.25 - b.x) * 0.6; b.y += (own.y - b.y) * 0.6; b.z += ((own.downT > 0 ? 0.3 : 1.0) - b.z) * 0.45; b.vx = b.vy = b.vz = 0; return; }
        // 浮いた球はトラップして足元へ落とす（瞬間的に落ちないように）
        // ドリブル：ボールを少し前へ押し出し、ボールが遅れて追いつく（なめらかに、瞬間移動なし）
        if (own.settle) {
          // 触って勢いを殺したボールは、その場で止まりかけている。選手が寄ってきて足元に収める
          own.settleT = (own.settleT || 0) + DT;
          b.x += b.vx * DT; b.y += b.vy * DT;
          if (own.settle === 'go') { b.vx *= 0.62; b.vy *= 0.62; }
          else if (own.settle === 'meet' && own.meet && hyp(b.x - own.meet[0], b.y - own.meet[1]) < 0.45) { const dd0 = hyp(b.x - own.x, b.y - own.y); b.vx = own.vx; b.vy = own.vy; own.settle = false; own.dO = Math.min(Math.max(dd0, 0.3), 1.2); own.dV = 0; own.bdir = dd0 > 0.05 ? [(b.x - own.x) / dd0, (b.y - own.y) / dd0] : null; return; }   // 置く所まで来たら、そこからドリブルへ（勢いが余って転がっていかない・瞬間移動もしない）   // 置く所まで来たら、選手と一緒に動く（勢いが余って転がっていかない・瞬間移動もしない）
          else if (own.settleT >= 0.45) { b.vx *= 0.5; b.vy *= 0.5; }
          if (b.z > 0) { b.vz -= 9.8 * DT; b.z = Math.max(0, b.z + b.vz * DT); if (b.z === 0) b.vz = 0; }
          const dd = hyp(b.x - own.x, b.y - own.y);
          if ((dd < 0.8 && b.z < 0.3) || own.settleT > 1.2) {
            own.settle = false; own.dO = Math.min(dd, 0.6); own.dV = 0;
            own.bdir = dd > 0.05 ? [(b.x - own.x) / dd, (b.y - own.y) / dd] : null;
          }
          if (b.y < 0 || b.y > W || b.x < 0 || b.x > L) { Object.assign(b, { owner: -1, kind: 'loose', lastTeam: own.team, lastPlayer: own.idx }); own.settle = false; ballOut(); }
          return;
        }
        const spd = hyp(own.vx, own.vy);
        if (own.dO == null) { own.dO = 0.5; own.dV = 0; }
        if (spd > 1.6 && S.dribbleDir && b.z <= 0.02) {
          own.dV -= 3.4 * DT; own.dO += own.dV * DT;
          const carry = S.dribbleMode === 'carry', sd = (own.sdOn || 0) > S.t;   // 運ぶ：ボールは足元（0.3〜0.55m）／突破：大きく押し出す（速いほど遠く、最大1.3m）／高速ドリブル：大きく蹴り出す（最大2.4m）
          if (own.dO <= (carry ? 0.3 : 0.4)) { own.dO = carry ? 0.3 : 0.4; own.dV = carry ? 0.55 + spd * 0.05 : sd ? 1.9 + spd * 0.2 : 1.1 + spd * 0.14; act(own, 'touch', 0.25); }
          own.dO = Math.min(own.dO, carry ? 0.55 : sd ? 2.4 : 1.3);
        } else { own.dO += (0.5 - own.dO) * 0.3; own.dV = 0; }
        const fxp = own.x + dir[0] * own.dO, fyp = own.y + dir[1] * own.dO;
        if (b.z > 0.02) { b.x += (fxp - b.x) * 0.55; b.y += (fyp - b.y) * 0.55; b.z = Math.max(0, b.z - Math.max(2.2, b.z * 3.2) * DT); }
        else { let mx = (fxp - b.x) * 0.6, my = (fyp - b.y) * 0.6; const ml = hyp(mx, my), cap = (hyp(own.vx, own.vy) + 4.5) * DT; if (ml > cap && !globalThis.__noCap) { mx *= cap / ml; my *= cap / ml; } b.x += mx; b.y += my; b.z = 0; }   // ボールは足もとへ転がって寄る（一気に飛ばない）
        b.vx = own.vx; b.vy = own.vy; b.vz = 0;
        // ドリブルでラインを割ったらプレーは切れる（スローイン・ゴールキック・CK）
        if (b.y < 0 || b.y > W || b.x < 0 || b.x > L) {
          Object.assign(b, { owner: -1, kind: 'loose', lastTeam: own.team, lastPlayer: own.idx }); own.settle = false; S.dribbleDir = null;
          ballOut();
        }
        return;
      }
      if (b.kind === 'dead') return;
      {
        // 回転によるカーブ（浮いている間）と、無回転のブレ
        const sp0 = hyp(b.vx, b.vy);
        if (b.kind !== 'shot') b.curveAll = false;
        if (b.kind !== 'pass') b.curlP = false;
        if ((b.z > 0.15 || b.curveAll || b.curlP) && sp0 > 3) {
          const nx = -b.vy / sp0, ny = b.vx / sp0;
          let lat = (b.spin || 0) * sp0 * 0.24;
          b.vx += nx * lat * DT; b.vy += ny * lat * DT;
          if (b.knuckle && sp0 > 12) {
            // 無回転：左右・上下に小刻みに揺れながら飛ぶ（横の速さを波のように変える。平均すると狙った所へ向かう）
            if (b.wobW == null) { b.wobW = R.range(1.8, 2.8) * 6.283; b.wobA = R.range(5, 7); b.wobPh = 0; b.wobZA = R.range(1.2, 2.2); }
            const s0 = Math.sin(b.wobPh), c0 = Math.cos(b.wobPh * 1.37); b.wobPh += b.wobW * DT;
            const dl = (Math.sin(b.wobPh) - s0) * b.wobA, dz = (Math.cos(b.wobPh * 1.37) - c0) * b.wobZA;
            b.vx += nx * dl; b.vy += ny * dl; b.vz += dz;
            if (R.next() < 0.12) b.wobW = R.range(1.8, 2.8) * 6.283;   // 揺れの速さも時々変わる（読めない）
          }
        }
      }
      b.px = b.x; b.py = b.y; b.pz = b.z;   // 1コマ前の位置（速い球がGKをすり抜けないように線分で判定する）
      b.x += b.vx * DT; b.y += b.vy * DT;
      const airborne = b.z > 0 || b.vz > 0;
      if (airborne) {
        // 空気抵抗（3次元）
        const v = Math.hypot(b.vx, b.vy, b.vz);
        b.vx -= AIR * v * b.vx * DT; b.vy -= AIR * v * b.vy * DT;
        const bsv = b.bs || 0;
        b.vz -= (9.8 + AIR * v * b.vz - LIFT * bsv * Math.hypot(b.vx, b.vy) + (b.drive ? (b.vz < 0 ? b.drive : b.driveUp || 0) : 0)) * DT; b.z += b.vz * DT;   // ドライブシュート：頂点を過ぎると急に落ちる
        if (b.z <= 0) {
          // バウンド：バックスピンは跳ねたあと止まり気味、トップスピンは低く前へ伸びる。横回転は跳ねる向きを少し変える
          b.z = 0; b.drive = 0;
          const hard = Math.abs(b.vz) > 2.2;
          const keep = hard ? clamp(BOUNCE_H - bsv * 0.24, 0.4, 0.86) : 0.92 - Math.max(0, bsv) * 0.1;
          b.vx *= keep; b.vy *= keep;
          if (b.spin && !b.curveAll) { const a = -(b.spin) * 0.18, c0 = Math.cos(a), s0 = Math.sin(a); const vx = b.vx; b.vx = vx * c0 - b.vy * s0; b.vy = vx * s0 + b.vy * c0; }
          b.vz = hard ? -b.vz * clamp(BOUNCE_V + bsv * 0.06, 0.25, 0.5) : 0;
          b.spin = (b.spin || 0) * (b.curveAll ? 1 : 0.4); b.bs = bsv * 0.35 - 0.15; if (b.vz === 0) { b.knuckle = false; b.bs = -0.3; }
        }
      } else {
        const sp = hyp(b.vx, b.vy);
        if (sp > 0) {
          const ns = Math.max(0, sp - groundDec(sp) * DT);
          b.vx *= ns / sp; b.vy *= ns / sp;
        }
      }
      // クロスやこぼれ球がそのままゴールへ向かう時は、GKがシュートと同じように反応する
      if ((b.kind === 'pass' || b.kind === 'loose') && !b.selfPass && Math.abs(b.vx) > 3) {
        const gx = b.vx > 0 ? L : 0, tHit = (gx - b.x) / b.vx;
        if (tHit > 0 && tHit < 1.2) {
          const yHit = b.y + b.vy * tHit, zHit = b.z + b.vz * tHit - 4.9 * tHit * tHit;
          const defTeam = (gx === L) === (side[0] > 0) ? 1 : 0;
          if (Math.abs(yHit - GOAL_Y) < POST + 1.5 && zHit < BAR + 0.5 && b.lastTeam !== defTeam) { b.kind = 'shot'; b.shotOnTarget = true; b.oneOnOne = false; b.conv = true; b.shotFrom = hyp(b.x - (b.vx > 0 ? L : 0), b.y - GOAL_Y); b.gkPen = 0; b.shotT = S.t - 0.3; }
        }
      }
      postHit();
      ballOut();
    }
    // ポスト・バーに当たった直後（1.5秒）か、ボールがポストのすぐ脇でゴールラインにある時は、GKは触れない
    function postBlock(b) {
      if (b.postT != null && S.t - b.postT < 1.5) return true;
      const gl = Math.min(Math.abs(b.x), Math.abs(L - b.x));
      return gl < 1.0 && Math.abs(Math.abs(b.y - GOAL_Y) - POST) < 0.9 && b.z < BAR + 0.3;
    }
    // ポスト・クロスバー：当たれば弾かれる（中へ入るか、外へ出るか、跳ね返るか）
    function postHit() {
      const b = S.ball;
      if (b.px == null) return;
      for (const gx of [0, L]) {
        if ((b.px - gx) * (b.x - gx) > 0 || b.px === gx) continue;
        const u = (gx - b.px) / ((b.x - b.px) || 1e-6), yc = b.py + (b.y - b.py) * u, zc = b.pz != null ? b.pz + (b.z - b.pz) * u : b.z;
        const inward = b.px < gx ? -1 : 1;   // ピッチ側の向き
        const r = 0.11 + 0.06;               // ポストの太さ＋ボール
        for (const py of [GOAL_Y - POST, GOAL_Y + POST]) {
          if (Math.abs(yc - py) < r + 0.05 && zc < BAR + r) {
            const side = Math.sign(yc - py) || (R.next() < 0.5 ? 1 : -1);
            const sp = hyp(b.vx, b.vy);
            b.x = gx + inward * 0.05; b.y = py + side * (r + 0.02);
            b.vx = inward * Math.abs(b.vx) * R.range(0.3, 0.6); b.vy = side * sp * R.range(0.25, 0.5) + b.vy * 0.3;
            b.kind = 'loose'; b.curveAll = false; b.spin = 0; b.knuckle = false; b.postT = S.t;
            ev('post', { team: b.lastTeam });
            return;
          }
        }
        if (Math.abs(yc - GOAL_Y) < POST && Math.abs(zc - BAR) < 0.18) {
          if (globalThis.__barLog) globalThis.__barLog.push({ t: S.t, zc: +zc.toFixed(2), sk: b.shotSkill || '' });
          // クロスバー：上に当たれば外へ、下に当たれば中へ落ちるか跳ね返る
          if (zc < BAR && R.next() < 0.5) { b.vz = -Math.abs(b.vz) * 0.4 - 2; b.postT = S.t; return; }   // 下に当たって中へ落ちる
          b.x = gx + inward * 0.05; b.vx = inward * Math.abs(b.vx) * R.range(0.3, 0.5); b.vz = Math.abs(b.vz) * 0.5 + 1.5;
          b.kind = 'loose'; b.curveAll = false; b.spin = 0; b.postT = S.t;
          ev('post', { team: b.lastTeam, bar: true });
          return;
        }
      }
    }

    // 体に当たったボールの跳ね返り：当たった面（選手→ボールの向き）で反射し、勢いを落とす。少しだけばらつく
    function rebound(p, b, keep) {
      let nx = b.x - p.x, ny = b.y - p.y; const nd = hyp(nx, ny);
      const sp = hyp(b.vx, b.vy) || 1;
      if (nd < 0.05) { nx = -b.vx / sp; ny = -b.vy / sp; } else { nx /= nd; ny /= nd; }
      const dot = b.vx * nx + b.vy * ny;
      let vx = b.vx, vy = b.vy;
      if (dot < 0) { vx -= 1.6 * dot * nx; vy -= 1.6 * dot * ny; }
      else { vx += nx * sp * 0.3; vy += ny * sp * 0.3; }
      const a = Math.atan2(vy, vx) + R.gauss() * 0.18, v = Math.max(2.5, hyp(vx, vy) * keep);
      return [Math.cos(a) * v, Math.sin(a) * v];
    }
    // ドリブルで何人抜いたか（同じ選手がボールを持ち続けている間）。3人以上でハイライト用の出来事を残す
    function noteBeat(own, q) {
      own.beatT = S.t;   // 版840：抜いた時刻（続けて抜きにいかず、はたく判断に使う）
      if (!S.dRun || S.dRun.p !== own.idx) S.dRun = { p: own.idx, t0: S.t, beaten: [], e: null };
      const r = S.dRun;
      if (r.beaten.includes(q.idx)) return;
      r.beaten.push(q.idx);
      if (r.beaten.length >= 3) {
        if (!r.e) { ev('dribbleRun', { team: own.team, player: own.name, number: own.number, n: 3, t0: +r.t0.toFixed(1), t1: +S.t.toFixed(1) }); r.e = events[events.length - 1]; }
        else { r.e.n = r.beaten.length; r.e.t1 = +S.t.toFixed(1); }
      }
    }
    // 雅の後始末：ボールを受けた相手の前（ゴールまで）に、だれもいない広いスペースがある＝このままだとGKと1対1
    function miyabiOpen(p) {
      if (p.gk || p.off || fx(p.team, p.x) < L - 55) return false;
      const gx = fx(p.team, L), dl = hyp(gx - p.x, GOAL_Y - p.y) || 1, ux = (gx - p.x) / dl, uy = (GOAL_Y - p.y) / dl;
      const wide = Math.abs(p.y - GOAL_Y) > 16;
      for (const m of opps(p)) { if (m.gk || m.off || m.uniq === 'miyabi') continue;
        if (fx(p.team, m.x) > fx(p.team, p.x) + 1 && (wide || Math.abs(m.y - p.y) < 22)) return false;   // 最終ラインに味方が残っている：その味方に任せる（発動しない）
        const ax = m.x - p.x, ay = m.y - p.y, al = ax * ux + ay * uy, lat = Math.abs(ax * uy - ay * ux);
        if (al > 0.5 && al < Math.min(dl, 30) && lat < 4 + al * 0.3) return false; }
      return true;
    }
    function gainBall(p, how) {
      if (globalThis.__mdG && p.uniq === 'midori') globalThis.__mdG.push([+fx(p.team, p.x).toFixed(0), how, S.restart ? 1 : 0, S.setPiece ? 1 : 0]);
      for (const q of P) q.aoKeepFast = false;   // 蒼の王座の「抜け出す足」は、打つか離すまで
      const b = S.ball;
      if (globalThis.__byLog && b.byP) globalThis.__byLog.push([+S.t.toFixed(2), p.idx, b.intended, b.kind, how, +b.z.toFixed(1)]);
      if (globalThis.__scLog && b.kind === 'shot' && p.team === b.lastTeam && p.idx !== b.lastPlayer) globalThis.__scLog.push(['gain', S.t, how]);
      p.recvT = S.t;
      if (globalThis.__kcut && b.kicker >= 0 && P[b.kicker] && P[b.kicker].uniq === 'aonoouza' && P[b.kicker].team !== p.team && S.t - (b.passT ?? -9) < 3) globalThis.__kcut.push([+S.t.toFixed(1), how, b.kind, b.uSafe, b.lastPlayer === b.kicker ? 'direct' : 'touched:' + b.lastPlayer, b.intended, +(S.t - b.passT).toFixed(2), b.z.toFixed(1), b.style || '']);
      if (globalThis.__aoLost && b.lastPlayer >= 0 && P[b.lastPlayer] && P[b.lastPlayer].uniq === 'aonoouza' && P[b.lastPlayer].team !== p.team && uOn(P[b.lastPlayer], 'aonoouza')) globalThis.__aoLost.push([+S.t.toFixed(1), how, b.kind, P[b.lastPlayer].aoLastPick || '-', +(S.t - (P[b.lastPlayer].aoHoldT || S.t)).toFixed(1), +(L - fx(1 - p.team, P[b.lastPlayer].x)).toFixed(0)]);
      if (globalThis.__aoCut && globalThis.__aoCut.log) { const c = globalThis.__aoCut.log[globalThis.__aoCut.log.length - 1]; if (c && c.t != null && c.by == null && S.t - c.t < 4) { c.by = p.idx; c.how = how; c.dt = +(S.t - c.t).toFixed(2); c.bz = +S.ball.z.toFixed(1); } }
      if (globalThis.__aoDbg && globalThis.__aoDbg.length) { const L0 = globalThis.__aoDbg[globalThis.__aoDbg.length - 1]; if (!L0.got && S.t - L0.t < 5) { L0.got = p.idx; L0.gt = +(S.t - L0.t).toFixed(2); L0.gx = +fx(1 - p.team === 0 ? 0 : 0, 0).toFixed(0); L0.pf = +fx(S.ball.lastTeam ?? 0, p.x).toFixed(1); L0.py = +p.y.toFixed(1); L0.z = +S.ball.z.toFixed(1); L0.how = how; } }
      if (!S.setPiece && !S.restart && how !== 'tackle' && !p.gk) for (const m of opps(p)) if (m.kgT === p.idx && uOn(m, 'kagenui') && m.uniqLv >= 2 && hyp(m.x - p.x, m.y - p.y) < 4.5) { p.kgPin = S.t + 1.0; p.vx *= 0.1; p.vy *= 0.1; act(p, 'kgpin', 1.0, { o: m.idx }); act(m, 'kgsew', 0.6, { o: p.idx }); break; }
      if (!S.setPiece && !S.restart && how !== 'tackle' && !p.gk && !((p.kgPin || 0) > S.t) && b.kind === 'pass') for (const m of opps(p)) if (m.kgT === p.idx && uOn(m, 'kagenui') && hyp(m.x - p.x, m.y - p.y) < 3.2 && R.next() < 0.85) {   // 影縫い：張りつかれたまま受けると、トラップが乱れてこぼれる
        const ax = m.x - p.x, ay = m.y - p.y, al = hyp(ax, ay) || 1, an = Math.atan2(ay, ax) + R.range(-0.9, 0.9), v = R.range(2.5, 4); Object.assign(b, { owner: -1, kind: 'loose', vx: Math.cos(an) * v, vy: Math.sin(an) * v, vz: 0, lastTeam: p.team, lastPlayer: p.idx, intended: -1 }); p.touchCd = 0.5; act(p, 'lose', 0.6, { o: m.idx }); act(m, 'kgsew', 0.45, { o: p.idx }); return; }   // 影縫い（凸）：受けた瞬間、影を地面に縫い止める（約1秒その場から動けず、前を向けない）
      if (!S.setPiece && !S.restart && p.team === b.lastTeam && miyabiOpen(p)) for (const m of opps(p)) if (m.uniq === 'miyabi' && !m.off && hyp(m.x - p.x, m.y - p.y) < 35) uFire(m, 'miyabi');   // 相手FWにボールが入った瞬間：前のスペースをケアしに走る
      if ((b.tsukiP || b.tact) && b.kind === 'pass' && b.intended === p.idx) for (const m of opps(p)) if (m.uniq === 'miyabi' && !m.off) uFire(m, 'miyabi');   // 抜け出された：雅の後始末がすぐカバーへ
      if (b.tsukiP && b.kind === 'pass' && b.intended === p.idx) { const tw = p.uniqLv >= 2 ? 1.5 : 0.4; p.tsukiRecv = S.t; p.tsukiGuard = S.t + tw; if (p.uOn > S.t) p.uOn = Math.min(p.uOn, S.t + tw); }   // 抜け出しのスピードは、受けてから1.5秒で終わる（あとはふつうのドリブル）   // 月影の抜け出し：受けた直後は奪われない
      b.tsukiP = false; b.trapP = false;
      // （指揮の余韻は廃止：港の指揮者はチーム全体の指揮に変わった）
      b.tact = false;
      if (b.hari && (b.intended === p.idx || b.intended < 0) && p.team === b.lastTeam && b.lastPlayer !== p.idx && !p.gk) {   // 針の穴通しの1本を受けた：止まらずにそのままゴールへ。シュート・次のプレーも正確に
        const d2 = b.hariLv >= 2 ? 3 : 2; p.tactBuff = S.t + d2; p.tactLv = b.hariLv; p.hariT = S.t + d2 + 3; p.tactBuff = p.hariT; p.hariLv = b.hariLv; act(p, 'hrbuf', d2 + 3, { lv: b.hariLv });
        if (fx(p.team, p.x) > L / 2) { const gx = fx(p.team, L) - p.x, gy = GOAL_Y - p.y, gl = hyp(gx, gy) || 1; S.dribbleDir = [gx / gl, gy / gl]; S.dribbleMode = 'break'; p.burstT = S.t + 0.5; p.protect = Math.max(p.protect || 0, S.t + 1.6); }
        for (const o of opps(p)) if (!o.gk && hyp(o.x - p.x, o.y - p.y) < 8) o.lagT = Math.max(o.lagT || 0, S.t + (b.hariLv >= 2 ? 1.3 : 1.1));   // 針の穴を通された：まわりのDFは一瞬反応が遅れる
      }
      if (b.byP && (b.intended === p.idx || b.intended < 0) && p.team === b.lastTeam && b.lastPlayer !== p.idx && !p.gk) {   // 白夜の視界のロングフィードを受けた：前を向いたまま運べる
        const d3 = b.byLv >= 2 ? 3 : 2; p.byT = S.t + d3; if ((p.byRunT || 0) > S.t) p.byRunT = S.t + 1.5; p.byLv = b.byLv; p.protect = Math.max(p.protect || 0, S.t + 0.8); act(p, 'bybuf', d3, { lv: b.byLv }); }
      if (b.aoP && p.team === b.lastTeam && b.lastPlayer !== p.idx && !p.gk && p.uniq !== 'aonoouza' && P[b.lastPlayer] && P[b.lastPlayer].uniq === 'aonoouza') { p.aoFast = Math.max(p.aoFast || 0, S.t + 3.5); p.aoKeepFast = true; p.finT = S.t + 9; S.decision = Math.min(S.decision, 0.08); }   // 蒼の王座：裏で受けた味方は、打つか離すまで抜け出す足のまま（追いつかれない）   // 蒼の王座：裏で受けた味方は、そのまま抜け出す足で（追いつかれない）
      if ((p.mdFree || 0) > S.t && p.team === b.lastTeam && P[b.lastPlayer] && P[b.lastPlayer].uniq === 'midori' && !p.gk) { p.mdFree = 0; p.mdDrive = S.t + 2.5; p.protect = Math.max(p.protect || 0, S.t + 1.0); act(p, 'mdfree', 1.6, { lv: T[p.team].mdBuildLv || 1 }); if (globalThis.__mdC) globalThis.__mdC.recv = (globalThis.__mdC.recv || 0) + 1; }   /* 版449 翠の起点：フリーで受けた味方は、前を向いて落ち着いてプレーできる */
      if (b.aoP && p.team === b.lastTeam && b.lastPlayer !== p.idx && !p.gk && p.uniq !== 'aonoouza') { p.finT = S.t + 4; p.protect = Math.max(p.protect || 0, S.t + 0.8); }   // 蒼の王座・渦潮の囮の1本を受けた：迷わずゴールへ運んで、GKとの距離を詰めて打つ
      if (b.aoFw && b.kind === 'pass' && b.lastTeam === p.team && b.lastPlayer !== p.idx && !p.gk) { p.protect = Math.max(p.protect || 0, S.t + 0.7); for (const o of opps(p)) if (!o.gk && hyp(o.x - p.x, o.y - p.y) < 3) o.lagT = Math.max(o.lagT || 0, S.t + 0.4); }   // 蒼の王座のパスを受けた味方：ぴたりと届くので、寄せてくる相手より一瞬早く、次のプレーに移れる
      b.byP = false; b.aoP = false; b.aoIn = false; b.aoFw = false; b.mdP = false;
      b.hari = false;
      // ドリブルの続き（自分で前へ出したボールを自分で拾う）でなければ、抜いた人数は数え直し
      if (S.dRun && !(p.idx === S.dRun.p && (b.selfPass || (b.kind !== 'pass' && b.kind !== 'shot' && b.lastPlayer === p.idx)))) S.dRun = null;
      // 股を抜かれたDFが先にボールに触った：相手とボールの間に体を入れ、肩でぶつかってマイボールにする（守備の基本）
      if (p.nmDef && S.t < p.nmDef.until && b.owner < 0) {
        // 股は抜かれたが、先にボールに追いついた：まず相手に背中を向けてボールを隠す（シールド）。相手が来たら肩・背中でぶつけてブロック
        const o = P[p.nmDef.o], ux = p.x - o.x, uy = p.y - o.y, ul = hyp(ux, uy) || 1;
        act(p, 'bodyIn', 1.2, { dx: ux / ul, dy: uy / ul }); p.protect = S.t + 1.4;
        p.shieldFrom = { o: o.idx, until: S.t + 1.4, bumped: false };
        p.nmDef = null;
      }
      S.charge = null;
      S.forceShot = null;
      const prevTeam = b.lastTeam, prevKind = b.kind, prevPlayer = b.lastPlayer, inAir0 = (b.z || 0) > 0.3, bSpd0 = hyp(b.vx || 0, b.vy || 0);
      // 版843：攻撃のスイッチ：何本かつないだ後、相手の中盤の間・前へ縦パスが入った瞬間に、チーム全体がテンポを上げる（6秒）
      if (prevKind === 'pass' && prevTeam === p.team && P[prevPlayer] && prevPlayer !== p.idx && !S.setPiece && (S.passStreak[p.team] || 0) >= 2 && fx(p.team, p.x) > L / 2 - 12 && fx(p.team, p.x) - fx(p.team, P[prevPlayer].x) > 7) { T[p.team].accelT = S.t + 6; T[p.team].ovlNext = 0; if (globalThis.__scnLog) globalThis.__scnLog.push(['acc', +S.t.toFixed(1), p.team]); if (globalThis.__ovDbg) globalThis.__ovDbg.acc++; }
      // 版843：奪い返し：失ってから3秒以内に、相手陣で奪い返した
      if (prevTeam != null && prevTeam !== p.team && S.t - (T[p.team].lostT ?? -9) < 3.5 && fx(p.team, p.x) > L / 2 - 10) stats[p.team].counterpress_wins++;
      if (prevTeam != null && prevTeam !== p.team) T[p.team].ownSince = S.t;
      if (globalThis.__ksStat) { const k = (globalThis.__ksStat[p.name] ||= { win: 0, recv: 0 }); if (prevTeam != null && prevTeam !== p.team) k.win++; else if (prevKind === 'pass' && prevPlayer !== p.idx) k.recv++; }
      // ボールが相手チームに渡ったら、前のプレーの続き（カットインからのシュートなど）は全部取り消す
      if (prevTeam != null && prevTeam !== p.team) { for (const q of P) { q.cutInShot = 0; q.wantShot = 0; } p.wonT = S.t; T[prevTeam].lostT = S.t; }
      if (globalThis.__lossLog && prevTeam !== p.team && prevTeam != null) globalThis.__lossLog.push({ xf: fx(prevTeam, b.x), how, kind: b.kind, lp: b.lastPlayer, predD: b.predD, predLen: b.predLen, trav: b.kicker >= 0 && P[b.kicker] ? hyp(b.x - P[b.kicker].x, b.y - P[b.kicker].y) : -1, z: b.z });
      if (p.gkAtk && prevTeam !== p.team && fx(p.team, p.x) > 15) act(p, 'gkplay', 1.2, { k: 'rushOut' });   // 吹き出しは、飛び出しのスキルを持っているGKだけ   // 飛び出し：裏へのボールを先に処理
      // パスの結果
      if (b.kind === 'pass' && b.selfPass) { b.kind = 'loose'; }
      if (b.kind === 'pass') {
        const kicker = P[b.kicker];
        if (p.team === kicker.team) {
          if (b.offside && b.intended === p.idx) {
            stats[p.team].offsides++;
            ev('offside', { team: p.team, player: p.name, number: p.number, passT: b.passT ?? S.t - 1, line: b.offLineX ?? p.x, ox: b.offX ?? p.x, oy: b.offY ?? p.y });
            const ox = b.offX ?? p.x, oy = b.offY ?? p.y;
            setRestart('free', 1 - p.team, ox, oy);
            S.restart.offside = true; S.restart.wait = Math.max(S.restart.wait, 4.6);
            return;
          }
          stats[p.team].passes_completed++;
                    if (b.otRet) { stats[p.team].one_two++; b.otRet = false; if (globalThis.__scnLog) globalThis.__scnLog.push(['12', +S.t.toFixed(1), p.team]); ev('onetwo', { team: p.team, player: p.name }); }
          const bs = (stats[p.team].byStyle ||= {}); (bs[b.style] ||= [0, 0])[0]++;
          S.passStreak[p.team]++;
        } else {
          stats[kicker.team].failed_passes++; 
                    const bs = (stats[kicker.team].byStyle ||= {}); (bs[b.style] ||= [0, 0])[1]++;
          S.passStreak[kicker.team] = 0;
        }
      }
      if (b.kind === 'shot' && p.team !== b.lastTeam) {
        if (p.gk) { stats[p.team].saves++; ev('save', { team: p.team, player: p.name }); }
        else ev('block', { team: p.team, player: p.name });
      }
      if (p.team !== prevTeam) {
        S.passStreak[prevTeam] = 0;
        // 奪った瞬間、相手の守備が整っていなければカウンター（前へのパス・裏への走りが増える）
        const behind = opps(p).filter((q) => !q.gk && fx(p.team, q.x) > fx(p.team, p.x)).length;
        S.counter = behind <= 6 && fx(p.team, p.x) > 15 ? 6 : 0;   // 版841：4→6秒、少し自陣寄りで奪っても
        if (S.counter && globalThis.__ctDbg) globalThis.__ctDbg.start.push({ t: S.t, team: p.team });
        if (S.counter) { ctLaunch(p); if (globalThis.__scnLog) globalThis.__scnLog.push(['ctr', +S.t.toFixed(1), p.team]); }   // 版842：奪った瞬間、前の選手が一斉にゴールへスプリント（中は斜めに裏へ、サイドは外のレーンを駆け上がる。ボールの後ろの中盤も追い越す）
        if (T[p.team].urg && fx(p.team, p.x) > L / 2) stats[p.team].high_wins++;
      }
      const inOwnBox = fx(p.team, b.x) < 16.5 && Math.abs(b.y - GOAL_Y) < 20.2;
      p.hold = p.gk && inOwnBox && !(b.kind === 'pass' && prevTeam === p.team && b.lastTeam === p.team);
      p.gkOutT = p.gk && !inOwnBox ? S.t : 0;   // エリアの外で触ったGKは、すぐ処理する
      // 自陣ゴール前で相手FWに寄せられながらこぼれ球を拾ったDF：迷わずクリア
      const pingPong = prevTeam != null && prevTeam !== p.team && S.t - (S.lastFlipT ?? -9) < 1.6;   // 版848：直前にも奪い合いで行き来したボール（当てて跳ね返り合い）
      if (prevTeam != null && prevTeam !== p.team) S.lastFlipT = S.t;
      if (!p.gk && prevKind !== 'pass' && !(pingPong && !(fx(p.team, p.x) < 11 && Math.abs(p.y - GOAL_Y) < 12)) && fx(p.team, p.x) < 26 && Math.abs(p.y - GOAL_Y) < 22 && nearestOpp(p, p.x, p.y).d < 4) S.mustClear = { i: p.idx, t: S.t };   // 跳ね返り合いの後は、ゴール目の前以外はまず収める
      if (p.hold) p.holdT = S.t;
      p.sdShown = false;
      Object.assign(b, { owner: p.idx, kind: 'owned', selfPass: false, vz: 0, bs: 0, drive: 0, lastTeam: p.team, lastPlayer: p.idx, intended: -1, offside: false, spin: 0, knuckle: false });
      S.poss = p.team;
      p.run = 0; p.dO = 0.5; p.dV = 0; p.bdir = null;
      if (globalThis.__pgCnt && (p.pgRun || 0) > S.t && prevKind === 'pass' && prevTeam === p.team) globalThis.__pgCnt.recv++;
      p.otRun = null; p.pgRun = 0;
      // 3人目の動き：味方から味方へパスが通った瞬間、もう1人が前のスペースへ走り出す（受けた選手の次のパスの先へ）
      if (prevKind === 'pass' && prevTeam === p.team && prevPlayer >= 0 && prevPlayer !== p.idx && !p.gk && !S.setPiece && fx(p.team, p.x) > L / 2 - 22 && R.next() < 0.75) {   // 版842：中盤からでも、3人目が動き出す
        const offL3 = offsideLine(p.team), bx = fx(p.team, p.x); let best = null, bs = -1e9;
        for (const m of mates(p)) { if (m === p || m.gk || m.off || m.idx === prevPlayer || m.position === 'DF' || (m.run > 0 && m.otRun)) continue; const mx = fx(p.team, m.x); if (mx < bx - 12 || mx > offL3 - 0.5 || hyp(m.x - p.x, m.y - p.y) > 30) continue;
          const v = Math.min(8, nearestOpp(m, m.x, m.y).d) * 0.3 + (mx - bx) * 0.08 + (m.position === 'FW' ? 0.6 : 0) + R.next(); if (v > bs) { bs = v; best = m; } }
        if (best) { pgGo(best, p, fx(p.team, best.x) > offL3 - 13 ? 'behind' : null); if ((best.pgRun || 0) > S.t) p.tmFor = { i: best.idx, t: S.t }; } }   // 版842：受けた選手は、3人目が走り出したのを見ている
      S.dribbleDir = null;
      // 触った瞬間の足：ボールの方へ足を出す（何に触ったかが見えるように）
      for (const q of P) { q.settle = false; q.moveQ = null; q.moveEnd = null; }
      {
        const rx = b.x - p.x, ry = b.y - p.y, rd = hyp(rx, ry);
        if (!p.hold) {
          if (rd > 0.05) act(p, 'poke', 0.35, { dx: rx / rd, dy: ry / rd, ...(how === 'tackle' ? {} : { trap: 1 }) });
          // 少し離れた所で止めたボールは、勢いを殺してその場に置き、選手の方が寄っていく
          const mv = hyp(p.vx, p.vy), behind = mv > 1 && (rx * p.vx + ry * p.vy) / (mv * (rd || 1)) < -0.2;
          if (behind && rd > 0.6 && !(how === 'control' && !p.gk && p.technique >= 55 && prevTeam === p.team)) {   // D1・D2（テクニックC以上）の受け手は、後ろへ流さない（足を伸ばして前へ置く）
            // 後ろへ流れたボール：足を伸ばして勢いを止め、振り向いて取りに行く
            p.settle = 'go'; p.settleT = 0; const k = how === 'tackle' ? 0.5 : 0.12; b.vx *= k; b.vy *= k;
          } else if (rd > 0.9) {
            // 少し離れたボール：足を伸ばして、自分の走る先へまっすぐ置く（ボールが曲がって吸い付かない）
            const lead = 0.45, ux = mv > 0.5 ? p.vx / mv : rx / (rd || 1), uy = mv > 0.5 ? p.vy / mv : ry / (rd || 1);
            const Tx = p.x + p.vx * lead + ux * 0.5, Ty = p.y + p.vy * lead + uy * 0.5;
            p.settle = 'meet'; p.settleT = 0; p.meet = [Tx, Ty];
            b.vx = (Tx - b.x) / lead; b.vy = (Ty - b.y) / lead;
          }
          else { p.bdir = rd > 0.05 ? [rx / rd, ry / rd] : null; p.dO = Math.max(0.3, rd); }
          // コントロールオリエンタード：テクニックC（55）以上なら、ファーストタッチで「次に進みたい方向」へボールを置く
          // （下手な選手は来た方向に止めるだけ。うまいほど、相手から遠ざけて前へ置ける）
          if (how === 'control' && !p.gk && b.z < 1.2) {
            const tq = p.technique, good = tq >= 55;
            if (good || R.next() < clamp((tq - 35) / 40, 0, 0.5)) {
              // 行きたい向き：相手ゴールの方向。近くの相手からは離れる
              let dx = sgn(p.team) * 1.0, dy = (GOAL_Y - p.y) * 0.025;
              for (const o of opps(p)) { const ox = p.x - o.x, oy = p.y - o.y, od = hyp(ox, oy); if (od < 7 && od > 0.01) { dx += (ox / od) * (7 - od) / 7 * 1.3; dy += (oy / od) * (7 - od) / 7 * 1.3; } }
              if ((p.y < 3 && dy < 0) || (p.y > W - 3 && dy > 0)) dy = 0;
              let dl = hyp(dx, dy) || 1; dx /= dl; dy /= dl;
              // うまさで、どこまで思った向きに置けるか（Sならほぼ完璧、Cでも十分）
              const qq = good ? clamp(0.65 + (tq - 55) / 90, 0.65, 1) : 0.35;
              const mv = hyp(p.vx, p.vy), cx = mv > 0.6 ? p.vx / mv : rd > 0.05 ? rx / rd : dx, cy = mv > 0.6 ? p.vy / mv : rd > 0.05 ? ry / rd : dy;
              let ux = cx + (dx - cx) * qq, uy = cy + (dy - cy) * qq; dl = hyp(ux, uy) || 1; ux /= dl; uy /= dl;
              const put = 0.75 + qq * 0.35, lead = 0.32, Tx = p.x + ux * put, Ty = p.y + uy * put;
              p.settle = 'meet'; p.settleT = 0; p.meet = [Tx, Ty]; p.bdir = [ux, uy];
              b.vx = (Tx - b.x) / lead; b.vy = (Ty - b.y) / lead; b.vz = 0;
              p.vx += ux * 1.2; p.vy += uy * 1.2;   // 置いた方へ体も向かう
              act(p, 'poke', 0.3, { dx: ux, dy: uy, trap: 1 });
            }
          }
        }
      }
      S.decision = p.gk ? (p.hold ? R.range(1.0, 1.8) : p.gkOutT === S.t ? 0.08 : 0.3) : S.mustClear && S.mustClear.i === p.idx ? 0.08 : clamp(R.range(0.25, 0.7) - p.vision * 0.004, 0.1, 0.7);   // うまい選手ほど判断が早い（プレーが速い）
      if (!p.gk && how !== 'tackle' && condLv(p.team)) S.decision = Math.min(S.decision, 0.28);
      if (uOn(p, 'kinshachi')) S.decision = Math.min(S.decision, p.uniqLv >= 2 ? 0.1 : 0.12);
      if (uOn(p, 'aonoouza')) { S.decision = Math.min(S.decision, 0.08); p.protect = Math.max(p.protect || 0, S.t + 1.0); }   // 蒼の王座：受けたら、食いついてきたCBをいなして、すぐに穴へ   // 金鯱の心臓：受けたらすぐ次へ（判断が速い）   // 港の指揮者：受けたらすぐ次へ（テンポよく回す）
      // ワンツーの壁役：トラップせずにダイレクトで返す
      S.oneTouch = false; p.otPass = false;
      if (!p.gk && how !== 'tackle' && !S.setPiece && fx(p.team, p.x) > L - 38 && prevTeam === p.team && prevKind === 'pass' && mates(p).some((m) => m !== p && !m.gk && !m.off && hyp(m.x - p.x, m.y - p.y) < 14) && opps(p).some((q) => !q.off && !q.gk && hyp(q.x - p.x, q.y - p.y) < 6)) {   // 版847：ゴール前で寄せられて受けたら、持たずに1〜2タッチではたく（うまい選手ほどダイレクト）
        S.decision = Math.min(S.decision, 0.12 + Math.max(0, 75 - p.vision) * 0.003);
        if (!S.oneTouch && R.next() < (p.pass + p.technique) / 330) { S.oneTouch = true; p.otPass = true; }
        if (globalThis.__qk) globalThis.__qk.quick++; }
      if (!p.gk && (T[p.team].accelT || 0) > S.t && how !== 'tackle') S.decision = Math.min(S.decision, 0.16 + Math.max(0, 70 - p.vision) * 0.003);   // 版843：スイッチが入ったら、持たずにテンポよく
      if (!p.gk && p.tmFor && p.tmFor.t === S.t && how !== 'tackle' && R.next() < 0.2 + (p.pass + p.vision) / 260) S.decision = Math.min(S.decision, 0.14);   // 版842：3人目が走り出したら、うまい選手ほど持たずにすぐ出す
      // ワンタッチパス（覚えている選手）：中盤より前で、受けた瞬間にダイレクトではたく
      if (!p.gk && skZ(p, 'oneTouchPass') && fx(p.team, p.x) > 35 && how !== 'tackle' && b.kind !== 'loose' && R.next() < (fx(p.team, p.x) > L - 35 ? 0.42 : 0.18)) { S.decision = 0.06; S.oneTouch = true; p.otPass = true; }
      if (!p.gk && S.oneTwo && S.oneTwo.b === p.idx && S.t - S.oneTwo.t < 3 && fx(p.team, p.x) > L - 68 && how !== 'tackle') { S.decision = 0.06; S.oneTouch = true; }
      // 港の指揮者：指揮の間は、味方からのパスをダイレクト・ワンタッチでテンポよくつなぐ。受けるたびに、前の味方が空いた所へ動き直す
      if (!p.gk && prevPlayer !== p.idx && condLv(p.team) && fx(p.team, p.x) < L - 20) {   // 味方のパスでも、こぼれ球でも、受けたらダイレクト
        S.decision = R.range(0.05, 0.12); S.oneTouch = true; S.oneTouchBoost = true; if (globalThis.__cdLog) globalThis.__cdLog.push(['recv', +S.t.toFixed(2), p.idx]);
        if (S.t >= (T[p.team].cdNext || 0)) { T[p.team].cdNext = S.t + 1.0; tactStart(p); } }
      // ゴール前のこぼれ球・折り返しは、トラップせずにダイレクトで流し込む（貪欲にゴールへ）
      if (!p.gk && how !== 'tackle' && how !== 'save' && !S.restart && !(prevTeam !== p.team && prevKind === 'pass')) {   // 相手のパスを拾った時は、まず収める
        const xf2 = fx(p.team, p.x), dG = hyp(L - xf2, GOAL_Y - p.y), dir0 = false;   // ダイレクトは技ではなく、だれでもする標準の打ち方（吹き出しなし）
        if (xf2 > L - (dir0 ? 19 : 17) && Math.abs(p.y - GOAL_Y) < (dir0 ? 15 : 13) && dG < (dir0 ? 18 : 15)) {
          const gx = fx(p.team, L);
          const blockers = opps(p).filter((q) => !q.gk && segDist(q.x, q.y, p.x, p.y, gx, GOAL_Y).d < 1.2).length;
          if (blockers === 0 && R.next() < (dir0 ? 0.92 : 0.4) + p.technique * 0.003) {
            const gk = opps(p).find((q) => q.gk) || opps(p)[0];
            // GKのいない側（ニアが空いていればニア）へ
            const aim = GOAL_Y + (gk.y > GOAL_Y ? -1 : 1) * R.range(2.0, 3.0);
            // ワンタッチで合わせる：一瞬で振り抜くが、足を振る動きは見せる
            S.forceShot = aim; S.forceHow = 'oneTouch'; S.decision = 0.2;   // ワンタッチで合わせる（技は重ねない）
          }
        }
      }
      // 版843：エリアの外のこぼれ球：クリア・はじかれた浮き球や転がってきたボールを、エリアの外（ゴールまで16〜27m）からダイレクトで打つ（キック・ボレー・ミドルが得意な選手ほど狙う）
      if (!p.gk && S.forceShot == null && how !== 'tackle' && !S.restart && !S.setPiece && (inAir0 || bSpd0 > 5) && (prevTeam !== p.team || (S.lastShotT != null && S.t - S.lastShotT < 3.5 && S.lastShotTeam === p.team && prevKind !== 'pass'))) {
        const xf4 = fx(p.team, p.x), gx4 = fx(p.team, L);
        if (xf4 > L - 27 && xf4 < L - 15 && Math.abs(p.y - GOAL_Y) < 14) {
          const bl = opps(p).filter((q) => !q.gk && !q.off && segDist(q.x, q.y, p.x, p.y, gx4, GOAL_Y).d < 1.2 && segDist(q.x, q.y, p.x, p.y, gx4, GOAL_Y).u > 0.04).length;
          if (bl <= 1 && R.next() < 0.12 + p.kick / 400 + (p.sk.has('volley') ? 0.25 : 0) + (p.sk.has('powerMid') ? 0.15 : 0) + ((p.rbWait || 0) > S.t - 0.5 ? 0.15 : 0)) {
            const gk = opps(p).find((q) => q.gk && !q.off), side = gk && Math.abs(gk.y - GOAL_Y) > 0.4 ? (gk.y > GOAL_Y ? -1 : 1) : (R.next() < 0.5 ? -1 : 1);
            S.forceShot = GOAL_Y + side * R.range(1.5, 3.2); S.forceHow = inAir0 && p.sk.has('volley') ? 'volley' : 'oneTouch'; S.decision = 0.1; stats[p.team].edge_volleys++; if (globalThis.__scnLog) globalThis.__scnLog.push(['vol', +S.t.toFixed(1), p.team]);
          }
        }
      }
      // シュートのこぼれ球（GKがはじいた・ポストやバーに当たった）を詰める時は、ドリブルせずにまずシュート
      if (!p.gk && S.forceShot == null && how !== 'tackle' && !S.restart && !S.setPiece && S.lastShotT != null && S.t - S.lastShotT < 3.5 && S.lastShotTeam === p.team && prevKind !== 'pass') {
        const xf3 = fx(p.team, p.x), dy3 = Math.abs(p.y - GOAL_Y), dG3 = hyp(L - xf3, GOAL_Y - p.y);
        if (xf3 > L - 17 && dy3 < 16 && dG3 < 18) {
          const gk = opps(p).find((q) => q.gk && !q.off), side = gk ? (Math.abs(gk.y - GOAL_Y) > 0.4 ? (gk.y > GOAL_Y ? -1 : 1) : (p.y > GOAL_Y ? -1 : 1)) : 1;
          S.forceShot = GOAL_Y + side * R.range(1.8, 3.0); S.forceHow = 'oneTouch'; S.decision = 0.12; S.lastShotT = null;
        }
      }
      // 蒼の王座：折り返しを受けたくもいは、トラップせずにダイレクトでゴールの空いている側へ
      if (globalThis.__aoCut && (p.aoFin || 0) > S.t) (globalThis.__aoCut.log ||= []).push({ g: +S.t.toFixed(1), who: p.idx, u: p.uniq, pk: prevKind, x: +fx(p.team, p.x).toFixed(1), y: +p.y.toFixed(1) });
      if ((p.aoFin || 0) > S.t && p.uniq === 'aonoouza' && prevKind === 'pass' && prevTeam === p.team && !S.setPiece) { p.aoFin = 0;
        const xq = fx(p.team, p.x), dG = hyp(L - xq, GOAL_Y - p.y);
        if (dG < 23) { const gk = opps(p).find((q) => q.gk && !q.off), side = gk ? (Math.abs(gk.y - GOAL_Y) > 0.4 ? (gk.y > GOAL_Y ? -1 : 1) : (p.y > GOAL_Y ? -1 : 1)) : 1;
          S.forceShot = GOAL_Y + side * R.range(2.0, 3.0); S.forceHow = 'oneTouch'; S.decision = 0.1; act(p, 'aoflash', 0.9, { lv: p.uniqLv || 1 }); if (globalThis.__aoCut) globalThis.__aoCut.fin++; } }
      if (uOn(p, 'tetsurou') && prevTeam != null && prevTeam !== p.team && !S.setPiece) { p.uTetsu = S.t + 2.5; act(p, 'ttsteal', 0.8, { lv: p.uniqLv || 1 }); S.decision = Math.min(S.decision, 0.15); }   // 鉄狼の関所：奪ったら、すぐ前へ
      if ((p.kmFin || 0) > S.t && prevKind === 'pass' && prevTeam === p.team && P[prevPlayer] && !S.setPiece) { p.kmFin = 0; p.kmRunT = 0;   // 影の一刺しを受けたFW：トラップせずに、そのまま打つ（遠ければ運んで打つ）
        const xq = fx(p.team, p.x), dG = hyp(L - xq, GOAL_Y - p.y); if (globalThis.__kmC) globalThis.__kmC.recv++;
        if (dG < 21) { const gk = opps(p).find((q) => q.gk && !q.off), side = gk ? (Math.abs(gk.y - GOAL_Y) > 0.4 ? (gk.y > GOAL_Y ? -1 : 1) : (p.y > GOAL_Y ? -1 : 1)) : 1; S.forceShot = GOAL_Y + side * R.range(2.2, 3.2); S.forceHow = 'oneTouch'; S.decision = 0.1; }
        else { p.finT = S.t + 3; p.protect = Math.max(p.protect || 0, S.t + 0.6); } }
      // 月影の抜け出し：受けた場所で決める。ペナルティエリアに入った所・GKの目の前ならダイレクトでゴールの空いている側へ。バイタル（アーク付近）より手前ならドリブルで運ぶ
      if (p.tsukiRecv === S.t && !S.setPiece) {
        const xq = fx(p.team, p.x), inBox = xq > L - 16.5 && Math.abs(p.y - GOAL_Y) < 20.16;
        const gk = opps(p).find((q) => q.gk && !q.off), gkNear = gk && hyp(gk.x - p.x, gk.y - p.y) < 7;
        if (globalThis.__tr) globalThis.__tr.push({ t: S.t, xq: +xq.toFixed(1), dy: +(p.y - GOAL_Y).toFixed(1), gkD: gk ? +hyp(gk.x - p.x, gk.y - p.y).toFixed(1) : 99, direct: !!(inBox || gkNear) });
        if (inBox || gkNear) {
          const side = gk ? (Math.abs(gk.y - GOAL_Y) > 0.4 ? (gk.y > GOAL_Y ? -1 : 1) : (p.y > GOAL_Y ? -1 : 1)) : 1;   // GKのいない側（GKが真ん中ならファー）
          S.forceShot = GOAL_Y + side * R.range(2.3, 3.1); S.forceHow = null; S.decision = 0.12; p.tsukiRecv = 0; p.tsukiDirect = S.t;
        }
      }
    }

    // 反則：場所によって直接FKかPK。悪質さに応じて審判がカードを出す
    function commitFoul(q, own, sev) {
      stats[q.team].fouls++;
      const att = own.team, xf = fx(att, own.x);
      const inBox = xf > L - 16.5 && Math.abs(own.y - GOAL_Y) < 20.16;
      const lastMan = xf > 62 && !T[q.team].players.some((d) => !d.gk && d !== q && fx(att, d.x) > xf);
      ev('foul', { team: q.team, player: q.name, inBox });
      S.refFocus = { x: own.x, y: own.y, t: 3 };
      const r = R.next();
      let card = null;
      if (lastMan && !inBox && r < 0.55) card = 'red';
      else if (r < (sev ? SLIDE_RULE[sev].red : 0.025)) card = 'red';
      else if (r < (sev ? SLIDE_RULE[sev].yellow : 0.2) + q.physical * 0.0015 + (inBox || lastMan ? 0.3 : 0)) card = 'yellow';
      if (card && !q.gk) giveCard(q, card);
      if (inBox) setRestart('penalty', att, fx(att, L - 11), GOAL_Y, penaltyTaker(att));
      else {
        // ゴールに近いFKは、直接FKを覚えている選手が蹴る
        const spec = T[att].players.filter((p) => p.sk.has('fk') && !p.gk && !p.off);
        const near = fx(att, own.x) > L - 32 && Math.abs(own.y - GOAL_Y) < 24;
        const fkR = T[att].role && T[att].role.fk;   // 指名されたFKキッカー
        setRestart('free', att, own.x, own.y, near ? (fkR && !fkR.off ? fkR.idx : spec.length ? spec[0].idx : own.idx) : own.idx);
      }
      // 反則の瞬間：足を出した選手が相手にぶつかり、倒された側はぶつかった向きへ倒れる
      { const ux = own.x - q.x, uy = own.y - q.y, ud = hyp(ux, uy) || 1;
        if (!(q.slideT > 0)) act(q, 'fouler', 0.9, { o: own.idx, dx: ux / ud, dy: uy / ud });
        act(own, 'fall', 1.3, { o: q.idx, dx: ux / ud, dy: uy / ud });
        own.vx = (ux / ud) * 2; own.vy = (uy / ud) * 2; q.vx *= 0.3; q.vy *= 0.3; }
      own.downT = Math.max(own.downT || 0, 1.1); own.settle = false;
    }
    function penaltyTaker(ti) {
      const r = T[ti].role && T[ti].role.pk; if (r && !r.off) return r.idx;   // 指名されたPKキッカー
      return T[ti].players.filter((p) => !p.gk).reduce((a, c) => (c.kick + c.mental * 0.5 + (c.sk.has('pkMaster') ? 60 : 0) > a.kick + a.mental * 0.5 + (a.sk.has('pkMaster') ? 60 : 0) ? c : a)).idx;
    }
    function giveCard(p, color) {
      let second = false;
      if (color === 'yellow') { p.yellow = (p.yellow || 0) + 1; if (p.yellow >= 2) { color = 'red'; second = true; } }
      stats[p.team][color === 'red' ? 'reds' : 'yellows']++;
      ev('card', { team: p.team, player: p.name, number: p.number, color, second });
      S.refCard = { code: color === 'red' ? 2 : 1, t: 5.6, p, show: false };   // 主審が反則した選手の前まで行ってから、カードを掲げる
      if (color === 'red') {
        p.off = true;
        T[p.team].players = T[p.team].players.filter((x) => x !== p);
      }
    }

    // パンチング（スキル）：スペースか味方を狙ってはじく。持っていなければ前・外へ大きく
    function punchTo(p, b, hard) {
      if (p.sk.has('punching')) {
        const mts = mates(p).filter((m) => !m.gk && fx(p.team, m.x) > fx(p.team, p.x) + 8 && hyp(m.x - p.x, m.y - p.y) < 30);
        const tgt = mts.sort((a, c) => nearestOpp(c, c.x, c.y).d - nearestOpp(a, a.x, a.y).d)[0];
        const tx = tgt ? tgt.x : p.x + sgn(p.team) * 18, ty = tgt ? tgt.y : (p.y < GOAL_Y ? R.range(4, 14) : W - R.range(4, 14));
        const dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy) || 1, v = clamp(d * 0.7, 9, 17);
        act(p, 'gkplay', 1.2, { k: 'punching' });   // パンチングの吹き出しは出さない
        Object.assign(b, { vx: (dx / d) * v, vy: (dy / d) * v, vz: R.range(4.5, 6.5), z: Math.max(b.z, 1.8), kind: tgt ? 'pass' : 'loose', intended: tgt ? tgt.idx : -1, kicker: p.idx, lastTeam: p.team, lastPlayer: p.idx, spin: 0, knuckle: false, offside: false });
        return;
      }
      // テクニックが高いほど、ゴール前から遠いサイドへ大きく逃がす（下手だと正面にこぼす）
      const safe = R.next() < 0.25 + p.technique * 0.0065 + (uOn(p, 'ikari') ? 0.5 * gkF(p) : 0), side = p.y < GOAL_Y ? -1 : 1;   // 白亜の城壁：はじく時も、相手のいない外へ正確に逃がす
      Object.assign(b, { vx: sgn(p.team) * (safe ? R.range(9, 14) : hard ? R.range(5, 10) : R.range(3, 7)), vy: safe ? side * R.range(5, 9) : R.gauss() * 5, vz: R.range(4, 7), z: Math.max(b.z, hard ? 1.6 : 1.8), kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, spin: 0, knuckle: false, intended: -1 });
    }
    // GKがこのシュートを止められる確率（触った瞬間と、横っ跳びを始める瞬間の両方で使う）
    const CLOSE_FINISH = 0.78;   // 近距離シュートの決まりやすさ（得点の多さの調整用）
    function gkSaveProb(p, b, off, yAt, sp) {
            // GKの能力（テクニック・スピード・フィジカル）でセーブ率が決まる。速い球・近い距離・隅のコースは止めにくい
            const skill = p.vision * 0.25 + p.technique * 0.3 + p.jump * 0.2 + p.dash * 0.1 + p.mental * 0.15;   // 判断力が土台
            const shotD = b.shotFrom != null ? Math.max(1, b.shotFrom - 2) : hyp(P[b.kicker].x - p.x, P[b.kicker].y - p.y);   // 蹴った位置からの距離（蹴った選手はその後も走るので、今の位置では測らない）
            // コース：GKの体からどれだけ離れているか（正面ならほぼ止める）。隅は止めにくい
            const corner = Math.abs(yAt - GOAL_Y) > 2.6 ? 0.12 : 0;
            const pace = sp < 12 ? 0.12 : sp < 15 ? 0.04 : sp > 19 ? -Math.min(0.22, (sp - 19) * 0.03) : 0;   // 弱いシュートは簡単、強烈なのは難しい
            const trick = b.knuckle ? 0.1 : Math.abs(b.spin || 0) > 0.4 ? 0.06 : 0;          // 無回転・カーブは難しい
            // 角度：シュート位置から見えるゴールの幅（ラジアン）。角度がないほど、近くても・1対1でも、GKの正面に来やすい
            let visA = 1; if (b.sx0 != null && b.kind === 'shot' && !b.pkShot) { const ex = Math.abs(fx(p.team, 0) - b.sx0), ey = Math.abs(b.sy0 - GOAL_Y); if (ey > POST) visA = Math.atan2(ey + POST, ex) - Math.atan2(ey - POST, ex); }
            const narrowF = clamp(visA / 0.6, b.shotSkill === 'controlShot' ? 0.55 : 0.15, 1);   // コントロールショットは角度がなくても巻いて隅へ置けるが、真横からは楽ではない
            let prob = clamp(0.27 + (skill - 50) * 0.0058 + (1 - Math.min(1, off)) * 0.32 + pace + (shotD > 20 ? 0.2 : shotD > 16 ? 0.08 : shotD < 9 ? -0.12 : 0) - corner - trick, 0.08, 0.97);
            if (p.diveT > 0) prob -= 0.04;
            prob += p.gkAtk ? -0.04 : 0.025;   // 守備的GKはセービングが高い
            const oneGK = b.oneOnOne && p.sk.has('oneOnOne');
            if (b.oneOnOne) prob -= (oneGK ? 0.24 : 0.62) * (P[b.kicker].technique / 100) * narrowF;   // 1対1でうまく流し込まれると止められない（1対1の鬼は体を投げ出して当てる）
            prob -= b.gkPen || 0;
            const ik = p.uniq === 'ikari' && ((b.kind === 'shot' && (b.shotOnTarget || Math.abs(yAt - GOAL_Y) < POST + 0.3)) || b.pkShot) && uFire(p, 'ikari');   // 白亜の城壁：シュートを打たれるたびに出る
                        if (ik) prob += 0.38 * gP(p) + (Math.min(1.0, b.gkPen || 0) * 0.85 + (b.guren ? 0.12 : 0)) * gkF(p) + ((b.oneOnOne || b.pkShot) ? 0.3 * gP(p) : 0);   // どんなシュートにも強い（技のシュートの効き目も半分に）。1対1・PKはさらに
            if (b.brk) prob += 0.2 + Math.max(0, p.vision - 60) * 0.004;   // 抜け出しからの1対1：うまいGKほど、待ち構えて止める
            if (p.type === 'スイーパーキーパー' && ((p.skRead || 0) > S.t || uOn(p, 'sutemi')) && b.shotFrom != null && P[b.kicker] && fx(P[b.kicker].team, p.x) > fx(P[b.kicker].team, P[b.kicker].x) && hyp(P[b.kicker].x - p.x, P[b.kicker].y - p.y) < 9) prob += (b.oneOnOne ? 0.5 : 0.25) + (uOn(p, 'sutemi') ? 0.15 * uP(p) : 0);   // 読んで詰めていたスイーパーキーパー：角度を消して体で止める   // 白亜の城壁：1対1・PKのセーブ率が大きく上がる
            if (b.drive > 0 && b.driveOn) prob -= 0.15;   // 急に落ちてくるドライブ：GKの目測が狂う
            // 角度のない所からのシュート：見えるゴールの幅が狭く、ニアに立つGKのほぼ正面。しっかり止める（コントロールショットで巻いた球は別）
            if (b.sx0 != null && b.kind === 'shot' && !b.pkShot) {
              const gxl = fx(p.team, 0), ex = Math.abs(gxl - b.sx0), ey = Math.abs(b.sy0 - GOAL_Y);
              const vis = Math.atan2(ey + POST, ex) - Math.atan2(Math.max(0, ey - POST), ex);   // シュート位置から見えるゴールの角度（ラジアン）
              if (ey > POST && vis < 0.45) prob += (0.45 - vis) * (b.shotSkill === 'controlShot' ? 0.6 : 2.0);   // 角度が狭いほど止めやすい（真横に近いほど大きく上がる）
            }
            // 蹴った選手のうまさ（キック・テクニック）：Sの選手が打てば、弱いGKではまず止められない
            { const kq = P[b.kicker]; prob -= Math.max(0, (kq.kick * 0.6 + kq.technique * 0.4) - skill) * 0.022 * Math.min(1, 0.45 + off * 1.6) * (0.4 + 0.6 * narrowF); }
            // ゴール前（PA内）の近いシュートは決まりやすく：崩して打った近距離シュートは、GKもなかなか止められない
            if (shotD < 16) prob -= CLOSE_FINISH * (1 - shotD / 22) * clamp(1.4 - skill / 100, 0.35, 1) * narrowF;   // うまいGKほど至近距離でも反応できる
            // 正面へのゆるいシュートは、相手が誰でも止める
            { const gl = fx(p.team, 0), yGl = b.y + b.vy * ((gl - b.x) / (b.vx || 1e-6)); if ((Math.abs(yGl - p.y) < 1.1 || Math.abs(yAt - p.y) < 0.8) && sp < 15.5 && !b.knuckle && !b.curveAll && !(b.drive > 0 && b.driveOn)) prob = Math.max(prob, 0.62 + skill * 0.0035); }   // GKの正面に来たゆるい球は止める（下手なGKはたまにこぼす）   // シュート技（トゥーキック・ニア上など）はGKが反応しにくい
            // 構えているGKに、地面を転がるゆるいシュート（コロコロ）は通用しない
            const rolling = b.z < 0.4 && b.vz < 1 && sp < 12.5 && fx(p.team, p.x) < 6 && !(b.csPlace && b.csGkNear > 0.5);   // ニア寄りのGKの逆を突くコロコロは別
            if (rolling) prob = Math.max(prob, 0.96);
            // クロスがそのままゴールへ向かってきた：GKは落ち着いて処理する
            if (b.conv) prob = Math.max(prob, 0.93);
            // PKストッパー：読みが当たれば高確率で触る
            if (b.pkStop) prob = Math.max(prob, 0.82);
            // ミドル・ロング・直接FK：ヒョロヒョロの球は入らない。入るのは「強い球」か「甘くないコース（隅）」だけ
            const gkQ = clamp((skill - 50) / 40, 0, 1) * clamp((shotD - 12) / 6, 0, 1);   // 版790：GKのうまさ×遠さ（遠いほど反応する時間がある）
            if (shotD > 14 && !b.pkStop) {
              const tight = Math.abs(yAt - GOAL_Y) > POST - 1.1 || (b.z > BAR - 0.7 && Math.abs(yAt - GOAL_Y) > POST - 1.8);   // サイドネットぎりぎり・上の隅
              if (b.csPlace && b.csType === 'ground' && !(b.csGkNear > 0.5)) prob = Math.max(prob, 0.92);   // コロコロ：GKがニア寄りでなければ、構えて止める
              else if (b.csPlace && Math.abs(yAt - GOAL_Y) > POST - 1.6) prob = Math.max(prob, 0.38);   // 置きに行くコントロールショット：隅へ正確に置いた球は止めにくいが、うまいGKなら指先で届くこともある
              else if (b.drive > 0 && b.driveOn) { /* ドライブシュート：バーの上を越えると見せて急に落ちる球は、GKの目測が狂う */ }
              else if (sp < 16.5 && !b.knuckle) prob = Math.max(prob, tight ? 0.86 : 0.96);
              else if (sp < 21 && !tight) prob = Math.max(prob, 0.72 + 0.22 * gkQ);
              else if (!tight) prob = Math.max(prob, 0.5 + 0.4 * gkQ);
              else prob = Math.max(prob, 0.7 * gkQ);   // 版790：隅ぎりぎりの強い球も、うまいGKは遠めなら反応できる（D1でミドル・ロングが4割近く入っていた）
            }
            if (globalThis.__dpl && b.drive > 0) globalThis.__dpl.push({ t: S.t, prob: +prob.toFixed(2), vz: +b.vz.toFixed(1), on: b.driveOn, sp: +sp.toFixed(1), kind: b.kind });
            if (ik) prob = Math.max(prob, 0.3 * gP(p)) + 0.08 * gkF(p);   // 至近距離の決定機でも、簡単には割らせない
            if (visA < 0.3 && b.shotSkill !== 'controlShot' && !b.pkShot) prob = Math.max(prob, 0.8 + (0.3 - visA));   // ほぼ真横（角度なし）からのシュートは、GKの正面。まず止める
            if (p.uniq === 'sutemi' && b.kind === 'shot') prob = Math.max(prob, 0.25 * gkF(p)) + 0.4 * gP(p);   // 捨て身の守護神（なかむら）：国内屈指のGK。ふつうのGKよりはっきり止める（れんのには及ばない）
            if (b.guren && !b.pkShot) prob -= (b.guren >= 2 ? 0.14 : 0.1) * (b.grF ?? 1);   // 紅蓮の牙：正面に来ても、勢いでGKの手をはじく
            if (b.tsukiShot) prob = Math.max(prob, 0) + (b.csPlace ? 0.26 : 0.14);   // 月影の抜け出し（無凸）の後のシュートは、GKも待ち構えて止めやすい（エースのかとうより決定力は下）
            if (globalThis.__gkp && off < 0.2 && shotD > 16) globalThis.__gkp.push({ prob, skill, shotD, sp, corner, pace, trick, kq: P[b.kicker].kick * 0.6 + P[b.kicker].technique * 0.4, base: 0.27 + (skill - 50) * 0.0058 + (1 - Math.min(1, off)) * 0.32, drive: b.drive > 0 && b.driveOn, guren: !!b.guren, kn: !!b.knuckle });
            return { prob, skill, shotD, oneGK, rolling };
    }
    // カットインの角度：前から内側へ 25°〜90°（真横）の5つから選ぶ（ゲームとカットイン確認画面で同じ計算）
    const CUT_ANG = [25, 40, 55, 70, 90];   // 斜め〜真横
    function cutInScores(px, py, fdx, fdy, inY, gxL, gyC, opps2, beyond) {
      return CUT_ANG.map((deg) => {
        const a = deg * Math.PI / 180;
        // 前（fdx,fdy）から内側（inY の向き）へ deg 度
        const vx = fdx * Math.cos(a) + (-fdy) * inY * Math.sin(a) * Math.sign(fdx || 1), vy = fdy * Math.cos(a) + fdx * inY * Math.sin(a) * Math.sign(fdx || 1);
        const l = hyp(vx, vy) || 1, ux = vx / l, uy = vy / l, ex = px + ux * 5, ey = py + uy * 5;
        let space = 4; for (const o of opps2) space = Math.min(space, segDist(o.x, o.y, px, py, ex, ey).d);
        let sc = space * 0.45 - hyp(gxL - ex, gyC - ey) * 0.09;
        if (beyond(ex)) sc -= 3;   // ゴールライン（エンドライン）の外へ出てしまう角度はダメ
        return { deg, ux, uy, sc };
      });
    }
    function cutInAngle(own, q, fdx, fdy, inY) {
      const opps2 = opps(own).filter((o) => o !== q && !o.gk);
      const cs = cutInScores(own.x, own.y, fdx, fdy, inY, fx(own.team, L), GOAL_Y, opps2, (ex) => fx(own.team, ex) > L - 0.8);
      const sharp = 0.3 + own.vision / 40; let tot = 0; for (const c of cs) { c.w = Math.pow(Math.exp(c.sc * 2), sharp); tot += c.w; }
      let r = R.next() * tot, pick = cs[2]; for (const c of cs) { r -= c.w; if (r <= 0) { pick = c; break; } }
      if (globalThis.__cutLog) globalThis.__cutLog.push(pick.deg);
      return [pick.ux, pick.uy];
    }
    // 運ぶドリブルの向き：16方向から一番良い向きを選ぶ
    //  ①取られない（寄せてくる相手の方へは行かない。近いほど強く避ける）を一番に守りつつ、
    //  ②縦→横→後ろの順に良い（前へ進めるなら前、ダメなら横、横もダメなら後ろ）
    //  ③前で待っている味方（FW）の方へ体を向けておく（いつでも縦パスを出せるように）
    //  ④今の向きを保つ（相手を背にしたら真っ直ぐ、グネグネしない）
    function carryDir(p) {
      const gx = fx(p.team, L) - p.x, gy = (GOAL_Y - p.y) * 0.35, gl = hyp(gx, gy) || 1, ux = gx / gl, uy = gy / gl;
      const xf = fx(p.team, p.x);
      const fw = mates(p).filter((m) => !m.gk && fx(p.team, m.x) > xf + 5 && hyp(m.x - p.x, m.y - p.y) < 35 && nearestOpp(m, m.x, m.y).d > 3).sort((a, b) => fx(p.team, b.x) - fx(p.team, a.x))[0];
      const thr = opps(p).filter((q) => !q.gk).map((q) => ({ q, d: hyp(q.x - p.x, q.y - p.y) })).filter((o) => o.d < 9);
      const cur = S.dribbleMode === 'carry' && S.dribbleDir ? S.dribbleDir : null;
      let best = null, bs = -1e9;
      for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, vx = Math.cos(a), vy = Math.sin(a);
        let sc = (vx * ux + vy * uy) * 1.0;   // 縦→横→後ろ
        for (const o of thr) { const tq = ((o.q.x - p.x) * vx + (o.q.y - p.y) * vy) / o.d; if (tq > -0.2) sc -= (tq + 0.2) * 2.6 * clamp(4 / o.d, 0.45, 3); }   // 相手の方へは行かない
        if (fw) { const fd = hyp(fw.x - p.x, fw.y - p.y); sc += ((fw.x - p.x) * vx + (fw.y - p.y) * vy) / fd * 0.45; }   // 前で待つFWへ意識を向ける
        if (cur) sc += (vx * cur[0] + vy * cur[1]) * 0.45;   // 今の向きを保つ
        if ((p.y < 4 && vy < -0.2) || (p.y > W - 4 && vy > 0.2)) sc -= 2;   // タッチラインの外へは行かない
        if (sc > bs) { bs = sc; best = [vx, vy]; }
      }
      p.carryFW = fw ? fw.idx : -1;
      return best;
    }
    // スライディングがどこから来たか：ドリブルの進む向きと、滑り込む向きで決める
    //  後ろから（同じ向きに滑る）＝ボールが見えずに足に行きやすい → 反則・カードが多い
    //  正面から（向かい合う）＝ボールに行ける → 反則は少ない／横からは五分五分
    function slideFrom(q, own, dx, dy) {
      let mx = own.vx, my = own.vy, ml = hyp(mx, my);
      if (ml < 1) { mx = fx(own.team, L) - own.x; my = (GOAL_Y - own.y) * 0.35; ml = hyp(mx, my) || 1; }
      const c = (mx * dx + my * dy) / ml;
      return c > 0.45 ? 'back' : c < -0.45 ? 'front' : 'side';
    }
    const SLIDE_RULE = {   // 外れたときに反則になる確率・カードの出やすさ
      back: { foul: 0.45, win: -0.1, yellow: 0.42, red: 0.015 },
      side: { foul: 0.22, win: 0, yellow: 0.2, red: 0.01 },
      front: { foul: 0.06, win: 0.04, yellow: 0.06, red: 0.005 },
    };
    function slideTackle(q, own) {
      const b = S.ball;
      const dx = b.x - q.x, dy = b.y - q.y, d = hyp(dx, dy) || 1;
      const from = slideFrom(q, own, dx / d, dy / d), rule = SLIDE_RULE[from];
      q.slideT = 0.45; q.vx = (dx / d) * 7.5; q.vy = (dy / d) * 7.5; q.tackleCd = 2.2;
      act(q, 'slide', 1.25, { dx: dx / d, dy: dy / d, from });
      const myb = uOn(q, 'miyabi') || q.mybStay, pS = 0.5 + (q.defense + q.physical - own.dribble - own.physical) * 0.005 + rule.win + (myb ? 0.18 * uP(q) : 0) + (q.uniq === 'kinshachi' ? 0.1 : 0);   // 雅の後始末：ボールだけをきれいにかき出す
      const roll = R.next(), won = roll < clamp(pS, 0.2, myb ? 0.92 : 0.85), foul = !won && R.next() < rule.foul * (myb ? 0.4 : q.uniq === 'kinshachi' ? 0.6 : 1);
      if (globalThis.__slideLog) globalThis.__slideLog.push({ from, won, foul });
      if (won) {
        // ボールだけをかき出す
        stats[q.team].tackles_won++; stats[own.team].tackles_lost++;
        const a = Math.atan2(dy, dx) + R.gauss() * 0.35, v = R.range(4, 8);
        own.settle = false;
        Object.assign(b, { owner: -1, kind: 'loose', vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0, z: 0, lastTeam: q.team, lastPlayer: q.idx, intended: -1 });
        own.touchCd = 0.6; own.stun = 0.5; S.dribbleDir = null;
        ev('tackle', { team: q.team, player: q.name, slide: true });
        if (rec) { const sa = actions[actions.length - 1]; if (sa && sa.i === q.idx && sa.a === 'slide') sa.won = 1; }   // 滑り込んでボールをかき出した（勝ちの印を出す）
        act(own, 'lose', 0.8, { o: q.idx });
      } else if (foul) {
        commitFoul(q, own, from);
      } else {
        stats[own.team].dribbles_past++; noteBeat(own, q);
        slideDodge(own, q, dx / d, dy / d, from);
      }
    }
    // ダブルタッチの足の運び：d＝技の長さ（秒）。最初の12%で踏み込み、45%までに2タッチで横へ約1.8m（1人分）、そのあと斜め前へ加速
    // 版666：ヒールリフト
    //  ①0.42秒：止まって、前の足の裏でボールを後ろへ転がし、後ろの足のかかとの上へ乗せる（この間は奪われない）
    //  ②かかとで背中越しに跳ね上げる：ボールは自分と相手の頭の上を高く（高さ約3.8m）越えて、前へ大きく（自分から約9m先・相手の向こう側）落ちる（版670・671）
    //  ③自分は相手の横を回り込んで、落ちてくるボールを拾う。相手は振り返ってボールを見上げる（すぐには追えない）
    //  失敗：相手が読んで跳び、頭で止める（こぼれ球）
    function heelLiftStart(own, q, fail, fdx, fdy, lx, ly) {
      const t = S.t;
      own.moveQ = [{ until: t + 0.42, dx: fdx, dy: fdy, v: 0.4, snap: 0.9 }]; own.moveEnd = null;
      act(own, 'dmove', 1.05, { k: 'heelLift', dx: lx, dy: ly, fx: fdx, fy: fdy });
      own.protect = t + 0.48; own.skillCd = Math.max(own.skillCd || 0, t + 2.4);
      q.tackleCd = Math.max(q.tackleCd, 0.5); q.vx *= 0.4; q.vy *= 0.4;
      own.hl = { t: t + 0.42, fail: !!fail, q: q.idx, fdx, fdy, lx, ly };
    }
    function heelLiftFlick(own, h) {
      const b = S.ball, q = P[h.q];
      if (S.restart || S.celebrate > 0 || b.owner !== own.idx || !q || q.off) return;   // 溜めの間にボールがなくなった
      const ux = q.x - own.x, uy = q.y - own.y, ul = hyp(ux, uy) || 1, fdx = h.fdx, fdy = h.fdy;
      const [tx, ty] = hlLand(own, q);
      const bx0 = own.x - fdx * 0.3, by0 = own.y - fdy * 0.3, z0 = 0.35, vz = h.fail ? 4.8 : 8.2;
      const T = ((vz + Math.sqrt(vz * vz + 2 * 9.8 * z0)) / 9.8) * 1.08, d = hyp(tx - bx0, ty - by0) || 1, v = d / T;
      Object.assign(b, { owner: -1, kind: 'pass', selfPass: true, x: bx0, y: by0, z: z0, vx: ((tx - bx0) / d) * v, vy: ((ty - by0) / d) * v, vz, spin: 0, bs: 0, knuckle: false, lastTeam: own.team, lastPlayer: own.idx, kicker: own.idx, intended: own.idx, offside: false, style: 'ground', hlift: S.t });
      own.touchCd = 0.6; S.dribbleDir = null; own.settle = false;
      if (globalThis.__hlDbg) globalThis.__hlDbg.push({ t: S.t, o: own.idx, q: q.idx, fail: h.fail, ah: +(fx(own.team, q.x) - fx(own.team, own.x)).toFixed(1), xf: +fx(own.team, own.x).toFixed(0), wy: +Math.abs(own.y - GOAL_Y).toFixed(0) });   // 確認用
      for (const m of mates(own)) if (m !== own && !m.gk && hyp(m.x - tx, m.y - ty) < 10) m.touchCd = Math.max(m.touchCd || 0, T + 0.5);   // 味方は手を出さない（自分で拾う）
      { const tDn = (vz + Math.sqrt(Math.max(0, vz * vz + 2 * 9.8 * (z0 - 1.0)))) / 9.8; if (!h.fail) own.touchCd = Math.max(own.touchCd, tDn - 0.05);   /* 自分も、頭の高さで触らず（ヘディングで味方へ流さず）、落ちてきた所を足で拾う */ for (const o of opps(own)) if (!o.gk && o !== q && hyp(o.x - bx0, o.y - by0) < 9) o.touchCd = Math.max(o.touchCd || 0, tDn); }   // 頭の上を越えている間は、まわりの相手も胸や足で止められない（落ちてきてから競る）
      // 相手の横（いない側）を回り込んで、落ちる所へ
      const rx = h.lx * 0.85 + fdx * 0.55, ry = h.ly * 0.85 + fdy * 0.55, rl = hyp(rx, ry) || 1, sp = Math.max(6, maxSpeed(own) * 0.9);
      own.vx = (rx / rl) * sp; own.vy = (ry / rl) * sp; own.burstT = S.t + 0.6;
      if (h.fail) {
        // 読まれた：相手はその場で待ち、ボールが頭の上に来た所で跳んで止める
        const tq = Math.max(0.12, (hyp(q.x - bx0, q.y - by0) / v) - 0.05);
        q.hlHead = { t: S.t + tq, o: own.idx }; q.stun = 0; q.touchCd = Math.max(q.touchCd, tq + 0.05);
        act(q, 'hlLook', 0.5, { dx: -ux / ul, dy: -uy / ul, read: 1 });
      } else {
        stats[own.team].dribbles_past++; noteBeat(own, q);
        q.stun = Math.max(q.stun, 1.2); q.tackleCd = Math.max(q.tackleCd, 1.8); q.touchCd = Math.max(q.touchCd, T + 0.4); q.vx = q.vy = 0;
        act(q, 'hlLook', 1.4, { dx: ux / ul, dy: uy / ul });   // 振り返って、頭の上を越えていくボールを見上げる
      }
    }
    function heelLiftHead(q, h) {
      const b = S.ball;
      if (b.owner >= 0 || b.hlift == null || S.restart || hyp(b.x - q.x, b.y - q.y) > 2.2 || b.z > 2.9) return;
      act(q, 'head', 0.6);
      const o = P[h.o], ax = o ? o.x - q.x : -sgn(q.team), ay = o ? o.y - q.y : 0, al = hyp(ax, ay) || 1, a = Math.atan2(ay, ax) + R.range(-0.9, 0.9), v = R.range(3.5, 6);
      Object.assign(b, { owner: -1, kind: 'pass', selfPass: false, x: q.x, y: q.y, z: 1.9, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: R.range(1, 3), spin: 0, bs: 0, knuckle: false, lastTeam: q.team, lastPlayer: q.idx, kicker: q.idx, intended: -1, offside: false, style: 'head', hlift: null });
      if (o) o.touchCd = Math.max(o.touchCd || 0, 0.25);
      stats[q.team].tackles_won++; stats[1 - q.team].tackles_lost++; ev('tackle', { team: q.team, player: q.name });
    }
    function doubleTouchMove(own, d, lx, ly, fdx, fdy) {
      const t = S.t, side = 1.8 / (d * 0.33);   // 横へ約1.8m（ボールと一緒に、1人分ずれる）
      own.moveQ = [
        { until: t + d * 0.12, dx: fdx, dy: fdy, v: 1.6, snap: 0.8 },
        { until: t + d * 0.28, dx: lx, dy: ly, v: side, snap: 0.95 },
        { until: t + d * 0.45, dx: lx * 0.9 + fdx * 0.3, dy: ly * 0.9 + fdy * 0.3, v: side, snap: 0.95 },
      ];
      const ex = fdx * 0.75 + lx * 0.5, ey = fdy * 0.75 + ly * 0.5, el = hyp(ex, ey) || 1;
      own.moveEnd = { dx: ex / el, dy: ey / el, v: 7.4 };
      act(own, 'dmove', d, { k: 'doubleTouch', dx: lx, dy: ly, fx: fdx, fy: fdy });
    }
    // マルセイユルーレットの足の運び：一回転しながら横へ約1.8m回り込み、前へ
    function rouletteMove(own, lx, ly, fdx, fdy, q) {
      own.moveQ = [{ until: S.t + 0.6, dx: lx * 0.9 + fdx * 0.2, dy: ly * 0.9 + fdy * 0.2, v: 3.8, snap: 0.8 }];
      own.moveEnd = { dx: fdx, dy: fdy, v: 6.8 };
      // 相手（足を出してくる方）の向き：回る向きを決める（相手に背中を向ける方へ回る）
      const ox = q ? q.x - own.x : 0, oy = q ? q.y - own.y : 0, ol = hyp(ox, oy) || 1;
      act(own, 'dmove', 0.85, { k: 'roulette', dx: lx, dy: ly, fx: fdx, fy: fdy, ox: q ? ox / ol : null, oy: q ? oy / ol : null });
    }
    // スライディングをかわす：すり抜けずに、体を使って避ける
    //  hurdle＝ボールを浮かせて飛び越える（漫画のように）／swerve＝ドリブルで横へ避ける
    //  doubleTouch＝トン・トンと横へずらす／roulette＝くるっと回って避ける
    function slideDodge(own, q, sdx, sdy, from) {
      // 前＝今ドリブルしている向き（止まっていればゴールの方）
      let fdx = own.vx, fdy = own.vy, fl = hyp(fdx, fdy);
      if (fl < 1) { fdx = fx(own.team, L) - own.x; fdy = (GOAL_Y - own.y) * 0.35; fl = hyp(fdx, fdy) || 1; }
      fdx /= fl; fdy /= fl;
      // よける向き：滑ってくる線に対して90°。そのあと前へ直進しても相手の体を横切らない側を選ぶ（正面からなら今いる側）
      const px = -sdy, py = sdx, fp = fdx * px + fdy * py;
      const side = Math.abs(fp) > 0.15 ? Math.sign(fp) : (Math.sign(px * (own.x - q.x) + py * (own.y - q.y)) || (R.next() < 0.5 ? 1 : -1));
      const lx = px * side, ly = py * side;
      const tech = own.technique, w = {
        hurdle: (from === 'back' ? 0.5 : 1.2) * (0.6 + own.jump / 100),
        swerve: 1.6,
        doubleTouch: from === 'back' ? 0 : skZ(own, 'doubleTouch') ? 3.5 : tech >= 60 ? 0.7 : 0,
        roulette: from !== 'front' ? 0 : skZ(own, 'roulette') ? 3.5 : tech >= 72 ? 0.5 : 0,   // ルーレットは正面から来た相手にだけ（横から来た足の前で回ると引っかかる）
      };
      let k = S.forceDodge || 'swerve';
      if (!S.forceDodge) { let r = R.next() * (w.hurdle + w.swerve + w.doubleTouch + w.roulette); for (const kk of ['hurdle', 'swerve', 'doubleTouch', 'roulette']) { r -= w[kk]; if (r <= 0) { k = kk; break; } } }
      const t = S.t;
      if (k === 'hurdle') {
        own.moveQ = [{ until: t + 0.12, dx: fdx, dy: fdy, v: 3.2, snap: 0.6 }, { until: t + 0.62, dx: fdx, dy: fdy, v: 5.2, snap: 0.8 }];
        own.moveEnd = { dx: fdx, dy: fdy, v: 6.8 };
        act(own, 'dmove', 0.85, { k, dx: lx, dy: ly, fx: fdx, fy: fdy });
      } else if (k === 'swerve') {
        // 真横へ大きく1歩ずれて、そのまま前へ直進
        own.moveQ = [{ until: t + 0.36, dx: lx, dy: ly, v: 7.2, snap: 0.85 }];
        own.moveEnd = { dx: fdx, dy: fdy, v: 6.8 };
        act(own, 'dmove', 0.7, { k, dx: lx, dy: ly, fx: fdx, fy: fdy });
      } else if (k === 'doubleTouch' || k === 'roulette') {
        // 技は、ドリブルの向きに対して真横・相手の体と遠い側へ（横から来た相手でも、自分から見て横へずれる）
        const p2x = -fdy, p2y = fdx, oq = p2x * (q.x - own.x) + p2y * (q.y - own.y);
        const s2 = Math.abs(oq) > 0.3 ? -Math.sign(oq) : (Math.sign(p2x * lx + p2y * ly) || 1), mx = p2x * s2, my = p2y * s2;
        if (k === 'doubleTouch') doubleTouchMove(own, 0.55, mx, my, fdx, fdy);   // スキルのダブルタッチと同じ動きを、1.5倍の速さで
        else rouletteMove(own, mx, my, fdx, fdy, q);   // スキルのルーレットと同じ   // スキルのダブルタッチと同じ動きを、1.5倍の速さで
      }
      own.protect = t + 1.0; own.skillCd = t + 1.5; q.touchCd = Math.max(q.touchCd, 1.0);
      if (globalThis.__slideLog) globalThis.__slideLog.push({ dodge: k });
    }
    // ヘディング：シュート・クリア・味方へ落とす
    function header(p) {
      if (globalThis.__scLog && S.ball.kind === 'shot' && p.team === S.ball.lastTeam && p.idx !== S.ball.lastPlayer) globalThis.__scLog.push(['head', S.t]);
      const b = S.ball, xf = fx(p.team, p.x);
      // 味方の浮き球を頭でつなげばパス成功、相手に競り負ければ失敗
      if (b.kind === 'pass' && b.kicker >= 0) {
        const kt = P[b.kicker].team, bs = (stats[kt].byStyle ||= {});
        if (p.team === kt) { stats[kt].passes_completed++; (bs[b.style] ||= [0, 0])[0]++; }
        else { stats[kt].failed_passes++; (bs[b.style] ||= [0, 0])[1]++; }
      }
      act(p, 'head', 0.6);
      p.touchCd = 0.5;
      const base = { owner: -1, spin: 0, bs: 0, knuckle: false, lastTeam: p.team, lastPlayer: p.idx, kicker: p.idx, kickKind: 'head', offside: false, intended: -1 };
      if (xf > L - 17 && Math.abs(p.y - GOAL_Y) < 13) {
        const nf = skZ(p, 'nearRun') || skZ(p, 'farWait');   // ニア・ファーで合わせるのが得意
        const gr = uFire(p, 'guren'), lv2 = gr && p.uniqLv >= 2;   // 紅蓮の牙：ヘディングシュートでも出る
        const gx = fx(p.team, L), ty = GOAL_Y + (gr ? (R.next() < 0.5 ? -1 : 1) * R.range(2.8, 3.9) : nf ? (GOAL_Y - p.y > 0 ? 1 : -1) * R.range(2.4, 3.8) : R.gauss() * 2.4);   // 出たら隅へ正確に
        const dx = gx - b.x, dy = ty - b.y, d = hyp(dx, dy) || 1, v = (10 + p.physical * 0.07 + R.next() * 3) * (gr ? (lv2 ? 1.5 : 1.35) : 1);   // 叩きつける強いヘディング
        Object.assign(b, base, { kind: 'shot', vx: (dx / d) * v, vy: (dy / d) * v, vz: gr ? R.range(-1.6, 0.2) : R.range(-2.6, 0.8), style: 'head', shotT: S.t, shotFrom: hyp(fx(p.team, L) - p.x, GOAL_Y - p.y), gkPen: 0, uDelay: 0, guren: 0, uSafe: 0, csPlace: false, curveAll: false, drive: 0 });
        if (nf) b.gkPen = 0.08;
        if (gr) { b.grF = grF(p); b.gkPen += (lv2 ? 0.6 : 0.2) * b.grF; b.uDelay = 0.07 * uP(p) * b.grF; b.guren = p.uniqLv || 1; }
        const tHit = (gx - b.x) / b.vx, yHit = b.y + b.vy * tHit;
        b.shotOnTarget = Math.abs(yHit - GOAL_Y) < POST;
        stats[p.team].shots++; if (b.shotOnTarget) stats[p.team].shots_on_target++; else stats[p.team].off_target++;
        
        ev('shot', { team: p.team, player: p.name, number: p.number, d: +b.shotFrom.toFixed(1), on: b.shotOnTarget, header: true, power: Math.round(v * 3.6) });
      } else if (xf < 40 && (b.lastTeam !== p.team || opps(p).some((q) => !q.off && hyp(q.x - p.x, q.y - p.y) < 3.5) || (xf < 22 && Math.abs(p.y - GOAL_Y) < 20))) {   // 版845：クリアするのは、相手のボール・すぐ近くに相手がいる・自陣ゴール前の時だけ
        const a = Math.atan2((GOAL_Y - p.y) * 0.012, sgn(p.team)) + R.gauss() * 0.4, v = 11 + p.physical * 0.06;   // 版845：外へ出さないよう、少し内側（前）へ
        Object.assign(b, base, { kind: 'loose', vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: R.range(4.5, 7), style: 'head' });
      } else {
        const mates2 = mates(p).filter((m) => m !== p && !m.gk).map((m) => ({ m, d: hyp(m.x - p.x, m.y - p.y), o: nearestOpp(m, m.x, m.y).d })).filter((o) => o.d > 5 && o.d < 20).sort((a, c) => c.o - a.o);
        const tg = mates2[0];
        if (tg) {
          // 頭で落とす：味方の足元へ低く（ヘディングの応酬にならないように）
          const dx = tg.m.x - b.x, dy = tg.m.y - b.y, d = hyp(dx, dy), v = 6 + d * 0.45;
          Object.assign(b, base, { kind: 'pass', vx: (dx / d) * v, vy: (dy / d) * v, vz: 0.3 + d * 0.02, intended: tg.m.idx, style: 'head' });
          stats[p.team].passes++; S.lastPass[p.team] = { from: p.idx, t: S.t };
          if (R.next() < 0.75) pgGo(p, tg.m);   // 頭で落としたFW：落とした後、もう一度裏へ／開いて受け直す
        } else {
          const a = Math.atan2((GOAL_Y - p.y) * 0.01, sgn(p.team)) + R.gauss() * 0.4, v = xf < 50 ? 3 : 9;   // 版845：自陣で出す先がない時は、自分の前へ小さく落とす（外へ出さない）
          Object.assign(b, base, { kind: 'loose', vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: xf < 50 ? 1.2 : 3, style: 'head' });
        }
      }
      S.poss = p.team;
    }
    // ---------- ドリブル技 ----------
    // いま出せる技（場面と覚えている技から）
    // 版668：ヒールリフトは、サイドの前の方（相手陣の深い所）で、目の前の相手が1人だけ・その後ろにスペースがある時にしか使わない
    // 版671：ヒールリフトの落ちる所：前（相手ゴールの方）へ大きく。相手の向こう側、自分から約9m先
    function hlLand(own, q) {
      const gx = fx(own.team, L), gdx = gx - own.x, gdy = (GOAL_Y - own.y) * 0.35, gl = hyp(gdx, gdy) || 1;
      const ux = q.x - own.x, uy = q.y - own.y, ul = hyp(ux, uy) || 1;
      let dx = (gdx / gl) * 0.75 + (ux / ul) * 0.25, dy = (gdy / gl) * 0.75 + (uy / ul) * 0.25; const dl = hyp(dx, dy) || 1; dx /= dl; dy /= dl;
      const along = Math.max(0, ux * dx + uy * dy);   // 相手までの、前向きの距離
      return [clamp(own.x + dx * (along + 7.5), 0.5, L - 0.5), clamp(own.y + dy * (along + 7.5), 0.5, W - 0.5), own.x + dx * (along + 7.5), own.y + dy * (along + 7.5)];
    }
    function hlSpace(own, q) {
      if (!q || Math.abs(own.y - GOAL_Y) < 15 || fx(own.team, own.x) < 58) return false;
      const ux = q.x - own.x, uy = q.y - own.y, ul = hyp(ux, uy) || 1, [, , lx, ly] = hlLand(own, q);
      const ahead = fx(own.team, q.x) - fx(own.team, own.x);   // 相手が自分より前（相手ゴール側）に何mいるか
      if (ahead < 0.6 || ahead / ul < 0.5 || ul < 1.2 || ul > 4.5) return false;   // 目の前（前方±60°くらい・1.2〜4.5m）に立ちはだかる相手を抜く技。横や後ろの相手には使わない
      if (lx < 1.5 || lx > L - 1.5 || ly < 1.5 || ly > W - 1.5) return false;   // 落ちる所がピッチの外
      for (const o of opps(own)) { if (o === q || o.off) continue; if (hyp(o.x - lx, o.y - ly) < 6 || hyp(o.x - own.x, o.y - own.y) < 3.6) return false; }   // 後ろに別の相手がいる・2人に囲まれている
      return true;
    }
    function dribbleCtx(own, q) {
      const xf = fx(own.team, own.x);
      const near = opps(own).filter((o) => !o.gk && hyp(o.x - own.x, o.y - own.y) < 3.6).length;
      const wide = Math.abs(own.y - GOAL_Y) > 16;
      const ctx = {
        mid: xf > 35,
        narrow: xf > 25 && near >= 2,
        side: xf > 35 && wide && near <= 1,
        goal: xf > L - 24 && Math.abs(own.y - GOAL_Y) < 17,
      };
      const set = new Set();
      const dq = hyp(q.x - own.x, q.y - own.y);
      for (const z in DRIB_ZONES) for (const k of DRIB_ZONES[z]) if (skZ(own, k) && k !== 'speedDribble' && !(k === 'cutIn' && dq < 2.4) && !(k === 'heelLift' && !hlSpace(own, q))) set.add(k);   // どこで使うかは「スキルのエリア設定」の表で決める（場面は重みだけ）   // カットインは相手に近すぎると仕掛けない（少し離れた所から）
      return { ctx, list: [...set] };
    }
    // ボディフェイント・シザース：逆へ行くと見せて（踏み出す／ボールをまたぐ）体重を乗せる → 反対の足でボールを転がし、踏み出した足の反発でグン！と逆へ
    //  lx,ly＝本当に行く側（相手のいない側）、見せる側はその逆。相手は見せた側へつられる（だまされ具合はドリブル・テクニックと守備の差）
    function feintMove(own, q, k, lx, ly, fdx, fdy, dbl) {
      const t = S.t, sc = k === 'scissors';
      const nz = (a, b) => { const l = hyp(a, b) || 1; return [a / l, b / l]; };
      if (sc && dbl) {
        // ダブルシザース：1回目（−l側を見せる）は読まれて相手は動かない（むしろ本当に行く l 側を待つ）
        //  → 反対の足でもう一度またいで l 側を見せる → 相手が l 側へ体重を乗せた瞬間、1回目に見せた −l 側へグン！
        const [ax, ay] = nz(-lx * 0.5 + fdx * 0.5, -ly * 0.5 + fdy * 0.5), [cx, cy] = nz(lx * 0.5 + fdx * 0.5, ly * 0.5 + fdy * 0.5);
        const [gx, gy] = nz(-lx * 0.17 + fdx * 0.98, -ly * 0.17 + fdy * 0.98);   // 相手がよろけてくれるので、空いた側へ10°だけ斜め
        own.moveQ = [{ until: t + 0.38, dx: ax, dy: ay, v: 2.2, snap: 0.6 }, { until: t + 0.76, dx: cx, dy: cy, v: 2.2, snap: 0.6 }, { until: t + 0.84, dx: cx, dy: cy, v: 0.4, snap: 0.85 }];
        own.moveEnd = { dx: gx, dy: gy, v: 2.4 };
        S.dribbleMode = 'break'; own.pace = { ph: 'burst', until: t + 1.8 };
        act(own, 'dmove', 1.35, { k, dbl: 1, dx: -lx, dy: -ly, fx: fdx, fy: fdy, ax, ay, cx, cy, bx: gx, by: gy });
        const fool = clamp(0.75 + (own.dribble - q.defense) * 0.01 + (own.technique - 60) * 0.004, 0.4, 1);   // 2回目は、1回目を読んだ分だけ深くつられる
        q.vx = lx * 0.8; q.vy = ly * 0.8; q.lagT = t + 0.5; q.stun = Math.max(q.stun, 0.3);   // 読んで、その場で待つ（飛び込まない） q.tackleCd = Math.max(q.tackleCd, 1.9);
        q.sway = { t: t + 0.5, vx: cx * 3.6 * fool, vy: cy * 3.6 * fool, lag: t + 0.84 + 0.4 * fool };
        q.lateLose = { t: t + 0.84, o: own.idx, dx: cx, dy: cy, fall: R.next() < 0.15 * fool };
        own.protect = t + 1.5;
        return;
      }
      const [ax, ay] = sc ? nz(-lx * 0.5 + fdx * 0.5, -ly * 0.5 + fdy * 0.5) : nz(-lx * 0.7 + fdx * 0.3, -ly * 0.7 + fdy * 0.3);   // 見せる側へ
      const [bx, by] = nz(lx * 0.75 + fdx * 0.45, ly * 0.75 + fdy * 0.45);   // 本当に行く側
      const t1 = sc ? 0.38 : 0.3, t2 = sc ? 0.46 : 0.4;
      own.moveQ = [{ until: t + t1, dx: ax, dy: ay, v: sc ? 2.2 : 2.8, snap: 0.6 }, { until: t + t2, dx: ax, dy: ay, v: 0.4, snap: 0.85 }];
      own.moveEnd = { dx: bx, dy: by, v: 2.4 };   // 反発で切り返し、ここから瞬発力でグン！と加速
      S.dribbleMode = 'break'; own.pace = { ph: 'burst', until: t + 1.4 };
      act(own, 'dmove', sc ? 0.95 : 0.9, { k, dx: lx, dy: ly, fx: fdx, fy: fdy, ax, ay, bx, by });
      const fool = clamp(0.55 + (own.dribble - q.defense) * 0.01 + (own.technique - 60) * 0.004, 0.15, 1);
      q.vx = ax * 3.6 * fool; q.vy = ay * 3.6 * fool; q.stun = Math.max(q.stun, 0.4 + 0.8 * fool); q.tackleCd = Math.max(q.tackleCd, 1.4);
      q.lateLose = { t: t + t2, o: own.idx, dx: ax, dy: ay, fall: R.next() < 0.15 * fool };
      own.protect = t + 1.1;
    }
    // 技を仕掛ける。成功なら相手をかわして前へ、失敗なら奪われる。戻り値：仕掛けたら true
    function skillMove(own, q, force) {
      const b = S.ball;
      if (!q || own.gk || (own.skillCd || 0) > S.t || (own.skLock || 0) > S.t || (S.charge && S.charge.p === own.idx)) return false;
      const { ctx, list } = dribbleCtx(own, q);
      if (globalThis.__forceSkill && !list.length) list.push(globalThis.__forceSkill);   // 確認用：技を持っていない選手も、選んだ技を使う
      if (!list.length) return false;
      // 場面に合う技を優先（狭い所はダブルタッチ等、サイドはヒールリフト等、ゴール前はキックフェイント等）
      const wts = list.map((k) => zw(own, k) * (k === 'cutIn' && ctx.side ? 4 : 1) * (ctx.narrow && DRIB_ZONES.narrow.includes(k) ? 3 : 1) * (ctx.side && DRIB_ZONES.side.includes(k) ? 2 : 1) * (ctx.goal && DRIB_ZONES.goal.includes(k) ? 3 : 1));
      let r = R.next() * wts.reduce((a, c) => a + c, 0), k = list[0];
      for (let i = 0; i < list.length; i++) { r -= wts[i]; if (r <= 0) { k = list[i]; break; } }
      if (globalThis.__forceSkill) { k = globalThis.__forceSkill; if (k === 'heelLift' && !hlSpace(own, q)) return false; }   // 確認用（ヒールリフトは、使える場面でだけ）
      own.skillCd = S.t + (uOn(own, 'shiden') ? 0.2 : 2.2);   // 紫電の遊戯：フェイントを連続で（抜いたらすぐ次の相手へ）   // 紫電の遊戯：フェイントを続けて何回でも
      const fit = (ctx.narrow && DRIB_ZONES.narrow.includes(k)) || (ctx.side && DRIB_ZONES.side.includes(k)) || (ctx.goal && DRIB_ZONES.goal.includes(k));
      // 成功率：股抜きは（ドリブル＋テクニック）の平均と、相手の守備力の差でほぼ決まる
      const uD = uDrib(own, q);
      const bPen = S.t - (own.beatT ?? -9) < 2 && !(own.uniq && own.uOn > S.t) ? 0.12 : 0;   // 版840：技で抜く率を下げた（0.5→0.42）。抜いた直後の2人目はさらに難しい
      const pS = k === 'heelLift' ? clamp(0.4 - bPen + ((own.technique * 0.6 + own.dribble * 0.4) - (q.defense * 0.6 + q.jump * 0.4)) * 0.009 + (fit ? 0.08 : 0) + (q.stun > 0 ? 0.15 : 0) + uD, 0.1, uD > 0 ? 0.97 : 0.9)   // 版666：ヒールリフトはテクニックが大事。跳べる相手（ジャンプ）には頭で止められやすい
        : k === 'nutmeg' ? clamp(0.4 - bPen + ((own.dribble + own.technique) / 2 - q.defense) * 0.012 + (fit ? 0.05 : 0) + (q.stun > 0 ? 0.15 : 0) + uD, 0.08, uD > 0 ? 0.97 : 0.92)
        : clamp(0.4 - bPen + (own.dribble - q.defense) * 0.006 + (own.technique - 60) * 0.002 + (fit ? 0.07 : 0) + (q.stun > 0 ? 0.15 : 0) + uD, 0.1, uD > 0 ? 0.97 : 0.9);
      // 相手からボールへの向き・抜く方向
      const gx = fx(own.team, L);
      let fdx = gx - own.x, fdy = (GOAL_Y - own.y) * 0.35; const fl = hyp(fdx, fdy) || 1; fdx /= fl; fdy /= fl;     // 前
      const sideSign = Math.sign((own.y - q.y) || (R.next() < 0.5 ? 1 : -1));
      const lx = -fdy * sideSign, ly = fdx * sideSign;   // 相手のいない側
      if (R.next() >= pS && k === 'nutmeg') {
        // 股抜き失敗①：そもそも通せない。相手が足を閉じて、股の間でボールを止められる
        const ux = own.x - q.x, uy = own.y - q.y, ul = hyp(ux, uy) || 1;
        act(own, 'skill', 1.3, { k });
        act(own, 'dmove', 0.45, { k, dx: -ux / ul, dy: -uy / ul, fail: 1 });
        act(q, 'legsClose', 0.55, { dx: ux / ul, dy: uy / ul });
        stats[q.team].tackles_won++; stats[own.team].tackles_lost++;
        stealRoll(q, own);
        act(own, 'lose', 0.8, { o: q.idx }); own.stun = 0.7;
        ev('tackle', { team: q.team, player: q.name });
        return true;
      }
      // シザースが読まれた：テクニックがあれば、反対の足でもう一度またぐ（ダブルシザース）。2回目が決まれば抜ける
      let miss = R.next() >= pS, dblSc = false;
      if (miss && k === 'scissors' && own.technique >= 50 && R.next() < clamp(0.35 + (own.technique - 50) * 0.01, 0, 0.75) && R.next() < pS) { miss = false; dblSc = true; }
      act(own, 'skill', 1.3, { k: dblSc ? 'doubleScissors' : k });
      if (k === 'heelLift') { heelLiftStart(own, q, miss, fdx, fdy, lx, ly); return true; }   // 版666：ヒールリフトは、溜め（足でボールを背中側へ転がし上げる）→ かかとで跳ね上げる → 相手の横を回って拾う。失敗は、跳び上がった相手に頭で止められる
      if (miss) {
        // 読まれた：足を出されて奪われる
        act(own, 'dmove', 0.45, { k, dx: lx, dy: ly, fail: 1 });
        stats[q.team].tackles_won++; stats[own.team].tackles_lost++;
        stealRoll(q, own);
        act(own, 'lose', 0.8, { o: q.idx }); own.stun = 0.7;
        ev('tackle', { team: q.team, player: q.name });
        return true;
      }
      stats[own.team].dribbles_past++; noteBeat(own, q);
      own.protect = S.t + 0.7;
      // 抜かれた相手：フェイントにつられて逆へ体が流れる（大きく崩れると尻もち）
      const beat = (stun, cd, fall) => {
        q.stun = Math.max(q.stun, stun); q.tackleCd = Math.max(q.tackleCd, cd);
        q.vx = -lx * 4.2 - fdx * 1.5; q.vy = -ly * 4.2 - fdy * 1.5;   // 逆へつられ、少し前のめりに
        act(q, fall ? 'fall' : 'lose', fall ? 1.2 : 0.9, { o: own.idx, dx: -lx, dy: -ly });
        if (fall) q.downT = Math.max(q.downT || 0, 1.0);
        if (uOn(own, 'shiden')) {   // 紫電の遊戯：抜いた瞬間、紫電が走る。抜いた後はすぐに次のプレー（ノールックのラストパス・シュート）へ
          act(own, 'sdzap', 0.6, { lv: own.uniqLv || 1 }); own.sdBeat = S.t; S.decision = Math.min(S.decision, 0.12);
          if (own.uniqLv >= 2) for (const o of opps(own)) if (o !== q && !o.gk && hyp(o.x - own.x, o.y - own.y) < 5) { o.lagT = S.t + 0.6; o.stun = Math.max(o.stun || 0, 0.35); }   // 凸：抜いた勢いのまま、次の相手も一瞬置き去り
        }
      };
      const burst = (dx, dy, v) => { const l = hyp(dx, dy) || 1; dx /= l; dy /= l; if (uOn(own, 'shiden')) [dx, dy] = sdFwd(own, dx, dy); S.dribbleDir = [dx, dy]; v = Math.max(v * 1.35, 6.5); own.vx = dx * v; own.vy = dy * v; own.burstT = S.t + 0.5; };
      const toBehind = (dist) => { const ux = q.x - own.x, uy = q.y - own.y, ul = hyp(ux, uy) || 1; return [q.x + (ux / ul) * dist, q.y + (uy / ul) * dist]; };
      const selfKick = (tx, ty, v, vz) => {
        if (uOn(own, 'shiden')) {   // 紫電の遊戯：ボールを足もとから離さないまま、相手の横をすり抜ける（押し出したボールを拾われない）
          const [ex, ey] = sdFwd(own, tx - own.x, ty - own.y), sv = Math.max(6.5, v * 0.85);
          own.vx = ex * sv; own.vy = ey * sv; own.burstT = S.t + 0.5; S.dribbleDir = [ex, ey]; own.settle = false;
          q.touchCd = Math.max(q.touchCd, 1.0); own.protect = Math.max(own.protect || 0, S.t + 0.35); return;
        }
        const dx = tx - b.x, dy = ty - b.y, d = hyp(dx, dy) || 1;
        Object.assign(b, { owner: -1, kind: 'pass', selfPass: true, vx: (dx / d) * v, vy: (dy / d) * v, vz, z: Math.max(b.z, 0.05), spin: 0, bs: 0, knuckle: false, lastTeam: own.team, lastPlayer: own.idx, kicker: own.idx, intended: own.idx, offside: false, style: 'ground' });
        q.touchCd = Math.max(q.touchCd, 1.0);
        if (uOn(own, 'shiden')) for (const o of opps(own)) if (!o.gk && hyp(o.x - b.x, o.y - b.y) < 16) o.touchCd = Math.max(o.touchCd, 2.0);   // 紫電の遊戯：ボールが足に吸いつく。押し出したボールを周りの相手に拾わせない
        own.touchCd = 0.35; S.dribbleDir = null; own.settle = false;
      };
      switch (k) {
        case 'scissors': feintMove(own, q, 'scissors', lx, ly, fdx, fdy, dblSc); break;
        case 'elastico': act(own, 'dmove', 0.65, { k, dx: lx, dy: ly, fx: fdx, fy: fdy }); beat(0.9, 1.4, R.next() < 0.35); burst(fdx * 0.5 + lx * 0.85, fdy * 0.5 + ly * 0.85, 5); break;
        case 'bodyFeint': case 'feint': feintMove(own, q, 'bodyFeint', lx, ly, fdx, fdy); break;
        case 'doubleTouch': {
          // ダブルタッチ（実写を写す）：前を向いたまま、右足のインで左足へ・左足でさらに横へ、と2タッチで横へずらす → 相手の伸ばした足の横を斜め前へ抜ける
          doubleTouchMove(own, 0.8, lx, ly, fdx, fdy);
          { const ux = b.x - q.x, uy = b.y - q.y, ul = hyp(ux, uy) || 1; act(q, 'poke', 0.45, { dx: ux / ul, dy: uy / ul }); }   // 相手は元のボールの所へ足を伸ばす
          q.stun = Math.max(q.stun, 0.9); q.tackleCd = Math.max(q.tackleCd, 1.3);
          q.lateLose = { t: S.t + 0.42, o: own.idx, dx: -lx, dy: -ly, fall: R.next() < 0.15 };
          own.protect = S.t + 1.0; break;
        }
        case 'roulette': {
          // マルセイユルーレット：足裏でボールを引きながら背中を相手に向けて一回転、相手の脇へ回り込んで前へ
          rouletteMove(own, lx, ly, fdx, fdy, q); beat(0.8, 1.4, false);
          own.protect = S.t + 1.0; break;
        }
        case 'cutIn': {
          own.cutInT = S.t;
          // カットイン：サイドで縦へ行くと見せて（1歩外へ）、利き足側へ斜めに中へ切れ込む → そのままシュートへ
          const sd = (a, b) => { const l = hyp(a, b) || 1; return [a / l, b / l]; };
          const inY = Math.sign(GOAL_Y - own.y) || 1;
          // ①縦へ行くと見せて外へ運ぶ（0.26秒）→ ②外の足で踏ん張って止まる（0.1秒）→ ③インで中へ持ち出し、前傾してグン！と斜め内へ（突破のドリブルと同じ加速）
          const [ox2, oy2] = sd(fdx * 0.9, -inY * 0.35);
          // 切れ込む角度は場面で選ぶ（斜め25°〜真横85°）：空いている所・ゴールへの近さ・タッチライン（ゴールライン）を見て、判断力が高いほど一番良い角度を選ぶ
          const [ix, iy] = cutInAngle(own, q, fdx, fdy, inY);
          // 緩急をはっきり：「緩」＝ゆっくり外へ運んで相手を誘う → ほぼ止まる → 「急」＝止まった所からグン！と最高速まで一気に加速
          own.moveQ = [{ until: S.t + 0.33, dx: ox2, dy: oy2, v: 3.4, snap: 0.6 }, { until: S.t + 0.46, dx: ox2, dy: oy2, v: 0.5, snap: 0.85 }];
          own.moveEnd = { dx: ix, dy: iy, v: 2.4 };   // ここから瞬発力で加速して見せる
          S.dribbleMode = 'break'; own.pace = { ph: 'burst', until: S.t + 1.5 };
          act(own, 'dmove', 1.1, { k, dx: ix, dy: iy, fx: fdx, fy: fdy, ox: ox2, oy: oy2 });
          // 相手は縦を切りに外へつられる → 切り返されて逆を取られる
          q.stun = Math.max(q.stun, 1.0); q.tackleCd = Math.max(q.tackleCd, 1.5); q.vx = ox2 * 3.8; q.vy = oy2 * 3.8;
          q.lateLose = { t: S.t + 0.5, o: own.idx, dx: ox2, dy: oy2, fall: R.next() < 0.15 };
          own.protect = S.t + 1.1;
          // 中に入ったら狙う（コントロールショットがあれば巻いてファーへ）
          if (fx(own.team, own.x) > L - 30) { own.cutInShot = S.t + 0.75; }
          break;
        }
        case 'kickFeint': {
          // キックフェイント：シュートを打つと見せて大きく振りかぶる → 相手はブロックのために止まって構える（足が止まる）
          // → インでボールを横へずらし、空いたコースへシュート
          const cx = lx * 0.9 + fdx * 0.3, cy = ly * 0.9 + fdy * 0.3, cl = hyp(cx, cy) || 1;
          own.moveQ = [{ until: S.t + 0.36, dx: fdx, dy: fdy, v: 0.9, snap: 0.8 }, { until: S.t + 0.56, dx: cx / cl, dy: cy / cl, v: 5.5, snap: 0.9 }];   // 横へ大きくずらす（前の1.3倍）
          own.moveEnd = { dx: cx / cl, dy: cy / cl, v: 1.8 };
          // 蹴る足：右へずらしたら右足、左へずらしたら左足でシュート。振りかぶって見せるのは反対の足
          const sf = (lx * -fdy + ly * fdx) > 0 ? 'R' : 'L', ff = sf === 'R' ? 'L' : 'R';
          own.forceFoot = { f: sf, until: S.t + 1.6 };
          act(own, 'dmove', 1.0, { k, dx: lx, dy: ly, fx: fdx, fy: fdy, sf, ff });
          // ブロックに来た相手：シュートコースに立ちはだかって止まり、構えたまま固まる（だまされ具合は技術と守備の差）
          const fool = clamp(0.55 + (own.technique - q.defense) * 0.01 + (own.kick - 60) * 0.003, 0.2, 1);
          act(q, 'block', 0.6 + 0.5 * fool, { dx: (own.x - q.x) / (hyp(own.x - q.x, own.y - q.y) || 1), dy: (own.y - q.y) / (hyp(own.x - q.x, own.y - q.y) || 1) });
          q.vx = 0; q.vy = 0; q.lagT = S.t + 0.45 + 0.45 * fool; q.tackleCd = Math.max(q.tackleCd, 1.2); q.stun = Math.max(q.stun, 0.3 + 0.6 * fool);
          // ずらした先から、相手（ブロック）と逆のサイドへ打つ
          // フェイントのあとは、必ずシュートとは限らない：近くて打てそうなら打つ。そうでなければ、ずらした先でパス・ドリブルも選ぶ（シュートは選ばれやすい）
          { const dG = hyp(L - fx(own.team, own.x), GOAL_Y - own.y);
            if (dG < 19 && R.next() < 0.55) S.forceShot = GOAL_Y + (own.y > GOAL_Y ? -1 : 1) * R.range(1.5, 3);
            S.decision = 0.66; own.wantShot = S.t + 1.2; }
          own.protect = S.t + 0.9;
          break;
        }
        case 'nutmeg': {
          // 相手の股の間を通して、裏で受け直す
          // 足を出して股が開いた瞬間に、つま先でちょんと股の間へ → 自分は相手の脇を回り込んで、裏で拾い直す
          const ux = q.x - own.x, uy = q.y - own.y, ul = hyp(ux, uy) || 1;
          act(own, 'dmove', 0.8, { k, dx: ux / ul, dy: uy / ul, fx: fdx, fy: fdy, sx: lx, sy: ly });
          // 股は通った。でも、相手の方が先にボールに触ることもある（失敗②）：守備力・瞬発力が高い相手ほどすぐ振り返って、体を入れてマイボールにする
          const defFirst = R.next() < clamp(0.2 + (q.defense - (own.dribble + own.technique) / 2) * 0.01 + (q.dash - own.dash) * 0.006, 0.05, 0.75);
          if (defFirst) {
            // ボールはちゃんと股の間を通って、相手の3.5m後ろへ転がる。でも相手の反応が速い：すぐ振り返って全力で追い、先に追いつく
            act(q, 'spread', 0.18, { dx: -ux / ul, dy: -uy / ul });
            var [tx, ty] = toBehind(3.5); selfKick(tx, ty, 7.0, 0);
            q.stun = 0; q.touchCd = 0.25; q.tackleCd = 0.5; q.nmDef = { until: S.t + 2.0, o: own.idx }; q.nmChase = S.t + 1.8;
            own.touchCd = 1.4;   // 回り込む分、青は一歩遅れる
            if (globalThis.__nutLog) globalThis.__nutLog.push('def');
          } else {
            act(q, 'spread', 0.55, { dx: -ux / ul, dy: -uy / ul });   // 相手：足を開いて止めにきた姿勢のまま、股を抜かれる
            q.stun = Math.max(q.stun, 1.1); q.tackleCd = Math.max(q.tackleCd, 1.6);
            q.lateLose = { t: S.t + 0.55, o: own.idx, dx: ux / ul, dy: uy / ul, fall: false };
            var [tx, ty] = toBehind(5.0); selfKick(tx, ty, 8.5, 0);   // 相手が届かない所まで転がす
            if (globalThis.__nutLog) globalThis.__nutLog.push('ok');
          }
          const [ax2, ay2] = [lx * 0.85 + fdx * 0.35, ly * 0.85 + fdy * 0.35], al2 = hyp(ax2, ay2) || 1;
          own.moveQ = [{ until: S.t + 0.12, dx: ux / ul, dy: uy / ul, v: 1.2, snap: 0.8 }, { until: S.t + 0.55, dx: ax2 / al2, dy: ay2 / al2, v: 6.0, snap: 0.85 }];   // 相手の脇を大きく回り込む
          { const bx = tx - (own.x + ax2 / al2 * 2.6), by = ty - (own.y + ay2 / al2 * 1.8), bl = hyp(bx, by) || 1; own.moveEnd = { dx: bx / bl, dy: by / bl, v: 7.2 }; }
          break;
        }
        default: return false;
      }
      return true;
    }
    function contest() {
      const b = S.ball;
      if (S.restart || b.kind === 'dead') return;
      if (b.x < -0.1 || b.x > L + 0.1) return;   // ゴールラインを越えた球（ネットの中・ゴールの外）には、だれも触らない
      const own = ownerP();
      if (own) {
        // タックル
        if (own.gk && own.hold) return;
        if ((own.protect || 0) > S.t) return;   // 技でかわした直後は奪われない
        // スイーパーキーパーの飛び出し：読んで詰めたGKが、抜け出した相手の足もとへ飛び込む（成功すればキャッチ・失敗すれば倒れて無人のゴール）
        for (const q of opps(own)) {
          if (q.tackleCd > 0 || q.gk || q.downT > 0 || q.slideT > 0) continue;
          if ((own.tsukiGuard || 0) > S.t && !isCover(q) && !(q.trackRun && q.trackRun.r === own.idx)) continue;   // 月影の抜け出しで運んでいる間は、カバーリングできるDFしか止めに来られない
          if (q.uniq !== 'matsuri' && T[q.team].players.some((m) => ((m.mtCharge && m.mtCharge.o === own.idx) || (m.mtGrip && m.mtGrip.o === own.idx)) && m.uOn > S.t)) continue;   // 祭り太鼓の壁が突っ込んでいる相手には、ほかの味方は手を出さない（あおやまがぶつかる）
          let d = hyp(q.x - own.x, q.y - own.y);
          const pr = clamp(q.press + T[q.team].mods.press + T[q.team].tac.press + DOM[q.team] * 40 + T[q.team].urg * 30 + (skZ(q, 'pressMonster') ? 30 : 0) , 0, 100);
          // 紫電の遊戯：相手と1対1になったら
          if (own.uniq === 'shiden' && d < 3.2 && !own.gk) uFire(own, 'shiden');
          const mtH = q.uniq === 'matsuri' && (uOn(q, 'matsuri') || (q.mtHunt || 0) > S.t);
          if (mtH && d <= 3.0 && !uOn(q, 'matsuri')) { q.mtHunt = 0; uFire(q, 'matsuri'); }   // 祭り太鼓の壁：ぶつかる少し手前（3m）で発動。吹き出しが先に出て「お、きた」と分かる
          if (uOn(q, 'matsuri') && q.mtCharge && q.mtCharge.o === own.idx && S.t < q.mtCharge.at) continue;   // 発動（吹き出し）→ 0.3秒踏み込んで → ぶつかる、の順に見せる
          const mtC = uOn(q, 'matsuri') && q.mtCharge && q.mtCharge.o === own.idx && S.t >= q.mtCharge.at && d <= 2.8;
          if (mtC) q.mtCharge = null;
          if (q.mtGrip && q.mtGrip.o === own.idx && S.t < q.mtGrip.at) { own.vx *= 0.6; own.vy *= 0.6; if (d > 0.62) { const ux = (own.x - q.x) / d, uy = (own.y - q.y) / d, st = Math.min(d - 0.6, 6 * DT); q.x += ux * st; q.y += uy * st; q.vx = own.vx + ux * 2; q.vy = own.vy + uy * 2; } else { q.vx = own.vx; q.vy = own.vy; } continue; }   // 祭り太鼓の壁：体を当てて、押し合っている間（0.4秒）。ここで一瞬ため、そのあと奪う
          const mtG = !!(q.mtGrip && q.mtGrip.o === own.idx && S.t >= q.mtGrip.at && S.t < q.mtGrip.at + 0.5 && d < 3); if (q.mtGrip && (mtG || S.t >= q.mtGrip.at + 0.5)) q.mtGrip = null;   // 発動したら必ずぶつかる：0.3秒後、届く範囲なら一気に踏み込んで体当たり（何も起きずに終わらない）
          // 積極的なエリア：寄せてきた相手（1.7〜3.2m）に、競り合いになる前に自分から技を仕掛ける
          if (d > 1.7 && d < (uOn(own, 'shiden') ? 4.5 : 3.2) && !own.gk && !(uOn(own, 'shiden') && hyp(L - fx(own.team, own.x), GOAL_Y - own.y) < 21 && !(fx(own.team, q.x) > fx(own.team, own.x) && Math.abs(q.y - own.y - (GOAL_Y - own.y) * (fx(own.team, q.x) - fx(own.team, own.x)) / Math.max(1, L - fx(own.team, own.x))) < 1.6)) && /* 紫電の遊戯：シュートレンジでは、シュートコースをふさがれている時だけ技で外す */ !((own.skillCd || 0) > S.t) && R.next() < (uOn(own, 'shiden') ? 0.95 : 0.2) && dribbleCtx(own, q).list.some((k) => zr(own, k) === 2 || (uOn(own, 'shiden') && fx(own.team, own.x) > L / 2 - 5 && zr(own, k) > 0)) && skillMove(own, q)) return;   // 紫電の遊戯（かまた）：発動中、ゴール前（38m以内）では自分から技を仕掛ける
          if (!mtC && !mtG && d > (mtH ? 2.4 : 1.7)) {
            if ((uOn(q, 'miyabi') || q.mybStay) && d < 3.8 && R.next() < 0.3) { slideTackle(q, own); return; }
            if (q.uniq === 'kinshachi' && fx(q.team, own.x) < 34 && fx(q.team, q.x) < fx(q.team, own.x) + 0.5 && d < 3.6 && R.next() < 0.3) { slideTackle(q, own); return; }   /* ゴール側（前・横）からだけ。後ろからは滑らない */   // 金鯱の心臓：ゴール前では、最後はスライディングで止めに行く   // 雅の後始末：届くなら滑り込んででも止める
            // スライディング（覚えている選手だけ）：少し離れた所から滑り込む
            if (skZ(q, 'slide') && d < 3.3 && R.next() < 0.035 + pr * 0.0008) { slideTackle(q, own); return; }
            continue;
          }
          if (!uOn(q, 'miyabi') && !uOn(q, 'matsuri') && !uOn(q, 'tetsurou') && !(uOn(q, 'kagenui') && (own.kgPin || 0) > S.t) && !(q.uniq === 'kinshachi' && fx(q.team, own.x) < 34) && R.next() > (0.13 + pr * 0.0018) * 0.7 * (1 + DOM[q.team] * 1.5)) continue;   // 雅の後始末は、追いついたら必ず止めに行く
          if (!mtG) { act(q, 'duel', 0.5, { o: own.idx }); act(own, 'duel', 0.5, { o: q.idx }); }
          if (uOn(q, 'matsuri') && !mtG) { q.mtCharge = null; own.mtLock = S.t + 0.8; { const hx = own.x - q.x, hy = own.y - q.y, hl = hyp(hx, hy) || 1; act(q, 'mthit', 0.8, { dx: hx / hl, dy: hy / hl, lv: q.uniqLv || 1 }); act(own, 'mtpush', 0.45, { dx: -hx / hl, dy: -hy / hl }); } act(q, 'taiko', 0.7, { lv: q.uniqLv || 1 }); if (q.uniqLv >= 2) { own.mtSlow = S.t + 2.5; act(own, 'mtslow', 2.5); } }   // 祭り太鼓の壁：ドン！（凸：ぶつかった相手はしばらく動きが鈍る）
          // ドリブル技（覚えている選手だけ）：寄せてきた相手を技でかわす
          if (!mtG && R.next() < (uOn(own, 'shiden') ? 1 : (dribbleCtx(own, q).list.some((k) => zr(own, k) === 2) ? 0.85 : 0.6) * (uOn(q, 'matsuri') ? 0.5 : 1)) && skillMove(own, q)) return;   // 紫電の遊戯：競り合いになったら、必ず先に技で抜きにいく   // 祭り太鼓の壁に体を当てられると、技を出す余裕も少ない   // 積極的なエリアでは、競り合いになったらほぼ仕掛ける
          if (uOn(q, 'matsuri') && !mtG) { q.mtGrip = { o: own.idx, at: S.t + 0.25 }; own.mtHeld = S.t + 0.25; return; }   // 祭り太鼓の壁：ぶつかったら、まず体を当てたまま押し込む（すぐには奪わない）
          let pS = ((own.kgPin || 0) > S.t ? 0.3 : 0) + 0.55 + (S.t - (own.beatT ?? -9) < 2 && !(own.uniq && own.uOn > S.t) ? 0.1 : 0) + (q.defense + q.physical - own.dribble - own.physical) * 0.005 - (own.physical - 55) * 0.003 + (own.cur - q.cur) * -0.002 + uDuel(q, own) - ((own.tsukiGuard || 0) > S.t ? 0.15 : 0);   // 国内屈指のアタッカーの抜け出しは、カバーに来ても止めにくい
          // ショルダーチャージ：並走している相手に肩から当たって体を入れる（フィジカル勝負）
          if (mtG) pS += 0.25;   // 祭り太鼓の壁：押し込んだあとの奪い合いは、ほぼ負けない
          if (skZ(own, 'postPlay') && fx(own.team, own.x) > L / 2 && own.vx * sgn(own.team) < 1.5) pS -= 0.22;   // ポストプレー：背負ってキープ
          if (S.dribbleMode === 'carry') pS -= 0.06 + own.technique * 0.0008;   // 運ぶドリブルは足元から離れないので取られにくい
          else if ((own.dO || 0.5) > 0.85 && !(own.pace && own.pace.ph === 'burst')) pS += 0.04;   // 突破でボールが足から離れた瞬間は狙われる
          if (q.sk.has('fighting')) pS += S.score[q.team] < S.score[own.team] ? 0.12 : 0.06;   // 闘志
          if (q.sk.has('bigStage') && S.t >= HALF && Math.abs(S.score[0] - S.score[1]) <= 1) pS += 0.05;
          if (skZ(q, 'shoulder') && hyp(own.vx, own.vy) > 2.5 && Math.abs((q.x - own.x) * own.vx + (q.y - own.y) * own.vy) / (hyp(own.vx, own.vy) * (hyp(q.x - own.x, q.y - own.y) || 1)) < 0.6) pS += 0.14 + (q.physical - own.physical) * 0.004;
          if (R.next() < clamp(pS + (pS < 0.2 ? (pS - 0.2) * 0.5 : 0) + (pS > 0.7 ? (pS - 0.7) * 0.5 : 0), 0.03, 0.95)) {   // 力の差が大きいと、ほぼ一方的
            stats[q.team].tackles_won++;
            stats[own.team].tackles_lost++;
            const took = R.next() < (mtG || uOn(q, 'matsuri') ? 0.95 : uOn(q, 'tetsurou') ? 0.97 : 0.55);   // 祭り太鼓の壁も、つつき出すだけでなく体ごと奪い切る   // 鉄狼の関所：しっかり自分のボールにする
            if (took && uOn(q, 'tetsurou')) { q.uTetsu = S.t + 2.5; act(q, 'ttsteal', 0.8, { lv: q.uniqLv || 1 }); }
            if (uOn(q, 'matsuri')) { const ux = own.x - q.x, uy = own.y - q.y, ud = hyp(ux, uy) || 1; own.stun = Math.max(own.stun || 0, 0.7 + 0.6 * Math.min(1, mtF(q))); own.vx = (ux / ud) * 3.5; own.vy = (uy / ud) * 3.5; act(own, 'lose', 1.4, { o: q.idx, big: 1 }); }   // 祭り太鼓の壁：体をぶつけられた相手は、大きくよろける
            const mtRoll = took && (mtG || uOn(q, 'matsuri'));
            if (mtRoll) {   // 祭り太鼓の壁：押し負けた相手の足もとからボールがこぼれ、あおやまの足もとへ転がって収まる（瞬間移動しない）
              const tx = q.x + sgn(q.team) * 0.5, ty = q.y, bx = tx - b.x, by = ty - b.y, bl = hyp(bx, by) || 1, v = clamp(bl / 0.35, 2.5, 6);
              Object.assign(b, { owner: -1, kind: 'loose', vx: bx / bl * v, vy: by / bl * v, vz: 0, z: 0, lastTeam: q.team, lastPlayer: q.idx, intended: -1 });
              for (const o of opps(q)) if (hyp(o.x - b.x, o.y - b.y) < 6) o.touchCd = Math.max(o.touchCd, 0.8);
              q.touchCd = Math.min(0.25, bl / v * 0.8); S.dribbleDir = null; own.settle = false;
              if (q.uniqLv >= 2) { q.mtCounter = S.t + 1.4; S.decision = 0; }
            } else if (took) { stealRoll(q, own); if (uOn(q, 'matsuri') && q.uniqLv >= 2) { q.mtCounter = S.t + 0.8; S.decision = 0; } }   // 凸：奪ったら、すぐ前の味方へ蹴り出してカウンター
            else {
              // 足を出してつつき出す：ボールは「足→ボール」の向きから少しそれて転がる（どっちに出たか分かるように）
              const ux = b.x - q.x, uy = b.y - q.y, ud = hyp(ux, uy) || 1;
              let a = Math.atan2(uy, ux) + (R.next() < 0.5 ? -1 : 1) * R.range(0.35, 0.9), v = R.range(3.5, 6.5);
              // タッチライン際でつつき出したボールは、そのまま外へ出やすい（スローインでプレーが切れる）
              const edge = Math.min(b.y, W - b.y);
              if (edge < POKE_EDGE && R.next() < POKE_OUT) { a = Math.atan2(b.y < GOAL_Y ? -1 : 1, R.range(-0.6, 0.6)); v = R.range(5, 8); }
              Object.assign(b, { owner: -1, kind: 'loose', vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0, lastTeam: q.team, lastPlayer: q.idx, intended: -1 });
              act(q, 'poke', 0.35, { dx: ux / ud, dy: uy / ud });
              own.touchCd = 0.5; S.dribbleDir = null; own.settle = false;
            }
            ev('tackle', { team: q.team, player: q.name, took: took ? 1 : 0, i: q.idx, o: own.idx });
            // 球際の勝ち負けをはっきり：取られた側は体勢を崩して倒れる
            act(own, 'lose', 0.8, { o: q.idx }); act(q, 'win', 1.0, { o: own.idx, poke: took ? 0 : 1 });
            if (took && (own.dO || 0) > 0.85) { const ux = q.x - own.x, uy = q.y - own.y, ul = hyp(ux, uy) || 1; act(q, 'bodyIn', 0.85, { dx: ux / ul, dy: uy / ul, bump: 1 }); }   // ボールが足から離れた瞬間：間に体を入れてぶつけ、マイボールに（抜かれそうな時の守備の基本）
            own.stun = 0.8;   // 体勢を崩してよろける（倒れはしない）
            if (uOn(q, 'matsuri')) { const ux = own.x - q.x, uy = own.y - q.y, ul = hyp(ux, uy) || 1; act(own, 'lose', 1.6, { o: q.idx, big: 1 }); own.stun = 1.6; own.vx = ux / ul * 4.5; own.vy = uy / ul * 4.5; }   // 祭り太鼓の壁：ドン！と弾き飛ばされ、大きくよろける
            // 文字を出さなくても勝ち負けが分かるように、動きではっきり分ける：
            //  奪った側 → ボールを足元に収めて、相手と反対側（攻める向き）へすぐ持ち出す
            //  取られた側 → その場で止まり、半歩はじかれて、すぐには追えない
            { const ax = q.x - own.x, ay = q.y - own.y, al = hyp(ax, ay) || 1;
              let dx = sgn(q.team) * 0.8 + (ax / al) * 0.9, dy = (ay / al) * 0.9;
              if ((q.y < 3 && dy < 0) || (q.y > W - 3 && dy > 0)) dy = 0;
              const dl = hyp(dx, dy) || 1; dx /= dl; dy /= dl;
              if (mtRoll) { own.vx = -(ax / al) * 4; own.vy = -(ay / al) * 4; } else { own.vx = -(ax / al) * 1.6; own.vy = -(ay / al) * 1.6; own.x -= (ax / al) * 0.35; own.y -= (ay / al) * 0.35; }   // 祭り太鼓の壁ははじき飛ばす（位置を一気に動かさない）
              own.tackleCd = Math.max(own.tackleCd, 1.7); own.stun = Math.max(own.stun, 1.0);
              if (took && !mtRoll) {
                q.settle = false; q.bdir = [dx, dy]; q.dO = 0.45;
                Object.assign(b, { x: q.x + dx * 0.45, y: q.y + dy * 0.45, vx: 0, vy: 0, z: 0 });
                S.dribbleDir = [dx, dy]; const v = Math.max(5.2, maxSpeed(q) * 0.75); q.vx = dx * v; q.vy = dy * v; q.burstT = S.t + 0.6;
                S.decision = Math.max(S.decision, 0.6); q.protect = S.t + 0.5;
              } else { q.vx *= mtRoll ? 0.25 : 0.5; q.vy *= mtRoll ? 0.25 : 0.5; }
            }
            return;
          } else {
            q.tackleCd = 1.3; q.stun = 0.7;
            uBeaten(q);
            act(q, 'lose', 0.7, { o: own.idx }); act(own, 'beat', 1.0, { o: q.idx });
            // 抜いた側は一気に前へ、抜かれた側は止まる（どっちが勝ったか動きで分かるように）
            { const mv = hyp(own.vx, own.vy), fdx = mv > 1 ? own.vx / mv : sgn(own.team), fdy = mv > 1 ? own.vy / mv : 0; const v = Math.max(5.5, maxSpeed(own) * 0.8);
              own.vx = fdx * v; own.vy = fdy * v; own.burstT = S.t + 0.5; if (S.dribbleDir) S.dribbleDir = [fdx, fdy]; own.protect = S.t + 0.4;
              q.vx *= 0.15; q.vy *= 0.15; }
            stats[own.team].dribbles_past++; noteBeat(own, q); own.beatT = S.t;
            if (R.next() < 0.045 + q.physical * 0.0005) { commitFoul(q, own); return; }   // 反則は少なめに
          }
        }
        return;
      }
      // 捨て身の守護神：飛び出したGKは、届く所まで来たら必ずボールに触る（足・胸・体を投げ出して）
      { const g = P.find((q) => q.gk && !q.off && (q.sutemiBall || 0) > S.t && q.team !== b.lastTeam);
        if (g && b.z < (fx(g.team, b.x) < 16.5 && Math.abs(b.y - GOAL_Y) < 20.2 ? 2.8 : 1.9) && hyp(g.x - b.x, g.y - b.y) < 3.0) { g.sutemiBall = 0; act(g, 'sweep', 0.7); stats[g.team].saves++; ev('save', { team: g.team, player: g.name, act: 'sweep' });
          if (fx(g.team, b.x) < 16.5 && Math.abs(b.y - GOAL_Y) < 20.2) { gainBall(g, 'save'); return; }   // ペナルティエリアの中：そのまま抱える
          // エリアの外：触ったら一瞬だけ守られて、すぐ判断（フリーの味方がいればつなぐ、いなければ大きくクリア）。持ったまま奪われて無人のゴール、を防ぐ
          gainBall(g, 'save'); g.protect = Math.max(g.protect || 0, S.t + 0.5); g.sweepT = S.t; S.decision = 0; return; } }
      // 針の穴通し：受け手の届く所まで来たスルーパスは、走りながら必ず収める（スルーしない・相手より先に触る）
      if ((b.hari || b.byP || b.aoP) && b.intended >= 0 && (b.kind === 'pass' || b.kind === 'loose')) { const q = P[b.intended];
        const dq0 = q ? hyp(q.x - b.x, q.y - b.y) : 99;
        if (b.byP && q && !q.off && !(q.downT > 0) && q.team === b.lastTeam && b.z >= 0.8 && b.z < 2.7 && dq0 < 2.8 && b.vz < 0 && !((b.byTrapT || -9) > S.t - 1.2)) {   // 白夜の視界：胸・ももで勢いを殺して、走る足もとへ自然に落とす（瞬間移動させない）
          act(q, 'chest', 0.4); b.byTrapT = S.t; b.landX = null; b.landY = null; const T0 = 0.42, tx = q.x + q.vx * (T0 + 0.1), ty = q.y + q.vy * (T0 + 0.1);
          b.vx = (tx - b.x) / T0; b.vy = (ty - b.y) / T0; b.vz = Math.min(0, b.vz) * 0.15; b.spin = 0; b.bs = 0; b.knuckle = false; }
        else if (q && !q.off && !(q.downT > 0) && q.team === b.lastTeam && b.z < (b.byP ? 0.8 : 1.5) && dq0 < (b.byP ? 1.5 : 1.6) && (b.z < 0.8 || b.vz < 0)) { if (b.z > 1.0) act(q, 'chest', 0.4); stats[q.team].passes_completed++; const aoRcv = b.aoP && !b.hari && !b.byP; gainBall(q, 'control');
          { const gx = fx(q.team, L), dx = gx - q.x, dy = (GOAL_Y - q.y) * 0.5, dl = hyp(dx, dy) || 1, ux = dx / dl, uy = dy / dl, sp = Math.max(hyp(q.vx, q.vy), maxSpeed(q) * 0.85);   // 前を向いたまま、走る足もとにぴたりと収める（後ろを向いて止めない）
            if (aoRcv) { const kb = q.uniq === 'aonoouza', bl = hyp(b.x - q.x, b.y - q.y) || 1, wx = kb ? (b.x - q.x) / bl : ux, wy = kb ? (b.y - q.y) / bl : uy;   // くもい自身（ゴールに背を向けて受ける）：来た側の足もとに止める（背中の向こうへ飛ばさない）
              const T0 = kb ? 0.3 : 0.25, nx = q.x + q.vx * T0 + wx * (kb ? 0.4 : 0.6), ny = q.y + q.vy * T0 + wy * (kb ? 0.4 : 0.6); Object.assign(b, { z: 0, vz: 0, vx: (nx - b.x) / T0, vy: (ny - b.y) / T0 }); q.settle = 'meet'; q.settleT = 0; q.meet = [nx, ny]; }   // 蒼の王座のスルーパス：走る先（前）へボールを置く（後ろに落とさない）
            else             { const nx = q.x + ux * 0.55, ny = q.y + uy * 0.55, jx = nx - b.x, jy = ny - b.y, jl = hyp(jx, jy), lim = Math.min(1, 0.35 / (jl || 1)); Object.assign(b, { z: 0, vz: 0, vx: q.vx + jx / 0.2, vy: q.vy + jy / 0.2 }); q.settle = 'meet'; q.settleT = 0; q.meet = [nx + q.vx * 0.2, ny + q.vy * 0.2]; }   // 足もとへは、ボールが転がって収まる（瞬間移動させない）   /* ボールは少しだけ寄せる（瞬間移動に見せない） */
            if (aoRcv) { const kb2 = q.uniq === 'aonoouza', bl2 = hyp(b.x - q.x, b.y - q.y) || 1; S.dribbleDir = kb2 ? [(b.x - q.x) / bl2, (b.y - q.y) / bl2] : [ux, uy]; S.dribbleMode = 'carry'; q.protect = Math.max(q.protect || 0, S.t + 0.8); }   // 蒼の王座のスルーパス：行きたい方向（ゴール）へ置いて、足もとに収めたまま運ぶ（大きく蹴り出さない＝置き去りにしない）
            act(q, 'poke', 0.3, { dx: ux, dy: uy, trap: 1 }); }
          return; } }
      // 月影の抜け出し：足もと付近に落ちてきたスルーパスは、走りながら確実に収める（胸・もも・足で）
      if (b.tsukiP && b.kind === 'pass' && b.intended >= 0) { const q = P[b.intended];
        if (q && !q.off && !(q.downT > 0) && b.z < 2.3 && hyp(q.x - b.x, q.y - b.y) < 1.5 && (b.z < 0.5 || b.vz < 0)) { if (b.z > 1.0) act(q, 'chest', 0.4); stats[q.team].passes_completed++; gainBall(q, 'control');
          { const gx = fx(q.team, L), dx = gx - q.x, dy = (GOAL_Y - q.y) * 0.5, dl = hyp(dx, dy) || 1; const nx = q.x + (dx / dl) * 0.5, ny = q.y + (dy / dl) * 0.5, jx = nx - b.x, jy = ny - b.y, jl = hyp(jx, jy), lim = 0; Object.assign(b, { z: 0, vz: 0, vx: q.vx + jx / 0.2, vy: q.vy + jy / 0.2 }); S.dribbleDir = [dx / dl, dy / dl]; q.settle = 'meet'; q.settleT = 0; q.meet = [nx + q.vx * 0.2, ny + q.vy * 0.2]; q.dO = 0.5; }   // ファーストタッチは前へ（後ろに置かない）
          return; } }
      // こぼれ球・パス・シュートを止める
      const sp = hyp(b.vx, b.vy);
      // PA内で浮いて来た球に合わせる技：ボレー（腰の高さ）・ダイビングヘッド（低いクロス）・バイシクル（高い球）
      if ((b.kind === 'pass' || b.kind === 'loose') && b.z > 0.3 && b.z < 2.4 && !S.setPiece) {
        for (const p of P) {
          if (p.gk || p.off || p.touchCd > 0 || p.downT > 0 || p.team !== b.lastTeam || !passOk(p, b)) continue;   // 合わせられるのは味方のクロス・パスや自分たちのこぼれ球だけ（相手のクリアをそのままボレーはしない）
          if (!shotCtx(p).box || (p.skLock || 0) > S.t || b.lastPlayer === p.idx) continue;   // 自分で触ったばかりの球・技の直後は合わせない
          const d = hyp(p.x - b.x, p.y - b.y);
          if (d > 1.7) continue;
          const sp = hyp(b.vx, b.vy);
          let how = null;
          if (skZ(p, 'volley') && b.z >= 0.35 && b.z <= 1.4 && d < 1.6) how = 'volley';
          else if (skZ(p, 'divingHeader') && b.z >= 0.3 && b.z <= 1.0 && sp > 5 && d < 1.7) how = 'divingHeader';
          else if (skZ(p, 'bicycle') && b.z >= 1.3 && b.z <= 2.5 && d < 1.4 && b.vz < 0.5) {
            // バイシクル：味方のクロス、または自分の頭上を後ろへ越えていく球（ゴールに背を向けている時）だけ
            const toGoal = fx(p.team, L) - p.x, away = Math.sign(b.vx || 1) !== Math.sign(toGoal);
            const cross = b.kind === 'pass' && (b.style === 'cross' || b.style === 'high' || b.style === 'lob') && b.kicker !== p.idx;
            if ((cross && hyp(b.vx, b.vy) > 4) || (away && hyp(b.vx, b.vy) > 3)) how = 'bicycle';
          }
          if (!how || R.next() > 0.75) continue;
          // 味方へのパスならパス成功として数える
          if (b.kind === 'pass' && b.kicker >= 0 && P[b.kicker].team === p.team && !b.selfPass) stats[p.team].passes_completed++;
          Object.assign(b, { owner: p.idx, kind: 'owned', vx: 0, vy: 0, vz: 0, lastTeam: p.team, lastPlayer: p.idx, intended: -1 });
          if (how === 'divingHeader') { act(p, 'divehead', 0.9, { dx: b.x - p.x, dy: b.y - p.y }); p.downT = 0.9; }
          else if (how === 'bicycle') { act(p, 'bicycle', 0.9); p.downT = 0.8; }
          else act(p, 'volleyK', 0.4);
          S.poss = p.team;
          const z0 = b.z;
          shoot(p, null, how);
          b.z = Math.max(b.z, z0);
          return;
        }
      }
      // 浮き球の競り合い：頭の高さなら跳んでヘディング（GKが手で取れる時はGK優先）
      if (b.kind !== 'shot' && b.z > 1.0 && b.z < 3.3 && b.vz < 1.5) {
        const gkNear = !(postBlock(b)) && P.some((p) => p.gk && !p.off && !(p.downT > 0) && !(b.hari && b.lastTeam !== p.team && fx(p.team, b.x) >= 5.5) && fx(p.team, b.x) < 16.5 && Math.abs(b.y - GOAL_Y) < 20.2 && !(b.lastTeam === p.team && b.kind === 'pass') && b.z <= gkReachZ(p) && hyp(p.x - b.x, p.y - b.y) < 1.2 + p.jump * 0.007);
        if (!gkNear) {
          const hc = P.filter((p) => !p.gk && !p.off && p.touchCd <= 0 && !(p.downT > 0) && !(p.slideT > 0) && passOk(p, b) && !(b.byP && p.idx === b.intended && p.team === b.lastTeam) && hyp(p.x - b.x, p.y - b.y) <= 1.05 + p.jump * 0.007 + (skZ(p, 'aerial') ? 0.35 : 0) && b.z <= headZ(p));   /* v738：頭が届く高さはジャンプで決まる（E 約2.3m〜S 約2.7m） */
          const contested = new Set(hc.map((p) => p.team)).size > 1;
          // 競る相手がいなければ、受け手は胸で落としてトラップ（うまい選手ほど確実）
          const rcv = b.kind === 'pass' && b.intended >= 0 ? hc.find((p) => p.idx === b.intended) : null;
          const rFree = rcv && !opps(rcv).some((q) => !q.off && hyp(q.x - rcv.x, q.y - rcv.y) < 4.5);   // 版845：まわりに相手がいない（ドフリー）
          if (rcv && !contested && b.z < (rFree ? 2.7 : 2.1) && !opps(rcv).some((q) => hyp(q.x - rcv.x, q.y - rcv.y) < 2.2) && R.next() < (rFree ? 0.85 + rcv.technique * 0.002 : 0.62 + rcv.technique * 0.0045 + Math.max(0, rcv.technique - 70) * 0.005)) {
            act(rcv, 'chest', 0.4); gainBall(rcv, 'control'); return;
          }
          if (hc.length && (b.z > 1.35 || contested) && !(b.style === 'head' && !contested)) {
            let best = null, bsc = -1e9;
            for (const p of hc) { const sc = p.jump * 0.75 + p.physical * 0.3 + p.technique * 0.15 + R.next() * 26 - hyp(p.x - b.x, p.y - b.y) * 25 + (skZ(p, 'aerial') ? 28 : 0) + (p.position === 'DF' ? 6 * aura(p, 'bodyVoice') : 0) + (uOn(p, 'matsuri') ? 32 * mtF(p) : 0) + ((p.b5 || -9) > S.t - 0.5 && fx(p.team, b.x) < 18 ? 10 : 0); if (sc > bsc) { bsc = sc; best = p; } }   // 空中戦の鬼：競り合いにめっぽう強い
            for (const p of hc) if (p !== best) { act(p, 'jump', 0.55); p.touchCd = 0.4; }
            header(best);
            return;
          }
        }
      }
      const cand = [];
      for (const p of P) {
        if (p.touchCd > 0 || p.off || p.downT > 0) continue;
        if (b.trapP && b.kind === 'pass' && p.team !== b.lastTeam && !p.gk) continue;   // 桜島の号令：一斉に押し上げたDFはボールを追わない（パスはラインの裏へ抜ける＝オフサイド）
        const inBox = fx(p.team, b.x) < 16.5 && Math.abs(b.y - GOAL_Y) < 20.2;
        // バックパスは手で取れない
        const gkHands = p.gk && inBox && !(b.lastTeam === p.team && b.kind === 'pass');
        const reach = gkHands ? (uOn(p, 'ikari') ? 0.35 * gP(p) : 0) + (p.diveT > 0 ? 1.4 + (p.jump * 0.7 + p.technique * 0.3) * 0.012 + Math.max(0, p.jump * 0.7 + p.technique * 0.3 - 70) * 0.02 : b.kind === 'shot' ? 1.15 + p.technique * 0.005 + p.jump * 0.004 + Math.max(0, p.jump * 0.7 + p.technique * 0.3 - 70) * 0.012 : 1.3 + p.jump * 0.004) : b.kind === 'shot' && p.team !== b.lastTeam ? 0.55 - (b.guren ? 0.45 * Math.min(1, b.grF ?? 1) : 0) + p.technique * 0.002 + (skZ(p, 'shotBlock') ? 0.4 : 0) + (uOn(p, 'miyabi') ? 0.9 * uP(p) : 0) + (uOn(p, 'matsuri') ? 0.6 * uP(p) * mtF(p) : 0) + (uOn(p, 'kagenui') && b.kicker === p.kgT ? 0.6 : 0) + ((p.b5 || -9) > S.t - 0.5 && fx(p.team, b.x) < 25 ? 0.15 : 0) + (fx(p.team, b.x) < 7 && Math.abs(b.y - GOAL_Y) < POST + 2 ? 0.9 : 0) : (p.team !== b.lastTeam && b.kind === 'pass' && skZ(p, 'intercept') ? 0.4 : 0) - (p.team !== b.lastTeam && b.kind === 'pass' ? (b.uSafe || 0) * 0.5 : 0) + (uOn(p, 'tetsurou') && p.team !== b.lastTeam ? 0.5 : 0) + ((p.sw5 || -9) > S.t - 0.5 && p.team !== b.lastTeam && b.kind === 'pass' ? 0.7 : 0) + (uOn(p, 'kagenui') && p.team !== b.lastTeam && b.kind === 'pass' ? (b.intended === p.kgT ? 1.3 : 0.35) : 0) + (uOn(p, 'miyabi') && b.kind === 'loose' ? 0.5 : 0) + (uOn(p, 'sutemi') && !gkHands ? 0.6 : 0) + (b.kind === 'loose' || hyp(b.vx, b.vy) < 5 ? 0.8 : b.kind === 'pass' && b.intended === p.idx ? 1.25 : 0.75) + (p.team === b.lastTeam ? p.technique : p.defense) * 0.003 + (p.team !== b.lastTeam ? DOM[p.team] * 0.45 : 0);   // ダイレクトのワンツーは読まれにくい
        if (b.z > (gkHands ? gkReachZ(p) : 1.9)) continue;
        if (!passOk(p, b)) continue;
        const rcvX = !gkHands && b.kind === 'pass' && b.intended === p.idx && p.team === b.lastTeam && b.z < 0.8 && p.technique >= 55 ? 0.45 : 0;   // 味方からのパスの受け手：足を伸ばして止める（横を通されて置き去りにしない）   // 味方へのパスは、ほかの味方はまたいで通す。月影の抜け出しのスルーパスは、触れる相手が限られる
        // GKはシュートの通り道（このコマで動いた線分）全体に手が届くかで判定
        // ボールがこのコマで通った線分で判定（速いパスが選手の足元をすり抜けないように）
        const d = b.px != null && hyp(b.vx, b.vy) > 3 ? segDist(p.x, p.y, b.px, b.py, b.x, b.y).d : hyp(p.x - b.x, p.y - b.y);
        if (gkHands && b.px != null) {   // GKの背中側（ゴール寄り）へ抜けた球には手が届かない（頭上を越えて落ちたドライブ・ループなど）
          const gl0 = fx(p.team, 0), u0 = hyp(b.vx, b.vy) > 3 ? segDist(p.x, p.y, b.px, b.py, b.x, b.y).u : 1, cx0 = b.px + (b.x - b.px) * u0;
          if (Math.abs(cx0 - gl0) < Math.abs(p.x - gl0) - 0.5) continue;
        }
        const ttX = uOn(p, 'tetsurou') && b.kind === 'pass' && p.team !== b.lastTeam && b.z < 1.2 ? (p.uniqLv >= 2 ? 1.1 : 0.9) : 0;   // 鉄狼の関所：そばを通るパスに足が届く
        if (d <= reach + rcvX + ttX) cand.push({ p, d, gkHands, reach });
      }
      cand.sort((a, c) => a.d - c.d);   // こぼれ球は、ボールに近い方が先に触る（守る側・攻める側の差はない）
      for (const { p, gkHands, reach, d: dGk } of cand) {
        let prob;
        if (b.kind === 'shot' && p.team !== b.lastTeam) {
          if (gkHands && postBlock(b)) { p.touchCd = 0.6; continue; }   // バーに当たって落ちてきた球にも反応できない
          if (gkHands) {
            const yAt = b.px != null ? b.py + (b.y - b.py) * segDist(p.x, p.y, b.px, b.py, b.x, b.y).u : b.y;
            const off = Math.abs(yAt - p.y) / reach;
            let { prob, skill, shotD, oneGK, rolling } = gkSaveProb(p, b, off, yAt, sp);
            const pre = p.preSave && p.preSave.t === b.shotT ? p.preSave : null;
            if (globalThis.__gkc) globalThis.__gkc.push({ st: b.shotT, pre: pre ? (pre.miss ? 'miss' : 'try') : 'none', prob: +prob.toFixed(2), dGk: +dGk.toFixed(2) });
            /* v758：止められなかったのに、ボールがGKの体（手）の上を通る時は、見た目でも「触ったけど入った」にする（すり抜けて見えないように） */
            const tipIn = () => { if (dGk > 1.3 || p.downT > 0) return false; { const gl = fx(p.team, 0), tl = Math.abs(b.vx) > 0.5 ? (gl - b.x) / b.vx : -1, yc = b.y + b.vy * tl; if (!(tl > 0 && Math.abs(yc - GOAL_Y) < POST - 0.2 && b.z < 2.3)) return false; }   /* 枠に向かっている球だけ（外れる球をゴールに入れない） */ ev('gk', { team: p.team, player: p.name, act: 'tip' }); p.touchCd = 1.2; if (!p.diveT && Math.abs(yAt - p.y) > 0.4) startDive(p, Math.sign(yAt - p.y), Math.abs(yAt - p.y), 0.12);   /* 吹き出しなしでも分かるように：手をボールまで伸ばして触る */
              const gl = fx(p.team, 0), side = Math.sign(yAt - p.y) || 1, ty2 = clamp(yAt + side * R.range(0.9, 1.7), GOAL_Y - POST + 0.5, GOAL_Y + POST - 0.5), dxg = gl - b.x || -sgn(p.team) * 0.5, tt = Math.max(0.12, Math.abs(dxg) / Math.max(7, sp * 0.5));   /* 版781：はじいた球は、はっきり向きと勢いが変わって（ふわっと浮いて）入る */
              Object.assign(b, { vx: dxg / tt, vy: (ty2 - b.y) / tt, vz: R.range(1.6, 3.2), z: Math.min(b.z, 1.8), spin: 0, curveAll: false, knuckle: false, wobW: null }); return true; };
            if (pre && pre.miss) { if (tipIn()) continue; p.touchCd = 1.2; continue; }   // 届かないと決まった横っ跳び：手はボールの手前
            const gkRoll = pre ? pre.r : R.next();
            // 超反応：決まったと思った瞬間に指先で触る／1対1の鬼：体を投げ出して、体のどこかに当てる
            const reflex = gkRoll >= prob && p.sk.has('superReflex') && shotD < 17 && R.next() < 0.12 + p.technique * 0.0015;
            const block1 = gkRoll >= prob && !reflex && oneGK && R.next() < 0.3;
            if (reflex || block1) { act(p, 'skill', 1.3, { k: reflex ? 'superReflex' : 'oneOnOne' }); stats[p.team].saves++; ev('save', { team: p.team, player: p.name, act: 'diveparry' });
              if (!p.diveT && !p.downT && Math.abs(yAt - p.y) > 0.6) startDive(p, Math.sign(yAt - p.y), Math.abs(yAt - p.y), 0.15);
              const side = Math.sign(b.y - GOAL_Y) || 1, out = R.next() < 0.45;   // 指先でかき出す：半分近くはゴールの横へ出てCKになる
              Object.assign(b, { vx: sgn(p.team) * (out ? -R.range(2, 5) : R.range(1, 4)), vy: side * R.range(4, 8), vz: R.range(2, 4), z: Math.max(b.z, 0.5), kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, spin: 0, knuckle: false });
              p.touchCd = 0.8; return; }
            // GKの体の正面（手が届くど真ん中）に来た球は、止められなくても必ずどこかに当たる（「今の止めてたでしょ」をなくす）
            const bodyHit = (off < (shotD < 12 ? 0.28 : 0.42) || (pre && off < 0.85)) && !b.knuckle && !b.csPlace;   // 置きに行くコントロールショットは、GKの手がぎりぎり届かない隅へ置く   // 至近距離は体の正面でも反応が間に合わないことがある   // 届くと決まった横っ跳びも、必ず触る
            if (gkRoll < prob || bodyHit) {
              const high = b.z > 1.7, diving = p.diveT > 0;
              // 無回転シュート：ブレるので、どんなGKでもキャッチできない。触っても必ずファンブルする
              //  そのままゴールへこぼれ込む／前にこぼす／うまいGKなら、コースを変えてゴールの外へ逃がす（CK）のが精一杯
              if (b.knuckle) {
                const pOut = clamp((skill - 55) * 0.013, 0, 0.5), pIn = clamp(0.26 - skill * 0.002, 0.08, 0.24) + (b.guren >= 2 ? (uOn(p, 'ikari') ? (p.uniqLv >= 2 ? 0.08 : 0.18) : 0.4) * Math.min(1, b.grF ?? 1) : 0), r = R.next();   // 白亜の城壁は、こぼれ込みを許さない   // 紅蓮の牙（凸）の無回転は、さらにこぼれ込みやすい
                const side = Math.sign(yAt - p.y) || (R.next() < 0.5 ? -1 : 1);
                p.touchCd = 1.2;
                if (r < pIn) {   // 手に当たったまま、勢いが残ってゴールへ
                  ev('gk', { team: p.team, player: p.name, act: 'fumble' });
                  const gl = fx(p.team, 0), ty2 = clamp(yAt + side * R.range(0.3, 1.2), GOAL_Y - POST + 0.6, GOAL_Y + POST - 0.6), dxg = gl - b.x || -sgn(p.team) * 0.5, tt = Math.max(0.12, Math.abs(dxg) / R.range(6, 10));
                  Object.assign(b, { vx: dxg / tt, vy: (ty2 - b.y) / tt, vz: R.range(0.2, 1.2), z: Math.min(b.z, 1.6), spin: 0, knuckle: false, wobW: null });
                  return;
                }
                stats[p.team].saves++;
                if (r < pIn + pOut) {   // うまいGK：はじいてコースを変え、ゴールの外へ（CK）
                  ev('save', { team: p.team, player: p.name, act: diving ? 'diveparry' : 'parry' });
                  const sideOut = Math.sign(b.y - GOAL_Y) || side;
                  Object.assign(b, { vx: -sgn(p.team) * R.range(2.5, 5), vy: sideOut * R.range(4, 8), vz: R.range(1.5, 3.5), z: Math.max(b.z, 0.5), kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, spin: 0, knuckle: false });
                } else {         // 前へこぼす（詰められる）
                  ev('save', { team: p.team, player: p.name, act: diving ? 'diveparry' : 'parry', fumble: 1 });
                  Object.assign(b, { vx: sgn(p.team) * R.range(1.5, 5), vy: side * R.range(1.5, 5), vz: R.range(0.3, 1.8), z: Math.max(b.z, 0.3), kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, spin: 0, knuckle: false });   // 横寄りにこぼれる
                }
                return;
              }
              // 紅蓮の牙（凸）：GKはキャッチできない。触っても勢いに負けて、ゴールへこぼれ込むことがある
              if (b.guren >= 2 && R.next() < (uOn(p, 'ikari') ? (p.uniqLv >= 2 ? 0.12 : 0.3) : 0.65) * Math.min(1, b.grF ?? 1)) {   // 白亜の城壁は、勢いに負けにくい（凸ならほぼ負けない）
                ev('gk', { team: p.team, player: p.name, act: 'fumble' }); p.touchCd = 1.2;
                const gl = fx(p.team, 0), side = Math.sign(yAt - p.y) || 1, ty2 = clamp(yAt + side * R.range(0.3, 1.0), GOAL_Y - POST + 0.6, GOAL_Y + POST - 0.6), dxg = gl - b.x || -sgn(p.team) * 0.5, tt = Math.max(0.12, Math.abs(dxg) / R.range(7, 11));
                Object.assign(b, { vx: dxg / tt, vy: (ty2 - b.y) / tt, vz: R.range(0.2, 1.0), z: Math.min(b.z, 1.6), spin: 0, knuckle: false, wobW: null });
                return;
              }
              // 至近距離のシュートはキャッチできない：はじく（ディフレクト）のが基本
              const nearK = shotD < 7 ? 0.15 : shotD < 11 ? 0.4 : shotD < 15 ? 0.75 : 1;
              const catchP = rolling || b.conv ? 0.92 : ((high ? 0.25 : diving ? 0.4 : 0.62) + p.technique * 0.003 - Math.max(0, sp - 24) * 0.02) * nearK * (gkRoll >= prob ? 0.3 : 1);
              if (R.next() < (uOn(p, 'ikari') ? catchP + ((p.uniqLv >= 2 ? Math.max(catchP * 1.8, 0.92 * Math.max(nearK, 0.75)) : Math.min(0.95, catchP * 1.4 + 0.1)) - catchP) * Math.min(1, gkF(p)) : catchP) && !(postBlock(b)) && !(b.guren >= 2 && !(uOn(p, 'ikari') && p.uniqLv >= 2))) {   // 白亜の城壁（凸）は、紅蓮の牙（凸）のシュートもキャッチできる   // 白亜の城壁（凸）：はじかずに、がっちり抱える（こぼれ球を詰めさせない）   // バーに当たって落ちてきた球はキャッチできない。紅蓮の牙（凸）もキャッチできない
                if (globalThis.__ctl) globalThis.__ctl.push({ t: S.t, bx: +b.x.toFixed(2), by: +b.y.toFixed(2), bz: +b.z.toFixed(2), px: +(b.px ?? 0).toFixed(2), pz: +(b.pz ?? 0).toFixed(2), gx: p.x, gy: p.y });
                gainBall(p, 'save');
                ev('gk', { team: p.team, player: p.name, act: diving ? 'divecatch' : 'catch' });
                return;
              }
              stats[p.team].saves++;
              if (high) {
                // パンチング（上へ・外へ）
                p.punchT = 0.5;
                ev('save', { team: p.team, player: p.name, act: 'punch' });
                punchTo(p, b, false);
              } else {
                // 横へはじく
                ev('save', { team: p.team, player: p.name, act: diving ? 'diveparry' : 'parry' });
                const side = diving ? p.diveDir : (R.next() < 0.5 ? -1 : 1);
                // 下手なGKは正面にこぼしてしまう（詰められる）
                const spill = R.next() < (1 - skill / 100) * 0.7;
                if (spill) Object.assign(b, { vx: sgn(p.team) * R.range(2, 5), vy: side * R.range(0.5, 2.5), vz: R.range(0.3, 1.5), z: Math.max(b.z, 0.3), kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, spin: 0, knuckle: false });
                else { const out = R.next() < 0.4;   // 横へはじく：ゴールの外（ゴールライン）へ逃がすとCK
                  Object.assign(b, { vx: sgn(p.team) * (out ? -R.range(2, 5) : R.range(1, 4)), vy: side * R.range(5, 10), vz: R.range(1, 3), z: Math.max(b.z, 0.4), kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, spin: 0, knuckle: false }); }
              }
              p.touchCd = 0.8;
              return;
            }
            if (tipIn()) continue;
            p.touchCd = 1.2;
            // 止められなかった：正面でも体を投げ出して手を伸ばす（GKも頑張ったが届かなかった、と見えるように）
            // 届かなかったように見せる：飛ぶのが少し遅れて、手はボールの手前までしか届かない
            if (!p.diveT && !p.downT && !p.lateDive && Math.abs(yAt - p.y) > 1.0) missDive(p, yAt - p.y, 0.12, false);   // 正面は飛ばない
            continue;
          }
          // ゴールライン際：ゴールに向かう球に、スライディングで足を伸ばしてかき出す（ゴールを割らせないことが第一）
          if (fx(p.team, b.x) < 7 && Math.abs(b.y - GOAL_Y) < POST + 2 && b.z < 1.2) {
            const dxl = b.x - p.x, dyl = b.y - p.y, dl = hyp(dxl, dyl) || 1;
            p.slideT = 0.45; p.vx = (dxl / dl) * 6; p.vy = (dyl / dl) * 6;
            act(p, 'slide', 1.25, { dx: dxl / dl, dy: dyl / dl, from: 'front' });
            if (R.next() < clamp(0.45 + p.defense * 0.004 - Math.max(0, hyp(b.vx, b.vy) - 20) * 0.02 + (skZ(p, 'slide') ? 0.12 : 0), 0.3, 0.9)) {
              ev('block', { team: p.team, player: p.name, clear: 1 });
              const side = Math.sign(b.y - GOAL_Y) || (R.next() < 0.5 ? 1 : -1), out = R.next() < 0.5;   // ゴールラインの外へ（CK）か、横へかき出す
              Object.assign(b, { vx: out ? -sgn(p.team) * R.range(3, 6) : sgn(p.team) * R.range(2, 6), vy: side * R.range(5, 10), vz: R.range(0.5, 2.5), z: Math.max(b.z, 0.2), kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, spin: 0, knuckle: false, curveAll: false });
              p.touchCd = 0.8; return;
            }
            p.touchCd = 1; continue;   // 届かなかった
          }
          prob = (skZ(p, 'shotBlock') ? 0.68 : p.uniq === 'kinshachi' ? 0.6 : 0.3) + (dGk < 0.35 ? 0.5 : dGk < 0.5 ? 0.25 : 0);   // 版780：体の真ん中を通る球は、まず当たる（すり抜けて見えないように） // 体で止める（金鯱の心臓：体を投げ出してでも止める）（シュートブロック：コースに体を投げ出す）
          if (opps(P[b.kicker])[0]?.sk.has('coaching')) prob += 0.08;   // GKのコーチングでDFがコースを切っている
          if (R.next() < prob) {
            ev('block', { team: p.team, player: p.name });
            { let [vx, vy] = rebound(p, b, 0.35);
              // 体に当たったシュートは、勢いのままゴールラインの外へ逃げることも多い（CKになる）
              if (R.next() < 0.4 && fx(p.team, p.x) < 22) { const sp2 = Math.max(4, hyp(b.vx, b.vy) * 0.4); vx = -sgn(p.team) * sp2 * R.range(0.6, 0.9); vy = (Math.sign(b.y - GOAL_Y) || (R.next() < 0.5 ? 1 : -1)) * sp2 * R.range(0.5, 0.9); }
              Object.assign(b, { vx, vy, kind: 'loose', lastTeam: p.team, lastPlayer: p.idx }); }
            { const ux = b.x - p.x, uy = b.y - p.y, ud = hyp(ux, uy) || 1; act(p, 'poke', 0.35, { dx: ux / ud, dy: uy / ud, blk: 1 }); }
            p.touchCd = 0.6;
            return;
          }
          p.touchCd = 1; continue;
        }
        if (b.kind === 'shot' && p.team === b.lastTeam) continue;
        const pvB = b.kind === 'pass' && b.kicker >= 0 && P[b.kicker].team === p.team ? Math.max(0, (P[b.kicker].pass - 50) * 0.12) : 0;   /* v740 パスがうまいほど、速くても止めやすい球（受け手の許容が上がる） */
        if (p.team === b.lastTeam && (b.hari || b.byP) && b.intended === p.idx) prob = 1;   // 白夜の視界の1本も、受け手は必ず収める（置き去りにしない）   // 針の穴通し：ぴたりと届く1本は必ず収まる
        else if (p.team === b.lastTeam) prob = (b.intended === p.idx && condLv(p.team) ? 0.22 : 0) + (b.intended === p.idx ? (b.uSafe || 0) * 0.3 + 0.65 + (b.kicker >= 0 && P[b.kicker].team === p.team ? (P[b.kicker].pass - 55) * 0.004 : 0) + p.technique * 0.0039 + Math.max(0, p.technique - 65) * 0.004 + Math.max(0, p.technique - 80) * 0.004 - Math.max(0, sp - 17 - pvB) * Math.max(0.006, 0.045 - p.technique * 0.0004) + (opps(p).some((o) => !o.gk && hyp(o.x - p.x, o.y - p.y) < 2) ? (p.physical - 50) * 0.003 : 0) : 0.75 + p.technique * 0.002);   // トラップの上手さはテクニック次第
        // 足の届くボールはしっかり触る（素通りさせない）。速い球や浮き球ほど止めにくい
        else prob = clamp(0.95 - Math.max(0, sp - 9) * 0.035 + p.defense * 0.002 - (b.z > 0.6 ? 0.25 : 0) + (b.kind === 'pass' && b.kicker >= 0 ? (p.defense - P[b.kicker].pass) * 0.004 : 0) + (b.kind === 'pass' && skZ(p, 'intercept') ? 0.26 : 0) + (uOn(p, 'tetsurou') || uOn(p, 'sutemi') ? 0.2 : 0) + 0.03 * aura(p, 'relief'), 0.15, 0.99) * (b.kind === 'pass' ? 1 - (b.uSafe || 0) : 1);   // うまいパスは足を出されても抜けていく（針の穴通しなどは、さらに触られにくい）
        if (sp < 4.5 && b.z < 0.5) prob = Math.max(prob, 0.97);   // ゆっくり転がるボールはしっかり収める
        if (p.team === b.lastTeam && b.intended === p.idx && p.technique >= 68 && sp < 24 + pvB && b.z < 1.0) prob = Math.max(prob, 0.995);
        else if (p.team === b.lastTeam && b.intended === p.idx && p.technique >= 55 && sp < 20 + pvB && b.z < 1.0) prob = Math.max(prob, 0.97);   // テクニックC以上：味方からの普通のパスは、まず止める   // D1・D2レベル（テクニック68以上）：味方からのパスを置き去りにするトラップミスは、ほぼしない
        if (b.tsukiP && b.kind === 'pass' && p.idx === b.intended) prob = Math.max(prob, 0.97);   // 月影の抜け出し：走りながらぴたりと収める
        if (gkHands && S.gkCk && S.gkCk.g === p.idx && S.gkCk.mode !== 'stay' && b.z > 0.8 && b.kind === 'pass') {
          const m = S.gkCk.mode; S.gkCk = null; if (!(p.highT > 0)) { p.highT = 0.45; act(p, 'jump', 0.45); }
          if (m === 'miss') { p.touchCd = 1.2; ev('gk', { team: p.team, player: p.name, act: 'miss' }); continue; }   // 目測を誤って、かぶる
          if (m === 'punch') { p.punchT = 0.5; p.touchCd = 0.6; stats[p.team].saves++; ev('save', { team: p.team, player: p.name, act: 'punch' }); punchTo(p, b, true); return; }
          gainBall(p, 'control'); ev('gk', { team: p.team, player: p.name, act: 'claim' }); return;
        }
        // ポスト・バーに当たって跳ね返った直後の球、飛び込んで空中にいるGK：キャッチはできない（はじく・触れない）
        if (gkHands && postBlock(b)) { p.touchCd = 0.6; continue; }   // ポスト・バーの跳ね返りには、GKは反応できない（キャッチもパンチングもしない）
        if (gkHands && p.diveT > 0) {
          p.touchCd = 0.6;
          if (R.next() < 0.55) { p.punchT = 0.4; stats[p.team].saves++; ev('save', { team: p.team, player: p.name, act: p.diveT > 0 ? 'diveparry' : 'parry' }); punchTo(p, b, false); return; }
          continue;
        }
        if (gkHands) {
          prob = Math.max(prob, 0.9);
          const crowded = b.z > 1.1 && opps(p).some((q) => hyp(q.x - p.x, q.y - p.y) < 1.8);
          if (b.z > 1.6) act(p, 'jump', 0.55);   // 高いボールに跳んで手を伸ばす
          if (crowded && R.next() < 0.55 - p.technique * 0.004) {   // テクニックが高いほど、競られてもキャッチできる（基本はジャンプしてキャッチ）
            p.punchT = 0.5; p.touchCd = 0.6;
            ev('save', { team: p.team, player: p.name, act: 'punch' });
            punchTo(p, b, true);
            return;
          }
        }
        // 飛び出したGK（手が使えない所）：相手と競る中途半端な場面では、止めようとせず、はっきり大きくクリアする
        if (p.gk && !gkHands && b.z < 1.8 && p.team !== b.lastTeam && opps(p).some((o) => !o.off && hyp(o.x - b.x, o.y - b.y) < 3.5) && R.next() < 0.92) {
          act(p, 'gkplay', 1.2, { k: 'gkClear' }); const side = p.y < GOAL_Y ? -1 : 1;
          kick(p, clamp(b.x + sgn(p.team) * R.range(30, 45), 2, L - 2), clamp(b.y + side * R.range(8, 20), 2, W - 2), 'pass', 'clear', { landFrac: R.range(0.85, 1.0) });
          Object.assign(b, { intended: -1, offside: false, kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, kicker: p.idx, byP: false, hari: false, tsukiP: false, tact: false }); p.touchCd = 0.6; return; }
        if (globalThis.__trapLog && p.team === b.lastTeam && b.intended === p.idx) globalThis.__trapLog.try++;
        if (globalThis.__tfLog && p.team === b.lastTeam && b.intended === p.idx) globalThis.__tfLog.push({ t: S.t, q: p.idx, prob: +prob.toFixed(3), sp: +sp.toFixed(1), z: +b.z.toFixed(2), tec: p.technique });
        if (R.next() < prob) { const icp = b.kind === 'pass' && b.lastTeam !== p.team && !gkHands && p.sk.has('intercept'); gainBall(p, 'control'); if (icp) { act(p, 'icpt', 0.9);   /* 版846：インターセプトは吹き出しなし（青い輪だけ） */ if (globalThis.__tyDbg) globalThis.__tyDbg.icpt = (globalThis.__tyDbg.icpt || 0) + 1; } if (gkHands && b.z > 1.1) ev('gk', { team: p.team, player: p.name, act: 'claim' }); return; }   // 版838：インターセプトで奪ったら、頭の上に技の名前と青い輪
        p.touchCd = 0.45;
        if (p.team !== b.lastTeam && b.kind === 'pass' && (b.uSafe || 0) > 0 && R.next() < b.uSafe) { p.touchCd = 0.8; continue; }   // うまいパスは、出した足をすり抜けていく（触れずに通る。はじいてこぼさない）
        // 味方へのパスを、受け手がすぐ後ろで待っている時だけはまたいで通す（スルー）
        if (p.team === b.lastTeam && b.intended >= 0 && b.intended !== p.idx && hyp(P[b.intended].x - p.x, P[b.intended].y - p.y) < 8) { p.touchCd = 0.8; continue; }
        // はじいた（受け手のトラップミスは足元近くにこぼれる）
        const heavy = p.team === b.lastTeam && b.intended === p.idx;
        if (globalThis.__trapLog && heavy) globalThis.__trapLog.miss++;
        // 当たった所から跳ね返る：体（足）からボールへの向きに押し出され、勢いは落ちる（誰に当たってどっちへ転がったか分かるように）
        const [vx, vy] = rebound(p, b, heavy ? 0.3 : 0.45);
        { const ux = b.x - p.x, uy = b.y - p.y, ud = hyp(ux, uy) || 1; act(p, 'poke', 0.35, { dx: ux / ud, dy: uy / ud }); }
        Object.assign(b, { vx, vy, vz: Math.min(b.vz, 0), kind: 'loose', lastTeam: p.team, lastPlayer: p.idx, intended: -1 });
        return;
      }
    }

    // ---------- 審判 ----------
    const ref = { x: L / 2 - 6, y: W / 2 + 10, vx: 0, vy: 0 };
    const ar = [L * 0.75, L * 0.25];   // 奥の副審（右半分）・手前の副審（左半分）
    function moveOfficials() {
      const b = S.ball;
      let tx = b.x + (b.x < L / 2 ? 9 : -9), ty = clamp(b.y + (b.y < GOAL_Y ? 11 : -11), 3, W - 3);
      if (S.refFocus && S.refFocus.t > 0) { S.refFocus.t -= DT; tx = S.refFocus.x + 2.5; ty = S.refFocus.y + 2; }
      if (S.restart && S.restart.type === 'penalty') { tx = S.restart.x + (S.restart.x > L / 2 ? -4 : 4); ty = GOAL_Y + 12; }
      if (S.restart && S.restart.type === 'free') { tx = S.restart.x + (S.restart.x > L / 2 ? -6 : 6); ty = clamp(S.restart.y + 6, 3, W - 3); }
      // カード：反則した選手の手前（カメラ側）に立って、向き合って掲げる
      if (S.refCard && S.refCard.p) { const q = S.refCard.p; tx = q.x; ty = q.y + 1.5; if (hyp(tx - ref.x, ty - ref.y) < 0.6 || S.refCard.t < 3.6) S.refCard.show = true; }
      const dx = tx - ref.x, dy = ty - ref.y, d = hyp(dx, dy), v = Math.min(S.refCard && S.refCard.p ? 8 : 6.8, d * (S.refCard && S.refCard.p ? 2 : 1.2));
      ref.vx += ((d > 0.01 ? (dx / d) * v : 0) - ref.vx) * 0.15; ref.vy += ((d > 0.01 ? (dy / d) * v : 0) - ref.vy) * 0.15;
      ref.x += ref.vx * DT; ref.y += ref.vy * DT;
      // 副審はオフサイドラインに合わせて走る
      const right = side[0] > 0 ? 1 : 0, left = 1 - right;   // 右ゴールを守るチーム / 左ゴールを守るチーム
      const xsR = T[right].players.map((q) => q.x).sort((a, c) => c - a), xsL = T[left].players.map((q) => q.x).sort((a, c) => a - c);
      let t0 = clamp(Math.max(xsR[1] ?? L, b.x), L / 2, L), t1 = clamp(Math.min(xsL[1] ?? 0, b.x), 0, L / 2);
      const rs = S.restart;
      if (rs) {
        // コーナー・ゴールキックはゴールラインへ、オフサイドは反則の位置、スローインは出た所の近くで合図
        const right = rs.x > L / 2;
        const spot = rs.type === 'corner' || rs.type === 'goalkick' ? (right ? L : 0) : rs.offside || rs.type === 'throw' ? rs.x : null;
        if (spot != null) { if (right) t0 = clamp(spot, L / 2, L); else t1 = clamp(spot, 0, L / 2); }
      }
      ar[0] += clamp(t0 - ar[0], -0.8, 0.8); ar[1] += clamp(t1 - ar[1], -0.8, 0.8);
      if (S.refCard) { S.refCard.t -= DT; if (S.refCard.t <= 0) S.refCard = null; }
    }

    // ---------- 記録 ----------
    function record() {
      const r = S.restart;
      const held = r && r.stage === 'held' ? r.taker : -1;
      const f = [S.t, S.ball.x, S.ball.y, S.ball.z, held >= 0 ? held : S.ball.owner, S.score[0], S.score[1]];
      for (const p of P) f.push(+p.x.toFixed(2), +p.y.toFixed(2), Math.round(p.cur));
      f.push(r ? (r.offside ? 8 : RESTART_CODE[r.type]) : S.celebrate > 0 ? 6 : 0, held, S.ball.drive && S.ball.kind === 'shot' && S.ball.z > 0.1 ? 4 : S.ball.knuckle && S.ball.z > 0.1 ? 1 : Math.abs(S.ball.spin || 0) > 0.3 && S.ball.z > 0.1 ? (S.ball.spin > 0 ? 2 : 3) : 0);
      // 審判・副審・カード・GKの姿勢・退場者
      const gkCode = (g) => (g.diveT > 0 ? (g.diveDir > 0 ? 1 : 3) : g.downT > 0 ? (g.diveDir > 0 ? 2 : 4) : g.highT > 0 ? 7 : g.punchT > 0 ? 6 : g.hold && S.ball.owner === g.idx ? 5 : 0);   // 版834：7＝ハイボールに跳んでいる
      let gone = 0;
      for (const p of P) if (p.off && p.y > W + 2.5) gone += 2 ** p.idx;
      f.push(+ref.x.toFixed(2), +ref.y.toFixed(2), +ar[0].toFixed(2), +ar[1].toFixed(2), S.refCard && S.refCard.show ? S.refCard.code : 0, gkCode(P[0]), gkCode(P[11]), gone, side[0], r ? r.team : -1, r ? +r.x.toFixed(1) : -1, r ? +r.y.toFixed(1) : -1, +(S.ball.bs || 0).toFixed(2), S.kickRec, S.ball.owner < 0 && (S.ball.kind === 'pass') ? (S.ball.intended ?? -1) : -1);
      S.kickRec = -1;
      frames.push(f);
    }
    function logTypes() {
      if (S.restart || S.celebrate > 0) return;   // 流れの中の動きだけを集計
      const own = ownerP();
      for (const p of P) {
        if (p.gk || p.off) continue;
        const key = p.team + ':' + p.type;
        const g = typeLog[key] || (typeLog[key] = { team: p.team, type: p.type, atkX: 0, atkN: 0, defX: 0, defN: 0, distOwner: 0, nOwner: 0, box: 0, beyondLine: 0, pressSum: 0, ySum: 0, xx: 0, yAtk: 0 });
        const xf = fx(p.team, p.x); g.ySum += Math.abs(p.y - GOAL_Y); g.xx += xf * xf; if (S.poss === p.team) g.yAtk += Math.abs(p.y - GOAL_Y);
        if (S.poss === p.team) {
          g.atkX += xf; g.atkN++;
          if (xf > L - 16.5 && Math.abs(p.y - GOAL_Y) < 20) g.box++;
          if (xf > offsideLine(p.team) - 0.5) g.beyondLine++;
          if (own !== p) { g.distOwner += hyp(S.ball.x - p.x, S.ball.y - p.y); g.nOwner++; }
        } else {
          g.defX += xf; g.defN++;
          const tgt = own || S.ball;
          if (hyp(tgt.x - p.x, tgt.y - p.y) < 4) g.pressSum++;
        }
      }
    }

    // ゴールに入ったボールは、ゴールラインより奥（ネットの中）にとどめる：ネットに当たって跳ね返っても、ライン上まで戻ってこない
    function netKeep(b) {
      if (S.celebrate > S.cel0 - 0.5) return;   // 入った直後（まだ奥へ進んでいる間）はそのまま
      const inL = b.x < L / 2;
      if (inL && b.x > -1.0) { b.x = -1.0; b.vx = Math.min(b.vx, 0); }
      if (!inL && b.x < L + 1.0) { b.x = L + 1.0; b.vx = Math.max(b.vx, 0); }
    }
    // ---------- 本体 ----------
    kickoffPositions(0);
    computeTargets();
    let step = 0;
    // 前後半の終わり：アディショナルタイムを少し越えてから（20〜40秒ぶん）笛。
    // ただし、その時に攻撃の最中（ゴール前・シュート・ゴール前のセットプレー）なら、それを「ラストプレー」にして、
    // シュートが終わる・相手に取られる・プレーが切れる・GKが持つ、のどれかで笛を吹く（最大10秒）
    let halfStartT = 0, curHalf = 1, lastPlay = null;
    const hot = () => {
      if (S.celebrate > 0) return S.celebrate >= S.cel0 - 4.5;
      if (S.restart) { const r = S.restart; return r.type === 'penalty' || ((r.type === 'corner' || r.type === 'free') && fx(r.team, r.x) > L - 32); }
      const b = S.ball;
      if (b.kind === 'shot' || b.kind === 'cross') return true;
      if (b.owner < 0 && b.kind === 'pass' && (b.style === 'cross' || (b.landX != null && (b.landX < 32 || b.landX > L - 32)))) return true;   // 版845：ゴール前へ向かって飛んでいるボール（クロス・浮き球）の途中では笛を吹かない
      const own = ownerP();
      if (own && own.gk) return false;
      // ゴール前（両端32m）にボールがある、またはそこへ向かうパス・クロスが出ている
      if (b.x < 32 || b.x > L - 32) return true;
      if (b.kind === 'pass' && b.intended >= 0) { const q = P[b.intended]; if (q.x < 32 || q.x > L - 32) return true; }
      if (own && fx(own.team, own.x) > L - 45 && S.counter > 0) return true;
      return false;
    };
    const overMin = () => 1.6 + ((S.score[0] * 3 + S.score[1] * 5 + curHalf * 7 + events.length) % 5) * 0.4;   // 1.6〜3.2秒（時計で20〜40秒）
    const whistleNow0 = (el) => {
      if (el < HALF + overMin()) return false;
      { const b0 = S.ball, fly = b0.owner < 0 && (b0.kind === 'cross' || b0.kind === 'shot' || (b0.kind === 'pass' && b0.style === 'cross') || ((b0.kind === 'pass') && (b0.z || 0) > 0.4 && (b0.x < 32 || b0.x > L - 32 || (b0.landX != null && (b0.landX < 32 || b0.landX > L - 32)))));
        if (fly && el < HALF + 28) return false; }   // 版845：クロス・シュートが飛んでいる間は、待ち時間の上限でも笛を吹かない（落ちて次のプレーが決まってから）
      if (el >= HALF + 20 + (lastPlay && lastPlay.ck ? 9 : 0)) return true;   // ラストプレーは最大20秒まで待つ（CKまでやるときは、そのぶん長く）
      if (!lastPlay) { if (!hot()) return true; const rt = S.restart ? S.restart.type : null; lastPlay = { team: S.restart ? S.restart.team : S.poss, restart: rt, shot: false, ck: rt === 'corner' }; return false; }
      // ラストプレーの続き：終わったら笛
      const b = S.ball, own = ownerP();
      if (b.kind === 'shot') { lastPlay.shot = true; return false; }
      if (S.celebrate > 0) return S.celebrate < S.cel0 - 4.5;
      if (S.restart) {
        const t = S.restart.type;
        if (t === lastPlay.restart) return false;                  // まだ同じ再開を待っているところ
        if (t === 'penalty') { lastPlay.restart = t; return false; }
        // ラストプレーでCKになったら、そのCKまでやる（CKのプレーが切れたら笛）
        if (t === 'corner' && !lastPlay.ck) { Object.assign(lastPlay, { ck: true, restart: t, team: S.restart.team, shot: false }); return false; }
        return true;                                                // それ以外でプレーが切れたら笛
      }
      lastPlay.restart = null;
      if (own && own.gk) return true;
      if (own && own.team !== lastPlay.team) return true;
      if (lastPlay.shot && own && own.team !== lastPlay.team) return true;
      if (lastPlay.team != null && b.lastTeam != null && b.lastTeam !== lastPlay.team && b.kind !== 'shot' && !(b.owner < 0 && b.lastTeam === lastPlay.team)) { const fly = b.owner < 0 && (b.z || 0) > 0.4 && b.lastTeam === lastPlay.team; if (!fly) return true; }   // 版846：守る側が触った（クリア・カット）＝攻撃の流れが切れたら笛
      if (lastPlay.shot && own && own.team === lastPlay.team && fx(own.team, own.x) < L - 32) return true;   // 打った後、味方が拾っても下げて組み立て直すなら終わり
      // 攻めている側のボール（こぼれ球を含む）が相手陣内にある間は、攻撃が終わるまで待つ（こぼれ球を詰める前に笛を吹かない）
      const atk = lastPlay.team != null ? lastPlay.team : S.poss; if (atk != null && atk >= 0 && fx(atk, b.x) > L / 2 && (!own || own.team === atk)) return false;
      return !hot();
    };
    const whistleNow = (el) => { const r = whistleNow0(el); if (r && globalThis.__wh) { const b = S.ball, own = ownerP(); globalThis.__wh.push({ t: +S.t.toFixed(1), el: +el.toFixed(2), lp: lastPlay ? JSON.stringify(lastPlay) : null, kind: b.kind, own: b.owner, ownT: own ? own.team : -1, gk: own ? !!own.gk : false, bx: +b.x.toFixed(1), hot: hot(), rs: S.restart ? S.restart.type : null }); } return r; };
    while (true) {
      const el = S.t - halfStartT;
      if (el >= HALF - 1e-6 && whistleNow(el)) {
        lastPlay = null;
        if (curHalf === 2 || opts.oneHalf) break;   // 版560：練習試合は前半だけ
        curHalf = 2; halfStartT = S.t;
        S.celebrate = 0; S.restart = null;
        S.half = 2;
        ev('half', {});
        for (let k = 0; k < 2; k++) if (S.score[k] <= S.score[1 - k]) capRally(k);   // 版838：後半の始まり（勝っていなければ）
        for (const p of P) p.cdRem = 0;   // 港の指揮者の残りの秒数は、前半で終わり
        for (const p of P) p.cur = Math.min(100, p.cur + HALF_REST);   // ハーフタイムで少し回復
        // ハーフタイムの指示と、前半のうちに出したのにプレーが切れなかった指示
        for (const ch of (opts.changes || []).filter((c) => c.at == null)) applyHalfChange(ch);
        while (pendingCh.length && pendingCh[0].at < S.t + 1) applyHalfChange(pendingCh.shift());
        for (const tm of T) if (tm.autoSubs) {
          // 相手チーム：この試合で何人替えるか（2〜3人）を決めて、ハーフタイムに替えることもある
          tm.subPlan = Math.min(tm.subsLeft, tm.bench.filter((q) => q.position !== 'GK').length, R.next() < 0.5 ? 3 : 2);
          tm.subNext = 50 + R.range(0, 8);
          if (R.next() < 0.35) autoSub(tm);
        }
        side[0] = -1; side[1] = 1;   // コートチェンジ
        for (const tm of T) mirrorSlots(tm);   // 持ち場の左右も、攻める向きに合わせて裏返す（左ウイングは後半も左）
        for (const p of P) p.facing = -p.facing;
        kickoffPositions(1);
      }
      if (S.celebrate > 0) {
        S.celebrate -= DT;
        if (S.celebrate <= 0) {
          // 全員が自分の位置に戻るまで待つ（最大4秒）
          let far = 0;
          for (const p of P) { const ko = kickoffSpot(p, S.kickoffTeam); far = Math.max(far, hyp(fx(p.team, ko[0]) - p.x, ko[1] - p.y)); }
          S.koWait = (S.koWait || 0) + DT;
          if (far > 0.6 && S.koWait < 15) S.celebrate = 0.01;   // 版560：全員が戻るまで待つ（前は最大4.5秒で、戻りきらない選手が瞬間移動していた）
          else { if (globalThis.__koLog) globalThis.__koLog.push([+far.toFixed(1), +S.koWait.toFixed(1)]); S.koWait = 0; kickoffPositions(S.kickoffTeam); }
        }
      } else if (S.restart) {
        tickRestart();
      } else {
        const own = ownerP();
        // 溜めシュート：時間が来たら打つ。途中でボールを失ったら取り消し
        if (S.charge && (!own || own.idx !== S.charge.p)) S.charge = null;
        if (S.charge && own && S.t >= S.charge.t) { const c = S.charge; S.charge = null; shoot(own, c.aimY, null, c); }
        else if (own) {
          S.decision -= DT; if (S.counter > 0) S.counter -= DT;
          const close = nearestOpp(own, own.x, own.y).d;
          if (close < 1.6 && S.decision > 0.25 && !own.gk) S.decision -= DT * 2;
          // 判断力：寄せてくる相手に早く気づくほど、取られる前に次のプレー（運ぶ・預ける・スルーパス・仕掛ける）を選び直せる
          //   気づく距離 E（50未満）気づかない／C（65）約3.9m／S（90）約4.8m。気づいてから決めるまでの間も、判断力が高いほど短い
          { const notice = own.vision < 50 ? 0 : 1.6 + own.vision * 0.035;   // 判断力が50未満の選手は、寄せてくる相手に気づかない（そのままのプレーを続けてしまう）
            const cq = nearestOpp(own, own.x, own.y).q, closing = cq ? ((own.x - cq.x) * (cq.vx - own.vx) + (own.y - cq.y) * (cq.vy - own.vy)) / (close || 1) : 0;   // 寄せてきている（近づく速さ）
            if (!own.gk && fx(own.team, own.x) < L - 26 && close < notice && close > 1.0 && closing > 1.0 && S.decision > 0.05 && (own.noticeT || 0) < S.t && !own.pace) { S.decision = Math.min(S.decision, 0.02 + Math.max(0, 100 - own.vision) * 0.004); own.noticeT = S.t + 1.2; if (globalThis.__noticeLog) globalThis.__noticeLog.push(own.vision); } }
          if (S.forcePass && S.t >= S.forcePass.at && own.team === P[S.forcePass.to].team && !((own.moveQ && own.moveQ.length) || own.moveEnd)) { S.decision = Math.min(S.decision, 0); if (hyp(S.ball.x - own.x, S.ball.y - own.y) < 1.4) { own.settle = false; own.dO = 0.5; } }   // 月影の抜け出し：すぐ出す（足もとにあれば、トラップを待たずに）
          if ((own.moveQ && own.moveQ.length) || own.moveEnd) S.decision = Math.max(S.decision, 0.25);
          else if (own.cutInShot && S.t >= own.cutInShot) { own.cutInShot = 0; S.decision = Math.min(S.decision, 0.05); own.wantShot = S.t + 0.6; }   // 技の足さばきの途中では次のプレーを選ばない
          if (!own.gk && S.decision > 0.05 && !S.setPiece && fx(own.team, own.x) > L - 24 && emptyGoal(own)) S.decision = 0;   // 無人のゴールが見えたら、すぐ打つ
          if (S.decision <= 0 && !((own.mtLock || 0) > S.t) && (!own.settle || hyp(S.ball.x - own.x, S.ball.y - own.y) < (S.forceShot != null || S.oneTouchBoost ? 1.6 : 1.0)) && (S.oneTouchBoost || own.dO == null || own.dO < 0.8 || close < 2 || ((own.tsukiRecv || own.aoKeepFast || emptyGoal(own)) && fx(own.team, own.x) > L - 26 && own.dO < 2.4) || ((own.kmCall || 0) > S.t && own.dO < 2.4))) decide(own);   // 月影の抜け出し：高速ドリブル中でも、ペナルティエリアに入ったら打てる
        }
      }
      uTick();
      computeTargets();
      mdPost();
      shapePost();
      if (globalThis.__tgHook) globalThis.__tgHook(S, P, targets, urgent, fx, offsideLine, ownerP);
      movePlayers();
      if (!S.celebrate) { stepBall(); if (!S.celebrate) contest(); }   // ゴールが決まったコマでは、もうだれも触らない（入った球をGKがはじき出す描写をなくす）
      else {
        const b = S.ball, h = S.hurry;
        if (h && (h.stage === 'net' || h.stage === 'carry') && S.celebrate <= 0.6) h.stage = 'done';   /* 版781：取りに行けないまま時間が来たら、あきらめて自分の位置へ（ボールはセンターに置かれる） */
        if (h && S.celebrate > 0.6) {
          // 負けている側の得点：ネットのボールを拾い、持って走って、センターへ大きく蹴り返す
          const f = P[h.i];
          if (h.stage === 'net') {
            if (S.celebrate > S.cel0 - 0.9) { b.x += b.vx * DT; b.y += b.vy * DT; b.vx *= 0.85; b.vy *= 0.85; const nd = 2.3; b.x = clamp(b.x, -nd, L + nd); b.y = clamp(b.y, GOAL_Y - POST + 0.2, GOAL_Y + POST - 0.2); if (b.z > BAR * 0.9) { b.z = BAR * 0.9; b.vz = -Math.abs(b.vz) * 0.2; } if (b.z > 0 || b.vz > 0) { b.vz -= 9.8 * DT; b.z = Math.max(0, b.z + b.vz * DT); } netKeep(b); }   // ネットの天井より上には行かない
            else { b.vx = 0; b.vy = 0; b.vz = 0; b.z = Math.max(0, b.z - 4 * DT); }
            if (hyp(f.x - b.x, f.y - b.y) < 0.9 && S.celebrate < S.cel0 - 0.9) { h.stage = 'carry'; h.t0 = S.t; }
          } else if (h.stage === 'carry') {
            // 手で持つのではなく、足元でボールを運んでゴールの外へ（ゴールの口を通る）
            const [wx, wy] = goalWay(b, f.x, f.y), d = hyp(wx - b.x, wy - b.y) || 1e-6, v = Math.max(6, hyp(f.vx || 0, f.vy || 0) + 2);
            if (d > v * DT) { b.x += ((wx - b.x) / d) * v * DT; b.y += ((wy - b.y) / d) * v * DT; } else { b.x = f.x + Math.sign(L / 2 - f.x) * 0.5; b.y = f.y; }
            b.z = 0;
            const inField = b.x > 2 && b.x < L - 2;
            if (inField && (S.t - h.t0 > 1.6 || Math.abs(b.x - L / 2) < 22)) { h.stage = 'kick'; h.k0 = { x: b.x, y: b.y }; h.kT = 0; h.kD = Math.max(0.9, Math.min(1.8, hyp(L / 2 - b.x, W / 2 - b.y) / 22)); }
          } else {
            h.kT += DT; const u = Math.min(1, h.kT / h.kD);
            b.x = h.k0.x + (L / 2 - h.k0.x) * u; b.y = h.k0.y + (W / 2 - h.k0.y) * u; b.z = 4 * Math.min(8, hyp(L / 2 - h.k0.x, W / 2 - h.k0.y) / 5) * u * (1 - u) * 0.6;
            if (u >= 1) { b.z = 0; h.stage = 'done'; }
          }
        } else if (h && h.stage === 'done') { b.x = L / 2; b.y = W / 2; b.z = 0; }
        else if (S.celebrate > S.cel0 - 3.5) {
          // ネットに入ったボール
          // ネットに突き刺さる：奥のネットまで飛んで受け止められ、少し押し返されてから地面に落ちる
          b.x += b.vx * DT; b.y += b.vy * DT; b.vx *= 0.93; b.vy *= 0.9;
          const nd = 2.3, dIn = b.x < L / 2 ? -b.x : b.x - L;
          if (dIn > nd) { b.x = b.x < L / 2 ? -nd : L + nd; b.vx = -b.vx * 0.12; b.vy *= 0.5; b.vz = Math.min(b.vz, 0) * 0.5; }
          if (b.z > BAR * 0.9) { b.z = BAR * 0.9; b.vz = -Math.abs(b.vz) * 0.2; }
          b.x = clamp(b.x, -nd, L + nd); b.y = clamp(b.y, GOAL_Y - POST + 0.2, GOAL_Y + POST - 0.2);
          if (b.z > 0) { b.vz -= 9.8 * DT; b.z = Math.max(0, b.z + b.vz * DT); }
          netKeep(b);
        } else {
          // センターサークルへ戻す
          const [wx, wy] = goalWay(b, L / 2, W / 2);   // ネットの中からは、ゴールの口を通って出す
          const dx = wx - b.x, dy = wy - b.y, d = hyp(dx, dy) || 1e-6, v = Math.max(hyp(L / 2 - b.x, W / 2 - b.y) / Math.max(S.celebrate, 0.1), 3);
          if (d > v * DT) { b.x += (dx / d) * v * DT; b.y += (dy / d) * v * DT; } else { b.x = wx; b.y = wy; }
          b.z = 0;
        }
      }
      const holder = S.ball.owner >= 0 ? P[S.ball.owner].team : S.ball.lastTeam;
      stats[holder].possession += DT;
      if (step % 10 === 0) { checkIssues(); checkPolicies(); logTypes(); }
      // 試合中の交代・作戦変更（プレイヤー）：指示した時間のあと、最初にプレーが切れた所で入れ替える
      if (pendingCh.length && step % 2 === 0) {
        const ch0 = pendingCh[0];
        const tacOnly = !(ch0.subs && ch0.subs.length);
        if (ch0.at <= S.t && (tacOnly || subOk())) { while (pendingCh.length && pendingCh[0].at <= S.t && (!(pendingCh[0].subs || []).length || subOk())) applyHalfChange(pendingCh.shift()); }
        else if (ch0.at <= S.t - KICKOUT_WAIT && !S.restart && !S.celebrate) {
          // 交代を待って長くなったら、自陣で落ち着いてボールを持った時に外へ蹴り出してプレーを切る
          const own = ownerP();
          if (own && own.team === ch0.team && fx(own.team, own.x) < L * 0.72 && (own.gk || nearestOpp(own, own.x, own.y).d > 1.0) && !own.settle) {
            kick(own, clamp(own.x + sgn(own.team) * R.range(4, 12), 2, L - 2), own.y < GOAL_Y ? -5 : W + 5, 'pass', 'clear', { landFrac: 0.9 });
            S.ball.intended = -1; S.ball.offside = false; S.ball.kind = 'loose';
          }
        }
      }
      // 後半、プレーが切れた時：相手チームは疲れた選手を交代（5分以上あけて、1回に1人）
      if (step % 10 === 5 && curHalf === 2) {
        const minute = S.t * CLOCK_SCALE / 60;
        for (const tm of T) {
          if (!tm.autoSubs || !tm.subPlan || 3 - tm.subsLeft >= tm.subPlan) continue;
          // 予定の時間になった・へとへとの選手がいる・残り時間が少ない、のどれかで交代（必ず予定の人数は替える）
          const left = tm.subPlan - (3 - tm.subsLeft);
          const spent = minute >= 50 && tm.players.some((p) => !p.gk && p.cur < 28);
          if (minute >= tm.subNext || spent || minute >= 80 - left * 6) {
            // プレーが切れた時にまとめて替える（終盤は残りの人数をいっぺんに）
            const n = minute >= 74 ? left : Math.min(left, R.next() < 0.35 ? 2 : 1);
            let done = 0; for (let k = 0; k < n; k++) if (autoSub(tm)) done++;
            if (done) tm.subNext = minute + 4 + R.range(0, 6);
          }
        }
      }
      // オフサイドの見逃し防止：オフサイドの位置で出たパスを、受け手がトラップせずにダイレクトで触った（シュート・ヘディング・ワンタッチ）時も、オフサイド
      { const bb = S.ball;
        if (bb.trapP && bb.kind === 'pass' && !S.restart && P[bb.intended] && (S.t - (bb.passT ?? S.t) > 0.45 || hyp(P[bb.intended].x - bb.x, P[bb.intended].y - bb.y) < 4)) { const p = P[bb.intended]; bb.trapP = false; S.pOff = null;   // 桜島の号令：裏へ出たボールに走り出した瞬間、旗が上がる（ほぼ確実にオフサイド）
          stats[p.team].offsides++; ev('offside', { team: p.team, player: p.name, number: p.number, passT: bb.passT ?? S.t, line: bb.offLineX, ox: bb.offX, oy: bb.offY });
          setRestart('free', 1 - p.team, bb.offX ?? p.x, bb.offY ?? p.y); S.restart.offside = true; S.restart.wait = Math.max(S.restart.wait, 4.6); }
        else if (S.pOff && !S.restart && bb.lastPlayer === S.pOff.int && bb.kind !== 'pass' && P[S.pOff.int] && P[S.pOff.int].team === S.pOff.team) { const q = S.pOff, p = P[q.int]; S.pOff = null;
          stats[p.team].offsides++; ev('offside', { team: p.team, player: p.name, number: p.number, passT: q.passT, line: q.line, ox: q.ox, oy: q.oy });
          setRestart('free', 1 - p.team, q.ox, q.oy); S.restart.offside = true; S.restart.wait = Math.max(S.restart.wait, 4.6); }
        else if (S.shotOff && !S.restart && bb.lastPlayer >= 0 && S.shotOff.set.includes(bb.lastPlayer)) { const p = P[bb.lastPlayer], q = S.shotOff; S.shotOff = null;   // シュートのこぼれ球：打った瞬間にオフサイドの位置にいた味方が、GKがはじいた球・ポストの跳ね返りに触った
          stats[p.team].offsides++; ev('offside', { team: p.team, player: p.name, number: p.number, passT: q.t, line: q.line, ox: q.pos[p.idx][0], oy: q.pos[p.idx][1] });
          setRestart('free', 1 - p.team, q.pos[p.idx][0], q.pos[p.idx][1]); S.restart.offside = true; S.restart.wait = Math.max(S.restart.wait, 4.6); }
        else if (bb.kind === 'pass' && bb.offside && bb.kicker >= 0 && P[bb.kicker]) S.pOff = { int: bb.intended, team: P[bb.kicker].team, passT: bb.passT ?? S.t, line: bb.offLineX, ox: bb.offX, oy: bb.offY };
        else if (bb.kind === 'loose' && S.pOff && bb.owner < 0 && P[bb.lastPlayer] && P[bb.lastPlayer].team !== S.pOff.team && S.t - S.pOff.passT < 3) { }   // DFに当たっただけ（コントロールしていない）：オフサイドは消えない
        else if (bb.kind !== 'pass') S.pOff = null;
        if (bb.kind === 'shot' && bb.kicker >= 0 && P[bb.kicker] && (!S.shotOff || S.shotOff.t !== bb.shotT)) { const k = P[bb.kicker], ol = offsideLine(k.team), set = [], pos = {};   // 打った瞬間のオフサイドの位置を記録
          for (const m of T[k.team].players) if (m !== k && !m.off && fx(k.team, m.x) > ol + 0.3 && fx(k.team, m.x) > fx(k.team, bb.x) && fx(k.team, m.x) > L / 2) { set.push(m.idx); pos[m.idx] = [m.x, m.y]; }
          S.shotOff = set.length ? { t: bb.shotT, set, pos, line: fx(k.team, ol), team: k.team } : { t: bb.shotT, set: [], pos: {}, line: fx(k.team, ol), team: k.team }; }
        if (S.shotOff && (bb.owner >= 0 && P[bb.owner].team !== S.shotOff.team || S.restart || (bb.lastPlayer >= 0 && P[bb.lastPlayer] && P[bb.lastPlayer].team === S.shotOff.team && !S.shotOff.set.includes(bb.lastPlayer) && bb.kind !== 'shot'))) S.shotOff = null; }
      S.t += DT;
      if (!S.cap70 && S.t > HALF * 1.45 && !S.restart) { S.cap70 = 1; for (let k = 0; k < 2; k++) if (S.score[k] <= S.score[1 - k]) capRally(k); }   // 版838：終盤（70分ごろ）、勝っていなければもう一度
      step++;
      if (rec && step % FRAME_EVERY === 0) record();
    }
    const matchEnd = S.t;
    ev('fulltime', { score: [...S.score] });

    const tot = stats[0].possession + stats[1].possession;
    stats.forEach((s) => {
      s.possession_pct = Math.round((100 * s.possession) / tot);
      s.pass_pct = s.passes ? Math.round((100 * s.passes_completed) / s.passes) : 0;
    });
    return {
      home: T[0].name, away: T[1].name, homeShort: T[0].short, awayShort: T[1].short, score: S.score, stats, events, frames,
      roster: [P.slice(0, 11), P.slice(11, 22)].map((ps) => ps.map((p) => ({ params: Object.fromEntries(PARAM_KEYS.map((k) => [k, p[k] - (p.moodAdd || 0)])), name: p.name, number: p.number, type: p.type, position: p.position, hair: p.hair, hairColor: p.hairColor, skin: p.skin, gk: p.gk, skills: [...p.sk], uniq: p.uniq || undefined, passive: p.passive || undefined, faceKey: p.faceKey || undefined, cpuTid: p.cpuTid || undefined, cpuNo: p.cpuNo ?? undefined }))),
      uniqLog,
      actions,
      rosterStart,
      captains: T.map((tm) => { const c = tm.role.captain || tm.players.find((q) => q.sk.has('captaincy')) || tm.players.filter((q) => !q.gk).sort((x, y) => ((y.uniq ? 100 : 0) + y.mental) - ((x.uniq ? 100 : 0) + x.mental))[0]; return Math.max(0, tm.players.indexOf(c)); }),   // 版801：キャプテン（入場の列の先頭）
      typeLog, duration: +matchEnd.toFixed(2), halfTime: +halfStartT.toFixed(2), nominalHalf: HALF, clockScale: CLOCK_SCALE, frameDt: DT * FRAME_EVERY,
    };
  }

  root.DotSoccer = { UNIQ, UNIQ_BY_TOP, PASSIVE, simulateMatch, buildSlots, beginningTeam, presetTeam, atLevel, PRESET_NAMES, PARAMS, PARAM_KEYS, SKILLS, TYPE_HIDDEN, HIDDEN0, grade, fillParams, CONST: { L, W, GOAL_Y, POST, BAR, HALF, CLOCK_SCALE } };
})(typeof globalThis !== 'undefined' ? globalThis : window);
