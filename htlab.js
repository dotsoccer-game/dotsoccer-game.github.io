// ハーフタイムの確認：育成モードの公式戦を、前半の終わり（笛の少し前）から再生する
//  笛 → 暗転 → ロッカールーム（選手交代・戦術・状況・後半開始）→ 後半のキックオフ まで
(() => {
  const box = document.createElement('div'); box.id = 'htl';
  box.innerHTML = `<b>ハーフタイムの確認</b><span>前半の終わりから再生します（版 ${window.__appVer || '?'}）</span><button id="htlAgain">もう一度（前半の終わりから）</button>`;
  const css = document.createElement('style');
  css.textContent = `#htl{position:fixed;left:50%;transform:translateX(-50%);bottom:6px;z-index:12;background:rgba(10,24,16,.9);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:8px;padding:6px 10px;font:12px/1.5 system-ui,sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 16px)}#htl b{color:#ffe05a}#htl button{font:12px system-ui;padding:4px 8px;box-shadow:none;border-radius:6px}`;
  document.head.appendChild(css);
  function start() {
    try { window.__career.open(); const cs = document.getElementById('clubScreen'); if (cs) cs.hidden = true; } catch (e) { }
    setTimeout(() => {
      if (!window.__career.labMatch()) { box.querySelector('span').textContent = '公式戦が見つかりませんでした'; return; }
      setTimeout(() => { const D = window.__demo, m = D.match; D.stop(); D.seek(Math.max(1, (m.halfTime || 225) - 14)); D.setSpeed(1); D.play(); document.body.appendChild(box); }, 700);
    }, 1400);
  }
  box.querySelector('#htlAgain').onclick = () => location.reload();
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
