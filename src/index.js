// Zeropunch Worker. Static files are served by Workers Static Assets directly (security headers from
// public/_headers); the Worker runs for /api/* (run_worker_first), for requests that match no asset,
// and for the daily Cron Trigger (retention).

import { handleApi } from './api.js';
import { withSecurityHeaders } from './headers.js';
import { runRetention } from './retention.js';
import { upgradeKeyBlobs } from './api.js';

export default {
  /**
   * @param {Request} request
   * @param {Record<string, any>} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return withSecurityHeaders(await handleApi(request, env));
      } catch (e) {
        console.error('[api] error:', e && e.message ? e.message : 'unknown');
        return withSecurityHeaders(
          new Response(JSON.stringify({ error: 'server' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
          }),
        );
      }
    }

    // Only reached when no static asset matched (e.g. 404) or for other methods.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withSecurityHeaders(new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }));
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  /**
   * Daily retention backstop (wrangler.jsonc → triggers.crons).
   * @param {ScheduledController} controller
   * @param {Record<string, any>} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const r = await runRetention(env.DB, controller.scheduledTime || Date.now());
        // Key blobs still stored in clear from before 2.1 get encrypted at rest.
        const sealed = await upgradeKeyBlobs(env);
        console.log('[retention]', JSON.stringify({ ...r, sealed }));
      })(),
    );
  },
};
