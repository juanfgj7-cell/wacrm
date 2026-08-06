import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  publishFacebookPost,
  createInstagramContainer,
  pollInstagramContainerStatus,
  publishInstagramContainer,
  verifyPageAccess,
} from './meta-graph-api'

interface CapturedRequest {
  url: string
  body: Record<string, unknown> | null
}
let captured: CapturedRequest | null = null

function okFetch(response: unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    captured = { url, body: init?.body ? JSON.parse(init.body as string) : null }
    return { ok: true, json: async () => response } as Response
  })
}

function errorFetch(status: number, message: string) {
  return vi.fn(async (url: string) => {
    captured = { url, body: null }
    return {
      ok: false,
      status,
      json: async () => ({ error: { message } }),
    } as Response
  })
}

describe('publishFacebookPost', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts an image to /photos and prefers post_id over id', async () => {
    vi.stubGlobal('fetch', okFetch({ id: 'photo123', post_id: 'page_post456' }))
    const result = await publishFacebookPost({
      pageId: 'page1',
      pageAccessToken: 'tok',
      mediaUrl: 'https://cdn.example.com/a.jpg',
      mediaType: 'image',
      caption: 'hello',
    })
    expect(captured?.url).toContain('/page1/photos')
    expect(captured?.body).toEqual({ url: 'https://cdn.example.com/a.jpg', caption: 'hello', published: true })
    expect(result.postId).toBe('page_post456')
  })

  it('posts a video to /videos using file_url + description', async () => {
    vi.stubGlobal('fetch', okFetch({ id: 'video123' }))
    const result = await publishFacebookPost({
      pageId: 'page1',
      pageAccessToken: 'tok',
      mediaUrl: 'https://cdn.example.com/a.mp4',
      mediaType: 'video',
      caption: 'watch this',
    })
    expect(captured?.url).toContain('/page1/videos')
    expect(captured?.body).toEqual({
      file_url: 'https://cdn.example.com/a.mp4',
      description: 'watch this',
      published: true,
    })
    expect(result.postId).toBe('video123')
  })

  it('surfaces Meta error message on non-2xx', async () => {
    vi.stubGlobal('fetch', errorFetch(400, 'Invalid OAuth access token'))
    await expect(
      publishFacebookPost({
        pageId: 'page1',
        pageAccessToken: 'bad',
        mediaUrl: 'https://cdn.example.com/a.jpg',
        mediaType: 'image',
      }),
    ).rejects.toThrow(/Invalid OAuth access token/)
  })
})

describe('createInstagramContainer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends image_url for an image container (no media_type)', async () => {
    vi.stubGlobal('fetch', okFetch({ id: 'container1' }))
    await createInstagramContainer({
      igBusinessAccountId: 'ig1',
      pageAccessToken: 'tok',
      mediaUrl: 'https://cdn.example.com/a.jpg',
      mediaType: 'image',
      caption: 'hi',
    })
    expect(captured?.url).toContain('/ig1/media')
    expect(captured?.body).toEqual({ caption: 'hi', image_url: 'https://cdn.example.com/a.jpg' })
  })

  it('sends video_url + media_type=REELS for a video container', async () => {
    vi.stubGlobal('fetch', okFetch({ id: 'container2' }))
    await createInstagramContainer({
      igBusinessAccountId: 'ig1',
      pageAccessToken: 'tok',
      mediaUrl: 'https://cdn.example.com/a.mp4',
      mediaType: 'video',
    })
    expect(captured?.body).toEqual({
      caption: undefined,
      video_url: 'https://cdn.example.com/a.mp4',
      media_type: 'REELS',
    })
  })
})

describe('pollInstagramContainerStatus / publishInstagramContainer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads status_code from the container', async () => {
    vi.stubGlobal('fetch', okFetch({ status_code: 'FINISHED' }))
    const status = await pollInstagramContainerStatus({ containerId: 'c1', pageAccessToken: 'tok' })
    expect(status).toBe('FINISHED')
  })

  it('publishes with the creation_id', async () => {
    vi.stubGlobal('fetch', okFetch({ id: 'media1' }))
    const result = await publishInstagramContainer({
      igBusinessAccountId: 'ig1',
      pageAccessToken: 'tok',
      creationId: 'container1',
    })
    expect(captured?.body).toEqual({ creation_id: 'container1' })
    expect(result.mediaId).toBe('media1')
  })
})

describe('verifyPageAccess', () => {
  beforeEach(() => vi.stubGlobal('fetch', okFetch({ id: 'page1', name: 'My Page' })))
  afterEach(() => vi.unstubAllGlobals())

  it('returns the page info', async () => {
    const info = await verifyPageAccess({ pageId: 'page1', pageAccessToken: 'tok' })
    expect(info).toEqual({ id: 'page1', name: 'My Page' })
  })
})
