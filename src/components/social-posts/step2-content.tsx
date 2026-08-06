'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, X } from 'lucide-react';
import { uploadAccountMedia, deleteAccountMedia } from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const SOCIAL_MEDIA_BUCKET = 'social-media';
/** Matches the bucket's file_size_limit (migration 040). */
const MAX_BYTES = 100 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,video/mp4,video/quicktime';
/** Conservative cap under both Facebook's and Instagram's per-post caption limits. */
export const CAPTION_MAX = 2200;

export interface ContentValue {
  mediaUrl: string;
  mediaPath: string;
  mediaType: 'image' | 'video';
  caption: string;
}

interface Step2Props {
  value: ContentValue;
  onChange: (next: ContentValue) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2Content({ value, onChange, onNext, onBack }: Step2Props) {
  const t = useTranslations('SocialPosts.wizard.content');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(t('fileTooLarge', { max: Math.round(MAX_BYTES / 1024 / 1024) }));
      return;
    }
    const mediaType: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';

    setUploading(true);
    try {
      // Replacing a previous upload — GC the orphaned object first.
      if (value.mediaPath) {
        deleteAccountMedia(SOCIAL_MEDIA_BUCKET, value.mediaPath).catch(() => {});
      }
      const { publicUrl, path } = await uploadAccountMedia(SOCIAL_MEDIA_BUCKET, file);
      onChange({ ...value, mediaUrl: publicUrl, mediaPath: path, mediaType });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  function handleRemove() {
    if (value.mediaPath) {
      deleteAccountMedia(SOCIAL_MEDIA_BUCKET, value.mediaPath).catch(() => {});
    }
    onChange({ ...value, mediaUrl: '', mediaPath: '', mediaType: 'image' });
  }

  const canContinue = !!value.mediaUrl && !uploading;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {value.mediaUrl ? (
        <div className="relative overflow-hidden rounded-xl border border-border bg-card/50">
          <button
            type="button"
            onClick={handleRemove}
            className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-background"
          >
            <X className="size-4" />
          </button>
          {value.mediaType === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.mediaUrl} alt="" className="max-h-80 w-full object-contain" />
          ) : (
            <video src={value.mediaUrl} controls className="max-h-80 w-full" />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/50 py-12 text-muted-foreground hover:bg-muted"
        >
          {uploading ? (
            <Loader2 className="size-8 animate-spin text-primary" />
          ) : (
            <ImagePlus className="size-8" />
          )}
          <span className="text-sm font-medium">{uploading ? t('uploading') : t('selectFile')}</span>
          <span className="text-xs">{t('fileHint')}</span>
        </button>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('caption')}</label>
        <Textarea
          value={value.caption}
          onChange={(e) => onChange({ ...value, caption: e.target.value.slice(0, CAPTION_MAX) })}
          placeholder={t('captionPlaceholder')}
          rows={4}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {value.caption.length}/{CAPTION_MAX}
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!canContinue}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
