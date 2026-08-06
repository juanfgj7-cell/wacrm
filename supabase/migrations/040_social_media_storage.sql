-- ============================================================
-- 040_social_media_storage.sql
--
-- Adds the `social-media` Supabase Storage bucket for the
-- Facebook/Instagram post scheduler. Direct clone of the `chat-media`
-- bucket (023_chat_media.sql) and its account-scoped RLS shape, with
-- two differences suited to ad creative rather than chat attachments:
--
--   1. Higher size limit (100 MB vs 16 MB) — a video ad is routinely
--      larger than anything sent through the WhatsApp composer.
--   2. MIME list trimmed to what Meta's feed-post endpoints accept for
--      Facebook Page photos/videos and Instagram feed media: JPEG/PNG
--      images, MP4/MOV video. No documents/audio — this bucket is not
--      a chat channel.
--
-- Path convention (same as chat-media / flow-media):
--   social-media/account-<account_id>/<timestamp>-<basename>.<ext>
-- Public bucket so Meta's Graph API can fetch media_url/image_url/
-- video_url without auth; writes are scoped to account members via
-- the path's first segment.
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'social-media',
  'social-media',
  TRUE,
  104857600, -- 100 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'video/mp4',
    'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- Storage RLS — account-scoped writes, public reads. Same predicate
-- shape as migrations 020/023.
-- ============================================================
DROP POLICY IF EXISTS "Social media is publicly readable" ON storage.objects;
CREATE POLICY "Social media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'social-media');

DROP POLICY IF EXISTS "Members can upload social media" ON storage.objects;
CREATE POLICY "Members can upload social media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'social-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update social media" ON storage.objects;
CREATE POLICY "Members can update social media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'social-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete social media" ON storage.objects;
CREATE POLICY "Members can delete social media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'social-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
