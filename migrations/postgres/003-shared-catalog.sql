-- Existing registrations keep their IDs and ownership. Seeded tools join the same catalog.
ALTER TABLE services ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE services ADD COLUMN catalog_slug TEXT UNIQUE REFERENCES tools(slug);
ALTER TABLE services ADD COLUMN guide JSONB;
ALTER TABLE services ADD CONSTRAINT services_has_origin CHECK (user_id IS NOT NULL OR catalog_slug IS NOT NULL);
ALTER TABLE posts ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE SET NULL;
CREATE INDEX posts_service ON posts(service_id,board,status);
CREATE TABLE service_edits (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  before_data JSONB NOT NULL,
  after_data JSONB NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX service_edits_one_pending ON service_edits(service_id,user_id) WHERE status='pending';
CREATE INDEX service_edits_review ON service_edits(status,created_at);

ALTER TABLE services DROP CONSTRAINT services_name_check;
ALTER TABLE services ADD CONSTRAINT services_name_check CHECK (char_length(name) BETWEEN 1 AND 80);
