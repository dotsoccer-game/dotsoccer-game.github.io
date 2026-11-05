// 版1073：試合の計算を、画面とは別の働き手（Web Worker）で行う（計算の間も画面が止まらないように）
self.onmessage = (e) => {
  const d = e.data || {};
  try {
    if (!self.DotSoccer) importScripts(d.src);
    for (const k in (d.flags || {})) self[k] = d.flags[k];   // 画面側の設定（新しい動きなど）を同じにする
    const m = self.DotSoccer.simulateMatch(...d.args);
    self.postMessage({ id: d.id, m });
  } catch (err) { self.postMessage({ id: d.id, err: String(err && err.stack || err) }); }
};
