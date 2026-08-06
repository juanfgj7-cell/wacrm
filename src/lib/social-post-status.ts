/**
 * Shared status badge config for scheduled social posts. Same shape
 * and tolerant-lookup pattern as src/lib/broadcast-status.ts — one
 * source of truth used by the list and detail pages.
 */

import type { SocialPostStatus, SocialPlatformStatus } from "@/types";
import type { StatusDisplay } from "@/lib/broadcast-status";

export const socialPostStatusConfig: Record<SocialPostStatus, StatusDisplay> = {
  draft: {
    label: "draft",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
  scheduled: {
    label: "scheduled",
    classes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  publishing: {
    label: "publishing",
    classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    pulse: true,
  },
  published: {
    label: "published",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  partial: {
    label: "partial",
    classes: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  },
  failed: {
    label: "failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  canceled: {
    label: "canceled",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
};

export const socialPlatformStatusConfig: Record<SocialPlatformStatus, StatusDisplay> = {
  pending: {
    label: "pending",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
  success: {
    label: "success",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  failed: {
    label: "failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

/** Tolerant lookup — falls back to "draft" so the UI never crashes on an unknown value. */
export function getSocialPostStatus(status: string): StatusDisplay {
  return socialPostStatusConfig[status as SocialPostStatus] ?? socialPostStatusConfig.draft;
}

export function getSocialPlatformStatus(status: string | null | undefined): StatusDisplay {
  return socialPlatformStatusConfig[status as SocialPlatformStatus] ?? socialPlatformStatusConfig.pending;
}
