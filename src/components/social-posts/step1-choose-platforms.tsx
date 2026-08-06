'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
import { PlatformBadge } from './platform-badge';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import type { SocialConfig } from '@/types';

interface Step1Props {
  targetFacebook: boolean;
  targetInstagram: boolean;
  onChange: (next: { targetFacebook: boolean; targetInstagram: boolean }) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Platform picker — mirrors the checkbox-card style used elsewhere in
 * the wizard family (e.g. Step2SelectAudience's audience-type cards).
 * Cards for a disconnected platform stay visible but disabled with a
 * link to Settings → Social, rather than being hidden — the user
 * should never wonder why an option disappeared.
 */
export function Step1ChoosePlatforms({
  targetFacebook,
  targetInstagram,
  onChange,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('SocialPosts.wizard.choosePlatforms');
  const { accountId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<SocialConfig | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    supabase
      .from('social_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()
      .then(({ data }) => {
        setConfig(data);
        setLoading(false);
      });
  }, [accountId]);

  const fbConnected = config?.status === 'connected' && !!config?.page_id;
  const igConnected = config?.status === 'connected' && !!config?.ig_business_account_id;
  const canContinue = targetFacebook || targetInstagram;

  function toggle(platform: 'facebook' | 'instagram') {
    if (platform === 'facebook') {
      onChange({ targetFacebook: !targetFacebook, targetInstagram });
    } else {
      onChange({ targetFacebook, targetInstagram: !targetInstagram });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {!fbConnected && !igConnected && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-700/50 bg-amber-950/30 p-4">
          <AlertTriangle className="size-5 shrink-0 text-amber-400" />
          <div className="text-sm text-amber-100/90">
            {t('noConnectionWarning')}{' '}
            <Link href="/settings?tab=social" className="font-medium text-amber-200 underline">
              {t('goToSettings')}
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <PlatformCard
          icon={<PlatformBadge platform="facebook" className="size-8" />}
          label={t('facebook')}
          hint={fbConnected ? config?.page_name || t('connected') : t('notConnected')}
          selected={targetFacebook}
          disabled={!fbConnected}
          onClick={() => toggle('facebook')}
        />
        <PlatformCard
          icon={<PlatformBadge platform="instagram" className="size-8" />}
          label={t('instagram')}
          hint={igConnected ? (config?.ig_username ? `@${config.ig_username}` : t('connected')) : t('notConnected')}
          selected={targetInstagram}
          disabled={!igConnected}
          onClick={() => toggle('instagram')}
        />
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          {t('cancel')}
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

function PlatformCard({
  icon,
  label,
  hint,
  selected,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed border-border bg-muted/40 opacity-50'
          : selected
            ? 'border-primary bg-primary/10'
            : 'border-border bg-card hover:bg-muted'
      }`}
    >
      <span className={`flex size-10 shrink-0 items-center justify-center ${disabled ? 'opacity-60' : ''}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
