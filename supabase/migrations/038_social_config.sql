-- ============================================================
-- 038_social_config.sql
--
-- Meta credentials for the Facebook/Instagram post scheduler
-- (Settings → Social). One row per ACCOUNT, mirroring the
-- `whatsapp_config` shape (001_initial_schema.sql) plus the
-- "saved != actually live" split introduced for WhatsApp by
-- 015_whatsapp_config_registration.sql — `connected_at` /
-- `last_verify_error` play the same role here as `registered_at` /
-- `last_registration_error` do there.
--
-- Unlike WhatsApp, there is no separate webhook-subscription step to
-- track: a Page Access Token with the right permissions can publish
-- immediately, so `status` only needs to reflect "credentials verified
-- against Graph API" rather than a multi-step registration ladder.
--
-- `page_access_token` is stored encrypted the same way
-- `whatsapp_config.access_token` is — see src/lib/whatsapp/encryption.ts,
-- reused as-is (channel-agnostic AES-256-GCM over ENCRYPTION_KEY).
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS social_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Facebook Page
  page_id TEXT,
  page_name TEXT,
  page_access_token TEXT, -- encrypted (iv:ciphertext:authTag)

  -- Instagram Business account linked to the Page above
  ig_business_account_id TEXT,
  ig_username TEXT,

  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  last_verify_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT social_config_account_id_key UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_social_config_account ON social_config(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON social_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON social_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS — same admin-gated shape as whatsapp_config (017_account_sharing.sql):
-- any member can read (so the "Platforms" step of the post wizard can
-- tell which channels are connected), only admins+ can write.
-- ============================================================
ALTER TABLE social_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_config_select ON social_config;
CREATE POLICY social_config_select ON social_config
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS social_config_insert ON social_config;
CREATE POLICY social_config_insert ON social_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS social_config_update ON social_config;
CREATE POLICY social_config_update ON social_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS social_config_delete ON social_config;
CREATE POLICY social_config_delete ON social_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));
