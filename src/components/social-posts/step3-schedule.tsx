'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Step3Props {
  /** ISO string, or empty until the user picks something. */
  runAt: string;
  /**
   * `immediate` is explicitly set by the "Publish now" button rather
   * than re-derived later by comparing `runAt` against `Date.now()`
   * at render time (that comparison is impure and React's purity lint
   * rejects calling `Date.now()` during render).
   */
  onChange: (isoString: string, immediate: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Native `<input type="datetime-local">` — this repo has no
 * date-picker component or library (checked before building this),
 * and a plain input keeps the wizard dependency-free.
 */
export function Step3Schedule({ runAt, onChange, onNext, onBack }: Step3Props) {
  const t = useTranslations('SocialPosts.wizard.schedule');

  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time, no seconds/zone.
  const localValue = runAt ? toLocalInputValue(runAt) : '';
  const minLocal = toLocalInputValue(new Date().toISOString());

  function handlePickNow() {
    onChange(new Date().toISOString(), true);
  }

  function handlePick(value: string) {
    if (!value) {
      onChange('', false);
      return;
    }
    onChange(new Date(value).toISOString(), false);
  }

  const canContinue = !!runAt;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">{t('dateTime')}</label>
          <Input
            type="datetime-local"
            value={localValue}
            min={minLocal}
            onChange={(e) => handlePick(e.target.value)}
            className="border-border bg-muted text-foreground"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePickNow}
          className="border-border text-muted-foreground hover:bg-muted"
        >
          <Zap className="h-3.5 w-3.5" />
          {t('publishNow')}
        </Button>
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

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
