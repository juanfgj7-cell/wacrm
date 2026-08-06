'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Step1ChoosePlatforms } from '@/components/social-posts/step1-choose-platforms';
import { Step2Content, type ContentValue } from '@/components/social-posts/step2-content';
import { Step3Schedule } from '@/components/social-posts/step3-schedule';
import { Step4Review } from '@/components/social-posts/step4-review';

const steps = [
  { label: 'platforms', key: 'platforms' },
  { label: 'content', key: 'content' },
  { label: 'schedule', key: 'schedule' },
  { label: 'review', key: 'review' },
] as const;

export default function NewSocialPostPage() {
  const router = useRouter();
  const t = useTranslations('SocialPosts.new');
  const { user, accountId } = useAuth();

  const [currentStep, setCurrentStep] = useState(0);
  const [targetFacebook, setTargetFacebook] = useState(false);
  const [targetInstagram, setTargetInstagram] = useState(false);
  const [content, setContent] = useState<ContentValue>({
    mediaUrl: '',
    mediaPath: '',
    mediaType: 'image',
    caption: '',
  });
  const [runAt, setRunAt] = useState('');
  const [isImmediate, setIsImmediate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function persist(status: 'scheduled' | 'draft') {
    if (!user || !accountId) {
      toast.error(t('toastNotSignedIn'));
      return;
    }
    if (!content.mediaUrl) {
      toast.error(t('toastNoMedia'));
      return;
    }
    if (!targetFacebook && !targetInstagram) {
      toast.error(t('toastNoPlatform'));
      return;
    }
    if (!runAt) {
      toast.error(t('toastNoSchedule'));
      return;
    }

    setIsSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('social_posts')
        .insert({
          account_id: accountId,
          user_id: user.id,
          caption: content.caption || null,
          media_path: content.mediaPath,
          media_url: content.mediaUrl,
          media_type: content.mediaType,
          target_facebook: targetFacebook,
          target_instagram: targetInstagram,
          run_at: runAt,
          status,
        })
        .select('id')
        .single();

      if (error) throw new Error(error.message);

      toast.success(status === 'draft' ? t('toastDraftSaved') : t('toastScheduled'));
      router.push(`/social-posts/${data.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      console.error('Failed to save social post:', err);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'border-2 border-primary bg-primary/10 text-primary'
                        : 'border border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isActive ? 'text-foreground' : isCompleted ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {t(`steps.${step.label}`)}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`mx-3 h-px flex-1 ${index < currentStep ? 'bg-primary' : 'bg-muted'}`} />
              )}
            </div>
          );
        })}
      </div>

      <div className="relative min-h-[400px]">
        <div
          className="transition-all duration-300 ease-in-out"
          style={{ opacity: isSaving ? 0.6 : 1, pointerEvents: isSaving ? 'none' : 'auto' }}
        >
          {currentStep === 0 && (
            <Step1ChoosePlatforms
              targetFacebook={targetFacebook}
              targetInstagram={targetInstagram}
              onChange={({ targetFacebook: fb, targetInstagram: ig }) => {
                setTargetFacebook(fb);
                setTargetInstagram(ig);
              }}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push('/social-posts')}
            />
          )}
          {currentStep === 1 && (
            <Step2Content
              value={content}
              onChange={setContent}
              onNext={() => setCurrentStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && (
            <Step3Schedule
              runAt={runAt}
              onChange={(iso, immediate) => {
                setRunAt(iso);
                setIsImmediate(immediate);
              }}
              onNext={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}
          {currentStep === 3 && (
            <Step4Review
              targetFacebook={targetFacebook}
              targetInstagram={targetInstagram}
              mediaUrl={content.mediaUrl}
              mediaType={content.mediaType}
              caption={content.caption}
              runAt={runAt}
              isImmediate={isImmediate}
              onSchedule={() => persist('scheduled')}
              onSaveDraft={() => persist('draft')}
              onBack={() => setCurrentStep(2)}
              isSaving={isSaving}
            />
          )}
        </div>
      </div>
    </div>
  );
}
