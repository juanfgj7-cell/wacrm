/**
 * Meta Graph API helpers for the Facebook Page / Instagram Business
 * post scheduler. Sibling to src/lib/whatsapp/meta-api.ts and
 * deliberately kept self-contained rather than importing from it —
 * same conventions, different Meta product surface (Pages/IG content
 * publishing vs. WhatsApp Cloud API).
 *
 * Every function takes a single named-params object (see meta-api.ts's
 * top comment for why — swapped positional args caused real bugs).
 * No retry/backoff: errors are thrown immediately and it's the
 * caller's job (src/lib/social/publish.ts) to record them per-platform
 * and let a human decide whether to retry.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// Connection verification (Settings → Social "Test connection")
// ============================================================

export interface VerifyPageAccessArgs {
  pageId: string
  pageAccessToken: string
}

export interface MetaPageInfo {
  id: string
  name: string
}

/** Confirm the Page id + token pair is valid by reading the Page's own name. */
export async function verifyPageAccess(args: VerifyPageAccessArgs): Promise<MetaPageInfo> {
  const { pageId, pageAccessToken } = args
  const url = `${META_API_BASE}/${pageId}?fields=id,name`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

export interface VerifyInstagramAccessArgs {
  igBusinessAccountId: string
  pageAccessToken: string
}

export interface MetaInstagramInfo {
  id: string
  username?: string
}

/**
 * Confirm the Instagram Business Account id is reachable with the
 * Page's access token (IG content publishing rides on the linked
 * Page's token, not a separate IG-issued one).
 */
export async function verifyInstagramAccess(
  args: VerifyInstagramAccessArgs,
): Promise<MetaInstagramInfo> {
  const { igBusinessAccountId, pageAccessToken } = args
  const url = `${META_API_BASE}/${igBusinessAccountId}?fields=id,username`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// Facebook Page — feed post
// ============================================================

export type SocialMediaType = 'image' | 'video'

export interface PublishFacebookPostArgs {
  pageId: string
  pageAccessToken: string
  mediaUrl: string
  mediaType: SocialMediaType
  caption?: string
}

export interface PublishFacebookPostResult {
  /** The page-post id (what shows up in Page activity / links to the post). */
  postId: string
}

/**
 * Publish an image or video to a Facebook Page's feed. Two different
 * Graph API edges depending on media type — Meta does not have a
 * single "post anything" endpoint for a Page.
 */
export async function publishFacebookPost(
  args: PublishFacebookPostArgs,
): Promise<PublishFacebookPostResult> {
  const { pageId, pageAccessToken, mediaUrl, mediaType, caption } = args

  if (mediaType === 'image') {
    const url = `${META_API_BASE}/${pageId}/photos`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pageAccessToken}`,
      },
      body: JSON.stringify({
        url: mediaUrl,
        caption: caption || undefined,
        published: true,
      }),
    })
    if (!response.ok) {
      await throwMetaError(response, `Meta API error: ${response.status}`)
    }
    const data = (await response.json()) as { id: string; post_id?: string }
    // `/photos` returns both the photo id (`id`) and the page-post id
    // (`post_id`) once published — prefer post_id, it's what a human
    // recognizes as "the post".
    return { postId: data.post_id ?? data.id }
  }

  // video
  const url = `${META_API_BASE}/${pageId}/videos`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify({
      file_url: mediaUrl,
      description: caption || undefined,
      published: true,
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { id: string }
  return { postId: data.id }
}

// ============================================================
// Instagram Business account — feed post
//
// Instagram content publishing is a two-step "container" flow, not a
// single call:
//   1. POST /{ig-id}/media        → creates a media container, returns
//                                    a creation id.
//   2. POST /{ig-id}/media_publish → publishes that container.
//
// Images publish immediately; video containers process asynchronously
// on Meta's side and must be polled until status_code=FINISHED before
// step 2 will succeed — see pollInstagramContainerStatus below.
//
// ⚠️ The exact request shape for VIDEO containers on the feed (as
// opposed to Reels/Stories) has shifted across Graph API versions —
// verify against Meta's current Content Publishing docs at
// implementation/upgrade time rather than trusting this comment.
// ============================================================

export interface CreateInstagramContainerArgs {
  igBusinessAccountId: string
  pageAccessToken: string
  mediaUrl: string
  mediaType: SocialMediaType
  caption?: string
}

export interface CreateInstagramContainerResult {
  containerId: string
}

/** Step 1 — create a media container for a feed image or video. */
export async function createInstagramContainer(
  args: CreateInstagramContainerArgs,
): Promise<CreateInstagramContainerResult> {
  const { igBusinessAccountId, pageAccessToken, mediaUrl, mediaType, caption } = args
  const url = `${META_API_BASE}/${igBusinessAccountId}/media`
  const body: Record<string, unknown> = { caption: caption || undefined }
  if (mediaType === 'image') {
    body.image_url = mediaUrl
  } else {
    body.video_url = mediaUrl
    // Feed video containers require an explicit media_type on current
    // API versions (Meta has been steering single-video feed posts
    // toward the Reels container type) — confirm this still matches
    // the target API version before shipping.
    body.media_type = 'REELS'
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { id: string }
  return { containerId: data.id }
}

export type InstagramContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED'

export interface PollInstagramContainerStatusArgs {
  containerId: string
  pageAccessToken: string
}

/** Check a container's processing status. Only meaningful for video. */
export async function pollInstagramContainerStatus(
  args: PollInstagramContainerStatusArgs,
): Promise<InstagramContainerStatus> {
  const { containerId, pageAccessToken } = args
  const url = `${META_API_BASE}/${containerId}?fields=status_code`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { status_code: InstagramContainerStatus }
  return data.status_code
}

export interface PublishInstagramContainerArgs {
  igBusinessAccountId: string
  pageAccessToken: string
  creationId: string
}

export interface PublishInstagramContainerResult {
  mediaId: string
}

/** Step 2 — publish a container whose status_code is FINISHED. */
export async function publishInstagramContainer(
  args: PublishInstagramContainerArgs,
): Promise<PublishInstagramContainerResult> {
  const { igBusinessAccountId, pageAccessToken, creationId } = args
  const url = `${META_API_BASE}/${igBusinessAccountId}/media_publish`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify({ creation_id: creationId }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { id: string }
  return { mediaId: data.id }
}
