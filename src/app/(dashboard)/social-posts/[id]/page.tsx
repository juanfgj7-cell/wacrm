'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, RotateCcw } from 'lucide-react';
import { PlatformBadge } from '@/components/social-posts/platform-badge';
import { createClient } from '@/lib/supabase/client';
import type { SocialPost } from '@/types';
import { Button } from '@/components/ui/button';
import { getSocialPostStatus, getSocialPlatformStatus } from '@/lib/social-post-status';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

export default function SocialPostDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('SocialPosts.detail');
  const tStatus = useTranslations('SocialPosts.status');
  const canRetry = useCan('send-messages');

  const [post, setPost] = useState<SocialPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<'facebook' | 'instagram' | null>(null);

  const fetchPost = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('social_posts')
      .select('*')
      .eq('id', params.id)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
    }
    setPost(data);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  /**
   * Retry a single failed platform. Resets that platform's status
   * (and error) back to `pending` and the row to `scheduled` with
   * `run_at = now()` so the next cron tick picks it up. The publish
   * orchestrator (src/lib/social/publish.ts) skips any platform whose
   * status is already `success`, so this never re-posts to a platform
   * that already went out — safe even when retrying after a partial
   * failure.
   */
  async function handleRetry(platform: 'facebook' | 'instagram') {
    if (!post) return;
    setRetrying(platform);
    try {
      const supabase = createClient();
      const update: Record<string, unknown> = {
        status: 'scheduled',
        run_at: new Date().toISOString(),
      };
      if (platform === 'facebook') {
        update.fb_status = 'pending';
        update.fb_error = null;
      } else {
        update.ig_status = 'pending';
        update.ig_error = null;
      }
      const { error } = await supabase.from('social_posts').update(update).eq('id', post.id);
      if (error) throw new Error(error.message);
      toast.success(t('toastRetryQueued'));
      await fetchPost();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastRetryFailed'));
    } finally {
      setRetrying(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/social-posts')}>
          {t('backToList')}
        </Button>
      </div>
    );
  }

  const status = getSocialPostStatus(post.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" onClick={() => router.push('/social-posts')} className="text-muted-foreground">
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Button>

      <div className="grid gap-6 rounded-xl border border-border bg-card p-6 sm:grid-cols-[220px_1fr]">
        <div className="overflow-hidden rounded-lg border border-border bg-muted">
          {post.media_type === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.media_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <video src={post.media_url} controls className="h-full w-full object-cover" />
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.classes}`}>
              {tStatus(status.label)}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('scheduledFor', { date: new Date(post.run_at).toLocaleString() })}
            </span>
          </div>

          {post.caption && <p className="whitespace-pre-wrap text-sm text-foreground">{post.caption}</p>}

          <div className="space-y-2">
            {post.target_facebook && (
              <PlatformRow
                icon={<PlatformBadge platform="facebook" className="size-4" />}
                label="Facebook"
                platformStatus={post.fb_status}
                error={post.fb_error}
                postId={post.fb_post_id}
                onRetry={() => handleRetry('facebook')}
                retrying={retrying === 'facebook'}
                canRetry={canRetry}
                t={t}
                tStatus={tStatus}
              />
            )}
            {post.target_instagram && (
              <PlatformRow
                icon={<PlatformBadge platform="instagram" className="size-4" />}
                label="Instagram"
                platformStatus={post.ig_status}
                error={post.ig_error}
                postId={post.ig_post_id}
                onRetry={() => handleRetry('instagram')}
                retrying={retrying === 'instagram'}
                canRetry={canRetry}
                t={t}
                tStatus={tStatus}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformRow({
  icon,
  label,
  platformStatus,
  error,
  postId,
  onRetry,
  retrying,
  canRetry,
  t,
  tStatus,
}: {
  icon: React.ReactNode;
  label: string;
  platformStatus?: string | null;
  error?: string | null;
  postId?: string | null;
  onRetry: () => void;
  retrying: boolean;
  canRetry: boolean;
  t: ReturnType<typeof useTranslations>;
  tStatus: ReturnType<typeof useTranslations>;
}) {
  const display = getSocialPlatformStatus(platformStatus);
  const failed = platformStatus === 'failed';

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-foreground">
          {icon}
          {label}
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${display.classes}`}>
            {tStatus(`platform.${display.label}`)}
          </span>
        </div>
        {failed && (
          <GatedButton
            canAct={canRetry}
            gateReason="retry a social post"
            size="sm"
            variant="outline"
            onClick={onRetry}
            disabled={retrying}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            {t('retry')}
          </GatedButton>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {postId && !error && (
        <p className="mt-2 text-xs text-muted-foreground">{t('publishedId', { id: postId })}</p>
      )}
    </div>
  );
}
