'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { SocialConfig as SocialConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

/**
 * Settings panel for the Facebook Page / Instagram Business connection
 * used by the post scheduler (/social-posts). Structurally a trimmed
 * copy of whatsapp-config.tsx — same save/verify/reset flow — minus
 * the webhook-registration ladder, which doesn't apply here: a Page
 * token with the right permissions can publish immediately, there's
 * no separate "subscribe for inbound events" step.
 */
export function SocialConfig() {
  const t = useTranslations('Settings.social');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<SocialConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const loadedAccountIdRef = useRef<string | null>(null);

  const [pageId, setPageId] = useState('');
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [igBusinessAccountId, setIgBusinessAccountId] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('social_config')
        .select('*')
        .eq('account_id', acctId)
        .maybeSingle();

      if (error) console.error('Failed to load social config row:', error);

      if (data) {
        setConfig(data);
        setPageId(data.page_id || '');
        setIgBusinessAccountId(data.ig_business_account_id || '');
        setPageAccessToken(MASKED_TOKEN);
        setTokenEdited(false);
      } else {
        setConfig(null);
        setPageId('');
        setIgBusinessAccountId('');
        setPageAccessToken('');
        setTokenEdited(false);
      }

      if (data) {
        try {
          const res = await fetch('/api/social/config', { method: 'GET' });
          const payload = await res.json();
          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          } else {
            setConnectionStatus('disconnected');
            setResetReason(
              payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null,
            );
            setStatusMessage(payload.message || '');
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSave() {
    if (!pageId.trim()) {
      toast.error(t('toastPageIdRequired'));
      return;
    }
    if (!config && (!pageAccessToken.trim() || !tokenEdited)) {
      toast.error(t('toastTokenRequired'));
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        page_id: pageId.trim(),
        ig_business_account_id: igBusinessAccountId.trim() || null,
      };

      if (tokenEdited && pageAccessToken !== MASKED_TOKEN && pageAccessToken.trim()) {
        payload.page_access_token = pageAccessToken.trim();
      } else if (config) {
        toast.error(t('toastReenterToken'));
        setSaving(false);
        return;
      }

      const res = await fetch('/api/social/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('toastSaveFailed'));
        setSaving(false);
        return;
      }

      toast.success(
        data.page_info?.name
          ? t('toastConnected', { name: data.page_info.name })
          : t('toastConnectedGeneric'),
      );

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error(t('toastSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/social/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.page_info?.name ? t('toastConnected', { name: payload.page_info.name }) : t('toastTestOk'),
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(
          payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null,
        );
        setStatusMessage(payload.message || '');
        toast.error(payload.message || t('toastTestFailed'));
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error(t('toastTestFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (!confirm(t('resetConfirm'))) return;
    try {
      setResetting(true);
      const res = await fetch('/api/social/config', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastResetFailed'));
        return;
      }
      toast.success(t('toastResetOk'));
      setConfig(null);
      setPageId('');
      setIgBusinessAccountId('');
      setPageAccessToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
    } catch (err) {
      console.error('Reset error:', err);
      toast.error(t('toastResetFailed'));
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {showResetBanner && (
            <Alert className="bg-amber-950/40 border-amber-600/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <AlertTitle className="text-amber-200 mb-1">{t('tokenCorruptedTitle')}</AlertTitle>
                  <AlertDescription className="text-amber-100/80 text-sm">{statusMessage}</AlertDescription>
                  <Button onClick={handleReset} disabled={resetting} size="sm" className="mt-3 bg-amber-600 hover:bg-amber-700 text-white">
                    {resetting ? (
                      <><Loader2 className="size-4 animate-spin" />{t('resetting')}</>
                    ) : (
                      <><RotateCcw className="size-4" />{t('resetConfig')}</>
                    )}
                  </Button>
                </div>
              </div>
            </Alert>
          )}

          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {connectionStatus === 'connected' ? t('credentialsValid') : t('notConnected')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {connectionStatus === 'connected' ? t('connectedDesc') : statusMessage || t('notConnectedDesc')}
            </AlertDescription>
          </Alert>

          {config?.ig_business_account_id && !config?.ig_username && connectionStatus === 'connected' && (
            <Alert className="bg-amber-950/30 border-amber-700/50">
              <AlertTriangle className="size-4 text-amber-400" />
              <AlertTitle className="text-amber-200 mb-0">{t('igNotVerifiedTitle')}</AlertTitle>
              <AlertDescription className="text-muted-foreground text-xs">{t('igNotVerifiedDesc')}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('credentialsTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">{t('credentialsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('pageId')}</Label>
                <Input
                  placeholder="e.g. 100234567890123"
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('pageAccessToken')}</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    placeholder={t('pageAccessTokenPlaceholder')}
                    value={pageAccessToken}
                    onChange={(e) => {
                      setPageAccessToken(e.target.value);
                      setTokenEdited(true);
                    }}
                    onFocus={() => {
                      if (pageAccessToken === MASKED_TOKEN) {
                        setPageAccessToken('');
                        setTokenEdited(true);
                      }
                    }}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {config && !tokenEdited && <p className="text-xs text-muted-foreground">{t('tokenHidden')}</p>}
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('igBusinessAccountId')}
                  <span className="ml-1 text-muted-foreground">{t('optional')}</span>
                </Label>
                <Input
                  placeholder="e.g. 17841400000000000"
                  value={igBusinessAccountId}
                  onChange={(e) => setIgBusinessAccountId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">{t('igBusinessAccountIdHint')}</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              {saving ? <><Loader2 className="size-4 animate-spin" />{t('saving')}</> : t('saveConfig')}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !config}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {testing ? <><Loader2 className="size-4 animate-spin" />{t('testing')}</> : <><Zap className="size-4" />{t('testConnection')}</>}
            </Button>
            {config && (
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={resetting}
                className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
              >
                {resetting ? <><Loader2 className="size-4 animate-spin" />{t('resetting')}</> : <><RotateCcw className="size-4" />{t('resetConfig')}</>}
              </Button>
            )}
          </div>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">{t('setupInstructions')}</CardTitle>
              <CardDescription className="text-muted-foreground">{t('setupInstructionsDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                      {t('step1')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step1_1')}</li>
                      <li>{t('step1_2')}</li>
                      <li>{t('step1_3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      {t('step2')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step2_1')}</li>
                      <li>{t('step2_2')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      {t('step3')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step3_1')}</li>
                      <li>{t('step3_2')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 pt-4 border-t border-border">
                <a
                  href="https://developers.facebook.com/docs/pages-api/posts"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  {t('metaDocs')}
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
