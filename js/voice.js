// Разбор надиктованного текста в задачи. Без ИИ: правила для типовых русских фраз.
// Пример: «Тренировка вечером на час каждый день, стирка раз в 4 дня, в пятницу в 10 к врачу».
import { addDays, localISO } from './scheduler.js';

// Границы слова для кириллицы (\b в JS работает только с латиницей)
const L = '(?<![а-яa-z0-9])', R = '(?![а-яa-z0-9])';
const rx = (s, f = '') => new RegExp(L + '(?:' + s + ')' + R, f);

const NUM = {
  ноль: 0, один: 1, одна: 1, одну: 1, одного: 1, два: 2, две: 2, двух: 2, три: 3, трех: 3, четыре: 4, четырех: 4,
  пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9,
  десять: 10, десяти: 10, одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12, пятнадцать: 15, пятнадцати: 15,
  двадцать: 20, двадцати: 20, тридцать: 30, тридцати: 30, сорок: 40, сорока: 40, пятьдесят: 50, пятидесяти: 50,
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DOW_ACC = { понедельник: 1, вторник: 2, среду: 3, четверг: 4, пятницу: 5, субботу: 6, воскресенье: 0 };
const r0 = m => m[1];
const DOW_STEM = { понедельник: 1, вторник: 2, сред: 3, четверг: 4, пятниц: 5, суббот: 6, воскресень: 0 };

// Длительность и фоновая работа по умолчанию для знакомых дел
const KNOWN = [
  [/стир/, { dur: 10, bg: 60, fin: 10 }],
  [/посудомо/, { dur: 5, bg: 90, fin: 10 }],
  [/робот|пылесос/, { dur: 5, bg: 60, fin: 0 }],
  [/мультиварк|хлебопеч/, { dur: 10, bg: 60, fin: 0 }],
  [/душ|ванн/, { dur: 20 }],
  [/завтрак/, { dur: 20 }],
  [/обед/, { dur: 30 }],
  [/ужин|готов/, { dur: 40 }],
  [/трениров|спорт|зал|пробежк|бег/, { dur: 60 }],
  [/прогулк|гулять|погулять/, { dur: 60 }],
  [/уборк|убрать|убраться/, { dur: 45 }],
  [/покупк|магазин|продукт/, { dur: 40 }],
  [/врач|стоматолог|доктор/, { dur: 60 }],
  [/цвет/, { dur: 5 }],
  [/мусор/, { dur: 5 }],
];

function words2num(s) {
  s = s.replace(rx(Object.keys(NUM).join('|'), 'g'), w => String(NUM[w]));
  // «20 5» → 25
  return s.replace(/(?<![0-9])([2-5]0) ([1-9])(?![0-9])/g, (_, a, b) => String(+a + +b));
}

// Команды приложению, а не часть дела: «поставь», «добавь», «напомни мне»…
const COMMANDS = rx('(?:поставь|поставьте|добавь|добавьте|запиши|запишите|напомни|напомните|создай|внеси|сделай задачу|задача|задачу)(?: мне| нам)?(?: задачу)?', 'g');
// Слова на -ть, которые не глаголы
const NOT_VERB = /^(?:часть|сеть|путь|мать|рать|тетрадь|кровать|печать|скатерть|смерть|знать|\S*ость)$/;
// Частые повелительные формы: «накорми кота свари гречку»
const IMPERATIVE = /^(?:купи|свари|сходи|позвони|забери|приготовь|помой|убери|накорми|выгуляй|встреть|напиши|отправь|оплати|полей|вынеси|постирай|погуляй|сделай|сготовь|пожарь|почисти|запусти|развесь|сложи|погладь)$/;
// После этих слов глагол продолжает то же дело: «надо купить», «пойти погулять», «не забыть позвонить»
const MODAL = /^(?:надо|нужно|хочу|буду|можно|пойти|сходить|поехать|не|забыть|попробовать|начать|успеть|бы)$/;
const isVerb = w => (/(?:ть|ться|тись)$/.test(w) && !NOT_VERB.test(w)) || IMPERATIVE.test(w);

/** Распознанная речь без знаков препинания: «сварить гречку накормить кота» → два дела по глаголам. */
function splitByVerbs(chunk) {
  const words = chunk.trim().split(/\s+/), out = [];
  let cur = [], hasVerb = false;
  words.forEach(w => {
    const verb = isVerb(w);
    if (verb && hasVerb && cur.length >= 2 && !MODAL.test(cur[cur.length - 1])) { out.push(cur.join(' ')); cur = []; hasVerb = false; }
    cur.push(w);
    if (verb) hasVerb = true;
  });
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/** Убрать команды приложению и повторы, которые бывают при диктовке («поставь на поставь на 16:30»). */
export function cleanSpeech(text) {
  let s = ' ' + text.toLowerCase().replace(/ё/g, 'е') + ' ';
  s = s.replace(COMMANDS, ' ').replace(/\s+/g, ' ');
  for (let i = 0; i < 3; i++) s = s.replace(/(^|\s)((?:[а-яa-z0-9:.-]+ ){1,3})\2/g, '$1$2');
  return s.trim();
}

/** Делит текст на отдельные дела. */
export function splitPhrases(text) {
  const first = cleanSpeech(text)
    .split(/[.;!?\n]+|,(?! ?\d)|\s(?:потом|затем|а также|а еще|и еще|еще)\s/);
  const out = [];
  first.forEach(chunk => {
    // «душ и завтрак» → два дела; «по субботам и воскресеньям», «и 30 минут» не делим
    const parts = chunk.split(/\sи\s/);
    let cur = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const right = parts[i].trim();
      const keep = /^(\d|в |во |на |по |с |к |через )/.test(right) || /^(понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)/.test(right);
      if (keep) cur += ' и ' + parts[i]; else { out.push(cur); cur = parts[i]; }
    }
    out.push(cur);
  });
  return out.flatMap(splitByVerbs).map(s => s.trim()).filter(s => s.replace(/(?:^|\s)(?:потом|затем|и|а|еще|также)(?=\s|$)/g, '').replace(/[^а-яa-z]/g, '').length > 1);
}

/**
 * Разбирает одну фразу. existing — уже известные задачи (для «сразу после …»).
 * Возвращает задачу без id или null.
 */
export function parsePhrase(phrase, todayISO, existing = []) {
  let s = ' ' + words2num(phrase.toLowerCase().replace(/ё/g, 'е')) + ' ';
  const take = (re, fn) => { const m = s.match(re); if (m) { s = s.replace(m[0], ' '); fn(m); return true; } return false; };
  const t = { kind: 'daily', days: 'all', fixed: '', after: '', dur: 0, prio: 2, when: 'any', bg: 0, fin: 0 };
  const today = new Date(todayISO + 'T12:00');

  // сразу после …
  {
    // «сразу после работы магазин»: ищем задачу по одному-двум словам после «сразу после»
    const m = s.match(/(?:сразу )?после ([а-я]+)(?: ([а-я]+))?/);
    if (m) {
      const stem = w => w.slice(0, Math.max(4, w.length - 2));
      const same = (a, b) => a.length > 2 && b.length > 2 && (a.startsWith(stem(b)) || b.startsWith(stem(a)));
      const words = x => x.name.toLowerCase().replace(/ё/g, 'е').split(/\s+/);
      for (const n of [2, 1]) {
        const ref = n === 2 ? [m[1], m[2]].filter(Boolean) : [m[1]];
        if (n === 2 && ref.length < 2) continue;
        const hit = existing.find(x => { const w = words(x); return ref.every((r, i) => w[i] && same(w[i], r)) && (n === 2 || w.length === 1 || same(w[0], r0(m))); });
        if (hit) { t.after = hit.id; s = s.replace((m[0].startsWith('сразу') ? 'сразу ' : '') + 'после ' + ref.join(' '), ' '); break; }
      }
    }
  }

  // частота
  take(rx('раз в день|каждый день|ежедневно|всегда'), () => {}) ||
  take(rx('по будням|в будни|по рабочим(?: дням)?|в рабочие дни'), () => { t.days = 'weekday'; }) ||
  take(rx('по выходным|в выходные(?: дни)?'), () => { t.days = 'weekend'; }) ||
  take(/по ((?:понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям)(?:(?:,| и) (?:понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям))*)/, m => {
    const ds = [];
    Object.entries(DOW_STEM).forEach(([st, n]) => { if (m[1].includes(st)) ds.push(n); });
    t.days = 'dow:' + ds.join(',');
  }) ||
  take(rx('через день'), () => { t.kind = 'variable'; t.every = 2; }) ||
  take(rx('раз в (\\d+) недел[июьи]+'), m => { t.kind = 'variable'; t.every = 7 * +m[1]; }) ||
  take(rx('раз в неделю|каждую неделю|еженедельно'), () => { t.kind = 'variable'; t.every = 7; }) ||
  take(rx('раз в месяц|каждый месяц|ежемесячно'), () => { t.kind = 'variable'; t.every = 30; }) ||
  take(rx('(?:раз в|каждые|каждый) (\\d+) (?:дня|дней|день)'), m => { t.kind = 'variable'; t.every = Math.max(1, +m[1]); });

  // дата для разового дела
  const once = iso => { t.kind = 'once'; t.date = iso; };
  take(rx('послезавтра'), () => once(addDays(todayISO, 2))) ||
  take(rx('завтра'), () => once(addDays(todayISO, 1))) ||
  take(rx('сегодня'), () => once(todayISO)) ||
  take(rx('(?:в|во) (понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)'), m => {
    const diff = (DOW_ACC[m[1]] - today.getDay() + 7) % 7;
    once(addDays(todayISO, diff));
  }) ||
  take(rx('(\\d{1,2}) (' + MONTHS.join('|') + ')'), m => {
    let d = new Date(today.getFullYear(), MONTHS.indexOf(m[2]), +m[1]);
    if (localISO(d) < todayISO) d = new Date(today.getFullYear() + 1, MONTHS.indexOf(m[2]), +m[1]);
    once(localISO(d));
  });

  // длительность
  take(rx('(?:на )?полтора часа'), () => { t.dur = 90; }) ||
  take(rx('(?:на )?полчаса'), () => { t.dur = 30; }) ||
  take(rx('на (\\d+(?:[.,]\\d+)?) ?час(?:а|ов)?'), m => { t.dur = Math.round(parseFloat(m[1].replace(',', '.')) * 60); }) ||
  take(rx('на час'), () => { t.dur = 60; }) ||
  take(rx('(?:на )?(\\d+) ?(?:минут[уы]?|мин)'), m => { t.dur = +m[1]; });

  // точное время
  take(rx('в полдень'), () => { t.fixed = '12:00'; }) ||
  // «на 16:30», «на 7 вечера» — это время, а не длительность
  take(rx('на (\\d{1,2})(?:[:.](\\d{2})|(?: (\\d{1,2}))? (утра|дня|вечера|ночи))'), m => {
    let h = +m[1]; const min = +(m[2] || m[3] || 0);
    if ((m[4] === 'вечера' && h < 12) || (m[4] === 'дня' && h < 8)) h += 12;
    if (h > 23 || min > 59) return;
    t.fixed = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  }) ||
  take(rx('(?:в|к) (\\d{1,2})(?:[:.](\\d{2})| ?час(?:а|ов)?(?: (\\d{1,2}) ?минут\\w*)?)?(?: (утра|дня|вечера|ночи))?'), m => {
    let h = +m[1]; const min = +(m[2] || m[3] || 0);
    if ((m[4] === 'вечера' && h < 12) || (m[4] === 'дня' && h < 8)) h += 12;
    if (m[4] === 'ночи' && h === 12) h = 0;
    if (h > 23 || min > 59) return;
    t.fixed = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  });

  // часть дня
  take(rx('утром|с утра|по утрам'), () => { t.when = 'morning'; }) ||
  take(rx('днем|после обеда|в обед'), () => { t.when = 'day'; }) ||
  take(rx('вечером|по вечерам|перед сном'), () => { t.when = 'evening'; });

  // важность
  take(rx('очень важно|важно|обязательно|срочно'), () => { t.prio = 3; }) ||
  take(rx('по возможности|если будет время|не срочно|неважно'), () => { t.prio = 1; });

  // название: что осталось
  let name = s.replace(/\s+/g, ' ').trim()
    .replace(/^(?:и |а |еще |ещё )+/, '')
    .replace(/^(?:мне |нам |я )?(?:нужно|надо|хочу|буду|планирую|следует|не забыть)(?: бы)? /, '')
    .replace(/(?:^|\s)(?:в|во|на|по|к|и|с|а)$/g, '')
    .replace(/^(?:в|во|на|по|и|с|а)\s/, '')
    .replace(/\s+/g, ' ').trim();
  if (name.replace(/[^а-яa-z]/g, '').length < 2) return null;
  t.name = name.charAt(0).toUpperCase() + name.slice(1);

  const known = KNOWN.find(([re]) => re.test(name));
  if (known) {
    const k = known[1];
    if (k.bg) { t.bg = k.bg; t.fin = k.fin; if (!t.dur) t.dur = k.dur; }
    else if (!t.dur) t.dur = k.dur;
  }
  if (!t.dur) t.dur = 30;
  if (t.kind === 'variable') t.last = addDays(todayISO, -t.every); // первый раз — сегодня
  if (t.fixed && t.after) t.after = '';
  return t;
}

/** Разбирает весь текст. Задачи из начала текста можно указать в «сразу после» дальше. */
export function parseDictation(text, todayISO, existing = [], newId = () => 'v' + Math.random().toString(36).slice(2)) {
  const out = [];
  splitPhrases(text).forEach(p => {
    const t = parsePhrase(p, todayISO, existing.concat(out));
    if (t) { t.id = newId(); out.push(t); }
  });
  return out;
}
