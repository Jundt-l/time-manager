import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDictation, splitPhrases } from '../js/voice.js';
import { buildDay, isDue } from '../js/scheduler.js';

const TODAY = '2026-11-17'; // вторник
const parse = (txt, ex = []) => parseDictation(txt, TODAY, ex).map(({ id, ...t }) => t);
const one = (txt, ex) => { const r = parse(txt, ex); assert.equal(r.length, 1, 'ожидалась одна задача из: ' + txt); return r[0]; };

test('несколько дел в одной фразе', () => {
  const r = parse('Тренировка вечером на час каждый день, стирка раз в четыре дня, в пятницу в 10 к врачу');
  assert.deepEqual(r.map(t => t.name), ['Тренировка', 'Стирка', 'К врачу']);
  assert.deepEqual([r[0].kind, r[0].when, r[0].dur], ['daily', 'evening', 60]);
  assert.deepEqual([r[1].kind, r[1].every, r[1].bg], ['variable', 4, 60], 'стирка работает фоном');
  assert.deepEqual([r[2].kind, r[2].date, r[2].fixed], ['once', '2026-11-20', '10:00']);
});

test('время, длительность и дни', () => {
  assert.equal(one('по будням в 8:30 дорога на работу на полчаса').days, 'weekday');
  assert.equal(one('по будням в 8:30 дорога на работу на полчаса').fixed, '08:30');
  assert.equal(one('позвонить маме в восемь вечера').fixed, '20:00');
  assert.equal(one('прогулка на полтора часа').dur, 90);
  assert.equal(one('медитация 15 минут утром').dur, 15);
  assert.equal(one('по субботам и воскресеньям прогулка днём').days, 'dow:6,0');
  assert.equal(one('бассейн по вторникам и четвергам в 19:00').days, 'dow:2,4');
});

test('даты для разовых дел', () => {
  assert.equal(one('завтра в 7 вечера ужин с друзьями').date, '2026-11-18');
  assert.equal(one('послезавтра стоматолог').date, '2026-11-19');
  assert.equal(one('25 декабря праздничный ужин').date, '2026-12-25');
  assert.equal(one('10 января отпуск начинается').date, '2027-01-10', 'прошедшая дата — следующий год');
  assert.equal(one('во вторник сдать отчёт').date, TODAY, 'тот же день недели — сегодня');
});

test('частота вариативных дел', () => {
  assert.equal(one('уборка раз в неделю').every, 7);
  assert.equal(one('полить цветы через день').every, 2);
  assert.equal(one('поменять постельное раз в 2 недели').every, 14);
  assert.equal(one('уборка раз в неделю по возможности').prio, 1);
  assert.equal(one('важно оплатить счета раз в месяц').prio, 3);
});

test('«сразу после» находит задачу по названию', () => {
  const ex = [{ id: 'w', name: 'Работа' }];
  const t = one('сразу после работы магазин', ex);
  assert.equal(t.after, 'w');
  assert.equal(t.name, 'Магазин');
  const r = parseDictation('тренировка в 19:00, после тренировки душ', TODAY, []);
  assert.equal(r[1].after, r[0].id, 'можно сослаться на дело из той же фразы');
});

test('деление на фразы', () => {
  assert.deepEqual(splitPhrases('душ и завтрак утром'), ['душ', 'завтрак утром']);
  assert.equal(splitPhrases('по субботам и воскресеньям прогулка').length, 1);
  assert.equal(splitPhrases('потом').length, 0);
});

test('разовые дела и дни недели в плане', () => {
  const st = {
    tasks: parseDictation('в пятницу в 10 к врачу. бассейн по вторникам в 19:00', TODAY, []),
    times: { weekday: { wake: '07:00', sleep: '23:00' }, weekend: { wake: '09:00', sleep: '23:30' } },
    done: { ids: {} }, skip: {},
  };
  const tue = buildDay(st, TODAY, TODAY), fri = buildDay(st, '2026-11-20', TODAY);
  assert.ok(tue.items.some(i => i.name === 'Бассейн'));
  assert.ok(!tue.items.some(i => i.name === 'К врачу'));
  assert.ok(fri.items.some(i => i.name === 'К врачу'));
  assert.ok(!fri.items.some(i => i.name === 'Бассейн'));
  assert.equal(isDue(st.tasks[0], '2026-11-27', TODAY), false, 'разовое дело только в свой день');
});

test('речь без запятых делится по глаголам', () => {
  const r = parse('сварить гречку накормить кота пожарить курицу к гречке выгулять собаку встретить карину после работы', [{ id: 'w', name: 'Работа' }]);
  assert.deepEqual(r.map(t => t.name), ['Сварить гречку', 'Накормить кота', 'Пожарить курицу к гречке', 'Выгулять собаку', 'Встретить карину']);
  assert.equal(r[4].after, 'w');
  assert.equal(r[0].after, '');
  assert.deepEqual(parse('надо купить хлеб').map(t => t.name), ['Купить хлеб']);
  assert.deepEqual(parse('в 10 утра поставить стирку').map(t => t.name), ['Поставить стирку']);
  assert.deepEqual(parse('пойти погулять с собакой').map(t => t.name), ['Пойти погулять с собакой']);
  assert.deepEqual(parse('накорми кота свари гречку').map(t => t.name), ['Накорми кота', 'Свари гречку']);
});

test('команды «поставь», повторы и «на 16:30»', () => {
  const t = one('поставь купить продукты на 16:30');
  assert.equal(t.name, 'Купить продукты');
  assert.equal(t.fixed, '16:30');
  assert.equal(t.dur, 40);
  const u = one('какие-нибудь другие продукты поставь на поставь на 16:30');
  assert.equal(u.fixed, '16:30');
  assert.equal(u.name, 'Какие-нибудь другие продукты');
  assert.equal(one('напомни мне позвонить маме на 7 вечера').fixed, '19:00');
  assert.equal(one('напомни мне позвонить маме').name, 'Позвонить маме');
  assert.equal(one('уборка на 2 часа').dur, 120, '«на 2 часа» — по-прежнему длительность');
});

test('«когда-нибудь» — список желаний, само в план не встаёт', async () => {
  const { isDue, ideaFor } = await import('../js/scheduler.js');
  const t = one('когда-нибудь сходить в кино на 2 часа');
  assert.equal(t.kind, 'someday'); assert.equal(t.name, 'Сходить в кино'); assert.equal(t.dur, 120);
  assert.equal(isDue(t, TODAY, TODAY), false);
  const list = [{ ...t, id: 'a' }, { id: 'b', kind: 'someday', name: 'Почитать', dur: 30 }];
  assert.equal(ideaFor(list, 40, 0).id, 'b', 'в окно 40 минут кино не влезает');
  assert.equal(ideaFor(list, 200, 0).id, 'a');
  assert.equal(ideaFor(list, 200, 0, 1).id, 'b', '«Другое» перебирает варианты');
  assert.equal(ideaFor(list, 10, 0), null);
});
