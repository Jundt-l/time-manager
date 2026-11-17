import { localISO, addDays, daysBetween, dayTypeOf, fmt, human, WHEN_TXT, keyOf, buildDay, pendingChecks, setDone, setSkipped } from './scheduler.js';
import { sampleTasks, newId } from './sample.js';
import * as notify from './notify.js';

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
  const day = viewISO(), today = offset === 0, dt = dayTypeOf(day);
  const { items, unplaced, free, moved } = buildDay(state, day, todayISO());
  $('daytype').textContent = dt === 'weekend' ? 'Выходной' : 'Будний день';
  $('daytype').className = 'chip' + (dt === 'weekend' ? ' weekend' : '');
  $('to-today').hidden = today;
  document.querySelectorAll('.dt-label').forEach(e => { e.textContent = dt === 'weekend' ? 'в выходные' : 'в будни'; });
  $('wake').value = state.times[dt].wake; $('sleep').value = state.times[dt].sleep;
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
    if (t.days === 'weekday') meta += ' · будни'; else if (t.days === 'weekend') meta += ' · выходные';
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
  render();
}
$('timeline').addEventListener('click', e => {
  const b = e.target.closest('.check'); if (!b) return;
  const key = b.dataset.key;
  setDone(state, key, state.done.ids[key] === undefined, todayISO());
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
['wake', 'sleep'].forEach(k => $(k).addEventListener('change', e => { if (e.target.value) { state.times[dayTypeOf(viewISO())][k] = e.target.value; render(); } }));
$('notify-btn').onclick = async () => { await notify.requestPermission(); render(); };

// ---------- вкладки ----------
const tabs = { plan: 'view-plan', tasks: 'view-tasks', idea: 'view-idea' };
function show(name) {
  Object.entries(tabs).forEach(([k, v]) => { $(v).hidden = k !== name; $('tab-' + k).setAttribute('aria-selected', k === name); });
  window.scrollTo(0, 0);
}
Object.keys(tabs).forEach(k => $('tab-' + k).addEventListener('click', () => show(k)));

// ---------- барабан времени, как в будильнике ----------
const ROW = 36;
// Барабан замкнутый: после 23 идёт 00, после 59 снова 00.
// Значения повторяются REPS раз, а после остановки барабан незаметно возвращается в середину.
const REPS = 9, MID = Math.floor(REPS / 2);
const DRUMS = { 'drum-h': 24, 'drum-m': 60 };
const fill = (el, n) => {
  const one = Array.from({ length: n }, (_, i) => '<div>' + String(i).padStart(2, '0') + '</div>').join('');
  el.innerHTML = one.repeat(REPS);
};
Object.entries(DRUMS).forEach(([idd, n]) => fill($(idd), n));
const drumIdx = idd => Math.round($(idd).scrollTop / ROW);
const drumVal = idd => ((drumIdx(idd) % DRUMS[idd]) + DRUMS[idd]) % DRUMS[idd];
const drumSet = (idd, v) => { $(idd).scrollTop = (MID * DRUMS[idd] + v) * ROW; };
function setFixed(v) { $('f-fixed').value = v; $('f-fixed-btn').textContent = v || 'Не задано'; }
function tick() { try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) { /* нет вибрации */ } }
const readWheel = () => String(drumVal('drum-h')).padStart(2, '0') + ':' + String(drumVal('drum-m')).padStart(2, '0');
Object.keys(DRUMS).forEach(idd => {
  const el = $(idd);
  let last = -1, settle = null;
  el.addEventListener('scroll', () => {
    const i = drumIdx(idd);
    if (i !== last) { if (last !== -1) tick(); last = i; if (!$('wheel-box').hidden) { setFixed(readWheel()); $('f-after').value = ''; } }
    clearTimeout(settle);
    settle = setTimeout(() => {
      // вернуть в среднюю копию, если ушли далеко к краю
      const n = DRUMS[idd], copy = Math.floor(drumIdx(idd) / n);
      if (copy !== MID) { drumSet(idd, drumVal(idd)); last = drumIdx(idd); }
    }, 150);
  }, { passive: true });
});
$('f-fixed-btn').onclick = () => {
  const box = $('wheel-box'); box.hidden = !box.hidden; if (box.hidden) return;
  const v = $('f-fixed').value || '08:00'; const [h, m] = v.split(':').map(Number);
  drumSet('drum-h', h); drumSet('drum-m', m); setFixed(v); $('f-after').value = '';
};
$('wheel-ok').onclick = () => { $('wheel-box').hidden = true; };
$('wheel-clear').onclick = () => { setFixed(''); $('wheel-box').hidden = true; };
$('f-after').addEventListener('change', e => { if (e.target.value) { setFixed(''); $('wheel-box').hidden = true; } });

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
