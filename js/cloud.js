/**
 * Sincronización con Supabase. El teléfono siempre guarda primero (funciona
 * sin señal); esto sube lo pendiente y baja lo de otros dispositivos cuando
 * hay conexión: al abrir, después de cada cambio, al volver la señal, al
 * volver a la app y cada minuto. En la nube nunca se borra nada: un
 * borrado viaja como `deleted = true`.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as storage from './storage.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
const PAGE = 1000;

let client = null;
let session = null;
let syncing = false;
let again = false;
let timer = null;
let listeners = { change: () => {}, status: () => {} };
let last = { state: 'off', lastSync: 0, error: '' };

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function emit(patch) {
  last = { ...last, ...patch, pending: storage.pending().length, email: session ? session.user.email : '' };
  listeners.status(last);
}

export function status() {
  return { ...last, pending: storage.pending().length, email: session ? session.user.email : '' };
}

export async function init({ onChange, onStatus }) {
  listeners = { change: onChange, status: onStatus };
  if (!configured) { emit({ state: 'off' }); return; }
  try {
    const { createClient } = await import(LIB);
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'libreta-gastos:sesion' }
    });
  } catch (e) {
    emit({ state: 'offline' });
    window.addEventListener('online', () => { if (!client) init(listeners); }, { once: true });
    return;
  }
  const { data } = await client.auth.getSession();
  session = data.session;
  client.auth.onAuthStateChange((_evt, s) => {
    const was = session;
    session = s;
    if (!was && s) syncNow();
    if (!s) emit({ state: 'signed-out' });
  });
  emit({ state: session ? 'idle' : 'signed-out' });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => emit({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => syncNow(), 60000);
  syncNow();
}

/** Pide sincronizar pronto (agrupa varios cambios seguidos). */
export function requestSync() {
  emit({});
  clearTimeout(timer);
  timer = setTimeout(syncNow, 800);
}

function toRow(x) {
  return { id: x.id, tipo: x.tipo, monto: x.monto, categoria: x.categoria, nota: x.nota, ts: x.ts, deleted: x.deleted, updated_at: x.updatedAt };
}

function fromRow(r) {
  return { id: r.id, tipo: r.tipo, monto: Number(r.monto), categoria: r.categoria, nota: r.nota, ts: Number(r.ts), deleted: r.deleted, updatedAt: Number(r.updated_at) };
}

export async function syncNow() {
  if (!client || !session) return;
  if (!navigator.onLine) { emit({ state: 'offline' }); return; }
  if (syncing) { again = true; return; }
  syncing = true;
  emit({ state: 'syncing' });
  try {
    const out = storage.pending();
    for (let i = 0; i < out.length; i += 500) {
      const chunk = out.slice(i, i + 500);
      const { error } = await client.from('movimientos').upsert(chunk.map(toRow), { onConflict: 'id' });
      if (error) throw error;
      await storage.markSynced(chunk);
    }
    let changed = false;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('movimientos')
        .select('id,tipo,monto,categoria,nota,ts,deleted,updated_at')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (await storage.mergeRemote(data.map(fromRow))) changed = true;
      if (data.length < PAGE) break;
    }
    if (changed) listeners.change();
    emit({ state: 'ok', lastSync: Date.now(), error: '' });
  } catch (e) {
    const offline = !navigator.onLine || /fetch|network/i.test(String(e && e.message));
    emit({ state: offline ? 'offline' : 'error', error: offline ? '' : String((e && e.message) || e) });
  } finally {
    syncing = false;
    if (again) { again = false; syncNow(); }
  }
}

export async function sendCode(email) {
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email, code) {
  const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw error;
}

export async function signOut() {
  await client.auth.signOut();
}
