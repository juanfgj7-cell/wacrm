-- ============================================================
-- 039_social_posts.sql
--
-- Queue of scheduled Facebook / Instagram feed posts. Modeled on
-- `automation_pending_executions` (006_automations.sql) — a
-- run_at + status queue drained by a cron endpoint — rather than on
-- `broadcasts.scheduled_at`, which is a column nothing has ever
-- consumed (no write site sets it or transitions a broadcast into
-- `scheduled`).
--
-- Unlike automation_pending_executions this table IS read/written
-- directly by account members (create a post, view the list, retry a
-- failed platform), so — unlike that service-role-only table — it
-- gets full account-scoped RLS (pattern A, same shape as `broadcasts`
-- in 017_account_sharing.sql). The cron worker itself still goes
-- through the service-role client so it isn't blocked by RLS.
--
-- One row can target Facebook, Instagram, or both — `fb_*` / `ig_*`
-- columns track each platform's outcome independently so a partial
-- failure (e.g. Instagram video processing times out but Facebook
-- succeeds) is visible and individually retriable.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  caption TEXT,
  media_path TEXT NOT NULL,   -- social-media storage object path
  media_url TEXT NOT NULL,    -- public URL passed to Graph API
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),

  target_facebook BOOLEAN NOT NULL DEFAULT FALSE,
  target_instagram BOOLEAN NOT NULL DEFAULT FALSE,

  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'canceled')),

  fb_status TEXT CHECK (fb_status IN ('pending', 'success', 'failed')),
  fb_post_id TEXT,
  fb_error TEXT,

  ig_status TEXT CHECK (ig_status IN ('pending', 'success', 'failed')),
  ig_post_id TEXT,
  ig_container_id TEXT,
  ig_error TEXT,

  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT social_posts_at_least_one_target CHECK (target_facebook OR target_instagram)
);

-- Drained by the cron endpoint: due, still-scheduled rows, oldest first.
-- Partial index keeps it cheap as published/failed rows accumulate.
CREATE INDEX IF NOT EXISTS idx_social_posts_due
  ON social_posts(run_at) WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_social_posts_account
  ON social_posts(account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON social_posts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS — pattern A (own account_id column), same shape as `broadcasts`.
-- ============================================================
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_posts_select ON social_posts;
CREATE POLICY social_posts_select ON social_posts
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS social_posts_insert ON social_posts;
CREATE POLICY social_posts_insert ON social_posts
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS social_posts_update ON social_posts;
CREATE POLICY social_posts_update ON social_posts
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS social_posts_delete ON social_posts;
CREATE POLICY social_posts_delete ON social_posts
  FOR DELETE USING (is_account_member(account_id, 'agent'));
