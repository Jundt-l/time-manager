// Синхронизация без конфликтов. Состояние приложения раскладывается на записи
// {ключ: {u: время изменения в мс, v: значение или null, если удалено}}.
// Личные записи живут в документе пользователя, общие дела пары — в документе пары.
// Две копии сливаются по каждой записи отдельно: побеждает более свежая. Чистые функции, без DOM.
import { DEFAULT_WORK_WEEK, addDays } from './scheduler.js';

/** JSON с ключами по алфавиту, чтобы одинаковые объекты давали одинаковую строку. */
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/** Разложить состояние на личные (mine) и общие (ours) значения. Отметки берутся только за текущий день. */
export function split(state) {
  const mine = {}, ours = {}, shared = new Set();
  for (const t of state.tasks) {
    const { sh, ...rest } = t;
    if (sh) { shared.add(t.id); ours['task:' + t.id] = rest; } else { delete rest.who; mine['task:' + t.id] = rest; }
  }
  mine.times = state.times;
  mine.workWeek = state.workWeek || DEFAULT_WORK_WEEK;
  for (const [iso, v] of Object.entries(state.dayOverrides || {})) mine['ov:' + iso] = v;
  const d = state.done.date, marks = {};
  for (const [k, prev] of Object.entries(state.done.ids)) marks[k] = { done: prev };
  for (const [k, on] of Object.entries(state.skip || {})) if (on) marks[k] = { skip: 1 };
  for (const [k, on] of Object.entries(state.hide || {})) if (on) marks[k] = { hide: 1 };
  for (const [k, v] of Object.entries(marks)) (shared.has(k.split(':')[0]) ? ours : mine)['mark:' + d + ':' + k] = v;
  return { mine, ours };
}

/**
 * Проставить время изменения: новым и изменённым значениям — now, пропавшим — запись об удалении.
 * Отметки других дней не трогаем: их просто нет в текущем состоянии.
 */
export function stamp(prev = {}, cur, now, today) {
  const out = {};
  let changed = false;
  for (const [k, v] of Object.entries(cur)) {
    const p = prev[k];
    if (p && p.v !== null && stable(p.v) === stable(v)) out[k] = p;
    else { out[k] = { u: now, v }; changed = true; }
  }
  for (const [k, p] of Object.entries(prev)) {
    if (k in out) continue;
    const otherDay = k.startsWith('mark:') && k.slice(5, 15) !== today;
    if (p.v === null || otherDay) out[k] = p;
    else { out[k] = { u: now, v: null }; changed = true; }
  }
  return { entries: out, changed };
}

/** Слить две копии: по каждой записи берём более свежую. */
export function merge(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, e] of Object.entries(b)) {
    const x = out[k];
    if (!x || e.u > x.u || (e.u === x.u && stable(e) > stable(x))) out[k] = e;
  }
  return out;
}

/** Убрать старые записи об удалении (старше 45 дней) и отметки старше трёх дней. */
export function prune(entries, now, today) {
  const out = {}, oldDay = addDays(today, -3);
  for (const [k, e] of Object.entries(entries)) {
    if (e.v === null && e.u < now - 45 * 86400000) continue;
    if (k.startsWith('mark:') && k.slice(5, 15) < oldDay) continue;
    out[k] = e;
  }
  return out;
}

const live = (entries, prefix) => Object.entries(entries).filter(([k, e]) => k.startsWith(prefix) && e.v !== null);
const byCreation = (a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Собрать состояние из записей. Меняет state на месте: задачи, расписание, рабочие дни,
 * отметки за текущий день. Остальное (например, показанные уведомления) остаётся как было.
 */
export function apply(state, mine, ours) {
  const mineTasks = live(mine, 'task:').map(([, e]) => ({ ...e.v }));
  const ourTasks = live(ours, 'task:').map(([, e]) => ({ ...e.v, sh: 1 }));
  state.tasks = mineTasks.concat(ourTasks).sort(byCreation);
  if (mine.times && mine.times.v) state.times = mine.times.v;
  if (mine.workWeek && mine.workWeek.v) state.workWeek = mine.workWeek.v;
  state.dayOverrides = Object.fromEntries(live(mine, 'ov:').map(([k, e]) => [k.slice(3), e.v]));
  const d = state.done.date, pre = 'mark:' + d + ':';
  state.done.ids = {}; state.skip = {}; state.hide = {};
  for (const [k, e] of live(mine, pre).concat(live(ours, pre))) {
    const key = k.slice(pre.length);
    if (e.v.hide) state.hide[key] = true;
    else if (e.v.skip) state.skip[key] = true; else state.done.ids[key] = e.v.done;
  }
  return state;
}
