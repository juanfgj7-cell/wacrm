'use client';

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { SocialPost } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ImageIcon, Plus, Loader2 } from 'lucide-react';
import { PlatformBadge } from '@/components/social-posts/platform-badge';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { getSocialPostStatus } from '@/lib/social-post-status';
import { useTranslations } from 'next-intl';

/** Same cadence as the broadcasts list — see that file for the rationale. */
const POLL_INTERVAL_MS = 5_000;

export default function SocialPostsPage() {
  const router = useRouter();
  const t = useTranslations('SocialPosts.page');
  const tStatus = useTranslations('SocialPosts.status');
  // Reuses the "send-messages" capability (agent role+) — same RLS
  // threshold as social_posts_insert (migration 039), and there's no
  // reason to add a dedicated capability for a second outbound-content
  // feature that already maps to the same role gate.
  const canCreate = useCan('send-messages');
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('social_posts')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setPosts(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const anyPublishing = useMemo(() => posts.some((p) => p.status === 'publishing'), [posts]);

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchPosts, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    function handleVisibilityChange() {
      if (!anyPublishing) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchPosts();
        startPolling();
      }
    }

    if (anyPublishing && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anyPublishing, fetchPosts]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create social posts"
          onClick={() => router.push('/social-posts/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('newPost')}
        </GatedButton>
      </div>

      {posts.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border bg-card">
          <ImageIcon className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t('noPostsYet')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('createFirst')}</p>
          <GatedButton
            canAct={canCreate}
            gateReason="create social posts"
            onClick={() => router.push('/social-posts/new')}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('newPost')}
          </GatedButton>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">{t('table.media')}</TableHead>
                <TableHead className="text-muted-foreground">{t('table.platforms')}</TableHead>
                <TableHead className="text-muted-foreground">{t('table.status')}</TableHead>
                <TableHead className="hidden text-muted-foreground sm:table-cell">{t('table.scheduledFor')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => {
                const status = getSocialPostStatus(post.status);
                return (
                  <TableRow
                    key={post.id}
                    className="cursor-pointer border-border hover:bg-muted/50"
                    onClick={() => router.push(`/social-posts/${post.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                          {post.media_type === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={post.media_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <video src={post.media_url} className="h-full w-full object-cover" />
                          )}
                        </div>
                        <span className="max-w-[220px] truncate text-sm text-foreground">
                          {post.caption || t('noCaption')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {post.target_facebook && <PlatformBadge platform="facebook" className="size-4" />}
                        {post.target_instagram && <PlatformBadge platform="instagram" className="size-4" />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}>
                        {status.pulse && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                          </span>
                        )}
                        {tStatus(status.label)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {new Date(post.run_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
