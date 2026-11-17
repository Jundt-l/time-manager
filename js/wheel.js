// Барабан выбора времени, как в будильнике iPhone: часы и минуты крутятся пальцем,
// барабан замкнутый (после 23 идёт 00), на каждом шаге лёгкая вибрация (где телефон её поддерживает).
const ROW = 36, REPS = 9, MID = Math.floor(REPS / 2);

function tick() { try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) { /* нет вибрации */ } }
const pad = n => String(n).padStart(2, '0');

/**
 * Рисует барабан внутри root. onChange('HH:MM') вызывается при каждом шаге.
 * Возвращает { set('HH:MM'), get() }.
 */
export function createWheel(root, onChange = () => {}) {
  root.classList.add('wheel');
  root.innerHTML = '<div class="band"></div><div class="drum" aria-label="Часы"></div><div class="colon">:</div><div class="drum" aria-label="Минуты"></div>';
  const [hEl, mEl] = root.querySelectorAll('.drum');
  const drums = [{ el: hEl, n: 24 }, { el: mEl, n: 60 }];
  let quiet = false; // не дёргать onChange и вибрацию во время программной установки

  const idx = d => Math.round(d.el.scrollTop / ROW);
  const val = d => ((idx(d) % d.n) + d.n) % d.n;
  const place = (d, v) => { d.el.scrollTop = (MID * d.n + v) * ROW; };
  const get = () => pad(val(drums[0])) + ':' + pad(val(drums[1]));

  drums.forEach(d => {
    d.el.innerHTML = Array.from({ length: d.n }, (_, i) => '<div>' + pad(i) + '</div>').join('').repeat(REPS);
    let last = -1, settle = null;
    d.el.addEventListener('scroll', () => {
      const i = idx(d);
      if (i !== last) { if (last !== -1 && !quiet) { tick(); onChange(get()); } last = i; }
      clearTimeout(settle);
      // после остановки незаметно вернуть барабан в среднюю копию, чтобы крутить можно было бесконечно
      settle = setTimeout(() => { if (Math.floor(idx(d) / d.n) !== MID) { place(d, val(d)); last = idx(d); } }, 150);
    }, { passive: true });
  });

  return {
    get,
    set(v) {
      const [h, m] = (v || '08:00').split(':').map(Number);
      quiet = true;
      place(drums[0], h); place(drums[1], m);
      requestAnimationFrame(() => requestAnimationFrame(() => { quiet = false; }));
    },
  };
}
