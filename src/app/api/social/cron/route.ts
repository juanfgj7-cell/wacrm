import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/social/admin-client'
import { publishSocialPost } from '@/lib/social/publish'

/**
 * Drain due `social_posts` rows (status='scheduled', run_at <= now)
 * and publish each to its targeted platform(s). Mirrors
 * src/app/api/automations/cron/route.ts's claim pattern: a
 * conditional `UPDATE ... WHERE status='scheduled'` acts as a lock so
 * overlapping cron invocations can't double-publish a row.
 *
 * Auth: reuses AUTOMATION_CRON_SECRET (same env var as the other two
 * cron endpoints, so there's one secret to provision) on its own URL
 * — same "separate URL so one failing doesn't block the other"
 * reasoning as src/app/api/flows/cron/route.ts.
 *
 * No vercel.json exists in this repo (Hostinger deploy) — this route
 * must be registered with whatever external pinger already hits
 * /api/automations/cron and /api/flows/cron.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('social_posts')
    .select('id')
    .eq('status', 'scheduled')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('social_posts')
      .update({ status: 'publishing' })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await publishSocialPost(row.id as string)
    processed++
  }

  return NextResponse.json({ processed })
}
