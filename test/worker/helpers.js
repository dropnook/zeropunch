import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../../src/index.js';
import { solve } from '../../public/js/pow.js';

export const ORIGIN = 'https://zeropunch.app';
export { env, worker };

/**
 * Simple cookie jar per "device", honouring Max-Age like a browser: `clock` is the jar's own time, so
 * a test can let days pass for the browser (cookies past their Max-Age are no longer sent).
 */
export class Jar {
  constructor() {
    /** @type {Map<string, string>} */
    this.map = new Map();
    /** @type {Map<string, number>} name → expiry (jar time, ms) */
    this.until = new Map();
    this.clock = Date.now();
  }
  /** Let time pass for this browser. @param {number} ms */
  advance(ms) {
    this.clock += ms;
    for (const [name, t] of this.until) if (t <= this.clock) this.map.delete(name);
  }
  /** @param {Response} res */
  take(res) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const maxAge = attrs.map((a) => a.trim()).find((a) => a.toLowerCase().startsWith('max-age='));
      const secs = maxAge ? Number(maxAge.slice(8)) : Infinity;
      if (!value || secs <= 0) {
        this.map.delete(name);
        this.until.delete(name);
      } else {
        this.map.set(name, value);
        this.until.set(name, this.clock + secs * 1000);
      }
    }
  }
  header() {
    return [...this.map].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/**
 * @param {string} method @param {string} path
 * @param {{ body?: any, jar?: Jar, origin?: string|null, ip?: string, host?: string, raw?: string, contentType?: string, env?: any, headers?: Record<string,string> }} [o]
 */
export async function call(method, path, o = {}) {
  const h = new Headers();
  const origin = o.origin === undefined ? o.host || ORIGIN : o.origin;
  if (origin) h.set('Origin', origin);
  h.set('CF-Connecting-IP', o.ip || '203.0.113.1');
  let body;
  if (o.body !== undefined || o.raw !== undefined) {
    h.set('Content-Type', o.contentType || 'application/json');
    body = o.raw !== undefined ? o.raw : JSON.stringify(o.body);
  }
  if (o.jar && o.jar.map.size) h.set('Cookie', o.jar.header());
  for (const [k, v] of Object.entries(o.headers || {})) h.set(k, v);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${o.host || ORIGIN}${path}`, { method, headers: h, body }), o.env || env, ctx);
  await waitOnExecutionContext(ctx);
  if (o.jar) o.jar.take(res);
  return res;
}

/** 32 random bytes as base64url (stand-in for an authKey). */
export function key32() {
  let bin = '';
  for (const b of crypto.getRandomValues(new Uint8Array(32))) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Get and solve a challenge. @param {string} [ip] @param {string} [query] e.g. '?for=login' */
export async function pow(ip, query = '') {
  const ch = await (await call('GET', `/api/auth/challenge${query}`, { ip })).json();
  const { nonce } = await solve(ch.challenge, ch.bits);
  return { challenge: ch.challenge, nonce };
}

let counter = 0;
export const uniqueName = (prefix = 'user') => `${prefix}${++counter}.${Date.now() % 1e7}`.slice(0, 32);
const nextIp = () => `198.51.${100 + (counter % 100)}.${counter % 250}`;

/** Same shape as public/js/crypto.js makes it (12-byte IV, 48-byte wrapped key), random content. */
const b64 = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
export const wrap = () => ({ iv: b64(16), ct: b64(64) });
export const BLOB = { v: 1, pass: wrap() };

/**
 * Register a fresh account via the API. Returns the logged-in jar and its secrets.
 * @param {{ username?: string, ip?: string, keys?: any }} [o]
 */
export async function register(o = {}) {
  const jar = new Jar();
  const username = o.username || uniqueName();
  const ip = o.ip || nextIp();
  const auth = key32();
  const res = await call('POST', '/api/auth/register', {
    jar,
    ip,
    body: { username, auth, keys: o.keys || BLOB, pow: await pow(ip) },
  });
  return { jar, username, ip, auth, res };
}

/** Valid-looking record: base64url of the one length the client writes (12 + 256 + 16 bytes). */
export const fakeRecord = (n = 379, c = 'A') => c.repeat(n);
export const rid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const SETTINGS_ID = '0'.repeat(32);

/**
 * env whose DB counts the queries (first/run/all/raw = 1, a batch = its number of statements) and
 * records their SQL in order. @param {any} [base]
 */
export function counting(base = env) {
  const real = new WeakMap();
  const c = { n: 0, /** @type {string[]} */ sql: [] };
  /** @param {any} st @param {string} sql */
  const wrapStmt = (st, sql) => {
    const p = new Proxy(st, {
      get(t, k) {
        if (k === 'bind') return (...a) => wrapStmt(t.bind(...a), sql);
        if (['first', 'run', 'all', 'raw'].includes(String(k))) {
          return (...a) => {
            c.n++;
            c.sql.push(sql);
            return t[k](...a);
          };
        }
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    real.set(p, { st, sql });
    return p;
  };
  const db = new Proxy(base.DB, {
    get(t, k) {
      if (k === 'prepare') return (sql) => wrapStmt(t.prepare(sql), sql);
      if (k === 'batch') {
        return (stmts) => {
          c.n += stmts.length;
          for (const s of stmts) c.sql.push(real.get(s)?.sql ?? '?');
          return t.batch(stmts.map((s) => real.get(s)?.st || s));
        };
      }
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { env: { ...base, DB: db }, c };
}
