// Minimal IndexedDB wrapper (no external library). v2 adds "activities".
const NAME = 'fitplan', VER = 2;
const STORES = { meta: 'key', plans: 'plan_version', sessions: 'id', races: 'id', logs: 'id', activities: 'id' };
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => {
      for (const [s, k] of Object.entries(STORES))
        if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: k });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function all(store) { const db = await open(); return req(db.transaction(store).objectStore(store).getAll()); }
export async function get(store, key) { const db = await open(); return req(db.transaction(store).objectStore(store).get(key)); }
export async function put(store, val) { const db = await open(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val); return done(tx); }
export async function getMeta(key, dflt) { const r = await get('meta', key); return r ? r.value : dflt; }
export const setMeta = (key, value) => put('meta', { key, value });

// Atomic multi-store write: ops = [{store, put?:obj, del?:key, clear?:true}]
export async function batch(ops) {
  if (!ops.length) return;
  const db = await open();
  const stores = [...new Set(ops.map(o => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const s = tx.objectStore(o.store);
    if (o.clear) s.clear(); else if (o.del !== undefined) s.delete(o.del); else s.put(o.put);
  }
  return done(tx);
}
export async function dump() {
  const out = {};
  for (const s of Object.keys(STORES)) out[s] = await all(s);
  return out;
}
export async function restore(data) {
  const ops = [];
  for (const s of Object.keys(STORES)) {
    ops.push({ store: s, clear: true });
    for (const v of data[s] || []) ops.push({ store: s, put: v });
  }
  return batch(ops);
}
export async function wipe() { return batch(Object.keys(STORES).map(s => ({ store: s, clear: true }))); }
