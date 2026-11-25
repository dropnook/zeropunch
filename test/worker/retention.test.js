import { describe, it, expect } from 'vitest';
import { createExecutionContext, waitOnExecutionContext, createScheduledController } from 'cloudflare:test';
import { call, register, env, worker, fakeRecord, rid, SETTINGS_ID } from './helpers.js';
import { accountId } from '../../src/api.js';
import { runRetention, RETENTION_DAYS, IDLE_DAYS } from '../../src/retention.js';
import { SESSION_TTL } from '../../src/api.js';
import { DAY } from '../../src/limits.js';

const today = () => Math.floor(Date.now() / DAY) * DAY;

/** @param {string} username */
async function ids(username) {
  const uid = await accountId(env, username);
  const { results } = await env.DB.prepare('SELECT id, written FROM records WHERE user_id = ? ORDER BY id').bind(uid).all();
  return { uid, rows: results };
}

describe('retention (daily cron)', () => {
  it('records written today carry the UTC day, not the time', async () => {
    const a = await register();
    await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } });
    const { rows } = await ids(a.username);
    expect(rows[0].written).toBe(today());
  });

  it('13 months: 396 days for records, 61 idle days for accounts, sessions no longer than that', () => {
    expect(RETENTION_DAYS).toBe(396);
    expect(IDLE_DAYS).toBe(61);
    expect(SESSION_TTL).toBe(61 * DAY);
  });

  it('deletes records not written for 396 days (397 go, 396 and 395 stay), keeps the settings record', async () => {
    const a = await register();
    const { uid } = await ids(a.username);
    const old = rid();
    const edge = rid();
    const fresh = rid();
    const put = (id, written) =>
      env.DB.prepare('INSERT INTO records (user_id, id, seq, data, written) VALUES (?, ?, 1, ?, ?)').bind(uid, id, 'A', written).run();
    const near = rid();
    await put(old, today() - 397 * DAY);
    await put(edge, today() - 396 * DAY);
    await put(near, today() - 395 * DAY);
    await put(fresh, today() - 10 * DAY);
    await put(SETTINGS_ID, today() - 800 * DAY);

    const r = await runRetention(env.DB);
    expect(r.records).toBeGreaterThanOrEqual(1);
    const left = (await ids(a.username)).rows.map((x) => x.id);
    expect(left).not.toContain(old);
    expect(left).toContain(edge);
    expect(left).toContain(near);
    expect(left).toContain(fresh);
    expect(left).toContain(SETTINGS_ID);
  });

  it('accounts: idle 62 days → deleted, 61 and 60 days → kept', async () => {
    const accts = [await register(), await register(), await register()];
    const idleDays = [62, 61, 60];
    for (let i = 0; i < 3; i++) {
      const uid = await accountId(env, accts[i].username);
      await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(today() - idleDays[i] * DAY, uid).run();
    }
    await runRetention(env.DB);
    const alive = [];
    for (const a of accts) alive.push(!!(await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(await accountId(env, a.username)).first()));
    expect(alive).toEqual([false, true, true]);
  });

  it('deletes accounts idle for 61 days with records and sessions; active accounts stay', async () => {
    const idle = await register();
    const active = await register();
    for (const a of [idle, active]) await call('PUT', `/api/records/${SETTINGS_ID}`, { jar: a.jar, body: { data: fakeRecord() } });
    const idleId = await accountId(env, idle.username);
    await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(today() - 62 * DAY, idleId).run();

    await runRetention(env.DB);
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(idleId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ?').bind(idleId).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(idleId).first()).toEqual({ n: 0 });
    // its devices are told the account is gone (2.4), not just «logged out»
    expect((await call('GET', '/api/keys', { jar: idle.jar })).status).toBe(410);
    expect((await call('GET', '/api/keys', { jar: active.jar })).status).toBe(200);
    expect((await ids(active.username)).rows).toHaveLength(1);
  });

  it('removes expired sessions, old counters and spent challenges', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    await env.DB.prepare('UPDATE sessions SET expires = 1 WHERE user_id = ?').bind(uid).run();
    await env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, 1)').bind('xx|old', Date.now() - 3 * DAY).run();
    await env.DB.prepare('INSERT INTO pow_used (id, expires) VALUES (?, ?)').bind('spent-and-expired', Date.now() - 1).run();
    await runRetention(env.DB);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(uid).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT 1 FROM limits WHERE key = ?').bind('xx|old').first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM pow_used WHERE id = ?').bind('spent-and-expired').first()).toBeNull();
  });

  it('the scheduled() handler runs it', async () => {
    const a = await register();
    const { uid } = await ids(a.username);
    const old = rid();
    await env.DB.prepare('INSERT INTO records (user_id, id, seq, data, written) VALUES (?, ?, 1, ?, ?)').bind(uid, old, 'A', today() - 397 * DAY).run();
    const ctrl = createScheduledController({ scheduledTime: Date.now(), cron: '17 3 * * *' });
    const ctx = createExecutionContext();
    await worker.scheduled(ctrl, env, ctx);
    await waitOnExecutionContext(ctx);
    expect((await ids(a.username)).rows.map((x) => x.id)).not.toContain(old);
  });

  it('a hard delete removes a record for good (no resurrection by sync)', async () => {
    const a = await register();
    const id = rid();
    await call('PUT', `/api/records/${id}`, { jar: a.jar, body: { data: fakeRecord() } });
    expect((await call('DELETE', `/api/records/${id}`, { jar: a.jar, body: {} })).status).toBe(200);
    const g = await (await call('GET', '/api/records?since=0', { jar: a.jar })).json();
    expect(g.records.map((r) => r.id)).not.toContain(id);
    // Deleting again is harmless
    expect((await (await call('DELETE', `/api/records/${id}`, { jar: a.jar, body: {} })).json()).deleted).toBe(0);
  });
});
