// Барабан выбора времени, как в будильнике iPhone: часы и минуты крутятся пальцем,
// барабан замкнутый (после 23 идёт 00), на каждом шаге лёгкая вибрация (где телефон её поддерживает).
// Прокрутку ведём сами, а не браузером: палец двигает барабан 1:1, после отпускания он плавно
// замедляется и мягко встаёт на ближайшее значение. Нативная инерция была слишком быстрой.
const ROW = 44, REPS = 9, MID = Math.floor(REPS / 2);
const FRICTION = 0.92;   // доля скорости, остающаяся за 16 мс; меньше — быстрее останавливается
const MAX_V = 1.6;       // предел скорости после броска, px/мс
const FLING = 0.55;      // насколько сильно бросок продолжает движение
const SNAP_MS = 220;

function tick() { try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) { /* нет вибрации */ } }
const pad = n => String(n).padStart(2, '0');
const easeOut = t => 1 - Math.pow(1 - t, 3);

/**
 * Рисует барабан внутри root. onChange('HH:MM') вызывается при каждом шаге.
 * Возвращает { set('HH:MM'), get() }.
 */
export function createWheel(root, onChange = () => {}) {
  root.classList.add('wheel');
  root.innerHTML = '<div class="band"></div><div class="drum" tabindex="0" role="spinbutton" aria-label="Часы"></div><div class="colon">:</div><div class="drum" tabindex="0" role="spinbutton" aria-label="Минуты"></div>';
  const [hEl, mEl] = root.querySelectorAll('.drum');
  const drums = [{ el: hEl, n: 24 }, { el: mEl, n: 60 }];
  let quiet = false;

  const idx = d => Math.round(d.el.scrollTop / ROW);
  const val = d => ((idx(d) % d.n) + d.n) % d.n;
  const place = (d, v) => { d.el.scrollTop = (MID * d.n + v) * ROW; d.last = idx(d); };
  const get = () => pad(val(drums[0])) + ':' + pad(val(drums[1]));

  drums.forEach(d => {
    const el = d.el;
    el.innerHTML = Array.from({ length: d.n }, (_, i) => '<div>' + pad(i) + '</div>').join('').repeat(REPS);
    d.last = -1; d.anim = 0;

    const changed = () => {
      const i = idx(d);
      if (i !== d.last) { if (d.last !== -1 && !quiet) { tick(); onChange(get()); } d.last = i; }
      el.setAttribute('aria-valuenow', val(d)); el.setAttribute('aria-valuetext', pad(val(d)));
    };
    const stop = () => { cancelAnimationFrame(d.anim); d.anim = 0; };
    // вернуть в среднюю копию, чтобы крутить можно было бесконечно
    const recenter = () => { if (Math.floor(idx(d) / d.n) !== MID) { quiet = true; place(d, val(d)); quiet = false; } };
    const snapTo = target => {
      stop();
      const from = el.scrollTop, dist = target - from, t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / SNAP_MS);
        el.scrollTop = from + dist * easeOut(k); changed();
        if (k < 1) d.anim = requestAnimationFrame(step); else { d.anim = 0; recenter(); }
      };
      d.anim = requestAnimationFrame(step);
    };
    const snap = () => snapTo(Math.round(el.scrollTop / ROW) * ROW);
    const glide = v0 => {
      stop();
      let v = Math.max(-MAX_V, Math.min(MAX_V, v0 * FLING)), prev = performance.now();
      const step = now => {
        const dt = Math.min(40, now - prev); prev = now;
        el.scrollTop += v * dt; changed();
        v *= Math.pow(FRICTION, dt / 16);
        if (Math.abs(v) > 0.06) d.anim = requestAnimationFrame(step); else snap();
      };
      d.anim = requestAnimationFrame(step);
    };

    // палец или мышь
    let dragging = false, y0 = 0, top0 = 0, samples = [];
    el.addEventListener('pointerdown', e => {
      stop(); dragging = true; y0 = e.clientY; top0 = el.scrollTop; samples = [{ y: e.clientY, t: e.timeStamp }];
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата */ }
    });
    el.addEventListener('pointermove', e => {
      if (!dragging) return;
      el.scrollTop = top0 - (e.clientY - y0); changed();
      samples.push({ y: e.clientY, t: e.timeStamp });
      if (samples.length > 6) samples.shift();
    });
    const release = e => {
      if (!dragging) return; dragging = false;
      const a = samples[0], b = samples[samples.length - 1];
      const dt = b.t - a.t;
      const v = dt > 0 && e.timeStamp - b.t < 80 ? -(b.y - a.y) / dt : 0;
      if (Math.abs(v) > 0.15) glide(v); else snap();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    // колёсико мыши и клавиши: по одному шагу
    el.addEventListener('wheel', e => { e.preventDefault(); snapTo((Math.round(el.scrollTop / ROW) + Math.sign(e.deltaY)) * ROW); }, { passive: false });
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); snapTo((Math.round(el.scrollTop / ROW) + (e.key === 'ArrowDown' ? 1 : -1)) * ROW); }
    });
    // на всякий случай: если прокрутку сдвинул кто-то ещё
    el.addEventListener('scroll', () => { if (!d.anim && !dragging) changed(); }, { passive: true });
  });

  return {
    get,
    set(v) {
      const [h, m] = (v || '08:00').split(':').map(Number);
      quiet = true;
      drums.forEach(d => { cancelAnimationFrame(d.anim); d.anim = 0; });
      place(drums[0], h); place(drums[1], m);
      quiet = false;
    },
  };
}
