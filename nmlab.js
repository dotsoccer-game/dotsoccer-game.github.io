// 版882：動きの比べ：同じ試合番号を「今の動き」と「新しい動き」で切り替えて見る（オールS同士）
(() => {
  const D = window.__demo; if (!D) return;
  window.__noShow = true;
  let seed = 1, mode = 1, sp = 1, paused = false, lv = 's';
  function load(keepT) {
    const t = keepT ? D.time() : 30;
    globalThis.__newMove = mode === 1;
    document.querySelector('#level').value = lv; const op = document.querySelector('#opponent'); if (op) op.value = 'バランス型';
    document.getElementById('seed').value = String(seed);
    D.start(); D.stop(); window.__noShow = true;
    D.seek(Math.max(0.2, t)); D.setSpeed(paused ? 0.0001 : sp); D.play(); info();
  }
  const css = document.createElement('style');
  css.textContent = `#clubScreen,.std-wrap{display:none!important}#nm{position:fixed;left:8px;top:58px;z-index:50;background:rgba(10,24,16,.92);color:#e8f2ea;border:1px solid #3d6b4a;border-radius:10px;font:11px/1.35 system-ui,sans-serif;max-width:min(420px,calc(100vw - 110px));padding:5px 7px;box-sizing:border-box}
  #nm b{color:#ffe05a}#nm button{font:11px system-ui,sans-serif;background:#23392b;color:#e8f2ea;border:1px solid #4d7a5a;border-radius:6px;padding:3px 6px;margin:1px}#nm button.on{background:#3d7a4f;border-color:#9fe0b0}
  #nm .row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 5px}#nm .msg{color:#bcd3c2;font-size:10px;margin-top:1px}#nm.mini>:not(:first-child){display:none}#nm .big{font-size:12px;padding:4px 9px}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'nm';
  box.innerHTML = `<div class="row"><b id="nmT" style="cursor:pointer">動きの比べ ▾</b><button class="big" data-m="0">今の動き</button><button class="big on" data-m="1">新しい動き</button></div>
    <div class="row">試合 <button id="nmP">◀</button><span id="nmS">1</span><button id="nmN">▶</button>
      <button data-l="s" class="on">オールS</button><button data-l="low">育成序盤</button></div>
    <div class="row">時間 <button data-t="30">はじめ</button><button data-t="120">前半なかば</button><button data-t="300">後半</button><button data-t="400">終盤</button></div>
    <div class="row"><button data-s="1" class="on">1倍</button><button data-s="0.5">1/2</button><button data-s="4">4倍</button><button id="nmStop">停止</button><button data-z="near">近い</button><button data-z="normal">ふつう</button><button data-z="far">遠い</button></div>
    <div class="msg" id="nmM"></div>`;
  document.body.appendChild(box);
  function info() {
    document.getElementById('nmS').textContent = seed;
    box.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', +b.dataset.m === mode));
    box.querySelectorAll('[data-l]').forEach((b) => b.classList.toggle('on', b.dataset.l === lv));
    document.getElementById('nmM').textContent = `${mode ? '新しい動き' : '今の動き'}で再生中。切り替えると、同じ試合番号・同じ時間から見られます（途中から試合の流れは別になります）（版 ${window.__appVer || '?'}）`;
  }
  box.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = +b.dataset.m; load(true); });
  box.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { lv = b.dataset.l; load(true); });
  box.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { D.seek(+b.dataset.t); D.setSpeed(paused ? 0.0001 : sp); D.play(); });
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sp = +b.dataset.s; box.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); paused = false; document.getElementById('nmStop').textContent = '停止'; D.setSpeed(sp); D.play(); });
  box.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => { const z = document.querySelector(`[data-zoom="${b.dataset.z}"]`); if (z) z.click(); });
  document.getElementById('nmStop').onclick = () => { paused = !paused; document.getElementById('nmStop').textContent = paused ? '再生' : '停止'; D.setSpeed(paused ? 0.0001 : sp); if (!paused) D.play(); };
  document.getElementById('nmP').onclick = () => { seed = Math.max(1, seed - 1); load(false); };
  document.getElementById('nmN').onclick = () => { seed++; load(false); };
  document.getElementById('nmT').onclick = () => { box.classList.toggle('mini'); document.getElementById('nmT').textContent = '動きの比べ ' + (box.classList.contains('mini') ? '▸' : '▾'); };
  setTimeout(() => load(false), 300);
})();
