CREATE TABLE admin_members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  google_subject TEXT UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  granted_by TEXT REFERENCES admin_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX admin_members_email ON admin_members(lower(email));
CREATE UNIQUE INDEX admin_single_owner ON admin_members(role) WHERE role='owner';
CREATE TABLE admin_sessions (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES admin_members(id) ON DELETE CASCADE,
  google_subject TEXT NOT NULL,
  csrf TEXT NOT NULL,
  expires BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX admin_sessions_member ON admin_sessions(member_id);
CREATE TABLE admin_oauth_states (
  state TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires BIGINT NOT NULL
);
CREATE TABLE admin_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor TEXT REFERENCES admin_members(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX admin_audit_created ON admin_audit(created_at DESC);
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT REFERENCES admin_members(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO site_settings(key,value) VALUES ('registration_open','true'),('saas_submissions_open','true');
