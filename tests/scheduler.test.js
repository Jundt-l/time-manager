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
