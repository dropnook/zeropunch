import { describe, it, expect } from 'vitest';
import {
  createAccount,
  passphraseKeys,
  unlock,
  rewrapPassphrase,
  encryptRecord,
  decryptRecord,
  normalizeUsername,
  newId,
  b64u,
  unb64u,
  fingerprintRaw,
  pad,
  PBKDF2_ITERATIONS,
  PLAINTEXT_SIZE,
} from '../../public/js/crypto.js';

const USER = 'anna.m';
const PASS = 'richtig-lange-passphrase';
const FAST = { iterations: 1000 }; // tests: fewer rounds; the default is checked separately

describe('key derivation', () => {
  it('600 000 PBKDF2 rounds by default; deterministic per username + passphrase', async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const a = await passphraseKeys(USER, PASS);
    const b = await passphraseKeys(USER, PASS);
    expect(a.auth).toBe(b.auth);
    expect(a.auth).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('authKey and wrapKey are independent; wrapKey cannot be exported', async () => {
    const k = await passphraseKeys(USER, PASS, 1000);
    expect(k.wrapKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', k.wrapKey)).rejects.toThrow();
    // authKey does not decrypt what wrapKey encrypted
    const iv = new Uint8Array(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.wrapKey, new Uint8Array(32));
    const raw = Uint8Array.from(atob(k.auth.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0));
    const asKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, asKey, ct)).rejects.toThrow();
  });

  it('different username or passphrase → different authKey (salt is the username)', async () => {
    const a = await passphraseKeys(USER, PASS, 1000);
    expect((await passphraseKeys('anna.n', PASS, 1000)).auth).not.toBe(a.auth);
    expect((await passphraseKeys(USER, PASS + 'x', 1000)).auth).not.toBe(a.auth);
    // NFC normalisation: composed and decomposed umlaut are the same passphrase
    expect((await passphraseKeys(USER, 'Grüezi-mitenand', 1000)).auth).toBe((await passphraseKeys(USER, 'Grüezi-mitenand', 1000)).auth);
  });

  it('derivation unchanged since 1.0 (PBKDF2 → HKDF «zeropunch auth v1»), recomputed here by hand', async () => {
    const enc = new TextEncoder();
    const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`zeropunch kdf v1|${USER}`)));
    const pb = await crypto.subtle.importKey('raw', enc.encode(PASS), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, pb, 256);
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
    const auth = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('zeropunch auth v1') }, hk, 256);
    expect((await passphraseKeys(USER, PASS, 1000)).auth).toBe(b64u(new Uint8Array(auth)));
  });

  it('usernames: lowercased, 3–32 of a–z 0–9 . _ -', () => {
    expect(normalizeUsername('  Anna.M ')).toBe('anna.m');
    for (const bad of ['ab', 'x'.repeat(33), 'a b', 'ä12', 'a/b', '', null]) expect(normalizeUsername(bad)).toBeNull();
    expect(normalizeUsername('a_b-c.9')).toBe('a_b-c.9');
  });
});

describe('records', () => {
  it('round trip, fixed size, AAD binds username and id', async () => {
    const { key } = await createAccount(USER, PASS, FAST);
    expect(key.extractable).toBe(false);
    const id = newId();
    const rec = { v: 1, ts: 1795600000000, tz: 'Europe/Zurich', note: 'Grüezi «Test»', del: false, mod: 1 };
    const data = await encryptRecord(key, USER, id, rec);
    expect(await decryptRecord(key, USER, id, data)).toEqual(rec);
    const other = await encryptRecord(key, USER, newId(), { v: 1, ts: 1, note: 'x'.repeat(100) });
    expect(other.length).toBe(data.length);
    expect(data.length).toBeLessThanOrEqual(512);
    expect(() => pad({ note: 'x'.repeat(PLAINTEXT_SIZE) })).toThrow();
    await expect(decryptRecord(key, USER, newId(), data)).rejects.toThrow();
    await expect(decryptRecord(key, 'someone', id, data)).rejects.toThrow();
  });
});

describe('wrapping', () => {
  it('unlock with passphrase gives the same key; wrong passphrase or user fails', async () => {
    const made = await createAccount(USER, PASS, FAST);
    const id = newId();
    const data = await encryptRecord(made.key, USER, id, { v: 1, ts: 9 });
    const k = await passphraseKeys(USER, PASS, 1000);
    expect(k.auth).toBe(made.auth);
    const un = await unlock(made.blob, k.wrapKey, USER);
    expect(un.key.extractable).toBe(false);
    expect(un.fingerprint).toBe(made.fingerprint);
    expect((await decryptRecord(un.key, USER, id, data)).ts).toBe(9);
    const wrong = await passphraseKeys(USER, 'falsche-passphrase', 1000);
    await expect(unlock(made.blob, wrong.wrapKey, USER)).rejects.toThrow('wrong_passphrase');
    // a blob for another username does not open (AAD)
    await expect(unlock(made.blob, k.wrapKey, 'anna.x')).rejects.toThrow('wrong_passphrase');
  });

  it('a key blob in the 2.3 shape (with the old `rec` part) still unlocks; the AAD is unchanged', async () => {
    const k = await passphraseKeys(USER, PASS, 1000);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // exactly as 2.3 wrapped it: AES-GCM under wrapKey, AAD "zeropunch1|key|pass|<username>"
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`zeropunch1|key|pass|${USER}`) }, k.wrapKey, raw),
    );
    const old = { v: 1, pass: { iv: b64u(iv), ct: b64u(ct) }, rec: { iv: b64u(iv), ct: b64u(ct) } };
    const un = await unlock(old, k.wrapKey, USER);
    expect(un.fingerprint).toBe(await fingerprintRaw(raw));
    // re-wrapping drops the old part and keeps the master key
    const re = await rewrapPassphrase(old, k.wrapKey, USER, 'ganz-neue-passphrase', FAST);
    expect(Object.keys(re.blob)).toEqual(['v', 'pass']);
    expect(re.fingerprint).toBe(un.fingerprint);
    expect(unb64u(re.blob.pass.ct)).toHaveLength(48);
  });

  it('change passphrase with the old one; too short is refused', async () => {
    const made = await createAccount(USER, PASS, FAST);
    const k = await passphraseKeys(USER, PASS, 1000);
    const re = await rewrapPassphrase(made.blob, k.wrapKey, USER, 'zweite-passphrase', FAST);
    expect(re.fingerprint).toBe(made.fingerprint);
    expect(re.auth).toBe((await passphraseKeys(USER, 'zweite-passphrase', 1000)).auth);
    await expect(unlock(re.blob, k.wrapKey, USER)).rejects.toThrow('wrong_passphrase');
    const bad = await passphraseKeys(USER, 'nein-nein-nein', 1000);
    await expect(rewrapPassphrase(made.blob, bad.wrapKey, USER, 'x'.repeat(12), FAST)).rejects.toThrow('wrong_passphrase');
    await expect(createAccount(USER, 'kurz', FAST)).rejects.toThrow('passphrase_short');
    await expect(createAccount(USER, '12345', FAST)).rejects.toThrow('passphrase_short'); // 5: too short
    await expect(createAccount(USER, '123456', FAST)).resolves.toBeTruthy(); // 6: allowed (the form warns below 10)
  });

  it('a new account has one wrapping only, and the module has no recovery key any more', async () => {
    const made = await createAccount(USER, PASS, FAST);
    expect(Object.keys(made.blob)).toEqual(['v', 'pass']);
    expect(Object.keys(made).sort()).toEqual(['auth', 'blob', 'fingerprint', 'key']);
    const mod = await import('../../public/js/crypto.js');
    for (const gone of ['recoveryKeys', 'newRecoveryKey', 'parseRecoveryKey', 'formatRecoveryKey', 'RECOVERY_BYTES', 'base32']) expect(mod, gone).not.toHaveProperty(gone);
  });
});

describe('2.1 additions', () => {
  it('fingerprintRaw zeroes its temporary copy of the master key', async () => {
    const { fingerprintRaw } = await import('../../public/js/crypto.js');
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const orig = crypto.subtle.digest.bind(crypto.subtle);
    let seen = null;
    crypto.subtle.digest = async (alg, data) => {
      seen = data;
      return orig(alg, data.slice());
    };
    try {
      await fingerprintRaw(raw);
    } finally {
      crypto.subtle.digest = orig;
    }
    expect(seen).toBeInstanceOf(Uint8Array);
    expect(seen.every((b) => b === 0)).toBe(true);
    expect(raw.some((b) => b !== 0)).toBe(true); // the caller's bytes are left alone
  });
});

describe('record length (enforced by the server)', () => {
  it('every encrypted record, settings and punches, short or full, has exactly RECORD_LEN characters', async () => {
    const { RECORD_LEN } = await import('../../src/api.js');
    const { encryptRecord, SETTINGS_ID, PLAINTEXT_SIZE } = await import('../../public/js/crypto.js');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const samples = [
      [SETTINGS_ID, { v: 1, kind: 'settings', weekHours: 42, nerd: true, delayed: false, dayStart: 240, button: 'inout', fx: 'random', mod: 1 }],
      ['a'.repeat(32), { v: 1, ts: 1, tz: 'UTC', note: '', del: false, mod: 1 }],
      ['b'.repeat(32), { v: 1, ts: 1795600000000, tz: 'America/Argentina/ComodRivadavia', note: 'x'.repeat(120), del: true, mod: 1795600000000 }],
    ];
    for (const [id, obj] of samples) expect((await encryptRecord(key, 'some.user', id, obj)).length).toBe(RECORD_LEN);
    expect(RECORD_LEN).toBe(379);
    expect(PLAINTEXT_SIZE).toBe(256);
  });

  it('the largest possible settings record still fits PLAINTEXT_SIZE (every field at its longest value)', async () => {
    const { jsonSize, PLAINTEXT_SIZE } = await import('../../public/js/crypto.js');
    const { DEFAULT_SETTINGS, BUTTON_LABELS, FX_CHOICES, COLORS, BADGE_DAYS_MAX } = await import('../../public/js/store.js');
    const longest = (/** @type {readonly string[]} */ list) => list.reduce((a, b) => (b.length > a.length ? b : a));
    const biggest = {
      ...DEFAULT_SETTINGS,
      weekHours: 79.75, // parseHours: up to 80 with two decimals
      nerd: false,
      dayStart: 1439, // 23:59
      button: longest(BUTTON_LABELS),
      fx: longest(FX_CHOICES),
      badge: BADGE_DAYS_MAX,
      badgeAt: '2099-12-31',
      linkPunch: false,
      color: longest(COLORS),
      holidays: 'CH-AG', // the calendar keys are five characters at most (holidays.test.js)
      pause: '-5.5-15,9.5-60', // the longest break rule: paid short breaks, two steps with half hours
      mod: 9_999_999_999_999, // a timestamp in ms until the year 2286
    };
    // The record carries every field the app knows, and nothing else.
    expect(Object.keys(biggest).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(jsonSize(biggest)).toBeLessThanOrEqual(PLAINTEXT_SIZE);
    // the longest animation choice is a group's random one; it fits with room to spare
    expect(biggest.fx).toBe('random-film');
    expect(PLAINTEXT_SIZE - jsonSize(biggest)).toBeGreaterThanOrEqual(10);
  });
});
