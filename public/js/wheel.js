// Wheel picker for the time in the add/edit dialog: one vertical scroll column per unit (hours 00–23,
// minutes 00–59), the selected value centred between two lines, CSS scroll snapping for the thumb.
// Mouse wheel = one step per notch, click on a neighbour, keyboard like a spin button.
//
// One source of truth per column: the integer `value` of a WheelModel. Every programmatic change
// (opening the dialog, typed digits, arrow/page keys, a wheel notch, a click on a neighbour) sets the
// value and tells the caller at once (the hidden field is right synchronously), then puts the column
// there with instant positioning. Scroll events only move the value while a finger is on the column
// or the column is still coasting after it; all other scroll events (caused by our own positioning,
// layout, snapping) never change it – the column is put back under the value instead.
// Submitting while the wheel still moves takes the row under the centre line at that moment and stops
// the column there (commit), so what is saved is what the wheel shows.
// The pure parts (functions and WheelModel) are tested in test/unit/wheel.test.js.

import { h } from './dom.js';

/** @param {number} v @param {number} min @param {number} max */
export const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));

/** Value centred at this scroll position (row = row height in px). @param {number} scrollTop @param {number} row @param {number} min @param {number} max */
export const valueAt = (scrollTop, row, min, max) => clamp(min + (row > 0 ? scrollTop / row : 0), min, max);

/** Scroll position that centres a value. @param {number} v @param {number} row @param {number} min */
export const offsetFor = (v, row, min) => (v - min) * row;

/** Pixels of trackpad scrolling that make one step (a mouse notch is usually ≥ 50 px in one event). */
export const WHEEL_STEP_PX = 40;

/** After a finger left the column: this long without a scroll event = the column has come to rest. */
export const COAST_QUIET_MS = 150;

/**
 * Mouse wheel → whole steps. A notch (line or page mode, or one big pixel delta) is exactly one step;
 * small pixel deltas (trackpads) add up until WHEEL_STEP_PX.
 * @param {number} deltaY @param {number} deltaMode 0 = pixel, 1 = line, 2 = page @param {number} acc carried pixels
 * @returns {{ steps: number, acc: number }}
 */
export function wheelStep(deltaY, deltaMode, acc = 0) {
  if (!deltaY) return { steps: 0, acc };
  if (deltaMode !== 0 || Math.abs(deltaY) >= WHEEL_STEP_PX) return { steps: Math.sign(deltaY), acc: 0 };
  const sum = acc + deltaY;
  if (Math.abs(sum) >= WHEEL_STEP_PX) return { steps: Math.sign(sum), acc: 0 };
  return { steps: 0, acc: sum };
}

/**
 * Keyboard like a spin button: ArrowUp/Down ±1, PageUp/Down ±10, Home/End. null = not our key.
 * @param {string} key @param {number} v @param {number} min @param {number} max
 */
export function keyValue(key, v, min, max) {
  const step = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[key];
  if (step) return clamp(v + step, min, max);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}

/**
 * Typing digits: two digits in a row jump to that value («1», «7» → 17). A first digit that cannot start
 * a two-digit value (e.g. «5» for hours) is taken at once. Returns the new value and what to keep
 * waiting for (the caller forgets the buffer after a second).
 * @param {string} buffer @param {string} digit @param {number} min @param {number} max
 * @returns {{ value: number | null, buffer: string }}
 */
export function typeDigit(buffer, digit, min, max) {
  if (!/^\d$/.test(digit)) return { value: null, buffer: '' };
  if (buffer.length === 1) {
    const two = Number(buffer + digit);
    if (two >= min && two <= max) return { value: two, buffer: '' };
  }
  const one = Number(digit);
  if (one * 10 > max) return { value: one >= min && one <= max ? one : null, buffer: '' };
  return { value: clamp(one, min, max), buffer: digit };
}

/**
 * State of one column, without DOM. `mode`: 'idle' (only programmatic changes), 'touch' (a finger is
 * on the column: the value follows the position), 'coast' (finger lifted, the column may still move).
 */
export class WheelModel {
  /** @param {number} min @param {number} max */
  constructor(min, max) {
    this.min = min;
    this.max = max;
    this.value = min;
    /** @type {'idle'|'touch'|'coast'} */
    this.mode = 'idle';
  }

  /** Programmatic change: the value is set now; any user scrolling in progress is overruled. @param {number} v */
  set(v) {
    this.value = clamp(v, this.min, this.max);
    this.mode = 'idle';
    return this.value;
  }

  touchStart() {
    this.mode = 'touch';
  }

  touchEnd() {
    if (this.mode === 'touch') this.mode = 'coast';
  }

  /**
   * A scroll event at `scrollTop`. Returns what to do: 'changed' (the user moved the value),
   * 'realign' (not the user, and the position does not match the value: put the column back), or null.
   * @param {number} scrollTop @param {number} row
   */
  scrolled(scrollTop, row) {
    const at = valueAt(scrollTop, row, this.min, this.max);
    if (this.mode === 'idle') return at === this.value ? null : 'realign';
    if (at === this.value) return null;
    this.value = at;
    return 'changed';
  }

  /** The column has come to rest after the finger left (scrollend or a quiet moment). */
  settled() {
    if (this.mode === 'coast') this.mode = 'idle';
  }

  /**
   * Submit: while the user still moves the column, take the row under the centre line now and stop
   * there. Returns the final value. @param {number} scrollTop @param {number} row
   */
  commit(scrollTop, row) {
    if (this.mode !== 'idle') this.value = valueAt(scrollTop, row, this.min, this.max);
    this.mode = 'idle';
    return this.value;
  }

  /** New dialog: nothing from before carries over. */
  reset() {
    this.mode = 'idle';
  }
}

const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * One column. `onChange` runs synchronously on every change of the value.
 * @param {{ min: number, max: number, label: string, onChange: (v: number) => void }} o
 */
export function createWheel(o) {
  const { min, max } = o;
  const model = new WheelModel(min, max);
  let acc = 0;
  let typed = '';
  let typedAt = 0;
  let quiet = 0;
  let shown = -1;

  const items = [];
  for (let v = min; v <= max; v++) items.push(h('div', { class: 'wheel-item', 'data-v': v, 'aria-hidden': 'true' }, pad2(v)));
  const col = h('div', { class: 'wheel-col' }, h('div', { class: 'wheel-pad' }), items, h('div', { class: 'wheel-pad' }));
  const el = h(
    'div',
    {
      class: 'wheel',
      role: 'spinbutton',
      tabindex: '0',
      'aria-label': o.label,
      'aria-valuemin': min,
      'aria-valuemax': max,
    },
    col,
  );

  const rowH = () => /** @type {HTMLElement} */ (items[0]).offsetHeight || 40;

  /** Show the model's value (highlight, ARIA) and report it. */
  /** @param {boolean} [force] report even if unchanged */
  function show(force = false) {
    const v = model.value;
    if (v === shown && !force) return;
    if (shown >= min) items[shown - min].classList.remove('sel');
    shown = v;
    items[v - min].classList.add('sel');
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', pad2(v));
    o.onChange(v);
  }

  /** Put the column under the value, instantly (no animation that could report positions in between). */
  function position() {
    const top = offsetFor(model.value, rowH(), min);
    if (Math.abs(col.scrollTop - top) >= 1) col.scrollTop = top; // instant: .wheel-col has no smooth scroll-behavior
  }

  /** @param {number} v @param {boolean} [force] */
  function set(v, force = false) {
    clearTimeout(quiet);
    model.set(v);
    show(force);
    position();
  }

  col.addEventListener(
    'scroll',
    () => {
      const r = model.scrolled(col.scrollTop, rowH());
      if (r === 'changed') show();
      else if (r === 'realign') position();
      if (model.mode === 'coast') {
        clearTimeout(quiet);
        quiet = window.setTimeout(() => model.settled(), COAST_QUIET_MS);
      }
    },
    { passive: true },
  );
  col.addEventListener('scrollend', () => {
    if (model.mode !== 'coast') return;
    clearTimeout(quiet);
    model.settled();
  });
  col.addEventListener('touchstart', () => model.touchStart(), { passive: true });
  const lift = () => {
    model.touchEnd();
    clearTimeout(quiet);
    // No scroll event may follow (a tap without movement): come to rest after a quiet moment.
    quiet = window.setTimeout(() => model.settled(), COAST_QUIET_MS);
  };
  col.addEventListener('touchend', lift, { passive: true });
  col.addEventListener('touchcancel', lift, { passive: true });
  // One notch = one step; the page and the dialog do not scroll while the pointer is over the picker.
  col.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = wheelStep(e.deltaY, e.deltaMode, acc);
      acc = r.acc;
      if (r.steps) set(model.value + r.steps);
    },
    { passive: false },
  );
  col.addEventListener('click', (e) => {
    const it = /** @type {HTMLElement} */ (e.target).closest('.wheel-item');
    if (it) set(Number(/** @type {HTMLElement} */ (it).dataset.v));
    el.focus({ preventScroll: true });
  });
  el.addEventListener('keydown', (e) => {
    const k = keyValue(e.key, model.value, min, max);
    if (k != null) {
      e.preventDefault();
      set(k);
      return;
    }
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      const now = Date.now();
      const r = typeDigit(now - typedAt < 1000 ? typed : '', e.key, min, max);
      typed = r.buffer;
      typedAt = now;
      if (r.value != null) set(r.value);
    }
  });

  return {
    el,
    get value() {
      return model.value;
    },
    /** Set the value now (the dialog opening; forgets typed digits and any movement from before). @param {number} v */
    set: (v) => {
      model.reset();
      typed = '';
      acc = 0;
      set(v, true);
    },
    /** Before saving: settle a wheel that is still moving at the row under the centre line. */
    commit() {
      clearTimeout(quiet);
      const before = model.value;
      model.commit(col.scrollTop, rowH());
      if (model.value !== before) show();
      position();
      return model.value;
    },
  };
}
