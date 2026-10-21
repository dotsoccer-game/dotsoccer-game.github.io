// はじめて遊ぶ人のためのチュートリアル（本家カルチョビットAの最初の流れを参考に、このゲームの仕組みで案内する）
// 秘書とコーチが話しかけ、押してほしい所だけを光らせる。進み具合はセーブ（save.tut）に残す
(() => {
  'use strict';
  const $ = (q) => document.querySelector(q);
  const K = () => window.__career, A = () => window.__app;
  const LAB = /lab\.html/.test(location.pathname);   // 確認ページでは出さない
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const WHO = { sec: { name: '秘書', img: 'staff/secretary.png' }, coach: { name: 'コーチ', img: 'staff/coach.png' } };

  // ---------- 画面の上にかぶせる層 ----------
  let root = null;
  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement('div'); root.id = 'tut'; root.hidden = true;
    root.innerHTML = `<div class="tt-shade"></div><div class="tt-hole"></div>
      <svg class="tt-arrow" viewBox="0 0 64 64" aria-hidden="true"><path d="M22 4h20v26h14L32 60 8 30h14z" fill="#ffe23a" stroke="#3a2a00" stroke-width="4" stroke-linejoin="round"/></svg>
      <div class="tt-big"></div>
      <div class="tt-box"><div class="tt-face"><img alt=""></div><div class="tt-win"><div class="tt-name"></div><div class="tt-text"></div><div class="tt-ui"></div><i class="tt-next"></i></div></div>`;
    (document.getElementById('app') || document.body).appendChild(root);
    return root;
  }
  const appEl = () => document.getElementById('app');
  const scale = () => { const a = appEl(); return a.getBoundingClientRect().width / (a.offsetWidth || 1); };
  function local(r) { const a = appEl().getBoundingClientRect(), s = scale(); return { x: (r.left - a.left) / s, y: (r.top - a.top) / s, w: r.width / s, h: r.height / s, sx: r.left, sy: r.top, sw: r.width, sh: r.height }; }
  function rectOf(spot) {
    if (!spot) return null;
    if (typeof spot === 'function') spot = spot();
    if (!spot) return null;
    if (spot.left != null && spot.width != null && !(spot instanceof Element)) return local(spot);
    const els = typeof spot === 'string' ? [...document.querySelectorAll(spot)].filter((e) => e.offsetParent !== null || e.getClientRects().length) : Array.isArray(spot) ? spot : [spot];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const e of els) { if (!e) continue; for (const q of [e, ...e.querySelectorAll('img,canvas,svg')]) { const r = q.getBoundingClientRect(); if (!r.width && !r.height) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); } }   // 版483：はみ出した絵（ボタンの画像など）も含めて囲む
    if (x1 < x0) return null;
    return local({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 });
  }

  // 1つの吹き出し：話す人・文・光らせる所。tap＝光った所を押すまで進まない
  let typing = null;
  function say(who, text, o = {}) {
    const r = ensureRoot(); r.hidden = false; r.className = 'tt-on' + (o.cls ? ' ' + o.cls : '');
    const box = r.querySelector('.tt-box'), face = r.querySelector('.tt-face'), name = r.querySelector('.tt-name'), tx = r.querySelector('.tt-text'), ui = r.querySelector('.tt-ui'), nx = r.querySelector('.tt-next');
    const hole = r.querySelector('.tt-hole'), shade = r.querySelector('.tt-shade'), arrow = r.querySelector('.tt-arrow'), big = r.querySelector('.tt-big');
    const w = WHO[who];
    face.hidden = !w; if (w) face.querySelector('img').src = w.img;
    name.hidden = !w; name.textContent = w ? w.name : '';
    box.classList.toggle('narr', !w);
    ui.innerHTML = ''; big.innerHTML = o.big || ''; big.hidden = !o.big; big.className = 'tt-big' + (o.bigCls ? ' ' + o.bigCls : '');
    // 光らせる所
    const place = () => {
      const R = rectOf(o.spot), pad = o.pad ?? 8;
      if (R) {
        hole.hidden = false; shade.hidden = true;
        Object.assign(hole.style, { left: R.x - pad + 'px', top: R.y - pad + 'px', width: R.w + pad * 2 + 'px', height: R.h + pad * 2 + 'px', borderRadius: (o.round ? '50%' : '14px') });
        const H = appEl().offsetHeight, W = appEl().offsetWidth, below = R.y + R.h / 2 < H * 0.55;
        // 吹き出しは光った所と重ならない側へ
        box.classList.toggle('top', !below && !o.boxBottom);
        if (o.tap || o.arrow) { arrow.removeAttribute('hidden'); const ax = Math.min(W - 70, Math.max(10, R.x + R.w / 2 - 30)), up = R.y > 90; arrow.style.left = ax + 'px'; arrow.style.top = (up ? R.y - pad - 66 : R.y + R.h + pad + 6) + 'px'; arrow.classList.toggle('up', !up); }
        else arrow.setAttribute('hidden', '');
        r._hole = R; r._pad = pad;
      } else { hole.hidden = true; shade.hidden = !!(o.noShade || document.getElementById('ttScene')); arrow.setAttribute('hidden', ''); r._hole = null; box.classList.toggle('top', !!o.boxTop); }
    };
    place();
    const re = () => place(); window.addEventListener('stagefit', re);
    const follow = setInterval(place, 300);   // 版483：ボタンが動いて出てくる・画面の大きさが変わる時も、囲いがずれないように追いかける
    // 文字送り
    const html = text; let n = 0; const plain = html.replace(/<[^>]+>/g, '');
    clearInterval(typing); tx.innerHTML = ''; nx.hidden = true;
    const show = (k) => { let c = 0, out = '', inTag = false; for (const ch of html) { if (ch === '<') inTag = true; if (inTag) { out += ch; if (ch === '>') inTag = false; continue; } if (c >= k) break; out += ch; c++; } tx.innerHTML = out; };
    typing = setInterval(() => { n += 1; show(n); if (n >= plain.length) { clearInterval(typing); typing = null; nx.hidden = !!(o.tap || o.choices || o.input); } }, o.fast ? 10 : 34);
    const finishType = () => { if (typing) { clearInterval(typing); typing = null; show(1e9); nx.hidden = !!(o.tap || o.choices || o.input); return true; } return false; };
    return new Promise((res) => {
      const done = (v) => { clearInterval(follow); window.removeEventListener('stagefit', re); r.onclick = null; r.onpointerdown = null; res(v); };
      if (o.choices) {
        ui.innerHTML = `<div class="tt-ch">${o.choices.map((c, k) => `<button data-k="${k}" class="${k === 0 ? 'pri' : ''}">${esc(c)}</button>`).join('')}</div>`;
        ui.querySelectorAll('button').forEach((b) => b.onclick = (e) => { e.stopPropagation(); finishType(); done(+b.dataset.k); });
      }
      if (o.input) {
        ui.innerHTML = `<div class="tt-in"><input maxlength="${o.input.max || 10}" placeholder="${esc(o.input.ph || '')}" value="${esc(o.input.value || '')}"><button class="pri">決定</button></div><p class="tt-err"></p>`;
        const inp = ui.querySelector('input'), err = ui.querySelector('.tt-err');
        const ok = (e) => { if (e) e.stopPropagation(); const v = inp.value.trim(); if (!v) { err.textContent = '名前を入れてください'; return; } done(v); };
        ui.querySelector('button').onclick = ok; inp.onkeydown = (e) => { if (e.key === 'Enter') ok(e); }; inp.onclick = (e) => e.stopPropagation();
        setTimeout(() => { try { inp.focus(); } catch (_) {} }, 300);
      }
      r.onclick = (e) => {
        if (o.choices || o.input) { finishType(); return; }
        if (o.tap) {
          const R = r._hole; if (!R) { if (finishType()) return; hide(); if (typeof o.tap === 'function') setTimeout(o.tap, 0); done(true); return; }
          const a = appEl().getBoundingClientRect(), s = scale(), x = (e.clientX - a.left) / s, y = (e.clientY - a.top) / s, p = r._pad;
          if (x < R.x - p || x > R.x + R.w + p || y < R.y - p || y > R.y + R.h + p) { finishType(); hole.classList.remove('blink'); void hole.offsetWidth; hole.classList.add('blink'); return; }
          finishType(); hide();
          const cx = e.clientX, cy = e.clientY; setTimeout(() => { if (typeof o.tap === 'function') o.tap(); else forward(cx, cy); }, 0);
          done(true); return;
        }
        if (finishType()) return;
        done(true);
      };
    });
  }
  // 光った所を押した：その下にあるボタン・建物へ、そのままクリックを渡す
  function forward(cx, cy) {
    const r = ensureRoot(); r.hidden = true;
    const el = document.elementFromPoint(cx, cy); if (!el) return;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
  }
  function hide() { const r = ensureRoot(); r.hidden = true; r.onclick = null; clearInterval(typing); typing = null; }

  // ---------- タイトル画面 ----------
  function title() {
    // 版689：スタジアムの背景・太いロゴ。雲がゆっくり流れ、手前を選手がゆっくり歩く（たまにドリブル）
    return new Promise((res) => {
      const el = document.createElement('div'); el.id = 'ttTitle';
      const ver = esc((document.querySelector('script[src*="engine.js"]') || {}).src?.split('v=')[1] || '');
      el.innerHTML = `<div class="ttl-stage"><img class="ttl-bg" src="img/title/bg.jpg" alt="" draggable="false">
          <img class="ttl-cl c1" src="img/title/cloud1.png" alt=""><img class="ttl-cl c2" src="img/title/cloud2.png" alt=""><img class="ttl-cl c3" src="img/title/cloud3.png" alt="">
          <img class="ttl-logo2" src="img/title/logo.png" alt="ドットサッカー" draggable="false"><div class="ttl-men"></div></div>
        <p class="ttl-tap">画面をタップしてはじめる</p><p class="ttl-ver">Ver. ${ver}</p>`;
      (appEl() || document.body).appendChild(el);
      const stage = el.querySelector('.ttl-stage'), men = el.querySelector('.ttl-men');
      // 版784：背景（スタジアム）とロゴが読み込み終わってから、一度に出す（上から少しずつ描かれたり、空だけ映ったりしないように）
      { stage.style.opacity = '0'; const tap0 = el.querySelector('.ttl-tap'); if (tap0) tap0.style.visibility = 'hidden';
        const imgs = [...el.querySelectorAll('.ttl-bg,.ttl-logo2')];
        const ready = (im) => (im.complete && im.naturalWidth ? (im.decode ? im.decode().catch(() => {}) : Promise.resolve()) : new Promise((r) => { im.onload = () => (im.decode ? im.decode().catch(() => {}).then(r) : r()); im.onerror = r; }));
        let shown = false; const showNow = () => { if (shown) return; shown = true; stage.style.transition = 'opacity .25s'; stage.style.opacity = '1'; if (tap0) tap0.style.visibility = ''; };
        Promise.all(imgs.map(ready)).then(showNow); setTimeout(showNow, 6000); }
      const SW = 1850, SH = 850;
      const fit = () => { const w = el.clientWidth || 1280, h = el.clientHeight || 720, k = Math.max(w / SW, h / SH); stage.style.transform = `translate(${(w - SW * k) / 2}px,${(h - SH * k) / 2}px) scale(${k})`; };
      fit(); addEventListener('resize', fit);
      // 版783：スマホを回した直後などに、画面の大きさが変わったのに合わせ直されず、背景の空だけが大きく映ることがあった。大きさの変化を直接見張る＋少し遅れて合わせ直す
      try { const ro = new ResizeObserver(() => fit()); ro.observe(el); } catch (_) {}
      addEventListener('orientationchange', () => { setTimeout(fit, 120); setTimeout(fit, 500); });
      setTimeout(fit, 300); setTimeout(fit, 1200);
      // 版690：選手が一列になって走る。先頭がボールをドリブル（ボールはドット絵で、転がると回る）
      const ppl = [], N = 5, GAP = 150, V = 165;
      try {
        const look = [[2, 2, 0], [0, 0, 1], [1, 1, 2], [3, 0, 0], [1, 2, 1]];
        look.forEach(([hair, hc, skin], k) => {
          const info = { name: '', number: 1 + k, hair, hairColor: hc, skin, position: 'MF' };
          const fr = [0, 1, 2, 3].map((f) => A().spriteCanvas(info, 0, 'side', f, true, false));
          if (!fr[0]) return;
          const box = document.createElement('div'); box.className = 'ttl-man';
          const cv = document.createElement('canvas'); cv.width = fr[0].width; cv.height = fr[0].height; box.appendChild(cv);
          men.appendChild(box); ppl.push({ box, cv, fr, t: k * 0.7 });
        });
      } catch (_) {}
      // ボール：14×14ドット。サッカーボールの黒い五角形（正二十面体の頂点の向き）を、転がった角度で回して描く
      const BP = (() => { const t = (1 + Math.sqrt(5)) / 2, v = []; for (const a of [-1, 1]) for (const b of [-t, t]) v.push([0, a, b], [a, b, 0], [b, 0, a]); return v.map((q) => { const n = Math.hypot(...q); return q.map((u) => u / n); }); })();
      const bwrap = document.createElement('div'); bwrap.className = 'ttl-bw'; const bcv = document.createElement('canvas'); bcv.width = 14; bcv.height = 14; bwrap.appendChild(bcv); men.appendChild(bwrap);
      const bctx = bcv.getContext('2d'), bimg = bctx.createImageData(14, 14);
      const drawBall = (ang) => {
        const c = Math.cos(ang), s = Math.sin(ang), d = bimg.data;
        for (let py = 0; py < 14; py++) for (let px = 0; px < 14; px++) {
          const x = (px + 0.5 - 7) / 6.3, y = (py + 0.5 - 7) / 6.3, rr = x * x + y * y, o = (py * 14 + px) * 4;
          if (rr > 1) { d[o + 3] = 0; continue; }
          let col;
          if (rr > 0.7) col = [27, 42, 74];   // ふち
          else {
            const z = Math.sqrt(1 - rr);
            // 画面の奥向きの軸で回す（横に転がる）＋少し傾けて模様を見やすく
            const rx = x * c + y * s, ry = -x * s + y * c, ty = ry * 0.9 - z * 0.44, tz = ry * 0.44 + z * 0.9;
            let best = -1; for (const q of BP) { const dd = q[0] * rx + q[1] * ty + q[2] * tz; if (dd > best) best = dd; }
            const lit = 0.78 + 0.22 * (-x * 0.5 - y * 0.6 + z * 0.6);
            col = best > 0.925 ? [30, 34, 48] : [Math.min(255, 255 * lit), Math.min(255, 255 * lit), Math.min(255, 258 * lit)];
          }
          d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
        }
        bctx.putImageData(bimg, 0, 0);
      };
      let dir = 1, head = -160, rowY = 556, wait = 0, bx = 0, bv = 0, bang = 0, lap = 0;
      const startLap = () => { head = dir > 0 ? -160 : SW + 160; rowY = lap % 2 ? 578 : 556; bx = head + dir * 92; bv = 0; };
      startLap();
      let last = performance.now(), raf = 0;
      const tick = (now) => {
        if (!el.isConnected) return;
        const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
        if (wait > 0) { wait -= dt; if (wait <= 0) { lap++; dir = -dir; startLap(); } }
        else {
          head += dir * V * dt;
          // ボール：先頭の足が追いついたら軽く蹴り出す。転がりながら少しずつ遅くなる
          const foot = head + dir * 70;
          if ((bx - foot) * dir < 16) bv = V * 1.85;
          bv = Math.max(0, bv - 230 * dt); bx += dir * bv * dt; bang += dir * (bv * dt) / 13;
          const tail = head - dir * GAP * (ppl.length - 1);
          if ((dir > 0 && tail > SW + 120) || (dir < 0 && tail < -220)) wait = 1.6;
        }
        ppl.forEach((p, i) => {
          const x = head - dir * GAP * i - 45; p.t += dt * 9;
          const f = ((Math.floor(p.t) % 4) + 4) % 4, c = p.cv.getContext('2d'); c.clearRect(0, 0, p.cv.width, p.cv.height); c.drawImage(p.fr[f], 0, 0);
          p.box.style.transform = `translate(${x}px,${rowY}px)`; p.cv.style.transform = dir < 0 ? 'scaleX(-1)' : '';   // 横向きの絵は右向き。左へ走る時だけ裏返す
        });
        drawBall(bang); bwrap.style.transform = `translate(${bx - 17}px,${rowY + 120 - 32}px)`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      // 版691：タップ → 少し暗くなりながら、ホーム画面へ
      el.onclick = () => { if (el.classList.contains('dim')) return; el.classList.add('dim'); try { window.DotSound && DotSound.play('tap'); } catch (_) {} setTimeout(() => el.classList.add('out'), 380); setTimeout(() => { cancelAnimationFrame(raf); removeEventListener('resize', fit); el.remove(); res(); }, 900); };
    });
  }
  // 背景（クラブハウス）と秘書の立ち絵だけの場面
  function scene(on) {
    let el = document.getElementById('ttScene');
    if (!on) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'ttScene'; (appEl() || document.body).appendChild(el); }
    let bg = ''; try { bg = K().clubhouseBg(); } catch (_) {}
    el.innerHTML = (bg ? `<img class="sc-bg" src="${bg}" alt="">` : '') + `<img class="sc-sec" src="${WHO.sec.img}" alt="">`;
    { const im = el.querySelector('.sc-sec'); im.decoding = 'sync'; im.onerror = () => { setTimeout(() => { im.src = WHO.sec.img + '?r=' + Date.now(); }, 300); }; }   /* 版469：読み込みに失敗したら、もう一度 */
  }

  // ---------- 進み具合 ----------
  let save = null, busy = false;
  const st = () => (save && save.tut) || null;
  const store = () => { try { K().store(); } catch (_) {} };
  function setStep(s) { if (!save) return; save.tut = save.tut || {}; save.tut.s = s; store(); }
  const step = () => (st() ? st().s : null);
  const active = () => !!(st() && st().s && st().s !== 'done');
  // ほかの画面（結果・順位表・秘書・モーダル）が出ている間は待つ
  const blocking = () => ['#crModal', '#secScreen', '#assocScreen', '#clubScreen', '#liveScr', '#pbModal', '#mresult', '#lkScreen', '#ttTitle', '#match:not([hidden])'].some((q) => { const e = document.querySelector(q); return e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; }) || [...document.querySelectorAll('.lk-wrap')].some((e) => !e.hidden && e.id !== 'ttScene');
  async function idleHome(maxMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) { if (K().view === 'home' && !$('#cv-home').hidden && !$('#career').hidden && !blocking()) { await sleep(250); if (!blocking()) return true; } await sleep(250); }
    return false;
  }
  const runQ = async (fn) => { for (let k = 0; busy && k < 200; k++) await sleep(50); return run(fn); };   // 前の案内が終わるのを待ってから
  const run = async (fn) => { if (busy) return; busy = true; try { await fn(); } catch (e) { console.error(e); hide(); } busy = false; if (active()) setTimeout(() => kickHome(), 60); };

  // ---------- 台本 ----------
  const team = () => (save && save.team && save.team.name) || 'はじまりFC';
  const mgr = () => (save && save.manager) || '';
  const MGR = () => (mgr() ? `${esc(mgr())}監督` : '監督');

  // 1. はじめて開いた：タイトル → 秘書のあいさつ → ホームタウン
  async function opening() {
    await title();
    scene(true);
    await say('sec', '監督、はじめまして！<br>「ドットサッカー」をはじめていただき、ありがとうございます！');
    await say('sec', `私が秘書を務めさせていただきます。<br>この小さなサッカークラブ「${esc(team())}」を、どうぞよろしくお願いします！`);
    const k = await say('sec', 'まずは、このクラブでの監督のお仕事を、ひととおりご案内しますね。', { choices: ['案内してもらう', '自分で遊ぶ（説明をとばす）'] });
    scene(false);
    if (k === 1) { setStep('done'); hide(); if (!save.clubSet) K().openClub({ first: true, onDone: () => K().go('home') }); return; }
    setStep('town'); hide(); K().go('home');
  }
  // 2. ホームタウンの案内 → スタジアムで練習試合
  async function town() {
    await say('sec', `ここが、我らが「${esc(team())}」のホームタウンです。`);
    await say('sec', 'ホームタウンの建物を選ぶと、監督としていろいろなお仕事ができます。');
    await say('sec', '「クラブハウス」では、選手の様子を見たり、特訓をしたりします。', { spot: () => K().townRect('club') });
    await say('sec', '「サッカー協会」では、試合の日程や順位がわかります。', { spot: () => K().townRect('assoc') });
    await say('sec', '「クラブ事務所」では、チーム編成やクラブの名前・ユニフォームを決めます。', { spot: () => K().townRect('lineup') });
    await say('sec', '「ショップ」では、コインで特訓カードを買えます。', { spot: () => K().townRect('shop') });
    await say('sec', 'さっそくですが、これから練習試合があります。<br>「スタジアム」に行ってみましょう！', { spot: () => K().townRect('stadium'), tap: () => { setStep('pre'); K().tutPractice(); } });
  }
  // 3. 試合前の画面（コーチ）
  async function live(el, meta) {
    if (meta.tut === 'practice' && step() === 'pre') {
      await sleep(500);
      await say('coach', `${MGR()}、はじめての試合ですね。<br>コーチです。よろしくお願いします！`);
      await say('coach', '試合の前に、「スタメン」で先発メンバーとポジション、<br>「戦術」で攻め方・守り方を決めておけます。', { spot: () => [el.querySelector('[data-a="lineup"]'), el.querySelector('[data-a="tac"]')] });
      await say('coach', '「ユニフォーム」では、この試合で着るユニフォーム（ホーム・アウェー）を選べます。', { spot: () => el.querySelector('[data-a="kit"]') });
      await say('coach', '今日はひとまず、「試合開始」で試合を見てみましょう！', { spot: () => el.querySelector('[data-a="ko"]'), tap: true });
      setStep('match');
      return;
    }
    if (step() === 'official' && !meta.practice) {
      await sleep(500);
      await say('coach', `${MGR()}、いよいよ公式戦ですね！<br>練習試合と同じように、「スタメン」と「戦術」はここでも変えられます。`, { spot: () => [el.querySelector('[data-a="lineup"]'), el.querySelector('[data-a="tac"]')] });
      await say('coach', 'ここで変えた戦術は、この試合だけの指示になります。<br>準備ができたら「試合開始」です！', { spot: () => el.querySelector('[data-a="ko"]'), tap: true });
      setStep('officialVs');
    }
  }
  // 4. 対戦カード（TOTO）
  async function vs(el, meta) {
    const practice = meta.tut === 'practice' && step() === 'match', official = step() === 'officialVs' && !meta.practice;
    if (!practice && !official) return;
    await sleep(2300);
    window.__tutHold = true;
    if (practice) {
      await say(null, '試合の前には、対戦カードが出ます。<br>右の「TOTO」は試合の予想。上から「ホーム勝ち」「引き分け」「アウェー勝ち」の確率です。', { spot: () => el.querySelector('.vs-toto') });
      await say(null, 'チーム力の目安になるので、相手が強いか弱いかを確かめておきましょう。');
    } else {
      await say(null, 'いよいよ公式戦です。<br>TOTOで、相手との力の差を確かめておきましょう。', { spot: () => el.querySelector('.vs-toto') });
      setStep('officialMatch');
    }
    hide(); window.__tutHold = false;
  }
  // 5. 試合の中（練習試合：攻める向き・ボタン・課題カード → 途中で結果へ／公式戦：ハーフタイム）
  function matchOpts(meta) {
    if (!save || !active()) return null;
    if (meta.tut === 'practice' && (step() === 'match' || step() === 'pre')) {
      let introDone = false, issueDone = false, ending = false;
      const endEarly = async (api) => {
        if (ending) return; ending = true; api.pause();
        await say('sec', 'さすが監督、早くも課題が見えてきたみたいですね。<br>今日の観戦はここまでにして、結果を見てみましょう。');
        hide(); setStep('result'); api.skip();
      };
      return {
        tick: async (t, api) => {
          if (!introDone && t > 2.5) {
            introDone = true; api.pause();
            const d = api.dir();
            await say(null, `${d > 0 ? '左から右' : '右から左'}に攻めるのが、${MGR()}のチーム「${esc(team())}」です。`, { big: `<div class="tt-dir ${d > 0 ? 'r' : 'l'}"></div>`, boxTop: true, noShade: true });
            await say('coach', '試合が始まったら、選手は自分で考えて動きます。<br>監督は試合の流れを見て、チームの課題を見つけましょう。', { boxTop: true, noShade: true });
            await say('coach', '右のボタンで「選手交代」「選手」の様子、「状況」（スコアや途中経過）が見られます。', { spot: '#match aside', boxTop: false });
            await say('coach', '選手をタップすると、その選手を追いかけて見られますよ。', { boxTop: true });
            hide(); api.resume();
            return;
          }
          if (introDone && !issueDone && !ending && t > 120) endEarly(api);   // 課題が出なかった時も、ここで切り上げる
        },
        onIssue: async (e, api) => {
          if (issueDone || !introDone || ending) return; issueDone = true;
          await sleep(700); api.pause();
          await say('coach', '試合の中でチームの課題が見つかると、こうしてカードで教えてくれます。', { spot: '#coach', boxTop: true });
          await say('coach', '見つかった課題のカードは、試合のあとにもらえます。<br>特訓で使って、選手を伸ばしましょう！', { spot: '#coach', boxTop: true });
          endEarly(api);
        },
        onResult: async (el) => {
          await sleep(600);
          const sec = el.querySelector('.lk-sec[data-k="c"]'); if (sec) sec.classList.add('open');
          await say('coach', '試合の結果です。<br>試合が終わると、特訓カードがもらえます（どのカードが出るかはランダム）。', { spot: () => el.querySelector('.lk-sec[data-k="c"]') || el.querySelector('.lk-stat'), boxTop: true });
          await say('coach', '確認したら、右上の戻るボタンで終わりです。', { spot: () => el.querySelector('.lk-back'), tap: true, round: true });
          setStep('afterPractice');
        },
      };
    }
    if (!meta.practice && (step() === 'officialMatch' || step() === 'officialVs' || step() === 'official')) {
      let introDone = false;
      return {
        tick: async (t, api) => { if (!introDone && t > 2) { introDone = true; setStep('officialMatch'); } },
        onHalf: async () => {
          window.__tutHold = true;   // 説明の間は、ロッカーの残り時間を止める
          await sleep(900);
          const lkOn = () => { const e = document.getElementById('locker'); return e && !e.hidden; };
          if (!lkOn()) { window.__tutHold = false; return; }
          await say('coach', 'ハーフタイムです。<br>ここで、後半に向けた指示を出せます。', { boxTop: true });
          await say('coach', '「選手交代」で疲れた選手を入れ替えたり、「戦術」で攻め方・守り方を変えたりできます。', { spot: '#locker .lk-btns', boxTop: true });
          await say('coach', '左下の数字は、ハーフタイムの残り時間です。', { spot: '#locker .lk-count', boxTop: true });
          await say('coach', '0になるか、「後半開始」を押すと後半が始まります。', { spot: '#locker .lk-go', boxTop: true });
          hide(); window.__tutHold = false; setStep('afterOfficial');
        },
        onResult: async () => { if (step() !== 'afterOfficial') setStep('afterOfficial'); },
      };
    }
    return null;
  }
  // 6. 練習試合のあと：監督名 → クラブ事務所（クラブ名・略称・ユニフォーム・エンブレム）
  async function afterPractice() {
    await say('sec', '練習試合、お疲れさまでした！<br>試合をすると、カレンダーが1週間すすみます。');
    await say('sec', 'そういえば…私としたことが、監督のお名前をうかがっていませんでした。');
    let nm = '';
    for (;;) {
      nm = await say('sec', '監督のお名前を教えてください。<br><small>（8文字まで）</small>', { input: { max: 8, ph: '監督名', value: nm } });
      const k = await say('sec', `「${esc(nm)}監督」、でよろしいですか？`, { choices: ['はい', 'いいえ'] });
      if (k === 0) break;
    }
    save.manager = nm; store();
    await say('sec', `${esc(nm)}監督、あらためてよろしくお願いします！<br>今はまだ無名のクラブですが、いつか強豪クラブの仲間入りができるよう、がんばりましょう！`);
    await say('sec', '地域リーグから勝ち上がって、目指すは「D1リーグ」の優勝と「国内カップ」の制覇。<br>夢の二冠を目指しましょう！');
    await say('sec', 'まずは、私たちのクラブの名前を決めましょう。<br>「クラブ事務所」をタップしてください。', { spot: () => K().townRect('lineup'), tap: () => {} });
    hide(); setStep('club');
    const closed = new Promise((res) => K().openClub({ first: true, onDone: () => { res(); } }));
    await sleep(500);
    await say('sec', 'ここで、クラブの名前を決めます。<br>「クラブ名」は12文字まで、「略称」は試合の点数の横に出る短い名前です。', { spot: '.cl-form', boxBottom: true });
    await say('sec', '「ユニフォーム」と「エンブレム」のタブで、色や形も選べます。<br>左の絵で、できあがりを確かめられますよ。', { spot: '.cl-tabs', boxBottom: true });
    await say('sec', '決まったら、下の「決定」を押してください。', { spot: '.cl-ok', boxTop: true });
    hide();
    await closed;
    K().go('home');
    await idleHome();
    await say('sec', `「${esc(team())}」、とても素敵な名前ですね！`);
    await say('sec', '「クラブ事務所」では、ほかにもスタメンやポジションなどの「チーム編成」ができます。<br>名前やユニフォームは、いつでも変えられますよ。', { spot: () => K().townRect('lineup') });
    setStep('clubhouse');
    await clubhouse();
  }
  // 7. クラブハウス：選手データ・スタメン・戦術・特訓
  async function clubhouse() {
    await say('sec', '次は「クラブハウス」です。<br>試合で見つけた課題をもとに、選手を特訓しましょう！', { spot: () => K().townRect('club'), tap: () => { setStep('clubIn'); K().go('club'); } });
  }
  async function clubIn() {
    await sleep(500);
    const b = (g) => document.querySelector(`#cv-club .rbtns button[data-go="${g}"]`);
    await say('coach', `${MGR()}、ここはクラブハウスの練習グラウンドです。<br>全体練習は毎週、自動で行われます。`);
    await say('coach', '「選手データ」では、選手の能力やタイプ、調子が見られます。', { spot: () => b('data') });
    await say('coach', '「スタメン」では、先発メンバーとポジションを決めます。<br>選手をドラッグして入れ替えられます。', { spot: () => b('lineup') });
    await say('coach', '「戦術」では、攻め方・守り方の指示を出せます。', { spot: () => b('tactic') });
    await say('coach', 'それでは「特訓」を見てみましょう。', { spot: () => b('train'), tap: true });
    setStep('train');
  }
  async function train() {
    await sleep(600);
    await say('coach', '特訓では、選手を1人選んで、カードを3枚までセットします。', { spot: '.trb-line', boxTop: false });
    await say('coach', '下に並んでいるのが、持っている特訓カードです。<br>試合で見つかった課題のカードも、ここに入ります。', { spot: '.trb-hand', boxTop: true });
    await say('coach', 'カードの組み合わせで、伸びる能力が変わります。<br>うまく組み合わせると「スペシャルメニュー」で技を覚えることも！', { spot: '.tslots2', boxTop: true });
    await say('coach', 'セットしたら「特訓する！」。特訓は、1人につき1週間に1回です。<br>カードを選んで、さっそく誰かを特訓してみてください。', { boxTop: true });
    await say('coach', '終わったら、右上の戻るボタンを押していくと、ホームタウンへ戻れます。', { spot: '#cvBack', round: true, boxTop: true });
    hide(); setStep('assoc');
  }
  // 8. サッカー協会・週送り・ドットガイド
  async function assoc() {
    await say('sec', 'お疲れさまです！<br>最後に「サッカー協会」をご案内しますね。', { spot: () => K().townRect('assoc'), tap: () => { setStep('assocIn'); K().openAssoc({ tab: 'sched' }); } });
    await sleep(700);
    await say('sec', '「サッカー協会」では、リーグ戦の日程や順位、カップ戦の組み合わせが見られます。', { spot: '#assocScreen .std-tabs', boxTop: false });
    await say('sec', '得点・アシストのランキング、監督成績もわかりますよ。', { spot: '#assocScreen .std-tabs', boxTop: false });
    hide();
    await say('sec', '見終わったら、右上の戻るボタンで戻ってくださいね。', { spot: '#assocScreen .std-back', round: true, tap: true });
    setStep('week');
  }
  async function week() {
    await say('sec', '左上の日付の「▶」をタップすると、次の週に進みます。', { spot: '.hm-date', boxTop: false });
    await say('sec', 'ここには、次の試合とその日付が出ます。<br>週が進むと、公式戦が近付いてきますよ！', { spot: '#hmNextMatch', boxTop: false });
    await say('sec', '画面の下では、「ドットガイド」が役に立つ情報を教えてくれます。', { spot: '.hm-ticker', boxTop: true });
    if (K().isMatchWeek()) { setStep('waitOfficial'); await officialWeek(); return; }
    await say('sec', '特訓が終わったら、日付の「▶」で週を進めて、公式戦に向かいましょう！');
    hide(); setStep('waitOfficial');
  }
  async function officialWeek() {
    await say('sec', '今週は公式戦です！<br>準備ができたら「スタジアム」をタップして、試合会場に向かいましょう。', { spot: () => K().townRect('stadium'), tap: () => { setStep('official'); K().stadium(); } });
    hide();
  }
  async function afterOfficial() {
    await say('coach', `${MGR()}、お疲れさまでした。<br>選手には、試合や特訓のたびに疲労がたまっていきます。`);
    await say('coach', '疲労がたまると、ケガをしやすくなります。<br>「選手データ」の疲労度の丸（青→黄→赤）で、疲れ具合に気をつけてください。');
    await say('sec', `これで、ひととおりのご案内は終わりです。<br>あとは${MGR()}の思うように、チームを育ててください！`);
    await say('sec', '説明をもう一度見たい時は、メニューの「チュートリアルを見る」からどうぞ。<br>一緒に頂点を目指しましょう！');
    hide(); setStep('done');
  }

  // ---------- きっかけ ----------
  async function onHomeIdle() {
    const s = step();
    if (s === 'town') await town();
    else if (s === 'afterPractice') await afterPractice();
    else if (s === 'club' && save.clubSet) { setStep('clubhouse'); await clubhouse(); }
    else if (s === 'clubhouse') await clubhouse();
    else if (s === 'train' || s === 'clubIn') { setStep('assoc'); await assoc(); }
    else if (s === 'assoc') await assoc();
    else if (s === 'assocIn' || s === 'week') { setStep('week'); await week(); }
    else if (s === 'waitOfficial' && K().isMatchWeek()) await officialWeek();
    else if (s === 'afterOfficial') await afterOfficial();
  }
  let homeWait = false;
  async function kickHome() {
    if (homeWait || busy || !active()) return; homeWait = true;
    const ok = await idleHome(); homeWait = false;
    if (ok && active()) run(onHomeIdle);
  }
  let titled = false;
  const T = {
    // 育成モードを開いた時：はじめての人ならチュートリアルを始める（true＝こちらで面倒を見る）
    boot(sv) {
      save = sv; if (LAB) return false;
      if (!save.tut) save.tut = { s: (!save.clubSet && (save.week || 1) <= 1 && save.season === 1 && !(save.history || []).length) ? 'start' : 'done' };
      if (step() === 'start') { titled = true; run(opening); return true; }
      if (!titled) { titled = true;   // 版691：アプリを開くたびにタイトル画面（版707：お支払いからもどった時は出さない）
        const paid = /[?&]paid=1/.test(location.search) || (save.payPending && Date.now() - (save.payPending.at || 0) < 30 * 60 * 1000);
        if (paid) { try { history.replaceState(null, '', location.pathname + location.search.replace(/[?&]paid=1/, '').replace(/^&/, '?') + location.hash); } catch (_) {} }
        else title(); }
      if (active()) kickHome();
      return active();
    },
    onView(v) {
      if (!save || !active()) return;
      if (v === 'home') kickHome();
      if (v === 'club' && step() === 'clubIn') runQ(clubIn);
      if (v === 'train' && step() === 'train') runQ(train);
    },
    onLive(el, meta) { if (save && active()) runQ(() => live(el, meta)); },
    onVs(el, meta) { if (save && active()) runQ(() => vs(el, meta)); },
    matchOpts(meta) { const o = matchOpts(meta); if (!o) return null; const wrap = {}; for (const k of Object.keys(o)) wrap[k] = (...a) => { if (k === 'tick') { if (!busy) run(() => o[k](...a)); return; } runQ(() => o[k](...a)); }; return wrap; },
    // メニューから：今のデータのまま、案内だけもう一度（練習試合と名前入れはとばす）
    replay() { save = K().save; if (!save) return; save.tut = { s: 'clubhouse' }; store(); K().go('home'); scene(false); run(async () => { await say('sec', 'では、もう一度ご案内しますね。'); await town0(); }); },
    get step() { return step(); },
  };
  async function town0() {
    await say('sec', 'ホームタウンの建物を選ぶと、監督としていろいろなお仕事ができます。');
    await say('sec', '「スタジアム」では、試合をします。公式戦のない週は、練習試合ができます。', { spot: () => K().townRect('stadium') });
    await say('sec', '「クラブ事務所」では、チーム編成やクラブの名前・ユニフォームを決めます。', { spot: () => K().townRect('lineup') });
    await say('sec', '「ショップ」では、コインで特訓カードを買えます。', { spot: () => K().townRect('shop') });
    await clubhouse();
  }
  window.__tut = T;
})();
