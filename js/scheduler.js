// Логика построения плана дня. Чистые функции без DOM, чтобы их можно было тестировать.

export const DAY = 86400000;
export const localISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return localISO(d); };
export const daysBetween = (fromISO, toISO) => Math.round((Date.parse(toISO + 'T12:00') - Date.parse(fromISO + 'T12:00')) / DAY);
export const dayTypeOf = iso => { const g = new Date(iso + 'T12:00').getDay(); return (g === 0 || g === 6) ? 'weekend' : 'weekday'; };
/** Рабочие дни недели по умолчанию: 1 = понедельник … 5 = пятница, 0 = воскресенье. */
export const DEFAULT_WORK_WEEK = [1, 2, 3, 4, 5];
/**
 * Рабочий это день или выходной с учётом настроек: сначала отметка в календаре на эту дату,
 * затем обычная рабочая неделя пользователя.
 */
export function typeOfDay(state, iso) {
  const o = state.dayOverrides && state.dayOverrides[iso];
  if (o) return o;
  const week = state.workWeek || DEFAULT_WORK_WEEK;
  return week.includes(new Date(iso + 'T12:00').getDay()) ? 'weekday' : 'weekend';
}
export const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export function human(m) { const h = Math.floor(m / 60), r = m % 60; if (!h) return r + ' мин'; return r ? h + ' ч ' + r + ' мин' : h + ' ч'; }

export const WIN = { morning: [null, 12 * 60], day: [12 * 60, 17 * 60], evening: [17 * 60, null], any: [null, null] };
export const WHEN_TXT = { morning: 'утром', day: 'днём', evening: 'вечером', any: 'когда угодно' };

/** Ключ отметки для пункта плана: id задачи, а для «закончить» ещё и суффикс. */
export const keyOf = it => it.task.id + (it.sub ? ':' + it.sub : '');

/**
 * Попадает ли задача в план дня `dayISO`.
 * `doneToday` — отметки за сегодня: отмеченная сегодня вариативная задача остаётся в сегодняшнем плане.
 */
export function isDue(t, dayISO, todayISO, doneToday = {}, dayType = dayTypeOf(dayISO)) {
  if (t.kind === 'once') return t.date === dayISO;
  if (t.days && t.days.startsWith('dow:')) {
    if (!t.days.slice(4).split(',').map(Number).includes(new Date(dayISO + 'T12:00').getDay())) return false;
  } else if (t.days && t.days !== 'all' && t.days !== dayType) return false;
  if (t.kind !== 'variable') return true;
  if (dayISO === todayISO && doneToday[t.id] !== undefined) return true;
  return daysBetween(t.last, dayISO) >= t.every;
}

/**
 * Строит план дня.
 * state: { tasks, times: {weekday:{wake,sleep}, weekend:{wake,sleep}}, done:{ids} }
 * Возвращает { items, unplaced, moved, free }.
 */
export function buildDay(state, dayISO, todayISO) {
  const tasks = state.tasks;
  const doneToday = (state.done && state.done.ids) || {};
  const dayType = typeOfDay(state, dayISO);
  const due = t => isDue(t, dayISO, todayISO, doneToday, dayType);
  const tm = state.times[dayType];
  const wake = toMin(tm.wake), sleep = toMin(tm.sleep);
  const busy = [], items = [], unplaced = [], moved = [];
  const clash = (s, e) => busy.some(b => s < b[1] && e > b[0]);
  const find = (len, from, to) => { for (let t = from; t + len <= to; t += 5) { if (!clash(t, t + len)) return t; } return null; };

  // 1. Точное время и цепочки «сразу после»
  const startOf = (t, depth = 0) => {
    if (depth > 20) return null;
    if (t.after) {
      const p = tasks.find(x => x.id === t.after);
      if (p && due(p)) { const ps = startOf(p, depth + 1); return ps === null ? null : ps + p.dur; }
    }
    return t.fixed ? toMin(t.fixed) : null;
  };
  const anchored = t => (t.fixed || t.after) && startOf(t) !== null;
  tasks.filter(t => anchored(t) && due(t)).forEach(t => {
    const s = startOf(t); busy.push([s, s + t.dur]);
    const p = t.after && tasks.find(x => x.id === t.after);
    items.push({ s, e: s + t.dur, type: 'fixed', name: t.name, why: p ? 'Сразу после: ' + p.name.toLowerCase() : 'Точное время', task: t });
  });

  // 2. Гибкие задачи: важные первыми, из равных первыми фоновые, затем самые просроченные
  const flex = tasks.filter(t => !anchored(t) && due(t))
    .map(t => ({ t, over: t.kind === 'variable' ? daysBetween(t.last, dayISO) - t.every : 0 }));
  flex.sort((a, b) => (b.t.prio - a.t.prio) || ((b.t.bg > 0) - (a.t.bg > 0)) || (b.over - a.over));
  flex.forEach(({ t, over }) => {
    const w = WIN[t.when] || WIN.any;
    const lo = Math.max(wake, w[0] ?? wake), hi = Math.min(sleep, w[1] ?? sleep);
    const tryRange = (a, b) => {
      for (let s = a; s + t.dur <= b; s += 5) {
        if (clash(s, s + t.dur)) continue;
        if (t.bg > 0) {
          const bgEnd = s + t.dur + t.bg;
          busy.push([s, s + t.dur]);
          // фоновую задачу запускаем так, чтобы её можно было закончить не позже чем через 30 минут
          const f = t.fin > 0 ? find(t.fin, bgEnd, Math.min(bgEnd + 30, sleep)) : bgEnd;
          busy.pop();
          if (f === null) continue;
          return { s, f };
        }
        return { s };
      }
      return null;
    };
    let fallback = false;
    let r = tryRange(lo, hi);
    if (!r && (lo !== wake || hi !== sleep)) { r = tryRange(wake, sleep); fallback = !!r; if (r) moved.push(t); }
    if (!r) { unplaced.push(t); return; }
    const why = [];
    if (t.kind === 'variable') why.push(over > 0 ? 'Просрочено на ' + over + ' дн.' : 'Подошёл срок: раз в ' + t.every + ' дн.');
    if (t.when !== 'any') why.push(fallback ? 'Не нашлось места ' + WHEN_TXT[t.when] + ', поставлено в ближайшее окно' : 'Удобнее ' + WHEN_TXT[t.when]);
    if (t.bg > 0) why.push('Запускаем пораньше: дальше ' + human(t.bg) + ' работает само');
    busy.push([r.s, r.s + t.dur]);
    items.push({ s: r.s, e: r.s + t.dur, type: 'task', name: t.bg > 0 ? 'Запустить: ' + t.name.toLowerCase() : t.name, why: why.join(' · '), task: t, par: t.bg > 0 });
    if (t.bg > 0) {
      const bs = r.s + t.dur, be = bs + t.bg;
      items.push({ s: bs, e: be, type: 'bg', name: t.name + ' идёт сама', why: 'Можно заниматься другими делами' });
      if (t.fin > 0) {
        busy.push([r.f, r.f + t.fin]);
        items.push({ s: r.f, e: r.f + t.fin, type: 'task', name: 'Закончить: ' + t.name.toLowerCase(), why: 'Сразу после того, как машина закончит', task: t, sub: 'fin' });
      }
    }
  });

  // 3. Свободные окна от 15 минут
  const sorted = busy.filter(b => b[1] > wake && b[0] < sleep).sort((a, b) => a[0] - b[0]);
  let cur = wake, free = 0;
  const gap = (a, b) => { items.push({ s: a, e: b, type: 'free', name: 'Свободное время', why: human(b - a) + ' для себя' }); free += b - a; };
  sorted.forEach(b => { if (b[0] - cur >= 15) gap(cur, b[0]); cur = Math.max(cur, b[1]); });
  if (sleep - cur >= 15) gap(cur, sleep);
  items.sort((a, b) => a.s - b.s || (a.type === 'bg') - (b.type === 'bg'));
  return { items, unplaced, moved, free };
}

/** Пункты сегодняшнего плана, время которых прошло, а отметки нет. */
export function pendingChecks(plan, state, nowMin) {
  return plan.items.filter(it => it.type === 'task' && it.e <= nowMin
    && state.done.ids[keyOf(it)] === undefined && !state.skip[keyOf(it)]);
}

/** Отметить пункт: on=true «сделано», on=false снять отметку. Для вариативной задачи двигает дату «последний раз». */
export function setDone(state, key, on, todayISO) {
  const tid = key.split(':')[0];
  const t = state.tasks.find(x => x.id === tid);
  delete state.skip[key];
  const was = state.done.ids[key] !== undefined;
  if (on === was) return;
  const main = t && t.kind === 'variable' && !key.includes(':');
  if (!on) { if (main) t.last = state.done.ids[key]; delete state.done.ids[key]; }
  else { state.done.ids[key] = t && t.last ? t.last : ''; if (main) t.last = todayISO; }
}

/** «Не сделал»: снимает отметку и помечает пропуск. Вариативная задача останется в плане завтра. */
export function setSkipped(state, key, todayISO) {
  setDone(state, key, false, todayISO);
  state.skip[key] = true;
}
