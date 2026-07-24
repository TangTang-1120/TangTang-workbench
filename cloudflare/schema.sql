-- Tang Tang D1 schema
CREATE TABLE IF NOT EXISTS gallery (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  pos_label TEXT,
  has_poster INTEGER DEFAULT 0,
  has_cello INTEGER DEFAULT 0,
  has_solfege INTEGER DEFAULT 0,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  filename TEXT NOT NULL,
  source TEXT,
  featured INTEGER DEFAULT 0,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  filename TEXT,
  r2_key TEXT,
  title TEXT,
  error TEXT,
  mime TEXT,
  file_b64 TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_gallery_updated ON gallery(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_updated ON library(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
