import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDay, isDue, dayTypeOf, setDone, setSkipped, pendingChecks, keyOf, fmt, toMin, addDays } from '../js/scheduler.js';
import { sampleTasks } from '../js/sample.js';

const TUE = '2026-11-17', SAT = '2026-11-21';
const mk = (today = TUE) => ({
  tasks: sampleTasks(today),
  times: { weekday: { wake: '07:00', sleep: '23:00' }, weekend: { wake: '09:00', sleep: '23:30' } },
  done: { date: today, ids: {} }, skip: {}, notified: {},
});
const byName = (plan, n) => plan.items.find(i => i.name === n);
const overlaps = items => {
  const hands = items.filter(i => i.type === 'task' || i.type === 'fixed').sort((a, b) => a.s - b.s);
  for (let i = 1; i < hands.length; i++) if (hands[i].s < hands[i - 1].e) return [hands[i - 1].name, hands[i].name];
  return null;
};

test('выходные и будни определяются по дате', () => {
  assert.equal(dayTypeOf(TUE), 'weekday');
  assert.equal(dayTypeOf(SAT), 'weekend');
  assert.equal(dayTypeOf('2026-11-22'), 'weekend');
});

test('в будни есть работа, в выходные нет, зато есть прогулка и свой подъём', () => {
  const st = mk();
  const tue = buildDay(st, TUE, TUE), sat = buildDay(st, SAT, TUE);
  assert.ok(byName(tue, 'Работа'));
  assert.equal(byName(sat, 'Работа'), undefined);
  assert.ok(byName(sat, 'Прогулка'));
  assert.equal(sat.items[0].s, toMin('09:00'));
});

test('цепочка: сдвинули дорогу на работу, работа и дорога домой сдвинулись следом', () => {
  const st = mk();
  st.tasks.find(t => t.name === 'Дорога на работу').fixed = '07:00';
  const p = buildDay(st, TUE, TUE);
  assert.equal(fmt(byName(p, 'Работа').s), '07:30');
  assert.equal(fmt(byName(p, 'Дорога домой').s), '16:30');
  // домашние дела не попадают на время работы
  assert.equal(overlaps(p.items), null);
  // душ и завтрак не помещаются утром и попадают в список «утром не хватает времени»
  assert.deepEqual(p.moved.map(t => t.name).sort(), ['Душ', 'Завтрак']);
});

test('дела не пересекаются, а фоновая задача заканчивается вовремя', () => {
  const p = buildDay(mk(), TUE, TUE);
  assert.equal(overlaps(p.items), null);
  const bg = p.items.find(i => i.type === 'bg' && i.name.startsWith('Стирка'));
  const fin = p.items.find(i => i.name === 'Закончить: стирка');
  assert.ok(fin.s >= bg.e && fin.s - bg.e <= 30, 'развесить бельё в течение 30 минут после стирки');
});

test('вариативная задача появляется, только когда подошёл срок', () => {
  const st = mk();
  const shop = st.tasks.find(t => t.name === 'Купить продукты'); // раз в 5 дней, было 2 дня назад
  assert.equal(isDue(shop, TUE, TUE), false);
  assert.equal(isDue(shop, addDays(TUE, 3), TUE), true);
});

test('«Сделано» двигает дату, «Не сделал» оставляет задачу на завтра', () => {
  const st = mk();
  const wash = st.tasks.find(t => t.name === 'Стирка');
  setDone(st, wash.id, true, TUE);
  assert.equal(wash.last, TUE);
  assert.ok(byName(buildDay(st, TUE, TUE), 'Запустить: стирка'), 'отмеченная сегодня задача остаётся в сегодняшнем плане');
  assert.equal(isDue(wash, addDays(TUE, 1), TUE), false);

  const st2 = mk();
  const clean = st2.tasks.find(t => t.name === 'Уборка квартиры');
  const before = clean.last;
  setSkipped(st2, clean.id, TUE);
  assert.equal(clean.last, before);
  assert.equal(isDue(clean, addDays(TUE, 1), TUE), true);
});

test('напоминание приходит только по прошедшим делам без отметки', () => {
  const st = mk();
  const plan = buildDay(st, TUE, TUE);
  const at = toMin('08:00');
  const pend = pendingChecks(plan, st, at).map(i => i.name);
  assert.ok(pend.includes('Душ'));
  const shower = byName(plan, 'Душ');
  setDone(st, keyOf(shower), true, TUE);
  assert.ok(!pendingChecks(plan, st, at).map(i => i.name).includes('Душ'));
  setSkipped(st, keyOf(byName(plan, 'Завтрак')), TUE);
  assert.ok(!pendingChecks(plan, st, at).map(i => i.name).includes('Завтрак'));
});

test('календарь: свой рабочий график и ручные отметки на даты', async () => {
  const { typeOfDay } = await import('../js/scheduler.js');
  const st = mk();
  assert.equal(typeOfDay(st, TUE), 'weekday');
  st.dayOverrides = { [TUE]: 'weekend' };
  assert.equal(typeOfDay(st, TUE), 'weekend');
  const p = buildDay(st, TUE, TUE);
  assert.equal(byName(p, 'Работа'), undefined, 'в отмеченный выходной работы нет');
  assert.equal(p.items[0].s, toMin('09:00'), 'и подъём по выходному расписанию');
  st.dayOverrides = { [SAT]: 'weekday' };
  assert.ok(byName(buildDay(st, SAT, TUE), 'Работа'), 'рабочая суббота');
  st.workWeek = [2, 3, 4, 5, 6]; // со вторника по субботу
  st.dayOverrides = {};
  assert.equal(typeOfDay(st, '2026-11-16'), 'weekend');
  assert.equal(typeOfDay(st, SAT), 'weekday');
});

test('убранное на сегодня дело пропадает только из сегодняшнего плана', async () => {
  const { buildDay } = await import('../js/scheduler.js');
  const st = { tasks: [{ id: 'a', name: 'Душ', kind: 'daily', days: 'all', fixed: '', dur: 20, prio: 3, when: 'any', bg: 0, fin: 0 }],
    times: { weekday: { wake: '07:00', sleep: '23:00' }, weekend: { wake: '09:00', sleep: '23:00' } }, done: { ids: {} }, hide: { a: true } };
  const has = d => buildDay(st, d, '2026-11-17').items.some(i => i.task && i.task.id === 'a');
  assert.equal(has('2026-11-17'), false);
  assert.equal(has('2026-11-18'), true);
});

test('сегодня план живой: новое ставится от текущего времени, начатое остаётся на месте', async () => {
  const { buildDay } = await import('../js/scheduler.js');
  const T = (id, name, dur, when = 'any', extra = {}) => ({ id, name, kind: 'daily', days: 'all', fixed: '', dur, prio: 2, when, bg: 0, fin: 0, ...extra });
  const st = { tasks: [T('a', 'Уборка', 60), T('b', 'Завтрак', 20, 'morning'), T('c', 'Чтение', 30)],
    times: { weekday: { wake: '07:00', sleep: '23:00' }, weekend: { wake: '07:00', sleep: '23:00' } }, done: { ids: {} }, skip: {}, pin: {} };
  const D = '2026-11-17', now = 16 * 60 + 41;
  const at = (p, id) => p.items.find(i => i.task && i.task.id === id).s;
  let p = buildDay(st, D, D, now);
  assert.equal(at(p, 'a'), 16 * 60 + 45, 'не в прошлом, а с ближайших 5 минут');
  assert.equal(at(p, 'b'), 7 * 60, 'утреннее дело остаётся утром, чтобы спросить о нём');
  assert.equal(p.moved.length, 0);
  assert.equal(p.items.filter(i => i.type === 'free').every(i => i.s >= 16 * 60 + 45), true, 'свободное время только впереди');
  // уборка началась — закрепили, время идёт дальше, а она не прыгает
  st.pin = { a: 16 * 60 + 45 };
  p = buildDay(st, D, D, 17 * 60 + 10);
  assert.equal(at(p, 'a'), 16 * 60 + 45);
  // отмеченное сделанным не съедает время впереди
  st.done.ids = { c: '' };
  p = buildDay(st, D, D, 17 * 60 + 10);
  assert.ok(at(p, 'c') < 17 * 60 + 10);
  // без текущего времени (другие дни) — как раньше, от подъёма
  assert.equal(at(buildDay(st, '2026-11-18', D), 'a') < 12 * 60, true);
});

test('удалили дело — освободившееся окно сразу занимает то, что не помещалось', async () => {
  const { buildDay } = await import('../js/scheduler.js');
  const T = (id, dur, fixed = '') => ({ id, name: id, kind: 'daily', days: 'all', fixed, dur, prio: 2, when: 'any', bg: 0, fin: 0 });
  const st = { tasks: [T('big', 300, '17:00'), T('new', 60)],
    times: { weekday: { wake: '07:00', sleep: '22:00' }, weekend: { wake: '07:00', sleep: '22:00' } }, done: { ids: {} }, skip: {}, pin: {} };
  const D = '2026-11-17', now = 16 * 60 + 40;
  assert.equal(buildDay(st, D, D, now).unplaced.length, 1);
  st.tasks = st.tasks.filter(t => t.id !== 'big');
  const p = buildDay(st, D, D, now);
  assert.equal(p.unplaced.length, 0);
  assert.equal(p.items.find(i => i.task && i.task.id === 'new').s, 16 * 60 + 40);
});

test('убрали на сегодня начало цепочки — следующие дела остаются на своём времени', async () => {
  const { buildDay } = await import('../js/scheduler.js');
  const st = { tasks: [
    { id: 'r', name: 'Дорога', kind: 'daily', days: 'all', fixed: '08:30', dur: 30, prio: 3, when: 'any', bg: 0, fin: 0 },
    { id: 'w', name: 'Работа', kind: 'daily', days: 'all', fixed: '', after: 'r', dur: 540, prio: 3, when: 'any', bg: 0, fin: 0 }],
    times: { weekday: { wake: '07:00', sleep: '23:00' }, weekend: { wake: '07:00', sleep: '23:00' } }, done: { ids: {} }, hide: { r: true } };
  const p = buildDay(st, '2026-11-17', '2026-11-17', 20 * 60);
  assert.equal(p.items.find(i => i.task && i.task.id === 'w').s, 9 * 60);
  assert.ok(!p.items.find(i => i.task && i.task.id === 'r'));
  assert.equal(p.unplaced.length, 0);
});
