'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, CalendarClock, Loader2, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlatformBadge } from './platform-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Step4Props {
  targetFacebook: boolean;
  targetInstagram: boolean;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption: string;
  runAt: string;
  isImmediate: boolean;
  onSchedule: () => void;
  onSaveDraft: () => void;
  onBack: () => void;
  isSaving: boolean;
}

export function Step4Review({
  targetFacebook,
  targetInstagram,
  mediaUrl,
  mediaType,
  caption,
  runAt,
  isImmediate,
  onSchedule,
  onSaveDraft,
  onBack,
  isSaving,
}: Step4Props) {
  const t = useTranslations('SocialPosts.wizard.review');
  const [showConfirm, setShowConfirm] = useState(false);

  const runAtLabel = runAt ? new Date(runAt).toLocaleString() : '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 rounded-xl border border-border bg-card/50 p-4 sm:grid-cols-[140px_1fr]">
        <div className="overflow-hidden rounded-lg border border-border bg-muted">
          {mediaType === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <video src={mediaUrl} className="h-full w-full object-cover" />
          )}
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {targetFacebook && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground">
                <PlatformBadge platform="facebook" className="size-3.5" /> Facebook
              </span>
            )}
            {targetInstagram && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground">
                <PlatformBadge platform="instagram" className="size-3.5" /> Instagram
              </span>
            )}
          </div>
          {caption && <p className="whitespace-pre-wrap text-foreground">{caption}</p>}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" />
            {isImmediate ? t('willPublishNow') : t('willPublishAt', { date: runAtLabel })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} disabled={isSaving} className="border-border text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onSaveDraft}
            disabled={isSaving}
            className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {t('saveDraft')}
          </Button>

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={
                <Button disabled={isSaving} className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" />
              }
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isImmediate ? t('publishNow') : t('schedule')}
            </DialogTrigger>
            <DialogContent className="border-border bg-popover sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">{t('confirmTitle')}</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {isImmediate ? t('confirmDescNow') : t('confirmDescScheduled', { date: runAtLabel })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowConfirm(false)} className="border-border text-muted-foreground">
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    onSchedule();
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="h-4 w-4" />
                  {isImmediate ? t('publishNow') : t('schedule')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
