-- Zeropunch 2.4: the recovery key is gone; other devices learn that an account was deleted.
-- Works on existing rows.
-- 1. The hash of the recovery key's auth secret is no longer used: drop the column (SQLite ≥ 3.35;
--    the column is not indexed, not a key and not referenced anywhere else in the schema).
ALTER TABLE users DROP COLUMN rec_auth;

-- 2. Key blobs still stored in plain JSON (from before 2.1) lose their `rec` wrapping right here.
--    json_remove() writes compact JSON in the same key order, i.e. exactly {"v":1,"pass":{"iv":…,"ct":…}}.
UPDATE users SET keys = json_remove(keys, '$.rec') WHERE keys NOT LIKE 'e1.%' AND json_valid(keys);

-- Sealed blobs (prefix "e1.", encrypted at rest under PEPPER) cannot be opened in SQL: the Worker
-- rewrites them without `rec` on the next login or passphrase change, and the daily cron does the
-- remaining rows (and seals the plain rows from step 2).

-- 3. Sessions of deleted accounts: only the session hashes, for as long as a session could have lived
--    (61 days, stored as a UTC day like every other time). A device that still presents such a cookie
--    is told «account deleted» (410) instead of «logged out» (401) and removes its local copy.
--    No account id, no username.
CREATE TABLE gone_sessions (
  hash     TEXT PRIMARY KEY,               -- SHA-256 of the session token (as in sessions.hash)
  expires  INTEGER NOT NULL                -- UTC day start (ms) after which the entry is dropped
);
CREATE INDEX gone_sessions_expires ON gone_sessions(expires);
