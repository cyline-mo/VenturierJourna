CREATE TABLE IF NOT EXISTS article_comments (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 2 AND 800),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS article_comments_slug_time_idx
  ON article_comments(article_slug, created_at);

CREATE INDEX IF NOT EXISTS article_comments_user_idx
  ON article_comments(user_id);
