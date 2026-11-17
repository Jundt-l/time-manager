import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split, stamp, merge, prune, apply, stable } from '../js/merge.js';

const T = '2026-11-17';
const base = () => ({
  tasks: [
    { id: 'ta1', name: 'Душ', kind: 'daily', dur: 20 },
    { id: 'ta2', name: 'Стирка', kind: 'variable', dur: 10, sh: 1, who: 'any' },
  ],
  times: { weekday: { wake: '07:00', sleep: '23:00' }, weekend: { wake: '09:00', sleep: '23:30' } },
  done: { date: T, ids: {} }, skip: {}, notified: {},
});
const stampBoth = (st, prev = {}, now = 1000) => {
  const { mine, ours } = split(st);
  return { mine: stamp(prev.mine, mine, now, T).entries, ours: stamp(prev.ours, ours, now, T).entries };
};

test('личное и общее раскладываются по разным документам', () => {
  const { mine, ours } = split(base());
  assert.ok(mine['task:ta1']); assert.ok(!mine['task:ta2']);
  assert.equal(ours['task:ta2'].who, 'any');
  assert.equal(ours['task:ta2'].sh, undefined);
});

test('stable не зависит от порядка ключей', () => {
  assert.equal(stable({ a: 1, b: [2, { c: 3, d: 4 }] }), stable({ b: [2, { d: 4, c: 3 }], a: 1 }));
});

test('без изменений время не меняется, удаление оставляет запись null', () => {
  const st = base();
  const a = stampBoth(st);
  const again = stamp(a.mine, split(st).mine, 2000, T);
  assert.equal(again.changed, false);
  st.tasks = st.tasks.filter(t => t.id !== 'ta1');
  const del = stamp(a.mine, split(st).mine, 3000, T);
  assert.equal(del.changed, true);
  assert.deepEqual(del.entries['task:ta1'], { u: 3000, v: null });
});

test('два телефона меняют разные дела, после слияния видны оба изменения', () => {
  const st = base();
  const start = stampBoth(st);
  const phoneA = structuredClone(st), phoneB = structuredClone(st);
  phoneA.tasks[0].dur = 30;                       // А меняет душ
  phoneB.tasks.push({ id: 'ta3', name: 'Кино', kind: 'once', dur: 120 }); // Б добавляет кино
  const a = stamp(start.mine, split(phoneA).mine, 2000, T).entries;
  const b = stamp(start.mine, split(phoneB).mine, 2500, T).entries;
  const m = merge(a, b);
  const res = apply(structuredClone(st), m, start.ours);
  assert.equal(res.tasks.find(t => t.id === 'ta1').dur, 30);
  assert.ok(res.tasks.find(t => t.id === 'ta3'));
  assert.deepEqual(merge(a, b), merge(b, a));
});

test('удаление на одном телефоне не воскресает от старой копии', () => {
  const st = base();
  const start = stampBoth(st);
  const gone = structuredClone(st); gone.tasks = gone.tasks.filter(t => t.id !== 'ta1');
  const a = stamp(start.mine, split(gone).mine, 2000, T).entries;
  const res = apply(structuredClone(st), merge(start.mine, a), start.ours);
  assert.ok(!res.tasks.find(t => t.id === 'ta1'));
});

test('отметка партнёра по общему делу видна у меня, снятая отметка снимается', () => {
  const st = base();
  const start = stampBoth(st);
  const her = structuredClone(st); her.done.ids['ta2'] = '2026-11-10';
  const herOurs = stamp(start.ours, split(her).ours, 2000, T).entries;
  assert.ok(herOurs['mark:' + T + ':ta2']);
  const me = apply(structuredClone(st), start.mine, merge(start.ours, herOurs));
  assert.equal(me.done.ids.ta2, '2026-11-10');
  assert.equal(me.tasks.find(t => t.id === 'ta2').sh, 1);
  // она сняла отметку
  delete her.done.ids.ta2;
  const undo = stamp(herOurs, split(her).ours, 3000, T).entries;
  assert.equal(undo['mark:' + T + ':ta2'].v, null);
  const me2 = apply(structuredClone(st), start.mine, merge(herOurs, undo));
  assert.equal(me2.done.ids.ta2, undefined);
});

test('отметки прошлых дней не превращаются в удаления и потом вычищаются', () => {
  const prev = { ['mark:2026-11-16:ta1']: { u: 1, v: { done: '' } } };
  const r = stamp(prev, {}, 5000, T);
  assert.equal(r.changed, false);
  assert.deepEqual(r.entries['mark:2026-11-16:ta1'], { u: 1, v: { done: '' } });
  const old = { ['mark:2026-11-10:ta1']: { u: 1, v: { done: '' } }, x: { u: 1, v: null }, y: { u: Date.parse(T), v: null } };
  assert.deepEqual(Object.keys(prune(old, Date.parse(T), T)), ['y']);
});

test('порядок задач — по времени создания', () => {
  const st = base();
  const { mine, ours } = stampBoth(st);
  const res = apply({ ...base(), tasks: [] }, mine, ours);
  assert.deepEqual(res.tasks.map(t => t.id), ['ta1', 'ta2']);
});

test('«убрать на сегодня» синхронизируется отдельно от отметок', () => {
  const st = base(); st.hide = { ta1: true };
  const { mine } = split(st);
  assert.deepEqual(mine['mark:' + T + ':ta1'], { hide: 1 });
  const res = apply(base(), stampBoth(st).mine, {});
  assert.equal(res.hide.ta1, true);
  assert.equal(res.done.ids.ta1, undefined);
});

test('кто отметил общее дело и статистика партнёра', () => {
  const st = base(); st.sync = { uid: 'me' };
  st.done.ids.ta2 = ''; st.by = { ta2: 'me' };
  st.hist = { [T]: { d: 3, t: 5, sh: 1 } };
  const { mine, ours } = split(st);
  assert.deepEqual(ours['mark:' + T + ':ta2'], { done: '', by: 'me' });
  assert.deepEqual(mine['hist:' + T], { d: 3, t: 5, sh: 1 });
  assert.equal(ours['stat:me:' + T], 1);
  // запись партнёра не превращается в удаление при моём сохранении
  const prev = { ['stat:her:' + T]: { u: 1, v: 2 } };
  const r = stamp(prev, ours, 5, T);
  assert.deepEqual(r.entries['stat:her:' + T], { u: 1, v: 2 });
  const res = apply(base(), stamp({}, mine, 1, T).entries, merge(r.entries, {}));
  assert.equal(res.pstat.her[T], 2);
  assert.equal(res.by.ta2, 'me');
  assert.equal(res.hist[T].d, 3);
});
