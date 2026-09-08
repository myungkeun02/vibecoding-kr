CREATE TABLE IF NOT EXISTS consents(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,policy TEXT NOT NULL,accepted_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,policy));
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,is_read);
CREATE INDEX IF NOT EXISTS votes_slug ON votes(slug);
