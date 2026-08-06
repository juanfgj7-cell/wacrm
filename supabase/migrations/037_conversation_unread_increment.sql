-- ============================================================
-- 037_conversation_unread_increment.sql
--
-- Atomic increment of conversations.unread_count on inbound
-- messages. Called via PostgREST RPC from the webhook handler.
--
-- Before this, processMessage did a read-modify-write:
--   UPDATE conversations SET unread_count = <cached + 1> WHERE id = ...
-- where `<cached>` was read earlier in the same request (via
-- findOrCreateConversation). Two inbound messages landing close
-- together for the same conversation (Meta redelivers, or two
-- messages arrive in the same batch) could both read N and both
-- write N+1, permanently losing one unread count.
--
-- Mirrors migrations 007 / 012 (automations / flows execution
-- counters) — same shape, same security posture. Idempotent: safe
-- to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_conversation_unread(
  p_conversation_id UUID,
  p_last_message_text TEXT,
  p_last_message_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET
    unread_count = unread_count + 1,
    last_message_text = p_last_message_text,
    last_message_at = p_last_message_at,
    updated_at = NOW()
  WHERE id = p_conversation_id;
$$;

-- Only the service role needs to call this (the webhook handler uses
-- the service-role client). Explicitly lock anon / authenticated out
-- so an authenticated user can't juice someone else's conversation
-- counter via RPC.
REVOKE ALL ON FUNCTION public.increment_conversation_unread(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_conversation_unread(UUID, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.increment_conversation_unread(UUID, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_conversation_unread(UUID, TEXT, TIMESTAMPTZ) TO service_role;
