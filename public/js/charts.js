// Hand-made SVG charts. Colours come from app.css (classes), no inline styles.

import { s } from './dom.js';
import { formatDur } from './time.js';
import { t, tn, weekdayShort, locale } from './i18n.js';

const H = 3600_000;

/**
 * Hours per week as bars, target as a line.
 * @param {{ start: string, week: number, sum: number }[]} weeks oldest first
 * @param {number} targetHours
 */
export function weekBars(weeks, targetHours) {
  const W = 320, Hh = 160, padL = 28, padB = 22, padT = 8;
  const max = Math.max(targetHours * 1.15, ...weeks.map((w) => w.sum / H), 1);
  const plotH = Hh - padB - padT;
  const plotW = W - padL - 4;
  const bw = plotW / weeks.length;
  const y = (/** @type {number} */ hours) => padT + plotH - (hours / max) * plotH;

  const svg = s('svg', {
    viewBox: `0 0 ${W} ${Hh}`,
    class: 'chart',
    role: 'img',
    'aria-label': t('chart_week_aria', { n: weeks.length, h: targetHours }),
  });
  // grid
  const step = max > 60 ? 20 : 10;
  for (let v = 0; v <= max; v += step) {
    svg.append(s('line', { x1: padL, x2: W - 4, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(s('text', { x: padL - 4, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, String(v)));
  }
  weeks.forEach((w, i) => {
    const hours = w.sum / H;
    const x = padL + i * bw + bw * 0.15;
    const top = y(hours);
    const bar = s('rect', {
      x,
      y: top,
      width: bw * 0.7,
      height: Math.max(0, padT + plotH - top),
      rx: 2,
      class: hours >= targetHours ? 'bar bar-ok' : 'bar',
    });
    bar.append(s('title', {}, t('bar_title', { w: w.week, dur: formatDur(w.sum) })));
    svg.append(bar);
    if (i % 2 === weeks.length % 2 || weeks.length <= 8) {
      svg.append(s('text', { x: x + bw * 0.35, y: Hh - 6, class: 'axis', 'text-anchor': 'middle' }, String(w.week)));
    }
  });
  svg.append(s('line', { x1: padL, x2: W - 4, y1: y(targetHours), y2: y(targetHours), class: 'target' }));
  return svg;
}

/**
 * Hours per calendar month as bars; each month's own target (its workdays) as a short tick on the bar.
 * Labels: the month's narrow name (J F M …), the full name with year in the tooltip.
 * @param {{ month: string, start: string, sum: number, target: number }[]} months oldest first
 */
export function monthBars(months) {
  const W = 320, Hh = 150, padL = 32, padB = 22, padT = 8;
  const max = Math.max(...months.map((m) => Math.max(m.sum, m.target * 1.1) / H), 1);
  const plotH = Hh - padB - padT;
  const plotW = W - padL - 4;
  const bw = plotW / months.length;
  const y = (/** @type {number} */ hours) => padT + plotH - (hours / max) * plotH;
  const narrow = new Intl.DateTimeFormat(locale(), { month: 'narrow', timeZone: 'UTC' });
  const full = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const date = (/** @type {string} */ start) => Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 15);

  const svg = s('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'chart', role: 'img', 'aria-label': t('chart_month_aria', { n: months.length }) });
  const step = max > 200 ? 100 : max > 80 ? 50 : 20;
  for (let v = 0; v <= max; v += step) {
    svg.append(s('line', { x1: padL, x2: W - 4, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(s('text', { x: padL - 4, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, String(v)));
  }
  months.forEach((m, i) => {
    const hours = m.sum / H;
    const x = padL + i * bw + bw * 0.15;
    const top = y(hours);
    const ok = m.target > 0 && m.sum >= m.target;
    const bar = s('rect', { x, y: top, width: bw * 0.7, height: Math.max(0, padT + plotH - top), rx: 2, class: ok ? 'bar bar-ok' : 'bar' });
    bar.append(s('title', {}, t('bar_month_title', { month: full.format(date(m.start)), dur: formatDur(m.sum), target: formatDur(m.target) })));
    svg.append(bar);
    if (m.target > 0) svg.append(s('line', { x1: x - 1, x2: x + bw * 0.7 + 1, y1: y(m.target / H), y2: y(m.target / H), class: 'target' }));
    svg.append(s('text', { x: x + bw * 0.35, y: Hh - 6, class: 'axis', 'text-anchor': 'middle' }, narrow.format(date(m.start))));
  });
  return svg;
}

/**
 * Stamp heatmap weekday × hour.
 * @param {number[][]} heat 7 × 24
 */
export function heatmap(heat) {
  const cell = 12, gap = 1, padL = 20, padT = 14;
  const W = padL + 24 * (cell + gap), Hh = padT + 7 * (cell + gap);
  const max = Math.max(1, ...heat.flat());
  const svg = s('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'chart heat', role: 'img', 'aria-label': t('heat_aria') });
  for (let hr = 0; hr < 24; hr += 3) {
    svg.append(s('text', { x: padL + hr * (cell + gap), y: 10, class: 'axis' }, String(hr)));
  }
  heat.forEach((row, d) => {
    svg.append(s('text', { x: 0, y: padT + d * (cell + gap) + cell - 2, class: 'axis' }, weekdayShort(d)));
    row.forEach((n, hr) => {
      const level = n === 0 ? 0 : Math.ceil((n / max) * 4); // 0–4
      const r = s('rect', {
        x: padL + hr * (cell + gap),
        y: padT + d * (cell + gap),
        width: cell,
        height: cell,
        rx: 2,
        class: `hc hc${level}`,
      });
      r.append(s('title', {}, tn('heat_title', n, { day: weekdayShort(d), h: hr, h2: hr + 1 })));
      svg.append(r);
    });
  });
  return svg;
}
