/* 版816：スカウト演出の確認ページ。コインもセーブも使わずに、決めた☆で演出だけを何度でも見られる */
(function () {
  const KEY = 'dotsoccer.career.v1';
  try { if (!localStorage.getItem(KEY)) { const s = window.DotCareer.newCareer('テストFC'); s.clubSet = true; s.tutDone = true; window.DotCareer.ensureGacha(s).gift = 1; localStorage.setItem(KEY, JSON.stringify(s)); } } catch (e) {}
  let promo = null, fx = null, busy = false;
  const panel = document.createElement('div'); panel.id = 'gLab';
  panel.innerHTML = `<style>
#gLab{position:fixed;left:8px;top:8px;z-index:99999;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:12px;background:rgba(0,0,0,.6);font:800 13px/1 sans-serif;color:#fff;max-height:calc(100vh - 16px);overflow:auto}
#gLab b{font-size:12px;opacity:.85;margin-top:4px}
#gLab .r{display:flex;gap:5px;flex-wrap:wrap}
#gLab button{font:900 14px/1 sans-serif;padding:8px 10px;border-radius:8px;border:2px solid #fff6;background:#1f4fb8;color:#fff;box-shadow:none;min-width:44px}
#gLab button.on{background:#f0a400;border-color:#fff}
#gLab.hide .body{display:none}
</style><button class="tg">確認 ▲</button><div class="body">
<b>1回スカウト</b><div class="r">${[1, 2, 3, 4, 5].map((s) => `<button data-one="${s}">☆${s}</button>`).join('')}</div>
<b>10回スカウト</b><div class="r"><button data-ten="rand">ふつう</button><button data-ten="s4">☆4入り</button><button data-ten="s5">☆5入り</button></div>
<b>昇格（色が変わる）</b><div class="r"><button data-pr="auto" class="on">おまかせ</button><button data-pr="1">あり</button><button data-pr="0">なし</button></div>
<b>☆5の演出</b><div class="r"><button data-fx="auto" class="on">おまかせ</button><button data-fx="thunder">雷の音</button><button data-fx="black">全部黒</button><button data-fx="slip">ズレ</button><button data-fx="">なし</button></div></div>`;
  const pickStar = () => { const x = Math.random(); return x < 0.5 ? 1 : x < 0.8 ? 2 : 3; };
  const run = async (stars) => {
    if (busy || !window.__career || !window.__career.gachaDemo) return; busy = true; panel.classList.add('hide');
    try { const t = document.getElementById('ttTitle'); if (t) t.remove(); const app = document.getElementById('app'); if (app) app.style.zIndex = 9500; await window.__career.gachaDemo(stars, promo, fx); } catch (e) { console.warn(e); }
    { const app = document.getElementById('app'); if (app) app.style.zIndex = ''; }   // 版819：演出の間だけ、ゲーム画面を案内の黒い画面より上に
    busy = false; panel.classList.remove('hide');
  };
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
    if (b.classList.contains('tg')) { panel.classList.toggle('hide'); return; }
    if (b.dataset.pr) { promo = b.dataset.pr === 'auto' ? null : b.dataset.pr === '1'; panel.querySelectorAll('[data-pr]').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (b.dataset.fx != null) { fx = b.dataset.fx === 'auto' ? null : b.dataset.fx; panel.querySelectorAll('[data-fx]').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (b.dataset.one) { run([+b.dataset.one]); return; }
    if (b.dataset.ten) { const st = Array.from({ length: 10 }, pickStar); if (b.dataset.ten === 's4') st[3] = 4; if (b.dataset.ten === 's5') { st[3] = 4; st[7] = 5; } run(st); }
  });
  // 版819：保存（localStorage）が使えない所でも動くように、ゲームの画面は開かない（タイトルも消すだけ）。下は黒い画面に案内の文字
  const add = () => { document.body.appendChild(panel);
    const bg = document.createElement('div'); bg.id = 'gLabBg'; bg.innerHTML = '<p>左上の「確認」から、見たいスカウトを選んでください</p>';
    bg.style.cssText = 'position:fixed;inset:0;z-index:8000;background:#050a1a;display:flex;align-items:center;justify-content:center;color:#fff;font:800 20px/1.6 sans-serif;text-align:center;padding:20px'; document.body.appendChild(bg);
    const kill = () => { const t = document.getElementById('ttTitle'); if (t) t.remove(); }; kill(); setTimeout(kill, 500); setTimeout(kill, 1500); };
  if (document.readyState === 'complete') add(); else addEventListener('load', add);
})();
