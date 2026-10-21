// 試合終了の確認：育成モードの公式戦を、試合の終わり（笛の少し前）から再生する
//  笛 → 暗転 → ダイジェスト → 試合結果 → ロッカールームの会話 → 順位表／トーナメント表 → 秘書（支持率）→ ホーム
(() => {
  const box = document.createElement('div'); box.id = 'enl';
  box.innerHTML = `<b>試合終了の確認</b><span>試合の終わりから再生します（版 ${window.__appVer || '?'}）</span><button id="enlAgain">もう一度（試合の終わりから）</button>`;
  const css = document.createElement('style');
  css.textContent = `#enl{position:fixed;left:50%;transform:translateX(-50%);top:6px;z-index:12;background:rgba(10,24,16,.9);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:8px;padding:6px 10px;font:12px/1.5 system-ui,sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 16px)}#enl b{color:#ffe05a}#enl button{font:12px system-ui;padding:4px 8px;box-shadow:none;border-radius:6px}`;
  document.head.appendChild(css);
  function start() {
    try { window.__career.open(); const cs = document.getElementById('clubScreen'); if (cs) cs.hidden = true; } catch (e) { }
    setTimeout(() => {
      if (!window.__career.labMatch(true)) { box.querySelector('span').textContent = '公式戦が見つかりませんでした'; return; }
      setTimeout(() => { const D = window.__demo, m = D.match; D.stop(); D.seek(Math.max(1, Math.min(m.duration - 16, m.halfTime + (m.nominalHalf || 225) - 6))); D.setSpeed(1); D.play(); document.body.appendChild(box); }, 700);
    }, 1400);
  }
  box.querySelector('#enlAgain').onclick = () => location.reload();
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
