import { addDays } from './scheduler.js';

let uid = Date.now();
export const newId = () => 't' + (uid++).toString(36);

/** Примерные задачи для первого запуска. Пользователь меняет их под себя. */
export function sampleTasks(today) {
  const ago = n => addDays(today, -n);
  const a = newId(), b = newId();
  return [
    { id: a, name: 'Дорога на работу', kind: 'daily', days: 'weekday', fixed: '08:30', dur: 30, prio: 3, when: 'any', bg: 0, fin: 0 },
    { id: b, name: 'Работа', kind: 'daily', days: 'weekday', fixed: '', after: a, dur: 540, prio: 3, when: 'any', bg: 0, fin: 0 },
    { id: newId(), name: 'Дорога домой', kind: 'daily', days: 'weekday', fixed: '', after: b, dur: 30, prio: 3, when: 'any', bg: 0, fin: 0 },
    { id: newId(), name: 'Душ', kind: 'daily', days: 'all', fixed: '', dur: 20, prio: 3, when: 'morning', bg: 0, fin: 0 },
    { id: newId(), name: 'Завтрак', kind: 'daily', days: 'all', fixed: '', dur: 20, prio: 3, when: 'morning', bg: 0, fin: 0 },
    { id: newId(), name: 'Тренировка', kind: 'daily', days: 'all', fixed: '', dur: 60, prio: 2, when: 'evening', bg: 0, fin: 0 },
    { id: newId(), name: 'Приготовить ужин', kind: 'daily', days: 'all', fixed: '', dur: 40, prio: 3, when: 'evening', bg: 0, fin: 0 },
    { id: newId(), name: 'Прогулка', kind: 'daily', days: 'weekend', fixed: '', dur: 90, prio: 1, when: 'day', bg: 0, fin: 0 },
    { id: newId(), name: 'Стирка', kind: 'variable', days: 'all', fixed: '', dur: 10, prio: 2, when: 'any', bg: 60, fin: 10, every: 4, last: ago(5) },
    { id: newId(), name: 'Уборка квартиры', kind: 'variable', days: 'all', fixed: '', dur: 45, prio: 2, when: 'any', bg: 0, fin: 0, every: 7, last: ago(8) },
    { id: newId(), name: 'Посудомойка', kind: 'variable', days: 'all', fixed: '', dur: 5, prio: 2, when: 'evening', bg: 90, fin: 10, every: 2, last: ago(2) },
    { id: newId(), name: 'Полить цветы', kind: 'variable', days: 'all', fixed: '', dur: 5, prio: 1, when: 'any', bg: 0, fin: 0, every: 3, last: ago(3) },
    { id: newId(), name: 'Купить продукты', kind: 'variable', days: 'all', fixed: '', dur: 40, prio: 2, when: 'evening', bg: 0, fin: 0, every: 5, last: ago(2) },
  ];
}
