// Аккаунт и синхронизация: вход, пара, общие дела, уведомления с сервера.
// Связывает приложение (app.js) с сервером (sync.js) и слиянием данных (merge.js).
import * as api from './sync.js';
import { split, stamp, merge, prune, apply, stable } from './merge.js';
import { localISO, addDays, fmt, keyOf, buildDay } from './scheduler.js';
import * as notify from './notify.js';

const $ = s => document.getElementById(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* нет хранилища */ } } };

let hooks = null;          // { getState, save, render, roll }
let user = null;           // вошедший пользователь
let busy = false, again = false, timer = null;
let lastSync = 0, lastError = '';
let mode = 'login', formError = '', pairError = '', leaveArmed = false;

const todayISO = () => localISO(new Date());

// ---------- что видно в плане ----------
/** Моё ли это дело: личное, общее «любой из нас» или общее, назначенное мне. */
export function isMine(t) {
  if (!t.sh || !t.who || t.who === 'any') return true;
  return !user || t.who === user.id;
}
/** Состояние для построения плана: без общих дел, назначенных партнёру. */
export const planState = st => ({ ...st, tasks: st.tasks.filter(isMine) });

/** Информация о паре для формы задачи. */
export function pairInfo() {
  const st = hooks && hooks.getState();
  const p = st && st.sync && st.sync.pair;
  if (!user || !p || !p.couple) return null;
  return { me: user.id, partner: p.partner };
}
/** Подпись «чьё дело» для списка задач. */
export function whoText(t) {
  if (!t.sh) return '';
  const p = pairInfo();
  if (!t.who || t.who === 'any') return 'общее · любой из нас';
  if (user && t.who === user.id) return 'общее · делаю я';
  return 'общее · ' + (p && p.partner ? p.partner.name || 'партнёр' : 'партнёр');
}

// ---------- синхронизация ----------
/** Проставить время изменений. Возвращает true, если что-то поменялось. Вызывается при каждом сохранении. */
export function restamp(st) {
  if (!st.sync || !user) return false;
  const { mine, ours } = split(st), now = Date.now(), d = st.done.date;
  const a = stamp(st.sync.mine, mine, now, d);
  st.sync.mine = a.entries;
  let changed = a.changed;
  if (st.sync.couple) { const b = stamp(st.sync.ours, ours, now, d); st.sync.ours = b.entries; changed = changed || b.changed; }
  return changed;
}

/** Сохранение в приложении: если что-то поменялось, через полторы секунды отправляем на сервер. */
export function changed() {
  clearTimeout(timer);
  timer = setTimeout(syncNow, 1500);
}

export async function syncNow() {
  if (!user || !navigator.onLine) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    hooks.roll();
    let st = hooks.getState();
    // первый вход на этом телефоне: если в аккаунте уже есть данные, берём их, иначе отправляем свои
    if (!st.sync || st.sync.uid !== user.id) {
      const remote = await api.syncMine({});
      st = hooks.getState();
      st.sync = { uid: user.id, mine: {}, ours: {}, couple: null, pair: null };
      if (Object.keys(remote).length) { st.sync.mine = remote; apply(st, remote, {}); }
    }
    const pair = await api.loadPair(user.id);
    st = hooks.getState();
    if (st.sync.couple !== pair.couple) st.sync.ours = {};
    st.sync.couple = pair.couple;
    st.sync.pair = { couple: pair.couple, code: pair.code, name: pair.me.name, partner: pair.partner ? { id: pair.partner.id, name: pair.partner.name } : null };
    restamp(st);
    const gotMine = await api.syncMine(st.sync.mine);
    const gotOurs = pair.couple ? await api.syncOurs(st.sync.ours) : null;
    // пока ждали сервер, могли что-то поменять: сначала фиксируем это, потом сливаем
    hooks.roll();
    st = hooks.getState();
    restamp(st);
    const now = Date.now(), today = st.done.date;
    st.sync.mine = prune(merge(st.sync.mine, gotMine), now, today);
    st.sync.ours = gotOurs ? prune(merge(st.sync.ours, gotOurs), now, today) : {};
    apply(st, st.sync.mine, st.sync.ours);
    lastSync = Date.now(); lastError = '';
    hooks.save(true);
    hooks.render();
    await uploadReminders(st);
  } catch (e) {
    lastError = 'Не получилось синхронизировать. Попробую ещё раз позже.';
    console.warn('sync', e);
  } finally {
    busy = false;
    renderProfile();
    if (again) { again = false; changed(); }
  }
}

// ---------- напоминания с сервера ----------
const pushOn = () => ls.get('tm-push') === '1';

/** Отправить на сервер напоминания на неделю вперёд: конец каждого дела, если к нему не будет отметки. */
async function uploadReminders(st) {
  if (!pushOn()) return;
  const today = todayISO(), items = [], view = planState(st);
  for (let d = 0; d < 7; d++) {
    const day = addDays(today, d);
    buildDay(view, day, today).items.filter(i => i.type === 'task' && i.e < 1440).forEach(i => {
      const key = keyOf(i);
      if (d === 0 && (st.done.ids[key] !== undefined || st.skip[key])) return;
      const due = new Date(day + 'T' + fmt(i.e) + ':30');
      if (due.getTime() < Date.now() - 60000) return;
      items.push({ key, day, due_at: due.toISOString(), title: 'Вы сделали «' + i.name + '»?', body: 'По плану было ' + fmt(i.s) + '–' + fmt(i.e) });
    });
  }
  const sig = user.id + stable(items);
  if (sig === ls.get('tm-rem-sig')) return;
  await api.setReminders(items);
  ls.set('tm-rem-sig', sig);
}

/** Включить уведомления с сервера на этом устройстве (после разрешения уведомлений). */
export async function enablePush() {
  if (!user || notify.status() !== 'granted') return false;
  try {
    const ok = await api.subscribePush(user.id);
    ls.set('tm-push', ok ? '1' : null);
    notify.setServerPush(ok);
    if (ok) { ls.set('tm-rem-sig', null); await uploadReminders(hooks.getState()); }
    return ok;
  } catch (e) { console.warn('push', e); return false; } finally { renderProfile(); }
}

// ---------- вход ----------
async function afterSignIn(u) {
  user = u;
  renderProfile();
  await syncNow();
  if (notify.status() === 'granted') await enablePush();
}

async function submitAuth(e) {
  e.preventDefault();
  const email = $('acc-email').value.trim(), pass = $('acc-pass').value;
  const name = mode === 'signup' ? $('acc-name').value.trim() : '';
  formError = '';
  if (pass.length < 6) { formError = 'Пароль — не короче 6 символов.'; renderProfile(); return; }
  $('acc-submit').disabled = true;
  try {
    const u = mode === 'signup' ? await api.signUp(name, email, pass) : await api.signIn(email, pass);
    await afterSignIn(u);
  } catch (err) {
    const m = String(err && err.message || err);
    formError = /Invalid login/i.test(m) ? 'Неверная почта или пароль.'
      : /already registered/i.test(m) ? 'Такая почта уже зарегистрирована. Войдите.'
      : m === 'confirm' ? 'Сервер просит подтвердить почту. Напишите мне, я это отключу.'
      : /fetch|network|import/i.test(m) ? 'Нет связи с сервером. Проверьте интернет.'
      : 'Не получилось: ' + m;
    renderProfile();
  }
}

async function signOut() {
  await api.unsubscribePush();
  try { await api.signOut(); } catch (e) { /* уже вышли */ }
  user = null;
  const st = hooks.getState();
  delete st.sync;
  // общие дела без пары не показываем
  st.tasks = st.tasks.filter(t => !t.sh);
  ls.set('tm-push', null); ls.set('tm-rem-sig', null);
  notify.setServerPush(false);
  hooks.save(true); hooks.render(); renderProfile();
}

// ---------- пара ----------
async function pairAction(fn) {
  pairError = '';
  try { await fn(); } catch (e) { pairError = 'Не получилось. Проверьте интернет и попробуйте ещё раз.'; }
  await syncNow();
}

// ---------- вкладка «Профиль» ----------
export function renderProfile() {
  const box = $('account');
  if (!box) return;
  if (!api.enabled()) {
    box.innerHTML = '<div class="card"><div class="eyebrow">Вход для двоих</div><p>Сервер ещё настраивается. Как только он заработает, здесь появится вход, и задачи будут синхронизироваться между вашими телефонами.</p></div>';
    return;
  }
  if (!user) {
    const su = mode === 'signup';
    box.innerHTML = '<form class="card acc-form" id="acc-form">'
      + '<div class="eyebrow">' + (su ? 'Новый аккаунт' : 'Вход') + '</div>'
      + '<p class="note">' + (su ? 'Аккаунт нужен, чтобы задачи хранились на сервере, а напоминания приходили, даже когда приложение закрыто.' : 'Войдите, чтобы задачи синхронизировались между телефонами, а напоминания приходили, даже когда приложение закрыто.') + '</p>'
      + (su ? '<label>Как вас зовут<input id="acc-name" autocomplete="nickname" placeholder="Например, Артём"></label>' : '')
      + '<label>Почта<input id="acc-email" type="email" autocomplete="email" required></label>'
      + '<label>Пароль<input id="acc-pass" type="password" autocomplete="' + (su ? 'new-password' : 'current-password') + '" required minlength="6"></label>'
      + (formError ? '<div class="alert">' + esc(formError) + '</div>' : '')
      + '<button class="primary" id="acc-submit">' + (su ? 'Создать аккаунт' : 'Войти') + '</button>'
      + '<button type="button" class="ghost" id="acc-mode">' + (su ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать') + '</button>'
      + '</form>';
    $('acc-form').addEventListener('submit', submitAuth);
    $('acc-mode').onclick = () => { mode = su ? 'login' : 'signup'; formError = ''; renderProfile(); };
    return;
  }
  const st = hooks.getState(), p = (st.sync && st.sync.pair) || {};
  const name = p.name || user.email;
  const syncLine = lastError ? '<span class="bad">' + esc(lastError) + '</span>'
    : busy && !lastSync ? 'Синхронизирую…'
    : lastSync ? 'Синхронизировано в ' + new Date(lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  let pairHtml;
  if (!p.couple) {
    pairHtml = '<p>Создайте пару и отправьте код второму человеку. Или введите код, который прислали вам.</p>'
      + '<button class="primary" id="pair-create">Создать пару</button>'
      + '<div class="row nowrap"><input id="pair-code" placeholder="Код, например 4F2A9C" autocapitalize="characters" maxlength="6"><button id="pair-join">Вступить</button></div>';
  } else if (!p.partner) {
    pairHtml = '<p>Отправьте этот код второму человеку. Он вводит его у себя в «Профиле».</p><div class="code">' + esc(p.code || '') + '</div>'
      + '<button type="button" id="pair-share">Поделиться кодом</button>'
      + '<button type="button" class="ghost danger" id="pair-leave">' + (leaveArmed ? 'Точно отменить пару?' : 'Отменить пару') + '</button>';
  } else {
    pairHtml = '<p>Ваша пара: <b>' + esc(p.partner.name || 'партнёр') + '</b>. Общие дела видно вам обоим: при добавлении задачи выберите, чьё это дело.</p>'
      + '<button type="button" class="ghost danger" id="pair-leave">' + (leaveArmed ? 'Точно выйти из пары?' : 'Выйти из пары') + '</button>';
  }
  const ns = notify.status();
  let notifHtml;
  if (notify.needsInstallOnIOS()) notifHtml = '<p class="note">На iPhone сначала добавьте приложение на экран «Домой»: кнопка «Поделиться» в Safari, затем «На экран Домой». Потом откройте его оттуда и вернитесь сюда.</p>';
  else if (ns === 'unsupported') notifHtml = '<p class="note">Этот браузер не умеет показывать уведомления.</p>';
  else if (ns === 'denied') notifHtml = '<p class="note">Уведомления запрещены. Разрешите их для этого приложения в настройках телефона.</p>';
  else if (ns === 'granted' && pushOn()) notifHtml = '<p><span class="ok">●</span> Напоминания приходят, даже когда приложение закрыто.</p>';
  else notifHtml = '<p class="note">Если время дела прошло, а галочки нет, придёт уведомление «Вы сделали?».</p><button class="primary" id="push-on">Включить напоминания</button>';

  box.innerHTML = '<div class="card"><div class="eyebrow">Аккаунт</div><p><b>' + esc(name) + '</b>' + (p.name ? '<br><span class="note">' + esc(user.email) + '</span>' : '') + '</p>'
    + (syncLine ? '<p class="note">' + syncLine + '</p>' : '') + '</div>'
    + '<div class="card"><div class="eyebrow">Пара</div>' + pairHtml + (pairError ? '<div class="alert">' + esc(pairError) + '</div>' : '') + '</div>'
    + '<div class="card"><div class="eyebrow">Напоминания</div>' + notifHtml + '</div>'
    + '<button type="button" class="ghost" id="acc-out">Выйти из аккаунта</button>';

  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('acc-out', signOut);
  on('pair-create', () => pairAction(() => api.createPair()));
  on('pair-join', () => pairAction(async () => {
    const code = $('pair-code').value.trim();
    if (!code) throw new Error('empty');
    if (!(await api.joinPair(code))) { pairError = 'Код не подошёл. Проверьте его или попросите новый.'; return; }
  }).then(() => { if (pairError) renderProfile(); }));
  on('pair-leave', () => {
    if (!leaveArmed) { leaveArmed = true; renderProfile(); setTimeout(() => { leaveArmed = false; renderProfile(); }, 3000); return; }
    leaveArmed = false;
    pairAction(() => api.leavePair());
  });
  on('pair-share', async () => {
    const text = 'Код для «Мой день»: ' + p.code + '. Открой https://jundt-l.github.io/time-manager/ → Профиль → Вступить.';
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); $('pair-share').textContent = 'Скопировано'; } } catch (e) { /* отменили */ }
  });
  on('push-on', async () => { if (ns !== 'granted') await notify.requestPermission(); await enablePush(); hooks.render(); });
}

// ---------- запуск ----------
export async function init(h) {
  hooks = h;
  renderProfile();
  if (!api.enabled()) return;
  if (pushOn()) notify.setServerPush(true);
  // syncNow сам ничего не делает, пока не вошли
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  window.addEventListener('online', () => syncNow());
  setInterval(() => { if (!document.hidden) syncNow(); }, 120000);
  try { user = await api.currentUser(); } catch (e) { user = null; }
  renderProfile();
  if (!user) return;
  hooks.render();
  await syncNow();
  if (notify.status() === 'granted' && !pushOn()) await enablePush();
}
