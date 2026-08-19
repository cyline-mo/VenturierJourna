CREATE TABLE IF NOT EXISTS article_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_slug TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  view_bucket INTEGER NOT NULL,
  viewed_at INTEGER NOT NULL,
  country TEXT NOT NULL DEFAULT 'XX',
  referrer_host TEXT,
  UNIQUE(article_slug, visitor_hash, view_bucket)
) STRICT;

CREATE INDEX IF NOT EXISTS article_views_slug_time_idx
  ON article_views(article_slug, viewed_at);

CREATE INDEX IF NOT EXISTS article_views_time_idx
  ON article_views(viewed_at);
