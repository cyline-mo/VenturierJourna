CREATE TABLE IF NOT EXISTS guest_article_comments (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 30),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 2 AND 800),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS guest_article_comments_slug_time_idx
  ON guest_article_comments(article_slug, created_at);
