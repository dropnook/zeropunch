// The list without the DOM: which rows and controls a day gets, and deleting a punch through a
// confirmation. Pure enough to test in Node (test/unit/listview.test.js); app.js turns it into elements.

import { t, tn } from './i18n.js';
import { timeOfDay, absenceType, absenceCredit, DEFAULT_TZ } from './time.js';

/**
 * @typedef {{ kind: 'edit' | 'delete', aria: string }} Control
 * @typedef {{ dir: 'in' | 'out', entry: any | null, time: string, controls: Control[] }} PunchRow
 * @typedef {{ status: string, dur: number, rows: PunchRow[], notes: string[] }} PairBlock
 * @typedef {{ absence: any, label: string, credit: number, note: string, controls: Control[] }} AbsenceRow
 */

/** «Vacation» / «Vacation · half day». @param {{ type: string, half?: boolean }} a */
export function absenceLabel(a) {
  const name = t(`abs_${absenceType(a.type)}`);
  return a.half ? t('abs_half_label', { name }) : name;
}

/**
 * The absence rows of a day (usually one): label, the credited time and a delete control.
 * @param {import('./time.js').Day} d @param {number} weekHours @returns {AbsenceRow[]}
 */
export function absenceRows(d, weekHours) {
  return (d.absences || []).map((a) => {
    const label = absenceLabel(a);
    return { absence: a, label, credit: absenceCredit(a, weekHours), note: a.note || '', controls: [{ kind: 'delete', aria: t('delete_absence_aria', { what: label }) }] };
  });
}

/**
 * Delete an absence from the list: ask first (naming day and kind), then write its tombstone, then tell.
 * @param {{ remove: (id: string) => Promise<any> }} store
 * @param {{ id: string, type: string, half?: boolean }} absence
 * @param {string} dayText the day as shown to people
 * @param {{ confirm: (title: string, text: string, opt: { ok: string }) => Promise<boolean>, toast: (msg: string) => void, message: (e: any) => string }} ui
 * @returns {Promise<boolean>} deleted
 */
export async function deleteAbsence(store, absence, dayText, ui) {
  const what = absenceLabel(absence);
  const ok = await ui.confirm(t('delete_absence_title'), t('delete_absence_text', { what, day: dayText }), { ok: t('delete') });
  if (!ok) return false;
  try {
    await store.remove(absence.id);
  } catch (e) {
    ui.toast(ui.message(e));
    return false;
  }
  ui.toast(t('absence_deleted', { what, day: dayText }));
  return true;
}

/**
 * One block per pair, one row per punch with an edit and a delete control. An unpaired last punch gets
 * a second row without entry (the «…» to add the missing punch on that day).
 * @param {import('./time.js').Day} d @returns {PairBlock[]}
 */
export function dayBlocks(d) {
  return d.pairs.map((p) => {
    /** @param {'in'|'out'} dir @param {any} e @returns {PunchRow} */
    const row = (dir, e) => {
      if (!e) return { dir, entry: null, time: '…', controls: [] };
      const time = timeOfDay(e.ts, e.tz || DEFAULT_TZ);
      return {
        dir,
        entry: e,
        time,
        controls: [
          { kind: 'edit', aria: t('edit_aria', { time }) },
          { kind: 'delete', aria: t('delete_aria', { time }) },
        ],
      };
    };
    return {
      status: p.status,
      dur: p.dur,
      rows: [row('in', p.in), row('out', p.out)],
      notes: [p.in?.note, p.out?.note].filter(Boolean),
    };
  });
}

/**
 * Delete one punch from the list: ask first (naming day and time), then write the tombstone, then tell.
 * @param {{ remove: (id: string) => Promise<any> }} store
 * @param {{ id: string, ts: number, tz?: string }} entry
 * @param {string} dayText the day as shown to people, e.g. «Mon 23 Nov»
 * @param {{ confirm: (title: string, text: string, opt: { ok: string }) => Promise<boolean>, toast: (msg: string) => void, message: (e: any) => string }} ui
 * @returns {Promise<boolean>} deleted
 */
export async function deletePunch(store, entry, dayText, ui) {
  const time = timeOfDay(entry.ts, entry.tz || DEFAULT_TZ);
  const ok = await ui.confirm(t('delete_punch_title'), t('delete_punch_text', { time, day: dayText }), { ok: t('delete') });
  if (!ok) return false;
  try {
    await store.remove(entry.id);
  } catch (e) {
    ui.toast(ui.message(e));
    return false;
  }
  ui.toast(t('punch_deleted', { time }));
  return true;
}

/**
 * Delete all punches of one day from the list: ask once (naming the day and the number), then write
 * the tombstones one after the other, then tell how many went.
 * @param {{ remove: (id: string) => Promise<any> }} store
 * @param {{ id: string }[]} punches the day's punches
 * @param {string} dayText the day as shown to people
 * @param {{ confirm: (title: string, text: string, opt: { ok: string }) => Promise<boolean>, toast: (msg: string) => void, message: (e: any) => string }} ui
 * @returns {Promise<number>} how many were deleted
 */
export async function deleteDay(store, punches, dayText, ui) {
  if (!punches.length) return 0;
  const ok = await ui.confirm(t('delete_day_title'), tn('delete_day_text', punches.length, { day: dayText }), { ok: t('delete') });
  if (!ok) return 0;
  let done = 0;
  try {
    for (const p of punches) {
      await store.remove(p.id);
      done++;
    }
  } catch (e) {
    ui.toast(ui.message(e));
    return done;
  }
  ui.toast(tn('day_deleted', done));
  return done;
}
