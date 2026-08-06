import { supabaseAdmin } from './admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  publishFacebookPost,
  createInstagramContainer,
  pollInstagramContainerStatus,
  publishInstagramContainer,
  type SocialMediaType,
} from './meta-graph-api'

/**
 * Publishes one `social_posts` row to every platform it targets that
 * hasn't already succeeded, then updates the row with the outcome.
 *
 * Called by the cron worker (src/app/api/social/cron/route.ts) after
 * it claims the row, and again by the "Retry" action on the detail
 * page (which resets only the failed platform(s) back to non-success
 * and the row to `scheduled`). Skipping platforms already at
 * `fb_status/ig_status === 'success'` is what makes retry safe — it
 * never re-posts to a platform that already went out.
 *
 * Never throws: every failure mode is caught and recorded on the row
 * so the cron loop can move to the next post and the UI has something
 * concrete to show. No retry/backoff inside a single run, matching
 * the rest of the codebase's Meta-integration style — a transient
 * failure surfaces as `failed`/`partial` and a human retries.
 */
export async function publishSocialPost(postId: string): Promise<void> {
  const admin = supabaseAdmin()

  const { data: post, error: postError } = await admin
    .from('social_posts')
    .select('*')
    .eq('id', postId)
    .maybeSingle()

  if (postError || !post) {
    console.error('[social/publish] post not found:', postId, postError?.message)
    return
  }

  const { data: config, error: configError } = await admin
    .from('social_config')
    .select('*')
    .eq('account_id', post.account_id)
    .maybeSingle()

  if (configError || !config || config.status !== 'connected') {
    const message = 'No hay una cuenta de Facebook/Instagram conectada para esta cuenta.'
    await admin
      .from('social_posts')
      .update({
        status: 'failed',
        fb_status: post.target_facebook ? 'failed' : post.fb_status,
        fb_error: post.target_facebook ? message : post.fb_error,
        ig_status: post.target_instagram ? 'failed' : post.ig_status,
        ig_error: post.target_instagram ? message : post.ig_error,
      })
      .eq('id', postId)
    return
  }

  let pageAccessToken: string
  try {
    pageAccessToken = decrypt(config.page_access_token as string)
  } catch (err) {
    const message = `No se pudo leer el token guardado: ${err instanceof Error ? err.message : String(err)}`
    await admin
      .from('social_posts')
      .update({
        status: 'failed',
        fb_status: post.target_facebook ? 'failed' : post.fb_status,
        fb_error: post.target_facebook ? message : post.fb_error,
        ig_status: post.target_instagram ? 'failed' : post.ig_status,
        ig_error: post.target_instagram ? message : post.ig_error,
      })
      .eq('id', postId)
    return
  }

  const mediaType = post.media_type as SocialMediaType
  const update: Record<string, unknown> = {}

  // ---- Facebook -------------------------------------------------
  if (post.target_facebook && post.fb_status !== 'success') {
    try {
      const result = await publishFacebookPost({
        pageId: config.page_id as string,
        pageAccessToken,
        mediaUrl: post.media_url as string,
        mediaType,
        caption: post.caption ?? undefined,
      })
      update.fb_status = 'success'
      update.fb_post_id = result.postId
      update.fb_error = null
    } catch (err) {
      update.fb_status = 'failed'
      update.fb_error = err instanceof Error ? err.message : String(err)
    }
  }

  // ---- Instagram --------------------------------------------------
  if (post.target_instagram && post.ig_status !== 'success') {
    try {
      const { containerId } = await createInstagramContainer({
        igBusinessAccountId: config.ig_business_account_id as string,
        pageAccessToken,
        mediaUrl: post.media_url as string,
        mediaType,
        caption: post.caption ?? undefined,
      })
      update.ig_container_id = containerId

      if (mediaType === 'video') {
        await waitForContainerReady({ containerId, pageAccessToken })
      }

      const { mediaId } = await publishInstagramContainer({
        igBusinessAccountId: config.ig_business_account_id as string,
        pageAccessToken,
        creationId: containerId,
      })
      update.ig_status = 'success'
      update.ig_post_id = mediaId
      update.ig_error = null
    } catch (err) {
      update.ig_status = 'failed'
      update.ig_error = err instanceof Error ? err.message : String(err)
    }
  }

  // ---- Overall status ---------------------------------------------
  const fbWanted = post.target_facebook
  const igWanted = post.target_instagram
  const fbOk = fbWanted ? (update.fb_status ?? post.fb_status) === 'success' : true
  const igOk = igWanted ? (update.ig_status ?? post.ig_status) === 'success' : true
  const anyOk = (fbWanted && fbOk) || (igWanted && igOk)
  const allOk = fbOk && igOk

  update.status = allOk ? 'published' : anyOk ? 'partial' : 'failed'
  if (anyOk) update.published_at = new Date().toISOString()

  const { error: updateError } = await admin
    .from('social_posts')
    .update(update)
    .eq('id', postId)

  if (updateError) {
    console.error('[social/publish] failed to persist outcome:', postId, updateError.message)
  }
}

/**
 * Poll an Instagram video container until Meta finishes processing it
 * (status_code FINISHED) or gives up. Bounded — 10 attempts, 3s apart
 * (~30s total) — so one slow video can't hold the cron run open
 * indefinitely; a container that's still IN_PROGRESS after that
 * throws, the post is marked `failed` for Instagram with a message
 * that says to retry, and the next cron tick / manual retry tries
 * again (the container itself keeps processing on Meta's side
 * regardless of whether we're watching it).
 */
async function waitForContainerReady(args: {
  containerId: string
  pageAccessToken: string
}): Promise<void> {
  const { containerId, pageAccessToken } = args
  const maxAttempts = 10
  const delayMs = 3000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await pollInstagramContainerStatus({ containerId, pageAccessToken })
    if (status === 'FINISHED') return
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Instagram no pudo procesar el video (status: ${status}).`)
    }
    await sleep(delayMs)
  }

  throw new Error(
    'Instagram sigue procesando el video después de 30s. Vuelve a intentar en unos minutos con "Reintentar".',
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
