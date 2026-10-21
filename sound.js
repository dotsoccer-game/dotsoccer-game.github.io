// 版499：サウンド（効果音とBGM）。音のファイルは使わず、ファミコン風の音をその場で作る
(function () {
  let AC = null, master = null, sfxG = null, bgmG = null, crowdNode = null, crowdGain = null;
  const pref = { sfx: true, bgm: true, vol: 0.8 }; const BOOST = 1.8;
  try { const v = JSON.parse(localStorage.getItem('dotSound') || '{}'); Object.assign(pref, v); } catch (_) {}
  const save = () => { try { localStorage.setItem('dotSound', JSON.stringify(pref)); } catch (_) {} };
  function ctx() {
    if (AC) return AC;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    try { AC = new C({ latencyHint: 'interactive' }); } catch (_) { AC = new C(); }
    AC.onstatechange = () => { if (!AC) return; if (AC.state === 'interrupted') needRebuild = true; else if (AC.state === 'running') setTimeout(() => { if (AC && AC.state === 'running' && want && !cur) bgm(want); }, 0); };   // 版560：電話・画面収録などで音が止められた
    // 版728：全体の音を大きく（約1.8倍）。大きい音が割れないように、最後に「リミッター」を通す
    master = AC.createGain(); master.gain.value = pref.vol * BOOST;
    try { const lim = AC.createDynamicsCompressor(); lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.25; master.connect(lim); lim.connect(AC.destination); } catch (_) { master.connect(AC.destination); }
    sfxG = AC.createGain(); sfxG.gain.value = pref.sfx ? 1 : 0; sfxG.connect(master);
    bgmG = AC.createGain(); bgmG.gain.value = pref.bgm ? 0.55 : 0; bgmG.connect(master);
    clockA = null; setTimeout(prerenderAll, 0); setTimeout(loadFiles, 0);
    return AC;
  }
  // 版560：音の作り直し。アプリを一瞬閉じて戻った時・画面収録を始めた時などに、音が遅れたり雑音になったりするので、音の仕組みごと作り直す
  let needRebuild = false, crowdModeNow = null, clockA = null, driftBad = 0;
  function rebuild() {
    needRebuild = false; if (!AC) return;
    const song = want, cm = crowdModeNow, old = AC;
    crowdParts.forEach((p) => { try { p.stop(); } catch (_) {} }); crowdParts = []; crowdGain = null; crowdHp = null; crowdMix = null; crowdModeNow = null;
    clearInterval(timer); timer = null; cur = null;
    AC = null; noiseBuf = null; lastAt = {}; PRE = {};
    try { old.close(); } catch (_) {}
    const a = ctx(); if (!a) return; try { a.resume(); } catch (_) {}
    if (cm) crowd(cm);
    if (song) { want = song; if (a.state === 'running') bgm(song); else a.onstatechange = ((f) => () => { if (f) f(); if (a.state === 'running' && want && !cur) bgm(want); })(a.onstatechange); }
  }
  // 版718：iPhoneは、画面にさわっていない時に音の仕組みを作り直すと、次にさわるまで音が出なくなる（試合中の歓声・キック・ドリブルの音が消えていた）。
  //  そのため、作り直しは「次に画面にさわった時」にする（ずれた時・アプリにもどった時は、印だけつけておく）
  // 音の時計が実際の時間とずれていく時（音の処理が追いつかない・速さが合わない）も作り直す
  setInterval(() => {
    if (!AC || AC.state !== 'running' || document.hidden) { clockA = null; return; }
    const now = performance.now() / 1000, at = AC.currentTime;
    if (clockA) { const dp = now - clockA[0], da = at - clockA[1]; if (dp > 1.5) { const r = da / dp; driftBad = Math.abs(r - 1) > 0.04 ? driftBad + 1 : 0; if (driftBad >= 2) { driftBad = 0; needRebuild = true; return; } } }
    clockA = [now, at];
  }, 2000);
  // iPhoneは、画面にさわった時でないと音が出せない：最初のタッチで音を使えるようにする
  // 版561：resume は少し待ってから動き出すので、動き出してから曲を始める（前は最初のタッチで曲が始まらず、しばらく無音だった）
  const startWant = () => { if (AC && AC.state === 'running' && want && !cur) bgm(want); };
  const unlock = () => { if (needRebuild) rebuild(); const a = ctx(); if (!a) return; if (a.state !== 'running') { try { const pr = a.resume(); if (pr && pr.then) pr.then(startWant, () => {}); } catch (_) {} setTimeout(startWant, 120); setTimeout(startWant, 500); } else startWant(); };
  ['pointerdown', 'touchstart', 'touchend', 'pointerup', 'click', 'keydown'].forEach((e) => addEventListener(e, unlock, { passive: true, capture: true }));   // 版561：iPhoneは指を離した時（touchend）でないと音を始められないことがある
  document.addEventListener('visibilitychange', () => { if (!AC) return; if (document.hidden) { try { AC.suspend(); } catch (_) {} needRebuild = true; } else { try { AC.resume(); } catch (_) {} } });   // 版560：戻ってきたら作り直す（一瞬閉じると音がずれていた）
  addEventListener('pageshow', (e) => { if (e.persisted && AC) { needRebuild = true; try { AC.resume(); } catch (_) {} } });

  // ---- 音の部品 ----
  function tone(f, d, type = 'square', vol = 0.2, t0 = 0, slide = null, out = null) {
    const a = ctx(); if (!a) return; const t = a.currentTime + t0;
    const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(out || sfxG); o.start(t); o.stop(t + d + 0.02);
  }
  let noiseBuf = null;
  function noiseBuffer() { const a = ctx(); if (noiseBuf) return noiseBuf; noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noiseBuf; }
  // 版825：ひずんだドーン（低い音を割って、高い成分も出す。小さいスピーカーでも重く聞こえる）
  function dboom(k = 1) {
    const a = ctx(); if (!a) return; const t = a.currentTime;
    const ws = a.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cv[i] = Math.tanh(x * 6); } ws.curve = cv;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(300, t + 1.2);
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * k, t + 0.008); g.gain.exponentialRampToValueAtTime(0.18 * k, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    [['sawtooth', 130], ['square', 66]].forEach(([ty, f]) => { const o = a.createOscillator(); o.type = ty; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.4, t + 1.2); o.connect(ws); o.start(t); o.stop(t + 1.65); });
    ws.connect(lp); lp.connect(g); g.connect(sfxG);
    noise(1.4, 0.55 * k, 'lowpass', 1600, 0, null, 0.002); noise(0.25, 0.35 * k, 'bandpass', 700, 0, null, 0.002); tone(60, 1.2, 'sine', 0.3 * k, 0, 30);
  }
  // バリバリバリ（雷の裂ける音）：短いザッを不規則に重ねる
  function crackle(d, vol) { let t = 0; while (t < d) { noise(0.05 + Math.random() * 0.08, vol * (1 - t / d * 0.6), 'bandpass', 1800 + Math.random() * 2500, t, null, 0.001); t += 0.02 + Math.random() * 0.05; } noise(0.3, vol, 'highpass', 1500, 0, null, 0.001); }
  // 版824：ドーン！（雷が当たった重い一発）：低い音が一気に下がる＋こもった爆発の音＋余韻
  function boom(k = 1) {
    tone(95, 1.4, 'sine', 0.55 * k, 0, 28); tone(48, 1.8, 'sine', 0.35 * k, 0, 26); tone(140, 0.25, 'triangle', 0.25 * k, 0, 50);
    noise(0.7, 0.4 * k, 'lowpass', 700, 0, null, 0.002); noise(2.0, 0.22 * k, 'lowpass', 180, 0.08, null, 0.06);
  }
  // 地鳴り（ゴゴゴゴ）：低いザーッという音を、速く揺らす
  function rumble(d, vol = 0.4, t0 = 0, fq = 120, rate = 11) {
    const a = ctx(); if (!a) return; const t = a.currentTime + t0;
    const s = a.createBufferSource(); s.buffer = noiseBuffer(); s.loop = true; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fq; f.Q.value = 3;
    const g = a.createGain(), m = a.createGain(), lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = rate; lg.gain.value = 0.45; m.gain.value = 0.55; lfo.connect(lg); lg.connect(m.gain);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.35, d * 0.25)); g.gain.setValueAtTime(vol, t + d * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(m); m.connect(g); g.connect(sfxG); s.start(t, Math.random()); s.stop(t + d + 0.05); lfo.start(t); lfo.stop(t + d + 0.05);
  }
  function noise(d, vol = 0.2, fType = 'lowpass', fq = 1200, t0 = 0, out = null, attack = 0.005) {
    const a = ctx(); if (!a) return; const t = a.currentTime + t0;
    const s = a.createBufferSource(); s.buffer = noiseBuffer(); const f = a.createBiquadFilter(); f.type = fType; f.frequency.value = fq; const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(out || sfxG); s.start(t, Math.random()); s.stop(t + d + 0.05);
  }
  // 長くのびる雑音（立ち上がり→そのまま→消える）
  function noiseHold(d, vol, fq, q, t0 = 0, att = 0.6, rel = 1.0) {
    const a = ctx(); if (!a) return; const t = a.currentTime + t0;
    const s = a.createBufferSource(); s.buffer = noiseBuffer(); s.loop = true; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = q; const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.setValueAtTime(vol, t + d - rel); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(sfxG); s.start(t, Math.random()); s.stop(t + d + 0.05);
  }
  // 版558：本家の笛を測って合わせた：約3000Hz、鳴り始めは2600Hzから0.04秒で上がる、玉が転がる「ビリビリ」（毎秒93回のふるえ）
  function whistle(d = 0.28, t0 = 0, vol = 0.18) {
    const a = ctx(); if (!a) return; const t = a.currentTime + t0;
    const o = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain(), g = a.createGain(), am = a.createGain(), alfo = a.createOscillator(), ag = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(2620, t); o.frequency.exponentialRampToValueAtTime(3010, t + 0.04);
    lfo.frequency.value = 93; lg.gain.value = 95; lfo.connect(lg); lg.connect(o.frequency);
    alfo.frequency.value = 93; ag.gain.value = 0.28; alfo.connect(ag); am.gain.value = 0.72; ag.connect(am.gain);   // 音の大きさもビリビリ
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(vol * 0.62, t + Math.min(0.25, d * 0.6)); g.gain.setValueAtTime(vol * 0.62, t + Math.max(0.02, d - 0.03)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(am); am.connect(g); g.connect(sfxG); [o, lfo, alfo].forEach((x) => { x.start(t); x.stop(t + d + 0.02); });
    noise(d, vol * 0.08, 'bandpass', 3000, t0, null, 0.01);   // 息の音
  }
  // 指笛（観客の「ヒューッ」）：低いところから一気に上がる
  function fanWhistle(t0 = 0, f0 = 400, f1 = 2000, d = 0.2, vol = 0.05) {
    const a = ctx(); if (!a) return; const t = a.currentTime + t0;
    const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol, t + d * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.04);
    o.connect(g); g.connect(sfxG); o.start(t); o.stop(t + d + 0.06);
  }
  // 版559：観客の声のかたまり。ひとりひとり高さ・ゆれ・出だしが違う声を何十人分も重ね、口の形（母音の響き）に通す
  // （全員が同じように上がり下がりすると「サイレン」に、雑音だけだと「砂嵐」に聞こえるので、どちらもしない）
  function crowdVoices(d, vol, t0, o) {
    const a = ctx(); if (!a) return; const t = a.currentTime + t0;
    const out = a.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(vol, t + o.att); out.gain.setValueAtTime(vol, t + Math.max(o.att, d - o.rel)); out.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp || 3200; lp.connect(out); out.connect(sfxG);
    const fm = o.vowel.map(([fq, q, g]) => { const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = q; const gg = a.createGain(); gg.gain.value = g; f.connect(gg); gg.connect(lp); return f; });
    for (let i = 0; i < o.n; i++) {
      const f0 = o.lo * Math.pow(o.hi / o.lo, Math.random()), st = t + Math.random() * o.spread, en = t + d - Math.random() * o.rel * 0.6;
      const osc = a.createOscillator(); osc.type = 'sawtooth';
      // 声の高さ：ひとりずつ、ゆっくりばらばらに動く（そろわない）
      const pts = 6, curve = new Float32Array(pts); for (let k = 0; k < pts; k++) curve[k] = f0 * (1 + (Math.random() - 0.5) * 0.08 + (k === pts - 1 ? o.endBend * Math.random() : 0));
      osc.frequency.setValueAtTime(f0, st); try { osc.frequency.setValueCurveAtTime(curve, st + 0.01, Math.max(0.2, en - st - 0.02)); } catch (_) {}
      const vib = a.createOscillator(), vg = a.createGain(); vib.frequency.value = 4 + Math.random() * 3; vg.gain.value = f0 * (0.01 + Math.random() * 0.02); vib.connect(vg); vg.connect(osc.frequency);
      const g = a.createGain(), pk = (0.5 + Math.random() * 0.5) / Math.sqrt(o.n);
      g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(pk, st + 0.08 + Math.random() * o.att); g.gain.setValueAtTime(pk, Math.max(st + 0.1, en - 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, en);
      osc.connect(g); fm.forEach((f) => g.connect(f));
      osc.start(st); vib.start(st); osc.stop(en + 0.05); vib.stop(en + 0.05);
    }
  }
  const N = (s) => { const m = /^([A-G])(#?)(\d)$/.exec(s); if (!m) return 0; const k = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] ? 1 : 0) + (+m[3] - 4) * 12; return 440 * Math.pow(2, k / 12); };

  // ---- 効果音 ----
  function cheerLive() {
      // 「ワーッ」：高めの声（ア）を28人分。雑音は少しだけ（息の音）
      crowdVoices(6.4, 0.45, 0.05, { n: 28, lo: 170, hi: 430, att: 0.7, rel: 1.3, spread: 0.5, endBend: -0.06, vowel: [[800, 4, 1], [1250, 5, 0.7], [2600, 6, 0.25]] });
      [[900, 5, 0.05], [1500, 5, 0.035]].forEach(([fq, q, v], k) => noiseHold(6.2, v, fq, q, k * 0.05, 0.8, 1.2));
      [[1.3, 500, 2400], [2.9, 450, 2200], [4.1, 600, 2500]].forEach(([t, a, b]) => fanWhistle(t, a, b, 0.22, 0.04));
  }
  function oohLive() { crowdVoices(2.2, 0.8, 0, { n: 22, lo: 110, hi: 260, att: 0.3, rel: 0.9, spread: 0.25, endBend: -0.12, vowel: [[480, 4, 1], [850, 5, 0.6], [2400, 6, 0.12]] }); fanWhistle(0.8, 420, 1900, 0.18, 0.07); }

  const SFX = {
    // 版558：本家のタップ音は「カチッ」と短く高い音（5300Hzあたり、0.015秒）
    tap() { noise(0.018, 0.22, 'bandpass', 5300, 0, null, 0.001); tone(5300, 0.012, 'sine', 0.05); },
    ok() { tone(784, 0.07, 'square', 0.09); tone(1175, 0.1, 'square', 0.09, 0.07); },
    back() { noise(0.018, 0.22, 'bandpass', 3600, 0, null, 0.001); tone(3600, 0.012, 'sine', 0.05); },
    pop() { tone(1060, 0.07, 'sine', 0.2, 0, 690); },   // 本家：お知らせが出る時の「ポッ」（1060→690Hz、0.07秒）
    // 版719：スマホの小さなスピーカーは低い音（100Hzあたり）が出ないので、聞こえる高さ（500〜2000Hz）の「トッ」も重ねる
    touch() { noise(0.035, 0.12, 'lowpass', 900); tone(110, 0.05, 'sine', 0.16, 0, 70); tone(520, 0.035, 'triangle', 0.13, 0, 330); noise(0.02, 0.08, 'bandpass', 1600, 0, null, 0.002); },
    header() { noise(0.07, 0.25, 'bandpass', 700); tone(260, 0.1, 'sine', 0.3, 0, 120); },   // ボン（頭）
    catch() { noise(0.12, 0.3, 'lowpass', 500); tone(95, 0.14, 'sine', 0.4, 0, 60); noise(0.06, 0.16, 'bandpass', 1300, 0, null, 0.003); noise(0.04, 0.1, 'highpass', 3000, 0.01); },   // バシッ（両手で抱える）
    parry() { noise(0.06, 0.32, 'bandpass', 1800); tone(320, 0.07, 'square', 0.08, 0, 160); },   // パンッ（はじく）
    // 版558：本家のキックは低く短い「ドッ」（210Hzから130Hzへ、0.04秒）。高い音はほとんどない
    kick() { tone(210, 0.05, 'sine', 0.6, 0, 125); tone(105, 0.045, 'triangle', 0.26, 0, 70); tone(640, 0.04, 'triangle', 0.2, 0, 380); noise(0.025, 0.12, 'bandpass', 2000, 0, null, 0.002); noise(0.012, 0.06, 'highpass', 5000); },
    shot() { tone(230, 0.08, 'sine', 0.45, 0, 105); tone(115, 0.07, 'triangle', 0.2, 0, 60); tone(720, 0.06, 'triangle', 0.24, 0, 360); noise(0.04, 0.16, 'bandpass', 1800, 0, null, 0.002); noise(0.03, 0.09, 'lowpass', 600); noise(0.012, 0.05, 'highpass', 5000); },
    // 版558：本家の吹き方 — キックオフ「ピーーー」1.45秒／ファール「ピッピッ」／前半終了「ピッ、ピーーー」／試合終了「ピッ、ピッ、ピーーー」
    whistle() { whistle(1.45); },
    pkgo() { whistle(0.42); },   /* 版742：PKの合図は短く「ピッ」 */
    foul() { whistle(0.09); whistle(0.085, 0.12); },
    whistle2() { whistle(0.19); whistle(1.48, 0.6); },
    whistle3() { whistle(0.19); whistle(0.19, 0.52); whistle(1.48, 1.03); },
    // 版558：本家のゴール：1秒で観客が「ワーッ」と明るく大きくなり（高めの声が+10dB）、5秒ほど続いて1秒で戻る。低い地鳴りはない。指笛がまじる
    cheer() {
      if (FILE.big) {   // 版722：ゴールの盛り上がりを長く（約8秒）：歓声を少しずつずらして3回重ね、拍手を2回、うしろのざわめきも一時的に大きく
        playBuf(FILE.big, FILE_VOL.big); playBuf(FILE.big, FILE_VOL.big * 0.85, 2.2); playBuf(FILE.big, FILE_VOL.big * 0.6, 4.4);
        if (FILE.clap) { playBuf(FILE.clap, FILE_VOL.clap, 0.5); playBuf(FILE.clap, FILE_VOL.clap * 0.8, 3.6); }
        if (crowdMix && AC) { const t = AC.currentTime, g = crowdMix.gain, base = g.value; try { g.cancelScheduledValues(t); g.setValueAtTime(base, t); g.linearRampToValueAtTime(base * 1.8, t + 0.6); g.setValueAtTime(base * 1.8, t + 5.5); g.linearRampToValueAtTime(base, t + 8.5); } catch (_) {} }
      } else if (PRE.cheer) playBuf(PRE.cheer, 0.6); else cheerLive();
      if (crowdGain && AC) { const t = AC.currentTime; try { crowdGain.gain.cancelScheduledValues(t); crowdGain.gain.setValueAtTime(crowdGain.gain.value, t); crowdGain.gain.linearRampToValueAtTime(1.3, t + 0.8); crowdGain.gain.setValueAtTime(1.3, t + 5.4); crowdGain.gain.linearRampToValueAtTime(0.9, t + 6.6); } catch (_) {} }
    },
    // 点数が変わる時のファンファーレ
    scoreUp() {
      ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone(N(n), 0.16, 'square', 0.14, i * 0.1));
      tone(N('G5'), 0.12, 'square', 0.14, 0.45); tone(N('C6'), 0.6, 'square', 0.15, 0.57);
      tone(N('C4'), 0.7, 'triangle', 0.28, 0.57); tone(N('E4'), 0.7, 'triangle', 0.2, 0.57); tone(N('G4'), 0.7, 'triangle', 0.16, 0.57);
    },
    goal() { SFX.cheer(); },
    // 版558：おしいシュートの「おぉー」と指笛（本家：声のかたまり＋「ヒュイッ、ヒュイーッ」）
    ooh() { if (FILE.ooh) playBuf(FILE.ooh, FILE_VOL.ooh); else if (PRE.ooh) playBuf(PRE.ooh, 0.6); else oohLive(); },
    clap() { if (FILE.clap) playBuf(FILE.clap, FILE_VOL.clap); },
    skill() { [880, 1320, 1760, 2349].forEach((f, i) => tone(f, 0.09, 'triangle', 0.12, i * 0.045)); },
    uniq() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.08, i * 0.05)); noise(0.5, 0.06, 'highpass', 4000, 0.05); },
    card() { whistle(0.09); whistle(0.085, 0.12); },
    thunder() {   // 版818：雷（バリッ → ゴロゴロ）
      if (FILE.thunder) { playBuf(FILE.thunder, 0.9); return; }   // 版826：録音があればそれを使う
      noise(0.22, 0.55, 'highpass', 1800, 0); noise(0.45, 0.4, 'lowpass', 3500, 0.03, null, 0.003);
      noise(1.0, 0.5, 'lowpass', 200, 0.08, null, 0.04); noise(1.0, 0.38, 'lowpass', 140, 0.6, null, 0.15); noise(1.0, 0.26, 'lowpass', 100, 1.25, null, 0.2);
      tone(58, 1.8, 'sine', 0.28, 0.06, 32);
    },
    gachaRise() { tone(110, 2.2, 'sawtooth', 0.05, 0, 880); tone(165, 2.2, 'sawtooth', 0.035, 0, 1320); noise(2.2, 0.05, 'highpass', 2500, 0, null, 2.0); [0, 0.5, 0.9, 1.2, 1.42, 1.6, 1.74, 1.86, 1.96, 2.05].forEach((t) => tone(60, 0.1, 'sine', 0.3, t, 40)); },   // 版821：止まり始めたら、音が上がっていく＋心臓の音が速くなる
    gachaCheer() { gCheer(1); },   // 版822：選手の顔が出た時の歓声（ウイイレのように）。だんだん小さくなる
    gachaCheerS() { gCheer(0.55); },
    // 版823：金・黒が当たった時の音を、ピコピコではなく雷と地鳴り（ゴゴゴゴ）に
    // 版825：iPhoneのスピーカーは低すぎる音が出ない（さっきのドーンは聞こえず、パチッだけ残った）。ひずませて、スピーカーでも聞こえる「ドーン」に。雷はバリバリと長く
    // 版826：雷はいただいた録音（sound/thunder.mp3）。読み込めていない時だけ、作った音
    // 版832：ボールの色が変わる時（昇格・ズレ）も雷の録音。黒は大きく、金は少し小さく、銀は軽く
    gachaUp5() { if (FILE.thunder) { playBuf(FILE.thunder, 1.0); rumble(1.6, 0.3, 0.1, 320, 10); } else SFX.gachaRumble(); },
    gachaUp4() { if (FILE.thunder) playBuf(FILE.thunder, 0.75); else SFX.gachaRumble4(); },
    gachaUp3() { if (FILE.thunder) playBuf(FILE.thunder, 0.45); else SFX.reveal5(); },
    gachaBolt5() { if (FILE.thunder) { playBuf(FILE.thunder, 1.0); dboom(0.5); } else { dboom(1.0); crackle(0.9, 0.5); rumble(2.8, 0.5, 0.2, 320, 9); } },   // 黒：録音の雷＋ドーン
    gachaBolt4() { if (FILE.thunder) playBuf(FILE.thunder, 0.75); else { dboom(0.8); crackle(0.55, 0.4); rumble(1.6, 0.4, 0.15, 340, 11); } },   // 金：録音の雷（少し小さく）
    gachaRumble() { rumble(1.8, 0.5, 0, 100, 10); tone(40, 1.8, 'sine', 0.35, 0, 30); noise(0.6, 0.2, 'lowpass', 400, 1.2, null, 0.3); },   // 黒に変わる時：ゴゴゴゴ
    gachaRumble4() { rumble(1.1, 0.38, 0, 140, 13); tone(52, 1.1, 'sine', 0.26, 0, 36); },   // 金に変わる時
    gachaHit() { tone(70, 0.9, 'sine', 0.5, 0, 35); noise(0.5, 0.45, 'lowpass', 900, 0, null, 0.003); noise(1.4, 0.18, 'lowpass', 160, 0.05, null, 0.05); },   // 金・黒の選手が出た時：ドーン
    gachaTap() { noise(0.5, 0.22, 'bandpass', 900, 0, null, 0.01); tone(180, 0.45, 'sawtooth', 0.07, 0, 60); tone(90, 0.35, 'sine', 0.3, 0, 45); },   // 版824：止めるタップ：シュッ＋ブレーキ（低く下がる）
    gachaLock() { tone(75, 0.4, 'sine', 0.4, 0, 40); noise(0.12, 0.3, 'lowpass', 1400, 0, null, 0.002); noise(0.05, 0.14, 'highpass', 4000, 0.01); },   // 版824：リングで止まった：ガチッ（重い）
    gachaOrb() { tone(220, 1.4, 'triangle', 0.12, 0, 880); noise(1.5, 0.06, 'highpass', 3000, 0.2, null, 0.6); },
    gachaRare() { tone(220, 1.4, 'square', 0.08, 0, 1760); [0.6, 0.8, 1.0, 1.2].forEach((t, i) => tone(N(['C6', 'E6', 'G6', 'C7'][i]), 0.3, 'triangle', 0.1, t)); noise(1.6, 0.08, 'highpass', 4000, 0.2, null, 0.6); },
    reveal() { tone(1318, 0.06, 'square', 0.06); tone(1760, 0.08, 'square', 0.05, 0.05); },
    // 版717：特訓で能力のランクが上がった時（ピロリン↑）
    rankUp() { ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone(N(n), 0.11, 'square', 0.08, i * 0.06)); tone(N('C6'), 0.35, 'triangle', 0.12, 0.24); tone(N('G6'), 0.25, 'triangle', 0.06, 0.3); },
    // 版699：タイプが変わった時（キュイーン→キラキラ）
    typeChange() { tone(330, 0.45, 'triangle', 0.12, 0, 1320); ['E5', 'G#5', 'B5', 'E6'].forEach((n, i) => tone(N(n), 0.16, 'square', 0.09, 0.42 + i * 0.07)); tone(N('E6'), 0.5, 'triangle', 0.12, 0.72); noise(0.6, 0.05, 'highpass', 5000, 0.45); },
    // 版696：コインの音（チャリン）。coinBurst＝買った時にじゃらっと出る音
    coin() { const k = 0.94 + Math.random() * 0.12; tone(1976 * k, 0.05, 'square', 0.05); tone(2637 * k, 0.16, 'square', 0.045, 0.05); },
    coinBurst() { for (let i = 0; i < 7; i++) { const k = 0.9 + Math.random() * 0.25, t = i * 0.055 + Math.random() * 0.02; tone(1976 * k, 0.04, 'square', 0.04, t); tone(2637 * k, 0.12, 'triangle', 0.06, t + 0.035); } noise(0.35, 0.05, 'highpass', 6000, 0.02); },
    reveal5() { [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.18, 'triangle', 0.12, i * 0.06)); },
    week() { tone(N('E5'), 0.12, 'triangle', 0.16); tone(N('A5'), 0.12, 'triangle', 0.16, 0.1); tone(N('E6'), 0.35, 'triangle', 0.14, 0.2); },
    win() { [['C5', 0], ['C5', 0.12], ['C5', 0.24], ['G5', 0.4], ['E5', 0.6], ['G5', 0.75], ['C6', 0.9]].forEach(([n, t]) => tone(N(n), t === 0.9 ? 0.7 : 0.12, 'square', 0.12, t)); tone(N('C4'), 1.4, 'triangle', 0.22, 0.2); },
    lose() { [['E5', 0], ['D#5', 0.25], ['D5', 0.5], ['C#5', 0.75]].forEach(([n, t]) => tone(N(n), t === 0.75 ? 0.8 : 0.22, 'square', 0.1, t)); tone(N('A3'), 1.4, 'triangle', 0.2, 0.2); },
    draw() { [['E5', 0], ['G5', 0.18], ['E5', 0.36], ['D5', 0.54]].forEach(([n, t]) => tone(N(n), t === 0.54 ? 0.5 : 0.15, 'square', 0.1, t)); },
  };
  let lastAt = {};
  function play(name) {
    if (!pref.sfx) return; const a = ctx(); if (!a) return; if (a.state !== 'running') { try { a.resume(); } catch (_) {} return; }
    const now = performance.now(); if (lastAt[name] && now - lastAt[name] < (name === 'kick' ? 70 : name === 'ooh' ? 4000 : 40)) return; lastAt[name] = now; if (window.__sndLog) window.__sndLog.push([name, Math.round(now)]);   // 同じ音が重なりすぎないように
    try { (SFX[name] || (() => {}))(); } catch (_) {}
  }

  // ---- 観客の声（試合中ずっと）：版558 本家を測って合わせた — 600〜750Hzに山（ほかより+6dB）、100〜500Hzは平ら、1000Hzから上はなだらかに下がる ----
  // mode：true＝ピッチ（ふつう）、'far'＝入場前の画面（遠くに聞こえる：低い音が細く、9dB小さい）、'duck'＝ロッカールーム（ほぼ聞こえない）
  let crowdParts = [], crowdHp = null, crowdMix = null; const CROWD = 3.1;   // 本家は観客の声が大きい（キックより6dBほど小さいだけ）
  // 版724：大歓声は、録音を何十回も少しずつずらして重ねた「12秒のくり返し」（cheerloop.mp3）を、音量だけ上げ下げして使う（波のように切れない）
  //  goal：ゴールの瞬間から次のキックオフまで大きく。excite：バイタルエリアにドリブルで入った時など、チャンスの大きさ（0〜1）に合わせてだんだん上げる
  let goalOn = false, cheerSrc = null, cheerG = null, exciteNow = 0;
  function cheerLoop() {
    const a = ctx(); if (!a || !FILE.cheerloop || !crowdParts.length) return null;
    if (cheerSrc && cheerG) return cheerG;
    cheerG = a.createGain(); cheerG.gain.value = 0.0001; cheerG.connect(sfxG);
    cheerSrc = a.createBufferSource(); cheerSrc.buffer = FILE.cheerloop; cheerSrc.loop = true; cheerSrc.loopStart = 0.05; cheerSrc.loopEnd = FILE.cheerloop.duration - 0.05;
    cheerSrc.connect(cheerG); cheerSrc.start(0, Math.random() * 10); crowdParts.push(cheerSrc);
    return cheerG;
  }
  function rampTo(param, v, sec) { const t = AC.currentTime; try { param.cancelScheduledValues(t); param.setValueAtTime(Math.max(0.0001, param.value), t); param.linearRampToValueAtTime(Math.max(0.0001, v), t + sec); } catch (_) {} }
  function goal(on) {
    const a = ctx(); if (!a) return;
    if (on) {
      if (goalOn) return; goalOn = true;
      const g = cheerLoop();
      if (!g) { SFX.cheer(); return; }
      if (FILE.big) playBuf(FILE.big, FILE_VOL.big * 1.3);   // ゴールの瞬間の「ワッ」
      rampTo(g.gain, FILE_VOL.cheer, 0.35);
      if (crowdMix) rampTo(crowdMix.gain, crowdBase() * 1.5, 0.6);
    } else {
      if (!goalOn) return; goalOn = false;
      if (cheerG) rampTo(cheerG.gain, FILE_VOL.cheer * 0.5 * exciteNow, 3.0);
      if (crowdMix) rampTo(crowdMix.gain, crowdBase(), 3.0);
    }
  }
  // 版730：楽器付きの応援（太鼓）。2種類（chantA・chantB：スタジアムで録ったもの）は混ぜない。
  //  1回の応援では1種類だけを、小節の切れ目でくり返す（リズムが途中で変わらないように）。次の応援の時に、また種類を選ぶ
  let chantSrc = null, chantG = null, chantType = null, chantOld = null;
  //  版731：太鼓のリズム（打点）に合わせて16拍ちょうどで切ってあるので、そのまま頭からくり返す。前の応援が残っていたら、すぐ消してから始める（ダブらないように）
  function chant(on, vol) {
    const a = ctx(); if (!a || !crowdParts.length) return false;
    if (!on) { if (chantG) { const g = chantG, s2 = chantSrc; rampTo(g.gain, 0.0001, 3.5); chantOld = [g, s2]; setTimeout(() => { try { s2.stop(); } catch (_) {} if (chantOld && chantOld[1] === s2) chantOld = null; }, 4000); } chantG = null; chantSrc = null; chantType = null; return true; }
    if (chantG) { rampTo(chantG.gain, FILE_VOL.chant * (vol || 1), 1.5); return true; }   // もう鳴っている時は、同じ種類のまま大きさだけ合わせる
    const types = ['chantA', 'chantB'].filter((k) => FILE[k]); if (!types.length) return false;
    if (chantOld) { const [og, os] = chantOld; rampTo(og.gain, 0.0001, 0.4); setTimeout(() => { try { os.stop(); } catch (_) {} }, 500); chantOld = null; }
    chantType = types[Math.floor(Math.random() * types.length)]; const buf = FILE[chantType];
    chantG = a.createGain(); chantG.gain.value = 0.0001; chantG.connect(sfxG);
    chantSrc = a.createBufferSource(); chantSrc.buffer = buf; chantSrc.loop = true; chantSrc.loopStart = 0; chantSrc.loopEnd = buf.duration; chantSrc.connect(chantG); chantSrc.start(); crowdParts.push(chantSrc);
    rampTo(chantG.gain, FILE_VOL.chant * (vol || 1), 2.0);   // ふわっと始まる
    return true;
  }
  function excite(x) {
    x = Math.max(0, Math.min(1, x || 0)); x = Math.round(x * 5) / 5; if (x === exciteNow) return; const up = x > exciteNow; exciteNow = x;   // 版725：細かく上げ下げすると波に聞こえるので、5段階にして、ゆっくり動かす
    if (goalOn || !AC) return; const g = cheerLoop(); if (!g) return;
    rampTo(g.gain, FILE_VOL.cheer * 0.6 * x, up ? 1.5 : 3.0);   // 上がる時はゆっくり盛り上がり、下がる時はもっとゆっくり静まる
    if (crowdMix) rampTo(crowdMix.gain, crowdBase() * (1 + 0.35 * x), up ? 1.5 : 3.0);
  }
  const crowdBase = () => CROWD * (crowdModeNow === 'far' ? 0.36 : crowdModeNow === 'duck' ? 0.08 : crowdModeNow === 'pre' ? 0.6 : 1);
  function crowdMode(m) {
    if (!crowdMix || !AC) return; const t = AC.currentTime;
    const [g, hp] = m === 'far' ? [CROWD * 0.36, 420] : m === 'duck' ? [CROWD * 0.08, 600] : m === 'pre' ? [CROWD * 0.6, 40] : [CROWD, 40];   // 版728：pre＝試合前（LIVE）の画面。ふつうより少し小さめ
    try { crowdMix.gain.cancelScheduledValues(t); crowdMix.gain.setValueAtTime(crowdMix.gain.value, t); crowdMix.gain.linearRampToValueAtTime(g, t + 0.8); crowdHp.frequency.cancelScheduledValues(t); crowdHp.frequency.setValueAtTime(crowdHp.frequency.value, t); crowdHp.frequency.linearRampToValueAtTime(hp, t + 0.8); } catch (_) {}
  }
  function crowdBands(a, lp, parts) {
    const nb = noiseBuffer();
      // 声の響き：[高さ, 幅（大きいほど細い）, 大きさ]
      [[680, 2.4, 0.085], [300, 0.9, 0.055], [1050, 2.2, 0.03], [1600, 2, 0.016], [150, 1.2, 0.05]].forEach(([fq, q, vol], k) => {
        const s = a.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = 0.9 + k * 0.05;
        const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q;
        const g = a.createGain(); g.gain.value = vol;
        // 大きさを、ゆっくり・速くの2つの波でゆらす（ざわざわ）
        [[0.17 + k * 0.05, vol * 0.35], [1.3 + k * 0.7, vol * 0.25]].forEach(([fr, dep]) => { const l = a.createOscillator(); l.frequency.value = fr; const lg = a.createGain(); lg.gain.value = dep; l.connect(lg); lg.connect(g.gain); l.start(); parts.push(l); });
        { const l = a.createOscillator(); l.frequency.value = 0.4 + k * 0.13; const lg = a.createGain(); lg.gain.value = fq * 0.06; l.connect(lg); lg.connect(bp.frequency); l.start(); parts.push(l); }
        s.connect(bp); bp.connect(g); g.connect(lp); s.start(0, Math.random()); parts.push(s);
      });
  }
  // 版560：観客の声・歓声・「おぉー」は、最初に一度だけ作って録音しておき、それを鳴らす（何十個もの音を毎回作ると、iPhoneで音が遅れたり雑音になったりする）
  let PRE = {};
  async function prerenderAll() {
    const a = AC; if (!a || PRE.busy) return; PRE.busy = true;
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OC) return;
    const sr = a.sampleRate;
    const mk = (secs, build) => { const oc = new OC(1, Math.ceil(secs * sr), sr); const keep = { AC, sfxG, noiseBuf }; AC = oc; sfxG = oc.createGain(); sfxG.connect(oc.destination); noiseBuf = null; try { build(oc, sfxG); } finally { ({ AC, sfxG, noiseBuf } = keep); } return oc.startRendering(); };
    try {
      const raw = await mk(14, (oc, out) => { const g = oc.createGain(); g.connect(out); crowdBands(oc, g, []); });
      // つなぎ目が分からないように、最後の2秒を最初の2秒に重ねて12秒のくり返しにする
      const L = 12 * sr, X = 2 * sr, src = raw.getChannelData(0), loop = a.createBuffer(1, L, sr), d = loop.getChannelData(0);
      for (let i = 0; i < L; i++) { if (i < X) { const w = i / X; d[i] = src[i] * Math.sqrt(w) + src[i + L] * Math.sqrt(1 - w); } else d[i] = src[i]; }
      const cheer = await mk(7, () => cheerLive());
      const ooh = await mk(2.6, () => oohLive());
      if (AC === a) PRE = { crowd: loop, cheer, ooh };
    } catch (_) { PRE.busy = false; }
  }
  function playBuf(buf, vol = 1, t0 = 0) { const a = ctx(); if (!a || !buf) return; const s2 = a.createBufferSource(); s2.buffer = buf; s2.playbackRate.value = 0.97 + Math.random() * 0.06; const g = a.createGain(); g.gain.value = vol; s2.connect(g); g.connect(sfxG); s2.start(a.currentTime + t0); }
  // 版720：本物の観客の録音（sound/ のmp3）。読みこめたら、作った音の代わりに使う（読みこめない時は、今までの作った音）
  //  crowd＝スタジアムのざわめき（くり返し）、big＝すごいプレーの時のざわめき、ooh＝惜しいシーン（スキルの時も）、clap＝拍手
  let FILE = {}, fileLoading = false;
  function gCheer(k) {
    const a = AC; if (!a) return; loadFiles();
    if (FILE.big) { playBuf(FILE.big, FILE_VOL.big * 1.2 * k); if (k > 0.8) playBuf(FILE.big, FILE_VOL.big * 0.7, 1.0); } else if (PRE.cheer) playBuf(PRE.cheer, 0.6 * k); else { try { cheerLive(); } catch (_) {} }
    if (FILE.clap) playBuf(FILE.clap, FILE_VOL.clap * k, 0.3);
    if (FILE.cheerloop) { const src = a.createBufferSource(), g = a.createGain(), t = a.currentTime; src.buffer = FILE.cheerloop; src.loop = true;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(FILE_VOL.cheer * 0.7 * k, t + 0.3); g.gain.setValueAtTime(FILE_VOL.cheer * 0.7 * k, t + 1.5); g.gain.linearRampToValueAtTime(0.0001, t + 4.8);
      src.connect(g); g.connect(sfxG); src.start(t); src.stop(t + 5); }
  }
  // 版822：曲をだんだん大きくして始める（クレッシェンド）
  function bgmIn(name, secs = 3) {
    const a = ctx(); if (a && bgmG && pref.bgm) { const g = bgmG.gain, t = a.currentTime; try { g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(0.55, t + secs); } catch (_) {} }
    bgm(name);
  }
  const SVER = (() => { try { return (document.currentScript && document.currentScript.src.split('v=')[1]) || ''; } catch (_) { return ''; } })();   // 版725：音を作り直した時に、古い音が残らないように
  const FILE_VOL = { crowd: 0.25, big: 0.75, ooh: 0.6, clap: 0.6, cheer: 1.5, chant: 0.6 };   // 版727：スタジアムのざわめきに負けないように、大歓声を大きく
  function loadFiles() {
    const a = AC; if (!a || fileLoading || FILE.crowd) return; fileLoading = true;
    ['crowd', 'big', 'ooh', 'clap', 'cheerloop', 'chantA', 'chantB', 'thunder'].forEach((n) => {
      fetch('sound/' + n + (/^chant/.test(n) ? '.wav' : '.mp3') + (SVER ? '?v=' + SVER : '')) /* 版731：太鼓はmp3だと前後にすき間が入ってリズムがずれるので、wav */.then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))).then((ab) => new Promise((ok, ng) => { try { const p = a.decodeAudioData(ab, ok, ng); if (p && p.then) p.then(ok, ng); } catch (e) { ng(e); } }))
        .then((buf) => { FILE[n] = buf; if (n === 'crowd' && crowdModeNow && crowdParts.length) { const m = crowdModeNow; crowd(false); setTimeout(() => crowd(m), 50); } }, () => {});
    });
  }
  function crowd(on) {
    const a = ctx(); if (!a) return; if (!on) { goalOn = false; exciteNow = 0; cheerSrc = null; cheerG = null; chantSrc = null; chantG = null; chantType = null; } crowdModeNow = on || null;
    if (on && crowdParts.length) { crowdMode(on); return; }
    if (on && !crowdParts.length) {
      const out = a.createGain(); out.gain.value = 0.0001; out.gain.exponentialRampToValueAtTime(0.9, a.currentTime + 1.5);
      const mix = a.createGain(); mix.gain.value = CROWD * (on === 'far' ? 0.36 : on === 'duck' ? 0.08 : on === 'pre' ? 0.6 : 1);
      const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = on === 'far' ? 420 : 40; hp.Q.value = 0.5;
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.connect(hp); hp.connect(out); out.connect(mix); mix.connect(sfxG);
      if (FILE.crowd) { const src = a.createBufferSource(), fg = a.createGain(); src.buffer = FILE.crowd; src.loop = true; src.loopStart = 0.05; src.loopEnd = FILE.crowd.duration - 0.05; fg.gain.value = FILE_VOL.crowd; src.connect(fg); fg.connect(hp); src.start(0, 0.05 + Math.random() * (FILE.crowd.duration - 0.2)); crowdParts.push(src); }   // 版720：録音のざわめき（こもらないように、高い音を切るフィルターは通さない）
      else if (PRE.crowd) { const src = a.createBufferSource(); src.buffer = PRE.crowd; src.loop = true; src.connect(lp); src.start(0, Math.random() * 10); crowdParts.push(src); }   // 版560：前もって作っておいた観客の声（軽い）
      else crowdBands(a, lp, crowdParts);
      crowdParts.push({ stop() {}, out });
      crowdGain = out; crowdHp = hp; crowdMix = mix;
    } else if (!on && crowdParts.length) { const parts = crowdParts, g = crowdGain, mx = crowdMix; crowdParts = []; crowdGain = null; crowdHp = null; crowdMix = null; try { const t = a.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); } catch (_) {} try { setTimeout(() => { try { mx.disconnect(); } catch (_) {} }, 700); } catch (_) {} setTimeout(() => parts.forEach((p) => { try { p.stop(); } catch (_) {} }), 800); }
  }

  // ---- BGM：小さな曲を繰り返す（メロディ・ベース・リズム） ----
  // 1拍を4つに分けたマス。'-'は前の音をのばす、'.'は休み
  const SONGS = {
    home: { bpm: 112, mel: 'E5 - G5 - A5 - G5 E5 | C5 - D5 - E5 - . . | D5 - E5 - G5 - E5 D5 | C5 - - - . . . . | E5 - G5 - A5 - C6 A5 | G5 - E5 - D5 - . . | C5 - D5 - E5 - D5 C5 | C5 - - - . . . .',
      bass: 'C3 . G3 . C3 . G3 . | A2 . E3 . A2 . E3 . | F2 . C3 . F2 . C3 . | G2 . D3 . G2 . B2 . | C3 . G3 . C3 . G3 . | A2 . E3 . A2 . E3 . | F2 . C3 . G2 . D3 . | C3 . G3 . C3 . . .', drum: 'k.h.s.h.' },
    club: { bpm: 96, mel: 'G4 - B4 - D5 - B4 - | C5 - B4 - A4 - . . | A4 - C5 - E5 - C5 - | D5 - - - . . . . | G4 - B4 - D5 - G5 - | F#5 - E5 - D5 - . . | C5 - B4 - A4 - B4 - | G4 - - - . . . .',
      bass: 'G2 . D3 . G2 . D3 . | C3 . G3 . C3 . G3 . | A2 . E3 . A2 . E3 . | D3 . A3 . D3 . F#3 . | G2 . D3 . G2 . D3 . | D3 . A3 . D3 . A3 . | C3 . G3 . D3 . A3 . | G2 . D3 . G2 . . .', drum: 'k...s...' },
    prematch: { bpm: 132, mel: 'A4 . A4 . E5 - - . | D5 . C5 . B4 - - . | A4 . A4 . E5 - - . | G5 - F#5 - E5 - . . | C5 . C5 . G5 - - . | F5 . E5 . D5 - - . | E5 . E5 . A5 - G5 - | E5 - - - . . . .',
      bass: 'A2 A2 A3 A2 A2 A2 A3 A2 | G2 G2 G3 G2 G2 G2 G3 G2 | F2 F2 F3 F2 F2 F2 F3 F2 | E2 E2 E3 E2 E2 E2 E3 E2 | C3 C3 C4 C3 C3 C3 C4 C3 | D3 D3 D4 D3 D3 D3 D4 D3 | A2 A2 A3 A2 E2 E2 E3 E2 | A2 A2 A3 A2 A2 . . .', drum: 'k.hsk.hs' },
    // 版558：ハーフタイム（ロッカールーム）。本家はテンポ約130の明るいバンドの曲なので、明るく速い曲にした（曲は自作）
    half: { bpm: 128, mel: 'C5 . F5 . A5 - G5 F5 | G5 - - . . . E5 F5 | G5 . A5 . A#5 - A5 G5 | A5 - - - . . . . | A5 . G5 . F5 - D5 F5 | G5 - - . C5 . E5 G5 | F5 . A5 . G5 - E5 . | F5 - - - . . . .',
      bass: 'F2 . F3 . F2 . F3 . | C3 . C3 . C3 . E3 . | A#2 . A#2 . A#2 . A#3 . | F2 . F3 . A2 . C3 . | D3 . D3 . D3 . A2 . | C3 . C3 . C3 . E3 . | A#2 . A#2 . C3 . C3 . | F2 . C3 . F2 . . .', drum: 'khshkhsh' },
    // 版580：優勝の演出の曲（本家は変ロ長調・テンポ105くらいの明るいファンファーレ。曲は自作）
    champ: { bpm: 108, mel: 'A#4 . D5 . F5 - - A#5 | A5 - G5 - F5 - - . | D#5 . G5 . A#5 - - D#6 | D6 - C6 - A#5 - - . | C6 . A#5 . A5 . G5 . | F5 - G5 - A5 - A#5 . | C6 - - - A5 - F5 . | A#5 - - - - - . .',
      bass: 'A#2 . F3 . A#2 . F3 . | F2 . C3 . F2 . C3 . | D#2 . A#2 . D#2 . A#2 . | A#2 . F3 . A#2 . D3 . | A2 . D3 . G2 . D3 . | D#2 . A#2 . F2 . C3 . | F2 . C3 . F2 . A2 . | A#2 . F3 . A#2 . . .', drum: 'khshkhsh' },
    // 版559：試合が終わったあと（ダイジェスト・ロッカールーム・順位表）。本家は試合後、観客の声が消えて、ノリのいい曲になる（曲は自作）
    post: { bpm: 140, mel: 'E5 - G5 - C6 - B5 A5 | G5 - E5 - D5 - . . | F5 - A5 - D6 - C6 B5 | C6 - - - G5 - . . | A5 - C6 - F5 - E5 D5 | E5 - C5 - A4 - G4 - | F4 - E4 - D4 - G4 - | C5 - - - . . . .',
      bass: 'C3 C3 C4 C3 C3 C3 C4 C3 | G2 G2 G3 G2 G2 G2 G3 G2 | D3 D3 D4 D3 D3 D3 D4 D3 | C3 C3 C4 C3 E3 E3 E4 E3 | F2 F2 F3 F2 F2 F2 F3 F2 | A2 A2 A3 A2 A2 A2 A3 A2 | D3 D3 D4 D3 G2 G2 G3 G2 | C3 C3 C4 C3 C3 . . .', drum: 'khshkhsh' },
    // 版821：スカウト（ガチャ）の曲。明るくせず、ドキドキさせる。短調の低い音の刻み＋心臓の音（ドクン、ドクン）＋高い音がじわじわ半音ずつ上がる（曲は自作）
    // 版822：スカウト（ガチャ）の曲。ウイイレのスカウトのような、ワクワクするドキドキ。明るい長調で、速い分散和音（アルペジオ）＋はねるベース＋4つ打ち。最後の小節で上へかけ上がる（曲は自作）
    gacha: { bpm: 136, mel: 'D5 F#5 A5 D6 A5 F#5 A5 D6 | C#5 E5 A5 C#6 A5 E5 A5 C#6 | B4 D5 F#5 B5 F#5 D5 F#5 B5 | G4 B4 D5 G5 D5 B4 D5 G5 | D5 F#5 A5 D6 A5 F#5 A5 D6 | C#5 E5 A5 C#6 A5 E5 A5 C#6 | G5 B5 D6 G6 D6 B5 D6 G6 | A5 C#6 E6 A6 - - . .',
      bass: 'D2 D3 D2 D3 D2 D3 D2 D3 | A1 A2 A1 A2 A1 A2 A1 A2 | B1 B2 B1 B2 B1 B2 B1 B2 | G1 G2 G1 G2 G1 G2 G1 G2 | D2 D3 D2 D3 D2 D3 D2 D3 | A1 A2 A1 A2 A1 A2 A1 A2 | G1 G2 G1 G2 G1 G2 G1 G2 | A1 A2 A1 A2 A1 A2 A1 A2', drum: 'khshkhsh' },
  };
  let cur = null, want = null, timer = null, step = 0, nextT = 0, parsed = null;
  const parse = (s) => s.replace(/\|/g, ' ').trim().split(/\s+/);
  function bgm(name) {
    want = name || null;
    if (cur === want) return;
    clearInterval(timer); timer = null; cur = null;
    if (!want || !SONGS[want]) return;
    const a = ctx(); if (!a || a.state !== 'running') return;
    const S = SONGS[want]; parsed = { mel: parse(S.mel), bass: parse(S.bass), drum: S.drum, sp: 60 / S.bpm / 2 };
    cur = want; step = 0; nextT = a.currentTime + 0.08;
    timer = setInterval(sched, 60); sched();
  }
  function lead(f, d, t0) {
    const a = AC; const t = a.currentTime + t0; const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(1500, t + Math.min(d, 0.4)); lp.Q.value = 1;
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.012); g.gain.exponentialRampToValueAtTime(0.04, t + Math.min(d, 0.15)); g.gain.setValueAtTime(0.04, t + Math.max(0.02, d - 0.03)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    [-7, 7].forEach((c) => { const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c; o.connect(lp); o.start(t); o.stop(t + d + 0.02); });
    { const o = a.createOscillator(); o.type = 'square'; o.frequency.value = f; const g2 = a.createGain(); g2.gain.value = 0.35; o.connect(g2); g2.connect(lp); o.start(t); o.stop(t + d + 0.02); }
    lp.connect(g); g.connect(bgmG);
  }
  function bassV(f, d, t0) {
    const a = AC; const t = a.currentTime + t0; const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 2;
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.01); g.gain.exponentialRampToValueAtTime(0.08, t + Math.min(d, 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const o2 = a.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f;
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bgmG); [o, o2].forEach((x) => { x.start(t); x.stop(t + d + 0.02); });
  }
  function noteAt(arr, i) { const n = arr[i % arr.length]; if (n === '-' || n === '.') return null; let len = 1; while (arr[(i + len) % arr.length] === '-' && len < 16) len++; return { f: N(n), len }; }
  function sched() {
    const a = AC; if (!a || !cur) return;
    while (nextT < a.currentTime + 0.25) {
      const t0 = nextT - a.currentTime, sp = parsed.sp;
      // 版558：本家の曲はバンドの音（ピコピコではない）。メロディは2本のギザギザ波を少しずらして柔らかく、ベースは太く、ドラムはキック・スネア・ハイハット
      const m = noteAt(parsed.mel, step); if (m) lead(m.f, m.len * sp * 0.92, t0);
      const b = noteAt(parsed.bass, step); if (b) bassV(b.f, b.len * sp * 0.9, t0);
      if (parsed.drum) { const d = parsed.drum[step % parsed.drum.length]; if (d === 'k') { tone(150, 0.12, 'sine', 0.32, t0, 48, bgmG); noise(0.01, 0.04, 'highpass', 3000, t0, bgmG); } else if (d === 's') { noise(0.13, 0.11, 'bandpass', 1900, t0, bgmG, 0.002); tone(190, 0.07, 'triangle', 0.08, t0, 150, bgmG); } else if (d === 'h') noise(0.035, 0.03, 'highpass', 7000, t0, bgmG, 0.001); }
      step++; nextT += sp;
    }
  }

  // 確認用：音を画面の外で作って、波の形を返す（スピーカーは使わない）
  async function __render(fn, secs = 3) {
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext; const keep = { AC, master, sfxG, bgmG, noiseBuf, crowdParts, crowdGain, crowdHp, crowdMix };
    const oc = new OC(1, Math.ceil(secs * 22050), 22050); AC = oc; master = oc.createGain(); master.gain.value = 1; master.connect(oc.destination); sfxG = oc.createGain(); sfxG.connect(master); bgmG = oc.createGain(); bgmG.gain.value = 0.55; bgmG.connect(master); noiseBuf = null; crowdParts = []; crowdGain = null;
    const song = (name) => { const kp = [cur, parsed, step, nextT]; const S = SONGS[name]; parsed = { mel: parse(S.mel), bass: parse(S.bass), drum: S.drum, sp: 60 / S.bpm / 2 }; cur = '__r'; step = 0; nextT = 0.05; const end = secs - 0.3; while (nextT < end) sched2(); [cur, parsed, step, nextT] = kp; };
    const sched2 = () => { const sp = parsed.sp, t0 = nextT; const m = noteAt(parsed.mel, step); if (m) lead(m.f, m.len * sp * 0.92, t0); const b = noteAt(parsed.bass, step); if (b) bassV(b.f, b.len * sp * 0.9, t0); if (parsed.drum) { const d = parsed.drum[step % parsed.drum.length]; if (d === 'k') { tone(150, 0.12, 'sine', 0.32, t0, 48, bgmG); noise(0.01, 0.04, 'highpass', 3000, t0, bgmG); } else if (d === 's') { noise(0.13, 0.11, 'bandpass', 1900, t0, bgmG, 0.002); tone(190, 0.07, 'triangle', 0.08, t0, 150, bgmG); } else if (d === 'h') noise(0.035, 0.03, 'highpass', 7000, t0, bgmG, 0.001); } step++; nextT += sp; };
    let buf; try { fn({ SFX, crowd, tone, noise, whistle, song, oc }); buf = await oc.startRendering(); } finally { ({ AC, master, sfxG, bgmG, noiseBuf, crowdParts, crowdGain, crowdHp, crowdMix } = keep); }
    return Array.from(buf.getChannelData(0));
  }
  function set(k, v) {
    pref[k] = v; save(); const a = ctx(); if (!a) return;
    if (k === 'sfx') sfxG.gain.value = v ? 1 : 0;
    if (k === 'bgm') { bgmG.gain.value = v ? 0.55 : 0; }
    if (k === 'vol') master.gain.value = v * BOOST;
  }
  window.DotSound = { play, bgm, bgmIn, crowd, goal, excite, chant, set, __render, get __bufs() { return { PRE, FILE }; }, get state() { return { bgm: cur, want, crowd: crowdMix ? +crowdMix.gain.value.toFixed(2) : 0, hp: crowdHp ? Math.round(crowdHp.frequency.value) : 0, pre: Object.keys(PRE).join(',') }; }, get pref() { return { ...pref }; } };
})();
// ボタンを押した時の音（戻るボタンは別の音）
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button'); if (!b || b.disabled || !window.DotSound) return;
  const back = b.querySelector('.bk-ico') || /もどる|戻る/.test(b.title || '') || b.id === 'wStop';
  DotSound.play(back ? 'back' : 'tap');
}, true);
