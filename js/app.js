import { localISO, addDays, daysBetween, typeOfDay, DEFAULT_WORK_WEEK, fmt, human, WHEN_TXT, keyOf, buildDay, pendingChecks, setDone, setSkipped, ideaFor, askable } from './scheduler.js';
import { sampleTasks, newId } from './sample.js';
import * as notify from './notify.js';
import { createWheel } from './wheel.js';
import { parseDictation } from './voice.js';
import * as account from './account.js';

const KEY = 'time-manager-v1';
const todayISO = () => localISO(new Date());
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const $ = s => document.getElementById(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- состояние ----------
function freshState() {
  return { v: 1, tasks: sampleTasks(todayISO()), times: { weekday: { wake: '07:00', sleep: '23:00' }, weekend: { wake: '09:00', sleep: '23:30' } }, done: { date: todayISO(), ids: {} }, skip: {}, notified: {} };
}
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.tasks) return s; } catch (e) { /* пусто */ } return null; }
/** Сохранить на телефоне. Если вошли в аккаунт и что-то поменялось, изменения уйдут на сервер. */
function save(fromSync = false) {
  if (!fromSync && account.restamp(state)) account.changed();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ }
}
let state = load() || freshState();
function rollDay() {
  if (state.done.date !== todayISO()) { state.done = { date: todayISO(), ids: {} }; state.skip = {}; state.notified = {}; state.hide = {}; state.by = {}; }
  if (!state.notified) state.notified = {};
  if (!state.hide) state.hide = {};
  if (!state.by) state.by = {};
  if (!state.hist) state.hist = {};
  // история дольше двух месяцев не нужна
  const oldHist = addDays(todayISO(), -60);
  Object.keys(state.hist).forEach(d => { if (d < oldHist) delete state.hist[d]; });
  // разовые дела старше недели больше не нужны
  const old = addDays(todayISO(), -7);
  state.tasks = state.tasks.filter(t => !(t.kind === 'once' && t.date < old));
}
rollDay();
let offset = 0; // 0 = сегодня
const viewISO = () => addDays(todayISO(), offset);

// ---------- план ----------
const CHECK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderPlan() {
  const day = viewISO(), today = offset === 0, dt = typeOfDay(state, day);
  const { items, unplaced, free, moved } = buildDay(account.planState(state), day, todayISO());
  const now = today ? nowMin() : -1;

  // шапка: «Сегодня» / «Завтра» / день недели, дата мелко сверху
  const d = new Date(day + 'T12:00');
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'long' });
  const dm = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const rel = { 0: 'Сегодня', 1: 'Завтра', '-1': 'Вчера' }[offset];
  $('today-title').textContent = rel || wd.charAt(0).toUpperCase() + wd.slice(1);
  $('today-date').textContent = rel ? wd.charAt(0).toUpperCase() + wd.slice(1) + ', ' + dm : dm;
  $('daytype').textContent = dt === 'weekend' ? 'Выходной' : 'Рабочий день';
  $('daytype').className = 'chip' + (dt === 'weekend' ? ' weekend' : '');
  $('to-today').hidden = today;

  // сводка: кольцо — доля свободного времени в дне
  const tm = state.times[dt];
  $('wake').textContent = tm.wake; $('sleep').textContent = tm.sleep;
  const span = Math.max(1, ((+tm.sleep.slice(0, 2)) * 60 + (+tm.sleep.slice(3))) - ((+tm.wake.slice(0, 2)) * 60 + (+tm.wake.slice(3))));
  const C = 2 * Math.PI * 27, frac = Math.min(1, free / span);
  $('ring-arc').setAttribute('stroke-dasharray', (C * frac).toFixed(1) + ' ' + C.toFixed(1));
  $('st-free').textContent = human(free);
  const count = items.filter(i => i.type === 'task' || i.type === 'fixed').length;
  const bgN = items.filter(i => i.type === 'bg').length;
  const doneN = today ? items.filter(i => i.type === 'task' && state.done.ids[keyOf(i)] !== undefined).length : 0;
  $('st-sub').textContent = (doneN ? doneN + ' из ' : '') + count + ' ' + plural(count, 'дело', 'дела', 'дел') + (bgN ? ' · ' + bgN + ' ' + plural(bgN, 'идёт', 'идут', 'идут') + ' сами' : '');

  let warn = unplaced.length ? '<div class="alert"><b>Не поместилось:</b> ' + unplaced.map(t => esc(t.name)).join(', ') + '. Попробуйте раньше встать или перенести что-то.</div>' : '';
  const mm = moved.filter(t => t.when === 'morning');
  if (mm.length) warn += '<div class="alert"><b>Утром не хватает времени:</b> ' + mm.map(t => esc(t.name.toLowerCase())).join(', ') + ' (' + human(mm.reduce((a, t) => a + t.dur, 0)) + '). Поставьте подъём раньше, и план сам перенесёт их на утро.</div>';
  const hid = today ? state.tasks.filter(t => state.hide[t.id]) : [];
  if (hid.length) warn += '<div class="note hidden-list">Убрано на сегодня: ' + hid.map(t => '<button type="button" class="ghost" data-unhide="' + t.id + '">' + esc(t.name) + ' ↺</button>').join('') + '</div>';
  $('unplaced').innerHTML = warn;

  // карточки «Вы сделали…?» внутри приложения
  const pending = today ? pendingChecks({ items }, state, now) : [];
  $('checks').innerHTML = pending.slice(0, 2).map(it => '<div class="notif" role="alert"><div class="head"><span>Без отметки</span><span>по плану ' + fmt(it.s) + '–' + fmt(it.e) + '</span></div><div class="q">Вы сделали «' + esc(it.name) + '»?</div><div class="acts"><button class="yes" data-yes="' + keyOf(it) + '">✓ Сделано</button><button class="no" data-no="' + keyOf(it) + '">✗ Не сделал</button></div></div>').join('')
    + (pending.length > 2 ? '<div class="note">И ещё ' + (pending.length - 2) + ' без отметки</div>' : '');

  // линия времени: фоновая работа показывается плашкой у «Запустить», а не отдельной строкой
  const bgOf = {};
  items.filter(i => i.type === 'bg').forEach(b => { bgOf[b.s] = b; });
  const rows = items.filter(i => i.type !== 'bg');
  // «сейчас» — дело, которое идёт в эту минуту; если такого нет, ближайшее следующее не отмечаем
  // «сейчас» — самое конкретное из идущих дел: еда в обед важнее работы, внутри которой она идёт
  const nowIt = today ? rows.filter(i => (i.type === 'task' || i.type === 'fixed') && i.s <= now && now < i.e && !(state.done.ids[keyOf(i)] !== undefined))
    .sort((a, b) => b.s - a.s || (a.e - a.s) - (b.e - b.s))[0] || null : null;
  // дело внутри другого (обед во время работы) подписываем, чтобы было понятно, почему они пересекаются
  const inside = it => rows.find(o => o !== it && o.task && (o.type === 'fixed' || o.type === 'task') && o.s <= it.s && o.e >= it.e && o.e - o.s > it.e - it.s);
  usedIdeas = new Set();
  $('timeline').innerHTML = rows.map(it => {
    const key = it.task ? keyOf(it) : '';
    const done = today && key && state.done.ids[key] !== undefined;
    const skipped = today && key && state.skip[key];
    const isNow = it === nowIt && !done;
    const bg = it.par ? bgOf[it.e] : null;
    const cls = ['tl-row', it.type === 'fixed' ? 'fixed' + (it.e - it.s > 120 ? ' long' : '') : it.type === 'free' ? 'free' : 'task', it.par ? 'bgstart' : '', done ? 'done' : '', skipped ? 'skipped' : '', isNow ? 'now' : ''].join(' ');
    let sub = '';
    if (it.type === 'free') sub = human(it.e - it.s) + ' для себя';
    else if (isNow) sub = '';
    else if (it.type === 'fixed') { const c = inside(it); sub = fmt(it.s) + '–' + fmt(it.e) + (c ? ' · во время «' + c.name.toLowerCase() + '»' : ''); }
    else sub = human(it.e - it.s) + (it.why && !it.par ? ' · ' + it.why.split(' · ')[0].toLowerCase() : '');
    const btn = ((it.type === 'task' || it.type === 'fixed') && today) ? '<button class="check" data-key="' + key + '" aria-pressed="' + !!done + '" aria-label="Готово: ' + esc(it.name) + '">' + CHECK + '</button>' : '';
    const tid = it.task && it.type !== 'free' ? ' data-tid="' + it.task.id + '" data-key="' + key + '"' : '';
    return '<div class="' + cls + '"' + tid + '><span class="tl-time">' + fmt(it.s) + '</span><span class="tl-rail"><i class="dot"></i></span><div class="tl-body"><div class="tl-text">'
      + (isNow ? '<span class="now-lbl">СЕЙЧАС · ДО ' + fmt(it.e) + '</span>' : '')
      + '<span class="tl-name">' + esc(it.type === 'free' ? 'Свободное время' : it.name) + '</span>'
      + (sub ? '<span class="tl-sub">' + esc(sub) + '</span>' : '')
      + (bg ? '<span class="par">' + esc(it.task.name) + ' идёт сама до ' + fmt(bg.e) + ' · можно другое</span>' : '')
      + (skipped ? '<span class="st">Не сделано</span>' : '')
      + (it.task && it.type !== 'free' && openRow === it.task.id ? rowActs(it.task, today) : '')
      + (it.type === 'free' ? ideaHtml(it, day) : '')
      + '</div>' + btn + '</div></div>';
  }).join('');

  if (today) { notify.schedule(items, state, now); recordDay(items); }
}
const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const daysText = d => d === 'weekday' ? 'рабочие дни' : d === 'weekend' ? 'выходные' : (d && d.startsWith('dow:')) ? 'по ' + d.slice(4).split(',').map(n => DOW_SHORT[+n]).join(', ') : 'каждый день';
const dateText = iso => new Date(iso + 'T12:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
/** Короткое описание задачи: длительность, время, дни, частота. */
function describe(t, all = state.tasks) {
  const p = t.after && all.find(x => x.id === t.after);
  if (t.kind === 'someday') return human(t.dur) + (t.sh ? ' · <span class="who">' + esc(account.whoText(t)) + '</span>' : '');
  let meta = human(t.dur) + ' · ' + (p ? 'сразу после «' + esc(p.name) + '»' : t.fixed ? 'в ' + t.fixed : WHEN_TXT[t.when]);
  if (t.kind === 'once') meta += ' · ' + dateText(t.date);
  else if (t.kind === 'daily' || (t.days && t.days !== 'all')) meta += ' · ' + daysText(t.days);
  if (t.bg) meta += ' · фоном ' + human(t.bg);
  if (t.prio === 3 && !t.fixed && !t.after) meta += ' · важно';
  if (t.sh) meta += ' · <span class="who">' + esc(account.whoText(t)) + '</span>';
  if (t.kind === 'variable') {
    const left = t.every - daysBetween(t.last, todayISO());
    meta += ' · раз в ' + t.every + ' дн. · ' + (left <= 0 ? '<span class="due">пора</span>' : 'через ' + left + ' дн.');
  }
  return meta;
}

function renderTasks() {
  const row = t => {
    const meta = describe(t);
    return '<div class="trow"><div><div class="tname">' + esc(t.name) + '</div><div class="meta">' + meta + '</div></div><button data-edit="' + t.id + '">Изменить</button></div>';
  };
  $('list-daily').innerHTML = state.tasks.filter(t => t.kind === 'daily').map(row).join('') || '<div class="note">Пока нет задач</div>';
  $('list-var').innerHTML = state.tasks.filter(t => t.kind === 'variable').map(row).join('') || '<div class="note">Пока нет задач</div>';
  const once = state.tasks.filter(t => t.kind === 'once' && t.date >= todayISO()).sort((a, b) => (a.date + a.fixed).localeCompare(b.date + b.fixed));
  $('list-once').innerHTML = once.map(row).join('') || '<div class="note">Пока нет. Например, «в пятницу в 10 к врачу».</div>';
  $('list-some').innerHTML = state.tasks.filter(t => t.kind === 'someday').map(row).join('') || '<div class="note">Пока пусто. Добавьте то, на что вечно нет времени: «когда-нибудь сходить в кино на 2 часа».</div>';
}

function renderNotifyCard() {
  const st = notify.status();
  $('notify-card').hidden = st === 'granted' || (st === 'unsupported' && !notify.needsInstallOnIOS());
  $('notify-ios').hidden = !notify.needsInstallOnIOS();
  $('notify-denied').hidden = st !== 'denied';
  $('notify-btn').hidden = st === 'denied' || notify.needsInstallOnIOS();
}

function render() { rollDay(); renderPlan(); renderTasks(); renderNotifyCard(); renderStats(); save(); }

// ---------- отметки ----------
/** Отметить дело и запомнить, кто отметил (для общих дел и статистики). */
function markDone(key, on) {
  setDone(state, key, on, todayISO());
  if (on) state.by[key] = account.myId(); else delete state.by[key];
}
export function applyAction(key, action, day) {
  rollDay();
  if (day && day !== todayISO()) return; // ответ на вчерашнее напоминание уже не нужен
  if (action === 'done') markDone(key, true);
  else if (action === 'skip') setSkipped(state, key, todayISO());
  notify.dismiss(key);
  render();
}
$('timeline').addEventListener('click', e => {
  const b = e.target.closest('.check');
  if (!b) {
    const a = e.target.closest('[data-act]');
    if (a) { rowAction(a.dataset.act, a.dataset.tid); return; }
    const idea = e.target.closest('[data-idea]');
    if (idea) { ideaAction(idea); return; }
    const row = e.target.closest('.tl-row[data-tid]');
    if (row) { openRow = openRow === row.dataset.tid ? null : row.dataset.tid; renderPlan(); }
    return;
  }
  const key = b.dataset.key;
  markDone(key, state.done.ids[key] === undefined);
  notify.dismiss(key);
  render();
});
$('checks').addEventListener('click', e => {
  const y = e.target.closest('[data-yes]'), n = e.target.closest('[data-no]');
  if (y) applyAction(y.dataset.yes, 'done');
  if (n) applyAction(n.dataset.no, 'skip');
});
$('unplaced').addEventListener('click', e => { const b = e.target.closest('[data-unhide]'); if (b) { delete state.hide[b.dataset.unhide]; render(); } });
$('prev-day').onclick = () => { offset--; render(); };
$('next-day').onclick = () => { offset++; render(); };
$('to-today').onclick = () => { offset = 0; render(); };
$('notify-btn').onclick = async () => { await notify.requestPermission(); render(); await account.enablePush(); };

// ---------- вкладки ----------
const tabs = { plan: 'view-plan', tasks: 'view-tasks', idea: 'view-idea' };
function show(name) {
  Object.entries(tabs).forEach(([k, v]) => { $(v).hidden = k !== name; $('tab-' + k).setAttribute('aria-selected', k === name); });
  $('dict-btn-plan').hidden = name === 'idea';
  if (name === 'idea') account.renderProfile();
  window.scrollTo(0, 0);
}
Object.keys(tabs).forEach(k => $('tab-' + k).addEventListener('click', () => show(k)));

// ---------- барабан времени, как в будильнике ----------
function setFixed(v) { $('f-fixed').value = v; $('f-fixed-btn').textContent = v || 'Не задано'; }
const formWheel = createWheel($('form-wheel'), v => { setFixed(v); $('f-after').value = ''; });
$('f-fixed-btn').onclick = () => {
  const box = $('wheel-box'); box.hidden = !box.hidden; if (box.hidden) return;
  const v = $('f-fixed').value || '08:00';
  formWheel.set(v); setFixed(v); $('f-after').value = '';
};
$('wheel-ok').onclick = () => { $('wheel-box').hidden = true; };
$('wheel-clear').onclick = () => { setFixed(''); $('wheel-box').hidden = true; };

// подъём и отбой: тот же барабан в отдельной шторке
let timeField = null;
const sheetWheel = createWheel($('time-wheel'), v => { $('time-value').textContent = v; });
function openTime(k) {
  timeField = k;
  const dt = typeOfDay(state, viewISO());
  $('time-title').textContent = (k === 'wake' ? 'Подъём' : 'Отбой') + (dt === 'weekend' ? ' в выходные' : ' в рабочие дни');
  const v = state.times[dt][k];
  $('time-value').textContent = v;
  $('time-sheet').hidden = false;
  sheetWheel.set(v);
}
$('wake-btn').onclick = () => openTime('wake');
$('sleep-btn').onclick = () => openTime('sleep');
$('time-ok').onclick = () => { state.times[typeOfDay(state, viewISO())][timeField] = sheetWheel.get(); $('time-sheet').hidden = true; render(); };
$('time-cancel').onclick = () => { $('time-sheet').hidden = true; };
$('time-sheet').addEventListener('click', e => { if (e.target.id === 'time-sheet') $('time-sheet').hidden = true; });
$('f-after').addEventListener('change', e => { if (e.target.value) { setFixed(''); $('wheel-box').hidden = true; } });

// ---------- календарь рабочих дней ----------
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_NUM = [1, 2, 3, 4, 5, 6, 0];
let calMonth = 0; // смещение месяца от текущего
function renderCalendar() {
  const week = state.workWeek || DEFAULT_WORK_WEEK;
  $('cal-week').innerHTML = WD.map((n, i) => '<button type="button" data-wd="' + WD_NUM[i] + '" aria-pressed="' + week.includes(WD_NUM[i]) + '">' + n + '</button>').join('');
  const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + calMonth, 1);
  $('cal-title').textContent = first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  const lead = (first.getDay() + 6) % 7; // понедельник первый
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = todayISO();
  let html = WD.map(n => '<div class="cal-h">' + n + '</div>').join('') + '<div></div>'.repeat(lead);
  for (let d = 1; d <= days; d++) {
    const iso = localISO(new Date(first.getFullYear(), first.getMonth(), d));
    const type = typeOfDay(state, iso), changed = !!(state.dayOverrides && state.dayOverrides[iso]);
    html += '<button type="button" class="cal-d ' + (type === 'weekend' ? 'off' : 'work') + (changed ? ' changed' : '') + (iso === today ? ' today' : '') + (iso < today ? ' past' : '') + '" data-iso="' + iso + '" aria-label="' + d + ', ' + (type === 'weekend' ? 'выходной' : 'рабочий') + '">' + d + '</button>';
  }
  $('cal-grid').innerHTML = html;
}
$('daytype').onclick = () => {
  const v = new Date(viewISO() + 'T12:00'), n = new Date();
  calMonth = (v.getFullYear() - n.getFullYear()) * 12 + v.getMonth() - n.getMonth();
  renderCalendar(); $('cal-sheet').hidden = false;
};
$('cal-prev').onclick = () => { calMonth--; renderCalendar(); };
$('cal-next').onclick = () => { calMonth++; renderCalendar(); };
$('cal-done').onclick = () => { $('cal-sheet').hidden = true; render(); };
$('cal-sheet').addEventListener('click', e => { if (e.target.id === 'cal-sheet') { $('cal-sheet').hidden = true; render(); } });
$('cal-week').addEventListener('click', e => {
  const b = e.target.closest('[data-wd]'); if (!b) return;
  const n = +b.dataset.wd, week = [...(state.workWeek || DEFAULT_WORK_WEEK)];
  state.workWeek = week.includes(n) ? week.filter(x => x !== n) : week.concat(n);
  save(); renderCalendar();
});
$('cal-grid').addEventListener('click', e => {
  const b = e.target.closest('[data-iso]'); if (!b) return;
  const iso = b.dataset.iso;
  if (!state.dayOverrides) state.dayOverrides = {};
  const flipped = typeOfDay(state, iso) === 'weekend' ? 'weekday' : 'weekend';
  delete state.dayOverrides[iso];
  // если после снятия отметки день и так нужного типа, отметка не нужна
  if (typeOfDay(state, iso) !== flipped) state.dayOverrides[iso] = flipped;
  try { if (navigator.vibrate) navigator.vibrate(6); } catch (err) { /* нет вибрации */ }
  save(); renderCalendar();
});

// ---------- форма задачи ----------
let editing = null, kind = 'daily';
function setKind(k) {
  kind = k;
  $('f-kind-daily').setAttribute('aria-pressed', k === 'daily');
  $('f-kind-var').setAttribute('aria-pressed', k === 'variable');
  $('f-kind-once').setAttribute('aria-pressed', k === 'once');
  $('f-kind-some').setAttribute('aria-pressed', k === 'someday');
  $('f-var-box').hidden = k !== 'variable';
  $('f-date-box').hidden = k !== 'once';
  $('f-days-box').hidden = k === 'once' || k === 'someday';
}
$('f-kind-once').onclick = () => { setKind('once'); if (!$('f-date').value) $('f-date').value = todayISO(); };
$('f-kind-daily').onclick = () => setKind('daily');
$('f-kind-var').onclick = () => setKind('variable');
$('f-kind-some').onclick = () => setKind('someday');
function openForm(t) {
  editing = t || null;
  $('form-title').textContent = t ? 'Изменить задачу' : 'Новая задача';
  $('del-btn').hidden = !t;
  $('f-name').value = t ? t.name : ''; $('f-dur').value = t ? t.dur : 30; $('f-prio').value = t ? t.prio : 2;
  $('f-when').value = t ? t.when : 'any'; const dv = t && t.days ? t.days : 'all';
  $('f-days').querySelectorAll('[data-dow]').forEach(o => o.remove());
  if (dv.startsWith('dow:')) { const o = document.createElement('option'); o.value = dv; o.dataset.dow = '1'; o.textContent = daysText(dv).replace(/^по/, 'По'); $('f-days').append(o); }
  $('f-days').value = dv; $('f-date').value = t && t.date ? t.date : todayISO();
  setFixed(t ? t.fixed : ''); $('wheel-box').hidden = true;
  $('f-every').value = t && t.every ? t.every : 7; $('f-ago').value = t && t.last ? daysBetween(t.last, todayISO()) : 0;
  const opts = state.tasks.filter(x => !t || x.id !== t.id).map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
  $('f-after').innerHTML = '<option value="">Не привязана</option>' + opts; $('f-after').value = t && t.after ? t.after : '';
  $('f-bg').value = t ? t.bg : 0; $('f-fin').value = t ? t.fin : 0;
  const pi = account.pairInfo();
  $('f-who-box').hidden = !pi;
  if (pi) {
    $('f-who').innerHTML = '<option value="">Только моё</option><option value="any">Общее: любой из нас</option><option value="' + pi.me + '">Общее: делаю я</option>'
      + (pi.partner ? '<option value="' + esc(pi.partner.id) + '">Общее: делает ' + esc(pi.partner.name || 'партнёр') + '</option>' : '');
    $('f-who').value = t && t.sh ? (t.who || 'any') : '';
  }
  setKind(t ? t.kind : 'daily');
  $('sheet').hidden = false; $('f-name').focus();
}
$('add-btn').onclick = () => openForm();
$('close-btn').onclick = () => { $('sheet').hidden = true; };
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('sheet').hidden = true; });
$('view-tasks').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) openForm(state.tasks.find(t => t.id === b.dataset.edit)); });
$('form').addEventListener('submit', e => {
  e.preventDefault();
  const n = x => Math.max(0, parseInt($(x).value, 10) || 0);
  // пока форма была открыта, синхронизация могла заменить задачу свежей копией: ищем по id
  const cur = editing && state.tasks.find(x => x.id === editing.id);
  const t = cur || editing || { id: newId() };
  Object.assign(t, {
    name: $('f-name').value.trim() || 'Без названия', kind, dur: Math.max(5, n('f-dur')), prio: +$('f-prio').value,
    when: $('f-when').value, days: $('f-days').value,
    fixed: $('f-after').value ? '' : $('f-fixed').value, after: $('f-after').value || '', bg: n('f-bg'), fin: n('f-fin'),
  });
  if (kind === 'variable') { t.every = Math.max(1, n('f-every')); t.last = addDays(todayISO(), -n('f-ago')); }
  if (kind === 'once') t.date = $('f-date').value || todayISO();
  const who = $('f-who-box').hidden ? (t.sh ? (t.who || 'any') : '') : $('f-who').value;
  if (who) { t.sh = 1; t.who = who; } else { delete t.sh; delete t.who; }
  if (!cur) state.tasks.push(t);
  $('sheet').hidden = true; render();
});
/** Удалить задачу. Дела, которые шли «сразу после» неё, получают её время. */
function deleteTask(task) {
  state.tasks.forEach(t => { if (t.after === task.id) { t.after = ''; if (!t.fixed && task.fixed) t.fixed = task.fixed; } });
  state.tasks = state.tasks.filter(t => t.id !== task.id);
}
let delArmed = false;
$('del-btn').onclick = () => {
  if (!delArmed) { delArmed = true; $('del-btn').textContent = 'Точно удалить?'; setTimeout(() => { delArmed = false; $('del-btn').textContent = 'Удалить'; }, 3000); return; }
  delArmed = false; $('del-btn').textContent = 'Удалить';
  deleteTask(editing);
  $('sheet').hidden = true; render();
};

// ---------- неделя в цифрах ----------
/** Записать итог сегодняшнего дня: сколько моих дел в плане и сколько сделано. */
function recordDay(items) {
  const me = account.myId();
  let d = 0, t = 0, sh = 0;
  items.filter(askable).forEach(i => {
    const key = keyOf(i), done = state.done.ids[key] !== undefined, by = state.by[key];
    if (done && by && by !== me) return; // общее дело сделал партнёр — не моё
    t++;
    if (done) { d++; if (i.task.sh) sh++; }
  });
  const h = { d, t, sh };
  const old = state.hist[todayISO()];
  if (!old || old.d !== d || old.t !== t || old.sh !== sh) state.hist[todayISO()] = h;
}
const DOW_MIN = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
let statSel = null;
function renderStats() {
  const box = $('stats'); if (!box) return;
  const today = todayISO(), days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const H = iso => state.hist[iso] || { d: 0, t: 0, sh: 0 };
  const done = days.reduce((a, iso) => a + H(iso).d, 0), planned = days.reduce((a, iso) => a + H(iso).t, 0);
  // серия: дни подряд, когда сделано от 70% плана. Сегодня считается, если уже выполнено
  const good = iso => { const h = H(iso); return h.t > 0 && h.d / h.t >= 0.7; };
  let streak = good(today) ? 1 : 0;
  for (let i = 1; i < 60 && good(addDays(today, -i)); i++) streak++;
  const bars = days.map(iso => {
    const h = H(iso), pct = h.t ? Math.round(100 * h.d / h.t) : 0;
    const dd = new Date(iso + 'T12:00');
    const tip = DOW_MIN[dd.getDay()] + ', ' + dd.getDate() + ': ' + (h.t ? h.d + ' из ' + h.t + ' дел' : 'нет данных');
    return '<button type="button" class="bar' + (iso === today ? ' today' : '') + (statSel === iso ? ' sel' : '') + '" data-day="' + iso + '" aria-label="' + tip + '">'
      + '<span class="track"><span class="fill" style="height:' + pct + '%"></span></span><span class="dl">' + DOW_MIN[dd.getDay()] + '</span></button>';
  }).join('');
  const sel = statSel && days.includes(statSel) ? statSel : today, sh = H(sel);
  const sd = new Date(sel + 'T12:00');
  let pair = '';
  const pi = account.pairInfo();
  if (pi && pi.partner) {
    const mine = days.reduce((a, iso) => a + H(iso).sh, 0);
    const ps = (state.pstat && state.pstat[pi.partner.id]) || {};
    const hers = days.reduce((a, iso) => a + (ps[iso] || 0), 0);
    pair = '<div class="st-row"><span>Общие дела</span><b>вы ' + mine + ' · ' + esc(pi.partner.name || 'партнёр') + ' ' + hers + '</b></div>';
  }
  box.innerHTML = '<div class="card stats"><div class="eyebrow">Неделя в цифрах</div>'
    + '<div class="st-hero"><span class="big">' + done + '</span><span>' + plural(done, 'дело сделано', 'дела сделано', 'дел сделано') + ' за 7 дней' + (planned ? ' · ' + Math.round(100 * done / planned) + '% плана' : '') + '</span></div>'
    + '<div class="bars" role="group" aria-label="Доля сделанного по дням">' + bars + '</div>'
    + '<div class="note st-tip">' + DOW_MIN[sd.getDay()] + ', ' + sd.getDate() + ': ' + (sh.t ? 'сделано ' + sh.d + ' из ' + sh.t : 'нет данных') + '</div>'
    + '<div class="st-row"><span>Серия</span><b>' + (streak ? streak + ' ' + plural(streak, 'день', 'дня', 'дней') + ' подряд' : 'начнётся сегодня') + '</b></div>'
    + pair
    + '<div class="note">Серия растёт, когда за день сделано не меньше 70% плана.</div></div>';
}
$('stats').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) { statSel = b.dataset.day; renderStats(); } });

// ---------- «когда-нибудь»: подсказка в свободном окне ----------
const ideaShift = {};
let usedIdeas = new Set(); // одно и то же дело не предлагаем в двух окнах
function ideaHtml(it, day) {
  const len = it.e - it.s, id = day + '@' + it.s;
  if (len < 20 || (offset === 0 && it.e <= nowMin())) return '';
  const t = ideaFor(state.tasks.filter(x => account.isMine(x) && !usedIdeas.has(x.id)), len, daysBetween('2026-01-01', day) + it.s, ideaShift[id] || 0);
  if (!t) return '';
  usedIdeas.add(t.id);
  const more = state.tasks.filter(x => x.kind === 'someday' && x.dur <= len).length > 1;
  return '<span class="idea">Можно: <b>' + esc(t.name) + '</b> · ' + human(t.dur)
    + '<button type="button" data-idea="add" data-tid="' + t.id + '" data-day="' + day + '" data-s="' + it.s + '">В план</button>'
    + (more ? '<button type="button" class="ghost" data-idea="next" data-key="' + id + '">Другое</button>' : '') + '</span>';
}
function ideaAction(b) {
  if (b.dataset.idea === 'next') { ideaShift[b.dataset.key] = (ideaShift[b.dataset.key] || 0) + 1; renderPlan(); return; }
  const t = state.tasks.find(x => x.id === b.dataset.tid); if (!t) return;
  // дело из списка становится разовым на этот день и встаёт в начало свободного окна
  undoable('«' + t.name + '» в плане на ' + fmt(+b.dataset.s), () => {
    Object.assign(t, { kind: 'once', date: b.dataset.day, fixed: fmt(+b.dataset.s), after: '', days: 'all' });
  });
}

// ---------- нажатие на задачу в плане: «На завтра» и «Удалить» ----------
let openRow = null; // id задачи, под которой показаны кнопки
/** Действие с возможностью отменить его из всплывающей подсказки. */
function undoable(msg, fn) {
  const snap = JSON.stringify({ tasks: state.tasks, hide: state.hide });
  fn(); openRow = null; render();
  toast(msg, () => { const s = JSON.parse(snap); state.tasks = s.tasks; state.hide = s.hide; render(); });
}
/** Кнопки под задачей: перенести, взять на себя (общее дело), удалить. */
function rowActs(t, today) {
  const b = (act, label, cls = '') => '<button type="button"' + (cls ? ' class="' + cls + '"' : '') + ' data-act="' + act + '" data-tid="' + t.id + '">' + label + '</button>';
  let h = '';
  if (t.sh) h += t.who === account.myId() ? b('share', 'Отдать в общие') : b('mine', 'Беру на себя', 'take');
  if (today || t.kind === 'once') h += b('tomorrow', 'На завтра');
  h += b('del', 'Удалить', 'danger');
  return '<span class="row-acts">' + h + '</span>';
}
function rowAction(act, tid) {
  const t = state.tasks.find(x => x.id === tid); if (!t) return;
  if (act === 'mine') undoable('«' + t.name + '» теперь ваше дело', () => { t.who = account.myId(); });
  if (act === 'share') undoable('«' + t.name + '» снова общее: сделает любой из вас', () => { t.who = 'any'; });
  if (act === 'del') undoable('«' + t.name + '» удалено', () => deleteTask(t));
  if (act === 'tomorrow') undoable('«' + t.name + '» перенесено на завтра', () => {
    if (t.kind === 'once') t.date = addDays(t.date, 1); else state.hide[t.id] = true;
  });
}
$('reset-btn').onclick = () => { state = Object.assign(freshState(), state.sync ? { sync: state.sync } : {}); offset = 0; render(); show('plan'); };

// ---------- установка на телефон (Android, Chrome) ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('install-card').hidden = false; });
window.addEventListener('appinstalled', () => { installEvt = null; $('install-card').hidden = true; });
$('install-btn').onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  try { await installEvt.userChoice; } catch (e) { /* закрыли окно */ }
  installEvt = null; $('install-card').hidden = true;
};
$('install-later').onclick = () => { $('install-card').hidden = true; };

// ---------- надиктовать задачи ----------
let draft = [];
const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg>';
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
function openDictation() {
  $('dict-text').value = ''; draft = []; renderDraft();
  $('dict-mic').hidden = !Speech;
  $('dict-hint').textContent = Speech
    ? 'Нажмите на микрофон и говорите. Можно и напечатать.'
    : 'Нажмите на микрофон на клавиатуре телефона и говорите, или напечатайте.';
  $('dict-sheet').hidden = false;
  if (!Speech) $('dict-text').focus();
}
function stopMic() { listening = false; $('dict-mic').classList.remove('on'); $('dict-mic').innerHTML = MIC + '<span>Говорить</span>'; if (rec) try { rec.stop(); } catch (e) { /* уже остановлен */ } }
$('dict-mic').onclick = () => {
  if (listening) { stopMic(); return; }
  rec = new Speech(); rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = true;
  const base = $('dict-text').value ? $('dict-text').value.replace(/\s*$/, '. ') : '';
  rec.onresult = e => { let txt = ''; for (const r of e.results) txt += r[0].transcript; $('dict-text').value = base + txt; };
  rec.onend = () => { if (listening) stopMic(); parseNow(); };
  rec.onerror = () => stopMic();
  try { rec.start(); listening = true; $('dict-mic').classList.add('on'); $('dict-mic').innerHTML = '<span>■ Остановить</span>'; } catch (e) { stopMic(); }
};
function parseNow() {
  draft = parseDictation($('dict-text').value, todayISO(), state.tasks, newId);
  renderDraft();
}
function renderDraft() {
  const kindName = { daily: 'Повседневная', variable: 'Вариативная', once: 'Разовая', someday: 'Когда-нибудь' };
  $('dict-preview').innerHTML = draft.map((t, i) => '<div class="trow"><div><div class="tname">' + esc(t.name) + '<span class="kind">' + kindName[t.kind] + '</span></div><div class="meta">' + describe(t, state.tasks.concat(draft)) + '</div></div><button type="button" class="ghost" data-drop="' + i + '" aria-label="Убрать">✕</button></div>').join('');
  $('dict-add').hidden = !draft.length;
  $('dict-add').textContent = 'Добавить ' + draft.length + ' ' + (draft.length === 1 ? 'задачу' : draft.length < 5 ? 'задачи' : 'задач');
  $('dict-empty').hidden = !!draft.length || !$('dict-text').value.trim();
}
let parseTimer = null;
$('dict-text').addEventListener('input', () => { clearTimeout(parseTimer); parseTimer = setTimeout(parseNow, 400); });
$('dict-preview').addEventListener('click', e => { const b = e.target.closest('[data-drop]'); if (b) { draft.splice(+b.dataset.drop, 1); renderDraft(); } });
$('dict-add').onclick = () => { state.tasks.push(...draft); draft = []; stopMic(); $('dict-sheet').hidden = true; render(); };
$('dict-close').onclick = () => { stopMic(); $('dict-sheet').hidden = true; };

// ---------- быстрая диктовка: нажал — говоришь, нажал ещё раз — дела добавлены ----------
const buzz = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* нет вибрации */ } };
let vRec = null, vOn = false, vFinal = '', vShown = 0, vDoneTimer = null;
function voiceStart() {
  if (!Speech) { openDictation(); return; } // нет распознавания речи — окно с вводом текста
  vOn = true; vFinal = ''; vShown = 0;
  $('voice-text').textContent = ''; $('voice-ov').hidden = false;
  $('dict-btn-plan').setAttribute('aria-pressed', 'true'); $('dict-btn-plan').setAttribute('aria-label', 'Закончить диктовку');
  buzz(20);
  setTimeout(listen, 80); // вибрация отдельно от записи: моторчик шумит прямо у микрофона
}
function listen() {
  const base = vFinal;
  vRec = new Speech(); vRec.lang = 'ru-RU'; vRec.interimResults = true; vRec.continuous = true;
  vRec.onresult = e => {
    let fin = '', interim = '';
    for (const r of e.results) { if (r.isFinal) fin += r[0].transcript + ' '; else interim += r[0].transcript; }
    vFinal = base + fin;
    const shown = (vFinal + interim).replace(/\s+/g, ' ').trim();
    $('voice-text').textContent = shown;
    // кнопка пульсирует в такт словам. Вибрации во время записи нет: моторчик шумит у микрофона,
    // и телефон хуже разбирает речь
    const grow = shown.length - vShown;
    if (grow > 0) { $('dict-btn-plan').classList.add('beat'); setTimeout(() => $('dict-btn-plan').classList.remove('beat'), 120); }
    vShown = shown.length;
  };
  vRec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { vOn = false; voiceFinish(); toast('Нет доступа к микрофону. Разрешите его приложению в настройках телефона.'); }
  };
  // телефон сам останавливает запись после паузы: пока не нажали «стоп», слушаем дальше
  vRec.onend = () => { if (vOn) { try { listen(); } catch (err) { vOn = false; voiceFinish(); } } else voiceFinish(); };
  try { vRec.start(); } catch (e) { /* уже слушает */ }
}
function voiceStop() {
  vOn = false;
  try { vRec.stop(); } catch (e) { /* уже остановлен */ }
  clearTimeout(vDoneTimer); vDoneTimer = setTimeout(voiceFinish, 1500); // если телефон не сообщил об остановке
}
function voiceFinish() {
  clearTimeout(vDoneTimer);
  if ($('voice-ov').hidden) return;
  $('voice-ov').hidden = true;
  $('dict-btn-plan').setAttribute('aria-pressed', 'false'); $('dict-btn-plan').setAttribute('aria-label', 'Надиктовать дела');
  const text = $('voice-text').textContent.trim();
  buzz([12, 50, 12]);
  if (!text) return;
  const added = parseDictation(text, todayISO(), state.tasks, newId);
  if (!added.length) { toast('Не понял ни одного дела. Попробуйте: «купить продукты в 18:00».'); return; }
  state.tasks.push(...added); render();
  const ids = new Set(added.map(t => t.id));
  toast('Добавлено: ' + added.map(t => t.name).join(', '), () => { state.tasks = state.tasks.filter(t => !ids.has(t.id)); render(); });
}
$('dict-btn-plan').onclick = () => { if (vOn) voiceStop(); else voiceStart(); };

let toastTimer = null, toastUndo = null;
function toast(text, undo) {
  $('toast-text').textContent = text;
  toastUndo = undo || null; $('toast-undo').hidden = !undo;
  $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, undo ? 7000 : 4000);
}
$('toast-undo').onclick = () => { if (toastUndo) toastUndo(); toastUndo = null; $('toast').hidden = true; };

// ---------- запуск ----------
notify.init(applyAction);
account.init({ getState: () => state, save, render, roll: rollDay });
// ответ из уведомления, если приложение открыли нажатием на него
const params = new URLSearchParams(location.search);
if (params.get('key') && params.get('action')) {
  applyAction(params.get('key'), params.get('action'), params.get('day'));
  history.replaceState(null, '', location.pathname);
}
render();
// раз в минуту обновляем план: карточки «Вы сделали?» и смена дня
setInterval(render, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { notify.drainInbox(); render(); } });
