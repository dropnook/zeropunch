// Security headers for Worker responses (/api/* and fallbacks). Static files get the same set from
// public/_headers; a unit test keeps both in sync.

export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  // "empty" = no feature allowed.
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), ' +
    'payment=(), usb=(), interest-cohort=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** New response with security headers (original headers kept). @param {Response} res */
export function withSecurityHeaders(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  // No CORS, whatever was there before.
  out.headers.delete('Access-Control-Allow-Origin');
  out.headers.delete('Access-Control-Allow-Credentials');
  return out;
}
