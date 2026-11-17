// Уведомления «Вы сделали…?» с кнопками ✓ и ✗.
// Android: кнопки прямо в уведомлении. iPhone: веб-уведомления без кнопок, нажатие открывает приложение.
// Без аккаунта уведомления приходят, только если приложение недавно открывали. С аккаунтом их присылает сервер.
import { keyOf, fmt, localISO, askable } from './scheduler.js';
import { inboxTake } from './inbox.js';

let reg = null;
let onAction = () => {};
let timers = [];
let serverPush = false;
/** Напоминания присылает сервер: свои таймеры не нужны, иначе придёт два уведомления. */
export function setServerPush(on) { serverPush = on; if (on) { timers.forEach(clearTimeout); timers = []; } }

export const supported = () => 'Notification' in window && 'serviceWorker' in navigator;
export const status = () => (supported() ? Notification.permission : 'unsupported');
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
/** На iPhone уведомления работают только у приложения, добавленного на экран «Домой». */
export const needsInstallOnIOS = () => isIOS() && !standalone();

export async function init(applyAction) {
  onAction = applyAction;
  if (!('serviceWorker' in navigator)) return;
  // Когда на сайте появилась новая версия, приложение один раз перезагружается само, переустанавливать не нужно.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true; location.reload();
  });
  try { reg = await navigator.serviceWorker.register('./sw.js'); } catch (e) { return; }
  // проверять обновления при каждом возвращении в приложение
  document.addEventListener('visibilitychange', () => { if (!document.hidden && reg) reg.update().catch(() => {}); });
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'action') drainInbox();
  });
  drainInbox();
}

export async function drainInbox() {
  const list = await inboxTake();
  list.forEach(({ key, action, day }) => onAction(key, action, day));
}

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
}

async function show(it) {
  if (status() !== 'granted') return;
  const r = reg || await navigator.serviceWorker.ready;
  const key = keyOf(it);
  await r.showNotification('Вы сделали «' + it.name + '»?', {
    body: 'По плану было ' + fmt(it.s) + '–' + fmt(it.e),
    tag: key,
    data: { key, day: localISO(new Date()) },
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    actions: [{ action: 'done', title: '✓ Сделано' }, { action: 'skip', title: '✗ Не сделал' }],
    vibrate: [80, 40, 80],
    requireInteraction: true,
  });
}

/**
 * Ставит таймеры на конец каждой задачи сегодняшнего плана.
 * Если к концу задачи нет отметки, приходит уведомление. Каждое уведомление показывается один раз за день.
 */
export function schedule(items, state, nowMin) {
  timers.forEach(clearTimeout); timers = [];
  if (status() !== 'granted' || serverPush) return;
  const pending = it => state.done.ids[keyOf(it)] === undefined && !state.skip[keyOf(it)];
  items.filter(askable).forEach(it => {
    const key = keyOf(it);
    if (state.notified[key] || !pending(it)) return;
    if (it.e <= nowMin) {
      // задача закончилась недавно, а отметки нет: напоминаем сразу (старые не трогаем, для них есть карточки в приложении)
      if (nowMin - it.e <= 60) { state.notified[key] = true; show(it); }
    } else {
      const ms = (it.e - nowMin) * 60000 + 30000;
      timers.push(setTimeout(() => { if (!state.notified[key] && pending(it)) { state.notified[key] = true; show(it); } }, ms));
    }
  });
}

/** Закрыть уведомление по делу, на которое уже ответили в приложении. */
export async function dismiss(key) {
  try {
    const r = reg || await navigator.serviceWorker.ready;
    (await r.getNotifications({ tag: key })).forEach(n => n.close());
  } catch (e) { /* уведомлений нет */ }
}
