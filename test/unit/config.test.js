// Checks on files that ship: headers in sync, Worker config, texts complete, nothing private.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SECURITY_HEADERS } from '../../src/headers.js';
import { DICT, APP_NAME, WORDMARK, fromNavigator, t, tn, wordMatches, setLang, SHY, plain, applyStatic } from '../../public/js/i18n.js';
import { FX_CHOICES } from '../../public/js/store.js';

const root = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

/** @param {string} text */
function parseHeaders(text) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) out[(cur = line.trim())] = {};
    else {
      const i = line.indexOf(':');
      out[/** @type {string} */ (cur)][line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

describe('static delivery', () => {
  it('public/_headers sends exactly the Worker security headers to every file', () => {
    const h = parseHeaders(read('public/_headers'));
    expect(h['/*']).toEqual(SECURITY_HEADERS);
    for (const p of ['/', '/sw.js', '/manifest.webmanifest']) expect(h[p]['Cache-Control']).toBe('no-cache');
  });

  it('wrangler.jsonc: Worker only for /api/*, daily cron, no secrets or test switches', () => {
    const w = read('wrangler.jsonc');
    expect(w).toMatch(/"run_worker_first":\s*\["\/api\/\*"\]/);
    expect(w).toMatch(/"crons":\s*\["[^"]+"\]/);
    expect(w).toMatch(/"name": "zeropunch"/);
    expect(w).not.toMatch(/PEPPER"\s*:/);
    expect(w).not.toMatch(/addresses|MAIL_|ALLOWED_DOMAINS|LOGIN_ADDRESS/);
  });

  it('service worker answers only the app itself from the cache (e.g. /about/ goes to the network)', () => {
    const sw = read('public/sw.js');
    expect(sw).toMatch(/CACHE_VERSION = 'zp-v2026\.11\.25'/);
    expect(sw).toMatch(/url\.pathname !== '\/' && url\.pathname !== '\/index\.html'\) return;/);
    expect(sw).toMatch(/if \(!SHELL_SET\.has\(url\.pathname\)\) return;/);
    // every file in the shell exists
    const shell = [...sw.matchAll(/^\s+'(\/[^']*)',$/gm)].map((m) => m[1]);
    for (const p of shell) {
      if (p !== '/') expect(statSync(join(root, 'public', p)).isFile(), p).toBe(true);
    }
    // … and every module and stylesheet of the app is in the shell (the lazily loaded animation included)
    for (const f of readdirSync(join(root, 'public/js'))) expect(shell, f).toContain(`/js/${f}`);
    for (const f of readdirSync(join(root, 'public')).filter((x) => x.endsWith('.css'))) expect(shell, f).toContain(`/${f}`);
    // … and every animation scene (module + stylesheet, each loaded only when it plays)
    const scenes = readdirSync(join(root, 'public/fx'));
    expect(scenes.length).toBeGreaterThan(0);
    for (const f of scenes) expect(shell, f).toContain(`/fx/${f}`);
  });

  it('the new service worker reloads open pages once only when it replaces a version with the recovery key (≤ 2.3)', () => {
    const sw = read('public/sw.js');
    const re = new RegExp(/RELOAD_FROM = \/(.*)\/;/.exec(sw)[1]);
    for (const k of ['zp-v2.3.1', 'zp-v2.3.0', 'zp-v2.0.0', 'zp-v1.4.2']) expect(re.test(k), k).toBe(true);
    for (const k of ['zp-v2.4.0', 'zp-v2.4.1', 'zp-v2.10.0', 'zp-v3.0.0', 'other']) expect(re.test(k), k).toBe(false);
    expect(sw).toMatch(/navigate\(c\.url\)/);
  });

  it('one version everywhere: package.json, app, Worker, service worker cache', async () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.version).toBe('2026.11.25');
    expect(read('public/js/app.js')).toMatch(new RegExp(`APP_VERSION = '${pkg.version.replace(/\./g, '\\.')}'`));
    expect(read('public/sw.js')).toContain(`CACHE_VERSION = 'zp-v${pkg.version}'`);
    expect((await import('../../src/api.js')).VERSION).toBe(pkg.version);
  });

  it('nothing under /about/ is taken by the app; /about redirects to the product site', () => {
    expect(() => statSync(join(root, 'public/about'))).toThrow();
    const r = read('public/_redirects');
    expect(r).toMatch(/^\/about https:\/\/zeropunch\.dropnook\.app\/ 302$/m);
    expect(r).toMatch(/^\/about\/\* https:\/\/zeropunch\.dropnook\.app\/ 302$/m);
  });
});

describe('texts', () => {
  it('English and German have the same keys and no empty text', () => {
    expect(Object.keys(DICT.de).sort()).toEqual(Object.keys(DICT.en).sort());
    for (const l of ['en', 'de']) for (const [k, v] of Object.entries(DICT[l])) expect(v.trim(), `${l}.${k}`).not.toBe('');
  });

  it('limits in texts come from the constants, never written out', () => {
    for (const l of ['en', 'de']) {
      for (const [k, v] of Object.entries(DICT[l])) {
        // 90 only as the «90 days» range of the key figures and 13 only for the 13-week chart; months via {months}
        if (k !== 'range_90d' && k !== 'h_weekhours') expect(v, `${l}.${k}`).not.toMatch(/\b(90|50|61|396|13)\b/);
      }
    }
    setLang('en');
    expect(t('retention_note')).toMatch(/^Punches are kept for 13 months/);
    expect(t('idle_note')).toBe('Accounts not used for 61 days are deleted together with their punches.');
    expect(t('away_text', { n: 45 })).toBe('You were away for 45 days. After 61 days without use the account is deleted.');
    expect(t('day_full')).toMatch(/^12 punches today/);
    setLang('de');
    expect(t('idle_note')).toBe('Konten, die 61 Tage nicht benutzt werden, werden samt ihren Punches gelöscht.');
    expect(t('away_text', { n: 45 })).toBe('Du warst 45 Tage weg. Nach 61 Tagen ohne Nutzung wird das Konto gelöscht.');
    expect(t('err_too_old')).toBe('Erfassen geht nur für die letzten 13 Monate.');
    setLang('en');
  });

  it('German in Swiss spelling: no ß, «» quotes', () => {
    for (const [k, v] of Object.entries(DICT.de)) {
      expect(v, k).not.toMatch(/ß/);
      expect(v, k).not.toMatch(/[„“”"]/);
    }
  });

  it('every data-i18n key in index.html exists', () => {
    const html = read('public/index.html');
    const keys = [...html.matchAll(/data-i18n(?:-aria|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) expect(DICT.en[k], k).toBeTypeOf('string');
  });

  it('every t() key used in the client exists', () => {
    for (const f of ['app.js', 'charts.js', 'listview.js', 'sheet.js']) {
      const src = read(`public/js/${f}`);
      for (const m of src.matchAll(/\bt\('([a-z0-9_]+)'/g)) expect(DICT.en[m[1]], `${f}: ${m[1]}`).toBeTypeOf('string');
      // tn(): singular and plural form in both languages
      for (const m of src.matchAll(/\btn\('([a-z0-9_]+)'/g)) {
        for (const l of ['en', 'de']) for (const f2 of ['one', 'other']) expect(DICT[l][`${m[1]}_${f2}`], `${l} ${m[1]}_${f2}`).toBeTypeOf('string');
      }
    }
  });

  it('every text is used somewhere (no dead keys left behind)', () => {
    const i18n = read('public/js/i18n.js');
    const src = ['app.js', 'charts.js', 'listview.js', 'sheet.js', 'store.js', 'wheel.js'].map((f) => read(`public/js/${f}`)).join('\n') +
      read('public/index.html') + i18n.slice(i18n.indexOf('let lang'));
    // The animation names are built from FX_CHOICES (`fx_${v}` in app.js): each choice has a text, no other fx_ key exists.
    expect(src).toContain('`fx_${v}`');
    const fxKeys = Object.keys(DICT.en).filter((k) => /^fx_/.test(k) && !['fx_hint', 'fx_reduced'].includes(k));
    expect(fxKeys.map((k) => k.slice(3)).sort()).toEqual([...FX_CHOICES].sort());
    for (const k of Object.keys(DICT.en)) {
      if (fxKeys.includes(k)) continue;
      const base = k.replace(/_(one|other)$/, '');
      expect(src.includes(`'${k}'`) || src.includes(`"${k}"`) || src.includes(`'${base}'`), k).toBe(true);
    }
  });

  // The animation picker's tiles are narrow: at 390 px (five columns) a name has 57 px of text at
  // 0.72rem, and the chosen tile shows it in bold (800). Measured in Chromium: the widest 8-character
  // runs («maschine», «Schreib-») fit in bold, a 9-character one («Hourglass») does not. So no piece of a
  // name between two break points (space, hyphen, soft hyphen; a hyphen shown at the break counts) may
  // be longer than 8 characters. app.css has hyphens: manual and no overflow-wrap/word-break on the
  // name: it breaks only there, never inside a syllable, and is never clipped.
  it('animation names: no unbreakable run longer than fits a tile, soft hyphens only inside words', () => {
    const FIT = 8;
    for (const l of ['en', 'de']) {
      for (const v of FX_CHOICES) {
        const label = DICT[l][`fx_${v}`];
        expect(label, `${l}.fx_${v}`).not.toMatch(/(^|[\s-])\u00AD|\u00AD($|[\s-])|\u00AD\u00AD/);
        // pieces as they can appear on a line: a soft hyphen becomes «-» at a break, a hyphen stays
        const runs = label.split(/\s+/).flatMap((w) => w.replace(/\u00AD/g, '-').match(/[^-]+-?/g) || []);
        for (const r of runs) expect(r.length, `${l}.fx_${v}: «${r}»`).toBeLessThanOrEqual(FIT);
      }
    }
    // the plain form has none left, and no other text carries a soft hyphen
    for (const l of ['en', 'de'])
      for (const [k, v] of Object.entries(DICT[l])) {
        expect(plain(v), `${l}.${k}`).not.toContain(SHY);
        if (!k.startsWith('fx_')) expect(v, `${l}.${k}`).not.toContain(SHY);
      }
    expect(DICT.de.fx_typewriter).toBe('Schreib\u00ADmaschine');
    expect(plain(DICT.de.fx_typewriter)).toBe('Schreibmaschine');
  });

  it('animation names: accessible names carry no soft hyphen', () => {
    // The tile: the radio button is named by the plain name, the visible name (with soft hyphens) is hidden from assistive technology.
    const app = read('public/js/app.js');
    expect(app).toMatch(/h\('input', \{ type: 'radio', name: 'punch-fx', value: v, 'aria-label': plain\(t\(`fx_\$\{v\}`\)\), 'data-i18n-aria': `fx_\$\{v\}` \}\)/);
    expect(app).toMatch(/h\('span', \{ class: 'fx-name', 'aria-hidden': 'true', 'data-i18n': `fx_\$\{v\}` \}/);
    // … and on a language switch applyStatic() renames it without soft hyphens (texts keep them).
    /** @param {Record<string, string>} attrs */
    const el = (attrs) => ({ attrs: { ...attrs }, textContent: '', getAttribute(/** @type {string} */ n) { return this.attrs[n] ?? null; }, setAttribute(/** @type {string} */ n, /** @type {string} */ x) { this.attrs[n] = x; } });
    const radios = FX_CHOICES.map((v) => el({ 'data-i18n-aria': `fx_${v}` }));
    const names = FX_CHOICES.map((v) => el({ 'data-i18n': `fx_${v}` }));
    const root = { querySelectorAll: (/** @type {string} */ q) => (q === '[data-i18n-aria]' ? radios : q === '[data-i18n]' ? names : []) };
    const prev = globalThis.document;
    globalThis.document = /** @type {any} */ ({ documentElement: {} });
    try {
      for (const l of /** @type {const} */ (['en', 'de'])) {
        setLang(l);
        applyStatic(/** @type {any} */ (root));
        FX_CHOICES.forEach((v, i) => {
          expect(radios[i].attrs['aria-label'], `${l} ${v}`).toBe(plain(DICT[l][`fx_${v}`]));
          expect(radios[i].attrs['aria-label'], `${l} ${v}`).not.toContain(SHY);
          expect(names[i].textContent).toBe(DICT[l][`fx_${v}`]);
        });
      }
      expect(radios.find((r) => r.attrs['data-i18n-aria'] === 'fx_typewriter')?.attrs['aria-label']).toBe('Schreibmaschine');
    } finally {
      globalThis.document = prev;
      setLang('en');
    }
  });

  it('the recovery key is gone from the app (texts, screens, API calls)', () => {
    const html = read('public/index.html');
    for (const id of ['f-recover', 'f-newpass', 'v-recovery', 'v-recunconf', 'dlg-recnew', 'b-forgot', 'b-recovery-new']) expect(html, id).not.toContain(`id="${id}"`);
    expect(read('public/js/api.js')).not.toMatch(/\/api\/auth\/recover/);
    for (const l of ['en', 'de']) for (const [k, v] of Object.entries(DICT[l])) expect(v, `${l}.${k}`).not.toMatch(/recovery|Wiederherstell/i);
  });

  it('no visible text hard-coded in index.html outside the boot screen', () => {
    const html = read('public/index.html').replace(/<!--[\s\S]*?-->/g, '');
    const body = html.slice(html.indexOf('<body>'), html.indexOf('</body>'));
    const boot = body.slice(body.indexOf('<section id="v-boot"'), body.indexOf('</section>') + 10);
    const rest = body.replace(boot, '').replace(/<option[^>]*>[^<]*<\/option>/g, '');
    const texts = [...rest.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);
    // Allowed: symbols, units and format names that are the same in both languages
    const allowed = new Set(['◷', '☰', '∑', '⚙', '+', '–', '--:--', '0:00', 'h', '…', 'CSV', 'JSON', '·', '‹', '›']);
    expect(texts.filter((x) => !allowed.has(x))).toEqual([]);
  });

  it('language from the browser: de* → German, else English', () => {
    expect(fromNavigator('de-CH')).toBe('de');
    expect(fromNavigator('de')).toBe('de');
    expect(fromNavigator('fr-CH')).toBe('en');
    expect(fromNavigator(undefined)).toBe('en');
    setLang('de');
    expect(t('about_license')).toBe('Zeropunch™ · freie Software unter der AGPL-3.0');
    setLang('en');
    expect(t('err_min', { n: 10 })).toBe('At least 10 characters.');
  });

  it('singular and plural', () => {
    setLang('en');
    expect(tn('unsynced_text', 1)).toBe('1 change is not on the server yet and will be lost when you log out.');
    expect(tn('unsynced_text', 3)).toMatch(/^3 changes are/);
    expect(tn('break_days', 1, { dur: '0:30' })).toBe('0:30 h (on 1 day)');
    setLang('de');
    expect(tn('break_days', 1, { dur: '0:30' })).toBe('0:30 h (an 1 Tag)');
    expect(tn('heat_title', 1, { day: 'Mo', h: 8, h2: 9 })).toBe('Mo 8–9 Uhr: 1 Punch');
    expect(tn('records_detail', 1, { del: 0, set: '' })).toBe('1 Paket, davon 0 gelöscht');
    expect(t('settings_rec')).not.toMatch(/1 Einstellungen/);
    setLang('en');
  });

  it('the delete word accepts LOESCHEN as well as LÖSCHEN', () => {
    expect(wordMatches('loeschen', 'LÖSCHEN')).toBe(true);
    expect(wordMatches(' Löschen ', 'LÖSCHEN')).toBe(true);
    expect(wordMatches('LOSCHEN', 'LÖSCHEN')).toBe(false);
    expect(wordMatches('delete', 'DELETE')).toBe(true);
  });

  it('the encrypted backup is gone (no import, contradicted the retention)', () => {
    expect(read('public/js/app.js')).not.toMatch(/exportBackup|zeropunch-backup/);
    expect(read('public/js/store.js')).not.toMatch(/backup\(/);
    expect(DICT.en.backup).toBeUndefined();
  });

  it('the name lives in one constant (plus the listed literals)', () => {
    expect(APP_NAME).toBe('Zeropunch');
    expect(WORDMARK.join('')).toBe(APP_NAME);
    const files = ['app.js', 'store.js', 'crypto.js', 'charts.js', 'api.js', 'db.js', 'time.js', 'qr.js', 'dom.js', 'merge.js', 'pow.js', 'wheel.js', 'listview.js'];
    for (const f of files) expect(read(`public/js/${f}`), f).not.toMatch(/'Zeropunch'/);
  });
});

describe('public repository hygiene', () => {
  /** @returns {string[]} */
  function walk(dir) {
    const out = [];
    for (const name of readdirSync(join(root, dir))) {
      if (['node_modules', '.git', '.wrangler', '.dev.vars', 'package-lock.json'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(join(root, p)).isDirectory()) out.push(...walk(p));
      else if (!/\.(png)$/.test(name)) out.push(p);
    }
    return out;
  }

  it('no local paths, old names, e-mail leftovers or obvious secrets', () => {
    const files = walk('.');
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      if (f === 'test/unit/config.test.js' || f === 'LICENSE') continue;
      const s = read(f);
      expect(s, f).not.toMatch(/\/Users\/|\/home\/[a-z]/);
      expect(s, f).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}/); // no e-mail addresses
      expect(s, f).not.toMatch(/-----BEGIN|ghp_[A-Za-z0-9]{20}|sk_live_/);
    }
  });

  it('host names come from the request / location, not from the code', () => {
    for (const f of walk('src').concat(walk('public'))) {
      if (!/\.(js|html|webmanifest)$/.test(f)) continue;
      expect(read(f), f).not.toMatch(/zeropunch\.app|dropnook\.app/);
    }
  });

  // The owner's rule: descriptive prose never names the hosting provider, its products, plans or prices.
  // Case-insensitive words, and product names that are ordinary words in lower case (matched as written).
  const BANNED_ANY = /cloudflare|wrangler|miniflare|workerd|workers\.dev|workers (free|paid)|(free|paid|gratis|bezahl)[- ]?plan|\bplan (free|paid)\b|\$\s?\d/i;
  const BANNED_CASE = /\bD1\b|\bR2\b|\bKV\b|\bWorkers?\b|\bCron Triggers?\b|\bDurable Objects?\b|\bStatic Assets\b|\bWorkers Static Assets\b/;
  // «Service Worker» is the browser's, not the provider's.
  const banned = (/** @type {string} */ text) => {
    const t = text.replace(/service[ -]?workers?/gi, '');
    return BANNED_ANY.exec(t)?.[0] ?? BANNED_CASE.exec(t)?.[0] ?? null;
  };

  it('the banned word list catches what it should, and only that', () => {
    for (const w of ['Cloudflare', 'npx wrangler deploy', 'a Worker', 'Workers Free', 'the free plan', 'Gratis-Plan', 'D1 database', 'Cron Trigger', '$5 a month', 'Durable Object', 'R2', 'KV'])
      expect(banned(w), w).not.toBeNull();
    for (const w of ['service worker', 'Service Worker', 'workers on night shifts', 'a daily scheduled job', 'D10', 'Planung'])
      expect(banned(w), w).toBeNull();
  });

  it('public texts do not name the hosting provider (product site, app texts, package metadata)', () => {
    const site = readdirSync(join(root, 'docs'))
      .filter((f) => /\.(html|txt|js|css|xml|svg)$/.test(f) || f === '_headers')
      .map((f) => `docs/${f}`)
      .concat(['docs/de/index.html'])
      .concat(walk('docs/demo').filter((f) => /\.(js|css)$/.test(f)));
    expect(site).toContain('docs/demo/demo-core.js');
    expect(site).toContain('docs/index.html');
    expect(site).toContain('docs/llms.txt');
    expect(site).toContain('docs/_headers');
    for (const f of [...site, 'public/js/i18n.js', 'public/index.html', 'public/manifest.webmanifest']) {
      expect(banned(read(f)), f).toBeNull();
    }
    const pkg = JSON.parse(read('package.json'));
    expect(banned(`${pkg.description} ${(pkg.keywords || []).join(' ')}`)).toBeNull();
  });

  it('README and KONZEPT name the provider, its products and plans only in the self-hosting section or in code blocks', () => {
    for (const f of ['README.md', 'KONZEPT.md']) {
      let section = '';
      let fenced = false;
      for (const [i, line] of read(f).split('\n').entries()) {
        if (line.startsWith('```')) fenced = !fenced;
        if (!fenced && /^## /.test(line)) section = line;
        if (fenced) continue;
        const hit = banned(line);
        if (!hit) continue;
        expect(section, `${f}:${i + 1} «${hit}» in: ${line}`).toMatch(/^## (Self-hosting|\d+\. Selbst betreiben)$/);
      }
    }
  });

  it('.dev.vars stays out of git', () => {
    expect(read('.gitignore')).toMatch(/^\.dev\.vars$/m);
  });
});
