import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      projects: [
        {
          // Pure modules (client crypto, store, time, QR, i18n, config checks) in Node.
          test: { name: 'unit', include: ['test/unit/**/*.test.js'], environment: 'node' },
        },
        {
          // Worker against a local D1 (Miniflare).
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: {
                bindings: {
                  PEPPER: 'test-pepper',
                  // Small proof of work so the tests stay fast; the real value is in wrangler.jsonc.
                  POW_BITS: '4',
                  // The limit tests exercise the mechanism with 5; production uses the value in wrangler.jsonc.
                  REG_PER_IP_DAY: '5',
                  TEST_MIGRATIONS: migrations,
                },
                // A second, empty database: migration 0003 is tested there on rows in the 2.3 shape.
                // PRE_DB stays at 0001 + 0002: the 2.4 Worker must work there too (deployed before the migration).
                d1Databases: { OLD_DB: 'zeropunch-old-test', PRE_DB: 'zeropunch-pre-test' },
              },
            }),
          ],
          test: {
            name: 'worker',
            include: ['test/worker/**/*.test.js'],
            setupFiles: ['./test/worker/apply-migrations.js'],
          },
        },
      ],
    },
  };
});
