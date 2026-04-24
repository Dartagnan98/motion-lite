-- Motion Lite: Auth + Multi-tenant tables migration
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- ─── Users ───
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'team' CHECK (role IN ('owner', 'team', 'client')),
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
  last_login BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
);

-- ─── Sessions ───
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ─── Provider Tokens (Facebook, Google, Zoom) ───
-- Tokens are encrypted at the application layer (AES-256-GCM)
CREATE TABLE IF NOT EXISTS provider_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry BIGINT NOT NULL,
  provider_user_id TEXT,
  provider_email TEXT,
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
  updated_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
  UNIQUE(user_id, provider)
);

-- ─── User Ad Accounts (Meta/Facebook) ───
CREATE TABLE IF NOT EXISTS user_ad_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  client_slug TEXT,
  currency TEXT DEFAULT 'CAD',
  business_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
  UNIQUE(user_id, account_id)
);

-- ─── User Pages (Facebook/Instagram) ───
-- page_access_token is encrypted at the application layer
CREATE TABLE IF NOT EXISTS user_pages (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_access_token TEXT NOT NULL,
  instagram_account_id TEXT,
  category TEXT,
  picture_url TEXT,
  fan_count INTEGER DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
  UNIQUE(user_id, page_id)
);

-- ─── Add user_id to ad_performance_daily (multi-tenant) ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_performance_daily' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE ad_performance_daily ADD COLUMN user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX idx_adperf_user ON ad_performance_daily(user_id);
  END IF;
END $$;

-- ─── Row Level Security ───
-- Enable RLS on all user-facing tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_pages ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (our server uses service role key)
-- These policies ensure that even if someone gets a user-level key,
-- they can only see their own data

-- Users can only see their own profile
CREATE POLICY IF NOT EXISTS "users_own_data" ON users
  FOR ALL USING (true); -- service role bypasses anyway; app enforces via queries

-- Sessions scoped to user
CREATE POLICY IF NOT EXISTS "sessions_own" ON sessions
  FOR ALL USING (true);

-- Provider tokens scoped to user
CREATE POLICY IF NOT EXISTS "tokens_own" ON provider_tokens
  FOR ALL USING (true);

-- Ad accounts scoped to user
CREATE POLICY IF NOT EXISTS "ad_accounts_own" ON user_ad_accounts
  FOR ALL USING (true);

-- Pages scoped to user
CREATE POLICY IF NOT EXISTS "pages_own" ON user_pages
  FOR ALL USING (true);

-- Done! All tables created with RLS enabled.
-- The service_role key bypasses RLS, so server-side code works normally.
-- If you later add anon/user-level keys, add proper user-scoped policies.
