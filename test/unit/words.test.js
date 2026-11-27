// «Stempel» instead of «Punch»: with the button «Jetzt stempeln» or «Stempeln» every German text says
// «Stempel» (i18n.js setWords / stempel), new texts included; English keeps «punch».
import { describe, it, expect, afterEach } from 'vitest';
import { DICT, t, setLang, setWords, stempel, KEEP_PUNCH } from '../../public/js/i18n.js';
import { buttonWords, buttonLabel, buttonLabelKey, BUTTON_LABELS } from '../../public/js/store.js';

afterEach(() => {
  setWords('punch');
  setLang('en');
});

describe('the words follow the button', () => {
  it('«Jetzt stempeln» and «Stempeln» switch to «stamp», the others keep «punch»; unknown values are the default', () => {
    expect(BUTTON_LABELS).toEqual(['inout', 'punch', 'now', 'stamp']);
    expect(['inout', 'punch', 'now', 'stamp', 'x', undefined].map(buttonWords)).toEqual(['punch', 'punch', 'stamp', 'stamp', 'punch', 'punch']);
    expect(buttonLabel('stamp')).toBe('stamp');
    expect(buttonLabelKey('stamp')).toBe('punch_stamp');
    setLang('de');
    expect(t('punch_stamp')).toBe('Stempeln');
  });

  it('every German text says «Stempel»: no «Punch» left apart from the product name and the labels to choose from', () => {
    setLang('de');
    setWords('stamp');
    for (const key of Object.keys(DICT.de)) {
      if (KEEP_PUNCH.has(key)) continue;
      const s = t(key).replaceAll('Zeropunch', '');
      expect(s, key).not.toMatch(/punch/i);
    }
    // the labels to choose from stay as they are
    expect(t('punch_inout')).toBe('Punch in/out');
    expect(t('punch')).toBe('Punch');
  });

  it('grammar: singular, plural, dative plural, the verb and its forms, compounds', () => {
    expect(stempel('Heute noch kein Punch')).toBe('Heute noch kein Stempel');
    expect(stempel('{n} Punches gelöscht.')).toBe('{n} Stempel gelöscht.');
    expect(stempel('Tage mit Punches')).toBe('Tage mit Stempeln');
    expect(stempel('samt ihren Punches gelöscht')).toBe('samt ihren Stempeln gelöscht');
    expect(stempel('Jetzt punchen?')).toBe('Jetzt stempeln?');
    expect(stempel('Punchen mit NFC-Kleber')).toBe('Stempeln mit NFC-Kleber');
    expect(stempel('der Link puncht sofort')).toBe('der Link stempelt sofort');
    expect(stempel('Eben schon gepuncht')).toBe('Eben schon gestempelt');
    expect(stempel('Punch-Link ohne Rückfrage')).toBe('Stempel-Link ohne Rückfrage');
    expect(stempel('Zeropunch speichert jeden Punch')).toBe('Zeropunch speichert jeden Stempel');
  });

  it('English keeps «punch»; back to «punch» brings the German texts back', () => {
    setWords('stamp');
    setLang('en');
    expect(t('state_none')).toBe(DICT.en.state_none);
    setLang('de');
    expect(t('state_none')).toBe('Heute noch kein Stempel');
    expect(setWords('punch')).toBe(true);
    expect(t('state_none')).toBe('Heute noch kein Punch');
    expect(setWords('punch')).toBe(false); // no change: the app need not redraw
  });
});
