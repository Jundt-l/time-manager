import { localISO, addDays, daysBetween, typeOfDay, DEFAULT_WORK_WEEK, fmt, human, WHEN_TXT, keyOf, buildDay, pendingChecks, setDone, setSkipped } from './scheduler.js';
import { sampleTasks, newId } from './sample.js';
import * as notify from './notify.js';
import { createWheel } from './wheel.js';

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
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ } }
let state = load() || freshState();
function rollDay() {
  if (state.done.date !== todayISO()) { state.done = { date: todayISO(), ids: {} }; state.skip = {}; state.notified = {}; }
  if (!state.notified) state.notified = {};
}
rollDay();
let offset = 0; // 0 = сегодня
const viewISO = () => addDays(todayISO(), offset);

// ---------- план ----------
const CHECK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderPlan() {
  const day = viewISO(), today = offset === 0, dt = typeOfDay(state, day);
  const { items, unplaced, free, moved } = buildDay(state, day, todayISO());
  $('daytype').textContent = dt === 'weekend' ? 'Выходной' : 'Рабочий день';
  $('daytype').className = 'chip' + (dt === 'weekend' ? ' weekend' : '');
  $('to-today').hidden = today;
  document.querySelectorAll('.dt-label').forEach(e => { e.textContent = dt === 'weekend' ? 'в выходные' : 'в рабочие дни'; });
  $('wake').textContent = state.times[dt].wake; $('sleep').textContent = state.times[dt].sleep;
  const dd = new Date(day + 'T12:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  $('today-title').textContent = today ? 'Сегодня, ' + dd : dd.charAt(0).toUpperCase() + dd.slice(1);

  $('st-free').textContent = human(free);
  $('st-count').textContent = items.filter(i => i.type === 'task' || i.type === 'fixed').length;
  $('st-count').nextElementSibling.textContent = today ? 'дел на сегодня' : 'дел в этот день';
  $('st-par').textContent = items.filter(i => i.type === 'bg').length;

  let warn = unplaced.length ? '<div class="unplaced"><b>Не поместилось:</b> ' + unplaced.map(t => esc(t.name)).join(', ') + '. Попробуйте раньше встать или перенести что-то.</div>' : '';
  const mm = moved.filter(t => t.when === 'morning');
  if (mm.length) warn += '<div class="unplaced"><b>Утром не хватает времени:</b> ' + mm.map(t => esc(t.name.toLowerCase())).join(', ') + ' (' + human(mm.reduce((a, t) => a + t.dur, 0)) + '). Поставьте подъём раньше, и план сам перенесёт их на утро.</div>';
  $('unplaced').innerHTML = warn;

  // карточки «Вы сделали…?» внутри приложения
  const pending = today ? pendingChecks({ items }, state, nowMin()) : [];
  $('checks').innerHTML = pending.slice(0, 2).map(it => '<div class="notif" role="alert"><div class="head"><span>Без отметки</span><span>по плану ' + fmt(it.s) + '–' + fmt(it.e) + '</span></div><div class="q">Вы сделали «' + esc(it.name) + '»?</div><div class="acts"><button class="yes" data-yes="' + keyOf(it) + '">✓ Сделано</button><button class="no" data-no="' + keyOf(it) + '">✗ Не сделал</button></div></div>').join('')
    + (pending.length > 2 ? '<div class="note">И ещё ' + (pending.length - 2) + ' без отметки</div>' : '');

  $('timeline').innerHTML = items.map(it => {
    const key = it.task ? keyOf(it) : '';
    const done = today && key && state.done.ids[key] !== undefined;
    const skipped = today && key && state.skip[key];
    const btn = (it.type === 'task' && today) ? '<button class="check" data-key="' + key + '" aria-pressed="' + done + '" aria-label="Готово: ' + esc(it.name) + '">' + CHECK + '</button>' : '<span></span>';
    return '<div class="item ' + it.type + (done ? ' done' : '') + (skipped ? ' skipped' : '') + '"><div class="t">' + fmt(it.s) + '<small>' + fmt(it.e) + '</small></div><div class="body"><div class="name">' + esc(it.name) + (it.par ? '<span class="tag par">параллельно</span>' : '') + (skipped ? '<span class="st">не сделано</span>' : '') + '</div><div class="why">' + esc(it.why) + '</div></div>' + btn + '</div>';
  }).join('');

  if (today) notify.schedule(items, state, nowMin());
}

function renderTasks() {
  const row = t => {
    const p = t.after && state.tasks.find(x => x.id === t.after);
    let meta = human(t.dur) + ' · ' + (p ? 'сразу после «' + esc(p.name) + '»' : t.fixed ? 'в ' + t.fixed : WHEN_TXT[t.when]);
    if (t.days === 'weekday') meta += ' · рабочие дни'; else if (t.days === 'weekend') meta += ' · выходные';
    if (t.bg) meta += ' · фоном ' + human(t.bg);
    if (t.kind === 'variable') {
      const left = t.every - daysBetween(t.last, todayISO());
      meta += ' · раз в ' + t.every + ' дн. · ' + (left <= 0 ? '<span class="due">пора</span>' : 'через ' + left + ' дн.');
    }
    return '<div class="trow"><div><div style="font-weight:600">' + esc(t.name) + '</div><div class="meta">' + meta + '</div></div><button data-edit="' + t.id + '">Изменить</button></div>';
  };
  $('list-daily').innerHTML = state.tasks.filter(t => t.kind === 'daily').map(row).join('') || '<div class="note">Пока нет задач</div>';
  $('list-var').innerHTML = state.tasks.filter(t => t.kind === 'variable').map(row).join('') || '<div class="note">Пока нет задач</div>';
}

function renderNotifyCard() {
  const st = notify.status();
  $('notify-card').hidden = st === 'granted' || (st === 'unsupported' && !notify.needsInstallOnIOS());
  $('notify-ios').hidden = !notify.needsInstallOnIOS();
  $('notify-denied').hidden = st !== 'denied';
  $('notify-btn').hidden = st === 'denied' || notify.needsInstallOnIOS();
}

function render() { rollDay(); renderPlan(); renderTasks(); renderNotifyCard(); save(); }

// ---------- отметки ----------
export function applyAction(key, action) {
  rollDay();
  if (action === 'done') setDone(state, key, true, todayISO());
  else if (action === 'skip') setSkipped(state, key, todayISO());
  notify.dismiss(key);
  render();
}
$('timeline').addEventListener('click', e => {
  const b = e.target.closest('.check'); if (!b) return;
  const key = b.dataset.key;
  setDone(state, key, state.done.ids[key] === undefined, todayISO());
  notify.dismiss(key);
  render();
});
$('checks').addEventListener('click', e => {
  const y = e.target.closest('[data-yes]'), n = e.target.closest('[data-no]');
  if (y) applyAction(y.dataset.yes, 'done');
  if (n) applyAction(n.dataset.no, 'skip');
});
$('prev-day').onclick = () => { offset--; render(); };
$('next-day').onclick = () => { offset++; render(); };
$('to-today').onclick = () => { offset = 0; render(); };
$('notify-btn').onclick = async () => { await notify.requestPermission(); render(); };

// ---------- вкладки ----------
const tabs = { plan: 'view-plan', tasks: 'view-tasks', idea: 'view-idea' };
function show(name) {
  Object.entries(tabs).forEach(([k, v]) => { $(v).hidden = k !== name; $('tab-' + k).setAttribute('aria-selected', k === name); });
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
$('wake').onclick = () => openTime('wake');
$('sleep').onclick = () => openTime('sleep');
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
  $('f-var-box').hidden = k !== 'variable';
}
$('f-kind-daily').onclick = () => setKind('daily');
$('f-kind-var').onclick = () => setKind('variable');
function openForm(t) {
  editing = t || null;
  $('form-title').textContent = t ? 'Изменить задачу' : 'Новая задача';
  $('del-btn').hidden = !t;
  $('f-name').value = t ? t.name : ''; $('f-dur').value = t ? t.dur : 30; $('f-prio').value = t ? t.prio : 2;
  $('f-when').value = t ? t.when : 'any'; $('f-days').value = t && t.days ? t.days : 'all';
  setFixed(t ? t.fixed : ''); $('wheel-box').hidden = true;
  $('f-every').value = t && t.every ? t.every : 7; $('f-ago').value = t && t.last ? daysBetween(t.last, todayISO()) : 0;
  const opts = state.tasks.filter(x => !t || x.id !== t.id).map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
  $('f-after').innerHTML = '<option value="">Не привязана</option>' + opts; $('f-after').value = t && t.after ? t.after : '';
  $('f-bg').value = t ? t.bg : 0; $('f-fin').value = t ? t.fin : 0;
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
  const t = editing || { id: newId() };
  Object.assign(t, {
    name: $('f-name').value.trim() || 'Без названия', kind, dur: Math.max(5, n('f-dur')), prio: +$('f-prio').value,
    when: $('f-when').value, days: $('f-days').value,
    fixed: $('f-after').value ? '' : $('f-fixed').value, after: $('f-after').value || '', bg: n('f-bg'), fin: n('f-fin'),
  });
  if (kind === 'variable') { t.every = Math.max(1, n('f-every')); t.last = addDays(todayISO(), -n('f-ago')); }
  if (!editing) state.tasks.push(t);
  $('sheet').hidden = true; render();
});
let delArmed = false;
$('del-btn').onclick = () => {
  if (!delArmed) { delArmed = true; $('del-btn').textContent = 'Точно удалить?'; setTimeout(() => { delArmed = false; $('del-btn').textContent = 'Удалить'; }, 3000); return; }
  delArmed = false; $('del-btn').textContent = 'Удалить';
  state.tasks.forEach(t => { if (t.after === editing.id) { t.after = ''; if (!t.fixed && editing.fixed) t.fixed = editing.fixed; } });
  state.tasks = state.tasks.filter(t => t !== editing);
  $('sheet').hidden = true; render();
};
$('reset-btn').onclick = () => { state = freshState(); offset = 0; render(); show('plan'); };

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

// ---------- запуск ----------
notify.init(applyAction);
// ответ из уведомления, если приложение открыли нажатием на него
const params = new URLSearchParams(location.search);
if (params.get('key') && params.get('action')) {
  applyAction(params.get('key'), params.get('action'));
  history.replaceState(null, '', location.pathname);
}
render();
// раз в минуту обновляем план: карточки «Вы сделали?» и смена дня
setInterval(render, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { notify.drainInbox(); render(); } });
