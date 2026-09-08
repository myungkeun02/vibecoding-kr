ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id IN (SELECT user_id FROM identities);
