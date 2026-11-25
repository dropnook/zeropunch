-- Zeropunch: accounts, sessions, encrypted records, rate-limit counters, used proof-of-work challenges.
-- No usernames, no IP addresses, no timestamps per stamp. Times below are server bookkeeping only.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,           -- HMAC(PEPPER, username), hex; never the username itself
  auth          TEXT NOT NULL,              -- HMAC(PEPPER, authKey)
  rec_auth      TEXT NOT NULL,              -- HMAC(PEPPER, recAuth)
  keys          TEXT NOT NULL,              -- wrapped master key (JSON, opaque to the server)
  keys_version  INTEGER NOT NULL DEFAULT 1, -- optimistic lock for passphrase changes
  seq           INTEGER NOT NULL DEFAULT 0, -- running number for sync
  created       INTEGER NOT NULL,           -- UTC day start (ms)
  last_seen     INTEGER NOT NULL            -- UTC day start (ms) of the last authenticated request
);
CREATE INDEX users_last_seen ON users(last_seen);

CREATE TABLE sessions (
  hash     TEXT PRIMARY KEY,                -- SHA-256 of the session token
  user_id  TEXT NOT NULL,
  expires  INTEGER NOT NULL,
  touched  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires);

CREATE TABLE records (
  user_id  TEXT NOT NULL,
  id       TEXT NOT NULL,                   -- random 128-bit id chosen by the client
  seq      INTEGER NOT NULL,
  data     TEXT NOT NULL,                   -- base64url(iv | ciphertext | tag), fixed size
  written  INTEGER NOT NULL,                -- UTC day start (ms) of the last write; retention backstop
  PRIMARY KEY (user_id, id)
);
CREATE INDEX records_seq ON records(user_id, seq);
CREATE INDEX records_written ON records(written);

CREATE TABLE limits (
  key  TEXT NOT NULL,                       -- hashed identifier + counter kind
  win  INTEGER NOT NULL,                    -- window start (ms)
  n    INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);

CREATE TABLE pow_used (
  id       TEXT PRIMARY KEY,                -- id of a spent proof-of-work challenge
  expires  INTEGER NOT NULL
);
CREATE INDEX pow_used_expires ON pow_used(expires);
