// 版613：オンライン（Firebase）：フレンド登録・ランクマッチの相手さがし
// FIREBASE_CONFIG が空のあいだは、オンラインの機能は使えない（フレンドのリンク対戦とCPUのランクマッチだけ）
(() => {
  'use strict';
  const FIREBASE_CONFIG = {   // 版614：dot-soccer プロジェクト（公開してよい設定。守りは Firestore のルール）
    apiKey: 'AIzaSyDP3mmjrdqi9LklMzGVEvVHFKDtFAKlu9M', authDomain: 'dot-soccer.firebaseapp.com', projectId: 'dot-soccer',
    storageBucket: 'dot-soccer.firebasestorage.app', messagingSenderId: '947181345833', appId: '1:947181345833:web:a50275f6c6a187e17fd038' };
  const SDK = 'https://cdn.jsdelivr.net/npm/firebase@10.12.2/';
  let db = null, uid = null, readyP = null, lastErr = '';
  const load = (src) => new Promise((ok, ng) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ng(new Error('load ' + src)); document.head.appendChild(s); });
  function ready() {
    if (!FIREBASE_CONFIG) return Promise.resolve(false);
    if (readyP) return readyP;
    readyP = (async () => {
      try {
        await load(SDK + 'firebase-app-compat.js');
        await Promise.all([load(SDK + 'firebase-auth-compat.js'), load(SDK + 'firebase-firestore-compat.js')]);
        const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
        const auth = app.auth();
        if (!auth.currentUser) await auth.signInAnonymously();
        uid = auth.currentUser.uid; db = app.firestore();
        try { db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (_) {}   // 版625：iPhone（ホーム画面のアプリ）でも見張りがつながるように
        return true;
      } catch (e) { lastErr = String(e && e.message || e); readyP = null; return false; }
    })();
    return readyP;
  }
  const withTimeout = (p, ms = 8000) => Promise.race([p, new Promise((_, ng) => setTimeout(() => ng(new Error('timeout')), ms))]);
  // フレンドID（8けたの数字）：はじめての時に作る。ほかの人と重ならないように fids/{id} を取る
  // 版682：開発用アカウントのIDを、決めた番号に付けかえる（持ち主の端末でだけ動く）
  const FID_MOVE = { '84539075': '11111111' };
  async function ensureFid(want) {
    // 版1267：引き継いだ時にフレンドIDを受け取れず、新しいIDが作られていた人を、元のID（引き継ぎで受け取ったID＝sv付き）へ戻す
    try { const q = await db.collection('fids').where('uid', '==', uid).limit(5).get(); const mine = q.docs.map((d) => ({ id: d.id, sv: d.data().sv || null }));
      const cur = mine.find((m) => m.id === want), withSv = mine.find((m) => m.sv && m.id !== want && !FID_MOVE[m.id]);
      if (withSv && (!want || !cur || !cur.sv) && !Object.values(FID_MOVE).includes(want)) return withSv.id;
      if (!want && mine.length) return mine[0].id; } catch (_) {}
    if (want) { const d = await db.collection('fids').doc(want).get(); if (d.exists && d.data().uid === uid) {
      const to = FID_MOVE[want];
      if (to) { try { const sv = d.data().sv || null; await db.runTransaction(async (tx) => { const ref = db.collection('fids').doc(to); const e = await tx.get(ref); if (e.exists && e.data().uid !== uid) throw new Error('used'); tx.set(ref, sv ? { uid, sv } : { uid }); }); return to; } catch (_) {} }
      return want; } }
    for (let k = 0; k < 8; k++) {
      const id = String(10000000 + Math.floor(Math.random() * 90000000));
      try { await db.runTransaction(async (tx) => { const ref = db.collection('fids').doc(id); const d = await tx.get(ref); if (d.exists) throw new Error('used'); tx.set(ref, { uid }); }); return id; } catch (_) {}
    }
    throw new Error('fid');
  }
  // 自分のクラブを公開する（名前・エンブレム・ランク・チームのコード）
  async function publish(me) {
    if (!(await ready())) return null;
    lastErr = '';   // 版684：前のエラーが残らないように
    return withTimeout((async () => {
      let fid; try { fid = await ensureFid(me.fid); } catch (e) { lastErr = 'fid: ' + (e && e.message || e); throw e; }
      // 版1216：チームのデータ（重い）は teams/{uid} へ分けて置く。players は軽い情報だけ（ランキング・フレンド一覧・相手さがしで、チームのデータまで読まないように）
      //  teams へ書けない時（データベースの決まりがまだ古い時）は、今までどおり players にチームのデータも入れる
      let split = false; try { await db.collection('teams').doc(uid).set({ code: me.code, at: Date.now() }); split = true; } catch (_) {}
      const doc = { fid, name: me.name, short: me.short, mgr: me.mgr || '', lg: me.lg || '', emb: me.emb || null, kit: me.kit || null, rank: me.rank, rp: me.rp, lvl: Math.round(me.lvl || 0), sv: me.sv || null, prem: !!me.prem, at: Date.now(), seen: Date.now() };
      if (split) { doc.code = firebase.firestore.FieldValue.delete(); doc.tc = true; } else doc.code = me.code;
      await db.collection('players').doc(uid).set(doc, { merge: true });   // 版1119：上書きで最後の時刻（seen）が消えていた → 足し込みにして、今の時刻も書く
      return fid;
    })()).catch((e) => { lastErr = lastErr || String(e && e.message || e); throw e; });
  }
  async function byFid(fid) {
    if (!(await ready())) return null;
    return withTimeout((async () => {
      const f = await db.collection('fids').doc(String(fid).replace(/\D/g, '')).get(); if (!f.exists) return null;
      const p = await db.collection('players').doc(f.data().uid).get(); return p.exists ? { uid: f.data().uid, ...p.data() } : null;
    })());
  }
  async function codeOf(p) { if (!p || p.code) return p; try { const t = await db.collection('teams').doc(p.uid).get(); if (t.exists && t.data().code) p.code = t.data().code; } catch (_) {} return p; }   // 版1216：チームのデータは teams から（古い人は players に入っている）
  async function byUid(u) { if (!(await ready())) return null; return withTimeout(db.collection('players').doc(u).get().then((p) => (p.exists ? codeOf({ uid: u, ...p.data() }) : null))); }
  // 版1216：何人かの公開情報を、まとめて読む（1人ずつ読まない）。uid → 情報
  async function playersOf(uids) { if (!(await ready())) return {}; const out = {}, list = [...new Set((uids || []).filter(Boolean))], FP = firebase.firestore.FieldPath.documentId();
    for (let i = 0; i < list.length; i += 10) { try { const q = await withTimeout(db.collection('players').where(FP, 'in', list.slice(i, i + 10)).get()); q.docs.forEach((d) => { out[d.id] = { uid: d.id, ...d.data() }; }); } catch (_) {} }
    return out; }
  // ランクマッチの相手：同じランクの人（いなければ近いランク）から1人
  async function rankRival(rank, avoid, ranks) {   // 版1213：同じ級（いなければ1つ上・下まで）の、最近（2週間以内）遊んだ監督。直前に当たった相手には続けて当たらない。いなければ null（CPUのクラブになる）
    if (!(await ready())) return null;
    return withTimeout((async () => {
      const recent = Date.now() - 14 * 24 * 3600 * 1000;
      for (const r of ranks || [rank, rank - 1, rank + 1]) {
        if (r < 0 || r > 4) continue;
        const q = await db.collection('players').where('rank', '==', r).limit(40).get();
        const list = q.docs.filter((d) => d.id !== uid && d.id !== avoid && (d.data().at || 0) > recent).map((d) => ({ uid: d.id, ...d.data() }));
        if (list.length) return codeOf(list[Math.floor(Math.random() * list.length)]);
      }
      return null;
    })());
  }
  // 版616：守備の記録（挑んだ側が相手の受け箱に入れる。読むのと消すのは本人だけ）
  async function report(to, b) {
    if (!(await ready())) return;
    return withTimeout(db.collection('battles').add({ to, from: uid, res: b.res, s: b.s, name: String(b.name || '').slice(0, 20), mgr: String(b.mgr || '').slice(0, 12), at: Date.now() }));
  }
  async function inbox() {
    if (!(await ready())) return [];
    return withTimeout(db.collection('battles').where('to', '==', uid).limit(50).get().then((q) => q.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }
  async function clearInbox(ids) { if (!(await ready())) return; await Promise.all(ids.map((id) => db.collection('battles').doc(id).delete().catch(() => {}))); }
  async function top(n) {   // 版1020：RPが0の監督（まだランクマッチをしていない・開いただけの端末）はランキングに出さない
    if (!(await ready())) return [];
    const mp = (q) => q.docs.map((d) => ({ uid: d.id, name: d.data().name, mgr: d.data().mgr, emb: d.data().emb, rank: d.data().rank, rp: d.data().rp, prem: !!d.data().prem }));
    try { return await withTimeout(db.collection('players').where('rp', '>', 0).orderBy('rp', 'desc').limit(n || 50).get().then(mp)); }
    catch (_) { return withTimeout(db.collection('players').orderBy('rp', 'desc').limit((n || 50) + 50).get().then((q) => mp(q).filter((p) => (p.rp || 0) > 0).slice(0, n || 50))); }   // 念のため：絞り込みが使えない時は、読んでから外す
  }

  // 版618：ポスト（フレンド申請・承認・お知らせ）
  async function sendMail(to, m) {
    if (!(await ready())) return;
    return withTimeout(db.collection('mail').add({ ...m, to, from: uid, at: Date.now() }));
  }
  async function mailbox() {
    if (!(await ready())) return [];
    return withTimeout(db.collection('mail').where('to', '==', uid).limit(50).get().then((q) => q.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }
  async function delMail(ids) { if (!(await ready())) return; await Promise.all(ids.map((id) => db.collection('mail').doc(id).delete().catch(() => {}))); }
  async function news() {
    if (!(await ready())) return [];
    return withTimeout(db.collection('news').orderBy('at', 'desc').limit(20).get().then((q) => q.docs.map((d) => ({ id: d.id, ...d.data() })))).catch(() => []);
  }
  // 版622：フレンドのルーム（2人が「対戦する」を押したら、2つの画面で同じ試合が始まる）
  async function createRoom(guest, r) {
    if (!(await ready())) return null;
    return withTimeout(db.collection('rooms').add({ ...r, host: uid, guest, state: 'open', hostIn: true, guestIn: false, hostReady: false, guestReady: false, at: Date.now() }).then((d) => d.id));
  }
  async function roomUpdate(id, patch) { if (!(await ready())) return; return withTimeout(db.collection('rooms').doc(id).update(patch)); }
  async function roomGet(id) { if (!(await ready())) return null; return withTimeout(db.collection('rooms').doc(id).get().then((d) => (d.exists ? { id: d.id, ...d.data() } : null))); }
  function roomWatch(id, cb) { if (!db) return () => {}; return db.collection('rooms').doc(id).onSnapshot((d) => cb(d.exists ? { id: d.id, ...d.data() } : null), () => cb(null)); }
  async function roomInvites() {
    if (!(await ready())) return [];
    const t = Date.now() - 30 * 60 * 1000;
    return withTimeout(db.collection('rooms').where('guest', '==', uid).where('state', '==', 'open').limit(10).get().then((q) => q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => (r.at || 0) > t)));
  }
  async function roomStart(id) {   // ふたりとも準備ができたら、ホストが種と開始時刻を決める（取り合いにならないように取引で）
    if (!(await ready())) return;
    const ref = db.collection('rooms').doc(id);
    return db.runTransaction(async (tx) => { const d = await tx.get(ref); const r = d.data(); if (!r || r.state !== 'open' || !r.hostReady || !r.guestReady) return; tx.update(ref, { state: 'go', seed: 1 + Math.floor(Math.random() * 999999), startAt: Date.now() + 4000 }); });
  }
  // 版624：自分あての mail・battles が増えたら、すぐ知らせる（onSnapshot）
  let watchState = '未接続';
  function watchMail(cb) {
    if (!db) return () => {};
    const err = (e) => { watchState = 'エラー: ' + (e && (e.code || e.message) || e); };
    const u1 = db.collection('mail').where('to', '==', uid).onSnapshot((q) => { watchState = 'ON'; cb(q.size); }, err);
    const u2 = db.collection('battles').where('to', '==', uid).onSnapshot((q) => cb(q.size), err);
    return () => { u1(); u2(); };
  }
  // 版672：データ引き継ぎ（クラウドに保存・クラウドから復元）。引き継ぎコード（12文字）で、ほかの端末からも読める
  //  saves/{コード} = { d: セーブ（gzip＋base64、使えない端末はそのままのJSON）, z: 圧縮したか, info: 表示用, at: 保存日時, cur: 最後に使った端末, fid: フレンドID }
  const CC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => { let c = ''; const a = new Uint32Array(12); (crypto || window.crypto).getRandomValues(a); for (const v of a) c += CC[v % CC.length]; return c; };
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1');
  async function packSave(obj) {
    const json = JSON.stringify(obj);
    try { if (typeof CompressionStream === 'function') { const buf = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return { d: btoa(bin), z: true }; } } catch (_) {}
    return { d: json, z: false };
  }
  async function unpackSave(d, z) {
    if (!z) return JSON.parse(d);
    const bin = atob(d), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return JSON.parse(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  async function cloudInfo(code) {
    if (!(await ready())) throw new Error('offline');
    const c = normCode(code); if (c.length !== 12) return null;
    return withTimeout(db.collection('saves').doc(c).get().then((d) => (d.exists ? { code: c, info: d.data().info || null, at: d.data().at || 0 } : null)));
  }
  async function cloudPut(code, saveObj, info, fid) {
    if (!(await ready())) throw new Error('offline');
    return withTimeout((async () => {
      let c = normCode(code);
      if (c.length !== 12) { for (let k = 0; k < 6; k++) { const t = newCode(); const d = await db.collection('saves').doc(t).get(); if (!d.exists) { c = t; break; } } }
      const pk = await packSave(saveObj);
      if (pk.d.length > 880000) throw new Error('too big');
      await db.collection('saves').doc(c).set({ d: pk.d, z: pk.z, info: info || null, at: Date.now(), cur: uid, fid: fid || null, v: 1 });
      if (fid) { try { await db.collection('fids').doc(String(fid)).set({ uid, sv: c }); } catch (_) {} }   // フレンドIDに引き継ぎコードを結ぶ（新しい端末でも同じIDを使えるように）
      return c;
    })(), 20000);
  }
  async function cloudGet(code) {
    if (!(await ready())) throw new Error('offline');
    const c = normCode(code); if (c.length !== 12) return null;
    return withTimeout((async () => { const d = await db.collection('saves').doc(c).get(); if (!d.exists) return null; const v = d.data(); return { code: c, info: v.info || null, at: v.at || 0, fid: v.fid || null, save: await unpackSave(v.d, v.z) }; })(), 20000);
  }
  // 版1250：（開発用）作り直したセーブを、そのフレンドIDの引き継ぎコードとして保存する（フレンドIDの持ち主はまだ変えない。相手が復元した時に、相手へ移る）
  async function cloudPutFor(saveObj, info, fid) {
    if (!(await ready())) throw new Error('offline');
    return withTimeout((async () => {
      let c = ''; for (let k = 0; k < 6; k++) { const t = newCode(); const d = await db.collection('saves').doc(t).get(); if (!d.exists) { c = t; break; } }
      if (!c) throw new Error('code');
      const pk = await packSave(saveObj); if (pk.d.length > 880000) throw new Error('too big');
      await db.collection('saves').doc(c).set({ d: pk.d, z: pk.z, info: info || null, at: Date.now(), cur: uid, fid: fid ? String(fid) : null, v: 1 });
      return c;
    })(), 20000);
  }
  // 版1249：（開発用）フレンドIDから、そのアカウントの引き継ぎコード（クラウド保存）を調べる。端末から消えたアカウントの復元の手伝い
  async function fidLookup(fid) {
    if (!(await ready())) throw new Error('offline');
    return withTimeout((async () => {
      const f = await db.collection('fids').doc(String(fid)).get(); const fd = f.exists ? f.data() : null;
      let pl = null; if (fd && fd.uid) { try { const d = await db.collection('players').doc(fd.uid).get(); if (d.exists) { const v = d.data(); pl = { name: v.name || '', sv: v.sv || null, seen: v.seen || 0, lg: v.lg || '' }; } } catch (_) {} }
      const code = (fd && fd.sv) || (pl && pl.sv) || null; let info = null;
      if (code) { try { const d = await db.collection('saves').doc(code).get(); if (d.exists) info = { info: d.data().info || null, at: d.data().at || 0 }; } catch (_) {} }
      return { found: !!fd, uid: fd ? fd.uid : null, code, name: pl ? pl.name : '', seen: pl ? pl.seen : 0, save: info };
    })(), 20000);
  }
  // 復元したあと：この端末を「いま使っている端末」にして、フレンドIDをこの端末へ移し、前の端末のランキングの記録を消す
  async function cloudClaim(code, fid) {
    if (!(await ready())) return;
    const c = normCode(code);
    await withTimeout(db.collection('saves').doc(c).update({ cur: uid, at2: Date.now() }));
    if (!fid) return;
    try {
      const f = await db.collection('fids').doc(String(fid)).get(), old = f.exists ? f.data().uid : null;
      await db.collection('fids').doc(String(fid)).set({ uid, sv: c });
      if (old && old !== uid) await db.collection('players').doc(old).delete().catch(() => {});
    } catch (_) {}
  }
  // 版703：お金での購入（Stripe）。支払いの画面のURLをサーバーで作る・払い終わったものを受け取る
  const PAY_ON = true;   // 版704：本物の支払い（Stripe）を使う。false にすると、前のテスト版（お金のかからない購入）にもどる
  let fnP = null;
  const fns = () => fnP || (fnP = (async () => { if (!(await ready())) throw new Error('offline'); if (!firebase.functions) await load(SDK + 'firebase-functions-compat.js'); return firebase.app().functions('asia-northeast1'); })().catch((e) => { fnP = null; throw e; }));
  async function payCheckout(item) { const f = await fns(); const r = await withTimeout(f.httpsCallable('payCheckout')({ item, back: location.href }), 20000); return r.data; }
  async function payClaim() { const f = await fns(); const r = await withTimeout(f.httpsCallable('payClaim')({}), 20000); const a = (r.data && r.data.items) || []; a.sub = (r.data && r.data.sub) || null; return a; }   // 版712：a.sub＝月額パスの今の状態
  async function payPortal() { const f = await fns(); const r = await withTimeout(f.httpsCallable('payPortal')({ back: location.href }), 20000); return r.data; }
  // 版1118：オンライン状況。自分の公開データ（players）に、最後にアプリを開いていた時刻（seen）と、していること（st：'home'・'match'）を書く。players がまだない人は書かない
  async function ping(st) { if (!(await ready()) || !uid) return null; try { await withTimeout(db.collection('players').doc(uid).update({ seen: Date.now(), st: st || 'home' })); return true; } catch (_) { return false; } }   // 版1265：書けなかった（この端末の公開データがまだない＝引き継いだばかりなど）ことを返す
  async function seenOf(uids) { const ps = await playersOf(uids), out = {}; for (const u in ps) out[u] = { seen: Math.max(ps[u].seen || 0, 0), at: ps[u].at || 0, st: ps[u].st || '' }; return out; }   // 版1216：まとめて読む
  // 版1268：（開発用）フレンドIDの持ち主（今つながっている端末）を調べる
  async function fidDoc(fid) { if (!(await ready())) return null; try { const d = await withTimeout(db.collection('fids').doc(String(fid).replace(/\D/g, '')).get()); return d.exists ? d.data() : null; } catch (e) { return { err: String(e && e.message || e) }; } }
  // 版1270：（開発用）同じクラブ名の公開データをさがす（フレンドIDが変わってしまった人を見つける）
  async function byName(name) { if (!(await ready())) return []; try { const q = await withTimeout(db.collection('players').where('name', '==', String(name)).limit(10).get()); return q.docs.map((d) => ({ uid: d.id, ...d.data() })); } catch (e) { return [{ err: String(e && e.message || e) }]; } }
  window.DotNet = { byName, fidDoc, cloudPutFor, fidLookup, PAY_ON, ping, seenOf, payCheckout, payClaim, payPortal, FID_MOVE, cloudInfo, cloudPut, cloudGet, cloudClaim, normCode, get watchState() { return watchState; }, get on() { return !!FIREBASE_CONFIG; }, get uid() { return uid; }, get err() { return lastErr; }, ready, publish, byFid, byUid, playersOf, rankRival, report, inbox, clearInbox, top, sendMail, mailbox, delMail, news, createRoom, roomUpdate, roomGet, roomWatch, roomInvites, roomStart, watchMail };
})();
