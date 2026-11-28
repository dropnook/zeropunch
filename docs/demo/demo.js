// The live phone in the hero: the app's start screen to punch on. Pure show: no account, no network,
// nothing stored (no cookie, no storage). Loaded by boot.js once the page is idle and the phone is near
// the window; it replaces the screenshot (<picture>), which stays the fallback without JavaScript.
// Logic in demo-core.js; the punch animations are the app's own code, copied byte for byte to
// ./app/ by scripts/sync-demo.mjs and loaded only when one plays. No inline styles (CSP): classes and
// CSSOM custom properties only.

import { h, s as svg, fill } from './app/js/dom.js';
import { createFxRunner } from './app/js/fx.js';
import * as core from './demo-core.js';

const HERE = new URL('.', import.meta.url);
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** @type {Map<string, Promise<void>>} */
const sheets = new Map();
/**
 * The animation core asks for its stylesheets at the app's paths (/punchfx.css, /fx/<name>.css) and
 * takes a <link data-punchfx="that path"> already in the page as loaded. So the demo adds those links
 * itself, pointing at the copies, and waits until they apply before the scene plays.
 * @param {string} key the app's path @param {string} file under ./app/
 */
function sheet(key, file) {
  let p = sheets.get(key);
  if (!p) {
    p = new Promise((ok, fail) => {
      const link = h('link', { rel: 'stylesheet', href: new URL(`app/${file}`, HERE).href, 'data-punchfx': key });
      link.addEventListener('load', () => ok());
      link.addEventListener('error', () => {
        link.remove();
        fail(new Error(file));
      });
      document.head.append(link);
    });
    sheets.set(key, p);
    p.catch(() => sheets.delete(key));
  }
  return p;
}

/** The animation module for the runner: the copied punchfx.js, its stylesheets in place first. */
async function loadFx() {
  const m = await import('./app/js/punchfx.js');
  return {
    /** @param {string} name @param {any} o */
    play(name, o) {
      let cancelled = false;
      /** @type {{ cancel(): void } | null} */
      let inner = null;
      Promise.all([sheet('/punchfx.css', 'punchfx.css'), sheet(`/fx/${name}.css`, `fx/${name}.css`)]).then(
        () => {
          if (!cancelled) inner = m.play(name, o);
        },
        () => {
          if (!cancelled) o.buzz?.([15]); // no picture, the plain buzz
        },
      );
      return {
        cancel() {
          cancelled = true;
          inner?.cancel();
        },
      };
    },
  };
}

/**
 * Build the demo phone and put it in place of `old` (the screenshot).
 * @param {Element} old @param {'en'|'de'} lang
 */
export function mount(old, lang) {
  const T = (/** @type {string} */ k, /** @type {Record<string, any>} */ p) => core.text(lang, k, p);
  let st = core.initial();
  let t0 = performance.now();
  let lastTap = -Infinity;
  const nowTs = () => core.now(st, performance.now() - t0);

  // ---------------------------------------------------------------- markup (as public/index.html)
  const dayEl = h('span', { 'aria-live': 'polite' });
  const sumEl = h('span', { class: 'zd-sum' });
  const prev = h('button', { class: 'zd-nav', type: 'button', 'aria-label': T('day_prev') }, h('span', { 'aria-hidden': 'true' }, '‹'));
  const next = h('button', { class: 'zd-nav', type: 'button', 'aria-label': T('day_next') }, h('span', { 'aria-hidden': 'true' }, '›'));
  const todayBtn = h('button', { class: 'zd-todaybtn', type: 'button', 'aria-label': T('back_today'), hidden: true }, T('today'));
  const chips = h('ul', { class: 'zd-chips' });
  const dayview = h(
    'div',
    { class: 'zd-dayview', role: 'region', tabindex: '0', 'aria-label': T('dayview_aria') },
    h('div', { class: 'zd-head' }, prev, h('p', { class: 'zd-title' }, h('span', { class: 'zd-title-in' }, dayEl, h('span', { class: 'zd-sep', 'aria-hidden': 'true' }, '·'), sumEl)), next, todayBtn),
    chips,
  );
  const stateEl = h('span');
  const clock = h('p', { class: 'zd-clock', 'aria-live': 'off' });
  const todaySum = h('strong');
  const status = h(
    'div',
    { class: 'zd-status' },
    h('p', { class: 'zd-state' }, h('span', { class: 'zd-state-dot', 'aria-hidden': 'true' }), stateEl),
    clock,
    h('p', { class: 'zd-today' }, h('span', {}, T('today')), ' ', todaySum, ' h'),
  );
  const btn = /** @type {HTMLButtonElement} */ (h('button', { class: 'punch zd-punch', type: 'button' }, T('punch_inout')));
  const full = h('p', { class: 'zd-hint', hidden: true }, T('demo_done'));
  const again = h('button', { class: 'zd-again', type: 'button', hidden: true }, T('restart'));
  const area = h('div', { class: 'zd-punch-area' }, btn, h('div', { class: 'zd-hints' }, full, again));
  // No banner after a punch: the new chip glows. Screen readers hear the line from here.
  const said = h('p', { class: 'zd-vh', role: 'status', 'aria-live': 'polite' });
  const tabs = h(
    'div',
    { class: 'zd-tabs', 'aria-hidden': 'true' },
    // Symbols only, like the app's tab bar (public/index.html); the gear is drawn there too.
    h('span', { class: 'zd-tab zd-on' }, h('span', { class: 'zd-ico' }, '◷')),
    h('span', { class: 'zd-tab' }, h('span', { class: 'zd-ico' }, '☰')),
    h('span', { class: 'zd-tab' }, h('span', { class: 'zd-ico zd-emoji' }, '🤓')),
    h(
      'span',
      { class: 'zd-tab' },
      svg(
        'svg',
        { viewBox: '0 0 24 24', class: 'zd-gear' },
        svg('path', { d: 'M19.38 10.17L21.9 10.59L21.9 13.41L19.38 13.83L18.51 15.92L20 18L18 20L15.92 18.51L13.83 19.38L13.41 21.9L10.59 21.9L10.17 19.38L8.08 18.51L6 20L4 18L5.49 15.92L4.62 13.83L2.1 13.41L2.1 10.59L4.62 10.17L5.49 8.08L4 6L6 4L8.08 5.49L10.17 4.62L10.59 2.1L13.41 2.1L13.83 4.62L15.92 5.49L18 4L20 6L18.51 8.08Z' }),
        svg('circle', { cx: '12', cy: '12', r: '3.2' }),
      ),
    ),
  );
  const screen = h(
    'div',
    { class: 'zd-screen' },
    h('div', { class: 'zd-top', 'aria-hidden': 'true' }, h('span', { class: 'zd-wm' }, h('span', {}, 'Zero'), h('span', {}, 'punch')), h('span', { class: 'zd-pill' }, h('span', { class: 'zd-dot' }), T('demo'))),
    h('div', { class: 'zd-main' }, dayview, status, area),
    tabs,
    said,
  );
  const phone = h('div', { class: 'phone zd', role: 'group', 'aria-label': T('phone_aria') }, screen);
  // A nudge beside the phone until the first punch: the phone is a demo, not a picture.
  const tryMe = h('p', { class: 'zd-try', 'aria-hidden': 'true' }, h('span', { class: 'zd-try-text' }, T('try_me')), h('span', { class: 'zd-try-hand' }, '👉'));
  // Under the phone: the caption and a button that takes the demo to one day in 1955 and back.
  const tripBtn = h('button', { class: 'zd-trip', type: 'button' }, `⚡ ${T('trip')}`);
  const wrap = h('div', { class: 'zd-wrap' }, phone, tryMe, h('p', { class: 'zd-cap' }, h('span', {}, T('caption')), ' ', tripBtn));

  // ---------------------------------------------------------------- drawing
  let sig = '';
  /** The punch just made: its chip glows once. */
  let glowTs = 0;
  /** @type {any} */
  let glowTimer = 0;
  function render() {
    const n = nowTs();
    const v = core.view(st, n);
    const s = core.status(st, n);
    const set = (/** @type {Element} */ el, /** @type {string} */ x) => {
      if (el.textContent !== x) el.textContent = x;
    };
    set(dayEl, core.longDate(v.day, lang));
    set(sumEl, `${core.dur(v.sum)} h`);
    /** @type {HTMLButtonElement} */ (prev).disabled = !v.prev;
    /** @type {HTMLButtonElement} */ (next).disabled = !v.next;
    todayBtn.hidden = v.isToday;
    dayview.classList.toggle('zd-away', !v.isToday);
    const mine = `${v.day}|${v.punches.length}|${glowTs}`;
    if (mine !== sig) {
      sig = mine;
      chips.classList.toggle('zd-dense', v.punches.length > 6);
      if (!v.punches.length) fill(chips, h('li', { class: 'zd-empty' }, T('day_empty')));
      else
        fill(
          chips,
          ...v.punches.map((p) => {
            const dir = T(p.dir === 'in' ? 'dir_in' : 'dir_out');
            return h('li', { class: `zd-chip zd-${p.dir}${p.ts === glowTs ? ' zd-new' : ''}` }, h('span', { class: 'zd-time' }, p.time), h('span', { class: 'zd-dir' }, dir, p.plus ? h('span', { class: 'zd-badge' }, T('badge_plus', { n: p.plus })) : null));
          }),
        );
    }
    set(clock, core.hms(n));
    set(stateEl, s.in ? T('state_in', { time: s.since, dur: core.dur(s.todaySum) }) : s.punchesToday ? T('state_out', { dur: core.dur(s.todaySum) }) : T('state_none'));
    phone.classList.toggle('zd-is-in', s.in);
    set(todaySum, core.dur(s.todaySum));
    btn.disabled = s.full;
    full.hidden = !s.full;
    again.hidden = !s.full;
  }

  // ---------------------------------------------------------------- the clock ticks on from the demo time
  /** @type {any} */
  let timer = 0;
  const tick = () => {
    render();
    const ms = 1000 - ((performance.now() - t0) % 1000);
    timer = setTimeout(tick, ms + 5);
  };

  // ---------------------------------------------------------------- day browsing (as the app)
  /** @param {-1|0|1} dir @param {number} [fromX] */
  function go(dir, fromX = 0) {
    const before = st;
    st = core.step(st, dir);
    chips.classList.remove('zd-drag');
    chips.style.removeProperty('--zd-dx');
    if (st === before || (dir === 0 && !before.view)) {
      if (fromX) slide('zd-back', fromX);
      return;
    }
    render();
    // A ‹ or › that just reached its bound is disabled: keep the focus in the day view.
    if (dayview.contains(document.activeElement) && /** @type {any} */ (document.activeElement).disabled) dayview.focus({ preventScroll: true });
    slide('zd-in', fromX || (dir < 0 ? -1 : 1) * Math.min(80, chips.clientWidth * 0.25));
  }
  /** Chips slide in from where the day comes from (CSS keyframes from --zd-from). @param {string} cls @param {number} from */
  function slide(cls, from) {
    if (reduced()) return;
    chips.classList.remove('zd-in', 'zd-back');
    chips.style.setProperty('--zd-from', `${from}px`);
    void chips.offsetWidth;
    chips.classList.add(cls);
  }
  chips.addEventListener('animationend', () => chips.classList.remove('zd-in', 'zd-back'));
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  todayBtn.addEventListener('click', () => {
    go(0);
    dayview.focus({ preventScroll: true });
  });
  dayview.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    go(e.key === 'ArrowLeft' ? -1 : 1);
  });
  // Swipe: the dominant axis decides after a few pixels; vertical movement stays with the page
  // (touch-action: pan-y), so the phone never holds up scrolling.
  const SLOP = 10;
  const SWIPE = 48;
  /** @type {null | { id: number, x: number, y: number, t: number, axis: ''|'x'|'y' }} */
  let drag = null;
  dayview.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, axis: '' };
  });
  dayview.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'y') return;
      try {
        dayview.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    if (drag.axis === 'x' && !reduced()) {
      chips.classList.add('zd-drag');
      chips.style.setProperty('--zd-dx', `${dx * 0.6}px`);
    }
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.axis !== 'x') return;
    const dx = e.type === 'pointercancel' ? 0 : e.clientX - d.x;
    const fast = Math.abs(dx) > 24 && Math.abs(dx) / Math.max(1, e.timeStamp - d.t) > 0.4;
    const shown = reduced() ? 0 : dx * 0.6;
    // finger to the right = an older day
    if (Math.abs(dx) >= SWIPE || fast) go(dx > 0 ? -1 : 1, shown);
    else {
      chips.classList.remove('zd-drag');
      chips.style.removeProperty('--zd-dx');
      if (shown) slide('zd-back', shown);
    }
  };
  dayview.addEventListener('pointerup', end);
  dayview.addEventListener('pointercancel', end);
  let acc = 0;
  let quietUntil = 0;
  dayview.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = Date.now();
      if (now < quietUntil) {
        quietUntil = now + 250;
        return;
      }
      acc += e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      if (Math.abs(acc) < 60) return;
      go(acc > 0 ? 1 : -1);
      acc = 0;
      quietUntil = now + 250;
    },
    { passive: false },
  );

  // ---------------------------------------------------------------- punching
  const fx = createFxRunner({
    load: loadFx,
    reduced,
    vibrate: typeof navigator.vibrate === 'function' ? (p) => navigator.vibrate(p) : null,
  });
  btn.addEventListener('click', () => {
    const t = performance.now();
    if (btn.disabled || t - lastTap < 300) return; // a double tap counts once, as in the app
    lastTap = t;
    const r = core.tap(st);
    if (!r.punch) return;
    tryMe.remove();
    st = r.state;
    t0 = t; // the demo clock now stands at this punch and ticks on from there
    glowTs = r.punch.ts;
    clearTimeout(glowTimer);
    glowTimer = setTimeout(() => (glowTs = 0), 1800);
    clearTimeout(timer);
    tick();
    // The last punch of the time travel is the clock tower's; every other one is picked at random.
    void fx.punch(st.trip && core.status(st, r.punch.ts).full ? 'tower' : 'random', { anchor: btn, time: r.punch.time, out: r.punch.dir === 'out' });
    said.textContent = T('punched', { time: r.punch.time, dir: T(r.punch.dir === 'in' ? 'dir_in' : 'dir_out') });
    if (btn.disabled) again.focus({ preventScroll: true }); // the button is done for the day; keep the focus nearby
  });
  again.addEventListener('click', () => {
    fx.cancel();
    st = st.trip ? core.trip() : core.reset();
    t0 = performance.now();
    said.textContent = '';
    glowTs = 0;
    clearTimeout(timer);
    tick();
    btn.focus({ preventScroll: true });
  });
  tripBtn.addEventListener('click', () => {
    fx.cancel();
    st = st.trip ? core.reset() : core.trip();
    tripBtn.textContent = st.trip ? `↩ ${T('trip_back')}` : `⚡ ${T('trip')}`;
    t0 = performance.now();
    said.textContent = '';
    glowTs = 0;
    clearTimeout(timer);
    tick();
  });

  tick();
  old.replaceWith(wrap);
  return { wrap, phone };
}
