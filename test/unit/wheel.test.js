import { describe, it, expect } from 'vitest';
import { clamp, valueAt, offsetFor, wheelStep, keyValue, typeDigit, WHEEL_STEP_PX, WheelModel } from '../../public/js/wheel.js';

describe('time wheel: value and scroll position', () => {
  it('value ↔ scroll position, both ways, clamped', () => {
    const row = 40;
    for (const v of [0, 7, 23]) expect(valueAt(offsetFor(v, row, 0), row, 0, 23)).toBe(v);
    expect(valueAt(19 * row + 19, row, 0, 59)).toBe(19); // just below the half row: stays
    expect(valueAt(19 * row + 21, row, 0, 59)).toBe(20); // past the half row: next
    expect(valueAt(-50, row, 0, 23)).toBe(0);
    expect(valueAt(99 * row, row, 0, 23)).toBe(23);
    expect(valueAt(100, 0, 0, 23)).toBe(0); // no layout yet
    expect(clamp(24, 0, 23)).toBe(23);
    expect(clamp(-1, 0, 59)).toBe(0);
    expect(clamp(4.6, 0, 59)).toBe(5);
  });
});

describe('time wheel: mouse wheel', () => {
  it('one notch is one step, whatever its size', () => {
    expect(wheelStep(100, 0, 0)).toEqual({ steps: 1, acc: 0 });
    expect(wheelStep(-120, 0, 0)).toEqual({ steps: -1, acc: 0 });
    expect(wheelStep(3, 1, 0)).toEqual({ steps: 1, acc: 0 }); // line mode (Firefox)
    expect(wheelStep(-1, 2, 0)).toEqual({ steps: -1, acc: 0 }); // page mode
    expect(wheelStep(0, 0, 7)).toEqual({ steps: 0, acc: 7 });
  });

  it('small trackpad deltas add up to one step', () => {
    let acc = 0;
    let steps = 0;
    for (let i = 0; i < 4; i++) {
      const r = wheelStep(10, 0, acc);
      acc = r.acc;
      steps += r.steps;
    }
    expect(steps).toBe(1);
    expect(acc).toBe(0);
    expect(wheelStep(-10, 0, 20)).toEqual({ steps: 0, acc: 10 }); // direction change eats the rest
    expect(WHEEL_STEP_PX).toBe(40);
  });
});

describe('time wheel: keyboard', () => {
  it('arrows ±1, page ±10, Home/End, clamped', () => {
    expect(keyValue('ArrowUp', 5, 0, 23)).toBe(6);
    expect(keyValue('ArrowDown', 0, 0, 23)).toBe(0);
    expect(keyValue('PageUp', 55, 0, 59)).toBe(59);
    expect(keyValue('PageDown', 15, 0, 59)).toBe(5);
    expect(keyValue('Home', 30, 0, 59)).toBe(0);
    expect(keyValue('End', 3, 0, 23)).toBe(23);
    expect(keyValue('a', 3, 0, 23)).toBeNull();
  });

  it('typing two digits jumps to that value', () => {
    // hours: «1» then «7» → 1, then 17
    let r = typeDigit('', '1', 0, 23);
    expect(r).toEqual({ value: 1, buffer: '1' });
    r = typeDigit(r.buffer, '7', 0, 23);
    expect(r).toEqual({ value: 17, buffer: '' });
    // «5» cannot start an hour: taken at once
    expect(typeDigit('', '5', 0, 23)).toEqual({ value: 5, buffer: '' });
    // «2» «9» = 29 is no hour: the 9 is taken alone
    expect(typeDigit('2', '9', 0, 23)).toEqual({ value: 9, buffer: '' });
    // minutes: «4» «5» → 45; «0» «7» → 7
    expect(typeDigit(typeDigit('', '4', 0, 59).buffer, '5', 0, 59).value).toBe(45);
    expect(typeDigit('0', '7', 0, 59).value).toBe(7);
    expect(typeDigit('', 'x', 0, 59)).toEqual({ value: null, buffer: '' });
  });
});

describe('time wheel: one source of truth (WheelModel)', () => {
  const row = 40;

  it('a programmatic change is final at once; scroll events of our own movement never change it', () => {
    const m = new WheelModel(0, 59);
    expect(m.set(33)).toBe(33);
    // a smooth or delayed movement from 0 towards 33 reports positions in between: all ignored
    for (const top of [0, 3 * row, 12.4 * row, 20 * row, 32.4 * row]) {
      const r = m.scrolled(top, row);
      expect(m.value).toBe(33);
      expect(r).toBe('realign'); // the column is put back under the value, not the other way round
    }
    expect(m.scrolled(33 * row, row)).toBeNull();
    expect(m.value).toBe(33);
  });

  it('a stale position from the previous opening cannot overwrite a new value', () => {
    const m = new WheelModel(0, 23);
    m.set(8);
    m.touchStart();
    m.scrolled(12 * row, row);
    m.touchEnd(); // still coasting when the dialog closes …
    m.reset(); // … and opens again
    m.set(3);
    expect(m.scrolled(12 * row, row)).toBe('realign');
    expect(m.value).toBe(3);
  });

  it('with a finger on the column the value follows the position, also while coasting', () => {
    const m = new WheelModel(0, 23);
    m.set(5);
    m.touchStart();
    expect(m.scrolled(7 * row, row)).toBe('changed');
    expect(m.value).toBe(7);
    m.touchEnd();
    expect(m.mode).toBe('coast');
    expect(m.scrolled(9.4 * row, row)).toBe('changed');
    expect(m.value).toBe(9);
    m.settled();
    expect(m.mode).toBe('idle');
    expect(m.scrolled(15 * row, row)).toBe('realign'); // not the user any more
    expect(m.value).toBe(9);
  });

  it('commit at submit: a coasting wheel stops at the row under the centre line at that moment', () => {
    const m = new WheelModel(0, 59);
    m.set(10);
    m.touchStart();
    m.scrolled(14 * row, row); // last scroll event seen: 14
    m.touchEnd();
    // the column has moved on to 17.3 rows, no scroll event handled yet: the saved value is 17, not 14
    expect(m.commit(17.3 * row, row)).toBe(17);
    expect(m.mode).toBe('idle');
    expect(m.scrolled(19 * row, row)).toBe('realign'); // the rest of the coasting no longer counts
    expect(m.value).toBe(17);
    // idle: commit keeps the value, whatever the position says
    expect(m.commit(40 * row, row)).toBe(17);
  });

  it('a programmatic change during a drag wins and ends the drag', () => {
    const m = new WheelModel(0, 23);
    m.touchStart();
    m.scrolled(4 * row, row);
    m.set(21);
    expect(m.mode).toBe('idle');
    expect(m.scrolled(5 * row, row)).toBe('realign');
    expect(m.value).toBe(21);
    expect(m.set(99)).toBe(23);
  });
});
