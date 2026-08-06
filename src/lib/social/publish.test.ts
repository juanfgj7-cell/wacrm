import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Mocks ------------------------------------------------------
// Decrypt is a pass-through; publish.ts never calls encrypt.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((token: string) => {
    if (token === 'corrupted') throw new Error('bad token')
    return `plain:${token}`
  }),
}))

const graphMocks = vi.hoisted(() => ({
  publishFacebookPost: vi.fn(),
  createInstagramContainer: vi.fn(),
  pollInstagramContainerStatus: vi.fn(),
  publishInstagramContainer: vi.fn(),
}))
vi.mock('./meta-graph-api', () => graphMocks)

/**
 * Minimal fake Supabase query builder — enough surface for publish.ts's
 * `.from(table).select().eq().maybeSingle()` (read) and
 * `.from(table).update(patch).eq()` (write) calls. State is a plain
 * object keyed by table name; `update` merges the patch in place so a
 * test can assert on it afterwards.
 */
function makeFakeAdmin(state: Record<string, Record<string, unknown> | null>) {
  return {
    from(table: string) {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          return { data: state[table], error: null }
        },
        update(patch: Record<string, unknown>) {
          if (state[table]) Object.assign(state[table]!, patch)
          return {
            eq: async () => ({ error: null }),
          }
        },
      }
    },
  }
}

vi.mock('./admin-client', () => ({
  supabaseAdmin: vi.fn(),
}))

import { supabaseAdmin } from './admin-client'
import { publishSocialPost } from './publish'

const BASE_POST = {
  id: 'post1',
  account_id: 'acct1',
  media_url: 'https://cdn.example.com/a.jpg',
  media_type: 'image',
  caption: 'hi',
  target_facebook: true,
  target_instagram: false,
  status: 'scheduled' as string,
  fb_status: null as string | null,
  fb_post_id: null as string | null,
  fb_error: null as string | null,
  ig_status: null as string | null,
  ig_post_id: null as string | null,
  ig_error: null as string | null,
  published_at: null as string | null,
}

const BASE_CONFIG = {
  account_id: 'acct1',
  status: 'connected',
  page_id: 'page1',
  page_access_token: 'stored-token',
  ig_business_account_id: 'ig1',
}

describe('publishSocialPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks the post published when its only target succeeds', async () => {
    const state = { social_posts: { ...BASE_POST }, social_config: { ...BASE_CONFIG } }
    vi.mocked(supabaseAdmin).mockReturnValue(makeFakeAdmin(state) as never)
    graphMocks.publishFacebookPost.mockResolvedValue({ postId: 'fbpost1' })

    await publishSocialPost('post1')

    expect(state.social_posts.status).toBe('published')
    expect(state.social_posts.fb_status).toBe('success')
    expect(state.social_posts.fb_post_id).toBe('fbpost1')
    expect(state.social_posts.published_at).toBeTruthy()
  })

  it('marks the post failed and records the error when Facebook rejects it', async () => {
    const state = { social_posts: { ...BASE_POST }, social_config: { ...BASE_CONFIG } }
    vi.mocked(supabaseAdmin).mockReturnValue(makeFakeAdmin(state) as never)
    graphMocks.publishFacebookPost.mockRejectedValue(new Error('Invalid OAuth access token'))

    await publishSocialPost('post1')

    expect(state.social_posts.status).toBe('failed')
    expect(state.social_posts.fb_status).toBe('failed')
    expect(state.social_posts.fb_error).toMatch(/Invalid OAuth/)
  })

  it('computes partial when Facebook succeeds and Instagram fails', async () => {
    const state = {
      social_posts: { ...BASE_POST, target_instagram: true },
      social_config: { ...BASE_CONFIG },
    }
    vi.mocked(supabaseAdmin).mockReturnValue(makeFakeAdmin(state) as never)
    graphMocks.publishFacebookPost.mockResolvedValue({ postId: 'fbpost1' })
    graphMocks.createInstagramContainer.mockRejectedValue(new Error('IG rejected media'))

    await publishSocialPost('post1')

    expect(state.social_posts.status).toBe('partial')
    expect(state.social_posts.fb_status).toBe('success')
    expect(state.social_posts.ig_status).toBe('failed')
    expect(state.social_posts.ig_error).toMatch(/IG rejected media/)
  })

  it('waits for a video container to finish before publishing it', async () => {
    const state = {
      social_posts: { ...BASE_POST, target_facebook: false, target_instagram: true, media_type: 'video' },
      social_config: { ...BASE_CONFIG },
    }
    vi.mocked(supabaseAdmin).mockReturnValue(makeFakeAdmin(state) as never)
    graphMocks.createInstagramContainer.mockResolvedValue({ containerId: 'container1' })
    graphMocks.pollInstagramContainerStatus
      .mockResolvedValueOnce('IN_PROGRESS')
      .mockResolvedValueOnce('FINISHED')
    graphMocks.publishInstagramContainer.mockResolvedValue({ mediaId: 'igmedia1' })

    await publishSocialPost('post1')

    expect(graphMocks.pollInstagramContainerStatus).toHaveBeenCalledTimes(2)
    expect(state.social_posts.ig_status).toBe('success')
    expect(state.social_posts.ig_post_id).toBe('igmedia1')
    expect(state.social_posts.status).toBe('published')
  })

  it('never re-publishes a platform whose status is already success (retry safety)', async () => {
    // Facebook already succeeded on a prior run; only Instagram is
    // targeted for this retry pass.
    const state = {
      social_posts: {
        ...BASE_POST,
        target_instagram: true,
        fb_status: 'success',
        fb_post_id: 'already-posted',
      },
      social_config: { ...BASE_CONFIG },
    }
    vi.mocked(supabaseAdmin).mockReturnValue(makeFakeAdmin(state) as never)
    graphMocks.createInstagramContainer.mockResolvedValue({ containerId: 'container1' })
    graphMocks.publishInstagramContainer.mockResolvedValue({ mediaId: 'igmedia1' })

    await publishSocialPost('post1')

    expect(graphMocks.publishFacebookPost).not.toHaveBeenCalled()
    expect(state.social_posts.fb_post_id).toBe('already-posted')
    expect(state.social_posts.status).toBe('published')
  })

  it('fails both targeted platforms when there is no connected social_config', async () => {
    const state = {
      social_posts: { ...BASE_POST, target_instagram: true },
      social_config: null,
    }
    vi.mocked(supabaseAdmin).mockReturnValue(makeFakeAdmin(state) as never)

    await publishSocialPost('post1')

    expect(state.social_posts!.status).toBe('failed')
    expect(state.social_posts!.fb_status).toBe('failed')
    expect(state.social_posts!.ig_status).toBe('failed')
    expect(graphMocks.publishFacebookPost).not.toHaveBeenCalled()
  })

  it('fails gracefully when the stored token cannot be decrypted', async () => {
    const state = {
      social_posts: { ...BASE_POST },
      social_config: { ...BASE_CONFIG, page_access_token: 'corrupted' },
    }
    vi.mocked(supabaseAdmin).mockReturnValue(makeFakeAdmin(state) as never)

    await publishSocialPost('post1')

    expect(state.social_posts.status).toBe('failed')
    expect(state.social_posts.fb_error).toMatch(/token guardado/)
  })
})
