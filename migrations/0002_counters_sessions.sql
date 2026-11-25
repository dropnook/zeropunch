-- Zeropunch 2.1: works on existing rows, adds nothing that identifies anyone.
-- 1. Record counter per account (replaces COUNT(*) on every write), back-filled from the records.
ALTER TABLE users ADD COLUMN nrec INTEGER NOT NULL DEFAULT 0;
UPDATE users SET nrec = (SELECT COUNT(*) FROM records WHERE records.user_id = users.id);

-- 2. Session times only as UTC days: touched rounded down, expires rounded up (nobody is logged out early).
UPDATE sessions SET
  touched = (touched / 86400000) * 86400000,
  expires = ((expires + 86399999) / 86400000) * 86400000;

-- 3. Sessions without an account.
DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users);

-- The wrapped-key blob (users.keys) is encrypted at rest by the Worker (prefix "e1."): on the next
-- login or key change, and by the daily cron for all remaining rows. Plain rows stay readable.
