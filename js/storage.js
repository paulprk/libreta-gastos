/**
 * Guardado local con doble copia: IndexedDB (principal) y localStorage
 * (espejo). Cada cambio se escribe en las dos al instante; al abrir, se
 * unen ambas por id, así si una se vacía o se corrompe se recupera de la
 * otra. Borrar no elimina: marca `deleted`, para que el borrado viaje a la
 * nube y nunca se pierda un dato por error. `synced` indica si la última
 * versión ya está en la nube.
 */
const DB_NAME = 'libreta-gastos';
const STORE = 'movimientos';
const MIRROR_KEY = 'libreta-gastos:espejo';
const BACKUP_KEY = 'libreta-gastos:ultimo-backup';

let dbPromise = null;

function openDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function readMirror() {
  try {
    const arr = JSON.parse(localStorage.getItem(MIRROR_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeMirror() {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify([...byId.values()]));
    return true;
  } catch (e) {
    return false;
  }
}

export function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const monto = Math.round(Number(x.monto) * 100) / 100;
  const ts = Number(x.ts);
  if (!(monto > 0) || !(ts > 0) || !x.id) return null;
  return {
    id: String(x.id).slice(0, 64),
    tipo: x.tipo === 'ingreso' ? 'ingreso' : 'gasto',
    monto,
    categoria: String(x.categoria || 'Varios').slice(0, 40),
    nota: String(x.nota || '').slice(0, 80),
    ts,
    deleted: Boolean(x.deleted),
    updatedAt: Number(x.updatedAt) > 0 ? Number(x.updatedAt) : ts,
    synced: Boolean(x.synced)
  };
}

function newId(ts) {
  const rnd = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 10);
  return `m${ts.toString(36)}${rnd}`;
}

const byId = new Map();
let persisted = false;

/** Escribe estos movimientos en las dos copias. Falla solo si no entró en ninguna. */
async function persist(list) {
  list.forEach((x) => byId.set(x.id, x));
  const db = await openDb();
  let okDb = false;
  if (db) {
    try { await tx(db, 'readwrite', (s) => { list.forEach((x) => s.put(x)); }); okDb = true; } catch (e) { okDb = false; }
  }
  const okMirror = writeMirror();
  if (!okDb && !okMirror) throw new Error('sin espacio');
}

/** Carga todo, uniendo IndexedDB y el espejo (gana la versión más nueva), y repara la copia que falte. */
export async function load() {
  const db = await openDb();
  let fromDb = [];
  if (db) {
    try { fromDb = (await tx(db, 'readonly', (s) => s.getAll())) || []; } catch (e) { fromDb = []; }
  }
  byId.clear();
  [...readMirror(), ...fromDb].forEach((x) => {
    const c = clean(x);
    if (!c) return;
    const prev = byId.get(c.id);
    if (!prev || c.updatedAt > prev.updatedAt || (c.updatedAt === prev.updatedAt && c.synced)) byId.set(c.id, c);
  });
  const dbIds = new Map(fromDb.map((d) => [d.id, d]));
  const fix = [...byId.values()].filter((x) => {
    const d = dbIds.get(x.id);
    return !d || d.updatedAt !== x.updatedAt || Boolean(d.synced) !== x.synced;
  });
  if (db && fix.length) {
    try { await tx(db, 'readwrite', (s) => { fix.forEach((x) => s.put(x)); }); } catch (e) { /* queda el espejo */ }
  }
  writeMirror();

  if (navigator.storage && navigator.storage.persist) {
    try { persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (e) { persisted = false; }
  }
  return all();
}

/** Movimientos visibles (sin los borrados), del más nuevo al más viejo. */
export function all() {
  return [...byId.values()].filter((x) => !x.deleted).sort((a, b) => b.ts - a.ts);
}

export function isPersisted() {
  return persisted;
}

export async function add({ tipo, monto, categoria, nota }) {
  const ts = Date.now();
  const item = clean({ id: newId(ts), tipo, monto, categoria, nota, ts, updatedAt: ts, synced: false });
  if (!item) throw new Error('datos inválidos');
  try {
    await persist([item]);
  } catch (e) {
    byId.delete(item.id);
    throw e;
  }
  return item;
}

async function change(id, patch) {
  const cur = byId.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: Math.max(Date.now(), cur.updatedAt + 1), synced: false };
  await persist([next]);
}

export function remove(id) {
  return change(id, { deleted: true });
}

/** Deshace un borrado (o vuelve a guardar algo quitado con Deshacer), conservando id y fecha. */
export function restore(item) {
  if (byId.has(item.id)) return change(item.id, { deleted: false });
  const c = clean({ ...item, deleted: false, updatedAt: Date.now(), synced: false });
  return c ? persist([c]) : Promise.resolve();
}

// --- Para la sincronización con la nube ---

/** Cambios que todavía no llegaron a la nube (incluye borrados). */
export function pending() {
  return [...byId.values()].filter((x) => !x.synced);
}

/** Marca como subidas estas versiones, salvo que hayan vuelto a cambiar mientras se subían. */
export async function markSynced(sent) {
  const done = [];
  sent.forEach((s) => {
    const cur = byId.get(s.id);
    if (cur && cur.updatedAt === s.updatedAt && !cur.synced) done.push({ ...cur, synced: true });
  });
  if (done.length) await persist(done);
}

/** Une lo que vino de la nube: gana la versión más nueva. Devuelve true si cambió algo visible. */
export async function mergeRemote(rows) {
  const upd = [];
  rows.forEach((r) => {
    const c = clean({ ...r, synced: true });
    if (!c) return;
    const cur = byId.get(c.id);
    if (!cur || c.updatedAt > cur.updatedAt) upd.push(c);
    else if (c.updatedAt === cur.updatedAt && !cur.synced) upd.push({ ...cur, synced: true });
  });
  if (upd.length) await persist(upd);
  return upd.length > 0;
}

// --- Copias de seguridad ---

export function exportJson() {
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (e) { /* ignorar */ }
  const movimientos = all().map(({ id, tipo, monto, categoria, nota, ts }) => ({ id, tipo, monto, categoria, nota, ts }));
  return JSON.stringify({ app: 'libreta-gastos', version: 1, exportado: new Date().toISOString(), movimientos }, null, 2);
}

export function lastBackup() {
  try { return Number(localStorage.getItem(BACKUP_KEY)) || 0; } catch (e) { return 0; }
}

/** Une una copia de seguridad con lo que ya hay (no borra nada). Devuelve cuántos agregó. */
export async function importJson(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data && Array.isArray(data.movimientos) ? data.movimientos : null;
  if (!list) throw new Error('formato');
  const now = Date.now();
  const nuevos = list
    .map((x) => clean({ ...x, deleted: false, synced: false, updatedAt: now }))
    .filter((x) => x && (!byId.has(x.id) || byId.get(x.id).deleted));
  if (!nuevos.length) return 0;
  await persist(nuevos);
  return nuevos.length;
}
