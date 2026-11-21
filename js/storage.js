/**
 * storage.js
 * Local-first persistence. IndexedDB is the primary store; localStorage is the
 * fallback. Every call is wrapped so a blocked or full store never crashes the app.
 */

const DB_NAME = 'room-studio';
const STORE = 'kv';
const LS_PREFIX = 'room-studio:';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      if (!('indexedDB' in window) || !window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB error'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    } catch (e) { reject(e); }
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

function lsGet(key) {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); return true; }
  catch (e) { return false; }
}

/** Where the last save landed: 'idb', 'local' or 'none'. */
export const storageInfo = { mode: 'idb' };

/** Read a value. Falls back to localStorage. Never throws. */
export async function getItem(key) {
  try {
    const v = await idbGet(key);
    if (v !== undefined && v !== null) return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { /* fall back */ }
  return lsGet(key);
}

/** Write a value. Returns 'idb', 'local' or 'none'. Never throws. */
export async function setItem(key, value) {
  try {
    await idbSet(key, JSON.stringify(value));
    storageInfo.mode = 'idb';
    return 'idb';
  } catch (e) { /* fall back */ }
  const ok = lsSet(key, value);
  storageInfo.mode = ok ? 'local' : 'none';
  return storageInfo.mode;
}

let saveTimer = null;
let pendingGetter = null;

/** Debounced autosave of the project. */
export function scheduleSave(getProject, onResult, delay = 500) {
  pendingGetter = { getProject, onResult };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, delay);
}

/** Save immediately if a save is pending. */
export async function flushSave() {
  clearTimeout(saveTimer);
  if (!pendingGetter) return;
  const { getProject, onResult } = pendingGetter;
  pendingGetter = null;
  const result = await setItem('project', getProject());
  if (onResult) onResult(result);
}

export const loadProject = () => getItem('project');
export const saveBackup = p => setItem('backup', { savedAt: Date.now(), project: p });
export const loadBackup = () => getItem('backup');
