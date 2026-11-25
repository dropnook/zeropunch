// IndexedDB: kv (key, username, sync state), records (ciphertext), outbox (pending writes/deletes).
// The device holds only ciphertext and the non-extractable CryptoKey.

const NAME = 'zeropunch';
const VERSION = 1;

/** @type {Promise<IDBDatabase> | null} */
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('idb_blocked'));
    });
  }
  return dbp;
}

/**
 * @template T
 * @param {string} store @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest<T>} fn
 * @returns {Promise<T>}
 */
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** @param {string} store @param {IDBValidKey} key */
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
/** @param {string} store @param {any} value @param {IDBValidKey} [key] */
export const put = (store, value, key) => run(store, 'readwrite', (s) => s.put(value, key));
/** @param {string} store @param {IDBValidKey} key */
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
/** @param {string} store */
export const all = (store) => run(store, 'readonly', (s) => s.getAll());
/** @param {string} store */
export const count = (store) => run(store, 'readonly', (s) => s.count());

/**
 * Several puts/deletes in ONE transaction: all or nothing (e.g. a record and its outbox item).
 * @param {{ store: string, op: 'put'|'del', value?: any, key?: IDBValidKey }[]} ops
 */
export async function tx(ops) {
  const db = await open();
  const stores = [...new Set(ops.map((o) => o.store))];
  await new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    for (const o of ops) {
      const s = t.objectStore(o.store);
      if (o.op === 'put') s.put(o.value, o.key);
      else s.delete(/** @type {IDBValidKey} */ (o.key));
    }
    t.oncomplete = () => resolve(undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** kv shortcuts */
export const kvGet = (/** @type {string} */ k) => get('kv', k);
export const kvSet = (/** @type {string} */ k, /** @type {any} */ v) => put('kv', v, k);

/** Delete everything on this device (log out). */
export async function wipe() {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['kv', 'records', 'outbox'], 'readwrite');
    for (const n of ['kv', 'records', 'outbox']) tx.objectStore(n).clear();
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}
