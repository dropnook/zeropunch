import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';
import { call, register, fakeRecord, rid, Jar, key32, BLOB } from './helpers.js';
import { CSP } from '../../src/headers.js';

describe('access to another account', () => {
  it('account B neither sees nor overwrites records of account A', async () => {
    const a = await register();
    const b = await register();
    const id = rid();
    await call('PUT', `/api/records/${id}`, { jar: a.jar, body: { data: fakeRecord() } });

    const bList = await (await call('GET', '/api/records?since=0', { jar: b.jar })).json();
    expect(bList.records).toEqual([]);

    // Same id at B creates B's own record; A is untouched. B's hard delete does not reach A.
    await call('PUT', `/api/records/${id}`, { jar: b.jar, body: { data: fakeRecord(379, 'B') } });
    await call('DELETE', `/api/records/${id}`, { jar: b.jar, body: {} });
    const aList = await (await call('GET', '/api/records?since=0', { jar: a.jar })).json();
    expect(aList.records).toHaveLength(1);
    expect(aList.records[0].data).toBe(fakeRecord());

    // /api/keys always returns the caller's own blob
    const bKeys = await (await call('GET', '/api/keys', { jar: b.jar })).json();
    expect(bKeys.keys).toEqual(BLOB);
    expect(bKeys).not.toHaveProperty('account');
  });

  it('B cannot change A’s passphrase, not even with A’s current authKey', async () => {
    const a = await register();
    const b = await register();
    const r = await call('POST', '/api/auth/passphrase', { jar: b.jar, body: { auth: a.auth, newAuth: key32(), keys: BLOB, version: 1 } });
    expect(r.status).toBe(400);
    expect((await call('POST', '/api/auth/login', { body: { username: a.username, auth: a.auth } })).status).toBe(200);
  });

  it('no session or a made-up cookie: 401', async () => {
    expect((await call('GET', '/api/records?since=0')).status).toBe(401);
    const jar = new Jar();
    jar.map.set('__Host-zp', 'madeUPmadeUPmadeUP');
    expect((await call('GET', '/api/keys', { jar })).status).toBe(401);
  });
});

describe('origin check', () => {
  it('POST/PUT/DELETE without or with a foreign Origin: 403', async () => {
    const a = await register();
    for (const origin of [null, 'https://evil.example', 'https://zp.zeropunch.app', 'http://zeropunch.app']) {
      expect((await call('POST', '/api/auth/register', { origin, body: {} })).status).toBe(403);
      expect((await call('POST', '/api/auth/login', { origin, body: { username: a.username, auth: a.auth } })).status).toBe(403);
      expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() }, origin })).status).toBe(403);
      expect((await call('DELETE', `/api/records/${rid()}`, { jar: a.jar, body: {}, origin })).status).toBe(403);
      expect((await call('DELETE', '/api/account', { jar: a.jar, origin })).status).toBe(403);
      expect((await call('POST', '/api/auth/logout', { jar: a.jar, origin })).status).toBe(403);
    }
    expect((await call('GET', '/api/keys', { jar: a.jar, origin: null })).status).toBe(200);
  });

  it('works on any host as long as Origin matches it (self-hosting)', async () => {
    const host = 'https://punch.example.org';
    const a = await register();
    const r = await call('POST', '/api/auth/login', { host, body: { username: a.username, auth: a.auth } });
    expect(r.status).toBe(200);
  });

  it('no CORS', async () => {
    const r = await call('OPTIONS', '/api/keys', { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const g = await call('GET', '/api/keys', { origin: 'https://evil.example' });
    expect(g.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('headers', () => {
  it('security headers on API responses and on Worker fallbacks', async () => {
    for (const path of ['/api/keys', '/api/nope', '/does-not-exist']) {
      const r = await exports.default.fetch(`https://zeropunch.app${path}`);
      expect(r.headers.get('Content-Security-Policy'), path).toBe(CSP);
      expect(r.headers.get('Strict-Transport-Security'), path).toMatch(/max-age=\d+/);
      expect(r.headers.get('Referrer-Policy'), path).toBe('no-referrer');
      expect(r.headers.get('X-Content-Type-Options'), path).toBe('nosniff');
      expect(r.headers.get('Cross-Origin-Opener-Policy'), path).toBe('same-origin');
      await r.arrayBuffer();
    }
  });

  it('static files carry the headers from public/_headers', async () => {
    for (const path of ['/', '/js/app.js', '/sw.js']) {
      const r = await exports.default.fetch(`https://zeropunch.app${path}`);
      expect(r.status, path).toBe(200);
      expect(r.headers.get('Content-Security-Policy'), path).toBe(CSP);
      expect(r.headers.get('X-Frame-Options'), path).toBe('DENY');
      await r.arrayBuffer();
    }
    const idx = await exports.default.fetch('https://zeropunch.app/');
    expect(idx.headers.get('Cache-Control')).toBe('no-cache');
    expect(await idx.text()).toContain('<title>Zeropunch — a punch clock that knows nothing about you</title>');
    const sw = await exports.default.fetch('https://zeropunch.app/sw.js');
    expect(sw.headers.get('Cache-Control')).toBe('no-cache');
    await sw.arrayBuffer();
  });
});
