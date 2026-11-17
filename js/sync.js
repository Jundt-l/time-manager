// Связь с сервером Supabase: вход, пара, синхронизация, подписка на уведомления, напоминания.
// Библиотека Supabase грузится только когда нужна, поэтому без интернета приложение работает как раньше.
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
let sb = null;

export const enabled = () => !!(SUPABASE_URL && SUPABASE_ANON);

async function client() {
  if (sb) return sb;
  const { createClient } = await import(LIB);
  sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true } });
  return sb;
}
const check = ({ data, error }) => { if (error) throw error; return data; };

/** Текущий пользователь или null. */
export async function currentUser() {
  if (!enabled()) return null;
  const c = await client();
  const { data } = await c.auth.getSession();
  return data.session ? data.session.user : null;
}

export async function signUp(name, email, password) {
  const c = await client();
  const data = check(await c.auth.signUp({ email, password }));
  if (!data.session) throw new Error('confirm');
  await c.rpc('set_my_name', { n: name || email.split('@')[0] });
  return data.user;
}
export async function signIn(email, password) {
  const c = await client();
  return check(await c.auth.signInWithPassword({ email, password })).user;
}
export async function signOut() {
  const c = await client();
  await c.auth.signOut();
}

/** Я, партнёр и код приглашения. */
export async function loadPair(uid) {
  const c = await client();
  const rows = check(await c.from('profiles').select('id, name, couple_id')) || [];
  const me = rows.find(r => r.id === uid) || { id: uid, name: '', couple_id: null };
  const partner = me.couple_id ? rows.find(r => r.id !== uid && r.couple_id === me.couple_id) || null : null;
  let code = null;
  if (me.couple_id) {
    const cp = check(await c.from('couples').select('invite_code').eq('id', me.couple_id).maybeSingle());
    code = cp ? cp.invite_code : null;
  }
  return { me, partner, couple: me.couple_id, code };
}
export async function createPair() { return check(await (await client()).rpc('create_couple')); }
export async function joinPair(code) { return check(await (await client()).rpc('join_couple', { code })); }
export async function leavePair() { check(await (await client()).rpc('leave_couple')); }
export async function setName(n) { check(await (await client()).rpc('set_my_name', { n })); }

/** Отправить свои записи, получить слитые с сервером. */
export async function syncMine(entries) { return check(await (await client()).rpc('sync_mine', { entries })) || {}; }
/** То же для общих дел. null — пары нет. */
export async function syncOurs(entries) { return check(await (await client()).rpc('sync_ours', { entries })); }

/** Заменить будущие напоминания новым списком. */
export async function setReminders(items) { return check(await (await client()).rpc('set_reminders', { items })); }

// ---------- уведомления с сервера ----------
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, ch => ch.charCodeAt(0)); };

/** Подписать это устройство на уведомления с сервера. Возвращает true, если получилось. */
export async function subscribePush(uid) {
  if (!('PushManager' in window) || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const res = await fetch(SUPABASE_URL + '/functions/v1/push', { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON } });
    const { publicKey } = await res.json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
  }
  const j = sub.toJSON();
  const c = await client();
  check(await c.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: uid, p256dh: j.keys.p256dh, auth: j.keys.auth }));
  return true;
}
/** Отписать устройство (при выходе из аккаунта). */
export async function unsubscribePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const c = await client();
    await c.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  } catch (e) { /* уже отписано */ }
}
