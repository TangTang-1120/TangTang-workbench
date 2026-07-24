-- 邮箱登录
CREATE TABLE IF NOT EXISTS auth_codes (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_email ON auth_sessions(email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions(expires_at);
