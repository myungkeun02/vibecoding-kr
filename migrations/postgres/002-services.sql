CREATE TABLE services (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  website_url TEXT NOT NULL,
  url_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  tagline TEXT NOT NULL CHECK (char_length(tagline) BETWEEN 10 AND 160),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 30 AND 5000),
  pricing TEXT NOT NULL CHECK (pricing IN ('free','freemium','subscription','one-time','usage-based','contact-sales','unknown')),
  relationship TEXT NOT NULL CHECK (relationship IN ('maker','user')),
  image_id TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','hidden')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);
CREATE INDEX services_public ON services(status,published_at DESC);
CREATE INDEX services_owner ON services(user_id,updated_at DESC);
