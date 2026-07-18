package db

const oauthAppSchemaSQL = `

CREATE TABLE IF NOT EXISTS oauth_app_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (issuer, subject),
  CHECK (length(CAST(issuer AS BLOB)) BETWEEN 1 AND 2048),
  CHECK (length(CAST(subject AS BLOB)) BETWEEN 1 AND 1024),
  CHECK (length(CAST(user_id AS BLOB)) BETWEEN 1 AND 128),
  CHECK (email IS NULL OR length(CAST(email AS BLOB)) <= 320),
  CHECK (display_name IS NULL OR length(CAST(display_name AS BLOB)) <= 512)
);
CREATE INDEX IF NOT EXISTS idx_oauth_app_identities_user ON oauth_app_identities(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS oauth_app_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  CHECK (length(CAST(id AS BLOB)) BETWEEN 1 AND 128),
  CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(CAST(user_id AS BLOB)) BETWEEN 1 AND 128),
  CHECK (json_valid(scopes_json) AND json_type(scopes_json) = 'array'),
  CHECK (length(CAST(scopes_json AS BLOB)) <= 32768)
);
CREATE INDEX IF NOT EXISTS idx_oauth_app_sessions_user ON oauth_app_sessions(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_oauth_app_sessions_expiry ON oauth_app_sessions(expires_at, revoked_at, id);
`
